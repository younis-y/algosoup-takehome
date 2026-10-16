// UK trading-day helpers. A settlement day runs Europe/London midnight to midnight,
// so it has 46 (spring forward), 50 (fall back) or 48 half-hour periods.

const HALF_HOUR_MS = 30 * 60 * 1000;

const londonFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

// Europe/London UTC offset in ms at a given instant.
function londonOffsetMs(utcMs: number): number {
  const p = Object.fromEntries(londonFmt.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - utcMs;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// UTC ms of local midnight. UK clocks change at 01:00Z, so the offset at 00:00Z
// equals the offset in force at local midnight.
function londonMidnightUtcMs(date: string): number {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  return utcMidnight - londonOffsetMs(utcMidnight);
}

export function expectedPeriods(date: string): number {
  return (londonMidnightUtcMs(addDays(date, 1)) - londonMidnightUtcMs(date)) / HALF_HOUR_MS;
}

export function periodStartUtc(date: string, period: number): string {
  return new Date(londonMidnightUtcMs(date) + (period - 1) * HALF_HOUR_MS).toISOString();
}

export function previousDay(date: string): string {
  return addDays(date, -1);
}

export function nextDay(date: string): string {
  return addDays(date, 1);
}
