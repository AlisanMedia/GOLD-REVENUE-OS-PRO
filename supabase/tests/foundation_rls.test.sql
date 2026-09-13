begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_table('public', 'tenants', 'tenants table exists');
select has_table('public', 'tenant_members', 'tenant_members table exists');
select has_table('public', 'audit_logs', 'audit_logs table exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.tenants'::regclass),
  true,
  'tenants has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.tenant_members'::regclass),
  true,
  'tenant_members has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.audit_logs'::regclass),
  true,
  'audit_logs has RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.tenants', 'INSERT'),
  'authenticated cannot insert tenants'
);
select ok(
  not has_table_privilege('authenticated', 'public.tenant_members', 'UPDATE'),
  'authenticated cannot change roles directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_logs', 'INSERT'),
  'authenticated cannot forge audit entries'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_logs', 'DELETE'),
  'authenticated cannot delete audit entries'
);
select function_returns(
  'private',
  'is_tenant_member',
  array['uuid'],
  'boolean',
  'tenant membership helper returns boolean'
);

select * from finish();
rollback;
