export type LiquiditySweepParameters = {
  kind: "liquidity_sweep";
  level: "previous_candle" | "lookback_extreme";
  sweepSide: "auto" | "buy_side" | "sell_side";
  confirmation: "close_back_inside";
  lookback: number;
};

export type FairValueGapParameters = {
  kind: "fair_value_gap";
  polarity: "auto" | "bullish" | "bearish";
  interaction: "formation" | "retest";
  lookback: number;
  minimumGap: number;
  inverse?: boolean;
};

export type MarketStructureParameters = {
  kind: "market_structure";
  signal: "swing_high" | "swing_low" | "higher_high" | "higher_low" | "lower_high" | "lower_low" | "bos" | "choch" | "mss";
  polarity: "auto" | "bullish" | "bearish";
  lookback: number;
};

export type LiquidityLevelParameters = {
  kind: "liquidity_level";
  level: "buy_side" | "sell_side" | "equal_highs" | "equal_lows" | "previous_day_high" | "previous_day_low" | "previous_week_high" | "previous_week_low";
  lookback: number;
  tolerance: number;
};

export type IndicatorParameters = {
  kind: "indicator";
  indicator: "ema" | "sma" | "rsi" | "macd" | "vwap" | "atr";
  period: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  comparison: "above" | "below" | "cross_above" | "cross_below";
  threshold?: number;
};

export type PriceActionParameters = {
  kind: "price_action";
  pattern: "breakout" | "breakout_retest" | "bullish_engulfing" | "bearish_engulfing" | "pin_bar" | "inside_bar" | "support" | "resistance";
  polarity: "auto" | "bullish" | "bearish";
  lookback: number;
  wickRatio: number;
};

export type RangeLocationParameters = {
  kind: "range_location";
  location: "premium" | "discount" | "equilibrium";
  lookback: number;
};

export type DisplacementParameters = {
  kind: "displacement";
  polarity: "auto" | "bullish" | "bearish";
  atrPeriod: number;
  minimumBodyAtr: number;
  minimumCloseLocation: number;
};

export type RejectionParameters = {
  kind: "rejection";
  polarity: "auto" | "bullish" | "bearish";
  minimumWickFraction: number;
  minimumCloseLocation: number;
};

export type ExecutableConceptParameters =
  | LiquiditySweepParameters
  | FairValueGapParameters
  | MarketStructureParameters
  | LiquidityLevelParameters
  | IndicatorParameters
  | PriceActionParameters
  | RangeLocationParameters
  | DisplacementParameters
  | RejectionParameters;

export const DEFAULT_LIQUIDITY_SWEEP_PARAMETERS: LiquiditySweepParameters = {
  kind: "liquidity_sweep",
  level: "previous_candle",
  sweepSide: "auto",
  confirmation: "close_back_inside",
  lookback: 5,
};

export const DEFAULT_FAIR_VALUE_GAP_PARAMETERS: FairValueGapParameters = {
  kind: "fair_value_gap",
  polarity: "auto",
  interaction: "formation",
  lookback: 20,
  minimumGap: 0,
};

export const DEFAULT_MARKET_STRUCTURE_PARAMETERS: MarketStructureParameters = {
  kind: "market_structure",
  signal: "bos",
  polarity: "auto",
  lookback: 10,
};

export const DEFAULT_LIQUIDITY_LEVEL_PARAMETERS: LiquidityLevelParameters = {
  kind: "liquidity_level",
  level: "buy_side",
  lookback: 10,
  tolerance: 0,
};

export const DEFAULT_INDICATOR_PARAMETERS: IndicatorParameters = {
  kind: "indicator",
  indicator: "ema",
  period: 20,
  comparison: "above",
  threshold: 0,
  fastPeriod: 12,
  slowPeriod: 26,
  signalPeriod: 9,
};

export const DEFAULT_PRICE_ACTION_PARAMETERS: PriceActionParameters = {
  kind: "price_action",
  pattern: "breakout",
  polarity: "auto",
  lookback: 20,
  wickRatio: 2,
};

export const DEFAULT_RANGE_LOCATION_PARAMETERS: RangeLocationParameters = {
  kind: "range_location",
  location: "premium",
  lookback: 20,
};

export const DEFAULT_DISPLACEMENT_PARAMETERS: DisplacementParameters = {
  kind: "displacement",
  polarity: "auto",
  atrPeriod: 14,
  minimumBodyAtr: 1.5,
  minimumCloseLocation: 0.75,
};

export const DEFAULT_REJECTION_PARAMETERS: RejectionParameters = {
  kind: "rejection",
  polarity: "auto",
  minimumWickFraction: 0.5,
  minimumCloseLocation: 0.75,
};

const keyForConcept = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");

export function executableConceptLabel(name: string | null | undefined): string | null {
  const key = keyForConcept(name || "");
  if (key.includes("liquidity sweep")) return "Liquidity Sweep";
  if (key.includes("inverse fair value gap") || key === "ifvg" || key.endsWith(" ifvg")) return "Inverse Fair Value Gap";
  if (key.includes("fair value gap") || key === "fvg" || key.includes("fvg ") || key.endsWith(" fvg")) return "Fair Value Gap";
  if (key.includes("break of structure") || key === "bos") return "Break of Structure";
  if (key.includes("change of character") || key === "choch") return "Change of Character";
   if (key.includes("market structure shift") || key === "mss" || key === "htf structure" || key.includes("higher timeframe structure") || key === "bullish structure" || key === "bearish structure") return "Market Structure Shift";
  if (key.includes("higher high") || key === "hh") return "Higher High";
  if (key.includes("higher low") || key === "hl") return "Higher Low";
  if (key.includes("lower high") || key === "lh") return "Lower High";
  if (key.includes("lower low") || key === "ll") return "Lower Low";
  if (key.includes("swing high")) return "Swing High";
  if (key.includes("swing low")) return "Swing Low";
  if (key.includes("buy side")) return "Buy-Side Liquidity";
  if (key.includes("sell side")) return "Sell-Side Liquidity";
  if (key.includes("equal high")) return "Equal Highs";
  if (key.includes("equal low")) return "Equal Lows";
  if (key.includes("previous day high")) return "Previous Day High";
  if (key.includes("previous day low")) return "Previous Day Low";
  if (key.includes("previous week high")) return "Previous Week High";
  if (key.includes("previous week low")) return "Previous Week Low";
  if (key.includes("ema")) return "EMA";
  if (key.includes("sma")) return "SMA";
  if (key.includes("rsi")) return "RSI";
  if (key.includes("macd")) return "MACD";
  if (key.includes("vwap")) return "VWAP";
  if (key.includes("atr")) return "ATR";
  if (key.includes("breakout retest") || key.includes("break and retest")) return "Breakout Retest";
  if (key === "breakout") return "Breakout";
  if (key.includes("bullish engulfing")) return "Bullish Engulfing";
  if (key.includes("bearish engulfing")) return "Bearish Engulfing";
  if (key.includes("pin bar")) return "Pin Bar";
  if (key.includes("inside bar")) return "Inside Bar";
  if (key === "rejection" || key === "wick rejection" || key === "rejection candle" || key === "bullish rejection" || key === "bearish rejection") return "Rejection";
  if (key === "support") return "Support";
  if (key === "resistance") return "Resistance";
  if (key === "premium") return "Premium";
  if (key === "discount") return "Discount";
  if (key.includes("equilibrium")) return "Equilibrium";
  if (key === "displacement" || key.includes("displacement")) return "Displacement";
  return null;
}

export function executableConceptKind(name: string | null | undefined): ExecutableConceptParameters["kind"] | null {
  const key = keyForConcept(name || "");
  if (key.includes("liquidity sweep")) return "liquidity_sweep";
  if (
    key.includes("break of structure") || key === "bos" ||
    key.includes("change of character") || key === "choch" ||
     key.includes("market structure shift") || key === "mss" || key === "htf structure" || key.includes("higher timeframe structure") || key === "bullish structure" || key === "bearish structure" ||
    key === "higher high" || key === "hh" || key === "higher low" || key === "hl" ||
    key === "lower high" || key === "lh" || key === "lower low" || key === "ll" ||
    key === "swing high" || key === "swing low"
  ) return "market_structure";
  if (
    key === "buy side liquidity" || key === "buy side" || key === "sell side liquidity" || key === "sell side" ||
    key === "equal highs" || key === "equal high" || key === "equal lows" || key === "equal low" ||
    key === "previous day high" || key === "previous day low" ||
    key === "previous week high" || key === "previous week low"
  ) return "liquidity_level";
  if (
    key === "fvg" ||
    key.startsWith("fvg ") ||
    key.includes("fair value gap") ||
    key.includes("bullish fvg") ||
    key.includes("bearish fvg")
  ) return "fair_value_gap";
  if (key.includes("inverse fair value gap") || key === "ifvg" || key === "bullish ifvg" || key === "bearish ifvg") return "fair_value_gap";
  if (
    key === "ema" || key.startsWith("ema ") || key === "exponential moving average" || key.startsWith("exponential moving average ") ||
    key === "sma" || key.startsWith("sma ") || key === "simple moving average" || key.startsWith("simple moving average ") ||
    key === "ema cross" || key === "ema crossover" || key === "sma cross" || key === "sma crossover" ||
    key.includes("price above ema") || key.includes("price below ema") ||
    key === "rsi" || key.startsWith("rsi ") || key === "rsi overbought" || key === "rsi oversold" ||
    key === "macd" || key.startsWith("macd ") || key === "macd cross" || key === "vwap" || key === "atr" || key.startsWith("atr ")
  ) return "indicator";
  if (
    key === "breakout" || key === "breakout retest" || key === "break and retest" ||
    key === "bullish engulfing" || key === "bearish engulfing" || key === "pin bar" ||
    key === "inside bar" || key === "support" || key === "resistance"
  ) return "price_action";
  if (key === "rejection" || key === "wick rejection" || key === "rejection candle" || key === "bullish rejection" || key === "bearish rejection") return "rejection";
  if (key === "premium" || key === "discount" || key === "equilibrium" || key === "50 equilibrium") return "range_location";
  if (key === "displacement" || key.includes("displacement")) return "displacement";
  return null;
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function numberInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function normalizeExecutableParameters(
  conceptName: string | null | undefined,
  value: unknown,
): ExecutableConceptParameters | null {
  const kind = executableConceptKind(conceptName);
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (input.kind != null && input.kind !== kind) return null;
  if (kind === "liquidity_sweep") {
    const defaults = DEFAULT_LIQUIDITY_SWEEP_PARAMETERS;
    if (input.level != null && input.level !== "previous_candle" && input.level !== "lookback_extreme") return null;
    if (input.sweepSide != null && input.sweepSide !== "auto" && input.sweepSide !== "buy_side" && input.sweepSide !== "sell_side") return null;
    if (input.confirmation != null && input.confirmation !== "close_back_inside") return null;
    const sweepSide = input.sweepSide ?? (keyForConcept(conceptName || "").includes("buy side") ? "buy_side" : keyForConcept(conceptName || "").includes("sell side") ? "sell_side" : defaults.sweepSide);
    const result: LiquiditySweepParameters = {
      kind,
      level: input.level === "lookback_extreme" ? "lookback_extreme" : defaults.level,
      sweepSide: sweepSide === "buy_side" || sweepSide === "sell_side" ? sweepSide : "auto",
      confirmation: "close_back_inside",
      lookback: input.lookback == null ? defaults.lookback : Number(input.lookback),
    };
    return integerInRange(result.lookback, 1, 50) ? result : null;
  }
  if (kind === "fair_value_gap") {
    const defaults = DEFAULT_FAIR_VALUE_GAP_PARAMETERS;
    const conceptKey = keyForConcept(conceptName || "");
    if (input.polarity != null && input.polarity !== "auto" && input.polarity !== "bullish" && input.polarity !== "bearish") return null;
    if (input.interaction != null && input.interaction !== "formation" && input.interaction !== "retest") return null;
    const polarity = input.polarity
      ?? (conceptKey.includes("bullish") ? "bullish" : conceptKey.includes("bearish") ? "bearish" : defaults.polarity);
    const interaction = input.interaction
      ?? (conceptKey.includes("retest") || conceptKey.includes("fill") ? "retest" : defaults.interaction);
    const result: FairValueGapParameters = {
      kind,
      polarity: polarity === "bullish" || polarity === "bearish" ? polarity : "auto",
      interaction: interaction === "retest" || conceptKey.includes("inverse") || conceptKey === "ifvg" || conceptKey.endsWith(" ifvg") ? "retest" : defaults.interaction,
      lookback: input.lookback == null ? defaults.lookback : Number(input.lookback),
      minimumGap: input.minimumGap == null ? defaults.minimumGap : Number(input.minimumGap),
      ...(input.inverse === true || conceptKey.includes("inverse") || conceptKey === "ifvg" || conceptKey.endsWith(" ifvg") ? { inverse: true } : {}),
    };
    return integerInRange(result.lookback, 1, 100) && numberInRange(result.minimumGap, 0, Number.MAX_SAFE_INTEGER) ? result : null;
  }
  if (kind === "market_structure") {
    const defaults = DEFAULT_MARKET_STRUCTURE_PARAMETERS;
    const conceptKey = keyForConcept(conceptName || "");
    const signal = input.signal
      ?? (conceptKey === "higher high" || conceptKey === "hh" ? "higher_high"
        : conceptKey === "higher low" || conceptKey === "hl" ? "higher_low"
          : conceptKey === "lower high" || conceptKey === "lh" ? "lower_high"
            : conceptKey === "lower low" || conceptKey === "ll" ? "lower_low"
              : conceptKey === "swing high" ? "swing_high"
                : conceptKey === "swing low" ? "swing_low"
                : conceptKey === "change of character" || conceptKey === "choch" ? "choch"
                  : conceptKey === "market structure shift" || conceptKey === "mss" || conceptKey === "htf structure" ? "mss" : "bos");
    const signals = ["swing_high", "swing_low", "higher_high", "higher_low", "lower_high", "lower_low", "bos", "choch", "mss"];
    if (!signals.includes(String(signal))) return null;
    if (input.polarity != null && input.polarity !== "auto" && input.polarity !== "bullish" && input.polarity !== "bearish") return null;
    const result: MarketStructureParameters = {
      kind,
      signal: signal as MarketStructureParameters["signal"],
       polarity: input.polarity === "bullish" || input.polarity === "bearish"
         ? input.polarity
         : conceptKey.includes("bullish") ? "bullish" : conceptKey.includes("bearish") ? "bearish" : defaults.polarity,
      lookback: input.lookback == null ? defaults.lookback : Number(input.lookback),
    };
    return integerInRange(result.lookback, 2, 100) ? result : null;
  }
  if (kind === "liquidity_level") {
    const defaults = DEFAULT_LIQUIDITY_LEVEL_PARAMETERS;
    const conceptKey = keyForConcept(conceptName || "");
    const level = input.level
      ?? (conceptKey.includes("previous day high") ? "previous_day_high"
        : conceptKey.includes("previous day low") ? "previous_day_low"
          : conceptKey.includes("previous week high") ? "previous_week_high"
            : conceptKey.includes("previous week low") ? "previous_week_low"
              : conceptKey.includes("equal high") ? "equal_highs"
                : conceptKey.includes("equal low") ? "equal_lows"
                  : conceptKey.includes("sell side") ? "sell_side" : "buy_side");
    const levels = ["buy_side", "sell_side", "equal_highs", "equal_lows", "previous_day_high", "previous_day_low", "previous_week_high", "previous_week_low"];
    if (!levels.includes(String(level))) return null;
    const result: LiquidityLevelParameters = {
      kind,
      level: level as LiquidityLevelParameters["level"],
      lookback: input.lookback == null ? defaults.lookback : Number(input.lookback),
      tolerance: input.tolerance == null ? defaults.tolerance : Number(input.tolerance),
    };
    return integerInRange(result.lookback, 2, 100) && numberInRange(result.tolerance, 0, Number.MAX_SAFE_INTEGER) ? result : null;
  }
  if (kind === "indicator") {
    const defaults = DEFAULT_INDICATOR_PARAMETERS;
    const conceptKey = keyForConcept(conceptName || "");
    const indicator = input.indicator
      ?? (conceptKey.includes("rsi") ? "rsi" : conceptKey.includes("macd") ? "macd" : conceptKey.includes("vwap") ? "vwap" : conceptKey.includes("atr") ? "atr" : conceptKey.includes("sma") ? "sma" : "ema");
    if (!["ema", "sma", "rsi", "macd", "vwap", "atr"].includes(String(indicator))) return null;
    const comparison = input.comparison
      ?? (conceptKey.includes("cross") && conceptKey.includes("below") ? "cross_below"
        : conceptKey.includes("cross") && conceptKey.includes("above") ? "cross_above"
          : conceptKey.includes("below") || conceptKey.includes("oversold") ? "below"
          : conceptKey.includes("cross") ? "cross_above"
            : conceptKey.includes("overbought") ? "above" : defaults.comparison);
    if (!["above", "below", "cross_above", "cross_below"].includes(String(comparison))) return null;
    const result: IndicatorParameters = {
      kind,
      indicator: indicator as IndicatorParameters["indicator"],
      period: input.period == null ? defaults.period : Number(input.period),
      fastPeriod: input.fastPeriod == null ? defaults.fastPeriod : Number(input.fastPeriod),
      slowPeriod: input.slowPeriod == null ? defaults.slowPeriod : Number(input.slowPeriod),
      signalPeriod: input.signalPeriod == null ? defaults.signalPeriod : Number(input.signalPeriod),
      comparison: comparison as IndicatorParameters["comparison"],
      threshold: input.threshold == null
        ? indicator === "rsi" && conceptKey.includes("overbought") ? 70
          : indicator === "rsi" && conceptKey.includes("oversold") ? 30 : defaults.threshold
        : Number(input.threshold),
    };
    return integerInRange(result.period, 1, 500) &&
      integerInRange(result.fastPeriod!, 1, 500) &&
      integerInRange(result.slowPeriod!, 2, 500) &&
      integerInRange(result.signalPeriod!, 1, 500) &&
      result.fastPeriod! < result.slowPeriod! &&
      numberInRange(result.threshold, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) ? result : null;
  }
  if (kind === "price_action") {
    const defaults = DEFAULT_PRICE_ACTION_PARAMETERS;
    const conceptKey = keyForConcept(conceptName || "");
    const pattern = input.pattern
      ?? (conceptKey.includes("bullish engulfing") ? "bullish_engulfing"
        : conceptKey.includes("bearish engulfing") ? "bearish_engulfing"
          : conceptKey.includes("pin bar") ? "pin_bar"
            : conceptKey.includes("inside bar") ? "inside_bar"
              : conceptKey.includes("breakout retest") || conceptKey.includes("break and retest") ? "breakout_retest"
                : conceptKey === "support" ? "support" : conceptKey === "resistance" ? "resistance" : "breakout");
    const patterns = ["breakout", "breakout_retest", "bullish_engulfing", "bearish_engulfing", "pin_bar", "inside_bar", "support", "resistance"];
    if (!patterns.includes(String(pattern))) return null;
    const result: PriceActionParameters = {
      kind,
      pattern: pattern as PriceActionParameters["pattern"],
      polarity: input.polarity === "bullish" || input.polarity === "bearish" ? input.polarity : defaults.polarity,
      lookback: input.lookback == null ? defaults.lookback : Number(input.lookback),
      wickRatio: input.wickRatio == null ? defaults.wickRatio : Number(input.wickRatio),
    };
    return integerInRange(result.lookback, 2, 100) && numberInRange(result.wickRatio, 1, 20) ? result : null;
  }
  if (kind === "range_location") {
    const defaults = DEFAULT_RANGE_LOCATION_PARAMETERS;
    const conceptKey = keyForConcept(conceptName || "");
    const location = input.location
      ?? (conceptKey.includes("discount") ? "discount" : conceptKey.includes("equilibrium") ? "equilibrium" : "premium");
    if (!["premium", "discount", "equilibrium"].includes(String(location))) return null;
    const result: RangeLocationParameters = {
      kind,
      location: location as RangeLocationParameters["location"],
      lookback: input.lookback == null ? defaults.lookback : Number(input.lookback),
    };
    return integerInRange(result.lookback, 2, 100) ? result : null;
  }
  if (kind === "displacement") {
    const defaults = DEFAULT_DISPLACEMENT_PARAMETERS;
    const conceptKey = keyForConcept(conceptName || "");
    if (input.polarity != null && input.polarity !== "auto" && input.polarity !== "bullish" && input.polarity !== "bearish") return null;
    const result: DisplacementParameters = {
      kind,
      polarity: input.polarity === "bullish" || input.polarity === "bearish"
        ? input.polarity
        : conceptKey.includes("bullish") ? "bullish" : conceptKey.includes("bearish") ? "bearish" : defaults.polarity,
      atrPeriod: input.atrPeriod == null ? defaults.atrPeriod : Number(input.atrPeriod),
      minimumBodyAtr: input.minimumBodyAtr == null ? defaults.minimumBodyAtr : Number(input.minimumBodyAtr),
      minimumCloseLocation: input.minimumCloseLocation == null ? defaults.minimumCloseLocation : Number(input.minimumCloseLocation),
    };
    return integerInRange(result.atrPeriod, 1, 500)
      && numberInRange(result.minimumBodyAtr, 0, 20)
      && numberInRange(result.minimumCloseLocation, 0.5, 1) ? result : null;
  }
  if (kind === "rejection") {
    const defaults = DEFAULT_REJECTION_PARAMETERS;
    const conceptKey = keyForConcept(conceptName || "");
    if (input.polarity != null && input.polarity !== "auto" && input.polarity !== "bullish" && input.polarity !== "bearish") return null;
    const result: RejectionParameters = {
      kind,
      polarity: input.polarity === "bullish" || input.polarity === "bearish"
        ? input.polarity
        : conceptKey.includes("bullish") ? "bullish" : conceptKey.includes("bearish") ? "bearish" : defaults.polarity,
      minimumWickFraction: input.minimumWickFraction == null ? defaults.minimumWickFraction : Number(input.minimumWickFraction),
      minimumCloseLocation: input.minimumCloseLocation == null ? defaults.minimumCloseLocation : Number(input.minimumCloseLocation),
    };
    return numberInRange(result.minimumWickFraction, 0, 1)
      && numberInRange(result.minimumCloseLocation, 0.5, 1) ? result : null;
  }
  return null;
}

export function executableConceptTriggerRules(parameters: ExecutableConceptParameters): string {
  if (parameters.kind === "liquidity_sweep") return "Liquidity sweep: close back inside the swept level";
  if (parameters.kind === "fair_value_gap") return parameters.inverse
    ? "Inverse Fair Value Gap"
    : parameters.interaction === "retest" ? "Fair Value Gap retest" : "Fair Value Gap formation";
  if (parameters.kind === "market_structure") return `Market structure: ${parameters.signal.replaceAll("_", " ")}`;
  if (parameters.kind === "liquidity_level") return `Liquidity level: ${parameters.level.replaceAll("_", " ")}`;
  if (parameters.kind === "indicator") return `${parameters.indicator.toUpperCase()} ${parameters.comparison.replaceAll("_", " ")}`;
  if (parameters.kind === "price_action") return `Price action: ${parameters.pattern.replaceAll("_", " ")}`;
  if (parameters.kind === "displacement") {
    const polarity = parameters.polarity === "auto" ? "directional" : parameters.polarity;
    return `Displacement: ${polarity} body >= ${parameters.minimumBodyAtr} ATR with close location >= ${parameters.minimumCloseLocation}`;
  }
  if (parameters.kind === "rejection") {
    const polarity = parameters.polarity === "auto" ? "directional" : parameters.polarity;
    return `Rejection: ${polarity} wick >= ${parameters.minimumWickFraction * 100}% of range with close location >= ${parameters.minimumCloseLocation}`;
  }
  return `Range location: ${parameters.location}`;
}

export const EXECUTABLE_CONCEPT_DEFINITIONS = {
  liquidity_sweep: {
    label: "Liquidity Sweep",
    description: "The candle takes a prior liquidity level and closes back inside it.",
    aliases: ["liquidity sweep"],
  },
  fair_value_gap: {
    label: "Fair Value Gap",
    description: "A three-candle imbalance, evaluated as formation or a later retest.",
    aliases: ["fair value gap", "fvg", "bullish fvg", "bearish fvg", "fvg retest", "fvg fill", "ifvg", "bullish ifvg", "bearish ifvg"],
  },
  market_structure: {
    label: "Market Structure",
    description: "Causal rolling structure levels identify swings, HH/HL/LH/LL, and directional breaks.",
    aliases: ["higher high", "higher low", "lower high", "lower low", "break of structure", "bos", "change of character", "choch", "market structure shift", "mss", "htf structure", "swing high", "swing low"],
  },
  liquidity_level: {
    label: "Liquidity Level",
    description: "Historical prior, equal, day, and week levels derived from completed OHLC candles.",
    aliases: ["buy-side liquidity", "sell-side liquidity", "equal highs", "equal lows", "previous day high", "previous day low", "previous week high", "previous week low"],
  },
  indicator: {
    label: "Technical Indicator",
    description: "EMA, SMA, RSI, MACD, VWAP, and ATR calculations from historical OHLC data.",
    aliases: ["ema", "sma", "rsi", "rsi overbought", "rsi oversold", "macd", "macd cross", "vwap", "atr", "ema cross", "sma cross", "price above ema", "price below ema"],
  },
  price_action: {
    label: "Price Action",
    description: "Deterministic candle patterns and rolling-range breakouts from OHLC data.",
    aliases: ["breakout", "break and retest", "breakout retest", "bullish engulfing", "bearish engulfing", "pin bar", "inside bar", "support", "resistance"],
  },
  range_location: {
    label: "Range Location",
    description: "Premium, discount, or equilibrium relative to an established rolling high-low range.",
    aliases: ["premium", "discount", "equilibrium", "50% equilibrium"],
  },
  displacement: {
    label: "Displacement",
    description: "A directional candle whose body is at least a configured multiple of prior ATR and closes near its directional extreme.",
    aliases: ["displacement", "bullish displacement", "bearish displacement"],
  },
  rejection: {
    label: "Rejection",
    description: "A directional candle with a configurable wick fraction and close location.",
    aliases: ["rejection", "wick rejection", "rejection candle", "bullish rejection", "bearish rejection"],
  },
} as const;

export const EXECUTABLE_CONCEPT_REQUEST_ALIASES = Object.values(EXECUTABLE_CONCEPT_DEFINITIONS)
  .flatMap(definition => definition.aliases);