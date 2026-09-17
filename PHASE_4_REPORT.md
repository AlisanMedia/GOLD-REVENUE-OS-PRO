# Phase 4 Report — Admin Control Plane

Status: **IMPLEMENTED — CLOUD VALIDATION PENDING**

Validated Phase 4 commit: **pending merge and cloud validation**

Real historical customer import: **LOCKED / NOT EXECUTED**

## Scope delivered

Phase 4 combines the existing authentication, tenant isolation, RBAC, Customer
OS, lifecycle, event/outbox, audit and dry-run import foundations into one
tenant-safe operations panel. All dashboard metrics and operational lists are
derived from the current database. No payment, subscription, agent or revenue
metric is synthesized.

No Telegram integration, customer messaging, AI/OpenAI runtime, crypto payment,
subscription business logic, channel access automation, survey automation,
renewal, win-back automation or Phase 5 module was implemented.

## Exact implementation versions

| Component | Version |
|---|---:|
| Node.js CI | 24.19.0 |
| pnpm | 11.19.0 |
| TypeScript | 5.9.3 |
| Next.js | 16.3.5 |
| React / React DOM | 19.2.8 |
| Supabase CLI CI | 2.117.0 |
| Supabase JS | 2.116.0 |
| `@supabase/ssr` | 0.12.7 |
| Vitest | 5.0.0 |

## Implemented screens and routes

| Route | Purpose | Backend authorization |
|---|---|---|
| `/admin` | Real dashboard metrics and recent operational evidence | all active tenant roles |
| `/admin/customers` | Server-paginated customer search and filters | all active tenant roles; PII projection varies by role |
| `/admin/customers/:id` | Customer 360, state/event/audit timelines and guarded manual transitions | detail for all; PII/transition/audit sections require capabilities |
| `/admin/attention` | Dead letters, failed processing, unresolved import review and import errors | super admin, manager, support, analyst |
| `/admin/events` | Payload-free event operations filters, retries and correlation chain | super admin, manager, analyst |
| `/admin/imports` | Dry-run batches and historical reconciliation gate | super admin, manager |
| `/admin/imports/:id` | Bounded dedup review and first 100 validation errors | super admin, manager |
| `/admin/imports/new` | Secure in-memory CSV/XLSX dry run | super admin, manager |
| `/admin/audit` | Immutable audit metadata and controlled evidence | super admin, manager |
| `/admin/system` | Safe database/event/outbox/scheduler health | super admin, manager, analyst |

The shell includes tenant, authenticated user, role, STAGING indicator,
role-filtered sidebar and responsive desktop/tablet behavior. Hiding a link is
not an authorization control: each data path validates the session, tenant and
role again in the server DAL, RPC/RLS or mutation endpoint.

## Data architecture and migration

Migration: `supabase/migrations/20260917055834_phase4_admin_control_plane.sql`

No new business-domain table was introduced. The migration adds tenant-first,
bounded read-model RPCs:

- `admin_customer_list`
- `admin_dashboard_metrics`
- `admin_event_list`
- `admin_needs_attention`
- `admin_audit_list`
- `admin_system_health`

All are `SECURITY DEFINER` with fixed `search_path`, explicit authenticated
tenant-role validation, bounded page sizes and explicit grants. The list APIs
never use service-role credentials in the browser.

Indexes added:

- customer admin filters, created time and assigned manager;
- import review status/classification;
- event authority/time;
- audit action/time and correlation/time.

Customer and event list APIs use database pagination and filters. Customer 360
queries are capped at 50 identities and 100 entries per memory, history, event,
transition and audit timeline; outbox correlation is capped at 200. Needs
Attention is capped at 200. Import rows are paginated by 100.

## RBAC matrix

| Capability | super_admin | manager | support | analyst | readonly |
|---|:---:|:---:|:---:|:---:|:---:|
| Dashboard/customer list/detail | ✓ | ✓ | ✓ | ✓ | ✓ |
| Raw customer identities | ✓ | ✓ | ✓ | — | — |
| Manual safe state transition | ✓ | ✓ | — | — | — |
| Payload-free event operations | ✓ | ✓ | — | ✓ | — |
| Needs Attention | ✓ | ✓ | ✓ | ✓ | — |
| Import review/dry run | ✓ | ✓ | — | — | — |
| Audit log | ✓ | ✓ | — | — | — |
| Audit before/after projection | ✓ | metadata only | — | — | — |
| System health | ✓ | ✓ | — | ✓ | — |

Raw event envelopes remain RLS-visible only to `super_admin` and `manager`.
Analysts use the payload-free event projection. Direct browser DML remains
revoked. Support, analyst and readonly roles cannot call the lifecycle mutation
service because the database independently enforces management RBAC.

## State management and import lock

Manual transitions call the Phase 3 `transition_customer_state` service with a
required reason, authenticated human actor, correlation ID and idempotency key.
Only non-financial edges that do not require a verified domain event are
offered. Database rules remain authoritative. Payment, access, subscription and
other trusted-event edges are not available as an admin bypass.

The historical import remains locked in two layers:

1. the commit API always returns HTTP 423 `IMPORT_EXECUTION_LOCKED`;
2. `authenticated` no longer has `EXECUTE` on `commit_import_batch`.

The read-only import screen carries the Phase 2 evidence: 225 unique review
records, 229 category flags with four overlaps, 46 rejected rows, 39 probable
matches, 31 ambiguous matches, 113 mixed-field flags and the unresolved
1,133–1,152 versus approximately 1,161 reconciliation gap. It does not contain
the raw workbook or grant import authority.

## Security controls

- Tenant IDs are derived from authenticated active membership, not request
  bodies.
- Every read model rechecks the tenant and role inside PostgreSQL.
- Customer identity PII is hidden from analyst and readonly roles by RLS and
  removed from their list projection.
- Event list and Customer 360 omit event payloads.
- Audit records remain append-only; manager projections suppress before/after
  evidence while super admins receive the already controlled/redacted values.
- Secrets, connection strings, service-role keys and secret keys are not
  returned by system health or included in client components.
- Direct URL and API access cannot bypass backend authorization.
- The lifecycle service and transition matrix remain the sole state mutation
  path; financial/access/subscription edges require trusted deterministic
  events.

Supabase Security Advisor result: **pending staging migration**.

## Tests and actual results

Local application checks executed on 2026-09-17:

| Check | Actual result |
|---|---|
| ESLint | PASS |
| TypeScript strict typecheck | PASS |
| Unit tests | PASS — 35 |
| Integration tests | PASS — 11 |
| Next.js production build | PASS — all Phase 4 routes compiled |
| Local browser automation | NOT VERIFIED — browser daemon unavailable in the execution sandbox; staging browser validation remains required |

New application tests cover the role/capability matrix, backend route guards,
server-side pagination contracts, import lock, secret-key exclusion, fake-metric
exclusion and forbidden financial transition options.

New `admin_control_plane.test.sql` pgTAP coverage includes:

- tenant-safe customer list filtering, search and pagination;
- dashboard aggregates and Customer 360 tenant scope;
- identity and raw-event PII restrictions;
- sanitized event filters;
- audit visibility and manager redaction;
- Needs Attention aggregation;
- safe system health;
- support/analyst/readonly denial paths;
- forbidden financial-state bypass;
- database-enforced import lock.

Database CI result: **pending GitHub Actions execution**. No database test is
reported as passing until the cloud Database job actually starts Supabase,
applies all migrations and executes pgTAP.

## Cloud and staging validation

| Check | Result |
|---|---|
| GitHub Application job | PENDING |
| GitHub Database job | PENDING |
| Supabase staging migration/history/lint/auth | PENDING |
| Supabase Security Advisor | PENDING |
| Vercel staging build/deploy/live validation | PENDING |

## Performance findings

- Customer/event/audit lists paginate in PostgreSQL with a hard maximum page
  size of 100.
- Tenant-first compound indexes match the principal filter/order patterns.
- Timeline and operational queue reads are explicitly bounded.
- Customer list profile/primary identity projection is performed in one query;
  no per-row application query loop is used.
- This design supports the expected 1,000–10,000-customer operating range
  without replacing the modular monolith or adding an external queue.

## Remaining risks and limitations

- Local pgTAP could not run because this execution environment has no Docker
  engine. The GitHub Database job is the required execution evidence.
- Customer 360 displays only the most recent bounded timeline windows; cursor
  pagination can be added if operating evidence exceeds those limits.
- System health is a current database snapshot, not an alerting/monitoring
  service.
- The Phase 2 historical import gate remains unresolved and locked.
- Revenue, payment, subscription and agent metrics remain unavailable because
  those domains do not yet exist.

## Manual actions

No new account, paid service or secret is required. After both GitHub CI jobs
pass on the merged Phase 4 commit, the existing staging workflow must be
manually dispatched with that exact SHA and `run_vercel=true`.

## Rollback notes

1. Do not delete audit, event, history or import-review evidence.
2. Roll back application routing by redeploying the last validated Phase 3
   commit while leaving the additive Phase 4 migration in place.
3. Revert read-model functions or policies only through a reviewed forward
   migration; do not edit staging or production schema manually.
4. Restoring `commit_import_batch` to `authenticated` is explicitly prohibited
   until the historical reconciliation gate is resolved and approved.

## Phase 5 prerequisites

- GitHub Application and Database jobs pass on the exact merged commit.
- Supabase staging migration, history, lint, auth smoke and Security Advisor are
  reviewed.
- Vercel staging build, deploy and live authenticated smoke test pass on the
  same commit.
- The historical import remains locked.
- Explicit owner approval is required. Phase 5 has not started.
