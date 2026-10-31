# Stars genuine receipt/VIP integration — implementation checkpoint

2026-10-31 UTC. Dependent on the accepted native campaign integration in PR146.
This is repository/disposable acceptance, not a genuine provider, merchant, MFA,
customer, payment or deployed release result. Exact publication/CI evidence is
recorded separately in the consolidated owner artifact.

The existing catalogue now accepts explicitly approved positive whole XTR with
one-off billing. Existing fiat prices and historical test contracts are unchanged;
69USD does not produce an invented Stars price. The existing invoice/observation
and verified-receipt ledgers admit the separate LIVE Stars protocol behind the
existing private financial control, exact release/custody/merchant/market checks.
No control/merchant/price/financial authority is provisioned by the migration.

The server factory accounts before each one-shot request, authenticates webhook
before lookup, verifies exact payer/amount/currency/invoice/charge against an
independent decoded ledger page, and atomically reuses receipt→subscription→VIP.
A decoded page is not complete account history. Pre-checkout/link/API ACK is not
payment. Original receipts are append-only, refunds new evidence. Native numeric
identity is corroborated from actual-source contracts; screenshots/user claims
cannot substitute. Unknown checkout/financial/access effects never blindly retry.

The existing Phase11 adapter verifies exact private channel, actual bot rights and
numeric member/revocation. Existing jobs/audit now fence genuine starts/restarts,
unknown mutations and late outcomes. Existing Admin and authenticated cron gain
redacted payment origin/maintenance; no second dashboard, ledger or cron exists.
TEST Stars remains separate and cannot write LIVE receipts. No real charge or
historical customer outreach is performed by this package.

Local evidence:6 actual disposable PG17 cases pass with OFFLINE provider sockets,
including independent receipt-admission connections, exact one subscription,
numeric member/CRM, refund/revoke and unknown checkout/VIP restart.21 new protocol
unit cases plus affected financial-source/access-adapter regression passed (162
focused assertions). Typecheck/lint verified during implementation; mandatory
exact-head and post-merge Application/Database remain required before acceptance.

Failed local attempts were retained: SQL token/alias errors; pre-existing fixture
ID collisions; old timestamp-tied source selection; a fixture START/inbound in
one transaction correctly prevented offer preapproval; unverified numeric fixture
mapping was corrected through corroborated native identity, without weakening
existing binding. Async closure typing and a bounded full-page parser case were
fixed. Existing16KiB financial parser defaults are retained; only the explicit
bounded Stars ledger path permits64KiB with the same node/depth/key/number checks.

See [receipt/custody runbook](infra/runbooks/stars-genuine-receipt-bridge.md).
Genuine credentials/account limits/canary, actual founder MFA, merchant/test bot and
channel, signed supplier/legal/market/product/real XTR price and actual acceptance
remain external. Documentation, fixture grants and JSON cannot activate them.
FINANCIAL_AUTHORITY=NONE; COMMERCIAL_PILOT=NO_GO; PHASE16C-1=OPEN.
