---
name: Assistant backtest context
description: Backtest explanations require an explicitly selected completed persisted result.
---

The assistant must not call the model for a backtest explanation without an explicit backtest ID and completed persisted results. It should give clear context guidance for no selection, distinguish missing/unfinished records from provider failures, and pass stored statistics and available trade details without inventing values.

**Why:** A generic AI-unavailable message hid a missing-result-context problem and could invite explanations without evidence.

**How to apply:** Preserve the exact backtest and strategy-version IDs from the result route, load results through the existing persistence boundary, and keep no-data responses deterministic and honest.