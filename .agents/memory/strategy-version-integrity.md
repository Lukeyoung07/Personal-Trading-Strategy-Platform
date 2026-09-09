---
name: Strategy version integrity
description: Durable invariants for immutable strategy history, activation, and trade attribution.
---

Immutable strategy versions must store the historical display context they need instead of resolving names or definitions from mutable lookup records. Only one version may be active per strategy, and version numbers must be unique and allocated under a per-strategy transaction lock.

**Why:** Mutable concept or market records can otherwise make old snapshots appear changed, while concurrent saves can create duplicate version numbers or ambiguous active state.

**How to apply:** New snapshot fields must be copied from the working state or source snapshot. Trades remain permanently associated with one exact version, and performance is calculated only from trades linked to that version.