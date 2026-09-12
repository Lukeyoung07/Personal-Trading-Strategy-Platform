---
name: Backtest rule contract
description: Shared historical-rule compatibility semantics used by Builder and the server backtest engine.
---

The Builder’s compatibility presentation and the server backtest engine must consume the same shared historical-rule definitions and validator. Structured concepts such as Liquidity Sweep and Fair Value Gap must validate their parameter shape through that same contract rather than falling back to descriptive candle rules.

**Why:** Client-side compatibility drift can present a condition as executable when the authoritative historical engine rejects it, or hide a rule the engine supports.

**How to apply:** Extend the shared rule contract first, then update the evaluator and UI together. Keep unsupported concepts saved and reviewable, but never treat them as executable. Reject mismatched or invalid structured parameters instead of silently coercing them.

Canonical library labels should identify the executable concept family, while distinctions such as retest versus formation, polarity, direction, and indicator thresholds live in structured parameters.

**Why:** Alias-specific names otherwise fragment one executable definition across the assistant, Builder, library, and backtester, causing duplicate concepts or inconsistent support decisions.

**How to apply:** Normalize aliases to the existing family label before matching conditions, then preserve the requested behavior in typed parameters and trigger rules.

R-multiple take-profit rules are executable only when a supported percentage stop-loss defines the one-R distance; structural stops such as “below FVG” remain explicit review metadata.

**Why:** Applying an R target without a deterministic stop distance would fabricate a price level, while dropping a structural stop would misrepresent the user’s request.

**How to apply:** Preserve the normalized `risk/reward: NR` text through AI drafts and versions, reject it at backtest preflight without a numeric stop, and keep Builder compatibility aligned with the server.