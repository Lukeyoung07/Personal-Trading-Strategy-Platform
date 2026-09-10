import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signalrState = vi.hoisted(() => ({
  lastConnection: null as FakeConnection | null,
}));

class FakeConnection {
  state = "Disconnected";
  handlers = new Map<string, (payload: any) => void>();
  lifecycle = {
    reconnecting: null as ((error?: Error) => void) | null,
    reconnected: null as (() => void) | null,
    close: null as ((error?: Error) => void) | null,
  };
  invokes: Array<{ method: string; args: unknown[] }> = [];

  async start() {
    this.state = "Connected";
  }

  async stop() {
    this.state = "Disconnected";
    this.lifecycle.close?.();
  }

  on(method: string, handler: (payload: any) => void) {
    this.handlers.set(method, handler);
  }

  onreconnecting(handler: (error?: Error) => void) {
    this.lifecycle.reconnecting = handler;
  }

  onreconnected(handler: () => void) {
    this.lifecycle.reconnected = handler;
  }

  onclose(handler: (error?: Error) => void) {
    this.lifecycle.close = handler;
  }

  async invoke(method: string, ...args: unknown[]) {
    this.invokes.push({ method, args });
  }

  emit(method: string, payload: unknown) {
    this.handlers.get(method)?.(payload);
  }
}

vi.mock("@microsoft/signalr", () => ({
  HubConnectionBuilder: class {
    withUrl() {
      return this;
    }
    withAutomaticReconnect() {
      return this;
    }
    configureLogging() {
      return this;
    }
    build() {
      const connection = new FakeConnection();
      signalrState.lastConnection = connection;
      return connection;
    }
  },
  HttpTransportType: { WebSockets: 1, ServerSentEvents: 2, LongPolling: 4 },
  LogLevel: { Error: 4 },
}));

import { biQuoteAdapter } from "./biquote";

describe("BiQuote adapter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(async () => {
    await biQuoteAdapter.disconnect();
    vi.unstubAllGlobals();
    signalrState.lastConnection = null;
  });

  it("retrieves and normalizes historical candles while rejecting invalid bars", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      symbol: "EURUSD",
      interval: "1h",
      bars: [
        {
          openTime: "2026-09-10T01:00:00.000Z",
          closeTime: "2026-09-10T02:00:00.000Z",
          open: 1.1,
          high: 1.2,
          low: 1.05,
          close: 1.15,
          volume: 4,
        },
        { openTime: "not-a-date", open: 1, high: 1, low: 1, close: 1 },
        { openTime: "2026-09-10T00:00:00.000Z", open: 1, high: 1, low: 1, close: null },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const candles = await biQuoteAdapter.candles({
      providerSymbol: "EURUSD",
      timeframeCode: "1h",
      limit: 20,
    });

    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      open: 1.1,
      high: 1.2,
      low: 1.05,
      close: 1.15,
      volume: 4,
      isClosed: true,
    });
    expect(candles[0].openTime.toISOString()).toBe("2026-09-10T01:00:00.000Z");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/EURUSD/ohlc?interval=1h&limit=20");
  });

  it("returns only active catalog instruments with recent provider data", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      {
        name: "EURUSD",
        description: "Euro / US Dollar",
        exchange: "FOREX",
        type: "Forex",
        tickSize: 0.00001,
        contractSize: 100000,
        currency: "USD",
        isActive: true,
        hasData: true,
      },
      {
        name: "OLD",
        description: "No longer quoted",
        exchange: "FOREX",
        type: "Forex",
        isActive: true,
        hasData: false,
      },
      {
        name: "FUTURE",
        description: "Unsupported category",
        exchange: "CME",
        type: "Future",
        isActive: true,
        hasData: true,
      },
    ]), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(biQuoteAdapter.catalog()).resolves.toEqual([{
      providerSymbol: "EURUSD",
      displayName: "EURUSD",
      assetClass: "Forex",
      instrumentType: "forex",
      venue: "FOREX",
      quoteCurrency: "USD",
      tickSize: 0.00001,
      contractMultiplier: 100000,
      description: "Euro / US Dollar",
    }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/symbols?activeOnly=true&quotedWithinDays=7");
  });

  it("rejects unsupported timeframes, unsupported symbols, and invalid provider messages", async () => {
    await expect(biQuoteAdapter.candles({
      providerSymbol: "EURUSD",
      timeframeCode: "2h",
    })).rejects.toThrow("does not support timeframe");

    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    await expect(biQuoteAdapter.candles({
      providerSymbol: "NOT-A-SYMBOL",
      timeframeCode: "1h",
    })).rejects.toThrow("BiQuote request failed (404)");

    fetchMock.mockResolvedValueOnce(new Response("{bad json", { status: 200 }));
    await expect(biQuoteAdapter.candles({
      providerSymbol: "EURUSD",
      timeframeCode: "1h",
    })).rejects.toThrow("invalid JSON");
  });

  it("normalizes live quote propagation and forming-bar source metadata", async () => {
    const controller = new AbortController();
    const iterator = biQuoteAdapter.subscribeQuotes({ providerSymbol: "eurusd", signal: controller.signal })[Symbol.asyncIterator]();
    const nextQuote = iterator.next();
    await Promise.resolve();

    const connection = signalrState.lastConnection!;
    await vi.waitFor(() => expect(connection.invokes).toContainEqual({ method: "Subscribe", args: [["EURUSD"]] }));
    connection.emit("ReceiveSubscriptionState", [{ symbol: "EURUSD", state: "open", quoteAgeSeconds: 0 }]);
    connection.emit("ReceiveTick", {
      symbol: "EURUSD",
      bid: 1.1,
      ask: 1.2,
      mid: 1.15,
      timestamp: "2026-09-10T02:00:00.000Z",
      lastQuoteAt: "2026-09-10T02:00:00.000Z",
    });

    const result = await nextQuote;
    expect(result.value).toMatchObject({
      bid: 1.1,
      ask: 1.2,
      last: 1.15,
      marketState: "open",
      stale: false,
      quoteAgeSeconds: 0,
    });
    expect(result.value?.eventTime.toISOString()).toBe("2026-09-10T02:00:00.000Z");
    controller.abort();
    await iterator.return?.();
    expect(connection.invokes).toContainEqual({ method: "Unsubscribe", args: [["EURUSD"]] });
  });

  it("marks closed and aged quotes stale, and exposes reconnect/disconnect states", async () => {
    await biQuoteAdapter.connect();
    const connection = signalrState.lastConnection!;

    connection.emit("ReceiveSubscriptionState", [{ symbol: "EURUSD", state: "closed", quoteAgeSeconds: 600 }]);
    const controller = new AbortController();
    const iterator = biQuoteAdapter.subscribeQuotes({ providerSymbol: "EURUSD", signal: controller.signal })[Symbol.asyncIterator]();
    const nextQuote = iterator.next();
    await Promise.resolve();
    connection.emit("ReceiveTick", {
      symbol: "EURUSD",
      bid: 1.1,
      ask: 1.2,
      timestamp: "2026-09-10T02:00:00.000Z",
    });
    const result = await nextQuote;
    expect(result.value).toMatchObject({ marketState: "closed", stale: true, last: 1.1 });
    controller.abort();
    await iterator.return?.();

    connection.lifecycle.reconnecting?.(new Error("network drop"));
    await expect(biQuoteAdapter.connectionState()).resolves.toMatchObject({ state: "degraded" });
    connection.lifecycle.reconnected?.();
    await expect(biQuoteAdapter.connectionState()).resolves.toMatchObject({ state: "connected" });
    connection.lifecycle.close?.(new Error("provider closed"));
    await expect(biQuoteAdapter.connectionState()).resolves.toMatchObject({ state: "disconnected" });
  });
});