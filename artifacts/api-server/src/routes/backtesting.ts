import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, max, min } from "drizzle-orm";
import {
  backtestCandlesTable,
  backtestConfigurationsTable,
  backtestTradesTable,
  db,
  marketsTable,
  strategiesTable,
  strategyVersionConditionsTable,
  strategyVersionsTable,
  timeframesTable,
} from "@workspace/db";
import {
  CreateBacktestBody,
  CreateBacktestResponse,
  ListBacktestsResponse,
} from "@workspace/api-zod";
import { historicalCandleCoverage, marketDataService } from "../services/market-data";
import { runHistoricalBacktest, validateHistoricalBacktestStrategy, type BacktestCondition, type HistoricalBacktestInput } from "../services/backtest-engine";
import { calculateBacktestStatistics } from "../services/backtest-results";
import { HistoricalDataError } from "../services/historical-errors";

const router: IRouter = Router();
const activeBacktests = new Set<number>();
const inFlightBacktestRequests = new Map<string, Promise<any>>();

function engineCondition(condition: typeof strategyVersionConditionsTable.$inferSelect): BacktestCondition {
  return {
    name: condition.name,
    conceptName: condition.conceptName,
    timeframe: condition.timeframe,
    stage: condition.stage as BacktestCondition["stage"],
    direction: condition.direction as BacktestCondition["direction"],
    requirement: condition.requirement as BacktestCondition["requirement"],
    triggerRules: condition.triggerRules,
    parameters: condition.parameters,
    invalidationRules: condition.invalidationRules,
    conceptDetectionRules: condition.conceptDetectionRules,
  };
}

function timeframeKey(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "");
}

async function timeframeSummariesForBacktest(id: number) {
  const rows = await db.select({
    timeframeId: timeframesTable.id,
    code: timeframesTable.code,
    label: timeframesTable.label,
    durationSeconds: timeframesTable.durationSeconds,
    candlesProcessed: count(backtestCandlesTable.id),
    earliestCandle: min(backtestCandlesTable.openTime),
    latestCandle: max(backtestCandlesTable.openTime),
  }).from(backtestCandlesTable)
    .innerJoin(timeframesTable, eq(backtestCandlesTable.timeframeId, timeframesTable.id))
    .where(eq(backtestCandlesTable.backtestId, id))
    .groupBy(timeframesTable.id, timeframesTable.code, timeframesTable.label, timeframesTable.durationSeconds);
  const summaries = new Map<string, {
    timeframeId: number;
    code: string;
    label: string;
    durationSeconds: number;
    candlesProcessed: number;
    earliestCandle: Date;
    latestCandle: Date;
  }>();
  for (const row of rows) {
    const key = timeframeKey(row.code);
    if (!row.earliestCandle || !row.latestCandle) continue;
    summaries.set(key, {
      timeframeId: row.timeframeId,
      code: row.code,
      label: row.label,
      durationSeconds: row.durationSeconds,
      candlesProcessed: Number(row.candlesProcessed),
      earliestCandle: row.earliestCandle,
      latestCandle: row.latestCandle,
    });
  }
  const ordered = [...summaries.values()].sort((left, right) => left.durationSeconds - right.durationSeconds);
  return ordered.map((summary, index) => ({
    timeframeId: summary.timeframeId,
    code: summary.code,
    label: summary.label,
    candlesProcessed: summary.candlesProcessed,
    earliestCandle: summary.earliestCandle,
    latestCandle: summary.latestCandle,
    isExecutionTimeframe: index === 0,
  }));
}

function publicBacktestError(error: unknown) {
  if (error instanceof HistoricalDataError) {
    if (error.code === "rate_limited") {
      return "Historical provider rate limit reached after retries. Try again later; any candles already cached remain available.";
    }
    if (error.code === "provider_failure") {
      return "Historical provider could not be reached after retries. No new backtest result was saved; try again later.";
    }
    return error.message;
  }
  const message = error instanceof Error ? error.message : "";
  if (/not compatible|insufficient historical data|historical data for|pagination did not reach|not configured|no longer exists|no executable|not supported|risk rules mention/i.test(message)) {
    return message;
  }
  return "Historical backtest failed while retrieving market data or saving results.";
}

function backtestView(row: {
  configuration: typeof backtestConfigurationsTable.$inferSelect;
  strategyName: string;
  versionNumber: number;
  instrumentSymbol: string;
  timeframeLabel: string;
  timeframeSummaries?: Array<{
    code: string;
    label: string;
    candlesProcessed: number;
    earliestCandle: Date;
    latestCandle: Date;
  }>;
  statistics?: ReturnType<typeof calculateBacktestStatistics>;
}) {
  const statistics = row.statistics;
  return {
    ...row.configuration,
    strategyName: row.strategyName,
    versionNumber: row.versionNumber,
    instrumentSymbol: row.instrumentSymbol,
    timeframeLabel: row.timeframeLabel,
    timeframeSummaries: row.timeframeSummaries,
    winningTrades: statistics?.winningTrades ?? 0,
    losingTrades: statistics?.losingTrades ?? 0,
    winRate: statistics?.winRate ?? null,
    totalPnl: statistics?.totalPnl ?? null,
  };
}

async function statisticsForBacktest(id: number) {
  const trades = await db.select({
    id: backtestTradesTable.id,
    entryTime: backtestTradesTable.entryTime,
    exitTime: backtestTradesTable.exitTime,
    pnl: backtestTradesTable.pnl,
  }).from(backtestTradesTable).where(eq(backtestTradesTable.backtestId, id));
  const [configuration] = await db.select({ startDate: backtestConfigurationsTable.startDate })
    .from(backtestConfigurationsTable)
    .where(eq(backtestConfigurationsTable.id, id));
  return calculateBacktestStatistics(trades.map(trade => ({
    ...trade,
    pnl: Number(trade.pnl),
  })), configuration?.startDate ?? new Date(0));
}

async function findBacktest(id: number) {
  const [row] = await db
    .select({
      configuration: backtestConfigurationsTable,
      strategyName: strategiesTable.name,
      versionNumber: strategyVersionsTable.versionNumber,
      instrumentSymbol: marketsTable.symbol,
      timeframeLabel: timeframesTable.label,
    })
    .from(backtestConfigurationsTable)
    .innerJoin(strategiesTable, eq(backtestConfigurationsTable.strategyId, strategiesTable.id))
    .innerJoin(strategyVersionsTable, eq(backtestConfigurationsTable.strategyVersionId, strategyVersionsTable.id))
    .innerJoin(marketsTable, eq(backtestConfigurationsTable.instrumentId, marketsTable.id))
    .innerJoin(timeframesTable, eq(backtestConfigurationsTable.timeframeId, timeframesTable.id))
    .where(eq(backtestConfigurationsTable.id, id));
  return row ? backtestView({
    ...row,
    statistics: await statisticsForBacktest(id),
    timeframeSummaries: await timeframeSummariesForBacktest(id),
  }) : null;
}

async function executeBacktestInternal(backtestId: number) {
  const [configuration] = await db
    .select()
    .from(backtestConfigurationsTable)
    .where(eq(backtestConfigurationsTable.id, backtestId));
  if (!configuration) return null;

  const startedAt = new Date();
  await db.update(backtestConfigurationsTable).set({
    status: "running",
    startedAt,
    completedAt: null,
    errorMessage: null,
    candlesProcessed: 0,
    tradeCount: 0,
  }).where(eq(backtestConfigurationsTable.id, backtestId));
  await db.delete(backtestTradesTable).where(eq(backtestTradesTable.backtestId, backtestId));
  await db.delete(backtestCandlesTable).where(eq(backtestCandlesTable.backtestId, backtestId));

  try {
    const [[version], conditions, timeframes] = await Promise.all([
      db.select().from(strategyVersionsTable).where(and(
        eq(strategyVersionsTable.id, configuration.strategyVersionId),
        eq(strategyVersionsTable.strategyId, configuration.strategyId),
      )),
      db.select().from(strategyVersionConditionsTable)
        .where(eq(strategyVersionConditionsTable.strategyVersionId, configuration.strategyVersionId))
        .orderBy(asc(strategyVersionConditionsTable.conditionOrder)),
      db.select().from(timeframesTable).where(eq(timeframesTable.isActive, true)),
    ]);
    if (!version) throw new Error("The exact strategy version for this backtest no longer exists.");
    const engineConditions = conditions.map(engineCondition);
    const compatibilityErrors = validateHistoricalBacktestStrategy({
      direction: version.direction as "long" | "short" | "both",
      entryRules: version.entryRules,
      exitRules: version.exitRules,
      riskRules: version.riskRules ?? version.riskManagementRules,
      conditions: engineConditions,
    });
    if (compatibilityErrors.length) throw new Error(`This strategy version is not compatible with the historical engine: ${compatibilityErrors.join(" ")}`);
    const source = await marketDataService.historicalSourceForInstrument(configuration.instrumentId);

    const configuredTimeframe = timeframes.find(timeframe => timeframe.id === configuration.timeframeId);
    if (!configuredTimeframe) throw new Error("The selected backtest timeframe no longer exists.");
    const requestedCodes = [...new Set([
      configuredTimeframe.code,
      ...engineConditions.map(condition => condition.timeframe).filter((value): value is string => Boolean(value?.trim())),
    ])];
    const requestedTimeframes = requestedCodes.map(code => {
      const match = timeframes.find(timeframe =>
        timeframeKey(timeframe.code) === timeframeKey(code) || timeframeKey(timeframe.label) === timeframeKey(code),
      );
      if (!match) throw new Error(`The strategy references an unavailable timeframe: ${code}.`);
      return match;
    });
    const loadedSeries = await Promise.all(requestedTimeframes.map(async timeframe => {
      const candles = (await marketDataService.historicalCandles({
        sourceId: source.id,
        instrumentId: configuration.instrumentId,
        timeframeId: timeframe.id,
        from: configuration.startDate,
        to: configuration.endDate,
      })).filter(candle => candle.isClosed),
      coverage = historicalCandleCoverage(candles, {
        from: configuration.startDate,
        to: configuration.endDate,
        timeframeCode: timeframe.code,
        timeframeDurationSeconds: timeframe.durationSeconds,
      });
      return {
        code: timeframe.code,
        durationSeconds: timeframe.durationSeconds,
        candles,
        coverage,
      };
    }));
    const executionTimeframe = [...loadedSeries].sort((left, right) => left.durationSeconds - right.durationSeconds)[0];
    if (!executionTimeframe?.candles.length) {
      throw new Error("Insufficient historical data for the selected instrument and period.");
    }

    const result = runHistoricalBacktest({
      direction: version.direction as "long" | "short" | "both",
      entryRules: version.entryRules,
      exitRules: version.exitRules,
      riskRules: version.riskRules ?? version.riskManagementRules,
      conditions: engineConditions,
    }, {
      executionTimeframe: executionTimeframe.code,
      series: loadedSeries.map(({ code, candles: seriesCandles }) => ({ code, candles: seriesCandles })),
    } satisfies HistoricalBacktestInput);
    const completedAt = new Date();

    await db.transaction(async tx => {
       const candleRows = loadedSeries.flatMap(timeframe => timeframe.candles.map(candle => ({
          backtestId,
          sourceId: source.id,
          instrumentId: configuration.instrumentId,
          timeframeId: requestedTimeframes.find(candidate => candidate.code === timeframe.code)!.id,
          openTime: candle.openTime,
          closeTime: candle.closeTime,
          open: candle.open.toString(),
          high: candle.high.toString(),
          low: candle.low.toString(),
          close: candle.close.toString(),
          volume: candle.volume?.toString() ?? null,
          isClosed: candle.isClosed,
        })));
      if (candleRows.length) await tx.insert(backtestCandlesTable).values(candleRows);
      if (result.trades.length) {
        await tx.insert(backtestTradesTable).values(result.trades.map(trade => ({
          backtestId,
          strategyId: configuration.strategyId,
          strategyVersionId: configuration.strategyVersionId,
          instrumentId: configuration.instrumentId,
          timeframeId: requestedTimeframes.find(candidate => candidate.id === configuration.timeframeId)!.id,
          side: trade.side,
          entryTime: trade.entryTime,
          entryPrice: trade.entryPrice.toString(),
          stopLoss: trade.stopLoss?.toString() ?? null,
          takeProfit: trade.takeProfit?.toString() ?? null,
          exitTime: trade.exitTime,
          exitPrice: trade.exitPrice.toString(),
          pnl: trade.pnl.toString(),
          entryReason: trade.entryReason,
          exitReason: trade.exitReason,
        })));
      }
      await tx.update(backtestConfigurationsTable).set({
        status: "completed",
        candlesProcessed: result.candlesProcessed,
        tradeCount: result.trades.length,
        resultMessage: result.message,
        executionAssumptions: result.assumptions.join("\n"),
        errorMessage: null,
        completedAt,
      }).where(eq(backtestConfigurationsTable.id, backtestId));
    });
  } catch (error) {
    await db.update(backtestConfigurationsTable).set({
      status: "failed",
      resultMessage: null,
      errorMessage: publicBacktestError(error),
      completedAt: new Date(),
    }).where(eq(backtestConfigurationsTable.id, backtestId));
  }
  return findBacktest(backtestId);
}

async function executeBacktest(backtestId: number) {
  if (activeBacktests.has(backtestId)) return findBacktest(backtestId);
  activeBacktests.add(backtestId);
  try {
    return await executeBacktestInternal(backtestId);
  } finally {
    activeBacktests.delete(backtestId);
  }
}

router.get("/backtests", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      configuration: backtestConfigurationsTable,
      strategyName: strategiesTable.name,
      versionNumber: strategyVersionsTable.versionNumber,
      instrumentSymbol: marketsTable.symbol,
      timeframeLabel: timeframesTable.label,
    })
    .from(backtestConfigurationsTable)
    .innerJoin(strategiesTable, eq(backtestConfigurationsTable.strategyId, strategiesTable.id))
    .innerJoin(strategyVersionsTable, eq(backtestConfigurationsTable.strategyVersionId, strategyVersionsTable.id))
    .innerJoin(marketsTable, eq(backtestConfigurationsTable.instrumentId, marketsTable.id))
    .innerJoin(timeframesTable, eq(backtestConfigurationsTable.timeframeId, timeframesTable.id))
    .orderBy(desc(backtestConfigurationsTable.createdAt));
  res.json(ListBacktestsResponse.parse(await Promise.all(rows.map(async row => backtestView({
    ...row,
    statistics: await statisticsForBacktest(row.configuration.id),
    timeframeSummaries: await timeframeSummariesForBacktest(row.configuration.id),
  })))));
});

router.post("/backtests", async (req, res): Promise<void> => {
  const parsed = CreateBacktestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { strategyId, strategyVersionId, instrumentId, timeframeId, startDate, endDate } = parsed.data;
  if (![strategyId, strategyVersionId, instrumentId, timeframeId].every(value => Number.isInteger(value) && value > 0)) {
    res.status(400).json({ error: "Strategy, version, instrument, and timeframe IDs must be positive integers." });
    return;
  }
  if (startDate >= endDate) {
    res.status(400).json({ error: "Start date must be before end date." });
    return;
  }

  const [[version], [instrument], [timeframe]] = await Promise.all([
    db.select({
      id: strategyVersionsTable.id,
      direction: strategyVersionsTable.direction,
      entryRules: strategyVersionsTable.entryRules,
      exitRules: strategyVersionsTable.exitRules,
      riskRules: strategyVersionsTable.riskRules,
      riskManagementRules: strategyVersionsTable.riskManagementRules,
    })
      .from(strategyVersionsTable)
      .where(and(eq(strategyVersionsTable.id, strategyVersionId), eq(strategyVersionsTable.strategyId, strategyId))),
    db.select({ id: marketsTable.id }).from(marketsTable).where(eq(marketsTable.id, instrumentId)),
    db.select({ id: timeframesTable.id }).from(timeframesTable).where(eq(timeframesTable.id, timeframeId)),
  ]);
  if (!version) {
    res.status(400).json({ error: "The selected strategy version does not belong to the selected strategy." });
    return;
  }
  if (!instrument || !timeframe) {
    res.status(400).json({ error: "The selected instrument or timeframe was not found." });
    return;
  }
  const conditions = await db.select().from(strategyVersionConditionsTable)
    .where(eq(strategyVersionConditionsTable.strategyVersionId, strategyVersionId))
    .orderBy(asc(strategyVersionConditionsTable.conditionOrder));
  const compatibilityErrors = validateHistoricalBacktestStrategy({
    direction: version.direction as "long" | "short" | "both",
    entryRules: version.entryRules,
    exitRules: version.exitRules,
    riskRules: version.riskRules ?? version.riskManagementRules,
    conditions: conditions.map(engineCondition),
  });
  if (compatibilityErrors.length) {
    res.status(400).json({ error: `This strategy version is not compatible with the historical engine: ${compatibilityErrors.join(" ")}` });
    return;
  }

  const requestKey = JSON.stringify({ strategyId, strategyVersionId, instrumentId, timeframeId, preset: parsed.data.preset, startDate, endDate });
  const existingRequest = inFlightBacktestRequests.get(requestKey);
  if (existingRequest) {
    const result = await existingRequest;
    res.status(200).json(CreateBacktestResponse.parse(result));
    return;
  }
  const request = (async () => {
    const [created] = await db.insert(backtestConfigurationsTable).values({
      strategyId,
      strategyVersionId,
      instrumentId,
      timeframeId,
      preset: parsed.data.preset,
      startDate,
      endDate,
      status: "pending",
    }).returning();
    return executeBacktest(created.id);
  })();
  inFlightBacktestRequests.set(requestKey, request);
  try {
    const result = await request;
    res.status(201).json(CreateBacktestResponse.parse(result));
  } finally {
    inFlightBacktestRequests.delete(requestKey);
  }
});

router.get("/backtests/:backtestId", async (req, res): Promise<void> => {
  const id = Number(req.params.backtestId);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "backtestId must be a positive integer" });
    return;
  }
  const result = await findBacktest(id);
  if (!result) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }
  res.json(result);
});

router.post("/backtests/:backtestId/run", async (req, res): Promise<void> => {
  const id = Number(req.params.backtestId);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "backtestId must be a positive integer" });
    return;
  }
  const result = await executeBacktest(id);
  if (!result) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }
  res.json(result);
});

router.get("/backtests/:backtestId/trades", async (req, res): Promise<void> => {
  const id = Number(req.params.backtestId);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "backtestId must be a positive integer" });
    return;
  }
  const backtest = await findBacktest(id);
  if (!backtest) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }
  const trades = await db.select().from(backtestTradesTable)
    .where(eq(backtestTradesTable.backtestId, id))
    .orderBy(asc(backtestTradesTable.entryTime));
  res.json(trades.map(trade => ({
    ...trade,
    entryPrice: Number(trade.entryPrice),
    stopLoss: trade.stopLoss == null ? null : Number(trade.stopLoss),
    takeProfit: trade.takeProfit == null ? null : Number(trade.takeProfit),
    exitPrice: Number(trade.exitPrice),
    pnl: Number(trade.pnl),
  })));
});

router.get("/backtests/:backtestId/results", async (req, res): Promise<void> => {
  const id = Number(req.params.backtestId);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "backtestId must be a positive integer" });
    return;
  }
  const backtest = await findBacktest(id);
  if (!backtest) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }
  const [tradeRows, candleRows] = await Promise.all([
    db.select().from(backtestTradesTable).where(eq(backtestTradesTable.backtestId, id)).orderBy(asc(backtestTradesTable.entryTime)),
    db.select().from(backtestCandlesTable).where(eq(backtestCandlesTable.backtestId, id)).orderBy(asc(backtestCandlesTable.openTime)),
  ]);
  const trades = tradeRows.map(trade => ({
    ...trade,
    entryPrice: Number(trade.entryPrice),
    stopLoss: trade.stopLoss == null ? null : Number(trade.stopLoss),
    takeProfit: trade.takeProfit == null ? null : Number(trade.takeProfit),
    exitPrice: Number(trade.exitPrice),
    pnl: Number(trade.pnl),
  }));
  const candles = candleRows.map(candle => ({
    ...candle,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: candle.volume == null ? null : Number(candle.volume),
  }));
  res.json({
    backtest,
    trades,
    candles,
    statistics: calculateBacktestStatistics(trades.map(trade => ({
      id: trade.id,
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      pnl: trade.pnl,
    })), new Date(backtest.startDate)),
  });
});

export default router;