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
  EXECUTABLE_CONCEPT_REQUEST_ALIASES,
  executableConceptTriggerRules,
  executableConceptKind,
  executableConceptLabel,
  normalizeExecutableParameters,
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
  if (executableConceptKind(value)) return null;
  return UNSUPPORTED_CONCEPTS.find(concept => concept.pattern.test(value)) || null;
}

function compatibilityForDraft(draft: any) {
  const conditions = Array.isArray(draft?.conditions) ? draft.conditions : [];
  const unsupported: string[] = conditions
    .filter((condition: any) => condition?.supported !== true || (
      !supportedRule(normalizeConditionRule(condition))
      && !normalizeExecutableParameters(condition?.conceptName, condition?.parameters)
    ))
    .map((condition: any) => String(
      condition?.authorization?.status === "review_required"
        ? condition.authorization.canonicalConcept || condition.authorization.requestedConcept
        : condition?.name || condition?.triggerRules || "Unnamed condition",
    ));
  const unsupportedConcepts = Array.isArray(draft?.conceptsUsed)
    ? draft.conceptsUsed
      .filter((concept: any) => concept && concept.supported === false)
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
    const isMultiTimeframe = catalogKey(rawName) === "multi timeframe analysis";
    const isMappedHtfBias = catalogKey(rawName) === "higher timeframe bias"
      && conditions.some((condition: any) =>
        executableConceptKind(condition?.conceptName) === "market_structure"
        && /\b(?:htf|higher[- ]timeframe|bias|structure)\b/i.test(`${condition?.name || ""} ${condition?.timeframe || ""}`),
      );
    const unsupportedConcept = isMultiTimeframe || isMappedHtfBias ? null : unsupportedConceptForText(rawName);
    const name = isMappedHtfBias ? "Market Structure Shift" : unsupportedConcept?.name || executableConceptLabel(rawName) || rawName;
    const matchingConditions = conditions.filter(condition =>
      condition.conceptName.toLowerCase() === rawName.toLowerCase() ||
      condition.conceptName.toLowerCase() === name.toLowerCase(),
    );
    const executable = executableConceptKind(rawName) !== null || matchingConditions.some(condition => executableConceptKind(condition.conceptName) !== null);
    const supported = unsupportedConcept
      ? false
      : isMultiTimeframe || isMappedHtfBias
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

function conceptsRequestedInMessage(message: string) {
  const requested: Array<{ name: string; supported: boolean; explanation: string; matchedText: string }> = [];
  const seen = new Set<string>();
  for (const concept of UNSUPPORTED_CONCEPTS) {
    if (concept.name === "Retest" && /(?:fvg|fair\s+value\s+gap)[^.!?]{0,60}\bretests?\b/i.test(message)) continue;
    const match = message.match(concept.pattern);
    if (!match || seen.has(concept.name)) continue;
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
  const executableMatches = [...EXECUTABLE_CONCEPT_REQUEST_ALIASES]
    .sort((left, right) => right.length - left.length)
    .flatMap(alias => {
      const match = message.match(new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i"));
      if (!match) return [];
      return [{ name: executableConceptLabel(alias) || alias, matchedText: match[0] }];
    })
    .filter(match => !(match.name === "Rejection" && /\bstrong\s+rejection\b/i.test(message)));
  const candleMatch = message.match(/\b(?:bullish|bearish)\s+candle\b|\bcandle\s+(?:direction|strategy)\b/i);
  return candleMatch
    ? [...executableMatches, { name: "Candle Direction", matchedText: candleMatch[0] }]
    : executableMatches;
}

function requestedExecutableConcepts(message: string) {
  const requested: string[] = [];
  for (const { name } of requestedExecutableConceptMatches(message)) if (!requested.includes(name)) requested.push(name);
  return requested;
}

function explicitConceptPhraseMatches(message: string) {
  const matches: string[] = [];
  const add = (value: string) => {
    const cleaned = value
      .replace(/^[\s,;:.-]*(?:a|an|the|my|this)\s+/i, "")
      .replace(/^\d+(?:\.\d+)?\s*(?:m|min|minute|h|hr|hour|d|day|w|week)s?\s+/i, "")
      .replace(/\s+(?:strategy|setup|system|process|confirmation|entry|condition|rules?)\s*$/i, "")
      .trim();
    if (!cleaned || cleaned.length < 3 || cleaned.length > 80) return;
    if (/^(?:strategy|setup|system|rules?|risk management|long|short|both|directions?|bullish|bearish|explicit|required|optional|entry|exit|confirmation|invalidation|condition)(?:\s+(?:strategy|setup|system|rules?|directions?|entry|exit|confirmation|invalidation|condition))?$/i.test(cleaned)) return;
    if (!matches.some(existing => existing.toLowerCase() === cleaned.toLowerCase())) matches.push(cleaned);
  };
  for (const match of message.matchAll(/\b(?:concept|condition)\s*:\s*([^\n;]+)/gi)) add(match[1]);
  for (const match of message.matchAll(/\b(?:using|with|based on|including|combining with|combined with)\s+([^.!?\n]+)/gi)) {
    for (const phrase of match[1].split(/\s+(?:and|then|followed by|plus|with)\s+|[,;]/i)) add(phrase);
  }
  return matches;
}

function exactHtfBiasRetestRequest(message: string) {
  const hasBothBiasDirections = /\b(?:higher[- ]timeframe|htf)\b[^.!?]{0,50}\bbullish\b[^.!?]{0,50}\bbearish\b[^.!?]{0,30}\bbias\b/i.test(message)
    || /\b(?:higher[- ]timeframe|htf)\b[^.!?]{0,50}\bbearish\b[^.!?]{0,50}\bbullish\b[^.!?]{0,30}\bbias\b/i.test(message);
  return hasBothBiasDirections
    && /(?:fvg|fair\s+value\s+gap)[^.!?]{0,60}\bretests?\b/i.test(message);
}

function requestTimeframeValues(message: string) {
  return [...message.matchAll(/\b\d+(?:\.\d+)?\s*(?:m|min|minute|h|hr|hour|d|day|w|week)s?\b/gi)]
    .map(match => match[0].replace(/\s+/g, "").toUpperCase());
}

function mappedHtfBiasRetestConditions(
  conditions: any[],
  message: string,
  authorizations: RequestedConceptAuthorization[],
) {
  if (!exactHtfBiasRetestRequest(message)) return null;
  const requestedTimeframes = requestTimeframeValues(message);
  const htfCondition = conditions.find(condition => /\b(?:htf|higher[- ]timeframe|bias|structure)\b/i.test(`${condition?.name || ""} ${condition?.conceptName || ""}`));
  const fvgCondition = conditions.find(condition => /\b(?:fvg|fair\s+value\s+gap|retest)\b/i.test(`${condition?.name || ""} ${condition?.conceptName || ""} ${condition?.triggerRules || ""}`));
  const higherTimeframe = String(htfCondition?.timeframe || requestedTimeframes[0] || "1H");
  const lowerTimeframe = String(fvgCondition?.timeframe || requestedTimeframes[1] || requestedTimeframes[0] || "5M");
  const structureAuthorization = authorizations.find(authorization =>
    ["higher timeframe bias", "market structure shift"].includes(catalogKey(authorization.canonicalConcept)),
  );
  const fvgAuthorization = authorizations.find(authorization => catalogKey(authorization.canonicalConcept) === "fair value gap");
  if (!structureAuthorization || !fvgAuthorization) return null;
  const sides = [
    { direction: "long", polarity: "bullish", label: "Bullish" },
    { direction: "short", polarity: "bearish", label: "Bearish" },
  ] as const;
  return sides.flatMap(side => {
    const structureParameters = normalizeExecutableParameters("Market Structure Shift", {
      signal: "mss",
      polarity: side.polarity,
      lookback: 10,
    });
    const fvgParameters = normalizeExecutableParameters("Fair Value Gap", {
      polarity: side.polarity,
      interaction: "retest",
      lookback: 20,
      minimumGap: 0,
    });
    return [
      {
        name: `${side.label} higher-timeframe structure`,
        stage: "entry",
        requirement: "required",
        conceptName: "Market Structure Shift",
        timeframe: higherTimeframe,
        direction: side.direction,
        triggerRules: structureParameters ? executableConceptTriggerRules(structureParameters) : "",
        parameters: structureParameters,
        ruleSupported: Boolean(structureParameters),
        supported: Boolean(structureParameters),
        authorization: conditionAuthorization(
          { conceptName: "Market Structure Shift" },
          authorizations,
          { requestedConcept: structureAuthorization.requestedConcept, status: "required_for_concept" },
        ),
      },
      {
        name: `${side.label} Fair Value Gap Retest`,
        stage: "confirmation",
        requirement: "required",
        conceptName: "Fair Value Gap",
        timeframe: lowerTimeframe,
        direction: side.direction,
        triggerRules: fvgParameters ? executableConceptTriggerRules(fvgParameters) : "",
        parameters: fvgParameters,
        ruleSupported: Boolean(fvgParameters),
        supported: Boolean(fvgParameters),
        authorization: conditionAuthorization({ conceptName: "Fair Value Gap" }, authorizations),
      },
    ];
  });
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
  return executableConceptLabel(normalized) || unsupportedConceptForText(normalized)?.name || normalized;
}

function requestedConceptAuthorizations(message: string): RequestedConceptAuthorization[] {
  const byCanonical = new Map<string, RequestedConceptAuthorization>();
  const add = (requestedConcept: string, matchedText: string, supported: boolean, explanation: string) => {
    const canonicalConcept = canonicalConceptName(requestedConcept);
    if (!canonicalConcept) return;
    const key = catalogKey(canonicalConcept);
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
    const definition = executableConceptKind(canonical)
      ? EXECUTABLE_CONCEPT_DEFINITIONS[executableConceptKind(canonical)!]
      : null;
    add(
      concept.name,
      concept.matchedText,
      Boolean(executableConceptKind(canonical)),
      definition?.description || "Mapped to the existing structured executable concept definition.",
    );
  }
  for (const phrase of explicitConceptPhraseMatches(message)) {
    const canonical = canonicalConceptName(phrase);
    add(
      phrase,
      phrase,
      Boolean(executableConceptKind(canonical)),
      executableConceptKind(canonical)
        ? "Mapped to the existing structured executable concept definition."
        : "Explicitly requested, but not currently executable by the historical Builder.",
    );
  }
  return [...byCanonical.values()].sort((left, right) => {
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
  return {
    originalRequest: message,
    requestedConcepts: authorizations.map(authorization => ({
      requestedConcept: authorization.requestedConcept,
      canonicalConcept: authorization.canonicalConcept,
      matchedText: authorization.matchedText,
      supported: authorization.supported,
    })),
  };
}

function conditionMatchesConcept(condition: any, requestedName: string) {
  const candidateValues = [
    condition?.conceptName,
    condition?.name,
  ].map(value => String(value || ""));
  const requestedKey = catalogKey(canonicalConceptName(requestedName));
  return candidateValues.some(value => {
    const key = catalogKey(canonicalConceptName(value));
    return key === requestedKey || (
      Boolean(executableConceptKind(requestedName))
      && (key.includes(requestedKey) || requestedKey.includes(key))
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
    const periodMatch = descriptor.match(/(?:\b(?:ema|exponential\s+moving\s+average|sma|simple\s+moving\s+average|rsi|macd)\s*(?:\(\s*)?(\d+)|\b(\d+)\s*(?:ema|sma|rsi|macd)\b)/i);
    if (periodMatch) input.period = Number(periodMatch[1] || periodMatch[2]);
    const crossAbove = /\bcross(?:es|ing)?\s+(?:above|over)\b/i.test(descriptor);
    const crossBelow = /\bcross(?:es|ing)?\s+(?:below|under)\b/i.test(descriptor);
    if (crossAbove) input.comparison = "cross_above";
    else if (crossBelow) input.comparison = "cross_below";
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
    if (/\bretests?\b|\bfill\b/i.test(descriptor)) input.interaction = "retest";
    if (/\bbullish\b/i.test(descriptor)) input.polarity = "bullish";
    if (/\bbearish\b/i.test(descriptor)) input.polarity = "bearish";
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
) {
  const parameters = requestedParameters(conceptName, message);
  const supported = Boolean(parameters);
  const direction = requestedDirection(message, draft.direction);
  return {
    name: !supported
      ? executableConceptLabel(conceptName) || conceptName
      : parameters?.kind === "fair_value_gap" && parameters.interaction === "retest"
      ? "Fair Value Gap Retest"
      : `${executableConceptLabel(conceptName) || conceptName} condition`,
    stage: stageForRequestedConcept(conceptName, message, conceptName === "Fair Value Gap" ? "confirmation" : "entry"),
    requirement: "required",
    conceptName: executableConceptLabel(conceptName) || conceptName,
    timeframe: requestedTimeframes(message)[index] || requestedTimeframes(message)[0] || "Not specified",
    direction,
    triggerRules: parameters ? executableConceptTriggerRules(parameters) : `${conceptName} requested; review required because it is not executable by the current Builder.`,
    parameters,
    ruleSupported: supported,
    supported,
    authorization: conditionAuthorization({ conceptName }, authorizations),
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

function reconcileRequestedConditions(draft: any, message: string) {
  const originalConditions = Array.isArray(draft.conditions) ? draft.conditions : [];
  const authorizations = requestedConceptAuthorizations(message);
  const mappedHtfRetest = mappedHtfBiasRetestConditions(originalConditions, message, authorizations);
  if (mappedHtfRetest) return mappedHtfRetest;
  const requested = authorizations
    .filter(authorization => ![
      "multi timeframe analysis",
      "risk reward",
      "percentage risk",
      "position sizing",
      "maximum risk per trade",
      "stop loss",
      "take profit",
    ].includes(catalogKey(authorization.canonicalConcept)))
    .map(authorization => authorization.canonicalConcept);
  if (!requested.length) return [];
  const timeframes = requestedTimeframes(message);
  const direction = requestedDirection(message, draft.direction);
  const matched = requested.flatMap((requestedName, requestedIndex) => {
    const matching = originalConditions.filter((condition: any) => conditionMatchesConcept(condition, requestedName));
    if (!matching.length) return [syntheticRequestedCondition(requestedName, draft, message, requestedIndex, authorizations)];
    return matching.map((condition: any) => {
      const conceptName = executableConceptLabel(condition.conceptName) || condition.conceptName || requestedName;
      const parameters = requestedParameters(conceptName, message, condition);
      const conditionTimeframe = timeframes.find(value => catalogKey(value) === catalogKey(String(condition.timeframe || "")))
        || (timeframes.length === 1 ? timeframes[0] : condition.timeframe)
        || timeframes[requestedIndex]
        || "Not specified";
      return {
        ...condition,
        conceptName,
        timeframe: conditionTimeframe,
        direction: direction === "both" ? condition.direction || "both" : direction,
        parameters,
        triggerRules: parameters ? executableConceptTriggerRules(parameters) : condition.triggerRules,
        ruleSupported: condition.ruleSupported === true || Boolean(parameters),
        supported: Boolean(parameters) || condition.supported === true,
        authorization: conditionAuthorization({ ...condition, conceptName }, authorizations),
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
  const conditions = mappedConditions.map((condition: any) => {
    const conceptName = matchCatalogConcept(String(condition.conceptName || ""), catalog);
    const timeframe = matchCatalogTimeframe(String(condition.timeframe || ""), catalog);
    if (!conceptName) warnings.push(`Concept “${String(condition.conceptName || "Unnamed concept")}” is not in the Trading Concept Library.`);
    if (condition.timeframe && !timeframe) warnings.push(`Timeframe “${String(condition.timeframe)}” is not in the active Builder timeframes.`);
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
    return {
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
            return catalogKey(canonicalConceptName(name)) === catalogKey(authorization.canonicalConcept);
          })
          : null;
        return {
          name: authorization.canonicalConcept,
          supported: authorization.supported,
          explanation: typeof modelConcept === "object" && modelConcept?.explanation
            ? String(modelConcept.explanation)
            : authorization.explanation,
        };
      }),
    ...conditions.map((condition: any) => ({
      name: condition.conceptName,
      supported: condition.supported === true,
      explanation: condition.supported === true
        ? "Represented by the current historical rule set."
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
  const conceptsUsed = normalizeConcepts(retainedConcepts, conditions);
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
  const conditions = draft && Array.isArray(draft.conditions) ? draft.conditions.map((condition: any) => {
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
    return {
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