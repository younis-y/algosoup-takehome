import { describe, expect, it } from "vitest";
import { optimiseLp } from "./lp";
import { checkPlan, optimise, type BatterySpec } from "./optimise";

const simple: BatterySpec = { capacityMwh: 1, powerMw: 1, rte: 1, minSoc: 0, maxSoc: 1, maxCyclesPerDay: 1 };
const demo: BatterySpec = { capacityMwh: 100, powerMw: 50, rte: 0.88, minSoc: 0.1, maxSoc: 0.9, maxCyclesPerDay: 1.5 };
const slots = (prices: (number | null)[]) => prices.map((price, i) => ({ period: i + 1, price }));

function randomPrices(n: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return Array.from({ length: n }, () => Math.round((rnd() * 260 - 40) * 100) / 100);
}

describe("optimiseLp", () => {
  it("matches the obvious answer on a two-period day", () => {
    const plan = optimiseLp(simple, slots([10, 100]));
    expect(plan.intervals.map((i) => i.action)).toEqual(["charge", "discharge"]);
    expect(plan.expectedPnl).toBeCloseTo(45);
  });

  it("applies efficiency losses like the greedy model", () => {
    const lossy = { ...simple, rte: 0.81 };
    expect(optimiseLp(lossy, slots([100, 110])).expectedPnl).toBeCloseTo(0);
    expect(optimiseLp(lossy, slots([10, 100])).expectedPnl).toBeCloseTo(0.405 * 100 - 0.5 * 10);
  });

  it("charges into negative prices and never discharges into them", () => {
    const plan = optimiseLp(demo, slots(Array(48).fill(-20)));
    expect(plan.expectedPnl).toBeGreaterThan(0);
    expect(plan.intervals.some((i) => i.action === "discharge")).toBe(false);
    expect(checkPlan(demo, plan.intervals)).toEqual([]);
  });

  it("idles where there is no price", () => {
    const prices: (number | null)[] = randomPrices(48, 3);
    prices[5] = null;
    const plan = optimiseLp(demo, slots(prices));
    expect(plan.intervals[5].action).toBe("idle");
  });

  it.each([46, 50])("plans a %i-period day within limits", (n) => {
    const plan = optimiseLp(demo, slots(randomPrices(n, n)));
    expect(plan.intervals).toHaveLength(n);
    expect(checkPlan(demo, plan.intervals)).toEqual([]);
  });

  it("refuses an invalid battery", () => {
    expect(() => optimiseLp({ ...demo, rte: 1.5 }, slots([1, 2]))).toThrow(/efficiency/);
  });

  it("is never worse than greedy, always within limits, and sometimes strictly better", () => {
    let better = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const r = randomPrices(5, seed * 31).map((x) => Math.abs(x) / 300);
      const b: BatterySpec = {
        capacityMwh: 10 + r[0] * 200, powerMw: 5 + r[1] * 100, rte: 0.6 + r[2] * 0.4,
        minSoc: r[3] * 0.3, maxSoc: 0.7 + r[4] * 0.3, maxCyclesPerDay: 0.5 + (seed % 4),
      };
      const s = slots(randomPrices(46 + (seed % 3) * 2, seed));
      const lp = optimiseLp(b, s);
      const greedy = optimise(b, s);
      expect(checkPlan(b, lp.intervals), `seed ${seed}`).toEqual([]);
      expect(lp.expectedPnl, `seed ${seed}`).toBeGreaterThanOrEqual(greedy.expectedPnl - 1e-6 * Math.max(1, Math.abs(greedy.expectedPnl)));
      if (lp.expectedPnl > greedy.expectedPnl + 1) better++;
    }
    expect(better).toBeGreaterThan(0);
  });
});
