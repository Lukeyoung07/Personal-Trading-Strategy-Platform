import { describe, expect, it } from "vitest";
import {
  classifyMarketDataState,
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