import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BacktestResultsPanel } from "./backtest-results";

const resultState = vi.hoisted(() => ({
  current: null as any,
  isLoading: false,
  isError: false,
  queryOptions: null as any,
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetBacktestResultsQueryKey: (id: number) => ["backtest-results", id],
  useGetBacktestResults: (_id: number, options: any) => {
    resultState.queryOptions = options;
    return {
      data: resultState.current,
      isLoading: resultState.isLoading,
      isError: resultState.isError,
      refetch: vi.fn(),
    };
  },
}));

afterEach(() => {
  cleanup();
  resultState.current = null;
  resultState.isLoading = false;
  resultState.isError = false;
  resultState.queryOptions = null;
});

const baseBacktest = {
  id: 8,
  strategyId: 3,
  strategyName: "Bullish review",
  strategyVersionId: 12,
  versionNumber: 4,
  instrumentId: 25,
  instrumentSymbol: "XAUUSD",
  timeframeId: 15,
  timeframeLabel: "1 minute",
  preset: "custom",
  startDate: "2026-09-10T06:00:00.000Z",
  endDate: "2026-09-10T07:00:00.000Z",
  status: "completed",
  candlesProcessed: 2,
  tradeCount: 1,
  winningTrades: 1,
  losingTrades: 0,
  winRate: 100,
  totalPnl: 5,
  resultMessage: "1 simulated trade completed.",
  executionAssumptions: "Signals evaluated at candle close execute at the next candle open.",
  errorMessage: null,
  startedAt: "2026-09-10T07:00:00.000Z",
  completedAt: "2026-09-10T07:00:01.000Z",
  createdAt: "2026-09-10T07:00:00.000Z",
};

const trade = {
  id: 22,
  backtestId: 8,
  strategyId: 3,
  strategyVersionId: 12,
  instrumentId: 25,
  timeframeId: 15,
  side: "long",
  entryTime: "2026-09-10T06:01:00.000Z",
  entryPrice: 100,
  stopLoss: 99,
  takeProfit: 102,
  exitTime: "2026-09-10T06:02:00.000Z",
  exitPrice: 105,
  pnl: 5,
  entryReason: "entry_rule",
  exitReason: "take_profit",
  createdAt: "2026-09-10T07:00:01.000Z",
};

describe("BacktestResultsPanel", () => {
  it("renders stored statistics and reveals selected trade details", () => {
    resultState.current = {
      backtest: baseBacktest,
      trades: [trade],
      candles: [
        { id: 1, backtestId: 8, sourceId: 5, instrumentId: 25, timeframeId: 15, openTime: "2026-09-10T06:00:00.000Z", closeTime: null, open: 99, high: 101, low: 98, close: 100, volume: 1, isClosed: true, createdAt: baseBacktest.createdAt },
        { id: 2, backtestId: 8, sourceId: 5, instrumentId: 25, timeframeId: 15, openTime: "2026-09-10T06:01:00.000Z", closeTime: null, open: 100, high: 105, low: 99, close: 105, volume: 1, isClosed: true, createdAt: baseBacktest.createdAt },
      ],
      statistics: {
        winningTrades: 1,
        losingTrades: 0,
        winRate: 100,
        totalPnl: 5,
        averageWinningTrade: 5,
        averageLosingTrade: null,
        largestWinningTrade: 5,
        largestLosingTrade: null,
        maximumDrawdown: 0,
        profitFactor: null,
        equityCurve: [
          { timestamp: baseBacktest.startDate, equity: 0, tradeId: null },
          { timestamp: trade.exitTime, equity: 5, tradeId: trade.id },
        ],
      },
    };

    const onViewStrategy = vi.fn();
    const onRunAgain = vi.fn();
    render(<BacktestResultsPanel backtestId={8} onBack={vi.fn()} onViewStrategy={onViewStrategy} onRunAgain={onRunAgain} />);

    expect(screen.getByText("Bullish review")).toBeInTheDocument();
    expect(screen.getByText(/This backtest used/)).toHaveTextContent("Bullish review v4");
    fireEvent.click(screen.getByTestId("button-view-strategy-from-backtest"));
    expect(onViewStrategy).toHaveBeenCalledWith(3, 12);
    fireEvent.click(screen.getByTestId("button-run-again-backtest"));
    expect(onRunAgain).toHaveBeenCalledWith(baseBacktest);
    expect(screen.getByTestId("stat-win-rate")).toHaveTextContent("100.0%");
    expect(screen.getByTestId("stat-net-p/l")).toHaveTextContent("$5.00");
    expect(screen.getByTestId("chart-equity-curve")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-select-trade-22"));
    expect(screen.getByTestId("panel-trade-details-22")).toHaveTextContent("take_profit");
    expect(screen.getByTestId("chart-historical-ohlc")).toBeInTheDocument();
  });

  it("keeps performance statistics out of a zero-trade result", () => {
    resultState.current = {
      backtest: { ...baseBacktest, tradeCount: 0, winningTrades: 0, losingTrades: 0, winRate: null, totalPnl: null, resultMessage: "No trades found for this strategy and period." },
      trades: [],
      candles: [],
      statistics: {
        winningTrades: 0,
        losingTrades: 0,
        winRate: null,
        totalPnl: null,
        averageWinningTrade: null,
        averageLosingTrade: null,
        largestWinningTrade: null,
        largestLosingTrade: null,
        maximumDrawdown: null,
        profitFactor: null,
        equityCurve: [{ timestamp: baseBacktest.startDate, equity: 0, tradeId: null }],
      },
    };

    render(<BacktestResultsPanel backtestId={8} onBack={vi.fn()} />);

    expect(screen.getByTestId("backtest-zero-trade-state")).toHaveTextContent("No trades found for this strategy and period.");
    expect(screen.queryByText("What the recorded trades did")).not.toBeInTheDocument();
  });

  it("shows the missing-result error without retrying a 404", () => {
    resultState.isError = true;

    render(<BacktestResultsPanel backtestId={999999} onBack={vi.fn()} />);

    expect(screen.getByTestId("backtest-results-error")).toHaveTextContent("Couldn’t load this result");
    expect(resultState.queryOptions.query.retry).toBe(false);
  });
});