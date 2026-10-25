# Polat AI — provider decision intelligence

Research date: **2026-10-25 UTC**. Public official documentation only; no authenticated model/account API, secret read, inference, paid retrieval tool or SDK installation. Provider/account availability remains **UNKNOWN**. This document is a recommendation, not owner approval or model acceptance. [Existing disabled manifest](POLAT_REAL_MODEL_ACCEPTANCE_MANIFEST.md) stays authoritative and disabled.

## Verified identifiers, capabilities and pricing

Prices below are documented standard text rates in USD per1,000,000 tokens, not observed bills. Cache, long-context, region, service tier, tools and other eligible features can change the applicable charge. Actual Turkish/English quality, latency and cost are **NOT MEASURED**.

| Candidate | Exact documented model ID | Version stability established | Standard input / output | Cached input / cache write | Relevant capability and limitation |
| --- | --- | --- | --- | --- | --- |
| OpenAI GPT-6.1 Sol | `gpt-6.1-sol` [S01] | Model page lists this ID in Snapshots; no separate dated immutable revision was independently established here. Do not fabricate a dated suffix | $2.00 / $10.00 [S01,S04] | $0.10 / $2.50 | Text/image input, text output,1,050,000 context/128,000 max output, reasoning, streaming, function calling, structured outputs. Those maxima are not appropriate experimental defaults |
| OpenAI GPT-6 Luna | `gpt-6-luna` [S02] | Same limitation: published ID verified; separate dated pin/immutability guarantee not established | $0.10 / $0.50 [S02,S04] | $0.01 / $0.125 | Same listed context/output bounds and relevant streaming/structured-output capabilities. Low published rate does not prove good TR dialogue |
| Claude Haiku5.5 | `claude-haiku-5-5` [S03] | Official versioning says each model ID is pinned;4.6+ uses dateless IDs, unlike earlier convenience aliases [S06] | $0.10 / $0.50 for prompts up to100,000 tokens [S05] | $0.01 read / $0.125 five-minute write / $0.20 one-hour write for that bracket | Text/image input, text output, multilingual/tool use,1M context/128K output; adaptive thinking defaults on. Omit temperature/top_p/top_k [S03]. Exact structured-output/schema support must be mapped to existing QA [S15] |

Sol and Luna prompts above272K use documented2x input/cache rates and1.5x output rates. Haiku pricing has additional prompt-length brackets; the short-prompt rates above must not be applied to arbitrary1M-token requests. Neither cache hits nor discounts are guaranteed. New Haiku tokenizer differences mean equal text does not imply equal token counts [S03,S05]. No characters-to-token estimate is treated as usage. No FX conversion or price-to-bill substitution.

## Recommendation for short contextual TR/EN Telegram sales conversations

**Proposed primary: Anthropic Claude API / `claude-haiku-5-5`, pinned model ID of the same value.** Reasons are verifiable operating properties: low documented short-prompt rates, relevant structured response/tool capabilities, a documented model-ID stability contract and documented enforced spend-limit outcomes. Its suitability for Polat's tone, context, objections, financial-risk language and Turkish is unproven. It must pass the same versioned v2 objective and independent human review process before any acceptance.

**Proposed fallback candidate: OpenAI / `gpt-6-luna`.** Similar headline short-text rates and compatible streaming/structured-output concepts make it a useful alternative to compare later. It is not an automatic fallback route; a switch is a different exact model/manifest decision. Actual account access, independently established revision policy and enforceable spending evidence remain blockers. OpenAI project spend alerts alone are insufficient.

GPT-6.1 Sol is an optional separately approved reference candidate; its input/output headline rates are20x Luna's. That arithmetic says nothing about comparative Turkish correctness, total tokens, cached usage or effective cost. Do not pay for a reference comparison or silently add requests here.

For all candidates: keep customer English default or explicit verified language request; Polat AI identity disclosure; source-grounded catalog and policy; no invented familiarity, payment/refund/access, trading profits or discounts; short contextual replies; native human takeover and opt-out. Provider marketing terms such as fastest or multilingual are documented positioning, not a measured TR/EN ranking. Existing49-scenario paired fixture evaluation and216-target human-review workflow are reused; human ratings remain0.

## Region, training, retention and account evidence

- OpenAI states API content is not used for training unless the customer opts in. Abuse-monitoring logs may retain content up to30 days, with stated exceptions; ZDR/MAM needs approval and feature-specific eligibility. Application state is distinct from abuse logs; use of `store=false` does not alone prove no retention. Region support is endpoint/project/model/feature-specific. EEA+Switzerland processing/storage is listed with eligibility requirements; account approval is UNKNOWN [S07].
- Anthropic states retained data is not used to train without express permission and documents ZDR/HIPAA/feature arrangements. Current documentation identifies specific Covered Models with30-day retention; that is not a blanket Haiku policy. Actual workspace arrangement and feature retention must be independently confirmed. `inference_geo=global` may process in any available geography; `us` constrains inference to US. Storage jurisdiction and inference geography are different [S08,S16].
- Both public supported-region lists include Turkey/Türkiye [S12,S13]. This does not prove this owner's merchant/account/model eligibility, financial-promotion legality, supplier redistribution rights or lawful customer contact. Do not infer data residency from a customer's language/country.
- No API model-list/account/billing request was made. No trial, free tier, verified merchant, approved region or paid balance is assumed. Model pages list Free as unsupported for the cited OpenAI models; public documentation availability is not account availability.

## Usage, cost, spend and timeout behavior

| Concern | OpenAI evidence | Anthropic evidence | Preflight implication |
| --- | --- | --- | --- |
| Usage vs bill | Official SDK/API describe response usage; actual billing requires separate cost/account reconciliation [S14,S17]. A failed/unknown request may still incur cost | Usage and Cost API is a separate authorized administrative reporting surface; neither API was called [S11] | Preserve observed tokens, pricing estimate, provider-reported cost and independently reconciled billed cost as distinct evidence; unknown never0 |
| Enforced spending | Project spend alerts notify but do not stop API requests [S09] | Tier cap pauses usage; documented429 for tier cap and400 for a customer-set spend limit; workspace/account policy matters [S10] | Need independently verified effective account/workspace cap, not a screenshot of an alert, prepaid balance or typed boolean. Account state UNKNOWN |
| Retries/timeouts | Official Node SDK defaults include2 retries and10-minute timeout; timed-out requests can also retry [S14] | HTTP504/529/429 and streaming-after200 error behavior documented [S18]; SDK behavior must be explicitly configured/verified, never assumed | Future provider-specific code must disable SDK retries and QA regeneration, set a bounded owner-approved timeout and count every started attempt. No SDK added here |
| Cancellation | Client abort/timeout is not a billing reversal or proof remote processing stopped | Same conservative boundary applies; streamed partial success/error must not be called complete | On unknown result/cost, stop the experiment, retain reservation/evidence and require independent reconciliation; never blindly retry |

The current `ModelProvider` interface is nonstreaming and carries nullable token usage plus a numeric billedAmount. Do not turn that numeric value into exact monetary authority. Future provider-specific integration needs reviewed exact cost/provenance mapping, actual model/version response validation, explicit AbortSignal handling and streaming instrumentation if TTFR is required. No such adapter, credential resolver or network route is authorized in this package.

## Sources and reproducibility

All sources accessed **2026-10-25 UTC** with unauthenticated public HTTPS GET. Raw byte hashes and fetch timestamps are preserved in the downloadable owner evidence, not copied wholesale into the repository. SDK master/main references are dated retrievals, not an assertion that a particular npm version was installed or tested. A broad OpenAI Usage reference exceeded a retrieval guard; no claim depends on that unread response. The canonical API pricing page was used after the marketing `/api/pricing/` URL redirected to business pricing.

| Ref | Official source |
| --- | --- |
| S01 | [GPT-6.1 Sol model](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |
| S02 | [GPT-6 Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| S03 | [Claude Haiku5.5 model](https://platform.claude.com/docs/en/models/haiku-5-5/overview) |
| S04 | [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) |
| S05 | [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| S06 | [Claude model IDs/version stability](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions) |
| S07 | [OpenAI API data policies/residency](https://developers.openai.com/api/docs/guides/your-data) |
| S08 | [Claude API data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) |
| S09 | [OpenAI rate limits and spend alerts](https://developers.openai.com/api/docs/guides/terraform/rate-limits-and-spend) |
| S10 | [Claude spend/rate limits](https://platform.claude.com/docs/en/api/rate-limits) |
| S11 | [Claude Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) |
| S12 | [OpenAI supported countries](https://developers.openai.com/api/docs/supported-countries) |
| S13 | [Anthropic supported regions](https://www.anthropic.com/legal/supported-regions) |
| S14 | [Official OpenAI Node SDK README](https://github.com/openai/openai-node/blob/master/README.md) |
| S15 | [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) |
| S16 | [Claude data residency](https://platform.claude.com/docs/en/manage-claude/data-residency) |
| S17 | [OpenAI production practices](https://developers.openai.com/api/docs/guides/production-best-practices) |
| S18 | [Claude errors](https://platform.claude.com/docs/en/api/errors) |

**Status:** PROVIDER_SELECTION_PENDING; OWNER_AUTHORIZATION_PENDING; REAL_MODEL_NOT_TESTED; HUMAN_REVIEW_PENDING; COMMERCIAL_NO_GO. Authorized external requests0, execution_enabled=false, financial_authority=NONE, live_operations_authorized=false.
