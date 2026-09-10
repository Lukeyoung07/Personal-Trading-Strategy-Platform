---
name: Economic calendar boundaries
description: Provider-neutral event storage, deduplication, mappings, and disconnected-provider presentation.
---

Economic calendar records are provider-owned observations, not trading signals. Source keys and provider event IDs must remain stored, events without IDs need a stable identity derived from source and event facts, and market impact relationships belong in structured mappings rather than a hard-coded list.

**Why:** The workspace must not fabricate releases or infer recommendations while still being ready for forecast/actual/status revisions from a real calendar source.

**How to apply:** Keep provider adapters behind the economic-events service and registry, update event facts atomically, expose filters over normalized records, and show “No economic calendar data is currently connected.” when no provider is authorized.

Configured official providers refresh independently: a partial source failure must preserve healthy-source events and expose the unavailable source, while an all-source failure must return an explicit unavailable error rather than an empty success.

**Why:** The calendar now combines multiple official public schedules with different access methods and failure modes; one blocked or changed source should not hide genuine observations from the others.

**How to apply:** Keep provider-specific parsing and error capture inside adapters/service refresh, report connected and unavailable source names in normalized status, and only treat a refresh as successful when at least one configured source responds.

Market-specific event context must be resolved on the server from the selected instrument and normalized event fields: currency, region, explicit instrument mappings, and provider-owned market labels. The frontend should only select the instrument and relevance scope.

**Why:** A single matching rule prevents each client surface from inventing different interpretations of event relevance, while still allowing the calendar to remain provider-neutral.

**How to apply:** Add instrument-aware query parameters to the existing normalized event endpoint, preserve an explicit all-events scope, and keep unavailable-source errors distinct from an empty relevant result.