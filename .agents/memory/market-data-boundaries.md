---
name: Market data boundaries
description: Provider adapters, symbol mappings, connection truth, and normalized data ownership for future live-data work.
---

Provider symbols must map to canonical instruments per source, and only the market-data service may manage adapter connection state or normalize and persist provider data. Public clients can configure sources and mappings and read connection/data state, but cannot declare a source connected.

**Why:** This prevents provider-specific identifiers and caller-asserted connection states from leaking into strategies, and lets future monitoring consume canonical candles and quote events without rebuilding the data layer.

**How to apply:** Register concrete adapters with the market-data service, resolve provider symbols through source mappings, and use the service's candle or quote boundaries. Do not let adapters, UI routes, or strategy code write normalized market data or connection timestamps directly. Chart zoom and pan may reorganize genuine loaded candles, but must not synthesize bars or imply unsupported historical retrieval.

Market overview values must stay honest about their source: derive current price and movement from the live quote or loaded candles, label candle-derived high/low/open as loaded ranges rather than provider session statistics, and show unavailable fields such as volume as unavailable.

**Why:** The reference layout asks for compact market information, but the provider contract does not guarantee every session field. Explicit provenance preserves trust instead of filling the panel with plausible-looking values.

**How to apply:** Prefer provider values when available; otherwise calculate only from genuine loaded bars and label the scope. Never call a loaded range “today” or infer volume from candle count.