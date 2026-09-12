import { randomUUID } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  alertsTable,
  backtestCandlesTable,
  backtestConfigurationsTable,
  backtestTradesTable,
  candlesTable,
  db,
  marketDataConnectionsTable,
  marketDataSourcesTable,
  marketsTable,
  sourceInstrumentMappingsTable,
  strategyConditionsTable,
  strategyMonitorConditionStatesTable,
  strategyMonitorSessionsTable,
  strategyMonitorTransitionEventsTable,
  strategyVersionConditionsTable,
  strategyVersionsTable,
  strategiesTable,
  timeframesTable,
  tradingConceptsTable,
} from "@workspace/db";
import { TRADING_CONCEPT_REGISTRY } from "@workspace/api-zod";
import app from "../app";
import {
  marketDataService,
  type MarketDataProviderAdapter,
  type NormalizedCandle,
} from "../services/market-data";
import {
  createBuiltInStrategyMonitoringDetector,
  strategyMonitoringEngine,
} from "../services/strategy-monitoring";

const TEST_PROVIDER_KEY = `tradex-lifecycle-${randomUUID()}`;
const TEST_SOURCE_NAME = `TradeX lifecycle integration ${TEST_PROVIDER_KEY}`;
const requestedMessage = [
  "Build a long XAUUSD 1h strategy using Long Breakout.",
  "Use a 1% stop-loss and 2% take-profit.",
  "Do not add any other concepts.",
].join(" ");

type ResourceIds = {
  marketId: number;
  timeframeId: number;
  conceptId: number;
  sourceId: number;
  strategyId?: number;
  versionId?: number;
  conditionId?: number;
  backtestId?: number;
  versionConditionId?: number;
  temporaryMarket: boolean;
  temporaryTimeframe: boolean;
  temporaryConcept: boolean;
};

async function idsFor(table: any): Promise<number[]> {
  const rows = await db.select({ id: table.id }).from(table);
  return rows.map((row: { id: number }) => row.id).sort((left, right) => left - right);
}

async function snapshotRelevantIds() {
  return {
    strategies: await idsFor(strategiesTable),
    strategyVersions: await idsFor(strategyVersionsTable),
    strategyConditions: await idsFor(strategyConditionsTable),
    strategyVersionConditions: await idsFor(strategyVersionConditionsTable),
    backtests: await idsFor(backtestConfigurationsTable),
    backtestTrades: await idsFor(backtestTradesTable),
    backtestCandles: await idsFor(backtestCandlesTable),
    monitorSessions: await idsFor(strategyMonitorSessionsTable),
    monitorStates: await idsFor(strategyMonitorConditionStatesTable),
    monitorTransitions: await idsFor(strategyMonitorTransitionEventsTable),
    alerts: await idsFor(alertsTable),
    candles: await idsFor(candlesTable),
    sources: await idsFor(marketDataSourcesTable),
    mappings: await idsFor(sourceInstrumentMappingsTable),
    connections: await idsFor(marketDataConnectionsTable),
    markets: await idsFor(marketsTable),
    timeframes: await idsFor(timeframesTable),
    concepts: await idsFor(tradingConceptsTable),
  };
}

function lifecycleCandles(start: Date): NormalizedCandle[] {
  const breakoutPrices = new Map([
    [20, { high: 103, close: 102 }],
    [25, { high: 107, close: 106 }],
    [30, { high: 111, close: 110 }],
    [35, { high: 115, close: 114 }],
    [39, { high: 119, close: 118 }],
  ]);
  const targetPrices = new Map([
    [21, { open: 102, high: 105, close: 104.5 }],
    [26, { open: 106, high: 109, close: 108.5 }],
    [31, { open: 110, high: 113, close: 112.5 }],
    [36, { open: 114, high: 117, close: 116.5 }],
  ]);

  return Array.from({ length: 40 }, (_, index) => {
    const openTime = new Date(start.getTime() + index * 60 * 60 * 1_000);
    const breakout = breakoutPrices.get(index);
    if (breakout) {
      return {
        openTime,
        closeTime: new Date(openTime.getTime() + 60 * 60 * 1_000),
        open: 100,
        high: breakout.high,
        low: 99.5,
        close: breakout.close,
        volume: 1_000,
        isClosed: true,
        receivedAt: new Date(),
      };
    }
    const target = targetPrices.get(index);
    if (target) {
      return {
        openTime,
        closeTime: new Date(openTime.getTime() + 60 * 60 * 1_000),
        open: target.open,
        high: target.high,
        low: target.open - 0.5,
        close: target.close,
        volume: 1_000,
        isClosed: true,
        receivedAt: new Date(),
      };
    }
    return {
      openTime,
      closeTime: new Date(openTime.getTime() + 60 * 60 * 1_000),
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 1_000,
      isClosed: true,
      receivedAt: new Date(),
    };
  });
}

function expectedCanonicalFields(concept: typeof tradingConceptsTable.$inferSelect) {
  return {
    canonicalId: concept.canonicalId,
    registryVersion: concept.registryVersion,
    canonicalStatus: concept.canonicalStatus,
    executorKind: concept.executorKind,
    canonicalDefinition: concept.canonicalDefinition,
  };
}

async function waitForBacktest(backtestId: number) {
  const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request(app).get(`/api/backtests/${backtestId}`).expect(200);
    if (terminalStatuses.has(response.body.status)) return response.body;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Backtest ${backtestId} did not reach a terminal state.`);
}

describe("disposable Build with AI to monitoring lifecycle", () => {
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = globalThis.fetch;
  let resources: ResourceIds;
  let candles: NormalizedCandle[];
  let baselineIds: Awaited<ReturnType<typeof snapshotRelevantIds>>;

  beforeAll(async () => {
    baselineIds = await snapshotRelevantIds();

    const definition = TRADING_CONCEPT_REGISTRY.find(concept => concept.name === "Breakout");
    if (!definition) throw new Error("The canonical Breakout concept is missing from the registry.");

    const [existingMarket] = await db
      .select()
      .from(marketsTable)
      .where(eq(marketsTable.symbol, "XAUUSD"))
      .limit(1);
    const market = existingMarket ?? (await db.insert(marketsTable).values({
      assetClass: "Commodity",
      instrumentType: "commodity",
      venue: "Lifecycle test",
      symbol: "XAUUSD",
      displayName: "Lifecycle test XAUUSD",
      quoteCurrency: "USD",
      isActive: true,
    }).returning())[0];
    if (!market) throw new Error("Unable to prepare the lifecycle test market.");

    const [existingTimeframe] = await db
      .select()
      .from(timeframesTable)
      .where(eq(timeframesTable.code, "1h"))
      .limit(1);
    const timeframe = existingTimeframe ?? (await db.insert(timeframesTable).values({
      code: "1h",
      label: "1 hour",
      durationSeconds: 3_600,
      isActive: true,
    }).returning())[0];
    if (!timeframe) throw new Error("Unable to prepare the lifecycle test timeframe.");

    const [existingConcept] = await db
      .select()
      .from(tradingConceptsTable)
      .where(or(
        eq(tradingConceptsTable.canonicalId, definition.canonicalId),
        eq(tradingConceptsTable.name, definition.name),
      ))
      .limit(1);
    const concept = existingConcept ?? (await db.insert(tradingConceptsTable).values({
      category: definition.category,
      name: definition.name,
      description: definition.definition,
      detectionRules: definition.entryBehavior,
      invalidationRules: definition.invalidationBehavior,
      isBuiltIn: true,
      canonicalId: definition.canonicalId,
      registryVersion: definition.registryVersion,
      canonicalStatus: definition.status,
      executorKind: definition.executorKind,
      aliases: definition.aliases,
      canonicalDefinition: definition,
    }).returning())[0];
    if (!concept) throw new Error("Unable to prepare the lifecycle test concept.");

    const [source] = await db.insert(marketDataSourcesTable).values({
      name: TEST_SOURCE_NAME,
      providerKey: TEST_PROVIDER_KEY,
      sourceType: "historical",
      description: "Disposable source for the lifecycle integration test.",
      capabilities: ["candles", "historical"],
      configurationStatus: "configured",
      isEnabled: true,
    }).returning();
    if (!source) throw new Error("Unable to prepare the lifecycle test source.");

    await db.insert(sourceInstrumentMappingsTable).values({
      sourceId: source.id,
      instrumentId: market.id,
      providerSymbol: "XAUUSD-LIFECYCLE",
    });

    const start = new Date(Date.now());
    start.setUTCMinutes(0, 0, 0);
    start.setTime(start.getTime() - 39 * 60 * 60 * 1_000);
    candles = lifecycleCandles(start);
    const lastDataAt = candles.at(-1)!.receivedAt;
    await db.insert(marketDataConnectionsTable).values({
      sourceId: source.id,
      status: "connected",
      statusMessage: "Lifecycle test source is connected.",
      lastConnectedAt: lastDataAt,
      lastDataAt,
      checkedAt: lastDataAt,
    });
    await db.insert(candlesTable).values(candles.map(candle => ({
      sourceId: source.id,
      instrumentId: market.id,
      timeframeId: timeframe.id,
      openTime: candle.openTime,
      closeTime: candle.closeTime,
      open: candle.open.toString(),
      high: candle.high.toString(),
      low: candle.low.toString(),
      close: candle.close.toString(),
      volume: candle.volume?.toString() ?? null,
      isClosed: candle.isClosed,
      receivedAt: candle.receivedAt,
    })));

    resources = {
      marketId: market.id,
      timeframeId: timeframe.id,
      conceptId: concept.id,
      sourceId: source.id,
      temporaryMarket: !existingMarket,
      temporaryTimeframe: !existingTimeframe,
      temporaryConcept: !existingConcept,
    };

    const adapter: MarketDataProviderAdapter = {
      key: TEST_PROVIDER_KEY,
      capabilities: ["candles", "historical"],
      async connect() {},
      async disconnect() {},
      async connectionState() {
        return { state: "connected", message: "Lifecycle test source is connected." };
      },
      async candles(request) {
        return candles.filter(candle =>
          (!request.from || candle.openTime >= request.from)
          && (!request.to || candle.openTime <= request.to),
        );
      },
    };
    marketDataService.register(adapter);

    const detector = createBuiltInStrategyMonitoringDetector({
      id: concept.id,
      name: concept.name,
    });
    if (!detector) throw new Error("The lifecycle test concept has no monitoring evaluator.");
    strategyMonitoringEngine.registerDetector(detector);
  });

  afterAll(async () => {
    if (resources?.backtestId) {
      const backtest = await request(app).get(`/api/backtests/${resources.backtestId}`);
      if (backtest.body && !["completed", "failed", "cancelled"].includes(backtest.body.status)) {
        await request(app).post(`/api/backtests/${resources.backtestId}/cancel`);
        await waitForBacktest(resources.backtestId);
      }
    }

    if (resources?.strategyId) {
      const [versions] = await Promise.all([
        db.select({ id: strategyVersionsTable.id })
          .from(strategyVersionsTable)
          .where(eq(strategyVersionsTable.strategyId, resources.strategyId)),
      ]);
      const versionIds = versions.map(version => version.id);
      await db.delete(alertsTable).where(eq(alertsTable.strategyId, resources.strategyId));
      if (versionIds.length) {
        await db.delete(alertsTable).where(inArray(alertsTable.strategyVersionId, versionIds));
      }
      await request(app).delete(`/api/strategies/${resources.strategyId}`);
      await db.delete(backtestConfigurationsTable).where(eq(backtestConfigurationsTable.strategyId, resources.strategyId));
      await db.delete(strategiesTable).where(eq(strategiesTable.id, resources.strategyId));
    }

    if (resources?.sourceId) {
      await db.delete(candlesTable).where(and(
        eq(candlesTable.sourceId, resources.sourceId),
        eq(candlesTable.instrumentId, resources.marketId),
        eq(candlesTable.timeframeId, resources.timeframeId),
      ));
      await db.delete(sourceInstrumentMappingsTable).where(eq(sourceInstrumentMappingsTable.sourceId, resources.sourceId));
      await db.delete(marketDataConnectionsTable).where(eq(marketDataConnectionsTable.sourceId, resources.sourceId));
      await db.delete(marketDataSourcesTable).where(eq(marketDataSourcesTable.id, resources.sourceId));
    }
    if (resources?.temporaryConcept) {
      await db.delete(tradingConceptsTable).where(eq(tradingConceptsTable.id, resources.conceptId));
    }
    if (resources?.temporaryTimeframe) {
      await db.delete(timeframesTable).where(eq(timeframesTable.id, resources.timeframeId));
    }
    if (resources?.temporaryMarket) {
      await db.delete(marketsTable).where(eq(marketsTable.id, resources.marketId));
    }

    const finalIds = await snapshotRelevantIds();
    expect(finalIds).toEqual(baselineIds);

    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    globalThis.fetch = originalFetch;
  });

  it("preserves the AI draft through Builder, immutable Version, backtest, and Monitoring", async () => {
    process.env.OPENROUTER_API_KEY = "lifecycle-test-key";
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      expect(body.model).toBe("openrouter/free");
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              reply: "Prepared the requested canonical breakout strategy.",
              intent: "strategy_proposal",
              strategyDraft: {
                name: "Lifecycle Breakout",
                description: "A disposable long XAUUSD breakout strategy.",
                direction: "long",
                marketSymbol: "XAUUSD",
                timeframes: ["1h"],
                conditions: [{
                  name: "Long Breakout",
                  stage: "entry",
                  requirement: "required",
                  conceptName: "Long Breakout",
                  timeframe: "1h",
                  direction: "long",
                  triggerRules: "Price action breakout",
                  parameters: {
                    kind: "price_action",
                    pattern: "breakout",
                    polarity: "bullish",
                    lookback: 20,
                  },
                }],
                riskManagementRules: "stop-loss: 1%; take-profit: 2%",
              },
            }),
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const assistantResponse = await request(app)
      .post("/api/assistant/chat")
      .send({
        message: requestedMessage,
        messages: [],
        context: { page: "/strategy-builder" },
      })
      .expect(200);
    const draft = assistantResponse.body.strategyDraft;
    expect(assistantResponse.body.status).toBe("available");
    expect(assistantResponse.body.provider).toBe("openrouter/free");
    expect(draft).toMatchObject({
      name: "Lifecycle Breakout",
      marketSymbol: "XAUUSD",
      direction: "long",
      timeframes: ["1h"],
      riskManagementRules: "stop-loss: 1%; take-profit: 2%",
      compatibility: { compatible: true, unsupportedConditions: [] },
    });
    expect(draft.conditions).toHaveLength(1);
    expect(draft.conditions[0]).toMatchObject({
      conceptName: "Breakout",
      direction: "long",
      executionStatus: "executable",
      provenance: {
        source: "user_request",
        canonicalConcept: "Breakout",
      },
      authorization: {
        status: "explicit",
        canonicalConcept: "Breakout",
        matchedText: expect.stringContaining("Long Breakout"),
      },
    });
    expect(draft.conditions[0].parameters).toMatchObject({
      kind: "price_action",
      pattern: "breakout",
      polarity: "bullish",
      lookback: 20,
    });
    expect(draft.conditions.map((condition: { conceptName: string }) => condition.conceptName)).toEqual(["Breakout"]);
    expect(draft.riskRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "stop_loss_percentage", value: 1, unit: "percent", executionStatus: "executable" }),
      expect.objectContaining({ type: "take_profit_percentage", value: 2, unit: "percent", executionStatus: "executable" }),
    ]));

    const strategyResponse = await request(app)
      .post("/api/strategies")
      .send({
        name: draft.name,
        description: draft.description,
        status: "draft",
        marketId: resources.marketId,
        assetClass: "Commodity",
        direction: draft.direction,
        timeframes: draft.timeframes,
        conditions: draft.conditions.map((condition: any) => ({
          conceptId: resources.conceptId,
          stage: condition.stage,
          name: condition.name,
          timeframe: condition.timeframe,
          direction: condition.direction,
          requirement: condition.requirement,
          triggerRules: condition.triggerRules,
          parameters: condition.parameters,
          invalidationRules: null,
          resetBehavior: null,
        })),
        riskManagementRules: draft.riskManagementRules,
      })
      .expect(201);
    resources.strategyId = strategyResponse.body.id;
    expect(strategyResponse.body.currentVersion).toBe(1);
    expect(strategyResponse.body.currentVersionId).toBeTypeOf("number");

    const builderConditions = await request(app)
      .get(`/api/strategies/${resources.strategyId}/conditions`)
      .expect(200);
    expect(builderConditions.body).toHaveLength(1);
    expect(builderConditions.body[0]).toMatchObject({
      conceptId: resources.conceptId,
      conceptName: "Breakout",
      name: "Long Breakout",
      timeframe: "1h",
      direction: "long",
      stage: "entry",
      requirement: "required",
      parameters: expect.objectContaining({
        kind: "price_action",
        pattern: "breakout",
        polarity: "bullish",
        lookback: 20,
      }),
    });
    expect(builderConditions.body[0]).toMatchObject(expectedCanonicalFields(
      await db.select().from(tradingConceptsTable).where(eq(tradingConceptsTable.id, resources.conceptId)).then(rows => rows[0]),
    ));

    const v2Response = await request(app)
      .post(`/api/strategies/${resources.strategyId}/versions`)
      .send({
        label: "Lifecycle immutable version",
        thesis: "Break previous two-candle highs with explicit long polarity.",
        riskRules: draft.riskManagementRules,
        notes: "Created by the disposable lifecycle integration test.",
      })
      .expect(201);
    resources.versionId = v2Response.body.id;
    expect(v2Response.body.versionNumber).toBe(2);
    expect(v2Response.body.isActive).toBe(true);
    expect(v2Response.body.riskRules).toBe("stop-loss: 1%; take-profit: 2%");
    expect(v2Response.body.conditionCount).toBe(1);

    const versionConditionsBeforeEdit = await request(app)
      .get(`/api/strategies/${resources.strategyId}/versions/${resources.versionId}/conditions`)
      .expect(200);
    resources.versionConditionId = versionConditionsBeforeEdit.body[0].id;
    const immutableSnapshot = versionConditionsBeforeEdit.body[0];
    expect(immutableSnapshot).toMatchObject({
      strategyVersionId: resources.versionId,
      conceptId: resources.conceptId,
      conceptName: "Breakout",
      name: "Long Breakout",
      stage: "entry",
      direction: "long",
      requirement: "required",
      timeframe: "1h",
      parameters: expect.objectContaining({
        kind: "price_action",
        pattern: "breakout",
        polarity: "bullish",
        lookback: 20,
      }),
    });
    expect(immutableSnapshot).toMatchObject(expectedCanonicalFields(
      await db.select().from(tradingConceptsTable).where(eq(tradingConceptsTable.id, resources.conceptId)).then(rows => rows[0]),
    ));

    resources.conditionId = builderConditions.body[0].id;
    await request(app)
      .patch(`/api/strategies/${resources.strategyId}/conditions/${resources.conditionId}`)
      .send({ name: "Builder-only edited breakout checkpoint" })
      .expect(200);
    const versionConditionsAfterEdit = await request(app)
      .get(`/api/strategies/${resources.strategyId}/versions/${resources.versionId}/conditions`)
      .expect(200);
    expect(versionConditionsAfterEdit.body[0]).toEqual(immutableSnapshot);

    await request(app)
      .patch(`/api/strategies/${resources.strategyId}`)
      .send({ status: "active" })
      .expect(200);

    const backtestResponse = await request(app)
      .post("/api/backtests")
      .send({
        strategyId: resources.strategyId,
        strategyVersionId: resources.versionId,
        instrumentId: resources.marketId,
        timeframeId: resources.timeframeId,
        preset: "custom",
        startDate: candles[0].openTime.toISOString(),
        endDate: candles.at(-1)!.openTime.toISOString(),
      })
      .expect(202);
    resources.backtestId = backtestResponse.body.id;
    const backtestId = resources.backtestId;
    if (!backtestId) throw new Error("The lifecycle backtest did not return an ID.");
    const completedBacktest = await waitForBacktest(backtestId);
    expect(completedBacktest.status).toBe("completed");
    expect(completedBacktest.tradeCount).toBeGreaterThanOrEqual(4);
    expect(completedBacktest.errorMessage).toBeNull();

    const results = await request(app)
      .get(`/api/backtests/${resources.backtestId}/results`)
      .expect(200);
    expect(results.body.trades.length).toBeGreaterThanOrEqual(4);
    expect(results.body.trades.every((trade: { strategyVersionId: number; entryReason: string }) =>
      trade.strategyVersionId === resources.versionId
      && trade.entryReason.includes("Long Breakout"),
    )).toBe(true);
    expect(results.body.trades.every((trade: { stopLoss: number; takeProfit: number }) =>
      trade.stopLoss != null && trade.takeProfit != null,
    )).toBe(true);

    const monitoringResponse = await request(app)
      .post("/api/strategy-monitoring/evaluate")
      .send({ strategyId: resources.strategyId, sourceId: resources.sourceId })
      .expect(200);
    expect(monitoringResponse.body).toHaveLength(1);
    expect(monitoringResponse.body[0]).toMatchObject({
      strategyId: resources.strategyId,
      strategyVersionId: resources.versionId,
      versionNumber: 2,
      sourceId: resources.sourceId,
      marketDataState: "live",
      monitoringStatus: "monitoring",
      overallStatus: "met",
      conditionCount: 1,
      metCount: 1,
    });
    expect(monitoringResponse.body[0].conditions[0]).toMatchObject({
      strategyVersionConditionId: resources.versionConditionId,
      conceptId: resources.conceptId,
      conceptName: "Breakout",
      status: "met",
      reasonCode: "EXECUTABLE_CONDITION_MET",
      reason: expect.stringContaining("Long Breakout"),
    });

    const storedVersionCondition = await db
      .select()
      .from(strategyVersionConditionsTable)
      .where(eq(strategyVersionConditionsTable.id, resources.versionConditionId!));
    expect(storedVersionCondition[0]).toMatchObject({
      name: "Long Breakout",
      canonicalId: immutableSnapshot.canonicalId,
      registryVersion: immutableSnapshot.registryVersion,
      canonicalStatus: immutableSnapshot.canonicalStatus,
      executorKind: immutableSnapshot.executorKind,
      canonicalDefinition: immutableSnapshot.canonicalDefinition,
    });
  }, 60_000);
});