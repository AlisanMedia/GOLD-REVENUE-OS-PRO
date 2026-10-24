# Signal source capability and recovery — Package A

Repository-only synthetic implementation based on main `11dafaddafe8d82b118d36d45085c0121c6516c9`. Owner batch authorization: 2026-10-24, package 1 of 4. This report records pre-publication local evidence; exact PR/head/merge and mandatory CI evidence belong to the consolidated owner report after publication.

## Implemented boundary

- Strict versioned FAKE source capability declarations: fixture identity, simulated authorization, message/edit/delete support, sequence and independent fake-history capability. Channel membership never establishes redistribution rights.
- Additive private RLS tables for immutable capability versions, immutable original observations, a mutable generation-fenced checkpoint and append-only command/recovery history. No authenticated/service-role writer grants, network adapter, login/session data or hosted migration.
- Explicit disconnected, recovering, gap, restricted, conflict, limited and unrecoverable states. Network reconnect alone cannot prove recovered history or clear a terminal obligation. A source with unknown sequence capability fails closed.
- At most 64 consecutive entries per command, three incomplete recovery attempts and a 15-minute **TEST-only** recovery window. Sixty-second source freshness gates dispatch. Unsupported/long recovery requires review and a separately authorized integration; these limits are not a LIVE Telegram policy.
- Command identity/hash replay, generation/epoch fencing and deterministic controls-before-checkpoint locking. Capture, promotion, checkpoint and audit commit atomically. Original observations never change. Existing event revision/delivery fencing remains authoritative.
- Existing fixture gate/policy functions retain their object identities. Sources without a configured recovery layer retain their previous policy hash and behavior. Configured source state transitions fence queued/leased work; they do not revive stale delivery jobs.
- Restricted content is never retrieved or reconstructed. Recovery uses separately supplied fake history; its label/hash does not prove genuine provider authentication. Alternative authorized sources must be configured separately rather than resetting a restricted source.

## Local evidence

Disposable local PostgreSQL **17.11**, fresh database, pinned repository toolchain. No remote database or provider involved.

| Check | Actual result |
| --- | --- |
| New domain tests | 16 PASS |
| New source pgTAP | 48 PASS |
| Existing distribution pgTAP | 78 PASS |
| Real independent PostgreSQL backends | PASS: precommit work invisible; terminated recovery rolls back; later recovery promotes exactly once; two workers with one checkpoint produce one winner and one fenced loser |
| Full unit suite | 1004 PASS |
| Full integration suite without DB bridge | 421 PASS, 14 explicitly skipped DB-context tests; mandatory Database CI supplies its own database acceptance |
| Lint, strict TypeScript, production build | PASS |

The first 39-assertion source run had **1 FAIL**: an empty reconnect drain incorrectly restored CONNECTED. Fixed by a persisted recovery-required fence and excluding RECONNECT from promotion. Added regression proves a duplicate callback cannot clear that obligation. Original unsuccessful local evidence is retained outside Git; this failure is not rewritten as an original PASS.

## Acceptance and remaining limitations

Tests cover missing/reordered/duplicate/conflicting events, edits and deletes during an outage, independent sources, restricted content, incomplete/oversized/cache-derived history, unknown capabilities, stale/future/foreign checkpoints, crash rollback, command replay, role denial, immutable originals and stale activity. All results keep `financial_authority=NONE` and `live_operations_authorized=false`.

This package provides fixture-only source operations, not a scheduler, Telegram connection, session store, LIVE retry policy or production monitoring. A real provider must establish its sequence/recovery semantics, permissions, independent observations, gap window and external acceptance separately. There is no claim of real signal delivery, hosted capacity or commercial readiness. Existing subsecond benchmark failure remains unchanged for investigation in Package C.

## Sources

- [Recovery contracts](packages/contracts/src/signal-recovery.ts), [domain helper](packages/domain/src/signal-recovery.ts) and [domain tests](packages/domain/src/signal-recovery.test.ts).
- [Additive migration](supabase/migrations/20261024031459_signal_source_recovery.sql), [pgTAP](supabase/tests/signal_recovery.test.sql) and [independent-backend test](supabase/tests/signal_recovery_concurrency.sh).
- [Accepted distribution](SIGNAL_DISTRIBUTION_ENGINE_REPORT.md), [commercial restrictions](infra/runbooks/signal-commercial-readiness.md) and [CI](.github/workflows/ci.yml).

Commercial pilot remains **NO-GO**. Overall Phase16C-1 remains OPEN. No deployment, external message, payment, receipt, VIP change or historical import is part of this package.
