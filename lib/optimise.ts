// Greedy battery arbitrage over half-hourly prices. Pure: no DB, no I/O.
//
// Model: each settlement period is 0.5 h. Round-trip efficiency is split evenly,
// s = √rte: charging X MWh from the grid stores X·s; delivering Y MWh to the grid
// draws Y/s from storage. The day starts at min SoC and must end at or above it.
// A "cycle" = energy drawn from storage ÷ usable energy ((maxSoc − minSoc) × capacity).

export type BatterySpec = {
  capacityMwh: number; powerMw: number; rte: number;
  minSoc: number; maxSoc: number; maxCyclesPerDay: number;
};
export type Slot = { period: number; price: number | null }; // null = no price → idle
export type Action = "charge" | "discharge" | "idle" | "reserve"; // reserve = held for frequency response
export type Interval = { period: number; action: Action; mwh: number; socAfterMwh: number; price: number | null };
export type Plan = { intervals: Interval[]; expectedPnl: number; cycles: number };

const EPS = 1e-6;

export function validateBattery(b: BatterySpec): string[] {
  const errors: string[] = [];
  if (!(b.capacityMwh > 0)) errors.push("Storage must be more than 0 MWh");
  if (!(b.powerMw > 0)) errors.push("Speed must be more than 0 MW");
  if (!(b.rte > 0 && b.rte <= 1)) errors.push("Energy that comes back (efficiency) must be more than 0% and at most 100%");
  if (!(b.minSoc >= 0 && b.minSoc < b.maxSoc && b.maxSoc <= 1)) errors.push("The lower charge limit must be below the upper one, both between 0% and 100%");
  if (!(b.maxCyclesPerDay > 0)) errors.push("Fills a day must be more than 0");
  return errors;
}

export function optimise(b: BatterySpec, slots: Slot[]): Plan {
  const errors = validateBattery(b);
  if (errors.length) throw new Error(errors.join("; "));

  const n = slots.length;
  const s = Math.sqrt(b.rte);
  const maxGrid = b.powerMw * 0.5; // MWh per half hour
  const minE = b.minSoc * b.capacityMwh;
  const maxE = b.maxSoc * b.capacityMwh;
  let drawBudget = b.maxCyclesPerDay * (maxE - minE); // stored MWh we may still discharge

  // Stored-energy delta per period: + charge, − discharge.
  const delta = new Array<number>(n).fill(0);
  const price = (i: number) => slots[i].price;

  // SoC after each period, given current deltas.
  const socPath = () => {
    const soc: number[] = [];
    let e = minE;
    for (const d of delta) soc.push((e += d));
    return soc;
  };

  for (let iter = 0; iter < 10 * n * n; iter++) {
    const soc = socPath();
    let best = { value: EPS, c: -1, d: -1, e: 0 }; // d = -1 → charge only, nothing sold

    for (let c = 0; c < n; c++) {
      const pc = price(c);
      if (pc === null || delta[c] < 0) continue; // already discharging here
      const chargeRoom = (maxGrid - delta[c] / s) * s; // stored MWh still chargeable in c
      if (chargeRoom <= EPS) continue;

      // Charge-only: worth it at negative prices; SoC must stay ≤ max from c to end of day.
      if (pc < 0) {
        let e = chargeRoom;
        for (let t = c; t < n; t++) e = Math.min(e, maxE - soc[t]);
        const value = (-pc / s) * e;
        if (e > EPS && value > best.value) best = { value, c, d: -1, e };
      }

      for (let d = 0; d < n; d++) {
        const pd = price(d);
        // Skip d if it's already charging, or if selling there would pay to export (burning energy via losses).
        if (d === c || pd === null || pd <= 0 || delta[d] > 0) continue;
        const perMwh = pd * s - pc / s;
        if (perMwh <= 0) continue;
        let e = Math.min(chargeRoom, (maxGrid + delta[d] * s) / s, drawBudget);
        // Moving e of energy from c to d raises SoC over [c, d) or lowers it over [d, c).
        if (c < d) for (let t = c; t < d; t++) e = Math.min(e, maxE - soc[t]);
        else for (let t = d; t < c; t++) e = Math.min(e, soc[t] - minE);
        const value = perMwh * e;
        if (e > EPS && value > best.value) best = { value, c, d, e };
      }
    }

    if (best.c < 0) break;
    delta[best.c] += best.e;
    if (best.d >= 0) {
      delta[best.d] -= best.e;
      drawBudget -= best.e;
    }
  }

  const soc = socPath();
  const intervals: Interval[] = slots.map((slot, i) => {
    const d = Math.abs(delta[i]) < EPS ? 0 : delta[i];
    return {
      period: slot.period,
      action: d > 0 ? "charge" : d < 0 ? "discharge" : "idle",
      mwh: d > 0 ? d / s : d < 0 ? -d * s : 0, // grid-side
      socAfterMwh: soc[i],
      price: slot.price,
    };
  });
  const usable = maxE - minE;
  const drawn = intervals.reduce((a, i) => a + (i.action === "discharge" ? i.mwh / s : 0), 0);
  return { intervals, expectedPnl: cashflow(intervals, (i) => i.price), cycles: drawn / usable };
}

function cashflow(intervals: Interval[], priceOf: (i: Interval) => number | null | undefined) {
  let pnl = 0;
  for (const i of intervals) {
    if (i.action !== "charge" && i.action !== "discharge") continue;
    const p = priceOf(i) ?? 0;
    pnl += i.action === "discharge" ? i.mwh * p : -i.mwh * p;
  }
  return pnl;
}

// Settle planned volumes against actual prices. Null if any traded period has no actual price.
export function settle(intervals: Interval[], actual: Map<number, number>): number | null {
  if (intervals.some((i) => (i.action === "charge" || i.action === "discharge") && !actual.has(i.period))) return null;
  return cashflow(intervals, (i) => actual.get(i.period));
}

// Independent physics check of a plan. Returns human-readable violations; [] = valid.
export function checkPlan(b: BatterySpec, intervals: Interval[]): string[] {
  const v: string[] = [];
  const s = Math.sqrt(b.rte);
  const minE = b.minSoc * b.capacityMwh, maxE = b.maxSoc * b.capacityMwh;
  const tol = 1e-6 * Math.max(1, b.capacityMwh);
  let e = minE, drawn = 0;
  for (const i of intervals) {
    if (i.mwh < -tol) v.push(`P${i.period}: negative volume`);
    if (i.mwh > b.powerMw * 0.5 + tol) v.push(`P${i.period}: exceeds power limit`);
    if (i.action === "charge") e += i.mwh * s;
    if (i.action === "discharge") { e -= i.mwh / s; drawn += i.mwh / s; }
    if (i.action === "idle" && i.mwh > tol) v.push(`P${i.period}: idle with volume`);
    if (e < minE - tol || e > maxE + tol) v.push(`P${i.period}: SoC ${e.toFixed(3)} outside limits`);
    if (Math.abs(e - i.socAfterMwh) > tol) v.push(`P${i.period}: SoC does not carry over`);
  }
  if (e < minE - tol) v.push("Ends below starting SoC");
  if (drawn > b.maxCyclesPerDay * (maxE - minE) + tol) v.push("Exceeds cycle cap");
  return v;
}
