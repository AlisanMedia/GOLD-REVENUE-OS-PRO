# Phase 13 — Customer Success and premium TR/EN Admin

**OPEN — implementation and isolated synthetic acceptance authorized; formal closure requires separate owner approval.**

Baseline: `d6a76ce534d1fbe770a94c41721878d0a0c0b43a`, Phase 12 formal closeout PR #93, main CI `38943161057` Application + Database PASS. Phase 12 provider evidence `38907164142` is retained; this increment sends no new Telegram manager alert.

## Delivered implementation

- Account-persisted default Turkish/selectable English Admin; self RLS, typed copy, explicit enum labels, UTC/locale numbers and precise decimal formatting. Customer English/verified alternative language is independent, including source-bound preference lookup for the existing conversation engine.
- Premium shared dark/gold frame, role-filtered navigation/search, accessible mobile menu, active route, loading/error/unavailable views and responsive customer cards. Existing commercial/payment/subscription controls retain backend authority.
- Actual tenant-data operational charts: current lifecycle/task/workload/conversation-control distributions, daily message and escalation activity, bounded 7/30/90-day filters, honest empty/restricted states and accessible data tables. No live revenue/MRR/LTV/profit claims.
- Integrated Customer Success tasks for onboarding, linked support, observed inactivity, verified-term renewal, reasoned churn and win-back review; ownership/assignment/status/revision/audit and Customer 360 links.
- Existing PostgreSQL scheduled jobs, source-change reconciliation, duplicate prevention, stale-source retirement, concurrency fencing and bounded retry recovery and visible, audited management retry. Existing authenticated cron drains review jobs; a CS-only workload isolates acceptance from AI/Telegram senders. Mutation remains explicitly configured isolated synthetic sandbox only.
- English-default EN/TR/AR/RU message previews with consent/contactability, opt-out, customer-local windows, frequency, human-takeover/open-case and source guards. Internal preview review records `approved_for_delivery=false`; no campaign sender, charge/renewal or access writer.

## Evidence and limits

Detailed rationale/criteria: [Phase 13 design](docs/phases/PHASE_13_DESIGN.md). Tests: [pgTAP](supabase/tests/phase13_customer_success.test.sql), [concurrency](supabase/tests/phase13_concurrency.sh), [UI](tests/integration/phase13-admin-ux.test.ts), [actions](tests/integration/phase13-admin-actions.test.ts), [customer language](packages/domain/src/customer-language.test.ts), [authenticated staging](apps/web/scripts/phase13-staging.mjs).

[Implementation PR evidence ledger](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/pulls?q=is%3Apr+head%3Acodex%2Fphase13-success-admin-20261016) and final downloadable `PHASE_13_OWNER_ACCEPTANCE_REPORT` record exact application/merge SHA, required CI jobs, controlled staging run, sanitized fixture reconciliation, screenshots and failures. Do not infer PASS from this implementation inventory or from merge alone; verify those authoritative check runs and acceptance artifacts. The owner-facing report explains use and next decisions in Turkish.

Local full Supabase image startup exhausted this workspace's Docker storage; the attempt was stopped and unnecessary task images removed. Focused SQL/pgTAP/concurrency checks use disposable PostgreSQL 17 with test auth fixtures. This is not claimed as full Supabase/Auth acceptance; mandatory GitHub Database CI and controlled authenticated staging are the environment gates.

Previews and staging membership are explicitly synthetic, not genuine payment/Telegram-provider acceptance. Original customer/commercial text stays original; manager notes are human attestations. Current distribution graphs are snapshots; date filters apply to activity series. Full financial analytics, live contact policies/cohorts/operations and Phase 14+ remain separately gated. Contact windows support explicit same-day intervals; no overnight window policy is inferred.

## Security and next owner gate

Live payments, real-customer campaigns, production subscriptions/VIP, historical imports and persistent production escalation remain disabled/locked. Existing Telegram bot/channel administrator permissions, paid services and production settings are unchanged. Exact-branch Git deployment suppression accompanies the first feature push; only controlled isolated staging is permitted.

Stop after Phase 13 technical/usability acceptance and request owner review. Do not formally close Phase 13 or begin Phase 14 without a new explicit instruction. [Master context](docs/MASTER_PRODUCT_CONTEXT.md), [backlog](docs/NEXT_EXECUTION_BACKLOG.md).
