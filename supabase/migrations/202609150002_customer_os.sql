-- Gold Revenue OS Phase 2: Customer OS.
-- No customer data is seeded here. Historical files enter only through the
-- authenticated, dry-run import path implemented below.

create type public.customer_state as enum (
  'NEW', 'CONTACT_READY', 'CONTACTED', 'REPLIED', 'QUALIFIED', 'OFFER_SENT',
  'INTERESTED', 'NOT_INTERESTED', 'SURVEY_OFFERED', 'SURVEY_COMPLETED',
  'TRIAL_ACTIVE', 'PAYMENT_PENDING', 'PAID', 'ACCESS_GRANTED', 'ACTIVE',
  'RENEWAL_DUE', 'RENEWED', 'EXPIRED', 'CHURNED', 'WINBACK'
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  external_ref text,
  display_name text check (display_name is null or char_length(display_name) between 1 and 240),
  state public.customer_state not null default 'NEW',
  segment text,
  risk_level text not null default 'normal',
  assigned_manager_id uuid references public.app_users(id),
  automation_paused boolean not null default false,
  source_type text,
  source_name text,
  source_record_ref text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, external_ref)
);

create index customers_tenant_state_idx on public.customers (tenant_id, state, updated_at desc);
create index customers_tenant_updated_idx on public.customers (tenant_id, updated_at desc);
create index customers_tenant_name_idx on public.customers (tenant_id, lower(display_name));

create table public.customer_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid not null,
  identity_type text not null check (identity_type in ('email', 'telegram_username', 'telegram_user_id', 'external_id', 'phone')),
  identity_value text not null check (char_length(identity_value) between 1 and 320),
  normalized_value text not null check (char_length(normalized_value) between 1 and 320),
  identity_scope text not null default 'global',
  is_primary boolean not null default false,
  source_type text,
  source_name text,
  source_record_ref text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, customer_id, id),
  unique (tenant_id, identity_type, identity_scope, normalized_value),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete cascade
);

create index customer_identities_customer_idx on public.customer_identities (tenant_id, customer_id);
create index customer_identities_lookup_idx on public.customer_identities (tenant_id, identity_type, normalized_value);

create table public.customer_profiles (
  customer_id uuid primary key,
  tenant_id uuid not null,
  experience_level text,
  primary_instrument text,
  trading_style text,
  risk_preference text,
  preferred_signal_frequency text,
  previous_service_experience jsonb not null default '{}'::jsonb,
  pain_points jsonb not null default '[]'::jsonb,
  objections jsonb not null default '[]'::jsonb,
  communication_style text,
  preferred_message_length text,
  price_sensitivity text,
  trust_level text,
  churn_reason text,
  last_conversation_summary text,
  next_best_action text,
  retention_risk text,
  field_metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete cascade
);

create table public.customer_memory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid not null,
  memory_key text not null check (memory_key in (
    'experience_level', 'primary_instrument', 'trading_style', 'risk_preference',
    'preferred_signal_frequency', 'previous_service_experience', 'pain_points',
    'objections', 'communication_style', 'preferred_message_length', 'price_sensitivity',
    'trust_level', 'churn_reason', 'last_conversation_summary', 'next_best_action',
    'retention_risk'
  )),
  memory_value jsonb not null,
  source_type text not null,
  source_id text,
  source_name text,
  source_record_ref text,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  observed_at timestamptz not null default now(),
  superseded_at timestamptz,
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete cascade
);

create index customer_memory_active_idx on public.customer_memory (tenant_id, customer_id, memory_key, observed_at desc) where superseded_at is null;
create index customer_memory_source_idx on public.customer_memory (tenant_id, source_type, source_id);

create table public.customer_state_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid not null,
  from_state public.customer_state,
  to_state public.customer_state not null,
  reason_code text,
  actor_type public.audit_actor_type not null,
  actor_id uuid,
  event_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete cascade
);

create index customer_state_history_customer_idx on public.customer_state_history (tenant_id, customer_id, created_at desc);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  status text not null default 'dry_run_ready' check (status in ('uploaded', 'dry_run_ready', 'review_required', 'approved', 'importing', 'completed', 'failed', 'cancelled')),
  source_type text not null,
  source_name text not null,
  file_name text,
  file_sha256 text check (file_sha256 is null or file_sha256 ~ '^[a-f0-9]{64}$'),
  total_rows integer not null default 0 check (total_rows between 0 and 5000),
  exact_match_count integer not null default 0 check (exact_match_count >= 0),
  probable_match_count integer not null default 0 check (probable_match_count >= 0),
  ambiguous_count integer not null default 0 check (ambiguous_count >= 0),
  new_customer_count integer not null default 0 check (new_customer_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  validation_error_count integer not null default 0 check (validation_error_count >= 0),
  planned_mutation_count integer not null default 0 check (planned_mutation_count >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (tenant_id, id)
);

create index import_batches_tenant_created_idx on public.import_batches (tenant_id, created_at desc);
create index import_batches_tenant_status_idx on public.import_batches (tenant_id, status);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  status text not null default 'planned' check (status in ('planned', 'rejected', 'review_required', 'approved', 'imported', 'skipped')),
  classification text not null check (classification in ('exact_match', 'probable_match', 'ambiguous', 'new_customer')),
  resolution text check (resolution is null or resolution in ('exact_match', 'new_customer')),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  candidate_customer_id uuid,
  source_record_ref text,
  identity_fingerprint text,
  raw_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  planned_mutation jsonb not null default '{}'::jsonb,
  validation_error_count integer not null default 0 check (validation_error_count >= 0),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  imported_customer_id uuid,
  unique (batch_id, row_number),
  foreign key (tenant_id, batch_id) references public.import_batches(tenant_id, id) on delete cascade,
  foreign key (tenant_id, candidate_customer_id) references public.customers(tenant_id, id),
  foreign key (tenant_id, imported_customer_id) references public.customers(tenant_id, id)
);

create index import_rows_batch_status_idx on public.import_rows (tenant_id, batch_id, status, classification);
create index import_rows_candidate_idx on public.import_rows (tenant_id, candidate_customer_id);

create table public.import_errors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  import_row_id uuid references public.import_rows(id) on delete cascade,
  row_number integer not null,
  field_name text,
  error_code text not null,
  message text not null,
  raw_value jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, batch_id) references public.import_batches(tenant_id, id) on delete cascade
);

create index import_errors_batch_idx on public.import_errors (tenant_id, batch_id, row_number);

create or replace function private.customer_os_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  before_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  after_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  tenant uuid;
  entity text;
begin
  tenant := coalesce((after_row ->> 'tenant_id')::uuid, (before_row ->> 'tenant_id')::uuid);
  entity := coalesce(after_row ->> 'id', before_row ->> 'id', after_row ->> 'customer_id', before_row ->> 'customer_id');
  insert into public.audit_logs (tenant_id, actor_type, actor_id, action, entity_type, entity_id, before_data, after_data, request_id)
  values (
    tenant,
    case when auth.uid() is null then 'SYSTEM'::public.audit_actor_type else 'HUMAN'::public.audit_actor_type end,
    auth.uid(), lower(tg_op), tg_table_name, entity,
    case when before_row is null then null else jsonb_build_object('redacted', true, 'entity', tg_table_name) end,
    case when after_row is null then null else jsonb_build_object('redacted', true, 'entity', tg_table_name) end,
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id'
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.customer_os_audit() from public, anon, authenticated;

create or replace function private.customer_state_history_capture()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state then
    insert into public.customer_state_history (tenant_id, customer_id, from_state, to_state, reason_code, actor_type, actor_id)
    values (
      new.tenant_id,
      new.id,
      case when tg_op = 'INSERT' then null else old.state end,
      new.state,
      case when tg_op = 'INSERT' then 'customer_created' else 'customer_state_updated' end,
      case when auth.uid() is null then 'SYSTEM'::public.audit_actor_type else 'HUMAN'::public.audit_actor_type end,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

revoke all on function private.customer_state_history_capture() from public, anon, authenticated;

create or replace function private.reject_customer_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'customer_state_history is append-only' using errcode = '42501';
end;
$$;

create trigger customers_set_updated_at before update on public.customers for each row execute function private.set_updated_at();
create trigger customer_profiles_set_updated_at before update on public.customer_profiles for each row execute function private.set_updated_at();
create trigger customers_state_history after insert or update of state on public.customers for each row execute function private.customer_state_history_capture();
create trigger customer_state_history_immutable before update or delete on public.customer_state_history for each row execute function private.reject_customer_history_mutation();

create trigger customers_audit after insert or update or delete on public.customers for each row execute function private.customer_os_audit();
create trigger customer_identities_audit after insert or update or delete on public.customer_identities for each row execute function private.customer_os_audit();
create trigger customer_profiles_audit after insert or update or delete on public.customer_profiles for each row execute function private.customer_os_audit();
create trigger customer_memory_audit after insert or update or delete on public.customer_memory for each row execute function private.customer_os_audit();
create trigger customer_state_history_audit after insert on public.customer_state_history for each row execute function private.customer_os_audit();
create trigger import_batches_audit after insert or update or delete on public.import_batches for each row execute function private.customer_os_audit();
create trigger import_rows_audit after insert or update or delete on public.import_rows for each row execute function private.customer_os_audit();
create trigger import_errors_audit after insert or update or delete on public.import_errors for each row execute function private.customer_os_audit();

alter table public.customers enable row level security;
alter table public.customer_identities enable row level security;
alter table public.customer_profiles enable row level security;
alter table public.customer_memory enable row level security;
alter table public.customer_state_history enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.import_errors enable row level security;

create policy customers_select_member on public.customers for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));
create policy customer_identities_select_member on public.customer_identities for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));
create policy customer_profiles_select_member on public.customer_profiles for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));
create policy customer_memory_select_member on public.customer_memory for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));
create policy customer_state_history_select_member on public.customer_state_history for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));
create policy import_batches_select_management on public.import_batches for select to authenticated
  using ((select private.has_tenant_role(tenant_id, array['super_admin', 'manager']::public.app_role[])));
create policy import_rows_select_management on public.import_rows for select to authenticated
  using ((select private.has_tenant_role(tenant_id, array['super_admin', 'manager']::public.app_role[])));
create policy import_errors_select_management on public.import_errors for select to authenticated
  using ((select private.has_tenant_role(tenant_id, array['super_admin', 'manager']::public.app_role[])));

revoke all on table public.customers, public.customer_identities, public.customer_profiles, public.customer_memory,
  public.customer_state_history, public.import_batches, public.import_rows, public.import_errors from anon, authenticated;
grant select on table public.customers, public.customer_identities, public.customer_profiles, public.customer_memory,
  public.customer_state_history, public.import_batches, public.import_rows, public.import_errors to authenticated;

-- Authenticated users may create a dry-run only through this validated RPC.
create or replace function public.create_import_dry_run(
  target_tenant_id uuid,
  source_type_value text,
  source_name_value text,
  file_name_value text,
  file_sha256_value text,
  rows_value jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  batch_id_value uuid;
  row_value jsonb;
  error_value jsonb;
  row_id_value uuid;
  total_value integer := 0;
  exact_value integer := 0;
  probable_value integer := 0;
  ambiguous_value integer := 0;
  new_value integer := 0;
  rejected_value integer := 0;
  validation_value integer := 0;
begin
  if auth.uid() is null or not private.has_tenant_role(target_tenant_id, array['super_admin', 'manager']::public.app_role[]) then
    raise exception 'not authorized for tenant import' using errcode = '42501';
  end if;
  if jsonb_typeof(rows_value) <> 'array' or jsonb_array_length(rows_value) > 5000 then
    raise exception 'import must contain between 0 and 5000 rows' using errcode = '22023';
  end if;
  if file_sha256_value is not null and file_sha256_value !~ '^[a-f0-9]{64}$' then
    raise exception 'file_sha256 must be lowercase sha256' using errcode = '22023';
  end if;

  insert into public.import_batches (tenant_id, status, source_type, source_name, file_name, file_sha256, created_by)
  values (target_tenant_id, 'uploaded', left(source_type_value, 80), left(source_name_value, 160), left(file_name_value, 240), file_sha256_value, auth.uid())
  returning id into batch_id_value;

  for row_value in select value from jsonb_array_elements(rows_value) loop
    total_value := total_value + 1;
    case row_value ->> 'classification'
      when 'exact_match' then exact_value := exact_value + 1;
      when 'probable_match' then probable_value := probable_value + 1;
      when 'ambiguous' then ambiguous_value := ambiguous_value + 1;
      when 'new_customer' then new_value := new_value + 1;
      else rejected_value := rejected_value + 1;
    end case;
    validation_value := validation_value + coalesce((row_value ->> 'validation_error_count')::integer, 0);
    insert into public.import_rows (
      tenant_id, batch_id, row_number, status, classification, resolution, review_status,
      candidate_customer_id, source_record_ref, identity_fingerprint, raw_payload,
      normalized_payload, planned_mutation, validation_error_count
    ) values (
      target_tenant_id, batch_id_value, (row_value ->> 'row_number')::integer,
      case when coalesce((row_value ->> 'validation_error_count')::integer, 0) > 0 then 'rejected'
           when row_value ->> 'classification' in ('probable_match', 'ambiguous') then 'review_required'
           else 'planned' end,
      row_value ->> 'classification',
      case when row_value ->> 'classification' = 'exact_match' then 'exact_match' else null end,
      case when row_value ->> 'classification' = 'exact_match' or row_value ->> 'classification' = 'new_customer' then 'approved' else 'pending' end,
      nullif(row_value ->> 'candidate_customer_id', '')::uuid,
      left(row_value ->> 'source_record_ref', 240),
      left(row_value ->> 'identity_fingerprint', 128),
      coalesce(row_value -> 'raw_payload', '{}'::jsonb),
      coalesce(row_value -> 'normalized_payload', '{}'::jsonb),
      coalesce(row_value -> 'planned_mutation', '{}'::jsonb),
      coalesce((row_value ->> 'validation_error_count')::integer, 0)
    ) returning id into row_id_value;
    for error_value in select value from jsonb_array_elements(coalesce(row_value -> 'errors', '[]'::jsonb)) loop
      insert into public.import_errors (tenant_id, batch_id, import_row_id, row_number, field_name, error_code, message, raw_value)
      values (target_tenant_id, batch_id_value, row_id_value, (row_value ->> 'row_number')::integer,
        left(error_value ->> 'field', 120), left(error_value ->> 'code', 120), left(error_value ->> 'message', 500), error_value -> 'raw_value');
    end loop;
  end loop;

  update public.import_batches
  set status = case when probable_value > 0 or ambiguous_value > 0 or rejected_value > 0 then 'review_required' else 'dry_run_ready' end,
      total_rows = total_value, exact_match_count = exact_value, probable_match_count = probable_value,
      ambiguous_count = ambiguous_value, new_customer_count = new_value, rejected_count = rejected_value,
      validation_error_count = validation_value, planned_mutation_count = exact_value + new_value
  where id = batch_id_value;

  return jsonb_build_object('batch_id', batch_id_value, 'total_rows', total_value, 'exact_match_count', exact_value,
    'probable_match_count', probable_value, 'ambiguous_count', ambiguous_value, 'new_customer_count', new_value,
    'rejected_count', rejected_value, 'validation_error_count', validation_value, 'planned_mutation_count', exact_value + new_value);
end;
$$;

revoke all on function public.create_import_dry_run(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_import_dry_run(uuid, text, text, text, text, jsonb) to authenticated;

create or replace function public.review_import_row(
  target_batch_id uuid,
  target_row_id uuid,
  resolution_value text,
  candidate_value uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  tenant_value uuid;
begin
  select tenant_id into strict tenant_value from public.import_batches where id = target_batch_id;
  if auth.uid() is null or not private.has_tenant_role(tenant_value, array['super_admin', 'manager']::public.app_role[]) then
    raise exception 'not authorized for import review' using errcode = '42501';
  end if;
  if resolution_value not in ('exact_match', 'new_customer') then
    raise exception 'review resolution must be exact_match or new_customer' using errcode = '22023';
  end if;
  if resolution_value = 'exact_match' and candidate_value is null then
    raise exception 'exact_match requires a customer candidate' using errcode = '22023';
  end if;
  if candidate_value is not null and not exists (select 1 from public.customers where id = candidate_value and tenant_id = tenant_value) then
    raise exception 'candidate customer is outside tenant' using errcode = '42501';
  end if;
  update public.import_rows
  set resolution = resolution_value, candidate_customer_id = candidate_value, review_status = 'approved', status = 'approved', reviewed_at = now()
  where id = target_row_id and batch_id = target_batch_id and tenant_id = tenant_value;
  if not found then raise exception 'import row not found' using errcode = 'P0002'; end if;
  update public.import_batches set reviewed_at = now() where id = target_batch_id;
end;
$$;

revoke all on function public.review_import_row(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.review_import_row(uuid, uuid, text, uuid) to authenticated;

-- The commit endpoint is intentionally separate from dry-run creation and
-- requires an explicit owner confirmation phrase. It is never called by the
-- Phase 2 UI automatically.
create or replace function public.commit_import_batch(target_batch_id uuid, approval_phrase text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  batch_value record;
  row_value record;
  identity_value jsonb;
  memory_value jsonb;
  target_customer_id uuid;
  imported_count integer := 0;
  created_count integer := 0;
  linked_count integer := 0;
begin
  if approval_phrase <> 'IMPORT_APPROVED' then
    raise exception 'explicit import approval is required' using errcode = '42501';
  end if;
  select * into strict batch_value from public.import_batches where id = target_batch_id;
  if auth.uid() is null or not private.has_tenant_role(batch_value.tenant_id, array['super_admin']::public.app_role[]) then
    raise exception 'only a super_admin can commit an import' using errcode = '42501';
  end if;
  if batch_value.status not in ('dry_run_ready', 'review_required', 'approved') then
    raise exception 'batch is not commit-ready' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.import_rows
    where batch_id = target_batch_id and status <> 'rejected'
      and (classification in ('probable_match', 'ambiguous') and review_status <> 'approved')
  ) then
    raise exception 'all probable and ambiguous rows require manual review' using errcode = '42501';
  end if;

  update public.import_batches set status = 'importing' where id = target_batch_id;
  for row_value in select * from public.import_rows where batch_id = target_batch_id and status not in ('rejected', 'imported') order by row_number loop
    if row_value.resolution = 'exact_match' or row_value.classification = 'exact_match' then
      target_customer_id := row_value.candidate_customer_id;
      if target_customer_id is null or not exists (select 1 from public.customers where id = target_customer_id and tenant_id = batch_value.tenant_id) then
        raise exception 'exact match row has no valid tenant candidate' using errcode = '42501';
      end if;
      linked_count := linked_count + 1;
    else
      insert into public.customers (tenant_id, external_ref, display_name, source_type, source_name, source_record_ref)
      values (batch_value.tenant_id, nullif(row_value.normalized_payload ->> 'external_id', ''), nullif(row_value.normalized_payload ->> 'display_name', ''), batch_value.source_type, batch_value.source_name, row_value.source_record_ref)
      returning id into target_customer_id;
      created_count := created_count + 1;
    end if;

    for identity_value in select value from jsonb_array_elements(coalesce(row_value.normalized_payload -> 'identities', '[]'::jsonb)) loop
      if exists (
        select 1 from public.customer_identities as ci
        where ci.tenant_id = batch_value.tenant_id
          and ci.identity_type = identity_value ->> 'identity_type'
          and ci.identity_scope = coalesce(identity_value ->> 'identity_scope', 'global')
          and ci.normalized_value = identity_value ->> 'normalized_value'
          and ci.customer_id <> target_customer_id
      ) then
        raise exception 'identity conflict detected during import' using errcode = '23505';
      end if;
      insert into public.customer_identities (tenant_id, customer_id, identity_type, identity_value, normalized_value, identity_scope, is_primary, source_type, source_name, source_record_ref)
      values (batch_value.tenant_id, target_customer_id, identity_value ->> 'identity_type', identity_value ->> 'identity_value', identity_value ->> 'normalized_value', coalesce(identity_value ->> 'identity_scope', 'global'), coalesce((identity_value ->> 'is_primary')::boolean, false), batch_value.source_type, batch_value.source_name, row_value.source_record_ref)
      on conflict (tenant_id, identity_type, identity_scope, normalized_value) do nothing;
    end loop;

    insert into public.customer_profiles (tenant_id, customer_id, experience_level, primary_instrument, trading_style, risk_preference, preferred_signal_frequency, previous_service_experience, pain_points, objections, communication_style, preferred_message_length, price_sensitivity, trust_level, churn_reason, last_conversation_summary, next_best_action, retention_risk)
    values (
      batch_value.tenant_id, target_customer_id,
      row_value.normalized_payload #>> '{profile,experience_level}', row_value.normalized_payload #>> '{profile,primary_instrument}', row_value.normalized_payload #>> '{profile,trading_style}', row_value.normalized_payload #>> '{profile,risk_preference}', row_value.normalized_payload #>> '{profile,preferred_signal_frequency}',
      coalesce(row_value.normalized_payload #> '{profile,previous_service_experience}', '{}'::jsonb), coalesce(row_value.normalized_payload #> '{profile,pain_points}', '[]'::jsonb), coalesce(row_value.normalized_payload #> '{profile,objections}', '[]'::jsonb),
      row_value.normalized_payload #>> '{profile,communication_style}', row_value.normalized_payload #>> '{profile,preferred_message_length}', row_value.normalized_payload #>> '{profile,price_sensitivity}', row_value.normalized_payload #>> '{profile,trust_level}', row_value.normalized_payload #>> '{profile,churn_reason}', row_value.normalized_payload #>> '{profile,last_conversation_summary}', row_value.normalized_payload #>> '{profile,next_best_action}', row_value.normalized_payload #>> '{profile,retention_risk}'
    )
    on conflict (customer_id) do update set
      experience_level = coalesce(excluded.experience_level, public.customer_profiles.experience_level), primary_instrument = coalesce(excluded.primary_instrument, public.customer_profiles.primary_instrument), trading_style = coalesce(excluded.trading_style, public.customer_profiles.trading_style), risk_preference = coalesce(excluded.risk_preference, public.customer_profiles.risk_preference), preferred_signal_frequency = coalesce(excluded.preferred_signal_frequency, public.customer_profiles.preferred_signal_frequency), communication_style = coalesce(excluded.communication_style, public.customer_profiles.communication_style), preferred_message_length = coalesce(excluded.preferred_message_length, public.customer_profiles.preferred_message_length), price_sensitivity = coalesce(excluded.price_sensitivity, public.customer_profiles.price_sensitivity), trust_level = coalesce(excluded.trust_level, public.customer_profiles.trust_level), churn_reason = coalesce(excluded.churn_reason, public.customer_profiles.churn_reason), last_conversation_summary = coalesce(excluded.last_conversation_summary, public.customer_profiles.last_conversation_summary), next_best_action = coalesce(excluded.next_best_action, public.customer_profiles.next_best_action), retention_risk = coalesce(excluded.retention_risk, public.customer_profiles.retention_risk), updated_at = now();

    for memory_value in select value from jsonb_array_elements(coalesce(row_value.normalized_payload -> 'memory', '[]'::jsonb)) loop
      insert into public.customer_memory (tenant_id, customer_id, memory_key, memory_value, source_type, source_id, source_name, source_record_ref, confidence)
      values (batch_value.tenant_id, target_customer_id, memory_value ->> 'key', memory_value -> 'value', 'import', target_batch_id::text, batch_value.source_name, row_value.source_record_ref, least(greatest(coalesce((memory_value ->> 'confidence')::numeric, 0.8), 0), 1));
    end loop;
    update public.import_rows set status = 'imported', imported_customer_id = target_customer_id where id = row_value.id;
    imported_count := imported_count + 1;
  end loop;
  update public.import_batches set status = 'completed', completed_at = now() where id = target_batch_id;
  return jsonb_build_object('status', 'completed', 'imported_count', imported_count, 'created_count', created_count, 'linked_count', linked_count);
end;
$$;

revoke all on function public.commit_import_batch(uuid, text) from public, anon;
grant execute on function public.commit_import_batch(uuid, text) to authenticated;

comment on table public.import_batches is 'Metadata and reconciliation counts only; raw source files never live in the repository.';
comment on column public.import_rows.raw_payload is 'Tenant-protected source row retained for reconciliation; never log or commit this value.';
