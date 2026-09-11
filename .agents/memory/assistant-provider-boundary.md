---
name: Assistant provider boundary
description: The in-product trading assistant is intentionally constrained to the free OpenRouter route.
---

The trading assistant must use only OpenRouter's `openrouter/free` route through the server-side application endpoint. It must never call a provider directly from the browser, fall back to paid models, connect a broker, or invent data or results.

**Why:** The product is broker-independent and the user explicitly chose a free, server-protected provider with honest unavailable and rate-limit behavior.

**How to apply:** Keep provider credentials server-side, preserve exact strategy/version context, and treat provider failure as a visible workspace-safe state rather than silently changing providers.

Concept support labels are advisory model output; normalize them server-side with a deterministic alias taxonomy against the historical engine’s supported rule vocabulary. Structured Liquidity Sweep and Fair Value Gap aliases must resolve to executable parameters, while genuinely unsupported requests remain reviewable.

**Why:** Models can omit canonical names or describe a supported structured concept as prose, which can otherwise create false backtest warnings or downgrade it to a generic candle rule.

**How to apply:** Never trust a model-provided `supported` flag. Resolve Liquidity Sweep/FVG names, retest aliases, parameters, and canonical trigger labels through the shared executable definition before catalog validation; keep other unsupported concepts in compatibility warnings and reviewable drafts.