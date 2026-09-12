---
name: Universal assistant rule contract
description: Durable boundaries for the universal typed rule representation and its Builder handoff.
---

The assistant-to-Builder contract is additive: keep legacy condition fields and JSONB parameters for persisted compatibility, while optional canonical type, typed validation, provenance, relationship, execution status, and structured risk metadata travel with new drafts.

**Why:** Existing strategies, versions, monitoring sessions, backtests, and historical records must remain readable and must not be silently reinterpreted when the assistant gains richer parsing.

**How to apply:** Let the Builder persist executable `parameters` and the existing risk narrative into the established strategy/version contracts. Do not turn unsupported or ambiguous wording into executable rules. Preserve requested temporal relationships (`after`, `followed_by`, `while`, `or`) as review-required metadata unless the shared backtest and monitoring evaluators explicitly implement them. Treat explicit percentage stops as defining R targets; structural stops remain review-required.