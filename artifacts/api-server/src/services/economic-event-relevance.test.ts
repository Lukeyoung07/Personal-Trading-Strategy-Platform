import { describe, expect, it } from "vitest";
import { isEconomicEventRelevantToInstrument } from "./economic-events";

const event = (overrides: Record<string, unknown> = {}) => ({
  currency: null,
  region: null,
  affectedMarkets: [],
  ...overrides,
});

const instrument = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  symbol: "EURUSD",
  displayName: "Euro / US Dollar",
  description: null,
  assetClass: "Forex",
  instrumentType: "forex",
  venue: "FOREX",
  baseCurrency: "EUR",
  quoteCurrency: "USD",
  ...overrides,
});

describe("economic event relevance", () => {
  it("matches XAUUSD through USD and Gold mappings", () => {
    const xauusd = instrument({
      id: 10,
      symbol: "XAUUSD",
      displayName: "Gold / US Dollar",
      assetClass: "Commodity",
      instrumentType: "commodity",
      baseCurrency: "XAU",
      quoteCurrency: "USD",
    });

    expect(isEconomicEventRelevantToInstrument(event({ currency: "USD" }), xauusd)).toBe(true);
    expect(isEconomicEventRelevantToInstrument(event({ affectedMarkets: [{ marketLabel: "Gold", marketId: null }] }), xauusd)).toBe(true);
    expect(isEconomicEventRelevantToInstrument(event({ currency: "GBP" }), xauusd)).toBe(false);
  });

  it("matches EURUSD and GBPUSD through either currency", () => {
    const eurusd = instrument();
    const gbpusd = instrument({
      id: 11,
      symbol: "GBPUSD",
      displayName: "British Pound / US Dollar",
      baseCurrency: "GBP",
      quoteCurrency: "USD",
    });

    expect(isEconomicEventRelevantToInstrument(event({ currency: "EUR" }), eurusd)).toBe(true);
    expect(isEconomicEventRelevantToInstrument(event({ currency: "USD" }), eurusd)).toBe(true);
    expect(isEconomicEventRelevantToInstrument(event({ currency: "GBP" }), eurusd)).toBe(false);
    expect(isEconomicEventRelevantToInstrument(event({ currency: "GBP" }), gbpusd)).toBe(true);
    expect(isEconomicEventRelevantToInstrument(event({ region: "United Kingdom" }), gbpusd)).toBe(true);
  });

  it("matches a US index through US index labels and rejects unrelated GBP events", () => {
    const usIndex = instrument({
      id: 12,
      symbol: "SPX",
      displayName: "S&P 500",
      assetClass: "Index",
      instrumentType: "index",
      venue: "United States",
      baseCurrency: null,
      quoteCurrency: "USD",
    });

    expect(isEconomicEventRelevantToInstrument(event({ currency: "USD" }), usIndex)).toBe(true);
    expect(isEconomicEventRelevantToInstrument(event({ affectedMarkets: [{ marketLabel: "US indices", marketId: null }] }), usIndex)).toBe(true);
    expect(isEconomicEventRelevantToInstrument(event({ currency: "GBP" }), usIndex)).toBe(false);
  });

  it("matches explicit instrument mappings without broadening all events", () => {
    const eurusd = instrument({ id: 42 });
    expect(isEconomicEventRelevantToInstrument(event({
      currency: null,
      affectedMarkets: [{ marketId: 42, marketLabel: "Custom instrument", }],
    }), eurusd)).toBe(true);
    expect(isEconomicEventRelevantToInstrument(event({
      currency: null,
      affectedMarkets: [{ marketId: 43, marketLabel: "Other instrument", }],
    }), eurusd)).toBe(false);
  });
});