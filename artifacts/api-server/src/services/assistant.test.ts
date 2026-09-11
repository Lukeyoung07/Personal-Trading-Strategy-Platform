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
});