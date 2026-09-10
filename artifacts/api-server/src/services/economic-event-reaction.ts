import type { EconomicEvent, Instrument } from "@workspace/db";

export type ReactionState =
  | "waiting_for_actual"
  | "potentially_bullish"
  | "potentially_bearish"
  | "neutral_unclear"
  | "insufficient_data";

type ReactionDirection = "bullish" | "bearish" | "neutral";
type ScenarioCondition = "higher_than_forecast" | "lower_than_forecast" | "in_line";
type ReactionFamily = "inflation" | "monetary_policy" | "growth" | "employment" | "activity";

type ReactionRule = {
  ruleId: string;
  pattern: RegExp;
  family: ReactionFamily;
};

type MarketReactionScenario = {
  condition: ScenarioCondition;
  label: string;
  state: Exclude<ReactionState, "waiting_for_actual" | "insufficient_data">;
  reason: string;
};

export type EconomicEventMarketReaction = {
  instrumentId: number;
  instrumentSymbol: string;
  state: ReactionState;
  direction: ReactionDirection | null;
  summary: string;
  reason: string;
  ruleId: string | null;
  scenarios: MarketReactionScenario[];
};

const REACTION_RULES: readonly ReactionRule[] = [
  {
    ruleId: "inflation-surprise",
    pattern: /\b(?:consumer price index|core consumer price index|cpi|core cpi|inflation rate|inflation release|personal consumption expenditures|core pce|pce)\b/i,
    family: "inflation",
  },
  {
    ruleId: "monetary-policy-surprise",
    pattern: /\b(?:fomc|federal open market committee|interest rate decision|interest rates? decision|rate decision|monetary policy decision|monetary policy meeting|monetary policy statement|governing council.*monetary policy|bank of england.*monetary policy|boe.*monetary policy)\b/i,
    family: "monetary_policy",
  },
  {
    ruleId: "growth-surprise",
    pattern: /\b(?:gross domestic product|gdp)\b/i,
    family: "growth",
  },
  {
    ruleId: "employment-surprise",
    pattern: /\b(?:non[-\s]?farm payrolls?|nfp|employment situation|jobs report|unemployment rate)\b/i,
    family: "employment",
  },
  {
    ruleId: "activity-surprise",
    pattern: /\b(?:retail sales|manufacturing pmi|services pmi|composite pmi|pmi|industrial production|durable goods|housing starts|existing home sales|new home sales|building permits|house price index|consumer confidence|producer price index|ppi|trade balance|trade report|uk trade)\b/i,
    family: "activity",
  },
];

function reactionRule(name: string) {
  const normalized = name.trim().replace(/\s+/g, " ");
  return REACTION_RULES.find(rule => rule.pattern.test(normalized)) ?? null;
}

function parseNumericValue(value: string | null) {
  if (!value?.trim()) return null;
  const match = value.replace(/,/g, "").match(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareActualToForecast(actual: string | null, forecast: string | null) {
  const actualNumber = parseNumericValue(actual);
  const forecastNumber = parseNumericValue(forecast);
  if (actualNumber === null || forecastNumber === null) return null;
  const tolerance = Math.max(Math.abs(forecastNumber) * 0.005, 0.01);
  if (Math.abs(actualNumber - forecastNumber) <= tolerance) return "in_line" as const;
  return actualNumber > forecastNumber ? "higher_than_forecast" as const : "lower_than_forecast" as const;
}

function instrumentKind(instrument: Pick<Instrument, "symbol" | "displayName" | "description" | "assetClass" | "instrumentType" | "venue" | "baseCurrency" | "quoteCurrency">) {
  const raw = [
    instrument.symbol,
    instrument.displayName,
    instrument.description,
    instrument.assetClass,
    instrument.instrumentType,
    instrument.venue,
  ].filter(Boolean).join(" ").toUpperCase();
  const isGold = raw.includes("XAU") || raw.includes("GOLD");
  const isUsIndex = instrument.assetClass.toLowerCase() === "index"
    && /\b(?:US|USA|UNITED STATES|SPX|SP500|S&P|NASDAQ|NAS100|NDX|DOW|DJI|US30|US500|RUSSELL|VIX|USTEC)\b/.test(raw);
  const isForex = instrument.instrumentType.toLowerCase() === "forex"
    || Boolean(instrument.baseCurrency && instrument.quoteCurrency);
  return { raw, isGold, isUsIndex, isForex };
}

function eventCurrency(event: Pick<EconomicEvent, "currency" | "region">) {
  return event.currency?.trim().toUpperCase() ?? null;
}

function eventIsUnitedStates(event: Pick<EconomicEvent, "currency" | "region">) {
  return eventCurrency(event) === "USD" || /\b(?:united states|usa|us)\b/i.test(event.region ?? "");
}

function higherDirection(
  event: Pick<EconomicEvent, "currency" | "region">,
  instrument: Pick<Instrument, "symbol" | "displayName" | "description" | "assetClass" | "instrumentType" | "venue" | "baseCurrency" | "quoteCurrency">,
  family: ReactionFamily,
): ReactionDirection | null {
  const kind = instrumentKind(instrument);
  const currency = eventCurrency(event);

  if (kind.isGold && eventIsUnitedStates(event) && (family === "inflation" || family === "monetary_policy")) return "bearish";
  if (kind.isUsIndex && eventIsUnitedStates(event)) {
    if (family === "inflation" || family === "monetary_policy") return "bearish";
    if (family === "growth" || family === "employment") return "bullish";
  }
  if (kind.isForex && currency) {
    const base = instrument.baseCurrency?.toUpperCase();
    const quote = instrument.quoteCurrency?.toUpperCase();
    if (currency === base) return "bullish";
    if (currency === quote) return "bearish";
  }
  return null;
}

function invertDirection(direction: ReactionDirection): ReactionDirection {
  if (direction === "bullish") return "bearish";
  if (direction === "bearish") return "bullish";
  return "neutral";
}

function directionState(direction: ReactionDirection): Exclude<ReactionState, "waiting_for_actual" | "insufficient_data"> {
  if (direction === "bullish") return "potentially_bullish";
  if (direction === "bearish") return "potentially_bearish";
  return "neutral_unclear";
}

function directionLabel(direction: ReactionDirection) {
  if (direction === "bullish") return "Potentially bullish";
  if (direction === "bearish") return "Potentially bearish";
  return "Neutral / Unclear";
}

function marketDescription(instrument: Pick<Instrument, "symbol" | "displayName">) {
  return instrument.displayName?.trim() || instrument.symbol;
}

function scenarioReason(
  direction: ReactionDirection,
  condition: ScenarioCondition,
  event: Pick<EconomicEvent, "name" | "currency" | "region">,
  instrument: Pick<Instrument, "symbol" | "displayName">,
) {
  const comparison = condition === "higher_than_forecast" ? "higher" : condition === "lower_than_forecast" ? "lower" : "approximately in line";
  if (condition === "in_line") {
    return `If actual ${event.name} is approximately in line with forecast, the potential reaction for ${instrument.symbol} is neutral or unclear.`;
  }
  return `If actual ${event.name} is ${comparison} than forecast, it could be ${directionLabel(direction).toLowerCase()} for ${marketDescription(instrument)}.`;
}

export function calculateMarketReaction(
  event: Pick<EconomicEvent, "name" | "currency" | "region" | "forecast" | "actual" | "releaseStatus">,
  instrument: Pick<Instrument, "id" | "symbol" | "displayName" | "description" | "assetClass" | "instrumentType" | "venue" | "baseCurrency" | "quoteCurrency">,
): EconomicEventMarketReaction | null {
  const rule = reactionRule(event.name);
  if (!rule) return null;
  const higher = higherDirection(event, instrument, rule.family);
  if (!higher) return null;

  const scenarios: MarketReactionScenario[] = [
    {
      condition: "higher_than_forecast",
      label: "Higher than forecast",
      state: directionState(higher),
      reason: scenarioReason(higher, "higher_than_forecast", event, instrument),
    },
    {
      condition: "lower_than_forecast",
      label: "Lower than forecast",
      state: directionState(invertDirection(higher)),
      reason: scenarioReason(invertDirection(higher), "lower_than_forecast", event, instrument),
    },
    {
      condition: "in_line",
      label: "In line with forecast",
      state: "neutral_unclear",
      reason: scenarioReason("neutral", "in_line", event, instrument),
    },
  ];

  const comparison = compareActualToForecast(event.actual, event.forecast);
  if (comparison) {
    const direction = comparison === "higher_than_forecast" ? higher
      : comparison === "lower_than_forecast" ? invertDirection(higher)
        : "neutral";
    const comparisonText = comparison === "higher_than_forecast" ? "higher"
      : comparison === "lower_than_forecast" ? "lower"
        : "approximately in line";
    return {
      instrumentId: instrument.id,
      instrumentSymbol: instrument.symbol,
      state: directionState(direction),
      direction,
      summary: directionLabel(direction),
      reason: `Actual ${event.name} was ${comparisonText} than forecast. This could potentially affect ${instrument.symbol} in that direction; it is not a guaranteed prediction.`,
      ruleId: rule.ruleId,
      scenarios,
    };
  }

  if (event.actual) {
    return {
      instrumentId: instrument.id,
      instrumentSymbol: instrument.symbol,
      state: "insufficient_data",
      direction: null,
      summary: "Insufficient data",
      reason: "Insufficient data to determine potential reaction because actual and forecast could not be compared reliably.",
      ruleId: rule.ruleId,
      scenarios: [],
    };
  }

  if (!event.forecast) {
    return {
      instrumentId: instrument.id,
      instrumentSymbol: instrument.symbol,
      state: "insufficient_data",
      direction: null,
      summary: "Insufficient data",
      reason: "Insufficient data to determine potential reaction because no forecast is available.",
      ruleId: rule.ruleId,
      scenarios: [],
    };
  }

  return {
    instrumentId: instrument.id,
    instrumentSymbol: instrument.symbol,
    state: "waiting_for_actual",
    direction: null,
    summary: "Waiting for actual",
    reason: `Waiting for actual ${event.name} data before comparing it with forecast. These are conditional scenarios, not a prediction.`,
    ruleId: rule.ruleId,
    scenarios,
  };
}