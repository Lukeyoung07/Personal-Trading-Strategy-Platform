---
name: BiQuote regression testing
description: Test-runner constraints and live verification expectations for the BiQuote market-data integration.
---

Frontend Vitest must use its standalone config rather than importing the application Vite config. The application config requires `PORT` and `BASE_PATH`, while jsdom tests also need the React plugin.

**Why:** Running the frontend test command through the application Vite config failed before test discovery because those runtime variables were absent; a plain Vitest transform also left classic JSX without `React` in scope.

**How to apply:** Keep frontend regression tests on the dedicated Vitest config. For full workspace production builds, provide the artifact runtime variables explicitly. Live checks should use temporary mapped instruments, then remove candles, mappings, and instruments and confirm the market-data summary is empty.