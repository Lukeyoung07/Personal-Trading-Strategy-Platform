import type { ExecutableConceptParameters } from "./executable-concepts";

export type CanonicalConceptStatus = "executable" | "review_required";
export type CanonicalConceptDirection = "long" | "short" | "both";
export type CanonicalExecutorKind = ExecutableConceptParameters["kind"];

export type CanonicalConceptDefinition = {
  canonicalId: string;
  registryVersion: string;
  name: string;
  category: string;
  definition: string;
  is: string;
  isNot: string;
  directions: CanonicalConceptDirection[];
  aliases: string[];
  requiredData: string[];
  requiredTimeframes: string[];
  closedCandlePolicy: string;
  entryBehavior: string;
  invalidationBehavior: string;
  backtestBehavior: string;
  monitoringBehavior: string;
  aiRecognition: string;
  exclusions: string[];
  relationships: string[];
  status: CanonicalConceptStatus;
  statusReason: string;
  executorKind: CanonicalExecutorKind | null;
  evaluatorVersion: string | null;
  parameterSchema: Record<string, string>;
  requiredParameters: string[];
  optionalParameters: string[];
};

type ConceptSeed = readonly [category: string, name: string];

const LIBRARY_ROWS: readonly ConceptSeed[] = [
  ["MARKET STRUCTURE", "Higher High"],
  ["MARKET STRUCTURE", "Higher Low"],
  ["MARKET STRUCTURE", "Lower High"],
  ["MARKET STRUCTURE", "Lower Low"],
  ["MARKET STRUCTURE", "Break of Structure"],
  ["MARKET STRUCTURE", "Change of Character"],
  ["MARKET STRUCTURE", "Market Structure Shift"],
  ["MARKET STRUCTURE", "Internal Structure"],
  ["MARKET STRUCTURE", "External Structure"],
  ["MARKET STRUCTURE", "Swing High"],
  ["MARKET STRUCTURE", "Swing Low"],
  ["MARKET STRUCTURE", "Trend"],
  ["MARKET STRUCTURE", "Trend Reversal"],
  ["LIQUIDITY", "Buy-Side Liquidity"],
  ["LIQUIDITY", "Sell-Side Liquidity"],
  ["LIQUIDITY", "Liquidity Sweep"],
  ["LIQUIDITY", "Liquidity Grab"],
  ["LIQUIDITY", "Equal Highs"],
  ["LIQUIDITY", "Equal Lows"],
  ["LIQUIDITY", "Previous Day High"],
  ["LIQUIDITY", "Previous Day Low"],
  ["LIQUIDITY", "Previous Week High"],
  ["LIQUIDITY", "Previous Week Low"],
  ["LIQUIDITY", "Previous Session High"],
  ["LIQUIDITY", "Previous Session Low"],
  ["LIQUIDITY", "Internal Liquidity"],
  ["LIQUIDITY", "External Liquidity"],
  ["LIQUIDITY", "Liquidity Pool"],
  ["LIQUIDITY", "Liquidity Raid"],
  ["LIQUIDITY", "Session High"],
  ["LIQUIDITY", "Session Low"],
  ["FAIR VALUE / PRICE DELIVERY", "Fair Value Gap"],
  ["FAIR VALUE / PRICE DELIVERY", "Bullish FVG"],
  ["FAIR VALUE / PRICE DELIVERY", "Bearish FVG"],
  ["FAIR VALUE / PRICE DELIVERY", "FVG Fill"],
  ["FAIR VALUE / PRICE DELIVERY", "FVG Retest"],
  ["FAIR VALUE / PRICE DELIVERY", "Inverse Fair Value Gap"],
  ["FAIR VALUE / PRICE DELIVERY", "Bullish IFVG"],
  ["FAIR VALUE / PRICE DELIVERY", "Bearish IFVG"],
  ["FAIR VALUE / PRICE DELIVERY", "Imbalance"],
  ["FAIR VALUE / PRICE DELIVERY", "Displacement"],
  ["FAIR VALUE / PRICE DELIVERY", "Order Block"],
  ["FAIR VALUE / PRICE DELIVERY", "Bullish Order Block"],
  ["FAIR VALUE / PRICE DELIVERY", "Bearish Order Block"],
  ["FAIR VALUE / PRICE DELIVERY", "Order Block Retest"],
  ["FAIR VALUE / PRICE DELIVERY", "Mitigation"],
  ["FAIR VALUE / PRICE DELIVERY", "Breaker Block"],
  ["FAIR VALUE / PRICE DELIVERY", "Bullish Breaker"],
  ["FAIR VALUE / PRICE DELIVERY", "Bearish Breaker"],
  ["FAIR VALUE / PRICE DELIVERY", "Mitigation Block"],
  ["FAIR VALUE / PRICE DELIVERY", "Balanced Price Range"],
  ["SUPPLY & DEMAND", "Supply Zone"],
  ["SUPPLY & DEMAND", "Demand Zone"],
  ["SUPPLY & DEMAND", "Supply Retest"],
  ["SUPPLY & DEMAND", "Demand Retest"],
  ["SUPPLY & DEMAND", "Supply Reaction"],
  ["SUPPLY & DEMAND", "Demand Reaction"],
  ["SUPPLY & DEMAND", "Fresh Supply"],
  ["SUPPLY & DEMAND", "Fresh Demand"],
  ["PREMIUM / DISCOUNT", "Premium"],
  ["PREMIUM / DISCOUNT", "Discount"],
  ["PREMIUM / DISCOUNT", "Equilibrium"],
  ["PREMIUM / DISCOUNT", "50% Equilibrium"],
  ["PREMIUM / DISCOUNT", "Dealing Range"],
  ["PREMIUM / DISCOUNT", "Premium Entry"],
  ["PREMIUM / DISCOUNT", "Discount Entry"],
  ["PRICE ACTION", "Bullish Candle"],
  ["PRICE ACTION", "Bearish Candle"],
  ["PRICE ACTION", "Bullish Engulfing"],
  ["PRICE ACTION", "Bearish Engulfing"],
  ["PRICE ACTION", "Pin Bar"],
  ["PRICE ACTION", "Inside Bar"],
  ["PRICE ACTION", "Rejection"],
  ["PRICE ACTION", "Strong Rejection"],
  ["PRICE ACTION", "Wick Rejection"],
  ["PRICE ACTION", "Breakout"],
  ["PRICE ACTION", "Pullback"],
  ["PRICE ACTION", "Break and Retest"],
  ["PRICE ACTION", "Failed Breakout"],
  ["PRICE ACTION", "Continuation"],
  ["PRICE ACTION", "Reversal"],
  ["SUPPORT & RESISTANCE", "Support"],
  ["SUPPORT & RESISTANCE", "Resistance"],
  ["SUPPORT & RESISTANCE", "Previous Support"],
  ["SUPPORT & RESISTANCE", "Previous Resistance"],
  ["SUPPORT & RESISTANCE", "Support Break"],
  ["SUPPORT & RESISTANCE", "Resistance Break"],
  ["SUPPORT & RESISTANCE", "Support Retest"],
  ["SUPPORT & RESISTANCE", "Resistance Retest"],
  ["ICT / TIME-BASED", "Power of 3 / AMD"],
  ["ICT / TIME-BASED", "Kill Zones"],
  ["ICT / TIME-BASED", "London Session"],
  ["ICT / TIME-BASED", "New York Session"],
  ["ICT / TIME-BASED", "Asian Session"],
  ["ICT / TIME-BASED", "Daily Open"],
  ["ICT / TIME-BASED", "Weekly Open"],
  ["ICT / SMC", "IRL"],
  ["ICT / SMC", "ERL"],
  ["ICT / SMC", "Judas Swing"],
  ["MULTI-TIMEFRAME", "Higher Timeframe Bias"],
  ["MULTI-TIMEFRAME", "Lower Timeframe Confirmation"],
  ["MULTI-TIMEFRAME", "Multi-Timeframe Analysis"],
  ["MULTI-TIMEFRAME", "HTF Structure"],
  ["MULTI-TIMEFRAME", "LTF Structure"],
  ["MULTI-TIMEFRAME", "HTF Liquidity"],
  ["MULTI-TIMEFRAME", "LTF Liquidity"],
  ["MULTI-TIMEFRAME", "HTF FVG"],
  ["MULTI-TIMEFRAME", "HTF Order Block"],
  ["TECHNICAL", "EMA"],
  ["TECHNICAL", "SMA"],
  ["TECHNICAL", "EMA Cross"],
  ["TECHNICAL", "SMA Cross"],
  ["TECHNICAL", "Price Above EMA"],
  ["TECHNICAL", "Price Below EMA"],
  ["TECHNICAL", "VWAP"],
  ["TECHNICAL", "RSI"],
  ["TECHNICAL", "RSI Overbought"],
  ["TECHNICAL", "RSI Oversold"],
  ["TECHNICAL", "RSI Divergence"],
  ["TECHNICAL", "MACD"],
  ["TECHNICAL", "MACD Cross"],
  ["TECHNICAL", "Volume"],
  ["TECHNICAL", "Moving Average"],
  ["TECHNICAL", "Divergence"],
  ["TECHNICAL", "SMT Divergence"],
  ["RISK / TRADE MANAGEMENT", "Risk/Reward"],
  ["RISK / TRADE MANAGEMENT", "Percentage Risk"],
  ["RISK / TRADE MANAGEMENT", "Risk Amount"],
  ["RISK / TRADE MANAGEMENT", "Position Size"],
  ["RISK / TRADE MANAGEMENT", "Maximum Risk"],
  ["RISK / TRADE MANAGEMENT", "Stop Loss"],
  ["RISK / TRADE MANAGEMENT", "Take Profit"],
  ["RISK / TRADE MANAGEMENT", "Break Even"],
  ["RISK / TRADE MANAGEMENT", "Trailing Stop"],
];

const EXECUTABLE_KINDS: Record<string, CanonicalExecutorKind> = {
  "Higher High": "market_structure", "Higher Low": "market_structure",
  "Lower High": "market_structure", "Lower Low": "market_structure",
  "Break of Structure": "market_structure", "Change of Character": "market_structure",
  "Market Structure Shift": "market_structure", "HTF Structure": "market_structure", "Swing High": "market_structure",
  "Swing Low": "market_structure", "Buy-Side Liquidity": "liquidity_level",
  "Sell-Side Liquidity": "liquidity_level", "Liquidity Sweep": "liquidity_sweep",
  "Equal Highs": "liquidity_level", "Equal Lows": "liquidity_level",
  "Previous Day High": "liquidity_level", "Previous Day Low": "liquidity_level",
  "Previous Week High": "liquidity_level", "Previous Week Low": "liquidity_level",
  "Fair Value Gap": "fair_value_gap", "Bullish FVG": "fair_value_gap",
  "Bearish FVG": "fair_value_gap", "FVG Fill": "fair_value_gap",
  "FVG Retest": "fair_value_gap", "Inverse Fair Value Gap": "fair_value_gap",
  "Bullish IFVG": "fair_value_gap", "Bearish IFVG": "fair_value_gap",
  "Displacement": "displacement", "Premium": "range_location",
  "Discount": "range_location", "Equilibrium": "range_location",
  "50% Equilibrium": "range_location", "Rejection": "rejection",
  "Wick Rejection": "rejection", "Bullish Rejection": "rejection", "Bearish Rejection": "rejection",
  "Breakout": "price_action", "Bullish Engulfing": "price_action", "Bearish Engulfing": "price_action",
  "Pin Bar": "price_action", "Inside Bar": "price_action",
  "Break and Retest": "price_action", "Failed Breakout": "failed_breakout",
  "Support": "price_action", "Resistance": "price_action",
  "Kill Zones": "session", "London Session": "session",
  "New York Session": "session", "Asian Session": "session",
  "EMA": "indicator", "SMA": "indicator", "EMA Cross": "indicator",
  "SMA Cross": "indicator", "Price Above EMA": "indicator",
  "Price Below EMA": "indicator", "VWAP": "indicator", "RSI": "indicator",
  "RSI Overbought": "indicator", "RSI Oversold": "indicator",
  "MACD": "indicator", "MACD Cross": "indicator",
};

const ALIASES: Record<string, string[]> = {
  "Higher High": ["HH"], "Higher Low": ["HL"], "Lower High": ["LH"], "Lower Low": ["LL"],
  "Break of Structure": ["BOS"], "Change of Character": ["CHoCH"],
  "Market Structure Shift": ["MSS"], "Liquidity Sweep": ["Sweep", "Liquidity Sweeps"],
  "Fair Value Gap": ["FVG", "Fair Value Gap (FVG)"], "Bullish FVG": ["Bullish Fair Value Gap"],
  "Bearish FVG": ["Bearish Fair Value Gap"], "FVG Fill": ["Fair Value Gap Fill", "Fair Value Gap Fills"],
  "FVG Retest": ["Fair Value Gap Retest", "Fair Value Gap Retests", "FVG Retests"], "Inverse Fair Value Gap": ["IFVG"],
  "Bullish IFVG": ["Bullish Inverse Fair Value Gap"],
  "Bearish IFVG": ["Bearish Inverse Fair Value Gap"],
  "Buy-Side Liquidity": ["Buy Side Liquidity", "BSL"],
  "Sell-Side Liquidity": ["Sell Side Liquidity", "SSL"],
  "Equal Highs": ["Equal High"], "Equal Lows": ["Equal Low"],
  "Break and Retest": ["Breakout Retest"], "Failed Breakout": ["False Breakout"],
  "Breakout": ["Long Breakout", "Short Breakout"],
  "Rejection": ["Bullish Rejection", "Bearish Rejection"],
  "Wick Rejection": ["Rejection Candle"], "50% Equilibrium": ["50 Equilibrium"],
  "Kill Zones": ["Kill Zone"], "London Session": ["London"],
  "New York Session": ["NY", "NY Session", "New York Kill Zone"],
  "Asian Session": ["Asia", "Asia Session"],
  "EMA": ["Exponential Moving Average", "Exponential Moving Average (EMA)"],
  "SMA": ["Simple Moving Average", "Simple Moving Average (SMA)"],
  "EMA Cross": ["EMA Crossover"], "SMA Cross": ["SMA Crossover"],
  "Price Above EMA": ["Price Above Exponential Moving Average"],
  "Price Below EMA": ["Price Below Exponential Moving Average"],
  "RSI Overbought": ["RSI > 70"], "RSI Oversold": ["RSI < 30"],
  "MACD Cross": ["MACD Crossover"],
};

const EXECUTABLE_FIELDS: Record<CanonicalExecutorKind, {
  required: string[];
  optional: string[];
  schema: Record<string, string>;
}> = {
  liquidity_sweep: {
    required: ["level", "sweepSide", "confirmation", "lookback"],
    optional: [],
    schema: { level: "previous_candle | lookback_extreme", sweepSide: "auto | buy_side | sell_side", confirmation: "close_back_inside", lookback: "integer 1..50" },
  },
  fair_value_gap: {
    required: ["polarity", "interaction", "lookback", "minimumGap"],
    optional: ["inverse"],
    schema: { polarity: "auto | bullish | bearish", interaction: "formation | retest", lookback: "integer 1..100", minimumGap: "number >= 0", inverse: "boolean" },
  },
  market_structure: {
    required: ["signal", "polarity", "lookback"],
    optional: [],
    schema: { signal: "swing, HH/HL/LH/LL, BOS, CHoCH, or MSS", polarity: "auto | bullish | bearish", lookback: "integer 2..100" },
  },
  liquidity_level: {
    required: ["level", "lookback", "tolerance"],
    optional: [],
    schema: { level: "supported liquidity level", lookback: "integer 2..100", tolerance: "number >= 0" },
  },
  indicator: {
    required: ["indicator", "period", "comparison"],
    optional: ["fastPeriod", "slowPeriod", "signalPeriod", "threshold"],
    schema: { indicator: "EMA | SMA | RSI | MACD | VWAP | ATR", period: "integer 1..500", comparison: "above | below | cross_above | cross_below", threshold: "number" },
  },
  price_action: {
    required: ["pattern", "polarity", "lookback", "wickRatio"],
    optional: [],
    schema: { pattern: "breakout, retest, engulfing, pin, inside, support, or resistance", polarity: "auto | bullish | bearish", lookback: "integer 2..100", wickRatio: "number 1..20" },
  },
  range_location: {
    required: ["location", "lookback"],
    optional: [],
    schema: { location: "premium | discount | equilibrium", lookback: "integer 2..100" },
  },
  displacement: {
    required: ["polarity", "atrPeriod", "minimumBodyAtr", "minimumCloseLocation"],
    optional: [],
    schema: { polarity: "auto | bullish | bearish", atrPeriod: "integer 1..500", minimumBodyAtr: "number 0..20", minimumCloseLocation: "number .5..1" },
  },
  rejection: {
    required: ["polarity", "minimumWickFraction", "minimumCloseLocation"],
    optional: [],
    schema: { polarity: "auto | bullish | bearish", minimumWickFraction: "number 0..1", minimumCloseLocation: "number .5..1" },
  },
  failed_breakout: {
    required: ["polarity", "levelType", "lookback", "maxBarsToFailure"],
    optional: [],
    schema: { polarity: "auto | bullish | bearish", levelType: "auto | support | resistance", lookback: "integer 2..100", maxBarsToFailure: "integer 1..20" },
  },
  session: {
    required: ["session", "startTime", "endTime", "timezone"],
    optional: [],
    schema: { session: "london | new_york | asian | kill_zone", startTime: "HH:mm", endTime: "HH:mm", timezone: "IANA timezone" },
  },
};

const keyForConcept = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");

function idForConcept(name: string) {
  return `concept.${keyForConcept(name).replace(/\s+/g, "_")}`;
}

function reviewReason(name: string) {
  if (name.includes("Divergence") || name === "SMT Divergence") return "Requires a defined comparison series and causal swing-pair algorithm.";
  if (name.includes("Timeframe") || name.startsWith("HTF") || name.startsWith("LTF") || name === "Multi-Timeframe Analysis") return "Requires explicit multi-timeframe alignment and a closed-candle relationship evaluator.";
  if (name.includes("Order Block") || name.includes("Breaker") || name.includes("Supply") || name.includes("Demand")) return "Requires an objective formation, invalidation, and mitigation algorithm before execution can be enabled.";
  if (name.includes("Risk") || name.includes("Stop") || name.includes("Take") || name.includes("Position") || name.includes("Break Even") || name.includes("Trailing")) return "Risk and trade-management rules are kept separate from entry-condition evaluators.";
  return "The concept is preserved in the library but has no deterministic, versioned closed-candle evaluator yet.";
}

function aliasesFor(name: string) {
  return ALIASES[name] ?? [];
}

function definitionFor(category: string, name: string): CanonicalConceptDefinition {
  const executorKind = EXECUTABLE_KINDS[name] ?? null;
  const executable = executorKind !== null;
  const fields = executorKind ? EXECUTABLE_FIELDS[executorKind] : null;
  const aliases = aliasesFor(name);
  return {
    canonicalId: idForConcept(name),
    registryVersion: "2026-09-12",
    name,
    category,
    definition: executable
      ? `${name} is evaluated from completed OHLC${executorKind === "indicator" ? "V" : ""} candles using the canonical ${executorKind} evaluator.`
      : `${name} is a distinct ${category.toLowerCase()} concept retained with its domain meaning until its execution contract is defined.`,
    is: executable ? `The closed candle satisfies the canonical ${executorKind} parameters for ${name}.` : `The user explicitly requests the named ${name} concept.`,
    isNot: executable ? `A label, description, or open candle is not sufficient evidence for ${name}.` : `The concept must not be silently replaced with a related executable concept.`,
    directions: ["long", "short", "both"],
    aliases,
    requiredData: executable ? [executorKind === "session" ? "timestamp" : "OHLC"] : ["OHLC and any domain-specific series required by a future evaluator"],
    requiredTimeframes: ["the condition timeframe"],
    closedCandlePolicy: "Evaluate only completed candles; never use the still-forming candle or future bars.",
    entryBehavior: executable ? "The shared evaluator returns met only when the canonical rule is true on the decision candle." : "Keep visible as review_required and do not execute until its evaluator contract is approved.",
    invalidationBehavior: executable ? "Use the evaluator's false result on later closed candles; no implicit invalidation is invented." : "Preserve the requested concept and explain the missing invalidation/evaluator contract.",
    backtestBehavior: executable ? "Backtesting uses the shared canonical evaluator and required history; insufficient history returns no match." : "Backtesting blocks execution with an explicit review-required status.",
    monitoringBehavior: executable ? "Monitoring uses the same evaluator, canonical parameters, and closed-candle boundary as backtesting." : "Monitoring remains waiting/review_required rather than fabricating a detector.",
    aiRecognition: `Recognize the canonical name${aliases.length ? ` and aliases: ${aliases.join(", ")}` : ""}.`,
    exclusions: ["Do not infer this concept from a merely related phrase.", "Do not invent parameters, direction, timeframe, or risk rules."],
    relationships: name.includes("Retest") || name.includes("Break") ? ["May be requested after a preceding formation concept; relationship execution remains explicit."] : [],
    status: executable ? "executable" : "review_required",
    statusReason: executable ? "A shared deterministic closed-candle evaluator and history requirement are registered." : reviewReason(name),
    executorKind,
    evaluatorVersion: executable ? "historical-1" : null,
    parameterSchema: fields?.schema ?? {},
    requiredParameters: fields?.required ?? [],
    optionalParameters: fields?.optional ?? [],
  };
}

export const TRADING_CONCEPT_REGISTRY: readonly CanonicalConceptDefinition[] = LIBRARY_ROWS.map(
  ([category, name]) => definitionFor(category, name),
);

const NAME_LOOKUP = new Map<string, CanonicalConceptDefinition>();
for (const definition of TRADING_CONCEPT_REGISTRY) {
  for (const label of [definition.name, ...definition.aliases]) {
    const key = keyForConcept(label);
    if (NAME_LOOKUP.has(key) && NAME_LOOKUP.get(key)!.canonicalId !== definition.canonicalId) {
      throw new Error(`Canonical concept alias collision: ${label}`);
    }
    NAME_LOOKUP.set(key, definition);
  }
}

export function resolveTradingConcept(name: string | null | undefined): CanonicalConceptDefinition | null {
  if (!name?.trim()) return null;
  return NAME_LOOKUP.get(keyForConcept(name)) ?? null;
}

export function getTradingConceptDefinition(canonicalId: string | null | undefined): CanonicalConceptDefinition | null {
  if (!canonicalId) return null;
  return TRADING_CONCEPT_REGISTRY.find(definition => definition.canonicalId === canonicalId) ?? null;
}

export function tradingConceptMetadata(name: string) {
  const definition = resolveTradingConcept(name);
  if (!definition) return null;
  return {
    description: definition.definition,
    detectionRules: definition.entryBehavior,
    invalidationRules: definition.invalidationBehavior,
  };
}

export function canonicalConceptStatus(name: string | null | undefined): CanonicalConceptStatus | null {
  return resolveTradingConcept(name)?.status ?? null;
}