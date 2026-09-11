export type HistoricalDataErrorCode =
  | "unavailable"
  | "rate_limited"
  | "provider_failure";

export class HistoricalDataError extends Error {
  readonly code: HistoricalDataErrorCode;

  constructor(code: HistoricalDataErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HistoricalDataError";
    this.code = code;
  }
}

export function isHistoricalDataError(error: unknown): error is HistoricalDataError {
  return error instanceof HistoricalDataError;
}