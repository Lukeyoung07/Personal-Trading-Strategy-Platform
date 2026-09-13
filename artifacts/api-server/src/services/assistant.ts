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
import {
  ChatAssistantResponse,
  EXECUTABLE_CONCEPT_DEFINITIONS,
  executableConceptTriggerRules,
  executableConceptKind,
  executableConceptLabel,
  normalizeExecutableParameters,
  resolveTradingConcept,
  TRADING_CONCEPT_REGISTRY,
  normalizeStrategyTimeframe,
  universalValidation,
  type UniversalRiskRule,
  type ChatAssistantBody,
} from "@workspace/api-zod";
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

type RequestedConceptAuthorization = {
  requestedConcept: string;
  canonicalConcept: string;
  matchedText: string;
  supported: boolean;
  explanation: string;
};

type ConditionAuthorization = {
  source: "user_request";
  status: "explicit" | "required_for_concept" | "review_required";
  requestedConcept: string;
  canonicalConcept: string;
  matchedText: string;
};

type DraftAuthorization = {
  originalRequest: string;
  requestedConcepts: Array<{
    requestedConcept: string;
    canonicalConcept: string;
    matchedText: string;
    supported: boolean;
  }>;
};

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
  const descriptor = `${condition?.name || ""} ${condition?.conceptName || ""}`.toLowerCase();
  if (!/\b(?:bullish|bearish)\s+candle\b|\bcandle direction\b/.test(descriptor)) return normalized;
  if (/\bbullish\b/.test(descriptor)) return "bullish";
  if (/\bbearish\b/.test(descriptor)) return "bearish";
  return normalized;
}

function compatibleRiskRules(rules: string | null | undefined) {
  if (!rules?.trim() || !/(?:stop[- ]loss|sl|take[- ]profit|tp|risk[\/ -]?reward|r\s*:\s*r)/i.test(rules)) return true;
  if (/(?:below|above)\s+(?:the\s+)?(?:fvg|fair value gap)|(?:trailing|break even|structural)\s+(?:stop|exit)|structural\s+fvg\s+boundary/i.test(rules)) return false;
  if (/(?:percentage risk|risk per trade|position siz(?:e|ing)|maximum risk|max(?:imum)? risk)/i.test(rules)) return false;
  const hasStopLoss = /(?:stop[- ]loss|sl)\s*[:=]?\s*\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*(?:stop[- ]loss|sl)/i.test(rules);
  const hasTakeProfit = /(?:take[- ]profit|tp)\s*[:=]?\s*\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*(?:take[- ]profit|tp)/i.test(rules);
  const hasRiskReward = /(?:risk[\/ -]?reward|r\s*:\s*r)\s*[:=]?\s*\d+(?:\.\d+)?\s*R\b/i.test(rules);
  return hasStopLoss || hasTakeProfit || (hasRiskReward && hasStopLoss);
}

function riskRule(
  type: UniversalRiskRule["type"],
  value: number | null,
  unit: UniversalRiskRule["unit"],
  executionStatus: UniversalRiskRule["executionStatus"],
  reasons: string[] = [],
  reference: string | null = null,
): UniversalRiskRule {
  return {
    type,
    value,
    unit,
    reference,
    executionStatus,
    validation: universalValidation(executionStatus === "executable", reasons),
  };
}

function parseRiskRules(value: string | null | undefined, requestMessage?: string): UniversalRiskRule[] {
  const text = `${value || ""} ${requestMessage || ""}`.trim();
  if (!text) return [];
  const rules: UniversalRiskRule[] = [];
  const add = (rule: UniversalRiskRule) => {
    const key = `${rule.type}:${rule.value}:${rule.reference || ""}`;
    if (!rules.some(existing => `${existing.type}:${existing.value}:${existing.reference || ""}` === key)) rules.push(rule);
  };
  const percent = (pattern: RegExp, type: UniversalRiskRule["type"]) => {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) add(riskRule(type, value, "percent", "executable"));
    }
  };
  percent(/(?:stop[- ]loss|sl)\s*(?:at|of|[:=])?\s*(\d+(?:\.\d+)?)\s*%/gi, "stop_loss_percentage");
  percent(/(\d+(?:\.\d+)?)\s*%\s*(?:stop[- ]loss|sl)\b/gi, "stop_loss_percentage");
  percent(/(?:take[- ]profit|tp)\s*(?:at|of|[:=])?\s*(\d+(?:\.\d+)?)\s*%/gi, "take_profit_percentage");
  percent(/(\d+(?:\.\d+)?)\s*%\s*(?:take[- ]profit|tp)\b/gi, "take_profit_percentage");
  percent(/(?:risk\s*per\s*trade|percentage\s*risk|risk)\s*[:=]\s*(\d+(?:\.\d+)?)\s*%/gi, "risk_per_trade_percentage");
  const rMultiplePatterns = [
    /(?:take[- ]profit|tp|target)\s*(?:at|of|is|:|=)?\s*(\d+(?:\.\d+)?)\s*R\b/gi,
    /(\d+(?:\.\d+)?)\s*R\s*(?:take[- ]profit|tp|target)\b/gi,
    /(?:risk[\/ -]?reward|r\s*:\s*r)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*R\b/gi,
  ];
  for (const pattern of rMultiplePatterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      if (!Number.isFinite(value)) continue;
      const type = /risk[\/ -]?reward|r\s*:\s*r/i.test(match[0])
        ? "risk_reward_multiple"
        : "take_profit_r_multiple";
      add(riskRule(type, value, "r", "review_required", [
        "An R-multiple target requires a defining stop-loss before it can be executed.",
      ]));
    }
  }
  const structuralMatch = text.match(/\b(?:stop|stop[- ]loss)\s+(?:below|above)\s+(?:the\s+)?(?:fvg|fair value gap)\b/i);
  if (structuralMatch) {
    add(riskRule(
      "structural_stop",
      null,
      "reference",
      "review_required",
      ["Structural stops are preserved for review and are not converted into an invented percentage."],
      "fair_value_gap",
    ));
  }
  const hasExecutableStop = rules.some(rule => rule.type === "stop_loss_percentage");
  return rules.map(rule => {
    if (!["take_profit_r_multiple", "risk_reward_multiple"].includes(rule.type)) return rule;
    if (hasExecutableStop) {
      return {
        ...rule,
        executionStatus: "executable" as const,
        validation: universalValidation(true),
      };
    }
    return {
      ...rule,
      executionStatus: "review_required" as const,
      validation: universalValidation(false, [
        "An R-multiple target requires a defining stop-loss before it can be executed.",
      ]),
    };
  });
}

type UnsupportedConceptDefinition = {
  pattern: RegExp;
  name: string;
  explanation?: string;
};

const UNSUPPORTED_CONCEPTS: UnsupportedConceptDefinition[] = [
  { pattern: /\b(?:bos|break of structure)\b/i, name: "Break of Structure" },
  { pattern: /\b(?:choch|change of character)\b/i, name: "Change of Character" },
  { pattern: /\b(?:mss|market structure shift)\b/i, name: "Market Structure Shift" },
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
  { pattern: /\bbuy[- ]?side liquidity\b|\bbuy[- ]?side\b/i, name: "Buy-Side Liquidity" },
  { pattern: /\bsell[- ]?side liquidity\b|\bsell[- ]?side\b/i, name: "Sell-Side Liquidity" },
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
  { pattern: /\binverse fair value gap\b|\bifvg\b/i, name: "Inverse Fair Value Gap (IFVG)" },
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
  { pattern: /\bbreakout retest\b|\bbreak and retest\b/i, name: "Breakout Retest" },
  { pattern: /\bbullish engulfing\b/i, name: "Bullish Engulfing" },
  { pattern: /\bbearish engulfing\b/i, name: "Bearish Engulfing" },
  { pattern: /\bpin bar\b/i, name: "Pin Bar" },
  { pattern: /\binside bar\b/i, name: "Inside Bar" },
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
  { pattern: /\brsi\b/i, name: "RSI" },
  { pattern: /\bmacd\b/i, name: "MACD" },
  { pattern: /\bvwap\b/i, name: "VWAP" },
  { pattern: /\batr\b|average true range/i, name: "ATR" },
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
  { pattern: /\b(?:new york|ny)\s+(?:session|kill zone)\b/i, name: "New York Session", explanation: "Session timing is catalogued but does not yet have a deterministic historical evaluator." },
  { pattern: /\blondon\s+(?:session|kill zone)\b/i, name: "London Session", explanation: "Session timing is catalogued but does not yet have a deterministic historical evaluator." },
  { pattern: /\b(?:asia|asian)\s+(?:session|kill zone)\b/i, name: "Asian Session", explanation: "Session timing is catalogued but does not yet have a deterministic historical evaluator." },
];

function unsupportedConceptForText(value: string): UnsupportedConceptDefinition | null {
  if (catalogKey(value) === "multi timeframe analysis") return null;
  if (["bullish candle", "bearish candle", "candle direction"].includes(catalogKey(value))) return null;
  if (executableConceptKind(value)) return null;
  const canonical = resolveTradingConcept(value);
  if (canonical) {
    if (canonical.status === "executable") return null;
    return {
      pattern: /$^/,
      name: canonical.name,
      explanation: canonical.statusReason,
    };
  }
  return UNSUPPORTED_CONCEPTS.find(concept => concept.pattern.test(value)) || null;
}

function compatibilityForDraft(draft: any) {
  const conditions = Array.isArray(draft?.conditions) ? draft.conditions : [];
  const nonConditionConcepts = new Set([
    "risk reward",
    "percentage risk",
    "position sizing",
    "maximum risk per trade",
    "stop loss",
    "take profit",
  ]);
  const unsupported: string[] = conditions
    .filter((condition: any) => !["candle direction", "bullish candle", "bearish candle"].includes(catalogKey(String(condition?.conceptName || ""))))
    .filter((condition: any) => condition?.supported !== true || (
      !supportedRule(normalizeConditionRule(condition))
      && !normalizeExecutableParameters(condition?.conceptName, condition?.parameters)
    ) || condition?.executionStatus === "review_required" || condition?.validation?.valid === false)
    .map((condition: any) => String(
      condition?.authorization?.status === "review_required"
        ? condition.authorization.canonicalConcept || condition.authorization.requestedConcept
        : condition?.name || condition?.triggerRules || "Unnamed condition",
    ));
  const unsupportedConcepts = Array.isArray(draft?.conceptsUsed)
    ? draft.conceptsUsed
      .filter((concept: any) => concept && concept.supported === false)
      .filter((concept: any) => !nonConditionConcepts.has(catalogKey(String(concept.name || ""))))
      .filter((concept: any) => !conditions.some((condition: any) => {
        const conditionName = catalogKey(String(condition?.conceptName || ""));
        const conceptName = catalogKey(String(concept.name || ""));
        return conditionName === conceptName || conditionName.includes(conceptName) || conceptName.includes(conditionName);
      }))
      .map((concept: any) => String(concept.name || "Unnamed concept"))
    : [];
  unsupported.push(...unsupportedConcepts);
  if (!conditions.some((condition: any) => condition?.stage === "entry" || condition?.stage === "confirmation")) {
    unsupported.unshift("No entry condition has been added");
  }
  if (!compatibleRiskRules(draft?.riskManagementRules)) unsupported.push("The current risk rules");
  if (Array.isArray(draft?.riskRules)) {
    draft.riskRules
      .filter((rule: any) => rule?.executionStatus === "review_required" || rule?.validation?.valid === false)
      .forEach((rule: any) => unsupported.push(rule?.validation?.reasons?.[0] || "The current risk rules"));
  }
  return { compatible: unsupported.length === 0, unsupportedConditions: [...new Set<string>(unsupported)] };
}

function knownUnsupportedConcept(name: string) {
  return unsupportedConceptForText(name) !== null;
}

function normalizeConcepts(rawConcepts: unknown, conditions: Array<{ conceptName: string; supported: boolean }>, message = "") {
  const concepts = new Map<string, { name: string; supported: boolean; explanation: string }>();
  const requestedKeys = new Set([
    ...conditions.map(condition => catalogKey(canonicalConceptName(condition.conceptName))),
    ...conceptsRequestedInMessage(message).map(concept => catalogKey(canonicalConceptName(concept.name))),
  ]);
  const addConcept = (raw: any, fallbackName?: string) => {
    const rawName = String(typeof raw === "string" ? raw : raw?.name || fallbackName || "").trim().slice(0, 120);
    if (!rawName) return;
    const rawCanonical = canonicalConceptName(rawName);
    const rawKey = catalogKey(rawCanonical);
    const matchesCondition = conditions.some(condition => catalogKey(canonicalConceptName(condition.conceptName)) === rawKey);
    if (!matchesCondition && !requestedKeys.has(rawKey)) return;
    const isMultiTimeframe = catalogKey(rawName) === "multi timeframe analysis";
    const unsupportedConcept = isMultiTimeframe ? null : unsupportedConceptForText(rawName);
    const name = unsupportedConcept?.name || rawCanonical;
    const matchingConditions = conditions.filter(condition =>
      condition.conceptName.toLowerCase() === rawName.toLowerCase() ||
      condition.conceptName.toLowerCase() === name.toLowerCase(),
    );
    const executable = executableConceptKind(rawName) !== null || matchingConditions.some(condition => executableConceptKind(condition.conceptName) !== null);
    const supported = unsupportedConcept
      ? false
      : isMultiTimeframe
        ? true
        : executable
        ? matchingConditions.length === 0 || matchingConditions.every(condition => condition.supported)
      : matchingConditions.length > 0
        ? matchingConditions.every(condition => condition.supported) && raw?.supported !== false
        : false;
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

function isNegatedConceptMention(message: string, index: number) {
  if (index < 0) return false;
  const sentenceStart = Math.max(
    message.lastIndexOf(".", index - 1),
    message.lastIndexOf("!", index - 1),
    message.lastIndexOf("?", index - 1),
  ) + 1;
  const prefix = message.slice(sentenceStart, index);
  return /\b(?:do\s+not|don't|dont|never|without|no)\b[\s\S]{0,160}$/i.test(prefix)
    || /\bnot\s+(?:add|use|infer|include|invent|want|request)\b[\s\S]{0,160}$/i.test(prefix);
}

function escapeConceptPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function canonicalConceptMentions(value: string) {
  return TRADING_CONCEPT_REGISTRY
    .flatMap(definition => [definition.name, ...definition.aliases].map(label => ({ definition, label })))
    .sort((left, right) => right.label.length - left.label.length)
    .flatMap(({ definition, label }) => {
      const pattern = new RegExp(`\\b${escapeConceptPattern(label)}\\b`, "gi");
      return [...value.matchAll(pattern)].map(match => ({
        definition,
        index: match.index ?? 0,
        length: match[0].length,
      }));
    })
    .sort((left, right) => left.index - right.index || right.length - left.length)
    .filter((mention, index, mentions) => !mentions.some((other, otherIndex) =>
      otherIndex < index
      && other.index <= mention.index
      && other.index + other.length >= mention.index + mention.length,
    ));
}

function isNestedConceptMention(message: string, index: number, conceptName: string) {
  if (index < 0) return false;
  const currentDefinition = resolveTradingConcept(conceptName);
  if (currentDefinition && currentDefinition.status !== "executable" && conceptName !== "ATR") return false;
  const sentenceStart = Math.max(
    message.lastIndexOf(".", index - 1),
    message.lastIndexOf("!", index - 1),
    message.lastIndexOf("?", index - 1),
    message.lastIndexOf(";", index - 1),
  ) + 1;
  const before = message.slice(sentenceStart, index);
  const connectorMatch = [...before.matchAll(/(?:\busing\b|\bwith\b|\baround\b|\bnear\b|\bfrom\b|\boff\b|\bbased\s+on\b|\bdefined\s+by\b|\bbelonging\s+to\b|\bparameters?\s+for\b|\bwhere\b|\bthat\s+(?:sweeps?|closes?|forms?|uses?))\b/gi)].at(-1);
  if (!connectorMatch) return false;
  const connectorEnd = (connectorMatch.index ?? 0) + connectorMatch[0].length;
  const nestedText = before.slice(connectorEnd);
  if (/\b\d+(?:\.\d+)?[\s-]*(?:m|min|minute|h|hr|hour|d|day|w|week)s?\b/i.test(nestedText)) return false;
  if (/\b(?:followed\s+by|after|then)\b/i.test(nestedText)) return false;
  const parentMentions = canonicalConceptMentions(before.slice(0, connectorMatch.index ?? 0));
  if (!parentMentions.length) return false;
  const previousMention = canonicalConceptMentions(before).at(-1);
  if (/\b(?:and|then|followed\s+by|plus)\s*$/i.test(before) && currentDefinition && previousMention) {
    if (previousMention.definition.category === currentDefinition.category) return true;
    const levelContextCategories = new Set(["SUPPORT & RESISTANCE", "LIQUIDITY"]);
    return levelContextCategories.has(previousMention.definition.category)
      && levelContextCategories.has(currentDefinition.category);
  }
  return true;
}

function isExecutionInstructionPhrase(value: string) {
  const normalized = value.trim();
  return /\bclosed\s+(?:\d+\s*(?:m|min|minute|h|hr|hour)s?\s+)?(?:candles?|bars?)\b/i.test(normalized)
    || /\b(?:historical\s+backtesting?|backtesting?|backtest|monitoring|builder|build\s+with\s+ai|trading\s+concept\s+library)\b/i.test(normalized)
    || /\b(?:atr|average\s+true\s+range)\b[^.!?]{0,40}\b(?:parameters?|periods?|multiples?|thresholds?)\b/i.test(normalized)
    || /^(?:timeframe|market|direction|entry|confirmation|invalidation|exit|risk management|stop[- ]loss|take[- ]profit|percentage risk|position sizing)\b/i.test(normalized);
}

function conceptsRequestedInMessage(message: string) {
  const requested: Array<{ name: string; supported: boolean; explanation: string; matchedText: string }> = [];
  const seen = new Set<string>();
  for (const concept of UNSUPPORTED_CONCEPTS) {
    if (concept.name === "Retest" && /(?:fvg|fair\s+value\s+gap)[^.!?]{0,60}\bretests?\b/i.test(message)) continue;
    const match = message.match(concept.pattern);
    if (!match || seen.has(concept.name)) continue;
    if (isNegatedConceptMention(message, match.index ?? -1)) continue;
    if (isNestedConceptMention(message, match.index ?? -1, concept.name)) continue;
    const resolvedConcept = resolveTradingConcept(concept.name);
    if (resolvedConcept?.status === "executable") {
      requested.push({
        name: resolvedConcept.name,
        supported: true,
        explanation: "Mapped to the structured historical detector; review its parameters before saving.",
        matchedText: match[0],
      });
      seen.add(concept.name);
      continue;
    }
    const executableKind = executableConceptKind(concept.name);
    if (executableKind) {
       const name = executableConceptLabel(concept.name) || EXECUTABLE_CONCEPT_DEFINITIONS[executableKind].label;
      if (seen.has(name)) continue;
      seen.add(name);
      requested.push({
        name,
        supported: true,
        explanation: "Mapped to the existing structured executable concept definition.",
        matchedText: match[0],
      });
      continue;
    }
    seen.add(concept.name);
    requested.push({
      name: concept.name,
      supported: concept.name === "Multi-timeframe analysis",
      explanation: concept.name === "Multi-timeframe analysis"
        ? "The engine evaluates each executable condition on its configured timeframe and aligns completed candles without look-ahead."
        : concept.explanation || "Understood by the assistant, but not currently executable by historical backtesting.",
      matchedText: match[0],
    });
  }
  if (/\bhigher[- ]timeframe\b|\blower[- ]timeframe\b|\b\d+\s*h\b.*\b\d+\s*m\b|\bmulti[- ]timeframe\b/i.test(message) && !seen.has("Multi-timeframe analysis")) {
    const match = message.match(/\bhigher[- ]timeframe\b|\blower[- ]timeframe\b|\b\d+\s*h\b.*\b\d+\s*m\b|\bmulti[- ]timeframe\b/i);
    requested.push({
      name: "Multi-timeframe analysis",
      supported: true,
      explanation: "The engine evaluates each executable condition on its configured timeframe and aligns completed candles without look-ahead.",
      matchedText: match?.[0] || "multi-timeframe",
    });
  }
  return requested;
}

function requestedExecutableConceptMatches(message: string) {
  const executableMatches = TRADING_CONCEPT_REGISTRY
    .filter(definition => definition.status === "executable")
    .flatMap(definition => [definition.name, ...definition.aliases].map(alias => ({ alias, definition })))
    .sort((left, right) => right.alias.length - left.alias.length)
    .flatMap(({ alias, definition }) => {
      const match = message.match(new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i"));
      if (!match || isNegatedConceptMention(message, match.index ?? -1)) return [];
      if (isNestedConceptMention(message, match.index ?? -1, definition.name)) return [];
      return [{ name: definition.name, matchedText: match[0], canonicalId: definition.canonicalId }];
    })
    .filter((match, index, matches) => matches.findIndex(candidate => candidate.canonicalId === match.canonicalId) === index)
    .filter((match, index, matches) => !matches.some((candidate, candidateIndex) =>
      candidateIndex !== index
      && candidate.matchedText.length > match.matchedText.length
      && candidate.matchedText.toLowerCase().includes(match.matchedText.toLowerCase()),
    ))
    .filter(match => {
      const hasRetest = /\b(?:fvg|fair\s+value\s+gap)\b[^.!?]{0,60}\bretests?\b/i.test(message);
      const hasFill = /\b(?:fvg|fair\s+value\s+gap)\b[^.!?]{0,60}\bfills?\b/i.test(message);
      const hasDirectionalFvg = /\b(?:bullish|bearish)\s+(?:fvg|fair\s+value\s+gap)\b/i.test(message);
      if (hasRetest && ["Fair Value Gap", "Bullish FVG", "Bearish FVG", "FVG Fill"].includes(match.name)) return false;
      if (hasFill && ["Fair Value Gap", "Bullish FVG", "Bearish FVG", "FVG Retest"].includes(match.name)) return false;
      if (hasDirectionalFvg && match.name === "Fair Value Gap") return false;
      if (/\bwick\s+rejection\b/i.test(message) && match.name === "Rejection") return false;
      return !(match.name === "Rejection" && /\bstrong\s+rejection\b/i.test(message));
    });
  const inferredBreakouts = [
    message.match(/(?:(?:price\s+)?(?:(?:must\s+)?close(?:s)?\s+)?)?(?:above|over)\s+(?:the\s+)?previous\s+(?:(?:closed|completed)\s+)?(?:\d+[\s-]*(?:m|min|minute|h|hr|hour)s?\s+)?candle(?:'s)?\s+high/i),
    message.match(/(?:(?:price\s+)?(?:(?:must\s+)?close(?:s)?\s+)?)?(?:below|under)\s+(?:the\s+)?previous\s+(?:(?:closed|completed)\s+)?(?:\d+[\s-]*(?:m|min|minute|h|hr|hour)s?\s+)?candle(?:'s)?\s+low/i),
  ].map((match, index) => match && !isNegatedConceptMention(message, match.index ?? -1)
    ? { name: index === 0 ? "Long Breakout" : "Short Breakout", matchedText: match[0] }
    : null)
    .filter((match): match is { name: string; matchedText: string } => Boolean(match));
  const candleMatch = message.match(/\b(?:bullish|bearish)\s+candle\b|\bcandle\s+(?:direction|strategy)\b/i);
  return [
    ...executableMatches,
    ...inferredBreakouts,
    ...(candleMatch && !isNegatedConceptMention(message, candleMatch.index ?? -1)
      ? [{ name: "Candle Direction", matchedText: candleMatch[0] }]
      : []),
  ];
}

function requestedExecutableConcepts(message: string) {
  const requested: string[] = [];
  for (const { name } of requestedExecutableConceptMatches(message)) if (!requested.includes(name)) requested.push(name);
  return requested;
}

function isMetaInstructionPhrase(value: string) {
  const normalized = value.trim();
  const key = catalogKey(normalized);
  if (!key) return true;
  if (/^(?:do\s+not|don't|dont|never|without|no|not)\b/i.test(normalized)) return true;
  if (/\b(?:concept|concepts)\b/i.test(normalized) && /\b(?:library|registry|supported|existing|already|canonical|another|other|unknown|similar|replacement|requested)\b/i.test(normalized)) {
    return true;
  }
  if (/\b(?:original\s+wording|review[- ]required|backtest(?:ing)?|monitoring|builder|build\s+with\s+ai|placeholder)\b/i.test(normalized)) {
    return true;
  }
  if (/^(?:trading|strategy|market|direction|timeframe|risk(?:\s+rules?)?|supported|existing|canonical|placeholder|unknown|similar|replacement|requested|another|other|these|those|specified|for|during|on|at|in)\b/i.test(normalized)) {
    return true;
  }
  if (/^(?:or|and|the|a|an|any|some)\b/i.test(normalized) && !executableConceptKind(normalized) && !unsupportedConceptForText(normalized)) {
    return true;
  }
  return false;
}

function explicitConceptPhraseMatches(message: string) {
  const matches: string[] = [];
  const add = (value: string, index = -1) => {
    if (isNegatedConceptMention(message, index)) return;
    const cleaned = value
      .replace(/^[\s,;:.-]*(?:a|an|the|my|this)\s+/i, "")
      .replace(/^(?:only|just)\s+/i, "")
      .replace(/^\d+(?:\.\d+)?\s*(?:m|min|minute|h|hr|hour|d|day|w|week)s?\s+/i, "")
      .replace(/\s+(?:strategy|setup|system|process|confirmation|entry|condition|rules?)\s*$/i, "")
      .trim();
    if (!cleaned || cleaned.length < 3 || cleaned.length > 80) return;
    if (/(?:stop[- ]loss|take[- ]profit|risk[\/ -]?reward|r\s*:\s*r|target\s+\d+(?:\.\d+)?\s*R|\d+(?:\.\d+)?\s*R\s*(?:target|take[- ]profit|tp)|percentage\s+risk|risk\s+per\s+trade)/i.test(cleaned)) return;
    if (/^(?:strategy|setup|system|rules?|risk management|long|short|both|directions?|bullish|bearish|bias|main setup|explicit|required|optional|entry|exit|confirmation|invalidation|condition)(?:\s+(?:strategy|setup|system|rules?|directions?|entry|exit|confirmation|invalidation|condition))?$/i.test(cleaned)) return;
    if (isMetaInstructionPhrase(cleaned)) return;
    if (isExecutionInstructionPhrase(cleaned)) return;
    if (canonicalConceptMentions(cleaned).some(mention => mention.definition.status === "executable") && !resolveTradingConcept(cleaned)) return;
    if (!matches.some(existing => existing.toLowerCase() === cleaned.toLowerCase())) matches.push(cleaned);
  };
  for (const match of message.matchAll(/\b(?:concept|condition)\s*:\s*([^\n;]+)/gi)) {
    add(match[1], (match.index ?? 0) + match[0].indexOf(match[1]));
  }
  for (const match of message.matchAll(/\b(?:using|use|with|based on|including|combining with|combined with)\s+([^.!?\n]+)/gi)) {
    for (const phrase of match[1].split(/\s+(?:and|then|followed by|plus|with)\s+|[,;]/i)) {
      const phraseIndex = (match.index ?? 0) + match[0].indexOf(phrase);
      add(phrase, phraseIndex);
    }
  }
  return matches;
}

function requestTimeframeValues(message: string) {
  return [...message.matchAll(/\b\d+(?:\.\d+)?[\s-]*(?:m|min|minute|h|hr|hour|d|day|w|week)s?\b/gi)]
    .map(match => match[0].replace(/[\s-]+/g, "").toUpperCase());
}

function requestedDirection(message: string, fallback: string) {
  if (/\b(?:both|long\s+and\s+short|buy\s+and\s+sell)\b|\bboth\s+directions?\b/i.test(message)) return "both";
  if (/\b(?:short|sell|bearish)\b/i.test(message) && !/\b(?:long|buy|bullish)\b/i.test(message)) return "short";
  if (/\b(?:long|buy|bullish)\b/i.test(message) && !/\b(?:short|sell|bearish)\b/i.test(message)) return "long";
  return ["long", "short", "both"].includes(fallback) ? fallback : "both";
}

function requestedConceptNames(message: string) {
  const nonConditionConcepts = new Set([
    "Multi-timeframe analysis",
    "Risk / Reward",
    "Percentage Risk",
    "Position Sizing",
    "Maximum Risk per Trade",
    "Stop Loss",
    "Take Profit",
  ]);
  const names = [
    ...requestedExecutableConcepts(message),
    ...conceptsRequestedInMessage(message)
      .filter(concept => !nonConditionConcepts.has(concept.name))
      .map(concept => concept.name),
  ];
  const seen = new Set<string>();
  return names.filter(name => {
    const canonical = executableConceptLabel(name) || catalogKey(name);
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    return true;
  });
}

function canonicalConceptName(value: string) {
  const normalized = String(value || "").trim();
  if (["bullish candle", "bearish candle", "candle direction"].includes(catalogKey(normalized))) {
    return "Candle Direction";
  }
  return resolveTradingConcept(normalized)?.name
    || executableConceptLabel(normalized)
    || unsupportedConceptForText(normalized)?.name
    || normalized.replace(/\b\w/g, character => character.toUpperCase());
}

function canonicalExecutableName(value: string) {
  const definition = resolveTradingConcept(value);
  return definition?.status === "executable"
    ? definition.name
    : executableConceptLabel(value) || value;
}

function requestedConceptAuthorizations(message: string): RequestedConceptAuthorization[] {
  const byCanonical = new Map<string, RequestedConceptAuthorization>();
  const add = (requestedConcept: string, matchedText: string, supported: boolean, explanation: string) => {
    if (isExecutionInstructionPhrase(requestedConcept) && !resolveTradingConcept(requestedConcept)) return;
    let canonicalConcept = canonicalConceptName(requestedConcept);
    if (/^(?:bullish|bearish)\s+structure$/i.test(canonicalConcept)) canonicalConcept = "Market Structure Shift";
    const hasFvgInteraction = /\b(?:fvg|fair\s+value\s+gap)\b[^.!?]{0,60}\b(?:retests?|fills?)\b/i.test(message);
    if (canonicalConcept === "Fair Value Gap" && hasFvgInteraction) return;
    if (canonicalConcept === "Kill Zones") {
      if (/\bnew\s+york\s+(?:session\s+)?kill\s+zone\b/i.test(message)) canonicalConcept = "New York Session";
      else if (/\blondon\s+(?:session\s+)?kill\s+zone\b/i.test(message)) canonicalConcept = "London Session";
      else if (/\b(?:asia|asian)\s+(?:session\s+)?kill\s+zone\b/i.test(message)) canonicalConcept = "Asian Session";
    }
    if (!canonicalConcept) return;
    const directionalBreakout = canonicalConcept === "Breakout"
      && /^(?:long|short)\s+breakout$/i.test(requestedConcept.trim());
    const key = `${catalogKey(canonicalConcept)}${directionalBreakout ? `:${catalogKey(requestedConcept)}` : ""}`;
    if (["FVG Retest", "FVG Fill"].includes(canonicalConcept)) {
      byCanonical.delete(catalogKey("Fair Value Gap"));
    }
    const existing = byCanonical.get(key);
    if (existing) {
      if (!existing.matchedText && matchedText) existing.matchedText = matchedText;
      return;
    }
    byCanonical.set(key, {
      requestedConcept,
      canonicalConcept,
      matchedText: matchedText || requestedConcept,
      supported,
      explanation,
    });
  };

  for (const concept of conceptsRequestedInMessage(message)) {
    add(concept.name, concept.matchedText, concept.supported, concept.explanation);
  }
  for (const concept of requestedExecutableConceptMatches(message)) {
    const canonical = canonicalConceptName(concept.name);
    const definition = resolveTradingConcept(canonical);
    add(
      concept.name,
      concept.matchedText,
      definition?.status === "executable",
      definition?.definition || "Mapped to the existing structured executable concept definition.",
    );
  }
  for (const phrase of explicitConceptPhraseMatches(message)) {
    const canonical = canonicalConceptName(phrase);
    add(
      phrase,
      phrase,
      resolveTradingConcept(canonical)?.status === "executable" || Boolean(executableConceptKind(canonical)),
      resolveTradingConcept(canonical)?.definition || "Explicitly requested, but not currently executable by the historical Builder.",
    );
  }
  const fvgVariants = new Set(["Bullish FVG", "Bearish FVG", "FVG Retest", "FVG Fill"]);
  if ([...byCanonical.values()].some(authorization => fvgVariants.has(authorization.canonicalConcept))) {
    byCanonical.delete(catalogKey("Fair Value Gap"));
  }
  if ([...byCanonical.values()].some(authorization => ["FVG Retest", "FVG Fill"].includes(authorization.canonicalConcept))) {
    byCanonical.delete(catalogKey("Bullish FVG"));
    byCanonical.delete(catalogKey("Bearish FVG"));
  }
  const indicatorCross = message.match(/\b(ema|sma)\b[^.!?]{0,24}\bcross(?:es|ing)?\b/i)
    || message.match(/\bcross(?:es|ing)?\b[^.!?]{0,24}\b(ema|sma)\b/i);
  if (indicatorCross) {
    const indicator = (indicatorCross[1] || indicatorCross[2]).toUpperCase();
    add(`${indicator} Cross`, indicatorCross[0], true, "Mapped to the existing structured indicator-cross concept.");
  }
  const directionalBreakoutKeys = [...byCanonical.keys()]
    .filter(key => key.startsWith(`${catalogKey("Breakout")}:`));
  if (directionalBreakoutKeys.length) byCanonical.delete(catalogKey("Breakout"));
  return [...byCanonical.values()]
    .sort((left, right) => {
    const leftIndex = message.toLowerCase().indexOf(left.matchedText.toLowerCase());
    const rightIndex = message.toLowerCase().indexOf(right.matchedText.toLowerCase());
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
}

function conditionAuthorization(
  condition: any,
  authorizations: RequestedConceptAuthorization[],
  forced?: { requestedConcept: string; status: ConditionAuthorization["status"] },
): ConditionAuthorization | null {
  const candidateValues = [condition?.conceptName, condition?.name]
    .map(value => String(value || "").trim())
    .filter(Boolean);
  const match = forced
    ? authorizations.find(authorization => authorization.requestedConcept === forced.requestedConcept)
    : authorizations.find(authorization => candidateValues.some(value =>
      catalogKey(canonicalConceptName(value)) === catalogKey(authorization.canonicalConcept)
      || catalogKey(value) === catalogKey(authorization.requestedConcept),
    ));
  if (!match) return null;
  return {
    source: "user_request",
    status: forced?.status || (match.supported ? "explicit" : "review_required"),
    requestedConcept: match.requestedConcept,
    canonicalConcept: canonicalConceptName(condition?.conceptName || condition?.name || match.canonicalConcept),
    matchedText: match.matchedText,
  };
}

function draftAuthorization(message: string, authorizations = requestedConceptAuthorizations(message)): DraftAuthorization {
  const nonConditionConcepts = new Set([
    "multi timeframe analysis",
    "risk reward",
    "percentage risk",
    "position sizing",
    "maximum risk per trade",
    "stop loss",
    "take profit",
  ]);
  return {
    originalRequest: message,
    requestedConcepts: authorizations
      .filter(authorization => !nonConditionConcepts.has(catalogKey(authorization.canonicalConcept)))
      .map(authorization => ({
      requestedConcept: authorization.requestedConcept,
      canonicalConcept: authorization.canonicalConcept,
      matchedText: authorization.matchedText,
      supported: authorization.supported,
      })),
  };
}

function conditionMatchesConcept(condition: any, requestedName: string) {
  const conditionConceptName = String(condition?.conceptName || "");
  const candidateValues = ["candle direction", "bullish candle", "bearish candle"].includes(catalogKey(conditionConceptName)) || !conditionConceptName
    ? [conditionConceptName, String(condition?.name || "")]
    : [conditionConceptName];
  const requestedKey = catalogKey(canonicalConceptName(requestedName));
  return candidateValues.some(value => {
    const key = catalogKey(
      ["candle direction", "bullish candle", "bearish candle"].includes(catalogKey(value))
        ? "Candle Direction"
        : canonicalConceptName(value),
    );
    return key === requestedKey || (
      Boolean(executableConceptKind(requestedName))
      && key.includes(requestedKey)
    );
  });
}

function requestedTimeframes(message: string) {
  return requestTimeframeValues(message).filter((value, index, values) => values.indexOf(value) === index);
}

function requestedParameters(conceptName: string, message: string, condition: any = {}) {
  const input = {
    ...(condition?.parameters && typeof condition.parameters === "object" ? condition.parameters : {}),
  } as Record<string, unknown>;
  const descriptor = `${message} ${condition?.name || ""} ${condition?.conceptName || ""} ${condition?.triggerRules || ""}`;
  const kind = executableConceptKind(conceptName);
  if (kind === "indicator") {
    const indicator = String((input.indicator || conceptName || "")).toLowerCase();
    const periodPair = descriptor.match(/\b(?:ema|sma|moving\s+average)\s*(\d+)\s*(?:\/|and|&)\s*(\d+)\b|\b(\d+)\s*(?:\/|and|&)\s*(\d+)\s*(?:ema|sma|moving\s+average)\b/i);
    const periodMatch = descriptor.match(/(?:\b(?:ema|exponential\s+moving\s+average|sma|simple\s+moving\s+average|rsi|macd)\s*(?:\(\s*)?(\d+)|\b(\d+)\s*(?:ema|sma|rsi|macd)\b)/i);
    if (periodMatch) input.period = Number(periodMatch[1] || periodMatch[2]);
    if (periodPair) {
      const fastPeriod = Number(periodPair[1] || periodPair[3]);
      const slowPeriod = Number(periodPair[2] || periodPair[4]);
      if (Number.isFinite(fastPeriod) && Number.isFinite(slowPeriod)) {
        input.period = fastPeriod;
        input.fastPeriod = fastPeriod;
        input.slowPeriod = slowPeriod;
      }
    }
    const crossAbove = /\bcross(?:es|ing)?\s+(?:above|over)\b/i.test(descriptor);
    const crossBelow = /\bcross(?:es|ing)?\s+(?:below|under)\b/i.test(descriptor);
    const cross = /\bcross(?:es|ing)?\b|\bcrossover\b|\bcross\b/i.test(descriptor);
    if (crossAbove) input.comparison = "cross_above";
    else if (crossBelow) input.comparison = "cross_below";
    else if (cross) input.comparison = "cross_above";
    else if (/\b(?:rsi|relative\s+strength\s+index)\b[^.!?]{0,40}\b(?:below|under|less\s+than)\s*(\d+(?:\.\d+)?)/i.test(descriptor)) {
      const threshold = descriptor.match(/\b(?:rsi|relative\s+strength\s+index)\b[^.!?]{0,40}\b(?:below|under|less\s+than)\s*(\d+(?:\.\d+)?)/i)?.[1];
      input.comparison = "below";
      if (threshold) input.threshold = Number(threshold);
    } else if (/\b(?:rsi|relative\s+strength\s+index)\b[^.!?]{0,40}\b(?:above|over|greater\s+than)\s*(\d+(?:\.\d+)?)/i.test(descriptor)) {
      const threshold = descriptor.match(/\b(?:rsi|relative\s+strength\s+index)\b[^.!?]{0,40}\b(?:above|over|greater\s+than)\s*(\d+(?:\.\d+)?)/i)?.[1];
      input.comparison = "above";
      if (threshold) input.threshold = Number(threshold);
    }
    if (indicator === "rsi" && input.comparison === "below" && input.threshold == null) input.threshold = 30;
  }
  if (kind === "fair_value_gap") {
    const fvgDescriptor = descriptor.match(/(?:bullish|bearish)?\s*(?:fvg|fair\s+value\s+gap)\b[^.!?]{0,60}/i)?.[0] || "";
    if (/\bretests?\b|\bfill\b/i.test(fvgDescriptor)) input.interaction = "retest";
    if (/\bbullish\b/i.test(fvgDescriptor)) input.polarity = "bullish";
    if (/\bbearish\b/i.test(fvgDescriptor)) input.polarity = "bearish";
  }
  if (kind === "market_structure") {
    if (/\bbullish\b/i.test(descriptor)) input.polarity = "bullish";
    if (/\bbearish\b/i.test(descriptor)) input.polarity = "bearish";
  }
  if (kind === "displacement") {
    if (/\bbullish\b/i.test(descriptor)) input.polarity = "bullish";
    if (/\bbearish\b/i.test(descriptor)) input.polarity = "bearish";
  }
  if (kind === "rejection") {
    if (/\bbullish\b/i.test(descriptor)) input.polarity = "bullish";
    if (/\bbearish\b/i.test(descriptor)) input.polarity = "bearish";
  }
  if (kind === "price_action") {
    const localDescriptor = `${condition?.name || ""} ${condition?.conceptName || ""}`;
    if (/\b(?:long|bullish)\b/i.test(localDescriptor)) input.polarity = "bullish";
    else if (/\b(?:short|bearish)\b/i.test(localDescriptor)) input.polarity = "bearish";
    else if (/\bbullish\b/i.test(descriptor)) input.polarity = "bullish";
    else if (/\bbearish\b/i.test(descriptor)) input.polarity = "bearish";
  }
  if (kind === "failed_breakout") {
    if (/\bbullish\b/i.test(descriptor)) input.polarity = "bullish";
    if (/\bbearish\b/i.test(descriptor)) input.polarity = "bearish";
    if (/\bresistance\b/i.test(descriptor)) input.levelType = "resistance";
    if (/\bsupport\b/i.test(descriptor)) input.levelType = "support";
    const maxBars = descriptor.match(/\b(?:within|in|max(?:imum)?)\s+(\d+)\s+(?:closed\s+)?bars?\b/i)?.[1];
    if (maxBars) input.maxBarsToFailure = Number(maxBars);
    const lookback = descriptor.match(/\b(?:lookback|prior)\s+(\d+)\s+(?:candles?|bars?)\b/i)?.[1];
    if (lookback) input.lookback = Number(lookback);
  }
  if (kind === "session") {
    const times = [...descriptor.matchAll(/\b((?:[01]\d|2[0-3]):[0-5]\d)\b/g)].map(match => match[1]);
    if (times.length >= 2) {
      input.startTime = times[0];
      input.endTime = times[1];
    }
    const timezone = descriptor.match(/\b([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\b/)?.[1];
    if (timezone) input.timezone = timezone;
  }
  return normalizeExecutableParameters(conceptName, input);
}

function relationshipForRequest(message: string, conditionIndex: number): any | undefined {
  if (conditionIndex < 1) return undefined;
  const relationship = /\bfollowed\s+by\b/i.test(message)
    ? "followed_by"
    : /\bafter\b/i.test(message)
      ? "after"
      : /\bwhile\b/i.test(message)
        ? "while"
        : /\bor\b/i.test(message)
          ? "or"
          : /\band\b/i.test(message)
            ? "and"
            : null;
  if (!relationship) return undefined;
  const supported = relationship === "and"
    || (relationship === "followed_by" && /\b(?:displacement|higher[- ]timeframe|multi[- ]timeframe|htf)\b[^.!?]{0,100}\b(?:fvg|fair\s+value\s+gap)\b/i.test(message));
  return {
    type: relationship,
    targetRuleIndex: conditionIndex - 1,
    supported,
    reason: supported ? null : "The current evaluator preserves this relationship for review but does not execute it as a temporal or disjunctive operator.",
  };
}

function universalRuleMetadata(
  condition: any,
  conceptName: string,
  parameters: Record<string, unknown> | null,
  supported: boolean,
  matchedText: string,
  requestMessage: string,
  conditionIndex: number,
) {
  const normalizedRule = normalizeConditionRule(condition);
  const canonicalRuleType = parameters && typeof parameters === "object" && "kind" in parameters
    ? String(parameters.kind)
    : supportedRule(normalizedRule) ? "legacy_expression" : "unsupported";
  const reasons: string[] = [];
  if (!supported) reasons.push("The requested wording does not have a deterministic canonical evaluator.");
  const relationship = relationshipForRequest(requestMessage, conditionIndex);
  const timeframe = normalizeStrategyTimeframe(condition?.timeframe);
  if (condition?.timeframe && condition.timeframe !== "Not specified" && !timeframe) {
    reasons.push(`Timeframe “${String(condition.timeframe)}” could not be normalized without guessing.`);
  }
  const executable = supported && reasons.length === 0;
  return {
    canonicalRuleType,
    executionStatus: executable ? "executable" : "review_required",
    provenance: {
      source: "user_request",
      detectedText: matchedText || String(condition?.conceptName || conceptName),
      requestedConcept: matchedText || null,
      canonicalConcept: conceptName,
    },
    validation: universalValidation(executable, reasons),
    ...(relationship ? { relationship } : {}),
  };
}

function stageForRequestedConcept(conceptName: string, message: string, fallback = "entry") {
  const conceptKey = catalogKey(conceptName);
  const nearby = new RegExp(`(?:${conceptKey.replace(/\s+/g, "\\s+")})[^.!?]{0,50}\\b(confirmation|exit|invalidation)\\b|\\b(confirmation|exit|invalidation)\\b[^.!?]{0,50}(?:${conceptKey.replace(/\s+/g, "\\s+")})`, "i");
  const match = message.match(nearby);
  if (match?.[1] || match?.[2]) return (match[1] || match[2]) === "invalidation" ? "invalidation" : match[1] || match[2];
  return ["entry", "confirmation", "invalidation", "exit"].includes(fallback) ? fallback : "entry";
}

function syntheticRequestedCondition(
  conceptName: string,
  draft: any,
  message: string,
  index: number,
  authorizations: RequestedConceptAuthorization[],
  requestedDirectionOverride?: "long" | "short",
) {
  const parameters = requestedParameters(conceptName, message, requestedDirectionOverride
    ? { direction: requestedDirectionOverride, name: `${conceptName} ${requestedDirectionOverride}` }
    : {});
  const supported = Boolean(parameters);
  const direction = requestedDirectionOverride || requestedDirection(message, draft.direction);
  const condition = {
    name: !supported
      ? canonicalExecutableName(conceptName)
      : parameters?.kind === "fair_value_gap" && parameters.interaction === "retest"
      ? "Fair Value Gap Retest"
      : `${canonicalExecutableName(conceptName)} condition`,
    stage: stageForRequestedConcept(
      conceptName,
      message,
      ["Fair Value Gap", "FVG Retest", "FVG Fill"].includes(conceptName) ? "confirmation" : "entry",
    ),
    requirement: "required",
    conceptName: canonicalExecutableName(conceptName),
    timeframe: requestedTimeframes(message)[index] || requestedTimeframes(message)[0] || "Not specified",
    direction,
    triggerRules: parameters ? executableConceptTriggerRules(parameters) : `${conceptName} requested; review required because it is not executable by the current Builder.`,
    parameters,
    ruleSupported: supported,
    supported,
    authorization: conditionAuthorization({ conceptName }, authorizations),
  };
  return {
    ...condition,
    ...universalRuleMetadata(
      condition,
      condition.conceptName,
      parameters as Record<string, unknown> | null,
      supported,
      condition.authorization?.matchedText || conceptName,
      message,
      index,
    ),
  };
}

function directionalizeCondition(condition: any, direction: string, message: string) {
  const parameters = condition.parameters;
  const isCross = parameters?.kind === "indicator"
    && ["ema", "sma"].includes(parameters.indicator)
    && (String(parameters.comparison).startsWith("cross_") || /\bcross(?:es|ing)?\b/i.test(message));
  if (direction !== "both" || !isCross) {
    return [{ ...condition, direction: direction === "both" ? condition.direction || "both" : direction }];
  }
  return (["long", "short"] as const).map(side => {
    const sideParameters = {
      ...parameters,
      comparison: side === "long" ? "cross_above" : "cross_below",
    };
    return {
      ...condition,
      name: `${condition.name} (${side === "long" ? "Long" : "Short"})`,
      direction: side,
      parameters: sideParameters,
      triggerRules: executableConceptTriggerRules(sideParameters),
      ruleSupported: true,
      supported: true,
    };
  });
}

function directionalBreakoutVariant(requestedConcept: string): "long" | "short" | null {
  const key = catalogKey(requestedConcept);
  if (key === "long breakout") return "long";
  if (key === "short breakout") return "short";
  return null;
}

function reconcileRequestedConditions(draft: any, message: string) {
  const originalConditions = Array.isArray(draft.conditions) ? draft.conditions : [];
  const authorizations = requestedConceptAuthorizations(message);
  const conditionAuthorizations = authorizations
    .filter(authorization => ![
      "multi timeframe analysis",
      "risk reward",
      "percentage risk",
      "position sizing",
      "maximum risk per trade",
      "stop loss",
      "take profit",
    ].includes(catalogKey(authorization.canonicalConcept)))
    .map(authorization => ({
      authorization,
      name: canonicalConceptName(authorization.canonicalConcept),
      direction: directionalBreakoutVariant(authorization.requestedConcept),
    }));
  const hasDirectionalBreakout = conditionAuthorizations.some(candidate =>
    candidate.name === "Breakout" && candidate.direction !== null,
  );
  const hasSpecificFvg = conditionAuthorizations.some(candidate =>
    ["Bullish FVG", "Bearish FVG", "FVG Retest", "FVG Fill"].includes(candidate.name),
  );
  let requested = conditionAuthorizations.filter(candidate =>
    !(hasDirectionalBreakout && candidate.name === "Breakout" && candidate.direction === null)
    && !(hasSpecificFvg && candidate.name === "Fair Value Gap"),
  );
  const requestedIndicatorCross = requested.find(candidate => ["EMA Cross", "SMA Cross"].includes(candidate.name));
  if (requestedIndicatorCross) {
    const baseIndicator = requestedIndicatorCross.name.startsWith("EMA") ? "EMA" : "SMA";
    const existingBaseConditions = originalConditions.filter((condition: any) =>
      canonicalConceptName(String(condition?.conceptName || "")) === baseIndicator,
    );
    if (existingBaseConditions.length > 1) {
      requested = requested.filter(candidate => candidate.name !== requestedIndicatorCross.name);
    } else if (
      existingBaseConditions.length === 0
      && originalConditions.some((condition: any) => canonicalConceptName(String(condition?.conceptName || "")) === requestedIndicatorCross.name)
    ) {
      requested = requested.filter(candidate => candidate.name !== baseIndicator);
    }
  }
  if (!requested.length) return [];
  const timeframes = requestedTimeframes(message);
  const direction = requestedDirection(message, draft.direction);
  const matched = requested.flatMap((requestedConcept, requestedIndex) => {
    const matching = originalConditions.filter((condition: any) => conditionMatchesConcept(condition, requestedConcept.name));
    if (!matching.length) {
      return [syntheticRequestedCondition(
        requestedConcept.name,
        draft,
        message,
        requestedIndex,
        authorizations,
        requestedConcept.direction || undefined,
      )];
    }
    return matching.map((condition: any) => {
      const exactRequested = requested.find(candidate =>
        catalogKey(canonicalConceptName(condition.conceptName || "")) === catalogKey(candidate.name)
        && (!candidate.direction || candidate.direction === condition.direction),
      );
      const matchedRequested = exactRequested || requested.find(candidate =>
        conditionMatchesConcept(condition, candidate.name)
        && (!candidate.direction || candidate.direction === condition.direction),
      ) || requested.find(candidate => conditionMatchesConcept(condition, candidate.name)) || requestedConcept;
      const matchedRequestedName = matchedRequested.name;
      const sourceConceptName = matchedRequestedName;
      const conceptName = canonicalExecutableName(sourceConceptName);
      const parameters = requestedParameters(conceptName, message, condition);
      const conditionTimeframe = timeframes.find(value => catalogKey(value) === catalogKey(String(condition.timeframe || "")))
        || (timeframes.length === 1 ? timeframes[0] : condition.timeframe)
        || timeframes[requestedIndex]
        || "Not specified";
      const nextCondition = {
        ...condition,
        conceptName,
        timeframe: conditionTimeframe,
        direction: matchedRequested.direction || (direction === "both" ? condition.direction || "both" : direction),
        parameters,
        triggerRules: parameters ? executableConceptTriggerRules(parameters) : condition.triggerRules,
        ruleSupported: condition.ruleSupported === true || Boolean(parameters),
        supported: Boolean(parameters) || condition.supported === true,
        authorization: conditionAuthorization(
          { ...condition, conceptName },
          authorizations,
          {
            requestedConcept: matchedRequested.authorization.requestedConcept,
            status: matchedRequested.authorization.supported ? "explicit" : "review_required",
          },
        ),
      };
      return {
        ...nextCondition,
        ...universalRuleMetadata(
          nextCondition,
          conceptName,
          parameters as Record<string, unknown> | null,
          Boolean(parameters) || nextCondition.supported === true,
          nextCondition.authorization?.matchedText || conceptName,
          message,
          requestedIndex,
        ),
      };
    });
  });
  const seen = new Set<string>();
  return matched
    .flatMap(condition => directionalizeCondition(condition, direction, message))
     .filter(condition => {
      const key = JSON.stringify([
        condition.conceptName,
        condition.stage,
        condition.timeframe,
        condition.direction,
        condition.parameters || null,
      ]);
      if (seen.has(key)) return false;
      seen.add(key);
       return true;
    });
}

function addMissingRequestedExecutableConditions(draft: any, message: string) {
  return { ...draft, conditions: reconcileRequestedConditions(draft, message) };
}

function enrichDraftConcepts(draft: any, message: string) {
  const conceptsUsed = normalizeConcepts([
    ...(Array.isArray(draft.conceptsUsed) ? draft.conceptsUsed : []),
    ...conceptsRequestedInMessage(message),
  ], draft.conditions || [], message);
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

function matchCatalogConcept(value: string, catalog: BuilderCatalog): string | null {
  const key = catalogKey(value);
  if (!key) return null;
  if (key === "candle direction") return "Candle Direction";
  const canonical = resolveTradingConcept(value)?.name;
  if (canonical) {
    const canonicalMatch = catalog.concepts.find(concept => catalogKey(concept.name) === catalogKey(canonical));
    if (canonicalMatch) return canonicalMatch.name;
  }
  const exact = catalog.concepts.find(concept => catalogKey(concept.name) === key);
  if (exact) return exact.name;
  const contained = catalog.concepts.find(concept => {
    const conceptKey = catalogKey(concept.name);
    return conceptKey.length > 5 && (key.includes(conceptKey) || conceptKey.includes(key));
  });
  return contained?.name || null;
}

function matchCatalogTimeframe(value: string, catalog: BuilderCatalog): string | null {
  const key = catalogKey(value).replace(/\b(minutes?|mins?)\b/g, "m").replace(/\bhours?\b/g, "h").replace(/\bdays?\b/g, "d");
  if (!key) return null;
  const normalized = normalizeStrategyTimeframe(value);
  if (normalized) {
    const normalizedMatch = catalog.timeframes.find(timeframe => normalizeStrategyTimeframe(timeframe) === normalized);
    if (normalizedMatch) return normalizedMatch;
  }
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

function normalizeRiskRules(value: string | null | undefined, requestMessage?: string) {
  const normalized = value?.trim()
    ? value
    .replace(/risk\s*per\s*trade\s*[:=]\s*(\d+(?:\.\d+)?)\s*%/gi, "risk: $1%")
    .replace(/risk\s*\/\s*reward\s*[:=]\s*(\d+(?:\.\d+)?)\s*:\s*1/gi, "risk/reward: $1R")
    .replace(/risk\s*reward\s*[:=]\s*(\d+(?:\.\d+)?)\s*:\s*1/gi, "risk/reward: $1R")
    .replace(/(?:take[- ]profit|tp)\s*(?:at|of|[:=])?\s*(\d+(?:\.\d+)?)\s*R\b/gi, "risk/reward: $1R")
    .replace(/(\d+(?:\.\d+)?)\s*R\s*(?:take[- ]profit|tp)\b/gi, "risk/reward: $1R")
    .replace(/\btarget\s+(\d+(?:\.\d+)?)\s*R\b/gi, "risk/reward: $1R")
    .slice(0, 400)
    : null;
  if (requestMessage == null) return normalized;

  if (/\b(?:do\s*not|don't|dont|without|no|never)\b[^.!?]{0,50}\b(?:risk|stop[- ]loss|take[- ]profit|trailing|position sizing|risk\/?reward)\b/i.test(requestMessage)) {
    return null;
  }
  const requestedRules: string[] = [];
  const addMatch = (pattern: RegExp, formatter: (value: string) => string) => {
    const match = requestMessage.match(pattern);
    if (match?.[1]) requestedRules.push(formatter(match[1]));
  };
  addMatch(/(?:risk\s*per\s*trade|percentage\s*risk|risk)\s*[:=]\s*(\d+(?:\.\d+)?)\s*%/i, value => `risk: ${value}%`);
  addMatch(/(?:risk\s*\/\s*reward|risk\s*reward|r\s*:\s*r)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*:\s*1/i, value => `risk/reward: ${value}R`);
  addMatch(/(?:take[- ]profit|tp)\s*(?:at|of|[:=])?\s*(\d+(?:\.\d+)?)\s*R\b/i, value => `risk/reward: ${value}R`);
  addMatch(/(\d+(?:\.\d+)?)\s*R\s*(?:take[- ]profit|tp)\b/i, value => `risk/reward: ${value}R`);
  addMatch(/\btarget\s+(\d+(?:\.\d+)?)\s*R\b/i, value => `risk/reward: ${value}R`);
  addMatch(/(?:stop[- ]loss|sl)\s*[:=]\s*(\d+(?:\.\d+)?)\s*%/i, value => `stop-loss: ${value}%`);
  addMatch(/(\d+(?:\.\d+)?)\s*%\s*(?:stop[- ]loss|sl)\b/i, value => `stop-loss: ${value}%`);
  addMatch(/(?:take[- ]profit|tp)\s*[:=]\s*(\d+(?:\.\d+)?)\s*%/i, value => `take-profit: ${value}%`);
  addMatch(/(\d+(?:\.\d+)?)\s*%\s*(?:take[- ]profit|tp)\b/i, value => `take-profit: ${value}%`);
  if (/\b(?:stop|stop[- ]loss)\s+(?:below|above)\s+(?:the\s+)?(?:fvg|fair value gap)\b/i.test(requestMessage)) {
    requestedRules.push("stop-loss: structural FVG boundary (review required)");
  }
  if (requestedRules.length) return [...new Set(requestedRules)].join("; ");
  return null;
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

function validateDraftAgainstCatalog(draft: any, catalog: BuilderCatalog, requestMessage?: string) {
  if (!draft) return draft;
  const requestAuthorizations = requestMessage ? requestedConceptAuthorizations(requestMessage) : [];
  const requestedDraft = requestMessage
    ? addMissingRequestedExecutableConditions(draft, requestMessage)
    : draft;
  const warnings: string[] = [];
  const mappedConditions = requestedDraft.conditions || [];
  const conditions = mappedConditions.map((condition: any, conditionIndex: number) => {
    const conceptName = matchCatalogConcept(String(condition.conceptName || ""), catalog);
    const timeframe = matchCatalogTimeframe(String(condition.timeframe || ""), catalog);
    if (!conceptName && catalogKey(String(condition.conceptName || "")) !== "candle direction") {
      warnings.push(`Concept “${String(condition.conceptName || "Unnamed concept")}” is not in the Trading Concept Library.`);
    }
    if (condition.timeframe && condition.timeframe !== "Not specified" && !timeframe) warnings.push(`Timeframe “${String(condition.timeframe)}” is not in the active Builder timeframes.`);
    const recomputedAuthorization = requestMessage
      ? conditionAuthorization({ ...condition, conceptName: conceptName || condition.conceptName }, requestAuthorizations)
      : null;
    const existingAuthorization = condition?.authorization;
    const preservedAuthorization = existingAuthorization?.source === "user_request"
      && typeof existingAuthorization.requestedConcept === "string"
      && typeof existingAuthorization.matchedText === "string"
      && requestAuthorizations.some(authorization =>
        authorization.requestedConcept === existingAuthorization.requestedConcept
        && authorization.matchedText === existingAuthorization.matchedText,
      )
      ? existingAuthorization
      : null;
    const nextCondition = {
      ...condition,
      conceptName: conceptName || String(condition.conceptName || "Unmapped concept").slice(0, 160),
      timeframe: timeframe || String(condition.timeframe || "Not specified").slice(0, 40),
      direction: ["long", "short", "both"].includes(condition.direction) ? condition.direction : draft.direction,
      parameters: normalizeExecutableParameters(conceptName, condition.parameters),
      ruleSupported: condition.ruleSupported === true || Boolean(normalizeExecutableParameters(conceptName, condition.parameters)),
      supported: Boolean(conceptName) && (
        condition.supported === true
        || Boolean(normalizeExecutableParameters(conceptName, condition.parameters))
      ),
      authorization: recomputedAuthorization || preservedAuthorization,
    };
    return {
      ...nextCondition,
      ...universalRuleMetadata(
        nextCondition,
        nextCondition.conceptName,
        nextCondition.parameters as Record<string, unknown> | null,
        nextCondition.supported === true,
        nextCondition.authorization?.matchedText || nextCondition.conceptName,
        requestMessage || "",
        conditionIndex,
      ),
    };
  }).filter((condition: any) => {
    if (requestMessage && !condition.authorization) return false;
    if (requestMessage && !/(?:\bexit\b|\binvalidation\b|\bclose\b|\bstop[- ]loss\b|\btake[- ]profit\b|\btarget\b|\btp\b|\bsl\b)/i.test(requestMessage)) {
      return condition.stage !== "exit" && condition.stage !== "invalidation";
    }
    return true;
  });
  const requestedMarket = requestMessage?.match(/\b(?:XAUUSD|USTEC|US30|NAS100|SPX500|EURUSD|GBPUSD|USDJPY|BTCUSD|ETHUSD|gold|spot\s+gold|nasdaq)\b/i)?.[0] || null;
  const marketSymbol = matchCatalogMarket(draft.marketSymbol || requestedMarket, catalog);
  if (draft.marketSymbol && !marketSymbol) warnings.push(`Market “${String(draft.marketSymbol)}” is not in the active market catalog.`);
  if (!String(draft.name || "").trim()) warnings.push("Strategy name needs review.");
  if (!["long", "short", "both"].includes(draft.direction)) warnings.push("Strategy direction needs review.");
  const retainedConcepts = [
    ...requestAuthorizations
      .filter(authorization => authorization.canonicalConcept !== "")
      .map(authorization => {
        const modelConcept = Array.isArray(draft.conceptsUsed)
          ? draft.conceptsUsed.find((concept: any) => {
            const name = String(typeof concept === "string" ? concept : concept?.name || "");
            const modelDefinition = resolveTradingConcept(name);
            const authorizationDefinition = resolveTradingConcept(authorization.canonicalConcept);
            return catalogKey(canonicalConceptName(name)) === catalogKey(authorization.canonicalConcept)
              || Boolean(modelDefinition?.executorKind && modelDefinition.executorKind === authorizationDefinition?.executorKind);
          })
          : null;
        return {
          name: authorization.canonicalConcept,
          supported: authorization.supported,
          explanation: typeof modelConcept === "object" && modelConcept?.explanation
            ? String(modelConcept.explanation)
            : conditions.length
              ? authorization.supported
                ? "Mapped to the existing structured executable concept definition."
                : authorization.explanation
              : authorization.supported
                ? "Mapped to the structured historical detector; review its parameters before saving."
                : authorization.explanation,
        };
      }),
    ...conditions.map((condition: any) => ({
      name: condition.conceptName,
      supported: condition.supported === true,
      explanation: condition.supported === true
          ? executableConceptKind(condition.conceptName) !== null
            ? "Mapped to the existing structured executable concept definition."
            : "Represented by the current historical rule set."
        : "Explicitly requested and preserved for review.",
    })),
    ...requestAuthorizations
      .filter(authorization => catalogKey(authorization.canonicalConcept) === "multi timeframe analysis")
      .map(authorization => ({
        name: authorization.canonicalConcept,
        supported: authorization.supported,
        explanation: authorization.explanation,
      })),
  ];
  const conceptsUsed = normalizeConcepts(retainedConcepts, conditions, requestMessage || "");
  const requestedFrameValues = requestMessage ? requestedTimeframes(requestMessage) : [];
  const timeframes = (requestedFrameValues.length
    ? requestedFrameValues
    : Array.isArray(draft.timeframes)
      ? draft.timeframes
      : [])
    .map((timeframe: string) => matchCatalogTimeframe(String(timeframe), catalog) || String(timeframe).slice(0, 40))
    .filter(Boolean)
    .slice(0, 8);
  const next = {
    ...requestedDraft,
    marketSymbol,
    timeframes,
    conditions,
    conceptsUsed,
    authorization: draftAuthorization(requestMessage || "", requestAuthorizations),
    riskManagementRules: normalizeRiskRules(draft.riskManagementRules, requestMessage),
    riskRules: parseRiskRules(normalizeRiskRules(draft.riskManagementRules, requestMessage), requestMessage),
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

function normalizeModelResponse(model: any, requestMessage = ""): any {
  if (!model || typeof model.reply !== "string" || !model.reply.trim()) return null;
  const draft = model.strategyDraft && typeof model.strategyDraft === "object" ? model.strategyDraft : null;
  const requestAuthorizations = requestedConceptAuthorizations(requestMessage);
  const conditions = draft && Array.isArray(draft.conditions) ? draft.conditions.map((condition: any, conditionIndex: number) => {
    const normalizedRule = normalizeConditionRule(condition);
    const rawConceptName = String(condition?.conceptName || "Assistant draft").slice(0, 160);
    const unsupportedConcept = unsupportedConceptForText(rawConceptName);
    const ruleIsSupported = supportedRule(normalizedRule);
    const executableInput = condition?.parameters || (
      executableConceptKind(rawConceptName) === "fair_value_gap"
      && /(?:retest|fill)/i.test(`${condition?.name || ""} ${condition?.triggerRules || ""}`)
        ? { interaction: "retest" }
        : null
    );
    const parameters = normalizeExecutableParameters(rawConceptName, executableInput);
    const nextCondition = {
      name: String(condition?.name || "Assistant condition").slice(0, 160),
      stage: ["entry", "confirmation", "invalidation", "exit"].includes(condition?.stage) ? condition.stage : "entry",
      requirement: condition?.requirement === "optional" ? "optional" : "required",
       conceptName: executableConceptKind(rawConceptName) ? rawConceptName : unsupportedConcept?.name || (ruleIsSupported && /(?:bullish|bearish|close|open)/i.test(`${condition?.triggerRules || ""} ${condition?.conceptName || ""}`)
        ? "Candle Direction"
        : rawConceptName),
      timeframe: String(condition?.timeframe || "Not specified").slice(0, 40),
      direction: ["long", "short", "both"].includes(condition?.direction)
        ? condition.direction
        : (draft.direction === "long" || draft.direction === "short" || draft.direction === "both" ? draft.direction : "both"),
       triggerRules: parameters ? executableConceptTriggerRules(parameters) : normalizedRule.slice(0, 400),
      parameters,
      ruleSupported: ruleIsSupported || Boolean(parameters),
      supported: (ruleIsSupported || Boolean(parameters)) && !unsupportedConcept,
      authorization: conditionAuthorization(condition, requestAuthorizations) || {
        source: "user_request",
        status: "review_required",
        requestedConcept: "",
        canonicalConcept: canonicalConceptName(rawConceptName),
        matchedText: "",
      },
    };
    return {
      ...nextCondition,
      ...universalRuleMetadata(
        nextCondition,
        nextCondition.conceptName,
        parameters as Record<string, unknown> | null,
        nextCondition.supported,
        nextCondition.authorization.matchedText,
        requestMessage,
        conditionIndex,
      ),
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
    riskRules: parseRiskRules(draft.riskManagementRules, requestMessage),
    authorization: draftAuthorization(requestMessage, requestAuthorizations),
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
  const executable = [
    { pattern: /\bliquidity\s+sweep\b/i, name: "Liquidity Sweep" },
    { pattern: /\b(?:bullish|bearish)\s+fvg\b|\bfair\s+value\s+gap\b|\bfvg\b/i, name: "Fair Value Gap" },
  ].find(concept => concept.pattern.test(message));
  if (executable) return { name: executable.name, pattern: executable.pattern };
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
  const parameters = normalizeExecutableParameters(concept.name, null);
  const executable = Boolean(parameters);
  const explanation = executable
    ? "Mapped to the structured historical detector; review its parameters before saving."
    : "Understood by the assistant, but not currently executable by historical backtesting.";
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
       triggerRules: executable ? `${concept.name} structured detector` : `${concept.name} requested; unsupported for historical execution.`,
       parameters,
       ruleSupported: executable,
       supported: executable,
    }],
    conceptsUsed: [{
      name: concept.name,
       supported: executable,
      explanation,
    }],
    riskManagementRules: null,
    authorization: draftAuthorization(message),
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
- Multi-timeframe analysis: executable conditions may use different configured timeframes, including higher-timeframe conditions combined with lower-timeframe entries. Historical evaluation uses only candles that had closed at each lower-timeframe decision point.
- ICT/SMC: IRL, ERL, SMT divergence, AMD, Power of 3, and session concepts only when the supplied data supports them.
- Moving averages: EMA, SMA, price above/below EMA, EMA crossover, EMA rejection, EMA trend confirmation.
- Risk management: stop loss, take profit, risk/reward, percentage-based SL/TP, position sizing, and maximum risk per trade.

For every strategy draft, identify the concepts used in conceptsUsed as {name, supported, explanation}. The historical engine can execute the canonical structured OHLC concepts supplied by the Builder, and it can combine executable conditions across different configured timeframes without look-ahead. Keep subjective or unsupported concepts in the draft, mark them unsupported, and explain what engine capability would be needed. Never silently replace an unsupported concept with another rule.
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
- Historical Backtesting supports exact OHLC rules plus structured Liquidity Sweep and Fair Value Gap conditions. Liquidity Sweep uses a prior candle or prior lookback extreme and requires a close back inside the level. Fair Value Gap uses the three-candle gap and supports formation or a bounded retest. If a requested condition cannot be represented exactly, identify it as unsupported.
- Strategy directions must be exactly long, short, or both. Conditions must use the existing model fields.
- For strategy drafts, use only concept names, market symbols, and timeframe codes/labels from builderCatalog. Common aliases such as FVG, BOS, CHoCH, MSS, SMT, HTF, LTF, AMD, OB, and Gold must be mapped to a matching catalog item only when one exists. If no match exists, preserve the requested wording and mark it for review; never invent a library item.
- Recognise both normal-language requests and the structured TRADEX STRATEGY format with NAME, MARKET, DIRECTION, TIMEFRAMES, ENTRY, CONFIRMATION, EXIT, and RISK sections.
- Use exact supported rules or structured parameters for Liquidity Sweep and Fair Value Gap. Do not turn a concept into a bullish/bearish candle rule.
- Only infer bullish or bearish from an explicit Bullish Candle, Bearish Candle, or Candle Direction descriptor. Never convert an FVG, liquidity, structure, indicator, or other concept description into a candle rule.
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
  "conditions": [{"name":"string","stage":"entry|confirmation|invalidation|exit","requirement":"required|optional","conceptName":"string","timeframe":"string","direction":"long|short|both","triggerRules":"exact supported rule or descriptive unsupported rule","parameters":null}],
    "conceptsUsed": [{"name":"string","supported":true,"explanation":"string"}],
  "riskManagementRules": "string or null"
  },
  "backtestSetup": null or {"strategyId": number|null,"versionId":number|null,"instrumentId":number|null,"timeframeId":number|null,"startDate":"ISO string|null","endDate":"ISO string|null"}
}
  When proposing a strategy, include a draft even if one requested condition is unsupported; explain that limitation in reply. Keep unsupported concepts as named conditions, but distinguish that from whether the triggerRules value is one of the supported historical rules. Do not add exit conditions, stop loss, take profit, risk values, or indicator parameters unless the user explicitly requested them. For each condition, preserve an explicitly requested direction; otherwise use the strategy direction. Treat model suggestions as non-authoritative: only concepts present in the user's latest request may become conditions. The server will attach the authorization trace, so do not invent authorization data. For result explanations, use only actual numbers from context.
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
    const parsed = normalizeModelResponse(parseModelJson(content), input.message);
    if (!parsed) throw new Error("OpenRouter returned an invalid assistant response.");
    if (isStrategyDraftRequest(input.message) && !parsed.strategyDraft) {
      const fallbackDraft = fallbackDraftForUnsupportedRequest(input.message, parsed.reply);
      const validatedFallback = validateDraftAgainstCatalog(
        fallbackDraft,
        (context.builderCatalog || { concepts: [], markets: [], timeframes: [] }) as BuilderCatalog,
        input.message,
      );
      const finalFallback = validateDraftAgainstCatalog(
        validatedFallback,
        (context.builderCatalog || { concepts: [], markets: [], timeframes: [] }) as BuilderCatalog,
        input.message,
      );
      parsed.strategyDraft = finalFallback;
      parsed.intent = "strategy_proposal";
      parsed.compatibility = finalFallback.compatibility;
    } else if (parsed.strategyDraft) {
      const enrichedDraft = enrichDraftConcepts(parsed.strategyDraft, input.message);
      const validatedDraft = validateDraftAgainstCatalog(
        enrichedDraft,
        (context.builderCatalog || { concepts: [], markets: [], timeframes: [] }) as BuilderCatalog,
        input.message,
      );
      const finalDraft = validateDraftAgainstCatalog(
        validatedDraft,
        (context.builderCatalog || { concepts: [], markets: [], timeframes: [] }) as BuilderCatalog,
        input.message,
      );
      parsed.strategyDraft = finalDraft;
      parsed.compatibility = finalDraft.compatibility;
      if (finalDraft.compatibility.unsupportedConditions.length > enrichedDraft.compatibility.unsupportedConditions.length) {
        parsed.reply = `${parsed.reply}\n\nNeeds review: ${finalDraft.compatibility.unsupportedConditions.slice(enrichedDraft.compatibility.unsupportedConditions.length).join(" ")}`;
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