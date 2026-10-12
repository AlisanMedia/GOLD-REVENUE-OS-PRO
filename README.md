# Gold Revenue OS

A modular-monolith foundation for a crypto-payment-first, provider-neutral revenue operating system.

## Phase status

Phase 7 is **CLOSED**, explicitly owner-approved on 2026-10-12. The final accepted application SHA is `4cd5b2eecff4068b37778882fe8b434c31521626`; see `PHASE_7_REPORT.md` for accepted evidence and preserved failure history. Phase 8 (Orchestrator + Lead Intelligence) is **CLOSED**, explicitly owner-approved on 2026-10-12. Accepted application SHA: `17d497656dbe5c178fe6650fe8064de6ebe199c8` (PR #70); see `PHASE_8_REPORT.md` for acceptance evidence and `docs/phases/PHASE_8_DESIGN.md` for design. Phase 9 (Conversion, including admin-managed product/pricing and Knowledge Base) is **READY FOR OWNER CLOSURE**: implementation, mandatory CI, controlled staging, fresh Telegram acceptance and authenticated fixture cleanup pass on application SHA `ee6d25ba86934a6d889926c02d9f8cf56a0441b8`; see `PHASE_9_REPORT.md`. Formal CLOSED status still requires explicit owner approval. Phase 10 has **no authorization**.

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

Phase 9 is ready for explicit owner closure. No Phase 10 payment processing or Phase 11 access automation is authorized.
