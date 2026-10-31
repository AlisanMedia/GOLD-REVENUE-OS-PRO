# Stars genuine receipt bridge — dormant until genuine eligibility

The selected in-Telegram digital-goods rail is Telegram Stars. This extends the
existing invoice, observation, verified receipt, subscription, access job and Admin
modules. TEST Stars remains on Telegram's dedicated test network and cannot write
LIVE receipts. No merchant, real XTR price or financial authority is provisioned.

## Existing operator model

The founder retains one campaign START/PAUSE/STOP. Published immutable pricing is
preapproved by the accepted campaign offer rule; there is no per-offer founder
review in that scope. `createStarsCommerce().preparePurchase(approvedOfferId,key)`
prepares the exact approved whole-XTR offer, records an idempotent intent and calls
fixed `getMe`/`createInvoiceLink` once with committed observations first. It never
charges money or treats an intent/link/ACK as a purchase. Existing commercial and
Customer OS state/provenance must already establish an approved purchase; an AI
claim cannot skip those guards. No USD69→XTR conversion is invented.

The merchant BOT owns this checkout and Stars ledger. A link can be presented
through a separately permitted Business conversation. No `business_connection_id`
is sent on the invoice-link request; this avoids incorrectly reading the bot's
ledger for a Business-account-owned Stars transaction. Uninvited historical IDs
or usernames cannot authorize a bot-initiated private message.

## Private activation and protected fields

The existing `private.entitlement_controls` remains default-disabled. Only reviewed
protected database-owner setup may populate its `stars_binding` from actual owner,
merchant/legal/product/market, bot getMe/rights and custody evidence. Runtime roles
cannot activate it. The binding has exact SHA, bot/key/header hashes, private VIP
channel, expiry, external evidence references and eligible markets; Türkiye and
unknown markets are denied for genuine purchase, independently of free UAT.

- `POLAT_STARS_MERCHANT_TENANT_ID`: selects the one sealed merchant tenant.
- `POLAT_STARS_MERCHANT_BOT_TOKEN`: protected verified merchant bot credential.
- `POLAT_STARS_MERCHANT_WEBHOOK_SECRET`: protected Telegram secret token,32+ chars.
- `VERCEL_GIT_COMMIT_SHA`: platform-owned release binding.

These are names only. Do not print values, read credentials in chat, copy TEST bot
custody into LIVE, or treat JSON/hash/environment values as external authority.
The existing payment webhook provider path `telegram_stars_live` stays503 until
both protected configuration and the private financial control are genuinely set.
Configure an authenticated HTTPS ingress/relay for this exact path while retaining
Admin SSO; an inaccessible SSO webhook is not provider acceptance.

## Authoritative receipt and access

An authenticated successful-payment callback is persisted before independent ledger
reading. Exact payer, invoice payload, whole amount/XTR, merchant bot, charge and
provider source time must match a decoded independent `getStarTransactions` page.
A full decoded page is not called complete account history. Missing/out-of-window
charge remains PENDING; no absence or screenshot establishes payment/finality.

Only corroborated facts can atomically append `payment.confirmed`, an immutable
verified receipt with amount provenance, the existing subscription payment period,
and native subscription/access intent. Global charge uniqueness plus row locking
prevents cross-invoice double consumption. Pre-checkout is never payment and cannot
be answered by a second accounted mutation. Original receipts are never rewritten.

The same Phase11 adapter/jobs verify numeric user, exact private channel and bot
administration rights. A committed one-start audit fence precedes genuine effects.
Unknown/stale outcomes remain FAILED/STALE + REVIEW; no blind retry or lease reset.
Membership requires actual API verification. A refund API ACK is only a request;
authenticated refund plus independent ledger creates new evidence, cancels the
subscription and retains a revocation obligation. Expiry/cancellation use native
maintenance. A late ACK after a revision change cannot silently restore access.
The existing founder/operator interface retains manual support for genuine exceptions.

The existing authenticated cron can select `workload=commerce`; the protected
merchant selector alone confers no authority. Bounded maintenance reads up to3
pending invoices and processes one native access job. It does not retry a checkout,
refund or unknown delivery. No new cron or deployment setting is introduced.
Admin shows invoice origin, verification state and redacted evidence, keeping
provider custody nonces and raw ledger material out of operator responses. Gross
XTR is not USD collected revenue, provider payout or profit.

## Acceptance and outstanding genuine inputs

Disposable PG17 tests use invented accounts/permissions and OFFLINE Telegram only.
They prove receipt atomicity, concurrent connections, one subscription, numeric
membership/CRM, refund/revoke and unknown checkout/VIP restart safety; they are not
genuine provider payments, customer tests or actual founder MFA acceptance.

Before genuine testing: reviewed staging backup/migrations/release, actual founder
MFA, merchant getMe/webhook and numeric TEST participants/channel, eligible XTR
product/market, privacy/support/refund terms and authenticated financial activation.
Use dedicated TEST Stars for no-money UAT. Do not send a production invoice to the
friends cohort or charge real money under synthetic acceptance. Actual supplier,
merchant/legal/tax, pricing and release evidence remain required for paying users.

Official protocol checked2026-10-31:
- https://core.telegram.org/bots/payments-stars
- https://core.telegram.org/bots/api#createinvoicelink
- https://core.telegram.org/bots/api#getstartransactions
- https://core.telegram.org/bots/api#refundstarpayment

OpenAI spend controls are separate: https://developers.openai.com/api/docs/guides/spend-limits
An alert is not a hard cap, and hard-cap enforcement can lag. Dedicated-project
custody and conservative local request/liability reservation remain necessary.
