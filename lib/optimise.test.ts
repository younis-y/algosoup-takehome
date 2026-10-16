import { describe, expect, it } from "vitest";
import { checkPlan, optimise, settle, validateBattery, type BatterySpec } from "./optimise";

const simple: BatterySpec = { capacityMwh: 1, powerMw: 1, rte: 1, minSoc: 0, maxSoc: 1, maxCyclesPerDay: 1 };
const demo: BatterySpec = { capacityMwh: 100, powerMw: 50, rte: 0.88, minSoc: 0.1, maxSoc: 0.9, maxCyclesPerDay: 1.5 };

const slots = (prices: (number | null)[]) => prices.map((price, i) => ({ period: i + 1, price }));

// Deterministic pseudo-random prices with occasional negatives.
function randomPrices(n: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return Array.from({ length: n }, () => Math.round((rnd() * 260 - 40) * 100) / 100);
}

describe("validateBattery", () => {
  it("accepts a sensible battery", () => {
    expect(validateBattery(demo)).toEqual([]);
  });
  it("rejects efficiency above 100%", () => {
    expect(validateBattery({ ...demo, rte: 1.2 })).toContain("Energy that comes back (efficiency) must be more than 0% and at most 100%");
  });
  it("rejects max SoC at or below min SoC", () => {
    expect(validateBattery({ ...demo, minSoc: 0.8, maxSoc: 0.2 })).toContain("The lower charge limit must be below the upper one, both between 0% and 100%");
  });
  it("rejects non-positive power, capacity and cycle cap", () => {
    expect(validateBattery({ ...demo, powerMw: 0, capacityMwh: -1, maxCyclesPerDay: 0 })).toHaveLength(3);
  });
  it("optimise refuses an invalid battery", () => {
    expect(() => optimise({ ...demo, rte: 1.5 }, slots([1, 2]))).toThrow(/efficiency/);
  });
});

describe("optimise", () => {
  it("stays idle on flat prices", () => {
    const plan = optimise(demo, slots(Array(48).fill(80)));
    expect(plan.intervals.every((i) => i.action === "idle")).toBe(true);
    expect(plan.expectedPnl).toBe(0);
  });

  it("buys low then sells high, limited by power per half hour", () => {
    const plan = optimise(simple, slots([10, 100]));
    expect(plan.intervals.map((i) => i.action)).toEqual(["charge", "discharge"]);
    expect(plan.intervals[0].mwh).toBeCloseTo(0.5); // 1 MW × 0.5 h
    expect(plan.expectedPnl).toBeCloseTo(45);
  });

  it("applies efficiency losses and skips spreads that don't cover them", () => {
    const lossy = { ...simple, rte: 0.81 };
    expect(optimise(lossy, slots([100, 110])).expectedPnl).toBe(0);
    const plan = optimise(lossy, slots([10, 100]));
    // charge 0.5 MWh grid → 0.45 stored → discharge 0.405 MWh grid
    expect(plan.intervals[0].mwh).toBeCloseTo(0.5);
    expect(plan.intervals[1].mwh).toBeCloseTo(0.405);
    expect(plan.expectedPnl).toBeCloseTo(0.405 * 100 - 0.5 * 10);
  });

  it("never discharges before it has charged (starts at min SoC)", () => {
    const plan = optimise(simple, slots([100, 10]));
    expect(plan.expectedPnl).toBe(0);
  });

  it("respects the cycle cap", () => {
    // Many profitable spreads, but only 1 cycle allowed on a 1 MWh battery.
    const plan = optimise(simple, slots([0, 100, 0, 100, 0, 100, 0, 100]));
    const discharged = plan.intervals.filter((i) => i.action === "discharge").reduce((a, i) => a + i.mwh, 0);
    expect(discharged).toBeCloseTo(1);
    expect(plan.cycles).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("earns money charging at negative prices, even with nowhere to sell", () => {
    const plan = optimise(demo, slots(Array(48).fill(-20)));
    expect(plan.intervals.some((i) => i.action === "charge")).toBe(true);
    expect(plan.intervals.some((i) => i.action === "discharge")).toBe(false);
    expect(plan.expectedPnl).toBeGreaterThan(0);
    expect(checkPlan(demo, plan.intervals)).toEqual([]);
  });

  it("never discharges into a negative price", () => {
    const plan = optimise(demo, slots(randomPrices(48, 7)));
    for (const i of plan.intervals) if (i.action === "discharge") expect(i.price!).toBeGreaterThan(0);
  });

  it.each([46, 48, 50])("plans a %i-period day within limits", (n) => {
    const plan = optimise(demo, slots(randomPrices(n, n)));
    expect(plan.intervals).toHaveLength(n);
    expect(plan.intervals.map((i) => i.period)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(checkPlan(demo, plan.intervals)).toEqual([]);
    expect(plan.expectedPnl).toBeGreaterThan(0);
  });

  it("idles in periods with no forecast price", () => {
    const prices: (number | null)[] = randomPrices(48, 3);
    prices[5] = null;
    prices[40] = null;
    const plan = optimise(demo, slots(prices));
    expect(plan.intervals[5].action).toBe("idle");
    expect(plan.intervals[40].action).toBe("idle");
  });

  it("never breaks a limit across 200 random days and batteries", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = randomPrices(5, seed * 31).map((x) => Math.abs(x) / 300);
      const b: BatterySpec = {
        capacityMwh: 10 + r[0] * 200, powerMw: 5 + r[1] * 100, rte: 0.6 + r[2] * 0.4,
        minSoc: r[3] * 0.3, maxSoc: 0.7 + r[4] * 0.3, maxCyclesPerDay: 0.5 + (seed % 4),
      };
      const plan = optimise(b, slots(randomPrices(46 + (seed % 3) * 2, seed)));
      expect(checkPlan(b, plan.intervals), `seed ${seed}`).toEqual([]);
      expect(plan.expectedPnl).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("checkPlan", () => {
  it("flags power, SoC and end-of-day violations", () => {
    const bad = [
      { period: 1, action: "charge" as const, mwh: 0.9, socAfterMwh: 0.9, price: 10 },
      { period: 2, action: "discharge" as const, mwh: 0.9, socAfterMwh: 0, price: 50 },
    ];
    const v = checkPlan(simple, bad);
    expect(v.some((m) => m.includes("power"))).toBe(true);
  });
});

describe("settle", () => {
  it("settles planned volumes against actual prices", () => {
    const plan = optimise(simple, slots([10, 100]));
    // Forecast was right about direction, wrong about level.
    expect(settle(plan.intervals, new Map([[1, 20], [2, 60]]))).toBeCloseTo(0.5 * 60 - 0.5 * 20);
  });
  it("treats a missing actual price as unsettled (null)", () => {
    const plan = optimise(simple, slots([10, 100]));
    expect(settle(plan.intervals, new Map([[1, 20]]))).toBeNull();
  });
});
