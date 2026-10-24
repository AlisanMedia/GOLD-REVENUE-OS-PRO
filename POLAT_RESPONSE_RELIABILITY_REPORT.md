# Polat Response Reliability — Package B

## Implemented scope

Repository-only synthetic extension from `ebb330bd7d415f49deaf9ba59c59bf57ddc00de5`. No sender, model call, hosted migration, deployment or live activation. The immutable source is an existing persisted inbound message. The guarantee begins only after explicit private fixture configuration in an active, outbound-disabled `polat-sandbox-*` tenant; it does not claim to capture messages Telegram never delivered to the platform.

- Additive migration `20261024090458_polat_inbound_ownership_evidence.sql`: four private RLS tables, private fixture-only functions and one authorized read-only RPC. An inbound-message trigger atomically creates work/history/audit for configured conversations; native ownership transitions fence old operations. Other tenants/queues retain their accepted behavior.
- Seven tracked states distinguish pending, fake-acknowledged, human handoff, acknowledged human ownership, blocked, uncertain and evidence-backed closure. An unassigned human task is not reported as human-owned. Current native AI_ACTIVE/HUMAN_TAKEOVER/PAUSED semantics remain unchanged; HUMAN_ACTIVE is presentation vocabulary.
- Source hash, ownership generation, latest inbound boundary and current contactability are checked before preparation and again before a fake effect. A takeover invalidates old work. Returning to AI never releases historical drafts; a new inbound is required.
- PREPARED, FAKE_ACK, FAILED_BEFORE_SEND and UNKNOWN evidence is append-only. Strict duplicate-key parsing, exact source/operation/body/reference binding and immutable receipt hashes reject injected or mismatched acknowledgements. A queued response is never delivery evidence.
- Unknown preparation/acknowledgement outcomes stop blind retries. A separately observable matching fake acknowledgement can reconcile uncertainty. Known pre-send failures have a persisted three-attempt TEST budget and bounded backoff; exhaustion leaves a visible human obligation. Timeouts leave persistence explicitly unconfirmed.
- Human ownership requires actual active tenant role and a generation check. Closure requires a resolved existing Phase 12 case and stores its source link; no parallel complaint engine or automatic case resolver exists.
- The read RPC uses tenant membership, role-specific authorization, 25 default/100 maximum rows, a 500-source-row scan budget, deterministic keyset ordering, 30-minute user/role/filter/size/tenant-bound cursors and generation fencing. Empty filtered pages with further evidence disclose incompleteness and provide a continuation cursor. No bodies, Telegram identities, source hashes, lease tokens or provider credentials are projected.
- Private tables/functions grant neither authenticated nor service-role writer authority. No existing receipt writer, subscription consumer, entitlement worker, outbound path or financial metric definition changes. Every result retains financial_authority=NONE and live_operations_authorized=false.

## Actual local acceptance

| Check | Result |
|---|---|
| Focused domain tests | 45 PASS |
| PostgreSQL 17 pgTAP | 75 PASS |
| Actual domain → PostgreSQL → fake transport bridge | 1 PASS, four independent synthetic scenarios |
| Independent PostgreSQL connections/crash script | 4 scenarios PASS |
| Full unit/integration run | 1666 PASS, 0 FAIL, 16 explicit DB-context skips |
| Workspace lint / strict TypeScript | PASS / PASS |
| Local Next build | Existing sandbox Turbopack EPERM limitation; not reported as PASS |

The bridge separately exercises fake acknowledgement, unknown-after-effect recovery, lost preparation acknowledgement and takeover before dispatch. Concurrency exercises two live backend PIDs with observed lock contention, killed pre-commit prepare recovery, competing human owners and killed native-ingestion atomic rollback. The 1101-message fixture verifies bounded and sparse-page traversal. Controlled fixture timestamps establish overdue behavior; these are test inputs, not measured customer latency.

A draft local function refresh encountered an already-added column and was corrected before publication; no hosted database was involved. A lint finding in timeout-error handling was fixed without weakening assertions. Initial local HTTP tests required authorized sandbox socket access. Original logs are retained outside Git. Mandatory CI independently rebuilds the final migration in disposable PostgreSQL, runs this suite and the unaffected regressions, and executes the application build. Exact PR/head/merge/job evidence is included in the consolidated owner report after publication.

## Operational limits

This is a deterministic, network-free reliability substrate, not a deployed Telegram receiver or campaign sender. Model/provider failures use a fake ModelProvider. Genuine provider authentication, transport reconciliation, live takeover races and real response latency remain separately gated. Overdue alerts are PREVIEW_ONLY with dispatch DISABLED; no manager notification is sent. Existing Phase 14 anonymity boundaries and Phase 15 financial truth remain unchanged. Overall Phase 16C-1 stays OPEN; commercial pilot remains NO-GO.
