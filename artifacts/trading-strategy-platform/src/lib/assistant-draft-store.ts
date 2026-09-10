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
  if (pendingDraft) return pendingDraft;
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    pendingDraft = stored ? JSON.parse(stored) as AssistantStrategyDraft : null;
  } catch {
    pendingDraft = null;
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