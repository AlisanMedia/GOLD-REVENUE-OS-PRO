begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select function_returns('public', 'admin_customer_list', array['uuid','text','customer_state','text','text','text','uuid','timestamptz','timestamptz','integer','integer'], 'jsonb', 'customer list read model exists');
select function_returns('public', 'admin_dashboard_metrics', array['uuid'], 'jsonb', 'dashboard read model exists');
select function_returns('public', 'admin_event_list', array['uuid','text','text','event_authority','uuid','uuid','timestamptz','timestamptz','integer','integer'], 'jsonb', 'event operations read model exists');
select function_returns('public', 'admin_needs_attention', array['uuid'], 'jsonb', 'needs-attention read model exists');
select function_returns('public', 'admin_audit_list', array['uuid','uuid','app_role','text','text','uuid','timestamptz','timestamptz','integer','integer'], 'jsonb', 'audit read model exists');
select function_returns('public', 'admin_system_health', array['uuid'], 'jsonb', 'system-health read model exists');
select ok(not has_function_privilege('authenticated', 'public.commit_import_batch(uuid,text)', 'EXECUTE'), 'real import commit remains locked for authenticated users');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('71000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4-super@example.test', 'not-used', now()),
  ('71000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4-manager@example.test', 'not-used', now()),
  ('71000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4-support@example.test', 'not-used', now()),
  ('71000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4-analyst@example.test', 'not-used', now()),
  ('71000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4-readonly@example.test', 'not-used', now()),
  ('71000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4-other@example.test', 'not-used', now());

insert into public.tenants (id, name, slug) values
  ('72000000-0000-0000-0000-000000000001', 'Phase 4 Tenant A', 'phase4-tenant-a'),
  ('72000000-0000-0000-0000-000000000002', 'Phase 4 Tenant B', 'phase4-tenant-b');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'super_admin'),
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'manager'),
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000003', 'support'),
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000004', 'analyst'),
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000005', 'readonly'),
  ('72000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000006', 'manager');

insert into public.customers (id, tenant_id, display_name, segment, risk_level, source_type, source_name) values
  ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', 'Alpha Trader', 'vip', 'low', 'historical_import', 'legacy-sheet'),
  ('73000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001', 'Beta Trader', 'standard', 'high', 'manual', 'operator'),
  ('73000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000002', 'Tenant B Secret', 'vip', 'high', 'manual', 'operator');

insert into public.customer_identities (tenant_id, customer_id, identity_type, identity_value, normalized_value, is_primary)
values
  ('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'email', 'Alpha@Example.test', 'alpha@example.test', true),
  ('72000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000003', 'email', 'secret@example.test', 'secret@example.test', true);

insert into public.customer_profiles (tenant_id, customer_id, next_best_action)
values ('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'Review account');

insert into public.customer_memory (tenant_id, customer_id, memory_key, memory_value, source_type, confidence)
values ('72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'trust_level', '"high"'::jsonb, 'operator', 0.9);

insert into public.import_batches (id, tenant_id, status, source_type, source_name, total_rows, probable_match_count, ambiguous_count, created_by)
values ('74000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', 'review_required', 'xlsx', 'phase4-fixture', 2, 1, 1, '71000000-0000-0000-0000-000000000001');
insert into public.import_rows (id, tenant_id, batch_id, row_number, status, classification, review_status, normalized_payload)
values
  ('75000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001', 2, 'review_required', 'probable_match', 'pending', '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001', 3, 'review_required', 'ambiguous', 'pending', '{}'::jsonb);
insert into public.import_errors (tenant_id, batch_id, import_row_id, row_number, field_name, error_code, message)
values ('72000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000002', 3, 'email', 'invalid_email', 'invalid fixture email');

update public.event_outbox eo
set status = 'dead_letter', attempts = max_attempts, last_error_code = 'FIXTURE_FAILURE', dead_lettered_at = now()
from public.domain_events de
where de.id = eo.event_id and de.customer_id = '73000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);

select is((public.admin_customer_list('72000000-0000-0000-0000-000000000001', null, null, null, null, null, null, null, null, 1, 1) ->> 'total')::integer, 2, 'customer list is tenant-scoped and paginated');
select is(jsonb_array_length(public.admin_customer_list('72000000-0000-0000-0000-000000000001', null, null, null, null, null, null, null, null, 1, 1) -> 'items'), 1, 'customer list page size is enforced');
select is((public.admin_customer_list('72000000-0000-0000-0000-000000000001', 'Beta', null, null, null, null, null, null, null, 1, 25) ->> 'total')::integer, 1, 'customer search is executed server-side');
select is((public.admin_customer_list('72000000-0000-0000-0000-000000000001', null, null, 'vip', 'low', 'legacy-sheet', null, null, null, 1, 25) ->> 'total')::integer, 1, 'customer filters compose correctly');
select throws_ok($$select public.admin_customer_list('72000000-0000-0000-0000-000000000002', null, null, null, null, null, null, null, null, 1, 25)$$, '42501', 'role is not authorized', 'tenant A cannot query tenant B through an admin RPC');
select is((public.admin_dashboard_metrics('72000000-0000-0000-0000-000000000001') ->> 'total_customers')::integer, 2, 'dashboard uses real tenant customer totals');
select is((public.admin_dashboard_metrics('72000000-0000-0000-0000-000000000001') ->> 'open_import_reviews')::integer, 2, 'dashboard exposes real unresolved review count');
select ok((public.admin_needs_attention('72000000-0000-0000-0000-000000000001')) @> '[{"category":"dead_letter_event"}]'::jsonb, 'needs attention includes dead-letter events');
select ok((public.admin_needs_attention('72000000-0000-0000-0000-000000000001')) @> '[{"category":"import_review"}]'::jsonb, 'needs attention includes unresolved import review');
select is((public.admin_event_list('72000000-0000-0000-0000-000000000001', 'customer.created', null, null, null, null, null, null, 1, 50) ->> 'total')::integer, 2, 'event list filters by type within tenant');
select ok(not ((public.admin_event_list('72000000-0000-0000-0000-000000000001', null, null, null, null, null, null, null, 1, 50) -> 'items' -> 0) ? 'payload'), 'event operations projection never exposes payload');
select is((public.admin_system_health('72000000-0000-0000-0000-000000000001') ->> 'dead_letter_count')::integer, 1, 'system health reports real dead-letter count');
select is((select count(*) from public.customer_memory where tenant_id = '72000000-0000-0000-0000-000000000001' and customer_id = '73000000-0000-0000-0000-000000000001'), 1::bigint, 'Customer 360 memory remains tenant-scoped');
select lives_ok($$select public.admin_audit_list('72000000-0000-0000-0000-000000000001', null, null, null, null, null, null, null, 1, 50)$$, 'super admin can inspect audit history');

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000002', true);
select is((public.admin_audit_list('72000000-0000-0000-0000-000000000001', null, null, null, null, null, null, null, 1, 50) -> 'items' -> 0 -> 'before_data'), 'null'::jsonb, 'manager audit projection redacts controlled before data');
select is((public.transition_customer_state('72000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000002','NEW','PAID','financial_bypass','HUMAN','71000000-0000-0000-0000-000000000002','76000000-0000-0000-0000-000000000001',null,'operator.requested',null,'manager-financial-bypass',now()) ->> 'rejection_code'), 'invalid_transition', 'manager cannot bypass a guarded financial lifecycle edge');
select is((select state from public.customers where id = '73000000-0000-0000-0000-000000000002'), 'NEW'::public.customer_state, 'forbidden manager transition leaves customer state unchanged');

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000003', true);
select is((select count(*) from public.customer_identities where tenant_id = '72000000-0000-0000-0000-000000000001'), 1::bigint, 'support can read operational identities for own tenant');
select throws_ok($$select public.admin_event_list('72000000-0000-0000-0000-000000000001', null, null, null, null, null, null, null, 1, 50)$$, '42501', 'role is not authorized', 'support cannot access event operations RPC');
select throws_ok($$select public.transition_customer_state('72000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001','NEW','CONTACT_READY','support_attempt','HUMAN','71000000-0000-0000-0000-000000000003',gen_random_uuid(),null,'operator.requested',null,'support-attempt',now())$$, '42501', 'not authorized for lifecycle transition', 'support cannot perform a manual lifecycle mutation');

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000004', true);
select ok(not has_table_privilege('authenticated', 'public.customers', 'UPDATE'), 'analyst browser role has no direct customer write grant');
select is((select count(*) from public.customer_identities where tenant_id = '72000000-0000-0000-0000-000000000001'), 0::bigint, 'analyst cannot fetch raw customer identities');
select is((select count(*) from public.domain_events where tenant_id = '72000000-0000-0000-0000-000000000001'), 0::bigint, 'analyst cannot fetch raw event envelopes');
select lives_ok($$select public.admin_event_list('72000000-0000-0000-0000-000000000001', null, null, null, null, null, null, null, 1, 50)$$, 'analyst can use sanitized event operations projection');
select lives_ok($$select public.admin_system_health('72000000-0000-0000-0000-000000000001')$$, 'analyst can inspect safe system health');
select throws_ok($$select public.admin_audit_list('72000000-0000-0000-0000-000000000001', null, null, null, null, null, null, null, 1, 50)$$, '42501', 'role is not authorized', 'analyst cannot inspect privileged audit details');

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000005', true);
select is((select count(*) from public.import_rows where tenant_id = '72000000-0000-0000-0000-000000000001'), 0::bigint, 'readonly cannot read import review rows');
select throws_ok($$select public.admin_needs_attention('72000000-0000-0000-0000-000000000001')$$, '42501', 'role is not authorized', 'readonly cannot access operational attention queue');
select throws_ok($$select public.admin_system_health('72000000-0000-0000-0000-000000000001')$$, '42501', 'role is not authorized', 'readonly cannot access system health');
select throws_ok($$select public.transition_customer_state('72000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001','NEW','PAID','financial_bypass','HUMAN','71000000-0000-0000-0000-000000000005',gen_random_uuid(),null,'operator.requested',null,'readonly-financial-bypass',now())$$, '42501', 'not authorized for lifecycle transition', 'readonly cannot bypass a financial lifecycle edge');

select * from finish();
rollback;
