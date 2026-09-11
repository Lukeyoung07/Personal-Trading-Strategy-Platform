import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aggregateDukascopyMinuteCandles,
  DUKASCOPY_INSTRUMENT_MAPPINGS,
  dukascopyAdapter,
  parseDukascopyHistory,
} from "./dukascopy";
import { MarketDataService } from "./market-data";

const receivedAt = new Date("2026-09-11T00:00:00.000Z");

function response(payload: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function payload() {
  return {
    timestamp: Date.parse("2026-09-10T10:00:00.000Z"),
    multiplier: 0.001,
    shift: 60_000,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    times: [0, 1, 1, 1, 1],
    opens: [0, 1, 2, -1, 3],
    highs: [2, 3, 4, 1, 5],
    lows: [-1, -2, -1, -3, -2],
    closes: [1, 2, -1, 3, 2],
    volumes: [1, 2, 3, 4, 5],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Dukascopy historical provider", () => {
  it("exposes only the verified XAUUSD and USTEC mappings", () => {
    expect(DUKASCOPY_INSTRUMENT_MAPPINGS.XAUUSD.providerSymbol).toBe("XAU-USD");
    expect(DUKASCOPY_INSTRUMENT_MAPPINGS.USTEC.providerSymbol).toBe("USATECH.IDX-USD");
    expect(dukascopyAdapter.capabilities).toEqual(["candles", "historical"]);
  });

  it("registers through the provider-neutral market-data service", () => {
    const service = new MarketDataService();
    service.register(dukascopyAdapter);
    expect(service.registeredProviderKeys()).toEqual(["dukascopy"]);
    expect(service.adapter("dukascopy")).toBe(dukascopyAdapter);
  });

  it("decodes delta-compressed OHLCV arrays chronologically", () => {
    const candles = parseDukascopyHistory(
      payload(),
      new Date("2026-09-10T10:00:00.000Z"),
      new Date("2026-09-10T10:10:00.000Z"),
    );
    expect(candles).toHaveLength(5);
    expect(candles[0]).toEqual({
      time: Date.parse("2026-09-10T10:00:00.000Z"),
      open: 100,
      high: 100.002,
      low: 99.999,
      close: 100.001,
      volume: 1_000_000,
    });
    expect(candles.at(-1)?.time).toBe(Date.parse("2026-09-10T10:04:00.000Z"));
  });

  it("aggregates verified 1-minute data into 5-minute candles", () => {
    const candles = parseDukascopyHistory(payload());
    const aggregated = aggregateDukascopyMinuteCandles(candles);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]).toMatchObject({
      time: Date.parse("2026-09-10T10:00:00.000Z"),
      open: 100,
      high: 100.015,
      low: 99.991,
      close: 100.007,
      volume: 15_000_000,
    });
  });

  it("retrieves verified 5m data through the official daily endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response(payload()));
    const candles = await dukascopyAdapter.candles({
      providerSymbol: "XAU-USD",
      timeframeCode: "5m",
      from: new Date("2026-09-10T10:00:00.000Z"),
      to: new Date("2026-09-10T10:05:00.000Z"),
    });
    expect(candles).toHaveLength(1);
    expect(candles[0].isClosed).toBe(true);
    expect(candles[0].closeTime).toEqual(new Date("2026-09-10T10:05:00.000Z"));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/candles/minute/XAU-USD/BID/2026/9/10"),
      expect.anything(),
    );
  });

  it("retrieves verified 1h data through the official monthly endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response(payload()));
    const candles = await dukascopyAdapter.candles({
      providerSymbol: "USATECH.IDX-USD",
      timeframeCode: "1h",
      from: new Date("2026-09-10T10:00:00.000Z"),
      to: new Date("2026-09-10T10:05:00.000Z"),
    });
    expect(candles).toHaveLength(5);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/candles/trade/hour/USATECH.IDX-USD/BID/2026/9"),
      expect.anything(),
    );
  });

  it("rejects unsupported timeframes and unverified mappings", async () => {
    await expect(dukascopyAdapter.candles({
      providerSymbol: "XAU-USD",
      timeframeCode: "1m",
    })).rejects.toThrow(/only verified 5m and 1h/i);
    await expect(dukascopyAdapter.candles({
      providerSymbol: "XAUUSD",
      timeframeCode: "5m",
    })).rejects.toThrow(/no verified instrument mapping/i);
  });

  it("returns an empty series for an empty official response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      timestamp: Date.parse("2026-09-10T00:00:00.000Z"),
      multiplier: 0.001,
      shift: 60_000,
      times: [],
      opens: [],
      highs: [],
      lows: [],
      closes: [],
      volumes: [],
    }));
    await expect(dukascopyAdapter.candles({
      providerSymbol: "XAU-USD",
      timeframeCode: "5m",
      from: new Date("2026-09-10T00:00:00.000Z"),
      to: new Date("2026-09-10T01:00:00.000Z"),
    })).resolves.toEqual([]);
  });

  it("retries a rate-limited request sequentially before returning data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ error: "busy" }, 429, { "retry-after": "0" }))
      .mockResolvedValueOnce(response(payload()));

    const candles = await dukascopyAdapter.candles({
      providerSymbol: "XAU-USD",
      timeframeCode: "1h",
      from: new Date("2026-09-10T10:00:00.000Z"),
      to: new Date("2026-09-10T11:00:00.000Z"),
    });

    expect(candles).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After without issuing a concurrent retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ error: "busy" }, 429, { "retry-after": "3" }))
      .mockResolvedValueOnce(response(payload()));
    const request = dukascopyAdapter.candles({
      providerSymbol: "XAU-USD",
      timeframeCode: "1h",
      from: new Date("2026-09-10T10:00:00.000Z"),
      to: new Date("2026-09-10T11:00:00.000Z"),
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff for transient provider failures", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ error: "busy" }, 503))
      .mockResolvedValueOnce(response({ error: "busy" }, 503))
      .mockResolvedValueOnce(response(payload()));
    const request = dukascopyAdapter.candles({
      providerSymbol: "XAU-USD",
      timeframeCode: "1h",
      from: new Date("2026-09-10T10:00:00.000Z"),
      to: new Date("2026-09-10T11:00:00.000Z"),
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("classifies an exhausted rate limit separately from unavailable history", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => response({ error: "busy" }, 429, { "retry-after": "0" }));
    vi.useFakeTimers();
    const assertion = expect(dukascopyAdapter.candles({
      providerSymbol: "XAU-USD",
      timeframeCode: "1h",
      from: new Date("2026-09-10T10:00:00.000Z"),
      to: new Date("2026-09-10T11:00:00.000Z"),
    })).rejects.toMatchObject({ name: "HistoricalDataError", code: "rate_limited" });
    await vi.runAllTimersAsync();
    await assertion;
  });
});