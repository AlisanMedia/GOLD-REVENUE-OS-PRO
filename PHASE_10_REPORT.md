# Phase 10 — Provider-neutral multi-channel payments

Status: OPEN. The owner authorized multi-channel architecture and safe test interfaces on 2026-10-13. Live payment activation and Phase 11 remain prohibited.

Baseline: 57cf4cc091c14b5a9412cd796464d1556520cfbf, owner-approved Phase 9 closeout. No Phase 10 code, PR or branch existed in the inspected remote at start. Existing Phase 7–9 functionality and accepted source-of-truth checksums are preserved.

## Implemented increment

- Shared deterministic invoice/state engine with exact integer settlement units and immutable commercial offer/rules/quote snapshots.
- Separate telegram_stars_test and external_crypto_test adapters implementing checkout preview, authenticated webhook verification and independent reconciliation. Provider registry and shared persistence permit later approved adapters.
- Stars surfaces require Telegram origin; crypto retains independent web origin. No external crypto purchase links are sent to Telegram or added to agent context.
- Unified Payments admin: invoices, provider references, transaction evidence, verification decisions, reconciliation, independent provider snapshot and audit history. Elevated test actions are independently checked in application and database layers.
- Tenant isolation, RLS, explicit read-only browser grants, service-only receipt recording, append-only snapshots/transactions/history, content-aware event idempotency, global provider/network transaction uniqueness and locked concurrent mutations.
- Test-only database fence. Simulation cannot emit real payment.confirmed, set customer PAID, create a subscription or grant VIP access. Existing agent tools remain unchanged.
- Unmounted Stars genuine evidence verification contract. Crypto live adapter authorization/independent-read contract is declared; no merchant integration is claimed.

## Validation

Verified locally:

| Check | Result |
|---|---|
| Lint / strict typecheck | PASS |
| Unit tests | 500 PASS |
| Integration tests | 79 PASS |
| Production build | PASS |
| Dependency audit | PASS under the repository's existing exact development-advisory exception |
| Production dependency audit | PASS — no known vulnerabilities |
| Disposable PostgreSQL WASM verification | All migrations applied; 54 payment behavior/role/tenant assertions PASS |
| Supabase pgTAP / concurrent processes / mandatory GitHub CI | NOT RUN — publishing blocked |
| Controlled staging / manual admin acceptance | NOT RUN |

The PostgreSQL WASM harness used local Auth/role definitions. Its pgcrypto placeholder throws if invoked; no cryptographic behavior was simulated or asserted by that harness. Test assertions were executed as throwing PostgreSQL functions rather than claiming an actual pgTAP run. It supports migration compilation and payment behavior evidence but does not replace Supabase Auth, PostgREST, full pgTAP or multi-process concurrency CI. Local Supabase execution is unavailable because Docker/Podman is absent.

The local implementation commit is a1d9fdc8dc5d51999815334caa7da70d9ce175cf, followed by the local acceptance-evidence update containing the expanded 54-case database assertions. Neither commit was published. The remote branch search returned no phase10 branch after the rejected push.

## Publication blocker

Automatic approval review rejected git push. Its stated reason was that uploading new payment code/repository contents to github.com required explicit publishing authorization beyond the implementation request. No alternate upload, connector write, PR creation, merge or deployment was attempted. An explicit owner authorization to publish this branch/open the PR is required before mandatory GitHub CI can run.

## Acceptance still required

- Controlled staging migration, authenticated manual Payments panel verification and read-back against the exact tested commit.
- Explicit owner closure after reviewing evidence.
- Separate live approval: Telegram test-network/genuine provider evidence, authorized crypto provider and merchant, approved assets/networks/contract identity/finality, legal/terms/support/refund requirements, trusted independent-web provenance and rollout controls.
- Public merchant checkout, live provider credentials, real invoice dispatch and scheduled live reconciliation are not enabled in this increment.

Phase 10 remains OPEN even when test CI passes. Phase 11 is NOT AUTHORIZED. No real transaction, subscription or VIP access action was performed.

## 2026-10-13 publication continuation

Owner explicitly authorized repository publication, PR CI, focused corrections, merge after passing checks, one isolated staging deployment and sandbox/admin acceptance. Publication blocker is resolved. PR #83 contains the exact original local tree plus focused CI and staging acceptance changes. Initial CI 38417647413: Application PASS; Database migration/lint PASS but the old Phase 3 event-contract count failed (24 actual vs 23 original contracts). The correction preserves the 23 original contracts and verifies the separate Phase 10 test-only event in payment tests. Failure evidence is retained.

Staging acceptance uses only newly created synthetic, closed/blocked sandbox records. Its authenticated test webhook window defaults off, expires within 15 minutes and is closed in cleanup. Existing customer flags and conversation controls are compared before/after; worker backlog drain, historical retries and Telegram webhook registration are skipped. Current acceptance remains OPEN until CI and exact merged-SHA controlled staging finish.

Run 38419654878 preserved: Application PASS; real Supabase migrations, database lint, all regression suites, 60 Phase 10 pgTAP assertions and actual concurrency PASS. Signed HTTP/Admin checks reached 43 PASS before an acceptance-harness error counted the synthetic customer’s initial NEW birth history as a forbidden payment transition. The focused correction separately requires unchanged operating history and zero noninitial fixture transitions; it does not relax payment or state guards. Cleanup was executed.
