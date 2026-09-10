import { describe, expect, it } from "vitest";
import { BacktestEngineError, runHistoricalBacktest, validateHistoricalBacktestStrategy, type HistoricalCandle } from "./backtest-engine";

function candle(index: number, values: Partial<Pick<HistoricalCandle, "open" | "high" | "low" | "close">> = {}): HistoricalCandle {
  const open = values.open ?? 100;
  const close = values.close ?? open;
  return {
    openTime: new Date(Date.UTC(2026, 0, 1, index)),
    closeTime: new Date(Date.UTC(2026, 0, 1, index, 59)),
    open,
    high: values.high ?? Math.max(open, close),
    low: values.low ?? Math.min(open, close),
    close,
    volume: 1,
    isClosed: true,
  };
}

describe("historical backtest engine", () => {
  it("processes candles oldest-first and executes signals at the next open", () => {
    const result = runHistoricalBacktest({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [
        {
          name: "Bullish entry",
          stage: "entry",
          direction: "long",
          requirement: "required",
          triggerRules: "close > open",
          invalidationRules: null,
          conceptDetectionRules: null,
        },
        {
          name: "Bearish exit",
          stage: "exit",
          direction: "long",
          requirement: "required",
          triggerRules: "close < open",
          invalidationRules: null,
          conceptDetectionRules: null,
        },
      ],
    }, [
      candle(0, { open: 100, close: 101 }),
      candle(1, { open: 110, close: 111 }),
      candle(2, { open: 112, close: 111 }),
      candle(3, { open: 109, close: 109 }),
    ]);

    expect(result.candlesProcessed).toBe(4);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      side: "long",
      entryPrice: 110,
      exitPrice: 109,
      entryReason: "entry_conditions:Bullish entry",
      exitReason: "exit_condition:Bearish exit",
    });
  });

  it("does not use a future candle to create an earlier entry", () => {
    const result = runHistoricalBacktest({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [{
        name: "Bullish entry",
        stage: "entry",
        direction: "long",
        requirement: "required",
        triggerRules: "close > open",
        invalidationRules: null,
        conceptDetectionRules: null,
      }],
    }, [
      candle(0, { open: 100, close: 99 }),
      candle(1, { open: 100, close: 101 }),
    ]);

    expect(result.trades).toHaveLength(0);
    expect(result.message).toBe("0 trades found for this strategy and period.");
  });

  it("uses stop loss first when stop and target are both touched in one candle", () => {
    const result = runHistoricalBacktest({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: "stop-loss: 1%; take-profit: 2%",
      conditions: [{
        name: "Bullish entry",
        stage: "entry",
        direction: "long",
        requirement: "required",
        triggerRules: "bullish",
        invalidationRules: null,
        conceptDetectionRules: null,
      }],
    }, [
      candle(0, { open: 100, close: 101 }),
      candle(1, { open: 100, high: 103, low: 98, close: 102 }),
      candle(2, { open: 100, close: 100 }),
    ]);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      stopLoss: 99,
      takeProfit: 102,
      exitPrice: 99,
      exitReason: "stop_loss_first_same_candle_ambiguity",
      pnl: -1,
    });
  });

  it("completes successfully with zero trades", () => {
    const result = runHistoricalBacktest({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [{
        name: "Never met",
        stage: "entry",
        direction: "long",
        requirement: "required",
        triggerRules: "close > 1000",
        invalidationRules: null,
        conceptDetectionRules: null,
      }],
    }, [candle(0), candle(1)]);

    expect(result.trades).toHaveLength(0);
    expect(result.message).toBe("0 trades found for this strategy and period.");
  });

  it("fails clearly when a version has no executable entry rule", () => {
    expect(() => runHistoricalBacktest({
      direction: "both",
      entryRules: "wait for a clean setup",
      exitRules: null,
      riskRules: null,
      conditions: [],
    }, [candle(0), candle(1)])).toThrow(BacktestEngineError);
  });

  it("preflights unsupported rules without touching historical candles", () => {
    const errors = validateHistoricalBacktestStrategy({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: "stop loss is discretionary",
      conditions: [{
        name: "EMA crossover",
        stage: "entry",
        direction: "long",
        requirement: "required",
        triggerRules: "ema20 crosses above ema50",
        invalidationRules: null,
        conceptDetectionRules: null,
      }],
    });

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining("EMA crossover"),
      expect.stringContaining("Risk rules mention stop-loss or take-profit"),
    ]));
  });

  it("accepts a zero-trade-compatible strategy during preflight", () => {
    expect(validateHistoricalBacktestStrategy({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [{
        name: "Never met",
        stage: "entry",
        direction: "long",
        requirement: "required",
        triggerRules: "close > 1000",
        invalidationRules: null,
        conceptDetectionRules: null,
      }],
    })).toEqual([]);
  });
});