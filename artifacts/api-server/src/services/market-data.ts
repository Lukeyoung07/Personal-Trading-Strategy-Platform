import { and, asc, count, eq, gte, lte, max, min, sql } from "drizzle-orm";
import {
  candlesTable,
  db,
  marketDataConnectionsTable,
  marketDataSourcesTable,
  marketsTable,
  sourceInstrumentMappingsTable,
  timeframesTable,
} from "@workspace/db";
import { HistoricalDataError } from "./historical-errors";

export type MarketDataCapability = "realtime" | "candles" | "historical" | "sessions";
export type MarketDataConnectionState = "disconnected" | "connecting" | "connected" | "degraded" | "error";

export interface ProviderCandleRequest {
  providerSymbol: string;
  timeframeCode: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface ProviderQuoteRequest {
  providerSymbol: string;
  signal?: AbortSignal;
}

export interface NormalizedProviderQuote {
  eventTime: Date;
  receivedAt: Date;
  providerEventId?: string | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  last: number | null;
  lastSize: number | null;
  marketState?: "open" | "closed" | "unknown" | null;
  stale?: boolean | null;
  quoteAgeSeconds?: number | null;
  lastQuoteAt?: Date | null;
}

export interface CanonicalQuote extends NormalizedProviderQuote {
  sourceId: number;
  instrumentId: number;
}

export interface NormalizedCandle {
  openTime: Date;
  closeTime: Date | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  isClosed: boolean;
  receivedAt: Date;
}

export interface MarketSession {
  name: string;
  timezone: string;
  opensAt: string;
  closesAt: string;
}

export interface MarketDataProviderAdapter {
  readonly key: string;
  readonly capabilities: readonly MarketDataCapability[];
  readonly historicalEmptyPageAdvanceSeconds?: number;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  connectionState(): Promise<{ state: MarketDataConnectionState; message?: string }>;
  candles(request: ProviderCandleRequest): Promise<NormalizedCandle[]>;
  subscribeQuotes?(request: ProviderQuoteRequest): AsyncIterable<NormalizedProviderQuote>;
  sessions?(providerSymbol: string, at: Date): Promise<MarketSession[]>;
}

export interface HistoricalCandleCollectionRequest {
  adapter: Pick<MarketDataProviderAdapter, "candles" | "historicalEmptyPageAdvanceSeconds">;
  providerSymbol: string;
  timeframeCode: string;
  timeframeDurationSeconds: number;
  from?: Date;
  to?: Date;
  limit?: number;
  onBatch?: (candles: NormalizedCandle[]) => Promise<void>;
}

export interface HistoricalCandleCoverage {
  candlesProcessed: number;
  earliestCandle: Date;
  latestCandle: Date;
}

export type HistoricalAvailabilityState = "complete" | "partial" | "unavailable";

export interface HistoricalDataAvailability {
  sourceId: number;
  instrumentId: number;
  timeframeId: number;
  timeframeCode: string;
  requestedFrom: Date;
  requestedTo: Date;
  storedCount: number;
  earliestCandle: Date | null;
  latestCandle: Date | null;
  coverageState: HistoricalAvailabilityState;
  providerStatus: MarketDataConnectionState | null;
  providerError: {
    code: HistoricalDataError["code"] | "unknown";
    message: string;
  } | null;
}

export interface CanonicalCandleRequest {
  sourceId: number;
  instrumentId: number;
  timeframeId: number;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface CanonicalQuoteRequest {
  sourceId: number;
  instrumentId: number;
  signal?: AbortSignal;
}

export interface CandleBatch {
  sourceId: number;
  instrumentId: number;
  timeframeId: number;
  candles: NormalizedCandle[];
}

function validateCandle(candle: NormalizedCandle) {
  const prices = [candle.open, candle.high, candle.low, candle.close];
  if (prices.some(value => !Number.isFinite(value))) throw new Error("Candle prices must be finite numbers");
  if (candle.volume != null && !Number.isFinite(candle.volume)) throw new Error("Candle volume must be finite");
  if (candle.high < Math.max(candle.open, candle.low, candle.close)) throw new Error("Candle high is below another price");
  if (candle.low > Math.min(candle.open, candle.high, candle.close)) throw new Error("Candle low is above another price");
  if (candle.closeTime && candle.closeTime < candle.openTime) throw new Error("Candle close time is before open time");
}

function validateQuote(quote: NormalizedProviderQuote) {
  const values = [quote.bid, quote.ask, quote.bidSize, quote.askSize, quote.last, quote.lastSize];
  if (values.every(value => value == null)) throw new Error("Quote contains no price or size values");
  if (values.some(value => value != null && !Number.isFinite(value))) throw new Error("Quote values must be finite numbers");
  if (quote.eventTime.getTime() > quote.receivedAt.getTime()) throw new Error("Quote event time is after its received time");
}

const PROVIDER_PAGE_SIZE = 1_000;
const MAX_HISTORICAL_PAGES = 100_000;
const MARKET_CLOSURE_BOUNDARY_TOLERANCE_MS = 4 * 24 * 60 * 60 * 1_000;
const CANDLE_WRITE_BATCH_SIZE = 500;

function coverageToleranceMs(timeframeDurationSeconds: number) {
  return Math.max(
    MARKET_CLOSURE_BOUNDARY_TOLERANCE_MS,
    timeframeDurationSeconds * 2 * 1_000,
  );
}

function isCoveredByBoundaries(
  earliestCandle: Date | null,
  latestCandle: Date | null,
  request: Pick<HistoricalCandleCollectionRequest, "from" | "to" | "timeframeDurationSeconds">,
) {
  if (!earliestCandle || !latestCandle) return false;
  const tolerance = coverageToleranceMs(request.timeframeDurationSeconds);
  return (!request.from || earliestCandle.getTime() - request.from.getTime() <= tolerance)
    && (!request.to || request.to.getTime() - latestCandle.getTime() <= tolerance);
}

export interface HistoricalMissingRange {
  from: Date;
  to: Date;
}

/**
 * Finds only the leading and trailing portions not represented by the cache.
 * Gaps inside a market-closed period are intentionally not treated as missing:
 * provider candle series do not contain weekend or holiday candles.
 */
export function missingHistoricalRanges(
  cachedCandles: NormalizedCandle[],
  request: Pick<HistoricalCandleCollectionRequest, "from" | "to" | "timeframeDurationSeconds">,
): HistoricalMissingRange[] {
  if (!request.from || !request.to || request.from >= request.to) return [];
  const ordered = [...cachedCandles].sort((left, right) => left.openTime.getTime() - right.openTime.getTime());
  if (!ordered.length) return [{ from: request.from, to: request.to }];

  const ranges: HistoricalMissingRange[] = [];
  const tolerance = coverageToleranceMs(request.timeframeDurationSeconds);
  const earliest = ordered[0].openTime;
  const latest = ordered.at(-1)!.openTime;
  if (earliest.getTime() - request.from.getTime() > tolerance) {
    const to = new Date(earliest.getTime() - request.timeframeDurationSeconds * 1_000);
    if (request.from <= to) ranges.push({ from: request.from, to });
  }
  if (request.to.getTime() - latest.getTime() > tolerance) {
    const from = new Date(latest.getTime() + request.timeframeDurationSeconds * 1_000);
    if (from <= request.to) ranges.push({ from, to: request.to });
  }
  return ranges;
}

/**
 * Providers may return fewer than the requested page size even when more
 * history exists. Pagination therefore stops only when the requested end is
 * reached, an empty page cannot advance, or the provider stops moving forward.
 */
export async function collectHistoricalCandles(request: HistoricalCandleCollectionRequest) {
  const totalLimit = request.limit ?? (request.to ? Number.POSITIVE_INFINITY : 200_000);
  if (totalLimit <= 0) return [];

  const collected = new Map<number, NormalizedCandle>();
  let fromCursor = request.from;
  let toCursor = request.to;
  let direction: "forward" | "backward" | null = null;
  let pages = 0;

  while (collected.size < totalLimit) {
    if (pages >= MAX_HISTORICAL_PAGES) {
      throw new Error("Historical provider pagination did not reach the requested end date.");
    }

    const batch = await request.adapter.candles({
      providerSymbol: request.providerSymbol,
      timeframeCode: request.timeframeCode,
      from: fromCursor,
      to: toCursor,
      limit: Math.min(PROVIDER_PAGE_SIZE, totalLimit - collected.size),
    });
    pages += 1;
    batch.forEach(validateCandle);

    const filteredBatch = batch.filter(candle => (!request.from || candle.openTime >= request.from)
      && (!request.to || candle.openTime <= request.to));
    const latest = filteredBatch.reduce<Date | null>(
      (value, candle) => !value || candle.openTime > value ? candle.openTime : value,
      null,
    );
    const earliest = filteredBatch.reduce<Date | null>(
      (value, candle) => !value || candle.openTime < value ? candle.openTime : value,
      null,
    );

    for (const candle of filteredBatch) {
      // A provider page boundary can repeat its last candle. The later copy
      // is equivalent data, so retain one normalized candle per open time.
      collected.set(candle.openTime.getTime(), candle);
    }
    if (request.onBatch && filteredBatch.length) await request.onBatch(filteredBatch);

     if (!batch.length) {
       const emptyPageAdvanceSeconds = request.adapter.historicalEmptyPageAdvanceSeconds;
       if (!emptyPageAdvanceSeconds || !fromCursor) break;
       const nextCursor = new Date(fromCursor.getTime() + emptyPageAdvanceSeconds * 1_000);
       if (nextCursor <= fromCursor || (request.to && nextCursor > request.to)) break;
       fromCursor = nextCursor;
       continue;
     }
     if (!latest) break;
    if (!earliest) break;

    if (direction == null) {
      const firstOpenTime = batch[0]?.openTime.getTime();
      const lastOpenTime = batch.at(-1)?.openTime.getTime();
      if (firstOpenTime != null && lastOpenTime != null && firstOpenTime < lastOpenTime) {
        direction = "forward";
      } else if (firstOpenTime != null && lastOpenTime != null && firstOpenTime > lastOpenTime) {
        direction = "backward";
      }
    }

    if (direction == null) {
      const durationMs = request.timeframeDurationSeconds * 1_000;
      const providerStartedAtRequestedBoundary = !request.from
        || earliest.getTime() <= request.from.getTime() + durationMs * 2;
      direction = providerStartedAtRequestedBoundary ? "forward" : "backward";
    }

    if (direction === "forward") {
      if (request.to && latest >= request.to) break;
      const nextCursor = new Date(latest.getTime() + request.timeframeDurationSeconds * 1_000);
      if (fromCursor && nextCursor <= fromCursor) break;
      fromCursor = nextCursor;
    } else {
      if (request.from && earliest <= request.from) break;
      const nextCursor = new Date(earliest.getTime() - request.timeframeDurationSeconds * 1_000);
      if (toCursor && nextCursor >= toCursor) break;
      toCursor = nextCursor;
    }
  }

  return [...collected.values()].sort((left, right) => left.openTime.getTime() - right.openTime.getTime());
}

export function historicalCandleCoverage(
  candles: NormalizedCandle[],
  request: Pick<HistoricalCandleCollectionRequest, "from" | "to" | "timeframeCode" | "timeframeDurationSeconds">,
): HistoricalCandleCoverage {
  const ordered = [...candles].sort((left, right) => left.openTime.getTime() - right.openTime.getTime());
  const earliestCandle = ordered[0]?.openTime;
  const latestCandle = ordered.at(-1)?.openTime;
  if (!earliestCandle || !latestCandle) {
    throw new Error(`Historical data for ${request.timeframeCode} contains no candles in the requested period.`);
  }

  if (request.from && request.to) {
    const boundaryTolerance = coverageToleranceMs(request.timeframeDurationSeconds);
    const startsTooLate = earliestCandle.getTime() - request.from.getTime() > boundaryTolerance;
    const endsTooEarly = request.to.getTime() - latestCandle.getTime() > boundaryTolerance;
    if (startsTooLate || endsTooEarly) {
      throw new Error(
        `Historical data for ${request.timeframeCode} only covers ${earliestCandle.toISOString()} to ${latestCandle.toISOString()}; `
        + `the requested backtest range is ${request.from.toISOString()} to ${request.to.toISOString()}.`,
      );
    }
  }

  return {
    candlesProcessed: ordered.length,
    earliestCandle,
    latestCandle,
  };
}

/**
 * The sole boundary between future provider adapters and canonical market data.
 * Step 5 deliberately registers no concrete adapter and ingests no default data.
 */
export class MarketDataService {
  private readonly adapters = new Map<string, MarketDataProviderAdapter>();

  register(adapter: MarketDataProviderAdapter) {
    if (this.adapters.has(adapter.key)) throw new Error(`Market-data adapter '${adapter.key}' is already registered`);
    this.adapters.set(adapter.key, adapter);
  }

  adapter(key: string) {
    return this.adapters.get(key) ?? null;
  }

  registeredProviderKeys() {
    return [...this.adapters.keys()];
  }

  async historicalSourceForInstrument(instrumentId: number) {
    const candidates = await db.select({ source: marketDataSourcesTable })
      .from(marketDataSourcesTable)
      .innerJoin(sourceInstrumentMappingsTable, and(
        eq(sourceInstrumentMappingsTable.sourceId, marketDataSourcesTable.id),
        eq(sourceInstrumentMappingsTable.instrumentId, instrumentId),
      ))
      .where(eq(marketDataSourcesTable.isEnabled, true));

    const source = candidates
      .map(candidate => candidate.source)
      .filter(candidate =>
        candidate.providerKey
        && candidate.capabilities.includes("historical")
        && this.adapter(candidate.providerKey)?.capabilities.includes("historical"),
      )
      .sort((left, right) => {
        const leftIsHistorical = left.sourceType === "historical" ? 1 : 0;
        const rightIsHistorical = right.sourceType === "historical" ? 1 : 0;
        return rightIsHistorical - leftIsHistorical || left.id - right.id;
      })[0];

    if (!source) {
      throw new Error("No enabled historical market-data source is configured for this instrument.");
    }
    return source;
  }

  async connectSource(sourceId: number) {
    const { adapter } = await this.resolveSourceAdapter(sourceId);
    await this.recordConnection(sourceId, "connecting", "Provider adapter is connecting.");
    try {
      await adapter.connect();
      const state = await adapter.connectionState();
      return await this.recordConnection(sourceId, state.state, state.message ?? null);
    } catch (error) {
      await this.recordConnection(sourceId, "error", error instanceof Error ? error.message : "Provider connection failed.");
      throw error;
    }
  }

  async disconnectSource(sourceId: number) {
    const { adapter } = await this.resolveSourceAdapter(sourceId);
    await adapter.disconnect();
    return this.recordConnection(sourceId, "disconnected", "Provider adapter is disconnected.");
  }

  async refreshCandles(request: CanonicalCandleRequest) {
    const [{ adapter }, [mapping], [timeframe]] = await Promise.all([
      this.resolveSourceAdapter(request.sourceId),
      db.select().from(sourceInstrumentMappingsTable).where(and(
        eq(sourceInstrumentMappingsTable.sourceId, request.sourceId),
        eq(sourceInstrumentMappingsTable.instrumentId, request.instrumentId),
      )),
      db.select().from(timeframesTable).where(eq(timeframesTable.id, request.timeframeId)),
    ]);
    if (!mapping) throw new Error("No provider-symbol mapping exists for this source and instrument");
    if (!timeframe) throw new Error("Timeframe not found");

    const candles = await adapter.candles({
      providerSymbol: mapping.providerSymbol,
      timeframeCode: timeframe.code,
      from: request.from,
      to: request.to,
      limit: request.limit,
    });
    await this.ingestCandles({ ...request, candles });
    return candles.length;
  }

  async historicalCandles(request: CanonicalCandleRequest) {
    const [{ adapter }, [mapping], [timeframe]] = await Promise.all([
      this.resolveSourceAdapter(request.sourceId),
      db.select().from(sourceInstrumentMappingsTable).where(and(
        eq(sourceInstrumentMappingsTable.sourceId, request.sourceId),
        eq(sourceInstrumentMappingsTable.instrumentId, request.instrumentId),
      )),
      db.select().from(timeframesTable).where(eq(timeframesTable.id, request.timeframeId)),
    ]);
    if (!mapping) throw new Error("No provider-symbol mapping exists for this source and instrument");
    if (!timeframe) throw new Error("Timeframe not found");
    if (!adapter.capabilities.includes("historical")) {
      throw new Error("The selected market-data provider does not support historical candles");
    }

    const collect = (from?: Date, to?: Date) => collectHistoricalCandles({
      adapter,
      providerSymbol: mapping.providerSymbol,
      timeframeCode: timeframe.code,
      timeframeDurationSeconds: timeframe.durationSeconds,
      from,
      to,
      limit: request.limit,
      onBatch: async candles => {
        await this.ingestCandles({
          sourceId: request.sourceId,
          instrumentId: request.instrumentId,
          timeframeId: request.timeframeId,
          candles,
        });
      },
    });

    try {
      if (!request.from || !request.to) {
        const fetched = await collect(request.from, request.to);
        await this.recordConnection(request.sourceId, "connected", "Historical data is available.");
        return fetched;
      }

      const cached = await this.cachedCandles(request);
      const missingRanges = missingHistoricalRanges(cached, {
        from: request.from,
        to: request.to,
        timeframeDurationSeconds: timeframe.durationSeconds,
      });

      // The ranges are deliberately fetched in order. The Dukascopy adapter also
      // serializes its HTTP queue, but keeping this boundary sequential prevents
      // future historical adapters from being fan-out called by a backtest.
      for (const range of missingRanges) {
        await collect(range.from, range.to);
      }

      const refreshed = (await this.cachedCandles(request)).filter(candle => candle.isClosed);
      historicalCandleCoverage(refreshed, {
        from: request.from,
        to: request.to,
        timeframeCode: timeframe.code,
        timeframeDurationSeconds: timeframe.durationSeconds,
      });
      await this.recordConnection(request.sourceId, "connected", "Historical data is available.");
      return refreshed;
    } catch (error) {
      const historicalError = error instanceof HistoricalDataError
        ? error
        : new HistoricalDataError(
          "unavailable",
          error instanceof Error ? error.message : `Historical data for ${timeframe.code} is unavailable for the requested period.`,
          { cause: error },
        );
      await this.recordConnection(
        request.sourceId,
        "error",
        `Historical provider ${historicalError.code}: ${historicalError.message}`,
      );
      throw historicalError;
    }
  }

  async historicalDataAvailability(request: CanonicalCandleRequest & { from: Date; to: Date }): Promise<HistoricalDataAvailability> {
    const [[source], [timeframe], [summary], [connection]] = await Promise.all([
      db.select({ id: marketDataSourcesTable.id }).from(marketDataSourcesTable).where(eq(marketDataSourcesTable.id, request.sourceId)),
      db.select({ id: timeframesTable.id, code: timeframesTable.code, durationSeconds: timeframesTable.durationSeconds })
        .from(timeframesTable).where(eq(timeframesTable.id, request.timeframeId)),
      db.select({
        storedCount: count(candlesTable.id),
        earliestCandle: min(candlesTable.openTime),
        latestCandle: max(candlesTable.openTime),
      }).from(candlesTable).where(and(
        eq(candlesTable.sourceId, request.sourceId),
        eq(candlesTable.instrumentId, request.instrumentId),
        eq(candlesTable.timeframeId, request.timeframeId),
        gte(candlesTable.openTime, request.from),
        lte(candlesTable.openTime, request.to),
        eq(candlesTable.isClosed, true),
      )),
      db.select({
        status: marketDataConnectionsTable.status,
        statusMessage: marketDataConnectionsTable.statusMessage,
      }).from(marketDataConnectionsTable).where(eq(marketDataConnectionsTable.sourceId, request.sourceId)),
    ]);
    if (!source) throw new Error("Market-data source not found");
    if (!timeframe) throw new Error("Timeframe not found");
    const earliestCandle = summary?.earliestCandle ?? null;
    const latestCandle = summary?.latestCandle ?? null;
    const providerErrorMatch = connection?.status === "error"
      ? connection.statusMessage?.match(/^Historical provider (rate_limited|provider_failure|unavailable|unknown): (.*)$/i)
      : null;
    return {
      sourceId: source.id,
      instrumentId: request.instrumentId,
      timeframeId: timeframe.id,
      timeframeCode: timeframe.code,
      requestedFrom: request.from,
      requestedTo: request.to,
      storedCount: Number(summary?.storedCount ?? 0),
      earliestCandle,
      latestCandle,
      coverageState: !earliestCandle || !latestCandle
        ? "unavailable"
        : isCoveredByBoundaries(earliestCandle, latestCandle, {
          from: request.from,
          to: request.to,
          timeframeDurationSeconds: timeframe.durationSeconds,
        }) ? "complete" : "partial",
      providerStatus: connection?.status ?? null,
      providerError: providerErrorMatch ? {
        code: providerErrorMatch[1].toLowerCase() as HistoricalDataError["code"],
        message: providerErrorMatch[2],
      } : connection?.status === "error" ? {
        code: "unknown",
        message: connection.statusMessage ?? "Historical provider failed.",
      } : null,
    };
  }

  async *streamQuotes(request: CanonicalQuoteRequest): AsyncIterable<CanonicalQuote> {
    const [{ adapter }, [mapping]] = await Promise.all([
      this.resolveSourceAdapter(request.sourceId),
      db.select().from(sourceInstrumentMappingsTable).where(and(
        eq(sourceInstrumentMappingsTable.sourceId, request.sourceId),
        eq(sourceInstrumentMappingsTable.instrumentId, request.instrumentId),
      )),
    ]);
    if (!mapping) throw new Error("No provider-symbol mapping exists for this source and instrument");
    if (!adapter.capabilities.includes("realtime") || !adapter.subscribeQuotes) {
      throw new Error("Provider adapter does not support real-time quote subscriptions");
    }

    await adapter.connect();
    const connection = await adapter.connectionState();
    await this.recordConnection(request.sourceId, connection.state, connection.message ?? null);

    for await (const quote of adapter.subscribeQuotes({ providerSymbol: mapping.providerSymbol, signal: request.signal })) {
      validateQuote(quote);
      await this.recordDataReceipt(request.sourceId, quote.receivedAt);
      yield {
        ...quote,
        sourceId: request.sourceId,
        instrumentId: request.instrumentId,
      };
    }
  }

  async ingestCandles(batch: CandleBatch) {
    batch.candles.forEach(validateCandle);
    if (!batch.candles.length) return 0;

    const [[source], [instrument], [timeframe]] = await Promise.all([
      db.select({ id: marketDataSourcesTable.id }).from(marketDataSourcesTable).where(eq(marketDataSourcesTable.id, batch.sourceId)),
      db.select({ id: marketsTable.id }).from(marketsTable).where(eq(marketsTable.id, batch.instrumentId)),
      db.select({ id: timeframesTable.id }).from(timeframesTable).where(eq(timeframesTable.id, batch.timeframeId)),
    ]);
    if (!source || !instrument || !timeframe) throw new Error("Candle batch references an unknown source, instrument, or timeframe");

    const latestReceivedAt = new Date(Math.max(...batch.candles.map(candle => candle.receivedAt.getTime())));
    await db.transaction(async tx => {
      for (let offset = 0; offset < batch.candles.length; offset += CANDLE_WRITE_BATCH_SIZE) {
        const candles = batch.candles.slice(offset, offset + CANDLE_WRITE_BATCH_SIZE);
        await tx.insert(candlesTable).values(candles.map(candle => ({
          sourceId: batch.sourceId,
          instrumentId: batch.instrumentId,
          timeframeId: batch.timeframeId,
          openTime: candle.openTime,
          closeTime: candle.closeTime,
          open: candle.open.toString(),
          high: candle.high.toString(),
          low: candle.low.toString(),
          close: candle.close.toString(),
          volume: candle.volume?.toString() ?? null,
          isClosed: candle.isClosed,
          receivedAt: candle.receivedAt,
        }))).onConflictDoUpdate({
          target: [candlesTable.instrumentId, candlesTable.sourceId, candlesTable.timeframeId, candlesTable.openTime],
          set: {
            closeTime: sql`excluded.close_time`,
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            volume: sql`excluded.volume`,
            isClosed: sql`excluded.is_closed`,
            receivedAt: sql`excluded.received_at`,
          },
        });
      }
      await tx.update(marketDataConnectionsTable).set({
        checkedAt: new Date(),
        lastDataAt: latestReceivedAt,
      }).where(eq(marketDataConnectionsTable.sourceId, batch.sourceId));
    });
    return batch.candles.length;
  }

  private async cachedCandles(request: CanonicalCandleRequest) {
    const filters = [
      eq(candlesTable.sourceId, request.sourceId),
      eq(candlesTable.instrumentId, request.instrumentId),
      eq(candlesTable.timeframeId, request.timeframeId),
    ];
    if (request.from) filters.push(gte(candlesTable.openTime, request.from));
    if (request.to) filters.push(lte(candlesTable.openTime, request.to));
    const query = db.select().from(candlesTable)
      .where(and(...filters))
      .orderBy(asc(candlesTable.openTime));
    const rows = request.limit == null
      ? await query
      : await query.limit(request.limit);
    return rows.map(candle => ({
      openTime: candle.openTime,
      closeTime: candle.closeTime,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: candle.volume == null ? null : Number(candle.volume),
      isClosed: candle.isClosed,
      receivedAt: candle.receivedAt,
    }));
  }

  private async resolveSourceAdapter(sourceId: number) {
    const [source] = await db.select().from(marketDataSourcesTable).where(eq(marketDataSourcesTable.id, sourceId));
    if (!source) throw new Error("Market-data source not found");
    if (!source.providerKey) throw new Error("Market-data source has no provider adapter key");
    const adapter = this.adapter(source.providerKey);
    if (!adapter) throw new Error(`No provider adapter is registered for '${source.providerKey}'`);
    return { source, adapter };
  }

  private async recordConnection(sourceId: number, status: MarketDataConnectionState, statusMessage: string | null) {
    const now = new Date();
    const [connection] = await db.insert(marketDataConnectionsTable).values({
      sourceId,
      status,
      statusMessage,
      checkedAt: now,
      lastConnectedAt: status === "connected" ? now : null,
    }).onConflictDoUpdate({
      target: marketDataConnectionsTable.sourceId,
      set: {
        status,
        statusMessage,
        checkedAt: now,
        ...(status === "connected" ? { lastConnectedAt: now } : {}),
      },
    }).returning();
    return connection;
  }

  private async recordDataReceipt(sourceId: number, receivedAt: Date) {
    await db.update(marketDataConnectionsTable).set({
      checkedAt: new Date(),
      lastDataAt: receivedAt,
    }).where(eq(marketDataConnectionsTable.sourceId, sourceId));
  }
}

export const marketDataService = new MarketDataService();