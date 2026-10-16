import { sql } from "drizzle-orm";
import {
  check, date, doublePrecision, integer, jsonb, pgEnum, pgTable, primaryKey,
  serial, text, timestamp, unique,
} from "drizzle-orm/pg-core";

export const battery = pgTable("battery", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  capacityMwh: doublePrecision("capacity_mwh").notNull(),
  powerMw: doublePrecision("power_mw").notNull(),
  rte: doublePrecision("rte").notNull(), // round-trip efficiency, fraction (0, 1]
  minSoc: doublePrecision("min_soc").notNull(), // fraction of capacity
  maxSoc: doublePrecision("max_soc").notNull(),
  maxCyclesPerDay: doublePrecision("max_cycles_per_day").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("battery_capacity_pos", sql`${t.capacityMwh} > 0`),
  check("battery_power_pos", sql`${t.powerMw} > 0`),
  check("battery_rte_range", sql`${t.rte} > 0 AND ${t.rte} <= 1`),
  check("battery_soc_range", sql`${t.minSoc} >= 0 AND ${t.minSoc} < ${t.maxSoc} AND ${t.maxSoc} <= 1`),
  check("battery_cycles_pos", sql`${t.maxCyclesPerDay} > 0`),
]);

// Half-hourly wholesale price (Elexon Market Index, APXMIDP). settlementDate is the UK local trading day.
export const price = pgTable("price", {
  settlementDate: date("settlement_date", { mode: "string" }).notNull(),
  settlementPeriod: integer("settlement_period").notNull(),
  startTime: timestamp("start_time", { withTimezone: true, mode: "string" }).notNull(),
  priceGbpMwh: doublePrecision("price_gbp_mwh").notNull(),
  source: text("source").notNull(), // 'elexon' | 'seed'
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.settlementDate, t.settlementPeriod] })]);

// Frequency-response availability prices (NESO EAC auction), one row per product per EFA block.
export const ancillaryPrice = pgTable("ancillary_price", {
  deliveryStart: timestamp("delivery_start", { withTimezone: true, mode: "string" }).notNull(),
  deliveryEnd: timestamp("delivery_end", { withTimezone: true, mode: "string" }).notNull(),
  product: text("product").notNull(), // 'DCH' | 'DCL'
  priceGbpMwH: doublePrecision("price_gbp_mw_h").notNull(),
  source: text("source").notNull(),
}, (t) => [primaryKey({ columns: [t.deliveryStart, t.product] })]);

export const planStatus = pgEnum("plan_status", ["draft", "approved", "executed"]);
export const intervalAction = pgEnum("interval_action", ["charge", "discharge", "idle", "reserve"]);

export const dispatchPlan = pgTable("dispatch_plan", {
  id: serial("id").primaryKey(),
  batteryId: integer("battery_id").notNull().references(() => battery.id, { onDelete: "cascade" }),
  deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
  forecastDate: date("forecast_date", { mode: "string" }).notNull(),
  status: planStatus("status").notNull().default("draft"),
  params: jsonb("params").notNull(), // snapshot of battery settings at plan time
  expectedPnl: doublePrecision("expected_pnl").notNull(),
  realisedPnl: doublePrecision("realised_pnl"),
  pnlBreakdown: jsonb("pnl_breakdown"), // { arbitrage, frequency } once stacked
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique("plan_battery_day").on(t.batteryId, t.deliveryDate)]);

export const planInterval = pgTable("plan_interval", {
  planId: integer("plan_id").notNull().references(() => dispatchPlan.id, { onDelete: "cascade" }),
  period: integer("period").notNull(),
  action: intervalAction("action").notNull(),
  mwh: doublePrecision("mwh").notNull(), // grid-side energy; charge = import, discharge = export
  socAfterMwh: doublePrecision("soc_after_mwh").notNull(),
  reservedMw: doublePrecision("reserved_mw").notNull().default(0),
  forecastPrice: doublePrecision("forecast_price"),
  actualPrice: doublePrecision("actual_price"),
}, (t) => [primaryKey({ columns: [t.planId, t.period] })]);
