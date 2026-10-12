# Phase 8 — Orchestrator and Lead Intelligence

The roadmap requires event→task routing, profiling, qualification fields and next-best-action. Phase 7 supplied a Conversation-only consumer, leased tasks/runs, source-bounded context, QA and gated delivery. Customer OS already has profile field metadata and provenance-bearing memories. These are extended; no new business table, queue, provider or service is needed.

## Extension

- Opt-in tenant activation establishes a timestamp boundary. Historical events/drafts are untouched.
- The existing event consumer becomes the deterministic Orchestrator. Tenant/source identity, event authority, age and human control decide between Lead+Conversation, customer profile review or observation/hold. Decisions are audited, event/task keys are idempotent, and existing locks/leases/retries remain authoritative.
- Lead is a separate priority-60 task on the existing queue; Conversation remains priority 50 and the only reply producer. The same worker executes deterministic Lead extraction without invoking an LLM. Successful results use agent_runs; failures use existing retries/dead letters. Source ordering and per-conversation leases preserve Phase 7 behavior.
- Fields distinguish explicit self-report, authoritative system source, inferred topic and unknown. Recognized English/Turkish self-reports carry exact inbound source, quote, time and extraction confidence. Unrecognized wording stays Unknown rather than guessing. A signal-service history is not inferred from an unrelated software-service mention.
- Matched customers reuse customer_profiles.field_metadata and existing allowed customer_memory keys. Unmatched contacts retain only conversation-scoped run evidence. Telegram usernames never merge identities.
- A new customer question wins over qualification. Discovery requires explicit invitation, proposes one missing question and suppresses repeats. Disputes recommend human review; takeover, contact policy and kill switch recommend waiting. Later sales preparation is a recommendation, not a Conversion implementation or lifecycle transition.
- Conversation reads only the same source event's validated Lead result. A permitted qualification question changes the existing director goal; every ordinary reply still traverses the original renderer, grounding, QA, receipt, escalation and delivery gates. Specialist/task/routing names are never customer wording; truthful AI-identity handling is unchanged.
- Existing conversation detail and task/run screens show evidence, completeness, missing fields, next action and failures. No dashboard redesign.

## Boundaries and verification

Worker-only RPCs revoke browser/public execution. Admin reads enforce the existing active tenant-role helper. Provenance is rechecked inside the atomic persistence transaction; source quotes must exist in same-tenant inbound messages at or before the source boundary. No arbitrary AI database writes, new tools, payment/access/subscription mutations or automatic lifecycle transitions are introduced.

Validation: unit policy/extraction fixtures, mocked worker coordination, pgTAP routing/provenance/RBAC/stale/unmatched checks, real parallel database lease test, unchanged Phase 7 suites, lint/typecheck/build/security and mandatory Application/Database CI. One controlled staging release enables only future-source profiling for the authorized tenant, preserves single-conversation reply scope and verifies a minimal fresh-message smoke. No historical replay or paid Lead model calls.

Known limits: deterministic extraction intentionally leaves unsupported phrasing unknown; existing customer memory supplies the supported field subset, while remaining categories live in profile metadata. Retention decisions and complete Conversion/Payment/Subscription/Customer Success/Analytics engines remain future phases. Phase 9 is not authorized.
