import { describe, expect, it } from "vitest";
import {
  shouldCreateMonitoringAlert,
  transitionConditionStatus,
  type ConditionEvaluationStatus,
} from "./strategy-monitoring";

describe("strategy monitoring transition contracts", () => {
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