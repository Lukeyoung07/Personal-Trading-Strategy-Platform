---
name: Dukascopy historical API
description: Official Jetta candle access, verified TradeX symbols, chunking, and public rate limits.
---

The official Dukascopy Jetta API is a JSON endpoint at `https://jetta.dukascopy.com/v1`. The verified provider codes are `XAU-USD` for Gold vs US Dollar and `USATECH.IDX-USD` for US 100 Tech Index. The API returns delta-compressed arrays, so candle prices and timestamps must be reconstructed cumulatively. Direct 1-hour history is monthly; 1-minute history is daily and must be aggregated to 5-minute candles. Empty zero-valued records represent closed intervals and must be discarded.

**Why:** Dukascopy's public endpoint rate-limits concurrent historical requests with HTTP 429, even though individual older-date requests return genuine data. Treat long-range verification and retrieval as a throttled operation, not as parallel fan-out.

**How to apply:** Keep the provider request queue sequential with retry/backoff for 429 responses, send an explicit client user-agent, and persist each successful page before requesting the next one so a later 429 can resume from cached coverage. Dukascopy empty daily pages need a provider-specific one-day cursor advance; never treat a rate-limited, empty, or partial response as complete history.

Backtest candle persistence must be batched rather than inserted as one statement for a long multi-timeframe run.

**Why:** A 90-day XAUUSD run exceeded PostgreSQL's bind-parameter limit when all 5m and 1h candles were inserted together, even though retrieval and engine evaluation had completed successfully.

**How to apply:** Chunk large `backtest_candles` writes into bounded batches while preserving the existing strategy, engine, and source data unchanged.