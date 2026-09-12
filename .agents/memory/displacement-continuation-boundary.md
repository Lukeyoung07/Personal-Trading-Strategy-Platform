---
name: Displacement and continuation boundary
description: Which price-delivery concepts are safe to execute from the existing candle model.
---

Displacement is executable only as an explicit OHLC/ATR rule: the closed candle body must meet a configured multiple of prior ATR and its close must be in a configured outer portion of the directional range. Generic continuation remains review-required until the user defines the event sequence or price relationship.

**Why:** “Displacement” can be made deterministic from data the platform already owns, but “continuation” can mean breakout follow-through, trend persistence, pullback completion, or several other non-equivalent rules. Mapping it to an existing breakout or retest would silently invent behavior.

**How to apply:** Keep displacement on the shared canonical evaluator used by Builder, backtesting, and monitoring. Do not alias continuation to another executable concept; retain an explicit request as review-required and ask for the intended objective rule before implementing it.