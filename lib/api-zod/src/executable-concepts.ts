import { resolveTradingConcept, TRADING_CONCEPT_REGISTRY } from "./concept-registry";

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

export type FailedBreakoutParameters = {
  kind: "failed_breakout";
  polarity: "auto" | "bullish" | "bearish";
  levelType: "auto" | "support" | "resistance";
  lookback: number;
  maxBarsToFailure: number;
};

export type SessionName = "london" | "new_york" | "asian" | "kill_zone";

export type SessionParameters = {
  kind: "session";
  session: SessionName;
  startTime: string;
  endTime: string;
  timezone: string;
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
  | RejectionParameters
  | FailedBreakoutParameters
  | SessionParameters;

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

export const DEFAULT_FAILED_BREAKOUT_PARAMETERS: FailedBreakoutParameters = {
  kind: "failed_breakout",
  polarity: "auto",
  levelType: "auto",
  lookback: 20,
  maxBarsToFailure: 3,
};

export const CANONICAL_SESSION_DEFINITIONS: Record<SessionName, Omit<SessionParameters, "kind" | "session">> = {
  london: { startTime: "08:00", endTime: "17:00", timezone: "Europe/London" },
  new_york: { startTime: "08:00", endTime: "17:00", timezone: "America/New_York" },
  asian: { startTime: "09:00", endTime: "17:00", timezone: "Asia/Tokyo" },
  kill_zone: { startTime: "07:00", endTime: "10:00", timezone: "Europe/London" },
};

export const DEFAULT_SESSION_PARAMETERS: SessionParameters = {
  kind: "session",
  session: "london",
  ...CANONICAL_SESSION_DEFINITIONS.london,
};

const keyForConcept = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");

export function executableConceptLabel(name: string | null | undefined): string | null {
  const definition = resolveTradingConcept(name);
  return definition?.status === "executable" ? definition.name : null;
}

export function executableConceptKind(name: string | null | undefined): ExecutableConceptParameters["kind"] | null {
  return resolveTradingConcept(name)?.executorKind ?? null;
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function numberInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validSessionTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function sessionNameForConcept(conceptName: string): SessionName {
  const key = keyForConcept(conceptName);
  if (key.includes("new york") || key === "ny" || key.includes("ny session")) return "new_york";
  if (key.includes("kill zone")) return "kill_zone";
  if (key.includes("asian") || key === "asia" || key.includes("asia session")) return "asian";
  return "london";
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
  if (kind === "failed_breakout") {
    const defaults = DEFAULT_FAILED_BREAKOUT_PARAMETERS;
    const conceptKey = keyForConcept(conceptName || "");
    if (input.polarity != null && input.polarity !== "auto" && input.polarity !== "bullish" && input.polarity !== "bearish") return null;
    if (input.levelType != null && input.levelType !== "auto" && input.levelType !== "support" && input.levelType !== "resistance") return null;
    const result: FailedBreakoutParameters = {
      kind,
      polarity: input.polarity === "bullish" || input.polarity === "bearish"
        ? input.polarity
        : conceptKey.includes("bullish") ? "bullish" : conceptKey.includes("bearish") ? "bearish" : defaults.polarity,
      levelType: input.levelType === "support" || input.levelType === "resistance"
        ? input.levelType
        : conceptKey.includes("resistance") ? "resistance" : conceptKey.includes("support") ? "support" : defaults.levelType,
      lookback: input.lookback == null ? defaults.lookback : Number(input.lookback),
      maxBarsToFailure: input.maxBarsToFailure == null ? defaults.maxBarsToFailure : Number(input.maxBarsToFailure),
    };
    return integerInRange(result.lookback, 2, 100)
      && integerInRange(result.maxBarsToFailure, 1, 20) ? result : null;
  }
  if (kind === "session") {
    const session = input.session === "london" || input.session === "new_york" || input.session === "asian" || input.session === "kill_zone"
      ? input.session
      : sessionNameForConcept(conceptName || "");
    const defaults = CANONICAL_SESSION_DEFINITIONS[session];
    const result: SessionParameters = {
      kind,
      session,
      startTime: input.startTime == null ? defaults.startTime : String(input.startTime),
      endTime: input.endTime == null ? defaults.endTime : String(input.endTime),
      timezone: input.timezone == null ? defaults.timezone : String(input.timezone),
    };
    return validSessionTime(result.startTime) && validSessionTime(result.endTime) && validIanaTimezone(result.timezone)
      && result.startTime !== result.endTime ? result : null;
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
  if (parameters.kind === "failed_breakout") {
    const polarity = parameters.polarity === "auto" ? "directional" : parameters.polarity;
    return `Failed breakout: ${polarity} ${parameters.levelType} level failure within ${parameters.maxBarsToFailure} closed bars`;
  }
  if (parameters.kind === "session") {
    return `${parameters.session.replaceAll("_", " ")} session ${parameters.startTime}-${parameters.endTime} ${parameters.timezone}`;
  }
  return `Range location: ${parameters.location}`;
}

const executableDefinitionEntries = new Map<ExecutableConceptParameters["kind"], {
  label: string;
  description: string;
  aliases: string[];
}>();
for (const definition of TRADING_CONCEPT_REGISTRY) {
  if (!definition.executorKind || definition.status !== "executable") continue;
  const existing = executableDefinitionEntries.get(definition.executorKind);
  executableDefinitionEntries.set(definition.executorKind, {
    label: existing?.label ?? definition.name,
    description: existing?.description ?? definition.definition,
    aliases: [...new Set([
      ...(existing?.aliases ?? []),
      definition.name,
      ...definition.aliases,
    ])],
  });
}

export const EXECUTABLE_CONCEPT_DEFINITIONS = Object.fromEntries(executableDefinitionEntries) as Record<
  ExecutableConceptParameters["kind"],
  { label: string; description: string; aliases: string[] }
>;

export const EXECUTABLE_CONCEPT_REQUEST_ALIASES = TRADING_CONCEPT_REGISTRY
  .filter(definition => definition.status === "executable")
  .flatMap(definition => [definition.name, ...definition.aliases]);