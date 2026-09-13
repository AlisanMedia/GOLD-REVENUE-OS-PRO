begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager-a@example.test', 'not-used', now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'readonly-b@example.test', 'not-used', now());

insert into public.tenants (id, name, slug)
values
  ('20000000-0000-0000-0000-000000000001', 'Tenant A', 'tenant-a'),
  ('20000000-0000-0000-0000-000000000002', 'Tenant B', 'tenant-b');

insert into public.tenant_members (tenant_id, user_id, role)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'manager'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'readonly');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$ select slug from public.tenants order by slug $$,
  array['tenant-a'::text],
  'manager A sees only tenant A'
);
select results_eq(
  $$ select count(*) from public.tenant_members where tenant_id = '20000000-0000-0000-0000-000000000002' $$,
  array[0::bigint],
  'manager A cannot see tenant B membership'
);
select results_eq(
  $$ select count(*) from public.audit_logs where tenant_id = '20000000-0000-0000-0000-000000000002' $$,
  array[0::bigint],
  'manager A cannot see tenant B audit records'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$ select slug from public.tenants order by slug $$,
  array['tenant-b'::text],
  'readonly B sees only tenant B'
);
select results_eq(
  $$ select count(*) from public.audit_logs $$,
  array[0::bigint],
  'readonly B cannot read audit records'
);
select ok(
  not has_table_privilege('authenticated', 'public.tenant_members', 'UPDATE'),
  'readonly cannot bypass RBAC with a direct role update'
);

select * from finish();
rollback;
