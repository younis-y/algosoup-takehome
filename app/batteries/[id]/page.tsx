import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { battery, db, dispatchPlan } from "@/db";
import { PlanForm } from "@/components/forms";
import { Abbr, Glossary } from "@/components/glossary";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STAGE, gbp, homesForADay, londonToday, niceDate } from "@/lib/format";
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
  const usable = (b.maxSoc - b.minSoc) * b.capacityMwh;

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">← All batteries</Link>
        <h1 className="text-2xl font-semibold">{b.name}</h1>
        <p className="tabular-nums text-sm text-muted-foreground">
          Holds {b.capacityMwh} <Abbr term="MWh" /> · fills or empties at {b.powerMw} <Abbr term="MW" /> · gets back {Math.round(b.rte * 100)}% ·
          {" "}kept between {Math.round(b.minSoc * 100)}% and {Math.round(b.maxSoc * 100)}% <Abbr term="Charge">charge</Abbr> ·
          {" "}up to {b.maxCyclesPerDay} <Abbr term="Fill">fills</Abbr> a day
        </p>
        <p className="text-sm text-muted-foreground">
          It can use {usable.toFixed(0)} MWh, about enough electricity for {homesForADay(usable).toLocaleString("en-GB")} homes for a day.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Plan a day</CardTitle>
          <p className="text-sm text-muted-foreground">
            Pick a day. We use the day before&apos;s prices as our <Abbr term="Guess">guess</Abbr>, then choose the cheapest
            {" "}<Abbr term="Half-hour">half-hours</Abbr> to buy and the priciest to sell. If a standby job (<Abbr term="DC" />) pays more, we take that too.
            Once the day is over, we check the plan against the real prices.
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
                <TableHead>Day</TableHead><TableHead><Abbr term="Draft">Stage</Abbr></TableHead>
                <TableHead className="text-right">Money expected</TableHead><TableHead className="text-right">Money made</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell><Link className="font-medium hover:underline" href={`/plans/${p.id}`}>{niceDate(p.deliveryDate)}</Link></TableCell>
                  <TableCell><Badge variant={p.status}>{STAGE[p.status]}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{gbp(p.expectedPnl)}</TableCell>
                  <TableCell className="text-right tabular-nums">{gbp(p.realisedPnl)}</TableCell>
                </TableRow>
              ))}
              {plans.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">No plans yet. Pick a day above to make one.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Glossary />
    </div>
  );
}
