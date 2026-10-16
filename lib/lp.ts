// Linear-programming optimiser: the provably best plan under the same model as the greedy
// one in optimise.ts (same efficiency split, SoC limits, start/end SoC, cycle cap and the
// "never sell at ≤ £0" rule). Pure: no DB, no I/O.
//
// Per period t: c_t = MWh bought, d_t = MWh sold (grid side), e_t = stored MWh after t.
//   maximise   Σ p_t (d_t − c_t)
//   subject to e_t = e_{t−1} + √rte·c_t − d_t/√rte,  e_0 = min SoC
//              min SoC ≤ e_t ≤ max SoC, 0 ≤ c_t, d_t ≤ MW × 0.5
//              Σ d_t/√rte ≤ cycles × usable energy
//              c_t = d_t = 0 with no price; d_t = 0 when p_t ≤ 0
// No binary variables are needed: with selling blocked at p ≤ 0, buying and selling in the
// same period loses money through efficiency losses, so the optimum never does both.

import solver from "javascript-lp-solver";
import { validateBattery, type BatterySpec, type Interval, type Plan, type Slot } from "./optimise";

const TINY = 1e-7;

export function optimiseLp(b: BatterySpec, slots: Slot[]): Plan {
  const errors = validateBattery(b);
  if (errors.length) throw new Error(errors.join("; "));

  const s = Math.sqrt(b.rte);
  const maxGrid = b.powerMw * 0.5;
  const minE = b.minSoc * b.capacityMwh, maxE = b.maxSoc * b.capacityMwh;
  const constraints: Record<string, { min?: number; max?: number; equal?: number }> = {
    cycles: { max: b.maxCyclesPerDay * (maxE - minE) },
  };
  const variables: Record<string, Record<string, number>> = {};

  slots.forEach((slot, t) => {
    const p = slot.price;
    constraints[`soc${t}`] = { equal: t === 0 ? minE : 0 }; // e_t − e_{t−1} − s·c_t + d_t/s = 0
    constraints[`ebound${t}`] = { min: minE, max: maxE };
    constraints[`cmax${t}`] = { max: p === null ? 0 : maxGrid };
    constraints[`dmax${t}`] = { max: p === null || p <= 0 ? 0 : maxGrid };
    variables[`c${t}`] = { profit: -(p ?? 0), [`soc${t}`]: -s, [`cmax${t}`]: 1 };
    variables[`d${t}`] = { profit: p ?? 0, [`soc${t}`]: 1 / s, [`dmax${t}`]: 1, cycles: 1 / s };
    variables[`e${t}`] = { [`soc${t}`]: 1, [`ebound${t}`]: 1, ...(t + 1 < slots.length ? { [`soc${t + 1}`]: -1 } : {}) };
  });

  const result = solver.Solve({ optimize: "profit", opType: "max", constraints, variables }) as Record<string, number | boolean>;
  if (!result.feasible) throw new Error("LP found no feasible plan");
  const val = (k: string) => { const v = Number(result[k] ?? 0); return v > TINY ? v : 0; };

  // Rebuild intervals and SoC from the solution so they carry over exactly.
  let e = minE, drawn = 0, pnl = 0;
  const intervals: Interval[] = slots.map((slot, t) => {
    const net = val(`c${t}`) - val(`d${t}`); // never both in practice (see header)
    const action = net > TINY ? "charge" : net < -TINY ? "discharge" : "idle";
    const mwh = Math.abs(net) > TINY ? Math.abs(net) : 0;
    if (action === "charge") { e += mwh * s; pnl -= mwh * (slot.price ?? 0); }
    if (action === "discharge") { e -= mwh / s; drawn += mwh / s; pnl += mwh * (slot.price ?? 0); }
    e = Math.min(maxE, Math.max(minE, e)); // clamp solver round-off (≈1e-9)
    return { period: slot.period, action, mwh, socAfterMwh: e, price: slot.price };
  });
  return { intervals, expectedPnl: pnl, cycles: drawn / (maxE - minE) };
}
