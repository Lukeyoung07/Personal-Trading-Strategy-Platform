---
name: Journal performance semantics
description: Rules for the Journal's daily and monthly realized-performance aggregation and day-note persistence.
---

Journal analytics must use the same realized-trade definition as the existing performance summary: closed trades with numeric P/L, dated by `closedAt` and falling back to `createdAt` when `closedAt` is absent. Calendar grouping uses the configured/requested timezone. No-trade days are excluded from trading-day averages and streaks; zero-P/L trading days are neutral rather than wins or losses. Day notes are persisted separately from individual trade notes.

**Why:** Calendar grouping, summary totals, streaks, and individual-day details must not disagree, especially around timezone boundaries or incomplete timestamps.

**How to apply:** Reuse the Journal performance endpoint and its date semantics for future Journal analytics. Do not include backtest trades, open/planned trades, invented fees, or synthetic empty-day P/L.