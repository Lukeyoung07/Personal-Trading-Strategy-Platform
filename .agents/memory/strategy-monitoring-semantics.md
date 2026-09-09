---
name: Strategy monitoring semantics
description: Durable evaluation, concurrency, reset, and transition rules for strategy monitoring.
---

Condition and reset prose is never executable. Condition detectors bind through immutable concept references, reset policies bind to an exact strategy version, and only registered typed evaluators may produce MET or NOT MET. Missing data or evaluators remain WAITING; structural defects are INVALID.

**Why:** Strategy rules are currently user-authored descriptions. Parsing them or inferring dependencies would fabricate trading conclusions.

**How to apply:** Supply detectors only closed normalized candles in chronological order, plus prior typed state. Validate dependencies as explicit earlier-condition references. Guard persistence with both an evaluation revision and a monotonic activation epoch so concurrent or reactivated versions cannot accept stale progress. Persist state changes atomically with durable transition events; reactivation starts a fresh monitor session without deleting retained events.