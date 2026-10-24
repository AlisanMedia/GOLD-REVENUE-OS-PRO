# Polat Consent and Human Ownership — Package B

Repository-only package2/4. Baseline `f216cf20829fe6f4c2db631ce23203b7246b7182` / PR125, exact-head40094208537 and post-merge40094788501 Application+Database SUCCESS/app15368 independently verified. Overall16C-1 OPEN; commercial NO-GO. Final publication/head/merge evidence belongs to the consolidated owner artifact.

## Actual implementation

Two private RLS tables extend the existing Polat/native conversation system: immutable contact evidence and immutable fake-dispatch tickets. Source organization is an opaque fixture reference; provenance is a hash, lawful purpose and retention-policy reference (nullable, no invented production duration). Explicit fixture marketing grants/revocations, customer opt-out, suppression, requested support, human request/acknowledgment, AI pause/return and actual **fake-acknowledged** approved-offer presentation have typed, versioned evidence contracts. No customer, CRM, payment or campaign system is duplicated.

All writes are confined to PostgreSQL-owned fixture setup/record functions or narrowly scoped service RPCs that rederive the current inbound source. No browser/service generic evidence writer or raw private-table grant exists. The active outbound-disabled `polat-sandbox-*` profile is revalidated. Staff authority comes from existing tenant membership; marketing/provenance/AI return require a manager. Analyst/readonly cannot write. No client verified boolean, hash, source text or staff approval creates LIVE/legal/financial authority.

Evidence, revision/generation fencing and audit commit together under deterministic conversation→control locks. Commands have canonical hashes, idempotent replay and append-only previous-hash linkage. Each contact change invalidates old prepared generations using the accepted response-store checks. Missing scope, persistence, current source, contactability, ownership or open-case clearance leaves a visible review obligation. Strict raw JSON duplicate-key, size, schema, enum, tenant and source checks precede storage.

The **existing** runtime records each current source once, obtains a server-owned purpose/revision/generation ticket, and rechecks it immediately before fake effect. Marketing requires explicit synthetic provenance, current consent, expiry, approved timezone/window and bounded reservation caps (one/24h, three/7d); these are conservative **fixture** limits, not approved live policy. A requested reply is separately scoped to an actual current inbound and explicit fixture support provenance. An opt-out cannot be silently removed by staff. Suppression blocks both purposes. Unknown scope remains REVIEW.

Opt-out arriving before the final fake guard produces no effect. Arriving after a fake effect fences the ACK: the actual receipt stays immutable, but work remains DELIVERY_UNKNOWN and no acknowledged history/false success is created. No DB/network exactly-once guarantee is claimed. `polatRecordedOptOut` is only a bound, NOT_SENT synthetic-receipt preview; an absent/incorrect receipt cannot generate a saved-action statement. Default customer text remains natural English/verified alternatives, independent of operator Turkish.

## Native Phase12 integration

A confirmed new integration gap was that accepted Phase12 enablement recognized only `phase12-sandbox-*`; Polat review work was visible but not an Attention case. The additive migration preserves that branch and permits only dual-controlled active Polat fixtures with outbound disabled AND NULL bot/chat destinations. PostgreSQL fixture setup supplies this additional control; normal Phase12 configuration API is not broadened. Actual manager notifications cannot be activated by this path.

The native case/assignment/takeover/resolve/return functions remain authoritative. Polat work links the actual tenant/source-bound case. Human acknowledgment delegates case takeover before recording native conversation ownership. Open cases block return; resolved cases return through the existing case controller and its historical-draft boundary. No force-success, blind resend, refund or financial action exists.

Testing found the native AI_ACTIVE/automatic-replies-disabled combination rejected the attention-only update for a newly opened HIGH case. The guard remains unchanged. Only an explicitly controlled Polat HIGH fixture pauses AI before that update; the existing Phase12/LIVE branch is unchanged. No automatic-reply/global kill switch is relaxed. NULL manager destination and outbound-disabled fixture remain mandatory.

## Reads, privacy and acceptance

Role-scoped contact history uses keyset revisions, default25/max100,30-minute cursor lifetime, account/role/tenant/conversation binding and generation/revision refresh fencing. Every historical entry remains navigable. Analyst projection removes organization provenance details; all projections omit raw source text, credentials, actor identity, payer/invite/lease information and raw payloads. Reads do not grant mutation rights. Anonymous survey tables/joins are untouched.

-16 deterministic pure-contract tests PASS.
-68 new pgTAP assertions PASS: source/marketing/support separation; opt-out; timezone/expiry/window; role/cross-tenant denials; immutable audit/hash chain;104-entry first/middle/final pagination; stale/foreign/expired cursor; native Attention/manager assignment/resolve/return; no manager/customer/financial effect.
-Four genuine independent PostgreSQL-connection cases PASS: row-lock wait and precommit invisibility; duplicate replay once; competing revision denial40001; actual backend crash/rollback/recovery; concurrent human owner conflict. The concurrency script reports four scenarios, not genuine provider acceptance.
-Five new actual-worker/actual-PG cases PASS: unknown scope; opt-out before effect; opt-out after fake effect; missing persistence; marketing cap. The unchanged five PackageA scenarios also pass with explicit fixture provenance. Supabase transport remains a local test double; actual SQL/RPCs execute under service_role, not hosted REST acceptance.
-Existing Phase12 SQL68/68 PASS on disposable PG17. Full local Application selection1807 PASS,0 FAIL,27 explicit DB-context SKIP. The relevant ten new DB-context cases execute separately in Database acceptance. Lint and strict TypeScript PASS. Known local build environment failure is not rerun or relabelled PASS; exact-head CI must independently build.

Preserved failures: initial CLI telemetry write was blocked by the workspace sandbox; authorized CLI execution succeeded without changing HOME or credentials. Five initial bridge setups failed because JavaScript replacement interpreted SQL `$$`; a replacement callback preserved the original bytes. The expanded SQL helper produced a revision/generation mismatch; explicit separate reads corrected the helper and the unchanged drift assertions passed. Native HIGH-case compatibility failure above is retained. No test assertion, role, financial definition or live gate was weakened. Final migration acceptance starts from a fresh disposable PostgreSQL17 chain.

## Publication and remaining gates

Only exact `codex/polat-consent-ownership=false` is added before first push. main=false, all existing entries/crons, staging target/aliases/SSO and release governance are preserved. Required Application+Database exact-head SUCCESS/app15368, normal merge and both post-merge checks remain mandatory. Restore fingerprints include both new tables and the Polat-owned native escalation controls.

No hosted migration/deployment, real model/provider/Telegram/customer message, historical import, receipt/payment.confirmed writer, subscription/VIP grant or campaign. These are synthetic proof and contracts, not lawful real-cohort consent, supplier rights or approved live marketing settings. Genuine transport timing/opt-out races, external contact authority, operating coverage, retention/jurisdictions and C01–C10 remain separately gated.

Sources: [contracts](packages/contracts/src/polat-contact.ts), [pure checks](packages/domain/src/polat-contact.ts), [additive migration](supabase/migrations/20261024124143_polat_contact_ownership_evidence.sql), [SQL acceptance](supabase/tests/polat_contact.test.sql), [concurrency](supabase/tests/polat_contact_concurrency.sh), [worker races](tests/integration/polat-contact-db.test.ts), [runtime](POLAT_TEST_RUNTIME_INTEGRATION_REPORT.md), [accepted escalation](PHASE_12_REPORT.md).
