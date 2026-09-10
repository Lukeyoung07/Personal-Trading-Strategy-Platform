---
name: Economic calendar boundaries
description: Provider-neutral event storage, deduplication, mappings, and disconnected-provider presentation.
---

Economic calendar records are provider-owned observations, not trading signals. Source keys and provider event IDs must remain stored, events without IDs need a stable identity derived from source and event facts, and market impact relationships belong in structured mappings rather than a hard-coded list.

**Why:** The workspace must not fabricate releases or infer recommendations while still being ready for forecast/actual/status revisions from a real calendar source.

**How to apply:** Keep provider adapters behind the economic-events service and registry, update event facts atomically, expose filters over normalized records, and show “No economic calendar data is currently connected.” when no provider is authorized.