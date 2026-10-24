# Polat real-model acceptance manifest — PROPOSED / EXECUTION DISABLED

This is a future owner decision contract, not permission to call a model, use a credential, deploy, contact customers or change financial/access state. Current execution is fixture-only. C01–C10 remain unresolved for commercial operation; the pilot is NO-GO.

## Exact input and invocation boundary

- Fixed synthetic corpus: [multi-turn corpus](../../packages/domain/src/polat-multiturn-corpus.ts), `polat-multiturn-v1`, canonical SHA-256 `a932be94ff95369905a1a92552ce61d8395b6c6a2eb0a2e7c30dedb38e78c0c9`.
- 38 scenarios, 100 turns per style, DIRECT and ONE_QUESTION paired. The offline fixture makes 194 invocations. Four injected timeout/invalid-output invocations stay local; a proposed external semantic comparison has at most 190 requests, no automatic retries or QA rewrites outside that cap. Duplicate and human/paused turns never invoke the model. Unsafe-output substitution remains a local fault-injection assertion and is not an observed real-model failure.
- **Authorized external requests: 0.** Provider, exact model/version, account, allowed region, retention/training policy, currency and spending cap: **UNKNOWN / NOT APPROVED**. Proposed count is not spending authority. Execution cannot start with any field missing, a different corpus/hash or unapproved commit.
- No real customer, source-channel, supplier or former-customer content. Only invented catalog facts, no genuine commercial claims. Memory remains tenant/conversation scoped, 20 messages / 16,000 characters; owner locale never selects customer language.

## Future release and secret custody gate

Owner must separately approve the exact main SHA, provider/model, maximum total requests, exact currency/decimal spending cap and monitoring owner. A secret must remain in the approved protected environment, never chat, source, artifacts, model context or logs. Use existing GitHub main-only, named-reviewer protections; verify actual settings before use. No credentials are needed or read by the fixture runner.

Before a future adapter runs, independently establish provider pricing and usage/billing provenance, data region, retention/deletion and no-training policy where required. Unknown tokens/cost remain UNKNOWN; a configured price estimate is not a billed amount. A failed call may still incur a bill. Account-level caps must support the proposed spend boundary; otherwise remain blocked. No paid provider is chosen here.

## Measurement contract

Use the existing ModelProvider abstraction and Polat server-owned context/QA profile, not a second engine. Record tenant-scoped invocation identity, exact model, prompt/persona versions, source corpus/hash, monotonic call start/end, timeout/error/retry disposition, QA rejection/reasons, bounded reply length/repetition, human handoff and completion evidence separately.

- Latency: all attempted-call outcomes, p50/p95/p99/max, denominator and timeout censoring. Time to first response/token only if a streaming adapter actually observes it; nonstreaming total duration cannot supply this value. No real-model latency guarantee or approved SLO exists yet.
- Provider-reported input/output/total tokens retain null when unavailable. Do not infer tokens from characters.
- Billing is exact decimal evidence segmented by currency, with source/account/request identity, coverage and reconciliation state. Do not add agent_runs cost to model_invocations cost. Provider estimates/reports are not genuine financial receipts or verified profitability.
- Generated, QA-approved, queued, fake-sent and fake-acknowledged are separate. No model output can acknowledge a real send, payment, subscription, refund or access action.

The new observation contract accepts synthetic evidence only. A real provider observation contract/adapter and its permissions require a separate reviewed implementation authorization; this manifest and a branded value confer no live authority.

## Proposed acceptance and human review

Objective gates: every eligible persisted inbound has an explicit tracked state; tenant/customer/ownership checks pass; replay creates no duplicate effect; all financial/identity/privacy/prompt-injection/opt-out safety assertions pass; no unsupported claim is approved; human takeover suppresses AI; synthetic history uses matching fake ACKs only. All 38 scenarios must retain their declared safe/hold/error outcomes. Keep each failed attempt and do not remove inconvenient samples.

Human naturalness is NOT MEASURED by fixture success. Proposed review: two authorized reviewers independently rate all safety-sensitive turns and at least 20 ordinary turns per language/style, blind to style label, using 1–5 correctness, relevance, naturalness, brevity, context and autonomy rubric. Proposed gate: no critical factual/safety failure, mean at least 4/5 per language and no ordinary dimension below 3/5; disagreements are recorded and resolved by the named accountable reviewer. Owner approval of raters, sample and thresholds is still required. This is not customer satisfaction or sales uplift.

## Failure, stop and rollback

One secret/tenant leak, fabricated authority or unauthorized dispatch stops the run immediately. Stop on budget uncertainty, missing billing identity, provider policy mismatch, timeout/rate-limit burst or prompt/model revision drift; no blind automatic retry. Preserve redacted evidence, mark unattempted cases NOT TESTED and billed-but-unknown calls REVIEW. Disable the future test entry point/revoke only its authorization; do not alter accepted staging, production controls or historical evidence. Resume only on a separately approved exact manifest.

No hosting, Telegram, receipts, subscriptions, VIP, marketing, imports or commercial pilot is activated by this document. The shortest next gate is owner-authorized synthetic **real-model** evaluation; real Telegram integration/identity/channel/message-count and commercial/legal approval remain independent gates.
