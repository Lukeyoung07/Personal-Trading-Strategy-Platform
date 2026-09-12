---
name: Canonical condition snapshots
description: Why strategy conditions and immutable version snapshots retain canonical registry metadata
---

Strategy conditions and version-condition snapshots should retain canonical concept identity, registry version, status, executor kind, and the canonical definition alongside the existing display and parameter fields.

**Why:** The canonical registry can evolve while historical strategy versions must continue to explain which evaluator contract and review state applied when they were created. Additive nullable metadata preserves old rows and existing API contracts while making future version displays and audits deterministic.

**How to apply:** Populate the metadata when a condition is created or updated from a concept, copy it through duplication and activation paths, and expose it in the API schemas. Never rewrite historical display names or parameter JSON solely to backfill newer canonical definitions.