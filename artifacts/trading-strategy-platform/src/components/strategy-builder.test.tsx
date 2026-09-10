import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrategyBuilder } from "./strategy-builder";

const state = vi.hoisted(() => ({
  strategies: [] as any[],
  conditions: [] as any[],
  concepts: [{ id: 1, name: "Momentum", category: "PRICE", isBuiltIn: true }] as any[],
  markets: [] as any[],
  createCondition: vi.fn(),
  updateStrategy: vi.fn(),
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
  useReorderStrategyConditions: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateStrategy: () => ({ mutate: state.updateStrategy, isPending: false }),
  useUpdateStrategyCondition: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("./strategy-versioning", () => ({
  StrategyVersionManager: () => <div data-testid="mock-version-manager" />,
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
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
  state.strategies = [];
  state.conditions = [];
  state.createCondition.mockReset();
  state.updateStrategy.mockReset();
});

describe("StrategyBuilder", () => {
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
    fireEvent.change(screen.getByTestId("select-builder-condition-rule"), { target: { value: "rsi_above" } });

    expect(screen.getByText("Not currently supported by Backtesting.")).toBeInTheDocument();
  });
});