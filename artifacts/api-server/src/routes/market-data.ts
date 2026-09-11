import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, gte, lte, max } from "drizzle-orm";
import {
  candlesTable,
  db,
  marketDataConnectionsTable,
  marketDataSourcesTable,
  marketsTable,
  sourceInstrumentMappingsTable,
  strategiesTable,
  strategyVersionsTable,
  timeframesTable,
} from "@workspace/db";
import {
  CreateSourceInstrumentMappingBody,
  CreateSourceInstrumentMappingResponse,
  CreateInstrumentBody,
  CreateInstrumentResponse,
  AddBiQuoteMarketBody,
  AddBiQuoteMarketResponse,
  CreateMarketDataSourceBody,
  CreateMarketDataSourceResponse,
  CreateTimeframeBody,
  CreateTimeframeResponse,
  DeleteInstrumentParams,
  DeleteMarketDataSourceParams,
  DeleteSourceInstrumentMappingParams,
  DeleteTimeframeParams,
  GetMarketDataSummaryResponse,
  ListCandlesQueryParams,
  ListCandlesResponse,
  ListInstrumentsResponse,
  ListMarketDataConnectionsResponse,
  ListMarketDataSourcesResponse,
  ListSourceInstrumentMappingsResponse,
  ListTimeframesResponse,
  UpdateInstrumentBody,
  UpdateInstrumentParams,
  UpdateInstrumentResponse,
  UpdateMarketDataSourceBody,
  UpdateMarketDataSourceParams,
  UpdateMarketDataSourceResponse,
  UpdateSourceInstrumentMappingBody,
  UpdateSourceInstrumentMappingParams,
  UpdateSourceInstrumentMappingResponse,
  UpdateTimeframeBody,
  UpdateTimeframeParams,
  UpdateTimeframeResponse,
} from "@workspace/api-zod";
import { biQuoteAdapter } from "../services/biquote";
import { marketDataService } from "../services/market-data";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function instrumentView(instrument: typeof marketsTable.$inferSelect) {
  return {
    ...instrument,
    tickSize: instrument.tickSize == null ? null : Number(instrument.tickSize),
    contractMultiplier: instrument.contractMultiplier == null ? null : Number(instrument.contractMultiplier),
  };
}

function candleView(candle: typeof candlesTable.$inferSelect) {
  return {
    ...candle,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: candle.volume == null ? null : Number(candle.volume),
  };
}

router.get("/instruments", async (_req, res): Promise<void> => {
  const rows = await db.select().from(marketsTable).orderBy(asc(marketsTable.symbol));
  res.json(ListInstrumentsResponse.parse(rows.map(instrumentView)));
});

router.get("/market-data/biquote/catalog", async (_req, res): Promise<void> => {
  res.json((await biQuoteAdapter.catalog()).map(item => ({
    ...item,
    sourceName: "BiQuote",
  })));
});

router.post("/market-data/biquote/markets", async (req, res): Promise<void> => {
  const parsed = AddBiQuoteMarketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [source] = await db.select().from(marketDataSourcesTable).where(eq(marketDataSourcesTable.providerKey, "biquote"));
  const [timeframe] = await db.select().from(timeframesTable).where(eq(timeframesTable.id, parsed.data.timeframeId));
  const catalogItem = (await biQuoteAdapter.catalog()).find(item => item.providerSymbol === parsed.data.providerSymbol.toUpperCase());

  if (!source || !catalogItem) {
    res.status(400).json({ error: "That instrument is not currently supported by BiQuote." });
    return;
  }
  if (!timeframe || !timeframe.isActive) {
    res.status(400).json({ error: "Select an active timeframe." });
    return;
  }

  const result = await db.transaction(async tx => {
    const [existingMapping] = await tx.select().from(sourceInstrumentMappingsTable).where(and(
      eq(sourceInstrumentMappingsTable.sourceId, source.id),
      eq(sourceInstrumentMappingsTable.providerSymbol, catalogItem.providerSymbol),
    ));

    let instrumentId = existingMapping?.instrumentId;
    if (!instrumentId) {
      const [existingInstrument] = await tx.select().from(marketsTable).where(eq(marketsTable.symbol, catalogItem.providerSymbol));
      if (existingInstrument) {
        instrumentId = existingInstrument.id;
      } else {
        const [created] = await tx.insert(marketsTable).values({
          assetClass: catalogItem.assetClass,
          instrumentType: catalogItem.instrumentType,
          venue: catalogItem.venue,
          symbol: catalogItem.providerSymbol,
          displayName: catalogItem.description ?? catalogItem.displayName,
          quoteCurrency: catalogItem.quoteCurrency,
          tickSize: catalogItem.tickSize?.toString() ?? null,
          contractMultiplier: catalogItem.contractMultiplier?.toString() ?? null,
          isActive: true,
          description: catalogItem.description,
        }).returning();
        instrumentId = created.id;
      }
    }

    const [mapping] = existingMapping
      ? [existingMapping]
      : await tx.insert(sourceInstrumentMappingsTable).values({
        sourceId: source.id,
        instrumentId,
        providerSymbol: catalogItem.providerSymbol,
      }).returning();
    const [instrument] = await tx.select().from(marketsTable).where(eq(marketsTable.id, instrumentId));
    return { instrument: instrumentView(instrument), mapping, timeframe };
  });

  try {
    await marketDataService.refreshCandles({
      sourceId: source.id,
      instrumentId: result.instrument.id,
      timeframeId: result.timeframe.id,
      limit: 500,
    });
  } catch (error) {
    logger.warn({ err: error, providerSymbol: catalogItem.providerSymbol }, "BiQuote candles could not be retrieved after adding market");
  }

  res.status(201).json(AddBiQuoteMarketResponse.parse({
    ...result,
    mapping: {
      ...result.mapping,
      sourceName: source.name,
      instrumentSymbol: result.instrument.symbol,
    },
  }));
});

router.post("/instruments", async (req, res): Promise<void> => {
  const parsed = CreateInstrumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [created] = await db.insert(marketsTable).values({
    ...parsed.data,
    tickSize: parsed.data.tickSize?.toString(),
    contractMultiplier: parsed.data.contractMultiplier?.toString(),
  }).returning();
  res.status(201).json(CreateInstrumentResponse.parse(instrumentView(created)));
});

router.patch("/instruments/:instrumentId", async (req, res): Promise<void> => {
  const params = UpdateInstrumentParams.safeParse(req.params);
  const body = UpdateInstrumentBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [updated] = await db.update(marketsTable).set({
    ...body.data,
    tickSize: body.data.tickSize === undefined ? undefined : body.data.tickSize?.toString(),
    contractMultiplier: body.data.contractMultiplier === undefined ? undefined : body.data.contractMultiplier?.toString(),
  }).where(eq(marketsTable.id, params.data.instrumentId)).returning();
  if (!updated) {
    res.status(404).json({ error: "Instrument not found" });
    return;
  }
  res.json(UpdateInstrumentResponse.parse(instrumentView(updated)));
});

router.delete("/instruments/:instrumentId", async (req, res): Promise<void> => {
  const params = DeleteInstrumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [[candles], [strategies], [versions], [mappings]] = await Promise.all([
    db.select({ value: count() }).from(candlesTable).where(eq(candlesTable.instrumentId, params.data.instrumentId)),
    db.select({ value: count() }).from(strategiesTable).where(eq(strategiesTable.marketId, params.data.instrumentId)),
    db.select({ value: count() }).from(strategyVersionsTable).where(eq(strategyVersionsTable.marketId, params.data.instrumentId)),
    db.select({ value: count() }).from(sourceInstrumentMappingsTable).where(eq(sourceInstrumentMappingsTable.instrumentId, params.data.instrumentId)),
  ]);
  if ([candles, strategies, versions, mappings].some(row => Number(row?.value ?? 0) > 0)) {
    res.status(409).json({ error: "Instrument is referenced by strategy history, provider mappings, or candle data. Deactivate it instead." });
    return;
  }
  const [deleted] = await db.delete(marketsTable).where(eq(marketsTable.id, params.data.instrumentId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Instrument not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/market-data/sources", async (_req, res): Promise<void> => {
  res.json(ListMarketDataSourcesResponse.parse(await db.select().from(marketDataSourcesTable).orderBy(asc(marketDataSourcesTable.name))));
});

router.post("/market-data/sources", async (req, res): Promise<void> => {
  const parsed = CreateMarketDataSourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const created = await db.transaction(async tx => {
    const [source] = await tx.insert(marketDataSourcesTable).values(parsed.data).returning();
    await tx.insert(marketDataConnectionsTable).values({
      sourceId: source.id,
      status: "disconnected",
      statusMessage: "No provider adapter is connected.",
    });
    return source;
  });
  res.status(201).json(CreateMarketDataSourceResponse.parse(created));
});

router.patch("/market-data/sources/:sourceId", async (req, res): Promise<void> => {
  const params = UpdateMarketDataSourceParams.safeParse(req.params);
  const body = UpdateMarketDataSourceBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [updated] = await db.update(marketDataSourcesTable).set(body.data).where(eq(marketDataSourcesTable.id, params.data.sourceId)).returning();
  if (!updated) {
    res.status(404).json({ error: "Market-data source not found" });
    return;
  }
  res.json(UpdateMarketDataSourceResponse.parse(updated));
});

router.delete("/market-data/sources/:sourceId", async (req, res): Promise<void> => {
  const params = DeleteMarketDataSourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [used] = await db.select({ value: count() }).from(candlesTable).where(eq(candlesTable.sourceId, params.data.sourceId));
  if (Number(used?.value ?? 0) > 0) {
    res.status(409).json({ error: "Source has candle history and cannot be deleted." });
    return;
  }
  const [deleted] = await db.delete(marketDataSourcesTable).where(eq(marketDataSourcesTable.id, params.data.sourceId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Market-data source not found" });
    return;
  }
  res.sendStatus(204);
});

async function mappingView(mapping: typeof sourceInstrumentMappingsTable.$inferSelect) {
  const [[source], [instrument]] = await Promise.all([
    db.select({ name: marketDataSourcesTable.name }).from(marketDataSourcesTable).where(eq(marketDataSourcesTable.id, mapping.sourceId)),
    db.select({ symbol: marketsTable.symbol }).from(marketsTable).where(eq(marketsTable.id, mapping.instrumentId)),
  ]);
  return {
    ...mapping,
    sourceName: source?.name ?? "Unknown source",
    instrumentSymbol: instrument?.symbol ?? "Unknown instrument",
  };
}

router.get("/market-data/mappings", async (_req, res): Promise<void> => {
  const rows = await db.select().from(sourceInstrumentMappingsTable).orderBy(asc(sourceInstrumentMappingsTable.providerSymbol));
  res.json(ListSourceInstrumentMappingsResponse.parse(await Promise.all(rows.map(mappingView))));
});

router.post("/market-data/mappings", async (req, res): Promise<void> => {
  const parsed = CreateSourceInstrumentMappingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [[source], [instrument]] = await Promise.all([
    db.select({ id: marketDataSourcesTable.id }).from(marketDataSourcesTable).where(eq(marketDataSourcesTable.id, parsed.data.sourceId)),
    db.select({ id: marketsTable.id }).from(marketsTable).where(eq(marketsTable.id, parsed.data.instrumentId)),
  ]);
  if (!source || !instrument) {
    res.status(400).json({ error: "Select a valid source and instrument." });
    return;
  }
  const [created] = await db.insert(sourceInstrumentMappingsTable).values(parsed.data).returning();
  res.status(201).json(CreateSourceInstrumentMappingResponse.parse(await mappingView(created)));
});

router.patch("/market-data/mappings/:mappingId", async (req, res): Promise<void> => {
  const params = UpdateSourceInstrumentMappingParams.safeParse(req.params);
  const body = UpdateSourceInstrumentMappingBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [updated] = await db.update(sourceInstrumentMappingsTable).set(body.data).where(eq(sourceInstrumentMappingsTable.id, params.data.mappingId)).returning();
  if (!updated) {
    res.status(404).json({ error: "Provider-symbol mapping not found" });
    return;
  }
  res.json(UpdateSourceInstrumentMappingResponse.parse(await mappingView(updated)));
});

router.delete("/market-data/mappings/:mappingId", async (req, res): Promise<void> => {
  const params = DeleteSourceInstrumentMappingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(sourceInstrumentMappingsTable).where(eq(sourceInstrumentMappingsTable.id, params.data.mappingId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Provider-symbol mapping not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/market-data/timeframes", async (_req, res): Promise<void> => {
  res.json(ListTimeframesResponse.parse(await db.select().from(timeframesTable).orderBy(asc(timeframesTable.durationSeconds))));
});

router.post("/market-data/timeframes", async (req, res): Promise<void> => {
  const parsed = CreateTimeframeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [created] = await db.insert(timeframesTable).values(parsed.data).returning();
  res.status(201).json(CreateTimeframeResponse.parse(created));
});

router.patch("/market-data/timeframes/:timeframeId", async (req, res): Promise<void> => {
  const params = UpdateTimeframeParams.safeParse(req.params);
  const body = UpdateTimeframeBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.success ? "Invalid request body" : body.error.message });
    return;
  }
  const [updated] = await db.update(timeframesTable).set(body.data).where(eq(timeframesTable.id, params.data.timeframeId)).returning();
  if (!updated) {
    res.status(404).json({ error: "Timeframe not found" });
    return;
  }
  res.json(UpdateTimeframeResponse.parse(updated));
});

router.delete("/market-data/timeframes/:timeframeId", async (req, res): Promise<void> => {
  const params = DeleteTimeframeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [used] = await db.select({ value: count() }).from(candlesTable).where(eq(candlesTable.timeframeId, params.data.timeframeId));
  if (Number(used?.value ?? 0) > 0) {
    res.status(409).json({ error: "Timeframe has candle history and cannot be deleted." });
    return;
  }
  const [deleted] = await db.delete(timeframesTable).where(eq(timeframesTable.id, params.data.timeframeId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Timeframe not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/market-data/candles/refresh", async (req, res): Promise<void> => {
  const sourceId = Number(req.body?.sourceId);
  const instrumentId = Number(req.body?.instrumentId);
  const timeframeId = Number(req.body?.timeframeId);
  const limit = req.body?.limit == null ? undefined : Number(req.body.limit);
  const from = req.body?.from == null ? undefined : new Date(String(req.body.from));
  const to = req.body?.to == null ? undefined : new Date(String(req.body.to));
  if (![sourceId, instrumentId, timeframeId].every(Number.isInteger) || [sourceId, instrumentId, timeframeId].some(value => value < 1) || (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > 1000))) {
    res.status(400).json({ error: "sourceId, instrumentId, and timeframeId must be positive integers; limit must be between 1 and 1000." });
    return;
  }
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from >= to)) {
    res.status(400).json({ error: "from and to must be valid dates, with from earlier than to." });
    return;
  }
  try {
    const ingested = await marketDataService.refreshCandles({ sourceId, instrumentId, timeframeId, from, to, limit });
    res.json({ sourceId, instrumentId, timeframeId, ingested });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not refresh candles." });
  }
});

router.get("/market-data/historical-availability", async (req, res): Promise<void> => {
  const numberParam = (value: unknown) => typeof value === "string" ? Number(value) : NaN;
  const instrumentId = numberParam(req.query.instrumentId);
  const timeframeId = numberParam(req.query.timeframeId);
  const requestedSourceId = req.query.sourceId == null ? null : numberParam(req.query.sourceId);
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  if (![instrumentId, timeframeId].every(value => Number.isInteger(value) && value > 0)
    || (requestedSourceId != null && (!Number.isInteger(requestedSourceId) || requestedSourceId < 1))
    || !from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())
    || from >= to) {
    res.status(400).json({ error: "instrumentId, timeframeId, from, and to are required; sourceId is optional." });
    return;
  }
  try {
    const sourceId = requestedSourceId ?? (await marketDataService.historicalSourceForInstrument(instrumentId)).id;
    res.json(await marketDataService.historicalDataAvailability({
      sourceId,
      instrumentId,
      timeframeId,
      from,
      to,
    }));
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Historical availability is not available." });
  }
});

router.get("/market-data/connections", async (_req, res): Promise<void> => {
  const rows = await db.select({
    connection: marketDataConnectionsTable,
    sourceName: marketDataSourcesTable.name,
  }).from(marketDataConnectionsTable)
    .innerJoin(marketDataSourcesTable, eq(marketDataConnectionsTable.sourceId, marketDataSourcesTable.id))
    .orderBy(asc(marketDataSourcesTable.name));
  res.json(ListMarketDataConnectionsResponse.parse(rows.map(row => ({ ...row.connection, sourceName: row.sourceName }))));
});

router.get("/market-data/quotes/stream", async (req, res): Promise<void> => {
  const sourceId = Number(req.query.sourceId);
  const instrumentId = Number(req.query.instrumentId);
  if (![sourceId, instrumentId].every(Number.isInteger) || [sourceId, instrumentId].some(value => value < 1)) {
    res.status(400).json({ error: "sourceId and instrumentId must be positive integers." });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const controller = new AbortController();
  const send = (event: string, payload: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const statusTimer = setInterval(async () => {
    try {
      const [connection] = await db.select().from(marketDataConnectionsTable).where(eq(marketDataConnectionsTable.sourceId, sourceId));
      send("status", {
        state: connection?.status ?? "disconnected",
        message: connection?.statusMessage ?? "No connection status is available.",
        lastDataAt: connection?.lastDataAt ?? null,
      });
    } catch {
      // The stream will report provider errors through its error event.
    }
  }, 5000);
  req.on("close", () => controller.abort());
  send("status", { state: "connecting", message: "Connecting to the provider.", lastDataAt: null });

  try {
    for await (const quote of marketDataService.streamQuotes({ sourceId, instrumentId, signal: controller.signal })) {
      const isLive = quote.marketState === "open" && quote.stale !== true;
      send("quote", {
        ...quote,
        eventTime: quote.eventTime.toISOString(),
        receivedAt: quote.receivedAt.toISOString(),
        lastQuoteAt: quote.lastQuoteAt?.toISOString() ?? null,
        isLive,
      });
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      logger.warn({ err: error, sourceId, instrumentId }, "Market-data quote stream failed");
      send("error", { message: error instanceof Error ? error.message : "The provider stream failed." });
    }
  } finally {
    clearInterval(statusTimer);
    if (!res.writableEnded) res.end();
  }
});

router.get("/market-data/candles", async (req, res): Promise<void> => {
  const parsed = ListCandlesQueryParams.safeParse({
    ...req.query,
    from: typeof req.query.from === "string" ? new Date(req.query.from) : req.query.from,
    to: typeof req.query.to === "string" ? new Date(req.query.to) : req.query.to,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [
    eq(candlesTable.instrumentId, parsed.data.instrumentId),
    eq(candlesTable.timeframeId, parsed.data.timeframeId),
  ];
  if (parsed.data.sourceId) filters.push(eq(candlesTable.sourceId, parsed.data.sourceId));
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
    res.status(400).json({ error: "'from' must be earlier than or equal to 'to'." });
    return;
  }
  if (parsed.data.from) filters.push(gte(candlesTable.openTime, parsed.data.from));
  if (parsed.data.to) filters.push(lte(candlesTable.openTime, parsed.data.to));
  const rows = await db.select().from(candlesTable)
    .where(and(...filters))
    .orderBy(desc(candlesTable.openTime))
    .limit(parsed.data.limit ?? 500);
  res.json(ListCandlesResponse.parse(rows.map(candleView)));
});

router.get("/market-data/summary", async (_req, res): Promise<void> => {
  const [[instrumentCount], [sourceCount], [timeframeCount], [candleCount], [connectedCount], [latestData]] = await Promise.all([
    db.select({ value: count() }).from(marketsTable),
    db.select({ value: count() }).from(marketDataSourcesTable),
    db.select({ value: count() }).from(timeframesTable),
    db.select({ value: count() }).from(candlesTable),
    db.select({ value: count() }).from(marketDataConnectionsTable).where(eq(marketDataConnectionsTable.status, "connected")),
    db.select({ value: max(candlesTable.receivedAt) }).from(candlesTable),
  ]);
  res.json(GetMarketDataSummaryResponse.parse({
    instrumentCount: Number(instrumentCount?.value ?? 0),
    sourceCount: Number(sourceCount?.value ?? 0),
    timeframeCount: Number(timeframeCount?.value ?? 0),
    candleCount: Number(candleCount?.value ?? 0),
    connectedSourceCount: Number(connectedCount?.value ?? 0),
    latestDataAt: latestData?.value ?? null,
  }));
});

export default router;