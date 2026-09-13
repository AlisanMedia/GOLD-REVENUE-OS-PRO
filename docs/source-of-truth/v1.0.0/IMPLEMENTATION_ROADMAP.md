# IMPLEMENTATION ROADMAP

Her faz:
design note → implement → automated tests → manual verification →
migration docs → commit → PHASE_X_REPORT.md → approval.

## Phase 0 — Repo Audit & ADR
REPO_AUDIT.md, TARGET_ARCHITECTURE.md, GAP_ANALYSIS.md, PHASE_1_PLAN.md.

## Phase 1 — Foundation
Next.js shell, Supabase, auth, tenant, RBAC, audit.

## Phase 2 — Customer OS
customers, identities, profile, memory, imports, dedup, state history.

## Phase 3 — State + Event Engine
transition service, event store, dispatcher, idempotent consumers, jobs base.

## Phase 4 — Admin Control Plane
dashboard, customers, Customer 360, audit, agent tasks, settings.

## Phase 5 — Messaging Gateway
Telegram inbound/outbound adapter, thread store, normalization,
rate limit, contact eligibility guard.

## Phase 6 — Agent Runtime
tool registry, tasks, prompt versioning, context builder, run logs,
cost/latency.

## Phase 7 — Conversation Quality
style profile, director, renderer, QA, shadow mode, approve/edit/reject.

## Phase 8 — Orchestrator + Lead Intelligence
event→task, profiling, qualification fields, next-best-action.

## Phase 9 — Conversion
products/prices, offers, objections, followups, trial.

## Phase 10 — Crypto Payment
adapter interface, intent, invoice, webhook, reconciliation, idempotency.

## Phase 11 — Subscription + Access
subscription engine, Telegram access, invite, expiry, revoke, sync.

## Phase 12 — Human Escalation
detection, temp response, critical queue, admin Telegram notification,
takeover/return.

## Phase 13 — Customer Success
onboarding, support, inactivity, renewal, churn, win-back.

## Phase 14 — Survey + Intelligence
survey builder, responses, insight extraction, pain point taxonomy,
product recommendation queue.

## Phase 15 — Analytics
funnel, cohort, conversion, MRR, churn, agent performance, cost,
escalation metrics.

## Phase 16 — Pilot
10 → 25 → 50 → 100.
No scale without explicit owner approval.

## Phase 17 — Hardening
load, backup/restore, DR, webhook replay, access reconciliation,
rate limits, prompt regression, security review.

## Phase 18 — Multi-tenant White-label
Only after own operation is stable.
