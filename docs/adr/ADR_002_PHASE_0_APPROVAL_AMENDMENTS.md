# ADR-002 — Phase 0 approval amendments

Status: Accepted  
Date: 2026-09-12

## Decision

1. Payment architecture remains crypto-payment-first and provider-neutral. Telegram Stars is not the default. The final crypto provider is selected in the payment phase.
2. The data model preserves multi-tenant isolation. The first operating deployment is optimized for one tenant and Phase 1 has no tenant administration UI.
3. Phase 1 is restricted to repository foundation, authentication, tenant isolation, RBAC, immutable audit, environment validation, CI and a minimum admin shell.
4. Customer, messaging, agent, payment, Telegram, subscription and access logic remain outside Phase 1.
5. Human takeover and outbound kill switches remain P0 architectural requirements. Their implementation belongs to messaging/runtime phases and must precede automated outbound communication.
6. The project remains a modular monolith. New infrastructure must directly support correctness, security or the revenue lifecycle.
7. AI cannot mutate payment, access or lifecycle state directly. Those effects remain deterministic services behind validated tools.
8. Phase 1 ends with a report and an approval gate before Phase 2.

## Consequences

The initial repository has one web application and small shared packages. It has no worker, queue, provider adapter, customer schema or messaging runtime. Tenant selection is derived from membership and the current admin shell uses the first active tenant. Adding a second operational tenant later requires no schema rewrite, but will require an explicit tenant-switching interface.
