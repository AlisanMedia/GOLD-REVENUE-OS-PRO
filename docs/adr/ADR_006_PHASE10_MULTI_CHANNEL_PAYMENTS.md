# ADR 006 — Provider-neutral multi-channel payment verification

Status: Accepted architecture; sandbox/test Phase 10 formally CLOSED with owner approval on 2026-10-13. Accepted main/staging SHA `031509dc3d447703954f9c76396a7ae8504a9213`. Live payment activation and Phase 11 remain prohibited.

The owner's 2026-10-13 clarification supersedes the channel preference in ADR-002 for Phase 10. The payment engine has no exclusive provider dependency. Digital membership sales initiated inside Telegram bots and Mini Apps use Stars. Crypto is available only through a separately approved independent web checkout. A Telegram conversation, bot or Mini App cannot route digital sales to external checkout. No crypto URL is added to any agent output or Telegram message.

Shared invoice snapshots, exact atomic-unit amounts, deterministic states, append-only provider evidence, transaction-reference uniqueness, reconciliation and audit history are channel-neutral. Providers implement createCheckout, verifyWebhook and reconcile. A new approved adapter does not require rebuilding this engine. Asset/network/precision/finality rules are versioned in the invoice, rather than inferred from ticker names or a model.

This increment registers two test providers. All payment records have a database-enforced test mode. All confirmation events are named payment.test_observed; they cannot satisfy a payment.confirmed lifecycle guard. There is no subscription or access consumer, live provider factory, customer payment activation or outbound invoice send.

Stars live verification requires an authenticated Telegram successful_payment update bound to invoice payload, exact XTR units and expected payer, retaining the telegram_payment_charge_id. Pre-checkout approval, browser callbacks, screenshots and customer statements are insufficient. A parsing/authentication contract is tested; no live route is mounted. Crypto live verification requires a specifically authorized merchant/provider and asset/network configuration, authenticated raw webhook plus independent provider invoice and canonical transfer/finality reads. The interface is present; no live crypto provider has been selected or claimed operational.

The test adapters retrieve an independent persisted simulation snapshot, rather than treating webhook settlement claims as authoritative. Webhook HMAC, timestamp window, payload size, event-content idempotency, transaction uniqueness and locked database transitions are tested. Test checkout previews cannot charge money and never use real wallet addresses or payment URLs. Simulation quote amounts are explicit fixtures and do not establish a live USD/Stars or stablecoin conversion rate.

REVIEW is held for human investigation and cannot auto-confirm. Out-of-order evidence is retained without rolling state backward. Late payment, wrong binding, under/overpayment, insufficient confirmations, refund and reorg have explicit outcomes. Reconciliation uses the same adapter and atomic recorder as webhook processing; provider unavailability leaves the existing state untouched and permits retry.

Live activation needs separate owner approval, merchant eligibility, approved assets/networks and confirmation rules, genuine provider test evidence, independent checkout provenance controls, terms/support/refund handling and a controlled deployment acceptance. Phase 11 is not authorized.
