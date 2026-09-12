import { describe, expect, it } from "vitest";
import {
  classifyMarketDataState,
  createBuiltInStrategyMonitoringDetector,
  shouldCreateMonitoringAlert,
  transitionConditionStatus,
  type ConditionEvaluationStatus,
} from "./strategy-monitoring";

describe("strategy monitoring transition contracts", () => {
  it("normalizes provider and freshness states without treating missing data as not met", () => {
    const now = new Date("2026-09-12T00:00:00.000Z");
    expect(classifyMarketDataState({ sourceId: null })).toBe("ambiguous");
    expect(classifyMarketDataState({ sourceId: 6, connectionStatus: "disconnected" })).toBe("disconnected");
    expect(classifyMarketDataState({ sourceId: 6, connectionStatus: "error" })).toBe("error");
    expect(classifyMarketDataState({ sourceId: 6, connectionStatus: "closed", lastDataAt: now })).toBe("market_closed");
    expect(classifyMarketDataState({ sourceId: 6, connectionStatus: "connected" })).toBe("missing");
    expect(classifyMarketDataState({
      sourceId: 6,
      connectionStatus: "connected",
      lastDataAt: new Date("2026-09-11T23:00:00.000Z"),
      now,
    })).toBe("stale");
    expect(classifyMarketDataState({
      sourceId: 6,
      connectionStatus: "connected",
      lastDataAt: new Date("2026-09-11T23:55:00.000Z"),
      now,
    })).toBe("live");
  });

  it("keeps reset transitions waiting until the next evaluation", () => {
    expect(transitionConditionStatus("met", "met", true)).toBe("waiting");
    expect(transitionConditionStatus("not_met", "met")).toBe("met");
    expect(transitionConditionStatus(null, "waiting")).toBe("waiting");
  });

  it("uses the shared rejection evaluator for built-in monitoring detectors", async () => {
    const detector = createBuiltInStrategyMonitoringDetector({ id: 77, name: "Wick Rejection" });
    expect(detector).not.toBeNull();
    const condition = {
      id: 1,
      conceptId: 77,
      name: "Bullish wick rejection",
      conceptName: "Wick Rejection",
      timeframe: "5m",
      direction: "long",
      requirement: "required",
      order: 1,
      stage: "entry",
      triggerRules: "Rejection",
      parameters: {
        kind: "rejection",
        polarity: "bullish",
        minimumWickFraction: 0.5,
        minimumCloseLocation: 0.75,
      },
      invalidationRules: null,
      conceptDetectionRules: null,
    } as any;
    const input = {
      condition,
      dependencyStates: new Map(),
      previousStatus: null,
      previousState: null,
      evaluatedAt: new Date("2026-09-12T00:00:00.000Z"),
    };
    const candle = (close: number, low: number, high = 101) => ({
      id: 1,
      openTime: new Date("2026-09-11T23:55:00.000Z"),
      closeTime: new Date("2026-09-12T00:00:00.000Z"),
      open: 100,
      high,
      low,
      close,
      volume: null,
      isClosed: true,
      receivedAt: new Date("2026-09-12T00:00:00.000Z"),
    });

    expect(detector!.requiredCandleCount(condition)).toBe(1);
    await expect(detector!.evaluate({ ...input, candles: [candle(99, 90)] })).resolves.toMatchObject({
      status: "met",
      reasonCode: "EXECUTABLE_CONDITION_MET",
    });
    await expect(detector!.evaluate({ ...input, candles: [candle(101, 99, 105)] })).resolves.toMatchObject({
      status: "not_met",
      reasonCode: "EXECUTABLE_CONDITION_NOT_MET",
    });
  });

  it("uses the shared Failed Breakout and session evaluators for monitoring", async () => {
    const makeCandle = (index: number, values: { high: number; low: number; close: number; openTime?: string }) => ({
      id: index,
      openTime: new Date(values.openTime || `2026-01-01T0${index}:00:00.000Z`),
      closeTime: new Date(`2026-01-01T0${index}:59:00.000Z`),
      open: 100,
      high: values.high,
      low: values.low,
      close: values.close,
      volume: null,
      isClosed: true,
      receivedAt: new Date("2026-09-12T00:00:00.000Z"),
    });
    const failedBreakoutDetector = createBuiltInStrategyMonitoringDetector({ id: 78, name: "Failed Breakout" });
    const failedBreakoutCondition = {
      id: 2,
      conceptId: 78,
      name: "Bullish failed breakout",
      conceptName: "Failed Breakout",
      timeframe: "5m",
      direction: "long",
      requirement: "required",
      order: 1,
      stage: "entry",
      triggerRules: "Failed Breakout",
      parameters: { kind: "failed_breakout", polarity: "bullish", levelType: "resistance", lookback: 3, maxBarsToFailure: 3 },
      invalidationRules: null,
      conceptDetectionRules: null,
    } as any;
    const failedBreakoutCandles = [
      makeCandle(0, { high: 105, low: 95, close: 100 }),
      makeCandle(1, { high: 105, low: 95, close: 100 }),
      makeCandle(2, { high: 105, low: 95, close: 100 }),
      makeCandle(3, { high: 107, low: 99, close: 106 }),
      makeCandle(4, { high: 108, low: 100, close: 106 }),
      makeCandle(5, { high: 107, low: 99, close: 104 }),
      makeCandle(6, { high: 106, low: 100, close: 104 }),
    ];
    expect(failedBreakoutDetector).not.toBeNull();
    expect(failedBreakoutDetector!.requiredCandleCount(failedBreakoutCondition)).toBe(7);
    await expect(failedBreakoutDetector!.evaluate({
      condition: failedBreakoutCondition,
      candles: failedBreakoutCandles,
      dependencyStates: new Map(),
      previousStatus: null,
      previousState: null,
      evaluatedAt: new Date("2026-09-12T00:00:00.000Z"),
    })).resolves.toMatchObject({ status: "met", reasonCode: "EXECUTABLE_CONDITION_MET" });

    const sessionDetector = createBuiltInStrategyMonitoringDetector({ id: 79, name: "New York Session" });
    const sessionCondition = {
      ...failedBreakoutCondition,
      id: 3,
      conceptId: 79,
      name: "New York Session",
      conceptName: "New York Session",
      parameters: { kind: "session", session: "new_york", startTime: "08:00", endTime: "17:00", timezone: "America/New_York" },
    } as any;
    expect(sessionDetector).not.toBeNull();
    await expect(sessionDetector!.evaluate({
      condition: sessionCondition,
      candles: [makeCandle(0, { high: 101, low: 99, close: 100, openTime: "2026-07-15T13:00:00.000Z" })],
      dependencyStates: new Map(),
      previousStatus: null,
      previousState: null,
      evaluatedAt: new Date("2026-09-12T00:00:00.000Z"),
    })).resolves.toMatchObject({ status: "met", reasonCode: "EXECUTABLE_CONDITION_MET" });
  });

  it.each([
    [null, "met", true],
    ["waiting", "met", true],
    ["not_met", "invalid", true],
    [null, "invalid", true],
    ["met", "met", false],
    ["invalid", "invalid", false],
    ["waiting", "not_met", false],
    ["not_met", "waiting", false],
  ] as Array<[ConditionEvaluationStatus | null, ConditionEvaluationStatus, boolean]>)(
    "creates alerts only for new met/invalid overall states: %s -> %s",
    (previous, next, expected) => {
      expect(shouldCreateMonitoringAlert(previous, next)).toBe(expected);
    },
  );
});