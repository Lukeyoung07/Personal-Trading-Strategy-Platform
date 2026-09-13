---
name: Dynamic direction inheritance
description: Rules for handling conditions whose direction or polarity should come from another strategy condition.
---

Direction inheritance must never silently choose bullish, bearish, long, or short from model output. A draft that requests inheritance is review-required, keeps the target direction neutral, and records the source condition explicitly. When executable, the source must precede the target so backtest and monitoring can resolve the relationship deterministically.

**Why:** A model can provide a plausible fixed polarity even when the user asked for a dynamic relationship. Saving that guess changes the strategy while making the draft appear executable.

**How to apply:** Represent the dependency as `direction_from`; validate that it references an earlier source; evaluate the source direction first; and keep backtest, monitoring, builder UI, and canonical snapshots aligned.