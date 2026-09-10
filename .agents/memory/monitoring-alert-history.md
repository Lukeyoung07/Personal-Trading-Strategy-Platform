---
name: Monitoring alert history
description: The boundary between strategy monitoring transitions and the in-app Alerts page.
---

Monitoring-generated alerts are durable in-app history records created only when a strategy monitor's overall status changes into a meaningful `met` or `invalid` state. They can be acknowledged in the UI, but they do not send notifications, place trades, or act as broker instructions.

**Why:** The product explicitly excludes notifications, broker execution, and trading recommendations while still needing a reviewable record when monitoring changes state.

**How to apply:** Keep future alert work inside the application history/acknowledgement boundary unless the product explicitly changes its exclusions and defines a delivery model.