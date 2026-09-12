import {
  historicalRuleCompatibilityError,
  normalizeHistoricalRule,
  normalizeExecutableParameters,
  type ExecutableConceptParameters,
} from "@workspace/api-zod";

export type BacktestSide = "long" | "short";

export interface HistoricalCandle {
  openTime: Date;
  closeTime: Date | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  isClosed: boolean;
}

export interface BacktestCondition {
  name: string;
  conceptName?: string | null;
  timeframe?: string | null;
  stage: "entry" | "confirmation" | "invalidation" | "exit";
  direction: "long" | "short" | "both";
  requirement: "required" | "optional";
  triggerRules: string | null;
  parameters?: unknown;
  invalidationRules: string | null;
  conceptDetectionRules: string | null;
}

export interface BacktestStrategy {
  direction: "long" | "short" | "both";
  entryRules: string | null;
  exitRules: string | null;
  riskRules: string | null;
  conditions: BacktestCondition[];
}

export interface HistoricalCandleSeries {
  code: string;
  candles: HistoricalCandle[];
}

export interface HistoricalBacktestInput {
  executionTimeframe: string;
  series: HistoricalCandleSeries[];
}

export interface SimulatedTrade {
  side: BacktestSide;
  entryTime: Date;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  exitTime: Date;
  exitPrice: number;
  pnl: number;
  entryReason: string;
  exitReason: string;
}

export interface BacktestEngineResult {
  candlesProcessed: number;
  trades: SimulatedTrade[];
  assumptions: string[];
  message: string;
}

export function requiredCandleCountForCondition(condition: BacktestCondition) {
  const parameters = executableParameters(condition);
  if (!parameters) return 1;
  if (parameters.kind === "indicator") {
    return Math.max(parameters.period, parameters.fastPeriod ?? 1, parameters.slowPeriod ?? 1, parameters.signalPeriod ?? 1) + 1;
  }
  if (parameters.kind === "displacement") return parameters.atrPeriod + 1;
  if (parameters.kind === "fair_value_gap") return Math.max(3, parameters.lookback + 2);
  if (parameters.kind === "market_structure" || parameters.kind === "liquidity_level"
    || parameters.kind === "liquidity_sweep" || parameters.kind === "price_action"
    || parameters.kind === "range_location") {
    return parameters.lookback + 1;
  }
  return 1;
}

export class BacktestEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestEngineError";
  }
}

type PriceField = "open" | "high" | "low" | "close";

function normalizedRule(rule: string) {
  return normalizeHistoricalRule(rule);
}

function operandNumber(operand: string, candle: HistoricalCandle, previous: HistoricalCandle | undefined) {
  const value = operand.trim();
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const previousMatch = /^previous[_ ](open|high|low|close)$/.exec(value);
  if (previousMatch) {
    if (!previous) throw new BacktestEngineError(`Rule '${operand}' requires a previous candle.`);
    return previousMatch[1] === "open" ? previous.open
      : previousMatch[1] === "high" ? previous.high
        : previousMatch[1] === "low" ? previous.low : previous.close;
  }
  if (/^(open|high|low|close)$/.test(value)) return candle[value as PriceField];
  throw new BacktestEngineError(`Unsupported historical rule operand '${operand}'.`);
}

function evaluateClause(clause: string, candle: HistoricalCandle, previous: HistoricalCandle | undefined) {
  const compact = clause.trim();
  if (compact === "always") return true;
  if (compact === "bullish" || compact === "bullish candle") return candle.close > candle.open;
  if (compact === "bearish" || compact === "bearish candle") return candle.close < candle.open;
  const cross = /^(open|high|low|close) crosses (above|below) previous[_ ](open|high|low|close)$/.exec(compact);
  if (cross) {
    if (!previous) return false;
    const currentValue = operandNumber(cross[1], candle, previous);
    const previousValue = operandNumber(cross[1], previous, undefined);
    const targetValue = operandNumber(`previous_${cross[3]}`, candle, previous);
    const previousTarget = operandNumber(cross[3], previous, undefined);
    return cross[2] === "above"
      ? currentValue > targetValue && previousValue <= previousTarget
      : currentValue < targetValue && previousValue >= previousTarget;
  }
  const comparison = /^(open|high|low|close|previous[_ ](?:open|high|low|close))\s*(>=|<=|>|<|=|==)\s*(open|high|low|close|previous[_ ](?:open|high|low|close)|\d+(?:\.\d+)?)$/.exec(compact);
  if (!comparison) {
    throw new BacktestEngineError(`Unsupported historical rule '${clause}'. Use OHLC comparisons, bullish/bearish, or always.`);
  }
  const left = operandNumber(comparison[1], candle, previous);
  const right = operandNumber(comparison[3], candle, previous);
  switch (comparison[2]) {
    case ">": return left > right;
    case ">=": return left >= right;
    case "<": return left < right;
    case "<=": return left <= right;
    case "=":
    case "==": return left === right;
    default: return false;
  }
}

function evaluateRule(rule: string, candle: HistoricalCandle, previous: HistoricalCandle | undefined) {
  const normalized = normalizedRule(rule)
    .replace(/\s+and\s+/g, "&&")
    .replace(/\s+or\s+/g, "||");
  return normalized.split("||").some(group => group.split("&&").every(clause => evaluateClause(group === clause ? clause : clause, candle, previous)));
}

function executableParameters(condition: BacktestCondition): ExecutableConceptParameters | null {
  return normalizeExecutableParameters(condition.conceptName || condition.name, condition.parameters);
}

function levelForLiquidity(candles: HistoricalCandle[], index: number, level: "high" | "low", lookback: number) {
  const source = candles.slice(Math.max(0, index - lookback), index);
  if (source.length < lookback) return null;
  return level === "high"
    ? Math.max(...source.map(candle => candle.high))
    : Math.min(...source.map(candle => candle.low));
}

function fvgAt(candles: HistoricalCandle[], index: number, polarity: "bullish" | "bearish", minimumGap: number) {
  if (index < 2) return null;
  const first = candles[index - 2];
  const current = candles[index];
  if (polarity === "bullish") {
    const gap = current.low - first.high;
    return gap > minimumGap ? { low: first.high, high: current.low } : null;
  }
  const gap = first.low - current.high;
  return gap > minimumGap ? { low: current.high, high: first.low } : null;
}

function rollingLevel(candles: HistoricalCandle[], index: number, field: "high" | "low", lookback: number) {
  const source = candles.slice(Math.max(0, index - lookback), index);
  if (source.length < lookback) return null;
  return field === "high" ? Math.max(...source.map(candle => candle.high)) : Math.min(...source.map(candle => candle.low));
}

function priorPeriodLevel(candles: HistoricalCandle[], index: number, period: "day" | "week", field: "high" | "low") {
  const current = candles[index].openTime;
  const key = (date: Date) => period === "day"
    ? `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`
    : `${date.getUTCFullYear()}-${Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86400000 / 7)}`;
  const currentKey = key(current);
  const groups = new Map<string, HistoricalCandle[]>();
  for (const candle of candles.slice(0, index)) {
    const groupKey = key(candle.openTime);
    if (groupKey === currentKey) continue;
    const group = groups.get(groupKey) || [];
    group.push(candle);
    groups.set(groupKey, group);
  }
  const prior = [...groups.entries()].sort((a, b) => {
    const aTime = a[1][a[1].length - 1].openTime.getTime();
    const bTime = b[1][b[1].length - 1].openTime.getTime();
    return bTime - aTime;
  })[0]?.[1];
  if (!prior?.length) return null;
  return field === "high" ? Math.max(...prior.map(candle => candle.high)) : Math.min(...prior.map(candle => candle.low));
}

function evaluateMarketStructure(
  candles: HistoricalCandle[],
  index: number,
  parameters: Extract<ExecutableConceptParameters, { kind: "market_structure" }>,
) {
  const candle = candles[index];
  const priorHigh = rollingLevel(candles, index, "high", parameters.lookback);
  const priorLow = rollingLevel(candles, index, "low", parameters.lookback);
  if (priorHigh == null || priorLow == null) return false;
  const bullish = parameters.polarity === "bullish" || parameters.polarity === "auto";
  const bearish = parameters.polarity === "bearish" || parameters.polarity === "auto";
  if (parameters.signal === "swing_high" || parameters.signal === "higher_high") return bullish && candle.high > priorHigh;
  if (parameters.signal === "swing_low" || parameters.signal === "lower_low") return bearish && candle.low < priorLow;
  if (parameters.signal === "higher_low") return bullish && candle.low > priorLow;
  if (parameters.signal === "lower_high") return bearish && candle.high < priorHigh;
  const breaksBullish = candle.close > priorHigh;
  const breaksBearish = candle.close < priorLow;
  if (parameters.signal === "bos" || parameters.signal === "mss") {
    return (bullish && breaksBullish) || (bearish && breaksBearish);
  }
  let lastBreak: "bullish" | "bearish" | null = null;
  for (let previousIndex = Math.max(parameters.lookback, index - parameters.lookback * 4); previousIndex < index; previousIndex += 1) {
    const previousHigh = rollingLevel(candles, previousIndex, "high", parameters.lookback);
    const previousLow = rollingLevel(candles, previousIndex, "low", parameters.lookback);
    if (previousHigh != null && candles[previousIndex].close > previousHigh) lastBreak = "bullish";
    if (previousLow != null && candles[previousIndex].close < previousLow) lastBreak = "bearish";
  }
  return (bullish && breaksBullish && lastBreak === "bearish") || (bearish && breaksBearish && lastBreak === "bullish");
}

function evaluateLiquidityLevel(
  candles: HistoricalCandle[],
  index: number,
  parameters: Extract<ExecutableConceptParameters, { kind: "liquidity_level" }>,
) {
  const candle = candles[index];
  if (parameters.level === "previous_day_high" || parameters.level === "previous_day_low" || parameters.level === "previous_week_high" || parameters.level === "previous_week_low") {
    const period = parameters.level.includes("week") ? "week" : "day";
    const field = parameters.level.endsWith("high") ? "high" : "low";
    const level = priorPeriodLevel(candles, index, period, field);
    return level == null ? false : field === "high" ? candle.high >= level && candle.close <= level : candle.low <= level && candle.close >= level;
  }
  const field = parameters.level === "sell_side" || parameters.level === "equal_lows" ? "low" : "high";
  const level = rollingLevel(candles, index, field, parameters.lookback);
  if (level == null) return false;
  if (parameters.level === "equal_highs" || parameters.level === "equal_lows") {
    const values = candles.slice(index - parameters.lookback, index).map(item => field === "high" ? item.high : item.low);
    return values.some(value => Math.abs(value - (field === "high" ? candle.high : candle.low)) <= parameters.tolerance)
      && (field === "high" ? candle.high >= level : candle.low <= level);
  }
  return field === "high" ? candle.high >= level : candle.low <= level;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function averageTrueRangeBefore(candles: HistoricalCandle[], index: number, period: number) {
  if (index < period) return null;
  const trueRanges = candles.slice(index - period, index).map((candle, offset) => {
    const candleIndex = index - period + offset;
    const previous = candles[candleIndex - 1];
    return previous
      ? Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close))
      : candle.high - candle.low;
  });
  return average(trueRanges);
}

function indicatorValue(candles: HistoricalCandle[], index: number, parameters: Extract<ExecutableConceptParameters, { kind: "indicator" }>): number | null {
  const closes = candles.slice(0, index + 1).map(candle => candle.close);
  if (parameters.indicator === "sma") return closes.length >= parameters.period ? average(closes.slice(-parameters.period)) : null;
  if (parameters.indicator === "ema") {
    if (closes.length < parameters.period) return null;
    let ema = average(closes.slice(0, parameters.period))!;
    const multiplier = 2 / (parameters.period + 1);
    for (const close of closes.slice(parameters.period)) ema = (close - ema) * multiplier + ema;
    return ema;
  }
  if (parameters.indicator === "rsi") {
    if (closes.length <= parameters.period) return null;
    const changes = closes.slice(1).map((close, changeIndex) => close - closes[changeIndex]);
    const recent = changes.slice(-parameters.period);
    const gains = average(recent.map(change => Math.max(change, 0))) || 0;
    const losses = average(recent.map(change => Math.max(-change, 0))) || 0;
    return losses === 0 ? 100 : 100 - (100 / (1 + gains / losses));
  }
  if (parameters.indicator === "atr") {
    if (index < parameters.period) return null;
    const trueRanges = candles.slice(1, index + 1).map((candle, rangeIndex) => {
      const previous = candles[rangeIndex];
      return Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close));
    });
    return average(trueRanges.slice(-parameters.period));
  }
  if (parameters.indicator === "vwap") {
    const source = candles.slice(0, index + 1);
    const weighted = source.reduce((sum, candle) => sum + ((candle.high + candle.low + candle.close) / 3) * (candle.volume ?? 1), 0);
    const volume = source.reduce((sum, candle) => sum + (candle.volume ?? 1), 0);
    return volume ? weighted / volume : null;
  }
  if (closes.length < parameters.slowPeriod! + parameters.signalPeriod!) return null;
  const ema = (period: number, values: number[]) => {
    if (values.length < period) return null;
    let result = average(values.slice(0, period))!;
    const multiplier = 2 / (period + 1);
    for (const value of values.slice(period)) result = (value - result) * multiplier + result;
    return result;
  };
  const macdValues: number[] = [];
  for (let macdIndex = parameters.slowPeriod! - 1; macdIndex < closes.length; macdIndex += 1) {
    const prefix = closes.slice(0, macdIndex + 1);
    const fast = ema(parameters.fastPeriod!, prefix);
    const slow = ema(parameters.slowPeriod!, prefix);
    if (fast != null && slow != null) macdValues.push(fast - slow);
  }
  if (macdValues.length < parameters.signalPeriod!) return null;
  const macdLine = macdValues[macdValues.length - 1];
  const signal = ema(parameters.signalPeriod!, macdValues);
  return signal == null ? null : macdLine - signal;
}

function evaluateIndicator(candles: HistoricalCandle[], index: number, parameters: Extract<ExecutableConceptParameters, { kind: "indicator" }>) {
  const value = indicatorValue(candles, index, parameters);
  if (value == null) return false;
  const candle = candles[index];
  const current = parameters.indicator === "rsi" || parameters.indicator === "macd" || parameters.indicator === "atr"
    ? value
    : parameters.indicator === "vwap" || parameters.indicator === "ema" || parameters.indicator === "sma" ? candle.close - value : value;
  const threshold = parameters.indicator === "ema" || parameters.indicator === "sma" || parameters.indicator === "vwap" ? 0 : parameters.threshold ?? 0;
  if (parameters.comparison === "above") return current > threshold;
  if (parameters.comparison === "below") return current < threshold;
  if (index === 0) return false;
  const previous = indicatorValue(candles, index - 1, parameters);
  if (previous == null) return false;
  const previousCurrent = parameters.indicator === "ema" || parameters.indicator === "sma" || parameters.indicator === "vwap"
    ? candles[index - 1].close - previous : previous;
  return parameters.comparison === "cross_above" ? current > threshold && previousCurrent <= threshold : current < threshold && previousCurrent >= threshold;
}

function evaluatePriceAction(candles: HistoricalCandle[], index: number, parameters: Extract<ExecutableConceptParameters, { kind: "price_action" }>) {
  const candle = candles[index];
  const previous = candles[index - 1];
  if (!previous) return false;
  const bullish = parameters.polarity === "bullish" || parameters.polarity === "auto";
  const bearish = parameters.polarity === "bearish" || parameters.polarity === "auto";
  if (parameters.pattern === "bullish_engulfing") return bullish && previous.close < previous.open && candle.close > candle.open && candle.open <= previous.close && candle.close >= previous.open;
  if (parameters.pattern === "bearish_engulfing") return bearish && previous.close > previous.open && candle.close < candle.open && candle.open >= previous.close && candle.close <= previous.open;
  if (parameters.pattern === "inside_bar") return candle.high < previous.high && candle.low > previous.low;
  if (parameters.pattern === "pin_bar") {
    const body = Math.abs(candle.close - candle.open);
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    return Math.max(upperWick, lowerWick) >= Math.max(body, 1e-12) * parameters.wickRatio;
  }
  const priorHigh = rollingLevel(candles, index, "high", parameters.lookback);
  const priorLow = rollingLevel(candles, index, "low", parameters.lookback);
  if (priorHigh == null || priorLow == null) return false;
  if (parameters.pattern === "breakout") return (bullish && candle.close > priorHigh) || (bearish && candle.close < priorLow);
  if (parameters.pattern === "support") return candle.low <= priorLow && candle.close > priorLow;
  if (parameters.pattern === "resistance") return candle.high >= priorHigh && candle.close < priorHigh;
  for (let breakoutIndex = Math.max(parameters.lookback, index - parameters.lookback); breakoutIndex < index; breakoutIndex += 1) {
    const breakoutHigh = rollingLevel(candles, breakoutIndex, "high", parameters.lookback);
    const breakoutLow = rollingLevel(candles, breakoutIndex, "low", parameters.lookback);
    if (bullish && breakoutHigh != null && candles[breakoutIndex].close > breakoutHigh && candle.low <= breakoutHigh && candle.close >= breakoutHigh) return true;
    if (bearish && breakoutLow != null && candles[breakoutIndex].close < breakoutLow && candle.high >= breakoutLow && candle.close <= breakoutLow) return true;
  }
  return false;
}

function evaluateRangeLocation(candles: HistoricalCandle[], index: number, parameters: Extract<ExecutableConceptParameters, { kind: "range_location" }>) {
  const high = rollingLevel(candles, index, "high", parameters.lookback);
  const low = rollingLevel(candles, index, "low", parameters.lookback);
  if (high == null || low == null || high <= low) return false;
  const midpoint = low + (high - low) / 2;
  return parameters.location === "premium" ? candles[index].close > midpoint
    : parameters.location === "discount" ? candles[index].close < midpoint
      : candles[index].close === midpoint;
}

function evaluateExecutableCondition(
  condition: BacktestCondition,
  side: BacktestSide,
  candles: HistoricalCandle[],
  index: number,
) {
  const parameters = executableParameters(condition);
  if (!parameters) return null;
  const candle = candles[index];
  if (parameters.kind === "liquidity_sweep") {
    const sweepSide = parameters.sweepSide === "auto"
      ? side === "long" ? "sell_side" : "buy_side"
      : parameters.sweepSide;
    const level = levelForLiquidity(
      candles,
      index,
      sweepSide === "buy_side" ? "high" : "low",
      parameters.level === "previous_candle" ? 1 : parameters.lookback,
    );
    if (level == null) return false;
    return sweepSide === "buy_side"
      ? candle.high > level && candle.close < level
      : candle.low < level && candle.close > level;
  }

  if (parameters.kind === "fair_value_gap") {
    const polarity = parameters.polarity === "auto"
      ? side === "long" ? "bullish" : "bearish"
      : parameters.polarity;
    if (parameters.interaction === "formation") {
      if (!parameters.inverse) return fvgAt(candles, index, polarity, parameters.minimumGap) !== null;
      return false;
    }
    if (parameters.inverse) {
      const start = Math.max(2, index - parameters.lookback);
      for (let formationIndex = index - 1; formationIndex >= start; formationIndex -= 1) {
        const polarities = parameters.polarity === "auto" ? ["bullish", "bearish"] as const : [polarity];
        for (const sourcePolarity of polarities) {
          const zone = fvgAt(candles, formationIndex, sourcePolarity, parameters.minimumGap);
          if (zone && (sourcePolarity === "bullish" ? candle.close < zone.low : candle.close > zone.high)) return true;
        }
      }
      return false;
    }
    const start = Math.max(2, index - parameters.lookback);
    for (let formationIndex = index - 1; formationIndex >= start; formationIndex -= 1) {
      const zone = fvgAt(candles, formationIndex, polarity, parameters.minimumGap);
      if (!zone) continue;
      if (candle.high >= zone.low && candle.low <= zone.high) return true;
    }
    return false;
  }
  if (parameters.kind === "displacement") {
    const atr = averageTrueRangeBefore(candles, index, parameters.atrPeriod);
    const range = candle.high - candle.low;
    const body = Math.abs(candle.close - candle.open);
    if (atr == null || atr <= 0 || range <= 0 || body < atr * parameters.minimumBodyAtr) return false;
    const bullish = candle.close > candle.open;
    const bearish = candle.close < candle.open;
    const direction = parameters.polarity === "auto"
      ? side === "long" ? "bullish" : "bearish"
      : parameters.polarity;
    if (direction === "bullish" && (!bullish || (candle.close - candle.low) / range < parameters.minimumCloseLocation)) return false;
    if (direction === "bearish" && (!bearish || (candle.high - candle.close) / range < parameters.minimumCloseLocation)) return false;
    return true;
  }
  if (parameters.kind === "market_structure") return evaluateMarketStructure(candles, index, parameters);
  if (parameters.kind === "liquidity_level") return evaluateLiquidityLevel(candles, index, parameters);
  if (parameters.kind === "indicator") return evaluateIndicator(candles, index, parameters);
  if (parameters.kind === "price_action") return evaluatePriceAction(candles, index, parameters);
  if (parameters.kind === "range_location") return evaluateRangeLocation(candles, index, parameters);
  return false;
}

export function evaluateExecutableConditionAtLatest(
  condition: BacktestCondition,
  candles: HistoricalCandle[],
): boolean | null {
  if (!candles.length) return false;
  const rule = condition.triggerRules?.trim() || condition.conceptDetectionRules?.trim();
  if (!executableParameters(condition)) {
    if (!rule?.trim()) return null;
    try {
      return evaluateRule(rule, candles[candles.length - 1], candles[candles.length - 2]);
    } catch {
      return null;
    }
  }
  const sides: BacktestSide[] = condition.direction === "short"
    ? ["short"]
    : condition.direction === "long"
      ? ["long"]
      : ["long", "short"];
  return sides.some(side => evaluateExecutableCondition(condition, side, candles, candles.length - 1) === true);
}

export function validateHistoricalRule(rule: string) {
  return historicalRuleCompatibilityError(rule);
}

export function validateHistoricalBacktestStrategy(strategy: BacktestStrategy) {
  const errors: string[] = [];
  const entryConditions = strategy.conditions.filter(condition => condition.stage === "entry" || condition.stage === "confirmation");
  const exitConditions = strategy.conditions.filter(condition => condition.stage === "exit" || condition.stage === "invalidation");
  if (!entryConditions.length && !strategy.entryRules?.trim()) {
    errors.push("This strategy version has no executable entry rule.");
  }
  for (const condition of [...entryConditions, ...exitConditions]) {
    try {
      if (condition.conceptName && condition.parameters != null && !executableParameters(condition)) {
        errors.push(`${condition.name}: executable parameters are invalid.`);
        continue;
      }
      if (executableParameters(condition)) continue;
      const rule = ruleForCondition(condition);
      const error = validateHistoricalRule(rule);
      if (error) errors.push(`${condition.name}: ${error}`);
    } catch (error) {
      errors.push(error instanceof Error ? `${condition.name}: ${error.message}` : `${condition.name}: no executable historical rule.`);
    }
  }
  if (strategy.exitRules?.trim()) {
    const error = validateHistoricalRule(strategy.exitRules);
    if (error) errors.push(`Exit rules: ${error}`);
  }
  if (strategy.riskRules?.trim()) {
    try {
      parseRiskRules(strategy.riskRules);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Risk rules are not supported by the historical engine.");
    }
  }
  return [...new Set(errors)];
}

function ruleForCondition(condition: BacktestCondition) {
  if (executableParameters(condition)) return "always";
  const rule = condition.triggerRules?.trim() || condition.conceptDetectionRules?.trim();
  if (!rule) throw new BacktestEngineError(`Condition '${condition.name}' has no executable historical rule.`);
  return rule;
}

function parseRiskRules(riskRules: string | null) {
  if (!riskRules?.trim()) return { stopLossPercent: null, takeProfitPercent: null };
  const stopLoss = /(?:stop[- ]loss|sl)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i.exec(riskRules);
  const takeProfit = /(?:take[- ]profit|tp)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i.exec(riskRules);
  if (/(?:stop[- ]loss|sl|take[- ]profit|tp)/i.test(riskRules) && (!stopLoss && !takeProfit)) {
    throw new BacktestEngineError("Risk rules mention stop-loss or take-profit but do not use a supported percentage form such as 'stop-loss: 1%' or 'take-profit: 2%'.");
  }
  return {
    stopLossPercent: stopLoss ? Number(stopLoss[1]) / 100 : null,
    takeProfitPercent: takeProfit ? Number(takeProfit[1]) / 100 : null,
  };
}

function conditionMatches(condition: BacktestCondition, side: BacktestSide) {
  return condition.direction === "both" || condition.direction === side;
}

function timeframeKey(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function candleCompletionTime(candle: HistoricalCandle) {
  return (candle.closeTime ?? candle.openTime).getTime();
}

function latestCompletedIndex(candles: HistoricalCandle[], at: Date) {
  let low = 0;
  let high = candles.length - 1;
  let result = -1;
  const target = at.getTime();
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].isClosed && candleCompletionTime(candles[middle]) <= target) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

interface MultiTimeframeEvaluationContext {
  seriesByTimeframe: Map<string, HistoricalCandle[]>;
  executionTimeframe: string;
}

function evaluateConditions(
  conditions: BacktestCondition[],
  side: BacktestSide,
  candles: HistoricalCandle[],
  index: number,
  context?: MultiTimeframeEvaluationContext,
) {
  const candle = candles[index];
  const previous = index > 0 ? candles[index - 1] : undefined;
  const selected = conditions.filter(condition => conditionMatches(condition, side));
  const required = selected.filter(condition => condition.requirement === "required");
  const optional = selected.filter(condition => condition.requirement === "optional");
  if (!required.length && !optional.length) return { matched: false, reasons: [] as string[] };
  const evaluate = (condition: BacktestCondition) => {
    if (!context) {
      return evaluateExecutableCondition(condition, side, candles, index)
        ?? evaluateRule(ruleForCondition(condition), candle, previous);
    }
    const series = context.seriesByTimeframe.get(timeframeKey(condition.timeframe || context.executionTimeframe));
    if (!series) return false;
    const conditionIndex = latestCompletedIndex(series, candle.closeTime ?? candle.openTime);
    if (conditionIndex < 0) return false;
    const conditionCandle = series[conditionIndex];
    const conditionPrevious = conditionIndex > 0 ? series[conditionIndex - 1] : undefined;
    const rule = ruleForCondition(condition);
    if (!conditionPrevious && /\bprevious[_ ](open|high|low|close)\b/i.test(rule)) return false;
    return evaluateExecutableCondition(condition, side, series, conditionIndex)
      ?? evaluateRule(rule, conditionCandle, conditionPrevious);
  };
  const requiredResults = required.map(condition => ({ condition, matched: evaluate(condition) }));
  const optionalResults = optional.map(condition => ({ condition, matched: evaluate(condition) }));
  return {
    matched: requiredResults.every(result => result.matched),
    reasons: [...requiredResults, ...optionalResults].filter(result => result.matched).map(result => result.condition.name),
  };
}

function inferSide(
  strategy: BacktestStrategy,
  entryConditions: BacktestCondition[],
  candles: HistoricalCandle[],
  index: number,
  context?: MultiTimeframeEvaluationContext,
): BacktestSide | null {
  const candle = candles[index];
  const previous = index > 0 ? candles[index - 1] : undefined;
  if (strategy.direction === "long") return "long";
  if (strategy.direction === "short") return "short";
  const explicit = entryConditions.filter(condition => condition.direction !== "both");
  if (explicit.length) {
    const long = evaluateConditions(entryConditions, "long", candles, index, context).matched;
    const short = evaluateConditions(entryConditions, "short", candles, index, context).matched;
    if (long === short) return null;
    return long ? "long" : "short";
  }
  const bullish = evaluateRule("bullish", candle, previous);
  const bearish = evaluateRule("bearish", candle, previous);
  if (bullish && !bearish) return "long";
  if (bearish && !bullish) return "short";
  return null;
}

export function runHistoricalBacktest(
  strategy: BacktestStrategy,
  input: HistoricalCandle[] | HistoricalBacktestInput,
): BacktestEngineResult {
  const isMultiTimeframe = !Array.isArray(input);
  const candles = isMultiTimeframe
    ? [...input.series.find(series => timeframeKey(series.code) === timeframeKey(input.executionTimeframe))?.candles || []]
      .filter(candle => candle.isClosed)
      .sort((left, right) => left.openTime.getTime() - right.openTime.getTime())
    : [...input].filter(candle => candle.isClosed).sort((left, right) => left.openTime.getTime() - right.openTime.getTime());
  const context = isMultiTimeframe
    ? {
      executionTimeframe: input.executionTimeframe,
      seriesByTimeframe: new Map(input.series.map(series => [
        timeframeKey(series.code),
        [...series.candles].filter(candle => candle.isClosed).sort((left, right) => left.openTime.getTime() - right.openTime.getTime()),
      ])),
    }
    : undefined;
  if (!candles.length) throw new BacktestEngineError("Insufficient historical data for the selected instrument and period.");
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle.isClosed) throw new BacktestEngineError("Historical data contains an open candle; the backtest requires completed candles.");
    if (index > 0 && candle.openTime <= candles[index - 1].openTime) {
      throw new BacktestEngineError("Historical data is not strictly chronological and cannot be evaluated safely.");
    }
  }

  const entryConditions = strategy.conditions.filter(condition => condition.stage === "entry" || condition.stage === "confirmation");
  const exitConditions = strategy.conditions.filter(condition => condition.stage === "exit" || condition.stage === "invalidation");
  const entryRule = strategy.entryRules?.trim();
  const exitRule = strategy.exitRules?.trim();
  if (!entryConditions.length && !entryRule) {
    throw new BacktestEngineError("This strategy version has no executable entry rule. Add a supported OHLC rule to an entry checkpoint or entry rules.");
  }
  for (const condition of [...entryConditions, ...exitConditions]) {
    if (!executableParameters(condition)) ruleForCondition(condition);
  }
  if (exitRule && exitConditions.length === 0) evaluateRule(exitRule, candles[0], undefined);
  const risk = parseRiskRules(strategy.riskRules);
  const assumptions = [
    "Only completed provider candles are evaluated from oldest to newest.",
    "Signals evaluated at candle close execute at the next candle open.",
    "Protective levels use OHLC only; when stop-loss and take-profit are both touched in one candle, stop-loss is conservatively assumed first.",
    "Any open position is closed at the final candle close with reason end_of_period.",
  ];
  const trades: SimulatedTrade[] = [];
  let position: (SimulatedTrade & { exitTime: Date; exitPrice: number; pnl: number }) | null = null;
  let pendingEntry: { side: BacktestSide; reason: string } | null = null;
  let pendingExitReason: string | null = null;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = index > 0 ? candles[index - 1] : undefined;
    let exitedThisCandle = false;
    if (!position && pendingEntry) {
      const stopLoss = risk.stopLossPercent == null ? null : pendingEntry.side === "long"
        ? candle.open * (1 - risk.stopLossPercent)
        : candle.open * (1 + risk.stopLossPercent);
      const takeProfit = risk.takeProfitPercent == null ? null : pendingEntry.side === "long"
        ? candle.open * (1 + risk.takeProfitPercent)
        : candle.open * (1 - risk.takeProfitPercent);
      position = {
        side: pendingEntry.side,
        entryTime: candle.openTime,
        entryPrice: candle.open,
        stopLoss,
        takeProfit,
        exitTime: candle.openTime,
        exitPrice: candle.open,
        pnl: 0,
        entryReason: pendingEntry.reason,
        exitReason: "",
      };
      pendingEntry = null;
    }

    if (position && pendingExitReason) {
      position.exitTime = candle.openTime;
      position.exitPrice = candle.open;
      position.pnl = position.side === "long" ? candle.open - position.entryPrice : position.entryPrice - candle.open;
      position.exitReason = pendingExitReason;
      trades.push(position);
      position = null;
      pendingExitReason = null;
      exitedThisCandle = true;
    }

    if (position) {
      const stopTouched = position.stopLoss != null && (position.side === "long" ? candle.low <= position.stopLoss : candle.high >= position.stopLoss);
      const targetTouched = position.takeProfit != null && (position.side === "long" ? candle.high >= position.takeProfit : candle.low <= position.takeProfit);
      if (stopTouched || targetTouched) {
        const useStop = stopTouched;
        position.exitTime = candle.openTime;
        position.exitPrice = useStop ? position.stopLoss! : position.takeProfit!;
        position.pnl = position.side === "long" ? position.exitPrice - position.entryPrice : position.entryPrice - position.exitPrice;
        position.exitReason = useStop
          ? stopTouched && targetTouched ? "stop_loss_first_same_candle_ambiguity" : "stop_loss"
          : "take_profit";
        trades.push(position);
        position = null;
        exitedThisCandle = true;
      }
    }

    if (position) {
      const exitMatched = exitConditions.length
      ? evaluateConditions(exitConditions, position.side, candles, index, context).matched
        : exitRule ? evaluateRule(exitRule, candle, previous) : false;
      if (exitMatched) pendingExitReason = exitConditions.length
        ? `exit_condition:${exitConditions.filter(condition => conditionMatches(condition, position!.side)).map(condition => condition.name).join(",")}`
        : "exit_rule";
    }

    if (!position && !pendingEntry && !exitedThisCandle && index < candles.length - 1) {
      const side = inferSide(strategy, entryConditions, candles, index, context);
      const entryMatched = entryConditions.length
        ? side != null && evaluateConditions(entryConditions, side, candles, index, context).matched
        : entryRule ? evaluateRule(entryRule, candle, previous) : false;
      if (entryMatched && side) {
        pendingEntry = {
          side,
          reason: entryConditions.length
            ? `entry_conditions:${entryConditions.filter(condition => conditionMatches(condition, side)).map(condition => condition.name).join(",")}`
            : "entry_rule",
        };
      }
    }
  }

  if (position) {
    const last = candles[candles.length - 1];
    position.exitTime = last.closeTime ?? last.openTime;
    position.exitPrice = last.close;
    position.pnl = position.side === "long" ? last.close - position.entryPrice : position.entryPrice - last.close;
    position.exitReason = "end_of_period";
    trades.push(position);
  }

  return {
    candlesProcessed: candles.length,
    trades,
    assumptions,
    message: trades.length ? `${trades.length} simulated trade${trades.length === 1 ? "" : "s"} completed.` : "0 trades found for this strategy and period.",
  };
}