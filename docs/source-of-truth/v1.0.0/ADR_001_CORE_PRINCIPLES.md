# ADR-001 — Core Architecture Principles

Status: Proposed

## Decision
Gold Revenue OS will use:
- central Customer OS
- event-driven workflow
- deterministic money/access/state services
- tool-constrained agent runtime
- explicit human escalation
- append-only audit/event/state history
- multi-tenant data model

## Rationale
Free-form multi-agent architecture would create hidden state, duplicate actions,
payment/access risk and weak debuggability.

AI is used where language/reasoning is valuable.
Deterministic services control money, permissions and lifecycle correctness.

## Consequences
Positive:
- auditable
- easier debugging
- safer payments/access
- replaceable agents
- scalable

Cost:
- more backend work before flashy demos
- state/event discipline required
