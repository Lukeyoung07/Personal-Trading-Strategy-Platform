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
  stage: "entry" | "confirmation" | "invalidation" | "exit";
  direction: "long" | "short" | "both";
  requirement: "required" | "optional";
  triggerRules: string | null;
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

export class BacktestEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestEngineError";
  }
}

type PriceField = "open" | "high" | "low" | "close";

function normalizedRule(rule: string) {
  return rule
    .trim()
    .toLowerCase()
    .replace(/[()[\],]/g, " ")
    .replace(/\s+/g, " ");
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

function ruleForCondition(condition: BacktestCondition) {
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

function evaluateConditions(conditions: BacktestCondition[], side: BacktestSide, candle: HistoricalCandle, previous: HistoricalCandle | undefined) {
  const selected = conditions.filter(condition => conditionMatches(condition, side));
  const required = selected.filter(condition => condition.requirement === "required");
  const optional = selected.filter(condition => condition.requirement === "optional");
  if (!required.length && !optional.length) return { matched: false, reasons: [] as string[] };
  const requiredResults = required.map(condition => ({ condition, matched: evaluateRule(ruleForCondition(condition), candle, previous) }));
  const optionalResults = optional.map(condition => ({ condition, matched: evaluateRule(ruleForCondition(condition), candle, previous) }));
  return {
    matched: requiredResults.every(result => result.matched),
    reasons: [...requiredResults, ...optionalResults].filter(result => result.matched).map(result => result.condition.name),
  };
}

function inferSide(strategy: BacktestStrategy, entryConditions: BacktestCondition[], candle: HistoricalCandle, previous: HistoricalCandle | undefined): BacktestSide | null {
  if (strategy.direction === "long") return "long";
  if (strategy.direction === "short") return "short";
  const explicit = entryConditions.filter(condition => condition.direction !== "both");
  if (explicit.length) {
    const long = evaluateConditions(entryConditions, "long", candle, previous).matched;
    const short = evaluateConditions(entryConditions, "short", candle, previous).matched;
    if (long === short) return null;
    return long ? "long" : "short";
  }
  const bullish = evaluateRule("bullish", candle, previous);
  const bearish = evaluateRule("bearish", candle, previous);
  if (bullish && !bearish) return "long";
  if (bearish && !bullish) return "short";
  return null;
}

export function runHistoricalBacktest(strategy: BacktestStrategy, inputCandles: HistoricalCandle[]): BacktestEngineResult {
  const candles = [...inputCandles];
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
  for (const condition of [...entryConditions, ...exitConditions]) ruleForCondition(condition);
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
        ? evaluateConditions(exitConditions, position.side, candle, previous).matched
        : exitRule ? evaluateRule(exitRule, candle, previous) : false;
      if (exitMatched) pendingExitReason = exitConditions.length
        ? `exit_condition:${exitConditions.filter(condition => conditionMatches(condition, position!.side)).map(condition => condition.name).join(",")}`
        : "exit_rule";
    }

    if (!position && !pendingEntry && !exitedThisCandle && index < candles.length - 1) {
      const side = inferSide(strategy, entryConditions, candle, previous);
      const entryMatched = entryConditions.length
        ? side != null && evaluateConditions(entryConditions, side, candle, previous).matched
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