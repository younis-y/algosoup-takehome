import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { battery, db, dispatchPlan, planInterval } from "@/db";
import { DispatchChart } from "@/components/dispatch-chart";
import { PlanActions } from "@/components/forms";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { gbp, londonToday } from "@/lib/format";
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
  const ukTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="grid gap-6">
      <div>
        <Link href={`/batteries/${plan.batteryId}`} className="text-sm text-muted-foreground hover:underline">← {b?.name ?? "Battery"}</Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Plan for {plan.deliveryDate}</h1>
          <Badge data-testid="plan-status" variant={plan.status === "draft" ? "outline" : plan.status === "approved" ? "secondary" : "default"}>{plan.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {intervals.length} settlement periods · forecast from {plan.forecastDate} prices · {cycles.toFixed(2)} of {spec.maxCyclesPerDay} cycles used
        </p>
      </div>

      {unpriced.length > 0 && (
        <Alert><AlertDescription>
          No forecast price for period{unpriced.length > 1 ? "s" : ""} {unpriced.join(", ")} (clock change or missing data). The plan idles there rather than guess.
        </AlertDescription></Alert>
      )}

      {mix && mix.committed.length > 0 && (
        <Alert><AlertDescription>
          Dynamic Containment committed for {mix.committed.map((k) => `${ukTime(k.start)}–${ukTime(k.end)}`).join(", ")} (UK time): full {spec.powerMw} MW held for DC High + Low, no wholesale trading in those blocks, SoC kept within 15 minutes of full-power delivery each way.
        </AlertDescription></Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><p className="text-sm text-muted-foreground">Expected P&amp;L</p><CardTitle className="font-mono text-2xl">{gbp(plan.expectedPnl)}</CardTitle>
          {mix && mix.frequency > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="pnl-mix">
              Wholesale {gbp(mix.arbitrage)} + DC {gbp(mix.frequency)} · {gbp(plan.expectedPnl - mix.arbitrageOnly)} more than arbitrage alone
            </p>
          )}
        </CardHeader></Card>
        <Card><CardHeader><p className="text-sm text-muted-foreground">Realised P&amp;L</p><CardTitle className="font-mono text-2xl">{executed ? gbp(plan.realisedPnl) : "Not yet settled"}</CardTitle></CardHeader></Card>
        <Card><CardHeader><p className="text-sm text-muted-foreground">Forecast error</p><CardTitle className="font-mono text-2xl">{executed ? gbp((plan.realisedPnl ?? 0) - plan.expectedPnl) : "—"}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Dispatch schedule</CardTitle>
            <p className="text-sm text-muted-foreground">Top: price. Bottom: energy bought (below zero) and sold (above), with state of charge. Shaded: held for Dynamic Containment.</p>
          </div>
          {/* Actual prices are complete only after the UK trading day ends. */}
          <PlanActions planId={plan.id} status={plan.status} settlesAfter={plan.deliveryDate >= londonToday() ? plan.deliveryDate : null} />
        </CardHeader>
        <CardContent>
          <DispatchChart showActual={executed} rows={intervals.map((i) => ({
            period: i.period, forecastPrice: i.forecastPrice, actualPrice: i.actualPrice,
            charge: i.action === "charge" ? i.mwh : 0, discharge: i.action === "discharge" ? i.mwh : 0, soc: i.socAfterMwh, reserved: i.action === "reserve",
          }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Traded periods</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead><TableHead>Action</TableHead><TableHead className="text-right">MWh (grid)</TableHead>
                <TableHead className="text-right">SoC after (MWh)</TableHead><TableHead className="text-right">Forecast £/MWh</TableHead><TableHead className="text-right">Actual £/MWh</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traded.map((i) => (
                <TableRow key={i.period}>
                  <TableCell className="font-mono">{i.period}</TableCell>
                  <TableCell>{i.action}</TableCell>
                  <TableCell className="text-right font-mono">{i.mwh.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono">{i.socAfterMwh.toFixed(1)}</TableCell>
                  <TableCell className="text-right font-mono">{i.forecastPrice?.toFixed(2) ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{i.actualPrice?.toFixed(2) ?? "—"}</TableCell>
                </TableRow>
              ))}
              {traded.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No profitable trades on this forecast. The battery stays idle.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
