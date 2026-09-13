# Gold Revenue OS

A modular-monolith foundation for a crypto-payment-first, provider-neutral revenue operating system.

## Phase status

Phase 1 implementation exists but remains open pending cloud validation. Repository structure, authentication, tenant isolation, RBAC, immutable audit, environment validation, CI and the minimum admin shell are implemented. No customer, messaging, agent, payment, Telegram, subscription or access runtime is included.

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
