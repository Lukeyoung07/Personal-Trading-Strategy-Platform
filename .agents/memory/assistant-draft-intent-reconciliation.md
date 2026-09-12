---
name: Assistant draft intent reconciliation
description: The boundary between free-form model output and executable Builder conditions.
---

The assistant must reconcile model-generated conditions against concepts, timeframes, directions, stages, parameters, and risk rules explicitly present in the user request. Model condition order is not evidence of user intent; unrelated model rows must be discarded, requested omissions may be synthesized for review, and duplicate directional rows must be deduplicated after normalization.

**Why:** A model can return plausible but unrequested filters or duplicate long/short rows. Trusting those rows or mapping them positionally causes the Builder draft to differ from what the user asked for.

**How to apply:** Keep this reconciliation server-side before the draft reaches the Builder. Use the canonical executable concept registry for labels, kinds, and parameter normalization, and preserve unsupported requested concepts as review-required instead of substituting them.