# Signal operator review, source integrity and pilot preparation — Package D

Final package4/4 under the2026-10-24 owner repository-only batch. Base main `adee751feff309e734390df282fe7543c18156a1`, [PR119](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/pull/119); exact-head40060562876 and post-merge40061096910 Application+Database/app15368 SUCCESS. This report records implementation/local evidence before publication; the consolidated owner artifact must supply D's exact PR/head/merge and mandatory CI evidence after publication. Overall16C-1 remains OPEN and commercial pilot NO-GO.

## Corrected continuity boundary

Review of A exposed a confirmed **synthetic-contract** omission: a complete requested64-entry page did not prove reaching an independent provider head. It was not a measured production incident or data leak. One additive migration corrects this without rewriting A or any historical migration/report.

Recovery page v2 has an independent fake high-watermark. The checkpoint retains its target across partial pages/disconnects;64/64/2 pages for head130 remain RECOVERING until130 is reached. An empty independent range can prove no new events during a short outage. Missing/regressed/legacyv1 range-only proofs fail closed. Source-recovery history now immutably records verified head, proof version and processed checkpoint; older rows stay unknown/null. No historical proof is backfilled or reclassified as stronger evidence. Three incomplete-proof failures per outage consume the TEST budget; successful bounded pages do not. The15-minute/64-entry/3-failure/60-second freshness settings remain TEST-only, not a LIVE provider SLA.

Original observations, command identity, epoch/generation fences, source/provider/global pause policy, immutable source revisions and UNKNOWN delivery handling remain intact. A full page, connection reconnect, hash or manager decision cannot establish genuine source permission or recovered external history. Fake history keeps sources separate and enforces a total60KiB page bound without changing the existing16KiB financial canonical limit or financial golden vectors.

## Append-only review evidence

One private/RLS journal records reviewer identity/role, tenant/source/delivery ownership, issue, reason, OPEN/BLOCKED/RESOLVED_WITH_EVIDENCE, bounded existing observation references and current-context hash. No free-form callback/payer/session data is accepted. Commands are idempotent; reviewer context includes source generation, delivery state/current revision and previous review. Lock order is controls→current membership(shared)→source checkpoint→delivery. Current membership is rechecked after acquiring controls and held through commit.

Only tenant manager/super_admin fixture authority can append, and the private function has **no authenticated/service-role execute grant**. The browser has no writer. Support/analyst may read redacted evidence; readonly is denied. A label must have persisted source/delivery support. Resolution requires current caught-up source plus matching immutable **v2 head proof**, or an already persisted matching fake ACK/reconciliation for that delivery/claim. Unknown, old, foreign, conflicting or absent proof stays OPEN/BLOCKED. Restriction cannot be bypassed. Review never sends/retries, creates an ACK, changes a delivery/subscription/access state or deletes an obligation.

## Existing Admin extension and compatibility

`/admin/signals` gains source connection/recovery context, explicit unknown-head/freshness states, a safe expired-worker-lease warning and a bounded review journal. Main headings/reasons are TR/EN, Turkish default and existing per-user English selection preserved. Technical references are secondary. Source/customer text is not translated, and customer conversation defaults are unchanged.

New `admin_signal_page_v2` delegates accepted v1 auth/cursor/filter behavior, then enriches at most100 rows in one set projection. Existing `admin_signal_page_v1` stays compatible for older strict clients/rollback. New review-page RPC uses tenant/user/role/filter/page-size-bound cursors,25 default/100 max,30-minute TTL, real-boundary validation and bounded lookahead. Tenant/source/delivery indexes support its read patterns. No raw source text/reference, invite/session, reviewer UUID, private evidence hash, lease token or raw lease timestamp reaches these projections. There is no new production mutation/force-send UI.

## Actual local evidence

- 33 new domain tests:9 head-completeness and24 review validation/projection tests, all PASS; affected existing recovery tests preserved.
- 40 actual component/server-route tests PASS. Full local suite **1536 PASS,0 FAIL,15 DB-context SKIP**. Skips are not SQL/provider acceptance; mandatory Database CI executes its database bridges/HTTP acceptance separately.
- Disposable PostgreSQL17.11: **108 focused assertions PASS** (48 existing recovery,18 new head,42 review); **59 existing Admin assertions PASS**. Independent PostgreSQL backends prove source crash/replay and one-generation winner, review precommit invisibility, observed lock contention, stale-review rejection, real backend death rollback and same-command recovery/replay. No real provider is involved.
- TR/EN actual-component SSR previews at320/390/768/1440px: **16/16 PASS**, horizontal overflow absent, native keyboard details toggle and44px summary targets verified; external browser networking blocked. These are synthetic component previews, not hosted/hydrated production acceptance or a full accessibility audit.
- Lint, strict TypeScript and production build PASS. Focused authenticated local-only Supabase/Next HTTP cases were added for v2 source gaps, v1 compatibility, review route, tenant/RBAC denial, redaction and lease expiry. Their actual execution belongs to mandatory Database CI; no local authenticated HTTP PASS or hosted acceptance is claimed here.

## Preserved unsuccessful evidence

The first new domain run had85 PASS/2 FAIL: whole recovery pages were incorrectly passed through the financial canonical helper's16KiB limit. Recovery byte validation was separated; the financial helper was not widened. The same focused suite then passed87/87; lease-visibility and quarantined-source badge regressions make the final affected total89/89.

The first screenshot driver's Enter event lacked its native character and failed the toggle assertion; correct native key delivery passed16/16 without weakening overflow/touch/keyboard assertions.

A fresh, transaction-local10001-row existing Admin fixture had no analyze/autovacuum statistics and a large-page read ran for multiple minutes; only that owned local SELECT was canceled and its evidence retained. Explicit ANALYZE of the generated fixture's four signal tables made the same unchanged59 assertions pass in22s. No row count, cap, tenant/RLS assertion or runtime policy was weakened. This is fixture/query-planning evidence, not a production throughput claim; hosted cardinality/planner behavior remains unverified.

## Pilot preparation and remaining gates

[Single-provider pilot entry/runbook](infra/runbooks/signal-single-provider-pilot.md) covers rights, permitted integration alternatives, exact destinations, session custody/MFA, actual sequence/edit/delete recovery capability, latency/accuracy methodology, incidents/rollback, named staffing, customer privacy, infrastructure/cost method and future exact-count harmless test scope. No supplier, merchant, jurisdiction, wallet/network, cost, retention, RPO/RTO or named operator is invented. C01–C10 remain genuine external gates. Normal membership is not redistribution permission; protected content requires an approved alternative, never a bypass.

No real Telegram/account/session, source monitoring/forwarding, money/refund/receipt/trusted event, VIP/customer campaign/import, hosted schema/release or paid service is activated. All new fixture results keep financial_authority=NONE/live_operations_authorized=false. Only the exact `codex/signal-review-pilot-readiness=false` Vercel entry is added; existing policies/main=false/cron remain intact. The accepted isolated staging target stays unchanged. Stop after this fourth package; no commercial GO or overall phase closure follows.

## Canonical implementation links

- [Additive migration](supabase/migrations/20261024041522_signal_review_source_integrity.sql), [recovery contracts](packages/contracts/src/signal-recovery.ts), [review contracts](packages/contracts/src/signal-review.ts).
- [Recovery helper](packages/domain/src/signal-recovery.ts), [review parser/projection](packages/domain/src/signal-review.ts), [head tests](packages/domain/src/signal-recovery-head.test.ts), [review tests](packages/domain/src/signal-review.test.ts).
- [Source head pgTAP](supabase/tests/signal_recovery_head.test.sql), [review pgTAP](supabase/tests/signal_reviews.test.sql), [actual-backend review race/crash](supabase/tests/signal_review_concurrency.sh).
- [Read model](apps/web/src/lib/signals/read-model.ts), [authorized server reader](apps/web/src/lib/signals/admin.ts), [existing UI](apps/web/src/components/signal-operations.tsx), [TR/EN labels](apps/web/src/lib/i18n/signals.ts), [component/route tests](tests/integration/signal-operations.test.ts), [local HTTP acceptance](apps/web/scripts/signal-operations-http.mjs).
- [Living context](docs/MASTER_PRODUCT_CONTEXT.md), [backlog](docs/NEXT_EXECUTION_BACKLOG.md), [C01–C10](docs/phases/PILOT_ENTRY_v0.1.md).
