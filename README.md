# Gold Revenue OS

A modular-monolith, provider-neutral revenue operating system with channel-specific payment adapters.

## Phase status

Phase 7 is **CLOSED**, explicitly owner-approved on 2026-10-12. The final accepted application SHA is `4cd5b2eecff4068b37778882fe8b434c31521626`; see `PHASE_7_REPORT.md` for accepted evidence and preserved failure history. Phase 8 (Orchestrator + Lead Intelligence) is **CLOSED**, explicitly owner-approved on 2026-10-12. Accepted application SHA: `17d497656dbe5c178fe6650fe8064de6ebe199c8` (PR #70); see `PHASE_8_REPORT.md` for acceptance evidence and `docs/phases/PHASE_8_DESIGN.md` for design. Phase 9 (Conversion, including admin-managed product/pricing and Knowledge Base) is **CLOSED**, explicitly owner-approved on 2026-10-12. Accepted application SHA: `ee6d25ba86934a6d889926c02d9f8cf56a0441b8`; implementation, mandatory CI, controlled staging, fresh Telegram acceptance and authenticated fixture cleanup passed. See `PHASE_9_REPORT.md` for the formal acceptance and preserved failure history. Phase 10 is **CLOSED**, explicitly owner-approved on 2026-10-13 for provider-neutral Stars/independent web crypto **sandbox infrastructure only**. Accepted main/staging SHA: `031509dc3d447703954f9c76396a7ae8504a9213` (PRs #83–84; main CI `38428551092` and staging `38429095259` PASS). See `PHASE_10_REPORT.md`, `docs/phases/PHASE_10_DESIGN.md` and ADR-006. Live payment provider activation, real money collection and production VIP entitlement access remain **NOT AUTHORIZED**. Phase 11 (fenced Subscription Engine + Telegram VIP Access) is **CLOSED**, explicitly owner-approved on 2026-10-16 for deterministic sandbox plus fixed private-channel real Telegram provider staging acceptance only. Accepted application SHA: `68a4357bd9183a6977a71d98b1dffd76791c777c` (PR #86); verifier main SHA: `3a04630a579eb4e327cdd29896741a30df2b5916` (PR #87). See `PHASE_11_REPORT.md` and ADR-007. Phase 12+ is **NOT AUTHORIZED**.

See `PHASE_1_VALIDATION_REPORT.md` for the evidence gate and `MANUAL_ACTIONS_ROADMAP.md` for external dependencies through Phase 16.

## Cloud-first verification

The owner does not need Node.js, pnpm, Docker or the Supabase CLI locally. GitHub Actions provides Node.js 24.19.0, pnpm 11.19.0, Docker and Supabase CLI 2.117.0.

- `CI`: independent `Application` and `Database` jobs on every `main` push and pull request.
- `Staging Validation`: accepts a commit SHA, verifies both CI jobs passed for that SHA, then runs against isolated Supabase and Vercel staging projects.
- Production infrastructure and production secrets are not part of Phase 1.

## Optional maintainer workflow

```bash
cp .env.example .env.local
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:reset
pnpm dev
```

Copy the public URL and publishable key printed by the local Supabase stack into `.env.local`. Public signup is disabled. Follow `infra/runbooks/bootstrap.md` to associate an existing Auth user with the first tenant.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:db
```

Local execution is optional. The acceptance source of truth is the retained GitHub Actions evidence, not a maintainer laptop.

## Structure

- `apps/web`: Next.js admin shell and secure auth boundary
- `packages/config`: environment contracts
- `packages/contracts`: API and role contracts
- `packages/domain`: pure authorization rules
- `packages/observability`: redacted logging primitives
- `supabase`: Phase 1 migration and pgTAP tenant tests
- `docs/source-of-truth/v1.0.0`: immutable build-pack snapshot
- `docs/phase-0`: approved audit outputs
- `docs/adr`: accepted architectural decisions
- `infra/runbooks`: controlled operator procedures

Phases 7–11 are CLOSED within their expressly owner-accepted staging/test scopes. Live payment activation, live customer subscriptions and production Telegram VIP access are NOT authorized. Phase 12 and later phases are NOT authorized.
