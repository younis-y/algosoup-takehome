import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { battery, db, dispatchPlan, planInterval } from "@/db";
import { DispatchChart } from "@/components/dispatch-chart-lazy";
import { PlanActions } from "@/components/forms";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STAGE, gbp, londonToday, niceDate, periodTime, ukClock } from "@/lib/format";
import { Abbr, Glossary } from "@/components/glossary";
import type { DcBlock } from "@/lib/frequency";
import type { BatterySpec } from "@/lib/optimise";

export default async function PlanPage({ params }: PageProps<"/plans/[id]">) {
  await connection(); // always render per request: plans change state
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const plan = await db.query.dispatchPlan.findFirst({ where: eq(dispatchPlan.id, id) });
  if (!plan) notFound();
  const [b, intervals] = await Promise.all([
    db.query.battery.findFirst({ where: eq(battery.id, plan.batteryId) }),
    db.select().from(planInterval).where(eq(planInterval.planId, id)).orderBy(asc(planInterval.period)),
  ]);
  const spec = plan.params as BatterySpec; // settings as they were when the plan was made
  const s = Math.sqrt(spec.rte);
  const traded = intervals.filter((i) => i.action === "charge" || i.action === "discharge");
  const unpriced = intervals.filter((i) => i.forecastPrice === null).map((i) => i.period);
  const drawn = traded.reduce((a, i) => a + (i.action === "discharge" ? i.mwh / s : 0), 0);
  const cycles = drawn / ((spec.maxSoc - spec.minSoc) * spec.capacityMwh);
  const executed = plan.status === "executed";
  const mix = plan.pnlBreakdown as { arbitrage: number; frequency: number; arbitrageOnly: number; committed: DcBlock[] } | null;
  const hours = intervals.length / 2;
  const clockNote = intervals.length === 46 ? " (the clocks went forward, so this day is only 23 hours)" : intervals.length === 50 ? " (the clocks went back, so this day has 25 hours)" : "";
  const time = (period: number) => periodTime(plan.deliveryDate, period);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/batteries/${plan.batteryId}`} className="text-sm text-muted-foreground hover:underline">← {b?.name ?? "Battery"}</Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Plan for {niceDate(plan.deliveryDate)}</h1>
            <Badge data-testid="plan-status" variant={plan.status}>{STAGE[plan.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {intervals.length} <Abbr term="Half-hour">half-hours</Abbr>{clockNote} · prices <Abbr term="Guess">guessed</Abbr> from {niceDate(plan.forecastDate)} ·
            {" "}uses {cycles.toFixed(1)} of {spec.maxCyclesPerDay} <Abbr term="Fill">fills</Abbr> allowed
          </p>
        </div>
        {/* Actions sit with the stage they change. Real prices are complete only after the UK day ends. */}
        <PlanActions planId={plan.id} status={plan.status} settlesAfter={plan.deliveryDate >= londonToday() ? niceDate(plan.deliveryDate) : null} />
      </div>

      {unpriced.length > 0 && (
        <Alert><AlertDescription>
          We had no price guess for half-hour{unpriced.length > 1 ? "s" : ""} {unpriced.join(", ")}, because the day before had fewer half-hours or some prices were missing.
          The battery rests then instead of guessing a price.
        </AlertDescription></Alert>
      )}

      {mix && mix.committed.length > 0 && (
        <Alert><AlertDescription>
          <b>Standby job</b> (<Abbr term="DC" />) {mix.committed.map((k) => `${ukClock(k.start)}–${ukClock(k.end)}`).join(", ")}: the grid operator pays the battery just to stay ready
          to push or soak up up to {spec.powerMw} <Abbr term="MW" /> in under a second if the grid wobbles. It doesn&apos;t buy or sell during those times, and keeps
          enough charge to help for 15 minutes either way.
        </AlertDescription></Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader>
          <p className="text-sm text-muted-foreground">Money we expect to make <span className="text-xs">(expected <Abbr term="P&L" />)</span></p>
          <CardTitle className="tabular-nums text-2xl">{gbp(plan.expectedPnl)}</CardTitle>
          {mix && mix.frequency > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="pnl-mix">
              {gbp(mix.arbitrage)} from buying and selling + {gbp(mix.frequency)} from the standby job · {gbp(plan.expectedPnl - mix.arbitrageOnly)} more than buying and selling alone
            </p>
          )}
        </CardHeader></Card>
        <Card><CardHeader>
          <p className="text-sm text-muted-foreground">Money it really made <span className="text-xs">(realised <Abbr term="P&L" />)</span></p>
          <CardTitle className="tabular-nums text-2xl">{executed ? gbp(plan.realisedPnl) : "Not known yet"}</CardTitle>
          {!executed && <p className="text-xs text-muted-foreground">We find out after the day is over and the plan is marked done.</p>}
        </CardHeader></Card>
        <Card><CardHeader>
          <p className="text-sm text-muted-foreground">How far off our guess was</p>
          <CardTitle className="tabular-nums text-2xl">{executed ? gbp((plan.realisedPnl ?? 0) - plan.expectedPnl) : "—"}</CardTitle>
          {executed && <p className="text-xs text-muted-foreground">Real money minus expected money. Below zero means the guess was too hopeful.</p>}
        </CardHeader></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>When it buys and sells</CardTitle>
          <p className="text-sm text-muted-foreground">Every half-hour where the battery does something. The rest of the time it waits.</p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead><TableHead>What it does</TableHead><TableHead className="text-right">Energy (<Abbr term="MWh" />)</TableHead>
                <TableHead className="text-right"><Abbr term="Charge">Charge</Abbr> after (MWh)</TableHead>
                <TableHead className="text-right">Guessed price (<Abbr term="£/MWh" />)</TableHead><TableHead className="text-right">Real price (£/MWh)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traded.map((i) => (
                <TableRow key={i.period}>
                  <TableCell className="tabular-nums">{time(i.period)}</TableCell>
                  <TableCell>{i.action === "charge" ? "Buy (fill up)" : "Sell (empty)"}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.mwh.toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.socAfterMwh.toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.forecastPrice == null ? "—" : `£${i.forecastPrice.toFixed(2)}`}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.actualPrice == null ? "—" : `£${i.actualPrice.toFixed(2)}`}</TableCell>
                </TableRow>
              ))}
              {traded.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No good times to buy and sell on this guess, so the battery just waits.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The day at a glance</CardTitle>
          <p className="text-sm text-muted-foreground">
            Top: the price of electricity through the {hours}-hour day. Bottom: bars below the line are buying (filling up), bars above are selling;
            the green line shows how full the battery is. Grey shading is the standby job.
          </p>
        </CardHeader>
        <CardContent>
          <DispatchChart showActual={executed} rows={intervals.map((i) => ({
            period: i.period, time: time(i.period), forecastPrice: i.forecastPrice, actualPrice: i.actualPrice,
            charge: i.action === "charge" ? i.mwh : 0, discharge: i.action === "discharge" ? i.mwh : 0, soc: i.socAfterMwh, reserved: i.action === "reserve",
          }))} />
        </CardContent>
      </Card>

      <Glossary />
    </div>
  );
}
