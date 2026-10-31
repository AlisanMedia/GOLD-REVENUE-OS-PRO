# Genuine campaign runtime — integration and custody

This extends the accepted native worker, ModelProvider, Phase7 QA, message evidence,
experiment journal and Admin campaign screen. It is not a second chatbot, financial
ledger or campaign approval system. Repository acceptance is not provider acceptance.

## Operator flow

Use the existing founder MFA session and one batch
`OWNER_ATTESTED_EXISTING_PERMISSION` declaration/import preview. Configure the
approved plan, audience, market, contact window, pacing and exact-decimal campaign
budget. START is the only routine campaign activation; there is no per-message,
per-lead or repeated permission approval. PAUSE/STOP fence queued work. A newer
inbound can progress without inheriting a marketing-follow-up cooldown; follow-ups
still respect the configured interval, per-person caps and actual platform window.

`SYNTHETIC` retains the original isolated fixture acceptance. `CONTROLLED_TEST`
uses fictional products in an outbound-disabled isolated UAT tenant, with the
existing350-attempt/5USD ceiling. `COMMERCIAL` requires a non-test published plan
and separately verified genuine account/platform eligibility; it does not inherit
permanent experimental quotas. No control record is provisioned by the migration.

## Exact server-owned boundary

1. Independently verify the OpenAI organization/project, exact model
   `gpt-6.1-sol`, current access/data policy, credential custody, effective enforced
   monetary cap, remaining allowance, conservative full-context pricing and the
   independently reconciled canary. A balance screenshot, project budget alert,
   hash, environment flag or founder-supplied JSON is not account authority.
2. Only the protected database owner can record `private.campaign_control_record`.
   `authenticated` and `service_role` cannot write/seal control records. Its binding
   includes tenant/campaign, exact deployed repository SHA, campaign configuration,
   shared journal run, account, custody, authorization, expiry and numeric Business
   identity. The authenticated founder START audit is checked independently.
   Protected setup must derive evidence from genuine trusted observations and owner
   authentication; do not populate it with fixture declarations on hosted systems.
3. The existing shared PostgreSQL journal reserves an attempt and exact-decimal
   liability before a one-use start nonce and credential resolution. Restart,
   another worker or replay cannot reset it. Failed/unknown attempts consume budget.
   No fallback, automatic model retry or QA regeneration is enabled. The fixed
   HTTPS endpoint is `/v1/responses` on `api.openai.com`; output is bounded to512.
4. The actual codec response reaches native Phase7/Polat QA without replacing the
   text with a fixture or renderer. Only source-bound approved output can queue.
   Human takeover, a new source, config drift, STOP and opt-out fence older drafts.
   Provider token usage is observed, price-based liability is an estimate, actual
   billing stays UNKNOWN until independent append-only reconciliation.
5. Delivery uses the existing Telegram adapter, a fresh one-use
   `getBusinessConnection` permission probe and a committed numeric recipient claim.
   Source reply-window, connection generation, source, role and tenant are rechecked.
   An API ACK is not customer read evidence. Only a documented429 may schedule a
   bounded delivery retry; unknown outcomes pause and require reconciliation.
6. Existing Admin manual replies use authenticated human takeover and the common
   public label `Polat Support`; the true staff identity remains private audit data.
   Old AI and human drafts cannot cross takeover/return boundaries. No new public
   mutation or manual force-send/force-success capability is introduced.

## Protected runtime configuration

| Field | Purpose |
|---|---|
| `OPENAI_API_KEY` | Existing protected OpenAI credential; never display/read its value in chat |
| `POLAT_UAT_TELEGRAM_BOT_TOKEN` | Existing protected bot custody; matching bot ID/key hash required |
| `POLAT_CAMPAIGN_TENANT_ID` / `POLAT_CAMPAIGN_ID` | Select the server-bound campaign ingress, grant no authority |
| `POLAT_CAMPAIGN_WEBHOOK_SECRET` | Dedicated Telegram secret-token authentication |
| `POLAT_CAMPAIGN_RELAY_SECRET` | Dedicated isolated relay HMAC when SSO-protected hosting requires it |
| `VERCEL_GIT_COMMIT_SHA` | Platform-owned exact release SHA; no client override |

The authenticated endpoint is `/api/webhooks/campaign/telegram`. Its relay signature
binds a separate domain, tenant, campaign, release SHA, timestamp and body hash.
It cannot replay a beta signature. Native update/audit idempotency persists inbound,
edits/deletes, opt-out and permission-loss events without admitting unknown users.
Do not weaken Admin SSO; reuse the isolated authenticated relay where required.
The existing authenticated worker/cron performs bounded fair recovery. Merely
setting these variables or deploying cannot enable dispatch without custody records.

## Real acceptance procedure, no blanket activation

After reviewed migration/local recovery, protected main CI and staging backup/release,
verify actual founder MFA. The existing protected Private Beta UAT workflow now has
`openai_model_probe`: one read-only fixed model metadata GET, no inference, no DB
writer, no account/cap/policy assertion. It can diagnose a configured key before a
beta program exists. It uses the same staging environment review; do not bypass it.
Then complete independently verified account/canary setup under the existing bounded
UAT authority. Do not silently execute the separate290-request evaluation.

`integration_inventory` is the executable pre-configuration inventory in the same
protected workflow. It reuses `openai_model_probe`, reads `getMe`/`getWebhookInfo`
for each configured Business AI, merchant and dedicated TEST credential, and lists
configuration **names only**. A program is not required for these read-only checks.
It never calls getUpdates, setWebhook, inference, payments or membership methods;
it cannot write a private control record or turn metadata into account authority.
Do not deploy again to run it. The inspected workflow SHA is distinct from the
already deployed application SHA. The existing staging review still protects
credential access; an approved release does not silently approve another job.
Review the redacted artifact for numeric bot identities, TEST/production separation,
webhook classification, HTTP status and missing names. Unknown existing webhook
URLs/diagnostics are hashed, not printed; an existing webhook is never replaced.
Do not treat an inventory job SUCCESS as model/conversation/payment acceptance.

Use controlled numeric test identities only: inbound → actual OpenAI output → exact
QA → Business API ACK/history → human takeover/return → opt-out/STOP. Preserve failed
and unknown outcomes. Local fake-network PG tests do not prove any of these genuine
external observations or authenticated founder UI usability. Historical usernames do
not permit bot-initiated private contact; imports retain unreachable/unknown records.

Telegram Stars TEST remains a dedicated test-network receipt/subscription/VIP scope.
It cannot write genuine LIVE receipts or authorize financial authority. Genuine
merchant/product/XTR price, supplier/market/support terms and actual payment/VIP
acceptance remain separate. No genuine model, Telegram, payment or hosted release
success may be inferred from this runbook or local tests.
