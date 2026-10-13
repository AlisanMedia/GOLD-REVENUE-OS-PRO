# Phase 10 — Multi-channel Payments

Status: OPEN. Implementation is authorized; live activation and Phase 11 are not.

Baseline: main 57cf4cc091c14b5a9412cd796464d1556520cfbf (owner-approved Phase 9 closeout). Repository/remote inspection found no existing Phase 10 code or branch. This increment extends the existing modular monolith and preserves Phase 7–9 acceptance; it does not rerun their live matrices.

## Boundaries

| Channel | Initiation | Adapter now | Production evidence required |
|---|---|---|---|
| Stars | Telegram bot / Mini App | telegram_stars_test | authenticated successful_payment; XTR units, payer and payload match; retained Telegram charge ID |
| Crypto | independent web checkout only | external_crypto_test | authorized merchant/provider, approved asset/network/contract and finality; authenticated webhook and independent invoice/transfer reads |

No externally payable URL is generated. The admin preview and test provider fixtures are the only checkout interfaces. The Stars preview is never sent to a bot. The crypto preview is an independent web contract, available to authorized admins; it is not a public merchant checkout. USDT/TRON and USDC/ETHEREUM rules are simulation fixtures, not live asset approvals. Other approved methods can register their adapter/rules without changing invoice/history/reconciliation structures. Live registrations require a separately reviewed migration that lifts the test-only deployment fence.

## Persistence and authority

payment_invoices contains an immutable commercial offer/settlement quote snapshot, explicit simulation units, channel/surface, provider reference and confirmation rules. It links to a same-tenant customer and approved unexpired commercial offer. No fiat-to-Stars or fiat-to-stablecoin conversion is inferred. The amount has integer atomic units and asset precision. Tenant membership comes from the authenticated server session and is checked again in admin RPCs.

payment_transactions enforces provider/network/transaction uniqueness across tenants. payment_observations stores append-only authenticated callback hashes, provider references, deterministic decisions and reconciliation history. Independent provider fixtures live in an unexposed private table, writable only through audited authorized simulation, with immutable payloads. Service-only functions resolve that evidence and atomically commit payment state, audit and payment.test_observed. No raw callback or secret is persisted.

New public tables have RLS, explicit read-only grants and role-aware policies. Managers/super-admins can create test invoices, simulate and request reconciliation. Support/analyst can inspect payments. Readonly/anon cannot access payment data. Financial observations cannot be written by browsers or AI. The seven-entry agent whitelist is unchanged.

## State and failure rules

CREATED → PENDING → CONFIRMED; independent failure, expiry, refund and REVIEW outcomes are retained. REVIEW has no automatic release. A contradictory post-confirmation observation goes to REVIEW except an evidenced refund. Earlier evidence is stored without rolling back newer state. Late payment, wrong asset/network/recipient/payer, missing transaction, amount mismatch and duplicate transaction cannot confirm. Confirmation requires provider settlement plus the invoice's frozen minimum confirmations. Reorg creates a review hold. Provider lookup failure leaves state unchanged and allows retry.

Reconciliation reads the same independent record and uses the same classifier/transactional recorder as authenticated webhooks. Repeated callbacks/reads have content-aware idempotency. Concurrent invoice creation, provider event ingestion and transaction reuse are serialized by database locks/unique constraints. No paid queue, external scheduler or additional service is introduced. On-demand admin reconciliation and webhook processing are available in test mode; scheduled live reconciliation remains an activation dependency.

Test webhooks default disabled. Enabling requires PAYMENT_TEST_WEBHOOKS_ENABLED=true and a dedicated server-only PAYMENT_TEST_WEBHOOK_SECRET of at least 32 bytes. The generic route accepts only the two test providers, limits streamed bodies to 16 KiB, requires HTTPS in production, verifies timestamped raw-body HMAC before database access and resolves an independently stored simulation snapshot. Real provider IDs return LIVE_PAYMENTS_NOT_ACTIVATED. Internal reconciliation does not require webhook activation or live credentials.

## Acceptance criteria

- Both test adapters create safe checkout previews, verify authenticated signals and reconcile independent evidence.
- Telegram-origin digital purchases cannot use crypto; no bypass link in the conversation runtime.
- Stars verifier contract accepts only authenticated successful_payment with exact payer/XTR/payload and charge ID, rejecting precheckout/client callbacks/screenshots/recurring payments. Synthetic tests are not genuine Telegram test-network acceptance.
- Crypto interface mandates authorized provider and independent canonical transfer/finality reads. No unsupported merchant approval or live integration claim.
- Exact amounts, under/overpayment, wrong asset/network/recipient, insufficient finality, expiry, late payment, refund, reorg, provider failure, replay/tampering, invoice/evidence tenant binding, duplicate transactions and concurrent idempotency covered.
- Unified admin displays invoice, commercial snapshot, provider references, independent verification evidence, transactions and reconciliation/audit history with TEST ONLY labels.
- Mandatory lint/typecheck/unit/integration/build/security audit and Database CI pass.
- No real invoice send, funds collected, subscription creation, VIP granting, customer PAID transition or Phase 11.
- Controlled staging/manual panel verification remains required before recommending Phase 10 closure; live approval dependencies remain explicit.

## Primary protocol references

- Telegram Stars digital-goods requirements and successful-payment flow: https://core.telegram.org/bots/payments-stars
- Telegram payment object and webhook protocol: https://core.telegram.org/bots/api#successfulpayment
- Supabase RLS/grants: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase database functions: https://supabase.com/docs/guides/database/functions
