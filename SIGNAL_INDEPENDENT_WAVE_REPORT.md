# Signal latency and reliability — Package C

Repository-only package3/4, based on `73631883dca39ab3115073f55a4f0299d2e3a113` / [PR118](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/pull/118). Exact-head and post-merge Application/Database passed before this branch. Commercial pilot remains NO-GO; overall16C-1 remains OPEN.

## Measured problem and actual change

The unchanged accepted SQL harness still fails the delayed-ACK objective. A same-host rerun measured delayed p95 **1512.516ms**; queue wait p95 **1356.592ms**, fake dispatch/ACK p95 **159.265ms**. Eight serial150ms acknowledgements already require at least1200ms before overhead. An index or a faster parser cannot eliminate this bound.

One additive migration adds an explicitly configured **fixture-only** destination width of1(default) or2. The accepted FIFO claim/begin/finish/reconcile functions, retry/lease budgets and LIVE gates remain unchanged. A new private prepare function atomically leases and begins at most2 structurally independent fresh OPEN messages. All candidates are validated before any begin. Replies, edits, cancellations, lifecycle actions, existing bindings, retries, unsupported/policy-stale records and duplicate source message keys require the accepted ordered path. Existing RUNNING/UNKNOWN work blocks new waves. Browser/service-role execution remains denied.

The new domain helper performs one bounded wave using the existing FakeSignalTransport. Each outcome commits independently through the accepted finish function; unknown commit/effect remains UNKNOWN. No automatic resend, force success, worker, cron or actual provider is added. A new concurrency test exposed a fake transport check-before-await race; a post-delay ledger recheck now prevents a second effect for identical or conflicting concurrent operation identities.

Structural independence is **not** proof of a supplier's trading semantics. Within an opt-in wave two independent fixture messages may acknowledge out of order. This is not an approved LIVE rate/ordering policy. Default FIFO remains intact; genuine activation requires separate supplier/rate/order acceptance and owner approval.

## Comparable actual-domain benchmark

Disposable PostgreSQL17.11; Node24.19.0; local CPU quota4cores, memory limit16GiB. Same88 events,11 tenants/providers/destinations,11 persistent worker connections plus1 seed connection, no excluded samples. Both STRICT and WAVE2 use the **same** connections, fixture sizes,2ms/150ms actual FakeSignalTransport timer profiles and first Node source receipt→fake API ACK basis. Connection startup is measured separately for both. Every prepare is observed after SQL COMMIT before fake effects. All352 events have matching persisted fake acknowledgements; this is not real Telegram or production capacity.

| Profile | p50ms | p95ms | p99/maxms | Synthetic events/sec | p95<1000ms |
| --- | ---: | ---: | ---: | ---: | --- |
| STRICT /2ms |274|356|367|233.130|PASS|
| STRICT /150ms |817|1474|1483|59.058|FAIL|
| WAVE2 /2ms |213|279|286|294.733|PASS|
| WAVE2 /150ms |493|832|833|104.022|PASS|

These measured improvements apply only to the disclosed running-worker/independent-fixture conditions. Full source publication latency, real Telegram ACKs, subscriber receipt/reading and genuine capacity remain UNVERIFIED. Detailed normalization CPU, batch SQL/commit, queue-to-begin, dispatch/ACK and persist-ACK durations are retained in benchmark JSON. Mandatory CI repeats the measurements on its own environment; its values must be reported separately, not replaced with these local numbers.

Historical failed experiment preserved: a cold SQL prototype with22 connections measured fast p95 **615.684ms**, delayed **1085.682ms FAIL**. It is not relabelled PASS or silently compared with a warm baseline. The final stdlib persistent-connection harness runs actual domain/FakeSignalTransport code and adds a matched warm STRICT baseline; the original SQL harness is unchanged and continues to record its own failure.

## Acceptance and query evidence

- 18 new domain tests PASS;53 with existing distribution tests. First run:16 PASS/1 FAIL exposed duplicate fake effects; fixed, plus conflicting-facts regression added. First lint found7 typed-mock/async errors; corrected without disabling rules or removing assertions.
- 25 new pgTAP +78 existing distribution assertions =103 PASS. Independent real PostgreSQL backends prove precommit death rolls back leases/attempts/audit, one two-item wave wins, lost preparation is not replayed, expired begun work remains an obligation, and a second destination is independent.
- Actual domain→PostgreSQL→FakeSignalTransport comparative benchmark:1 test PASS,352 verified synthetic effects across4 profiles. Target flags are reported independently from correctness; a slow profile is never hidden or counted as target PASS.
- Full local unit/integration:1493 PASS,0 FAIL,15 explicitly DB-context SKIP. Database CI separately executes the new real SQL benchmark and existing bridges. Lint, strict workspace TS, separate strict benchmark TS and production build PASS.
- 1001 queued fixture messages: returned/prepared2, JSON1478bytes. Inspected literal query:0.271ms,662 shared-buffer hits, global sequence index with708 rows filtered. Existing tenant/destination partial index already covers the predicate; no duplicate speculative index was added for a sub-millisecond fixture query. Large hosted cardinality/planner behavior remains unmeasured; bounded output is not a production scan-cost guarantee.

## Remaining boundaries

The complete-page-versus-source-head recovery limitation discovered during D review is not fixed or hidden by this performance package. Package D must bind recovery completion/review resolution to an independent fake high-watermark, with an additive correction and regression before the final batch report. A source-range proof is not a commercial or LIVE permission.

Files: [migration](supabase/migrations/20261024035314_signal_independent_fixture_wave.sql), [contracts](packages/contracts/src/signal-wave.ts), [helper](packages/domain/src/signal-wave.ts), [unit tests](packages/domain/src/signal-wave.test.ts), [pgTAP](supabase/tests/signal_wave.test.sql), [race/crash](supabase/tests/signal_wave_concurrency.sh), [query plan](supabase/tests/signal_wave_read_plans.sql), [actual-domain benchmark](tests/integration/signal-wave-benchmark.test.ts).

Only `codex/signal-independent-wave=false` is added to Vercel configuration. No hosted migration/deployment, Telegram/session, payment/refund/receipt/event, VIP, customer communication or historical import occurs. Exact PR/head/merge and both mandatory CI results belong to the consolidated owner artifact after publication.
