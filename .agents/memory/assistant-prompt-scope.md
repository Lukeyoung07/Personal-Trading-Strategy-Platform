---
name: Assistant prompt scope
description: Durable rules for preserving prompt section, timeframe, and nested-span context during AI draft reconciliation.
---

Resolver normalization must use the user prompt's enclosing instruction scope for stage and timeframe decisions instead of trusting a model condition's copied metadata. A concept mentioned as a possessive qualifier for another concept is descriptive context, not an additional requested condition.

**Why:** Model drafts can flatten a multi-timeframe sequence into one stage/timeframe and can promote qualifying words such as “pullback” into unsupported conditions. Fixing only individual aliases or regexes leaves the same context-propagation failure in other prompts.

**How to apply:** Identify section/timeframe spans before reconciling conditions, assign repeated concepts by occurrence within those spans, and classify nested mentions using the parent concept plus grammatical connector. Keep risk prose in the separate risk-rule parser.