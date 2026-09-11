---
name: Historical candle pagination
description: Durable rules for retrieving complete provider candle ranges and exposing honest backtest coverage.
---

Historical candle retrieval must not treat a short provider response as the end of a requested range. Providers may return newest-first windows even when a `from` boundary is supplied, so the collector must detect whether it can progress forward or must page backward with the `to` boundary. Every result must be deduplicated, chronologically ordered, and coverage-validated before the backtest engine runs.

**Why:** BiQuote currently returns bounded recent windows and can return fewer candles than the requested page size. Stopping on page length produced completed backtests with only recent candles while displaying the user’s longer requested range.

**How to apply:** Keep provider-specific cursor handling behind the market-data service, avoid arbitrary long-range truncation, preserve closed-candle metadata, and fail with the actual available range when the requested period is not covered.