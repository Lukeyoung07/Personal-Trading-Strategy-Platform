import { describe, expect, it } from "vitest";
import { availabilityBoundaryError } from "./backtesting";

describe("backtest availability validation", () => {
  const coverage = [
    { timeframeLabel: "5 minutes", latestCandle: new Date("2026-09-10T23:55:00.000Z") },
    { timeframeLabel: "1 hour", latestCandle: new Date("2026-09-10T23:00:00.000Z") },
  ];

  it("accepts an end date on the earliest required coverage day", () => {
    expect(availabilityBoundaryError(new Date("2026-09-10T23:59:59.999Z"), coverage)).toBeNull();
  });

  it("rejects an end date after the earliest required coverage day", () => {
    expect(availabilityBoundaryError(new Date("2026-09-11T00:00:00.000Z"), coverage)).toMatch(/only available through 10 September 2026.*23:00 UTC/);
    expect(availabilityBoundaryError(new Date("2026-09-11T00:00:00.000Z"), coverage)).toMatch(/5 minutes: .*23:55 UTC; 1 hour: .*23:00 UTC/);
  });

  it("rejects missing coverage before a job can be created", () => {
    expect(availabilityBoundaryError(new Date("2026-09-10T00:00:00.000Z"), [
      ...coverage,
      { timeframeLabel: "4 hours", latestCandle: null },
    ])).toBe("Backtest cannot start because no cached historical data is available for 4 hours.");
  });
});