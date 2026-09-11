---
name: Background backtest jobs
description: Durable backtest execution, progress, cancellation, duplicate prevention, and result-read boundaries.
---

Background backtests must be represented by a persisted state machine, not an in-memory promise. The worker may resume queued or interrupted work after an API restart, while clients poll the saved job record for progress.

**Why:** Historical downloads and multi-timeframe evaluation can outlive a request and the browser session. Persisted progress also prevents the UI from implying that a result exists before candles and trades are committed.

**How to apply:** Keep duplicate detection limited to active identical jobs, preserve exact candle/strategy evaluation logic, make cancellation wins explicit at the final transaction boundary, and allow result reads only for `completed` jobs.