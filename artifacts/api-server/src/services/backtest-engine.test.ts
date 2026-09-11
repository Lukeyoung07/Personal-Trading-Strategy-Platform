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
  const structuredCondition = (
    name: string,
    conceptName: string,
    direction: "long" | "short",
    parameters: Record<string, unknown>,
  ) => ({
    name,
    conceptName,
    stage: "entry" as const,
    direction,
    requirement: "required" as const,
    triggerRules: `${conceptName} structured detector`,
    parameters,
    invalidationRules: null,
    conceptDetectionRules: null,
  });

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

  it("detects a long liquidity sweep below the prior low and enters at the next open", () => {
    const result = runHistoricalBacktest({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [structuredCondition("Sell-side sweep", "Liquidity Sweep", "long", {
        kind: "liquidity_sweep",
        level: "previous_candle",
        sweepSide: "auto",
        confirmation: "close_back_inside",
        lookback: 5,
      })],
    }, [
      candle(0, { open: 100, high: 105, low: 95, close: 100 }),
      candle(1, { open: 100, high: 103, low: 94, close: 101 }),
      candle(2, { open: 110, high: 111, low: 109, close: 110 }),
    ]);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ side: "long", entryPrice: 110, entryReason: "entry_conditions:Sell-side sweep" });
  });

  it("detects a short liquidity sweep above the prior high", () => {
    const result = runHistoricalBacktest({
      direction: "short",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [structuredCondition("Buy-side sweep", "Liquidity Sweep", "short", {
        kind: "liquidity_sweep",
        level: "previous_candle",
        sweepSide: "auto",
        confirmation: "close_back_inside",
        lookback: 5,
      })],
    }, [
      candle(0, { open: 100, high: 105, low: 95, close: 100 }),
      candle(1, { open: 100, high: 106, low: 98, close: 99 }),
      candle(2, { open: 90, high: 91, low: 89, close: 90 }),
    ]);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ side: "short", entryPrice: 90, entryReason: "entry_conditions:Buy-side sweep" });
  });

  it("detects bullish and bearish three-candle FVG formation", () => {
    const bullish = runHistoricalBacktest({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [structuredCondition("Bullish FVG", "Fair Value Gap", "long", {
        kind: "fair_value_gap",
        polarity: "auto",
        interaction: "formation",
        lookback: 20,
        minimumGap: 0,
      })],
    }, [
      candle(0, { open: 99, high: 100, low: 98, close: 99 }),
      candle(1, { open: 100, high: 102, low: 100, close: 101 }),
      candle(2, { open: 103, high: 105, low: 103, close: 104 }),
      candle(3, { open: 106, high: 107, low: 105, close: 106 }),
    ]);
    const bearish = runHistoricalBacktest({
      direction: "short",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [structuredCondition("Bearish FVG", "Fair Value Gap", "short", {
        kind: "fair_value_gap",
        polarity: "auto",
        interaction: "formation",
        lookback: 20,
        minimumGap: 0,
      })],
    }, [
      candle(0, { open: 101, high: 102, low: 100, close: 101 }),
      candle(1, { open: 99, high: 99, low: 97, close: 98 }),
      candle(2, { open: 96, high: 97, low: 95, close: 96 }),
      candle(3, { open: 94, high: 95, low: 93, close: 94 }),
    ]);

    expect(bullish.trades).toHaveLength(1);
    expect(bullish.trades[0]).toMatchObject({ side: "long", entryPrice: 106 });
    expect(bearish.trades).toHaveLength(1);
    expect(bearish.trades[0]).toMatchObject({ side: "short", entryPrice: 94 });
  });

  it("distinguishes FVG formation from a later bounded retest", () => {
    const result = runHistoricalBacktest({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [structuredCondition("Bullish FVG retest", "Fair Value Gap", "long", {
        kind: "fair_value_gap",
        polarity: "bullish",
        interaction: "retest",
        lookback: 3,
        minimumGap: 0,
      })],
    }, [
      candle(0, { open: 99, high: 100, low: 98, close: 99 }),
      candle(1, { open: 100, high: 102, low: 100, close: 101 }),
      candle(2, { open: 103, high: 105, low: 103, close: 104 }),
      candle(3, { open: 105, high: 106, low: 101, close: 104 }),
      candle(4, { open: 107, high: 108, low: 106, close: 107 }),
    ]);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ side: "long", entryPrice: 107 });
  });

  it("rejects invalid structured lookbacks during preflight", () => {
    const errors = validateHistoricalBacktestStrategy({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [structuredCondition("Invalid sweep", "Liquidity Sweep", "long", {
        kind: "liquidity_sweep",
        level: "lookback_extreme",
        sweepSide: "auto",
        confirmation: "close_back_inside",
        lookback: 0,
      })],
    });

    expect(errors).toEqual([expect.stringContaining("Invalid sweep")]);
  });
});