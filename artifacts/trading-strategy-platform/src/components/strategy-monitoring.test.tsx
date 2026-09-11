import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrategyMonitoringPage } from "./strategy-monitoring";

const state = vi.hoisted(() => ({
  monitors: [] as unknown[],
  mutate: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidateQueries }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListStrategyMonitors: () => ({
    data: state.monitors,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useEvaluateActiveStrategies: () => ({
    mutate: state.mutate,
    isPending: false,
    isError: false,
  }),
  getListStrategyMonitorsQueryKey: () => ["strategy-monitors"],
}));

vi.mock("../App", () => ({
  Page: ({ action, children }: { action?: React.ReactNode; children: React.ReactNode }) => (
    <main>{action}{children}</main>
  ),
  LoadingBlock: () => <div>Loading</div>,
  ErrorState: () => <div>Error</div>,
  EmptyState: () => <div>Empty</div>,
}));

const monitor = {
  monitorSessionId: 19,
  strategyId: 41,
  strategyName: "Gold Reversal Strategy",
  strategyVersionId: 67,
  versionNumber: 1,
  instrumentId: 25,
  instrumentSymbol: "XAUUSD",
  sourceId: 6,
  marketDataState: "stale",
  monitoringStatus: "monitoring",
  overallStatus: "not_met",
  statusReason: "At least one required condition is not met.",
  conditionCount: 2,
  metCount: 0,
  notMetCount: 2,
  waitingCount: 0,
  invalidCount: 0,
  remainingCount: 2,
  progressPercent: 0,
  lastEvaluationAt: "2026-09-11T23:16:52.672Z",
  lastMarketDataAt: "2026-09-11T22:14:31.790Z",
  resetStatus: "not_configured",
  resetReason: null,
  conditions: [
    {
      strategyVersionConditionId: 30,
      conceptId: 7,
      conceptName: "Market Structure Shift",
      conditionOrder: 1,
      name: "Bullish structure",
      stage: "entry",
      requirement: "required",
      timeframe: "1h",
      status: "not_met",
      reasonCode: "EXECUTABLE_CONDITION_NOT_MET",
      reason: "The latest closed 1h candle does not satisfy Bullish structure.",
      lastEvaluationAt: "2026-09-11T23:16:52.672Z",
      lastMarketDataAt: "2026-09-11T22:14:31.790Z",
      lastCandleOpenTime: "2026-08-31T23:00:00.000Z",
    },
    {
      strategyVersionConditionId: 31,
      conceptId: 19,
      conceptName: "Fair Value Gap",
      conditionOrder: 2,
      name: "Bullish FVG retest",
      stage: "confirmation",
      requirement: "required",
      timeframe: "5m",
      status: "not_met",
      reasonCode: "EXECUTABLE_CONDITION_NOT_MET",
      reason: "The latest closed 5m candle does not satisfy Bullish FVG retest.",
      lastEvaluationAt: "2026-09-11T23:16:52.672Z",
      lastMarketDataAt: "2026-09-11T20:35:28.934Z",
      lastCandleOpenTime: "2026-09-10T23:55:00.000Z",
    },
  ],
};

describe("Strategy Monitoring UI", () => {
  afterEach(() => {
    cleanup();
    state.monitors = [];
    state.mutate.mockReset();
    state.invalidateQueries.mockReset();
  });

  it("shows provider freshness, condition timestamps, and exact closed candles", () => {
    state.monitors = [monitor];
    render(<StrategyMonitoringPage />);

    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getAllByText(/Closed candle/)).toHaveLength(4);
    expect(screen.getAllByText("EXECUTABLE_CONDITION_NOT_MET")).toHaveLength(2);
  });

  it("evaluates every active monitor and invalidates the refreshed list", () => {
    state.monitors = [monitor];
    state.mutate.mockImplementation((_request: unknown, options: { onSuccess?: () => void }) => {
      options.onSuccess?.();
    });
    render(<StrategyMonitoringPage />);

    fireEvent.click(screen.getByTestId("button-evaluate-all"));

    expect(state.mutate).toHaveBeenCalledWith({ data: {} }, expect.any(Object));
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["strategy-monitors"] });
  });
});