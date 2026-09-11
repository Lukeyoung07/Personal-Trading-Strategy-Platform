export type LiquiditySweepParameters = {
  kind: "liquidity_sweep";
  level: "previous_candle" | "lookback_extreme";
  sweepSide: "auto" | "buy_side" | "sell_side";
  confirmation: "close_back_inside";
  lookback: number;
};

export type FairValueGapParameters = {
  kind: "fair_value_gap";
  polarity: "auto" | "bullish" | "bearish";
  interaction: "formation" | "retest";
  lookback: number;
  minimumGap: number;
};

export type ExecutableConceptParameters = LiquiditySweepParameters | FairValueGapParameters;

export const DEFAULT_LIQUIDITY_SWEEP_PARAMETERS: LiquiditySweepParameters = {
  kind: "liquidity_sweep",
  level: "previous_candle",
  sweepSide: "auto",
  confirmation: "close_back_inside",
  lookback: 5,
};

export const DEFAULT_FAIR_VALUE_GAP_PARAMETERS: FairValueGapParameters = {
  kind: "fair_value_gap",
  polarity: "auto",
  interaction: "formation",
  lookback: 20,
  minimumGap: 0,
};

const keyForConcept = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");

export function executableConceptKind(name: string | null | undefined): ExecutableConceptParameters["kind"] | null {
  const key = keyForConcept(name || "");
  if (key.includes("liquidity sweep")) return "liquidity_sweep";
  if (
    key === "fvg" ||
    key.startsWith("fvg ") ||
    key.includes("fair value gap") ||
    key.includes("bullish fvg") ||
    key.includes("bearish fvg")
  ) return "fair_value_gap";
  return null;
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function numberInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function normalizeExecutableParameters(
  conceptName: string | null | undefined,
  value: unknown,
): ExecutableConceptParameters | null {
  const kind = executableConceptKind(conceptName);
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (input.kind != null && input.kind !== kind) return null;
  if (kind === "liquidity_sweep") {
    const defaults = DEFAULT_LIQUIDITY_SWEEP_PARAMETERS;
    if (input.level != null && input.level !== "previous_candle" && input.level !== "lookback_extreme") return null;
    if (input.sweepSide != null && input.sweepSide !== "auto" && input.sweepSide !== "buy_side" && input.sweepSide !== "sell_side") return null;
    if (input.confirmation != null && input.confirmation !== "close_back_inside") return null;
    const sweepSide = input.sweepSide ?? (keyForConcept(conceptName || "").includes("buy side") ? "buy_side" : keyForConcept(conceptName || "").includes("sell side") ? "sell_side" : defaults.sweepSide);
    const result: LiquiditySweepParameters = {
      kind,
      level: input.level === "lookback_extreme" ? "lookback_extreme" : defaults.level,
      sweepSide: sweepSide === "buy_side" || sweepSide === "sell_side" ? sweepSide : "auto",
      confirmation: "close_back_inside",
      lookback: input.lookback == null ? defaults.lookback : Number(input.lookback),
    };
    return integerInRange(result.lookback, 1, 50) ? result : null;
  }
  if (kind === "fair_value_gap") {
    const defaults = DEFAULT_FAIR_VALUE_GAP_PARAMETERS;
    const conceptKey = keyForConcept(conceptName || "");
    if (input.polarity != null && input.polarity !== "auto" && input.polarity !== "bullish" && input.polarity !== "bearish") return null;
    if (input.interaction != null && input.interaction !== "formation" && input.interaction !== "retest") return null;
    const polarity = input.polarity
      ?? (conceptKey.includes("bullish") ? "bullish" : conceptKey.includes("bearish") ? "bearish" : defaults.polarity);
    const interaction = input.interaction
      ?? (conceptKey.includes("retest") || conceptKey.includes("fill") ? "retest" : defaults.interaction);
    const result: FairValueGapParameters = {
      kind,
      polarity: polarity === "bullish" || polarity === "bearish" ? polarity : "auto",
      interaction: interaction === "retest" ? "retest" : defaults.interaction,
      lookback: input.lookback == null ? defaults.lookback : Number(input.lookback),
      minimumGap: input.minimumGap == null ? defaults.minimumGap : Number(input.minimumGap),
    };
    return integerInRange(result.lookback, 1, 100) && numberInRange(result.minimumGap, 0, Number.MAX_SAFE_INTEGER) ? result : null;
  }
  return null;
}

export function executableConceptTriggerRules(parameters: ExecutableConceptParameters): string {
  return parameters.kind === "liquidity_sweep"
    ? "Liquidity sweep: close back inside the swept level"
    : parameters.interaction === "retest"
      ? "Fair Value Gap retest"
      : "Fair Value Gap formation";
}

export const EXECUTABLE_CONCEPT_DEFINITIONS = {
  liquidity_sweep: {
    label: "Liquidity Sweep",
    description: "The candle takes a prior liquidity level and closes back inside it.",
  },
  fair_value_gap: {
    label: "Fair Value Gap",
    description: "A three-candle imbalance, evaluated as formation or a later retest.",
  },
} as const;