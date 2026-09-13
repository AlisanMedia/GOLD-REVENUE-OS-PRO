# Gold Revenue OS engineering rules

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
