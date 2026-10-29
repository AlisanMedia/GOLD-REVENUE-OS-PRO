# Campaign staging acceptance

This is a targeted acceptance operation on the already deployed staging. It does
not redeploy, migrate, enable a model, send Telegram messages or activate commerce.

1. Use protected current `main`, with exact-commit Application and Database SUCCESS
   from GitHub Actions app15368. Do not rerun the completed release40876292590.
2. Dispatch **Campaign Staging Acceptance**, supplying `validated_commit_sha` equal
   to that exact main SHA. Its existing `staging` environment review remains required.
   Follow [the accepted release governance](private-beta-release.md); Codex does not
   approve or bypass the founder's GitHub environment review.
3. Inspect `campaign-staging-acceptance-<SHA>` artifacts. PASS requires all56 original
   conditions, rollback inside the test connection, and a second independent
   connection verifying that reserved fixture tenants9901–9903 did not persist.
   A failed assertion, timeout, unknown connection outcome or incomplete artifact
   is not acceptance. No hosted pgTAP extension or permanent helper is installed.
4. Verify the founder UI **separately**, using the founder's actual authenticated
   Admin account and MFA at `/admin/polat-operations/campaigns`. Confirm the correct
   tenant, TR/EN labels, keyboard/mobile usability and batch/plan selectors. Record
   the deployed SHA, actual operator, time and observed result privately. The
   SQL fixture's `aal2` claims are not a real login or UI test.

Protected fields reused by the runner:

| Field | Purpose |
|---|---|
| `STAGING_GITHUB_GOVERNANCE_TOKEN` | Read existing ruleset and environment protections |
| `SUPABASE_ACCESS_TOKEN` | Link the exact existing staging project; no migration |
| `STAGING_SUPABASE_DB_PASSWORD` | Execute rollback-only synthetic SQL |
| `STAGING_SUPABASE_SSL_ROOT_CERT` | Verify the actual staging TLS hostname and certificate |

Only `xqvwkghpmezcpgugetqc`, PG17 and `verify-full` TLS are accepted. No model,
bot or payment credential is forwarded to the PostgreSQL container. Artifacts
contain assertion/source hashes and sanitized outcomes, never connection secrets,
raw database output, customer records or invented human quality ratings.
Rolled-back inserts may consume sequence values; this test does not claim to
restore sequences or prove hosted concurrent-worker acceptance.

## Observed release boundary

Read-only hosted inspection on2026-10-29 found79 migrations (latest20261029111003),
zero private-beta programs, zero sealed provider accounts, zero sealed bot
connections and zero campaigns. Secret names in GitHub do not establish these
server-owned bindings. Anonymous staging access to the campaign URL reached the
login page; authenticated founder UI acceptance remains unobserved.

The accepted campaign scheduler and fixture executor do not constitute a genuine
commercial executor. `campaign_runtime_scope_v1` and the native worker still deny
real campaign dispatch. The genuine UAT OpenAI/Telegram paths retain their own
scope and cannot be relabeled as commercial authority. Model account limits,
independent billing/account evidence, numeric bot/business identity and current
recipient permission must be verified before a genuine commercial binding can
be reviewed and implemented. Existing fake ACKs cannot substitute for delivery.

The actual historical customer file is still required for unique/eligible counts.
Use the existing import preview and one batch owner declaration; never commit the
file to GitHub. A Telegram ID alone does not make a customer reachable. Bot inbound
permission and Telegram Business reply windows remain platform requirements.

Genuine receipt writing and live entitlement authority remain disabled. Stars TEST
receipt/entitlement evidence is separate from genuine payment acceptance. An
approved product/XTR price, provider verification, supplier rights, eligible
jurisdictions and support/refund terms remain necessary for the first real sale.
`START` changes campaign state only; it cannot manufacture those prerequisites.
