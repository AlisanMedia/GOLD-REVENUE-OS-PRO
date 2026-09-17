# Phase 3 Report — State + Event Engine

Status: **IMPLEMENTED LOCALLY — CLOUD VALIDATION PENDING**

Real historical customer import: **LOCKED / NOT EXECUTED**

## Scope delivered

- Deterministic customer transition RPC with row locking, explicit expected
  state, transition guards and idempotency keys.
- Append-only state history and transition-attempt evidence.
- Versioned central domain event store with correlation and causation IDs.
- Transactional PostgreSQL outbox, idempotent consumer inbox, processing
  attempts, exponential retry and dead-letter state.
- `FOR UPDATE SKIP LOCKED` event dispatcher claims and scheduled-job claims.
- Scheduled-job enqueue, retry, completion and dead-letter primitives.
- Tenant-safe RLS and read-only management diagnostics.
- Minimum customer/event diagnostics UI and guarded transition API.
- Phase 2 import gate clarification; no data import or persistence occurred.

No Telegram, messaging, AI runtime, payment provider, subscription engine,
channel access engine, surveys, autonomous followups or analytics module was
implemented. Their event names are contracts only.

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
| Zod | 4.6.2 |
| Vitest | 5.0.0 |

## Migration

`supabase/migrations/202609160002_state_event_engine.sql`

### New types

- `lifecycle_actor_type`: `SYSTEM`, `HUMAN`, `AGENT`, `WEBHOOK`, `SCHEDULER`
- `event_authority`: `UNTRUSTED`, `TRUSTED`

### New tables and indexes

| Table | Purpose | Key indexes/constraints |
|---|---|---|
| `domain_events` | Append-only event store | tenant/idempotency, customer/time, correlation chain, type/time |
| `event_outbox` | Durable leased delivery | unique tenant/event, pending/lease scan, tenant/status |
| `event_inbox` | Consumer idempotency | unique tenant/event/consumer, tenant/status |
| `event_processing_attempts` | Append-only dispatch evidence | tenant/event/time |
| `customer_state_transition_attempts` | Accepted/rejected transition evidence | tenant/idempotency, customer/time, correlation |
| `scheduled_jobs` | Future lifecycle scheduling base | tenant/idempotency, due/lease scan, tenant/status |

Private global configuration tables:

- `private.event_contracts`
- `private.customer_state_transition_rules`

All new public tables have RLS enabled. `anon` and `authenticated` receive no
DML grants. Tenant `super_admin` and `manager` roles receive RLS-filtered read
access for diagnostics. Worker mutation RPCs are `service_role` only; the human
transition RPC additionally validates the authenticated tenant role and actor.

## State transition architecture

`transition_customer_state` performs, in one transaction:

1. tenant/RBAC and actor validation;
2. idempotency lookup;
3. `SELECT ... FOR UPDATE` on the tenant/customer row;
4. expected-state and transition-matrix validation;
5. trusted triggering-event validation for money/access/subscription gates;
6. durable `customer.state_changed` event plus outbox insert;
7. guarded customer state update;
8. append-only state history and attempt record;
9. explicit privileged audit record.

Expected business rejection returns an observable rejected result and maps to
HTTP 409. It does not mutate customer state. Direct `customers.state` updates
are rejected by a database trigger unless the guarded service transaction set
the private transition context. Browser roles have no direct update grant.

### Complete transition matrix

| From | Allowed to |
|---|---|
| `NEW` | `CONTACT_READY` |
| `CONTACT_READY` | `CONTACTED` |
| `CONTACTED` | `REPLIED` |
| `REPLIED` | `QUALIFIED` |
| `QUALIFIED` | `OFFER_SENT` |
| `OFFER_SENT` | `INTERESTED`, `NOT_INTERESTED` |
| `INTERESTED` | `PAYMENT_PENDING` |
| `NOT_INTERESTED` | `SURVEY_OFFERED` |
| `SURVEY_OFFERED` | `SURVEY_COMPLETED` |
| `SURVEY_COMPLETED` | `TRIAL_ACTIVE` |
| `TRIAL_ACTIVE` | `INTERESTED`, `EXPIRED` |
| `PAYMENT_PENDING` | `PAID` |
| `PAID` | `ACCESS_GRANTED` |
| `ACCESS_GRANTED` | `ACTIVE` |
| `ACTIVE` | `RENEWAL_DUE` |
| `RENEWAL_DUE` | `RENEWED`, `EXPIRED` |
| `RENEWED` | `ACTIVE` |
| `EXPIRED` | `CHURNED` |
| `CHURNED` | `WINBACK` |
| `WINBACK` | `INTERESTED` |

Guarded financial/access/subscription edges require a persisted, tenant- and
customer-matching event with `TRUSTED` authority and the exact required event
type. An `AGENT`/LLM event marked `UNTRUSTED` cannot verify payment, access or
subscription state.

## Event and outbox architecture

Every event carries tenant/customer, event type/version, actor, producer,
authority, correlation, causation, occurrence time and immutable payload. The
database validates the event type/version and required payload keys against the
contract registry. Producer/idempotency keys are unique per tenant.

The event and its outbox row are inserted in the same transaction. A worker
claims due rows with a bounded lease and `SKIP LOCKED`. Before a consumer runs,
it acquires the unique tenant/event/consumer inbox key. Completed inbox entries
cause duplicate deliveries to be skipped. Failures release the outbox with
bounded exponential backoff; the configured maximum attempt enters
`dead_letter` without deleting evidence.

Event contracts are defined at version 1 for all requested events plus
`customer.updated` and the internal `lifecycle.transition_rejected` evidence
event. Future business modules are not present.

## Concurrency and atomicity

- Row locks serialize competing transitions for one customer.
- `expected_from_state` turns the losing request into `stale_state` rather than
  corrupting the lifecycle.
- Unique transition idempotency prevents duplicate history/events.
- Event + outbox + state + history + audit share one transaction.
- Append-only triggers reject event, history and attempt tampering.

## Minimum diagnostics

- Customer 360 shows current state, history, triggering event, event history,
  accepted/rejected attempts and correlation IDs.
- `/admin/events` shows event version/authority, outbox processing result,
  retries, error/dead-letter state and correlation/causation chain.
- `POST /api/v1/customers/:id/state` accepts a strict schema and derives tenant,
  human actor and actor ID from the authenticated session.

## Tests and actual results

Local application checks executed on 2026-09-16:

| Check | Result |
|---|---|
| ESLint | PASS |
| TypeScript strict typecheck | PASS |
| Unit tests | PASS — 35 |
| Integration tests | PASS — 5 |
| Next.js production build | PASS — 16 routes |

Database tests added:

- all 23 allowed transitions;
- forbidden and stale transitions;
- direct-mutation guard and append-only enforcement;
- RLS/tenant isolation and grants;
- duplicate transition/event delivery;
- idempotent consumers;
- retry and dead-letter paths;
- event/outbox atomicity and correlation chain;
- trusted payment-event enforcement;
- scheduled-job idempotency/lease/completion;
- actual two-session concurrent transition serialization.

Database execution: **PENDING GitHub Actions**. No database test is marked PASS
until the cloud Database job actually runs it.

## Staging validation

- GitHub Application job: PENDING
- GitHub Database job: PENDING
- Supabase staging migration/lint/auth validation: PENDING
- Vercel staging build/deploy/health validation: PENDING

## Security findings

- Direct lifecycle writes were the Phase 2 gap; they are now denied by grant
  and trigger, with one guarded RPC path.
- LLM-attributed events have no authority to verify payment/access/subscription.
- Service-role dispatcher functions remain server-only and must never enter a
  browser bundle, model context or logs.
- Event payloads must remain metadata-minimal; customer PII should stay in the
  Customer OS and be referenced by ID.
- RLS does not protect service-role misuse; credential scope and server-only
  injection remain mandatory operational controls.

## Performance considerations

- Partial indexes serve due outbox and scheduled-job scans.
- Claims are bounded to 100 rows and use `SKIP LOCKED` for horizontal workers.
- Customer and correlation timelines have tenant-first indexes.
- PostgreSQL is appropriate at current scale. External queue infrastructure is
  deferred until measured outbox lag, connection pressure or throughput proves
  it necessary.

## Remaining risks and limitations

- Phase 3 provides dispatcher and scheduler primitives, not a continuously
  hosted worker. A later runtime phase must choose the execution host and alert
  on lag/dead letters.
- Event schema compatibility is versioned but no upcaster is needed until a v2
  contract exists.
- Payment/subscription/access contracts are inert; their verification adapters
  and business records belong to later phases.
- The 225-record Phase 2 manual-review gate and 1,133–1,152 versus ~1,161 count
  reconciliation remain unresolved. Real import is still blocked.

## Rollback notes

1. Stop dispatcher/scheduler invocations before rollback.
2. Do not down-migrate after Phase 3 events or transitions exist without first
   exporting immutable evidence and approving data loss.
3. Application rollback is safe only while the Phase 3 migration remains;
   older code will ignore new tables but direct state writes will stay guarded.
4. A schema rollback requires a reviewed forward remediation migration. Never
   drop event/history/audit tables ad hoc.

## Phase 4 prerequisites

- Cloud Application and Database jobs green on the exact merged commit.
- Supabase and Vercel staging validation green on that same commit.
- Dead-letter/transition diagnostics manually readable by the staging admin.
- Explicit owner approval. Phase 4 has not started.
