# Polat Claude adapter — repository implementation checkpoint

2026-10-25. Starting protected main: `81aa89c8f3ab697e4eb5a611616577de49d928ec`. Owner scope: one repository-only Claude Haiku5.5 readiness package. Exact PR head/merge, mandatory CI/job IDs and final main are recorded in the separately delivered `POLAT_CLAUDE_ADAPTER_OWNER_REPORT.md` after protected acceptance. This checkpoint does not predict CI success or authorize an experiment.

## Implemented boundary

The explicit node-only `@gold-revenue-os/domain/polat-claude-adapter` export implements the existing `ModelProvider` contract using data-only offline HTTP frames. It contains the reviewed Messages request/response codec, typed failure mapping, abort/deadline handling, monotonic timing and nullable usage. No credential argument/loader, SDK, fetch, HTTP client, external URL, public route, worker, provider auto-selection or fallback exists. A model ID, environment variable, JSON approval or CLI flag cannot turn this implementation into a network client. The shared domain barrel does not export the adapter. Browser-condition resolution rejects its package entry; native Node can load it.

The equivalent narrow HTTP approach adds no dependency or SDK default-retry behavior. Protocol `2023-06-01`, codec `polat-claude-messages-v1` and model `claude-haiku-5-5` are explicit. The pure descriptor specifies POST `/v1/messages`, non-secret content/API-version headers, `stream=false`, exact `max_tokens` and JSON-schema output. There is no host or authentication path. Temperature/top_p/top_k, manual thinking budgets, tools, metadata and automatic QA regeneration are omitted. Documented unsupported generation-schema constraints are simplified; the original strict local schema and native QA still validate the actual response.

Completed assistant message identity, exact model, one JSON text block, allowed structure, usage bounds, output ceiling and `end_turn` are validated. Partial/refused/tool/unknown output is rejected. Default adaptive thinking blocks are bounded and discarded, never replayed or logged. Duplicate JSON keys, prototype keys, invalid UTF-8, excessive depth/size and unsafe numbers fail closed. Nonfinancial fractional confidence is supported by a separate bounded parser; financial canonical JSON and golden vectors are unchanged.

Existing server-owned context, message/evidence handles, native claim resolution, Phase7 QA and Polat identity disclosure are reused. Database IDs are excluded from the provider context. The actual decoded text reaches native QA; no safe fixture draft replaces it. Output remains a `ConversationModelOutput`, compatible with the existing captured-output human-review contract. No human records/scores or new review workflow are generated. Full290-target real-model replay is not performed.

## Existing guard and evidence integration

`createPolatClaudeOfflineTransport` registers a data-only port in the existing private registry. Existing v1 fixture policy/observation behavior is retained. Strict offline policy v2 binds the candidate model/version, current Polat profile, adapter version, corpus/hash, owner-proposed SHA, account/policy evidence, timeout and output ceiling. This is still `OFFLINE_SYNTHETIC`, not genuine authority.

The same journal records/fsyncs request count and exact-decimal liability before the fake transport is invoked. Request evidence includes the wire hash, output cap and version. Replay, failed calls, unknown result/billing, cancel, policy drift, concurrency, lease/reopen and spend rules are preserved. Unknown actual billing is null even if input/output/cache counters exist. Total tokens are not guessed. Explicit test costs are labelled SIMULATED, never actual invoices or financial receipts.

An additive optional hashed response-identity field detects one response reused for a different reserved request in the same run. Historical journal rows remain valid and immutable. Distinct offline-Claude observation v2 reuses the same consistency/normalization rules, explicitly labels `OFFLINE_CLAUDE_HTTP` and `real_model_execution=false`, and persists only hashes/counters through the existing journal. Legacy v1 observations still reject external provider identities. No duplicate journal, financial ledger or approval registry is introduced.

The bare offline ModelProvider can be unit-tested in memory without a journal; its only source is the supplied fake frame. The experiment registration path enforces the existing write-ahead model. There is no genuine driver to invoke outside that path. A future genuine driver/runner must be separately reviewed and cannot be enabled by merely changing a flag or supplying an API key.

## Actual development evidence and retained failures

- Final focused acceptance:121 PASS,0 FAIL/skip;53 new cases (51 domain,2 actual boundary integration) plus68 affected accepted guard/observation regressions. Browser resolver denial, native Node import and zero network calls are explicitly checked. Per-provider overlapping calls are rejected, and new unknown attempts cannot retain previous response/usage metadata.
- Lint and strict TypeScript pass. Local full unit regression:1,717 PASS/0 FAIL. First full integration:473 PASS/1 FAIL/27 skip; the existing review CLI correctly refuses an uncommitted Git tree. It is rechecked after a clean commit; exact clean-head and mandatory CI results belong in the final owner artifact. No assertion or clean-source gate was removed.
- First focused run38 PASS/9 FAIL exposed accidental spread of unrelated adapter metadata into the strict observation. Fixed by an explicit projection, retaining all literal mode/authority rules.
- Second combined run111 PASS/4 FAIL: the positive synthetic response used unsupported claim metadata. The sample now uses the same source-grounded BUSINESS_FACT identity format as the accepted native fixture. The original IDENTITY_RESPONSE case remains a negative HELD regression; QA was not relaxed and the adapter does not relabel it. Subsequent115/115 passes.
- Native boundary diagnostics initially used the wrong workspace package-resolution directory and then hit restricted subprocess stdout. Using the actual consuming workspace and permitted local process execution produced a genuine Node result; failure logs are retained. Intermediate118/1 and50/1 results are not PASS. Test-only readonly/unknown/literal TypeScript diagnostics were corrected without weakening runtime types.

Only synthetic content is used. No external inference (paid or unpaid), secret access, hosted migration, deployment, Telegram/customer operation, payment/receipt/subscription/VIP/import activation occurs. No SQL, old migration, metric definition, subscription consumer, live provider, worker/cron, dashboard or CI/security-policy change. The sole Vercel change is the exact new feature branch=false entry; main and every previous entry/cron remain unchanged.

## Genuine execution remains BLOCKED

`polatClaudeRealExecutionReadiness` projects the existing strict disabled manifest. Even complete fabricated approval JSON returns BLOCKED: independent owner authority, effective isolated account cap, billing provenance and durable custody are NOT VERIFIED/UNKNOWN; credential loader and network driver are ABSENT. Hashes and TypeScript types are not authentication. Actual provider/account eligibility is UNKNOWN.

Local fsync/hash-chain/exclusive locking is not WORM, global account enforcement or durable multi-host custody. A future server-owned run must retain the same run/attempt identities across restarts and unknown commits; never reset a directory to evade unsettled liability. A hosted migration or persistent runner store requires its own design/implementation/activation approval. No such operation is performed here.

Output/time ceilings are fenced by the offline policy/wire/journal binding. The current disabled owner manifest does not yet authenticate genuine output/time authorization: a future reviewed extension of that same manifest/runner must bind these limits as well. This does not create a parallel approval system or confer approval through the local policy hash.

Before the first real request, separately require:

1. Exact provider/model/account access, region/retention/training terms and protected secret custody; no real customer/supplier/history input.
2. Authentic owner approval bound to exact reviewed main SHA, corpus/version/hash, prompt/profile, request/output/time ceilings, currency, exact-decimal liability and spend. Full290 requests and5.00 USD remain NOT APPROVED. A smaller subset needs its own explicit versioned plan.
3. Proven effective account limits/remaining allowance and request-level usage/billing reconciliation. A spend alert or typed verified flag is insufficient. Unknown result/charge stops; no blind retry. Client abort is not remote cancellation or a refund.
4. A separately reviewed genuine transport and durable pre-dispatch runner, exact authority verification, no retries/fallback/regen, response identity/correlation and bounded unknown-outcome recovery.
5. Named monitoring owner/backup, two independent human reviewers, approved quality/safety/latency/error/cost thresholds and stop/rollback procedure. Model text can enter the existing UNVERIFIED capture workflow, never fabricate real model/human acceptance.

C01–C10, supplier rights, legal/merchant/contact/staffing/cost prerequisites and commercial NO_GO are unchanged. Overall Phase16C-1 OPEN.

## Dated official source evidence

Public HTTPS GET on2026-10-25, no authenticated model/account API or paid research tool:

- [Messages API](https://platform.claude.com/docs/en/api/messages/create), raw SHA-256 `a25f7d2000b74b77a1ea5f64f8e698c5f32b3635383fce3ea323ce9273a20511`.
- [Thinking behavior](https://platform.claude.com/docs/en/build-with-claude/extended-thinking), raw SHA-256 `721a9d1da7057b91d57e95b7f1f2b4825278443609e52dc72ff1a6a9f116bf72`.
- [Structured output constraints](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), raw SHA-256 `da3a348b856680c508b41afd049396e36df80d3ab54e5c24892393eb3be28486`.
- Prior dated [model/policy comparison](docs/phases/POLAT_PROVIDER_DECISION_INTELLIGENCE.md) and [same disabled owner decision sheet](docs/phases/POLAT_REAL_MODEL_ACCEPTANCE_MANIFEST.md) remain proposals, not account approval.

`REAL_MODEL_EXECUTION=false`; `AUTHORIZED_EXTERNAL_REQUESTS=0`; `HUMAN_REVIEW_PENDING`; `financial_authority=NONE`; `live_operations_authorized=false`; `COMMERCIAL_PILOT=NO_GO`; `PHASE16C-1=OPEN`. Publication acceptance and exact CI evidence must be read from actual checks, not inferred from this checkpoint.
