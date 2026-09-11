import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddMarketTab, MarketMonitor } from "./market-monitor";

const eventSources = vi.hoisted(() => [] as FakeEventSource[]);
const addMarketMutate = vi.hoisted(() => vi.fn());
const refreshCandleMutate = vi.hoisted(() => vi.fn());
const candleData = vi.hoisted(() => ({
  current: [{ id: 1, openTime: "2026-09-10T01:00:00.000Z", open: 1.1, high: 1.2, low: 1.05, close: 1.15, isClosed: true }],
}));

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
  getGetMarketDataSummaryQueryKey: () => ["market-data-summary"],
  useListInstruments: () => ({ data: [{ id: 18, symbol: "EURUSD", displayName: "Euro / US Dollar", assetClass: "Forex", instrumentType: "forex", isActive: true }], isLoading: false, isError: false, refetch: vi.fn() }),
  getListInstrumentsQueryKey: () => ["instruments"],
  useListMarketDataSources: () => ({ data: [{ id: 5, name: "BiQuote", providerKey: "biquote", sourceType: "websocket", capabilities: ["realtime", "candles", "historical"], configurationStatus: "configured", isEnabled: true }], isLoading: false, isError: false, refetch: vi.fn() }),
  useListTimeframes: () => ({ data: [{ id: 20, code: "1h", label: "1 hour", durationSeconds: 3600, isActive: true }], isLoading: false, isError: false, refetch: vi.fn() }),
  useGetBiQuoteCatalog: () => ({
    data: [
      { providerSymbol: "EURUSD", sourceName: "BiQuote", displayName: "EURUSD", assetClass: "Forex", instrumentType: "forex", venue: "FOREX", quoteCurrency: "USD", tickSize: 0.00001, contractMultiplier: 100000, description: "Euro / US Dollar" },
      { providerSymbol: "XAUUSD", sourceName: "BiQuote", displayName: "XAUUSD", assetClass: "Commodity", instrumentType: "commodity", venue: "COMEX", quoteCurrency: "USD", tickSize: 0.01, contractMultiplier: 100, description: "Gold" },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAddBiQuoteMarket: () => ({ isPending: false, isError: false, mutate: addMarketMutate }),
  useListEconomicEvents: () => ({ data: { providerConnected: true, providerName: "Test source", message: "Connected sources: Test source.", events: [] }, isLoading: false, isError: false }),
  getListEconomicEventsQueryKey: (params: unknown) => ["economic-events", params],
  useCreateAlert: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
  getListAlertsQueryKey: () => ["alerts"],
  useListCandles: () => ({ data: candleData.current, isLoading: false, isError: false, refetch: vi.fn() }),
  useRefreshMarketDataCandles: () => ({ isPending: false, isError: false, mutate: refreshCandleMutate }),
  getListCandlesQueryKey: (params: unknown) => ["candles", params],
  getListSourceInstrumentMappingsQueryKey: () => ["mappings"],
}));

beforeEach(() => {
  eventSources.length = 0;
  addMarketMutate.mockReset();
  refreshCandleMutate.mockReset();
  candleData.current = [{ id: 1, openTime: "2026-09-10T01:00:00.000Z", open: 1.1, high: 1.2, low: 1.05, close: 1.15, isClosed: true }];
  addMarketMutate.mockImplementation((_request: unknown, options: { onSuccess?: (result: unknown) => void }) => {
    options.onSuccess?.({
      instrument: { id: 19 },
      mapping: { id: 9 },
      timeframe: { id: 20 },
    });
  });
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

    expect(await screen.findByText("LIVE", { selector: "span.tag" })).toBeInTheDocument();
    expect(screen.getAllByText("1.15000").length).toBeGreaterThan(0);
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
     await waitFor(() => expect(screen.getAllByText("1.18000").length).toBeGreaterThan(0));
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
       expect(screen.getByText("STALE", { selector: "span.tag" })).toBeInTheDocument();
       expect(screen.queryByText("LIVE", { selector: "span.tag" })).not.toBeInTheDocument();
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
     expect(await screen.findByText("MARKET CLOSED", { selector: "span.tag" })).toBeInTheDocument();

    stream.fail();
     expect(await screen.findByText("DISCONNECTED", { selector: "span.tag" })).toBeInTheDocument();
     expect(screen.queryByText("LIVE", { selector: "span.tag" })).not.toBeInTheDocument();
  });

  it("requests genuine historical candles when a selected timeframe has no stored bars", async () => {
    candleData.current = [];
    render(<MarketMonitor />);

    await waitFor(() => expect(refreshCandleMutate).toHaveBeenCalledWith(
      { data: { sourceId: 5, instrumentId: 18, timeframeId: 20, limit: 500 } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    ));
  });

  it("routes price-axis and time-axis drags to visual scaling instead of chart panning", async () => {
    candleData.current = Array.from({ length: 80 }, (_, index) => {
      const close = 1.1 + index * 0.01;
      return {
        id: index + 1,
        openTime: new Date(Date.UTC(2026, 8, 10, index)).toISOString(),
        open: close - 0.004,
        high: close + 0.006,
        low: close - 0.008,
        close,
        isClosed: true,
      };
    });
    render(<MarketMonitor />);
    const chart = await screen.findByRole("img", { name: "BiQuote candlestick chart" });
    Object.defineProperty(chart, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 900, height: 360, right: 900, bottom: 360 }),
    });

    const initialHigh = screen.getByTestId("chart-price-high").textContent;
    const initialLow = screen.getByTestId("chart-price-low").textContent;
    fireEvent.pointerDown(screen.getByTestId("chart-price-axis"), { pointerId: 1, clientX: 870, clientY: 120 });
    fireEvent.pointerMove(chart, { pointerId: 1, clientX: 870, clientY: 60 });
    fireEvent.pointerUp(chart, { pointerId: 1, clientX: 870, clientY: 60 });

    await waitFor(() => {
      expect(screen.getByTestId("chart-price-high").textContent).not.toBe(initialHigh);
      expect(screen.getByTestId("chart-price-low").textContent).not.toBe(initialLow);
    });
    expect(screen.getByText("26–80")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId("chart-time-axis"), { pointerId: 2, clientX: 450, clientY: 350 });
    fireEvent.pointerMove(chart, { pointerId: 2, clientX: 300, clientY: 350 });
    fireEvent.pointerUp(chart, { pointerId: 2, clientX: 300, clientY: 350 });

    await waitFor(() => expect(screen.getByText("1–80")).toBeInTheDocument());
  });

  it("searches by human name or provider symbol and submits the selected timeframe", async () => {
    const onAdded = vi.fn();
    render(<AddMarketTab onAdded={onAdded} />);

    expect(screen.getByRole("option", { name: /Futures.*not currently available/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /Stocks.*not currently available/ })).toBeDisabled();
    expect(screen.getByText("No futures markets are currently available from this data provider.")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("select-market-category"), { target: { value: "Commodities" } });
    fireEvent.change(screen.getByTestId("input-search-markets"), { target: { value: "gold" } });

    await waitFor(() => expect(screen.getByTestId("market-card-XAUUSD")).toBeInTheDocument());
    expect(screen.getByText("Gold")).toBeInTheDocument();
    expect(screen.queryByTestId("market-card-EURUSD")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-search-markets"), { target: { value: "XAU" } });
    expect(screen.getByTestId("market-card-XAUUSD")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("market-card-XAUUSD"));
    fireEvent.change(screen.getByTestId("select-market-timeframe"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Market" }));

    expect(addMarketMutate).toHaveBeenCalledWith(
      { data: { providerSymbol: "XAUUSD", timeframeId: 20 } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onAdded).toHaveBeenCalled();
  });

  it("explains an empty provider category without inventing markets", async () => {
    render(<AddMarketTab onAdded={vi.fn()} />);

    fireEvent.change(screen.getByTestId("select-market-category"), { target: { value: "Futures" } });

    expect(await screen.findAllByText("No futures markets are currently available from this data provider.")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Add Market" })).toBeDisabled();
  });
});