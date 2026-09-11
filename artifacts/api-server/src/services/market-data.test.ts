import { describe, expect, it } from "vitest";
import {
  collectHistoricalCandles,
  describeCachedCoverage,
  historicalCandleCoverage,
  missingHistoricalRanges,
  type NormalizedCandle,
} from "./market-data";

const hour = 60 * 60 * 1_000;

function candle(index: number, start = "2026-01-01T00:00:00.000Z"): NormalizedCandle {
  const openTime = new Date(new Date(start).getTime() + index * hour);
  return {
    openTime,
    closeTime: new Date(openTime.getTime() + hour),
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 1,
    isClosed: true,
    receivedAt: new Date("2026-09-11T00:00:00.000Z"),
  };
}

describe("historical market-data retrieval", () => {
  it.each([
    ["7-day", 7],
    ["30-day", 30],
    ["90-day", 90],
    ["custom", 17],
    ["6-month", 180],
    ["1-year", 365],
    ["multi-year", 1_095],
  ])("retrieves the complete %s range", async (_label, days) => {
    const start = new Date("2025-01-01T00:00:00.000Z");
    const end = new Date(start.getTime() + days * 24 * hour);
    const allCandles = Array.from({ length: days + 1 }, (_, index) => candle(index * 24, start.toISOString()));
    const result = await collectHistoricalCandles({
      adapter: {
        candles: async (request) => {
          const from = request.from?.getTime() ?? start.getTime();
          const startIndex = allCandles.findIndex(item => item.openTime.getTime() >= from);
          return allCandles.slice(Math.max(startIndex, 0), Math.max(startIndex, 0) + 37);
        },
      },
      providerSymbol: "TEST",
      timeframeCode: "1d",
      timeframeDurationSeconds: 86_400,
      from: start,
      to: end,
    });

    expect(result).toHaveLength(days + 1);
    expect(result[0].openTime).toEqual(start);
    expect(result.at(-1)?.openTime).toEqual(end);
  });

  it("continues through short provider pages and returns unique candles chronologically", async () => {
    const allCandles = Array.from({ length: 7 }, (_, index) => candle(index));
    const calls: Array<{ from?: Date; limit?: number }> = [];
    const adapter = {
      candles: async (request: { from?: Date; limit?: number }) => {
        calls.push(request);
        const from = request.from?.getTime() ?? allCandles[0].openTime.getTime();
        const start = allCandles.findIndex(item => item.openTime.getTime() >= from);
        const page = allCandles.slice(Math.max(start, 0), Math.max(start, 0) + 2);
        return page[0]?.openTime.getTime() === allCandles[2].openTime.getTime()
          ? [allCandles[2], allCandles[2], allCandles[3]]
          : page;
      },
    };

    const result = await collectHistoricalCandles({
      adapter,
      providerSymbol: "TEST",
      timeframeCode: "1h",
      timeframeDurationSeconds: 3_600,
      from: allCandles[0].openTime,
      to: allCandles.at(-1)!.openTime,
    });

    expect(result.map(item => item.openTime.toISOString())).toEqual(
      allCandles.map(item => item.openTime.toISOString()),
    );
    expect(result).toHaveLength(7);
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.every(call => call.limit === 1_000)).toBe(true);
  });

  it("paginates backward when the provider returns the newest page first", async () => {
    const allCandles = Array.from({ length: 7 }, (_, index) => candle(index));
    const result = await collectHistoricalCandles({
      adapter: {
        candles: async (request) => {
          const from = request.from?.getTime() ?? allCandles[0].openTime.getTime();
          const to = request.to?.getTime() ?? allCandles.at(-1)!.openTime.getTime();
          return allCandles
            .filter(item => item.openTime.getTime() >= from && item.openTime.getTime() <= to)
            .slice(-2)
            .reverse();
        },
      },
      providerSymbol: "TEST",
      timeframeCode: "1h",
      timeframeDurationSeconds: 3_600,
      from: allCandles[0].openTime,
      to: allCandles.at(-1)!.openTime,
    });

    expect(result.map(item => item.openTime.toISOString())).toEqual(
      allCandles.map(item => item.openTime.toISOString()),
    );
  });

  it("stops when a provider ignores the forward cursor instead of looping forever", async () => {
    const firstPage = [candle(0), candle(1)];
    let calls = 0;
    const result = await collectHistoricalCandles({
      adapter: {
        candles: async () => {
          calls += 1;
          return firstPage;
        },
      },
      providerSymbol: "TEST",
      timeframeCode: "1h",
      timeframeDurationSeconds: 3_600,
      from: firstPage[0].openTime,
      to: candle(4).openTime,
    });

    expect(result).toHaveLength(2);
    expect(calls).toBe(2);
  });

  it("advances across empty provider periods when the adapter exposes a page step", async () => {
    const start = new Date("2026-01-03T00:00:00.000Z");
    const firstAvailable = candle(24 * 2, start.toISOString());
    let calls = 0;
    const result = await collectHistoricalCandles({
      adapter: {
        historicalEmptyPageAdvanceSeconds: 86_400,
        candles: async request => {
          calls += 1;
          if (calls < 3) return [];
          return [firstAvailable];
        },
      },
      providerSymbol: "TEST",
      timeframeCode: "1d",
      timeframeDurationSeconds: 86_400,
      from: start,
      to: firstAvailable.openTime,
    });

    expect(result).toEqual([firstAvailable]);
    expect(calls).toBe(3);
  });

  it("emits each successful page for durable cache persistence", async () => {
    const allCandles = [candle(0), candle(1), candle(2)];
    const batches: NormalizedCandle[][] = [];
    await collectHistoricalCandles({
      adapter: {
        candles: async request => {
          const from = request.from?.getTime() ?? allCandles[0].openTime.getTime();
          const start = allCandles.findIndex(item => item.openTime.getTime() >= from);
          return allCandles.slice(Math.max(start, 0), Math.max(start, 0) + 2);
        },
      },
      providerSymbol: "TEST",
      timeframeCode: "1h",
      timeframeDurationSeconds: 3_600,
      from: allCandles[0].openTime,
      to: allCandles.at(-1)!.openTime,
      onBatch: async batch => {
        batches.push(batch);
      },
    });

    expect(batches.flat()).toHaveLength(3);
    expect(batches.length).toBeGreaterThan(1);
  });

  it("rejects a provider response that does not cover the requested range", () => {
    expect(() => historicalCandleCoverage(
      [candle(998), candle(999)],
      {
        timeframeCode: "1h",
        timeframeDurationSeconds: 3_600,
        from: candle(0).openTime,
        to: candle(1_000).openTime,
      },
    )).toThrow(/only covers .*requested backtest range/i);
  });

  it("returns actual coverage metadata for a complete series", () => {
    const candles = [candle(0), candle(1), candle(2)];
    expect(historicalCandleCoverage(candles, {
      timeframeCode: "1h",
      timeframeDurationSeconds: 3_600,
      from: candles[0].openTime,
      to: candles.at(-1)!.openTime,
    })).toEqual({
      candlesProcessed: 3,
      earliestCandle: candles[0].openTime,
      latestCandle: candles[2].openTime,
    });
  });

  it("reports no-data responses instead of treating them as covered history", () => {
    expect(() => historicalCandleCoverage([], {
      timeframeCode: "1h",
      timeframeDurationSeconds: 3_600,
      from: candle(0).openTime,
      to: candle(2).openTime,
    })).toThrow(/contains no candles/i);
  });

  it("describes the actual cached range when a requested range is only partially available", () => {
    const from = new Date("2026-06-13T00:00:00.000Z");
    const to = new Date("2026-09-12T23:59:59.999Z");
    expect(describeCachedCoverage([
      candle(0, "2026-06-14T22:00:00.000Z"),
      candle(1, "2026-06-14T22:00:00.000Z"),
    ], { sourceId: 6, instrumentId: 25, timeframeId: 16, from, to }, "5m"))
      .toContain("Available cached 5m candles cover 2026-06-14T22:00:00.000Z to 2026-06-14T23:00:00.000Z");
  });

  it("requests the full range when the reusable cache is empty", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-11T00:00:00.000Z");
    expect(missingHistoricalRanges([], {
      from,
      to,
      timeframeDurationSeconds: 3_600,
    })).toEqual([{ from, to }]);
  });

  it("reuses complete cached coverage without a provider request", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-11T00:00:00.000Z");
    expect(missingHistoricalRanges([candle(0, from.toISOString()), candle(24 * 10, from.toISOString())], {
      from,
      to,
      timeframeDurationSeconds: 3_600,
    })).toEqual([]);
  });

  it("retrieves only leading and trailing periods around cached history", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-21T00:00:00.000Z");
    const cachedStart = new Date("2026-01-08T00:00:00.000Z");
    expect(missingHistoricalRanges([
      candle(0, cachedStart.toISOString()),
      candle(24 * 6, cachedStart.toISOString()),
    ], {
      from,
      to,
      timeframeDurationSeconds: 3_600,
    })).toEqual([
      {
        from,
        to: new Date("2026-01-07T23:00:00.000Z"),
      },
      {
        from: new Date("2026-01-14T01:00:00.000Z"),
        to,
      },
    ]);
  });
});