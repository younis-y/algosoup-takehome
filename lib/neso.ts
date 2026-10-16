import { and, asc, gte, lt, sql } from "drizzle-orm";
import { db, ancillaryPrice } from "@/db";
import { nextDay, periodStartUtc } from "./periods";

export type DcPriceRow = {
  deliveryStart: string;
  deliveryEnd: string;
  product: string; // 'DCH' | 'DCL'
  priceGbpMwH: number;
};

type ApiRecord = {
  auctionProduct: string;
  deliveryStart: string;
  deliveryEnd: string;
  clearingPrice: string | number;
};

const BASE = "https://api.neso.energy/api/3/action";
const RESOURCE = "596f29ac-0387-4ba4-a6d3-95c243140707";
const PRODUCTS = ["DCH", "DCL"];
const HOUR_MS = 60 * 60 * 1000;

// EFA day starts 23:00 local the evening before, i.e. one hour before settlement period 1.
function efaWindow(date: string) {
  const start = new Date(Date.parse(periodStartUtc(date, 1)) - HOUR_MS).toISOString();
  const end = new Date(Date.parse(periodStartUtc(nextDay(date), 1)) - HOUR_MS).toISOString();
  return { start, end };
}

// NESO timestamps are UTC with no 'Z' suffix.
const parseUtc = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`).toISOString();
const naive = (iso: string) => iso.slice(0, 19); // '2026-10-15T22:00:00'

async function getJson(url: string): Promise<ApiRecord[]> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`NESO request failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { success?: boolean; result?: { records?: ApiRecord[] }; error?: unknown };
  if (!body.success) throw new Error(`NESO request unsuccessful: ${JSON.stringify(body.error ?? body)}`);
  return body.result?.records ?? [];
}

export async function fetchDcPrices(date: string): Promise<DcPriceRow[]> {
  const { start, end } = efaWindow(date);
  let records: ApiRecord[];
  try {
    const q = `SELECT "auctionProduct","deliveryStart","deliveryEnd","clearingPrice" FROM "${RESOURCE}" ` +
      `WHERE "auctionProduct" IN ('DCH','DCL') AND "deliveryStart" >= '${naive(start)}' AND "deliveryStart" < '${naive(end)}' ` +
      `ORDER BY "deliveryStart"`;
    records = await getJson(`${BASE}/datastore_search_sql?sql=${encodeURIComponent(q)}`);
  } catch {
    // Fallback: plain datastore_search, newest first, one call per product; window filtered below.
    records = [];
    for (const product of PRODUCTS) {
      const params = new URLSearchParams({
        resource_id: RESOURCE,
        filters: JSON.stringify({ auctionProduct: product }),
        sort: "deliveryStart desc",
        limit: "500",
      });
      records.push(...(await getJson(`${BASE}/datastore_search?${params}`)));
    }
  }

  const seen = new Set<string>();
  const out: DcPriceRow[] = [];
  for (const r of records) {
    if (!PRODUCTS.includes(r.auctionProduct)) continue;
    const deliveryStart = parseUtc(r.deliveryStart);
    if (deliveryStart < start || deliveryStart >= end) continue;
    const key = `${deliveryStart}|${r.auctionProduct}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      deliveryStart,
      deliveryEnd: parseUtc(r.deliveryEnd),
      product: r.auctionProduct,
      priceGbpMwH: Number(r.clearingPrice),
    });
  }
  return out.sort((a, b) => a.deliveryStart.localeCompare(b.deliveryStart) || a.product.localeCompare(b.product));
}

async function readDcPrices(date: string) {
  const { start, end } = efaWindow(date);
  const rows = await db.select().from(ancillaryPrice)
    .where(and(gte(ancillaryPrice.deliveryStart, start), lt(ancillaryPrice.deliveryStart, end)))
    .orderBy(asc(ancillaryPrice.deliveryStart), asc(ancillaryPrice.product));
  return rows.map((r) => ({
    ...r,
    deliveryStart: new Date(r.deliveryStart).toISOString(),
    deliveryEnd: new Date(r.deliveryEnd).toISOString(),
  }));
}

export async function getDcPrices(date: string) {
  let rows = await readDcPrices(date);
  let error: string | undefined;

  // A full EFA day is 6 blocks x 2 products (clock-change days still have 6 blocks of mixed length).
  if (rows.length < 12) {
    try {
      const fetched = await fetchDcPrices(date);
      if (fetched.length) {
        await db.insert(ancillaryPrice)
          .values(fetched.map((r) => ({ ...r, source: "neso" })))
          .onConflictDoUpdate({
            target: [ancillaryPrice.deliveryStart, ancillaryPrice.product],
            set: {
              deliveryEnd: sql`excluded.delivery_end`,
              priceGbpMwH: sql`excluded.price_gbp_mw_h`,
              source: sql`excluded.source`,
            },
          });
        rows = await readDcPrices(date);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  return { rows, complete: rows.length >= 12, ...(error ? { error } : {}) };
}
