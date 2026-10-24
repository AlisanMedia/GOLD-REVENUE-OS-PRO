# Gold Revenue OS engineering rules

Gold Revenue OS PRO is an existing modular-monolith revenue platform, initially for Telegram subscription businesses. Continue working modules; do not rebuild accepted phases.

Start with `docs/MASTER_PRODUCT_CONTEXT.md` for the current system/evidence map and `docs/NEXT_EXECUTION_BACKLOG.md` for proposed work. Verify remote `main`, exact-commit Application **and** Database check runs, latest accepted phase report and owner scope before implementation; empty combined status is not CI success.

Phases 1–15 are CLOSED only within their documented acceptance boundaries. Phases 1–6 retain their reports' implementation/validation scope. Phase 12 was owner-approved after its 26/26 sandbox and single private-group manager-alert acceptance. Phase 13 Customer Success, premium Admin and per-user TR/EN localization were separately owner-approved and CLOSED after accepted SHA `ee64bdaa835a887e0e5782f2217f9a8190a0f117`, main CI 38958730970 and 60/60 controlled synthetic staging. No real Customer Success outbound was authorized. Phase 14 Survey + Customer Intelligence is formally CLOSED by explicit owner approval on 2026-10-17 within isolated synthetic staging scope: merged PR #97/#98, accepted main `2289fc5af8e8dd4bdeb0eda6572eb81fd4ad1bc3`, CI 39026333696 Application + Database PASS, staging 39026615428 66/66 PASS. No actual Telegram/customer survey delivery was authorized. Phase 16+ requires separate explicit owner authorization. Historical imports, live payments, production subscriptions/VIP access and broader outbound messaging remain locked/unauthorized. Do not repeat accepted real Telegram tests or change channel permissions without a specific reason and separate authorization.

Current continuation (2026-10-23): Phase16A governance and16C-0 reads are accepted;16C-1A was owner-accepted CLOSED with the historical Preview deviation preserved. PR106/107/108 implement synthetic evidence/recovery/retry hardening; overall16C-1 remains OPEN and the commercial pilot is NO-GO. See the current section in MASTER_PRODUCT_CONTEXT and infra/runbooks/pilot-entry-evidence.md. Explicit owner batches may authorize consecutive repository-only packages; respect their package limit and genuine stop conditions. No synthetic test, hash, branded value, report or manager approval confers LIVE financial, receipt, message or VIP authority.

Read `docs/source-of-truth/v1.0.0/` and accepted ADRs before changing architecture. ADR-002 controls the approved Phase 1 amendments.

- Signal development is fixture-only: no real Telegram sessions, protected-content bypass, forwarding, wallet/merchant setup or former-customer import/outreach. Normal channel membership is not redistribution permission. See `SIGNAL_INGESTION_FOUNDATION_REPORT.md` and `infra/runbooks/signal-commercial-readiness.md`; all genuine rights/payment/access/pilot gates remain closed.
- TypeScript is strict. Avoid `any`.
- Every business table is tenant scoped unless its global scope is explicit.
- Deny access by default. Browser tenant input never grants access.
- Privileged writes and audit entries commit atomically.
- Audit history is append-only.
- Secrets never enter browser bundles, model context, logs or audit payloads.
- AI may propose language and actions; deterministic services own payment, access and state mutations.
- External webhooks and jobs must be idempotent when those phases begin.
- Human takeover and the outbound kill switch must exist before automated outbound messaging.
- Do not create customer, messaging, agent, payment, Telegram, subscription or access logic in Phase 1.
- Run lint, typecheck, tests and build before closing a phase.
- Follow the latest explicit owner scope: continue through an authorized bounded batch; stop at its limit or a genuine external/security gate. Merge alone never closes a phase.
- Preserve the immutable build-pack snapshot and unsuccessful evidence. Later accepted reports/ADRs supersede historical phase-entry restrictions; a roadmap is never implementation authority.
- Keep changes minimal on a dedicated branch from current main. Use the pinned pnpm toolchain and targeted tests; require both CI jobs before recommending merge. Merge only when explicitly owner-authorized and both required CI jobs pass.
- Documentation-only changes need link/consistency checks and `git diff --check`; do not redeploy or rerun provider acceptance. `vercel.json` disables Git deployments for `main` and the documentation branch: verify exact-branch suppression before the first push of any implementation branch. Do not change deployment configuration without authorization.
- Deployments, production operations, paid-service provisioning, real-customer changes and each later phase need explicit owner scope. Follow DISCOVER → DESIGN → IMPLEMENT → TEST → VERIFY → REVIEW → CLOSE; merge alone does not close a phase.

## OWNER & CUSTOMER UX STANDARD

- From Phase 12 onward (including future Phases 13–18), customer communication defaults to professional English; honor a verified customer language preference/current explicit language request. Preserve EN/TR/AR/RU and grounding. Operator/owner language never selects customer language.
- Polat customer profiles must disclose that they are Polat’s AI assistant, never impersonate Polat or invent familiarity. Pure/offline guard evaluation is not live model, delivery, conversion or financial authority; see the Polat package reports.
- Admin UI defaults to tr-TR with a working en-US choice persisted per authenticated account; never derive customer language from this preference. Manager alerts and owner reports default to Turkish. Primary labels, controls, feedback and formatting use the selected admin locale. Internal enums/identifiers stay unchanged; present readable labels, status vocabulary and durations.
- Acceptance covers correctness, security/reliability, ease of use, visual clarity, customer/operator experience and speed. Include functional and UX criteria; verify mobile/keyboard use and show safe previews without unnecessary provider sends.
- Use consistent components, obvious next actions and minimal clicks/questions. Keep technical IDs/configuration secondary; label manual customer replies as English by default. Never present inferred delivery, takeover, assignment or financial actions as completed.
- Explain what changed, how the owner uses it and remaining decisions in Turkish. This standard is guidance only: Phase 16+ still requires explicit authorization. Detailed criteria: `docs/MASTER_PRODUCT_CONTEXT.md`.

Phase 13 CLOSED evidence: `docs/phases/PHASE_13_DESIGN.md` and `PHASE_13_REPORT.md`. Customer Success remains preview-only: no campaign sender, automatic charge or entitlement writer. Keep exact source/revision, consent, opt-out, contact-window, frequency, takeover and append-only review evidence. No worker/activation outside separately approved enabled `phase13-sandbox-*` fixtures. Phase16 work needs explicit scope; genuine activation and pilot remain unauthorized.

Phase 14 CLOSED, accepted design and evidence: `docs/phases/PHASE_14_DESIGN.md` and `PHASE_14_REPORT.md`. Survey collection is isolated to explicitly enabled, active, outbound-disabled `phase14-sandbox-*` fixtures plus the application forms test gate. No invitation/manager-alert sender exists. Approved question content is immutable. Anonymous web records have no contact/invitation/fingerprint mapping; fixed closed-month reports require k≥5 and suppress small cells. Never add per-response anonymous audit/IDs/exports or enrich named profiles. Cadence and retention default to null; live cohort/consent, privacy notice/jurisdictions, rollout and provider sends remain separate owner gates.

Phase 15 Revenue Intelligence is owner-approved and CLOSED on 2026-10-18 within isolated synthetic staging only: PR #100 accepted app SHA `fe823267365d7f0c554737081a7ff667cc730ae1`, main CI 39082475909 Application + Database PASS, staging 39082759184 59/59 PASS; no live payment/provider or customer-message activation. Accepted design and evidence: `docs/phases/PHASE_15_DESIGN.md`, 41 typed metrics in `packages/domain/src/analytics.ts` and `PHASE_15_REPORT.md`. Financial LIVE requires actual amount provenance; current receipt identity alone is insufficient. Keep exact numeric/asset-network separation, missing values null, no price-to-cash substitution, no model/run cost double count and Phase14 anonymous suppression. Economic review grants no payment/access/message authority. No live source writer or activation API. Only explicitly scoped repository-only Phase16 work is permitted; the pilot remains unauthorized.
