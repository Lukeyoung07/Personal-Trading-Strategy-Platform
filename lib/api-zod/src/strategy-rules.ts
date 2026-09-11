export const SUPPORTED_RULE_PRESETS = [
  { value: "bullish", label: "Candle is bullish", rule: "bullish" },
  { value: "bearish", label: "Candle is bearish", rule: "bearish" },
  { value: "close_above_open", label: "Price is above the candle open", rule: "close > open" },
  { value: "close_below_open", label: "Price is below the candle open", rule: "close < open" },
  { value: "close_crosses_above_previous_high", label: "Price crosses above the previous high", rule: "close crosses above previous high" },
  { value: "close_crosses_below_previous_low", label: "Price crosses below the previous low", rule: "close crosses below previous low" },
  { value: "always", label: "Always true", rule: "always" },
] as const;

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