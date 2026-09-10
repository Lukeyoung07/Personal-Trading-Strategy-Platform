---
name: Market catalog presentation
description: Product rules for presenting provider-backed instruments in the Market Monitor selector.
---

Use the provider catalog description as the human-facing market name and keep the provider symbol as secondary text. Empty categories should remain visible for discoverability but cannot be selected; show their unavailable status instead of inventing instruments.

**Why:** The catalog contains useful descriptions for beginner-friendly labels, while category availability changes with provider data and must not be represented with fabricated markets.

**How to apply:** Build selector categories and result cards from the live catalog response. Do not maintain a frontend alias table or add fallback instruments for empty categories.