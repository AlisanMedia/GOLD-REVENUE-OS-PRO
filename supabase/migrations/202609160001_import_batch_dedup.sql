alter table public.import_rows add column batch_customer_ref text
  check (batch_customer_ref is null or batch_customer_ref ~ '^[a-f0-9]{64}$');

create index import_rows_batch_customer_ref_idx
  on public.import_rows (tenant_id, batch_id, batch_customer_ref)
  where batch_customer_ref is not null;

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
  row_error_count integer;
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
    row_error_count := coalesce((row_value ->> 'validation_error_count')::integer, 0);
    if row_error_count > 0 then
      rejected_value := rejected_value + 1;
    else
      case row_value ->> 'classification'
        when 'exact_match' then exact_value := exact_value + 1;
        when 'probable_match' then probable_value := probable_value + 1;
        when 'ambiguous' then ambiguous_value := ambiguous_value + 1;
        when 'new_customer' then new_value := new_value + 1;
        else rejected_value := rejected_value + 1;
      end case;
    end if;
    validation_value := validation_value + row_error_count;
    insert into public.import_rows (
      tenant_id, batch_id, row_number, status, classification, resolution, review_status,
      candidate_customer_id, batch_customer_ref, source_record_ref, identity_fingerprint, raw_payload,
      normalized_payload, planned_mutation, validation_error_count
    ) values (
      target_tenant_id, batch_id_value, (row_value ->> 'row_number')::integer,
      case when row_error_count > 0 then 'rejected'
           when row_value ->> 'classification' in ('probable_match', 'ambiguous') then 'review_required'
           else 'planned' end,
      row_value ->> 'classification',
      case when row_value ->> 'classification' = 'exact_match' then 'exact_match' else null end,
      case when row_value ->> 'classification' in ('exact_match', 'new_customer') then 'approved' else 'pending' end,
      nullif(row_value ->> 'candidate_customer_id', '')::uuid,
      nullif(row_value ->> 'batch_customer_ref', ''),
      left(row_value ->> 'source_record_ref', 240),
      left(row_value ->> 'identity_fingerprint', 128),
      coalesce(row_value -> 'raw_payload', '{}'::jsonb),
      coalesce(row_value -> 'normalized_payload', '{}'::jsonb),
      coalesce(row_value -> 'planned_mutation', '{}'::jsonb),
      row_error_count
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

create or replace function public.commit_import_batch(target_batch_id uuid, approval_phrase text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  batch_value record;
  row_value record;
  identity_record jsonb;
  memory_value jsonb;
  target_customer_id uuid;
  batch_customer_map jsonb := '{}'::jsonb;
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
  for row_value in
    select * from public.import_rows
    where batch_id = target_batch_id and status not in ('rejected', 'imported')
    order by row_number
  loop
    if row_value.batch_customer_ref is not null and batch_customer_map ? row_value.batch_customer_ref then
      target_customer_id := (batch_customer_map ->> row_value.batch_customer_ref)::uuid;
      linked_count := linked_count + 1;
    elsif row_value.resolution = 'exact_match' or row_value.classification = 'exact_match' then
      target_customer_id := row_value.candidate_customer_id;
      if target_customer_id is null or not exists (
        select 1 from public.customers where id = target_customer_id and tenant_id = batch_value.tenant_id
      ) then
        raise exception 'exact match row has no valid tenant or batch candidate' using errcode = '42501';
      end if;
      linked_count := linked_count + 1;
    else
      insert into public.customers (tenant_id, external_ref, display_name, source_type, source_name, source_record_ref)
      values (batch_value.tenant_id, nullif(row_value.normalized_payload ->> 'external_id', ''), nullif(row_value.normalized_payload ->> 'display_name', ''), batch_value.source_type, batch_value.source_name, row_value.source_record_ref)
      returning id into target_customer_id;
      created_count := created_count + 1;
    end if;

    if row_value.batch_customer_ref is not null then
      batch_customer_map := jsonb_set(batch_customer_map, array[row_value.batch_customer_ref], to_jsonb(target_customer_id::text), true);
    end if;

    for identity_record in select value from jsonb_array_elements(coalesce(row_value.normalized_payload -> 'identities', '[]'::jsonb)) loop
      if exists (
        select 1 from public.customer_identities as ci
        where ci.tenant_id = batch_value.tenant_id
          and ci.identity_type = identity_record ->> 'identity_type'
          and ci.identity_scope = coalesce(identity_record ->> 'identity_scope', 'global')
          and ci.normalized_value = identity_record ->> 'normalized_value'
          and ci.customer_id <> target_customer_id
      ) then
        raise exception 'identity conflict detected during import' using errcode = '23505';
      end if;
      insert into public.customer_identities (tenant_id, customer_id, identity_type, identity_value, normalized_value, identity_scope, is_primary, source_type, source_name, source_record_ref)
      values (batch_value.tenant_id, target_customer_id, identity_record ->> 'identity_type', identity_record ->> 'identity_value', identity_record ->> 'normalized_value', coalesce(identity_record ->> 'identity_scope', 'global'), coalesce((identity_record ->> 'is_primary')::boolean, false), batch_value.source_type, batch_value.source_name, row_value.source_record_ref)
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
      experience_level = coalesce(excluded.experience_level, public.customer_profiles.experience_level),
      primary_instrument = coalesce(excluded.primary_instrument, public.customer_profiles.primary_instrument),
      trading_style = coalesce(excluded.trading_style, public.customer_profiles.trading_style),
      risk_preference = coalesce(excluded.risk_preference, public.customer_profiles.risk_preference),
      preferred_signal_frequency = coalesce(excluded.preferred_signal_frequency, public.customer_profiles.preferred_signal_frequency),
      communication_style = coalesce(excluded.communication_style, public.customer_profiles.communication_style),
      preferred_message_length = coalesce(excluded.preferred_message_length, public.customer_profiles.preferred_message_length),
      price_sensitivity = coalesce(excluded.price_sensitivity, public.customer_profiles.price_sensitivity),
      trust_level = coalesce(excluded.trust_level, public.customer_profiles.trust_level),
      churn_reason = coalesce(excluded.churn_reason, public.customer_profiles.churn_reason),
      last_conversation_summary = coalesce(excluded.last_conversation_summary, public.customer_profiles.last_conversation_summary),
      next_best_action = coalesce(excluded.next_best_action, public.customer_profiles.next_best_action),
      retention_risk = coalesce(excluded.retention_risk, public.customer_profiles.retention_risk),
      updated_at = now();

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

revoke all on function public.create_import_dry_run(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_import_dry_run(uuid, text, text, text, text, jsonb) to authenticated;
revoke all on function public.commit_import_batch(uuid, text) from public, anon;
grant execute on function public.commit_import_batch(uuid, text) to authenticated;
