---
name: Market data boundaries
description: Provider adapters, symbol mappings, connection truth, and normalized data ownership for future live-data work.
---

Provider symbols must map to canonical instruments per source, and only the market-data service may manage adapter connection state or normalize and persist provider data. Public clients can configure sources and mappings and read connection/data state, but cannot declare a source connected.

**Why:** This prevents provider-specific identifiers and caller-asserted connection states from leaking into strategies, and lets future monitoring consume canonical candles and quote events without rebuilding the data layer.

**How to apply:** Register concrete adapters with the market-data service, resolve provider symbols through source mappings, and use the service's candle or quote boundaries. Do not let adapters, UI routes, or strategy code write normalized market data or connection timestamps directly.