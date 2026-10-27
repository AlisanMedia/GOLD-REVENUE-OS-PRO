# Polat OpenAI + Telegram BUSINESS UAT — implementation evidence

27 Ekim2026. Starting protected main: `41ace1c0415e709a68e7b279941901a91262ee7f`
(PR138 accepted). Branch: `codex/polat-openai-business-uat`.

Owner chose OpenAI and configured a dedicated Telegram bot/selected private
Polat chat. Those manual owner reports are not independent server acceptance.
Owner-reported18USD API balance is not verified billing or an effective cap;
authorized total remains5.00USD, canary1, founder20, up to10 friends30, global350
initiated attempts including failures/unknowns. Existing full-v2 evaluation is
separate and not authorized by this package. BUSINESS first connection is only
one founder chat; accepted ordinary BOT friend invitation flow is preserved.

## Actual implementation

- Same native ModelProvider/context/Phase7 QA and durable PostgreSQL journal;
  version2 scoped OpenAI binding, fixed `api.openai.com/v1/responses` one-shot
  transport, exact `gpt-6.1-sol`, max512output/10sec, zero automatic retry,
  fallback or QA regeneration. No SDK/dependency or second journal/approval system.
- Exact organization/project/key-custody hash, repository/manifest/corpus/plan,
  generation, independent account policy and effective monetary-cap proof.
  Existing OPENAI_API_KEY is reused only after sealed authority; global OPENAI_MODEL
  is not changed. Legacy unscoped provider/worker denied within a UAT-marked release.
- DRAFT/fresh-MFA model selection creates an OpenAI-specific notice/manifest and
  invalidates old proof; generic configuration cannot switch provider/model.
- Old Claude v1 notice/plan/native semantics and historical corpus hashes retained.
  Actual provider usage nullable; actual billing UNKNOWN until independently
  reconciled. Model output itself reaches QA; no substitute safe fixture draft.
- Official nullable response metadata projected under explicit bounded schemas;
  mismatched model/account, tools/side effects, invalid completion, unexpected
  tier/cache policy and unsafe output fail closed. Optional metadata absence does
  not invent evidence or release the maximum reservation.
- Official Telegram BUSINESS event/ACK/ownership path, one representative and one
  founder chat, minimal reply rights only, fresh getBusinessConnection before
  every send, generation/lease/source fences, idempotent ingress and exact ACK.
  Permission loss, edited/deleted pending source, human reply and unknown outcomes
  preserve review obligations and prevent stale AI drafts or blind resends.
- Bounded DRAFT discovery stores only minimal candidates privately. This repository
  is public: generated Actions artifacts contain hashes/counts/scope/time only,
  never raw representative/founder/connection IDs, names, message bodies or tokens.
  Private read requires fresh-MFA owner; at most10 candidates×10chat IDs;5min
  validity, exact SHA/generation/current bot-key fences. Candidate is not consent,
  enrollment, provider verification or sending authority. Validity expiry is not
  a claim of immediate physical erasure; existing retention/deletion applies.
- Existing TR/EN Admin shows model selection, scoped connection state, private
  candidates and explicit independent reverification. No new dashboard or force
  send/success control. Minimal extra manual protected workflow operations; none
  are triggered automatically by this implementation.
- Two additive migrations only, tested against disposable PostgreSQL17. Existing
  migrations, financial receipt writers, subscriptions/VIP and hosted DB untouched.
- Exact feature branch Vercel Git deployment suppression added; main=false, all
  other branch rules and crons preserved. No push-triggered deployment authorized.

## Price and canary identity

Official docs checked2026-10-27:
[model](https://developers.openai.com/api/docs/models/gpt-6.1-sol),
[pricing](https://developers.openai.com/api/docs/pricing),
[Telegram Bot API](https://core.telegram.org/bots/api).
Public model metadata does not verify this account/model access, terms or Turkish
conversation quality. Exact model ID has no invented dated snapshot.

Short-context Standard input2/output10 USD/1M tokens is not a full-window bound:
>272K input applies2×input and1.5×output to the whole request. Conservative
1050000input/512output bound therefore uses4/15 and reserves4.20768USD. This is
liability, not observed usage or billed cost; account surcharges/tiers/caching
require genuine evidence. Until reconciliation this conservative reserve may
prevent another attempt;350/20/30 are ceilings, not guaranteed usable quotas.

OpenAI canary: Hi / en / DIRECT /1 initiated attempt /512 output /10seconds.

- Corpus SHA256: `afda9041422b96eca4ccb86e95febfc920b35db01d38ffc42b96505a4f955fad`.
- Plan SHA256: `05ed93b8aef4c47bf86c333ce779dd0e408692cadcf3e2e167af74a6b256a71f`.
- Target SHA256: `d6cf5fcf98e4c3fe339c53d2165ac725e6dbc7e818f08e4328febaeda6e8c293`.

## Actual focused local acceptance

- Final combined new+legacy UAT pgTAP:394/394PASS,7files,0FAIL/0SKIP.
  Includes OpenAI45, BUSINESS98, private discovery43 and accepted UAT208.
- BUSINESS actual independent PostgreSQL concurrency:7/7PASS (same execution
  functions unaffected by later private-discovery-only extension).
- New OpenAI server factory + actualPG + fakeHTTPS:8/8PASS; new BUSINESS server
  +actualPG +fake provider:3/3PASS.
- Combined native worker/context/codec/actualPhase7QA/PG journal/fake OpenAI and
  Telegram:1/1PASS, two conversation turns; prior fake-ACK reply appears in next
  context; duplicate ingress spends/sends nothing; human reply blocks stale AI.
  Three fake model calls (canary+two turns) and three fake sends (notice+two replies)
  are synthetic only. No genuine model/provider/Telegram acceptance is implied.
- Model focused221/221PASS (overlapping existing release/Claude regressions).
  BUSINESS privacy/release focused67/67PASS. Admin final50/50PASS.
  These are individual focused runs and must not be summed across overlapping files.
- Mandatory local application run:1985/1985 unit PASS;896 integration PASS,
  60 environment-gated SKIP in11 files (not counted as PASS). Actual disposable
  provider/native/BUSINESS runs above execute20 of those tests; mandatory Database
  CI separately enables the remaining affected/legacy database harnesses.
- Full strict TypeScript, lint, production build, existing-policy dependency audit,
  local health/home/login200 smoke and absence of Node provider markers from
  client static bundles:PASS. Network-blocked Chromium:8/8 TR/EN×320/390/768/1440
  responsive/keyboard checks PASS; synthetic HTML, not genuine authenticated UAT.
- Fresh78-migration PG17 schema:42 SQL files/2487 assertions PASS; the remaining
  legacy inbound test initially ran0 assertions because its existing relative
  fixture include needs the test directory. Same unmodified file from that correct
  working directory:75/75PASS. Unique final SQL total:43files/2562 assertions.
  Initial full-suite attempt on a reused fixture clone produced6 failed assertions
  plus3 aborted files; real fresh-schema rerun eliminated count/lease/old Stars
  fixture collisions. Those original FAIL logs are preserved, not relabeled PASS.
  One bootstrap tried a host-only file path inside Docker and ran no migrations;
  corrected to stdin before the fresh-schema acceptance. No test was weakened.
- Mandatory protected CI is recorded in the final
  owner artifact with exact commit/run/job IDs; this committed checkpoint does not
  claim future CI or hosted acceptance as passed.

## Preserved failures and corrections

- Model initial159:149PASS/10FAIL from invalid fake request UUIDs; fixtures fixed,
  validators kept. Snapshot-mutation assertion and nullable SQL fixture corrected.
- Initial optional-metadata echo expectation was stricter than official schemas;
  documented nullable/optional fields now accepted while policy conflicts still HOLD.
- Full-window pricing was initially underbound at2.10512USD. Official long-context
  multiplier found during review, corrected to4.20768USD BEFORE publication or any
  real request. Earlier interim pricing success is not final financial acceptance.
- BUSINESS refactor initially stripped Telegram numeric identity (28FAIL/88PASS);
  strict source schema corrected. Mutable fake expiry (2FAIL/53PASS) corrected.
- ActualPG bridge initially2PASS/1FAIL: Phase12 HIGH escalation changed PAUSED to
  HUMAN_TAKEOVER after permission uncertainty. Final explicit PAUSED restored;
  original assertion retained and final bridge3/3PASS.
- Fixture seed collided with accepted Stars data (3FAIL); failed clone retained,
  verified free seed used. Import/search-path/occurred_at harness errors corrected;
  first root pgTAP ran0tests without extensions search_path, final394PASS uses
  public,extensions,pg_catalog. No assertion weakened or historical evidence erased.
- Public artifact identity risk was found and corrected before first publication;
  no genuine discovery ran, so this is a prevented code-level risk, not an observed
  disclosure. Historical unauthorized Preview creation remains HISTORICAL FAIL —
  RESOLVED WITH DOCUMENTED DEVIATION under prior owner/support closeout.

## Genuine stages still blocked / independent evidence

No actual key value read, model/Telegram/provider request, hosted migration,
workflow dispatch, deployment, customer message or financial operation occurred
as part of these local tests. Owner's manual Telegram setup and GitHub secret-name
screenshot are separately reported observations, not app activation.

Required remaining verified setup: recoverable staging backup/TLS CA/custody and
reviewed exact-SHA release; actual privileged MFA accounts and UTC/retention scope;
OpenAI org/project/model access, data policy/region and enforced5USD experiment cap,
complete price/remaining-allowance/billing evidence; genuine dedicated bot getMe,
minimal-rights BUSINESS connection, authenticated ingress/SSO bypass custody and
founder invitation/notice consent. Existing key/balance/project budget alert cannot
substitute for these controls. Do not relax them to make the beta appear usable.

[Exact release/setup procedure](infra/runbooks/private-beta-release.md).
Supplier redistribution, merchant/legal/tax, jurisdiction, genuine receipt/payment,
consent, operations and economics C01–C10 remain external commercial NO_GO gates.
Fictional free UAT does not require inventing supplier rights; source signal reading
or protected-content bypass is not implemented by this private-chat connection.

`FINANCIAL_AUTHORITY=NONE` · no live commercial activation · `COMMERCIAL_PILOT=NO_GO`
· `PHASE16C-1=OPEN` · genuine model quality/human naturalness NOT_MEASURED.

## Exact scoped changed-file inventory

- `.github/workflows/ci.yml`
- `.github/workflows/private-beta-uat.yml`
- `POLAT_OPENAI_BUSINESS_UAT_IMPLEMENTATION_REPORT.md`
- `apps/web/src/app/admin/polat-operations/beta-actions.ts`
- `apps/web/src/app/api/webhooks/private-beta/telegram/route.ts`
- `apps/web/src/components/polat-operations.tsx`
- `apps/web/src/components/polat-private-beta.tsx`
- `apps/web/src/lib/agent-runtime/context-builder.ts`
- `apps/web/src/lib/agent-runtime/worker.ts`
- `apps/web/src/lib/messaging/telegram-adapter.ts`
- `apps/web/src/lib/polat/admin.ts`
- `apps/web/src/lib/polat/private-beta-business.ts`
- `apps/web/src/lib/polat/private-beta-canary.ts`
- `apps/web/src/lib/polat/private-beta-provider.ts`
- `apps/web/src/lib/polat/private-beta-read.ts`
- `apps/web/src/lib/polat/private-beta-runtime.ts`
- `apps/web/src/lib/polat/private-beta-webhook.ts`
- `docs/MASTER_PRODUCT_CONTEXT.md`
- `docs/NEXT_EXECUTION_BACKLOG.md`
- `infra/runbooks/private-beta-release.md`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/polat-openai-adapter.ts`
- `packages/contracts/src/private-beta-uat.ts`
- `packages/domain/package.json`
- `packages/domain/src/polat-claude-adapter.ts`
- `packages/domain/src/polat-claude-https-boundary.ts`
- `packages/domain/src/polat-experiment-execution-gate.ts`
- `packages/domain/src/polat-native-wire.ts`
- `packages/domain/src/polat-openai-adapter.test.ts`
- `packages/domain/src/polat-openai-adapter.ts`
- `packages/domain/src/polat-openai-canary.ts`
- `packages/domain/src/polat-openai-https-boundary.ts`
- `packages/domain/src/polat-private-beta-provider.ts`
- `packages/domain/src/telegram-delivery-evidence.test.ts`
- `packages/domain/src/telegram-delivery-evidence.ts`
- `scripts/private-beta-release-bot.d.mts`
- `scripts/private-beta-release-bot.mjs`
- `scripts/private-beta-release-openai-account.d.mts`
- `scripts/private-beta-release-openai-account.mjs`
- `scripts/private-beta-release-vercel.mjs`
- `supabase/migrations/20261027090000_private_beta_openai.sql`
- `supabase/migrations/20261027090100_private_beta_business.sql`
- `supabase/tests/helpers/private_beta_business_fixtures.sql`
- `supabase/tests/helpers/private_beta_openai_fixtures.sql`
- `supabase/tests/private_beta_business.test.sql`
- `supabase/tests/private_beta_business_concurrency.sh`
- `supabase/tests/private_beta_business_discovery.test.sql`
- `supabase/tests/private_beta_openai.test.sql`
- `tests/integration/polat-openai-private-beta-provider-db.test.ts`
- `tests/integration/private-beta-business-boundary.test.ts`
- `tests/integration/private-beta-business-control.test.ts`
- `tests/integration/private-beta-business-db.test.ts`
- `tests/integration/private-beta-business-dispatch.test.ts`
- `tests/integration/private-beta-openai-business-runtime-db.test.ts`
- `tests/integration/private-beta-operations.test.ts`
- `tests/integration/private-beta-provider-isolation.test.ts`
- `tests/integration/private-beta-release-openai-account.test.ts`
- `tests/integration/private-beta-webhook.test.ts`
- `tests/integration/telegram-transport-safety.test.ts`
- `vercel.json`

## Migration SHA256

- `supabase/migrations/20261027090000_private_beta_openai.sql`: `17455612e3bf67211a75596b571d349450e2fb2f856684ac72f319cc3d18da17`.
- `supabase/migrations/20261027090100_private_beta_business.sql`: `a0c15e9bcc834cda9d18f171dcf28cc91b1698460c6285f4b45c7f17558e2aa7`.
