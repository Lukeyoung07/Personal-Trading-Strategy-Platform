import { and, asc, desc, eq } from "drizzle-orm";
import {
  backtestConfigurationsTable,
  backtestTradesTable,
  db,
  marketsTable,
  strategiesTable,
  strategyConditionsTable,
  strategyVersionConditionsTable,
  strategyVersionsTable,
  timeframesTable,
} from "@workspace/db";
import { ChatAssistantResponse, type ChatAssistantBody } from "@workspace/api-zod";
import { calculateBacktestStatistics } from "./backtest-results";
import { logger } from "../lib/logger";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "openrouter/free";
const OPENROUTER_TIMEOUT_MS = 60000;
const UNAVAILABLE_MESSAGE = "AI Assistant is currently unavailable.";
const RATE_LIMIT_MESSAGE = "AI is temporarily unavailable because the free AI service has reached its current limit. Please try again later.";
const NO_BACKTEST_MESSAGE = "I need a completed backtest to explain. Open a completed backtest result first, then ask me to explain it.";

type AssistantInput = typeof ChatAssistantBody._output;
type AssistantContext = AssistantInput["context"];
type AssistantResponse = typeof ChatAssistantResponse._output;

function supportedRule(rule: string | null | undefined) {
  const normalized = normalizeSupportedRule(rule);
  if (!normalized) return false;
  if (["always", "bullish", "bullish candle", "bearish", "bearish candle"].includes(normalized)) return true;
  if (/^(open|high|low|close) crosses (above|below) previous[_ ](open|high|low|close)$/.test(normalized)) return true;
  return /^(open|high|low|close|previous[_ ](?:open|high|low|close))\s*(>=|<=|>|<|=|==)\s*(open|high|low|close|previous[_ ](?:open|high|low|close)|\d+(?:\.\d+)?)$/.test(normalized);
}

function normalizeSupportedRule(rule: string | null | undefined) {
  if (!rule?.trim()) return "";
  const normalized = rule.trim().toLowerCase().replace(/[()[\],]/g, " ").replace(/\s+/g, " ");
  if (normalized === "close > open" || normalized === "close < open") return normalized;
  if (/^(?:close|candle close)\s*(?:(?:is\s*)?(?:greater than|above)|>)\s*(?:the\s*)?(?:candle\s*)?open(?:\s+(?:on|for)\s+(?:the\s+)?(?:entry|exit|signal)\s+candle)?$/.test(normalized)) return "close > open";
  if (/^(?:close|candle close)\s*(?:(?:is\s*)?(?:less than|below)|<)\s*(?:the\s*)?(?:candle\s*)?open(?:\s+(?:on|for)\s+(?:the\s+)?(?:entry|exit|signal)\s+candle)?$/.test(normalized)) return "close < open";
  if (normalized === "bullish candle") return "bullish";
  if (normalized === "bearish candle") return "bearish";
  return normalized;
}

function normalizeConditionRule(condition: any) {
  const normalized = normalizeSupportedRule(String(condition?.triggerRules || ""));
  if (supportedRule(normalized)) return normalized;
  const descriptor = `${condition?.name || ""} ${condition?.conceptName || ""} ${condition?.triggerRules || ""}`.toLowerCase();
  if (/\bbullish\b/.test(descriptor)) return "bullish";
  if (/\bbearish\b/.test(descriptor)) return "bearish";
  return normalized;
}

function compatibleRiskRules(rules: string | null | undefined) {
  if (!rules?.trim() || !/(?:stop[- ]loss|sl|take[- ]profit|tp)/i.test(rules)) return true;
  const hasStopLoss = /(?:stop[- ]loss|sl)\s*[:=]?\s*\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*(?:stop[- ]loss|sl)/i.test(rules);
  const hasTakeProfit = /(?:take[- ]profit|tp)\s*[:=]?\s*\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*(?:take[- ]profit|tp)/i.test(rules);
  return hasStopLoss && hasTakeProfit;
}

function compatibilityForDraft(draft: any) {
  const conditions = Array.isArray(draft?.conditions) ? draft.conditions : [];
  const unsupported: string[] = conditions
    .filter((condition: any) => !supportedRule(normalizeConditionRule(condition)))
    .map((condition: any) => String(condition?.name || condition?.triggerRules || "Unnamed condition"));
  if (!conditions.some((condition: any) => condition?.stage === "entry" || condition?.stage === "confirmation")) {
    unsupported.unshift("No entry condition has been added");
  }
  if (!compatibleRiskRules(draft?.riskManagementRules)) unsupported.push("The current risk rules");
  return { compatible: unsupported.length === 0, unsupportedConditions: [...new Set<string>(unsupported)] };
}

function parseDateOrNull(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseModelJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] || content;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeModelResponse(model: any): Omit<AssistantResponse, "status" | "provider"> | null {
  if (!model || typeof model.reply !== "string" || !model.reply.trim()) return null;
  const draft = model.strategyDraft && typeof model.strategyDraft === "object" ? model.strategyDraft : null;
  const strategyDraft = draft ? {
    name: String(draft.name || "Assistant strategy draft").slice(0, 160),
    description: String(draft.description || "").slice(0, 2000),
    direction: ["long", "short", "both"].includes(draft.direction) ? draft.direction : "both",
    marketSymbol: draft.marketSymbol ? String(draft.marketSymbol).slice(0, 80) : null,
    timeframes: Array.isArray(draft.timeframes) ? draft.timeframes.map(String).slice(0, 8) : [],
    conditions: Array.isArray(draft.conditions) ? draft.conditions.map((condition: any) => ({
      name: String(condition?.name || "Assistant condition").slice(0, 160),
      stage: ["entry", "confirmation", "invalidation", "exit"].includes(condition?.stage) ? condition.stage : "entry",
      requirement: condition?.requirement === "optional" ? "optional" : "required",
      conceptName: supportedRule(normalizeConditionRule(condition)) && /(?:bullish|bearish|close|open)/i.test(`${condition?.triggerRules || ""} ${condition?.conceptName || ""}`)
        ? "Candle Direction"
        : String(condition?.conceptName || "Assistant draft").slice(0, 160),
      timeframe: String(condition?.timeframe || "Not specified").slice(0, 40),
      triggerRules: normalizeConditionRule(condition).slice(0, 400),
      supported: supportedRule(normalizeConditionRule(condition)),
    })).slice(0, 20) : [],
    riskManagementRules: draft.riskManagementRules ? String(draft.riskManagementRules).slice(0, 400) : null,
    compatibility: compatibilityForDraft(draft),
  } : null;
  return {
    reply: model.reply.trim().slice(0, 6000),
    intent: typeof model.intent === "string" ? model.intent.slice(0, 80) : null,
    strategyDraft,
    compatibility: strategyDraft?.compatibility || null,
    backtestSetup: model.backtestSetup && typeof model.backtestSetup === "object" ? {
      strategyId: Number.isInteger(model.backtestSetup.strategyId) ? model.backtestSetup.strategyId : null,
      versionId: Number.isInteger(model.backtestSetup.versionId) ? model.backtestSetup.versionId : null,
      instrumentId: Number.isInteger(model.backtestSetup.instrumentId) ? model.backtestSetup.instrumentId : null,
      timeframeId: Number.isInteger(model.backtestSetup.timeframeId) ? model.backtestSetup.timeframeId : null,
      startDate: parseDateOrNull(model.backtestSetup.startDate),
      endDate: parseDateOrNull(model.backtestSetup.endDate),
    } : null,
  };
}

async function contextForRequest(context: AssistantContext, message: string) {
  const result: Record<string, unknown> = { page: context.page || "workspace" };
  if (context.strategyId) {
    const [strategy] = await db.select({
      id: strategiesTable.id,
      name: strategiesTable.name,
      description: strategiesTable.description,
      direction: strategiesTable.direction,
      timeframes: strategiesTable.timeframes,
      riskManagementRules: strategiesTable.riskManagementRules,
      marketSymbol: marketsTable.symbol,
    }).from(strategiesTable).leftJoin(marketsTable, eq(strategiesTable.marketId, marketsTable.id)).where(eq(strategiesTable.id, context.strategyId));
    if (strategy) {
      const conditions = await db.select({
        name: strategyConditionsTable.name,
        stage: strategyConditionsTable.stage,
        requirement: strategyConditionsTable.requirement,
        timeframe: strategyConditionsTable.timeframe,
        triggerRules: strategyConditionsTable.triggerRules,
      }).from(strategyConditionsTable).where(eq(strategyConditionsTable.strategyId, context.strategyId)).orderBy(asc(strategyConditionsTable.conditionOrder));
      result.strategy = { ...strategy, conditions };
    }
    if (/compare|version/i.test(message)) {
      result.strategyVersions = await db.select({
        id: strategyVersionsTable.id,
        strategyId: strategyVersionsTable.strategyId,
        versionNumber: strategyVersionsTable.versionNumber,
        name: strategyVersionsTable.name,
        description: strategyVersionsTable.description,
        direction: strategyVersionsTable.direction,
        timeframes: strategyVersionsTable.timeframes,
        riskManagementRules: strategyVersionsTable.riskManagementRules,
        createdAt: strategyVersionsTable.createdAt,
      }).from(strategyVersionsTable)
        .where(eq(strategyVersionsTable.strategyId, context.strategyId))
        .orderBy(desc(strategyVersionsTable.versionNumber));
    }
  }
  if (context.versionId) {
    const [version] = await db.select({
      id: strategyVersionsTable.id,
      strategyId: strategyVersionsTable.strategyId,
      versionNumber: strategyVersionsTable.versionNumber,
      name: strategyVersionsTable.name,
      description: strategyVersionsTable.description,
      direction: strategyVersionsTable.direction,
      timeframes: strategyVersionsTable.timeframes,
      entryRules: strategyVersionsTable.entryRules,
      exitRules: strategyVersionsTable.exitRules,
      riskManagementRules: strategyVersionsTable.riskManagementRules,
    }).from(strategyVersionsTable).where(and(
      eq(strategyVersionsTable.id, context.versionId),
      context.strategyId ? eq(strategyVersionsTable.strategyId, context.strategyId) : undefined,
    ));
    if (version) {
      const conditions = await db.select({
        name: strategyVersionConditionsTable.name,
        stage: strategyVersionConditionsTable.stage,
        requirement: strategyVersionConditionsTable.requirement,
        timeframe: strategyVersionConditionsTable.timeframe,
        triggerRules: strategyVersionConditionsTable.triggerRules,
      }).from(strategyVersionConditionsTable).where(eq(strategyVersionConditionsTable.strategyVersionId, context.versionId)).orderBy(asc(strategyVersionConditionsTable.conditionOrder));
      result.exactVersion = { ...version, conditions };
    }
  }
  if (context.backtestId) {
    const [backtest] = await db.select({
      id: backtestConfigurationsTable.id,
      strategyId: backtestConfigurationsTable.strategyId,
      strategyVersionId: backtestConfigurationsTable.strategyVersionId,
      status: backtestConfigurationsTable.status,
      startDate: backtestConfigurationsTable.startDate,
      endDate: backtestConfigurationsTable.endDate,
      errorMessage: backtestConfigurationsTable.errorMessage,
      strategyName: strategiesTable.name,
      versionNumber: strategyVersionsTable.versionNumber,
      instrumentSymbol: marketsTable.symbol,
      timeframeLabel: timeframesTable.label,
    }).from(backtestConfigurationsTable)
      .innerJoin(strategiesTable, eq(backtestConfigurationsTable.strategyId, strategiesTable.id))
      .innerJoin(strategyVersionsTable, eq(backtestConfigurationsTable.strategyVersionId, strategyVersionsTable.id))
      .innerJoin(marketsTable, eq(backtestConfigurationsTable.instrumentId, marketsTable.id))
      .innerJoin(timeframesTable, eq(backtestConfigurationsTable.timeframeId, timeframesTable.id))
      .where(eq(backtestConfigurationsTable.id, context.backtestId));
    if (backtest) {
      const trades = await db.select({
        id: backtestTradesTable.id,
        side: backtestTradesTable.side,
        entryTime: backtestTradesTable.entryTime,
        entryPrice: backtestTradesTable.entryPrice,
        stopLoss: backtestTradesTable.stopLoss,
        takeProfit: backtestTradesTable.takeProfit,
        exitTime: backtestTradesTable.exitTime,
        exitPrice: backtestTradesTable.exitPrice,
        pnl: backtestTradesTable.pnl,
        entryReason: backtestTradesTable.entryReason,
        exitReason: backtestTradesTable.exitReason,
      })
        .from(backtestTradesTable).where(eq(backtestTradesTable.backtestId, context.backtestId));
      const statistics = backtest.status === "completed"
        ? calculateBacktestStatistics(trades.map(trade => ({ ...trade, pnl: Number(trade.pnl) })), backtest.startDate)
        : null;
      result.backtest = {
        ...backtest,
        tradeCount: trades.length,
        statistics,
        trades: trades.map(trade => ({
          ...trade,
          entryPrice: Number(trade.entryPrice),
          stopLoss: trade.stopLoss == null ? null : Number(trade.stopLoss),
          takeProfit: trade.takeProfit == null ? null : Number(trade.takeProfit),
          exitPrice: Number(trade.exitPrice),
          pnl: Number(trade.pnl),
        })),
      };
    }
  }
  if (/compare|strateg(y|ies)|backtest|perform|result/i.test(message)) {
    const recentBacktests = await db.select({
      id: backtestConfigurationsTable.id,
      strategyId: backtestConfigurationsTable.strategyId,
      strategyVersionId: backtestConfigurationsTable.strategyVersionId,
      status: backtestConfigurationsTable.status,
      startDate: backtestConfigurationsTable.startDate,
      endDate: backtestConfigurationsTable.endDate,
      strategyName: strategiesTable.name,
      versionNumber: strategyVersionsTable.versionNumber,
      instrumentSymbol: marketsTable.symbol,
      timeframeLabel: timeframesTable.label,
    }).from(backtestConfigurationsTable)
      .innerJoin(strategiesTable, eq(backtestConfigurationsTable.strategyId, strategiesTable.id))
      .innerJoin(strategyVersionsTable, eq(backtestConfigurationsTable.strategyVersionId, strategyVersionsTable.id))
      .innerJoin(marketsTable, eq(backtestConfigurationsTable.instrumentId, marketsTable.id))
      .innerJoin(timeframesTable, eq(backtestConfigurationsTable.timeframeId, timeframesTable.id))
      .orderBy(desc(backtestConfigurationsTable.createdAt)).limit(20);
    result.recentBacktests = recentBacktests;
  }
  return result;
}

function systemPrompt(context: Record<string, unknown>) {
  return `You are the single AI Trading Assistant inside a broker-independent personal trading workspace.

Safety and product boundaries:
- Never place trades, execute orders, connect to brokers, guarantee outcomes, fabricate market data, news, or backtest statistics.
- Use only the stored context supplied below for strategy and backtest facts. If a fact is absent, say it is unavailable.
- Existing Backtesting supports only: always, bullish, bearish, OHLC comparisons, and previous-candle crossings. If a requested condition cannot be represented exactly, identify it as unsupported and never claim it is backtest-compatible.
- Strategy directions must be exactly long, short, or both. Conditions must use the existing model fields.
- Never silently save, overwrite, activate, or run anything. Prepare drafts and explain the user's next explicit action.
- When setup context contains a strategy or version ID, copy those IDs unchanged. Never substitute a different strategy version.
- Keep explanations beginner-friendly and concise.

Return JSON only with this shape:
{
  "reply": "plain-English answer",
  "intent": "education | strategy_proposal | strategy_review | backtest_help | result_explanation | comparison",
  "strategyDraft": null or {
    "name": "string",
    "description": "string",
    "direction": "long | short | both",
    "marketSymbol": "string or null",
    "timeframes": ["string"],
    "conditions": [{"name":"string","stage":"entry|confirmation|invalidation|exit","requirement":"required|optional","conceptName":"string","timeframe":"string","triggerRules":"exact supported rule or descriptive unsupported rule"}],
    "riskManagementRules": "string or null"
  },
  "backtestSetup": null or {"strategyId": number|null,"versionId":number|null,"instrumentId":number|null,"timeframeId":number|null,"startDate":"ISO string|null","endDate":"ISO string|null"}
}
When proposing a strategy, include a draft even if one requested condition is unsupported; explain that limitation in reply. For result explanations, use only actual numbers from context.

Current workspace context:
${JSON.stringify(context)}`;
}

function isBacktestExplanation(message: string) {
  return /(?:explain|analyse|analyze|review|understand).*(?:backtest|results?)|(?:backtest).*(?:results?|performance)/i.test(message);
}

function localAssistantResponse(reply: string): AssistantResponse {
  return ChatAssistantResponse.parse({
    status: "available",
    reply,
    provider: OPENROUTER_MODEL,
    intent: "result_explanation",
    strategyDraft: null,
    compatibility: null,
    backtestSetup: null,
  });
}

export async function answerAssistant(input: AssistantInput): Promise<AssistantResponse> {
  const requestingBacktestExplanation = isBacktestExplanation(input.message);
  if (requestingBacktestExplanation && !input.context.backtestId) {
    return localAssistantResponse(NO_BACKTEST_MESSAGE);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return ChatAssistantResponse.parse({ status: "unavailable", reply: UNAVAILABLE_MESSAGE, provider: OPENROUTER_MODEL, intent: null, strategyDraft: null, compatibility: null, backtestSetup: null });
  }
  let context: Record<string, unknown>;
  try {
    context = await contextForRequest(input.context, input.message);
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : "Unknown context error",
      backtestId: input.context.backtestId ?? null,
    }, "Assistant context could not be loaded");
    if (requestingBacktestExplanation) {
      return localAssistantResponse("I couldn't load the stored backtest results right now. Please reopen the completed result and try again.");
    }
    return ChatAssistantResponse.parse({ status: "unavailable", reply: UNAVAILABLE_MESSAGE, provider: OPENROUTER_MODEL, intent: null, strategyDraft: null, compatibility: null, backtestSetup: null });
  }
  if (requestingBacktestExplanation) {
    const backtest = context.backtest as { status?: string; statistics?: unknown } | undefined;
    if (!backtest || backtest.statistics == null || backtest.status !== "completed") {
      return localAssistantResponse(NO_BACKTEST_MESSAGE);
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://replit.com",
        "X-Title": "Tandem Trading Workspace",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: systemPrompt(context) },
          ...input.messages.slice(-10),
          { role: "user", content: input.message },
        ],
        max_tokens: 1200,
        reasoning: { effort: "none" },
        response_format: { type: "json_object" },
      }),
    });
    if (!upstream.ok) {
      const errorBody = await upstream.text();
      logger.warn({
        upstreamStatus: upstream.status,
        responseBody: errorBody.slice(0, 500),
      }, "OpenRouter assistant request was rejected");
      if (upstream.status === 429 || upstream.status === 503 || upstream.status === 502) {
        return ChatAssistantResponse.parse({ status: "rate_limited", reply: RATE_LIMIT_MESSAGE, provider: OPENROUTER_MODEL, intent: null, strategyDraft: null, compatibility: null, backtestSetup: null });
      }
      throw new Error(`OpenRouter request failed with status ${upstream.status}`);
    }
    const payload = await upstream.json() as any;
    const content = typeof payload?.choices?.[0]?.message?.content === "string" ? payload.choices[0].message.content : "";
    const parsed = normalizeModelResponse(parseModelJson(content));
    if (!parsed) throw new Error("OpenRouter returned an invalid assistant response.");
    const backtestSetup = parsed.backtestSetup ? {
      ...parsed.backtestSetup,
      strategyId: input.context.strategyId ?? parsed.backtestSetup.strategyId,
      versionId: input.context.versionId ?? parsed.backtestSetup.versionId,
      instrumentId: input.context.instrumentId ?? parsed.backtestSetup.instrumentId,
      timeframeId: input.context.timeframeId ?? parsed.backtestSetup.timeframeId,
      startDate: input.context.startDate ?? parsed.backtestSetup.startDate,
      endDate: input.context.endDate ?? parsed.backtestSetup.endDate,
    } : null;
    return ChatAssistantResponse.parse({ status: "available", provider: OPENROUTER_MODEL, ...parsed, backtestSetup });
  } catch (error) {
    logger.warn({
      error: error instanceof Error ? error.message : "Unknown assistant error",
      timedOut: controller.signal.aborted,
    }, "OpenRouter assistant request failed");
    return ChatAssistantResponse.parse({ status: "unavailable", reply: UNAVAILABLE_MESSAGE, provider: OPENROUTER_MODEL, intent: null, strategyDraft: null, compatibility: null, backtestSetup: null });
  } finally {
    clearTimeout(timeout);
  }
}