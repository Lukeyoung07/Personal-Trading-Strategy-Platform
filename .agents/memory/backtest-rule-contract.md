---
name: Backtest rule contract
description: Shared historical-rule compatibility semantics used by Builder and the server backtest engine.
---

The Builder’s compatibility presentation and the server backtest engine must consume the same shared historical-rule definitions and validator. Structured concepts such as Liquidity Sweep and Fair Value Gap must validate their parameter shape through that same contract rather than falling back to descriptive candle rules.

**Why:** Client-side compatibility drift can present a condition as executable when the authoritative historical engine rejects it, or hide a rule the engine supports.

**How to apply:** Extend the shared rule contract first, then update the evaluator and UI together. Keep unsupported concepts saved and reviewable, but never treat them as executable. Reject mismatched or invalid structured parameters instead of silently coercing them.