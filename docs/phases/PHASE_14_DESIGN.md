# Phase 14 — Survey intelligence (OPEN)

Owner authorization: 17 October 2026, Phase 14 execution instruction. Baseline: `50ca8d8d61defa131757605405762905462df00b`; main CI 38977968917, Application and Database successful. Phases 1–13 remain closed within accepted boundaries. This document specifies implementation and synthetic acceptance, not commercial activation or phase closure.

## Accepted product choices

Consented, contactable prospects, trial users and verified VIP members; verified joining, trusted cancellation/departure, explicitly approved periodic cadence, and explicitly approved prospect requests. Four or five questions, rating 1–5, single/multiple choice and optional text, explicit skips. Four editable starter templates cover prospect needs, VIP onboarding, satisfaction/value and cancellation. English customer wording is independent of account-owned Turkish/English administrator preferences. Topics describe perceptions, never audited trading performance.

Both identified Telegram/web responses and genuinely identity-unlinked web responses are supported. Telegram transport reveals the sender; its anonymous option leads to a separate shared web entry point. No personalized token, customer ID, Telegram ID, fingerprint or hidden contact mapping belongs in anonymous storage.

## Architecture and authority

Reuse the modular monolith, tenant/RBAC helpers, PostgreSQL transactions, scheduled jobs, domain outbox, Phase 12 cases/takeover and Phase 13 admin components. No new provider, bot, CRM, campaign sender, payment or entitlement authority. Only explicitly enabled, active, outbound-disabled `phase14-sandbox-*` tenants can collect test responses. Public forms require a second application test gate. Publishing a questionnaire does not enable a campaign.

Survey definitions have editable drafts and immutable approved/published version payloads. All mutations are role checked, revision fenced and audited. Policy/legal-hold forms remount on source revision changes; collection shares locks on version, tenant and form gates so archive/disable cannot race acceptance. Survey-scoped consent is required in addition to current contactability, opt-out, source freshness, human takeover/open-case, timezone/window and duplicate/frequency controls. Test delivery contracts distinguish review readiness from actual outbound eligibility; outbound remains false. Periodic cadence is null until explicitly reviewed. Verified test membership is labeled simulated, never real payment/access authority.

Identified invitations use expiring, hashed, single-use access; tenant/customer identity is resolved on the server. The web token travels in a fragment then a POST body, never a query string. Telegram updates use a prepared, authenticated sandbox adapter, exact sender/chat binding, ordered callbacks, revision fencing and replay protection; the accepted live webhook stays unchanged.

Anonymous responses use physically separate private storage: tenant, version, collection month, answers and controlled taxonomy only. No exact submission timestamp or response identifier is exposed to administrators, audit/outbox or client receipts. Shared version keys are not identity invitations. Unlinked one-time admission permits prevent replay; spent permit hashes have no response foreign key or contact mapping. Per-version aggregate budgets bound abuse without storing IPs or fingerprints. This cannot prove one person/one vote. Infrastructure may process transport metadata; production privacy notices remain an owner decision.

Anonymous reporting uses closed, fixed calendar-month cohorts and a minimum sample of five. Small cells suppress the complete distribution to limit complementary inference. No anonymous raw-text export, individual timeline, customer enrichment or arbitrary demographic/date slicing. Optional text warns against identifying content; obvious identifiers are rejected, but voluntary self-disclosure cannot be promised anonymous. Anonymous serious concerns create identity-free cohort triage; identified current-source complaints enter existing Phase 12 cases with takeover fencing. Neither path sends a message.

Deterministic statistics and controlled taxonomy produce source-backed recommendations, with versions, aggregation window, sample/denominator, evidence, uncertainty, operational area and review state. No paid AI call is needed for this baseline. Free text is untrusted data. Manager review proceeds new → review → approved/rejected → planned → completed; approval grants no commercial, financial, messaging or entitlement authority. Turkish critical alert drafts preserve the accepted operations bot/destination allowlists; no provider transport is called. Simulated receipts never become real delivery evidence.

Retention duration defaults to null. Explicit sandbox retention can be tested; legal holds prevent deletion. Open complaint evidence is retained. Production duration, privacy notice/jurisdictions, cadence, cohort/consent review, invitation rollout and real manager alerts require separate owner approval.

## Acceptance gates

- Version immutability and 4–5 valid questions; both channels normalize to the same answer model.
- Consent/source/trigger/window/caps fail closed; claimed payment or VIP membership grants nothing.
- Anonymous storage, APIs, logs, aggregates and triage expose no identity link; small-group suppression and replay/concurrency verified.
- Tenant/RBAC, stale revisions, takeover, stop/opt-out, bounded rate limits and legal hold enforced.
- Recommendations cite persisted eligible evidence; serious identified feedback links Phase 12, anonymous feedback never invents a customer.
- Turkish/English management, independent English customer default, honest empty/error/unavailable states and actual 320/390/768/1440px keyboard/mobile previews.
- Focused domain/integration/pgTAP/concurrency/authenticated HTTP tests; lint, typecheck, build, audit; exact-head Application and Database CI.
- One controlled isolated staging acceptance, synthetic evidence only. Read back financial, messaging, VIP and import invariants; safely disable fixtures while preserving permitted audit/failure records.

Phase 14 remains OPEN until separate explicit owner approval. Phase 15+ is not authorized.

Source authority clarification: a fresh, server-bound identified survey is current evidence even when the existing conversation message is older. The message remains a real conversation anchor, never a fabricated new Telegram inbound. Eligibility requires a real anchor; completion rolls back if its survey/return-boundary authority changes, rather than accepting an untriaged serious complaint. A two-day-old-anchor regression is part of synthetic staging.
