# Phase 1 rollback

Phase 1 migrations are additive. In local and CI environments, reset the disposable database and replay migrations. In a persistent environment, roll back the web deployment first and use a reviewed forward migration for schema corrections.

Do not drop `audit_logs`, `tenant_members`, `tenants` or Auth identities to reverse a release. Preserve audit evidence. If authorization is faulty, disable application traffic, restore the last working web version, correct the policy in a new migration and rerun tenant isolation tests.
