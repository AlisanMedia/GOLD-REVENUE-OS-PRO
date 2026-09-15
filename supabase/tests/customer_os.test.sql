begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select has_table('public', 'customers', 'customers table exists');
select has_table('public', 'customer_identities', 'customer identities table exists');
select has_table('public', 'customer_profiles', 'customer profiles table exists');
select has_table('public', 'customer_memory', 'customer memory table exists');
select has_table('public', 'customer_state_history', 'state history table exists');
select has_table('public', 'import_batches', 'import batches table exists');
select has_table('public', 'import_rows', 'import rows table exists');
select has_table('public', 'import_errors', 'import errors table exists');

select is((select relrowsecurity from pg_class where oid = 'public.customers'::regclass), true, 'customers has RLS');
select is((select relrowsecurity from pg_class where oid = 'public.customer_identities'::regclass), true, 'identities have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.customer_profiles'::regclass), true, 'profiles have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.customer_memory'::regclass), true, 'memory has RLS');
select is((select relrowsecurity from pg_class where oid = 'public.customer_state_history'::regclass), true, 'state history has RLS');
select is((select relrowsecurity from pg_class where oid = 'public.import_batches'::regclass), true, 'batches have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.import_rows'::regclass), true, 'rows have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.import_errors'::regclass), true, 'errors have RLS');

select ok(not has_table_privilege('authenticated', 'public.customers', 'INSERT'), 'authenticated cannot insert customers directly');
select ok(not has_table_privilege('authenticated', 'public.customer_memory', 'UPDATE'), 'authenticated cannot mutate memory directly');
select ok(not has_table_privilege('authenticated', 'public.import_rows', 'INSERT'), 'authenticated cannot insert import rows directly');
select function_returns('public', 'create_import_dry_run', array['uuid','text','text','text','text','jsonb'], 'jsonb', 'dry-run RPC has contract');
select function_returns('public', 'review_import_row', array['uuid','uuid','text','uuid'], 'void', 'review RPC has contract');

select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer-a@example.test', 'not-used', now()),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer-b@example.test', 'not-used', now());
insert into public.tenants (id, name, slug) values
  ('40000000-0000-0000-0000-000000000001', 'Customer Tenant A', 'customer-tenant-a'),
  ('40000000-0000-0000-0000-000000000002', 'Customer Tenant B', 'customer-tenant-b');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'manager'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'manager');
insert into public.customers (id, tenant_id, display_name, state) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Customer A', 'NEW'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'Customer B', 'NEW');
insert into public.customer_identities (tenant_id, customer_id, identity_type, identity_value, normalized_value)
values ('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'email', 'a@example.test', 'a@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select results_eq($$select display_name from public.customers order by display_name$$, array['Customer A'::text], 'tenant A sees only customer A');
select results_eq($$select identity_value from public.customer_identities$$, array['a@example.test'::text], 'tenant A sees only own identity');
select results_eq($$select count(*) from public.customer_state_history where tenant_id = '40000000-0000-0000-0000-000000000002'$$, array[0::bigint], 'tenant A cannot see tenant B state history');
select results_eq($$select count(*) from public.audit_logs where tenant_id = '40000000-0000-0000-0000-000000000002'$$, array[0::bigint], 'tenant A cannot see tenant B audits');
select is((select count(*) from public.customer_state_history where customer_id = '50000000-0000-0000-0000-000000000001'), 1::bigint, 'customer insert creates initial state history');
select throws_ok($$update public.customer_state_history set reason_code = 'tamper' where customer_id = '50000000-0000-0000-0000-000000000001'$$, '42501', 'customer_state_history is append-only', 'state history rejects updates');
select is((select count(*) from public.audit_logs where tenant_id = '40000000-0000-0000-0000-000000000001' and entity_type = 'customers'), 1::bigint, 'customer mutation has audit record');
select ok(has_table_privilege('authenticated', 'public.customers', 'SELECT'), 'authenticated retains customer read grant');
select ok(has_table_privilege('authenticated', 'public.import_rows', 'SELECT'), 'authenticated retains import read grant');

select * from finish();
rollback;
