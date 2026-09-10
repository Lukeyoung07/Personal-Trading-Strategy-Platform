---
name: Assistant provider boundary
description: The in-product trading assistant is intentionally constrained to the free OpenRouter route.
---

The trading assistant must use only OpenRouter's `openrouter/free` route through the server-side application endpoint. It must never call a provider directly from the browser, fall back to paid models, connect a broker, or invent data or results.

**Why:** The product is broker-independent and the user explicitly chose a free, server-protected provider with honest unavailable and rate-limit behavior.

**How to apply:** Keep provider credentials server-side, preserve exact strategy/version context, and treat provider failure as a visible workspace-safe state rather than silently changing providers.