import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantStrategyDraft } from "@workspace/api-client-react";
import { clearPendingAssistantDraft, getPendingAssistantDraft, setPendingAssistantDraft } from "./assistant-draft-store";

const draft = {
  name: "Storage test draft",
  description: "",
  direction: "both",
  marketSymbol: null,
  timeframes: [],
  conditions: [],
  conceptsUsed: [],
  riskManagementRules: null,
  authorization: {
    originalRequest: "Storage test request",
    requestedConcepts: [],
  },
  compatibility: { compatible: false, unsupportedConditions: ["Review required"] },
} as AssistantStrategyDraft;

describe("assistant draft storage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00.000Z"));
    sessionStorage.clear();
    clearPendingAssistantDraft();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it("stores only drafts carrying their original request authorization", () => {
    setPendingAssistantDraft(draft);
    const stored = JSON.parse(sessionStorage.getItem("assistant-strategy-draft") || "{}");
    expect(stored.draft.name).toBe(draft.name);
    expect(getPendingAssistantDraft()).toEqual(draft);

    sessionStorage.setItem("assistant-strategy-draft", JSON.stringify(draft));
    expect(getPendingAssistantDraft()).toEqual(draft);

    sessionStorage.setItem("assistant-strategy-draft", JSON.stringify({
      ...draft,
      authorization: undefined,
    }));
    expect(getPendingAssistantDraft()).toBeNull();
  });

  it("preserves optional universal rule metadata and structured risk rules", () => {
    const universalDraft = {
      ...draft,
      conditions: [{
        name: "Bullish displacement",
        conceptName: "Displacement",
        stage: "entry",
        requirement: "required",
        timeframe: "5m",
        direction: "long",
        triggerRules: "displacement",
        invalidationRules: null,
        conceptDetectionRules: null,
        parameters: { kind: "displacement", polarity: "bullish" },
        ruleSupported: true,
        supported: true,
        canonicalRuleType: "displacement",
        executionStatus: "executable",
        provenance: {
          source: "user_request",
          detectedText: "bullish displacement",
          requestedConcept: "Displacement",
          canonicalConcept: "Displacement",
        },
        validation: { valid: true, status: "valid", reasons: [], warnings: [] },
        authorization: {
          source: "user_request",
          status: "explicit",
          requestedConcept: "Displacement",
          matchedText: "bullish displacement",
          canonicalConcept: "Displacement",
        },
      }],
      authorization: {
        originalRequest: "Storage test request",
        requestedConcepts: [{ requestedConcept: "Displacement", matchedText: "bullish displacement" }],
      },
      riskRules: [{
        type: "stop_loss_percentage",
        value: 1,
        unit: "percent",
        reference: null,
        executionStatus: "executable",
        validation: { valid: true, status: "valid", reasons: [], warnings: [] },
      }],
    } as AssistantStrategyDraft;

    setPendingAssistantDraft(universalDraft);
    expect(getPendingAssistantDraft()).toMatchObject({
      conditions: [expect.objectContaining({
        canonicalRuleType: "displacement",
        executionStatus: "executable",
        provenance: expect.objectContaining({ source: "user_request" }),
      })],
      riskRules: [expect.objectContaining({ type: "stop_loss_percentage", value: 1 })],
    });
  });

  it("clears corrupt, oversized, and expired storage instead of trusting it", () => {
    sessionStorage.setItem("assistant-strategy-draft", "{not-json");
    expect(getPendingAssistantDraft()).toBeNull();

    sessionStorage.setItem("assistant-strategy-draft", JSON.stringify({
      savedAt: Date.now() - 31 * 60 * 1000,
      draft,
    }));
    expect(getPendingAssistantDraft()).toBeNull();

    sessionStorage.setItem("assistant-strategy-draft", "x".repeat(200_001));
    expect(getPendingAssistantDraft()).toBeNull();
  });
});