import { describe, expect, it } from "vitest";
import { checkPlan, optimise, type BatterySpec, type Interval } from "./optimise";
import { blockRevenue, dcBand, planWithFrequency, type DcBlock } from "./frequency";
import { expectedPeriods, periodStartUtc } from "./periods";

const demo: BatterySpec = { capacityMwh: 100, powerMw: 50, rte: 0.88, minSoc: 0.1, maxSoc: 0.9, maxCyclesPerDay: 1.5 };
const DATE = "2026-10-14"; // BST: EFA day starts 2026-10-13T22:00Z, six 4h blocks

const slots = (prices: (number | null)[]) => prices.map((price, i) => ({ period: i + 1, price }));

// Blocks from consecutive UTC boundaries, all with the same DC prices.
function blocksFrom(bounds: string[], dch: number, dcl: number): DcBlock[] {
  return bounds.slice(0, -1).map((start, i) => ({ start, end: bounds[i + 1], dch, dcl }));
}
const efaBounds = ["2026-10-13T22:00:00.000Z", "2026-10-14T02:00:00.000Z", "2026-10-14T06:00:00.000Z",
  "2026-10-14T10:00:00.000Z", "2026-10-14T14:00:00.000Z", "2026-10-14T18:00:00.000Z", "2026-10-14T22:00:00.000Z"];
const efa = (dch: number, dcl: number) => blocksFrom(efaBounds, dch, dcl);

// Flat £20 wholesale with an evening spike in periods 47–48 (after the EFA day ends at 22:00Z).
// Perfectly flat prices never move SoC off minimum, which no DC block can accept; the spike
// gives the optimiser a reason to hold charge through the day.
const flatWithSpike = slots(Array.from({ length: 48 }, (_, i) => (i >= 46 ? 200 : 20)));

function randomPrices(n: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return Array.from({ length: n }, () => Math.round((rnd() * 260 - 40) * 100) / 100);
}

const asIdle = (ivs: Interval[]) => ivs.map((i) => (i.action === "reserve" ? { ...i, action: "idle" as const } : i));

// SoC entering each committed block (SoC after the period before it; minE at period 1).
// SoC entering each committed block: SoC after the period before its first period (minE at period 1).
function entrySocs(b: BatterySpec, date: string, plan: ReturnType<typeof planWithFrequency>) {
  return plan.committed.map((k) => {
    const i = plan.intervals.findIndex((iv) => periodStartUtc(date, iv.period) >= k.start);
    return i === 0 ? b.minSoc * b.capacityMwh : plan.intervals[i - 1].socAfterMwh;
  });
}

describe("planWithFrequency", () => {
  it("commits nothing when DC prices are zero, matching arbitrage-only", () => {
    const prices = slots(randomPrices(48, 7));
    const plan = planWithFrequency(demo, DATE, prices, efa(0, 0));
    expect(plan.committed).toEqual([]);
    expect(plan.frequencyPnl).toBe(0);
    expect(plan.expectedPnl).toBeCloseTo(plan.arbitrageOnlyPnl, 9);
    expect(plan.arbitrageOnlyPnl).toBeCloseTo(optimise(demo, prices).expectedPnl, 9);
    expect(plan.intervals.every((i) => i.reservedMw === 0 && i.action !== "reserve")).toBe(true);
  });

  it("never commits a zero-revenue block, even where idling it would help the greedy arbitrage", () => {
    // On these seeds, nulling a block's periods raises optimise's (non-optimal) greedy PnL.
    for (const seed of [141, 182, 196]) {
      const plan = planWithFrequency(demo, DATE, slots(randomPrices(48, seed)), efa(0, 0));
      expect(plan.committed).toEqual([]);
      expect(plan.expectedPnl).toBeCloseTo(plan.arbitrageOnlyPnl, 9);
    }
  });

  it("with huge DC prices commits every band-feasible block and earns their revenue", () => {
    const blocks = efa(1000, 1000);
    const plan = planWithFrequency(demo, DATE, flatWithSpike, blocks);
    // Block 1 starts at period 1 with SoC at minimum, below the DC band: infeasible. The rest fit.
    expect(plan.committed).toEqual(blocks.slice(1));
    expect(plan.frequencyPnl).toBeCloseTo(5 * 50 * 4 * 2000, 6);
    expect(plan.expectedPnl).toBeCloseTo(plan.arbitragePnl + plan.frequencyPnl, 9);
  });

  it("never commits a block that starts at period 1, since the day starts at min SoC", () => {
    const plan = planWithFrequency(demo, DATE, flatWithSpike, efa(1000, 1000));
    expect(plan.committed.map((k) => k.start)).not.toContain(efaBounds[0]);
    expect(plan.intervals[0].action).not.toBe("reserve");
  });

  it("marks committed periods as reserve at full power and leaves a physically valid plan", () => {
    const plan = planWithFrequency(demo, DATE, flatWithSpike, efa(1000, 1000));
    // Committed blocks 2–6 cover 02:00Z–22:00Z = periods 7–46.
    for (const iv of plan.intervals) {
      const reserved = iv.period >= 7 && iv.period <= 46;
      expect(iv.action === "reserve").toBe(reserved);
      expect(iv.reservedMw).toBe(reserved ? demo.powerMw : 0);
      if (reserved) expect(iv.mwh).toBe(0);
    }
    expect(checkPlan(demo, asIdle(plan.intervals))).toEqual([]);
  });

  it("keeps SoC at entry to every committed block inside the DC band, and beats arbitrage-only", () => {
    const band = dcBand(demo);
    let commitments = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const plan = planWithFrequency(demo, DATE, slots(randomPrices(48, seed)), efa(8, 6));
      const socs = entrySocs(demo, DATE, plan);
      for (const e of socs) {
        expect(e).toBeGreaterThanOrEqual(band.lo - 1e-6);
        expect(e).toBeLessThanOrEqual(band.hi + 1e-6);
      }
      expect(plan.expectedPnl).toBeGreaterThanOrEqual(plan.arbitrageOnlyPnl - 1e-6);
      expect(checkPlan(demo, asIdle(plan.intervals))).toEqual([]);
      commitments += plan.committed.length;
    }
    expect(commitments).toBeGreaterThan(0); // the property checks above are not vacuous
  });

  it("commits nothing when the battery is too small for a DC band", () => {
    const tiny = { ...demo, capacityMwh: 10 }; // 15 min at 50 MW each way exceeds 8 MWh usable
    const band = dcBand(tiny);
    expect(band.lo).toBeGreaterThan(band.hi);
    const plan = planWithFrequency(tiny, DATE, flatWithSpike, efa(1000, 1000));
    expect(plan.committed).toEqual([]);
    expect(plan.frequencyPnl).toBe(0);
    expect(plan.expectedPnl).toBeCloseTo(plan.arbitrageOnlyPnl, 9);
  });

  it("uses actual block length on a 46-period clock-change day", () => {
    const date = "2026-03-29";
    expect(expectedPeriods(date)).toBe(46);
    // Real EFA layout: block 1 is 23:00Z–02:00Z (3h), the rest 4h.
    const real = blocksFrom(["2026-03-28T23:00:00.000Z", "2026-03-29T02:00:00.000Z", "2026-03-29T06:00:00.000Z",
      "2026-03-29T10:00:00.000Z", "2026-03-29T14:00:00.000Z", "2026-03-29T18:00:00.000Z", "2026-03-29T22:00:00.000Z"], 7, 3);
    expect(blockRevenue(demo, real[0])).toBeCloseTo(50 * 3 * 10, 9);
    expect(blockRevenue(demo, real[1])).toBeCloseTo(50 * 4 * 10, 9);

    // The real 3h block opens the day (always band-infeasible), so put a 3h block second to see it committed.
    const blocks = blocksFrom(["2026-03-28T23:00:00.000Z", "2026-03-29T03:00:00.000Z", "2026-03-29T06:00:00.000Z",
      "2026-03-29T10:00:00.000Z", "2026-03-29T14:00:00.000Z", "2026-03-29T18:00:00.000Z", "2026-03-29T22:00:00.000Z"], 1000, 1000);
    const prices = slots(Array.from({ length: 46 }, (_, i) => (i >= 44 ? 200 : 20)));
    const plan = planWithFrequency(demo, date, prices, blocks);
    expect(plan.committed).toEqual(blocks.slice(1));
    expect(plan.frequencyPnl).toBeCloseTo(50 * (3 + 4 * 4) * 2000, 6);
    expect(plan.intervals).toHaveLength(46);
    expect(checkPlan(demo, asIdle(plan.intervals))).toEqual([]);
  });
});
