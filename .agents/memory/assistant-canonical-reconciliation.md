---
name: Assistant canonical reconciliation
description: Durable rules for reconciling AI strategy drafts with the canonical trading concept registry.
---

The assistant must resolve user-requested concept aliases through the canonical registry before classifying a phrase as unsupported. The user authorization determines the saved executable concept; model-provided labels may contribute parameters and wording, but must not introduce extra conditions or replace a requested concept with a related one. Specific interaction aliases such as FVG retest and directional indicator crosses need precedence over their broader base concepts.

**Why:** Model drafts can contain broader, polluted, or synonym labels, and the same request can mention both a family concept and a specific interaction. Letting model order or fuzzy matches control execution creates duplicate conditions, loses requested concepts, or silently changes review status.

**How to apply:** Keep alias resolution, authorization filtering, condition matching, and synthetic-condition expansion in one reconciliation path. When adding a canonical alias, add a regression case for both the direct alias and a polluted model draft. For overlapping session aliases, prefer the specific named session (for example New York) before the generic kill-zone fallback.