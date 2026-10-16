# Phase 13 — Customer Success and premium localized administration

Status: **owner-authorized implementation; OPEN pending separate owner acceptance**. Baseline main: `d6a76ce534d1fbe770a94c41721878d0a0c0b43a` (Phase 12 formal closeout PR #93, exact Application + Database PASS). Phases 1–12 remain closed within accepted boundaries. Phase 14+ is not authorized.

## Product and authority

The manager sees what is happening, which review needs attention and the next safe action. Customer Success adds a review layer over the existing Customer OS, subscriptions and escalation cases; it does not create a second CRM, payment ledger or complaint authority.

`source change → existing scheduled job → current-evidence reconciliation → one scoped task → manager review → immutable history/audit → safe preview/internal review`

There is no Customer Success customer-message sender, payment/access writer, new cron, external queue or paid dependency. Event-driven mutation is limited to explicitly enabled active, outbound-disabled `phase13-sandbox-*` tenants. No production activation API is introduced. Service-only sandbox configuration cancels remaining CS jobs when disabled.

## Existing components reused

- Customer IDs, lifecycle, profile, communication contacts and conversation evidence remain authoritative in Customer OS/messaging.
- Subscriptions and immutable payment periods prove term/mode. A live term must match genuine signed/independently verified receipt evidence; simulations stay TEST.
- Phase 12 cases own human takeover/support resolution/return. CS support tasks link those cases and close only when the case resolves.
- PostgreSQL scheduled jobs, row locks, revision conflicts (`PT409`), tenant/RBAC checks and append-only global audit remain the concurrency/security boundary.

## Tasks and safeguards

| Task | Source / next step | Negative acceptance |
| --- | --- | --- |
| Onboarding | Current subscription/payment period and backend membership; payment review → access review → ready | Payment alone or customer assertion cannot complete membership onboarding; TEST never becomes live |
| Support | Existing case/category/severity/revision | CS cannot bypass case resolution or unpause AI |
| Inactivity | Last observed inbound; 14-day review threshold | Missing evidence is UNKNOWN, not abandonment; recent activity dismisses stale tasks |
| Renewal | Verified existing subscription revision and due/end dates | No automatic charge/renewal; changed/cancelled terms invalidate old reviews/previews |
| Churn | Cancelled/expired verified term plus explicit manager reason and source-bearing note | Expiry does not invent a churn reason; unknown reason cannot create a reviewed win-back recommendation |
| Win-back | Completed reasoned churn review, source revisions | A current verified subscription or superseded source invalidates the recommendation; no guarantees/discount claims |

One task per tenant/customer/kind/source key; evidence changes increment revisions. Bounded 100-customer review batches expose continuation cursors. Worker batches use `FOR UPDATE SKIP LOCKED`; a customer lock serializes reconciliation; stale generic leases recover from current evidence, failures use bounded backoff/dead letter with append-only failure audit. Queue health exposes blocked reviews; management-only fenced retry preserves earlier failure evidence. Access/payment updates enqueue review jobs too; verified renewal/term-end dates and observed-inbound inactivity thresholds schedule future reviews in the same queue. Stale due jobs reevaluate current evidence and cannot act on old terms. The existing authenticated `/api/internal/agent-worker` drains configured sandbox CS jobs; its `workload=customer-success` acceptance path invokes no AI/Telegram sender. The existing cron schedule is unchanged. No provider side effects occur.

Contact preferences require manager attestation and a source reference. Preview defaults to English; only reviewed EN/TR/AR/RU preference/current explicit language request may override. Admin locale is never an input. Preview checks consent/opt-out, verified contact, customer timezone/local-hour window, pending/sent-message caps (1/24h, 3/7d), takeover/open cases, task state and source freshness. Unknown timezone/consent fails closed. Windows are explicit same-day local-hour intervals; overnight windows are not configured by this increment. Template text is fixed and bounded; renewal dates come from current verified terms.

Preview creation is idempotent per task/policy revision. Immutable previews record checks at creation; requesting preview reevaluates current guards. Internal approval checks current evidence, task ownership and contact guards, then appends `approved_for_delivery=false`. This is internal dry-run review, never a customer-send authorization.

## Language and interface

`admin_preferences(user_id, locale)` is an account-owned preference, with self RLS and `WITH CHECK`; only authenticated current user IDs are written. SSR lookup is request-local. Default `tr-TR`, selectable `en-US`; one user's choice cannot affect another user or tenant authorization. Central typed copy, explicit enum presentation and locale formatting preserve backend values and original customer/commercial text. Precise decimal strings never lose financial precision through `Number` conversion. Dates explicitly show UTC; contact windows use the customer's verified timezone.

The shared dark/gold frame has grouped role-filtered navigation, active state, navigation search, accessible mobile dialog, header language selector and skip link. Customer mobile cards use the same authorized read projection as desktop. Technical IDs/evidence are secondary; original text is not translated. Manual customer replies remain English by default.

Dashboard uses PostgreSQL tenant aggregates and lightweight accessible SVG/distribution charts with native data-table alternatives and 7/30/90-day activity filters. Current lifecycle/task/control distributions remain current snapshots. Message counts are activity records, not proof of delivery; case charts count openings/resolutions and current critical priority. Missing/restricted data gets an empty/unavailable view. No financial totals/MRR/LTV/profit are introduced; Phase 15 remains separate.

## Acceptance and release

- Focused domain, UI, action, self/tenant/RBAC, source freshness, consent/timezone/frequency, worker/concurrency, audit and financial/access invariants.
- Mandatory exact-commit Application + Database, including full retained suites and Phase 13 pgTAP/concurrency/authenticated Admin HTTP/native language-action checks.
- Actual application components, synthetic fixtures, TR/EN at 320/390/768/1440px; inspect screenshots and keyboard/mobile controls.
- Exact feature-branch Vercel Git suppression before first push; unchanged `main=false`/other branch rules, project settings and cron.
- One controlled isolated staging deployment/Phase 13 acceptance; no old real Telegram acceptance, manager alert, payment webhook window or production activation. Disable fixtures/CS controls and preserve evidence.
- Merge is separately owner-authorized after both CI jobs pass. Formal Phase 13 closure requires later explicit owner approval. [Implementation report](../../PHASE_13_REPORT.md).
