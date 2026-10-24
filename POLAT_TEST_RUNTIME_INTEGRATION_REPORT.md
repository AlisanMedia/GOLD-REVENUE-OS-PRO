# Polat TEST Runtime Integration — Package A

Repository-only package 1/4 of the owner-authorized operational batch. Baseline protected main `7188cf2d6a6a84e8f411719d9cf37e30aa2c9d07`; PR121–124 head and merge Application/Database evidence was independently re-read. Overall16C-1 OPEN, commercial NO-GO. This document records engineering acceptance before publication; exact protected head/merge/check evidence is retained in the final consolidated owner artifact.

## Delivered path

The **existing** `runDeterministicWorker`, event consumer/orchestrator, native tasks/runs/model invocations, context builder, Phase7 QA, Phase8/9 internal tasks, proposal queue and audit records are reused. Explicit scoped `polatTest` execution selects mock `polat-test-runtime-v1`; default worker/cron and existing LIVE sender behavior are unchanged. No second conversation engine or public activation route exists. Scoped TEST claims exclude historical conversation tasks from a different profile version; those remain visible and cannot fall through to a legacy sender.

Only a PostgreSQL-owned setup function can configure an active, outbound-disabled `polat-sandbox-*` fixture. Browser roles and service_role cannot activate it. Private profile/draft/stage tables use RLS, deny raw access, and immutable draft/stage triggers. Service-only RPCs revalidate the explicit fixture on every operation. Enabling outbound invalidates this TEST path.

The bounded context contains at most20 messages/16000 characters, exact source sequence, quoted nonsensitive memory from the same observed conversation, source-bound approved catalog/knowledge and at most3 **test-labelled** subscription records. Native commercial evidence retains the original message-created boundary. Polat conversation/identity QA uses its separate observed-receipt boundary; neither is silently substituted for the other. No payment/access action receipt enters this profile.

The native SQL evidence-reference gate accepts only two additional fixed persona references for this enabled mock profile, matching tenant, conversation, agent version, native run and disabled-outbound fixture. All normal message/commercial checks and all non-Polat/LIVE branches remain unchanged. Identity remains a grounded fact, never a customer quotation or a new financial authority. Existing QA independently checks the actual identity wording, impersonation, claims, safety and source facts.

Generated, QA-approved/held, queued, sent-to-fake and fake-acknowledged are separate append-only stages. A reply enters the next turn's history only after the matching fake receipt AND current ownership/source acceptance. An unacknowledged draft cannot suppress the introduction. No record is inserted into genuine outbound `messages`; the CRM/Polat work projection records the synthetic outcome separately.

Existing proposal persistence is also the crash-recovery source. A cycle considers at most1 current-source approved proposal,25 scoped events and1 scoped task. Unknown preparation/delivery never blindly resends. Independent `FakePolatTransport.observe()` can reconcile the same fake operation; unavailable observation leaves DELIVERY_UNKNOWN. Source generation, native takeover, return boundary and duplicate preparation remain fenced by the accepted response store. Human control is reflected through its bounded refresh. Old drafts are not sent after AI resumption.

Fixture token/billing values remain null. A narrowly conditional TEST trigger preserves null `agent_runs.total_tokens` when both token inputs are unknown; no legacy/LIVE metric or financial definition changes.

## Verification and failed evidence

- Fresh additive migration chain on disposable PostgreSQL17; no hosted schema change.
-28 pgTAP assertions: explicit activation, role/tenant denials, raw grants/RLS, current source,20-message bound, independent customer locale, unknown subscription, outbound invalidation and zero receipt/subscription/outbound creation.
-5 actual-worker/actual-PG integration scenarios: two-turn ACK history; unknown→independent fake ACK without resend; lost fake ledger remains unknown; human takeover/new-inbound-only resumption; timeout→visible human obligation with unknown billing. The Supabase transport is a local test double; SQL/RPCs run on actual PG under service_role. This is not hosted REST, real Telegram or external-model acceptance.
-Native legacy SQL regressions in a separate clean disposable DB: Phase7 QA109/109 and Phase9 commercial67/67 PASS. The first Phase9 run in a DB already containing committed runtime fixtures selected a different global queue task and failed one ordering assertion; isolated unchanged acceptance passed. Original failure is retained.
-9 strict wire-schema tests and10 unaffected native worker regressions. Full Application selection:1791 PASS,0 FAIL,22 explicit DB-context SKIP; the five new DB-context tests are separately exercised against actual PostgreSQL. Workspace lint/strict TypeScript required before push.
-Local webpack build attempt failed: Next could not parse the local TypeScript `--showConfig` subprocess output. Earlier accepted local Turbopack port-binding limitation remains historical. No local build PASS is asserted; exact-head Application CI must perform the unchanged mandatory production build.

Preserved failed attempts outside Git include initial fixture setup ordering; NULL JSON transport representation; unavailable native identity reference; a rejected social reclassification (discarded); a wrong fixture column; source-vs-observed QA time boundary; test module alias resolution; a timestamp-tied test source selector; delayed ownership projection; and a clean-install check exposing the QA-boundary regression. Each was corrected at its source without weakening the gate/assertion. Failed fixtures are retired, not erased; rollback-only pgTAP leaves no fixture rows. The consolidated evidence archive retains original failures.

## Release and remaining boundaries

Only `codex/polat-test-runtime=false` is added to Vercel; main=false, previous entries and cron are preserved. Current official Vercel Git documentation confirms exact-branch suppression; all matching rules remain false. Protected PR, exact-head Application+Database SUCCESS/app15368, normal merge and both post-merge checks are mandatory. No deployment workflow is dispatched.

No real model call, Telegram login/message, customer import/campaign, financial receipt/event, subscription/VIP writer, hosted migration or deployment is introduced. Future consent append-only evidence, broader multi-turn evaluation and real-model readiness are separately scoped packages in this authorized batch. Genuine provider/REST delivery, legal contact authority, C01–C10 and commercial pilot remain unaccepted.

Sources: [worker](apps/web/src/lib/agent-runtime/worker.ts), [context](apps/web/src/lib/agent-runtime/context-builder.ts), [TEST adapter](apps/web/src/lib/polat/test-runtime.ts), [wire contract](packages/contracts/src/polat-runtime.ts), [migration](supabase/migrations/20261024120617_polat_test_runtime_integration.sql), [SQL acceptance](supabase/tests/polat_runtime.test.sql), [runtime acceptance](tests/integration/polat-runtime-db.test.ts), [existing response contract](POLAT_RESPONSE_RELIABILITY_REPORT.md), [existing commercial QA](POLAT_SALES_CONVERSION_REPORT.md).
