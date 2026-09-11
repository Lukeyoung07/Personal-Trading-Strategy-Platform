---
name: Dukascopy current-period boundary
description: Dukascopy behavior when historical requests reach the current or future publication boundary.
---

Dukascopy can return HTTP 400 with `From time is too late` for daily 5m requests at the current/future date and for the current monthly 1h endpoint. This is a provider availability boundary, not evidence of malformed UTC formatting.

**Why:** A requested range can contain genuine older candles and still fail when pagination reaches an unpublished day or month. Treating the whole request as empty hides the usable partial range and can make a valid historical setup look broken.

**How to apply:** Preserve the exact endpoint and provider body in the error, persist successful pages incrementally, report the cached earliest/latest candles, and do not silently shorten the requested backtest.