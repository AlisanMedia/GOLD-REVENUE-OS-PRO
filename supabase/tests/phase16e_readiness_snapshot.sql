-- Test-only logical-recovery fingerprint. Never returns source rows or PII.
-- Called only by the loopback/container/PG17-guarded offline drill.
begin isolation level repeatable read read only;
set local timezone='UTC';
set local statement_timeout='15s';
with evidence_rows as (
 select 'namespaces' k,to_jsonb(x)::text v from private.fse_namespaces x
 union all select 'scopes',to_jsonb(x)::text from private.fse_scopes x
 union all select 'bindings',to_jsonb(x)::text from private.fse_binding_versions x
 union all select 'commands',to_jsonb(x)::text from private.fse_commands x
 union all select 'operations',to_jsonb(x)::text from private.fse_operations x
 union all select 'acquisitions',to_jsonb(x)::text from private.fse_acquisitions x
 union all select 'observations',to_jsonb(x)::text from private.fse_observations x
 union all select 'history',to_jsonb(x)::text from private.fse_history_entries x
 union all select 'assessments',to_jsonb(x)::text from private.fse_assessments x
 union all select 'claims',to_jsonb(x)::text from private.fse_operation_claims x
 union all select 'audit',to_jsonb(x)::text from public.audit_logs x
 union all select 'periods',to_jsonb(x)::text from public.subscription_payments x
 union all select 'jobs',to_jsonb(x)::text from public.entitlement_jobs x
 union all select 'access',to_jsonb(x)::text from public.channel_access x
 union all select 'test_runtime',to_jsonb(x)::text from private.entitlement_test_runtime x
 union all select 'test_policy',to_jsonb(x)::text from private.entitlement_test_policy x
), row_hashes as (
 select k,encode(extensions.digest(v,'sha256'),'hex') h from evidence_rows
), fingerprints as (
 select k,count(*) n,encode(extensions.digest(string_agg(h,'' order by h),'sha256'),'hex') digest from row_hashes group by k
), objects as (
 select 'table:'||c.relname k,jsonb_build_array(c.relrowsecurity,c.relforcerowsecurity,
  (select jsonb_agg(to_jsonb(a) order by grantee,grantor,privilege_type,is_grantable) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a),pg_get_userbyid(c.relowner))::text v
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and (c.relname like 'fse_%' or c.relname in ('entitlement_test_runtime','entitlement_test_policy'))
 union all
 select 'function:'||p.proname||':'||pg_get_function_identity_arguments(p.oid),jsonb_build_array(pg_get_functiondef(p.oid),
  (select jsonb_agg(to_jsonb(a) order by grantee,grantor,privilege_type,is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),pg_get_userbyid(p.proowner))::text
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and (p.proname like 'fse_%' or p.proname like 'entitlement_test_%' or p.proname in ('prepare_financial_evidence_v1','record_financial_evidence_v1','read_financial_evidence_command_v1'))) or (n.nspname='public' and (p.proname like 'admin_financial_evidence_%' or p.proname in ('entitlement_test_claim_cycle_v1','entitlement_test_begin_effect_v1','entitlement_claim_job','entitlement_complete_job')))
)
select jsonb_build_object('version',1,'classification','SYNTHETIC','financial_authority','NONE',
 'tables',(select jsonb_object_agg(k,jsonb_build_object('rows',n,'sha256',digest) order by k) from fingerprints),
 'security_objects_sha256',(select encode(extensions.digest(string_agg(k||v,'' order by k),'sha256'),'hex') from objects),
 'security_object_digests',(select jsonb_object_agg(k,encode(extensions.digest(v,'sha256'),'hex') order by k) from objects),
 'receipt_count',(select count(*) from private.verified_payment_receipts),
 'live_subscription_count',(select count(*) from public.subscriptions where mode='live'),
 'live_access_count',(select count(*) from public.channel_access where mode='live'),
 'confirmed_payment_count',(select count(*) from public.domain_events where event_type='payment.confirmed'),
 'runtime_writer_allowed',has_function_privilege('service_role','private.record_financial_evidence_v1(text,text)','EXECUTE'),
 'authenticated_raw_read',has_table_privilege('authenticated','private.fse_observations','SELECT'),
 'service_raw_write',has_table_privilege('service_role','private.fse_operation_claims','INSERT'),
 'all_claims_none',not exists(select 1 from private.fse_operation_claims where financial_authority<>'NONE'),
 'read_only_views',(select count(*)=2 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('fse_allocation_candidates_v1','fse_refund_correlations_v1') and c.relkind='v' and c.reloptions @> array['security_invoker=true']),
 'fixture_outbound',exists(select 1 from public.tenants where (slug like 'phase16c1b-sandbox-%' or slug like 'phase11-sandbox-16de-%') and outbound_messaging_enabled));
commit;
