import { Router, type IRouter } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  backtestConfigurationsTable,
  backtestTradesTable,
  db,
  marketsTable,
  marketDataSourcesTable,
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
import { marketDataService } from "../services/market-data";
import { runHistoricalBacktest } from "../services/backtest-engine";

const router: IRouter = Router();

function backtestView(row: {
  configuration: typeof backtestConfigurationsTable.$inferSelect;
  strategyName: string;
  versionNumber: number;
  instrumentSymbol: string;
  timeframeLabel: string;
}) {
  return {
    ...row.configuration,
    strategyName: row.strategyName,
    versionNumber: row.versionNumber,
    instrumentSymbol: row.instrumentSymbol,
    timeframeLabel: row.timeframeLabel,
  };
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
  return row ? backtestView(row) : null;
}

async function executeBacktest(backtestId: number) {
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

  try {
    const [[version], conditions, [source]] = await Promise.all([
      db.select().from(strategyVersionsTable).where(and(
        eq(strategyVersionsTable.id, configuration.strategyVersionId),
        eq(strategyVersionsTable.strategyId, configuration.strategyId),
      )),
      db.select().from(strategyVersionConditionsTable)
        .where(eq(strategyVersionConditionsTable.strategyVersionId, configuration.strategyVersionId))
        .orderBy(asc(strategyVersionConditionsTable.conditionOrder)),
      db.select().from(marketDataSourcesTable)
        .where(eq(marketDataSourcesTable.providerKey, "biquote")),
    ]);
    if (!version) throw new Error("The exact strategy version for this backtest no longer exists.");
    if (!source) throw new Error("BiQuote is not configured as a historical market-data source.");

    const candles = await marketDataService.historicalCandles({
      sourceId: source.id,
      instrumentId: configuration.instrumentId,
      timeframeId: configuration.timeframeId,
      from: configuration.startDate,
      to: configuration.endDate,
    });
    if (!candles.length) {
      throw new Error("Insufficient historical data for the selected instrument and period.");
    }

    const result = runHistoricalBacktest({
      direction: version.direction as "long" | "short" | "both",
      entryRules: version.entryRules,
      exitRules: version.exitRules,
      riskRules: version.riskRules ?? version.riskManagementRules,
      conditions: conditions.map(condition => ({
        name: condition.name,
        stage: condition.stage as "entry" | "confirmation" | "invalidation" | "exit",
        direction: condition.direction as "long" | "short" | "both",
        requirement: condition.requirement as "required" | "optional",
        triggerRules: condition.triggerRules,
        invalidationRules: condition.invalidationRules,
        conceptDetectionRules: condition.conceptDetectionRules,
      })),
    }, candles);
    const completedAt = new Date();

    await db.transaction(async tx => {
      if (result.trades.length) {
        await tx.insert(backtestTradesTable).values(result.trades.map(trade => ({
          backtestId,
          strategyId: configuration.strategyId,
          strategyVersionId: configuration.strategyVersionId,
          instrumentId: configuration.instrumentId,
          timeframeId: configuration.timeframeId,
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
      errorMessage: error instanceof Error ? error.message : "Historical backtest failed.",
      completedAt: new Date(),
    }).where(eq(backtestConfigurationsTable.id, backtestId));
  }
  return findBacktest(backtestId);
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
  res.json(ListBacktestsResponse.parse(rows.map(backtestView)));
});

router.post("/backtests", async (req, res): Promise<void> => {
  const parsed = CreateBacktestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { strategyId, strategyVersionId, instrumentId, timeframeId, startDate, endDate } = parsed.data;
  if (startDate >= endDate) {
    res.status(400).json({ error: "Start date must be before end date." });
    return;
  }

  const [[version], [instrument], [timeframe]] = await Promise.all([
    db.select({ id: strategyVersionsTable.id })
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
  const result = await executeBacktest(created.id);
  res.status(201).json(CreateBacktestResponse.parse(result));
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

export default router;