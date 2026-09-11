import { describe, expect, it } from "vitest";
import { calculateJournalMonthPerformance } from "./trading";

type TestTrade = {
  status: "closed";
  pnl: number | null;
  side: "long" | "short";
  marketId: number;
  strategyVersionId: number;
  createdAt: Date;
  closedAt: Date | null;
};

function row(
  pnl: number | null,
  timestamp: string,
  overrides: Partial<Pick<TestTrade, "side" | "marketId" | "strategyVersionId" | "closedAt">> = {},
) {
  const createdAt = new Date(timestamp);
  const trade: TestTrade = {
    status: "closed",
    pnl,
    side: overrides.side ?? "long",
    marketId: overrides.marketId ?? 10,
    strategyVersionId: overrides.strategyVersionId ?? 101,
    createdAt,
    closedAt: overrides.closedAt === undefined ? createdAt : overrides.closedAt,
  };
  return {
    trade,
    strategyId: trade.strategyVersionId === 202 ? 2 : 1,
    strategyVersionId: trade.strategyVersionId,
    strategyName: trade.strategyVersionId === 202 ? "Second strategy" : "First strategy",
    versionNumber: trade.strategyVersionId === 202 ? 2 : 1,
  } as never;
}

const params = (overrides: Record<string, unknown> = {}) => ({
  month: "2026-09",
  timezone: "UTC",
  ...overrides,
});

describe("calculateJournalMonthPerformance", () => {
  it("summarizes a single winning day and a single losing day", () => {
    const result = calculateJournalMonthPerformance(
      [row(125, "2026-09-02T10:00:00Z"), row(-40, "2026-09-04T10:00:00Z")],
      new Map(),
      params(),
    );

    expect(result.tradeCount).toBe(2);
    expect(result.netPnl).toBe(85);
    expect(result.winningTrades).toBe(1);
    expect(result.losingTrades).toBe(1);
    expect(result.daily.map(day => [day.date, day.pnl])).toEqual([["2026-09-02", 125], ["2026-09-04", -40]]);
    expect(result.bestDay?.date).toBe("2026-09-02");
    expect(result.worstDay?.date).toBe("2026-09-04");
  });

  it("calculates mixed-day details, best/worst trades, and average trading day", () => {
    const result = calculateJournalMonthPerformance(
      [row(100, "2026-09-03T09:00:00Z"), row(-25, "2026-09-03T11:00:00Z"), row(50, "2026-09-06T09:00:00Z")],
      new Map(),
      params(),
    );

    const mixedDay = result.daily.find(day => day.date === "2026-09-03");
    expect(mixedDay).toMatchObject({
      tradeCount: 2,
      winningTrades: 1,
      losingTrades: 1,
      pnl: 75,
      winRate: 50,
      averageWinner: 100,
      averageLoser: -25,
      bestTrade: 100,
      worstTrade: -25,
    });
    expect(result.averageTradingDay).toBe(62.5);
    expect(result.cumulative.map(point => point.cumulativePnl)).toEqual([75, 125]);
  });

  it("returns an honest empty month without invented daily values", () => {
    const result = calculateJournalMonthPerformance([], new Map(), params());

    expect(result.hasData).toBe(false);
    expect(result.tradeCount).toBe(0);
    expect(result.netPnl).toBeNull();
    expect(result.daily).toEqual([]);
    expect(result.cumulative).toEqual([]);
    expect(result.currentStreak).toEqual({ type: "none", length: 0 });
  });

  it("keeps note-only dates visible without counting them as trading days", () => {
    const result = calculateJournalMonthPerformance(
      [],
      new Map([["2026-09-12", "Review the week"]]),
      params(),
    );

    expect(result.hasData).toBe(false);
    expect(result.daily).toMatchObject([{ date: "2026-09-12", tradeCount: 0, pnl: 0, note: "Review the week" }]);
    expect(result.averageTradingDay).toBeNull();
    expect(result.bestDay).toBeNull();
  });

  it("uses the configured timezone and closedAt with createdAt fallback", () => {
    const result = calculateJournalMonthPerformance(
      [
        row(10, "2026-08-31T23:30:00Z"),
        row(20, "2026-09-02T12:00:00Z", { closedAt: null }),
      ],
      new Map(),
      params({ timezone: "Europe/London" }),
    );

    expect(result.daily.map(day => day.date)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(result.dateField).toBe("createdAtFallback");
  });

  it("reports closedAt when all realized trades have a close timestamp", () => {
    const result = calculateJournalMonthPerformance(
      [row(30, "2026-09-02T12:00:00Z", { closedAt: new Date("2026-09-04T12:00:00Z") })],
      new Map(),
      params({ timezone: "Europe/London" }),
    );

    expect(result.dateField).toBe("closedAt");
    expect(result.daily.map(day => day.date)).toEqual(["2026-09-04"]);
  });

  it("applies strategy, exact version, instrument, direction, and date filters", () => {
    const result = calculateJournalMonthPerformance(
      [
        row(100, "2026-09-02T10:00:00Z", { strategyVersionId: 101, marketId: 10, side: "long" }),
        row(50, "2026-09-03T10:00:00Z", { strategyVersionId: 202, marketId: 11, side: "short" }),
        row(25, "2026-09-04T10:00:00Z", { strategyVersionId: 101, marketId: 10, side: "short" }),
      ],
      new Map(),
      params({ strategyId: 1, strategyVersionId: 101, marketId: 10, side: "long", from: new Date("2026-09-01"), to: new Date("2026-09-03") }),
    );

    expect(result.tradeCount).toBe(1);
    expect(result.netPnl).toBe(100);
    expect(result.byStrategyVersion).toMatchObject([{ strategyVersionId: 101, tradeCount: 1 }]);
  });

  it("tracks winning and losing streaks across trading days only", () => {
    const result = calculateJournalMonthPerformance(
      [
        row(10, "2026-09-01T10:00:00Z"),
        row(5, "2026-09-03T10:00:00Z"),
        row(-2, "2026-09-05T10:00:00Z"),
        row(-4, "2026-09-06T10:00:00Z"),
      ],
      new Map(),
      params(),
    );

    expect(result.currentStreak).toEqual({ type: "losing", length: 2 });
    expect(result.bestWinningStreak).toBe(2);
    expect(result.bestLosingStreak).toBe(2);
  });
});