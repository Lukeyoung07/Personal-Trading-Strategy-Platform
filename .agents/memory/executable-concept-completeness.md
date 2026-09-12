---
name: Executable concept completeness
description: The cross-layer contract for adding a deterministic strategy concept.
---

A concept is not executable until its canonical registry, parameter normalization, Builder controls, shared backtest evaluator, candle-history requirement, monitoring adapter, and regression tests agree on the same typed rule.

**Why:** Omitting the candle requirement or monitoring adapter can make a rule appear supported in the Builder while producing insufficient-data or evaluator-unavailable states in live monitoring.

**How to apply:** Treat the canonical executable registry as the starting point and verify both historical backtesting and the built-in monitoring detector before marking a concept supported.