import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, isNotNull, max, avg, min, sql, sum } from "drizzle-orm";
import {
  db,
  alertsTable,
  candlesTable,
  conditionsTable,
  marketsTable,
  performanceRecordsTable,
  sourceInstrumentMappingsTable,
  strategiesTable,
  strategyConditionsTable,
  strategyMonitorSessionsTable,
  strategyVersionConditionsTable,
  strategyVersionsTable,
  tradesTable,
  tradingConceptsTable,
  userSettingsTable,
} from "@workspace/db";
import {
  ActivateStrategyVersionParams,
  ActivateStrategyVersionResponse,
  CloneStrategyVersionBody,
  CloneStrategyVersionParams,
  CloneStrategyVersionResponse,
  CreateAlertBody,
  CreateAlertResponse,
  CreateConditionBody,
  CreateConditionResponse,
  CreateConceptBody,
  CreateConceptResponse,
  CreateMarketBody,
  CreateMarketResponse,
  CreateStrategyBody,
  CreateStrategyResponse,
  CreateStrategyVersionBody,
  CreateStrategyVersionResponse,
  DuplicateStrategyBody,
  DuplicateStrategyResponse,
  CreateStrategyConditionBody,
  CreateStrategyConditionResponse,
  CreateTradeBody,
  CreateTradeResponse,
  DeleteAlertParams,
  DeleteConditionParams,
  DeleteConceptParams,
  DeleteMarketParams,
  DeleteStrategyParams,
  DeleteTradeParams,
  DeleteStrategyConditionParams,
  GetDashboardSummaryResponse,
  GetJournalPerformanceQueryParams,
  GetJournalPerformanceResponse,
  GetPerformanceSummaryResponse,
  GetSettingsResponse,
  GetStrategyParams,
  GetStrategyResponse,
  ListAlertsResponse,
  ListConditionsResponse,
  ListConceptsResponse,
  ListMarketsResponse,
  ListStrategiesResponse,
  ListStrategyVersionsParams,
  ListStrategyVersionsResponse,
  ListStrategyVersionConditionsParams,
  ListStrategyVersionConditionsResponse,
  ListStrategyConditionsParams,
  ListStrategyConditionsResponse,
  ListTradesResponse,
  UpdateJournalDayNoteBody,
  UpdateJournalDayNoteParams,
  UpdateJournalDayNoteResponse,
  UpdateAlertBody,
  UpdateAlertParams,
  UpdateAlertResponse,
  UpdateConditionBody,
  UpdateConditionParams,
  UpdateConditionResponse,
  UpdateConceptBody,
  UpdateConceptParams,
  UpdateConceptResponse,
  UpdateMarketBody,
  UpdateMarketParams,
  UpdateMarketResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
  UpdateStrategyBody,
  UpdateStrategyParams,
  UpdateStrategyResponse,
  UpdateStrategyConditionBody,
  UpdateStrategyConditionParams,
  UpdateStrategyConditionResponse,
  ReorderStrategyConditionsBody,
  ReorderStrategyConditionsResponse,
  UpdateTradeBody,
  UpdateTradeParams,
  UpdateTradeResponse,
  executableConceptKind,
  normalizeExecutableParameters,
} from "@workspace/api-zod";

const router: IRouter = Router();

function conditionParameters(conceptName: string | null | undefined, value: unknown) {
  if (!executableConceptKind(conceptName)) return value ?? null;
  const parameters = normalizeExecutableParameters(conceptName, value);
  if (!parameters) throw new Error(`Parameters for ${conceptName} are invalid.`);
  return parameters;
}

const DEFAULT_CONCEPTS = [
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
] as const;

const EXECUTABLE_CONCEPT_METADATA: Record<string, { description: string; detectionRules: string }> = {
  "Liquidity Sweep": {
    description: "A prior high or low is swept and the candle closes back inside that level.",
    detectionRules: "Structured detector: previous candle or prior lookback extreme; close-back-inside confirmation.",
  },
  "Bullish FVG": {
    description: "A bullish three-candle fair value gap, optionally retested.",
    detectionRules: "Structured detector: current low is above the high two candles earlier.",
  },
  "Bearish FVG": {
    description: "A bearish three-candle fair value gap, optionally retested.",
    detectionRules: "Structured detector: current high is below the low two candles earlier.",
  },
  "Fair Value Gap": {
    description: "A three-candle fair value gap, optionally retested.",
    detectionRules: "Structured detector: bullish or bearish three-candle gap, with formation or retest interaction.",
  },
  "FVG Retest": {
    description: "A previously formed fair value gap is revisited by a later candle.",
    detectionRules: "Structured detector: prior three-candle gap within the configured retest lookback.",
  },
  "FVG Fill": {
    description: "A previously formed fair value gap is interacted with by a later candle.",
    detectionRules: "Structured detector: prior three-candle gap within the configured retest lookback.",
  },
  "Inverse Fair Value Gap": {
    description: "A prior fair value gap is invalidated by a close through its opposite boundary.",
    detectionRules: "Structured detector: prior three-candle gap followed by a close through the gap boundary.",
  },
  "Higher High": {
    description: "The candle high exceeds the established prior rolling structure high.",
    detectionRules: "Structured detector: current high above the prior lookback high.",
  },
  "Higher Low": {
    description: "The candle low remains above the established prior rolling structure low.",
    detectionRules: "Structured detector: current low above the prior lookback low.",
  },
  "Lower High": {
    description: "The candle high remains below the established prior rolling structure high.",
    detectionRules: "Structured detector: current high below the prior lookback high.",
  },
  "Lower Low": {
    description: "The candle low falls below the established prior rolling structure low.",
    detectionRules: "Structured detector: current low below the prior lookback low.",
  },
  "Swing High": {
    description: "A causal rolling swing high above the prior lookback high.",
    detectionRules: "Structured detector: current high above the prior lookback high.",
  },
  "Swing Low": {
    description: "A causal rolling swing low below the prior lookback low.",
    detectionRules: "Structured detector: current low below the prior lookback low.",
  },
  "Break of Structure": {
    description: "The candle closes beyond the established prior rolling structure level.",
    detectionRules: "Structured detector: close above prior high or below prior low.",
  },
  "Change of Character": {
    description: "A directional structure break opposite to the most recent detected structure break.",
    detectionRules: "Structured detector: opposite-direction close break after a prior structure break.",
  },
  "Market Structure Shift": {
    description: "A directional close break through a prior rolling structure level.",
    detectionRules: "Structured detector: bullish or bearish close break.",
  },
  "Buy-Side Liquidity": {
    description: "Price reaches a prior rolling high where buy-side liquidity is defined.",
    detectionRules: "Structured detector: current high reaches the prior lookback high.",
  },
  "Sell-Side Liquidity": {
    description: "Price reaches a prior rolling low where sell-side liquidity is defined.",
    detectionRules: "Structured detector: current low reaches the prior lookback low.",
  },
  "Equal Highs": {
    description: "The current high matches a prior rolling high within the configured tolerance.",
    detectionRules: "Structured detector: prior lookback high match within price tolerance.",
  },
  "Equal Lows": {
    description: "The current low matches a prior rolling low within the configured tolerance.",
    detectionRules: "Structured detector: prior lookback low match within price tolerance.",
  },
  "Previous Day High": {
    description: "The current candle interacts with the most recent completed UTC day high.",
    detectionRules: "Structured detector: prior calendar-day high is reached and rejected.",
  },
  "Previous Day Low": {
    description: "The current candle interacts with the most recent completed UTC day low.",
    detectionRules: "Structured detector: prior calendar-day low is reached and rejected.",
  },
  "Previous Week High": {
    description: "The current candle interacts with the most recent completed UTC week high.",
    detectionRules: "Structured detector: prior calendar-week high is reached and rejected.",
  },
  "Previous Week Low": {
    description: "The current candle interacts with the most recent completed UTC week low.",
    detectionRules: "Structured detector: prior calendar-week low is reached and rejected.",
  },
  "EMA": {
    description: "An exponential moving average condition evaluated from completed closes.",
    detectionRules: "Structured detector: EMA period and above/below comparison.",
  },
  "SMA": {
    description: "A simple moving average condition evaluated from completed closes.",
    detectionRules: "Structured detector: SMA period and above/below comparison.",
  },
  "RSI": {
    description: "A relative strength index threshold condition from completed closes.",
    detectionRules: "Structured detector: RSI period and threshold comparison.",
  },
  "RSI Overbought": {
    description: "RSI is above the configured overbought threshold.",
    detectionRules: "Structured detector: RSI period and threshold comparison.",
  },
  "RSI Oversold": {
    description: "RSI is below the configured oversold threshold.",
    detectionRules: "Structured detector: RSI period and threshold comparison.",
  },
  "MACD": {
    description: "A moving-average convergence/divergence condition from completed closes.",
    detectionRules: "Structured detector: fast, slow, signal periods and comparison.",
  },
  "MACD Cross": {
    description: "A MACD line cross condition from completed closes.",
    detectionRules: "Structured detector: fast, slow, signal periods and cross direction.",
  },
  "VWAP": {
    description: "A cumulative volume-weighted average price condition.",
    detectionRules: "Structured detector: typical price weighted by available candle volume.",
  },
  "ATR": {
    description: "An average true range threshold condition from completed OHLC candles.",
    detectionRules: "Structured detector: true-range average period and threshold.",
  },
  "Breakout": {
    description: "A close beyond the prior rolling high or low.",
    detectionRules: "Structured detector: close beyond prior lookback range.",
  },
  "Break and Retest": {
    description: "A prior rolling-range breakout level is revisited and held.",
    detectionRules: "Structured detector: prior close breakout followed by a level retest.",
  },
  "Breakout Retest": {
    description: "A prior rolling-range breakout level is revisited and held.",
    detectionRules: "Structured detector: prior close breakout followed by a level retest.",
  },
  "Bullish Engulfing": {
    description: "A bullish candle fully engulfs the prior bearish candle body.",
    detectionRules: "Structured detector: two-candle OHLC body relationship.",
  },
  "Bearish Engulfing": {
    description: "A bearish candle fully engulfs the prior bullish candle body.",
    detectionRules: "Structured detector: two-candle OHLC body relationship.",
  },
  "Pin Bar": {
    description: "A candle with a wick at least the configured multiple of its body.",
    detectionRules: "Structured detector: OHLC wick-to-body ratio.",
  },
  "Inside Bar": {
    description: "The candle range is contained inside the preceding candle range.",
    detectionRules: "Structured detector: current high below prior high and low above prior low.",
  },
  "Support": {
    description: "Price reaches the prior rolling low and closes back above it.",
    detectionRules: "Structured detector: prior rolling low interaction and rejection.",
  },
  "Resistance": {
    description: "Price reaches the prior rolling high and closes back below it.",
    detectionRules: "Structured detector: prior rolling high interaction and rejection.",
  },
  "Displacement": {
    description: "A directional candle has a body at least the configured ATR multiple and closes near its directional extreme.",
    detectionRules: "Structured detector: body >= minimumBodyAtr × prior ATR and directional close location >= minimumCloseLocation.",
  },
  "Premium": {
    description: "The close is above the midpoint of the established rolling range.",
    detectionRules: "Structured detector: prior rolling high-low midpoint.",
  },
  "Discount": {
    description: "The close is below the midpoint of the established rolling range.",
    detectionRules: "Structured detector: prior rolling high-low midpoint.",
  },
  "Equilibrium": {
    description: "The close equals the midpoint of the established rolling range.",
    detectionRules: "Structured detector: prior rolling high-low midpoint.",
  },
};

async function ensureBuiltInConcepts(): Promise<void> {
  const existing = await db
    .select({ name: tradingConceptsTable.name })
    .from(tradingConceptsTable)
    .where(eq(tradingConceptsTable.isBuiltIn, true));
  const existingNames = new Set(existing.map(({ name }) => name));
  const missing = DEFAULT_CONCEPTS.filter(([, name]) => !existingNames.has(name)).map(([category, name]) => ({
    category,
    name,
    description: null,
    detectionRules: null,
    invalidationRules: null,
    isBuiltIn: true,
  }));
  if (missing.length > 0) {
    await db.insert(tradingConceptsTable).values(missing);
  }
  for (const [name, metadata] of Object.entries(EXECUTABLE_CONCEPT_METADATA)) {
    await db.update(tradingConceptsTable).set(metadata).where(and(
      eq(tradingConceptsTable.name, name),
      eq(tradingConceptsTable.isBuiltIn, true),
    ));
  }
}

const nullableNumber = (value: string | number | null | undefined): number | null =>
  value == null ? null : Number(value);

function calculateTradeMetrics(rows: Array<{ status: string; pnl: string | number | null }>) {
  const closed = rows.filter(row => row.status === "closed");
  const pnlValues = closed.map(row => nullableNumber(row.pnl)).filter((value): value is number => value != null);
  const wins = pnlValues.filter(value => value > 0).length;
  return {
    tradeCount: rows.length,
    winRate: pnlValues.length ? Number(((wins / pnlValues.length) * 100).toFixed(2)) : null,
    netPnl: pnlValues.length ? Number(pnlValues.reduce((total, value) => total + value, 0).toFixed(2)) : null,
    averagePnl: pnlValues.length ? Number((pnlValues.reduce((total, value) => total + value, 0) / pnlValues.length).toFixed(2)) : null,
  };
}

function roundMetric(value: number) {
  return Number(value.toFixed(2));
}

function calculateJournalPerformance(rows: Array<{
  trade: typeof tradesTable.$inferSelect;
  strategyId: number;
  strategyVersionId: number;
  strategyName: string;
  versionNumber: number;
}>) {
  const closed = rows
    .filter(({ trade }) => trade.status === "closed")
    .map(({ trade, ...context }) => ({
      ...context,
      trade,
      pnl: nullableNumber(trade.pnl),
      timestamp: trade.closedAt ?? trade.createdAt,
    }))
    .filter((row): row is typeof row & { pnl: number } => row.pnl != null)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const pnlValues = closed.map(row => row.pnl);
  const winners = pnlValues.filter(value => value > 0);
  const losers = pnlValues.filter(value => value < 0);
  const netPnl = pnlValues.reduce((total, value) => total + value, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve = closed.map(row => {
    equity += row.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    return { timestamp: row.timestamp.toISOString(), equity: roundMetric(equity) };
  });
  const byVersion = new Map<number, {
    strategyId: number;
    strategyVersionId: number;
    strategyName: string;
    versionNumber: number;
    values: number[];
  }>();
  for (const row of closed) {
    const existing = byVersion.get(row.strategyVersionId) ?? {
      strategyId: row.strategyId,
      strategyVersionId: row.strategyVersionId,
      strategyName: row.strategyName,
      versionNumber: row.versionNumber,
      values: [],
    };
    existing.values.push(row.pnl);
    byVersion.set(row.strategyVersionId, existing);
  }
  const breakdown = [...byVersion.values()].map(version => {
    const versionWins = version.values.filter(value => value > 0).length;
    return {
      strategyId: version.strategyId,
      strategyVersionId: version.strategyVersionId,
      strategyName: version.strategyName,
      versionNumber: version.versionNumber,
      tradeCount: version.values.length,
      winningTrades: versionWins,
      losingTrades: version.values.filter(value => value < 0).length,
      netPnl: roundMetric(version.values.reduce((total, value) => total + value, 0)),
      winRate: version.values.length ? roundMetric((versionWins / version.values.length) * 100) : null,
    };
  });
  const grossProfit = winners.reduce((total, value) => total + value, 0);
  const grossLoss = Math.abs(losers.reduce((total, value) => total + value, 0));
  return {
    hasData: pnlValues.length > 0,
    tradeCount: pnlValues.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    netPnl: pnlValues.length ? roundMetric(netPnl) : null,
    winRate: pnlValues.length ? roundMetric((winners.length / pnlValues.length) * 100) : null,
    averagePnl: pnlValues.length ? roundMetric(netPnl / pnlValues.length) : null,
    averageWinner: winners.length ? roundMetric(grossProfit / winners.length) : null,
    averageLoser: losers.length ? roundMetric(losers.reduce((total, value) => total + value, 0) / losers.length) : null,
    largestWin: winners.length ? roundMetric(Math.max(...winners)) : null,
    largestLoss: losers.length ? roundMetric(Math.min(...losers)) : null,
    maxDrawdown: pnlValues.length ? roundMetric(maxDrawdown) : null,
    profitFactor: grossLoss > 0 ? roundMetric(grossProfit / grossLoss) : null,
    equityCurve,
    byStrategyVersion: breakdown,
  };
}

type JournalPerformanceRow = {
  trade: typeof tradesTable.$inferSelect;
  strategyId: number;
  strategyVersionId: number;
  strategyName: string;
  versionNumber: number;
};

type JournalDayAccumulator = {
  date: string;
  values: number[];
  note: string | null;
};

function journalDateKey(value: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const year = parts.find(part => part.type === "year")?.value;
    const month = parts.find(part => part.type === "month")?.value;
    const day = parts.find(part => part.type === "day")?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // An invalid timezone should not make the journal unavailable.
  }
  return value.toISOString().slice(0, 10);
}

function dateOnlyKey(value: Date | undefined) {
  return value ? value.toISOString().slice(0, 10) : undefined;
}

function journalDaySummary(day: JournalDayAccumulator) {
  const winners = day.values.filter(value => value > 0);
  const losers = day.values.filter(value => value < 0);
  const pnl = day.values.reduce((total, value) => total + value, 0);
  return {
    date: day.date,
    tradeCount: day.values.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    pnl: roundMetric(pnl),
    winRate: day.values.length ? roundMetric((winners.length / day.values.length) * 100) : null,
    averageWinner: winners.length ? roundMetric(winners.reduce((total, value) => total + value, 0) / winners.length) : null,
    averageLoser: losers.length ? roundMetric(losers.reduce((total, value) => total + value, 0) / losers.length) : null,
    bestTrade: day.values.length ? roundMetric(Math.max(...day.values)) : null,
    worstTrade: day.values.length ? roundMetric(Math.min(...day.values)) : null,
    note: day.note,
  };
}

function journalStreaks(days: Array<{ pnl: number }>) {
  let currentType: "winning" | "losing" | "none" = "none";
  let currentLength = 0;
  let bestWinningStreak = 0;
  let bestLosingStreak = 0;
  for (const day of days) {
    const nextType = day.pnl > 0 ? "winning" : day.pnl < 0 ? "losing" : "none";
    if (nextType === "none") {
      currentType = "none";
      currentLength = 0;
      continue;
    }
    if (currentType === nextType) {
      currentLength += 1;
    } else {
      currentType = nextType;
      currentLength = 1;
    }
    if (nextType === "winning") {
      bestWinningStreak = Math.max(bestWinningStreak, currentLength);
    } else {
      bestLosingStreak = Math.max(bestLosingStreak, currentLength);
    }
  }
  return {
    currentStreak: { type: currentType, length: currentLength },
    bestWinningStreak,
    bestLosingStreak,
  };
}

export function calculateJournalMonthPerformance(
  rows: JournalPerformanceRow[],
  notes: Map<string, string | null>,
  params: {
    month: string;
    timezone: string;
    strategyId?: number;
    strategyVersionId?: number;
    marketId?: number;
    side?: "long" | "short";
    from?: Date;
    to?: Date;
  },
) {
  const fromKey = dateOnlyKey(params.from);
  const toKey = dateOnlyKey(params.to);
  const filtered = rows
    .filter(({ trade, strategyId: rowStrategyId, strategyVersionId: rowStrategyVersionId }) => {
      if (params.strategyId != null && params.strategyId !== rowStrategyId) return false;
      if (params.strategyVersionId != null && params.strategyVersionId !== rowStrategyVersionId) return false;
      if (params.marketId != null && params.marketId !== trade.marketId) return false;
      if (params.side != null && params.side !== trade.side) return false;
      return true;
    })
    .map(({ trade, ...context }) => ({
      ...context,
      trade,
      pnl: nullableNumber(trade.pnl),
      timestamp: trade.closedAt ?? trade.createdAt,
    }))
    .filter((row): row is typeof row & { pnl: number } => row.pnl != null)
    .map(row => ({ ...row, date: journalDateKey(row.timestamp, params.timezone) }))
    .filter(row => {
      if (!row.date.startsWith(`${params.month}-`)) return false;
      if (fromKey && row.date < fromKey) return false;
      if (toKey && row.date > toKey) return false;
      return true;
    })
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const byDate = new Map<string, JournalDayAccumulator>();
  for (const row of filtered) {
    const existing = byDate.get(row.date) ?? { date: row.date, values: [], note: notes.get(row.date) ?? null };
    existing.values.push(row.pnl);
    byDate.set(row.date, existing);
  }
  for (const [date, note] of notes) {
    if (!date.startsWith(`${params.month}-`)) continue;
    if (fromKey && date < fromKey) continue;
    if (toKey && date > toKey) continue;
    if (!byDate.has(date)) {
      byDate.set(date, { date, values: [], note });
    }
  }
  const daily = [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(journalDaySummary);
  const tradingDays = daily.filter(day => day.tradeCount > 0);
  const pnlValues = filtered.map(row => row.pnl);
  const winners = pnlValues.filter(value => value > 0);
  const losers = pnlValues.filter(value => value < 0);
  const netPnl = pnlValues.reduce((total, value) => total + value, 0);
  let cumulativePnl = 0;
  const cumulative = tradingDays.map(day => {
    cumulativePnl += day.pnl;
    return { date: day.date, cumulativePnl: roundMetric(cumulativePnl) };
  });
  const streaks = journalStreaks(tradingDays);
  const bestDay = tradingDays.length ? tradingDays.reduce((best, day) => day.pnl > best.pnl ? day : best) : null;
  const worstDay = tradingDays.length ? tradingDays.reduce((worst, day) => day.pnl < worst.pnl ? day : worst) : null;
  const byVersion = new Map<number, {
    strategyId: number;
    strategyVersionId: number;
    strategyName: string;
    versionNumber: number;
    values: number[];
  }>();
  for (const row of filtered) {
    const existing = byVersion.get(row.strategyVersionId) ?? {
      strategyId: row.strategyId,
      strategyVersionId: row.strategyVersionId,
      strategyName: row.strategyName,
      versionNumber: row.versionNumber,
      values: [],
    };
    existing.values.push(row.pnl);
    byVersion.set(row.strategyVersionId, existing);
  }
  const byStrategyVersion = [...byVersion.values()].map(version => {
    const versionWins = version.values.filter(value => value > 0).length;
    return {
      strategyId: version.strategyId,
      strategyVersionId: version.strategyVersionId,
      strategyName: version.strategyName,
      versionNumber: version.versionNumber,
      tradeCount: version.values.length,
      winningTrades: versionWins,
      losingTrades: version.values.filter(value => value < 0).length,
      netPnl: roundMetric(version.values.reduce((total, value) => total + value, 0)),
      winRate: version.values.length ? roundMetric((versionWins / version.values.length) * 100) : null,
    };
  });

  return {
    month: params.month,
    dateField: filtered.some(row => row.trade.closedAt == null) ? "createdAtFallback" as const : "closedAt" as const,
    hasData: pnlValues.length > 0,
    tradeCount: pnlValues.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    netPnl: pnlValues.length ? roundMetric(netPnl) : null,
    winRate: pnlValues.length ? roundMetric((winners.length / pnlValues.length) * 100) : null,
    averageTradingDay: tradingDays.length ? roundMetric(netPnl / tradingDays.length) : null,
    bestDay,
    worstDay,
    daily,
    cumulative,
    currentStreak: streaks.currentStreak,
    bestWinningStreak: streaks.bestWinningStreak,
    bestLosingStreak: streaks.bestLosingStreak,
    byStrategyVersion,
  };
}

async function strategyTradeMetrics(strategyId: number) {
  const rows = await db
    .select({ status: tradesTable.status, pnl: tradesTable.pnl })
    .from(tradesTable)
    .innerJoin(strategyVersionsTable, eq(tradesTable.strategyVersionId, strategyVersionsTable.id))
    .where(eq(strategyVersionsTable.strategyId, strategyId));
  return calculateTradeMetrics(rows);
}

async function strategyView(strategy: typeof strategiesTable.$inferSelect) {
  const [active] = await db
    .select({ id: strategyVersionsTable.id, versionNumber: strategyVersionsTable.versionNumber })
    .from(strategyVersionsTable)
    .where(and(eq(strategyVersionsTable.strategyId, strategy.id), eq(strategyVersionsTable.isActive, true)))
    .orderBy(desc(strategyVersionsTable.versionNumber))
    .limit(1);
  const [latest] = active ? [] : await db
    .select({ id: strategyVersionsTable.id, versionNumber: strategyVersionsTable.versionNumber })
    .from(strategyVersionsTable)
    .where(eq(strategyVersionsTable.strategyId, strategy.id))
    .orderBy(desc(strategyVersionsTable.versionNumber))
    .limit(1);
  const current = active ?? latest;
  return {
    ...strategy,
    marketSymbol: await marketSymbol(strategy.marketId),
    currentVersion: current?.versionNumber == null ? null : Number(current.versionNumber),
    currentVersionId: current?.id ?? null,
    ...(await strategyTradeMetrics(strategy.id)),
  };
}

async function marketSymbol(marketId: number | null) {
  if (marketId == null) return null;
  const [market] = await db.select({ symbol: marketsTable.symbol }).from(marketsTable).where(eq(marketsTable.id, marketId));
  return market?.symbol ?? null;
}

function marketView(market: typeof marketsTable.$inferSelect) {
  return {
    ...market,
    tickSize: market.tickSize == null ? null : Number(market.tickSize),
    contractMultiplier: market.contractMultiplier == null ? null : Number(market.contractMultiplier),
  };
}

function alertView(
  alert: typeof alertsTable.$inferSelect,
  context: { marketSymbol: string | null; strategyName: string | null; versionNumber: number | null },
) {
  let evidence: Record<string, unknown> | null = null;
  if (alert.evidence) {
    try {
      const parsed = JSON.parse(alert.evidence);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) evidence = parsed;
    } catch {
      evidence = null;
    }
  }
  return {
    ...alert,
    evidence,
    marketSymbol: context.marketSymbol,
    strategyName: context.strategyName,
    versionNumber: context.versionNumber,
  };
}

async function snapshotMarketSymbol(executor: any, marketId: number | null) {
  if (marketId == null) return null;
  const [market] = await executor.select({ symbol: marketsTable.symbol }).from(marketsTable).where(eq(marketsTable.id, marketId));
  return market?.symbol ?? null;
}

async function buildVersionConditionSnapshots(
  executor: any,
  conditions: Array<typeof strategyConditionsTable.$inferSelect>,
  strategyVersionId: number,
) {
  return Promise.all(conditions.map(async condition => {
    const [concept] = await executor
      .select()
      .from(tradingConceptsTable)
      .where(eq(tradingConceptsTable.id, condition.conceptId));
    return {
      strategyVersionId,
      conceptId: condition.conceptId,
      conceptName: concept?.name ?? "Unknown concept",
      conceptCategory: concept?.category ?? null,
      conceptDescription: concept?.description ?? null,
      conceptDetectionRules: concept?.detectionRules ?? null,
      conceptInvalidationRules: concept?.invalidationRules ?? null,
      stage: condition.stage,
      name: condition.name,
      description: condition.description,
      timeframe: condition.timeframe,
      direction: condition.direction,
      requirement: condition.requirement,
      conditionOrder: condition.conditionOrder,
      triggerRules: condition.triggerRules,
      parameters: conditionParameters(concept?.name, condition.parameters),
      invalidationRules: condition.invalidationRules,
      resetBehavior: condition.resetBehavior,
    };
  }));
}

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [strategyCount, tradeCount, alertCount, conceptCount, marketCount, activeStrategyCount, latestTrade] =
    await Promise.all([
      db.select({ value: count() }).from(strategiesTable),
      db.select({ value: count() }).from(tradesTable),
      db.select({ value: count() }).from(alertsTable),
      db.select({ value: count() }).from(tradingConceptsTable),
      db.select({ value: count() }).from(marketsTable),
      db.select({ value: count() }).from(strategiesTable).where(eq(strategiesTable.status, "active")),
      db.select({ createdAt: tradesTable.createdAt }).from(tradesTable).orderBy(desc(tradesTable.createdAt)).limit(1),
    ]);
  const data = {
    strategyCount: Number(strategyCount[0]?.value ?? 0),
    tradeCount: Number(tradeCount[0]?.value ?? 0),
    alertCount: Number(alertCount[0]?.value ?? 0),
    conceptCount: Number(conceptCount[0]?.value ?? 0),
    marketCount: Number(marketCount[0]?.value ?? 0),
    activeStrategyCount: Number(activeStrategyCount[0]?.value ?? 0),
    hasPerformanceData: Number(tradeCount[0]?.value ?? 0) > 0,
    latestTradeAt: latestTrade[0]?.createdAt ?? null,
  };
  res.json(GetDashboardSummaryResponse.parse(data));
});

router.get("/strategies", async (_req, res): Promise<void> => {
  const rows = await db.select().from(strategiesTable).orderBy(desc(strategiesTable.updatedAt));
  res.json(ListStrategiesResponse.parse(await Promise.all(rows.map(strategyView))));
});

router.post("/strategies", async (req, res): Promise<void> => {
  const parsed = CreateStrategyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { conditions = [], ...strategyData } = parsed.data;
  let created: typeof strategiesTable.$inferSelect;
  try {
    created = await db.transaction(async (tx) => {
      const [strategy] = await tx.insert(strategiesTable).values(strategyData).returning();
      const [version] = await tx.insert(strategyVersionsTable).values({
        strategyId: strategy.id,
        versionNumber: 1,
        isActive: true,
        label: "Initial version",
        name: strategy.name,
        description: strategy.description,
        marketId: strategy.marketId,
        marketSymbol: await snapshotMarketSymbol(tx, strategy.marketId),
        assetClass: strategy.assetClass,
        direction: strategy.direction,
        timeframes: strategy.timeframes,
        riskManagementRules: strategy.riskManagementRules,
        resetRules: strategy.resetRules,
        alertRules: strategy.alertRules,
      }).returning();
      const persistedConditions = [];
      for (const [index, inputCondition] of conditions.entries()) {
        const [concept] = await tx
          .select({ id: tradingConceptsTable.id, name: tradingConceptsTable.name })
          .from(tradingConceptsTable)
          .where(eq(tradingConceptsTable.id, inputCondition.conceptId));
        if (!concept) throw new Error("Concept not found.");
        const parameters = conditionParameters(concept.name, inputCondition.parameters);
        const [condition] = await tx.insert(strategyConditionsTable).values({
          ...inputCondition,
          strategyId: strategy.id,
          conditionOrder: index + 1,
          parameters,
        }).returning();
        persistedConditions.push(condition);
      }
      if (persistedConditions.length) {
        await tx.insert(strategyVersionConditionsTable).values(
          await buildVersionConditionSnapshots(tx, persistedConditions, version.id),
        );
      }
      return strategy;
    });
  } catch (error) {
    if (error instanceof Error && (/^Concept not found/.test(error.message) || /^Parameters for /.test(error.message))) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
  res.status(201).json(CreateStrategyResponse.parse(await strategyView(created)));
});

router.get("/strategies/:strategyId", async (req, res): Promise<void> => {
  const params = GetStrategyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [strategy] = await db.select().from(strategiesTable).where(eq(strategiesTable.id, params.data.strategyId));
  if (!strategy) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  res.json(GetStrategyResponse.parse(await strategyView(strategy)));
});

router.patch("/strategies/:strategyId", async (req, res): Promise<void> => {
  const params = UpdateStrategyParams.safeParse(req.params);
  const body = UpdateStrategyBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [updated] = await db
    .update(strategiesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(strategiesTable.id, params.data.strategyId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  res.json(UpdateStrategyResponse.parse(await strategyView(updated)));
});

router.delete("/strategies/:strategyId", async (req, res): Promise<void> => {
  const params = DeleteStrategyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [trade] = await db
    .select({ id: tradesTable.id })
    .from(tradesTable)
    .innerJoin(strategyVersionsTable, eq(tradesTable.strategyVersionId, strategyVersionsTable.id))
    .where(eq(strategyVersionsTable.strategyId, params.data.strategyId))
    .limit(1);
  if (trade) {
    res.status(409).json({ error: "This strategy has recorded trades. Archive it instead so its version history remains intact." });
    return;
  }
  const [deleted] = await db.delete(strategiesTable).where(eq(strategiesTable.id, params.data.strategyId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/strategies/:strategyId/duplicate", async (req, res): Promise<void> => {
  const params = GetStrategyParams.safeParse(req.params);
  const body = DuplicateStrategyBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [source] = await db.select().from(strategiesTable).where(eq(strategiesTable.id, params.data.strategyId));
  if (!source) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  const duplicated = await db.transaction(async (tx) => {
    const [strategy] = await tx.insert(strategiesTable).values({
      name: body.data.name || `${source.name} Copy`,
      description: source.description,
      status: "draft",
      marketId: source.marketId,
      assetClass: source.assetClass,
      direction: source.direction,
      timeframes: source.timeframes,
      riskManagementRules: source.riskManagementRules,
      resetRules: source.resetRules,
      alertRules: source.alertRules,
    }).returning();
    const [version] = await tx.insert(strategyVersionsTable).values({
      strategyId: strategy.id,
      versionNumber: 1,
      isActive: true,
      label: "Initial copy",
      name: strategy.name,
      description: strategy.description,
      marketId: strategy.marketId,
      marketSymbol: await snapshotMarketSymbol(tx, strategy.marketId),
      assetClass: strategy.assetClass,
      direction: strategy.direction,
      timeframes: strategy.timeframes,
      riskManagementRules: strategy.riskManagementRules,
      resetRules: strategy.resetRules,
      alertRules: strategy.alertRules,
    }).returning();
    const conditions = await tx.select().from(strategyConditionsTable).where(eq(strategyConditionsTable.strategyId, source.id));
    if (conditions.length) {
      await tx.insert(strategyVersionConditionsTable).values(await buildVersionConditionSnapshots(tx, conditions, version.id));
      await tx.insert(strategyConditionsTable).values(conditions.map(condition => ({
        strategyId: strategy.id,
        conceptId: condition.conceptId,
        stage: condition.stage,
        name: condition.name,
        description: condition.description,
        timeframe: condition.timeframe,
        direction: condition.direction,
        requirement: condition.requirement,
        conditionOrder: condition.conditionOrder,
        triggerRules: condition.triggerRules,
        parameters: condition.parameters,
        invalidationRules: condition.invalidationRules,
        resetBehavior: condition.resetBehavior,
      })));
    }
    return strategy;
  });
  res.status(201).json(DuplicateStrategyResponse.parse(await strategyView(duplicated)));
});

async function strategyVersionView(version: typeof strategyVersionsTable.$inferSelect) {
  const [conditionCount] = await db
    .select({ value: count() })
    .from(strategyVersionConditionsTable)
    .where(eq(strategyVersionConditionsTable.strategyVersionId, version.id));
  const trades = await db
    .select({ status: tradesTable.status, pnl: tradesTable.pnl })
    .from(tradesTable)
    .where(eq(tradesTable.strategyVersionId, version.id));
  return {
    ...version,
    conditionCount: Number(conditionCount?.value ?? 0),
    ...calculateTradeMetrics(trades),
  };
}

router.get("/strategies/:strategyId/versions", async (req, res): Promise<void> => {
  const params = ListStrategyVersionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(strategyVersionsTable)
    .where(eq(strategyVersionsTable.strategyId, params.data.strategyId))
    .orderBy(desc(strategyVersionsTable.versionNumber));
  res.json(ListStrategyVersionsResponse.parse(await Promise.all(rows.map(strategyVersionView))));
});

router.post("/strategies/:strategyId/versions", async (req, res): Promise<void> => {
  const params = ListStrategyVersionsParams.safeParse(req.params);
  const body = CreateStrategyVersionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [strategy] = await db.select({ id: strategiesTable.id }).from(strategiesTable).where(eq(strategiesTable.id, params.data.strategyId));
  if (!strategy) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${params.data.strategyId})`);
    const [latest] = await tx
      .select({ versionNumber: max(strategyVersionsTable.versionNumber) })
      .from(strategyVersionsTable)
      .where(eq(strategyVersionsTable.strategyId, params.data.strategyId));
    const [current] = await tx
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.id, params.data.strategyId));
    await tx.update(strategyVersionsTable).set({ isActive: false }).where(eq(strategyVersionsTable.strategyId, params.data.strategyId));
    const [version] = await tx
      .insert(strategyVersionsTable)
      .values({
        ...body.data,
        strategyId: params.data.strategyId,
        versionNumber: Number(latest?.versionNumber ?? 0) + 1,
        isActive: true,
        name: current.name,
        description: current.description,
        marketId: current.marketId,
        marketSymbol: await snapshotMarketSymbol(tx, current.marketId),
        assetClass: current.assetClass,
        direction: current.direction,
        timeframes: current.timeframes,
        riskManagementRules: current.riskManagementRules,
        resetRules: current.resetRules,
        alertRules: current.alertRules,
      })
      .returning();
    const conditions = await tx.select().from(strategyConditionsTable).where(eq(strategyConditionsTable.strategyId, params.data.strategyId));
    if (conditions.length) {
      await tx.insert(strategyVersionConditionsTable).values(await buildVersionConditionSnapshots(tx, conditions, version.id));
    }
    return version;
  });
  res.status(201).json(CreateStrategyVersionResponse.parse(await strategyVersionView(created)));
});

async function activateVersionSnapshot(strategyId: number, versionId: number) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${strategyId})`);
    const [version] = await tx
      .select()
      .from(strategyVersionsTable)
      .where(and(eq(strategyVersionsTable.id, versionId), eq(strategyVersionsTable.strategyId, strategyId)));
    if (!version) return null;
    if (!version.isActive) {
      await tx.delete(strategyMonitorSessionsTable)
        .where(eq(strategyMonitorSessionsTable.strategyVersionId, version.id));
    }
    const conditions = await tx
      .select()
      .from(strategyVersionConditionsTable)
      .where(eq(strategyVersionConditionsTable.strategyVersionId, version.id))
      .orderBy(asc(strategyVersionConditionsTable.conditionOrder));
    await tx.update(strategyVersionsTable).set({ isActive: false }).where(eq(strategyVersionsTable.strategyId, strategyId));
    const [active] = await tx.update(strategyVersionsTable).set({
      isActive: true,
      monitoringEpoch: sql`${strategyVersionsTable.monitoringEpoch} + 1`,
    }).where(eq(strategyVersionsTable.id, version.id)).returning();
    await tx.update(strategiesTable).set({
      name: version.name,
      description: version.description,
      marketId: version.marketId,
      assetClass: version.assetClass,
      direction: version.direction,
      timeframes: version.timeframes,
      riskManagementRules: version.riskManagementRules,
      resetRules: version.resetRules,
      alertRules: version.alertRules,
      updatedAt: new Date(),
    }).where(eq(strategiesTable.id, strategyId));
    await tx.delete(strategyConditionsTable).where(eq(strategyConditionsTable.strategyId, strategyId));
    if (conditions.length) {
      await tx.insert(strategyConditionsTable).values(conditions.map(condition => ({
        strategyId,
        conceptId: condition.conceptId,
        stage: condition.stage,
        name: condition.name,
        description: condition.description,
        timeframe: condition.timeframe,
        direction: condition.direction,
        requirement: condition.requirement,
        conditionOrder: condition.conditionOrder,
        triggerRules: condition.triggerRules,
        parameters: condition.parameters,
        invalidationRules: condition.invalidationRules,
        resetBehavior: condition.resetBehavior,
      })));
    }
    return active;
  });
}

router.post("/strategies/:strategyId/versions/:versionId/activate", async (req, res): Promise<void> => {
  const params = ActivateStrategyVersionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const active = await activateVersionSnapshot(params.data.strategyId, params.data.versionId);
  if (!active) {
    res.status(404).json({ error: "Strategy version not found" });
    return;
  }
  res.json(ActivateStrategyVersionResponse.parse(await strategyVersionView(active)));
});

router.post("/strategies/:strategyId/versions/:versionId/clone", async (req, res): Promise<void> => {
  const params = CloneStrategyVersionParams.safeParse(req.params);
  const body = CloneStrategyVersionBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${params.data.strategyId})`);
    const [source] = await tx
      .select()
      .from(strategyVersionsTable)
      .where(and(eq(strategyVersionsTable.id, params.data.versionId), eq(strategyVersionsTable.strategyId, params.data.strategyId)));
    if (!source) return null;
    const [latest] = await tx
      .select({ versionNumber: max(strategyVersionsTable.versionNumber) })
      .from(strategyVersionsTable)
      .where(eq(strategyVersionsTable.strategyId, params.data.strategyId));
    await tx.update(strategyVersionsTable).set({ isActive: false }).where(eq(strategyVersionsTable.strategyId, params.data.strategyId));
    const [version] = await tx.insert(strategyVersionsTable).values({
      strategyId: source.strategyId,
      versionNumber: Number(latest?.versionNumber ?? 0) + 1,
      isActive: true,
      label: body.data.label || `Created from v${source.versionNumber}`,
      name: source.name,
      description: source.description,
      thesis: source.thesis,
      entryRules: source.entryRules,
      exitRules: source.exitRules,
      riskRules: source.riskRules,
      notes: source.notes,
      marketId: source.marketId,
      marketSymbol: source.marketSymbol,
      assetClass: source.assetClass,
      direction: source.direction,
      timeframes: source.timeframes,
      riskManagementRules: source.riskManagementRules,
      resetRules: source.resetRules,
      alertRules: source.alertRules,
    }).returning();
    const sourceConditions = await tx
      .select()
      .from(strategyVersionConditionsTable)
      .where(eq(strategyVersionConditionsTable.strategyVersionId, source.id));
    if (sourceConditions.length) {
      await tx.insert(strategyVersionConditionsTable).values(sourceConditions.map(condition => ({
        strategyVersionId: version.id,
        conceptId: condition.conceptId,
        conceptName: condition.conceptName,
        conceptCategory: condition.conceptCategory,
        conceptDescription: condition.conceptDescription,
        conceptDetectionRules: condition.conceptDetectionRules,
        conceptInvalidationRules: condition.conceptInvalidationRules,
        stage: condition.stage,
        name: condition.name,
        description: condition.description,
        timeframe: condition.timeframe,
        direction: condition.direction,
        requirement: condition.requirement,
        conditionOrder: condition.conditionOrder,
        triggerRules: condition.triggerRules,
        parameters: condition.parameters,
        invalidationRules: condition.invalidationRules,
        resetBehavior: condition.resetBehavior,
      })));
    }
    await tx.update(strategiesTable).set({
      name: source.name,
      description: source.description,
      marketId: source.marketId,
      assetClass: source.assetClass,
      direction: source.direction,
      timeframes: source.timeframes,
      riskManagementRules: source.riskManagementRules,
      resetRules: source.resetRules,
      alertRules: source.alertRules,
      updatedAt: new Date(),
    }).where(eq(strategiesTable.id, source.strategyId));
    await tx.delete(strategyConditionsTable).where(eq(strategyConditionsTable.strategyId, source.strategyId));
    if (sourceConditions.length) {
      await tx.insert(strategyConditionsTable).values(sourceConditions.map(condition => ({
        strategyId: source.strategyId,
        conceptId: condition.conceptId,
        stage: condition.stage,
        name: condition.name,
        description: condition.description,
        timeframe: condition.timeframe,
        direction: condition.direction,
        requirement: condition.requirement,
        conditionOrder: condition.conditionOrder,
        triggerRules: condition.triggerRules,
        parameters: condition.parameters,
        invalidationRules: condition.invalidationRules,
        resetBehavior: condition.resetBehavior,
      })));
    }
    return version;
  });
  if (!created) {
    res.status(404).json({ error: "Strategy version not found" });
    return;
  }
  res.status(201).json(CloneStrategyVersionResponse.parse(await strategyVersionView(created)));
});

router.get("/strategies/:strategyId/versions/:versionId/conditions", async (req, res): Promise<void> => {
  const params = ListStrategyVersionConditionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [version] = await db
    .select({ id: strategyVersionsTable.id })
    .from(strategyVersionsTable)
    .where(and(eq(strategyVersionsTable.id, params.data.versionId), eq(strategyVersionsTable.strategyId, params.data.strategyId)));
  if (!version) {
    res.status(404).json({ error: "Strategy version not found" });
    return;
  }
  const rows = await db
    .select()
    .from(strategyVersionConditionsTable)
    .where(eq(strategyVersionConditionsTable.strategyVersionId, params.data.versionId))
    .orderBy(asc(strategyVersionConditionsTable.conditionOrder));
  const withConcepts = await Promise.all(rows.map(async condition => {
    return { ...condition, order: condition.conditionOrder };
  }));
  res.json(ListStrategyVersionConditionsResponse.parse(withConcepts));
});

async function strategyConditionView(condition: typeof strategyConditionsTable.$inferSelect) {
  const [concept] = await db
    .select({ name: tradingConceptsTable.name, category: tradingConceptsTable.category })
    .from(tradingConceptsTable)
    .where(eq(tradingConceptsTable.id, condition.conceptId));
  return {
    ...condition,
    conceptName: concept?.name ?? "Missing concept",
    conceptCategory: concept?.category ?? null,
    order: condition.conditionOrder,
  };
}

router.get("/strategies/:strategyId/conditions", async (req, res): Promise<void> => {
  const params = ListStrategyConditionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(strategyConditionsTable)
    .where(eq(strategyConditionsTable.strategyId, params.data.strategyId))
    .orderBy(asc(strategyConditionsTable.conditionOrder));
  res.json(ListStrategyConditionsResponse.parse(await Promise.all(rows.map(strategyConditionView))));
});

router.post("/strategies/:strategyId/conditions", async (req, res): Promise<void> => {
  const params = ListStrategyConditionsParams.safeParse(req.params);
  const body = CreateStrategyConditionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [strategy] = await db.select({ id: strategiesTable.id }).from(strategiesTable).where(eq(strategiesTable.id, params.data.strategyId));
  if (!strategy) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  const [concept] = await db.select({ name: tradingConceptsTable.name }).from(tradingConceptsTable).where(eq(tradingConceptsTable.id, body.data.conceptId));
  if (!concept) {
    res.status(400).json({ error: "Concept not found." });
    return;
  }
  let parameters: unknown;
  try {
    parameters = conditionParameters(concept.name, body.data.parameters);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Condition parameters are invalid." });
    return;
  }
  const [latest] = await db
    .select({ conditionOrder: max(strategyConditionsTable.conditionOrder) })
    .from(strategyConditionsTable)
    .where(eq(strategyConditionsTable.strategyId, params.data.strategyId));
  const [created] = await db
    .insert(strategyConditionsTable)
    .values({ ...body.data, parameters, strategyId: params.data.strategyId, conditionOrder: Number(latest?.conditionOrder ?? 0) + 1 })
    .returning();
  res.status(201).json(CreateStrategyConditionResponse.parse(await strategyConditionView(created)));
});

router.patch("/strategies/:strategyId/conditions/reorder", async (req, res): Promise<void> => {
  const params = ListStrategyConditionsParams.safeParse(req.params);
  const body = ReorderStrategyConditionsBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const existing = await db
    .select({ id: strategyConditionsTable.id })
    .from(strategyConditionsTable)
    .where(eq(strategyConditionsTable.strategyId, params.data.strategyId));
  const existingIds = new Set(existing.map(({ id }) => id));
  const requestedIds = body.data.conditionIds;
  if (requestedIds.length !== existing.length || new Set(requestedIds).size !== requestedIds.length || requestedIds.some(id => !existingIds.has(id))) {
    res.status(400).json({ error: "conditionIds must contain each condition for this strategy exactly once" });
    return;
  }
  for (const [index, conditionId] of requestedIds.entries()) {
    await db.update(strategyConditionsTable).set({ conditionOrder: index + 1, updatedAt: new Date() }).where(and(eq(strategyConditionsTable.id, conditionId), eq(strategyConditionsTable.strategyId, params.data.strategyId)));
  }
  const rows = await db
    .select()
    .from(strategyConditionsTable)
    .where(eq(strategyConditionsTable.strategyId, params.data.strategyId))
    .orderBy(asc(strategyConditionsTable.conditionOrder));
  res.json(ReorderStrategyConditionsResponse.parse(await Promise.all(rows.map(strategyConditionView))));
});

router.patch("/strategies/:strategyId/conditions/:conditionId", async (req, res): Promise<void> => {
  const params = UpdateStrategyConditionParams.safeParse(req.params);
  const body = UpdateStrategyConditionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [existing] = await db.select().from(strategyConditionsTable)
    .where(and(eq(strategyConditionsTable.id, params.data.conditionId), eq(strategyConditionsTable.strategyId, params.data.strategyId)));
  if (!existing) {
    res.status(404).json({ error: "Strategy condition not found" });
    return;
  }
  const [concept] = await db.select({ name: tradingConceptsTable.name }).from(tradingConceptsTable)
    .where(eq(tradingConceptsTable.id, body.data.conceptId ?? existing.conceptId));
  if (!concept) {
    res.status(400).json({ error: "Concept not found." });
    return;
  }
  let parameters: unknown;
  try {
    parameters = conditionParameters(concept.name, body.data.parameters ?? existing.parameters);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Condition parameters are invalid." });
    return;
  }
  const [updated] = await db
    .update(strategyConditionsTable)
    .set({ ...body.data, parameters, updatedAt: new Date() })
    .where(and(eq(strategyConditionsTable.id, params.data.conditionId), eq(strategyConditionsTable.strategyId, params.data.strategyId)))
    .returning();
  res.json(UpdateStrategyConditionResponse.parse(await strategyConditionView(updated)));
});

router.delete("/strategies/:strategyId/conditions/:conditionId", async (req, res): Promise<void> => {
  const params = DeleteStrategyConditionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(strategyConditionsTable)
    .where(and(eq(strategyConditionsTable.id, params.data.conditionId), eq(strategyConditionsTable.strategyId, params.data.strategyId)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Strategy condition not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/concepts", async (_req, res): Promise<void> => {
  await ensureBuiltInConcepts();
  res.json(ListConceptsResponse.parse(await db.select().from(tradingConceptsTable).orderBy(asc(tradingConceptsTable.name))));
});

router.post("/concepts", async (req, res): Promise<void> => {
  const parsed = CreateConceptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [created] = await db.insert(tradingConceptsTable).values(parsed.data).returning();
  res.status(201).json(CreateConceptResponse.parse(created));
});

router.patch("/concepts/:conceptId", async (req, res): Promise<void> => {
  const params = UpdateConceptParams.safeParse(req.params);
  const body = UpdateConceptBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [updated] = await db.update(tradingConceptsTable).set(body.data).where(eq(tradingConceptsTable.id, params.data.conceptId)).returning();
  if (!updated) {
    res.status(404).json({ error: "Concept not found" });
    return;
  }
  res.json(UpdateConceptResponse.parse(updated));
});

router.delete("/concepts/:conceptId", async (req, res): Promise<void> => {
  const params = DeleteConceptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(tradingConceptsTable).where(eq(tradingConceptsTable.id, params.data.conceptId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Concept not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/conditions", async (_req, res): Promise<void> => {
  res.json(ListConditionsResponse.parse(await db.select().from(conditionsTable).orderBy(asc(conditionsTable.name))));
});

router.post("/conditions", async (req, res): Promise<void> => {
  const parsed = CreateConditionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [created] = await db.insert(conditionsTable).values(parsed.data).returning();
  res.status(201).json(CreateConditionResponse.parse(created));
});

router.patch("/conditions/:conditionId", async (req, res): Promise<void> => {
  const params = UpdateConditionParams.safeParse(req.params);
  const body = UpdateConditionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [updated] = await db.update(conditionsTable).set(body.data).where(eq(conditionsTable.id, params.data.conditionId)).returning();
  if (!updated) {
    res.status(404).json({ error: "Condition not found" });
    return;
  }
  res.json(UpdateConditionResponse.parse(updated));
});

router.delete("/conditions/:conditionId", async (req, res): Promise<void> => {
  const params = DeleteConditionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(conditionsTable).where(eq(conditionsTable.id, params.data.conditionId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Condition not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/markets", async (_req, res): Promise<void> => {
  const rows = await db.select().from(marketsTable).orderBy(asc(marketsTable.symbol));
  res.json(ListMarketsResponse.parse(rows.map(marketView)));
});

router.post("/markets", async (req, res): Promise<void> => {
  const parsed = CreateMarketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [created] = await db.insert(marketsTable).values({
    ...parsed.data,
    tickSize: parsed.data.tickSize?.toString(),
    contractMultiplier: parsed.data.contractMultiplier?.toString(),
  }).returning();
  res.status(201).json(CreateMarketResponse.parse(marketView(created)));
});

router.patch("/markets/:marketId", async (req, res): Promise<void> => {
  const params = UpdateMarketParams.safeParse(req.params);
  const body = UpdateMarketBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [updated] = await db.update(marketsTable).set({
    ...body.data,
    tickSize: body.data.tickSize === undefined ? undefined : body.data.tickSize?.toString(),
    contractMultiplier: body.data.contractMultiplier === undefined ? undefined : body.data.contractMultiplier?.toString(),
  }).where(eq(marketsTable.id, params.data.marketId)).returning();
  if (!updated) {
    res.status(404).json({ error: "Market not found" });
    return;
  }
  res.json(UpdateMarketResponse.parse(marketView(updated)));
});

router.delete("/markets/:marketId", async (req, res): Promise<void> => {
  const params = DeleteMarketParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [[candles], [strategies], [versions], [mappings]] = await Promise.all([
    db.select({ value: count() }).from(candlesTable).where(eq(candlesTable.instrumentId, params.data.marketId)),
    db.select({ value: count() }).from(strategiesTable).where(eq(strategiesTable.marketId, params.data.marketId)),
    db.select({ value: count() }).from(strategyVersionsTable).where(eq(strategyVersionsTable.marketId, params.data.marketId)),
    db.select({ value: count() }).from(sourceInstrumentMappingsTable).where(eq(sourceInstrumentMappingsTable.instrumentId, params.data.marketId)),
  ]);
  if ([candles, strategies, versions, mappings].some(row => Number(row?.value ?? 0) > 0)) {
    res.status(409).json({ error: "Market is referenced by strategy history, provider mappings, or candle data. Deactivate it instead." });
    return;
  }
  const [deleted] = await db.delete(marketsTable).where(eq(marketsTable.id, params.data.marketId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Market not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/trades", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      trade: tradesTable,
      symbol: marketsTable.symbol,
      strategyName: strategiesTable.name,
      strategyId: strategiesTable.id,
      versionNumber: strategyVersionsTable.versionNumber,
    })
    .from(tradesTable)
    .leftJoin(strategyVersionsTable, eq(tradesTable.strategyVersionId, strategyVersionsTable.id))
    .leftJoin(strategiesTable, eq(strategyVersionsTable.strategyId, strategiesTable.id))
    .leftJoin(marketsTable, eq(tradesTable.marketId, marketsTable.id))
    .orderBy(desc(tradesTable.createdAt));
  res.json(
    ListTradesResponse.parse(
      rows.map(({ trade, symbol, strategyName, strategyId, versionNumber }) => ({
        ...trade,
        marketSymbol: symbol,
        strategyName,
        strategyId,
        strategyVersionNumber: versionNumber,
        quantity: nullableNumber(trade.quantity),
        entryPrice: nullableNumber(trade.entryPrice),
        exitPrice: nullableNumber(trade.exitPrice),
        pnl: nullableNumber(trade.pnl),
        stopLoss: nullableNumber(trade.stopLoss),
        takeProfit: nullableNumber(trade.takeProfit),
        riskAmount: nullableNumber(trade.riskAmount),
      })),
    ),
  );
});

router.post("/trades", async (req, res): Promise<void> => {
  const parsed = CreateTradeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [strategyVersion] = await db
    .select({ id: strategyVersionsTable.id })
    .from(strategyVersionsTable)
    .where(eq(strategyVersionsTable.id, parsed.data.strategyVersionId));
  if (!strategyVersion) {
    res.status(400).json({ error: "Select a valid saved strategy version for this trade." });
    return;
  }
  const [created] = await db
    .insert(tradesTable)
    .values({
      ...parsed.data,
      quantity: parsed.data.quantity?.toString(),
      entryPrice: parsed.data.entryPrice?.toString(),
      exitPrice: parsed.data.exitPrice?.toString(),
      stopLoss: parsed.data.stopLoss?.toString(),
      takeProfit: parsed.data.takeProfit?.toString(),
      riskAmount: parsed.data.riskAmount?.toString(),
      pnl: parsed.data.pnl?.toString(),
    })
    .returning();
  const [context] = created.strategyVersionId ? await db
    .select({ strategyId: strategiesTable.id, strategyName: strategiesTable.name, versionNumber: strategyVersionsTable.versionNumber })
    .from(strategyVersionsTable)
    .innerJoin(strategiesTable, eq(strategyVersionsTable.strategyId, strategiesTable.id))
    .where(eq(strategyVersionsTable.id, created.strategyVersionId)) : [];
  res.status(201).json(
    CreateTradeResponse.parse({
      ...created,
      marketSymbol: await marketSymbol(created.marketId),
      strategyName: context?.strategyName ?? null,
      strategyId: context?.strategyId,
      strategyVersionNumber: context?.versionNumber ?? null,
      quantity: nullableNumber(created.quantity),
      entryPrice: nullableNumber(created.entryPrice),
      exitPrice: nullableNumber(created.exitPrice),
        stopLoss: nullableNumber(created.stopLoss),
        takeProfit: nullableNumber(created.takeProfit),
        riskAmount: nullableNumber(created.riskAmount),
      pnl: nullableNumber(created.pnl),
    }),
  );
});

router.patch("/trades/:tradeId", async (req, res): Promise<void> => {
  const params = UpdateTradeParams.safeParse(req.params);
  const body = UpdateTradeBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [updated] = await db
    .update(tradesTable)
    .set({
      ...body.data,
      quantity: body.data.quantity?.toString(),
      entryPrice: body.data.entryPrice?.toString(),
      exitPrice: body.data.exitPrice?.toString(),
      stopLoss: body.data.stopLoss?.toString(),
      takeProfit: body.data.takeProfit?.toString(),
      riskAmount: body.data.riskAmount?.toString(),
      pnl: body.data.pnl?.toString(),
      updatedAt: new Date(),
    })
    .where(eq(tradesTable.id, params.data.tradeId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Trade not found" });
    return;
  }
  const [context] = updated.strategyVersionId ? await db
    .select({ strategyId: strategiesTable.id, strategyName: strategiesTable.name, versionNumber: strategyVersionsTable.versionNumber })
    .from(strategyVersionsTable)
    .innerJoin(strategiesTable, eq(strategyVersionsTable.strategyId, strategiesTable.id))
    .where(eq(strategyVersionsTable.id, updated.strategyVersionId)) : [];
  res.json(
    UpdateTradeResponse.parse({
      ...updated,
      marketSymbol: await marketSymbol(updated.marketId),
      strategyName: context?.strategyName ?? null,
      strategyId: context?.strategyId,
      strategyVersionNumber: context?.versionNumber ?? null,
      quantity: nullableNumber(updated.quantity),
      entryPrice: nullableNumber(updated.entryPrice),
      exitPrice: nullableNumber(updated.exitPrice),
        stopLoss: nullableNumber(updated.stopLoss),
        takeProfit: nullableNumber(updated.takeProfit),
        riskAmount: nullableNumber(updated.riskAmount),
      pnl: nullableNumber(updated.pnl),
    }),
  );
});

router.delete("/trades/:tradeId", async (req, res): Promise<void> => {
  const params = DeleteTradeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(tradesTable).where(eq(tradesTable.id, params.data.tradeId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Trade not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/journal/performance", async (req, res): Promise<void> => {
  const parsed = GetJournalPerformanceQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
    res.status(400).json({ error: "The from date must be on or before the to date" });
    return;
  }
  const rows = await db
    .select({
      trade: tradesTable,
      strategyId: strategiesTable.id,
      strategyVersionId: strategyVersionsTable.id,
      strategyName: strategiesTable.name,
      versionNumber: strategyVersionsTable.versionNumber,
    })
    .from(tradesTable)
    .innerJoin(strategyVersionsTable, eq(tradesTable.strategyVersionId, strategyVersionsTable.id))
    .innerJoin(strategiesTable, eq(strategyVersionsTable.strategyId, strategiesTable.id))
    .where(eq(tradesTable.status, "closed"))
    .orderBy(asc(tradesTable.closedAt), asc(tradesTable.createdAt));
  const noteRows = await db
    .select({ periodStart: performanceRecordsTable.periodStart, notes: performanceRecordsTable.notes })
    .from(performanceRecordsTable);
  const notes = new Map(noteRows.map(row => [dateOnlyKey(row.periodStart)!, row.notes]));
  res.json(
    GetJournalPerformanceResponse.parse(
      calculateJournalMonthPerformance(rows, notes, parsed.data),
    ),
  );
});

router.put("/journal/day-notes/:date", async (req, res): Promise<void> => {
  const params = UpdateJournalDayNoteParams.safeParse(req.params);
  const body = UpdateJournalDayNoteBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const periodStart = new Date(`${params.data.date}T00:00:00.000Z`);
  const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
  const notes = body.data.notes?.trim() || null;
  const [existing] = await db
    .select({ id: performanceRecordsTable.id })
    .from(performanceRecordsTable)
    .where(eq(performanceRecordsTable.periodStart, periodStart));

  if (!notes) {
    if (existing) {
      await db.delete(performanceRecordsTable).where(eq(performanceRecordsTable.id, existing.id));
    }
  } else if (existing) {
    await db
      .update(performanceRecordsTable)
      .set({ notes })
      .where(eq(performanceRecordsTable.id, existing.id));
  } else {
    await db.insert(performanceRecordsTable).values({
      periodStart,
      periodEnd,
      tradeCount: 0,
      netPnl: null,
      notes,
    });
  }
  res.json(UpdateJournalDayNoteResponse.parse({ date: params.data.date, notes }));
});

router.get("/performance/summary", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      trade: tradesTable,
      strategyId: strategiesTable.id,
      strategyVersionId: strategyVersionsTable.id,
      strategyName: strategiesTable.name,
      versionNumber: strategyVersionsTable.versionNumber,
    })
    .from(tradesTable)
    .innerJoin(strategyVersionsTable, eq(tradesTable.strategyVersionId, strategyVersionsTable.id))
    .innerJoin(strategiesTable, eq(strategyVersionsTable.strategyId, strategiesTable.id))
    .where(eq(tradesTable.status, "closed"))
    .orderBy(asc(tradesTable.closedAt), asc(tradesTable.createdAt));
  res.json(
    GetPerformanceSummaryResponse.parse(calculateJournalPerformance(rows)),
  );
});

router.get("/alerts", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      alert: alertsTable,
      symbol: marketsTable.symbol,
      strategyName: strategiesTable.name,
      versionNumber: strategyVersionsTable.versionNumber,
    })
    .from(alertsTable)
    .leftJoin(marketsTable, eq(alertsTable.marketId, marketsTable.id))
    .leftJoin(strategyVersionsTable, eq(alertsTable.strategyVersionId, strategyVersionsTable.id))
    .leftJoin(strategiesTable, eq(strategyVersionsTable.strategyId, strategiesTable.id))
    .orderBy(desc(alertsTable.updatedAt));
  res.json(ListAlertsResponse.parse(rows.map(({ alert, symbol, strategyName, versionNumber }) => alertView(alert, {
    marketSymbol: symbol,
    strategyName,
    versionNumber,
  }))));
});

router.post("/alerts", async (req, res): Promise<void> => {
  const parsed = CreateAlertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [created] = await db.insert(alertsTable).values({ ...parsed.data, sourceType: "manual" }).returning();
  res.status(201).json(CreateAlertResponse.parse(alertView(created, {
    marketSymbol: await marketSymbol(created.marketId),
    strategyName: null,
    versionNumber: null,
  })));
});

router.patch("/alerts/:alertId", async (req, res): Promise<void> => {
  const params = UpdateAlertParams.safeParse(req.params);
  const body = UpdateAlertBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [updated] = await db
    .update(alertsTable)
    .set({
      ...body.data,
      acknowledgedAt: body.data.status === "acknowledged" ? new Date() : body.data.status === "triggered" ? null : undefined,
      updatedAt: new Date(),
    })
    .where(eq(alertsTable.id, params.data.alertId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  const [context] = await db
    .select({
      marketSymbol: marketsTable.symbol,
      strategyName: strategiesTable.name,
      versionNumber: strategyVersionsTable.versionNumber,
    })
    .from(alertsTable)
    .leftJoin(marketsTable, eq(alertsTable.marketId, marketsTable.id))
    .leftJoin(strategyVersionsTable, eq(alertsTable.strategyVersionId, strategyVersionsTable.id))
    .leftJoin(strategiesTable, eq(strategyVersionsTable.strategyId, strategiesTable.id))
    .where(eq(alertsTable.id, updated.id));
  res.json(UpdateAlertResponse.parse(alertView(updated, context ?? {
    marketSymbol: await marketSymbol(updated.marketId),
    strategyName: null,
    versionNumber: null,
  })));
});

router.delete("/alerts/:alertId", async (req, res): Promise<void> => {
  const params = DeleteAlertParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(alertsTable).where(eq(alertsTable.id, params.data.alertId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/settings", async (_req, res): Promise<void> => {
  let [settings] = await db.select().from(userSettingsTable).limit(1);
  if (!settings) {
    [settings] = await db.insert(userSettingsTable).values({}).returning();
  }
  res.json(GetSettingsResponse.parse(settings));
});

router.patch("/settings", async (req, res): Promise<void> => {
  const body = UpdateSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  let [settings] = await db.select({ id: userSettingsTable.id }).from(userSettingsTable).limit(1);
  if (!settings) {
    [settings] = await db.insert(userSettingsTable).values(body.data).returning({ id: userSettingsTable.id });
  } else {
    await db.update(userSettingsTable).set({ ...body.data, updatedAt: new Date() }).where(eq(userSettingsTable.id, settings.id));
  }
  const [updated] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.id, settings.id));
  res.json(UpdateSettingsResponse.parse(updated));
});

export default router;