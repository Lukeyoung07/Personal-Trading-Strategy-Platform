---
name: Strategy builder assistant handoff
description: AI drafts must enter the Builder as an explicit review state before any strategy or version save.
---

AI draft actions should transfer the complete draft through session state and an action-specific Builder route. The Builder must force the draft review view even when existing strategies are present, show all conditions and compatibility warnings, import only resolvable concept references, and leave saving to explicit user confirmation.

**Why:** Navigating to the Builder without a forced draft state made both Review Strategy and Save as New Version appear to do nothing or show the default Builder.

**How to apply:** Keep supported rule normalization at the assistant boundary, preserve unmatched condition details for manual review, and treat the version API as the only path that creates an immutable version.

The Builder must read query parameters from `window.location.search`; the routing hook may expose only the pathname and omit the query string. Route changes should still trigger a re-read of the pending draft so a mounted Builder cannot ignore a newly requested assistant draft.

**Why:** A live navigation included `assistantDraft=1` in the browser URL and the stored draft was present, but parsing the routing hook's value treated the flag as absent and rendered the default form.

**How to apply:** Use the browser URL for query parsing, use route changes only as the effect trigger, and prefer the latest serialized draft over stale in-memory state.

Generated Builder drafts should be validated against the live concept, market, and timeframe catalogs before they reach review; unresolved references remain visible as warnings instead of being guessed or dropped.

**Why:** AI output can use aliases such as FVG or Gold, while the Builder requires exact catalog references. Mapping only against current records keeps the handoff editable without creating concepts or instruments that do not exist.

**How to apply:** Normalize recognized aliases to exact catalog names on the server, preserve unknown references in the draft, and keep the existing Builder as the only save path.