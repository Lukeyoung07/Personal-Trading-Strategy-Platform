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
        conceptName: "Custom indicator",
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

  it("evaluates market structure breaks with a causal prior range", () => {
    const result = runHistoricalBacktest({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [structuredCondition("Bullish BOS", "Break of Structure", "long", {
        kind: "market_structure",
        signal: "bos",
        polarity: "bullish",
        lookback: 2,
      })],
    }, [
      candle(0, { open: 100, high: 102, low: 99, close: 101 }),
      candle(1, { open: 101, high: 103, low: 100, close: 102 }),
      candle(2, { open: 102, high: 106, low: 101, close: 105 }),
      candle(3, { open: 106, high: 108, low: 105, close: 107 }),
    ]);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ side: "long", entryPrice: 106 });
  });

  it("evaluates indicators, price action, and range location from OHLC history", () => {
    const ema = runHistoricalBacktest({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [structuredCondition("EMA above", "EMA", "long", {
        kind: "indicator",
        indicator: "ema",
        period: 2,
        comparison: "above",
        threshold: 0,
      })],
    }, [
      candle(0, { open: 100, high: 101, low: 99, close: 100 }),
      candle(1, { open: 100, high: 102, low: 100, close: 101 }),
      candle(2, { open: 101, high: 104, low: 101, close: 103 }),
      candle(3, { open: 104, high: 106, low: 103, close: 105 }),
    ]);
    const engulfing = runHistoricalBacktest({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [structuredCondition("Bullish engulfing", "Bullish Engulfing", "long", {
        kind: "price_action",
        pattern: "bullish_engulfing",
        polarity: "bullish",
        lookback: 2,
        wickRatio: 2,
      })],
    }, [
      candle(0, { open: 100, high: 101, low: 99, close: 99 }),
      candle(1, { open: 98, high: 103, low: 97, close: 102 }),
      candle(2, { open: 103, high: 104, low: 102, close: 103 }),
    ]);

    expect(ema.trades).toHaveLength(1);
    expect(engulfing.trades).toHaveLength(1);
  });

  it("evaluates prior calendar liquidity levels and supports valid zero-trade outcomes", () => {
    const result = runHistoricalBacktest({
      direction: "short",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [structuredCondition("Previous day high", "Previous Day High", "short", {
        kind: "liquidity_level",
        level: "previous_day_high",
        lookback: 2,
        tolerance: 0,
      })],
    }, [
      { ...candle(0, { open: 100, high: 105, low: 99, close: 102 }), openTime: new Date("2026-01-01T10:00:00Z") },
      { ...candle(1, { open: 102, high: 104, low: 101, close: 103 }), openTime: new Date("2026-01-01T11:00:00Z") },
      { ...candle(2, { open: 103, high: 105, low: 102, close: 104 }), openTime: new Date("2026-01-02T10:00:00Z") },
      { ...candle(3, { open: 103, high: 104, low: 102, close: 103 }), openTime: new Date("2026-01-02T11:00:00Z") },
    ]);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ side: "short", entryPrice: 103 });
  });

  it("does not expose an HTF close to an earlier LTF candle", () => {
    const htf: HistoricalCandle[] = [
      { openTime: new Date("2026-01-01T09:00:00.000Z"), closeTime: new Date("2026-01-01T10:00:00.000Z"), open: 100, high: 101, low: 99, close: 100, volume: 1, isClosed: true },
      { openTime: new Date("2026-01-01T10:00:00.000Z"), closeTime: new Date("2026-01-01T11:00:00.000Z"), open: 100, high: 121, low: 99, close: 120, volume: 1, isClosed: true },
    ];
    const ltf: HistoricalCandle[] = [
      { openTime: new Date("2026-01-01T10:50:00.000Z"), closeTime: new Date("2026-01-01T10:55:00.000Z"), open: 100, high: 101, low: 99, close: 100, volume: 1, isClosed: true },
      { openTime: new Date("2026-01-01T10:55:00.000Z"), closeTime: new Date("2026-01-01T11:00:00.000Z"), open: 100, high: 121, low: 99, close: 120, volume: 1, isClosed: true },
      { openTime: new Date("2026-01-01T11:00:00.000Z"), closeTime: new Date("2026-01-01T11:05:00.000Z"), open: 121, high: 122, low: 120, close: 121, volume: 1, isClosed: true },
    ];
    const result = runHistoricalBacktest({
      direction: "long",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [{
        name: "HTF break",
        conceptName: null,
        timeframe: "1H",
        stage: "entry",
        direction: "long",
        requirement: "required",
        triggerRules: "close > previous close",
        parameters: null,
        invalidationRules: null,
        conceptDetectionRules: null,
      }],
    }, {
      executionTimeframe: "5m",
      series: [{ code: "5m", candles: ltf }, { code: "1H", candles: htf }],
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryTime).toEqual(new Date("2026-01-01T11:00:00.000Z"));
    expect(result.trades[0].entryPrice).toBe(121);
  });

  it("supports valid zero-trade multi-timeframe results", () => {
    const result = runHistoricalBacktest({
      direction: "both",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [{
        name: "Never met",
        conceptName: null,
        timeframe: "1H",
        stage: "entry",
        direction: "long",
        requirement: "required",
        triggerRules: "close > 999999",
        parameters: null,
        invalidationRules: null,
        conceptDetectionRules: null,
      }],
    }, {
      executionTimeframe: "5m",
      series: [{ code: "5m", candles: [candle(0), candle(1)] }, { code: "1H", candles: [candle(0), candle(1)] }],
    });

    expect(result.trades).toEqual([]);
    expect(result.candlesProcessed).toBe(2);
  });

  it("evaluates short-side conditions against their own timeframe", () => {
    const result = runHistoricalBacktest({
      direction: "short",
      entryRules: null,
      exitRules: null,
      riskRules: null,
      conditions: [{
        name: "HTF breakdown",
        conceptName: null,
        timeframe: "1H",
        stage: "entry",
        direction: "short",
        requirement: "required",
        triggerRules: "close < previous close",
        parameters: null,
        invalidationRules: null,
        conceptDetectionRules: null,
      }],
    }, {
      executionTimeframe: "5m",
      series: [
        { code: "5m", candles: [candle(0), candle(1, { open: 90, close: 90 }), candle(2, { open: 89, close: 89 })] },
        { code: "1H", candles: [candle(0, { close: 100 }), candle(1, { open: 100, close: 80 })] },
      ],
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].side).toBe("short");
  });
});