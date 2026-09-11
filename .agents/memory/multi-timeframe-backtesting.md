---
name: Multi-timeframe backtesting
description: Durable semantics for causal higher-/lower-timeframe historical evaluation.
---

Multi-timeframe backtests use the smallest loaded timeframe as the execution series, while each condition reads only its own timeframe's latest candle whose close is at or before the execution candle close.

**Why:** Using the current higher-timeframe candle at an earlier lower-timeframe decision introduces look-ahead bias; using only one series also makes valid zero-trade and short-side combinations impossible to verify.

**How to apply:** Load every distinct configured condition timeframe through the existing market-data service, persist closed candles with their timeframe IDs, keep exact selected dates, expose per-timeframe counts in results, and test a higher-timeframe close boundary explicitly.