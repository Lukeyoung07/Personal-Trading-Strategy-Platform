import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPanel } from "./assistant-panel";

const state = {
  chat: {
    isPending: false,
    isError: false,
    error: null,
    data: undefined as any,
    mutate: vi.fn(),
  },
};

vi.mock("@workspace/api-client-react", () => ({
  useChatAssistant: () => state.chat,
}));

const context = { page: "/strategy-builder", strategyId: 4, versionId: 9 };

describe("AssistantPanel", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    state.chat.isPending = false;
    state.chat.isError = false;
    state.chat.error = null;
    state.chat.data = undefined;
    state.chat.mutate.mockImplementation((_request: unknown, options: { onSuccess?: (response: unknown) => void }) => {
      options.onSuccess?.(state.chat.data);
    });
  });

  it("shows beginner prompt groups and puts a clicked example into the composer", () => {
    render(
      <AssistantPanel
        open
        onClose={vi.fn()}
        context={context}
        onReviewStrategy={vi.fn()}
        onOpenBacktest={vi.fn()}
      />,
    );

    expect(screen.getByText("Tell me what you want to build, test, or understand.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Help me define an entry rule" }));
    expect(screen.getByDisplayValue("Help me define an entry rule")).toBeTruthy();
  });

  it("sends the current message with exact workspace ids", () => {
    render(
      <AssistantPanel
        open
        onClose={vi.fn()}
        context={context}
        onReviewStrategy={vi.fn()}
        onOpenBacktest={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("input-assistant-message"), { target: { value: "Review this version" } });
    fireEvent.click(screen.getByTestId("button-send-assistant"));
    expect(state.chat.mutate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        message: "Review this version",
        context,
      }),
    }), expect.anything());
  });

  it("renders structured strategy drafts with explicit review actions", () => {
    state.chat.data = {
      status: "available",
      provider: "openrouter/free",
      reply: "Here is a draft to review.",
      strategyDraft: {
        name: "Opening range",
        description: "A small testable draft.",
        direction: "both",
        marketSymbol: null,
        timeframes: ["15m"],
        conditions: [{
          name: "Breakout",
          stage: "entry",
          requirement: "required",
          conceptName: "Price action",
          timeframe: "15m",
          triggerRules: "close > previous_high",
          supported: true,
        }],
        riskManagementRules: "Stop-loss 1%.",
        compatibility: { compatible: true, unsupportedConditions: [] },
      },
      compatibility: { compatible: true, unsupportedConditions: [] },
    };
    const onReviewStrategy = vi.fn();
    render(<AssistantPanel open onClose={vi.fn()} context={context} onReviewStrategy={onReviewStrategy} onOpenBacktest={vi.fn()} />);
    fireEvent.change(screen.getByTestId("input-assistant-message"), { target: { value: "Build this strategy" } });
    fireEvent.click(screen.getByTestId("button-send-assistant"));
    fireEvent.click(screen.getByTestId("button-review-strategy"));
    expect(onReviewStrategy).toHaveBeenCalledWith(expect.objectContaining({ name: "Opening range" }));
    fireEvent.click(screen.getByTestId("button-save-new-version"));
    expect(onReviewStrategy).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Opening range" }), "save-version");
  });

  it("shows an honest rate-limit state without inventing a result", async () => {
    state.chat.data = {
      status: "rate_limited",
      provider: "openrouter/free",
      reply: "The assistant is temporarily rate-limited.",
    };
    render(<AssistantPanel open onClose={vi.fn()} context={context} onReviewStrategy={vi.fn()} onOpenBacktest={vi.fn()} />);
    fireEvent.change(screen.getByTestId("input-assistant-message"), { target: { value: "Explain the result" } });
    fireEvent.click(screen.getByTestId("button-send-assistant"));
    await waitFor(() => expect(screen.getByTestId("assistant-unavailable")).toBeTruthy());
  });
});