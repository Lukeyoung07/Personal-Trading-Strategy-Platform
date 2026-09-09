---
name: Strategy builder model
description: Durable design rules for the no-code strategy builder and its concept-based condition flow.
---

Strategy conditions belong to the strategy itself and reference the shared Trading Concept Library; they are ordered checkpoints with user-defined stage, requirement, and rules rather than generated signals.

**Why:** The product needs a usable no-code strategy definition before strategy versions, market data, detection, or signal generation exist, and concept definitions must remain user-owned.

**How to apply:** Keep builder persistence descriptive and broker-independent. Preserve global condition ordering, allow manual reordering, and treat entry as a visual endpoint only until a future market-data layer is explicitly added.