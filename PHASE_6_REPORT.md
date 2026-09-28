# Phase 6 Report — Agent Runtime + Deterministic Worker

Status: **implemented and cloud-validated**  
Validation date: **2026-09-27 UTC / 2026-09-27 Europe/Istanbul**  
Validated implementation SHA: `dab00cf279c95ef63e85d48a972228e5972e50b9`  
Implementation merge SHA: `cf36d04b405cefe0d67001adcb357c329af704db`  
Repository: `AlisanMedia/GOLD-REVENUE-OS-PRO`

## Scope and enforced boundaries

Phase 6 establishes the secure execution foundation for future agents. It does not implement sales behavior, qualification strategy, persuasion, autonomous customer replies, payment, subscription, access automation, surveys, renewal, win-back, bulk messaging, cold outreach, or the historical customer import.

Staging defaults to `SHADOW`. Model output is untrusted and cannot directly mutate lifecycle, payment, subscription, access, tenant permissions, messaging kill switches, or provider state. Human approval records evidence only; it does not send a Telegram message.

The real historical customer import remains **LOCKED**. The unresolved 225-record manual-review set and the 1,133–1,152 versus approximately 1,161 reconciliation gate remain mandatory before any real import.

## Architecture

The runtime remains inside the modular monolith and reuses the Phase 3 PostgreSQL event store/outbox/inbox and the Phase 5 messaging gateway.

`domain event -> transactional outbox -> leased worker -> idempotent inbox consumer -> agent task -> bounded context -> model adapter -> validated structured proposal -> human review`

Key properties:

- PostgreSQL is the durable work and state authority.
- Vercel Cron invokes a protected deterministic worker every minute.
- `FOR UPDATE SKIP LOCKED`, leases, unique idempotency keys, and the existing inbox prevent concurrent double-processing.
- The worker never calls Telegram directly and never generates an outbound message while processing Phase 5 backlog.
- No Redis, BullMQ, Vercel Queue, or other paid queue was introduced.
- The first provider is a deterministic mock adapter, so no OpenAI credential or AI usage charge was required.

## Migration and persistent model

Migration:

- `supabase/migrations/20260926220326_phase6_agent_runtime.sql`

New enums:

- `agent_execution_mode`: `SHADOW`, `HUMAN_APPROVAL`, `AUTONOMOUS`
- `agent_runtime_status`: `QUEUED`, `RUNNING`, `WAITING_FOR_APPROVAL`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `TIMED_OUT`, `DEAD_LETTER`
- `agent_approval_status`: `pending`, `approved`, `rejected`, `edited`, `expired`
- `conversation_runtime_mode`: `AI_ACTIVE`, `HUMAN_TAKEOVER`, `PAUSED`

New tables:

- `agent_definitions`
- `agent_versions`
- `agent_tasks`
- `agent_runs`
- `agent_run_attempts`
- `agent_proposals`
- `agent_tool_calls`
- `agent_tool_results`
- `model_invocations`
- `agent_worker_heartbeats`
- `data_retention_policies`
- private `agent_tool_registry`

All tenant data is tenant-keyed. Cross-tenant foreign keys use `(tenant_id, id)` constraints. Runtime tables exposed in `public` have RLS enabled. Authenticated reads require active membership; privileged writes are mediated by role-checking RPCs. Worker mutation RPCs are revoked from `public`, `anon`, and `authenticated` and granted only to `service_role`. The private tool registry is not exposed to browser roles.

## Agent definition and versioning

Definitions are tenant-scoped and keyed by `agent_type`. Versions persist:

- prompt template;
- output schema version;
- allowed tool names;
- model provider and model;
- provider configuration reference;
- timeout;
- maximum attempts and retry policy;
- publication and supersession timestamps.

Only one non-superseded version may exist per agent definition. The initial `conversation_shadow` agent is created deterministically with model `mock/deterministic-shadow-v1`, execution mode `SHADOW`, and safe read/draft tool declarations. Future prompts are versioned data rather than hardcoded sales prompts.

## Task and run lifecycle

`message.received` is consumed idempotently into one `conversation.shadow_draft` task using an event-derived idempotency key. A claimed task creates a numbered run and immutable attempt evidence. Successful shadow execution persists:

- the structured output;
- model invocation metadata;
- draft proposal;
- proposed tool calls, if valid;
- `WAITING_FOR_APPROVAL` on both task and run.

Human review supports `approved`, `rejected`, and `edited`. The original proposal remains preserved; an edit is stored separately with reviewer, timestamp, and optional reason. Review is audited and creates `agent.task_completed`; it still reports `message_sent=false`.

Cancellation, timeout, retry scheduling, failure category, error code, and terminal dead-letter status are durable. Status values are database enums and shared TypeScript constants to avoid drift.

## Worker deployment and outbox processing

Deployment model:

- protected endpoint: `GET /api/internal/agent-worker`;
- authentication: timing-safe comparison of `Authorization: Bearer <CRON_SECRET>`;
- runtime: Node.js;
- maximum invocation duration: 60 seconds;
- schedule: Vercel Cron `* * * * *`;
- event batch: 25;
- task batch: 10;
- lease: 120 seconds;
- worker heartbeat and result counters are persisted.

Event processing calls the Phase 3 inbox functions before domain consumption. Duplicate delivery therefore resolves as already consumed and the outbox row can be completed safely. Task claim uses row locking with `SKIP LOCKED`; an active lease cannot be claimed twice. Expired leases can be reclaimed after a crash.

Retry is bounded by the versioned `max_attempts`. Retryable model failures return the task to `QUEUED` with exponential delay capped at 60 seconds. Non-retryable or exhausted tasks become `DEAD_LETTER`. Event-processing failures follow the existing Phase 3 retry/dead-letter path.

## Existing four-event backlog reconciliation

The authoritative Phase 5 closeout backlog contained three `message.received` events and one `message.sent` event.

Staging worker evidence from workflow run `36342651890`:

| Invocation | Events claimed | Events completed | Events failed | Tasks claimed | Waiting approval | Tasks failed |
|---|---:|---:|---:|---:|---:|---:|
| Worker 1 | 4 | 4 | 0 | 3 | 3 | 0 |
| Worker 2 | 3 | 3 | 0 | 0 | 0 | 0 |
| Worker 3 | 0 | 0 | 0 | 0 | 0 | 0 |

Disposition:

- all four pre-existing messaging outbox rows were completed;
- the three inbound events each produced exactly one shadow task and one pending proposal;
- the one `message.sent` event was observed without creating an agent task;
- the three runtime-generated `agent.task_created` events were consumed on the second pass;
- the third pass proved an empty replay produced no additional work;
- outbound message count remained `1`;
- no Telegram provider call or duplicate message occurred.

Authoritative staging snapshot after drain:

| Metric | Result |
|---|---:|
| Agent tasks | 3 |
| Waiting approval | 3 |
| Pending outbox | 0 |
| Processing outbox | 0 |
| Completed outbox | 7 |
| Dead-letter outbox | 0 |
| Agent dead-letter | 0 |
| `message.received` events | 3 |
| `message.sent` events | 1 |
| Outbound messages | 1 |
| Outbound kill switch | `false` / DISABLED |
| Latest worker completion | `2026-09-27T19:01:20.271787+00:00` |

## Model provider abstraction

The domain interface supports:

- structured request and response;
- timeout and rate-limit classification;
- retryable versus non-retryable failures;
- provider and model identity;
- provider request ID;
- latency;
- input/output/total tokens when reported;
- billed amount and currency when reported.

The staging adapter is `DeterministicShadowProvider`. It validates context and returns schema-validated output. It intentionally reports token and billing fields as unavailable rather than inventing usage or cost. OpenAI is not connected in Phase 6.

## Structured output contract

System actions never depend on free-form prose. Output schema version 1 requires:

- `classification`;
- `proposed_response`;
- `confidence` between 0 and 1;
- `escalation_recommended`;
- at most eight versioned `proposed_tool_calls` with object arguments.

Unknown properties, invalid confidence, oversized drafts, malformed tool arguments, unregistered tools, or tools missing from the agent version fail safely. Text that merely resembles a tool call is conversation content and cannot execute a tool.

## Tool gateway and AI trust boundary

Registered safe tools:

- `customer.get_context`
- `customer.get_profile`
- `customer.get_memory`
- `conversation.get_context`
- `conversation.get_recent_messages`
- `event.get_context`
- `message.create_draft`

Each tool is versioned, schema-validated, capability-checked, restricted by the agent version, tenant-validated, and designed for idempotent evidence. `message.create_draft` requires human approval and is not executable through the read-tool path.

Not exposed:

- arbitrary SQL;
- arbitrary HTTP/fetch;
- shell execution;
- generic database writes;
- direct Telegram/provider calls;
- lifecycle/payment/subscription/access mutation.

The backend, RLS, RBAC, state transition service, Phase 5 contactability checks, human-takeover state, and kill switch remain authoritative. An LLM cannot declare a payment confirmed, move a customer to a guarded state, or bypass a disabled outbound channel.

## Context builder

Context is assembled deterministically and tenant-scoped from:

- customer lifecycle state;
- selected profile fields;
- active structured memory;
- contactability;
- conversation runtime mode;
- recent conversation messages;
- recent related event types.

Limits:

- 20 messages;
- 24 memory items;
- 12 recent event types;
- 4,096 characters per message;
- 16,000 total message characters;
- 64,000 maximum serialized context characters.

The manifest records what was included and the applied limits, not credentials. Secret-shaped keys such as service role, database password, Telegram bot token, authorization, and cookie are rejected before model invocation. Customer prompt-injection text remains inert message content.

## Human approval and takeover

Approval capability is limited to `super_admin`, `manager`, and `support`. `analyst` and `readonly` cannot review proposals. Human review is audited with redacted content evidence.

Conversation controls:

- `AI_ACTIVE`
- `HUMAN_TAKEOVER`
- `PAUSED`

Support may enforce takeover/pause; returning to `AI_ACTIVE` requires manager or super-admin. Customer-facing execution is allowed only when all conditions are true: non-shadow mode, approved action, `AI_ACTIVE`, and tenant outbound messaging enabled. Phase 6 does not wire an AI send operation even when those conditions are met.

## Admin observability

New screens:

- `/admin/agents`: status-filtered, server-paginated task list plus queued/running/waiting/dead-letter health and latest worker time;
- `/admin/agent-runs/[id]`: run, context manifest, proposal, model metadata, tool proposals, attempts, and approval/edit/reject controls.

The UI does not expose provider credentials, API keys, service-role keys, full secrets, or raw internal credentials.

## Usage and cost accounting

`agent_runs` and `model_invocations` can store provider/model, provider request ID, latency, token counts, billed amount, and billed currency. This supports later cost-per-conversation, lead, conversion, agent, and model analysis. Mock staging values remain null because the provider supplies no real billing metadata.

## Retention and redaction

`data_retention_policies` provides tenant-level configuration points for:

- message content;
- model inputs/outputs;
- tool evidence;
- operational logs;
- deletion mode (`hold`, `redact`, `delete`).

No existing staging evidence was destructively deleted. Production durations remain an explicit unresolved business/legal-owner decision (`legal_owner_decision_required=true`) rather than an invented default. Operational error details are redacted and bounded; audit before/after data records approval state without copying proposal content.

## Security findings

Validated controls:

- tenant A cannot read or operate tenant B agent data;
- tenant ID is derived and revalidated at database/tool boundaries;
- service-role, database, Telegram, cron, and provider secrets never enter model context or the browser bundle;
- prompt injection cannot change system policy, capabilities, tenant, RBAC, or lifecycle authority;
- model output cannot bypass schema validation or execute unregistered tools;
- analyst/readonly cannot approve;
- human takeover and outbound kill switch are mandatory gates;
- shadow execution cannot send;
- guarded financial/access lifecycle state remains unchanged;
- worker endpoint rejects missing or incorrect `CRON_SECRET`;
- no high-severity dependency vulnerability was reported by `pnpm audit --audit-level high`.

Security caveat: `service_role` necessarily operates the worker boundary. Its scope is limited by private/revoked RPCs, fixed code paths, tenant-keyed functions, and server-only environment handling; it is never sent to the model.

## Actual test results

Final implementation CI: [GitHub Actions run 36322606072](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/36322606072)

| Suite | Actual result |
|---|---:|
| Application job | PASS |
| Database job | PASS |
| Unit tests | 48 PASS |
| Integration tests | 22 PASS |
| Foundation pgTAP | 11 PASS |
| Tenant isolation pgTAP | 6 PASS |
| Customer OS pgTAP | 35 PASS |
| State/Event pgTAP | 50 PASS |
| Admin Control Plane pgTAP | 37 PASS |
| Messaging Gateway pgTAP | 49 PASS |
| Agent Runtime pgTAP | 44 PASS |
| Concurrent transition serialization | PASS |
| Auth smoke | PASS |
| Lint / typecheck / production build | PASS |
| Dependency audit at high severity | PASS; no known vulnerabilities |

Phase 6-specific coverage includes task idempotency, duplicate delivery, leases, crash recovery, bounded retry, dead-letter, run lifecycle, structured-output validation, timeout/rate-limit mapping, tool schema/capability checks, cross-tenant denial, approval/rejection/edit evidence, human takeover, kill switch, prompt injection, secret exclusion, no direct lifecycle mutation, and financial/access-state protection.

## Cloud validation

Staging workflow: [GitHub Actions run 36342651890](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/36342651890)

| Gate | Actual result |
|---|---|
| Validated SHA | `dab00cf279c95ef63e85d48a972228e5972e50b9` |
| CI gate | Application PASS; Database PASS |
| Supabase staging migrations | PASS |
| Supabase migration history | PASS |
| Supabase linked database lint | PASS |
| Supabase staging auth smoke | PASS |
| Vercel isolated staging build/deploy | PASS |
| Canonical staging alias | PASS |
| Staging HTTP validation | PASS |
| Protected worker invocation | PASS |
| Existing backlog drain | PASS |
| Telegram live registration | Not requested; intentionally skipped |

Validated deployment artifact URL:

- `https://gold-revenue-os-staging-lttm01sxh-gold-revenue-os-staging.vercel.app`

The isolated staging Vercel project is deployed as its production target because Vercel Cron runs only on a production target. This is still non-production Gold Revenue OS infrastructure. The workflow gates deployment behind successful Supabase validation and a previously green Application/Database commit.

## Live staging validation

The safe live path used existing authorized Telegram staging evidence:

`existing message.received events -> worker -> three shadow tasks -> deterministic mock model -> three draft proposals -> WAITING_FOR_APPROVAL`

No AI response was sent. The outbound kill switch remained disabled. Outbound message count remained one—the Phase 5 manually validated message. No historical customer was contacted.

## Versions

- Node.js `24.19.0`
- pnpm `11.19.0`
- Supabase CLI `2.117.0`
- Next.js `16.3.5`
- React / React DOM `19.2.8`
- TypeScript `5.9.3`
- Vitest `5.0.0`
- `@supabase/supabase-js` `2.116.0`
- `@supabase/ssr` `0.12.7`
- Zod `4.6.2`

## Manual actions and cost

Completed manual action:

- `CRON_SECRET` was added to the GitHub `staging` environment. The secret value was never shared in chat or committed.

No new paid service was introduced. Phase 6 uses the existing GitHub, Supabase, and Vercel Pro infrastructure. No OpenAI/API usage charge occurred because validation used the deterministic mock provider.

Before a real OpenAI adapter is activated, the owner must explicitly approve provider/billing setup and add the server-only credential to the approved staging secret surfaces. No credential should be pasted into chat or source control.

## Remaining risks and limitations

- A real model provider has not been live-validated; provider behavior, token accounting, rate limits, and cost remain unverified until an approved adapter and credential are configured.
- Vercel Cron has platform scheduling characteristics rather than a dedicated always-on worker SLA. The database leases and idempotency make invocations safe, but higher volume may later justify dedicated worker infrastructure based on measured backlog/latency.
- Approval is evidence-only in Phase 6. A later phase must deliberately connect approved drafts to the Phase 5 send service without weakening contactability, kill-switch, takeover, RBAC, and idempotency controls.
- Retention durations need a documented legal/business-owner decision before production.
- Runtime-generated `agent.task_created` events are observed by the same generic consumer and intentionally create no recursive task. Future consumers must preserve this event-type allowlist behavior.
- Vercel Git-connected automatic deployment may not contain the staging environment materialization used by the controlled GitHub workflow. The validated release path is the gated `Staging Validation` workflow.

## Rollback

Application rollback:

1. Re-point the isolated staging Vercel alias to the previously validated Phase 5 deployment or redeploy the prior SHA.
2. Disable/remove the Vercel cron invocation if the worker must be halted.
3. Preserve outbox, inbox, task, run, proposal, and attempt rows for replay/audit; do not delete evidence.

Database rollback is forward-fix preferred because Phase 6 tables contain append-only operational evidence. If complete rollback is mandatory before production data exists, stop the cron first, confirm no leased rows, export evidence, then apply a reviewed compensating migration that revokes Phase 6 RPCs/policies and removes objects in dependency order. Never roll back by deleting event history or customer messaging records.

## Phase 7 prerequisites

- explicit owner approval to begin Phase 7;
- select the first real model/provider and approve its billing/security posture;
- add a provider adapter with contract, timeout, retry, structured-output, redaction, and usage tests;
- define prompt/version evaluation criteria before enabling real model output;
- keep staging default `SHADOW` and autonomous messaging disabled;
- decide how approved drafts will enter the existing Phase 5 send service while preserving every deterministic gate;
- define production retention durations with business/legal ownership;
- monitor cron backlog age and invocation reliability before considering external worker infrastructure;
- keep historical customer import locked until the separate 225-record review and count reconciliation are approved.

Phase 7 has **not** started.
