---
name: Builder end-to-end cleanup
description: Safe cleanup boundary for temporary Builder and Backtest acceptance data.
---

Temporary end-to-end strategies should be created with no recorded journal trades and removed from Strategy Library after testing; deleting the strategy also removes its dependent backtest records.

**Why:** This preserves existing user strategies and trades while allowing a real provider-backed backtest to be exercised without leaving QA data behind.

**How to apply:** Use the actual Builder and Strategy Library UI for setup and deletion, then verify both the strategies and backtests collections are empty of the temporary records.