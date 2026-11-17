# CLAUDE.md — VSEV engineering standards

This file is the source of truth for coding standards. Read it before changing anything.
Customer-facing copy is Traditional Chinese; technical documentation and code comments are English.

## Layout

```
apps/storefront   consumer SPA (React 18 + Vite)                  → /api/v1/*
apps/admin        operations SPA (separate bundle + auth)        → /api/v1/admin/*
apps/api          modular monolith (Express + SQLite via better-sqlite3)
packages/shared   zod schemas, enums, error codes, money, order state machine, CTA gate
packages/ui       design tokens (tokens.css, light theme), tread motif, shared React components
```

## Hard rules (enforced by `pnpm lint` where possible)

1. **Named exports only.** No `export default` (tool config files excepted).
2. **Module layering** inside `apps/api/src/modules/<name>/`:
   `router → service → repository`. The router has zero business logic; only `*.repository.sqlite.ts` touches the database.
   Every port also has a `*.repository.memory.ts`; the API test suite runs against both and they must agree.
3. **Cross-module calls are service → service only.** Never import another module's repository.
4. **Side effects go through domain events + queues.** `order` must never import `notification`,
   `loyalty` or `maintenance`; they subscribe to events instead.
5. **Money and points are integers.** Money is stored in minor units (`amountCents`, 100 = NT$1).
   Points live in a **ledger** (`points_ledger`); a balance is always a sum, never a column.
6. **Points and referral validation are backend-only.** No client code may write points or validate referral codes.
7. **Order status changes only via `OrderService.transition()`**, which checks the transition table in
   `@vsev/shared`, writes an `OrderEvent` audit row and publishes the matching domain event.
8. **Timestamps are UTC** in the database and over the wire (ISO-8601); format to Asia/Taipei in the UI only.
   In SQLite they are TEXT from `Date#toISOString()`, so text comparison = time comparison.
9. **Two auth audiences.** Storefront and admin tokens use different secrets and `aud` claims.
10. TypeScript `strict` everywhere. No `any`; validate all I/O boundaries with zod from `@vsev/shared`.

## CTA gate (storefront purchase button)

The buy button is enabled only when ALL of: vehicle model chosen, install shop chosen, install deadline acknowledged.
The logic lives in `@vsev/shared` (`evaluateCtaGate`) so UI and API agree. The API re-checks the same conditions on `POST /orders`.

## Theming

Light theme is the default. Colors, fonts and the `.tread` divider live in `packages/ui/src/tokens.css` as CSS
custom properties — use `var(--maxxis)` etc., never hard-coded hex values in app CSS. When a background gets lighter, accents get deeper to hold contrast
(MAXXIS orange `#F5741E` → `#E8650F`). Typography: Barlow Condensed (display), Noto Sans TC (body), Barlow (numerals).

## Database (SQLite)

- Schema lives in `apps/api/src/platform/sqlite.migrations.ts`. Migrations are **append-only**: never edit a
  shipped entry; add a new one. The API migrates on boot and refuses to start on a newer schema than it knows.
- STRICT tables + CHECK constraints mirror `@vsev/shared` enums. When you add an enum value, add a migration.
- SQLite allows one writer process: run **one** API instance per database file.
- Use `?` placeholders only — better-sqlite3 does not accept numbered `?1` placeholders with positional args.
- Back up with `pnpm db:backup` (online backup API), never by copying the live `.db` file.

## Connectors (docs/connectors.md)

- External systems are reached only through `apps/api/src/connectors/` adapters. Modules never import them;
  they expose plain methods (`syncFromFeed()`) or ports (`modules/order/commerce.port.ts`).
- Every external response is validated against the contracts in `packages/shared/src/connectors.ts`.
- Master data (vehicle models, shops) is **synced and mirrored locally**, never fetched per request.
  A failed sync keeps the last good data; an empty feed is refused; missing items are deactivated, never deleted.
- Orders are always created and validated locally; an external cart only takes the payment.
  Commerce webhooks require an HMAC signature and a matching `externalRef`, and are idempotent per `eventId`.

## Deployment (docs/deploy-portainer.md)

- Images are built only by GitHub Actions and pushed to GHCR; Portainer pulls `docker-compose.yml` (no `build:` in it).
  `docker-compose.build.yml` is the local/CI override that builds from source.
- Every new env var must be added to the `x-api-env` block in `docker-compose.yml` and to `stack.env.example`.
- The storefront port must never serve `/api/v1/admin/*`, and the admin port only serves `/api/v1/admin/*`
  (`docker/nginx/default.conf.template`); `scripts/smoke-test.sh` checks both.
- `/api/v1/health` reports `APP_VERSION` (the git SHA baked into the image); the deploy job waits for it.

## Commands

```
pnpm install
cp .env.example .env
pnpm db:seed        # creates ./apps/api/data/vsev.db (migrates automatically)
pnpm dev            # api :4000, storefront :5173, admin :5174
pnpm typecheck && pnpm test && pnpm lint && pnpm build
```
