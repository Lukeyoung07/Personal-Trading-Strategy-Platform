---
name: Breakout concept boundary
description: Objective previous-candle high/low rules map to the canonical Breakout evaluator without separate long/short registry rows.
---

The concept library keeps one canonical Breakout definition. Explicit long and short breakout requests are represented by direction and bullish/bearish price-action polarity, including objective “close above/below the previous candle high/low” wording.

**Why:** The validation contract requires exact two-sided breakout drafts without inventing unrelated concepts, while the registry should avoid duplicate concepts for direction variants.

**How to apply:** Preserve Breakout as the canonical concept name; use aliases and request authorization to retain Long Breakout and Short Breakout intent, then normalize each condition to the shared price-action evaluator.