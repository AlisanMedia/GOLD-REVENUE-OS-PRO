-- Gold Revenue OS Phase 1 foundation.
-- Scope: authentication profiles, tenants, memberships, RBAC and immutable audit.

create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum (
  'super_admin',
  'manager',
  'support',
  'analyst',
  'readonly'
);

create type public.audit_actor_type as enum ('SYSTEM', 'HUMAN');

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role public.app_role not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index tenant_members_user_active_idx
  on public.tenant_members (user_id, tenant_id)
  where status = 'active';

create table public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id) on delete restrict,
  actor_type public.audit_actor_type not null,
  actor_id uuid,
  action text not null check (char_length(action) between 3 and 120),
  entity_type text not null check (char_length(entity_type) between 1 and 80),
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create index audit_logs_tenant_created_idx
  on public.audit_logs (tenant_id, created_at desc, id desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger app_users_set_updated_at
before update on public.app_users
for each row execute function private.set_updated_at();

create trigger tenants_set_updated_at
before update on public.tenants
for each row execute function private.set_updated_at();

create trigger tenant_members_set_updated_at
before update on public.tenant_members
for each row execute function private.set_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into public.app_users (id, display_name)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create or replace function private.is_tenant_member(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = target_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  );
$$;

create or replace function private.has_tenant_role(
  target_tenant_id uuid,
  allowed_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = target_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role = any(allowed_roles)
  );
$$;

revoke all on function private.is_tenant_member(uuid) from public, anon;
revoke all on function private.has_tenant_role(uuid, public.app_role[]) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_tenant_member(uuid) to authenticated;
grant execute on function private.has_tenant_role(uuid, public.app_role[]) to authenticated;

create or replace function private.capture_foundation_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  row_before jsonb;
  row_after jsonb;
  target_tenant_id uuid;
  target_entity_id text;
  request_headers jsonb;
begin
  row_before := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  row_after := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  target_tenant_id := case
    when tg_table_name = 'tenants' then coalesce((row_after ->> 'id')::uuid, (row_before ->> 'id')::uuid)
    else coalesce((row_after ->> 'tenant_id')::uuid, (row_before ->> 'tenant_id')::uuid)
  end;
  target_entity_id := coalesce(
    row_after ->> 'id', row_before ->> 'id',
    row_after ->> 'user_id', row_before ->> 'user_id'
  );
  request_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);

  insert into public.audit_logs (
    tenant_id, actor_type, actor_id, action, entity_type, entity_id,
    before_data, after_data, request_id
  ) values (
    target_tenant_id,
    case when auth.uid() is null then 'SYSTEM'::public.audit_actor_type else 'HUMAN'::public.audit_actor_type end,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    target_entity_id,
    row_before,
    row_after,
    request_headers ->> 'x-request-id'
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.capture_foundation_audit() from public, anon, authenticated;

create trigger tenants_audit
after insert or update or delete on public.tenants
for each row execute function private.capture_foundation_audit();

create trigger tenant_members_audit
after insert or update or delete on public.tenant_members
for each row execute function private.capture_foundation_audit();

create or replace function private.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'audit_logs are append-only' using errcode = '42501';
end;
$$;

create trigger audit_logs_immutable
before update or delete on public.audit_logs
for each row execute function private.reject_audit_mutation();

alter table public.app_users enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.audit_logs enable row level security;

create policy app_users_select_self
on public.app_users for select to authenticated
using (id = (select auth.uid()));

create policy tenants_select_member
on public.tenants for select to authenticated
using ((select private.is_tenant_member(id)));

create policy tenant_members_select_same_tenant
on public.tenant_members for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

create policy audit_logs_select_management
on public.audit_logs for select to authenticated
using ((select private.has_tenant_role(
  tenant_id,
  array['super_admin', 'manager']::public.app_role[]
)));

revoke all on table public.app_users from anon, authenticated;
revoke all on table public.tenants from anon, authenticated;
revoke all on table public.tenant_members from anon, authenticated;
revoke all on table public.audit_logs from anon, authenticated;

grant select on table public.app_users to authenticated;
grant select on table public.tenants to authenticated;
grant select on table public.tenant_members to authenticated;
grant select on table public.audit_logs to authenticated;

-- All writes are server/operator-controlled in Phase 1. No authenticated DML grants.
