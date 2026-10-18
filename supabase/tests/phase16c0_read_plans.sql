-- Run against the SAME disposable fixtures before/after the additive migration.
-- Never run this workload against hosted staging or production.
\set ON_ERROR_STOP on
\pset pager off
analyze public.subscriptions;
analyze public.channel_access;
analyze public.subscription_payments;
analyze public.entitlement_jobs;
analyze public.entitlement_audit;
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000001',false);
explain (analyze,buffers) select public.admin_entitlement_list('e3200000-0000-4000-8000-000000000001');
select octet_length(public.admin_entitlement_list('e3200000-0000-4000-8000-000000000001')::text) as legacy_json_bytes,
 jsonb_array_length(public.admin_entitlement_list('e3200000-0000-4000-8000-000000000001')->'audit') as legacy_audit_rows;
explain (analyze,buffers) select id,created_at from public.subscriptions where tenant_id='e3200000-0000-4000-8000-000000000001' order by created_at desc,id desc limit 26;
explain (analyze,buffers) select id,created_at from public.subscriptions where tenant_id='e3200000-0000-4000-8000-000000000001' and customer_id='ec020000-0000-4000-8000-000000000001' order by created_at desc,id desc limit 26;
explain (analyze,buffers) select id from public.channel_access where tenant_id='e3200000-0000-4000-8000-000000000001' and id<'ec060000-0000-4000-8000-000000000101' order by id desc limit 26;
explain (analyze,buffers) select id from public.entitlement_jobs where tenant_id='e3200000-0000-4000-8000-000000000001' and access_id='ec060000-0000-4000-8000-000000000001' and id<'ec071000-0000-4000-8000-000000001000' order by id desc limit 26;
explain (analyze,buffers) select id,period_start from public.subscription_payments where tenant_id='e3200000-0000-4000-8000-000000000001' and subscription_id='ec030000-0000-4000-8000-000000000001' and (period_start,id)<('2020-03-01Z'::timestamptz,'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid) order by period_start desc,id desc limit 26;
explain (analyze,buffers) select id,created_at from public.entitlement_audit where tenant_id='e3200000-0000-4000-8000-000000000001' and subscription_id='ec030000-0000-4000-8000-000000000001' and (created_at,id)<('2026-01-01T00:02:00Z'::timestamptz,'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid) order by created_at desc,id desc limit 26;
