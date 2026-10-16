import Link from "next/link";
import { connection } from "next/server";
import { asc } from "drizzle-orm";
import { battery, db } from "@/db";
import { BatteryForm } from "@/components/forms";
import { Abbr, Glossary } from "@/components/glossary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { homesForADay } from "@/lib/format";

const steps = [
  ["🔋", "Buy when it's cheap", "Electricity is cheapest when few people need it, like at night or on windy days. The battery fills up then."],
  ["💷", "Sell when it's dear", "Around teatime everyone is cooking and watching TV, so electricity costs more. The battery sells it back."],
  ["📋", "Plan, approve, check", "This app picks the best half-hours, shows the money it should make, and checks what really happened afterwards."],
];

export default async function Home() {
  await connection(); // always render per request: plans change state
  const batteries = await db.select().from(battery).orderBy(asc(battery.createdAt));
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Batteries</h1>
        <p className="text-muted-foreground">Make money with a giant battery: buy electricity when it&apos;s cheap, sell it when it&apos;s worth more.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {steps.map(([icon, title, text]) => (
          <div key={title} className="rounded-2xl bg-muted/60 p-4">
            <p className="font-medium"><span aria-hidden="true">{icon}</span> {title}</p>
            <p className="text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pick a battery</CardTitle>
          <p className="text-sm text-muted-foreground">
            <Abbr term="MWh" /> is how much energy it holds, like litres in a water tank. <Abbr term="MW" /> is how fast it fills or empties, like how wide the tap is.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Battery</TableHead>
                <TableHead className="text-right">Holds</TableHead>
                <TableHead className="text-right">Speed</TableHead>
                <TableHead className="text-right"><Abbr term="%">Gets back</Abbr></TableHead>
                <TableHead className="hidden text-right sm:table-cell">Enough for</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batteries.map((b) => (
                <TableRow key={b.id}>
                  <TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/batteries/${b.id}`}>{b.name}</Link></TableCell>
                  <TableCell className="text-right tabular-nums">{b.capacityMwh} MWh</TableCell>
                  <TableCell className="text-right tabular-nums">{b.powerMw} MW</TableCell>
                  <TableCell className="text-right tabular-nums">{Math.round(b.rte * 100)}%</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    ≈ {homesForADay((b.maxSoc - b.minSoc) * b.capacityMwh).toLocaleString("en-GB")} homes for a day
                  </TableCell>
                </TableRow>
              ))}
              {batteries.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-muted-foreground">No batteries yet. Add one below.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Add a battery</CardTitle></CardHeader>
        <CardContent><BatteryForm /></CardContent>
      </Card>

      <Glossary />
    </div>
  );
}
