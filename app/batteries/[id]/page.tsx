import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { battery, db, dispatchPlan } from "@/db";
import { PlanForm } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { gbp, londonToday } from "@/lib/format";
import { previousDay } from "@/lib/periods";

export default async function BatteryPage({ params }: PageProps<"/batteries/[id]">) {
  await connection(); // always render per request: plans change state
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [b, plans] = await Promise.all([
    db.query.battery.findFirst({ where: eq(battery.id, id) }),
    db.select().from(dispatchPlan).where(eq(dispatchPlan.batteryId, id)).orderBy(desc(dispatchPlan.deliveryDate)),
  ]);
  if (!b) notFound();
  const today = londonToday();

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">← Batteries</Link>
        <h1 className="text-2xl font-semibold">{b.name}</h1>
        <p className="tabular-nums text-sm text-muted-foreground">
          {b.capacityMwh} MWh · {b.powerMw} MW · RTE {Math.round(b.rte * 100)}% · SoC {Math.round(b.minSoc * 100)}–{Math.round(b.maxSoc * 100)}% · ≤{b.maxCyclesPerDay} cycles/day
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Plan a day</CardTitle>
          <p className="text-sm text-muted-foreground">
            The optimiser uses the previous day&apos;s half-hourly prices as the forecast. Executing settles the plan against the delivery day&apos;s actual prices.
          </p>
        </CardHeader>
        <CardContent><PlanForm batteryId={b.id} defaultDate={previousDay(today)} maxDate={today}
          existing={Object.fromEntries(plans.map((p) => [p.deliveryDate, { id: p.id, status: p.status }]))} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Plans</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Delivery date</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Expected P&amp;L</TableHead><TableHead className="text-right">Realised P&amp;L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell><Link className="font-medium hover:underline" href={`/plans/${p.id}`}>{p.deliveryDate}</Link></TableCell>
                  <TableCell><Badge variant={p.status}>{p.status}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{gbp(p.expectedPnl)}</TableCell>
                  <TableCell className="text-right tabular-nums">{gbp(p.realisedPnl)}</TableCell>
                </TableRow>
              ))}
              {plans.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">No plans yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
