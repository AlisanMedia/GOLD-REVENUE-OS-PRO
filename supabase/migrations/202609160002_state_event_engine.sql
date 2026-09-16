-- Gold Revenue OS Phase 3: deterministic lifecycle and durable event engine.
-- PostgreSQL is the queue of record for this phase; no external queue is used.

create type public.lifecycle_actor_type as enum (
  'SYSTEM', 'HUMAN', 'AGENT', 'WEBHOOK', 'SCHEDULER'
);

create type public.event_authority as enum ('UNTRUSTED', 'TRUSTED');

alter table public.audit_logs
  add column correlation_id uuid;

-- Replace the Phase 2 convenience trigger. State changes are now accepted only
-- through public.transition_customer_state().
drop trigger if exists customers_state_history on public.customers;
drop function if exists private.customer_state_history_capture();

alter table public.customer_state_history
  alter column actor_type type public.lifecycle_actor_type
    using actor_type::text::public.lifecycle_actor_type,
  alter column actor_id type text using actor_id::text,
  add column correlation_id uuid,
  add column causation_id uuid,
  add column triggering_event text,
  add column triggering_event_id uuid,
  add column state_change_event_id uuid,
  add column occurred_at timestamptz;

update public.customer_state_history
set correlation_id = gen_random_uuid(),
    triggering_event = coalesce(reason_code, 'legacy.phase2_state_capture'),
    occurred_at = created_at
where correlation_id is null;

alter table public.customer_state_history
  alter column correlation_id set not null,
  alter column triggering_event set not null,
  alter column occurred_at set not null;

create table private.event_contracts (
  event_type text not null,
  version integer not null check (version > 0),
  required_payload_keys text[] not null default '{}'::text[],
  trusted_producer_required boolean not null default false,
  description text not null,
  primary key (event_type, version)
);

revoke all on table private.event_contracts from public, anon, authenticated;

insert into private.event_contracts (
  event_type, version, required_payload_keys, trusted_producer_required, description
) values
  ('customer.created', 1, array['source'], false, 'A Customer OS record was created.'),
  ('customer.updated', 1, array['changed_fields'], false, 'Customer attributes changed.'),
  ('customer.state_changed', 1, array['from_state','to_state','reason_code','triggering_event'], true, 'A guarded lifecycle transition committed.'),
  ('message.received', 1, array['conversation_id','message_id','channel'], false, 'Inbound message contract only.'),
  ('message.sent', 1, array['conversation_id','message_id','channel'], false, 'Outbound message contract only.'),
  ('qualification.completed', 1, array['qualification_id'], false, 'Qualification contract only.'),
  ('offer.created', 1, array['offer_id'], false, 'Offer contract only.'),
  ('offer.accepted', 1, array['offer_id'], false, 'Offer acceptance contract only.'),
  ('payment.intent_created', 1, array['payment_id','amount','asset','network'], true, 'Payment intent contract only.'),
  ('payment.confirmed', 1, array['payment_id','tx_hash'], true, 'Verified payment confirmation contract.'),
  ('payment.failed', 1, array['payment_id','reason'], true, 'Verified payment failure contract.'),
  ('subscription.started', 1, array['subscription_id','starts_at','ends_at'], true, 'Subscription start contract only.'),
  ('subscription.renewal_due', 1, array['subscription_id','ends_at'], true, 'Renewal scheduler contract only.'),
  ('subscription.renewed', 1, array['subscription_id','new_ends_at'], true, 'Subscription renewal contract only.'),
  ('subscription.expired', 1, array['subscription_id'], true, 'Subscription expiry contract only.'),
  ('access.granted', 1, array['channel_access_id','channel_id'], true, 'Access grant contract only.'),
  ('access.revoked', 1, array['channel_access_id','channel_id','reason'], true, 'Access revoke contract only.'),
  ('survey.completed', 1, array['survey_response_id'], false, 'Survey contract only.'),
  ('escalation.created', 1, array['escalation_id','category','severity'], false, 'Escalation creation contract only.'),
  ('escalation.resolved', 1, array['escalation_id','resolution'], false, 'Escalation resolution contract only.'),
  ('agent.task_created', 1, array['task_id','agent'], false, 'Agent task contract only.'),
  ('agent.task_completed', 1, array['task_id','outcome'], false, 'Agent task completion contract only.'),
  ('lifecycle.transition_rejected', 1, array['from_state','to_state','reason_code','rejection_code'], true, 'Observable rejected lifecycle request.');

create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid,
  event_type text not null,
  event_version integer not null default 1 check (event_version > 0),
  aggregate_type text not null default 'customer' check (char_length(aggregate_type) between 1 and 80),
  aggregate_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  actor_type public.lifecycle_actor_type not null,
  actor_id text,
  producer text not null check (char_length(producer) between 1 and 120),
  authority public.event_authority not null default 'UNTRUSTED',
  correlation_id uuid not null,
  causation_id uuid,
  idempotency_key text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, causation_id) references public.domain_events(tenant_id, id) on delete restrict,
  check (idempotency_key is null or char_length(idempotency_key) between 1 and 240)
);

create unique index domain_events_idempotency_idx
  on public.domain_events (tenant_id, producer, idempotency_key)
  where idempotency_key is not null;
create index domain_events_customer_time_idx
  on public.domain_events (tenant_id, customer_id, recorded_at desc, id desc);
create index domain_events_correlation_idx
  on public.domain_events (tenant_id, correlation_id, recorded_at, id);
create index domain_events_type_time_idx
  on public.domain_events (tenant_id, event_type, recorded_at desc);

create table public.event_outbox (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  event_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending','processing','completed','dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 32),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  last_error_message text,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, event_id),
  foreign key (tenant_id, event_id) references public.domain_events(tenant_id, id) on delete restrict
);

create index event_outbox_dispatch_idx
  on public.event_outbox (available_at, id)
  where status in ('pending','processing');
create index event_outbox_tenant_status_idx
  on public.event_outbox (tenant_id, status, updated_at desc, id desc);

create table public.event_inbox (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  event_id uuid not null,
  consumer_name text not null check (char_length(consumer_name) between 1 and 120),
  status text not null check (status in ('processing','completed','failed')),
  attempts integer not null default 1 check (attempts > 0),
  result_hash text,
  last_error_code text,
  first_seen_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, event_id, consumer_name),
  foreign key (tenant_id, event_id) references public.domain_events(tenant_id, id) on delete restrict
);

create index event_inbox_tenant_status_idx
  on public.event_inbox (tenant_id, status, last_attempt_at desc);

create table public.event_processing_attempts (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  event_id uuid not null,
  outbox_id bigint references public.event_outbox(id) on delete restrict,
  consumer_name text,
  worker_id text not null,
  attempt_number integer not null check (attempt_number > 0),
  result text not null check (result in ('claimed','completed','retry_scheduled','dead_lettered','consumer_started','consumer_duplicate','consumer_completed','consumer_failed')),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, event_id) references public.domain_events(tenant_id, id) on delete restrict
);

create index event_processing_attempts_event_idx
  on public.event_processing_attempts (tenant_id, event_id, created_at, id);

create table public.customer_state_transition_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid not null,
  expected_from_state public.customer_state not null,
  observed_from_state public.customer_state not null,
  to_state public.customer_state not null,
  reason_code text not null check (char_length(reason_code) between 1 and 120),
  actor_type public.lifecycle_actor_type not null,
  actor_id text,
  correlation_id uuid not null,
  causation_id uuid,
  triggering_event text not null check (char_length(triggering_event) between 1 and 160),
  triggering_event_id uuid,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 240),
  result text not null check (result in ('accepted','rejected')),
  rejection_code text,
  state_change_event_id uuid,
  state_history_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, triggering_event_id) references public.domain_events(tenant_id, id) on delete restrict,
  foreign key (tenant_id, state_change_event_id) references public.domain_events(tenant_id, id) on delete restrict
);

create index customer_transition_attempts_customer_idx
  on public.customer_state_transition_attempts (tenant_id, customer_id, created_at desc);
create index customer_transition_attempts_correlation_idx
  on public.customer_state_transition_attempts (tenant_id, correlation_id, created_at, id);

create table public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid,
  job_type text not null check (char_length(job_type) between 1 and 120),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'scheduled'
    check (status in ('scheduled','processing','completed','dead_letter','cancelled')),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 240),
  correlation_id uuid not null,
  causation_id uuid,
  scheduled_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 32),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, causation_id) references public.domain_events(tenant_id, id) on delete restrict
);

create index scheduled_jobs_claim_idx
  on public.scheduled_jobs (scheduled_at, id)
  where status in ('scheduled','processing');
create index scheduled_jobs_tenant_status_idx
  on public.scheduled_jobs (tenant_id, status, scheduled_at, id);

create table private.customer_state_transition_rules (
  from_state public.customer_state not null,
  to_state public.customer_state not null,
  required_event_type text,
  trusted_event_required boolean not null default false,
  primary key (from_state, to_state)
);

revoke all on table private.customer_state_transition_rules from public, anon, authenticated;

insert into private.customer_state_transition_rules (from_state, to_state, required_event_type, trusted_event_required) values
  ('NEW','CONTACT_READY',null,false),
  ('CONTACT_READY','CONTACTED',null,false),
  ('CONTACTED','REPLIED',null,false),
  ('REPLIED','QUALIFIED','qualification.completed',false),
  ('QUALIFIED','OFFER_SENT','offer.created',false),
  ('OFFER_SENT','INTERESTED','offer.accepted',false),
  ('OFFER_SENT','NOT_INTERESTED',null,false),
  ('INTERESTED','PAYMENT_PENDING','payment.intent_created',true),
  ('PAYMENT_PENDING','PAID','payment.confirmed',true),
  ('PAID','ACCESS_GRANTED','access.granted',true),
  ('ACCESS_GRANTED','ACTIVE','subscription.started',true),
  ('ACTIVE','RENEWAL_DUE','subscription.renewal_due',true),
  ('RENEWAL_DUE','RENEWED','subscription.renewed',true),
  ('RENEWED','ACTIVE','subscription.started',true),
  ('RENEWAL_DUE','EXPIRED','subscription.expired',true),
  ('EXPIRED','CHURNED',null,false),
  ('CHURNED','WINBACK',null,false),
  ('WINBACK','INTERESTED','offer.accepted',false),
  ('NOT_INTERESTED','SURVEY_OFFERED',null,false),
  ('SURVEY_OFFERED','SURVEY_COMPLETED','survey.completed',false),
  ('SURVEY_COMPLETED','TRIAL_ACTIVE',null,false),
  ('TRIAL_ACTIVE','INTERESTED','offer.accepted',false),
  ('TRIAL_ACTIVE','EXPIRED','subscription.expired',true);

create or replace function private.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

revoke all on function private.reject_append_only_mutation() from public, anon, authenticated;

create trigger domain_events_immutable
before update or delete on public.domain_events
for each row execute function private.reject_append_only_mutation();

create trigger event_processing_attempts_immutable
before update or delete on public.event_processing_attempts
for each row execute function private.reject_append_only_mutation();

create trigger customer_transition_attempts_immutable
before update or delete on public.customer_state_transition_attempts
for each row execute function private.reject_append_only_mutation();

create trigger event_outbox_set_updated_at
before update on public.event_outbox
for each row execute function private.set_updated_at();

create trigger scheduled_jobs_set_updated_at
before update on public.scheduled_jobs
for each row execute function private.set_updated_at();

create or replace function private.guard_customer_state_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.state is distinct from old.state
     and coalesce(current_setting('app.state_transition_context', true), '') <> 'guarded' then
    raise exception 'customer state can only change through transition_customer_state'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_customer_state_mutation() from public, anon, authenticated;

create trigger customers_guard_state_mutation
before update of state on public.customers
for each row execute function private.guard_customer_state_mutation();

create or replace function private.append_domain_event(
  target_tenant_id uuid,
  target_customer_id uuid,
  event_type_value text,
  event_version_value integer,
  payload_value jsonb,
  actor_type_value public.lifecycle_actor_type,
  actor_id_value text,
  producer_value text,
  authority_value public.event_authority,
  correlation_id_value uuid,
  causation_id_value uuid,
  idempotency_key_value text,
  occurred_at_value timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  contract_value record;
  existing_value public.domain_events%rowtype;
  event_id_value uuid;
begin
  select * into contract_value
  from private.event_contracts
  where event_type = event_type_value and version = event_version_value;

  if not found then
    raise exception 'unknown event contract %.v%', event_type_value, event_version_value
      using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(payload_value, '{}'::jsonb)) <> 'object' then
    raise exception 'event payload must be an object' using errcode = '22023';
  end if;
  if not coalesce(payload_value, '{}'::jsonb) ?& contract_value.required_payload_keys then
    raise exception 'event payload is missing required keys' using errcode = '22023';
  end if;
  if contract_value.trusted_producer_required and authority_value <> 'TRUSTED' then
    raise exception 'event requires a trusted deterministic producer' using errcode = '42501';
  end if;
  if target_customer_id is not null and not exists (
    select 1 from public.customers
    where tenant_id = target_tenant_id and id = target_customer_id
  ) then
    raise exception 'customer not found in tenant' using errcode = 'P0002';
  end if;
  if causation_id_value is not null and not exists (
    select 1 from public.domain_events
    where tenant_id = target_tenant_id and id = causation_id_value
  ) then
    raise exception 'causation event not found in tenant' using errcode = '22023';
  end if;

  if idempotency_key_value is not null then
    select * into existing_value
    from public.domain_events
    where tenant_id = target_tenant_id
      and producer = producer_value
      and idempotency_key = idempotency_key_value;
    if found then
      if existing_value.event_type <> event_type_value
         or existing_value.event_version <> event_version_value
         or existing_value.customer_id is distinct from target_customer_id
         or existing_value.correlation_id <> correlation_id_value
         or existing_value.causation_id is distinct from causation_id_value
         or existing_value.payload <> coalesce(payload_value, '{}'::jsonb) then
        raise exception 'idempotency key reused with a different event envelope'
          using errcode = '23505';
      end if;
      return existing_value.id;
    end if;
  end if;

  begin
    insert into public.domain_events (
      tenant_id, customer_id, event_type, event_version, aggregate_type,
      aggregate_id, payload, actor_type, actor_id, producer, authority,
      correlation_id, causation_id, idempotency_key, occurred_at
    ) values (
      target_tenant_id, target_customer_id, event_type_value, event_version_value,
      'customer', target_customer_id, coalesce(payload_value, '{}'::jsonb),
      actor_type_value, actor_id_value, producer_value, authority_value,
      correlation_id_value, causation_id_value, idempotency_key_value,
      coalesce(occurred_at_value, now())
    ) returning id into event_id_value;
  exception when unique_violation then
    select * into strict existing_value
    from public.domain_events
    where tenant_id = target_tenant_id
      and producer = producer_value
      and idempotency_key = idempotency_key_value;
    if existing_value.event_type <> event_type_value
       or existing_value.event_version <> event_version_value
       or existing_value.customer_id is distinct from target_customer_id
       or existing_value.correlation_id <> correlation_id_value
       or existing_value.causation_id is distinct from causation_id_value
       or existing_value.payload <> coalesce(payload_value, '{}'::jsonb) then
      raise exception 'idempotency key reused with a different event envelope'
        using errcode = '23505';
    end if;
    return existing_value.id;
  end;

  insert into public.event_outbox (tenant_id, event_id)
  values (target_tenant_id, event_id_value);
  return event_id_value;
end;
$$;

revoke all on function private.append_domain_event(uuid, uuid, text, integer, jsonb, public.lifecycle_actor_type, text, text, public.event_authority, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;

create or replace function private.capture_customer_created_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  correlation_value uuid := gen_random_uuid();
  event_value uuid;
begin
  if new.state <> 'NEW' then
    raise exception 'new customers must start in NEW state' using errcode = '22023';
  end if;
  event_value := private.append_domain_event(
    new.tenant_id, new.id, 'customer.created', 1,
    jsonb_build_object('source', coalesce(new.source_name, new.source_type, 'customer_os')),
    case when auth.uid() is null then 'SYSTEM'::public.lifecycle_actor_type else 'HUMAN'::public.lifecycle_actor_type end,
    auth.uid()::text, 'customer-os', 'TRUSTED', correlation_value, null,
    'customer-created:' || new.id::text, new.created_at
  );
  insert into public.customer_state_history (
    tenant_id, customer_id, from_state, to_state, reason_code, actor_type,
    actor_id, event_id, correlation_id, causation_id, triggering_event,
    triggering_event_id, state_change_event_id, occurred_at, created_at
  ) values (
    new.tenant_id, new.id, null, 'NEW', 'customer_created',
    case when auth.uid() is null then 'SYSTEM'::public.lifecycle_actor_type else 'HUMAN'::public.lifecycle_actor_type end,
    auth.uid()::text, event_value, correlation_value, null, 'customer.created',
    event_value, event_value, new.created_at, now()
  );
  return new;
end;
$$;

revoke all on function private.capture_customer_created_event() from public, anon, authenticated;

create trigger customers_capture_created_event
after insert on public.customers
for each row execute function private.capture_customer_created_event();

alter table public.customer_state_history
  add constraint customer_state_history_event_fk
    foreign key (tenant_id, event_id) references public.domain_events(tenant_id, id) on delete restrict,
  add constraint customer_state_history_triggering_event_fk
    foreign key (tenant_id, triggering_event_id) references public.domain_events(tenant_id, id) on delete restrict,
  add constraint customer_state_history_state_change_event_fk
    foreign key (tenant_id, state_change_event_id) references public.domain_events(tenant_id, id) on delete restrict;

create or replace function private.transition_result(attempt_value public.customer_state_transition_attempts)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'attempt_id', attempt_value.id,
    'accepted', attempt_value.result = 'accepted',
    'result', attempt_value.result,
    'rejection_code', attempt_value.rejection_code,
    'customer_id', attempt_value.customer_id,
    'from_state', attempt_value.observed_from_state,
    'to_state', attempt_value.to_state,
    'correlation_id', attempt_value.correlation_id,
    'event_id', attempt_value.state_change_event_id,
    'history_id', attempt_value.state_history_id
  );
$$;

revoke all on function private.transition_result(public.customer_state_transition_attempts) from public, anon, authenticated;

create or replace function public.transition_customer_state(
  target_tenant_id uuid,
  target_customer_id uuid,
  expected_from_state public.customer_state,
  target_to_state public.customer_state,
  reason_code_value text,
  actor_type_value public.lifecycle_actor_type,
  actor_id_value text,
  correlation_id_value uuid,
  causation_id_value uuid,
  triggering_event_value text,
  triggering_event_id_value uuid,
  idempotency_key_value text,
  occurred_at_value timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  current_state_value public.customer_state;
  rule_value record;
  trigger_event_value public.domain_events%rowtype;
  attempt_value public.customer_state_transition_attempts%rowtype;
  state_event_id_value uuid;
  history_id_value uuid;
  rejection_code_value text;
  payload_value jsonb;
begin
  if auth.uid() is not null then
    if not private.has_tenant_role(target_tenant_id, array['super_admin','manager']::public.app_role[]) then
      raise exception 'not authorized for lifecycle transition' using errcode = '42501';
    end if;
    if actor_type_value <> 'HUMAN' or actor_id_value is distinct from auth.uid()::text then
      raise exception 'authenticated lifecycle actor must match the current user' using errcode = '42501';
    end if;
  end if;
  if nullif(btrim(reason_code_value), '') is null
     or nullif(btrim(triggering_event_value), '') is null
     or nullif(btrim(idempotency_key_value), '') is null
     or correlation_id_value is null then
    raise exception 'transition metadata is incomplete' using errcode = '22023';
  end if;
  if actor_type_value in ('HUMAN','AGENT','WEBHOOK') and nullif(btrim(actor_id_value), '') is null then
    raise exception 'actor_id is required for this actor type' using errcode = '22023';
  end if;

  select * into attempt_value
  from public.customer_state_transition_attempts
  where tenant_id = target_tenant_id and idempotency_key = idempotency_key_value;
  if found then
    return private.transition_result(attempt_value);
  end if;

  select state into current_state_value
  from public.customers
  where tenant_id = target_tenant_id and id = target_customer_id
  for update;
  if not found then
    insert into public.audit_logs (
      tenant_id, actor_type, actor_id, action, entity_type, entity_id,
      after_data, correlation_id
    ) values (
      target_tenant_id,
      case when auth.uid() is null then 'SYSTEM'::public.audit_actor_type else 'HUMAN'::public.audit_actor_type end,
      auth.uid(), 'customer.state_transition_rejected', 'customers', target_customer_id::text,
      jsonb_build_object('rejection_code','customer_not_found'), correlation_id_value
    );
    return jsonb_build_object('accepted', false, 'result', 'rejected', 'rejection_code', 'customer_not_found', 'correlation_id', correlation_id_value);
  end if;

  if current_state_value <> expected_from_state then
    rejection_code_value := 'stale_state';
  else
    select * into rule_value
    from private.customer_state_transition_rules
    where from_state = current_state_value and to_state = target_to_state;
    if not found then
      rejection_code_value := 'invalid_transition';
    elsif rule_value.required_event_type is not null
          and rule_value.required_event_type <> triggering_event_value then
      rejection_code_value := 'required_event_mismatch';
    elsif rule_value.trusted_event_required then
      if triggering_event_id_value is null then
        rejection_code_value := 'trusted_event_required';
      else
        select * into trigger_event_value
        from public.domain_events
        where tenant_id = target_tenant_id and id = triggering_event_id_value;
        if not found
           or trigger_event_value.customer_id is distinct from target_customer_id
           or trigger_event_value.event_type <> triggering_event_value
           or trigger_event_value.authority <> 'TRUSTED' then
          rejection_code_value := 'trusted_event_required';
        end if;
      end if;
    end if;
  end if;

  if rejection_code_value is not null then
    state_event_id_value := private.append_domain_event(
      target_tenant_id, target_customer_id, 'lifecycle.transition_rejected', 1,
      jsonb_build_object(
        'from_state', current_state_value,
        'to_state', target_to_state,
        'reason_code', reason_code_value,
        'rejection_code', rejection_code_value,
        'triggering_event', triggering_event_value
      ), actor_type_value, actor_id_value, 'lifecycle-service', 'TRUSTED',
      correlation_id_value, causation_id_value,
      'transition-rejected:' || idempotency_key_value, coalesce(occurred_at_value, now())
    );
    insert into public.customer_state_transition_attempts (
      tenant_id, customer_id, expected_from_state, observed_from_state, to_state,
      reason_code, actor_type, actor_id, correlation_id, causation_id,
      triggering_event, triggering_event_id, idempotency_key, result,
      rejection_code, state_change_event_id
    ) values (
      target_tenant_id, target_customer_id, expected_from_state, current_state_value,
      target_to_state, left(reason_code_value,120), actor_type_value,
      actor_id_value, correlation_id_value, causation_id_value,
      left(triggering_event_value,160), triggering_event_id_value,
      left(idempotency_key_value,240), 'rejected', rejection_code_value,
      state_event_id_value
    ) returning * into attempt_value;
    insert into public.audit_logs (
      tenant_id, actor_type, actor_id, action, entity_type, entity_id,
      before_data, after_data, correlation_id
    ) values (
      target_tenant_id,
      case when auth.uid() is null then 'SYSTEM'::public.audit_actor_type else 'HUMAN'::public.audit_actor_type end,
      auth.uid(), 'customer.state_transition_rejected', 'customers', target_customer_id::text,
      jsonb_build_object('state', current_state_value),
      jsonb_build_object('requested_state', target_to_state, 'rejection_code', rejection_code_value, 'reported_actor_type', actor_type_value),
      correlation_id_value
    );
    return private.transition_result(attempt_value);
  end if;

  payload_value := jsonb_build_object(
    'from_state', current_state_value,
    'to_state', target_to_state,
    'reason_code', reason_code_value,
    'triggering_event', triggering_event_value,
    'triggering_event_id', triggering_event_id_value
  );
  state_event_id_value := private.append_domain_event(
    target_tenant_id, target_customer_id, 'customer.state_changed', 1,
    payload_value, actor_type_value, actor_id_value, 'lifecycle-service',
    'TRUSTED', correlation_id_value, causation_id_value,
    'transition:' || idempotency_key_value, coalesce(occurred_at_value, now())
  );

  perform set_config('app.state_transition_context', 'guarded', true);
  update public.customers
  set state = target_to_state
  where tenant_id = target_tenant_id and id = target_customer_id;

  insert into public.customer_state_history (
    tenant_id, customer_id, from_state, to_state, reason_code, actor_type,
    actor_id, event_id, correlation_id, causation_id, triggering_event,
    triggering_event_id, state_change_event_id, occurred_at
  ) values (
    target_tenant_id, target_customer_id, current_state_value, target_to_state,
    left(reason_code_value,120), actor_type_value, actor_id_value,
    state_event_id_value, correlation_id_value, causation_id_value,
    left(triggering_event_value,160), triggering_event_id_value,
    state_event_id_value, coalesce(occurred_at_value, now())
  ) returning id into history_id_value;

  insert into public.customer_state_transition_attempts (
    tenant_id, customer_id, expected_from_state, observed_from_state, to_state,
    reason_code, actor_type, actor_id, correlation_id, causation_id,
    triggering_event, triggering_event_id, idempotency_key, result,
    state_change_event_id, state_history_id
  ) values (
    target_tenant_id, target_customer_id, expected_from_state, current_state_value,
    target_to_state, left(reason_code_value,120), actor_type_value, actor_id_value,
    correlation_id_value, causation_id_value, left(triggering_event_value,160),
    triggering_event_id_value, left(idempotency_key_value,240), 'accepted',
    state_event_id_value, history_id_value
  ) returning * into attempt_value;

  insert into public.audit_logs (
    tenant_id, actor_type, actor_id, action, entity_type, entity_id,
    before_data, after_data, correlation_id
  ) values (
    target_tenant_id,
    case when auth.uid() is null then 'SYSTEM'::public.audit_actor_type else 'HUMAN'::public.audit_actor_type end,
    auth.uid(), 'customer.state_transition', 'customers', target_customer_id::text,
    jsonb_build_object('state', current_state_value),
    jsonb_build_object('state', target_to_state, 'reason_code', reason_code_value, 'reported_actor_type', actor_type_value, 'event_id', state_event_id_value),
    correlation_id_value
  );
  return private.transition_result(attempt_value);
exception when unique_violation then
  select * into attempt_value
  from public.customer_state_transition_attempts
  where tenant_id = target_tenant_id and idempotency_key = idempotency_key_value;
  if found then return private.transition_result(attempt_value); end if;
  raise;
end;
$$;

revoke all on function public.transition_customer_state(uuid, uuid, public.customer_state, public.customer_state, text, public.lifecycle_actor_type, text, uuid, uuid, text, uuid, text, timestamptz)
  from public, anon;
grant execute on function public.transition_customer_state(uuid, uuid, public.customer_state, public.customer_state, text, public.lifecycle_actor_type, text, uuid, uuid, text, uuid, text, timestamptz)
  to authenticated, service_role;

create or replace function public.append_domain_event(
  target_tenant_id uuid,
  target_customer_id uuid,
  event_type_value text,
  event_version_value integer,
  payload_value jsonb,
  actor_type_value public.lifecycle_actor_type,
  actor_id_value text,
  producer_value text,
  authority_value public.event_authority,
  correlation_id_value uuid,
  causation_id_value uuid,
  idempotency_key_value text,
  occurred_at_value timestamptz
)
returns uuid
language sql
security definer
set search_path = pg_catalog
as $$
  select private.append_domain_event(
    target_tenant_id, target_customer_id, event_type_value, event_version_value,
    payload_value, actor_type_value, actor_id_value, producer_value,
    authority_value, correlation_id_value, causation_id_value,
    idempotency_key_value, occurred_at_value
  );
$$;

revoke all on function public.append_domain_event(uuid, uuid, text, integer, jsonb, public.lifecycle_actor_type, text, text, public.event_authority, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.append_domain_event(uuid, uuid, text, integer, jsonb, public.lifecycle_actor_type, text, text, public.event_authority, uuid, uuid, text, timestamptz)
  to service_role;

create or replace function public.claim_event_outbox(
  worker_id_value text,
  batch_size_value integer default 25,
  lease_seconds_value integer default 60
)
returns table (
  outbox_id bigint,
  tenant_id uuid,
  event_id uuid,
  event_type text,
  event_version integer,
  customer_id uuid,
  payload jsonb,
  actor_type public.lifecycle_actor_type,
  actor_id text,
  authority public.event_authority,
  correlation_id uuid,
  causation_id uuid,
  occurred_at timestamptz,
  attempt_number integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if nullif(btrim(worker_id_value), '') is null then
    raise exception 'worker_id is required' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select eo.id
    from public.event_outbox eo
    where (
      eo.status = 'pending' and eo.available_at <= now()
    ) or (
      eo.status = 'processing'
      and eo.locked_at < now() - make_interval(secs => greatest(10, least(lease_seconds_value, 3600)))
    )
    order by eo.available_at, eo.id
    for update skip locked
    limit greatest(1, least(batch_size_value, 100))
  ), claimed as (
    update public.event_outbox eo
    set status = 'processing', attempts = eo.attempts + 1,
        locked_at = now(), locked_by = left(worker_id_value,120)
    from candidates c
    where eo.id = c.id
    returning eo.*
  ), logged as (
    insert into public.event_processing_attempts (
      tenant_id, event_id, outbox_id, worker_id, attempt_number, result
    )
    select c.tenant_id, c.event_id, c.id, left(worker_id_value,120), c.attempts, 'claimed'
    from claimed c
    returning id
  )
  select c.id, c.tenant_id, e.id, e.event_type, e.event_version,
         e.customer_id, e.payload, e.actor_type, e.actor_id, e.authority,
         e.correlation_id, e.causation_id, e.occurred_at, c.attempts
  from claimed c
  join public.domain_events e on e.tenant_id = c.tenant_id and e.id = c.event_id;
end;
$$;

revoke all on function public.claim_event_outbox(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_event_outbox(text, integer, integer) to service_role;

create or replace function public.begin_event_consumption(
  target_tenant_id uuid,
  target_event_id uuid,
  consumer_name_value text,
  worker_id_value text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  inbox_value public.event_inbox%rowtype;
begin
  insert into public.event_inbox (
    tenant_id, event_id, consumer_name, status
  ) values (
    target_tenant_id, target_event_id, left(consumer_name_value,120), 'processing'
  )
  on conflict (tenant_id, event_id, consumer_name) do update
    set status = 'processing', attempts = public.event_inbox.attempts + 1,
        last_attempt_at = now(), last_error_code = null
    where public.event_inbox.status <> 'completed'
  returning * into inbox_value;

  if not found then
    insert into public.event_processing_attempts (
      tenant_id, event_id, consumer_name, worker_id, attempt_number, result
    )
    select target_tenant_id, target_event_id, left(consumer_name_value,120),
           left(worker_id_value,120), attempts, 'consumer_duplicate'
    from public.event_inbox
    where tenant_id = target_tenant_id and event_id = target_event_id
      and consumer_name = left(consumer_name_value,120);
    return false;
  end if;

  insert into public.event_processing_attempts (
    tenant_id, event_id, consumer_name, worker_id, attempt_number, result
  ) values (
    target_tenant_id, target_event_id, left(consumer_name_value,120),
    left(worker_id_value,120), inbox_value.attempts, 'consumer_started'
  );
  return true;
end;
$$;

create or replace function public.complete_event_consumption(
  target_tenant_id uuid,
  target_event_id uuid,
  consumer_name_value text,
  worker_id_value text,
  result_hash_value text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  attempt_value integer;
begin
  update public.event_inbox
  set status = 'completed', result_hash = left(result_hash_value,128),
      completed_at = now(), last_attempt_at = now(), last_error_code = null
  where tenant_id = target_tenant_id and event_id = target_event_id
    and consumer_name = left(consumer_name_value,120)
    and status <> 'completed'
  returning attempts into attempt_value;
  if not found then return false; end if;
  insert into public.event_processing_attempts (
    tenant_id, event_id, consumer_name, worker_id, attempt_number, result
  ) values (
    target_tenant_id, target_event_id, left(consumer_name_value,120),
    left(worker_id_value,120), attempt_value, 'consumer_completed'
  );
  return true;
end;
$$;

create or replace function public.fail_event_consumption(
  target_tenant_id uuid,
  target_event_id uuid,
  consumer_name_value text,
  worker_id_value text,
  error_code_value text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  attempt_value integer;
begin
  update public.event_inbox
  set status = 'failed', last_error_code = left(error_code_value,120),
      last_attempt_at = now()
  where tenant_id = target_tenant_id and event_id = target_event_id
    and consumer_name = left(consumer_name_value,120)
    and status <> 'completed'
  returning attempts into attempt_value;
  if not found then return false; end if;
  insert into public.event_processing_attempts (
    tenant_id, event_id, consumer_name, worker_id, attempt_number, result, error_code
  ) values (
    target_tenant_id, target_event_id, left(consumer_name_value,120),
    left(worker_id_value,120), attempt_value, 'consumer_failed', left(error_code_value,120)
  );
  return true;
end;
$$;

create or replace function public.complete_event_outbox(
  outbox_id_value bigint,
  worker_id_value text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  outbox_value public.event_outbox%rowtype;
begin
  update public.event_outbox
  set status = 'completed', completed_at = now(), locked_at = null,
      locked_by = null, last_error_code = null, last_error_message = null
  where id = outbox_id_value and status = 'processing'
    and locked_by = left(worker_id_value,120)
  returning * into outbox_value;
  if not found then return false; end if;
  insert into public.event_processing_attempts (
    tenant_id, event_id, outbox_id, worker_id, attempt_number, result
  ) values (
    outbox_value.tenant_id, outbox_value.event_id, outbox_value.id,
    left(worker_id_value,120), outbox_value.attempts, 'completed'
  );
  return true;
end;
$$;

create or replace function public.fail_event_outbox(
  outbox_id_value bigint,
  worker_id_value text,
  error_code_value text,
  error_message_value text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  outbox_value public.event_outbox%rowtype;
  next_status text;
begin
  select * into outbox_value from public.event_outbox
  where id = outbox_id_value and status = 'processing'
    and locked_by = left(worker_id_value,120)
  for update;
  if not found then return 'not_claimed'; end if;
  next_status := case when outbox_value.attempts >= outbox_value.max_attempts
    then 'dead_letter' else 'pending' end;
  update public.event_outbox
  set status = next_status,
      available_at = case when next_status = 'pending'
        then now() + make_interval(secs => least(3600, (power(2, least(attempts,10)))::integer))
        else available_at end,
      dead_lettered_at = case when next_status = 'dead_letter' then now() else null end,
      locked_at = null, locked_by = null,
      last_error_code = left(error_code_value,120),
      last_error_message = left(error_message_value,500)
  where id = outbox_id_value;
  insert into public.event_processing_attempts (
    tenant_id, event_id, outbox_id, worker_id, attempt_number, result,
    error_code, error_message
  ) values (
    outbox_value.tenant_id, outbox_value.event_id, outbox_value.id,
    left(worker_id_value,120), outbox_value.attempts,
    case when next_status = 'dead_letter' then 'dead_lettered' else 'retry_scheduled' end,
    left(error_code_value,120), left(error_message_value,500)
  );
  return next_status;
end;
$$;

create or replace function public.enqueue_scheduled_job(
  target_tenant_id uuid,
  target_customer_id uuid,
  job_type_value text,
  payload_value jsonb,
  idempotency_key_value text,
  correlation_id_value uuid,
  causation_id_value uuid,
  scheduled_at_value timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  job_id_value uuid;
begin
  insert into public.scheduled_jobs (
    tenant_id, customer_id, job_type, payload, idempotency_key,
    correlation_id, causation_id, scheduled_at
  ) values (
    target_tenant_id, target_customer_id, left(job_type_value,120),
    coalesce(payload_value,'{}'::jsonb), left(idempotency_key_value,240),
    correlation_id_value, causation_id_value, scheduled_at_value
  )
  on conflict (tenant_id, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id into job_id_value;
  return job_id_value;
end;
$$;

create or replace function public.claim_scheduled_jobs(
  worker_id_value text,
  batch_size_value integer default 25,
  lease_seconds_value integer default 60
)
returns setof public.scheduled_jobs
language sql
security definer
set search_path = pg_catalog
as $$
  with candidates as (
    select sj.id
    from public.scheduled_jobs sj
    where (
      sj.status = 'scheduled' and sj.scheduled_at <= now()
    ) or (
      sj.status = 'processing'
      and sj.locked_at < now() - make_interval(secs => greatest(10, least(lease_seconds_value,3600)))
    )
    order by sj.scheduled_at, sj.id
    for update skip locked
    limit greatest(1, least(batch_size_value,100))
  )
  update public.scheduled_jobs sj
  set status = 'processing', attempts = sj.attempts + 1,
      locked_at = now(), locked_by = left(worker_id_value,120)
  from candidates c
  where sj.id = c.id
  returning sj.*;
$$;

create or replace function public.complete_scheduled_job(
  job_id_value uuid,
  worker_id_value text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update public.scheduled_jobs
  set status = 'completed', completed_at = now(), locked_at = null,
      locked_by = null, last_error_code = null
  where id = job_id_value and status = 'processing'
    and locked_by = left(worker_id_value,120);
  return found;
end;
$$;

create or replace function public.fail_scheduled_job(
  job_id_value uuid,
  worker_id_value text,
  error_code_value text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  job_value public.scheduled_jobs%rowtype;
  next_status text;
begin
  select * into job_value from public.scheduled_jobs
  where id = job_id_value and status = 'processing'
    and locked_by = left(worker_id_value,120)
  for update;
  if not found then return 'not_claimed'; end if;
  next_status := case when job_value.attempts >= job_value.max_attempts
    then 'dead_letter' else 'scheduled' end;
  update public.scheduled_jobs
  set status = next_status,
      scheduled_at = case when next_status = 'scheduled'
        then now() + make_interval(secs => least(3600, (power(2, least(attempts,10)))::integer))
        else scheduled_at end,
      dead_lettered_at = case when next_status = 'dead_letter' then now() else null end,
      locked_at = null, locked_by = null,
      last_error_code = left(error_code_value,120)
  where id = job_id_value;
  return next_status;
end;
$$;

revoke all on function public.begin_event_consumption(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_event_consumption(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.fail_event_consumption(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_event_outbox(bigint, text) from public, anon, authenticated;
revoke all on function public.fail_event_outbox(bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.enqueue_scheduled_job(uuid, uuid, text, jsonb, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_scheduled_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_scheduled_job(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_scheduled_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.begin_event_consumption(uuid, uuid, text, text) to service_role;
grant execute on function public.complete_event_consumption(uuid, uuid, text, text, text) to service_role;
grant execute on function public.fail_event_consumption(uuid, uuid, text, text, text) to service_role;
grant execute on function public.complete_event_outbox(bigint, text) to service_role;
grant execute on function public.fail_event_outbox(bigint, text, text, text) to service_role;
grant execute on function public.enqueue_scheduled_job(uuid, uuid, text, jsonb, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.claim_scheduled_jobs(text, integer, integer) to service_role;
grant execute on function public.complete_scheduled_job(uuid, text) to service_role;
grant execute on function public.fail_scheduled_job(uuid, text, text) to service_role;

alter table public.domain_events enable row level security;
alter table public.event_outbox enable row level security;
alter table public.event_inbox enable row level security;
alter table public.event_processing_attempts enable row level security;
alter table public.customer_state_transition_attempts enable row level security;
alter table public.scheduled_jobs enable row level security;

create policy domain_events_select_management
on public.domain_events for select to authenticated
using ((select private.has_tenant_role(tenant_id, array['super_admin','manager']::public.app_role[])));

create policy event_outbox_select_management
on public.event_outbox for select to authenticated
using ((select private.has_tenant_role(tenant_id, array['super_admin','manager']::public.app_role[])));

create policy event_inbox_select_management
on public.event_inbox for select to authenticated
using ((select private.has_tenant_role(tenant_id, array['super_admin','manager']::public.app_role[])));

create policy event_processing_attempts_select_management
on public.event_processing_attempts for select to authenticated
using ((select private.has_tenant_role(tenant_id, array['super_admin','manager']::public.app_role[])));

create policy customer_transition_attempts_select_management
on public.customer_state_transition_attempts for select to authenticated
using ((select private.has_tenant_role(tenant_id, array['super_admin','manager']::public.app_role[])));

create policy scheduled_jobs_select_management
on public.scheduled_jobs for select to authenticated
using ((select private.has_tenant_role(tenant_id, array['super_admin','manager']::public.app_role[])));

revoke all on table public.domain_events, public.event_outbox, public.event_inbox,
  public.event_processing_attempts, public.customer_state_transition_attempts,
  public.scheduled_jobs from anon, authenticated;

grant select on table public.domain_events, public.event_outbox, public.event_inbox,
  public.event_processing_attempts, public.customer_state_transition_attempts,
  public.scheduled_jobs to authenticated;

grant usage, select on sequence public.event_outbox_id_seq to service_role;
grant usage, select on sequence public.event_inbox_id_seq to service_role;
grant usage, select on sequence public.event_processing_attempts_id_seq to service_role;
