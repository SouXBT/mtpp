# Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise folders, database, infra and code of the MTPP distribution system with no change in behaviour.

**Architecture:** Seven checked stages on a `restructure` branch in a separate worktree. A recorded baseline of flows, API responses and PDF text proves each stage changed nothing. The main database and `:8080` are untouched until the owner approves applying.

**Tech Stack:** NestJS 10, React 18, Ant Design 5, Prisma 7.10.1, Postgres 16, Docker Compose, ESLint, Prettier, class-validator, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-06-restructure-design.md`

## Global Constraints

- No table or column renames. API responses, URLs, PDFs and screens stay identical, except bad input now being rejected.
- `docker-compose.yml` stays in the root. The project folder stays `~/Downloads/mtpp`.
- Tests use a temporary compose project (`-p mtpp-rs`, port 8081), never the main database. Headless Playwright only.
- Prisma stays at 7.10.1. Each app keeps its own `package-lock.json`; no npm workspaces.
- Validation uses `whitelist: true`, not `forbidNonWhitelisted`. `''` still becomes null and numeric strings stay accepted for ID fields. No new business limits.
- No foreign keys on `create_uid`, `write_uid`, `res_id` or `change_logs.field_id`.
- No git remote and no push. `~/Downloads/mtpp` stays on the default branch until the owner approves applying.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A `date` column that is a timestamp in one table and a date in another must keep its exact JSON format. Pinned by the conversion tests in Task 6.
2. Deleting a user referenced by the new foreign keys returns the normal "Arsipkan" conflict, not a 500. Pinned in Task 5.
3. Existing rows and rows from every flow must pass the new CHECK rules, or the API won't start. Pinned by rehearsing on a dump in Task 5.
4. Fields the frontend sends that a DTO doesn't list must not be rejected, and `''` must still become null. Pinned by edge-flow plus Task 7's tests.
5. A raw `$queryRaw` result must keep its conversion, because it has no model. Pinned by the conversion tests in Task 6.

## Standard check

Used at the end of every task from Task 2. Run from the worktree:

```bash
tests/run-check.sh    # after Task 3; before that, the same steps with old paths
```

Passes when: `tsc` is clean for both apps, `node --test` passes, demo-flow prints `Semua pemeriksaan berhasil`, edge-flow prints `34 lulus, 0 gagal` (or the new total with 0 failed), all four e2e scripts exit 0, and `compare` reports no differences from the baseline.

---

### Task 1: Git and baseline

**Files:**
- Create: `.gitignore`, `tests/baseline/capture.mjs`, `tests/baseline/compare.mjs`, `tests/baseline/expected/*`

**Interfaces:**
- Produces: `node tests/baseline/capture.mjs <outDir>` (env `API`) and `node tests/baseline/compare.mjs <dirA> <dirB>` (exit 1 on any difference).

- [ ] **Step 1:** Write `.gitignore` covering `node_modules`, `dist`, `.env`, `.DS_Store`, `tfix/`, `storage`, `*.tsbuildinfo`.
- [ ] **Step 2:** `git init`, check `git status --ignored` shows `.env` ignored, then commit everything as the first commit.
- [ ] **Step 3:** Create the worktree: `git worktree add -b restructure ../mtpp-restructure`, and copy `.env` into it.
- [ ] **Step 4:** Write `capture.mjs`: logs in as `pimpinan@mtpp.co.id`, saves each GET list and detail endpoint to JSON, and the extracted text of one quotation PDF and one invoice PDF. Replace `createDate`, `writeDate`, `loginDate`, `sentAt`, `statusAt` and token-like values with fixed text.
- [ ] **Step 5:** Run on the untouched code: compose `mtpp-rs` on 8081, demo-flow, edge-flow, capture twice. `compare` between the two captures must report nothing, proving the capture is stable.
- [ ] **Step 6:** Commit `tests/baseline` with the expected output.

### Task 2: Tooling

**Files:**
- Create: `package.json`, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `eslint.config.mjs`, `.git-blame-ignore-revs`

- [ ] **Step 1:** Add root `package.json` with dev dependencies `eslint`, `typescript-eslint`, `prettier`, and scripts `lint`, `format`, `check`. `check` runs lint, `tsc` for both apps and `node --test` for web, calling apps through `npm --prefix`.
- [ ] **Step 2:** Prettier: `printWidth: 120`, `singleQuote: true`. ESLint: `no-explicit-any` as a warning, recommended rules otherwise as warnings for existing code.
- [ ] **Step 3:** Commit tooling.
- [ ] **Step 4:** Run `npm run format` in its own commit and list that commit's hash in `.git-blame-ignore-revs`.
- [ ] **Step 5:** Standard check. Expected: no differences.

### Task 3: Folders

**Moves, no logic:**

| From | To |
|---|---|
| `apps/api/src/common/` | `apps/api/src/shared/` |
| `apps/api/scripts/demo-flow.mjs`, `edge-flow.mjs` | `tests/flows/` |
| `apps/api/scripts/mock-data.mjs` | `apps/api/scripts/seed/` |
| `apps/api/scripts/api-client.mjs` | `apps/api/scripts/examples/` |
| `e2e/*.mjs`, `e2e/package*.json` | `tests/e2e/` |
| `e2e/compose.test.yml` | `infra/compose/test.yml` |
| `infra/nginx-https.conf` | `infra/nginx/nginx-https.conf` |
| `infra/backup.sh` | `infra/backup/backup.sh` (its `cd` becomes `../..`) |
| `docs/superpowers/specs`, `plans` | `docs/specs`, `docs/plans` |
| `docs/change-report-*.txt`, `docs/flow-review-*.txt` | `docs/reports/` |
| `apps/web/src/components/*` plus `hooks.ts`, `lib.ts` | `apps/web/src/shared/` |
| `apps/web/src/main.tsx`, `Shell.tsx`, `auth.tsx`, `nav.ts`, `nav.test.ts`, `styles.css` | `apps/web/src/app/` |
| `apps/web/src/pages/<Name>.tsx` | `apps/web/src/features/<name>/<Name>.tsx` |
| `createPO` | `features/purchasing/` |
| `createDelivery` | `features/stock/` |
| `useCreateFromSale`, `nextSteps`, `nextSteps.test` | `features/sales/` |
| `docCatalog` | `features/documents/` |

- [ ] **Step 1:** `git mv` everything above and update imports, `index.html`'s script path, the web `tsconfig` test exclude, and `ROOT` in `edge-flow.mjs` (`../..` from `tests/flows`).
- [ ] **Step 2:** Update paths in `README.md`, `CARA-MENJALANKAN.txt`, `docs/restore.md`, nginx comments and the backup crontab line; keep the teammates' module table accurate.
- [ ] **Step 3:** Create `tests/run-check.sh` running the standard check.
- [ ] **Step 4:** Standard check, then commit. `tfix/` is ignored and left in the main folder until Task 9.

### Task 4: Split the Prisma schema

**Files:** `apps/api/prisma/schema/{base,auth,master,sales,purchasing,stock,accounting,system}.prisma`, `apps/api/prisma.config.ts`

`base.prisma` holds generator and datasource. Mapping: auth = Users, Groups, GroupUsers, GroupPermissions. master = Partners, PaymentTerms, SalesPricelists, SalesPricelistItems, Units, ProductCategories, ProductTemplates, Products, SupplierPrices. sales = SalesOrders, SalesOrderLines. purchasing = PurchaseOrders, PurchaseOrderLines. stock = Warehouses, Locations, TransferTypes, StockTransfers, StockMoves, StockBalances, StockRules. accounting = Accounts, Journals, JournalEntries, JournalEntryLines, Payments, BankStatementLines. system = Messages, ChangeLogs, EmailLogs, Attachments, Activities, Settings, DocumentSequences, SavedFilters, ApiKeys, Documents.

- [ ] **Step 1:** Split by that mapping and point `schema` at `prisma/schema`, keeping `migrations.path: 'prisma/migrations'`.
- [ ] **Step 2:** Run `prisma migrate diff` against the old schema. Expected: no difference.
- [ ] **Step 3:** Standard check, then commit.

### Task 5: Indexes, foreign keys, CHECK rules

**Files:** schema files; a new migration under `apps/api/prisma/migrations/`; `docs/reports/lampiran-c-changes.md`

- [ ] **Step 1:** Add `@@index` for the 67 unindexed foreign keys.
- [ ] **Step 2:** Confirm in code what each of the 5 candidate relations refers to, and drop any that doesn't fit. Check `email_logs.attachment_id` orphans too, without adding a foreign key.
- [ ] **Step 3:** Add confirmed relations, default no-action delete.
- [ ] **Step 4:** Collect allowed `state` values per table from code. Add CHECK rules in the migration SQL. Skip `email_logs.state` if it stores free-form webhook status.
- [ ] **Step 5:** Add a flow test: deleting a referenced user returns 409 with the "Arsipkan" message, or the existing deactivation behaviour if users can't be deleted at all.
- [ ] **Step 6:** Rehearse: `pg_dump` the main database read-only, restore to `mtpp-rs`, start the API. Expected: migration succeeds and row counts match.
- [ ] **Step 7:** `prisma migrate diff`: schema and database match. Standard check. Write the Lampiran C note and commit.

### Task 6: Replace `fields.ts`

**Files:** `apps/api/src/db/convert.ts`, `apps/api/src/db/convert.test.ts`, `apps/api/src/db/db.module.ts`; delete `apps/api/src/db/fields.ts`

**Interfaces:**
- Produces: `toDb(model: string, args: unknown): unknown`, `fromDb(model: string, value: unknown): unknown`, `fromRaw(value: unknown): unknown`.

- [ ] **Step 1:** Write tests pinning today's output: a `@db.Date` column gives `YYYY-MM-DD`; a timestamp `date` column stays a `Date`; Decimal and bigint give number; a JSON field is untouched; nested includes convert by the related model; numeric strings for ints become numbers; `$queryRaw` midnight dates give `YYYY-MM-DD`.
- [ ] **Step 2:** Run against the current code by exporting the existing helpers. Expected: pass, except any test exposing a real difference, which gets reported.
- [ ] **Step 3:** Implement from `Prisma.dmmf` column types per model. If native types aren't exposed, generate a map from the schema in the build.
- [ ] **Step 4:** Run tests. Standard check. Commit.

### Task 7: Split backend modules and validate input

Order: `email`, `auth`, `users`, `dashboard`, `documents`, `records`, `settings`, `public-api`, `importer`, `master`, `stock`, `purchasing`, `reports`, `accounting`, `billing`, `sales`.

Each module ends as `<name>.controller.ts`, `<name>.service.ts` where a service exists or the controller holds substantial queries, `<name>.module.ts`, `dto/`.

- [ ] **Step 1:** Add `class-validator`, `class-transformer` and a global `ValidationPipe({ whitelist: true, transform: false })`. Body parameters typed `any` stay unaffected until given a DTO. Multi-controller modules get one controller file each.
- [ ] **Step 2:** Write unit tests first for totals, tax, payment status and `reservedAhead`, then move that code. Use `node --test` with `tsx`.
- [ ] **Step 3:** For each module, in order: split with no logic change, add DTOs for write endpoints with optional, tolerant fields, then run `tsc` and commit. After `master`, `purchasing` and `sales`, also run the standard check.
- [ ] **Step 4:** Extend `makeCrud` with type checks through a per-table rule list, keeping `writable`.
- [ ] **Step 5:** Standard check. List any missing business limits in `docs/reports/validation-gaps.md`.

### Task 8: Stricter types

- [ ] **Step 1:** In the API, turn on `strictNullChecks`, fix errors, standard check, commit.
- [ ] **Step 2:** Turn on `noImplicitAny`, then `strict`, and commit each.
- [ ] **Step 3:** Repeat for web.
- [ ] **Step 4:** Reduce explicit `any` module by module; replace with Prisma types. Report remaining counts. If the cost is too high for `web` or `makeCrud`, stop there and report to the owner.

### Task 9: Infra and final check

**Files:** `infra/compose/production.yml`, `README.md`

- [ ] **Step 1:** Write `production.yml`: `APP_ENV: production`, `SEED_DEMO: "false"`, and `${VAR:?}` for `DB_PASSWORD`, `JWT_SECRET`, `WEBHOOK_TOKEN`.
- [ ] **Step 2:** Verify: `docker compose -f docker-compose.yml -f infra/compose/production.yml config` fails with the variables unset and passes with them set.
- [ ] **Step 3:** Add README commands for local, test and production.
- [ ] **Step 4:** Add a note on `tfix/`: delete it from the main folder after confirming the baseline covers it.
- [ ] **Step 5:** Standard check, whole-branch code review, fix findings, commit.
- [ ] **Step 6:** Report to the owner and ask for approval to apply to `:8080` using the spec's "Applying to :8080" steps. Do not merge or apply before approval.
