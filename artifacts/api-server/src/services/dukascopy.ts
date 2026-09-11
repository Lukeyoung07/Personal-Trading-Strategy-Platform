import { and, eq } from "drizzle-orm";
import {
  db,
  marketDataSourcesTable,
  marketsTable,
  sourceInstrumentMappingsTable,
  timeframesTable,
} from "@workspace/db";
import type {
  MarketDataConnectionState,
  MarketDataProviderAdapter,
  NormalizedCandle,
  ProviderCandleRequest,
} from "./market-data";
import { HistoricalDataError } from "./historical-errors";

export const DUKASCOPY_KEY = "dukascopy";
export const DUKASCOPY_BASE_URL = "https://jetta.dukascopy.com/v1";

export const DUKASCOPY_INSTRUMENT_MAPPINGS = {
  XAUUSD: {
    providerSymbol: "XAU-USD",
    displayName: "Gold vs US Dollar",
    assetClass: "Commodity",
    instrumentType: "commodity",
    quoteCurrency: "USD",
    tickSize: "0.01",
    contractMultiplier: "1",
  },
  USTEC: {
    providerSymbol: "USATECH.IDX-USD",
    displayName: "US 100 Tech Index",
    assetClass: "Index",
    instrumentType: "index",
    quoteCurrency: "USD",
    tickSize: "0.01",
    contractMultiplier: "1",
  },
} as const;

const DUKASCOPY_TIMEFRAMES = [
  { code: "5m", label: "5 minutes", durationSeconds: 300 },
  { code: "1h", label: "1 hour", durationSeconds: 3_600 },
] as const;
const DUKASCOPY_MIN_REQUEST_INTERVAL_MS = 1_000;
const DUKASCOPY_MAX_ATTEMPTS = 5;

type DukascopyHistoryPayload = {
  timestamp?: unknown;
  shift?: unknown;
  multiplier?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  times?: unknown;
  opens?: unknown;
  highs?: unknown;
  lows?: unknown;
  closes?: unknown;
  volumes?: unknown;
};

type DecodedDukascopyCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function priceScale(multiplier: number) {
  const exponent = Math.floor(Math.log10(multiplier));
  return exponent > 0 ? multiplier : 10 ** Math.abs(exponent);
}

function applyDelta(previous: number, delta: unknown, multiplier: number, scale: number) {
  const value = finiteNumber(delta);
  if (value == null) throw new Error("Dukascopy returned a non-numeric candle value.");
  return Math.round((previous + value * multiplier) * scale) / scale;
}

export function parseDukascopyHistory(payload: DukascopyHistoryPayload, from?: Date, to?: Date) {
  const times = Array.isArray(payload.times) ? payload.times : [];
  const opens = Array.isArray(payload.opens) ? payload.opens : [];
  const highs = Array.isArray(payload.highs) ? payload.highs : [];
  const lows = Array.isArray(payload.lows) ? payload.lows : [];
  const closes = Array.isArray(payload.closes) ? payload.closes : [];
  const volumes = Array.isArray(payload.volumes) ? payload.volumes : [];

  if (![opens, highs, lows, closes, volumes].every(values => values.length === times.length)) {
    throw new Error("Dukascopy returned inconsistent candle arrays.");
  }
  if (!times.length) return [];

  const timestamp = finiteNumber(payload.timestamp);
  const shift = finiteNumber(payload.shift);
  const multiplier = finiteNumber(payload.multiplier);
  if (timestamp == null || shift == null || shift <= 0 || multiplier == null || multiplier <= 0) {
    throw new Error("Dukascopy returned an invalid candle payload.");
  }

  const scale = priceScale(multiplier);
  let time = timestamp;
  let open = finiteNumber(payload.open) ?? 0;
  let high = finiteNumber(payload.high) ?? 0;
  let low = finiteNumber(payload.low) ?? 0;
  let close = finiteNumber(payload.close) ?? 0;
  const fromTime = from?.getTime() ?? Number.NEGATIVE_INFINITY;
  const toTime = to?.getTime() ?? Number.POSITIVE_INFINITY;
  const candles: DecodedDukascopyCandle[] = [];

  for (let index = 0; index < times.length; index += 1) {
    const timeDelta = finiteNumber(times[index]);
    if (timeDelta == null) throw new Error("Dukascopy returned a non-numeric candle timestamp.");
    time += timeDelta * shift;
    open = applyDelta(open, opens[index], multiplier, scale);
    high = applyDelta(high, highs[index], multiplier, scale);
    low = applyDelta(low, lows[index], multiplier, scale);
    close = applyDelta(close, closes[index], multiplier, scale);

    // Empty market intervals are represented by zero-valued records.
    // They are not candles and must not reach the backtest engine.
    if (time < fromTime || time > toTime || [open, high, low, close].some(value => value <= 0)) continue;

    const volume = finiteNumber(volumes[index]);
    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume: volume == null ? null : Math.round(volume * 1_000_000),
    });
  }

  return candles;
}

export function aggregateDukascopyMinuteCandles(
  candles: DecodedDukascopyCandle[],
  from?: Date,
  to?: Date,
): DecodedDukascopyCandle[] {
  const buckets = new Map<number, DecodedDukascopyCandle>();
  const fromTime = from?.getTime() ?? Number.NEGATIVE_INFINITY;
  const toTime = to?.getTime() ?? Number.POSITIVE_INFINITY;

  for (const candle of candles) {
    const bucketTime = Math.floor(candle.time / (5 * 60_000)) * (5 * 60_000);
    if (bucketTime < fromTime || bucketTime > toTime) continue;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, { ...candle, time: bucketTime });
      continue;
    }
    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    if (existing.volume != null && candle.volume != null) existing.volume += candle.volume;
    else existing.volume = null;
  }

  return [...buckets.values()].sort((left, right) => left.time - right.time);
}

function normalizeTimeframe(timeframeCode: string) {
  const code = timeframeCode.trim().toLowerCase();
  if (code !== "5m" && code !== "1h") {
    throw new Error("Dukascopy supports only verified 5m and 1h historical candles.");
  }
  return code;
}

function verifiedProviderSymbol(providerSymbol: string) {
  if (Object.values(DUKASCOPY_INSTRUMENT_MAPPINGS).some(mapping => mapping.providerSymbol === providerSymbol)) {
    return providerSymbol;
  }
  throw new Error(`Dukascopy has no verified instrument mapping for '${providerSymbol}'.`);
}

function pathDate(date: Date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function toNormalizedCandle(candle: DecodedDukascopyCandle, durationSeconds: number, receivedAt: Date): NormalizedCandle {
  const openTime = new Date(candle.time);
  return {
    openTime,
    closeTime: new Date(candle.time + durationSeconds * 1_000),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    isClosed: true,
    receivedAt,
  };
}

class DukascopyAdapter implements MarketDataProviderAdapter {
  readonly key = DUKASCOPY_KEY;
  readonly capabilities = ["candles", "historical"] as const;
  readonly historicalEmptyPageAdvanceSeconds = 86_400;

  private state: MarketDataConnectionState = "disconnected";
  private statusMessage = "Dukascopy historical connection is disconnected.";
  private requestChain = Promise.resolve();
  private lastRequestAt = 0;

  async connect() {
    this.state = "connected";
    this.statusMessage = "Dukascopy historical data is available.";
  }

  async disconnect() {
    this.state = "disconnected";
    this.statusMessage = "Dukascopy historical connection is disconnected.";
  }

  async connectionState() {
    return { state: this.state, message: this.statusMessage };
  }

  async candles(request: ProviderCandleRequest) {
    const timeframe = normalizeTimeframe(request.timeframeCode);
    const providerSymbol = verifiedProviderSymbol(request.providerSymbol);
    const targetDate = request.from ?? request.to ?? new Date();
    const { year, month, day } = pathDate(targetDate);
    const offerSide = "BID";
    const path = timeframe === "1h"
      ? `/candles/trade/hour/${providerSymbol}/${offerSide}/${year}/${month}`
      : `/candles/minute/${providerSymbol}/${offerSide}/${year}/${month}/${day}`;
    const payload = await this.requestJson(path);
    const receivedAt = new Date();
    const decoded = parseDukascopyHistory(payload, request.from, request.to);

    if (timeframe === "5m") {
      return aggregateDukascopyMinuteCandles(decoded, request.from, request.to)
        .map(candle => toNormalizedCandle(candle, 300, receivedAt));
    }
    return decoded
      .sort((left, right) => left.time - right.time)
      .map(candle => toNormalizedCandle(candle, 3_600, receivedAt));
  }

  private async requestJson(path: string): Promise<DukascopyHistoryPayload> {
    const request = this.requestChain.then(async () => {
      const waitMs = Math.max(0, DUKASCOPY_MIN_REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt));
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));

      for (let attempt = 0; attempt < DUKASCOPY_MAX_ATTEMPTS; attempt += 1) {
        let response: Response;
        let body = "";
        try {
          response = await fetch(`${DUKASCOPY_BASE_URL}${path}`, {
            headers: { accept: "application/json" },
          });
          this.lastRequestAt = Date.now();
          body = await response.text();
        } catch (error) {
          if (attempt === DUKASCOPY_MAX_ATTEMPTS - 1) {
            throw new HistoricalDataError(
              "provider_failure",
              "Dukascopy could not be reached after retrying the historical request.",
              { cause: error },
            );
          }
          await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
          continue;
        }
        if (response.ok) {
          try {
            return JSON.parse(body) as DukascopyHistoryPayload;
          } catch {
            throw new HistoricalDataError("provider_failure", "Dukascopy returned invalid JSON.");
          }
        }
        if (response.status === 429) {
          if (attempt === DUKASCOPY_MAX_ATTEMPTS - 1) {
            throw new HistoricalDataError(
              "rate_limited",
              "Dukascopy rate-limited the historical request after retries.",
            );
          }
        } else if (response.status >= 500) {
          if (attempt === DUKASCOPY_MAX_ATTEMPTS - 1) {
            throw new HistoricalDataError(
              "provider_failure",
              `Dukascopy failed the historical request (${response.status}) after retries.`,
            );
          }
        } else {
          throw new HistoricalDataError(
            "unavailable",
            `Dukascopy has no historical data for this request (${response.status}).`,
          );
        }
        const retryAfter = Number(response.headers.get("retry-after"));
        const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.max(DUKASCOPY_MIN_REQUEST_INTERVAL_MS, retryAfter * 1_000)
          : 2_000 * 2 ** attempt;
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
      throw new HistoricalDataError("provider_failure", "Dukascopy request retry limit reached.");
    });
    this.requestChain = request.then(() => undefined, () => undefined);
    return request;
  }
}

export const dukascopyAdapter = new DukascopyAdapter();

async function ensureDukascopyMapping(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  sourceId: number,
  instrument: typeof DUKASCOPY_INSTRUMENT_MAPPINGS[keyof typeof DUKASCOPY_INSTRUMENT_MAPPINGS],
  symbol: string,
) {
  const [existingMarket] = await tx.select().from(marketsTable).where(eq(marketsTable.symbol, symbol));
  const [market] = existingMarket
    ? [existingMarket]
    : await tx.insert(marketsTable).values({
      assetClass: instrument.assetClass,
      instrumentType: instrument.instrumentType,
      venue: "Dukascopy",
      symbol,
      displayName: instrument.displayName,
      quoteCurrency: instrument.quoteCurrency,
      tickSize: instrument.tickSize,
      contractMultiplier: instrument.contractMultiplier,
      isActive: true,
      description: instrument.displayName,
    }).returning();
  if (!market) throw new Error(`Unable to create the Dukascopy instrument '${symbol}'.`);

  const [existingMapping] = await tx.select().from(sourceInstrumentMappingsTable).where(and(
    eq(sourceInstrumentMappingsTable.sourceId, sourceId),
    eq(sourceInstrumentMappingsTable.instrumentId, market.id),
  ));
  const providerMetadata = JSON.stringify({
    name: instrument.displayName,
    source: "https://jetta.dukascopy.com/v1/instruments",
    verifiedTimeframes: ["5m", "1h"],
  });

  if (existingMapping) {
    await tx.update(sourceInstrumentMappingsTable)
      .set({ providerSymbol: instrument.providerSymbol, providerMetadata })
      .where(eq(sourceInstrumentMappingsTable.id, existingMapping.id));
  } else {
    await tx.insert(sourceInstrumentMappingsTable).values({
      sourceId,
      instrumentId: market.id,
      providerSymbol: instrument.providerSymbol,
      providerMetadata,
    });
  }
}

export async function ensureDukascopyCatalog() {
  const [source] = await db.select().from(marketDataSourcesTable).where(eq(marketDataSourcesTable.providerKey, DUKASCOPY_KEY));
  const [resolvedSource] = source
    ? [source]
    : await db.insert(marketDataSourcesTable).values({
      name: "Dukascopy",
      providerKey: DUKASCOPY_KEY,
      sourceType: "historical",
      description: "Free Dukascopy historical candles for verified XAUUSD and USTEC mappings.",
      capabilities: [...dukascopyAdapter.capabilities],
      configurationStatus: "configured",
      isEnabled: true,
    }).returning();
  if (!resolvedSource) throw new Error("Unable to configure the Dukascopy market-data source.");

  await Promise.all(DUKASCOPY_TIMEFRAMES.map(timeframe =>
    db.insert(timeframesTable).values(timeframe).onConflictDoNothing({ target: timeframesTable.code }),
  ));

  await db.transaction(async tx => {
    await ensureDukascopyMapping(tx, resolvedSource.id, DUKASCOPY_INSTRUMENT_MAPPINGS.XAUUSD, "XAUUSD");
    await ensureDukascopyMapping(tx, resolvedSource.id, DUKASCOPY_INSTRUMENT_MAPPINGS.USTEC, "USTEC");
  });

  return resolvedSource;
}