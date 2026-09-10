---
name: Market selection persistence
description: Rules for persisting the Market Monitor instrument and timeframe selection safely.
---

Persisted Market Monitor selections are only valid while the selected instrument still exists in the current provider-neutral catalog. When the catalog is empty or the stored instrument is absent, clear the selection before opening candles or quote streams.

**Why:** A smoke-test cleanup exposed that a deleted instrument ID in local storage could make the browser repeatedly reconnect to a mapping that no longer existed, even though the visible monitor showed the empty state.

**How to apply:** Validate stored instrument and timeframe IDs against freshly loaded active API data before enabling market-data queries or SSE connections; clear invalid state rather than retrying it.