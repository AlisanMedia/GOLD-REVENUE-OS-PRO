# Gold Revenue OS — Phase 1 Cloud Validation Report

**Status:** COMPLETE — GitHub CI, Supabase staging and Vercel Preview validation passed. Phase 2 remains blocked pending explicit user approval.  
**Last updated:** 2026-09-15  
**Validated application commit:** `49f0c8190e7d1ec794ab01e02b90a98741e6838d`  
**Rule:** no result is marked PASS without an executed cloud run and retained evidence.

## Validation targets

- GitHub repository: `AlisanMedia/GOLD-REVENUE-OS-PRO`
- Supabase staging: `gold-revenue-os-staging`, project ref `xqvwkghpmezcpgugetqc`, region `eu-central-1`
- Vercel staging project/team: `gold-revenue-os-staging`
- Production infrastructure: not created, linked, migrated or deployed

## Actual results

| Validation item | Status | Evidence | Actual result |
|---|---|---|---|
| GitHub CI | PASS | [CI Run #35000683966](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/35000683966) | Commit `49f0c819…`; workflow completed successfully. |
| Application job | PASS | CI Run #35000683966 | Install, lint, typecheck, Vitest, Next.js build, high-severity dependency audit and production bundle smoke completed. |
| Database job | PASS | CI Run #35000683966 | GitHub-hosted Ubuntu/Docker job completed successfully. |
| `supabase start` | PASS | CI Run #35000683966, Database job | Supabase local stack actually started. |
| Migration execution | PASS | CI Run #35000683966, Database job | Database rebuilt and `202609120001_foundation.sql` executed. |
| Migration history | PASS | CI Run #35000683966, Database job | Migration history verification completed. |
| Database lint | PASS | CI Run #35000683966, Database job | No blocking schema errors. |
| Foundation pgTAP | PASS | CI Run #35000683966, Database job | 11 checks executed successfully. |
| Tenant-isolation pgTAP | PASS | CI Run #35000683966, Database job | 6 checks executed successfully. |
| Local Auth smoke | PASS | CI Run #35000683966, Database job | User creation, sign-in, session, tenant RLS, manager audit read and sign-out executed. |
| Supabase staging link | PASS | [Staging Run #35001113563](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/35001113563) | Linked only project ref `xqvwkghpmezcpgugetqc`. |
| Supabase staging migration push | PASS | Staging Run #35001113563 | Remote migration push and local/remote migration-list verification completed. |
| Supabase staging lint | PASS | Staging Run #35001113563 | `No schema errors found`. |
| Supabase staging Auth smoke | PASS | Staging Run #35001113563 | `admin-create-user`, `password-sign-in`, `session`, `tenant-rls`, `manager-audit-read`, `sign-out`. |
| Vercel project identity | PASS | Staging Run #35001113563 | Exact organization/project IDs verified without logging credentials. |
| Vercel config pull | PASS | Staging Run #35001113563 | Preview environment and project configuration downloaded. |
| Vercel build | PASS | Staging Run #35001113563 | Vercel CLI 59.16.0, Node.js 24.19.0, Next.js 16.3.5; prebuilt output completed in 10s. |
| Vercel Preview deploy | PASS | Staging Run #35001113563 | Deployment reached Ready state. |
| Staging root and login smoke | PASS | Staging Run #35001113563 | `/` and `/login` validated through authenticated Vercel Preview requests. |
| Liveness | PASS | Staging Run #35001113563 | `/api/health/live` returned expected `status: ok`. |
| Readiness | PASS | Staging Run #35001113563 | `/api/health/ready` reached Supabase Auth and returned expected `status: ready`. |
| Admin access boundary | PASS | Staging Run #35001113563 | Unauthenticated `/admin` returned an accepted redirect status. |
| Evidence artifacts | PASS | Staging Run #35001113563 | Supabase and Vercel evidence artifacts uploaded with 14-day retention. |

## Deployment result

- **URL:** https://gold-revenue-os-staging-qsnrlssuk-gold-revenue-os-staging.vercel.app
- **Target:** Preview/staging
- **Status:** READY and endpoint-smoke verified
- **Commit:** `49f0c8190e7d1ec794ab01e02b90a98741e6838d`
- **Framework:** Next.js 16.3.5
- **Production:** not deployed

## Failure and remediation history

1. Staging Run #34927242881 initially could not deploy because the Vercel team had an overdue balance. The owner upgraded/reactivated the account; the next deployment succeeded.
2. The same run's retry exposed invalid `vercel curl` argument ordering: `--token` was forwarded to the underlying curl binary. No application defect was involved.
3. Commit `49f0c8190e7d1ec794ab01e02b90a98741e6838d` changed Preview validation to use `vercel curl <path> --deployment <url>`, with `VERCEL_TOKEN` supplied by the protected GitHub environment.
4. CI Run #35000683966 revalidated Application and Database after the workflow fix.
5. Staging Run #35001113563 then passed Supabase, build, deployment and all endpoint checks.

## Security observations

- Service-role/secret keys and database passwords remained in protected environment secrets and were masked in logs.
- Only the publishable Supabase key is exposed to the browser.
- Preview Deployment Protection remained enabled; validation used authenticated Vercel CLI requests instead of disabling protection.
- Production credentials and infrastructure were not used.
- Multi-tenant RLS and tenant-isolation tests ran in CI; staging Auth smoke verified tenant RLS against the hosted project.

## Remaining unverified items and risks

- Full interactive browser UX for login and admin navigation was not executed; Phase 1's API/Auth smoke and access-boundary checks passed.
- MFA/provider policy, custom-domain redirects and production allowlists remain intentionally deferred until their approved phases.
- Production Supabase, production Vercel deployment, production backups and disaster-recovery rehearsal are not part of this staging checkpoint.
- Vercel CLI `curl` is marked beta; its pinned version and staging checks should remain monitored.
- GitHub Actions evidence artifacts expire after 14 days; this report and linked run metadata are the durable summary.
- The repository is currently public by owner choice; it should be returned to private after the owner completes any desired external review.

## Rollback notes

- Application: redeploy the prior known-good Vercel Preview artifact or use the procedure in `infra/runbooks/rollback.md`.
- Database: the foundation migration is additive. Do not delete tenant or audit data to roll back; pause rollout and ship a reviewed forward corrective migration.
- Secrets: revoke/rotate any credential suspected of exposure, then update GitHub `staging` environment secrets and Vercel Preview environment variables before rerunning.
- Production rollback is not applicable because no production deployment occurred.

## Phase gate

Phase 1 cloud validation is complete. Phase 2 remains blocked until the user explicitly approves Phase 1 closure and authorizes Phase 2.
