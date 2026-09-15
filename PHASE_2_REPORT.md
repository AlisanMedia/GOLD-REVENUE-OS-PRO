# Phase 2 Report — Customer OS

## Scope

Phase 2 adds the tenant-safe Customer OS foundation. No Telegram, messaging, agents, OpenAI runtime, payments, subscriptions, channel access, renewal, surveys, autonomous follow-ups or full analytics were implemented. The real historical customer dataset was not uploaded or imported.

## Schema and migrations

Migration: `supabase/migrations/202609150002_customer_os.sql`.

Tables added:

- `customers` (tenant-scoped canonical record and lifecycle state)
- `customer_identities` (email, Telegram username/user ID, external ID, phone; normalized and provenance tracked)
- `customer_profiles` (structured trading/customer fields)
- `customer_memory` (key/value memory with confidence and provenance)
- `customer_state_history` (append-only lifecycle history)
- `import_batches`, `import_rows`, `import_errors` (metadata, dry-run rows and validation errors)

Tenant composite foreign keys, uniqueness constraints, lookup indexes, state/name indexes and import status indexes are included. All new public tables have RLS enabled. Direct authenticated DML is revoked; reads are limited by tenant membership and import reads by manager/super_admin role. Privileged dry-run/review/commit RPCs are SECURITY DEFINER with auth and tenant-role checks, fixed search paths and explicit grants.

A redacted audit trigger records privileged customer/import mutations without copying PII into audit payloads. State history is append-only and automatically records initial and changed states.

## Import and deduplication architecture

CSV and XLSX are parsed in memory with size and row limits (4 MiB / 5,000 rows). Formula cells are rejected. Raw source files never enter GitHub. The authenticated import endpoint computes a SHA-256 fingerprint and calls the dry-run RPC under the operator's tenant RLS context.

Identity normalization covers lowercase/trimmed email, Telegram username and numeric ID, E.164-like phone normalization, and trimmed external IDs. Deduplication classifies every row as `exact_match`, `probable_match`, `ambiguous` or `new_customer`. Probable and ambiguous rows are held for manual review; no silent merge occurs. The commit RPC requires the exact owner confirmation phrase `IMPORT_APPROVED` and a super_admin role, and refuses unreviewed probable/ambiguous rows.

## Customer 360

The server-side data access layer loads the tenant-filtered customer, identities, profile, memory and state history in parallel. The minimum admin shell provides customer list, Customer 360, import batch status, reconciliation counts, dedup review and validation errors. Raw payloads are never returned by the import detail API.

## Tests executed

GitHub Actions CI run: [35009300541](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/35009300541)

- Application job: PASS — lint, typecheck, 16 workspace tests, Next production build, audit and bundle smoke test.
- Database job: PASS — Supabase start, migrations, migration history, database lint, foundation pgTAP, tenant isolation tests and Customer OS pgTAP.
- Customer OS pgTAP: 30 tests passed.
- Existing foundation pgTAP: 11 tests passed.
- Existing tenant isolation pgTAP: 6 tests passed.
- Domain unit tests: 8 tests passed (included in application test suite).
- No real customer dataset was used.

## Staging validation

Pending the post-merge staging workflow. The staging workflow must run against Supabase project `gold-revenue-os-staging` only, with Vercel disabled until staging database/auth checks are confirmed. This section must be updated with the workflow URL, migration result and authentication smoke result before Phase 2 is closed.

## Security findings and limitations

- Raw import rows remain tenant-protected in the database but are sanitized from API responses.
- Import commit is intentionally a separate, explicit super_admin operation; the Phase 2 UI does not execute it.
- Identity resolution is deterministic and conservative; fuzzy matching and full event processing remain future work.
- The XLSX reader intentionally supports the bounded import subset rather than arbitrary workbook features.
- Human takeover and outbound kill-switch remain documented P0 architecture, not Phase 2 messaging runtime.
- Staging and production are separate; no production infrastructure was touched.

## Manual actions

No new paid service or external credential is required for Phase 2 implementation. The operator must later provide the private dataset through the secure staging import path described in `PHASE_2_IMPORT_READINESS.md` and explicitly approve its dry-run report. Do not paste customer data into GitHub issues, commits or chat.

## Rollback notes

Before rollback, stop import operations and retain the dry-run batch report. Revert the Phase 2 application commit and apply a reviewed down migration only if no Phase 3 data depends on these tables. Never delete the source dataset as a rollback action. Any committed import requires a data-level remediation plan rather than an automatic destructive rollback.

## Phase 3 prerequisites

Approve this report and the dry-run design; confirm a secure dataset transfer path; review identity conflict outcomes; and keep the existing state-machine, audit and kill-switch contracts unchanged. Phase 3 may then add the event engine, but not before explicit approval.
