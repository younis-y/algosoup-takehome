import { describe, it, expect } from "vitest";
import { expectedPeriods, periodStartUtc, previousDay } from "./periods";

describe("expectedPeriods", () => {
  it("returns 46 on the spring-forward day", () => {
    expect(expectedPeriods("2026-03-29")).toBe(46);
  });
  it("returns 50 on the fall-back day", () => {
    expect(expectedPeriods("2025-10-26")).toBe(50);
  });
  it("returns 48 on ordinary days", () => {
    expect(expectedPeriods("2026-10-14")).toBe(48);
    expect(expectedPeriods("2026-01-15")).toBe(48);
    expect(expectedPeriods("2026-03-28")).toBe(48);
    expect(expectedPeriods("2026-03-30")).toBe(48);
  });
});

describe("periodStartUtc", () => {
  it("starts at 23:00Z the previous day in BST", () => {
    expect(periodStartUtc("2026-10-14", 1)).toBe("2026-10-13T23:00:00.000Z");
    expect(periodStartUtc("2026-10-14", 48)).toBe("2026-10-14T22:30:00.000Z");
  });
  it("starts at 00:00Z in GMT", () => {
    expect(periodStartUtc("2026-01-15", 1)).toBe("2026-01-15T00:00:00.000Z");
  });
  it("handles clock-change days", () => {
    expect(periodStartUtc("2026-03-29", 46)).toBe("2026-03-29T22:30:00.000Z");
    expect(periodStartUtc("2025-10-26", 1)).toBe("2025-10-25T23:00:00.000Z");
    expect(periodStartUtc("2025-10-26", 50)).toBe("2025-10-26T23:30:00.000Z");
  });
});

describe("previousDay", () => {
  it("crosses month and year boundaries", () => {
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
  });
});
