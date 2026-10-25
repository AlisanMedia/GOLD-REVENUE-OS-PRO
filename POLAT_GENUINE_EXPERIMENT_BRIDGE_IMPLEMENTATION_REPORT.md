# Polat genuine experiment bridge — repository implementation checkpoint

2026-10-25. Baseline protected main: `73fdeea60c896322772aeacf55f29d9cd253087b`. One owner-authorized repository-only package. Exact PR-head, normal merge and separate mandatory job evidence will be read after publication and delivered in `POLAT_GENUINE_EXPERIMENT_BRIDGE_OWNER_REPORT.md`. This checkpoint does not predict CI success or authorize inference.

## Official response compatibility

The accepted ModelProvider/Phase7 QA/evidence codec remains authoritative. Explicit schemas now cover the dated official Messages nullable `container`, `diagnostics.cache_miss_reason`, `stop_details`, nullable cache/output breakdowns, region/tier/speed and zero-valued server-tool counters. No unrestricted passthrough or catch-all metadata object exists. Refusal details, non-null container, nonzero/unknown tool effects, unknown fields, malformed usage, incomplete stop and non-null stop sequence are held/rejected. Thinking usage cannot exceed output usage. Only safe bounded diagnostic codes/counters are projected; refusal explanation/thinking/signature never becomes instruction, authority or logs. Historical negative tests remain unchanged.

Current official source reads,2026-10-25, public HTTPS GET only:

- [Messages API](https://platform.claude.com/docs/en/api/messages/create), SHA256 `2ca137cefe0b2782fee5667716e41ee6f8a54ef66c8a14ada719c6c46db349bf`.
- [Official SDK response type source](https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/resources/messages/messages.ts), SHA256 `e4a57d12f91fa40aecaa14304e93132eab36b2427741030d720e92cd913c8cb9`. This is dated schema evidence, not an installed SDK version.
- [PostgreSQL17 locking](https://www.postgresql.org/docs/17/explicit-locking.html), SHA256 `40cb5a062d13eac78b0a8e00653a0301cd16e21538498dfef39921cd39913ac3`.
- [Supabase changelog](https://supabase.com/changelog.md), SHA256 `45528009025b8ad8487ccb73f7c769b66d4b0e7aa4560157047899dcb5b5a006`. Private schema, PostgreSQL numeric/hash/RLS conventions are reused; no Supabase client/API upgrade.

Protocol stays pinned `2023-06-01`; current documentation's example uses `2026-10-21`. Offline structural compatibility does not prove live version/model support. That is a genuine canary gate. No SDK or dependency was added.

## Dormant transport and independent authority boundary

Explicit Node-only package entry `@gold-revenue-os/domain/polat-experiment-bridge`, absent from the shared barrel/browser conditions, contains the dormant fixed-host HTTPS implementation. No route, worker, Telegram gateway, cron, account selector or environment loader imports it. It sends at most once per one-shot context, with no SDK retries, fallback, redirects or regeneration. TLS verification remains enabled. Request/output/header/response bounds, AbortSignal, monotonic elapsed time, immutable request snapshot and safe static error mapping are tested with a mocked Node socket. Actual decoded output reaches native QA; unsafe content is not replaced.

Every genuine call first requires a module-owned opaque permit. This release has **no permit issuer**, pinned real authority roots, credential loader or hosted control plane. `DORMANT` is compiled policy; JSON/flags/hashes/model IDs/API keys cannot enable it. A pure Ed25519 contract verifies three independent owner/account-control/committed-reservation signatures against trusted server-code keys, exact binding/request/account/currency scope and expiry. Fixture-generated keys only test cryptography; a `true` pure verification result is not an execution capability. The active gate always returns BLOCKED before socket or credential access.

Future reviewed release work must authenticate the existing owner decision, provision independent roots/custody, verify committed DB reservation and effective account policy, and issue/consume bound one-shot permits. Current private fixture functions/observations cannot be relabelled genuine by changing flags. Genuine outcome/billing classification and isolated runner authority require that review; no real sender is activated here. Provider timeout/abort is not proof of zero charge or remote cancellation.

## Durable journal backend

One additive migration creates private `polat_experiment_runs`, `polat_experiment_attempts`, `polat_experiment_evidence`. It is the database backend of the experiment reservation/evidence model; historical local JSONL journals are retained and not mirrored or rewritten. No financial ledger, receipt, payment event or customer state is created.

- Account-scope + authorization-record uniqueness is global across tenants. Same authorization returns the original run even with a different run UUID/process/directory; changed binding or foreign tenant fails uniformly. The server-owned authorization hash itself must be genuinely authenticated by the future control plane.
- Lock order: global account/authorization advisory lock for prepare, then run row, attempt row, append-only evidence/native audit. Reserve atomically commits unique target/attempt, monotonic request count, exact numeric liability and audit. Maximum request/count/currency/model/corpus/plan/manifest/SHA/output/time fields are immutable; no floating point monetary arithmetic or rounding.
- One dispatch marker per attempt and one in-flight experiment request. No expired lease reclaims a send. Unknown/lost ACK/restart uses the same identities, never a replacement request. An outcome arriving after its deadline/UNKNOWN is append-only DELAYED_RESULT, never successful consumption or history replacement.
- No actual billing writer exists: actual billed amount/currency remain null. Independent **simulated** reconciliation has explicit provenance/status; it cannot refund request count, release liability, clear a stop or manufacture actual billing. Failed/incomplete/conflicting reconciliation remains visible. The conservative reservation stays charged to the cap.
- Private bounded evidence read: default25, maximum100, lookahead, stable sequence/anchor and has_newer disclosure. History cap1024 and request cap290 bound all reads/counters. Reserved-not-dispatched and unresolved-completion counts keep obligations visible. Internal dispatch keys are hashed, not read-projected. Raw prompts, raw responses, customer identities and credentials are absent from database/audit payloads.
- RLS enabled, no public schema RPC/policy; all new table/function rights revoked from PUBLIC/anon/authenticated/service_role. Fixture writers require the existing active, outbound-disabled `polat-sandbox-*` tenant and postgres-only disposable authority. No new application/service writer or direct authenticated mutation grant. Hosted installation and a future genuine authority adapter require separate approval.

The existing local journal remains valid for accepted offline v2 tests. A filesystem journal is not global spending authority. Likewise local DB tests are not hosted durability/backup, WORM, provider accounting, authenticated owner approval or a global provider-account cap. Restoring/cloning an authoritative DB would require recovery fencing and independent account reconciliation before any genuine execution; this package does not authorize such an operation.

## Canary and actual local acceptance

[Versioned one-request plan](docs/phases/POLAT_CLAUDE_CANARY_v1.md) has independent plan/corpus/target hashes. No v1/v2 corpus, historical outcome, human review or disabled typed owner manifest is changed.290 requests/5.00 USD remain NOT APPROVED; canary spend/currency are null and request authority0. A smaller scope is explicit, never silently borrowed from full-v2 approval.

Actual development evidence before protected publication:

- Initial focused115/0; expanded focused165/0. Full unit1,785/0 (including67 new cases), lint and strict TypeScript PASS. Final exact-head mandatory results belong to the owner artifact.
- Disposable PostgreSQL17.11: initial65/65, expanded70/70 pgTAP. Ten actual database integration tests pass, including two distinct native Node PIDs/directories retaining one original budget, real autocommit-ACK loss, actual native codec/QA and no genuine bill.
- Five actual independent PostgreSQL connection scenarios plus invariant read-back pass: duplicate/cap row-lock races with distinct PIDs and precommit invisibility; real backend termination with atomic counter/audit rollback; lost committed start ACK; concurrent dispatch; stale completion preserved as late evidence. No real socket/provider/customer effects.
- One failed initial CLI invocation encountered read-only local telemetry storage; the authorized local migration generation succeeded with appropriate process permissions. First lint found14 test typing/precision/timer issues; typed fixture/unknown projection and explicit bounds fixed them without weakening assertions. Original diagnostics are retained outside the repository.
- Initial PR-head Database attempt failed before tests on registry/port bootstrap. A single failed-job rerun passed new70/70 pgTAP and10/10 actual DB tests, then exposed missing `rg` in the CI runner. The new concurrency script now uses the same portable `grep` as established scripts; all race/crash assertions remain. Both unsuccessful jobs stay historical FAIL; the corrected exact head needs fresh Application+Database success.

Native tests use a fresh disposable database and separate psql/Node processes. Local Docker is a transport to PostgreSQL, not an in-memory concurrency simulation. No hosted schema, credential, real inference, model token, provider bill, deployment, Telegram/customer send, payment/receipt/subscription/VIP/import or paid resource was used.

## Governance and remaining genuine gates

Exact branch `codex/polat-genuine-experiment-bridge=false` is included before the first push; main=false, previous branch entries, cron and global Vercel settings remain unchanged. Normal protected PR/merge requires exact Application+Database app15368 success and post-merge success. No security/audit policy is loosened; CI only registers the new disposable tests/evidence. Final branch/project inventory and accepted staging read-back are in the owner artifact, not assumed here.

No genuine provider response, latency, cost, human naturalness or conversion acceptance is claimed. Pending: authenticated owner/account roots and release; exact current model/protocol access; data region/retention/training; effective dedicated account caps and independent billing; hosted durable custody and a least-privilege genuine experiment runner/capture classification; named monitor/reviewers; exact separately approved canary SHA/hash/request/output/time/currency/liability and inference window. Canary completion cannot approve290 requests or satisfy human quality review. C01–C10 remain unchanged; commercial pilot NO_GO and overall Phase16C-1 OPEN.

Rollback is code revert through governance; preserve append-only private evidence. There is no hosted deployment to roll back. Do not drop evidence tables or turn fixture evidence into genuine observations. Historical Preview deviation stays HISTORICAL FAIL — RESOLVED WITH DOCUMENTED DEVIATION.

`OWNER_ACCOUNT_AUTHORITY_UNVERIFIED`; `LIVE_MODEL_REQUESTS_ZERO`; `REAL_MODEL_ACCEPTANCE_PENDING`; `REAL_MODEL_EXECUTION=false`; `AUTHORIZED_EXTERNAL_REQUESTS=0`; `financial_authority=NONE`; `live_operations_authorized=false`; `COMMERCIAL_PILOT_NO_GO`; `PHASE16C-1=OPEN`.
