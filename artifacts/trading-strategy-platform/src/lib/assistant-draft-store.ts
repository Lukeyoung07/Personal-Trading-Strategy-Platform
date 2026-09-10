import type { AssistantStrategyDraft } from "@workspace/api-client-react";

const STORAGE_KEY = "assistant-strategy-draft";

let pendingDraft: AssistantStrategyDraft | null = null;

export function setPendingAssistantDraft(draft: AssistantStrategyDraft) {
  pendingDraft = draft;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // The in-memory value still carries the draft through same-tab navigation.
  }
}

export function getPendingAssistantDraft(): AssistantStrategyDraft | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      pendingDraft = JSON.parse(stored) as AssistantStrategyDraft;
      return pendingDraft;
    }
    pendingDraft = null;
  } catch {
    // Fall back to the same-tab value when browser storage is unavailable.
  }
  return pendingDraft;
}

export function clearPendingAssistantDraft() {
  pendingDraft = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}