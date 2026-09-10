---
name: BiQuote runtime integration
description: Environment-specific constraints for the initial server-side BiQuote SignalR adapter.
---

The BiQuote SignalR client runs server-side through Node transport dependencies and must remain external to the API esbuild bundle.

**Why:** Bundling the client caused its dynamic Node transport imports to fail at runtime even though the TypeScript build passed. The working setup loads the package natively and keeps provider credentials out of the browser.

**How to apply:** Preserve the external-package treatment in the API build and keep live browser delivery behind the normalized server-sent-event stream. Validate real REST candles and live quotes after dependency or build changes.