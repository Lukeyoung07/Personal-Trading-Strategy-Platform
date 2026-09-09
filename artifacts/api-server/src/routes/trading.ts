import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, isNotNull, max, avg, min, sql, sum } from "drizzle-orm";
import {
  db,
  alertsTable,
  conditionsTable,
  marketsTable,
  strategiesTable,
  strategyConditionsTable,
  strategyVersionsTable,
  tradesTable,
  tradingConceptsTable,
  userSettingsTable,
} from "@workspace/db";
import {
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
  ListStrategyConditionsParams,
  ListStrategyConditionsResponse,
  ListTradesResponse,
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
} from "@workspace/api-zod";

const router: IRouter = Router();

const DEFAULT_CONCEPTS = [
  ["MARKET STRUCTURE", "Higher High"],
  ["MARKET STRUCTURE", "Higher Low"],
  ["MARKET STRUCTURE", "Lower High"],
  ["MARKET STRUCTURE", "Lower Low"],
  ["MARKET STRUCTURE", "Break of Structure"],
  ["MARKET STRUCTURE", "Change of Character"],
  ["MARKET STRUCTURE", "Market Structure Shift"],
  ["LIQUIDITY", "Buy-Side Liquidity"],
  ["LIQUIDITY", "Sell-Side Liquidity"],
  ["LIQUIDITY", "Liquidity Sweep"],
  ["LIQUIDITY", "Equal Highs"],
  ["LIQUIDITY", "Equal Lows"],
  ["LIQUIDITY", "Previous Day High"],
  ["LIQUIDITY", "Previous Day Low"],
  ["LIQUIDITY", "Previous Week High"],
  ["LIQUIDITY", "Previous Week Low"],
  ["LIQUIDITY", "Session High"],
  ["LIQUIDITY", "Session Low"],
  ["FAIR VALUE / PRICE DELIVERY", "Fair Value Gap"],
  ["FAIR VALUE / PRICE DELIVERY", "Inverse Fair Value Gap"],
  ["FAIR VALUE / PRICE DELIVERY", "Order Block"],
  ["FAIR VALUE / PRICE DELIVERY", "Breaker Block"],
  ["FAIR VALUE / PRICE DELIVERY", "Mitigation Block"],
  ["FAIR VALUE / PRICE DELIVERY", "Balanced Price Range"],
  ["ICT / TIME-BASED", "Power of 3 / AMD"],
  ["ICT / TIME-BASED", "Kill Zones"],
  ["ICT / TIME-BASED", "London Session"],
  ["ICT / TIME-BASED", "New York Session"],
  ["ICT / TIME-BASED", "Asian Session"],
  ["ICT / TIME-BASED", "Daily Open"],
  ["ICT / TIME-BASED", "Weekly Open"],
  ["TECHNICAL", "EMA"],
  ["TECHNICAL", "SMA"],
  ["TECHNICAL", "VWAP"],
  ["TECHNICAL", "RSI"],
  ["TECHNICAL", "Volume"],
  ["TECHNICAL", "Divergence"],
  ["TECHNICAL", "SMT Divergence"],
] as const;

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
}

const nullableNumber = (value: string | number | null | undefined): number | null =>
  value == null ? null : Number(value);

async function strategyView(strategy: typeof strategiesTable.$inferSelect) {
  const [latest] = await db
    .select({ versionNumber: max(strategyVersionsTable.versionNumber) })
    .from(strategyVersionsTable)
    .where(eq(strategyVersionsTable.strategyId, strategy.id));
  return {
    ...strategy,
    marketSymbol: await marketSymbol(strategy.marketId),
    currentVersion: latest?.versionNumber == null ? null : Number(latest.versionNumber),
  };
}

async function marketSymbol(marketId: number | null) {
  if (marketId == null) return null;
  const [market] = await db.select({ symbol: marketsTable.symbol }).from(marketsTable).where(eq(marketsTable.id, marketId));
  return market?.symbol ?? null;
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
  const [created] = await db.insert(strategiesTable).values(parsed.data).returning();
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
  const [deleted] = await db.delete(strategiesTable).where(eq(strategiesTable.id, params.data.strategyId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  res.sendStatus(204);
});

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
  res.json(ListStrategyVersionsResponse.parse(rows));
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
  const [latest] = await db
    .select({ versionNumber: max(strategyVersionsTable.versionNumber) })
    .from(strategyVersionsTable)
    .where(eq(strategyVersionsTable.strategyId, params.data.strategyId));
  const [created] = await db
    .insert(strategyVersionsTable)
    .values({ ...body.data, strategyId: params.data.strategyId, versionNumber: Number(latest?.versionNumber ?? 0) + 1 })
    .returning();
  res.status(201).json(CreateStrategyVersionResponse.parse(created));
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
  const [latest] = await db
    .select({ conditionOrder: max(strategyConditionsTable.conditionOrder) })
    .from(strategyConditionsTable)
    .where(eq(strategyConditionsTable.strategyId, params.data.strategyId));
  const [created] = await db
    .insert(strategyConditionsTable)
    .values({ ...body.data, strategyId: params.data.strategyId, conditionOrder: Number(latest?.conditionOrder ?? 0) + 1 })
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
  const [updated] = await db
    .update(strategyConditionsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(strategyConditionsTable.id, params.data.conditionId), eq(strategyConditionsTable.strategyId, params.data.strategyId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Strategy condition not found" });
    return;
  }
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
  res.json(ListMarketsResponse.parse(await db.select().from(marketsTable).orderBy(asc(marketsTable.symbol))));
});

router.post("/markets", async (req, res): Promise<void> => {
  const parsed = CreateMarketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [created] = await db.insert(marketsTable).values(parsed.data).returning();
  res.status(201).json(CreateMarketResponse.parse(created));
});

router.patch("/markets/:marketId", async (req, res): Promise<void> => {
  const params = UpdateMarketParams.safeParse(req.params);
  const body = UpdateMarketBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [updated] = await db.update(marketsTable).set(body.data).where(eq(marketsTable.id, params.data.marketId)).returning();
  if (!updated) {
    res.status(404).json({ error: "Market not found" });
    return;
  }
  res.json(UpdateMarketResponse.parse(updated));
});

router.delete("/markets/:marketId", async (req, res): Promise<void> => {
  const params = DeleteMarketParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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
    .select({ trade: tradesTable, symbol: marketsTable.symbol })
    .from(tradesTable)
    .leftJoin(marketsTable, eq(tradesTable.marketId, marketsTable.id))
    .orderBy(desc(tradesTable.createdAt));
  res.json(
    ListTradesResponse.parse(
      rows.map(({ trade, symbol }) => ({
        ...trade,
        marketSymbol: symbol,
        quantity: nullableNumber(trade.quantity),
        entryPrice: nullableNumber(trade.entryPrice),
        exitPrice: nullableNumber(trade.exitPrice),
        pnl: nullableNumber(trade.pnl),
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
  const [created] = await db
    .insert(tradesTable)
    .values({
      ...parsed.data,
      quantity: parsed.data.quantity?.toString(),
      entryPrice: parsed.data.entryPrice?.toString(),
      exitPrice: parsed.data.exitPrice?.toString(),
      pnl: parsed.data.pnl?.toString(),
    })
    .returning();
  res.status(201).json(
    CreateTradeResponse.parse({
      ...created,
      marketSymbol: await marketSymbol(created.marketId),
      quantity: nullableNumber(created.quantity),
      entryPrice: nullableNumber(created.entryPrice),
      exitPrice: nullableNumber(created.exitPrice),
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
      pnl: body.data.pnl?.toString(),
      updatedAt: new Date(),
    })
    .where(eq(tradesTable.id, params.data.tradeId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Trade not found" });
    return;
  }
  res.json(
    UpdateTradeResponse.parse({
      ...updated,
      marketSymbol: await marketSymbol(updated.marketId),
      quantity: nullableNumber(updated.quantity),
      entryPrice: nullableNumber(updated.entryPrice),
      exitPrice: nullableNumber(updated.exitPrice),
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

router.get("/performance/summary", async (_req, res): Promise<void> => {
  const [aggregate] = await db
    .select({
      tradeCount: count(),
      netPnl: sum(tradesTable.pnl),
      averagePnl: avg(tradesTable.pnl),
      largestWin: max(tradesTable.pnl),
      largestLoss: min(tradesTable.pnl),
    })
    .from(tradesTable)
    .where(and(eq(tradesTable.status, "closed"), isNotNull(tradesTable.pnl)));
  const tradeCount = Number(aggregate?.tradeCount ?? 0);
  const [wins] = await db
    .select({ value: count() })
    .from(tradesTable)
    .where(and(eq(tradesTable.status, "closed"), sql`${tradesTable.pnl} > 0`));
  res.json(
    GetPerformanceSummaryResponse.parse({
      hasData: tradeCount > 0,
      tradeCount,
      netPnl: nullableNumber(aggregate?.netPnl),
      winRate: tradeCount > 0 ? Number(wins?.value ?? 0) / tradeCount : null,
      averagePnl: nullableNumber(aggregate?.averagePnl),
      largestWin: nullableNumber(aggregate?.largestWin),
      largestLoss: nullableNumber(aggregate?.largestLoss),
    }),
  );
});

router.get("/alerts", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ alert: alertsTable, symbol: marketsTable.symbol })
    .from(alertsTable)
    .leftJoin(marketsTable, eq(alertsTable.marketId, marketsTable.id))
    .orderBy(desc(alertsTable.updatedAt));
  res.json(ListAlertsResponse.parse(rows.map(({ alert, symbol }) => ({ ...alert, marketSymbol: symbol }))));
});

router.post("/alerts", async (req, res): Promise<void> => {
  const parsed = CreateAlertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [created] = await db.insert(alertsTable).values(parsed.data).returning();
  res.status(201).json(CreateAlertResponse.parse({ ...created, marketSymbol: await marketSymbol(created.marketId) }));
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
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(alertsTable.id, params.data.alertId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  res.json(UpdateAlertResponse.parse({ ...updated, marketSymbol: await marketSymbol(updated.marketId) }));
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