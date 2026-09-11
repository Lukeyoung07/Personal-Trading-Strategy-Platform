import type { AssistantStrategyDraft } from "@workspace/api-client-react";

const STORAGE_KEY = "assistant-strategy-draft";
const MAX_STORAGE_BYTES = 200_000;
const STORAGE_TTL_MS = 30 * 60 * 1000;

let pendingDraft: AssistantStrategyDraft | null = null;

function isDraft(value: unknown): value is AssistantStrategyDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<AssistantStrategyDraft>;
  return typeof draft.name === "string"
    && Array.isArray(draft.conditions);
}

export function setPendingAssistantDraft(draft: AssistantStrategyDraft) {
  if (!isDraft(draft)) return;
  pendingDraft = draft;
  try {
    const stored = JSON.stringify({ savedAt: Date.now(), draft });
    if (stored.length > MAX_STORAGE_BYTES) return;
    sessionStorage.setItem(STORAGE_KEY, stored);
  } catch {
    // The in-memory value still carries the draft through same-tab navigation.
  }
}

export function getPendingAssistantDraft(): AssistantStrategyDraft | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored && stored.length <= MAX_STORAGE_BYTES) {
      const parsed = JSON.parse(stored) as unknown;
      const envelope = parsed && typeof parsed === "object" && "draft" in parsed ? parsed as { savedAt?: unknown; draft?: unknown } : null;
      const draft = envelope ? envelope.draft : parsed;
      const savedAt = envelope && typeof envelope.savedAt === "number" ? envelope.savedAt : null;
      if (savedAt != null && Date.now() - savedAt > STORAGE_TTL_MS) {
        sessionStorage.removeItem(STORAGE_KEY);
        pendingDraft = null;
        return null;
      }
      if (isDraft(draft)) {
        pendingDraft = draft;
        return pendingDraft;
      }
    }
    sessionStorage.removeItem(STORAGE_KEY);
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