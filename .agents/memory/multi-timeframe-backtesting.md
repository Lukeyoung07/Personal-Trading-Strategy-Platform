---
name: Multi-timeframe backtesting
description: Durable semantics for causal higher-/lower-timeframe historical evaluation.
---

Multi-timeframe backtests use the smallest loaded timeframe as the execution series, while each condition reads only its own timeframe's latest candle whose close is at or before the execution candle close.

**Why:** Using the current higher-timeframe candle at an earlier lower-timeframe decision introduces look-ahead bias; using only one series also makes valid zero-trade and short-side combinations impossible to verify.

**How to apply:** Load every distinct configured condition timeframe through the existing market-data service, persist closed candles with their timeframe IDs, keep exact selected dates, expose per-timeframe counts in results, and test a higher-timeframe close boundary explicitly.

For a `followed_by` relationship across timeframes, `maxBarsBetween` is measured on the target condition's candle series. A 1H source followed by a 5M target therefore counts 5M target bars after the source candle closes; it is not a source-timeframe count or a duration conversion.

**Why:** The target is the execution event being bounded, and using its series keeps the source-trigger timestamp aligned with the target's closed-candle decisions without look-ahead.

**How to apply:** Preserve this target-series rule in backtesting and monitoring, and add explicit cross-timeframe relationship tests whenever the relationship evaluator changes.