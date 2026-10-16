// Idempotent seed. Run: npx tsx --env-file=.env.local db/seed.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, battery, price, ancillaryPrice } from "./index";
import { fetchMarketIndex, type MarketIndexRow } from "../lib/elexon";
import { fetchDcPrices, type DcPriceRow } from "../lib/neso";

const PRICE_DAYS = ["2026-10-13", "2026-10-14"];
const DC_DAY = "2026-10-14";

const EXAMPLES = [
  { name: "Riverside Big Battery", capacityMwh: 100, powerMw: 50, rte: 0.88, minSoc: 0.1, maxSoc: 0.9, maxCyclesPerDay: 1.5 },
  { name: "Hilltop Speedy Battery", capacityMwh: 50, powerMw: 50, rte: 0.9, minSoc: 0.05, maxSoc: 0.95, maxCyclesPerDay: 2 },
  { name: "Village Little Battery", capacityMwh: 10, powerMw: 5, rte: 0.85, minSoc: 0.1, maxSoc: 0.9, maxCyclesPerDay: 1 },
];
const PRICES_FILE = join(__dirname, "seed-prices.json");
const DC_FILE = join(__dirname, "seed-dc.json");

// Snapshot live data to a static JSON once so later seeds work offline.
async function loadOrFetch<T>(file: string, fetcher: () => Promise<T[]>): Promise<T[]> {
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const rows = await fetcher();
  writeFileSync(file, JSON.stringify(rows, null, 2) + "\n");
  console.log(`wrote ${rows.length} rows to ${file}`);
  return rows;
}

async function main() {
  // Example batteries with plain names: same chemistry, different sizes and speeds.
  await db.update(battery).set({ name: EXAMPLES[0].name }).where(eq(battery.name, "Demo BESS – 50 MW / 100 MWh"));
  const names = new Set((await db.select({ name: battery.name }).from(battery)).map((b) => b.name));
  const missing = EXAMPLES.filter((e) => !names.has(e.name));
  if (missing.length) await db.insert(battery).values(missing);
  console.log(`example batteries: ${missing.length} added`);

  const prices = await loadOrFetch<MarketIndexRow>(PRICES_FILE, async () =>
    (await Promise.all(PRICE_DAYS.map(fetchMarketIndex))).flat());
  if (prices.length) {
    await db.insert(price).values(prices.map((r) => ({ ...r, source: "seed" }))).onConflictDoNothing();
  }

  const dc = await loadOrFetch<DcPriceRow>(DC_FILE, () => fetchDcPrices(DC_DAY));
  if (dc.length) {
    await db.insert(ancillaryPrice).values(dc.map((r) => ({ ...r, source: "seed" }))).onConflictDoNothing();
  }

  console.log(`seed done: ${prices.length} price rows, ${dc.length} DC rows in snapshot files`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
