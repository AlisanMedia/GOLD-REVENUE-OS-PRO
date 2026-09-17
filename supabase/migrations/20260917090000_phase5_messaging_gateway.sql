-- Gold Revenue OS Phase 5: provider-neutral messaging gateway and Telegram adapter storage.
-- No provider credentials are stored in Postgres. Outbound is disabled by default.

create type public.messaging_provider as enum ('telegram');
create type public.messaging_contactability as enum ('unknown','user_initiated','allowed','blocked','revoked');
create type public.message_direction as enum ('inbound','outbound');
create type public.message_status as enum ('received','pending','sending','retry_scheduled','sent','failed','blocked');

alter table public.tenants
  add column outbound_messaging_enabled boolean not null default false;

create table public.messaging_provider_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  provider public.messaging_provider not null,
  label text not null default 'staging' check (char_length(label) between 1 and 80),
  status text not null default 'active' check (status in ('configuring','active','disabled','revoked')),
  provider_account_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider)
);

create table public.messaging_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  provider_connection_id uuid not null,
  customer_id uuid,
  provider_user_id text not null check (char_length(provider_user_id) between 1 and 120),
  provider_chat_id text not null check (char_length(provider_chat_id) between 1 and 120),
  username text,
  first_name text,
  last_name text,
  contactability public.messaging_contactability not null default 'unknown',
  identity_resolution text not null default 'unmatched'
    check (identity_resolution in ('exact_match','ambiguous','unmatched','manual')),
  review_required boolean not null default true,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  blocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (provider_connection_id, provider_user_id),
  unique (provider_connection_id, provider_chat_id),
  foreign key (tenant_id, provider_connection_id)
    references public.messaging_provider_connections(tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_id)
    references public.customers(tenant_id, id) on delete restrict
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  provider_connection_id uuid not null,
  messaging_contact_id uuid not null,
  customer_id uuid,
  provider_conversation_id text not null check (char_length(provider_conversation_id) between 1 and 160),
  status text not null default 'open' check (status in ('open','closed','blocked')),
  human_takeover boolean not null default true,
  unread_count integer not null default 0 check (unread_count >= 0),
  attention_required boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (provider_connection_id, provider_conversation_id),
  foreign key (tenant_id, provider_connection_id)
    references public.messaging_provider_connections(tenant_id, id) on delete restrict,
  foreign key (tenant_id, messaging_contact_id)
    references public.messaging_contacts(tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_id)
    references public.customers(tenant_id, id) on delete restrict
);

create table public.conversation_participants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  conversation_id uuid not null,
  customer_id uuid,
  messaging_contact_id uuid,
  participant_role text not null check (participant_role in ('customer','operator','system')),
  created_at timestamptz not null default now(),
  unique (tenant_id, conversation_id, participant_role, messaging_contact_id),
  foreign key (tenant_id, conversation_id)
    references public.conversations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, customer_id)
    references public.customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, messaging_contact_id)
    references public.messaging_contacts(tenant_id, id) on delete restrict
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  conversation_id uuid not null,
  customer_id uuid,
  messaging_contact_id uuid not null,
  provider_connection_id uuid not null,
  direction public.message_direction not null,
  message_type text not null default 'text' check (message_type in ('text','command','unsupported')),
  content text not null check (char_length(content) between 1 and 4096),
  status public.message_status not null,
  provider_message_id text,
  provider_chat_id text not null,
  reply_to_message_id uuid,
  reply_to_provider_message_id text,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 240),
  actor_type public.lifecycle_actor_type not null,
  actor_id text,
  correlation_id uuid not null,
  causation_id uuid,
  failure_code text,
  retry_after_at timestamptz,
  provider_acknowledged_at timestamptz,
  occurred_at timestamptz not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, conversation_id)
    references public.conversations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_id)
    references public.customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, messaging_contact_id)
    references public.messaging_contacts(tenant_id, id) on delete restrict,
  foreign key (tenant_id, provider_connection_id)
    references public.messaging_provider_connections(tenant_id, id) on delete restrict,
  foreign key (tenant_id, reply_to_message_id)
    references public.messages(tenant_id, id) on delete restrict,
  foreign key (tenant_id, causation_id)
    references public.domain_events(tenant_id, id) on delete restrict
);

create unique index messages_provider_id_idx
  on public.messages (provider_connection_id, provider_chat_id, provider_message_id)
  where provider_message_id is not null;
create index messages_conversation_time_idx
  on public.messages (tenant_id, conversation_id, occurred_at desc, id desc);
create index messages_customer_time_idx
  on public.messages (tenant_id, customer_id, occurred_at desc, id desc);
create index conversations_tenant_time_idx
  on public.conversations (tenant_id, last_message_at desc nulls last, id);
create index messaging_contacts_customer_idx
  on public.messaging_contacts (tenant_id, customer_id, updated_at desc);
create index messaging_contacts_review_idx
  on public.messaging_contacts (tenant_id, review_required, updated_at desc)
  where review_required;

create table public.messaging_provider_updates (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  provider_connection_id uuid not null,
  provider_update_id text not null check (char_length(provider_update_id) between 1 and 120),
  provider_message_id text,
  message_id uuid,
  processing_status text not null default 'processing'
    check (processing_status in ('processing','completed','rejected','failed')),
  error_code text,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (provider_connection_id, provider_update_id),
  foreign key (tenant_id, provider_connection_id)
    references public.messaging_provider_connections(tenant_id, id) on delete restrict,
  foreign key (tenant_id, message_id)
    references public.messages(tenant_id, id) on delete restrict
);

create table public.message_delivery_attempts (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  message_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  result text not null check (result in ('sent','retry_scheduled','failed','blocked')),
  provider_status integer,
  error_code text,
  retry_after_seconds integer,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, message_id)
    references public.messages(tenant_id, id) on delete restrict
);

create index provider_updates_tenant_time_idx
  on public.messaging_provider_updates (tenant_id, received_at desc, id desc);
create index delivery_attempts_message_idx
  on public.message_delivery_attempts (tenant_id, message_id, created_at, id);

create trigger messaging_connections_set_updated_at
before update on public.messaging_provider_connections
for each row execute function private.set_updated_at();
create trigger messaging_contacts_set_updated_at
before update on public.messaging_contacts
for each row execute function private.set_updated_at();
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function private.set_updated_at();
create trigger messages_set_updated_at
before update on public.messages
for each row execute function private.set_updated_at();

create trigger message_delivery_attempts_immutable
before update or delete on public.message_delivery_attempts
for each row execute function private.reject_append_only_mutation();

create or replace function public.ingest_telegram_message(
  target_tenant_id uuid,
  provider_update_id_value text,
  provider_message_id_value text,
  provider_chat_id_value text,
  provider_user_id_value text,
  username_value text,
  first_name_value text,
  last_name_value text,
  content_value text,
  reply_to_provider_message_id_value text,
  occurred_at_value timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  connection_id_value uuid;
  update_row_id bigint;
  existing_message_id uuid;
  exact_customer_id uuid;
  username_matches integer := 0;
  contact_value public.messaging_contacts%rowtype;
  conversation_value public.conversations%rowtype;
  message_id_value uuid;
  reply_message_id_value uuid;
  event_id_value uuid;
  correlation_id_value uuid := gen_random_uuid();
  resolution_value text := 'unmatched';
  review_value boolean := true;
begin
  -- EXECUTE is revoked from PUBLIC, anon and authenticated; only service_role may call this RPC.
  if nullif(btrim(provider_update_id_value),'') is null
     or nullif(btrim(provider_message_id_value),'') is null
     or nullif(btrim(provider_chat_id_value),'') is null
     or nullif(btrim(provider_user_id_value),'') is null
     or nullif(btrim(content_value),'') is null
     or char_length(content_value) > 4096 then
    raise exception 'invalid Telegram message envelope' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants where id = target_tenant_id and status = 'active') then
    raise exception 'tenant unavailable' using errcode = 'P0002';
  end if;

  insert into public.messaging_provider_connections (tenant_id, provider, label, status)
  values (target_tenant_id, 'telegram', 'staging', 'active')
  on conflict (tenant_id, provider) do update set status =
    case when public.messaging_provider_connections.status = 'revoked'
      then 'revoked' else 'active' end
  returning id into connection_id_value;

  insert into public.messaging_provider_updates (
    tenant_id, provider_connection_id, provider_update_id, provider_message_id
  ) values (
    target_tenant_id, connection_id_value, left(provider_update_id_value,120),
    left(provider_message_id_value,120)
  )
  on conflict (provider_connection_id, provider_update_id) do nothing
  returning id into update_row_id;

  if update_row_id is null then
    select message_id into existing_message_id
    from public.messaging_provider_updates
    where provider_connection_id = connection_id_value
      and provider_update_id = left(provider_update_id_value,120);
    return jsonb_build_object('duplicate', true, 'message_id', existing_message_id);
  end if;

  select ci.customer_id into exact_customer_id
  from public.customer_identities ci
  where ci.tenant_id = target_tenant_id
    and ci.identity_type = 'telegram_user_id'
    and ci.normalized_value = btrim(provider_user_id_value)
  limit 1;

  if exact_customer_id is not null then
    resolution_value := 'exact_match';
    review_value := false;
  elsif nullif(btrim(username_value),'') is not null then
    select count(distinct ci.customer_id)::integer into username_matches
    from public.customer_identities ci
    where ci.tenant_id = target_tenant_id
      and ci.identity_type = 'telegram_username'
      and ci.normalized_value = lower(trim(leading '@' from btrim(username_value)));
    if username_matches > 0 then
      resolution_value := 'ambiguous';
      review_value := true;
    end if;
  end if;

  insert into public.messaging_contacts (
    tenant_id, provider_connection_id, customer_id, provider_user_id,
    provider_chat_id, username, first_name, last_name, contactability,
    identity_resolution, review_required, last_inbound_at
  ) values (
    target_tenant_id, connection_id_value, exact_customer_id,
    left(btrim(provider_user_id_value),120), left(btrim(provider_chat_id_value),120),
    nullif(left(lower(trim(leading '@' from btrim(coalesce(username_value,'')))),32),''),
    nullif(left(btrim(coalesce(first_name_value,'')),120),''),
    nullif(left(btrim(coalesce(last_name_value,'')),120),''),
    'user_initiated', resolution_value, review_value, coalesce(occurred_at_value,now())
  )
  on conflict (provider_connection_id, provider_user_id) do update
    set provider_chat_id = excluded.provider_chat_id,
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        contactability = case
          when public.messaging_contacts.contactability in ('blocked','revoked')
            then public.messaging_contacts.contactability
          else 'user_initiated'::public.messaging_contactability end,
        customer_id = coalesce(public.messaging_contacts.customer_id, excluded.customer_id),
        identity_resolution = case
          when public.messaging_contacts.customer_id is not null then public.messaging_contacts.identity_resolution
          else excluded.identity_resolution end,
        review_required = case
          when public.messaging_contacts.customer_id is not null then false
          else excluded.review_required end,
        last_inbound_at = excluded.last_inbound_at
  returning * into contact_value;

  insert into public.conversations (
    tenant_id, provider_connection_id, messaging_contact_id, customer_id,
    provider_conversation_id, human_takeover, unread_count, attention_required,
    last_message_at
  ) values (
    target_tenant_id, connection_id_value, contact_value.id, contact_value.customer_id,
    left(btrim(provider_chat_id_value),160), true, 1, contact_value.review_required,
    coalesce(occurred_at_value,now())
  )
  on conflict (provider_connection_id, provider_conversation_id) do update
    set customer_id = coalesce(public.conversations.customer_id, excluded.customer_id),
        unread_count = public.conversations.unread_count + 1,
        attention_required = public.conversations.attention_required or excluded.attention_required,
        last_message_at = excluded.last_message_at
  returning * into conversation_value;

  insert into public.conversation_participants (
    tenant_id, conversation_id, customer_id, messaging_contact_id, participant_role
  ) values (
    target_tenant_id, conversation_value.id, contact_value.customer_id, contact_value.id, 'customer'
  ) on conflict do nothing;

  if nullif(btrim(reply_to_provider_message_id_value),'') is not null then
    select m.id into reply_message_id_value
    from public.messages m
    where m.provider_connection_id = connection_id_value
      and m.provider_chat_id = btrim(provider_chat_id_value)
      and m.provider_message_id = btrim(reply_to_provider_message_id_value)
    limit 1;
  end if;

  insert into public.messages (
    tenant_id, conversation_id, customer_id, messaging_contact_id,
    provider_connection_id, direction, message_type, content, status,
    provider_message_id, provider_chat_id, reply_to_message_id,
    reply_to_provider_message_id, idempotency_key, actor_type, actor_id,
    correlation_id, occurred_at
  ) values (
    target_tenant_id, conversation_value.id, contact_value.customer_id, contact_value.id,
    connection_id_value, 'inbound',
    case when content_value ~ '^/start(@[A-Za-z0-9_]+)?([[:space:]]|$)' then 'command' else 'text' end,
    content_value, 'received', left(btrim(provider_message_id_value),120),
    left(btrim(provider_chat_id_value),120), reply_message_id_value,
    nullif(left(btrim(coalesce(reply_to_provider_message_id_value,'')),120),''),
    'telegram:update:' || left(btrim(provider_update_id_value),120),
    'WEBHOOK', 'telegram', correlation_id_value, coalesce(occurred_at_value,now())
  )
  on conflict (tenant_id, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id into message_id_value;

  event_id_value := private.append_domain_event(
    target_tenant_id, contact_value.customer_id, 'message.received', 1,
    jsonb_build_object(
      'conversation_id', conversation_value.id,
      'message_id', message_id_value,
      'channel', 'telegram'
    ),
    'WEBHOOK', 'telegram', 'messaging.telegram.webhook', 'UNTRUSTED',
    correlation_id_value, null, 'telegram:update:' || left(btrim(provider_update_id_value),120),
    coalesce(occurred_at_value,now())
  );

  update public.messaging_provider_updates
  set message_id = message_id_value, processing_status = 'completed', completed_at = now()
  where id = update_row_id;

  return jsonb_build_object(
    'duplicate', false,
    'message_id', message_id_value,
    'conversation_id', conversation_value.id,
    'customer_id', contact_value.customer_id,
    'identity_resolution', contact_value.identity_resolution,
    'review_required', contact_value.review_required,
    'event_id', event_id_value
  );
exception when others then
  if update_row_id is not null then
    update public.messaging_provider_updates
    set processing_status = 'failed', error_code = left(sqlstate || ':' || sqlerrm,160)
    where id = update_row_id;
  end if;
  raise;
end;
$$;

create or replace function public.queue_outbound_message(
  target_tenant_id uuid,
  target_conversation_id uuid,
  content_value text,
  idempotency_key_value text,
  correlation_id_value uuid,
  reply_to_message_id_value uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  conversation_value public.conversations%rowtype;
  contact_value public.messaging_contacts%rowtype;
  existing_value public.messages%rowtype;
  message_id_value uuid;
begin
  if not private.has_tenant_role(
    target_tenant_id,
    array['super_admin','manager','support']::public.app_role[]
  ) then raise exception 'messaging send denied' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.tenants
    where id = target_tenant_id and status = 'active'
      and outbound_messaging_enabled
  ) then raise exception 'outbound messaging disabled' using errcode = '42501'; end if;
  if nullif(btrim(content_value),'') is null or char_length(content_value) > 4096 then
    raise exception 'message content invalid' using errcode = '22023'; end if;
  if nullif(btrim(idempotency_key_value),'') is null then
    raise exception 'idempotency key required' using errcode = '22023'; end if;

  select * into conversation_value from public.conversations
  where tenant_id = target_tenant_id and id = target_conversation_id
  for update;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;

  select * into contact_value from public.messaging_contacts
  where tenant_id = target_tenant_id and id = conversation_value.messaging_contact_id;
  if contact_value.contactability not in ('user_initiated','allowed')
     or nullif(contact_value.provider_chat_id,'') is null then
    raise exception 'contact is not reachable' using errcode = '42501'; end if;

  select * into existing_value from public.messages
  where tenant_id = target_tenant_id and idempotency_key = left(btrim(idempotency_key_value),240);
  if found then
    if existing_value.conversation_id <> target_conversation_id
       or existing_value.content <> content_value
       or existing_value.direction <> 'outbound' then
      raise exception 'idempotency key reused with different message' using errcode = '23505';
    end if;
    return jsonb_build_object('duplicate', true, 'message_id', existing_value.id, 'status', existing_value.status);
  end if;

  insert into public.messages (
    tenant_id, conversation_id, customer_id, messaging_contact_id,
    provider_connection_id, direction, message_type, content, status,
    provider_chat_id, reply_to_message_id, idempotency_key, actor_type,
    actor_id, correlation_id, occurred_at
  ) values (
    target_tenant_id, conversation_value.id, conversation_value.customer_id,
    contact_value.id, conversation_value.provider_connection_id, 'outbound',
    'text', content_value, 'pending', contact_value.provider_chat_id,
    reply_to_message_id_value, left(btrim(idempotency_key_value),240),
    'HUMAN', auth.uid()::text, correlation_id_value, now()
  ) returning id into message_id_value;

  insert into public.audit_logs (
    tenant_id, actor_type, actor_id, action, entity_type, entity_id,
    before_data, after_data, correlation_id
  ) values (
    target_tenant_id, 'HUMAN', auth.uid(), 'messaging.outbound_queued',
    'messages', message_id_value::text, null,
    jsonb_build_object('redacted',true,'conversation_id',conversation_value.id),
    correlation_id_value
  );

  return jsonb_build_object('duplicate', false, 'message_id', message_id_value, 'status', 'pending');
end;
$$;

create or replace function public.record_outbound_message_result(
  target_tenant_id uuid,
  target_message_id uuid,
  result_value text,
  provider_message_id_value text,
  provider_status_value integer,
  error_code_value text,
  retry_after_seconds_value integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  message_value public.messages%rowtype;
  attempt_number_value integer;
  event_id_value uuid;
begin
  -- EXECUTE is revoked from PUBLIC, anon and authenticated; only service_role may call this RPC.
  select * into message_value from public.messages
  where tenant_id = target_tenant_id and id = target_message_id
  for update;
  if not found or message_value.direction <> 'outbound' then
    raise exception 'outbound message not found' using errcode = 'P0002'; end if;

  select count(*)::integer + 1 into attempt_number_value
  from public.message_delivery_attempts
  where tenant_id = target_tenant_id and message_id = target_message_id;

  if result_value = 'sent' then
    if nullif(btrim(provider_message_id_value),'') is null then
      raise exception 'provider acknowledgement required' using errcode = '22023'; end if;
    update public.messages
    set status = 'sent', provider_message_id = left(btrim(provider_message_id_value),120),
        provider_acknowledged_at = now(), sent_at = now(), failure_code = null,
        retry_after_at = null
    where tenant_id = target_tenant_id and id = target_message_id
      and status <> 'sent';
    if found then
      update public.messaging_contacts
      set last_outbound_at = now()
      where tenant_id = target_tenant_id and id = message_value.messaging_contact_id;
      event_id_value := private.append_domain_event(
        target_tenant_id, message_value.customer_id, 'message.sent', 1,
        jsonb_build_object(
          'conversation_id', message_value.conversation_id,
          'message_id', message_value.id,
          'channel', 'telegram'
        ),
        'SYSTEM', 'telegram-adapter', 'messaging.telegram.adapter', 'UNTRUSTED',
        message_value.correlation_id, message_value.causation_id,
        'telegram:sent:' || message_value.id::text, now()
      );
    end if;
  elsif result_value = 'retry_scheduled' then
    update public.messages
    set status = 'retry_scheduled',
        retry_after_at = now() + make_interval(secs => greatest(1,least(coalesce(retry_after_seconds_value,30),3600))),
        failure_code = left(coalesce(error_code_value,'TELEGRAM_RATE_LIMITED'),120)
    where tenant_id = target_tenant_id and id = target_message_id and status <> 'sent';
  elsif result_value = 'blocked' then
    update public.messages set status = 'blocked',
      failure_code = left(coalesce(error_code_value,'TELEGRAM_CHAT_UNREACHABLE'),120)
    where tenant_id = target_tenant_id and id = target_message_id and status <> 'sent';
    update public.messaging_contacts set contactability = 'blocked', blocked_at = now()
    where tenant_id = target_tenant_id and id = message_value.messaging_contact_id;
    update public.conversations set status = 'blocked', attention_required = true
    where tenant_id = target_tenant_id and id = message_value.conversation_id;
  elsif result_value = 'failed' then
    update public.messages set status = 'failed',
      failure_code = left(coalesce(error_code_value,'TELEGRAM_REJECTED'),120)
    where tenant_id = target_tenant_id and id = target_message_id and status <> 'sent';
  else
    raise exception 'unsupported provider result' using errcode = '22023';
  end if;

  insert into public.message_delivery_attempts (
    tenant_id, message_id, attempt_number, result, provider_status,
    error_code, retry_after_seconds
  ) values (
    target_tenant_id, target_message_id, attempt_number_value, result_value,
    provider_status_value, left(error_code_value,120), retry_after_seconds_value
  );

  return jsonb_build_object('message_id',target_message_id,'result',result_value,'event_id',event_id_value);
end;
$$;

create or replace function public.set_outbound_messaging_enabled(
  target_tenant_id uuid,
  enabled_value boolean,
  correlation_id_value uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare previous_value boolean;
begin
  if not private.has_tenant_role(
    target_tenant_id, array['super_admin','manager']::public.app_role[]
  ) then raise exception 'kill switch mutation denied' using errcode = '42501'; end if;
  select outbound_messaging_enabled into previous_value
  from public.tenants where id = target_tenant_id for update;
  if not found then raise exception 'tenant not found' using errcode = 'P0002'; end if;
  update public.tenants set outbound_messaging_enabled = enabled_value
  where id = target_tenant_id;
  insert into public.audit_logs (
    tenant_id, actor_type, actor_id, action, entity_type, entity_id,
    before_data, after_data, correlation_id
  ) values (
    target_tenant_id, 'HUMAN', auth.uid(), 'messaging.kill_switch_changed',
    'tenants', target_tenant_id::text,
    jsonb_build_object('outbound_messaging_enabled',previous_value),
    jsonb_build_object('outbound_messaging_enabled',enabled_value),
    correlation_id_value
  );
  return enabled_value;
end;
$$;

create or replace function public.admin_conversation_list(
  target_tenant_id uuid,
  status_value text default null,
  customer_value uuid default null,
  page_value integer default 1,
  page_size_value integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare result_value jsonb;
begin
  if not private.has_tenant_role(
    target_tenant_id, array['super_admin','manager','support']::public.app_role[]
  ) then raise exception 'messaging read denied' using errcode = '42501'; end if;
  with filtered as (
    select c.id, c.customer_id, c.status, c.unread_count, c.attention_required,
      c.last_message_at, c.updated_at, mpc.provider, mc.username,
      mc.contactability, mc.identity_resolution, mc.review_required,
      cu.display_name as customer_name,
      lm.direction as last_direction, lm.status as last_status,
      left(lm.content,240) as last_message
    from public.conversations c
    join public.messaging_provider_connections mpc
      on mpc.tenant_id = c.tenant_id and mpc.id = c.provider_connection_id
    join public.messaging_contacts mc
      on mc.tenant_id = c.tenant_id and mc.id = c.messaging_contact_id
    left join public.customers cu
      on cu.tenant_id = c.tenant_id and cu.id = c.customer_id
    left join lateral (
      select m.direction, m.status, m.content
      from public.messages m
      where m.tenant_id = c.tenant_id and m.conversation_id = c.id
      order by m.occurred_at desc, m.id desc limit 1
    ) lm on true
    where c.tenant_id = target_tenant_id
      and (status_value is null or c.status = status_value)
      and (customer_value is null or c.customer_id = customer_value)
  ), counted as (select count(*)::integer total from filtered),
  paged as (
    select * from filtered
    order by last_message_at desc nulls last, id
    limit greatest(1,least(page_size_value,100))
    offset (greatest(page_value,1)-1)*greatest(1,least(page_size_value,100))
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb),
    'total',(select total from counted),
    'page',greatest(page_value,1),
    'page_size',greatest(1,least(page_size_value,100))
  ) into result_value;
  return result_value;
end;
$$;

create or replace function public.admin_conversation_messages(
  target_tenant_id uuid,
  target_conversation_id uuid,
  before_value timestamptz default null,
  limit_value integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare result_value jsonb;
begin
  if not private.has_tenant_role(
    target_tenant_id, array['super_admin','manager','support']::public.app_role[]
  ) then raise exception 'message read denied' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(rows_value) order by rows_value.occurred_at), '[]'::jsonb)
  into result_value
  from (
    select m.id, m.customer_id, m.direction, m.message_type, m.content, m.status,
      m.provider_message_id, m.reply_to_message_id, m.failure_code,
      m.provider_acknowledged_at, m.occurred_at, m.sent_at, m.created_at
    from public.messages m
    where m.tenant_id = target_tenant_id
      and m.conversation_id = target_conversation_id
      and (before_value is null or m.occurred_at < before_value)
    order by m.occurred_at desc, m.id desc
    limit greatest(1,least(limit_value,100))
  ) rows_value;
  return result_value;
end;
$$;

alter table public.messaging_provider_connections enable row level security;
alter table public.messaging_contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.messaging_provider_updates enable row level security;
alter table public.message_delivery_attempts enable row level security;

create policy messaging_connections_select_ops on public.messaging_provider_connections
for select to authenticated using ((select private.has_tenant_role(
  tenant_id,array['super_admin','manager','support']::public.app_role[])));
create policy messaging_contacts_select_ops on public.messaging_contacts
for select to authenticated using ((select private.has_tenant_role(
  tenant_id,array['super_admin','manager','support']::public.app_role[])));
create policy conversations_select_ops on public.conversations
for select to authenticated using ((select private.has_tenant_role(
  tenant_id,array['super_admin','manager','support']::public.app_role[])));
create policy conversation_participants_select_ops on public.conversation_participants
for select to authenticated using ((select private.has_tenant_role(
  tenant_id,array['super_admin','manager','support']::public.app_role[])));
create policy messages_select_ops on public.messages
for select to authenticated using ((select private.has_tenant_role(
  tenant_id,array['super_admin','manager','support']::public.app_role[])));
create policy provider_updates_select_management on public.messaging_provider_updates
for select to authenticated using ((select private.has_tenant_role(
  tenant_id,array['super_admin','manager']::public.app_role[])));
create policy delivery_attempts_select_management on public.message_delivery_attempts
for select to authenticated using ((select private.has_tenant_role(
  tenant_id,array['super_admin','manager']::public.app_role[])));

revoke all on table public.messaging_provider_connections, public.messaging_contacts,
  public.conversations, public.conversation_participants, public.messages,
  public.messaging_provider_updates, public.message_delivery_attempts
  from public, anon, authenticated;
grant select on table public.messaging_provider_connections, public.messaging_contacts,
  public.conversations, public.conversation_participants, public.messages
  to authenticated;
grant select on table public.messaging_provider_updates, public.message_delivery_attempts
  to authenticated;

revoke all on function public.ingest_telegram_message(uuid,text,text,text,text,text,text,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_telegram_message(uuid,text,text,text,text,text,text,text,text,text,timestamptz)
  to service_role;
revoke all on function public.record_outbound_message_result(uuid,uuid,text,text,integer,text,integer)
  from public, anon, authenticated;
grant execute on function public.record_outbound_message_result(uuid,uuid,text,text,integer,text,integer)
  to service_role;

revoke all on function public.queue_outbound_message(uuid,uuid,text,text,uuid,uuid)
  from public, anon;
grant execute on function public.queue_outbound_message(uuid,uuid,text,text,uuid,uuid)
  to authenticated;
revoke all on function public.set_outbound_messaging_enabled(uuid,boolean,uuid)
  from public, anon;
grant execute on function public.set_outbound_messaging_enabled(uuid,boolean,uuid)
  to authenticated;
revoke all on function public.admin_conversation_list(uuid,text,uuid,integer,integer)
  from public, anon;
grant execute on function public.admin_conversation_list(uuid,text,uuid,integer,integer)
  to authenticated;
revoke all on function public.admin_conversation_messages(uuid,uuid,timestamptz,integer)
  from public, anon;
grant execute on function public.admin_conversation_messages(uuid,uuid,timestamptz,integer)
  to authenticated;

grant usage, select on sequence public.messaging_provider_updates_id_seq to service_role;
grant usage, select on sequence public.message_delivery_attempts_id_seq to service_role;
