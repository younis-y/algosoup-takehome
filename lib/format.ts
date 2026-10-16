import { periodStartUtc } from "./periods";

export const gbp = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

// Today's UK trading date as YYYY-MM-DD.
export const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

// "2026-10-14" → "Wednesday 14 October 2026"
export const niceDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const ukClock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

// Settlement period → UK clock time it starts, e.g. period 35 on a normal day → "17:00".
export const periodTime = (date: string, period: number) => ukClock(periodStartUtc(date, period));
export { ukClock };

// A typical UK home uses about 2,700 kWh a year (Ofgem), roughly 7.4 kWh a day.
export const homesForADay = (mwh: number) => Math.round((mwh * 1000) / 7.4 / 100) * 100;

// Plain words for each plan stage. The stored status stays draft/approved/executed.
export const STAGE: Record<string, string> = { draft: "Draft", approved: "Approved", executed: "Done" };
