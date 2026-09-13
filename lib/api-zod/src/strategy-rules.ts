export const SUPPORTED_RULE_PRESETS = [
  { value: "bullish", label: "Candle is bullish", rule: "bullish" },
  { value: "bearish", label: "Candle is bearish", rule: "bearish" },
  { value: "close_above_open", label: "Price is above the candle open", rule: "close > open" },
  { value: "close_below_open", label: "Price is below the candle open", rule: "close < open" },
  { value: "close_crosses_above_previous_high", label: "Price crosses above the previous high", rule: "close crosses above previous high" },
  { value: "close_crosses_below_previous_low", label: "Price crosses below the previous low", rule: "close crosses below previous low" },
  { value: "always", label: "Always true", rule: "always" },
] as const;

import type { ExecutableConceptParameters } from "./executable-concepts";

export type UniversalRuleStage = "entry" | "confirmation" | "invalidation" | "exit";
export type UniversalRuleDirection = "long" | "short" | "both";
export type UniversalRuleExecutionStatus = "executable" | "review_required";
export type UniversalRuleValidationStatus = "valid" | "review_required";
export type UniversalRuleSource = "user_request" | "model" | "builder" | "legacy";
export type UniversalRuleRelationshipType =
  | "and"
  | "or"
  | "after"
  | "before"
  | "within"
  | "followed_by"
  | "retest_of"
  | "confirmation_of"
  | "invalidates"
  | "requires"
  | "while"
  | "direction_from";

export type UniversalRuleProvenance = {
  source: UniversalRuleSource;
  detectedText: string;
  requestedConcept: string | null;
  canonicalConcept: string;
};

export type UniversalRuleValidation = {
  valid: boolean;
  status: UniversalRuleValidationStatus;
  reasons: string[];
  warnings: string[];
};

export type UniversalRuleRelationship = {
  type: UniversalRuleRelationshipType;
  targetRuleIndex: number | null;
  targetCanonicalId?: string | null;
  parameters?: Record<string, unknown> | null;
  maxBarsBetween?: number;
  maxBarsBetweenDefaulted?: boolean;
  supported: boolean;
  reason: string | null;
};

export type UniversalStrategyRule = {
  canonicalRuleType: ExecutableConceptParameters["kind"] | "legacy_expression" | "unsupported" | null;
  conceptName: string;
  direction: UniversalRuleDirection;
  timeframe: string | null;
  parameters: Record<string, unknown> | null;
  stage: UniversalRuleStage;
  provenance: UniversalRuleProvenance;
  executionStatus: UniversalRuleExecutionStatus;
  validation: UniversalRuleValidation;
  relationship?: UniversalRuleRelationship;
};

export type UniversalRiskRule = {
  type: "stop_loss_percentage" | "take_profit_percentage" | "risk_per_trade_percentage" | "take_profit_r_multiple" | "risk_reward_multiple" | "structural_stop" | "structural_target";
  value: number | null;
  unit: "percent" | "r" | "reference";
  reference: string | null;
  executionStatus: UniversalRuleExecutionStatus;
  validation: UniversalRuleValidation;
};

export type CanonicalConditionSnapshot = {
  canonicalId: string | null;
  registryVersion: string | null;
  evaluatorVersion: string | null;
  executorKind: ExecutableConceptParameters["kind"] | null;
  conceptName: string;
  parameters: Record<string, unknown> | null;
  direction: UniversalRuleDirection;
  timeframe: string | null;
  relationship: UniversalRuleRelationship | null;
  provenance: UniversalRuleProvenance;
  executionStatus: UniversalRuleExecutionStatus;
  validation: UniversalRuleValidation;
};

export type CanonicalRiskSnapshot = {
  rules: UniversalRiskRule[];
  executionStatus: UniversalRuleExecutionStatus;
  validation: UniversalRuleValidation;
};

export function canonicalConditionSnapshot(input: {
  canonicalId?: string | null;
  registryVersion?: string | null;
  evaluatorVersion?: string | null;
  executorKind?: ExecutableConceptParameters["kind"] | null;
  conceptName: string;
  parameters?: Record<string, unknown> | null;
  direction: UniversalRuleDirection;
  timeframe?: string | null;
  relationship?: UniversalRuleRelationship | null;
  provenance: UniversalRuleProvenance;
  executionStatus: UniversalRuleExecutionStatus;
  validation: UniversalRuleValidation;
}): CanonicalConditionSnapshot {
  return {
    canonicalId: input.canonicalId ?? null,
    registryVersion: input.registryVersion ?? null,
    evaluatorVersion: input.evaluatorVersion ?? null,
    executorKind: input.executorKind ?? null,
    conceptName: input.conceptName,
    parameters: input.parameters ?? null,
    direction: input.direction,
    timeframe: input.timeframe ?? null,
    relationship: input.relationship ?? null,
    provenance: input.provenance,
    executionStatus: input.executionStatus,
    validation: input.validation,
  };
}

export function normalizeStrategyTimeframe(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  const suffixMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks)$/i);
  const prefixMatch = raw.match(/^(m|h|d|w)\s*(\d+(?:\.\d+)?)$/i);
  if (!suffixMatch && !prefixMatch) return null;
  const amount = Number(suffixMatch?.[1] || prefixMatch?.[2]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = suffixMatch?.[2] || prefixMatch?.[1];
  if (!unit) return null;
  const normalizedUnit = unit.toLowerCase();
  const suffix = normalizedUnit.startsWith("m") ? "M" : normalizedUnit.startsWith("h") ? "H" : normalizedUnit.startsWith("d") ? "D" : "W";
  return `${amount}${suffix}`;
}

export function universalValidation(
  executable: boolean,
  reasons: string[] = [],
  warnings: string[] = [],
): UniversalRuleValidation {
  const uniqueReasons = [...new Set(reasons.filter(Boolean))];
  return {
    valid: executable && uniqueReasons.length === 0,
    status: executable && uniqueReasons.length === 0 ? "valid" : "review_required",
    reasons: uniqueReasons,
    warnings: [...new Set(warnings.filter(Boolean))],
  };
}

export function normalizeHistoricalRule(rule: string) {
  return rule.trim().toLowerCase().replace(/[()[\],]/g, " ").replace(/\s+/g, " ");
}

export function isHistoricalRuleSupported(rule: string | null | undefined) {
  if (!rule?.trim()) return false;
  const normalized = normalizeHistoricalRule(rule).replace(/\s+and\s+/g, "&&").replace(/\s+or\s+/g, "||");
  for (const group of normalized.split("||")) {
    for (const clause of group.split("&&")) {
      const compact = clause.trim();
      if (compact === "always" || compact === "bullish" || compact === "bullish candle" || compact === "bearish" || compact === "bearish candle") continue;
      if (/^(open|high|low|close) crosses (above|below) previous[_ ](open|high|low|close)$/.test(compact)) continue;
      if (/^(open|high|low|close|previous[_ ](?:open|high|low|close))\s*(>=|<=|>|<|=|==)\s*(open|high|low|close|previous[_ ](?:open|high|low|close)|\d+(?:\.\d+)?)$/.test(compact)) continue;
      return false;
    }
  }
  return true;
}

export function historicalRuleCompatibilityError(rule: string) {
  return isHistoricalRuleSupported(rule)
    ? null
    : `Condition rule '${rule}' is not supported by the historical engine. Use always, bullish/bearish, OHLC comparisons, or previous-candle crossings.`;
}