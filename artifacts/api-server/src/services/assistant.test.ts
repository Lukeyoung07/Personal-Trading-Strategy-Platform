import { afterEach, describe, expect, it, vi } from "vitest";
import { answerAssistant } from "./assistant";

const originalKey = process.env.OPENROUTER_API_KEY;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  globalThis.fetch = originalFetch;
});

describe("AI Trading Assistant provider boundary", () => {
  it("returns an honest unavailable response when the server credential is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const response = await answerAssistant({
      message: "Build a simple strategy",
      messages: [],
      context: { page: "workspace" },
    });

    expect(response.status).toBe("unavailable");
    expect(response.provider).toBe("openrouter/free");
    expect(response.reply).toContain("unavailable");
  });

  it("distinguishes provider quota failures from temporary provider failures without exposing upstream bodies", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response("provider secret detail", {
      status: 429,
      headers: { "content-type": "text/plain" },
    }));

    const limited = await answerAssistant({
      message: "Explain this setup",
      messages: [],
      context: { page: "workspace" },
    });

    expect(limited.status).toBe("rate_limited");
    expect(limited.reply).not.toContain("provider secret detail");

    globalThis.fetch = vi.fn(async () => new Response("provider secret detail", {
      status: 503,
      headers: { "content-type": "text/plain" },
    }));
    const temporary = await answerAssistant({
      message: "Explain this setup",
      messages: [],
      context: { page: "workspace" },
    });

    expect(temporary.status).toBe("unavailable");
    expect(temporary.reply).toContain("temporarily unavailable");
    expect(temporary.reply).not.toContain("provider secret detail");
  });

  it("gives a useful result-context message when no backtest is selected", async () => {
    const response = await answerAssistant({
      message: "Explain my backtest results.",
      messages: [],
      context: { page: "/backtesting" },
    });

    expect(response.status).toBe("available");
    expect(response.intent).toBe("result_explanation");
    expect(response.reply).toBe("I need a completed backtest to explain. Open a completed backtest result first, then ask me to explain it.");
    expect(response.strategyDraft).toBeNull();
  });

  it("normalizes equivalent supported candle rules for Builder import", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared a compatible draft.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "Candle direction draft",
              description: "A supported candle strategy.",
              direction: "long",
              marketSymbol: "XAUUSD",
              timeframes: ["1H"],
              conditions: [
                {
                  name: "Bullish entry",
                  stage: "entry",
                  requirement: "required",
                  conceptName: "Bullish Candle",
                  timeframe: "1H",
                  triggerRules: "Close > Open on the entry candle",
                },
                {
                  name: "Bearish exit",
                  stage: "exit",
                  requirement: "optional",
                  conceptName: "Bearish Candle",
                  timeframe: "1H",
                  triggerRules: "Close < Open on the exit candle",
                },
              ],
              riskManagementRules: "Place a 1% stop loss and a 2% take profit.",
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
      message: "Build a compatible candle strategy with explicit entry and exit rules.",
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.status).toBe("available");
    expect(response.strategyDraft?.compatibility).toEqual({ compatible: true, unsupportedConditions: [] });
    expect(response.strategyDraft?.conditions.map(condition => ({
      conceptName: condition.conceptName,
      triggerRules: condition.triggerRules,
      supported: condition.supported,
    }))).toEqual([
      { conceptName: "Candle Direction", triggerRules: "close > open", supported: true },
      { conceptName: "Candle Direction", triggerRules: "close < open", supported: true },
    ]);
  });

  it("recovers exact bullish and bearish rules from explicit condition descriptors", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared a candle draft.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "Candle descriptor draft",
              description: "A supported candle strategy.",
              direction: "long",
              marketSymbol: "XAUUSD",
              timeframes: ["1H"],
              conditions: [
                { name: "Entry", stage: "entry", requirement: "required", conceptName: "Bullish Candle", timeframe: "1H", triggerRules: "unsupported rule requires adjustment" },
                { name: "Exit", stage: "exit", requirement: "required", conceptName: "Bearish Candle", timeframe: "1H", triggerRules: "unsupported rule requires adjustment" },
              ],
              riskManagementRules: "1% stop loss, 2% take profit",
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
      message: "Build a bullish and bearish candle strategy with entry and exit rules.",
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.compatibility).toEqual({ compatible: true, unsupportedConditions: [] });
    expect(response.strategyDraft?.conditions.map(condition => condition.triggerRules)).toEqual(["bullish", "bearish"]);
  });

  it("maps the exact Gold sweep plus FVG retest request to executable Builder conditions", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared the requested reversal draft.",
            intent: "strategy_proposal",
            strategyDraft: {
               name: "Gold Liquidity Sweep and FVG Retest Reversal",
               description: "A reversal setup with a liquidity sweep followed by a fair value gap retest.",
              direction: "both",
              marketSymbol: "Gold",
               timeframes: ["15m", "5m"],
              conditions: [
                {
                  name: "Liquidity Sweep",
                  stage: "entry",
                  requirement: "required",
                  conceptName: "Liquidity Sweep",
                   timeframe: "15m",
                  direction: "both",
                   triggerRules: "model prose that must not become the executable rule",
                },
                {
                   name: "Fair Value Gap Retest",
                  stage: "confirmation",
                  requirement: "required",
                   conceptName: "FVG Retest",
                   timeframe: "5m",
                  direction: "both",
                   triggerRules: "retest",
                },
              ],
               riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
       message: "Create me a reversal strategy for Gold using liquidity sweeps and Fair Value Gap retests. Use 15m for the main setup and 5m for confirmation, trading both long and short.",
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.marketSymbol).toBe("XAUUSD");
     expect(response.strategyDraft?.timeframes).toEqual(["15m", "5m"]);
    expect(response.strategyDraft?.conditions.map(condition => ({
      conceptName: condition.conceptName,
      stage: condition.stage,
      direction: condition.direction,
       timeframe: condition.timeframe,
      triggerRules: condition.triggerRules,
      ruleSupported: condition.ruleSupported,
       parameters: condition.parameters,
    }))).toEqual([
       {
         conceptName: "Liquidity Sweep",
         stage: "entry",
         direction: "both",
         timeframe: "15m",
         triggerRules: "Liquidity sweep: close back inside the swept level",
         ruleSupported: true,
         parameters: {
           kind: "liquidity_sweep",
           level: "previous_candle",
           sweepSide: "auto",
           confirmation: "close_back_inside",
           lookback: 5,
         },
       },
       {
         conceptName: "Fair Value Gap",
         stage: "confirmation",
         direction: "both",
         timeframe: "5m",
         triggerRules: "Fair Value Gap retest",
         ruleSupported: true,
         parameters: {
           kind: "fair_value_gap",
           polarity: "auto",
           interaction: "retest",
           lookback: 20,
           minimumGap: 0,
         },
       },
    ]);
    expect(response.strategyDraft?.riskManagementRules).toBeNull();
     expect(response.strategyDraft?.compatibility).toEqual({ compatible: true, unsupportedConditions: [] });
  });

  it("maps the exact HTF bias plus FVG retest request to paired canonical executable conditions", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared the requested multi-timeframe reversal draft.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "Gold HTF Bias and FVG Retest Reversal",
              description: "A 1H structure bias with 5M FVG retest confirmation.",
              direction: "both",
              marketSymbol: "XAUUSD",
              timeframes: ["1H", "5M"],
              conditions: [
                { name: "HTF Structure", stage: "confirmation", requirement: "required", conceptName: "HTF Structure", timeframe: "1H", direction: "both", triggerRules: "supported" },
                { name: "HTF Liquidity", stage: "confirmation", requirement: "required", conceptName: "HTF Liquidity", timeframe: "1H", direction: "both", triggerRules: "supported" },
                { name: "Fair Value Gap Retest", stage: "confirmation", requirement: "required", conceptName: "FVG Retest", timeframe: "5M", direction: "both", triggerRules: "retest" },
              ],
              conceptsUsed: [
                { name: "HTF Structure", supported: true, explanation: "Supported." },
                { name: "HTF Liquidity", supported: true, explanation: "Supported." },
                { name: "Fair Value Gap Retest", supported: true, explanation: "Supported." },
                { name: "Retest", supported: true, explanation: "Supported." },
              ],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
      message: "Create a reversal strategy for Gold using a 1H higher-timeframe bullish/bearish bias, followed by a 5M Fair Value Gap Retest confirmation. Trade both long and short.",
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.marketSymbol).toBe("XAUUSD");
    expect(response.strategyDraft?.direction).toBe("both");
    expect(response.strategyDraft?.timeframes.map(timeframe => timeframe.toLowerCase())).toEqual(["1h", "5m"]);
    expect(response.strategyDraft?.conditions.map(condition => ({
      conceptName: condition.conceptName,
      stage: condition.stage,
      direction: condition.direction,
      timeframe: condition.timeframe.toLowerCase(),
      parameters: condition.parameters,
    }))).toEqual([
      {
        conceptName: "Market Structure Shift",
        stage: "entry",
        direction: "long",
        timeframe: "1h",
        parameters: { kind: "market_structure", signal: "mss", polarity: "bullish", lookback: 10 },
      },
      {
        conceptName: "Fair Value Gap",
        stage: "confirmation",
        direction: "long",
        timeframe: "5m",
        parameters: { kind: "fair_value_gap", polarity: "bullish", interaction: "retest", lookback: 20, minimumGap: 0 },
      },
      {
        conceptName: "Market Structure Shift",
        stage: "entry",
        direction: "short",
        timeframe: "1h",
        parameters: { kind: "market_structure", signal: "mss", polarity: "bearish", lookback: 10 },
      },
      {
        conceptName: "Fair Value Gap",
        stage: "confirmation",
        direction: "short",
        timeframe: "5m",
        parameters: { kind: "fair_value_gap", polarity: "bearish", interaction: "retest", lookback: 20, minimumGap: 0 },
      },
    ]);
    expect(response.strategyDraft?.compatibility).toEqual({ compatible: true, unsupportedConditions: [] });
    expect(response.strategyDraft?.conceptsUsed?.map(concept => concept.name)).not.toContain("Retest");
    expect(response.strategyDraft?.compatibility.unsupportedConditions).not.toContain("Higher-timeframe bias");
  });

  it("transfers structured TRADEX fields, directions, and requested risk settings", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared the structured strategy draft.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "Gold Liquidity Reversal",
              description: "A multi-timeframe reversal process.",
              direction: "both",
              marketSymbol: "XAUUSD",
              timeframes: ["15M", "5M"],
              conditions: [
                {
                  name: "Liquidity Sweep",
                  stage: "entry",
                  requirement: "required",
                  conceptName: "Liquidity Sweep",
                  timeframe: "15M",
                  direction: "long",
                  triggerRules: "close crosses above previous low",
                },
                {
                  name: "Fair Value Gap",
                  stage: "confirmation",
                  requirement: "required",
                  conceptName: "FVG",
                  timeframe: "5M",
                  direction: "long",
                  triggerRules: "bullish",
                },
              ],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
      message: `TRADEX STRATEGY
Name: Gold Liquidity Reversal
Market: XAUUSD
Direction: Both
Timeframes:
15M
5M

ENTRY
1. Concept: Liquidity Sweep
   Direction: Long
   Timeframe: 15M

CONFIRMATION
1. Concept: Fair Value Gap
   Direction: Long
   Timeframe: 5M

RISK
Risk per trade: 1%
Risk/Reward: 2:1`,
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.marketSymbol).toBe("XAUUSD");
    expect(response.strategyDraft?.timeframes).toEqual(["15m", "5m"]);
    expect(response.strategyDraft?.conditions.map(condition => ({
      stage: condition.stage,
      direction: condition.direction,
      timeframe: condition.timeframe,
    }))).toEqual([
      { stage: "entry", direction: "long", timeframe: "15m" },
      { stage: "confirmation", direction: "long", timeframe: "5m" },
    ]);
    expect(response.strategyDraft?.riskManagementRules).toBe("risk: 1%; risk/reward: 2R");
  });

  it("maps indicator and breakout requests into Builder-compatible structured parameters", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared the indicator strategy draft.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "Gold Momentum",
              description: "Indicator confirmation with a range breakout.",
              direction: "both",
              marketSymbol: "XAUUSD",
              timeframes: ["15m"],
              conditions: [
                { name: "EMA 20", stage: "entry", requirement: "required", conceptName: "EMA", timeframe: "15m", direction: "both", triggerRules: "EMA above", parameters: { period: 20, comparison: "above" } },
                { name: "RSI", stage: "confirmation", requirement: "required", conceptName: "RSI", timeframe: "15m", direction: "both", triggerRules: "RSI above 50", parameters: { period: 14, comparison: "above", threshold: 50 } },
                { name: "Breakout", stage: "confirmation", requirement: "required", conceptName: "Breakout", timeframe: "15m", direction: "both", triggerRules: "breakout" },
              ],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
      message: "Create me a Gold strategy using EMA 20, RSI and Breakout confirmation.",
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.conditions.map(condition => ({
      conceptName: condition.conceptName,
      kind: condition.parameters?.kind,
      supported: condition.supported,
    }))).toEqual([
      { conceptName: "EMA", kind: "indicator", supported: true },
      { conceptName: "RSI", kind: "indicator", supported: true },
      { conceptName: "Breakout", kind: "price_action", supported: true },
    ]);
    expect(response.strategyDraft?.compatibility).toEqual({ compatible: true, unsupportedConditions: [] });
  });

    it("normalizes an EMA concept into the executable indicator family", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
             reply: "Prepared an EMA draft with an execution limitation.",
            intent: "strategy_proposal",
            strategyDraft: {
               name: "EMA draft",
               description: "An exponential moving average strategy.",
              direction: "long",
              marketSymbol: "XAUUSD",
              timeframes: ["15m"],
              conditions: [{
                 name: "EMA crossover",
                stage: "entry",
                requirement: "required",
                 conceptName: "EMA Cross",
                timeframe: "15m",
                triggerRules: "bullish",
              }],
              conceptsUsed: [{
                 name: "EMA Cross",
                supported: true,
                explanation: "The model should not be able to override this guardrail.",
              }],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
       message: "Build a bullish EMA strategy",
      messages: [],
      context: { page: "/strategy-builder" },
    });

      expect(response.strategyDraft?.conceptsUsed).toEqual(expect.arrayContaining([{
        name: "EMA",
       supported: true,
       explanation: "The model should not be able to override this guardrail.",
     }]));
      expect(response.strategyDraft?.compatibility.unsupportedConditions).not.toContain("EMA crossover");
  });

   it("keeps a supported indicator request as a reviewable draft when the model omits one", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "The 20 EMA is understood but unsupported for historical execution.",
            intent: "education",
            strategyDraft: null,
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
      message: "Build me a strategy using the 20 EMA.",
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.intent).toBe("strategy_proposal");
    expect(response.strategyDraft?.marketSymbol).toBeNull();
     expect(response.strategyDraft?.conceptsUsed).toEqual([{
       name: "EMA",
       supported: true,
       explanation: "Mapped to the structured historical detector; review its parameters before saving.",
     }]);
    expect(response.strategyDraft?.compatibility.compatible).toBe(false);
  });

  it("preserves explicitly requested concepts even when the model omits their canonical names", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared an FVG draft.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "FVG draft",
              description: "A four-hour bias with fifteen-minute entries.",
              direction: "both",
              marketSymbol: null,
              timeframes: ["4H", "15M"],
              conditions: [{
                name: "FVG entry",
                stage: "entry",
                requirement: "required",
                conceptName: "Candle Direction",
                timeframe: "15M",
                triggerRules: "bullish",
              }],
              conceptsUsed: [{
                name: "Candle Direction",
                supported: true,
                explanation: "Represented by the current historical rule set.",
              }],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
      message: "Create an FVG strategy using a 4H bias and 15M entry.",
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.conceptsUsed?.map(concept => concept.name)).toEqual(expect.arrayContaining([
       "Fair Value Gap",
      "Higher-timeframe bias",
      "Multi-timeframe analysis",
    ]));
    expect(response.strategyDraft?.compatibility.unsupportedConditions).toEqual(expect.arrayContaining([
      "Higher-timeframe bias",
    ]));
     expect(response.strategyDraft?.compatibility.unsupportedConditions).not.toContain("Fair Value Gap");
  });

  it("preserves the remaining taxonomy aliases as unsupported review metadata", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
     const requests = [
       { message: "Build me a liquidity sweep strategy.", expected: ["Liquidity Sweep"], unsupported: [] },
       { message: "Create an XAUUSD strategy using an FVG.", expected: ["Fair Value Gap"], unsupported: [] },
       { message: "Use a 4H bullish bias and 15M entry.", expected: ["Higher-timeframe bias", "Multi-timeframe analysis"], unsupported: ["Higher-timeframe bias"] },
        { message: "Build an SMC strategy using BOS and an order block.", expected: ["Break of Structure", "Order Block"], unsupported: ["Order Block"] },
        { message: "Use the 20 EMA as confirmation.", expected: ["EMA"], unsupported: [] },
        { message: "Create a strategy using premium and discount.", expected: ["Premium", "Discount"], unsupported: [] },
    ];

    for (const request of requests) {
      globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              reply: "Prepared a reviewable strategy draft.",
              intent: "strategy_proposal",
              strategyDraft: {
                name: "Taxonomy draft",
                description: "",
                direction: "both",
                marketSymbol: null,
                timeframes: [],
                conditions: [],
                conceptsUsed: [],
                riskManagementRules: null,
              },
            }),
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }));

      const response = await answerAssistant({
        message: request.message,
        messages: [],
        context: { page: "/strategy-builder" },
      });

      expect(response.strategyDraft?.conceptsUsed?.map(concept => concept.name)).toEqual(expect.arrayContaining(request.expected));
      expect(response.strategyDraft?.compatibility.compatible).toBe(false);
       if (request.unsupported.length) {
         expect(response.strategyDraft?.compatibility.unsupportedConditions).toEqual(expect.arrayContaining(request.unsupported));
       }
    }
  });

  it("keeps the generated draft aligned with the concepts, timeframes, directions, and rules requested by the user", async () => {
    const cases = [
      {
        message: "Create a 5m XAUUSD strategy using EMA 20 crosses, both directions.",
        draft: {
          direction: "both",
          timeframes: ["1H", "5m"],
          conditions: [
            { name: "EMA 20", stage: "entry", requirement: "required", conceptName: "EMA", timeframe: "1H", direction: "both", triggerRules: "model rule", parameters: { kind: "indicator", indicator: "ema", period: 99, comparison: "above" } },
            { name: "EMA 20 short", stage: "entry", requirement: "required", conceptName: "EMA", timeframe: "1H", direction: "short", triggerRules: "model rule", parameters: { kind: "indicator", indicator: "ema", period: 99, comparison: "above" } },
            { name: "HTF bias", stage: "confirmation", requirement: "required", conceptName: "HTF Structure", timeframe: "1H", direction: "both", triggerRules: "unrelated" },
            { name: "SMT", stage: "confirmation", requirement: "required", conceptName: "SMT Divergence", timeframe: "1H", direction: "both", triggerRules: "unrelated" },
          ],
          riskManagementRules: "Use appropriate risk management.",
        },
        verify: (response: Awaited<ReturnType<typeof answerAssistant>>) => {
          expect(response.strategyDraft?.marketSymbol).toBe("XAUUSD");
          expect(response.strategyDraft?.timeframes).toEqual(["5m"]);
          expect(response.strategyDraft?.conditions.map(condition => ({
            conceptName: condition.conceptName,
            timeframe: condition.timeframe,
            direction: condition.direction,
            period: condition.parameters?.period,
            comparison: condition.parameters?.comparison,
          }))).toEqual([
            { conceptName: "EMA", timeframe: "5m", direction: "long", period: 20, comparison: "cross_above" },
            { conceptName: "EMA", timeframe: "5m", direction: "short", period: 20, comparison: "cross_below" },
          ]);
          expect(response.strategyDraft?.riskManagementRules).toBeNull();
        },
      },
      {
        message: "Create a 15m long strategy using RSI below 30.",
        draft: {
          direction: "both",
          timeframes: ["1H"],
          conditions: [
            { name: "RSI", stage: "entry", requirement: "required", conceptName: "RSI", timeframe: "1H", direction: "both", triggerRules: "RSI above 70", parameters: { kind: "indicator", indicator: "rsi", period: 14, comparison: "above", threshold: 70 } },
            { name: "FVG", stage: "confirmation", requirement: "required", conceptName: "FVG", timeframe: "1H", direction: "both", triggerRules: "unrelated" },
          ],
          riskManagementRules: null,
        },
        verify: (response: Awaited<ReturnType<typeof answerAssistant>>) => {
          const condition = response.strategyDraft?.conditions[0];
          expect(response.strategyDraft?.timeframes).toEqual(["15m"]);
          expect(condition).toMatchObject({
            conceptName: "RSI",
            timeframe: "15m",
            direction: "long",
            parameters: { indicator: "rsi", period: 14, comparison: "below", threshold: 30 },
          });
          expect(response.strategyDraft?.conditions).toHaveLength(1);
        },
      },
      {
        message: "Create a 5m strategy using a bullish FVG retest with 1H bullish structure.",
        draft: {
          direction: "long",
          timeframes: ["5m", "1H"],
          conditions: [
            { name: "FVG retest", stage: "confirmation", requirement: "required", conceptName: "FVG", timeframe: "5m", direction: "long", triggerRules: "formation", parameters: { kind: "fair_value_gap", polarity: "bearish", interaction: "formation" } },
            { name: "Structure", stage: "entry", requirement: "required", conceptName: "HTF Structure", timeframe: "1H", direction: "long", triggerRules: "structure", parameters: { kind: "market_structure", signal: "bos", polarity: "bearish" } },
            { name: "Liquidity", stage: "confirmation", requirement: "required", conceptName: "Liquidity Sweep", timeframe: "1H", direction: "long", triggerRules: "unrelated" },
          ],
          riskManagementRules: null,
        },
        verify: (response: Awaited<ReturnType<typeof answerAssistant>>) => {
          expect(response.strategyDraft?.conditions.map(condition => ({
            conceptName: condition.conceptName,
            stage: condition.stage,
            timeframe: condition.timeframe,
            parameters: condition.parameters,
          }))).toEqual([
            {
              conceptName: "Fair Value Gap",
              stage: "confirmation",
              timeframe: "5m",
              parameters: { kind: "fair_value_gap", polarity: "bullish", interaction: "retest", lookback: 20, minimumGap: 0 },
            },
            {
              conceptName: "Market Structure Shift",
              stage: "entry",
              timeframe: "1h",
              parameters: { kind: "market_structure", signal: "bos", polarity: "bullish", lookback: 10 },
            },
          ]);
        },
      },
      {
        message: "Create a strategy using SMT divergence.",
        draft: {
          direction: "both",
          timeframes: [],
          conditions: [
            { name: "EMA", stage: "entry", requirement: "required", conceptName: "EMA", timeframe: "15m", direction: "both", triggerRules: "unrelated" },
          ],
          riskManagementRules: null,
        },
        verify: (response: Awaited<ReturnType<typeof answerAssistant>>) => {
          expect(response.strategyDraft?.conditions).toHaveLength(1);
          expect(response.strategyDraft?.conditions[0]).toMatchObject({
            conceptName: "SMT Divergence",
            supported: false,
          });
          expect(response.strategyDraft?.compatibility.unsupportedConditions).toContain("SMT Divergence");
        },
      },
      {
        message: "Create a strategy with a 2% stop loss and 4% take profit.",
        draft: {
          direction: "both",
          timeframes: [],
          conditions: [
            { name: "EMA", stage: "entry", requirement: "required", conceptName: "EMA", timeframe: "15m", direction: "both", triggerRules: "unrelated" },
          ],
          riskManagementRules: "Use appropriate risk management.",
        },
        verify: (response: Awaited<ReturnType<typeof answerAssistant>>) => {
          expect(response.strategyDraft?.conditions).toEqual([]);
          expect(response.strategyDraft?.riskManagementRules).toBe("stop-loss: 2%; take-profit: 4%");
        },
      },
      {
        message: "Create a strategy using EMA 20. Do not add risk management.",
        draft: {
          direction: "both",
          timeframes: ["15m"],
          conditions: [
            { name: "20 EMA", stage: "entry", requirement: "required", conceptName: "EMA(20)", timeframe: "15m", direction: "both", triggerRules: "EMA above", parameters: { kind: "indicator", indicator: "ema", period: 20, comparison: "above" } },
            { name: "FVG", stage: "confirmation", requirement: "required", conceptName: "FVG", timeframe: "15m", direction: "both", triggerRules: "unrelated" },
          ],
          riskManagementRules: "2% stop loss; 4% take profit",
        },
        verify: (response: Awaited<ReturnType<typeof answerAssistant>>) => {
          expect(response.strategyDraft?.conditions).toHaveLength(1);
          expect(response.strategyDraft?.conditions[0]).toMatchObject({
            conceptName: "EMA",
            parameters: { indicator: "ema", period: 20 },
          });
          expect(response.strategyDraft?.riskManagementRules).toBeNull();
        },
      },
    ];

    for (const testCase of cases) {
      process.env.OPENROUTER_API_KEY = "test-key";
      globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              reply: "Prepared a draft.",
              intent: "strategy_proposal",
              strategyDraft: {
                name: "Regression draft",
                description: "",
                marketSymbol: null,
                conceptsUsed: [],
                ...testCase.draft,
              },
            }),
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }));

      const response = await answerAssistant({
        message: testCase.message,
        messages: [],
        context: { page: "/strategy-builder" },
      });
      testCase.verify(response);
    }
  });

  it("rejects every model-suggested concept that is not authorized by a simple request", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared the requested RSI strategy.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "RSI strategy",
              description: "A simple oversold setup.",
              direction: "long",
              marketSymbol: "XAUUSD",
              timeframes: ["15m"],
              conditions: [
                { name: "RSI below 30", stage: "entry", requirement: "required", conceptName: "RSI", timeframe: "15m", direction: "long", triggerRules: "RSI below 30" },
                { name: "FVG retest", stage: "confirmation", requirement: "required", conceptName: "FVG", timeframe: "15m", direction: "long", triggerRules: "Fair Value Gap retest" },
                { name: "Liquidity sweep", stage: "confirmation", requirement: "required", conceptName: "Liquidity Sweep", timeframe: "15m", direction: "long", triggerRules: "close back inside" },
                { name: "Order block", stage: "confirmation", requirement: "required", conceptName: "Order Block", timeframe: "15m", direction: "long", triggerRules: "order block retest" },
              ],
              conceptsUsed: [
                { name: "RSI", supported: true, explanation: "Requested." },
                { name: "Fair Value Gap", supported: true, explanation: "Model suggestion." },
                { name: "Liquidity Sweep", supported: true, explanation: "Model suggestion." },
                { name: "Order Block", supported: false, explanation: "Model suggestion." },
              ],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const message = "Build a 15m XAUUSD long strategy using RSI below 30.";
    const response = await answerAssistant({
      message,
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.conditions).toHaveLength(1);
    expect(response.strategyDraft?.conditions[0]).toMatchObject({
      conceptName: "RSI",
      parameters: { indicator: "rsi", comparison: "below", threshold: 30 },
      authorization: {
        source: "user_request",
        status: "explicit",
        requestedConcept: "RSI",
        canonicalConcept: "RSI",
        matchedText: "RSI",
      },
    });
    expect(response.strategyDraft?.conceptsUsed?.map(concept => concept.name)).toEqual(["RSI"]);
    expect(response.strategyDraft?.authorization).toEqual({
      originalRequest: message,
      requestedConcepts: [{
        requestedConcept: "RSI",
        canonicalConcept: "RSI",
        matchedText: "RSI",
        supported: true,
      }],
    });
  });

  it("keeps complex multi-concept drafts limited to explicitly requested ICT and SMC concepts", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared the multi-timeframe strategy.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "Structure and FVG strategy",
              description: "A higher-timeframe structure setup with a lower-timeframe retest.",
              direction: "long",
              marketSymbol: "XAUUSD",
              timeframes: ["1H", "5m"],
              conditions: [
                { name: "MSS", stage: "entry", requirement: "required", conceptName: "MSS", timeframe: "1H", direction: "long", triggerRules: "market structure shift" },
                { name: "FVG retest", stage: "confirmation", requirement: "required", conceptName: "FVG Retest", timeframe: "5m", direction: "long", triggerRules: "retest" },
                { name: "SMT divergence", stage: "confirmation", requirement: "required", conceptName: "SMT Divergence", timeframe: "5m", direction: "long", triggerRules: "correlation divergence" },
                { name: "Order block retest", stage: "confirmation", requirement: "required", conceptName: "Order Block Retest", timeframe: "5m", direction: "long", triggerRules: "retest" },
                { name: "Premium", stage: "confirmation", requirement: "optional", conceptName: "Premium", timeframe: "1H", direction: "long", triggerRules: "premium range" },
                { name: "Liquidity sweep", stage: "confirmation", requirement: "optional", conceptName: "Liquidity Sweep", timeframe: "5m", direction: "long", triggerRules: "close back inside" },
              ],
              conceptsUsed: [
                { name: "MSS", supported: true, explanation: "Requested." },
                { name: "FVG", supported: true, explanation: "Requested." },
                { name: "SMT Divergence", supported: false, explanation: "Suggested." },
                { name: "Order Block", supported: false, explanation: "Suggested." },
                { name: "Premium", supported: true, explanation: "Suggested." },
                { name: "Liquidity Sweep", supported: true, explanation: "Suggested." },
              ],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const message = "Create a 1H market structure shift with a 5m Fair Value Gap retest strategy for XAUUSD.";
    const response = await answerAssistant({
      message,
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.conditions.map(condition => condition.conceptName)).toEqual([
      "Market Structure Shift",
      "Fair Value Gap",
    ]);
    expect(response.strategyDraft?.conditions.every(condition =>
      condition.authorization.source === "user_request"
      && condition.authorization.status === "explicit",
    )).toBe(true);
    expect(response.strategyDraft?.conceptsUsed?.map(concept => concept.name)).toEqual(expect.arrayContaining([
      "Market Structure Shift",
      "Fair Value Gap",
      "Multi-timeframe analysis",
    ]));
    expect(response.strategyDraft?.conceptsUsed?.map(concept => concept.name)).not.toEqual(expect.arrayContaining([
      "SMT Divergence",
      "Order Block",
      "Premium",
      "Liquidity Sweep",
    ]));
    expect(response.strategyDraft?.authorization.originalRequest).toBe(message);
  });

  it("preserves an explicitly requested unsupported concept only as review-required", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "SMT divergence needs review before it can be backtested.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "SMT strategy",
              description: "A requested unsupported concept.",
              direction: "both",
              marketSymbol: "XAUUSD",
              timeframes: ["5m"],
              conditions: [
                { name: "SMT divergence", stage: "entry", requirement: "required", conceptName: "SMT Divergence", timeframe: "5m", direction: "both", triggerRules: "correlated market divergence" },
                { name: "FVG", stage: "confirmation", requirement: "required", conceptName: "FVG", timeframe: "5m", direction: "both", triggerRules: "retest" },
                { name: "BOS", stage: "confirmation", requirement: "required", conceptName: "BOS", timeframe: "5m", direction: "both", triggerRules: "break of structure" },
              ],
              conceptsUsed: [
                { name: "SMT Divergence", supported: false, explanation: "Requested." },
                { name: "FVG", supported: true, explanation: "Suggested." },
                { name: "BOS", supported: true, explanation: "Suggested." },
              ],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const message = "Build a strategy using SMT divergence.";
    const response = await answerAssistant({
      message,
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.conditions).toHaveLength(1);
    expect(response.strategyDraft?.conditions[0]).toMatchObject({
      conceptName: "SMT Divergence",
      supported: false,
      authorization: {
        source: "user_request",
        status: "review_required",
        requestedConcept: "SMT Divergence",
        canonicalConcept: "SMT Divergence",
        matchedText: "SMT divergence",
      },
    });
    expect(response.strategyDraft?.compatibility.compatible).toBe(false);
    expect(response.strategyDraft?.compatibility.unsupportedConditions).toContain("SMT Divergence");
    expect(response.strategyDraft?.conditions.map(condition => condition.conceptName)).not.toEqual(expect.arrayContaining([
      "Fair Value Gap",
      "Break of Structure",
    ]));
  });

  it("authorizes arbitrary unsupported concepts only when their exact phrase appears in the request", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared a review-required volatility squeeze draft.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "Volatility squeeze strategy",
              description: "A custom unsupported concept.",
              direction: "long",
              marketSymbol: null,
              timeframes: ["15m"],
              conditions: [
                { name: "Volatility squeeze", stage: "entry", requirement: "required", conceptName: "Volatility Squeeze", timeframe: "15m", direction: "long", triggerRules: "custom model rule" },
                { name: "Volatility squeeze retest", stage: "confirmation", requirement: "required", conceptName: "Volatility Squeeze Retest", timeframe: "15m", direction: "long", triggerRules: "custom model rule" },
                { name: "SMT divergence", stage: "confirmation", requirement: "optional", conceptName: "SMT Divergence", timeframe: "15m", direction: "long", triggerRules: "custom model rule" },
              ],
              conceptsUsed: [],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const message = "Build a 15m long strategy using volatility squeeze.";
    const response = await answerAssistant({
      message,
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.conditions).toHaveLength(1);
    expect(response.strategyDraft?.conditions[0]).toMatchObject({
      conceptName: "Volatility Squeeze",
      supported: false,
      authorization: {
        source: "user_request",
        status: "review_required",
        requestedConcept: "volatility squeeze",
        matchedText: "volatility squeeze",
      },
    });
    expect(response.strategyDraft?.conditions.map(condition => condition.conceptName)).not.toContain("Volatility Squeeze Retest");
    expect(response.strategyDraft?.conditions.map(condition => condition.conceptName)).not.toContain("SMT Divergence");
  });

  it("keeps the requested displacement plus FVG handoff executable and does not invent continuation", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared the displacement and FVG retest draft.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "Gold displacement retest",
              description: "Bullish displacement with a bullish FVG retest.",
              direction: "long",
              marketSymbol: "XAUUSD",
              timeframes: ["5m"],
              conditions: [
                { name: "Bullish displacement", stage: "entry", requirement: "required", conceptName: "Displacement", timeframe: "5m", direction: "long", triggerRules: "model displacement" },
                { name: "Bullish FVG retest", stage: "confirmation", requirement: "required", conceptName: "FVG Retest", timeframe: "5m", direction: "long", triggerRules: "model retest" },
                { name: "Continuation", stage: "confirmation", requirement: "required", conceptName: "Continuation", timeframe: "5m", direction: "long", triggerRules: "model continuation" },
                { name: "Premium", stage: "confirmation", requirement: "optional", conceptName: "Premium", timeframe: "5m", direction: "long", triggerRules: "model premium" },
              ],
              conceptsUsed: [
                { name: "Displacement", supported: true, explanation: "Requested." },
                { name: "FVG Retest", supported: true, explanation: "Requested." },
                { name: "Continuation", supported: true, explanation: "Suggested." },
                { name: "Premium", supported: true, explanation: "Suggested." },
              ],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const message = "Create an XAUUSD 5m strategy using bullish displacement followed by a bullish FVG retest.";
    const response = await answerAssistant({
      message,
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.conditions.map(condition => condition.conceptName)).toEqual([
      "Displacement",
      "Fair Value Gap",
    ]);
    expect(response.strategyDraft?.conditions.map(condition => condition.parameters)).toEqual([
      {
        kind: "displacement",
        polarity: "bullish",
        atrPeriod: 14,
        minimumBodyAtr: 1.5,
        minimumCloseLocation: 0.75,
      },
      {
        kind: "fair_value_gap",
        polarity: "bullish",
        interaction: "retest",
        lookback: 20,
        minimumGap: 0,
      },
    ]);
    expect(response.strategyDraft?.conditions.every(condition =>
      condition.authorization.source === "user_request"
      && condition.authorization.status === "explicit",
    )).toBe(true);
    expect(response.strategyDraft?.conditions.map(condition => condition.conceptName)).not.toContain("Continuation");
    expect(response.strategyDraft?.conditions.map(condition => condition.conceptName)).not.toContain("Premium");
    expect(response.strategyDraft?.compatibility).toEqual({ compatible: true, unsupportedConditions: [] });
  });

  it("preserves an explicit R target and structural FVG stop as risk metadata", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared the requested reviewable risk draft.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "FVG risk draft",
              description: "A requested FVG retest with explicit risk language.",
              direction: "long",
              marketSymbol: "XAUUSD",
              timeframes: ["5m"],
              conditions: [
                { name: "Bullish FVG retest", stage: "entry", requirement: "required", conceptName: "FVG Retest", timeframe: "5m", direction: "long", triggerRules: "model retest" },
              ],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
      message: "Create an XAUUSD 5m strategy using a bullish FVG retest with a 2R take profit and a stop below the FVG.",
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.riskManagementRules).toContain("risk/reward: 2R");
    expect(response.strategyDraft?.riskManagementRules).toContain("stop-loss: structural FVG boundary");
    expect(response.strategyDraft?.compatibility.unsupportedConditions).toContain("The current risk rules");
  });

  it("maps an explicitly requested wick rejection into typed authorized parameters", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared the bullish wick rejection draft.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "Bullish wick rejection",
              description: "A deterministic bullish wick rejection.",
              direction: "long",
              marketSymbol: "XAUUSD",
              timeframes: ["5m"],
              conditions: [
                { name: "Bullish wick rejection", stage: "entry", requirement: "required", conceptName: "Wick Rejection", timeframe: "5m", direction: "long", triggerRules: "model rejection" },
              ],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
      message: "Create an XAUUSD 5m strategy using a bullish wick rejection.",
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.conditions).toHaveLength(1);
    expect(response.strategyDraft?.conditions[0]).toMatchObject({
      conceptName: "Rejection",
      supported: true,
      parameters: {
        kind: "rejection",
        polarity: "bullish",
        minimumWickFraction: 0.5,
        minimumCloseLocation: 0.75,
      },
      authorization: {
        source: "user_request",
        status: "explicit",
        canonicalConcept: "Rejection",
      },
    });
    expect(response.strategyDraft?.compatibility).toEqual({ compatible: true, unsupportedConditions: [] });
  });

  it("maps Failed Breakout and all canonical session names into executable draft parameters", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared the requested failed-breakout and session draft.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "Failed breakout sessions",
              description: "A deterministic breakout failure with session filters.",
              direction: "long",
              marketSymbol: "XAUUSD",
              timeframes: ["5m"],
              conditions: [
                { name: "Bullish failed breakout", stage: "entry", requirement: "required", conceptName: "Failed Breakout", timeframe: "5m", direction: "long", triggerRules: "model failure" },
                { name: "New York Session", stage: "confirmation", requirement: "required", conceptName: "New York Session", timeframe: "5m", direction: "long", triggerRules: "session" },
                { name: "London Session", stage: "confirmation", requirement: "required", conceptName: "London Session", timeframe: "5m", direction: "long", triggerRules: "session" },
                { name: "Asian Session", stage: "confirmation", requirement: "required", conceptName: "Asian Session", timeframe: "5m", direction: "long", triggerRules: "session" },
                { name: "Kill Zones", stage: "confirmation", requirement: "required", conceptName: "Kill Zones", timeframe: "5m", direction: "long", triggerRules: "session" },
              ],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
      message: "Create an XAUUSD 5m strategy using a bullish failed breakout within 3 bars, New York Session, London Session, Asian Session, and Kill Zone.",
      messages: [],
      context: { page: "/strategy-builder" },
    });
    const conditions = response.strategyDraft?.conditions || [];
    expect(conditions).toHaveLength(5);
    expect(conditions[0]).toMatchObject({
      conceptName: "Failed Breakout",
      supported: true,
      parameters: {
        kind: "failed_breakout",
        polarity: "bullish",
        levelType: "auto",
        maxBarsToFailure: 3,
      },
    });
    expect(conditions.slice(1).every(condition => condition.supported)).toBe(true);
    expect(conditions.slice(1).map(condition => (condition.parameters as any)?.session)).toEqual([
      "new_york",
      "london",
      "asian",
      "kill_zone",
    ]);
    expect(response.strategyDraft?.compatibility).toEqual({ compatible: true, unsupportedConditions: [] });
  });

  it("preserves explicitly requested continuation as review-required beside an FVG", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Continuation needs review before it can be backtested.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "Continuation retest",
              description: "An explicitly requested continuation concept.",
              direction: "long",
              marketSymbol: "XAUUSD",
              timeframes: ["5m"],
              conditions: [
                { name: "Bullish continuation", stage: "entry", requirement: "required", conceptName: "Continuation", timeframe: "5m", direction: "long", triggerRules: "follow-through" },
                { name: "Bullish FVG retest", stage: "confirmation", requirement: "required", conceptName: "FVG Retest", timeframe: "5m", direction: "long", triggerRules: "retest" },
              ],
              conceptsUsed: [],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const message = "Create an XAUUSD 5m strategy using bullish continuation and a bullish FVG retest.";
    const response = await answerAssistant({
      message,
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.conditions.map(condition => condition.conceptName)).toEqual([
      "Continuation",
      "Fair Value Gap",
    ]);
    expect(response.strategyDraft?.conditions[0]).toMatchObject({
      supported: false,
      authorization: {
        source: "user_request",
        status: "review_required",
        canonicalConcept: "Continuation",
      },
    });
    expect(response.strategyDraft?.conditions[1]).toMatchObject({
      supported: true,
      authorization: {
        source: "user_request",
        status: "explicit",
      },
    });
    expect(response.strategyDraft?.compatibility.compatible).toBe(false);
  });

  it("does not let the model invent displacement or continuation for an FVG-only request", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared the FVG draft.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "FVG only",
              description: "An FVG-only request.",
              direction: "long",
              marketSymbol: "XAUUSD",
              timeframes: ["5m"],
              conditions: [
                { name: "FVG", stage: "entry", requirement: "required", conceptName: "Fair Value Gap", timeframe: "5m", direction: "long", triggerRules: "formation" },
                { name: "Displacement", stage: "confirmation", requirement: "required", conceptName: "Displacement", timeframe: "5m", direction: "long", triggerRules: "model suggestion" },
                { name: "Continuation", stage: "confirmation", requirement: "required", conceptName: "Continuation", timeframe: "5m", direction: "long", triggerRules: "model suggestion" },
              ],
              conceptsUsed: [
                { name: "Fair Value Gap", supported: true },
                { name: "Displacement", supported: true },
                { name: "Continuation", supported: true },
              ],
              riskManagementRules: null,
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
      message: "Create an XAUUSD 5m strategy using a bullish FVG.",
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.conditions.map(condition => condition.conceptName)).toEqual(["Fair Value Gap"]);
    expect(response.strategyDraft?.conditions[0].authorization.status).toBe("explicit");
  });
});