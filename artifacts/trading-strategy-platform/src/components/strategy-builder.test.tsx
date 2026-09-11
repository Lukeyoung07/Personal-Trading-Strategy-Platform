import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrategyBuilder } from "./strategy-builder";

const state = vi.hoisted(() => ({
  strategies: [] as any[],
  conditions: [] as any[],
  concepts: [{ id: 1, name: "Momentum", category: "PRICE", isBuiltIn: true }] as any[],
  markets: [] as any[],
  createCondition: vi.fn(),
  updateStrategy: vi.fn(),
  chat: {
    isPending: false,
    mutate: vi.fn(),
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetDashboardSummaryQueryKey: () => ["dashboard-summary"],
  getListMarketsQueryKey: () => ["markets"],
  getListStrategiesQueryKey: () => ["strategies"],
  getListStrategyConditionsQueryKey: (id: number) => ["strategy-conditions", id],
  useCreateStrategy: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateStrategyCondition: () => ({ mutate: state.createCondition, isPending: false }),
  useDeleteStrategyCondition: () => ({ mutate: vi.fn(), isPending: false }),
  useListConcepts: () => ({ data: state.concepts, isLoading: false, isError: false }),
  useListMarkets: () => ({ data: state.markets, isLoading: false, isError: false }),
  useListStrategies: () => ({ data: state.strategies, isLoading: false, isError: false }),
  useListStrategyConditions: () => ({ data: state.conditions, isLoading: false, isError: false }),
  useListTimeframes: () => ({ data: [], isLoading: false, isError: false }),
  useReorderStrategyConditions: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateStrategy: () => ({ mutate: state.updateStrategy, isPending: false }),
  useUpdateStrategyCondition: () => ({ mutate: vi.fn(), isPending: false }),
  useChatAssistant: () => state.chat,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("./strategy-versioning", () => ({
  StrategyVersionManager: () => <div data-testid="mock-version-manager" />,
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useLocation: () => [window.location.pathname + window.location.search, vi.fn()],
}));

const strategy = {
  id: 4,
  name: "Candle review",
  description: "A simple candle-based process.",
  status: "draft",
  marketId: null,
  marketSymbol: null,
  assetClass: "equity",
  direction: "long",
  timeframes: ["4H"],
  riskManagementRules: "stop-loss: 1%",
  resetRules: null,
  alertRules: null,
};

const condition = {
  id: 11,
  strategyId: 4,
  conceptId: 1,
  stage: "entry",
  name: "Bullish candle",
  description: null,
  timeframe: "4H",
  direction: "long",
  requirement: "required",
  triggerRules: "bullish",
  invalidationRules: null,
  resetBehavior: null,
  order: 0,
};

afterEach(() => {
  cleanup();
  sessionStorage.removeItem("assistant-strategy-draft");
  window.history.pushState({}, "", "/strategy-builder");
  state.strategies = [];
  state.conditions = [];
  state.markets = [];
  state.createCondition.mockReset();
  state.updateStrategy.mockReset();
  state.chat.mutate.mockReset();
  state.chat.isPending = false;
  window.history.pushState({}, "", "/strategy-builder");
});

describe("StrategyBuilder", () => {
  it("opens Build with AI and keeps cancellation separate from the manual Builder", () => {
    render(<StrategyBuilder />);

    fireEvent.click(screen.getByTestId("button-build-with-ai"));
    expect(screen.getByText("BUILD A STRATEGY WITH AI")).toBeInTheDocument();
    expect(screen.getByTestId("input-build-with-ai-prompt")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-cancel-build-with-ai"));
    expect(screen.queryByText("BUILD A STRATEGY WITH AI")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-new-builder-strategy")).toBeInTheDocument();
  });

  it("shows the generated summary and hands the draft to the existing Builder review flow", () => {
    state.chat.mutate.mockImplementation((_request: unknown, options: { onSuccess?: (response: unknown) => void }) => {
      options.onSuccess?.({
        status: "available",
        provider: "openrouter/free",
        reply: "The requested concepts were mapped to the current library.",
        strategyDraft: {
          name: "Gold Liquidity Reversal",
          description: "A reversal hypothesis.",
          direction: "both",
          marketSymbol: "XAUUSD",
          timeframes: ["15m", "5m"],
          conditions: [
            { name: "Liquidity sweep", stage: "entry", requirement: "required", conceptName: "Liquidity Sweep", timeframe: "15m", triggerRules: "bullish", supported: true },
            { name: "FVG confirmation", stage: "confirmation", requirement: "required", conceptName: "Fair Value Gap", timeframe: "5m", triggerRules: "close > open", supported: true },
            { name: "Unmapped filter", stage: "exit", requirement: "optional", conceptName: "Invented Filter", timeframe: "15m", triggerRules: "unknown rule", supported: false },
          ],
          conceptsUsed: [{ name: "Invented Filter", supported: false, explanation: "Needs review." }],
          riskManagementRules: "risk: 1%; risk/reward: 2R",
          compatibility: { compatible: false, unsupportedConditions: ["Unmapped filter", "Invented Filter"] },
        },
      });
    });

    render(<StrategyBuilder />);
    fireEvent.click(screen.getByTestId("button-build-with-ai"));
    fireEvent.change(screen.getByTestId("input-build-with-ai-prompt"), {
      target: { value: "TRADEX STRATEGY\nName: Gold Liquidity Reversal\nMarket: XAUUSD" },
    });
    fireEvent.click(screen.getByTestId("button-generate-strategy"));

    expect(screen.getByTestId("build-with-ai-result")).toHaveTextContent("Gold Liquidity Reversal");
    expect(screen.getByTestId("build-with-ai-result")).toHaveTextContent("Entry");
    expect(screen.getByTestId("build-with-ai-result")).toHaveTextContent("Confirmation");
    expect(screen.getByTestId("build-with-ai-review-warning")).toHaveTextContent("Invented Filter");

    fireEvent.click(screen.getByTestId("button-review-generated-strategy"));
    expect(JSON.parse(sessionStorage.getItem("assistant-strategy-draft") || "{}").draft.name).toBe("Gold Liquidity Reversal");
    expect(screen.getByTestId("assistant-draft-builder-preview")).toHaveTextContent("Gold Liquidity Reversal");
    expect(screen.getByTestId("input-builder-strategy-name")).toHaveValue("Gold Liquidity Reversal");
  });

  it("shows the required failure state without creating a partial draft", () => {
    state.chat.mutate.mockImplementation((_request: unknown, options: { onSuccess?: (response: unknown) => void }) => {
      options.onSuccess?.({ status: "unavailable", provider: "openrouter/free", reply: "Unavailable" });
    });

    render(<StrategyBuilder />);
    fireEvent.click(screen.getByTestId("button-build-with-ai"));
    fireEvent.change(screen.getByTestId("input-build-with-ai-prompt"), { target: { value: "Build a strategy" } });
    fireEvent.click(screen.getByTestId("button-generate-strategy"));

    expect(screen.getByTestId("status-build-with-ai-error")).toHaveTextContent("Unable to generate strategy.");
    expect(sessionStorage.getItem("assistant-strategy-draft")).toBeNull();
  });

  it("renders the complete AI draft before any strategy is created", () => {
    const draft = {
      name: "XAUUSD candle review",
      description: "A simple candle-based strategy.",
      direction: "long",
      marketSymbol: "XAUUSD",
      timeframes: ["1H"],
      conditions: [
        {
          name: "Bullish entry",
          stage: "entry",
          requirement: "required",
          conceptName: "Candle Direction",
          timeframe: "1H",
          triggerRules: "bullish",
          supported: true,
        },
        {
          name: "Bearish exit",
          stage: "exit",
          requirement: "required",
          conceptName: "Candle Direction",
          timeframe: "1H",
          triggerRules: "bearish",
          supported: true,
        },
      ],
      riskManagementRules: "Stop loss: 1%; Take profit: 2%",
      compatibility: { compatible: true, unsupportedConditions: [] },
    };
    state.strategies = [strategy];
    state.markets = [{ id: 25, symbol: "XAUUSD", assetClass: "metals" }];
    window.history.pushState({}, "", "/strategy-builder?assistantDraft=1&assistantAction=save-version");
    sessionStorage.setItem("assistant-strategy-draft", JSON.stringify(draft));

    render(<StrategyBuilder />);

    expect(screen.getByTestId("assistant-draft-builder-preview")).toHaveTextContent("AI draft · save as new version");
    expect(screen.getByTestId("assistant-draft-builder-preview")).toHaveTextContent("XAUUSD candle review");
    expect(screen.getByTestId("assistant-draft-entry-conditions")).toHaveTextContent("Bullish entry");
    expect(screen.getByTestId("assistant-draft-exit-conditions")).toHaveTextContent("Bearish exit");
    expect(screen.getByTestId("assistant-draft-builder-preview")).toHaveTextContent("Stop loss: 1%; Take profit: 2%");
    expect(screen.getByTestId("input-builder-strategy-name")).toHaveValue("XAUUSD candle review");
    expect(screen.getByTestId("select-builder-direction")).toHaveValue("long");
  });

  it("renders paired HTF structure and FVG retest conditions with their review metadata", () => {
    const draft = {
      name: "Gold HTF Bias and FVG Retest Reversal",
      description: "A 1H structure bias with 5M FVG retest confirmation.",
      direction: "both",
      marketSymbol: "XAUUSD",
      timeframes: ["1h", "5m"],
      conditions: [
        { name: "Bullish higher-timeframe structure", stage: "entry", requirement: "required", conceptName: "Market Structure Shift", timeframe: "1h", direction: "long", triggerRules: "Market structure: mss", supported: true },
        { name: "Bullish Fair Value Gap Retest", stage: "confirmation", requirement: "required", conceptName: "Fair Value Gap", timeframe: "5m", direction: "long", triggerRules: "Fair Value Gap retest", supported: true },
        { name: "Bearish higher-timeframe structure", stage: "entry", requirement: "required", conceptName: "Market Structure Shift", timeframe: "1h", direction: "short", triggerRules: "Market structure: mss", supported: true },
        { name: "Bearish Fair Value Gap Retest", stage: "confirmation", requirement: "required", conceptName: "Fair Value Gap", timeframe: "5m", direction: "short", triggerRules: "Fair Value Gap retest", supported: true },
      ],
      riskManagementRules: null,
      compatibility: { compatible: true, unsupportedConditions: [] },
    };
    state.markets = [{ id: 25, symbol: "XAUUSD", assetClass: "metals" }];
    window.history.pushState({}, "", "/strategy-builder?assistantDraft=1&assistantAction=review");
    sessionStorage.setItem("assistant-strategy-draft", JSON.stringify(draft));

    render(<StrategyBuilder />);

    expect(screen.getByTestId("assistant-draft-builder-preview")).toHaveTextContent("both");
    expect(screen.getByTestId("assistant-draft-builder-preview")).toHaveTextContent("XAUUSD");
    expect(screen.getByTestId("assistant-draft-builder-preview")).toHaveTextContent("1h, 5m");
    expect(screen.getByTestId("assistant-draft-entry-conditions")).toHaveTextContent("Bullish higher-timeframe structure");
    expect(screen.getByTestId("assistant-draft-entry-conditions")).toHaveTextContent("Market Structure Shift · long");
    expect(screen.getByTestId("assistant-draft-entry-conditions")).toHaveTextContent("Bearish Fair Value Gap Retest");
    expect(screen.getByTestId("assistant-draft-entry-conditions")).toHaveTextContent("Fair Value Gap · short");
    expect(screen.queryByTestId("assistant-draft-compatibility-warning")).not.toBeInTheDocument();
  });

  it("reloads the pending draft when assistant query state arrives after the Builder mounted", async () => {
    const draft = {
      name: "XAUUSD live handoff",
      description: "Draft loaded after route state changed.",
      direction: "long",
      marketSymbol: "XAUUSD",
      timeframes: ["1H"],
      conditions: [],
      riskManagementRules: "Stop loss: 1%; Take profit: 2%",
      compatibility: { compatible: true, unsupportedConditions: [] },
    };
    state.markets = [{ id: 25, symbol: "XAUUSD", assetClass: "metals" }];
    const view = render(<StrategyBuilder />);

    expect(screen.getByTestId("input-builder-strategy-name")).toHaveValue("");
    sessionStorage.setItem("assistant-strategy-draft", JSON.stringify(draft));
    window.history.pushState({}, "", "/strategy-builder?assistantDraft=1&assistantAction=review");
    view.rerender(<StrategyBuilder />);

    await waitFor(() => expect(screen.getByTestId("input-builder-strategy-name")).toHaveValue("XAUUSD live handoff"));
    expect(screen.getByTestId("select-builder-direction")).toHaveValue("long");
    expect(screen.getByTestId("input-builder-risk-rules")).toHaveValue("Stop loss: 1%; Take profit: 2%");
  });

  it("updates the draft market after markets load without overwriting a manual choice", async () => {
    const draft = {
      name: "XAUUSD market mapping",
      description: "Draft market mapping.",
      direction: "long",
      marketSymbol: "XAUUSD",
      timeframes: ["1H"],
      conditions: [],
      riskManagementRules: null,
      compatibility: { compatible: true, unsupportedConditions: [] },
    };
    window.history.pushState({}, "", "/strategy-builder?assistantDraft=1&assistantAction=review");
    sessionStorage.setItem("assistant-strategy-draft", JSON.stringify(draft));
    const view = render(<StrategyBuilder />);

    expect(screen.getByTestId("select-builder-market")).toHaveValue("");
    state.markets = [
      { id: 25, symbol: "XAUUSD", assetClass: "metals" },
      { id: 26, symbol: "USTEC", assetClass: "index" },
    ];
    view.rerender(<StrategyBuilder />);
    await waitFor(() => expect(screen.getByTestId("select-builder-market")).toHaveValue("25"));

    fireEvent.change(screen.getByTestId("select-builder-market"), { target: { value: "26" } });
    view.rerender(<StrategyBuilder />);
    expect(screen.getByTestId("select-builder-market")).toHaveValue("26");
  });

  it("loads an existing strategy and keeps the live summary in plain language", () => {
    state.strategies = [strategy];
    state.conditions = [condition];

    render(<StrategyBuilder />);

    expect(screen.getByText("Strategy details")).toBeInTheDocument();
    expect(screen.getByTestId("section-strategy-summary")).toHaveTextContent("Buy");
    expect(screen.getByTestId("section-strategy-summary")).toHaveTextContent("bullish");
    expect(screen.getByTestId("strategy-condition-flow")).toBeInTheDocument();
    expect(screen.getByTestId("builder-logic-legend")).toHaveTextContent("AND");
    expect(screen.getByTestId("builder-logic-legend")).toHaveTextContent("OR");
    expect(screen.getByTestId("builder-logic-legend")).toHaveTextContent("not currently supported");
  });

  it("saves BUY or SELL direction and percentage exit rules through the existing strategy API", () => {
    state.strategies = [strategy];
    render(<StrategyBuilder />);

    fireEvent.click(screen.getByTestId("button-builder-direction-short"));
    fireEvent.click(screen.getByTestId("checkbox-builder-take-profit"));
    fireEvent.change(screen.getByTestId("input-builder-stop-loss"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("input-builder-take-profit"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("button-save-builder-strategy-settings"));

    expect(state.updateStrategy).toHaveBeenCalledWith(
      { strategyId: 4, data: { direction: "short", riskManagementRules: "stop-loss: 2%; take-profit: 3%" } },
      expect.anything(),
    );
  });

  it("validates a new condition before saving and maps a guided rule to a backtest rule", () => {
    state.strategies = [strategy];
    render(<StrategyBuilder />);

    fireEvent.click(screen.getByTestId("button-add-strategy-condition"));
    fireEvent.click(screen.getByTestId("button-save-builder-condition"));
    expect(screen.getByTestId("status-builder-condition-error")).toHaveTextContent("choose a concept");
    expect(state.createCondition).not.toHaveBeenCalled();

    fireEvent.focus(screen.getByTestId("input-condition-concept"));
    fireEvent.click(screen.getByTestId("option-condition-concept-1"));
    fireEvent.change(screen.getByTestId("input-builder-condition-name"), { target: { value: "Bullish confirmation" } });
    fireEvent.change(screen.getByTestId("input-builder-condition-timeframe"), { target: { value: "4H" } });
    fireEvent.change(screen.getByTestId("select-builder-condition-rule"), { target: { value: "bullish" } });
    fireEvent.click(screen.getByTestId("button-save-builder-condition"));

    expect(state.createCondition).toHaveBeenCalledWith(
      {
        strategyId: 4,
        data: expect.objectContaining({
          conceptId: 1,
          name: "Bullish confirmation",
          timeframe: "4H",
          triggerRules: "bullish",
        }),
      },
      expect.anything(),
    );
  });

  it("shows the explicit unsupported state for indicator rules", () => {
    state.strategies = [strategy];
    render(<StrategyBuilder />);

    fireEvent.click(screen.getByTestId("button-add-strategy-condition"));
    fireEvent.focus(screen.getByTestId("input-condition-concept"));
    fireEvent.click(screen.getByTestId("option-condition-concept-1"));
    fireEvent.change(screen.getByTestId("select-builder-condition-rule"), { target: { value: "rsi_above" } });

    expect(screen.getByText("Not currently supported by Backtesting.")).toBeInTheDocument();
  });

  it("shows which saved condition prevents backtesting", () => {
    state.strategies = [strategy];
    state.conditions = [{ ...condition, name: "RSI filter", triggerRules: "RSI above 70" }];
    render(<StrategyBuilder />);

    expect(screen.getByTestId("section-backtest-compatibility")).toHaveTextContent("Some conditions cannot currently be backtested.");
    expect(screen.getByTestId("section-backtest-compatibility")).toHaveTextContent("RSI filter");
  });
});