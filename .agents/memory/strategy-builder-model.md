---
name: Strategy builder model
description: Durable design rules for the no-code strategy builder and its concept-based condition flow.
---

Strategy conditions belong to the strategy itself and reference the shared Trading Concept Library; they are ordered checkpoints with user-defined stage, requirement, and rules rather than generated signals.

**Why:** The product needs a usable no-code strategy definition before strategy versions, market data, detection, or signal generation exist, and concept definitions must remain user-owned.

**How to apply:** Keep builder persistence descriptive and broker-independent. Preserve global condition ordering, allow manual reordering, and treat entry as a visual endpoint only until a future market-data layer is explicitly added.

Guided builder choices may map directly to the historical evaluator's supported OHLC phrases, but unsupported indicators or logical groupings must be visibly labeled as unsupported rather than presented as executable behavior.

**Why:** The builder should be approachable without creating a second rule language, and Backtesting must never imply that an unsupported rule can produce trustworthy historical results.

**How to apply:** Prefer exact supported phrases such as bullish, bearish, OHLC comparisons, and previous-candle crossings. Keep unsupported indicator and OR choices explicit in the UI until the model and evaluator are extended together.