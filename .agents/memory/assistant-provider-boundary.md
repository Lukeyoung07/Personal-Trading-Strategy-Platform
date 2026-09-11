---
name: Assistant provider boundary
description: The in-product trading assistant is intentionally constrained to the free OpenRouter route.
---

The trading assistant must use only OpenRouter's `openrouter/free` route through the server-side application endpoint. It must never call a provider directly from the browser, fall back to paid models, connect a broker, or invent data or results.

**Why:** The product is broker-independent and the user explicitly chose a free, server-protected provider with honest unavailable and rate-limit behavior.

**How to apply:** Keep provider credentials server-side, preserve exact strategy/version context, and treat provider failure as a visible workspace-safe state rather than silently changing providers.

Concept support labels are advisory model output; normalize them server-side with a deterministic alias taxonomy against the historical engine’s supported rule vocabulary, preserve unsupported requests in reviewable drafts, and enrich metadata from explicit user wording when needed.

**Why:** Models can describe an unsupported EMA, FVG, or multi-timeframe rule using a simple proxy condition or omit the canonical concept name, which can otherwise mislead users about backtest compatibility.

**How to apply:** Never trust a model-provided `supported` flag for known concepts. Keep alias families such as market structure, liquidity, FVG/order blocks, multi-timeframe, indicators, and risk concepts marked as AI understanding, add them to compatibility warnings, and only use a conservative fallback draft when an available strategy response omits the requested unsupported concept entirely.