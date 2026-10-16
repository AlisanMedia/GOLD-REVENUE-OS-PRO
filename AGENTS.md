# Gold Revenue OS engineering rules

Gold Revenue OS PRO is an existing modular-monolith revenue platform, initially for Telegram subscription businesses. Continue working modules; do not rebuild accepted phases.

Start with `docs/MASTER_PRODUCT_CONTEXT.md` for the current system/evidence map and `docs/NEXT_EXECUTION_BACKLOG.md` for proposed work. Verify remote `main`, exact-commit Application **and** Database check runs, latest accepted phase report and owner scope before implementation; empty combined status is not CI success.

Phases 7–11 are CLOSED only within their documented acceptance boundaries. Phases 1–6 retain their reports' implementation/validation scope. The owner has explicitly authorized Phase 12 implementation and controlled isolated-staging acceptance; Phase 13+ requires separate explicit authorization. Historical imports, live payments, production subscriptions/VIP access and broader outbound messaging remain locked/unauthorized. Do not repeat accepted real Telegram tests or change channel permissions without a specific reason and separate authorization.

Read `docs/source-of-truth/v1.0.0/` and accepted ADRs before changing architecture. ADR-002 controls the approved Phase 1 amendments.

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
- Stop after each phase report and wait for explicit approval.
- Preserve the immutable build-pack snapshot and unsuccessful evidence. Later accepted reports/ADRs supersede historical phase-entry restrictions; a roadmap is never implementation authority.
- Keep changes minimal on a dedicated branch from current main. Use the pinned pnpm toolchain and targeted tests; require both CI jobs before recommending merge. Merge only when explicitly owner-authorized and both required CI jobs pass.
- Documentation-only changes need link/consistency checks and `git diff --check`; do not redeploy or rerun provider acceptance. `vercel.json` disables Git deployments for `main` and the documentation branch: verify exact-branch suppression before the first push of any implementation branch. Do not change deployment configuration without authorization.
- Deployments, production operations, paid-service provisioning, real-customer changes and each later phase need explicit owner scope. Follow DISCOVER → DESIGN → IMPLEMENT → TEST → VERIFY → REVIEW → CLOSE; merge alone does not close a phase.

## OWNER & CUSTOMER UX STANDARD

- From Phase 12 onward (including future Phases 13–18), customer communication defaults to professional English; honor a verified customer language preference/current explicit language request. Preserve EN/TR/AR/RU and grounding. Operator/owner language never selects customer language.
- Operator UI, manager alerts, validation, progress and owner reports default to Turkish. Internal enums/identifiers stay unchanged; present readable labels, status vocabulary and durations.
- Acceptance covers correctness, security/reliability, ease of use, visual clarity, customer/operator experience and speed. Include functional and UX criteria; verify mobile/keyboard use and show safe previews without unnecessary provider sends.
- Use consistent components, obvious next actions and minimal clicks/questions. Keep technical IDs/configuration secondary; label manual customer replies as English by default. Never present inferred delivery, takeover, assignment or financial actions as completed.
- Explain what changed, how the owner uses it and remaining decisions in Turkish. This standard is guidance only: Phase 13+ still requires explicit authorization. Detailed criteria: `docs/MASTER_PRODUCT_CONTEXT.md`.
