import { asc, eq, sql } from "drizzle-orm";
import { db, price } from "@/db";
import { expectedPeriods, nextDay, previousDay } from "./periods";

export type MarketIndexRow = {
  settlementDate: string;
  settlementPeriod: number;
  startTime: string;
  priceGbpMwh: number;
};

type ApiRow = {
  startTime: string;
  dataProvider: string;
  settlementDate: string;
  settlementPeriod: number;
  price: number;
  volume: number;
};

const BASE = "https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index";

export async function fetchMarketIndex(date: string): Promise<MarketIndexRow[]> {
  // from/to filter on UTC startTime, but settlementDate is the UK local day,
  // so over-fetch a window either side and filter on settlementDate.
  const from = `${previousDay(date)}T00:00:00Z`;
  const to = `${nextDay(date)}T03:00:00Z`;
  const url = `${BASE}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&dataProviders=APXMIDP`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Elexon market-index request failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { data?: ApiRow[] };

  const byPeriod = new Map<number, MarketIndexRow>();
  for (const r of body.data ?? []) {
    if (r.settlementDate !== date) continue;
    if (r.volume === 0 && r.price === 0) continue; // no trades: missing, not a real £0 price
    if (byPeriod.has(r.settlementPeriod)) continue;
    byPeriod.set(r.settlementPeriod, {
      settlementDate: r.settlementDate,
      settlementPeriod: r.settlementPeriod,
      startTime: new Date(r.startTime).toISOString(),
      priceGbpMwh: r.price,
    });
  }
  return [...byPeriod.values()].sort((a, b) => a.settlementPeriod - b.settlementPeriod);
}

async function readPrices(date: string) {
  const rows = await db.select().from(price)
    .where(eq(price.settlementDate, date))
    .orderBy(asc(price.settlementPeriod));
  return rows.map((r) => ({ ...r, startTime: new Date(r.startTime).toISOString() }));
}

export async function getPrices(date: string) {
  const expected = expectedPeriods(date);
  let rows = await readPrices(date);
  let error: string | undefined;

  if (rows.length < expected) {
    try {
      const fetched = await fetchMarketIndex(date);
      if (fetched.length) {
        await db.insert(price)
          .values(fetched.map((r) => ({ ...r, source: "elexon" })))
          .onConflictDoUpdate({
            target: [price.settlementDate, price.settlementPeriod],
            set: {
              startTime: sql`excluded.start_time`,
              priceGbpMwh: sql`excluded.price_gbp_mwh`,
              source: sql`excluded.source`,
              fetchedAt: sql`now()`,
            },
          });
        rows = await readPrices(date);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const have = new Set(rows.map((r) => r.settlementPeriod));
  const missing: number[] = [];
  for (let p = 1; p <= expected; p++) if (!have.has(p)) missing.push(p);

  const source = rows.length === 0 ? "none" : [...new Set(rows.map((r) => r.source))].join("+");
  return { rows, expected, missing, complete: missing.length === 0, source, ...(error ? { error } : {}) };
}
