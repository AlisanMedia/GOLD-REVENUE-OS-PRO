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

Local evidence:8 actual disposable PG17 cases pass with OFFLINE provider sockets,
including independent receipt-admission connections, exact one subscription,
numeric member/CRM, refund/revoke, STOP before checkout and unknown checkout/VIP/notification restart. The native campaign suite also exercises the full approved-price → explicit /buy → checkout evidence → actual model frame → native QA path.23 new protocol
unit cases plus affected financial-source/access-adapter regression passed (169
focused assertions). Typecheck/lint verified during implementation; mandatory
exact-head and post-merge Application/Database remain required before acceptance.

Failed local attempts were retained: SQL token/alias errors; pre-existing fixture
ID collisions; old timestamp-tied source selection; a fixture START/inbound in
one transaction correctly prevented offer preapproval; unverified numeric fixture
mapping was corrected through corroborated native identity, without weakening
existing binding. Async closure typing and a bounded full-page parser case were
fixed. New source-bound checkout tests caught a PostgreSQL same-statement
visibility issue, native offer preapproval compatibility, and evidence-registry
assembly errors; null/mismatched offers now fail closed and actual source/ACK
proofs are required. A temporary local SQL diagnostic was not included in code.
One local historical state-engine assertion encountered pre-existing due jobs in
the copied fixture database; it is not reported as PASS. Its unchanged fresh-CI
acceptance is required. Existing16KiB financial parser defaults are retained; only the explicit
bounded Stars ledger path permits64KiB with the same node/depth/key/number checks.

The protected release also transfers only the explicit scoped campaign/merchant
runtime names. Two narrow Edge ingress modules reuse the accepted fixed-host,
bounded authenticated relay; Admin SSO remains intact. Neither is deployed here.

An exact /buy or /subscribe on the native current source can request checkout.
It requires an actual native QA-approved, provider-acknowledged price response,
current campaign/ownership, independently configured commercial and merchant
controls and the same approved offer. First-time price presentation stays in QA.
It uses the existing state graph and source-linked events, without inventing
payment or human approval; a prepared checkout is evidence for the same model/QA.
A recovered immutable checkout ACK reuses its link without another provider call.
Its actual committed observation time advances only QA’s backend evidence boundary;
conversation history keeps the original source cutoff. The DB registry independently
checks the observation, exact invoice/customer and manifest references.

The merchant bot supports a voluntary numeric payer /vip request after a genuine
receipt and current invitation. It sends only that payer’s personal link with a
tracked provider message ID; API ACK is not membership or customer-read evidence.
Duplicate/unknown requests do not blindly resend, and delivery uncertainty never
changes a confirmed financial receipt into a different payment result.
Unknown checkout never blindly retries. Full genuine sale acceptance is pending.

See [receipt/custody runbook](infra/runbooks/stars-genuine-receipt-bridge.md).
Genuine credentials/account limits/canary, actual founder MFA, merchant/test bot and
channel, signed supplier/legal/market/product/real XTR price and actual acceptance
remain external. Documentation, fixture grants and JSON cannot activate them.
FINANCIAL_AUTHORITY=NONE; COMMERCIAL_PILOT=NO_GO; PHASE16C-1=OPEN.
