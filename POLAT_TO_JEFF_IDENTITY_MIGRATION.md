# Identity migration

- Old identity: Polat.
- New identity: Jeff.
- Telegram Business representative: @jeffryfx.
- Initial refactor commit: `4052fc86a3e2ed8bd864fa4db0e4b9c31064f04f`.
- Final migration implementation commit: `78dd9906b11728d6cc8f05bd7a4f012f06288753`.
- Protected baseline: `96aa1c83dab1ffaff0975dfa0f62d33c38c48d8f`.

The existing runtime continues with the same data, tenant/program, CRM, model journal,
campaign budget, provider bindings, payment/VIP lifecycle, ownership and STOP controls.
Current prompts represent Jeff VIP support and answer automation questions truthfully;
they never impersonate Jeff personally or claim to be human.

Active identifiers: Jeff*/jeff*/JEFF_*; `/admin/jeff-operations` and nested campaigns;
renamed components, modules, contract exports, fixtures/tests, scripts, Edge function
slugs, headers, selectors and protected workflow references. Numeric Telegram checks,
MFA, RLS/RBAC, payment verification, opt-out and human takeover remain mandatory.

Database migration `20261107091336_jeff_identity_namespace.sql` renames catalog objects
in place and copies old public RPC ACLs onto invoker-only forwarding shims. It checks
that existing private rows and conversation/model/subscription history are unchanged.
The selected current tenant/agent labels change with append-only audit records.
The owner’s earlier unprovisioned setup tenant also receives the current name,
only after an exact shared super-admin user ID check. Other people remain unchanged.
Current published prompt wording receives a new version on the same agent definition;
the old prompt stays unchanged and receives its normal superseded lifecycle marker.
The 83 already-applied migration files and accepted historical evidence remain intact.

Legacy compatibility is explicit: frozen HMAC/hash/lock domains; read-only stored
version/context aliases; old RPC forwarding; one permanent Admin redirect; complete
old signed ingress headers during cutover; temporary protected GitHub/Edge secret
aliases; previous branch names in deployment suppression. The exact per-file counts
and reasons are in `docs/identity-legacy-reference-inventory.json`. Historical names
are evidence, never dispatch or financial authority. There is no second runtime.

External numeric Telegram identity: NOT_TESTED. No ID was invented or changed, and
no genuine getMe/Business readback or customer message has been produced by this
migration. Only the expected Business username is configured as @jeffryfx.

Environment migration: current code and workflow environment keys use JEFF_*.
Vercel supports server-side key renaming without exposing values. GitHub stored
secret values are unreadable, so new-name-first protected aliases remain until
secure provider migration is confirmed. Exact candidate names are listed in
`infra/runbooks/jeff-identity-environment-names.md`; migrate only configured entries.
No secret value belongs in this note, chat, logs or artifacts.

Hosted publication and database application require the existing protected release;
local tests/merge are not publication, model, Telegram or device acceptance.
