import type { EconomicEventInput } from "@workspace/api-zod";

const PROVIDER_KEY = "tradingeconomics";
const PROVIDER_NAME = "Trading Economics";
const DEFAULT_BASE_URL = "https://api.tradingeconomics.com";
const REQUEST_TIMEOUT_MS = 15_000;

type TradingEconomicsRecord = Record<string, unknown>;

export type EconomicCalendarProvider = {
  key: string;
  name: string;
  isConfigured: () => boolean;
  fetchEvents: (from: Date, to: Date) => Promise<EconomicEventInput[]>;
};

function configuredKey() {
  return process.env.TRADING_ECONOMICS_API_KEY?.trim() || null;
}

function valueAsString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function classifyImpact(value: unknown): "high" | "medium" | "low" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "3" || normalized === "high") return "high";
  if (normalized === "2" || normalized === "medium" || normalized === "moderate") return "medium";
  if (normalized === "1" || normalized === "low") return "low";
  return null;
}

function normalizeRecord(record: TradingEconomicsRecord): EconomicEventInput | null {
  const name = valueAsString(record.Event);
  const scheduledAt = parseDate(record.Date);
  if (!name || !scheduledAt) return null;

  const actual = valueAsString(record.Actual);
  const providerEventId = valueAsString(record.CalendarId);
  const now = Date.now();
  const releaseStatus = actual !== null
    ? "released"
    : scheduledAt.getTime() >= now
      ? "upcoming"
      : "unknown";
  const providerMarket = valueAsString(record.Ticker) ?? valueAsString(record.Symbol);

  return {
    providerKey: PROVIDER_KEY,
    providerEventId,
    name,
    scheduledAt,
    impact: classifyImpact(record.Importance),
    region: valueAsString(record.Country),
    currency: valueAsString(record.Currency),
    previous: valueAsString(record.Previous),
    forecast: valueAsString(record.Forecast),
    actual,
    releaseStatus,
    sourceUpdatedAt: parseDate(record.LastUpdate),
    affectedMarkets: providerMarket ? [{
      marketLabel: providerMarket,
      notes: "Provider-supplied market reference",
    }] : [],
  };
}

async function fetchEvents(from: Date, to: Date) {
  const apiKey = configuredKey();
  if (!apiKey) {
    throw new Error(`Trading Economics requires the TRADING_ECONOMICS_API_KEY secret.`);
  }

  const baseUrl = (process.env.TRADING_ECONOMICS_API_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/calendar/country/All/${dateOnly(from)}/${dateOnly(to)}`);
  url.searchParams.set("c", apiKey);
  url.searchParams.set("f", "json");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`Trading Economics request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Trading Economics returned invalid JSON.");
  }
  if (!Array.isArray(payload)) {
    throw new Error("Trading Economics returned an unexpected calendar response.");
  }

  return payload
    .filter((record): record is TradingEconomicsRecord => Boolean(record && typeof record === "object" && !Array.isArray(record)))
    .map(normalizeRecord)
    .filter((record): record is EconomicEventInput => record !== null);
}

export const tradingEconomicsProvider: EconomicCalendarProvider = {
  key: PROVIDER_KEY,
  name: PROVIDER_NAME,
  isConfigured: () => configuredKey() !== null,
  fetchEvents,
};

export const tradingEconomics = {
  providerKey: PROVIDER_KEY,
  providerName: PROVIDER_NAME,
  isConfigured: () => configuredKey() !== null,
  fetchEvents,
};