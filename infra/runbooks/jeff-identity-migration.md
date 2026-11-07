# Jeff identity cutover

Jeff is the renamed existing runtime. The Business representative is @jeffryfx;
the numeric bot ID and representative user ID remain independently verified.
A human Business username is not a bot token/getMe identity. Do not bind a new ID
from a handle or screenshot. Preserve the protected numeric binding flow.

1. Require exact protected main Application + Database SUCCESS and a protected PR.
2. Use the existing `Private Beta UAT Release` workflow, `release_disabled`, exact
   accepted main SHA and the existing program `67c4707d-33cb-407e-b617-07a7ff090182`.
   Keep `authorized_founder_recovery=false`. Preserve the approved backup retention.
3. Existing hosted backup and independent PG17 restore run before the pending
   identity migration. The read-only fingerprint detects the actual catalog namespace.
   Only an explicitly selected, expired v4 OWNER_ONLY program with exactly two stopped
   UNKNOWN canaries, no participants/invites/Business binding and no later result is
   eligible for identity-publication backup. It gives no runtime, reconciliation or
   resend authority; all other active windows block.
4. The new migration preserves physical OIDs, all private rows, conversation/model/
   subscription history, grants and RLS. The selected tenant label changes with an
   append-only before/after audit. Public old RPCs forward as invoker-only shims under
   their original ACLs; there is one physical set of tables and one implementation.
5. Vercel stored keys can be renamed server-side by environment-variable ID with only
   the `key` field. Preserve value/type/targets; do not decrypt, print or paste values.
   Require metadata readback. Current deployments keep their immutable snapshots.
6. GitHub stored secret values are unreadable. Reviewed workflow expressions use new
   `JEFF_*` names first and exact old stored aliases temporarily. Edge reads use
   `readJeffSecret`; conflicting aliases fail closed. New runtime env keys are Jeff only.
   Copy actual existing configured secrets through the provider's protected interface;
   never request them in chat or invent optional/unconfigured secrets.
7. The renamed ingress deploys before any potential new destination. Preserve the old
   hosted ingress until genuine getMe, current webhook state, exact destination, new
   ingress deployment and secret custody are verified. Existing protected registration
   refuses an unknown webhook. Do not call setWebhook for this rename blindly.
8. Verify artifacts, canonical aliases, deployed SHA, migration 84 and selected tenant
   readback. Do not restart successful jobs/migrations. Retain UNKNOWN attempts and
   the total reservation. An expired/held canary remains held after a release.

The repository guard and legacy-reference census document every retained old name:
applied migrations, accepted historical reports/ADRs, historical citations, frozen
wire/crypto aliases, route redirect, the additive migration and negative/preservation
tests, old branch deployment suppression, and protected secret bootstrap expressions.
No customer record, historical evidence, sealed manifest, published agent version,
financial receipt, subscription or Telegram numeric identity is relabelled as new proof.

Release readiness, real model output, Telegram delivery and device observation are
four separate results. Report unknown/blocking facts without substituting approvals,
HTTP 200, spend screenshots, synthetic ACKs or a code merge for provider evidence.
