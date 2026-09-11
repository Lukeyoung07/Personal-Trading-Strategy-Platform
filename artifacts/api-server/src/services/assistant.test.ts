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

  it("builds the requested Gold reversal stages without inventing risk or exits", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Prepared the requested reversal draft.",
            intent: "strategy_proposal",
            strategyDraft: {
              name: "Gold 15m Liquidity Sweep Reversal",
              description: "A reversal setup with a liquidity sweep followed by fair value gap confirmation.",
              direction: "both",
              marketSymbol: "Gold",
              timeframes: ["15 minutes"],
              conditions: [
                {
                  name: "Liquidity Sweep",
                  stage: "entry",
                  requirement: "required",
                  conceptName: "Liquidity Sweep",
                  timeframe: "15 minutes",
                  direction: "both",
                  triggerRules: "close crosses above previous low",
                },
                {
                  name: "Fair Value Gap confirmation",
                  stage: "confirmation",
                  requirement: "required",
                  conceptName: "Fair Value Gap",
                  timeframe: "15 minutes",
                  direction: "both",
                  triggerRules: "bullish",
                },
                {
                  name: "Take Profit",
                  stage: "exit",
                  requirement: "optional",
                  conceptName: "Take Profit",
                  timeframe: "15 minutes",
                  direction: "both",
                  triggerRules: "always",
                },
              ],
              riskManagementRules: "stop-loss: 1%; take-profit: 2%",
            },
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await answerAssistant({
      message: "Create me a Gold reversal strategy using a liquidity sweep followed by Fair Value Gap confirmation on the 15 minute timeframe.",
      messages: [],
      context: { page: "/strategy-builder" },
    });

    expect(response.strategyDraft?.marketSymbol).toBe("XAUUSD");
    expect(response.strategyDraft?.timeframes).toEqual(["15m"]);
    expect(response.strategyDraft?.conditions.map(condition => ({
      conceptName: condition.conceptName,
      stage: condition.stage,
      direction: condition.direction,
      triggerRules: condition.triggerRules,
      ruleSupported: condition.ruleSupported,
    }))).toEqual([
      { conceptName: "Liquidity Sweep", stage: "entry", direction: "both", triggerRules: "close crosses above previous low", ruleSupported: true },
      { conceptName: "Fair Value Gap", stage: "confirmation", direction: "both", triggerRules: "bullish", ruleSupported: true },
    ]);
    expect(response.strategyDraft?.riskManagementRules).toBeNull();
     expect(response.strategyDraft?.compatibility.unsupportedConditions).not.toContain("Liquidity Sweep");
     expect(response.strategyDraft?.compatibility.unsupportedConditions).not.toContain("Fair Value Gap confirmation");
    expect(response.strategyDraft?.compatibility.unsupportedConditions).not.toContain("Take Profit");
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

   it("does not trust a model-supported flag for concepts the engine cannot execute", async () => {
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
      message: "Build a bullish FVG strategy",
      messages: [],
      context: { page: "/strategy-builder" },
    });

     expect(response.strategyDraft?.conceptsUsed).toEqual(expect.arrayContaining([{
       name: "Exponential Moving Average (EMA)",
      supported: false,
      explanation: "The model should not be able to override this guardrail.",
    }]));
     expect(response.strategyDraft?.compatibility.unsupportedConditions).toContain("EMA crossover");
  });

  it("keeps an unsupported strategy request as a reviewable draft when the model omits one", async () => {
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
      name: "Exponential Moving Average (EMA)",
      supported: false,
      explanation: "Understood by the assistant, but not currently executable by historical backtesting.",
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
      "Fair Value Gap (FVG)",
      "Higher-timeframe bias",
      "Multi-timeframe analysis",
    ]));
    expect(response.strategyDraft?.compatibility.unsupportedConditions).toEqual(expect.arrayContaining([
      "Higher-timeframe bias",
      "Multi-timeframe analysis",
    ]));
     expect(response.strategyDraft?.compatibility.unsupportedConditions).not.toContain("Fair Value Gap (FVG)");
  });

  it("preserves the remaining taxonomy aliases as unsupported review metadata", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
     const requests = [
       { message: "Build me a liquidity sweep strategy.", expected: ["Liquidity Sweep"], unsupported: [] },
       { message: "Create an XAUUSD strategy using an FVG.", expected: ["Fair Value Gap (FVG)"], unsupported: [] },
       { message: "Use a 4H bullish bias and 15M entry.", expected: ["Higher-timeframe bias", "Multi-timeframe analysis"], unsupported: ["Higher-timeframe bias", "Multi-timeframe analysis"] },
       { message: "Build an SMC strategy using BOS and an order block.", expected: ["Break of Structure", "Order Block"], unsupported: ["Break of Structure", "Order Block"] },
       { message: "Use the 20 EMA as confirmation.", expected: ["Exponential Moving Average (EMA)"], unsupported: ["Exponential Moving Average (EMA)"] },
       { message: "Create a strategy using premium and discount.", expected: ["Premium", "Discount"], unsupported: ["Premium", "Discount"] },
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