# Polat Multi-turn Conversation Quality — Package C

Repository-only package3/4, reconciled with protected main `674d65de7a811b0ec9346b6c33721a951ad585c5` / PR126. The independent evaluator was developed while PackageB CI ran; publication requires its post-merge gates. Overall16C-1 OPEN, commercial NO-GO. Final head/merge/CI evidence belongs to the consolidated owner artifact.

## Reused runtime and actual changes

The accepted Polat ModelProvider profile, Phase7 grounding/director/QA and Phase9 commercial selection are reused. `preparePolatFixtureRuntime` is shared by the actual server worker and offline evaluator; the server adapter delegates to it, preserving PackageB contact tickets/native ownership. No second conversation engine, sender, queue, worker, paid provider or database migration is introduced.

The shared contract strictly validates its outer SYNTHETIC/no-authority envelope, native tenant/customer/conversation/ownership binding, run identity and exact fixture request. QA now evaluates the **actual returned output**; a precomputed sales-preview assessment cannot approve a later altered identity/payment claim. Catalog/knowledge facts retain their exact approved statements and source references. Payment/subscription/access action receipts remain unavailable in this profile.

Fixture policy `polat-ai-fixture-v2` adds conservative current-message handling for disinterest, time to decide, attributed instrument preference, comparison uncertainty, subscription expiry, explicit frustration, unsupported language, personal profit projections and financial vulnerability. No persistent sensitive profiling. Ordinary price questions still answer the approved exact price; requests for discounts, financial authority, refunds/access or unsupported outcomes remain human review. No personal investment advice, profit promise, invented discount, urgency or familiarity.

Short slang greetings/acknowledgments are recognized. An opt-out acknowledgment avoids canned empathy and never claims an uncommitted save. Explaining/negating unsubscribe is distinct from requesting it. Repeated questions preserve exact current catalog facts while avoiding repeated openings/questions. Trust questions receive the truthful performance limitation instead of an unsolicited inclusion pitch. Identity questions retain both exact truthful persona statements; repeated disclosure is limited to its actual need. Customer EN/TR switching remains independent of Admin locale, with existing EN/TR/AR/RU contract capability retained. New unsupported-language fixture cases hold rather than claim untested language ability.

## Fixed reproducible evaluation

-38 invented, versioned scenarios;100 turns per style; DIRECT and ONE_QUESTION use identical inputs, catalog, fixture clock and source identities.
-Corpus version `polat-multiturn-v1`, golden SHA256 `a932be94ff95369905a1a92552ce61d8395b6c6a2eb0a2e7c30dedb38e78c0c9`. The corpus and expectations were not removed/changed to obtain PASS.
-200 paired turns,194 bounded fixture model invocations; per style97 invocations =95 structured successes +1 timeout +1 invalid-output fixture. Three non-invoked turns per style cover duplicate, human ownership and pause.
-99 unique inbound fixture records per style are tracked; paired styles are not198 different real people. Each style has81 matching fake effects; duplicate replay adds no effect.14 completed drafts/style are held, plus the two model failures. Human/paused ownership remains explicit.
-Objective scenario acceptance **38/38 per style (76 paired scenario outcomes)**. Checked dimensions include answer/topic/quoted context, concise text, disclosure, grounding, truthful commercial state, safe next step, objections, repetition, escalation, opt-out/save truth, financial risk and uncertainty.
-At most20 messages/16000 characters remain in the context window. A long conversation deliberately evicts an old preference quotation; missing authorized memory is reported as unknown rather than invented recall. Source text/decimal values stay unchanged.

Naturalness outputs are deterministic text indicators, not human ratings. Human naturalness, customer satisfaction, actual conversion/revenue, paid-model token use and cost remain **NOT_MEASURED/null**. The response-size observations cover generated drafts including held drafts: DIRECT mean51.14/max112 characters; ONE_QUESTION mean56.57/max148. These are fixture observations, not customer preference, latency, conversion or model-quality guarantees. No live experiment or automatic style winner.

## Acceptance and retained failures

-259 focused tests PASS, including15 shared-profile negatives,76 individually named paired-scenario assertions plus the runner metadata/golden check and existing Polat regressions. Application CI retains the full fixture JSON as an artifact using the independently verified/pinned official upload-artifact v4 commit.
-Existing ten affected native-worker/actual-PG17 runtime/contact scenarios PASS after the shared-profile integration. No unaffected SQL/concurrency suite is needlessly replayed locally; mandatory Database CI remains unchanged.
-Full local Application selection1899 PASS,0 FAIL,27 explicit DB-context SKIP. Lint/strict TypeScript PASS. Exact-head Application CI must independently perform the unchanged production build; the known local build limitation is not relabelled PASS.

Original evidence is preserved: the first run exposed missing approved-catalog evidence in the evaluator harness as well as real response gaps. After wiring the same source evidence as the server, the unchanged corpus passed23/38 DIRECT and21/38 ONE_QUESTION. Subsequent renderer/intent fixes yielded37/38 and36/38, then38/38 each. Unsafe outcomes and held drafts remain in every artifact. Two lint findings (const and an unnecessary async callback) were fixed. QA thresholds/grounding/receipt requirements, existing financial definitions and assertions were not weakened. A local export conflict during main reconciliation retained both contact and evaluator exports.

## Release and limits

Only `codex/polat-multiturn-evaluation=false` is added before first push, preserving main, prior branches and crons. No SQL/hosted mutation, deployment, model/Telegram/provider/customer call, historical import, payment/receipt/subscription/VIP authority. Policy version is separate from the compatible `polat-test-runtime-v1` selector and existing Phase7 base prompt/QA versions; it does not invent live model acceptance.

Genuine model quality still requires a separately approved provider/model, synthetic input allowlist, request/spend caps, protected credential custody and human review. Genuine Telegram acceptance, legal contact/supplier rights, operating coverage and commercial C01–C10 remain gated. Offline fake history is labelled as such; native database acceptance is separately evidenced.

Sources: [fixed corpus](packages/domain/src/polat-multiturn-corpus.ts), [runner](packages/domain/src/polat-multiturn-evaluation.ts), [golden/paired acceptance](packages/domain/src/polat-multiturn-evaluation.test.ts), [shared profile](packages/domain/src/polat-runtime-profile.ts), [profile negatives](packages/domain/src/polat-runtime-profile.test.ts), [persona](packages/domain/src/polat-conversation.ts), [commercial renderer](packages/domain/src/polat-sales.ts), [server adapter](apps/web/src/lib/polat/test-runtime.ts), [runtime evidence](POLAT_TEST_RUNTIME_INTEGRATION_REPORT.md), [contact evidence](POLAT_CONSENT_OWNERSHIP_REPORT.md).
