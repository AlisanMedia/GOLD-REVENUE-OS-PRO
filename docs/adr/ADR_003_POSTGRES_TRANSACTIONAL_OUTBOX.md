# ADR-003 — PostgreSQL Transactional Outbox for Phase 3

Status: Accepted for Phase 3

## Decision

Lifecycle state, domain events and delivery intent commit in one PostgreSQL
transaction. `domain_events` is the append-only event store, `event_outbox` is
the leased delivery queue, and `event_inbox` is the per-consumer idempotency
ledger. Claim operations use `FOR UPDATE SKIP LOCKED`; retry and dead-letter
state remains in PostgreSQL.

No Redis, BullMQ or external worker service is introduced in Phase 3. A future
phase may add transport or worker capacity without changing the event envelope
or the transactional source of truth.

## Why

- A state update cannot commit without its event and outbox record.
- The existing Supabase/Postgres boundary already provides durability, row
  locks, RLS, backups and migration control.
- Current load does not demonstrate a need for a second consistency system.
- Avoiding an external queue removes cost, credentials and operational failure
  modes while the product is still foundation-first.

## Consequences

- Dispatcher throughput is bounded by PostgreSQL connection and write capacity.
- Consumers must use the inbox contract and remain idempotent.
- Outbox lag, retry count and dead-letter volume must be monitored.
- External queue adoption requires measured backlog/latency evidence and an ADR;
  it must not replace the event store as source of truth.
