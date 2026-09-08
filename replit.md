# Tandem Trading Workspace

A broker-independent workspace for designing, journaling, monitoring, and reviewing personal trading strategies without automated execution.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/trading-strategy-platform/src/App.tsx` — responsive workspace UI and route surface
- `artifacts/trading-strategy-platform/src/index.css` — dark workspace theme and reusable visual primitives
- `lib/api-spec/openapi.yaml` — source of truth for the typed API contract
- `artifacts/api-server/src/routes/trading.ts` — API handlers for the trading workspace
- `lib/db/src/schema/index.ts` — Drizzle schema for strategy, journal, market, alert, performance, and settings records

## Architecture decisions

- The product is broker- and asset-class-independent: market records store user-defined asset class, venue, and symbol instead of assuming a futures, forex, or equity workflow.
- Market monitor and alerts manage personal records only; there is no quote feed, broker connection, or automated execution path.
- Performance is derived from closed journal trades and renders an explicit no-data state until the user records real results.
- Backtesting is intentionally a placeholder route so it can be added later without implying simulated performance exists today.

## Product

Tandem gives a trader one quiet workspace for strategy hypotheses, reusable concepts and conditions, strategy versions, personal market lists, trade journaling, data-backed performance review, alerts, and workspace preferences.

## User preferences

- Keep the interface professional, dark, responsive, and low-clutter.
- Do not invent strategies, market data, performance data, broker integrations, AI, or automated trading.

## Gotchas

- After changing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`.
- API and frontend are separate managed artifacts; restart the existing managed workflows after backend or frontend changes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
