import { describe, expect, it } from "vitest";
import { calculateBacktestStatistics } from "./backtest-results";

const startDate = new Date("2026-01-01T00:00:00.000Z");

describe("backtest result statistics", () => {
  it("calculates trade statistics and drawdown from stored P/L", () => {
    const result = calculateBacktestStatistics([
      { id: 1, entryTime: new Date("2026-01-01T00:01:00.000Z"), exitTime: new Date("2026-01-01T00:02:00.000Z"), pnl: 10 },
      { id: 2, entryTime: new Date("2026-01-01T00:03:00.000Z"), exitTime: new Date("2026-01-01T00:04:00.000Z"), pnl: -4 },
      { id: 3, entryTime: new Date("2026-01-01T00:05:00.000Z"), exitTime: new Date("2026-01-01T00:06:00.000Z"), pnl: 6 },
    ], startDate);

    expect(result.winningTrades).toBe(2);
    expect(result.losingTrades).toBe(1);
    expect(result.winRate).toBeCloseTo(66.6667, 3);
    expect(result.totalPnl).toBe(12);
    expect(result.averageWinningTrade).toBe(8);
    expect(result.averageLosingTrade).toBe(-4);
    expect(result.largestWinningTrade).toBe(10);
    expect(result.largestLosingTrade).toBe(-4);
    expect(result.maximumDrawdown).toBe(4);
    expect(result.profitFactor).toBe(4);
    expect(result.equityCurve.map(point => point.equity)).toEqual([0, 10, 6, 12]);
    expect(result.equityCurve.map(point => point.tradeId)).toEqual([null, 1, 2, 3]);
  });

  it("does not invent statistics for an empty trade set", () => {
    const result = calculateBacktestStatistics([], startDate);

    expect(result.winningTrades).toBe(0);
    expect(result.losingTrades).toBe(0);
    expect(result.winRate).toBeNull();
    expect(result.totalPnl).toBeNull();
    expect(result.maximumDrawdown).toBeNull();
    expect(result.equityCurve).toEqual([{ timestamp: startDate, equity: 0, tradeId: null }]);
  });
});