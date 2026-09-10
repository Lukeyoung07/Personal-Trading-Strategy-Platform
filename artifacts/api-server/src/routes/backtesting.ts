import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  backtestConfigurationsTable,
  db,
  marketsTable,
  strategiesTable,
  strategyVersionsTable,
  timeframesTable,
} from "@workspace/db";
import {
  CreateBacktestBody,
  CreateBacktestResponse,
  ListBacktestsResponse,
} from "@workspace/api-zod";

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
    status: "configured",
  }).returning();
  const [view] = await db
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
    .where(eq(backtestConfigurationsTable.id, created.id));
  res.status(201).json(CreateBacktestResponse.parse(backtestView(view)));
});

export default router;