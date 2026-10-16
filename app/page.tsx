import Link from "next/link";
import { connection } from "next/server";
import { desc } from "drizzle-orm";
import { battery, db } from "@/db";
import { BatteryForm } from "@/components/forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function Home() {
  await connection(); // always render per request: plans change state
  const batteries = await db.select().from(battery).orderBy(desc(battery.createdAt));
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Batteries</h1>
        <p className="text-sm text-muted-foreground">Pick an asset to plan a day of wholesale charge/discharge against GB market prices.</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead className="text-right">MWh</TableHead><TableHead className="text-right">MW</TableHead>
                <TableHead className="text-right">RTE</TableHead><TableHead className="text-right">SoC window</TableHead><TableHead className="text-right">Cycles/day</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batteries.map((b) => (
                <TableRow key={b.id}>
                  <TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/batteries/${b.id}`}>{b.name}</Link></TableCell>
                  <TableCell className="text-right tabular-nums">{b.capacityMwh}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.powerMw}</TableCell>
                  <TableCell className="text-right tabular-nums">{Math.round(b.rte * 100)}%</TableCell>
                  <TableCell className="text-right tabular-nums">{Math.round(b.minSoc * 100)}–{Math.round(b.maxSoc * 100)}%</TableCell>
                  <TableCell className="text-right tabular-nums">{b.maxCyclesPerDay}</TableCell>
                </TableRow>
              ))}
              {batteries.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-muted-foreground">No batteries yet. Add one below.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Add a battery</CardTitle></CardHeader>
        <CardContent><BatteryForm /></CardContent>
      </Card>
    </div>
  );
}
