# Phase 5 Report — Messaging Gateway

Status: **implemented and cloud-validated**  
Validation date: **2026-09-25 UTC / 2026-09-26 Europe/Istanbul**  
Validated commit: `5fd324dd335c401c150c039cc8f9106ac4e7b8cc`  
Repository: `AlisanMedia/GOLD-REVENUE-OS-PRO`

## Scope and boundaries

Phase 5 introduces a provider-neutral messaging gateway with Telegram Bot API as the first provider. It does not introduce AI replies, autonomous outreach, bulk sends, payments, subscriptions, channel-access automation, surveys, renewal, win-back, or the historical customer import.

The real historical customer import remains **LOCKED**. The unresolved 225-record manual-review set and the 1,133–1,152 versus approximately 1,161 reconciliation gate remain mandatory before any real import.

## Implemented architecture

### Provider-neutral model

The messaging domain is separated from Telegram-specific transport code. The persistent model supports:

- provider connections;
- provider contacts and contactability;
- conversations and participants;
- inbound and outbound messages;
- provider update deduplication;
- provider message/chat references;
- reply references;
- processing and delivery status;
- idempotency keys;
- provider acknowledgements and failures;
- delivery attempts;
- correlation and causation identifiers.

Telegram-specific request parsing and API mapping remain behind the Telegram adapter and webhook boundary.

### Database migration

Phase 5 migration:

- `supabase/migrations/20260917090000_phase5_messaging_gateway.sql`

New enums:

- `messaging_provider`
- `messaging_contactability`
- `message_direction`
- `message_status`

New tables:

- `messaging_provider_connections`
- `messaging_contacts`
- `conversations`
- `conversation_participants`
- `messages`
- `messaging_provider_updates`
- `message_delivery_attempts`

Tenant setting:

- `tenants.outbound_messaging_enabled boolean not null default false`

All new tenant data is tenant-keyed, RLS-enabled, and protected by database constraints and backend authorization.

## Telegram adapter

Implemented support:

- private inbound text messages;
- `/start`;
- Telegram user ID, username when present, chat ID, first/last name;
- reply-to metadata;
- outbound text messages;
- provider success/error mapping;
- HTTP 429 and `retry_after` handling;
- blocked/unreachable mapping;
- provider acknowledgement before the local status becomes `sent`.

Not implemented in Phase 5:

- media, images, documents, voice, rich messages;
- delivery/read receipts Telegram does not provide;
- arbitrary username cold outreach;
- bulk send.

## Webhook security

Endpoint:

- `/api/webhooks/telegram`

Controls:

- HTTPS staging endpoint;
- Telegram `secret_token` header validation;
- missing/invalid secret rejection;
- malformed payload rejection;
- request-size enforcement;
- `update_id` idempotency;
- minimal normalized persistence;
- safe structured logging and PII/secrets redaction;
- bot token and webhook secret remain server-only;
- no bot token, webhook secret, service key, or raw customer file is committed.

Live probes returned:

| Probe | Actual result |
|---|---:|
| Readiness | HTTP 200 |
| Invalid webhook secret | HTTP 401 |
| Valid secret + malformed payload | HTTP 400 |
| Telegram `getMe` | HTTP 200 |
| Telegram `setWebhook` | HTTP 200 |
| Telegram `getWebhookInfo` | HTTP 200 |

The resolved bot identity was `@gold_revenue_os_staging_bot`. Telegram reported the canonical HTTPS webhook without a delivery error.

## Inbound flow

Implemented flow:

`Telegram -> secret validation -> update dedupe -> normalized envelope -> identity resolution -> conversation/message persistence -> message.received event`

Live staging evidence from the authorized test account:

| Check | Actual result |
|---|---:|
| Telegram updates received | 2 |
| Completed updates | 2 |
| Provider errors | 0 |
| Distinct update IDs | 2 |
| Persisted inbound messages | 2 |
| `/start` commands | 1 |
| Smoke-test text messages | 1 |
| Distinct inbound idempotency keys | 2 |
| `message.received` events | 2 |
| Event payloads containing message content | 0 |

The staging Customer OS contained no imported customers. Identity resolution therefore correctly returned `unmatched`, set `review_required=true`, created one attention-required conversation, and did not silently bind the Telegram user to a customer.

## Outbound flow

Implemented flow:

`authorized admin/backend action -> RBAC -> tenant kill switch -> contactability -> durable outbound record -> Telegram adapter -> acknowledgement/status -> message.sent event`

Live staging evidence:

| Check | Actual result |
|---|---:|
| Outbound messages created | 1 |
| Messages marked `sent` | 1 |
| Provider acknowledgements | 1 |
| `sent_at` recorded | 1 |
| Provider failures | 0 |
| Distinct outbound idempotency keys | 1 |
| `message.sent` events | 1 |
| Event payloads containing message content | 0 |
| Message received by the Telegram test account | Confirmed manually |

Telegram success is required before a message becomes `sent`. No fake delivered/read state is produced.

## Contactability and identity binding

Supported contactability states:

- `unknown`
- `user_initiated`
- `allowed`
- `blocked`
- `revoked`

A historical Telegram username alone does not create outbound permission. The live contact became `user_initiated` only after the Telegram user initiated the conversation. Uncertain or missing Customer OS matches remain reviewable and are never silently merged.

## RBAC

Messaging capabilities are enforced by backend authorization as well as UI visibility.

- `super_admin`: read, send, kill-switch control
- `manager`: read, send, kill-switch control
- `support`: read and permitted manual send
- `analyst`: no outbound send
- `readonly`: no outbound send

The database boundary rechecks tenant, connection, contactability, and kill-switch state. Direct URL/API calls cannot rely on hidden UI controls.

## Outbound kill switch

The tenant-level kill switch defaults to disabled.

When disabled:

- inbound remains operational;
- stored messages remain visible;
- provider sends are rejected at the backend/database boundary.

Live validation performed one controlled enable/send/disable cycle:

- two `messaging.kill_switch_changed` audit records were created;
- one `messaging.outbound_queued` audit record was created;
- the final staging value is `outbound_messaging_enabled=false`.

No bulk-send feature exists.

## Event engine integration

Phase 5 reuses the Phase 3 `domain_events` and transactional `event_outbox`; no parallel event system was introduced.

Contracts used:

- `message.received`
- `message.sent`

Event payloads contain only `channel`, `conversation_id`, and `message_id`; message content is not copied into domain events.

At the end of live validation, three messaging outbox records were durable and pending, with zero dead-lettered records. There are no Phase 5 downstream business consumers yet. Continuous dispatch/consumer runtime remains a Phase 6 prerequisite; pending records must stay observable and replay-safe.

## Admin Control Plane

Added operational views:

- Conversations list;
- conversation detail;
- message history;
- Telegram identity/contactability;
- unmatched/manual-review indication;
- manual reply for authorized roles;
- tenant outbound kill switch.

Customer 360 exposes conversations/messages and Telegram identity/contactability where a customer link exists.

## Privacy findings

- Raw Telegram webhook payloads are not retained as a general-purpose archive.
- Message content remains in the controlled messaging store.
- Domain events carry references rather than content.
- Secrets are absent from browser bundles, logs, repository files, and event payloads.
- Live verification output redacted GitHub, Supabase, Vercel, and Telegram secrets.
- The historical customer dataset was not imported or committed.

## Tests and actual results

GitHub CI run:

- Run: https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/36186197674
- Application job: **PASS**
- Database job: **PASS**

Application checks actually executed:

- frozen dependency install;
- ESLint;
- TypeScript typecheck;
- unit and integration tests;
- production build;
- high-severity dependency audit;
- production bundle smoke test.

Database checks actually executed:

- local Supabase start;
- full database reset and migration execution;
- migration-history verification;
- database lint;
- Phase 1 foundation pgTAP;
- tenant-isolation tests;
- Customer OS pgTAP;
- State/Event Engine pgTAP;
- Admin Control Plane pgTAP;
- Messaging Gateway pgTAP;
- concurrent transition serialization;
- authentication smoke test.

Phase 5 coverage includes:

- webhook secret validation;
- malformed webhook rejection;
- duplicate Telegram update;
- duplicate inbound message;
- identity binding;
- ambiguous and unknown identity handling;
- outbound authorization;
- outbound kill switch;
- Telegram success/failure mapping;
- 429/retry handling;
- outbound idempotency;
- tenant isolation;
- support/manager authorization;
- analyst/readonly send denial;
- secret leakage checks;
- `message.received` and `message.sent` events;
- Phase 1–4 regression tests.

## Cloud validation

Staging workflow:

- Run: https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/36186555051
- Supabase staging validation: **PASS**
- Vercel staging validation: **PASS**
- Telegram live validation: **PASS**

Supabase staging:

- project: `gold-revenue-os-staging`
- project ref: `xqvwkghpmezcpgugetqc`
- region: `eu-central-1`

Vercel staging:

- project: `gold-revenue-os-staging`
- validated deployment: `dpl_5BsqegNFbXZp9p6AgHPsjhYmGZuH`
- deployment state: `READY`
- canonical alias: https://gold-revenue-os-staging.vercel.app
- deployed commit: `5fd324dd335c401c150c039cc8f9106ac4e7b8cc`

Runtime secrets were attached server-side for the validated deployment without writing their values to the repository.

## Exact runtime/dependency versions

- Node.js: `>=24 <25`
- pnpm: `11.19.0`
- Next.js: `16.3.5`
- React / React DOM: `19.2.8`
- TypeScript: `5.9.3`
- Vitest: `5.0.0`
- `@supabase/supabase-js`: `2.116.0`
- `@supabase/ssr`: `0.12.7`
- Zod: `4.6.2`

## Known Telegram limitations

- A bot cannot cold-message arbitrary usernames.
- A usable provider chat ID requires user initiation or another Telegram-permitted interaction.
- Telegram does not provide reliable read receipts for this bot flow.
- Blocked/unreachable results are provider outcomes, not proof of customer intent.
- Media and rich-message support are deferred.
- Telegram events have no authority over payment, subscription, access, or financial lifecycle edges.

## Remaining risks

1. The event outbox is durable but has no continuously running Phase 5 consumer runtime; pending records must be drained by an explicitly deployed deterministic worker in the appropriate later phase.
2. The live test contact remains unmatched because the real customer import is locked; manual identity review is correct and must remain visible.
3. Contactability is provider-specific and must not be generalized into consent for other channels.
4. Telegram rate limits require bounded retries and operational monitoring at higher volume.
5. Bot token/webhook-secret rotation needs an operator runbook and immediate webhook re-registration.
6. Message retention and deletion policy must be finalized before production customer traffic.
7. Mass messaging, cold outreach, and autonomous replies remain prohibited.

## Manual actions completed

- staging Telegram bot created;
- GitHub staging secrets configured;
- Vercel staging runtime secrets configured;
- webhook registered;
- authorized test user sent `/start` and one smoke message;
- authorized admin sent one manual reply;
- test account confirmed receipt;
- outbound kill switch returned to disabled.

No new paid Phase 5 service was introduced.

## Rollback

1. Disable `outbound_messaging_enabled` for every affected tenant.
2. Disable or delete the Telegram webhook with the operator-controlled bot credential.
3. Roll the canonical Vercel staging alias back to the previously validated deployment.
4. Revert the Phase 5 application commit.
5. Roll back the Phase 5 migration only in a controlled maintenance window after exporting required message/audit evidence. Dropping messaging tables is destructive and is not the first rollback action.
6. Preserve append-only domain events, audits, and provider update evidence unless an approved retention process requires deletion.

## Phase 6 prerequisites

Before Phase 6 starts:

- explicit Phase 5 approval;
- keep the historical import locked;
- define deterministic agent tool boundaries;
- agents may request messaging actions but may not bypass RBAC, contactability, idempotency, tenant isolation, or kill switch;
- no AI output may directly mutate customer lifecycle, payment, subscription, or access state;
- define the worker/dispatcher deployment model and backlog monitoring for the durable outbox;
- define message retention/redaction policy;
- maintain human takeover as the default operational control;
- keep staging bot/test-chat isolation.

**Phase 6 has not started.**
