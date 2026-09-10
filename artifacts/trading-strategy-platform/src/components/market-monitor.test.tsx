import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketMonitor } from "./market-monitor";

const eventSources = vi.hoisted(() => [] as FakeEventSource[]);

class FakeEventSource {
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = FakeEventSource.OPEN;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();

  constructor(public readonly url: string) {
    eventSources.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, payload: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(payload) });
    this.listeners.get(type)?.forEach(listener => listener(event));
  }

  fail() {
    this.onerror?.();
  }
}

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMarketDataSummary: () => ({ data: { instrumentCount: 1, sourceCount: 1, timeframeCount: 1, candleCount: 1, connectedSourceCount: 1, latestDataAt: null } }),
  useListInstruments: () => ({ data: [{ id: 18, symbol: "EURUSD", displayName: "Euro / US Dollar", assetClass: "Forex", instrumentType: "forex", isActive: true }], isLoading: false, isError: false, refetch: vi.fn() }),
  useListMarketDataSources: () => ({ data: [{ id: 5, name: "BiQuote", providerKey: "biquote", sourceType: "websocket", capabilities: ["realtime", "candles", "historical"], configurationStatus: "configured", isEnabled: true }], isLoading: false, isError: false, refetch: vi.fn() }),
  useListTimeframes: () => ({ data: [{ id: 20, code: "1h", label: "1 hour", durationSeconds: 3600 }], isLoading: false, isError: false, refetch: vi.fn() }),
  useListCandles: () => ({ data: [{ id: 1, openTime: "2026-09-10T01:00:00.000Z", open: 1.1, high: 1.2, low: 1.05, close: 1.15, isClosed: true }], isLoading: false, isError: false, refetch: vi.fn() }),
  useRefreshMarketDataCandles: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
  getListCandlesQueryKey: (params: unknown) => ["candles", params],
}));

beforeEach(() => {
  eventSources.length = 0;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
});

describe("Market Monitor live state", () => {
  it("propagates a genuine live quote and updates the forming candle", async () => {
    render(<MarketMonitor />);
    await waitFor(() => expect(eventSources).toHaveLength(1));

    eventSources[0].emit("status", { state: "connected", message: "connected", lastDataAt: "2026-09-10T02:00:00.000Z" });
    eventSources[0].emit("quote", {
      eventTime: "2026-09-10T02:00:00.000Z",
      receivedAt: "2026-09-10T02:00:01.000Z",
      lastQuoteAt: "2026-09-10T02:00:00.000Z",
      last: 1.15,
      bid: 1.1,
      ask: 1.2,
      marketState: "open",
      stale: false,
      quoteAgeSeconds: 1,
      isLive: true,
    });

    expect(await screen.findByText("LIVE")).toBeInTheDocument();
    expect(screen.getByText("1.15000")).toBeInTheDocument();
    expect(screen.getByText("Includes live forming bar")).toBeInTheDocument();
    const chart = screen.getByRole("img", { name: "BiQuote candlestick chart" });
    expect(chart).toBeInTheDocument();
    expect(chart.querySelectorAll("rect")).toHaveLength(2);

    eventSources[0].emit("quote", {
      eventTime: "2026-09-10T02:00:30.000Z",
      receivedAt: "2026-09-10T02:00:31.000Z",
      lastQuoteAt: "2026-09-10T02:00:30.000Z",
      last: 1.18,
      bid: 1.17,
      ask: 1.19,
      marketState: "open",
      stale: false,
      quoteAgeSeconds: 1,
      isLive: true,
    });
    await waitFor(() => expect(screen.getByText("1.18000")).toBeInTheDocument());
    expect(chart.querySelectorAll("rect")).toHaveLength(2);
  });

  it("keeps stale, closed, and disconnected states distinct from LIVE", async () => {
    render(<MarketMonitor />);
    await waitFor(() => expect(eventSources).toHaveLength(1));
    const stream = eventSources[0];

    stream.emit("status", { state: "connected", message: "connected", lastDataAt: null });
    stream.emit("quote", {
      eventTime: "2026-09-10T02:00:00.000Z",
      receivedAt: "2026-09-10T02:00:01.000Z",
      lastQuoteAt: "2026-09-10T02:00:00.000Z",
      last: 1.15,
      bid: 1.1,
      ask: 1.2,
      marketState: "open",
      stale: true,
      quoteAgeSeconds: 600,
      isLive: false,
    });
    await waitFor(() => {
      expect(screen.getByText("STALE")).toBeInTheDocument();
      expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
    });

    stream.emit("quote", {
      eventTime: "2026-09-10T02:00:00.000Z",
      receivedAt: "2026-09-10T02:00:01.000Z",
      lastQuoteAt: "2026-09-10T02:00:00.000Z",
      last: 1.15,
      bid: 1.1,
      ask: 1.2,
      marketState: "closed",
      stale: true,
      quoteAgeSeconds: 600,
      isLive: false,
    });
    expect(await screen.findByText("MARKET CLOSED")).toBeInTheDocument();

    stream.fail();
    expect(await screen.findByText("DISCONNECTED")).toBeInTheDocument();
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });
});