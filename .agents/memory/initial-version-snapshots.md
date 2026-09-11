---
name: Initial version snapshots
description: The invariant between strategy creation, mutable conditions, and the first immutable version.
---

When a strategy is created with conditions, the conditions and the initial immutable version snapshot must be written in the same transaction. A strategy response that succeeds while its v1 has no conditions is incomplete, even if the mutable Builder condition list is populated afterward.

**Why:** Backtesting and monitoring read exact immutable version snapshots, not the mutable Builder state. Creating v1 before inserting AI or initial Builder conditions makes the UI appear compatible while the exact version is empty.

**How to apply:** Extend the strategy-create contract for initial conditions, normalize parameters through the canonical concept definitions, insert the mutable conditions, and snapshot those persisted conditions into v1 before returning success. Keep post-create condition mutations for later Builder edits only.