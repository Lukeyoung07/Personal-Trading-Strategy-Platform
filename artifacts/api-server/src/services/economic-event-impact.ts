export type ClassifiedEconomicImpact = "high" | "medium" | "low";

export type EconomicImpactClassification = {
  impact: ClassifiedEconomicImpact;
  ruleId: string;
  reason: string;
};

type ImpactRule = EconomicImpactClassification & {
  pattern: RegExp;
};

/**
 * Conservative, ordered rules for event types that have a recognizable
 * importance to traders. These are classifications, not provider ratings or
 * predictions about market direction.
 */
export const ECONOMIC_EVENT_IMPACT_RULES: readonly ImpactRule[] = [
  {
    ruleId: "central-bank-policy-decision",
    pattern: /\b(?:fomc|federal open market committee|interest rate decision|interest rates? decision|rate decision|monetary policy decision|monetary policy meeting|monetary policy statement|governing council.*monetary policy|bank of england.*monetary policy|boe.*monetary policy)\b/i,
    impact: "high",
    reason: "Central-bank monetary-policy decisions are classified as high importance.",
  },
  {
    ruleId: "inflation-release",
    pattern: /\b(?:consumer price index|core consumer price index|cpi|core cpi|inflation rate|inflation release)\b/i,
    impact: "high",
    reason: "CPI and other clearly identified inflation releases are classified as high importance.",
  },
  {
    ruleId: "major-employment-release",
    pattern: /\b(?:non[-\s]?farm payrolls?|nfp|employment situation|jobs report|unemployment rate)\b/i,
    impact: "high",
    reason: "Major employment and unemployment-rate releases are classified as high importance.",
  },
  {
    ruleId: "gdp-release",
    pattern: /\b(?:gross domestic product|gdp)\b/i,
    impact: "high",
    reason: "GDP releases are classified as high importance.",
  },
  {
    ruleId: "pce-inflation-release",
    pattern: /\b(?:personal consumption expenditures|core pce|pce)\b/i,
    impact: "high",
    reason: "PCE inflation releases are classified as high importance.",
  },
  {
    ruleId: "medium-activity-release",
    pattern: /\b(?:retail sales|manufacturing pmi|services pmi|composite pmi|pmi|industrial production|durable goods|housing starts|existing home sales|new home sales|building permits|house price index|consumer confidence|producer price index|ppi|trade balance|trade report|uk trade)\b/i,
    impact: "medium",
    reason: "This is a recognized activity, prices, housing, confidence, or trade release of medium importance.",
  },
  {
    ruleId: "secondary-employment-release",
    pattern: /\b(?:employment report|labou?r market|average weekly earnings|jobless claims|initial claims)\b/i,
    impact: "medium",
    reason: "This is an employment-related release without a clearly identified major headline type.",
  },
  {
    ruleId: "minor-survey-or-secondary-indicator",
    pattern: /\b(?:minor survey|business survey|consumer survey|sentiment survey|leading indicators?|wholesale inventories|capacity utilization|factory orders|administrative release|statistical release|statistical bulletin)\b/i,
    impact: "low",
    reason: "This is identified as a minor survey, secondary indicator, or administrative/statistical release.",
  },
];

export function classifyEconomicEventImpact(name: string): EconomicImpactClassification | null {
  const normalizedName = name.trim().replace(/\s+/g, " ");
  if (!normalizedName) return null;
  const match = ECONOMIC_EVENT_IMPACT_RULES.find(rule => rule.pattern.test(normalizedName));
  if (!match) return null;
  return {
    impact: match.impact,
    ruleId: match.ruleId,
    reason: `${match.reason} Rule: ${match.ruleId}.`,
  };
}