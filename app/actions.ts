"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { battery, db, dispatchPlan, planInterval } from "@/db";
import { getPrices } from "@/lib/elexon";
import { planWithFrequency, type DcBlock } from "@/lib/frequency";
import { getDcPrices } from "@/lib/neso";
import { settle, validateBattery, type BatterySpec } from "@/lib/optimise";
import { STAGE, londonToday, niceDate } from "@/lib/format";
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
  if (deliveryDate > londonToday()) return { error: "You can plan up to today. We need the day before's prices to make a guess" };
  if (!Number.isInteger(batteryId)) return { error: "Battery not found" };
  const b = await db.query.battery.findFirst({ where: eq(battery.id, batteryId) });
  if (!b) return { error: "Battery not found" };

  // Naive persistence forecast: plan day D on day D-1's prices, matched by period number.
  const forecastDate = previousDay(deliveryDate);
  const forecast = await getPrices(forecastDate);
  const n = expectedPeriods(deliveryDate);
  if (forecast.rows.length < n / 2) {
    return { error: `Not enough prices from ${niceDate(forecastDate)} to make a guess (${forecast.rows.length}/${forecast.expected})${forecast.error ? `: ${forecast.error}` : ""}` };
  }
  const byPeriod = new Map(forecast.rows.map((r) => [r.settlementPeriod, r.priceGbpMwh]));
  const spec: BatterySpec = {
    capacityMwh: b.capacityMwh, powerMw: b.powerMw, rte: b.rte,
    minSoc: b.minSoc, maxSoc: b.maxSoc, maxCyclesPerDay: b.maxCyclesPerDay,
  };
  const slots = Array.from({ length: n }, (_, i) => ({ period: i + 1, price: byPeriod.get(i + 1) ?? null }));

  // DC auction results for day D clear on D-1, so they're known at planning time. If NESO
  // is unavailable we fall back to arbitrage only (no blocks to commit).
  const dc = await getDcPrices(deliveryDate);
  const blocks = new Map<string, DcBlock>();
  for (const r of dc.rows) {
    const k = blocks.get(r.deliveryStart) ?? { start: r.deliveryStart, end: r.deliveryEnd, dch: 0, dcl: 0 };
    if (r.product === "DCH") k.dch = r.priceGbpMwH; else k.dcl = r.priceGbpMwH;
    blocks.set(r.deliveryStart, k);
  }
  const plan = planWithFrequency(spec, deliveryDate, slots, [...blocks.values()]);
  const pnlBreakdown = {
    arbitrage: plan.arbitragePnl, frequency: plan.frequencyPnl, arbitrageOnly: plan.arbitrageOnlyPnl,
    committed: plan.committed,
  };

  // One transaction: upsert the plan (only over a draft) and replace its intervals.
  // If the existing plan is approved/executed, the upsert is a no-op, the id subquery
  // finds no draft, the NOT NULL plan_id fails and the whole batch rolls back.
  const values = { batteryId, deliveryDate, forecastDate, params: spec, expectedPnl: plan.expectedPnl, pnlBreakdown, status: "draft" as const };
  const draftId = sql<number>`(select ${dispatchPlan.id} from ${dispatchPlan} where ${dispatchPlan.batteryId} = ${batteryId} and ${dispatchPlan.deliveryDate} = ${deliveryDate} and ${dispatchPlan.status} = 'draft')`;
  let planId: number;
  try {
    const [[row]] = await db.batch([
      db.insert(dispatchPlan).values(values)
        .onConflictDoUpdate({
          target: [dispatchPlan.batteryId, dispatchPlan.deliveryDate],
          set: { ...values, createdAt: new Date(), realisedPnl: null },
          setWhere: eq(dispatchPlan.status, "draft"),
        })
        .returning({ id: dispatchPlan.id }),
      db.delete(planInterval).where(eq(planInterval.planId, draftId)),
      db.insert(planInterval).values(plan.intervals.map((i) => ({
        planId: draftId, period: i.period, action: i.action, mwh: i.mwh, socAfterMwh: i.socAfterMwh, reservedMw: i.reservedMw, forecastPrice: i.price,
      }))),
    ]);
    planId = row.id;
  } catch (e) {
    const existing = await db.query.dispatchPlan.findFirst({
      where: and(eq(dispatchPlan.batteryId, batteryId), eq(dispatchPlan.deliveryDate, deliveryDate)),
    });
    if (existing && existing.status !== "draft") return { error: `The plan for ${niceDate(deliveryDate)} is already ${STAGE[existing.status].toLowerCase()}, so it can't be changed` };
    throw e;
  }
  revalidatePath(`/batteries/${batteryId}`);
  redirect(`/plans/${planId}`);
}

export async function approvePlan(_: FormState, f: FormData): Promise<FormState> {
  const id = num(f, "planId");
  if (!Number.isInteger(id)) return { error: "Plan not found" };
  const [row] = await db.update(dispatchPlan).set({ status: "approved", approvedAt: new Date() })
    .where(and(eq(dispatchPlan.id, id), eq(dispatchPlan.status, "draft")))
    .returning({ id: dispatchPlan.id });
  if (!row) return { error: "Only a draft plan can be approved" };
  revalidatePath(`/plans/${id}`);
}

export async function executePlan(_: FormState, f: FormData): Promise<FormState> {
  const id = num(f, "planId");
  if (!Number.isInteger(id)) return { error: "Plan not found" };
  const plan = await db.query.dispatchPlan.findFirst({ where: eq(dispatchPlan.id, id) });
  if (!plan) return { error: "Plan not found" };
  if (plan.status !== "approved") return { error: "Only an approved plan can be executed" };

  const actual = await getPrices(plan.deliveryDate);
  if (!actual.complete) {
    return { error: `The real prices for ${niceDate(plan.deliveryDate)} aren't all in yet (${actual.rows.length} of ${actual.expected} half-hours). Try again once the day is over.` };
  }
  const intervals = await db.select().from(planInterval).where(eq(planInterval.planId, id));
  const actualByPeriod = new Map(actual.rows.map((r) => [r.settlementPeriod, r.priceGbpMwh]));
  const realised = settle(intervals.map((i) => ({ ...i, price: i.forecastPrice })), actualByPeriod);
  if (realised === null) return { error: "Some traded periods have no actual price" };
  // DC availability fees are fixed at auction, so they settle as planned.
  const frequency = (plan.pnlBreakdown as { frequency?: number } | null)?.frequency ?? 0;

  // One transaction: flip status (only if still approved) and write actual prices together.
  // If a concurrent request won the flip, these price writes repeat the same settled prices: harmless.
  const [flipped] = await db.batch([
    db.update(dispatchPlan).set({ status: "executed", executedAt: new Date(), realisedPnl: realised + frequency })
      .where(and(eq(dispatchPlan.id, id), eq(dispatchPlan.status, "approved")))
      .returning({ id: dispatchPlan.id }),
    ...intervals.map((i) =>
      db.update(planInterval).set({ actualPrice: actualByPeriod.get(i.period) ?? null })
        .where(and(eq(planInterval.planId, id), eq(planInterval.period, i.period)))),
  ]);
  if (flipped.length === 0) return { error: "Someone else changed this plan just now. Reload the page." };
  revalidatePath(`/plans/${id}`);
}
