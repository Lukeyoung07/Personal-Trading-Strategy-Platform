export type BacktestPreset = "last_7_days" | "last_30_days" | "last_90_days" | "last_6_months" | "last_1_year" | "custom";

type TimeframeLike = {
  id: number;
  code: string;
  label: string;
};

type ConditionLike = {
  timeframe: string;
};

export function formatDateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function timeframeKey(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "");
}

export function requiredBacktestTimeframeIds(
  configuredTimeframeId: number | null,
  conditions: ConditionLike[],
  timeframes: TimeframeLike[],
) {
  const ids = new Set<number>();
  if (configuredTimeframeId != null) ids.add(configuredTimeframeId);
  for (const condition of conditions) {
    const match = timeframes.find(timeframe =>
      timeframeKey(timeframe.code) === timeframeKey(condition.timeframe)
      || timeframeKey(timeframe.label) === timeframeKey(condition.timeframe),
    );
    if (match) ids.add(match.id);
  }
  return [...ids].sort((left, right) => left - right);
}

export function presetRange(preset: BacktestPreset | string, availableEnd?: Date | null, now = new Date()) {
  const end = availableEnd ? new Date(availableEnd) : new Date(now);
  const start = new Date(end);
  if (preset === "last_6_months") {
    start.setUTCMonth(start.getUTCMonth() - 6);
  } else if (preset === "last_1_year") {
    start.setUTCFullYear(start.getUTCFullYear() - 1);
  } else {
    const days = preset === "last_30_days" ? 30 : preset === "last_90_days" ? 90 : 7;
    start.setUTCDate(start.getUTCDate() - days);
  }
  return { start: formatDateInput(start), end: formatDateInput(end) };
}

export function isEndDateWithinAvailability(endDate: string, latestAvailableDate: string | null) {
  return Boolean(latestAvailableDate && endDate <= latestAvailableDate);
}

export function formatHistoricalDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(typeof value === "string" ? new Date(value) : value) + " UTC";
}