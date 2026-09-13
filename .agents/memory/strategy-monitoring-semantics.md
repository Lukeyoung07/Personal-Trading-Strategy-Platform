---
name: Strategy monitoring semantics
description: Durable evaluation, concurrency, reset, and transition rules for strategy monitoring.
---

Condition and reset prose is never executable. Condition detectors bind through immutable concept references, reset policies bind to an exact strategy version, and only registered typed evaluators may produce MET or NOT MET. Missing data or evaluators remain WAITING; structural defects are INVALID.

**Why:** Strategy rules are currently user-authored descriptions. Parsing them or inferring dependencies would fabricate trading conclusions.

**How to apply:** Supply detectors only closed normalized candles in chronological order, plus prior typed state; enforce chronology once with an explicit ascending sort after provider retrieval so a second reverse cannot silently restore newest-first order. Validate dependencies as explicit earlier-condition references. Guard persistence with both an evaluation revision and a monotonic activation epoch so concurrent or reactivated versions cannot accept stale progress. Persist state changes atomically with durable transition events; reactivation starts a fresh monitor session without deleting retained events.

Monitoring snapshots expose a provider-neutral market-data state (`live`, `stale`, `market_closed`, `disconnected`, `missing`, `error`, or `ambiguous`) separately from condition status. Automatic source resolution must return `ambiguous` when multiple enabled sources exist; it must never guess. A connection is considered stale after 15 minutes without provider data unless the provider reports a stronger state.

**Why:** Condition outcomes and provider health answer different questions. Conflating them made a waiting strategy look like a rule failure and hid the reason automatic multi-source evaluation could not proceed.

**How to apply:** Persist the normalized state on the monitoring session, show it in the UI, and keep insufficient candles or unavailable sources in WAITING. Treat the 15-minute threshold as a generic freshness policy, not an instrument- or provider-specific rule.

Followed-by relationships are executable temporal dependencies: the source trigger must precede the target and remain within the recorded bar window; monitoring retains the source trigger timestamp in typed evaluator state so the target can wait without treating the source as permanently met.

**Why:** A flat AND loses event order, while a transient source status cannot represent a valid setup between source and target evaluation ticks.

**How to apply:** Keep the backtest and monitoring window interpretation aligned, default newly created followed-by relationships to 20 bars when unspecified, and reject unsupported relationship types rather than evaluating them as unordered conditions.