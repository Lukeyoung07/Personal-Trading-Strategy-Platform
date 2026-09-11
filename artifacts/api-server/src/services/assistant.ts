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
  tradingConceptsTable,
} from "@workspace/db";
import { ChatAssistantResponse, type ChatAssistantBody } from "@workspace/api-zod";
import { calculateBacktestStatistics } from "./backtest-results";
import { logger } from "../lib/logger";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "openrouter/free";
const OPENROUTER_TIMEOUT_MS = 60000;
const UNAVAILABLE_MESSAGE = "AI Assistant is currently unavailable.";
const RATE_LIMIT_MESSAGE = "AI is temporarily unavailable because the free AI service has reached its current limit. Please try again later.";
const PROVIDER_TEMPORARY_MESSAGE = "The AI provider is temporarily unavailable. Please try again shortly.";
const TIMEOUT_MESSAGE = "The AI provider took too long to respond. Please try again shortly.";
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
  if (/(?:risk[\/ -]?reward|percentage risk|risk per trade|position siz(?:e|ing)|maximum risk|max(?:imum)? risk)/i.test(rules)) return false;
  const hasStopLoss = /(?:stop[- ]loss|sl)\s*[:=]?\s*\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*(?:stop[- ]loss|sl)/i.test(rules);
  const hasTakeProfit = /(?:take[- ]profit|tp)\s*[:=]?\s*\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*(?:take[- ]profit|tp)/i.test(rules);
  return hasStopLoss && hasTakeProfit;
}

type UnsupportedConceptDefinition = {
  pattern: RegExp;
  name: string;
  explanation?: string;
};

const UNSUPPORTED_CONCEPTS: UnsupportedConceptDefinition[] = [
  { pattern: /\b(?:hh|higher high)\b/i, name: "Higher High" },
  { pattern: /\b(?:hl|higher low)\b/i, name: "Higher Low" },
  { pattern: /\b(?:lh|lower high)\b/i, name: "Lower High" },
  { pattern: /\b(?:ll|lower low)\b/i, name: "Lower Low" },
  { pattern: /\b(?:bos|break of structure)\b/i, name: "Break of Structure" },
  { pattern: /\b(?:choch|change of character)\b/i, name: "Change of Character" },
  { pattern: /\bbuy[- ]?side liquidity\b|\bbuy[- ]?side\b/i, name: "Buy-side Liquidity" },
  { pattern: /\bsell[- ]?side liquidity\b|\bsell[- ]?side\b/i, name: "Sell-side Liquidity" },
  { pattern: /\bliquidity sweep\b/i, name: "Liquidity Sweep" },
  { pattern: /\bliquidity grab\b/i, name: "Liquidity Grab" },
  { pattern: /\bequal highs?\b/i, name: "Equal Highs" },
  { pattern: /\bequal lows?\b/i, name: "Equal Lows" },
  { pattern: /\bprevious high liquidity\b/i, name: "Previous High Liquidity" },
  { pattern: /\bprevious low liquidity\b/i, name: "Previous Low Liquidity" },
  { pattern: /\bsupport\b/i, name: "Support" },
  { pattern: /\bresistance\b/i, name: "Resistance" },
  { pattern: /\bbreak(?:\s+and|\/)\s*retest\b|\bbreak and retest\b/i, name: "Break and Retest" },
  { pattern: /\brejection candle\b/i, name: "Rejection Candle" },
  { pattern: /\brejection\b/i, name: "Rejection" },
  { pattern: /\bprevious day high\b/i, name: "Previous Day High" },
  { pattern: /\bprevious day low\b/i, name: "Previous Day Low" },
  { pattern: /\bprevious week high\b/i, name: "Previous Week High" },
  { pattern: /\bprevious week low\b/i, name: "Previous Week Low" },
  { pattern: /\bsupply\b/i, name: "Supply" },
  { pattern: /\bdemand\b/i, name: "Demand" },
  { pattern: /\bzone reaction\b/i, name: "Zone Reaction" },
  { pattern: /\bzone retest\b/i, name: "Zone Retest" },
  { pattern: /\b(?:bullish|bearish)\s+fvg\b/i, name: "Fair Value Gap (FVG)" },
  { pattern: /\bfvg\s+fill|fair value gap\s+fill\b/i, name: "FVG Fill" },
  { pattern: /\bfvg\s+retest|fair value gap\s+retest\b/i, name: "FVG Retest" },
  { pattern: /\binverse fair value gap\b|\bifvg\b/i, name: "Inverse Fair Value Gap (IFVG)" },
  { pattern: /\bfair value gap\b|\bfvg\b/i, name: "Fair Value Gap (FVG)" },
  { pattern: /\bbullish order block\b/i, name: "Bullish Order Block" },
  { pattern: /\bbearish order block\b/i, name: "Bearish Order Block" },
  { pattern: /\border block retest\b/i, name: "Order Block Retest" },
  { pattern: /\bbreaker block\b/i, name: "Breaker Block" },
  { pattern: /\border block\b/i, name: "Order Block" },
  { pattern: /\bdisplacement\b/i, name: "Displacement" },
  { pattern: /\bbreakout\b/i, name: "Breakout" },
  { pattern: /\bpullback\b/i, name: "Pullback" },
  { pattern: /\bretest\b/i, name: "Retest" },
  { pattern: /\bpremium\b/i, name: "Premium" },
  { pattern: /\bdiscount\b/i, name: "Discount" },
  { pattern: /\bequilibrium\b/i, name: "Equilibrium" },
  { pattern: /\bhigher[- ]timeframe\s+bias\b|\bhtf bias\b|\b\d+\s*h\b[^.!?]{0,30}\bbias\b/i, name: "Higher-timeframe bias" },
  { pattern: /\blower[- ]timeframe\s+confirmation\b|\bltf confirmation\b/i, name: "Lower-timeframe confirmation" },
  { pattern: /\bhigher[- ]timeframe levels?\b|\bhtf levels?\b/i, name: "Higher-timeframe levels" },
  { pattern: /\bmultiple[- ]timeframe analysis\b/i, name: "Multi-timeframe analysis" },
  { pattern: /\bmulti[- ]timeframe\b|\b\d+\s*h\b.*\b\d+\s*m\b/i, name: "Multi-timeframe analysis" },
  { pattern: /\bhigher[- ]timeframe\b/i, name: "Higher-timeframe bias" },
  { pattern: /\blower[- ]timeframe\b/i, name: "Lower-timeframe confirmation" },
  { pattern: /\birl\b/i, name: "IRL" },
  { pattern: /\berl\b/i, name: "ERL" },
  { pattern: /\bsmt divergence\b|\bsmt\b/i, name: "SMT Divergence" },
  { pattern: /\bamd\b|power of 3/i, name: "AMD / Power of 3" },
  { pattern: /\bema\b|exponential moving average/i, name: "Exponential Moving Average (EMA)" },
  { pattern: /\bsma\b|simple moving average/i, name: "Simple Moving Average (SMA)" },
  { pattern: /\bprice\s+(?:above|below)\s+(?:the\s+)?ema\b/i, name: "Price above/below EMA" },
  { pattern: /\bema crossover\b/i, name: "EMA Crossover" },
  { pattern: /\bema rejection\b/i, name: "EMA Rejection" },
  { pattern: /\bema trend confirmation\b/i, name: "EMA Trend Confirmation" },
  { pattern: /\brisk[\/ -]?reward\b|\br:r\b/i, name: "Risk / Reward" },
  { pattern: /\bpercentage risk\b|\brisk per trade\b/i, name: "Percentage Risk" },
  { pattern: /\bposition sizing\b|\bposition size\b/i, name: "Position Sizing" },
  { pattern: /\bmaximum risk\b|\bmax(?:imum)? risk\b/i, name: "Maximum Risk per Trade" },
  { pattern: /\bstop[- ]loss\b|\bfixed stop\b/i, name: "Stop Loss" },
  { pattern: /\btake[- ]profit\b|\bfixed take\b/i, name: "Take Profit" },
];

function unsupportedConceptForText(value: string): UnsupportedConceptDefinition | null {
  return UNSUPPORTED_CONCEPTS.find(concept => concept.pattern.test(value)) || null;
}

function compatibilityForDraft(draft: any) {
  const conditions = Array.isArray(draft?.conditions) ? draft.conditions : [];
  const unsupported: string[] = conditions
    .filter((condition: any) => condition?.supported !== true || !supportedRule(normalizeConditionRule(condition)))
    .map((condition: any) => String(condition?.name || condition?.triggerRules || "Unnamed condition"));
  const unsupportedConcepts = Array.isArray(draft?.conceptsUsed)
    ? draft.conceptsUsed
      .filter((concept: any) => concept && concept.supported === false)
      .map((concept: any) => String(concept.name || "Unnamed concept"))
    : [];
  unsupported.push(...unsupportedConcepts);
  if (!conditions.some((condition: any) => condition?.stage === "entry" || condition?.stage === "confirmation")) {
    unsupported.unshift("No entry condition has been added");
  }
  if (!compatibleRiskRules(draft?.riskManagementRules)) unsupported.push("The current risk rules");
  return { compatible: unsupported.length === 0, unsupportedConditions: [...new Set<string>(unsupported)] };
}

function knownUnsupportedConcept(name: string) {
  return unsupportedConceptForText(name) !== null;
}

function normalizeConcepts(rawConcepts: unknown, conditions: Array<{ conceptName: string; supported: boolean }>) {
  const concepts = new Map<string, { name: string; supported: boolean; explanation: string }>();
  const addConcept = (raw: any, fallbackName?: string) => {
    const rawName = String(typeof raw === "string" ? raw : raw?.name || fallbackName || "").trim().slice(0, 120);
    if (!rawName) return;
    const unsupportedConcept = unsupportedConceptForText(rawName);
    const name = unsupportedConcept?.name || rawName;
    const matchingConditions = conditions.filter(condition =>
      condition.conceptName.toLowerCase() === rawName.toLowerCase() ||
      condition.conceptName.toLowerCase() === name.toLowerCase(),
    );
    const supported = unsupportedConcept
      ? false
      : matchingConditions.length > 0
        ? matchingConditions.every(condition => condition.supported) && raw?.supported !== false
        : raw?.supported === true;
    const explanation = String(
      typeof raw === "object" && raw?.explanation
        ? raw.explanation
        : supported
          ? "Represented by the current historical rule set."
          : "Understood by the assistant, but not currently executable by historical backtesting.",
    ).slice(0, 300);
    const existing = concepts.get(name.toLowerCase());
    concepts.set(name.toLowerCase(), {
      name,
      supported: existing ? existing.supported && supported : supported,
      explanation: existing?.explanation || explanation,
    });
  };

  if (Array.isArray(rawConcepts)) rawConcepts.forEach(concept => addConcept(concept));
  conditions.forEach(condition => addConcept(condition.conceptName));
  return [...concepts.values()].slice(0, 30);
}

function conceptsRequestedInMessage(message: string) {
  const requested: Array<{ name: string; supported: false; explanation: string }> = [];
  const seen = new Set<string>();
  for (const concept of UNSUPPORTED_CONCEPTS) {
    if (!concept.pattern.test(message) || seen.has(concept.name)) continue;
    seen.add(concept.name);
    requested.push({
      name: concept.name,
      supported: false,
      explanation: concept.name === "Multi-timeframe analysis"
        ? "The engine backtests one timeframe at a time and cannot combine higher-timeframe bias with lower-timeframe entries."
        : concept.explanation || "Understood by the assistant, but not currently executable by historical backtesting.",
    });
  }
  if (/\bhigher[- ]timeframe\b|\blower[- ]timeframe\b|\b\d+\s*h\b.*\b\d+\s*m\b|\bmulti[- ]timeframe\b/i.test(message) && !seen.has("Multi-timeframe analysis")) {
    requested.push({
      name: "Multi-timeframe analysis",
      supported: false,
      explanation: "The engine backtests one timeframe at a time and cannot combine higher-timeframe bias with lower-timeframe entries.",
    });
  }
  return requested;
}

function enrichDraftConcepts(draft: any, message: string) {
  const conceptsUsed = normalizeConcepts([
    ...(Array.isArray(draft.conceptsUsed) ? draft.conceptsUsed : []),
    ...conceptsRequestedInMessage(message),
  ], draft.conditions || []);
  return {
    ...draft,
    conceptsUsed,
    compatibility: compatibilityForDraft({ ...draft, conceptsUsed }),
  };
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

type BuilderCatalog = {
  concepts: Array<{ name: string; category: string | null }>;
  markets: string[];
  timeframes: string[];
};

function catalogKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const CONCEPT_ALIASES: Record<string, string[]> = {
  "fair value gap": ["fvg", "imbalance"],
  "inverse fair value gap": ["ifvg"],
  "break of structure": ["bos"],
  "change of character": ["choch"],
  "market structure shift": ["mss"],
  "higher timeframe bias": ["htf"],
  "lower timeframe confirmation": ["ltf"],
  "power of 3 / amd": ["amd", "power of 3", "power of three"],
  "order block": ["ob"],
  "smt divergence": ["smt"],
  ema: ["ema", "exponential moving average"],
  sma: ["sma", "simple moving average"],
};

function matchCatalogConcept(value: string, catalog: BuilderCatalog): string | null {
  const key = catalogKey(value);
  if (!key) return null;
  const exact = catalog.concepts.find(concept => catalogKey(concept.name) === key);
  if (exact) return exact.name;
  const aliasTarget = Object.entries(CONCEPT_ALIASES).find(([, aliases]) => aliases.some(alias => {
    const aliasKey = catalogKey(alias);
    return aliasKey === key || key.includes(aliasKey);
  }))?.[0];
  if (aliasTarget) {
    const aliased = catalog.concepts.find(concept => catalogKey(concept.name) === catalogKey(aliasTarget));
    if (aliased) return aliased.name;
  }
  const contained = catalog.concepts.find(concept => {
    const conceptKey = catalogKey(concept.name);
    return conceptKey.length > 5 && (key.includes(conceptKey) || conceptKey.includes(key));
  });
  return contained?.name || null;
}

function matchCatalogTimeframe(value: string, catalog: BuilderCatalog): string | null {
  const key = catalogKey(value).replace(/\b(minutes?|mins?)\b/g, "m").replace(/\bhours?\b/g, "h").replace(/\bdays?\b/g, "d");
  if (!key) return null;
  const exact = catalog.timeframes.find(timeframe => catalogKey(timeframe) === key);
  if (exact) return exact;
  const compact = key.replace(/\s+/g, "");
  return catalog.timeframes.find(timeframe => catalogKey(timeframe).replace(/\s+/g, "") === compact) || null;
}

function matchCatalogMarket(value: string | null | undefined, catalog: BuilderCatalog): string | null {
  const key = catalogKey(String(value || ""));
  if (!key) return null;
  const exact = catalog.markets.find(market => catalogKey(market) === key);
  if (exact) return exact;
  const aliases: Record<string, string[]> = {
    xauusd: ["gold", "spot gold", "xau"],
    ustec: ["us tech 100", "nasdaq 100", "nasdaq"],
    nas100: ["us tech 100", "nasdaq 100", "nasdaq"],
    btcusd: ["bitcoin", "btc"],
    ethusd: ["ethereum", "eth"],
  };
  const target = catalog.markets.find(market => aliases[catalogKey(market)]?.includes(key));
  return target || null;
}

function normalizeRiskRules(value: string | null | undefined) {
  if (!value?.trim()) return null;
  return value
    .replace(/risk\s*per\s*trade\s*[:=]\s*(\d+(?:\.\d+)?)\s*%/gi, "risk: $1%")
    .replace(/risk\s*\/\s*reward\s*[:=]\s*(\d+(?:\.\d+)?)\s*:\s*1/gi, "risk/reward: $1R")
    .replace(/risk\s*reward\s*[:=]\s*(\d+(?:\.\d+)?)\s*:\s*1/gi, "risk/reward: $1R")
    .slice(0, 400);
}

async function builderCatalog(): Promise<BuilderCatalog> {
  const [concepts, markets, timeframes] = await Promise.all([
    db.select({ name: tradingConceptsTable.name, category: tradingConceptsTable.category })
      .from(tradingConceptsTable)
      .orderBy(asc(tradingConceptsTable.name)),
    db.select({ symbol: marketsTable.symbol }).from(marketsTable).orderBy(asc(marketsTable.symbol)),
    db.select({ code: timeframesTable.code, label: timeframesTable.label })
      .from(timeframesTable)
      .where(eq(timeframesTable.isActive, true))
      .orderBy(asc(timeframesTable.durationSeconds)),
  ]);
  return {
    concepts,
    markets: markets.map(market => market.symbol),
    timeframes: timeframes.flatMap(timeframe => [timeframe.code, timeframe.label]),
  };
}

function validateDraftAgainstCatalog(draft: any, catalog: BuilderCatalog) {
  if (!draft) return draft;
  const warnings: string[] = [];
  const conditions = (draft.conditions || []).map((condition: any) => {
    const conceptName = matchCatalogConcept(String(condition.conceptName || ""), catalog);
    const timeframe = matchCatalogTimeframe(String(condition.timeframe || ""), catalog);
    if (!conceptName) warnings.push(`Concept “${String(condition.conceptName || "Unnamed concept")}” is not in the Trading Concept Library.`);
    if (condition.timeframe && !timeframe) warnings.push(`Timeframe “${String(condition.timeframe)}” is not in the active Builder timeframes.`);
    return {
      ...condition,
      conceptName: conceptName || String(condition.conceptName || "Unmapped concept").slice(0, 160),
      timeframe: timeframe || String(condition.timeframe || "Not specified").slice(0, 40),
      supported: Boolean(conceptName) && condition.supported === true,
    };
  });
  const marketSymbol = matchCatalogMarket(draft.marketSymbol, catalog);
  if (draft.marketSymbol && !marketSymbol) warnings.push(`Market “${String(draft.marketSymbol)}” is not in the active market catalog.`);
  if (!String(draft.name || "").trim()) warnings.push("Strategy name needs review.");
  if (!["long", "short", "both"].includes(draft.direction)) warnings.push("Strategy direction needs review.");
  const conceptsUsed = normalizeConcepts(draft.conceptsUsed, conditions);
  const next = {
    ...draft,
    marketSymbol,
    conditions,
    conceptsUsed,
    riskManagementRules: normalizeRiskRules(draft.riskManagementRules),
  };
  const compatibility = compatibilityForDraft(next);
  return {
    ...next,
    compatibility: {
      ...compatibility,
      unsupportedConditions: [...new Set([...compatibility.unsupportedConditions, ...warnings])],
      compatible: compatibility.compatible && warnings.length === 0,
    },
  };
}

function normalizeModelResponse(model: any): Omit<AssistantResponse, "status" | "provider"> | null {
  if (!model || typeof model.reply !== "string" || !model.reply.trim()) return null;
  const draft = model.strategyDraft && typeof model.strategyDraft === "object" ? model.strategyDraft : null;
  const conditions = draft && Array.isArray(draft.conditions) ? draft.conditions.map((condition: any) => {
    const normalizedRule = normalizeConditionRule(condition);
    const rawConceptName = String(condition?.conceptName || "Assistant draft").slice(0, 160);
    const unsupportedConcept = unsupportedConceptForText(rawConceptName);
    const ruleIsSupported = supportedRule(normalizedRule);
    return {
      name: String(condition?.name || "Assistant condition").slice(0, 160),
      stage: ["entry", "confirmation", "invalidation", "exit"].includes(condition?.stage) ? condition.stage : "entry",
      requirement: condition?.requirement === "optional" ? "optional" : "required",
      conceptName: unsupportedConcept?.name || (ruleIsSupported && /(?:bullish|bearish|close|open)/i.test(`${condition?.triggerRules || ""} ${condition?.conceptName || ""}`)
        ? "Candle Direction"
        : rawConceptName),
      timeframe: String(condition?.timeframe || "Not specified").slice(0, 40),
      triggerRules: normalizedRule.slice(0, 400),
      supported: ruleIsSupported && !unsupportedConcept,
    };
  }).slice(0, 20) : [];
  const conceptsUsed = draft ? normalizeConcepts(draft.conceptsUsed, conditions) : [];
  const compatibility = draft
    ? compatibilityForDraft({ ...draft, conditions, conceptsUsed })
    : { compatible: true, unsupportedConditions: [] };
  const strategyDraft = draft ? {
    name: String(draft.name || "Assistant strategy draft").slice(0, 160),
    description: String(draft.description || "").slice(0, 2000),
    direction: ["long", "short", "both"].includes(draft.direction) ? draft.direction : "both",
    marketSymbol: draft.marketSymbol ? String(draft.marketSymbol).slice(0, 80) : null,
    timeframes: Array.isArray(draft.timeframes) ? draft.timeframes.map(String).slice(0, 8) : [],
    conditions,
    conceptsUsed,
     riskManagementRules: draft.riskManagementRules ? String(draft.riskManagementRules).slice(0, 400) : null,
    compatibility,
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

function isStrategyDraftRequest(message: string) {
  return /(?:build|create|make|design|draft).*(?:strategy|setup|system)|(?:strategy|setup).*(?:using|with|based on)/i.test(message);
}

function unsupportedConceptFromRequest(message: string) {
  return unsupportedConceptForText(message) || {
    name: "Requested strategy concept",
    pattern: /./i,
  };
}

function fallbackDraftForUnsupportedRequest(message: string, reply: string) {
  const concept = unsupportedConceptFromRequest(message);
  const marketSymbol = message.match(/\b(?:XAUUSD|USTEC|US30|NAS100|SPX500|EURUSD|GBPUSD|USDJPY|BTCUSD|ETHUSD)\b/i)?.[0]?.toUpperCase() || null;
  const timeframes = [...message.matchAll(/\b\d+\s*(?:m|min|minute|h|hour|d|day|w|week)s?\b/gi)]
    .map(match => match[0].replace(/\s+/g, " ").trim())
    .slice(0, 4);
  const conditionName = `Requested ${concept.name}`;
  const explanation = "Understood by the assistant, but not currently executable by historical backtesting.";
  return {
    name: `${marketSymbol ? `${marketSymbol} ` : ""}${concept.name} strategy`.slice(0, 160),
    description: reply.slice(0, 2000),
    direction: (/\b(?:buy|long|bullish)\b/i.test(message) && !/\b(?:sell|short|bearish)\b/i.test(message)
      ? "long"
      : /\b(?:sell|short|bearish)\b/i.test(message) && !/\b(?:buy|long|bullish)\b/i.test(message)
        ? "short"
        : "both") as "long" | "short" | "both",
    marketSymbol,
    timeframes,
    conditions: [{
      name: conditionName,
      stage: "entry" as const,
      requirement: "required" as const,
      conceptName: concept.name,
      timeframe: timeframes[0] || "Not specified",
      triggerRules: `${concept.name} requested; unsupported for historical execution.`,
      supported: false,
    }],
    conceptsUsed: [{
      name: concept.name,
      supported: false,
      explanation,
    }],
    riskManagementRules: null,
    compatibility: {
      compatible: false,
      unsupportedConditions: [conditionName, concept.name],
    },
  };
}

const CONCEPT_GUIDE = `
Trading concept recognition:
- Market structure: higher high (HH), higher low (HL), lower high (LH), lower low (LL), break of structure (BOS), change of character (CHoCH).
- Liquidity: buy-side liquidity, sell-side liquidity, liquidity sweep/grab, equal highs/lows, previous high/low liquidity.
- Support and resistance: support, resistance, break and retest, rejection, previous day/week high and low.
- Supply and demand: supply zones, demand zones, reactions, zone entry/retest.
- Fair value gaps: FVG, bullish/bearish FVG, FVG fill/retest, IFVG.
- Price action: displacement, strong bullish/bearish candles, rejection candles, breakouts, pullbacks, retests.
- Order blocks: bullish/bearish order blocks, order block retest, breaker block.
- Premium/discount: premium, discount, equilibrium, range-based premium/discount.
- Multi-timeframe analysis: higher-timeframe bias, lower-timeframe confirmation, 4H → 1H → 15M → 5M flows, and higher-timeframe levels affecting lower-timeframe entries.
- ICT/SMC: IRL, ERL, SMT divergence, AMD, Power of 3, and session concepts only when the supplied data supports them.
- Moving averages: EMA, SMA, price above/below EMA, EMA crossover, EMA rejection, EMA trend confirmation.
- Risk management: stop loss, take profit, risk/reward, percentage-based SL/TP, position sizing, and maximum risk per trade.

For every strategy draft, identify the concepts used in conceptsUsed as {name, supported, explanation}. The current historical engine can execute only always, bullish, bearish, exact OHLC comparisons, and previous-candle crossings. Treat all other concepts, including EMA/SMA and ICT/SMC concepts, as understood but unsupported unless they are represented by one of those exact rules. Keep unsupported concepts in the draft, mark them unsupported, and explain what engine capability would be needed. Never silently replace an unsupported concept with another rule.
If the user asks to build or create a strategy, always return a non-null strategyDraft. Never respond with only a refusal because one requested concept is unsupported; preserve that concept as an unsupported condition and explain the limitation in reply.
`;

async function contextForRequest(context: AssistantContext, message: string) {
  const result: Record<string, unknown> = { page: context.page || "workspace" };
  result.builderCatalog = await builderCatalog();
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
- For strategy drafts, use only concept names, market symbols, and timeframe codes/labels from builderCatalog. Common aliases such as FVG, BOS, CHoCH, MSS, SMT, HTF, LTF, AMD, OB, and Gold must be mapped to a matching catalog item only when one exists. If no match exists, preserve the requested wording and mark it for review; never invent a library item.
- Recognise both normal-language requests and the structured TRADEX STRATEGY format with NAME, MARKET, DIRECTION, TIMEFRAMES, ENTRY, CONFIRMATION, EXIT, and RISK sections.
- Use only the exact historical rules supported by the Builder: always, bullish, bearish, close > open, close < open, and close crosses above/below a previous OHLC value. Preserve other requested concepts as descriptive unsupported conditions.
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
    "conceptsUsed": [{"name":"string","supported":true,"explanation":"string"}],
    "riskManagementRules": "string or null"
  },
  "backtestSetup": null or {"strategyId": number|null,"versionId":number|null,"instrumentId":number|null,"timeframeId":number|null,"startDate":"ISO string|null","endDate":"ISO string|null"}
}
When proposing a strategy, include a draft even if one requested condition is unsupported; explain that limitation in reply. For result explanations, use only actual numbers from context.
${CONCEPT_GUIDE}

Builder catalog and current workspace context:
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
        max_tokens: 8192,
        reasoning: { effort: "none" },
        response_format: { type: "json_object" },
      }),
    });
    if (!upstream.ok) {
      await upstream.text();
      logger.warn({
        upstreamStatus: upstream.status,
      }, "OpenRouter assistant request was rejected");
      if (upstream.status === 429) {
        return ChatAssistantResponse.parse({ status: "rate_limited", reply: RATE_LIMIT_MESSAGE, provider: OPENROUTER_MODEL, intent: null, strategyDraft: null, compatibility: null, backtestSetup: null });
      }
      if (upstream.status === 502 || upstream.status === 503 || upstream.status === 504) {
        return ChatAssistantResponse.parse({ status: "unavailable", reply: PROVIDER_TEMPORARY_MESSAGE, provider: OPENROUTER_MODEL, intent: null, strategyDraft: null, compatibility: null, backtestSetup: null });
      }
      throw new Error(`OpenRouter request failed with status ${upstream.status}`);
    }
    const payload = await upstream.json() as any;
    const content = typeof payload?.choices?.[0]?.message?.content === "string" ? payload.choices[0].message.content : "";
    const parsed = normalizeModelResponse(parseModelJson(content));
    if (!parsed) throw new Error("OpenRouter returned an invalid assistant response.");
    if (isStrategyDraftRequest(input.message) && !parsed.strategyDraft) {
      const fallbackDraft = fallbackDraftForUnsupportedRequest(input.message, parsed.reply);
      const validatedFallback = validateDraftAgainstCatalog(
        fallbackDraft,
        (context.builderCatalog || { concepts: [], markets: [], timeframes: [] }) as BuilderCatalog,
      );
      parsed.strategyDraft = validatedFallback;
      parsed.intent = "strategy_proposal";
      parsed.compatibility = validatedFallback.compatibility;
    } else if (parsed.strategyDraft) {
      const enrichedDraft = enrichDraftConcepts(parsed.strategyDraft, input.message);
      const validatedDraft = validateDraftAgainstCatalog(
        enrichedDraft,
        (context.builderCatalog || { concepts: [], markets: [], timeframes: [] }) as BuilderCatalog,
      );
      parsed.strategyDraft = validatedDraft;
      parsed.compatibility = validatedDraft.compatibility;
      if (validatedDraft.compatibility.unsupportedConditions.length > enrichedDraft.compatibility.unsupportedConditions.length) {
        parsed.reply = `${parsed.reply}\n\nNeeds review: ${validatedDraft.compatibility.unsupportedConditions.slice(enrichedDraft.compatibility.unsupportedConditions.length).join(" ")}`;
      }
    }
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
      failureType: controller.signal.aborted ? "timeout" : "provider_or_server_error",
    }, "OpenRouter assistant request failed");
    return ChatAssistantResponse.parse({ status: "unavailable", reply: controller.signal.aborted ? TIMEOUT_MESSAGE : UNAVAILABLE_MESSAGE, provider: OPENROUTER_MODEL, intent: null, strategyDraft: null, compatibility: null, backtestSetup: null });
  } finally {
    clearTimeout(timeout);
  }
}