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

  it("stores a validated, expiring envelope while preserving legacy raw drafts", () => {
    setPendingAssistantDraft(draft);
    const stored = JSON.parse(sessionStorage.getItem("assistant-strategy-draft") || "{}");
    expect(stored.draft.name).toBe(draft.name);
    expect(getPendingAssistantDraft()).toEqual(draft);

    sessionStorage.setItem("assistant-strategy-draft", JSON.stringify(draft));
    expect(getPendingAssistantDraft()).toEqual(draft);
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