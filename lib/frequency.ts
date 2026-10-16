// Co-optimise wholesale arbitrage with Dynamic Containment (DC). Pure: no DB, no I/O.
//
// Model (deliberately simple):
// - Committing an EFA block means offering the full powerMw to BOTH DC High and DC Low for
//   the whole block. Revenue = powerMw × blockHours × (dch + dcl), with blockHours taken from
//   the block's own timestamps, so 3h/5h blocks on clock-change days are paid correctly.
// - A settlement period belongs to a block if its UTC start lies in [start, end).
// - Committed periods do no wholesale trading (their price is nulled for `optimise`, so they
//   idle). SoC must sit inside the DC band: at least 15 min of full-power delivery above min
//   SoC and 15 min of full-power absorption below max SoC (rte split as √rte each way).
//   SoC is constant through an idle block, so the band is checked at block entry: the SoC
//   after the previous period, or min SoC if the block starts at period 1. The day starts at
//   min SoC, so a block covering period 1 is never feasible. Empty band → no DC at all.
// - Block choice is greedy: starting with none, repeatedly add the single paid block that most
//   increases arbitrage + DC revenue while keeping every committed block in band; stop when
//   no addition helps. With 6 blocks that's at most 1 + 6 + 5 + … + 1 = 22 optimise runs.
// - Not modelled: energy actually delivered under DC, availability penalties, partial offers.

import { optimise, type BatterySpec, type Interval, type Plan, type Slot } from "./optimise";
import { periodStartUtc } from "./periods";

export type DcBlock = { start: string; end: string; dch: number; dcl: number }; // £/MW/h, ISO UTC
export type FrequencyPlan = {
  intervals: (Interval & { reservedMw: number })[];
  committed: DcBlock[];
  arbitragePnl: number; frequencyPnl: number; expectedPnl: number; arbitrageOnlyPnl: number;
};

const EPS = 1e-6;
const ms = (iso: string) => Date.parse(iso);

export const blockHours = (k: DcBlock) => (ms(k.end) - ms(k.start)) / 3_600_000;
export const blockRevenue = (b: BatterySpec, k: DcBlock) => b.powerMw * blockHours(k) * (k.dch + k.dcl);

// Stored-energy band (MWh) the battery must be in to hold a DC commitment.
export function dcBand(b: BatterySpec) {
  const s = Math.sqrt(b.rte), quarterHour = b.powerMw * 0.25;
  return { lo: b.minSoc * b.capacityMwh + quarterHour / s, hi: b.maxSoc * b.capacityMwh - quarterHour * s };
}

// `solve` is the arbitrage optimiser to plan around the blocks: greedy by default, or the LP.
export function planWithFrequency(
  b: BatterySpec, date: string, slots: Slot[], blocks: DcBlock[], solve: (b: BatterySpec, slots: Slot[]) => Plan = optimise,
): FrequencyPlan {
  const minE = b.minSoc * b.capacityMwh;
  const band = dcBand(b);
  const starts = slots.map((s) => ms(periodStartUtc(date, s.period)));
  // Slot indices inside each block.
  const members = blocks.map((k) => starts.flatMap((t, i) => (t >= ms(k.start) && t < ms(k.end) ? [i] : [])));

  const evaluate = (chosen: number[]) => {
    const reserved = new Set(chosen.flatMap((j) => members[j]));
    const plan = solve(b, slots.map((s, i) => (reserved.has(i) ? { ...s, price: null } : s)));
    const inBand = chosen.every((j) => {
      const first = members[j][0];
      const e = first === 0 ? minE : plan.intervals[first - 1].socAfterMwh;
      return e >= band.lo - EPS && e <= band.hi + EPS;
    });
    const frequencyPnl = chosen.reduce((sum, j) => sum + blockRevenue(b, blocks[j]), 0);
    return { chosen, reserved, plan, inBand, frequencyPnl, total: plan.expectedPnl + frequencyPnl };
  };

  const base = evaluate([]);
  let best = base;
  while (band.lo <= band.hi) {
    let next: typeof best | null = null;
    for (let j = 0; j < blocks.length; j++) {
      // Skip unpaid blocks: idling periods can raise the greedy optimiser's PnL, which isn't DC value.
      if (best.chosen.includes(j) || members[j].length === 0 || blockRevenue(b, blocks[j]) <= 0) continue;
      const trial = evaluate([...best.chosen, j]);
      if (trial.inBand && trial.total > (next ?? best).total + EPS) next = trial;
    }
    if (!next) break;
    best = next;
  }

  return {
    intervals: best.plan.intervals.map((iv, i) =>
      best.reserved.has(i)
        ? { ...iv, action: "reserve", mwh: 0, price: slots[i].price, reservedMw: b.powerMw } // keep wholesale price for display
        : { ...iv, reservedMw: 0 }),
    committed: best.chosen.map((j) => blocks[j]).sort((x, y) => ms(x.start) - ms(y.start)),
    arbitragePnl: best.plan.expectedPnl,
    frequencyPnl: best.frequencyPnl,
    expectedPnl: best.total,
    arbitrageOnlyPnl: base.plan.expectedPnl,
  };
}
