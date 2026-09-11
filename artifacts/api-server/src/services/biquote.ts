import { HubConnection, HubConnectionBuilder, HttpTransportType, LogLevel } from "@microsoft/signalr";
import { eq } from "drizzle-orm";
import {
  db,
  marketDataSourcesTable,
  timeframesTable,
} from "@workspace/db";
import type {
  MarketDataConnectionState,
  MarketDataProviderAdapter,
  NormalizedCandle,
  NormalizedProviderQuote,
  ProviderCandleRequest,
} from "./market-data";

const BIQUOTE_KEY = "biquote";
const BIQUOTE_BASE_URL = "https://biquote.io";
const BIQUOTE_INTERVALS = [
  { code: "1m", label: "1 minute", durationSeconds: 60 },
  { code: "5m", label: "5 minutes", durationSeconds: 300 },
  { code: "15m", label: "15 minutes", durationSeconds: 900 },
  { code: "30m", label: "30 minutes", durationSeconds: 1800 },
  { code: "1h", label: "1 hour", durationSeconds: 3600 },
  { code: "4h", label: "4 hours", durationSeconds: 14400 },
  { code: "1d", label: "1 day", durationSeconds: 86400 },
] as const;

const BIQUOTE_CATALOG_TYPES = ["Forex", "Stock", "Index", "Commodity", "Crypto"] as const;
type BiQuoteCatalogType = typeof BIQUOTE_CATALOG_TYPES[number];

export type BiQuoteCatalogItem = {
  providerSymbol: string;
  displayName: string;
  assetClass: BiQuoteCatalogType;
  instrumentType: "forex" | "stock" | "index" | "commodity" | "crypto";
  venue: string | null;
  quoteCurrency: string | null;
  tickSize: number | null;
  contractMultiplier: number | null;
  description: string | null;
};

type BiQuoteTick = {
  symbol?: unknown;
  bid?: unknown;
  ask?: unknown;
  mid?: unknown;
  timestamp?: unknown;
  marketState?: unknown;
  stale?: unknown;
  quoteAgeSeconds?: unknown;
  lastQuoteAt?: unknown;
};

type SubscriptionState = {
  symbol?: unknown;
  state?: unknown;
  quoteAgeSeconds?: unknown;
  seeded?: unknown;
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseDate(value: unknown, fallback: Date) {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function httpError(response: Response, body: string) {
  return new Error(`BiQuote request failed (${response.status}): ${body.slice(0, 240)}`);
}

async function biquoteJson<T>(path: string, query: URLSearchParams) {
  const response = await fetch(`${BIQUOTE_BASE_URL}${path}?${query.toString()}`, {
    headers: { accept: "application/json" },
  });
  const body = await response.text();
  if (!response.ok) throw httpError(response, body);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("BiQuote returned an invalid JSON response.");
  }
}

function normalizeInterval(timeframeCode: string) {
  const code = timeframeCode.trim().toLowerCase();
  if (!(BIQUOTE_INTERVALS.some(interval => interval.code === code))) {
    throw new Error(`BiQuote does not support timeframe '${timeframeCode}'. Supported values: ${BIQUOTE_INTERVALS.map(interval => interval.code).join(", ")}`);
  }
  return code;
}

class BiQuoteAdapter implements MarketDataProviderAdapter {
  readonly key = BIQUOTE_KEY;
  readonly capabilities = ["realtime", "candles", "historical"] as const;

  private connection: HubConnection | null = null;
  private state: MarketDataConnectionState = "disconnected";
  private statusMessage = "BiQuote is disconnected.";
  private readonly marketStates = new Map<string, { state: string; quoteAgeSeconds: number | null }>();
  private readonly waiters = new Set<{ symbol: string; push: (quote: NormalizedProviderQuote) => void }>();
  private catalogCache: { expiresAt: number; items: BiQuoteCatalogItem[] } | null = null;

  async connect() {
    if (this.connection?.state === "Connected" || this.connection?.state === "Connecting") return;

    const connection = new HubConnectionBuilder()
      .withUrl(`${BIQUOTE_BASE_URL}/hubs/tick`, {
        transport: HttpTransportType.WebSockets | HttpTransportType.ServerSentEvents | HttpTransportType.LongPolling,
      })
      .withAutomaticReconnect([0, 2000, 10000, 30000])
      .configureLogging(LogLevel.Error)
      .build();

    connection.onreconnecting(error => {
      this.state = "degraded";
      this.statusMessage = error?.message ?? "BiQuote connection is reconnecting.";
    });
    connection.onreconnected(() => {
      this.state = "connected";
      this.statusMessage = "BiQuote connection restored.";
    });
    connection.onclose(error => {
      this.state = "disconnected";
      this.statusMessage = error?.message ?? "BiQuote connection closed.";
    });
    connection.on("ReceiveSubscriptionState", (states: SubscriptionState[]) => {
      for (const item of Array.isArray(states) ? states : []) {
        const symbol = typeof item.symbol === "string" ? item.symbol.toUpperCase() : null;
        if (!symbol) continue;
        this.marketStates.set(symbol, {
          state: typeof item.state === "string" ? item.state.toLowerCase() : "unknown",
          quoteAgeSeconds: finiteNumber(item.quoteAgeSeconds),
        });
      }
    });
    connection.on("ReceiveTick", (tick: BiQuoteTick) => {
      const symbol = typeof tick.symbol === "string" ? tick.symbol.toUpperCase() : null;
      if (!symbol) return;
      const receivedAt = new Date();
      const metadata = this.marketStates.get(symbol);
      const timestamp = parseDate(tick.timestamp, receivedAt);
      const marketState = typeof tick.marketState === "string"
        ? tick.marketState.toLowerCase()
        : metadata?.state;
      const quoteAgeSeconds = finiteNumber(tick.quoteAgeSeconds) ?? metadata?.quoteAgeSeconds ?? null;
      const stale = typeof tick.stale === "boolean"
        ? tick.stale
        : marketState === "closed" || (quoteAgeSeconds != null && quoteAgeSeconds > 300);
      const quote: NormalizedProviderQuote = {
        eventTime: timestamp,
        receivedAt,
        providerEventId: null,
        bid: finiteNumber(tick.bid),
        ask: finiteNumber(tick.ask),
        bidSize: null,
        askSize: null,
        last: finiteNumber(tick.mid) ?? finiteNumber(tick.bid) ?? finiteNumber(tick.ask),
        lastSize: null,
        marketState: marketState === "open" || marketState === "closed" ? marketState : "unknown",
        stale,
        quoteAgeSeconds,
        lastQuoteAt: parseDate(tick.lastQuoteAt ?? tick.timestamp, timestamp),
      };
      for (const waiter of this.waiters) {
        if (waiter.symbol === symbol) waiter.push(quote);
      }
    });

    this.connection = connection;
    this.state = "connecting";
    this.statusMessage = "Connecting to BiQuote.";
    try {
      await connection.start();
      this.state = "connected";
      this.statusMessage = "BiQuote live connection is connected.";
    } catch (error) {
      this.state = "error";
      this.statusMessage = error instanceof Error ? error.message : "BiQuote connection failed.";
      this.connection = null;
      throw error;
    }
  }

  async disconnect() {
    if (this.connection) await this.connection.stop();
    this.connection = null;
    this.state = "disconnected";
    this.statusMessage = "BiQuote is disconnected.";
  }

  async connectionState() {
    return { state: this.state, message: this.statusMessage };
  }

  async catalog(): Promise<BiQuoteCatalogItem[]> {
    if (this.catalogCache && this.catalogCache.expiresAt > Date.now()) return this.catalogCache.items;

    const query = new URLSearchParams({
      activeOnly: "true",
      quotedWithinDays: "7",
    });
    const symbols = await biquoteJson<Array<{
      name?: unknown;
      description?: unknown;
      exchange?: unknown;
      type?: unknown;
      tickSize?: unknown;
      contractSize?: unknown;
      currency?: unknown;
      isActive?: unknown;
      hasData?: unknown;
    }>>("/api/symbols", query);

    const items = symbols
      .filter((symbol): symbol is typeof symbol & { name: string; type: BiQuoteCatalogType } =>
        typeof symbol.name === "string"
        && BIQUOTE_CATALOG_TYPES.includes(symbol.type as BiQuoteCatalogType)
        && symbol.isActive === true
        && symbol.hasData === true,
      )
      .map(symbol => ({
        providerSymbol: symbol.name.toUpperCase(),
        displayName: symbol.name.toUpperCase(),
        assetClass: symbol.type,
        instrumentType: symbol.type.toLowerCase() as BiQuoteCatalogItem["instrumentType"],
        venue: typeof symbol.exchange === "string" ? symbol.exchange : null,
        quoteCurrency: typeof symbol.currency === "string" ? symbol.currency : null,
        tickSize: finiteNumber(symbol.tickSize),
        contractMultiplier: finiteNumber(symbol.contractSize),
        description: typeof symbol.description === "string" ? symbol.description : null,
      }))
      .sort((a, b) => a.providerSymbol.localeCompare(b.providerSymbol));

    this.catalogCache = { expiresAt: Date.now() + 60_000, items };
    return items;
  }

  async candles(request: ProviderCandleRequest): Promise<NormalizedCandle[]> {
    const interval = normalizeInterval(request.timeframeCode);
    const query = new URLSearchParams({
      interval,
      limit: String(Math.min(Math.max(request.limit ?? 200, 1), 1000)),
    });
    if (request.from) query.set("from", request.from.toISOString());
    if (request.to) query.set("to", request.to.toISOString());

    const response = await biquoteJson<{
      symbol?: unknown;
      interval?: unknown;
      bars?: Array<{
        openTime?: unknown;
        closeTime?: unknown;
        open?: unknown;
        high?: unknown;
        low?: unknown;
        close?: unknown;
        volume?: unknown;
          isOpen?: unknown;
      }>;
    }>(`/api/${encodeURIComponent(request.providerSymbol)}/ohlc`, query);

    const receivedAt = new Date();
    const bars = Array.isArray(response.bars) ? response.bars : [];
    return bars
      .map(bar => {
        const openTime = parseDate(bar.openTime, new Date(Number.NaN));
        const open = finiteNumber(bar.open);
        const high = finiteNumber(bar.high);
        const low = finiteNumber(bar.low);
        const close = finiteNumber(bar.close);
        if (Number.isNaN(openTime.getTime()) || open == null || high == null || low == null || close == null) return null;
        const closeTime = bar.closeTime == null ? null : parseDate(bar.closeTime, new Date(Number.NaN));
        return {
          openTime,
          closeTime: closeTime && !Number.isNaN(closeTime.getTime()) ? closeTime : null,
          open,
          high,
          low,
          close,
          volume: finiteNumber(bar.volume),
          isClosed: bar.isOpen !== true,
          receivedAt,
        };
      })
      .filter((bar): bar is NormalizedCandle => bar !== null)
      .sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
  }

  async *subscribeQuotes(request: { providerSymbol: string; signal?: AbortSignal }): AsyncIterable<NormalizedProviderQuote> {
    await this.connect();
    if (!this.connection) throw new Error("BiQuote connection is unavailable.");

    const symbol = request.providerSymbol.trim().toUpperCase();
    const queue: NormalizedProviderQuote[] = [];
    let wake: (() => void) | null = null;
    const push = (quote: NormalizedProviderQuote) => {
      queue.push(quote);
      wake?.();
    };
    const waiter = { symbol, push };
    this.waiters.add(waiter);
    const abort = () => wake?.();
    request.signal?.addEventListener("abort", abort, { once: true });

    try {
      await this.connection.invoke("Subscribe", [symbol]);
      while (!request.signal?.aborted) {
        if (!queue.length) await new Promise<void>(resolve => { wake = resolve; });
        wake = null;
        while (queue.length) yield queue.shift()!;
      }
    } finally {
      this.waiters.delete(waiter);
      request.signal?.removeEventListener("abort", abort);
      if (this.connection.state === "Connected") {
        await this.connection.invoke("Unsubscribe", [symbol]).catch(() => undefined);
      }
    }
  }
}

export const biQuoteAdapter = new BiQuoteAdapter();

export async function ensureBiQuoteCatalog() {
  const [source] = await db.select().from(marketDataSourcesTable).where(eq(marketDataSourcesTable.providerKey, BIQUOTE_KEY));
  const [resolvedSource] = source
    ? [source]
    : await db.insert(marketDataSourcesTable).values({
      name: "BiQuote",
      providerKey: BIQUOTE_KEY,
      sourceType: "websocket",
      description: "BiQuote live OTC market data for personal development and testing.",
      capabilities: [...biQuoteAdapter.capabilities],
      configurationStatus: "configured",
      isEnabled: true,
    }).returning();

  await Promise.all(BIQUOTE_INTERVALS.map(interval =>
    db.insert(timeframesTable).values(interval).onConflictDoNothing({ target: timeframesTable.code }),
  ));

  return resolvedSource;
}