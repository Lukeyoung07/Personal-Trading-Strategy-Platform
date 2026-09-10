---
name: Strategy builder assistant handoff
description: AI drafts must enter the Builder as an explicit review state before any strategy or version save.
---

AI draft actions should transfer the complete draft through session state and an action-specific Builder route. The Builder must force the draft review view even when existing strategies are present, show all conditions and compatibility warnings, import only resolvable concept references, and leave saving to explicit user confirmation.

**Why:** Navigating to the Builder without a forced draft state made both Review Strategy and Save as New Version appear to do nothing or show the default Builder.

**How to apply:** Keep supported rule normalization at the assistant boundary, preserve unmatched condition details for manual review, and treat the version API as the only path that creates an immutable version.