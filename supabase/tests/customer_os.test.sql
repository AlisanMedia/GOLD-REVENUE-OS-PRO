begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

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
select has_column('public', 'import_rows', 'batch_customer_ref', 'import rows retain a safe batch dedup reference');

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
set local role postgres;
select throws_ok($$update public.customer_state_history set reason_code = 'tamper' where customer_id = '50000000-0000-0000-0000-000000000001'$$, '42501', 'customer_state_history is append-only', 'state history rejects updates');
set local role authenticated;
select is((select count(*) from public.audit_logs where tenant_id = '40000000-0000-0000-0000-000000000001' and entity_type = 'customers'), 1::bigint, 'customer mutation has audit record');
select ok(has_table_privilege('authenticated', 'public.customers', 'SELECT'), 'authenticated retains customer read grant');
select ok(has_table_privilege('authenticated', 'public.import_rows', 'SELECT'), 'authenticated retains import read grant');

set local role postgres;
update public.tenant_members
set role = 'super_admin'
where tenant_id = '40000000-0000-0000-0000-000000000001'
  and user_id = '30000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (public.create_import_dry_run(
    '40000000-0000-0000-0000-000000000001',
    'csv',
    'pgtap-rejected-count',
    'invalid.csv',
    repeat('f', 64),
    jsonb_build_array(jsonb_build_object(
      'row_number', 2,
      'classification', 'new_customer',
      'candidate_customer_id', null,
      'batch_customer_ref', null,
      'source_record_ref', 'invalid:2',
      'identity_fingerprint', repeat('e', 64),
      'raw_payload', '{}'::jsonb,
      'normalized_payload', '{}'::jsonb,
      'planned_mutation', jsonb_build_object('action', 'manual_review'),
      'validation_error_count', 1,
      'errors', jsonb_build_array(jsonb_build_object('field', 'email', 'code', 'invalid_email', 'message', 'invalid'))
    ))
  ) ->> 'rejected_count')::integer,
  1,
  'dry-run report counts validation failures as rejected'
);

select lives_ok(
  $test$
  do $body$
  declare
    report jsonb;
    batch_id uuid;
  begin
    report := public.create_import_dry_run(
      '40000000-0000-0000-0000-000000000001',
      'csv',
      'pgtap-batch-dedup',
      'dedup.csv',
      repeat('d', 64),
      jsonb_build_array(
        jsonb_build_object(
          'row_number', 2,
          'classification', 'new_customer',
          'candidate_customer_id', null,
          'batch_customer_ref', repeat('a', 64),
          'source_record_ref', 'dedup:2',
          'identity_fingerprint', repeat('b', 64),
          'raw_payload', '{}'::jsonb,
          'normalized_payload', jsonb_build_object(
            'display_name', 'Batch Customer',
            'identities', jsonb_build_array(jsonb_build_object(
              'identity_type', 'email',
              'identity_value', 'batch@example.test',
              'normalized_value', 'batch@example.test',
              'identity_scope', 'global',
              'is_primary', true
            )),
            'profile', '{}'::jsonb,
            'memory', '[]'::jsonb
          ),
          'planned_mutation', jsonb_build_object('action', 'create_customer'),
          'validation_error_count', 0,
          'errors', '[]'::jsonb
        ),
        jsonb_build_object(
          'row_number', 3,
          'classification', 'exact_match',
          'candidate_customer_id', null,
          'batch_customer_ref', repeat('a', 64),
          'source_record_ref', 'dedup:3',
          'identity_fingerprint', repeat('b', 64),
          'raw_payload', '{}'::jsonb,
          'normalized_payload', jsonb_build_object(
            'display_name', 'Batch Customer',
            'identities', jsonb_build_array(jsonb_build_object(
              'identity_type', 'email',
              'identity_value', 'batch@example.test',
              'normalized_value', 'batch@example.test',
              'identity_scope', 'global',
              'is_primary', true
            )),
            'profile', '{}'::jsonb,
            'memory', '[]'::jsonb
          ),
          'planned_mutation', jsonb_build_object('action', 'link_batch'),
          'validation_error_count', 0,
          'errors', '[]'::jsonb
        )
      )
    );
    batch_id := (report ->> 'batch_id')::uuid;
    perform public.commit_import_batch(batch_id, 'IMPORT_APPROVED');
  end
  $body$
  $test$,
  'batch duplicates commit to one customer without an existing candidate UUID'
);
select is(
  (select count(*) from public.customers where source_name = 'pgtap-batch-dedup'),
  1::bigint,
  'batch dedup creates one customer'
);
select is(
  (select count(*) from public.import_rows ir join public.import_batches ib on ib.id = ir.batch_id
   where ib.source_name = 'pgtap-batch-dedup' and ir.status = 'imported'),
  2::bigint,
  'batch dedup imports both source rows'
);

select * from finish();
rollback;
