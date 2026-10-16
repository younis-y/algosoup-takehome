// Idempotent seed. Run: npx tsx --env-file=.env.local db/seed.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db, battery, price, ancillaryPrice } from "./index";
import { fetchMarketIndex, type MarketIndexRow } from "../lib/elexon";
import { fetchDcPrices, type DcPriceRow } from "../lib/neso";

const PRICE_DAYS = ["2026-10-13", "2026-10-14"];
const DC_DAY = "2026-10-14";
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
  const existing = await db.select({ id: battery.id }).from(battery).limit(1);
  if (existing.length === 0) {
    await db.insert(battery).values({
      name: "Demo BESS – 50 MW / 100 MWh",
      capacityMwh: 100, powerMw: 50, rte: 0.88,
      minSoc: 0.1, maxSoc: 0.9, maxCyclesPerDay: 1.5,
    });
    console.log("inserted demo battery");
  }

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
