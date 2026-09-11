import { describe, expect, it } from "vitest";
import {
  isEndDateWithinAvailability,
  presetRange,
  requiredBacktestTimeframeIds,
} from "./backtest-availability";

describe("backtest availability helpers", () => {
  it("includes the execution timeframe and all condition timeframes", () => {
    expect(requiredBacktestTimeframeIds(16, [{ timeframe: "1H" }, { timeframe: "5m" }], [
      { id: 16, code: "5m", label: "5 minutes" },
      { id: 20, code: "1h", label: "1 hour" },
    ])).toEqual([16, 20]);
  });

  it("anchors relative ranges to the latest available candle", () => {
    const availableEnd = new Date("2026-09-10T23:55:00.000Z");
    expect(presetRange("last_7_days", availableEnd)).toEqual({
      start: "2026-09-03",
      end: "2026-09-10",
    });
    expect(presetRange("last_6_months", availableEnd)).toEqual({
      start: "2026-03-10",
      end: "2026-09-10",
    });
    expect(presetRange("last_1_year", availableEnd)).toEqual({
      start: "2025-09-10",
      end: "2026-09-10",
    });
  });

  it("accepts the coverage day but rejects a later day", () => {
    expect(isEndDateWithinAvailability("2026-09-10", "2026-09-10")).toBe(true);
    expect(isEndDateWithinAvailability("2026-09-11", "2026-09-10")).toBe(false);
    expect(isEndDateWithinAvailability("2026-09-10", null)).toBe(false);
  });
});