import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, inArray, max, min, ne } from "drizzle-orm";
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
const queuedBacktests = new Set<number>();
const backtestQueue: number[] = [];
const inFlightBacktestRequests = new Map<string, number>();
let backtestWorkerRunning = false;
const BACKTEST_CANDLE_WRITE_BATCH_SIZE = 500;
const ACTIVE_BACKTEST_STATUSES = ["queued", "downloading_data", "processing", "pending", "running"] as const;

type BacktestProgressTimeframe = {
  timeframeId: number;
  code: string;
  label: string;
  status: "queued" | "downloading" | "complete" | "failed";
  candlesProcessed: number;
  earliestCandle: string | null;
  latestCandle: string | null;
  coverageState: string;
};

type BacktestProgress = {
  phase: "queued" | "downloading_data" | "processing" | "completed" | "failed" | "cancelled";
  message: string;
  timeframes: BacktestProgressTimeframe[];
  candlesDownloaded: number;
  candlesTotal: number | null;
  processingIndex: number | null;
  processingTotal: number | null;
};

class BacktestCancelledError extends Error {
  constructor() {
    super("Backtest cancelled by the user.");
    this.name = "BacktestCancelledError";
  }
}

function queuedProgress(message = "Waiting for a worker to start this backtest."): BacktestProgress {
  return {
    phase: "queued",
    message,
    timeframes: [],
    candlesDownloaded: 0,
    candlesTotal: null,
    processingIndex: null,
    processingTotal: null,
  };
}

async function setBacktestProgress(backtestId: number, progress: BacktestProgress, status?: string) {
  await db.update(backtestConfigurationsTable).set({
    ...(status ? { status } : {}),
    progress,
  }).where(and(
    eq(backtestConfigurationsTable.id, backtestId),
    ne(backtestConfigurationsTable.status, "cancelled"),
  ));
}

async function assertBacktestNotCancelled(backtestId: number) {
  const [row] = await db.select({ status: backtestConfigurationsTable.status })
    .from(backtestConfigurationsTable)
    .where(eq(backtestConfigurationsTable.id, backtestId));
  if (!row || row.status === "cancelled") throw new BacktestCancelledError();
}

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
    canonicalState: condition.canonicalDefinition && typeof condition.canonicalDefinition === "object"
      ? (condition.canonicalDefinition as Record<string, unknown>).conditionState as BacktestCondition["canonicalState"]
      : null,
    invalidationRules: condition.invalidationRules,
    conceptDetectionRules: condition.conceptDetectionRules,
  };
}

function timeframeKey(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function requiredBacktestTimeframes(
  timeframes: Array<{ id: number; code: string; label: string; durationSeconds: number }>,
  configuredTimeframeId: number,
  conditions: BacktestCondition[],
) {
  const configuredTimeframe = timeframes.find(timeframe => timeframe.id === configuredTimeframeId);
  if (!configuredTimeframe) throw new Error("The selected backtest timeframe no longer exists.");
  const requestedCodes = [...new Set([
    configuredTimeframe.code,
    ...conditions.map(condition => condition.timeframe).filter((value): value is string => Boolean(value?.trim())),
  ])];
  return requestedCodes.map(code => {
    const match = timeframes.find(timeframe =>
      timeframeKey(timeframe.code) === timeframeKey(code) || timeframeKey(timeframe.label) === timeframeKey(code),
    );
    if (!match) throw new Error(`The strategy references an unavailable timeframe: ${code}.`);
    return match;
  });
}

export function utcDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function availabilityBoundaryError(endDate: Date, timeframes: Array<{
  timeframeLabel: string;
  latestCandle: Date | null;
}>) {
  const unavailable = timeframes.filter(timeframe => timeframe.latestCandle == null);
  if (unavailable.length) {
    return `Backtest cannot start because no cached historical data is available for ${unavailable.map(timeframe => timeframe.timeframeLabel).join(", ")}.`;
  }
  const latestAvailableCandle = new Date(Math.min(...timeframes.map(timeframe => timeframe.latestCandle!.getTime())));
  if (utcDay(endDate) <= utcDay(latestAvailableCandle)) return null;
  const timeframeBoundaries = timeframes
    .map(timeframe => `${timeframe.timeframeLabel}: ${formatHistoricalBoundary(new Date(timeframe.latestCandle!))}`)
    .join("; ");
  return `Backtest cannot start because historical data is only available through ${formatHistoricalBoundary(latestAvailableCandle)} for the selected data series. ${timeframeBoundaries}`;
}

function formatHistoricalBoundary(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value) + " UTC";
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
    timeframeId: number;
    code: string;
    label: string;
    candlesProcessed: number;
    earliestCandle: Date;
    latestCandle: Date;
  }>;
  statistics?: ReturnType<typeof calculateBacktestStatistics>;
}) {
  const statistics = row.statistics;
  const persistedProgress = row.configuration.progress;
  const progress = persistedProgress && typeof persistedProgress === "object"
    && "phase" in persistedProgress && "message" in persistedProgress && "timeframes" in persistedProgress
    ? persistedProgress as BacktestProgress
    : {
      phase: row.configuration.status === "completed" ? "completed" : row.configuration.status === "failed" ? "failed" : "queued",
      message: row.configuration.status === "completed"
        ? "Backtest completed."
        : row.configuration.errorMessage || "Backtest is waiting to run.",
      timeframes: (row.timeframeSummaries || []).map(summary => ({
        timeframeId: summary.timeframeId,
        code: summary.code,
        label: summary.label,
        status: "complete" as const,
        candlesProcessed: summary.candlesProcessed,
        earliestCandle: summary.earliestCandle.toISOString(),
        latestCandle: summary.latestCandle.toISOString(),
        coverageState: "complete",
      })),
      candlesDownloaded: row.configuration.candlesProcessed,
      candlesTotal: row.configuration.candlesProcessed,
      processingIndex: row.configuration.status === "completed" ? row.configuration.candlesProcessed : null,
      processingTotal: row.configuration.status === "completed" ? row.configuration.candlesProcessed : null,
    } satisfies BacktestProgress;
  return {
    ...row.configuration,
    progress,
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
  if (configuration.status === "cancelled") return findBacktest(backtestId);

  const startedAt = new Date();
  await db.update(backtestConfigurationsTable).set({
    status: "downloading_data",
    startedAt,
    completedAt: null,
    errorMessage: null,
    candlesProcessed: 0,
    tradeCount: 0,
    resultMessage: null,
    progress: queuedProgress("Preparing historical data retrieval."),
  }).where(eq(backtestConfigurationsTable.id, backtestId));
  await db.delete(backtestTradesTable).where(eq(backtestTradesTable.backtestId, backtestId));
  await db.delete(backtestCandlesTable).where(eq(backtestCandlesTable.backtestId, backtestId));

  let progressTimeframes: BacktestProgressTimeframe[] = [];
  const loadedSeries: Array<{
    code: string;
    durationSeconds: number;
    candles: Awaited<ReturnType<typeof marketDataService.historicalCandles>>;
    coverage: ReturnType<typeof historicalCandleCoverage>;
  }> = [];
  try {
    await assertBacktestNotCancelled(backtestId);
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

    const requestedTimeframes = requiredBacktestTimeframes(timeframes, configuration.timeframeId, engineConditions);
    progressTimeframes = requestedTimeframes.map(timeframe => ({
      timeframeId: timeframe.id,
      code: timeframe.code,
      label: timeframe.label,
      status: "queued",
      candlesProcessed: 0,
      earliestCandle: null,
      latestCandle: null,
      coverageState: "pending",
    }));
    for (const [index, timeframe] of requestedTimeframes.entries()) {
      await assertBacktestNotCancelled(backtestId);
      progressTimeframes[index] = { ...progressTimeframes[index], status: "downloading" };
      await setBacktestProgress(backtestId, {
        phase: "downloading_data",
        message: `Downloading ${timeframe.label} historical data.`,
        timeframes: progressTimeframes,
        candlesDownloaded: progressTimeframes.reduce((total, item) => total + item.candlesProcessed, 0),
        candlesTotal: null,
        processingIndex: null,
        processingTotal: null,
      }, "downloading_data");
      let candles: Awaited<ReturnType<typeof marketDataService.historicalCandles>>;
      let coverage: ReturnType<typeof historicalCandleCoverage>;
      try {
        candles = (await marketDataService.historicalCandles({
          sourceId: source.id,
          instrumentId: configuration.instrumentId,
          timeframeId: timeframe.id,
          from: configuration.startDate,
          to: configuration.endDate,
        })).filter(candle => candle.isClosed);
        coverage = historicalCandleCoverage(candles, {
          from: configuration.startDate,
          to: configuration.endDate,
          timeframeCode: timeframe.code,
          timeframeDurationSeconds: timeframe.durationSeconds,
        });
      } catch (error) {
        progressTimeframes[index] = {
          ...progressTimeframes[index],
          status: "failed",
          coverageState: "partial",
        };
        throw error;
      }
      progressTimeframes[index] = {
        ...progressTimeframes[index],
        status: "complete",
        candlesProcessed: candles.length,
        earliestCandle: coverage.earliestCandle.toISOString(),
        latestCandle: coverage.latestCandle.toISOString(),
        coverageState: "complete",
      };
      loadedSeries.push({
        code: timeframe.code,
        durationSeconds: timeframe.durationSeconds,
        candles,
        coverage,
      });
      await setBacktestProgress(backtestId, {
        phase: "downloading_data",
        message: `${timeframe.label} historical data is complete.`,
        timeframes: progressTimeframes,
        candlesDownloaded: progressTimeframes.reduce((total, item) => total + item.candlesProcessed, 0),
        candlesTotal: progressTimeframes.reduce((total, item) => total + item.candlesProcessed, 0),
        processingIndex: null,
        processingTotal: null,
      }, "downloading_data");
    }
    await assertBacktestNotCancelled(backtestId);
    const executionTimeframe = [...loadedSeries].sort((left, right) => left.durationSeconds - right.durationSeconds)[0];
    if (!executionTimeframe?.candles.length) {
      throw new Error("Insufficient historical data for the selected instrument and period.");
    }

    const totalCandles = loadedSeries.reduce((total, series) => total + series.candles.length, 0);
    await setBacktestProgress(backtestId, {
      phase: "processing",
      message: "Processing the completed historical candle series.",
      timeframes: progressTimeframes,
      candlesDownloaded: totalCandles,
      candlesTotal: totalCandles,
      processingIndex: 0,
      processingTotal: totalCandles,
    }, "processing");
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
    await assertBacktestNotCancelled(backtestId);
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
      for (let offset = 0; offset < candleRows.length; offset += BACKTEST_CANDLE_WRITE_BATCH_SIZE) {
        await tx.insert(backtestCandlesTable)
          .values(candleRows.slice(offset, offset + BACKTEST_CANDLE_WRITE_BATCH_SIZE));
      }
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
      const [savedConfiguration] = await tx.update(backtestConfigurationsTable).set({
        status: "completed",
        candlesProcessed: result.candlesProcessed,
        tradeCount: result.trades.length,
        resultMessage: result.message,
        executionAssumptions: result.assumptions.join("\n"),
        errorMessage: null,
        completedAt,
        progress: {
          phase: "completed",
          message: "Backtest completed.",
          timeframes: progressTimeframes,
          candlesDownloaded: candleRows.length,
          candlesTotal: candleRows.length,
          processingIndex: candleRows.length,
          processingTotal: candleRows.length,
        } satisfies BacktestProgress,
      }).where(and(
        eq(backtestConfigurationsTable.id, backtestId),
        eq(backtestConfigurationsTable.status, "processing"),
      )).returning({ id: backtestConfigurationsTable.id });
      if (!savedConfiguration) throw new BacktestCancelledError();
    });
  } catch (error) {
    if (error instanceof BacktestCancelledError) {
      await setBacktestProgress(backtestId, {
        phase: "cancelled",
        message: error.message,
        timeframes: progressTimeframes,
        candlesDownloaded: loadedSeries.reduce((total, series) => total + series.candles.length, 0),
        candlesTotal: null,
        processingIndex: null,
        processingTotal: null,
      }, "cancelled");
      return findBacktest(backtestId);
    }
    await db.update(backtestConfigurationsTable).set({
      status: "failed",
      resultMessage: null,
      errorMessage: publicBacktestError(error),
      completedAt: new Date(),
      progress: {
        phase: "failed",
        message: publicBacktestError(error),
        timeframes: progressTimeframes,
        candlesDownloaded: loadedSeries.reduce((total, series) => total + series.candles.length, 0),
        candlesTotal: null,
        processingIndex: null,
        processingTotal: null,
      } satisfies BacktestProgress,
    }).where(and(
      eq(backtestConfigurationsTable.id, backtestId),
      ne(backtestConfigurationsTable.status, "cancelled"),
    ));
  }
  return findBacktest(backtestId);
}

function clearInFlightBacktest(backtestId: number) {
  for (const [requestKey, id] of inFlightBacktestRequests.entries()) {
    if (id === backtestId) inFlightBacktestRequests.delete(requestKey);
  }
}

async function executeBacktest(backtestId: number) {
  if (activeBacktests.has(backtestId)) return findBacktest(backtestId);
  activeBacktests.add(backtestId);
  try {
    return await executeBacktestInternal(backtestId);
  } finally {
    activeBacktests.delete(backtestId);
    clearInFlightBacktest(backtestId);
  }
}

function drainBacktestQueue() {
  if (backtestWorkerRunning) return;
  backtestWorkerRunning = true;
  void (async () => {
    try {
      while (backtestQueue.length) {
        const backtestId = backtestQueue.shift();
        if (backtestId == null) continue;
        queuedBacktests.delete(backtestId);
        await executeBacktest(backtestId);
      }
    } finally {
      backtestWorkerRunning = false;
      if (backtestQueue.length) drainBacktestQueue();
    }
  })();
}

function enqueueBacktest(backtestId: number) {
  if (activeBacktests.has(backtestId) || queuedBacktests.has(backtestId)) return;
  queuedBacktests.add(backtestId);
  backtestQueue.push(backtestId);
  drainBacktestQueue();
}

export async function resumeBacktestJobs() {
  const rows = await db.select({ id: backtestConfigurationsTable.id })
    .from(backtestConfigurationsTable)
    .where(inArray(backtestConfigurationsTable.status, [...ACTIVE_BACKTEST_STATUSES]));
  if (!rows.length) return;
  await db.update(backtestConfigurationsTable)
    .set({ status: "queued", progress: queuedProgress("Resuming this backtest after the server restarted.") })
    .where(inArray(backtestConfigurationsTable.id, rows.map(row => row.id)));
  rows.forEach(row => enqueueBacktest(row.id));
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

  const activeTimeframes = await db.select({
    id: timeframesTable.id,
    code: timeframesTable.code,
    label: timeframesTable.label,
    durationSeconds: timeframesTable.durationSeconds,
  }).from(timeframesTable).where(eq(timeframesTable.isActive, true));
  let requestedTimeframes: typeof activeTimeframes;
  try {
    requestedTimeframes = requiredBacktestTimeframes(activeTimeframes, timeframeId, conditions.map(engineCondition));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "The selected strategy references an unavailable timeframe." });
    return;
  }
  let availability;
  try {
    const source = await marketDataService.historicalSourceForInstrument(instrumentId);
    availability = await marketDataService.latestHistoricalDataAvailability({
      sourceId: source.id,
      instrumentId,
      timeframeIds: requestedTimeframes.map(timeframe => timeframe.id),
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Historical availability could not be checked." });
    return;
  }
  const availabilityError = availabilityBoundaryError(endDate, availability.timeframes);
  if (availabilityError) {
    res.status(400).json({ error: availabilityError });
    return;
  }

  const requestKey = JSON.stringify({ strategyId, strategyVersionId, instrumentId, timeframeId, preset: parsed.data.preset, startDate, endDate });
  const existingInFlightId = inFlightBacktestRequests.get(requestKey);
  if (existingInFlightId) {
    const result = await findBacktest(existingInFlightId);
    if (result) {
      res.status(200).json(CreateBacktestResponse.parse(result));
      return;
    }
    inFlightBacktestRequests.delete(requestKey);
  }
  const [existingJob] = await db.select({ id: backtestConfigurationsTable.id })
    .from(backtestConfigurationsTable)
    .where(and(
      eq(backtestConfigurationsTable.strategyId, strategyId),
      eq(backtestConfigurationsTable.strategyVersionId, strategyVersionId),
      eq(backtestConfigurationsTable.instrumentId, instrumentId),
      eq(backtestConfigurationsTable.timeframeId, timeframeId),
      eq(backtestConfigurationsTable.preset, parsed.data.preset),
      eq(backtestConfigurationsTable.startDate, startDate),
      eq(backtestConfigurationsTable.endDate, endDate),
      inArray(backtestConfigurationsTable.status, [...ACTIVE_BACKTEST_STATUSES]),
    ));
  if (existingJob) {
    const result = await findBacktest(existingJob.id);
    if (result) {
      inFlightBacktestRequests.set(requestKey, existingJob.id);
      res.status(200).json(CreateBacktestResponse.parse(result));
      return;
    }
  }
  const [created] = await db.insert(backtestConfigurationsTable).values({
    strategyId,
    strategyVersionId,
    instrumentId,
    timeframeId,
    preset: parsed.data.preset,
    startDate,
    endDate,
    status: "queued",
    progress: queuedProgress(),
  }).returning();
  inFlightBacktestRequests.set(requestKey, created.id);
  enqueueBacktest(created.id);
  const result = await findBacktest(created.id);
  if (!result) {
    res.status(500).json({ error: "Backtest job could not be created." });
    return;
  }
  res.status(202).json(CreateBacktestResponse.parse(result));
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
  const result = await findBacktest(id);
  if (!result) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }
  if (result.status === "completed") {
    res.json(result);
    return;
  }
  if (result.status === "failed" || result.status === "cancelled" || result.status === "configured") {
    await db.update(backtestConfigurationsTable).set({
      status: "queued",
      completedAt: null,
      errorMessage: null,
      progress: queuedProgress(),
    }).where(eq(backtestConfigurationsTable.id, id));
  }
  enqueueBacktest(id);
  res.json(await findBacktest(id));
});

router.post("/backtests/:backtestId/cancel", async (req, res): Promise<void> => {
  const id = Number(req.params.backtestId);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "backtestId must be a positive integer" });
    return;
  }
  const current = await findBacktest(id);
  if (!current) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }
  if (current.status === "completed" || current.status === "failed" || current.status === "cancelled") {
    res.json(current);
    return;
  }
  const progress = (current.progress && typeof current.progress === "object" ? current.progress : queuedProgress()) as BacktestProgress;
  await db.update(backtestConfigurationsTable).set({
    status: "cancelled",
    completedAt: new Date(),
    progress: {
      ...progress,
      phase: "cancelled",
      message: "Backtest cancelled by the user.",
    } satisfies BacktestProgress,
  }).where(eq(backtestConfigurationsTable.id, id));
  res.json(await findBacktest(id));
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
  if (backtest.status !== "completed") {
    res.status(409).json({ error: `Backtest result is not available while this job is ${backtest.status}.` });
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