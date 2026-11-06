# Design: Restructure folders, database, infra and code

Date: 2026-11-06. Status: waiting for owner approval. Size: project, delivered in seven checked stages.

## Why

The owner finds the project messy and asked for an expert cleanup of the database, infra, folders and code. It works today: the live database matches the Prisma schema and all 5 migrations are applied. The problem is that it is hard to navigate and easy to break by accident.

Measured on 2026-11-06:

- **Folders:** `tfix/` holds 22 stray test logs in the root. 16 backend modules, most of them one large `*.module.ts` holding controller and service together. `web/src/pages` mixes pages with helpers. Tests are split across `e2e/`, `apps/api/scripts/` and `apps/web/src/`.
- **Guardrails:** no git, `.gitignore`, linter, formatter or CI. `strict` is off in both apps, with 576 `any` types. API input has no validation library. 522 source lines exceed 200 characters. The API has no unit tests, though flow scripts exist.
- **Database:** 40 models in one 834-line schema. 67 of 71 foreign keys have no index. No CHECK rules. Several real relations have no foreign key.
- **Type conversion:** `src/db/fields.ts` converts values by column name across all tables. `date` is in both the date list and the timestamp list, and a midnight check tells them apart.

## Goals

1. Anyone on the team can find the code for a feature from the folder name.
2. Mistakes get caught automatically by types, lint, validation and database rules.
3. Every change can be undone through git.

## Owner's answers

- **No one else changes this code while the restructure runs,** including the owner and teammates' zip revisions. So no merge window or old-to-new path map is needed.
- **No production server exists yet.** `:8080` is the only running system. Production files in Stages 3 and 7 are prepared and documented, but there is no server rollout, crontab change or server data check.

## Non-goals

- New features or UI changes.
- Renaming tables or columns. The owner rejected this option (C).
- Rewriting the business logic.
- Changing the stack (NestJS, React, Ant Design, Prisma 7, Postgres).
- Tidying `~/Downloads`. `mtpp 2`, `mtpp 3` and the zips stay where they are. `mtpp 3` is an old Drizzle snapshot from 2026-11-04.

## Anti-goals: this has failed if

- An API response, URL, PDF or screen behaves differently, except where bad input is now rejected.
- The book's Lampiran C no longer matches table and column names.
- The main database at `:8080` is changed before the owner approves, or its data is lost. A read-only `pg_dump` for rehearsal is allowed. Protected data includes the owner's test quotation `SO/MTPP/2026/11/0001` (`rdadad`, Rp 0), which must stay unchanged.
- A teammate can't tell which code they own.

## Constraints

- **Project location and compose file stay.** The folder stays `~/Downloads/mtpp` and `docker-compose.yml` stays in the root. Moving the file changes the compose project name, which would point at new, empty `dbdata` and `storage` volumes.
- **Book:** table and column names stay. The 5 new relations in Stage 4 are new lines on the PDM, so Lampiran C needs those lines added.
- **Testing:** flows run only on a temporary compose project (`-p`, port 8081), never the main database. Browser tests use headless Playwright, never the owner's Chrome.
- **Prisma:** stays pinned at 7.10.1. Prisma queries are lazy, so fire-and-forget calls still need `.catch` or `.then`.
- **Docker:** each app keeps its own `package-lock.json`, because its Dockerfile runs `npm ci` from the app folder. So no npm workspaces (see Stage 2).
- **Owner decisions that must survive:** Operasional may see purchase prices on PO detail and PDF. DP 30/70 is printed text only. Red palette, never navy.

## Approaches considered

| | Changes | Trade-off |
|---|---|---|
| A. Tidy only | Git, tooling, stray files, indexes and rules | Lowest risk; code stays hard to read |
| **B. Tidy + restructure (picked by owner)** | A, plus code split by feature and input validation; names stay | Bigger job; book and API stay valid |
| C. B + rename the database | B, plus plain names such as `picking_id` → `transfer_id` | Most consistent; touches most queries and means redrawing Lampiran C |

## Target layout

```
apps/api/
  prisma/schema/       auth, master, sales, purchasing, stock, accounting, system (.prisma)
  prisma/migrations/   unchanged location, old migrations never edited
  src/modules/<name>/  <name>.controller.ts, <name>.service.ts, <name>.module.ts, dto/
  src/shared/          replaces common/: auth, pdf, numbering, chatter, files, settings, util
  src/db/              Prisma client, type conversion, seed
  scripts/seed/        mock-data
  scripts/examples/    api-client
apps/web/src/
  features/<name>/     home, sales, purchasing, billing, stock, accounting, master, settings, reports, documents
  shared/              ui, Crud, Chart, Chatter, hooks, lib
  app/                 main, Shell, auth, nav, styles
infra/
  nginx/  backup/  compose/ (test.yml, production.yml)
tests/
  e2e/                 Playwright scripts, own package.json
  flows/               demo-flow, edge-flow
docs/
  specs/  plans/  reports/  screenshots/  restore.md
```

Helpers move next to what uses them: `createPO` → purchasing, `createDelivery` → stock, `useCreateFromSale` and `nextSteps` → sales, `docCatalog` → documents. `tfix/` is deleted. `docs/superpowers/` moves to `docs/specs` and `docs/plans`, including this file. The two text reports go to `docs/reports`.

## Stages

Each stage ends with the checks below passing. The next stage doesn't start until they do.

**Standard check:** `tsc` for both apps, `node --test` for web, then a fresh temporary compose project running demo-flow, edge-flow and all four e2e scripts. Compare with the Stage 1 baseline.

### 1. Safety net
- `git init` in the project, with `.gitignore` covering `node_modules`, `dist`, `.env`, `.DS_Store`, `tfix/` and storage. Check that `.env` is not tracked before the first commit.
- First commit is the code as it stands, on the default branch. Work then continues on a `restructure` branch in a separate worktree, `~/Downloads/mtpp-restructure`. `~/Downloads/mtpp` stays on the default branch until the owner approves applying, because `docker compose up -d --build` there runs `prisma migrate deploy` against the main database. No remote and no push under this design.
- Record baseline results: flow outputs, plus saved API responses for key GET endpoints (values that vary, such as timestamps, normalised). Add PDF checks for one quotation and one invoice, comparing extracted text rather than bytes.

### 2. Tooling
- A root `package.json` holding only ESLint and Prettier, with scripts that call each app through `npm --prefix`. `npm run check` runs lint, types and unit tests.
- Prettier with a 120-character line, applied in one dedicated commit listed in `.git-blame-ignore-revs`. This commit changes formatting only.
- ESLint starts with `no-explicit-any` as a warning. Existing `any` doesn't block work.
- `.editorconfig`. A CI file is added only once a remote exists.

### 3. Folders
Moves and import updates only, no logic. Move `tfix/` out of the project first: delete it only after confirming the Stage 1 baseline covers it. Update README, `CARA-MENJALANKAN.txt` and the module table so each teammate's folders are still listed.

`backup.sh` needs care when it moves to `infra/backup/`:
- Its `cd "$(dirname "$0")/.."` must become `../..`.
- Its documented crontab line in the script and README changes to the new path. No server runs it yet.
- Update `docs/restore.md` and the nginx install comments to the new paths.

### 4. Database
Migrations are additive and generated by Prisma. Rehearse them before anything else on a fresh `pg_dump` of the main database, restored into a temporary compose project. Older dumps in `~/Downloads` predate migration 5 and the mock data, so don't use them. The API runs `prisma migrate deploy` at startup, so a migration that fails keeps the API down.

At the end of this stage, write `docs/reports/lampiran-c-changes.md` listing the relations actually added, for whoever updates the book. Redrawing the PDM is not part of this work.

- **Split the schema** into the 7 files above. `prisma migrate diff` must show no change from the split alone.
- **Index every foreign key** with `@@index`, using the 67 listed by the audit. Data is small, so a normal `CREATE INDEX` is fine.
- **Add foreign keys** on `sales_orders.user_id`, `journal_entries.reversed_entry_id`, `stock_transfers.backorder_id`, `messages.author_id` and `users.signature_attachment_id`, with the default no-action delete. All five have zero orphan rows today. Before adding each one, confirm in code what it refers to, and drop it from the list if it isn't that table. This makes deleting a referenced user fail, so check the user screen shows the normal "use Arsipkan" message.
- **Add CHECK rules on `state`**, listing allowed values from the code, not only those in today's data. Skip `email_logs.state` if it stores free-form status from the Brevo webhook.
- **Leave alone:** `create_uid`, `write_uid`, `res_id` and `change_logs.field_id`. `res_id` points at many tables, and audit columns add many foreign keys for little benefit.
- **Replace `fields.ts`** with conversion by model and column type, taken from the Prisma schema, so a new column can't convert wrongly by sharing a name. First write tests that pin today's output. The API contract stays: dates as `YYYY-MM-DD`, Decimal as number.

### 5. Backend code
One module per commit, in this order: smallest and least connected first, with `billing` and `sales` last. Split each `*.module.ts` into controller, service and module. Routes, permissions and responses stay identical.

Add validation with `class-validator` and a global `ValidationPipe` using `whitelist: true`, not `forbidNonWhitelisted`, so fields the frontend already sends don't start failing. Error messages stay in Indonesian.

Validation only rejects input that already fails or corrupts data. Current tolerance stays: `''` still becomes null and numeric strings are still accepted for ID fields. New business limits, such as rejecting negative quantities or discounts over 100, are out of scope, and any found are listed for the owner. `makeCrud` keeps its `writable` list and gains required and type checks.

Write unit tests first for money logic that gets moved: totals, tax, payment status and stock priority (`reservedAhead`). Use the `superpowers:test-driven-development` skill for any logic change.

### 6. Stricter types
Turn on `strictNullChecks` then `noImplicitAny`, then `strict`, removing `any` module by module. Prisma's generated types replace most of them. Reaching zero isn't required: if `web` or dynamic code like `makeCrud` costs too much, stop and report the remaining count so the owner can decide.

### 7. Infra
- `infra/compose/production.yml`: `APP_ENV=production`, `SEED_DEMO=false`, and `${VAR:?}` for `DB_PASSWORD`, `JWT_SECRET` and `WEBHOOK_TOKEN`, so production won't start without them.
- Local defaults in `docker-compose.yml` stay. Don't change the local `DB_PASSWORD`: the volume is already initialised with it.
- Add one README section listing commands for local, test and production.

## Applying to :8080

Only after all stages pass and the owner approves:
1. Take a database dump and a code archive, as was done on 2026-11-06.
2. `docker compose up -d --build`.
3. Run the read-only `nav-audit` and compare key GET responses with a capture taken just before applying.
4. Confirm `SO/MTPP/2026/11/0001` and the mock data are unchanged.

## Decided by Claude, for the owner to check

- Seven schema files, by business area.
- `class-validator` rather than zod, as it's the NestJS standard.
- Prettier with a 120-character line.
- No foreign keys on audit columns.
- Frontend pages are moved and typed but not split up. Backend modules are split.
- This spec is in English, while earlier specs are in Indonesian.
- Work happens in a separate worktree, so the running system isn't affected.
- A read-only dump of the main database is allowed for rehearsal.
- Validation stays at the current tolerance and adds no business limits.
- The book gets a handover note. Redrawing Lampiran C stays outside this work.

## Left to the builder

- Exact file for each model and helper, within the layout above.
- Which DTOs are needed per endpoint.
- ESLint rule set beyond those named.
- Module order inside Stage 5, within the rule given.
- How the conversion reads column types (Prisma's runtime metadata, or a generated file if that lacks native types).
