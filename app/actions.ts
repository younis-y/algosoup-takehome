"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { battery, db, dispatchPlan, planInterval } from "@/db";
import { getPrices } from "@/lib/elexon";
import { optimise, settle, validateBattery, type BatterySpec } from "@/lib/optimise";
import { expectedPeriods, previousDay } from "@/lib/periods";

export type FormState = { error?: string } | undefined;

const num = (f: FormData, k: string) => Number(f.get(k));
const pct = (f: FormData, k: string) => Number(f.get(k)) / 100;
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function createBattery(_: FormState, f: FormData): Promise<FormState> {
  const name = String(f.get("name") ?? "").trim();
  const spec: BatterySpec = {
    capacityMwh: num(f, "capacityMwh"), powerMw: num(f, "powerMw"), rte: pct(f, "rte"),
    minSoc: pct(f, "minSoc"), maxSoc: pct(f, "maxSoc"), maxCyclesPerDay: num(f, "maxCyclesPerDay"),
  };
  const errors = [...(name ? [] : ["Name is required"]), ...validateBattery(spec)];
  if (errors.length) return { error: errors.join(". ") };
  const [row] = await db.insert(battery).values({ name, ...spec }).returning({ id: battery.id });
  redirect(`/batteries/${row.id}`);
}

export async function generatePlan(_: FormState, f: FormData): Promise<FormState> {
  const batteryId = num(f, "batteryId");
  const deliveryDate = f.get("deliveryDate");
  if (!isDate(deliveryDate)) return { error: "Pick a delivery date" };
  const b = await db.query.battery.findFirst({ where: eq(battery.id, batteryId) });
  if (!b) return { error: "Battery not found" };

  // Naive persistence forecast: plan day D on day D-1's prices, matched by period number.
  const forecastDate = previousDay(deliveryDate);
  const forecast = await getPrices(forecastDate);
  const n = expectedPeriods(deliveryDate);
  if (forecast.rows.length < n / 2) {
    return { error: `Not enough forecast prices for ${forecastDate} (${forecast.rows.length}/${forecast.expected})${forecast.error ? `: ${forecast.error}` : ""}` };
  }
  const byPeriod = new Map(forecast.rows.map((r) => [r.settlementPeriod, r.priceGbpMwh]));
  const spec: BatterySpec = {
    capacityMwh: b.capacityMwh, powerMw: b.powerMw, rte: b.rte,
    minSoc: b.minSoc, maxSoc: b.maxSoc, maxCyclesPerDay: b.maxCyclesPerDay,
  };
  const plan = optimise(spec, Array.from({ length: n }, (_, i) => ({ period: i + 1, price: byPeriod.get(i + 1) ?? null })));

  // Upsert only over a draft: approved/executed plans are immutable.
  const values = { batteryId, deliveryDate, forecastDate, params: spec, expectedPnl: plan.expectedPnl, status: "draft" as const };
  const [row] = await db.insert(dispatchPlan).values(values)
    .onConflictDoUpdate({
      target: [dispatchPlan.batteryId, dispatchPlan.deliveryDate],
      set: { ...values, createdAt: new Date(), realisedPnl: null },
      setWhere: eq(dispatchPlan.status, "draft"),
    })
    .returning({ id: dispatchPlan.id });
  if (!row) return { error: `A plan for ${deliveryDate} is already approved and can't be regenerated` };

  await db.batch([
    db.delete(planInterval).where(eq(planInterval.planId, row.id)),
    db.insert(planInterval).values(plan.intervals.map((i) => ({
      planId: row.id, period: i.period, action: i.action, mwh: i.mwh, socAfterMwh: i.socAfterMwh, forecastPrice: i.price,
    }))),
  ]);
  revalidatePath(`/batteries/${batteryId}`);
  redirect(`/plans/${row.id}`);
}

export async function approvePlan(_: FormState, f: FormData): Promise<FormState> {
  const id = num(f, "planId");
  const [row] = await db.update(dispatchPlan).set({ status: "approved", approvedAt: new Date() })
    .where(and(eq(dispatchPlan.id, id), eq(dispatchPlan.status, "draft")))
    .returning({ id: dispatchPlan.id });
  if (!row) return { error: "Only a draft plan can be approved" };
  revalidatePath(`/plans/${id}`);
}

export async function executePlan(_: FormState, f: FormData): Promise<FormState> {
  const id = num(f, "planId");
  const plan = await db.query.dispatchPlan.findFirst({ where: eq(dispatchPlan.id, id) });
  if (!plan) return { error: "Plan not found" };
  if (plan.status !== "approved") return { error: "Only an approved plan can be executed" };

  const actual = await getPrices(plan.deliveryDate);
  if (!actual.complete) {
    return { error: `Actual prices for ${plan.deliveryDate} are incomplete (${actual.rows.length}/${actual.expected}). Try again once the day has settled.` };
  }
  const intervals = await db.select().from(planInterval).where(eq(planInterval.planId, id));
  const actualByPeriod = new Map(actual.rows.map((r) => [r.settlementPeriod, r.priceGbpMwh]));
  const realised = settle(intervals.map((i) => ({ ...i, price: i.forecastPrice })), actualByPeriod);
  if (realised === null) return { error: "Some traded periods have no actual price" };

  const [row] = await db.update(dispatchPlan).set({ status: "executed", executedAt: new Date(), realisedPnl: realised })
    .where(and(eq(dispatchPlan.id, id), eq(dispatchPlan.status, "approved")))
    .returning({ id: dispatchPlan.id });
  if (!row) return { error: "Plan was changed by someone else; reload" };
  await db.batch(intervals.map((i) =>
    db.update(planInterval).set({ actualPrice: actualByPeriod.get(i.period) ?? null })
      .where(and(eq(planInterval.planId, id), eq(planInterval.period, i.period)))) as [never, ...never[]]);
  revalidatePath(`/plans/${id}`);
}
