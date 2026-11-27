# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Web-based distribution system for PT Mentari Timur Prima Perkasa (capstone project): NestJS 10, React 18 + Ant Design 5, Postgres 16, Prisma 7.10.1 (pinned, with `@prisma/adapter-pg`), Docker Compose. UI text, error messages and code comments are in Indonesian. The business rules and the module-owner table are in `README.md`.

## Commands

Run from the repo root unless noted. There are no npm workspaces: each Dockerfile runs `npm ci` from its app folder, so `apps/api`, `apps/web`, `tests/e2e` and the root each have their own `package-lock.json` and need their own `npm install`.

```bash
docker compose up -d --build     # main stack on http://localhost:8080
npm run check                    # format:check, lint, generated-columns check, typecheck, unit tests
npm run format                   # Prettier
tests/run-check.sh               # check + full flows and browser tests on a temporary stack
```

Single unit test:

```bash
cd apps/api && node --import tsx --test src/db/convert.test.ts
cd apps/web && node --test src/app/nav.test.ts
# add --test-name-pattern='...' to filter by test name
```

`apps/web`'s `npm test` lists its test files by name, so add new ones to that script.

Flows and browser tests, on the test stack:

```bash
docker compose -p mtpp-nav -f docker-compose.yml -f infra/compose/test.yml up -d --build
API=http://localhost:8081/api node tests/flows/demo-flow.mjs   # then edge-flow and collection-flow, in this order, on a fresh DB
node tests/e2e/alur-po-pelanggan.mjs                           # BASE defaults to :8081
docker compose -p mtpp-nav -f docker-compose.yml -f infra/compose/test.yml down -v
```

Schema change, from `apps/api`: edit `prisma/schema/*.prisma`, then `npm run db:migrate`, then `npm run db:gen-columns`. `npm run check` fails if the generated file is out of date.

## Rules for working here

- **Never run write scripts against the main database on `:8080`.** That covers `demo-flow`, `edge-flow`, `collection-flow`, `validation-flow`, the `alur-*` scripts, `mock-data` and `mock-6-bulan`. Only `nav-audit` is safe there (`BASE=http://localhost:8080`). The owner's test quotation `SO/MTPP/2026/11/0001` (`rdadad`, Rp 0) must stay unchanged.
- **The test stack must be named `-p mtpp-nav`,** because `edge-flow` hardcodes it, and it runs on port 8081.
- **Keep `docker-compose.yml` in the root and the folder name `mtpp`.** The compose project name comes from the folder, so changing either points at new, empty `mtpp_dbdata` and `mtpp_storage` volumes.
- **`docker compose up -d --build` on the main stack applies pending migrations to the main database,** because the API image runs `prisma migrate deploy` at start. A failing migration keeps the API down.
- **Browser tests use headless Playwright,** never the owner's Chrome.
- **Keep table and column names.** The capstone book's Lampiran C documents them. New relations must be reported for the book, as in `docs/reports/lampiran-c-changes.md`.
- **Red palette (`#90241D`), never navy.**
- **Owner decisions that aren't bugs:** Operasional may see purchase prices on PO detail and PDF. DP 30/70 is printed text only, not a down-payment invoice.

## Architecture

**Request path:** Nginx in the web container serves the React build and proxies `/api` to NestJS. `AuthGuard` is registered globally, so routes need `@Public()` to skip login, and they declare access with `@Perm(menu, action)`, checked against `group_permissions` (5 groups). Requests can also authenticate through the `public-api` module's `X-API-Key` routes under `/api/v1`.

**Database conversion:** `apps/api/src/db/db.module.ts` wraps Prisma in a `$extends` layer that converts every query through `db/convert.ts`. This is the API contract: `@db.Date` columns are `YYYY-MM-DD` strings and Decimals are numbers, in and out. Conversion goes by model and column type. Prisma's runtime metadata lacks native types and required flags, so these come from `db/columns.generated.ts`, which is generated from the schema files. Prisma queries are lazy, so a fire-and-forget call does nothing without `.catch` or `.then`.

**Backend modules:** `apps/api/src/modules/<name>/` holds controller, service, module and `<name>.dto.ts`. Simple master tables have no hand-written controller: `shared/crud.ts`'s `makeCrud()` generates routes from a `writable` and `required` config, as used in `master.module.ts` and `accounting.module.ts`. Master deletes go through `safeDelete`, which turns a foreign-key failure into the "Gunakan Arsipkan" message.

**Validation:** the global pipe (`shared/validation.ts`) uses `whitelist: true` with `transform: false`. A field missing from a DTO is **silently dropped** before it reaches the service, so add it to the DTO whenever a service starts reading a new body field. Validators such as `IsNumeric` and `IsId` keep existing tolerance: `''` becomes null and numeric strings are accepted. Business limits such as negative quantities aren't enforced here; see `docs/reports/validation-gaps.md`.

**Cost visibility:** purchase price and margin are removed on the server by `stripCost` (`shared/auth.ts`), based on `canSeeCost`. New responses carrying cost fields must pass through it.

**Stock:** free stock is physical minus reserved, and the earlier-confirmed SO owns stock first (`StockService.reservedAhead`). Stock moves create no journal entries (periodic inventory).

**Environment flags:** `MOCK_DATE_HEADER=true` (test stack only, ignored when `APP_ENV=production`) lets the `x-mock-date` header set the business date of a request through `shared/clock.ts`; `today()` and `nowDate()` read it, so use `nowDate()` instead of `new Date()` for business timestamps. The Docker image always sets `NODE_ENV=production`, so the production safety checks in `main.ts` key off `APP_ENV`. Without `BREVO_API_KEY`, email runs in simulation mode and logs a `simulasi` status. Production settings are in `infra/compose/production.yml`, enabled through `COMPOSE_FILE` in `.env`.

**Frontend:** `apps/web/src/app` has the entry point, shell and menu (`nav.ts`, pure and unit-tested). `features/<area>` holds pages and their helpers, and `shared` holds common components. Pages call the `api` axios instance from `shared/lib.ts`.

**Behaviour comparison:** `tests/baseline/capture.mjs` records GET responses and PDF text, and `compare.mjs` compares two recordings. The recordings in `tests/baseline/expected` are gitignored and date-dependent, so create them the same day, before changing code: `tests/baseline/fresh-run.sh tests/baseline/expected <logdir>`. `capture.mjs` calls `/products/:id/price` without `partnerId`, so the `*_price` recordings only capture its 400 and don't exercise price lookup.
