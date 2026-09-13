# Gold Revenue OS — Phase 1 Cloud Validation Report

**Status:** GitHub CI and Supabase staging validation COMPLETE; Vercel staging validation remains pending.
**Last updated:** 2026-09-13  
**Rule:** no result is marked PASS without an executed run and retained evidence.

## Target architecture for validation

- GitHub repository: `AlisanMedia/GOLD-REVENUE-OS-PRO` (temporarily public by owner decision)
- Required GitHub Actions jobs: `Application`, `Database`
- Isolated hosted Supabase project: `gold-revenue-os-staging`
- Isolated Vercel project: `gold-revenue-os-staging`
- Production infrastructure: not created, linked or used

## Actual results

| Validation item | Actual status | Evidence | Notes |
|---|---|---|---|
| GitHub repository | PASS | [`GOLD-REVENUE-OS-PRO`](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO) | Checkpoint uploaded to `main`; currently public and can be made private after completion. |
| GitHub CI workflow | PASS | [Run #34753020142](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/34753020142) | Commit `f73ac2b0134f240c99855f4986f54af5af7b0b6f`; both required jobs successful. |
| Application job | PASS | Run #34753020142 | GitHub-hosted Ubuntu execution completed successfully. |
| Application lint | PASS | Run #34753020142 | Executed in GitHub Actions. |
| Application typecheck | PASS | Run #34753020142 | Executed in GitHub Actions. |
| Application unit/integration tests | PASS | Run #34753020142 | 10 Vitest tests passed. |
| Next.js production build | PASS | Run #34753020142 | Executed in GitHub Actions. |
| Production bundle HTTP smoke | PASS | Run #34753020142 | `/`, `/login`, and liveness checked. |
| Database job | PASS | Run #34753020142 | GitHub-hosted Ubuntu with Docker completed successfully. |
| `supabase start` | PASS | Run #34753020142 | Supabase CLI 2.117.0; local stack started. |
| Migration execution via `supabase db reset` | PASS | Run #34753020142 | `202609120001_foundation.sql` applied. |
| Migration history verification | PASS | Run #34753020142 | Local and remote both `202609120001`. |
| Database lint | PASS | Run #34753020142 | No schema errors found. |
| Foundation pgTAP suite | PASS | Run #34753020142 | Files=1, Tests=11, Result: PASS. |
| Tenant isolation pgTAP suite | PASS | Run #34753020142 | Files=1, Tests=6, Result: PASS. |
| Local-stack Auth smoke in GitHub | PASS | Run #34753020142 | User creation, password sign-in, session, tenant RLS, audit read and sign-out. |
| Supabase staging project created | PASS | Supabase project ref `xqvwkghpmezcpgugetqc` | `gold-revenue-os-staging`, `eu-central-1`, `ACTIVE_HEALTHY`, Postgres `17.6.1.166`. |
| Staging CI gate | PASS | [Staging Run #34757851016](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/34757851016) | Workflow confirmed `Application: success` and `Database: success` for the exact validated commit on `main`. |
| Staging link and migration push | PASS | Staging Run #34757851016 | Linked only project ref `xqvwkghpmezcpgugetqc`; applied `202609120001_foundation.sql`. |
| Staging migration history | PASS | Staging Run #34757851016 | Local and remote migration versions both `202609120001`. |
| Staging database lint | PASS | Staging Run #34757851016 | Linked schemas `extensions`, `private`, and `public`; no schema errors found. |
| Staging authentication smoke test | PASS | Staging Run #34757851016 | `admin-create-user`, `password-sign-in`, `session`, `tenant-rls`, `manager-audit-read`, and `sign-out` all passed. |
| Vercel staging project created/linked | NOT RUN | None | External account action required. |
| Vercel staging build/deploy | NOT RUN | None | `vercel@59.16.0` pinned; starts after successful CI. |
| Staging `/`, `/login`, liveness and readiness | NOT RUN | None | Pending deployment. |
| Unauthenticated `/admin` redirect | NOT RUN | None | Pending deployment. |

## Prepared cloud controls

- `.github/workflows/ci.yml`: two independent required jobs, explicit migration rebuild, separate pgTAP suites, auth smoke and retained DB evidence.
- `.github/workflows/staging.yml`: manual cloud gate that first verifies `Application` and `Database` succeeded for the supplied commit SHA; then links only the staging project, applies migrations and performs remote auth smoke. Its separate Vercel job runs only when `run_vercel=true` and the Supabase job succeeded.
- `apps/web/scripts/auth-smoke.mjs`: ephemeral Auth user, real password sign-in/session, tenant RLS and audit visibility test; no credential values logged.
- `vercel.json`: root-workspace build configuration.
- GitHub `staging` environment secrets are required; production secrets are intentionally absent.

## Independent Supabase verification

After Staging Run #34757851016 completed, the connected Supabase project was queried independently:

- Project status: `ACTIVE_HEALTHY`
- Project/region: `gold-revenue-os-staging` / `eu-central-1`
- Database version: Postgres `17.6.1.166`
- Recorded migration: `202609120001 foundation`
- RLS enabled: `public.tenants`, `public.app_users`, `public.tenant_members`, and `public.audit_logs`
- Supabase security advisors: no findings
- Supabase performance advisors: no findings

## Current blocker

GitHub cloud execution and Supabase staging validation are complete. Vercel staging remains intentionally unexecuted: Staging Run #34757851016 skipped the Vercel job because `run_vercel=false`. The isolated Vercel staging project and scoped secrets must be configured before deployment validation. Production infrastructure was not used. Phase 2 remains blocked.

## Evidence to record after execution

- Repository URL and validated commit SHA
- GitHub Actions CI run URL and both job conclusions — recorded above
- Exact migration version shown by the runner
- Foundation pgTAP output (`Files=1, Tests=11, Result: PASS`) — recorded above
- Tenant isolation pgTAP output (`Files=1, Tests=6, Result: PASS`) — recorded above
- Local authentication smoke JSON output — PASS recorded above
- Supabase staging project ref and migration list — recorded above
- Staging authentication smoke JSON output — PASS recorded above
- Vercel staging deployment URL/ID, build status and endpoint smoke results
- Every failed/retried step and the exact remediation commit

## Phase gate

Phase 1 remains open until Vercel staging deployment and endpoint checks have actually run, failures have been fixed, and final evidence is written here. Do not begin Phase 2 before explicit approval.
