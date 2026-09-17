-- Gold Revenue OS Phase 4: tenant-safe Admin Control Plane read models.
-- No historical customer rows are imported by this migration.

create index if not exists customers_admin_filters_idx
  on public.customers (tenant_id, segment, risk_level, source_type, updated_at desc, id desc);
create index if not exists customers_admin_created_idx
  on public.customers (tenant_id, created_at desc, id desc);
create index if not exists customers_admin_manager_idx
  on public.customers (tenant_id, assigned_manager_id, updated_at desc, id desc)
  where assigned_manager_id is not null;
create index if not exists import_rows_admin_review_idx
  on public.import_rows (tenant_id, review_status, classification, created_at desc, id desc);
create index if not exists domain_events_admin_authority_idx
  on public.domain_events (tenant_id, authority, recorded_at desc, id desc);
create index if not exists audit_logs_admin_action_idx
  on public.audit_logs (tenant_id, action, created_at desc, id desc);
create index if not exists audit_logs_admin_correlation_idx
  on public.audit_logs (tenant_id, correlation_id, created_at desc, id desc)
  where correlation_id is not null;

-- Identity values are operational PII. Analysts and readonly users can inspect
-- customer records, but cannot fetch identity rows directly through Data API.
drop policy if exists customer_identities_select_member on public.customer_identities;
create policy customer_identities_select_operational
on public.customer_identities for select to authenticated
using ((select private.has_tenant_role(
  tenant_id,
  array['super_admin','manager','support']::public.app_role[]
)));

-- Raw event envelopes (including payload) remain management-only. Analysts use
-- the bounded, payload-free operational projection below.
drop policy if exists domain_events_select_management on public.domain_events;
create policy domain_events_select_operations
on public.domain_events for select to authenticated
using ((select private.has_tenant_role(
  tenant_id,
  array['super_admin','manager']::public.app_role[]
)));

create or replace function private.require_tenant_role(
  target_tenant_id uuid,
  allowed_roles public.app_role[]
)
returns public.app_role
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  caller_role public.app_role;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select tm.role into caller_role
  from public.tenant_members tm
  where tm.tenant_id = target_tenant_id
    and tm.user_id = auth.uid()
    and tm.status = 'active';
  if caller_role is null or not caller_role = any(allowed_roles) then
    raise exception 'role is not authorized' using errcode = '42501';
  end if;
  return caller_role;
end;
$$;
revoke all on function private.require_tenant_role(uuid, public.app_role[]) from public, anon, authenticated;

create or replace function public.admin_customer_list(
  target_tenant_id uuid,
  search_value text default null,
  state_value public.customer_state default null,
  segment_value text default null,
  risk_value text default null,
  source_value text default null,
  manager_value uuid default null,
  created_from_value timestamptz default null,
  created_to_value timestamptz default null,
  page_value integer default 1,
  page_size_value integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  caller_role public.app_role;
  safe_page integer := greatest(coalesce(page_value, 1), 1);
  safe_size integer := least(greatest(coalesce(page_size_value, 25), 1), 100);
  result_value jsonb;
begin
  caller_role := private.require_tenant_role(
    target_tenant_id,
    array['super_admin','manager','support','analyst','readonly']::public.app_role[]
  );

  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(q) - 'total_count'), '[]'::jsonb),
    'total', coalesce(max(q.total_count), 0),
    'page', safe_page,
    'page_size', safe_size
  ) into result_value
  from (
    select
      c.id, c.display_name, c.external_ref, c.state, c.segment, c.risk_level,
      c.source_type, c.source_name, c.assigned_manager_id, c.created_at, c.updated_at,
      cp.next_best_action,
      case when caller_role in ('super_admin','manager','support') then pi.identity_type else null end as primary_identity_type,
      case when caller_role in ('super_admin','manager','support') then pi.identity_value else null end as primary_identity_value,
      count(*) over() as total_count
    from public.customers c
    left join public.customer_profiles cp
      on cp.tenant_id = c.tenant_id and cp.customer_id = c.id
    left join lateral (
      select ci.identity_type, ci.identity_value, ci.normalized_value
      from public.customer_identities ci
      where ci.tenant_id = c.tenant_id and ci.customer_id = c.id
      order by ci.is_primary desc, ci.created_at, ci.id
      limit 1
    ) pi on true
    where c.tenant_id = target_tenant_id
      and (state_value is null or c.state = state_value)
      and (segment_value is null or c.segment = segment_value)
      and (risk_value is null or c.risk_level = risk_value)
      and (source_value is null or c.source_type = source_value or c.source_name = source_value)
      and (manager_value is null or c.assigned_manager_id = manager_value)
      and (created_from_value is null or c.created_at >= created_from_value)
      and (created_to_value is null or c.created_at < created_to_value)
      and (
        nullif(btrim(search_value), '') is null
        or c.display_name ilike '%' || btrim(search_value) || '%'
        or c.external_ref ilike '%' || btrim(search_value) || '%'
        or exists (
          select 1 from public.customer_identities si
          where si.tenant_id = c.tenant_id and si.customer_id = c.id
            and (si.normalized_value ilike '%' || lower(btrim(search_value)) || '%'
              or si.identity_value ilike '%' || btrim(search_value) || '%')
        )
      )
    order by c.updated_at desc, c.id desc
    limit safe_size offset ((safe_page - 1) * safe_size)
  ) q;
  return result_value;
end;
$$;

create or replace function public.admin_dashboard_metrics(target_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare result_value jsonb;
begin
  perform private.require_tenant_role(target_tenant_id, array['super_admin','manager','support','analyst','readonly']::public.app_role[]);
  select jsonb_build_object(
    'total_customers', (select count(*) from public.customers c where c.tenant_id = target_tenant_id),
    'customers_by_state', coalesce((select jsonb_object_agg(s.state, s.count) from (
      select c.state::text as state, count(*) as count from public.customers c
      where c.tenant_id = target_tenant_id group by c.state
    ) s), '{}'::jsonb),
    'recent_customers', coalesce((select jsonb_agg(to_jsonb(rc)) from (
      select c.id, c.display_name, c.state, c.created_at from public.customers c
      where c.tenant_id = target_tenant_id order by c.created_at desc, c.id desc limit 5
    ) rc), '[]'::jsonb),
    'open_import_reviews', (select count(*) from public.import_rows ir where ir.tenant_id = target_tenant_id and ir.review_status = 'pending'),
    'probable_identities', (select count(*) from public.import_rows ir where ir.tenant_id = target_tenant_id and ir.classification = 'probable_match' and ir.review_status = 'pending'),
    'ambiguous_identities', (select count(*) from public.import_rows ir where ir.tenant_id = target_tenant_id and ir.classification = 'ambiguous' and ir.review_status = 'pending'),
    'recent_events', (select count(*) from public.domain_events de where de.tenant_id = target_tenant_id and de.recorded_at >= now() - interval '24 hours'),
    'failed_events', (select count(*) from public.event_outbox eo where eo.tenant_id = target_tenant_id and (eo.status = 'dead_letter' or eo.last_error_code is not null)),
    'scheduled_backlog', (select count(*) from public.scheduled_jobs sj where sj.tenant_id = target_tenant_id and sj.status in ('scheduled','processing')),
    'recent_audit', (select count(*) from public.audit_logs al where al.tenant_id = target_tenant_id and al.created_at >= now() - interval '24 hours')
  ) into result_value;
  return result_value;
end;
$$;

create or replace function public.admin_event_list(
  target_tenant_id uuid,
  event_type_value text default null,
  status_value text default null,
  authority_value public.event_authority default null,
  customer_value uuid default null,
  correlation_value uuid default null,
  date_from_value timestamptz default null,
  date_to_value timestamptz default null,
  page_value integer default 1,
  page_size_value integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  safe_page integer := greatest(coalesce(page_value, 1), 1);
  safe_size integer := least(greatest(coalesce(page_size_value, 50), 1), 100);
  result_value jsonb;
begin
  perform private.require_tenant_role(target_tenant_id, array['super_admin','manager','analyst']::public.app_role[]);
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(q) - 'total_count'), '[]'::jsonb),
    'total', coalesce(max(q.total_count), 0),
    'page', safe_page,
    'page_size', safe_size
  ) into result_value
  from (
    select de.id, de.customer_id, de.event_type, de.event_version, de.actor_type,
      de.producer, de.authority, de.correlation_id, de.causation_id,
      de.occurred_at, de.recorded_at, eo.status, eo.attempts, eo.max_attempts,
      eo.last_error_code, eo.dead_lettered_at, count(*) over() as total_count
    from public.domain_events de
    left join public.event_outbox eo on eo.tenant_id = de.tenant_id and eo.event_id = de.id
    where de.tenant_id = target_tenant_id
      and (event_type_value is null or de.event_type = event_type_value)
      and (status_value is null or coalesce(eo.status, 'not_queued') = status_value)
      and (authority_value is null or de.authority = authority_value)
      and (customer_value is null or de.customer_id = customer_value)
      and (correlation_value is null or de.correlation_id = correlation_value)
      and (date_from_value is null or de.recorded_at >= date_from_value)
      and (date_to_value is null or de.recorded_at < date_to_value)
    order by de.recorded_at desc, de.id desc
    limit safe_size offset ((safe_page - 1) * safe_size)
  ) q;
  return result_value;
end;
$$;

create or replace function public.admin_needs_attention(target_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare result_value jsonb;
begin
  perform private.require_tenant_role(target_tenant_id, array['super_admin','manager','support','analyst']::public.app_role[]);
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
  into result_value
  from (
    select 'dead_letter_event'::text as category, 'critical'::text as severity,
      eo.event_id::text as entity_id, de.customer_id, eo.last_error_code as summary,
      eo.dead_lettered_at as created_at
    from public.event_outbox eo join public.domain_events de
      on de.tenant_id = eo.tenant_id and de.id = eo.event_id
    where eo.tenant_id = target_tenant_id and eo.status = 'dead_letter'
    union all
    select 'failed_processing', 'high', eo.event_id::text, de.customer_id,
      eo.last_error_code, eo.updated_at
    from public.event_outbox eo join public.domain_events de
      on de.tenant_id = eo.tenant_id and de.id = eo.event_id
    where eo.tenant_id = target_tenant_id and eo.status <> 'dead_letter' and eo.last_error_code is not null
    union all
    select 'import_review', case when ir.classification = 'ambiguous' then 'high' else 'medium' end,
      ir.id::text, ir.candidate_customer_id,
      ir.classification || ' requires manual review', ir.created_at
    from public.import_rows ir
    where ir.tenant_id = target_tenant_id and ir.review_status = 'pending'
      and (ir.status = 'review_required' or ir.classification in ('probable_match','ambiguous'))
    union all
    select 'import_error', 'high', ie.id::text, null::uuid,
      ie.error_code || ': ' || left(ie.message, 180), ie.created_at
    from public.import_errors ie where ie.tenant_id = target_tenant_id
    order by created_at desc limit 200
  ) q;
  return result_value;
end;
$$;

create or replace function public.admin_audit_list(
  target_tenant_id uuid,
  actor_value uuid default null,
  role_value public.app_role default null,
  action_value text default null,
  entity_value text default null,
  correlation_value uuid default null,
  date_from_value timestamptz default null,
  date_to_value timestamptz default null,
  page_value integer default 1,
  page_size_value integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  caller_role public.app_role;
  safe_page integer := greatest(coalesce(page_value, 1), 1);
  safe_size integer := least(greatest(coalesce(page_size_value, 50), 1), 100);
  result_value jsonb;
begin
  caller_role := private.require_tenant_role(target_tenant_id, array['super_admin','manager']::public.app_role[]);
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(q) - 'total_count'), '[]'::jsonb),
    'total', coalesce(max(q.total_count), 0), 'page', safe_page, 'page_size', safe_size
  ) into result_value
  from (
    select al.id, al.actor_type, al.actor_id, tm.role, al.action, al.entity_type,
      al.entity_id, al.tenant_id, al.correlation_id, al.request_id, al.created_at,
      case when caller_role = 'super_admin' then al.before_data else null end as before_data,
      case when caller_role = 'super_admin' then al.after_data else null end as after_data,
      count(*) over() as total_count
    from public.audit_logs al
    left join public.tenant_members tm
      on tm.tenant_id = al.tenant_id and tm.user_id = al.actor_id
    where al.tenant_id = target_tenant_id
      and (actor_value is null or al.actor_id = actor_value)
      and (role_value is null or tm.role = role_value)
      and (action_value is null or al.action = action_value)
      and (entity_value is null or al.entity_type = entity_value)
      and (correlation_value is null or al.correlation_id = correlation_value)
      and (date_from_value is null or al.created_at >= date_from_value)
      and (date_to_value is null or al.created_at < date_to_value)
    order by al.created_at desc, al.id desc
    limit safe_size offset ((safe_page - 1) * safe_size)
  ) q;
  return result_value;
end;
$$;

create or replace function public.admin_system_health(target_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  latest_migration text := 'unavailable';
  result_value jsonb;
begin
  perform private.require_tenant_role(target_tenant_id, array['super_admin','manager','analyst']::public.app_role[]);
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select coalesce(max(version)::text, ''unavailable'') from supabase_migrations.schema_migrations'
      into latest_migration;
  end if;
  select jsonb_build_object(
    'environment', 'STAGING',
    'database', 'connected',
    'latest_migration', latest_migration,
    'failed_events', (select count(*) from public.event_outbox eo where eo.tenant_id = target_tenant_id and eo.last_error_code is not null),
    'dead_letter_count', (select count(*) from public.event_outbox eo where eo.tenant_id = target_tenant_id and eo.status = 'dead_letter'),
    'pending_outbox_count', (select count(*) from public.event_outbox eo where eo.tenant_id = target_tenant_id and eo.status in ('pending','processing')),
    'oldest_pending_outbox_at', (select min(eo.created_at) from public.event_outbox eo where eo.tenant_id = target_tenant_id and eo.status in ('pending','processing')),
    'scheduled_job_backlog', (select count(*) from public.scheduled_jobs sj where sj.tenant_id = target_tenant_id and sj.status in ('scheduled','processing')),
    'latest_successful_processing_at', (select max(coalesce(eo.completed_at, eo.updated_at)) from public.event_outbox eo where eo.tenant_id = target_tenant_id and eo.status = 'completed'),
    'checked_at', now()
  ) into result_value;
  return result_value;
end;
$$;

revoke all on function public.admin_customer_list(uuid,text,public.customer_state,text,text,text,uuid,timestamptz,timestamptz,integer,integer) from public, anon;
revoke all on function public.admin_dashboard_metrics(uuid) from public, anon;
revoke all on function public.admin_event_list(uuid,text,text,public.event_authority,uuid,uuid,timestamptz,timestamptz,integer,integer) from public, anon;
revoke all on function public.admin_needs_attention(uuid) from public, anon;
revoke all on function public.admin_audit_list(uuid,uuid,public.app_role,text,text,uuid,timestamptz,timestamptz,integer,integer) from public, anon;
revoke all on function public.admin_system_health(uuid) from public, anon;

grant execute on function public.admin_customer_list(uuid,text,public.customer_state,text,text,text,uuid,timestamptz,timestamptz,integer,integer) to authenticated;
grant execute on function public.admin_dashboard_metrics(uuid) to authenticated;
grant execute on function public.admin_event_list(uuid,text,text,public.event_authority,uuid,uuid,timestamptz,timestamptz,integer,integer) to authenticated;
grant execute on function public.admin_needs_attention(uuid) to authenticated;
grant execute on function public.admin_audit_list(uuid,uuid,public.app_role,text,text,uuid,timestamptz,timestamptz,integer,integer) to authenticated;
grant execute on function public.admin_system_health(uuid) to authenticated;

-- The real import remains technically locked. Dry-run and review RPCs stay
-- available; execution requires a future reviewed migration after resolution
-- of the 225-record manual-review gate and customer-count reconciliation.
revoke execute on function public.commit_import_batch(uuid, text) from authenticated;
