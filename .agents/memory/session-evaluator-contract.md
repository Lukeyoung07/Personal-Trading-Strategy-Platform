---
name: Session evaluator contract
description: The deterministic contract for named trading sessions and kill zones.
---

Session concepts use an explicit IANA timezone, local start time, and local end time. Canonical named sessions supply configured defaults; custom values replace those defaults only when they pass typed validation. Membership is evaluated on completed candle timestamps, with the end boundary excluded.

**Why:** Fixed UTC offsets silently become wrong across daylight-saving transitions and can make historical backtests disagree with live monitoring.

**How to apply:** Keep session parameters in the shared executable registry and route both backtest and monitoring through the same local-time evaluator. Never replace the timezone with a hard-coded UTC offset.