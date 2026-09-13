-- Gold Revenue OS — initial PostgreSQL/Supabase schema draft
create extension if not exists pgcrypto;

create type app_role as enum ('super_admin','manager','support','analyst','readonly');
create type customer_state as enum (
  'NEW','CONTACT_READY','CONTACTED','REPLIED','QUALIFIED','OFFER_SENT',
  'INTERESTED','NOT_INTERESTED','SURVEY_OFFERED','SURVEY_COMPLETED',
  'TRIAL_ACTIVE','PAYMENT_PENDING','PAID','ACCESS_GRANTED','ACTIVE',
  'RENEWAL_DUE','RENEWED','EXPIRED','CHURNED','WINBACK'
);
create type payment_status as enum ('CREATED','PENDING','CONFIRMED','FAILED','EXPIRED','REFUNDED','REVIEW');
create type subscription_status as enum ('TRIAL','ACTIVE','RENEWAL_DUE','EXPIRED','CANCELLED','SUSPENDED');
create type access_status as enum ('PENDING','ACTIVE','REVOKED','FAILED');
create type escalation_severity as enum ('LOW','MEDIUM','HIGH','CRITICAL');
create type escalation_status as enum ('OPEN','ASSIGNED','WAITING','RESOLVED','CLOSED');
create type actor_type as enum ('SYSTEM','AGENT','HUMAN','WEBHOOK');

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table tenant_members (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  external_ref text,
  display_name text,
  state customer_state not null default 'NEW',
  segment text,
  risk_level text not null default 'normal',
  assigned_manager_id uuid references app_users(id),
  automation_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, external_ref)
);
create index idx_customers_tenant_state on customers(tenant_id, state);
create index idx_customers_updated on customers(tenant_id, updated_at desc);

create table customer_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  identity_type text not null,
  identity_value text not null,
  normalized_value text not null,
  is_primary boolean not null default false,
  source text,
  created_at timestamptz not null default now(),
  unique (tenant_id, identity_type, normalized_value)
);

create table customer_profiles (
  customer_id uuid primary key references customers(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  experience_level text,
  primary_instrument text,
  trading_style text,
  risk_preference text,
  preferred_signal_frequency text,
  communication_style text,
  preferred_message_length text,
  price_sensitivity text,
  trust_level text,
  previous_service_experience jsonb not null default '{}'::jsonb,
  pain_points jsonb not null default '[]'::jsonb,
  objections jsonb not null default '[]'::jsonb,
  churn_reason text,
  next_best_action text,
  updated_at timestamptz not null default now()
);

create table customer_memory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  memory_key text not null,
  memory_value jsonb not null,
  source_type text,
  source_id text,
  confidence numeric(5,4),
  observed_at timestamptz not null default now(),
  superseded_at timestamptz
);
create index idx_customer_memory_active
  on customer_memory(tenant_id, customer_id, memory_key)
  where superseded_at is null;

create table conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  channel text not null,
  external_thread_id text,
  status text not null default 'open',
  human_takeover boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  sender_type actor_type not null,
  sender_id text,
  external_message_id text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  prompt_version text,
  qa_scores jsonb,
  created_at timestamptz not null default now()
);
create unique index uq_messages_external
  on messages(tenant_id, external_message_id)
  where external_message_id is not null;

create table customer_state_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  from_state customer_state,
  to_state customer_state not null,
  reason_code text,
  actor_type actor_type not null,
  actor_id text,
  event_id uuid,
  created_at timestamptz not null default now()
);
create index idx_state_history_customer
  on customer_state_history(tenant_id, customer_id, created_at desc);

create table events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  event_type text not null,
  correlation_id uuid not null default gen_random_uuid(),
  payload jsonb not null default '{}'::jsonb,
  actor_type actor_type not null default 'SYSTEM',
  actor_id text,
  created_at timestamptz not null default now()
);
create index idx_events_type_created on events(event_type, created_at);
create index idx_events_customer on events(tenant_id, customer_id, created_at desc);

create table products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table prices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  amount numeric(18,6) not null check (amount >= 0),
  currency_or_asset text not null,
  billing_period_days int,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  product_id uuid not null references products(id),
  price_id uuid not null references prices(id),
  status text not null default 'created',
  expires_at timestamptz,
  created_by_type actor_type not null,
  created_by_id text,
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  offer_id uuid references offers(id),
  provider text not null,
  provider_payment_id text,
  invoice_id text not null,
  amount numeric(18,6) not null,
  asset text not null,
  network text,
  status payment_status not null default 'CREATED',
  tx_hash text,
  confirmations int,
  idempotency_key text not null,
  expires_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, invoice_id),
  unique (tenant_id, idempotency_key)
);
create index idx_payments_customer on payments(tenant_id, customer_id, created_at desc);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  product_id uuid not null references products(id),
  source_payment_id uuid references payments(id),
  status subscription_status not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  grace_ends_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_subscriptions_due on subscriptions(tenant_id, status, ends_at);

create table channel_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  subscription_id uuid references subscriptions(id),
  channel_provider text not null,
  channel_id text not null,
  status access_status not null default 'PENDING',
  granted_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  external_membership_id text,
  created_at timestamptz not null default now()
);

create table surveys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  version int not null default 1,
  schema jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table survey_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  survey_id uuid not null references surveys(id),
  customer_id uuid not null references customers(id) on delete cascade,
  answers jsonb not null,
  completed_at timestamptz not null default now()
);

create table customer_insights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  insight_type text not null,
  finding text not null,
  evidence jsonb not null default '[]'::jsonb,
  confidence numeric(5,4),
  recommended_action text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table agent_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  agent_name text not null,
  objective text not null,
  allowed_tools jsonb not null default '[]'::jsonb,
  context_version int,
  priority text not null default 'normal',
  status text not null default 'queued',
  correlation_id uuid not null default gen_random_uuid(),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  task_id uuid not null references agent_tasks(id) on delete cascade,
  agent_name text not null,
  model text,
  prompt_version text,
  input_summary jsonb,
  tool_calls jsonb,
  output_summary jsonb,
  qa_scores jsonb,
  token_usage jsonb,
  latency_ms int,
  outcome text,
  error_code text,
  created_at timestamptz not null default now()
);

create table escalations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  detected_message_id uuid references messages(id),
  severity escalation_severity not null,
  category text not null,
  status escalation_status not null default 'OPEN',
  summary text not null,
  evidence jsonb not null default '[]'::jsonb,
  suggested_resolution text,
  suggested_reply text,
  assigned_to uuid references app_users(id),
  first_response_at timestamptz,
  resolved_at timestamptz,
  resolution_code text,
  resolution_note text,
  created_at timestamptz not null default now()
);
create index idx_escalations_open
  on escalations(tenant_id, status, severity, created_at);

create table followups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  conversation_id uuid references conversations(id),
  kind text not null,
  status text not null default 'scheduled',
  scheduled_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  actor_type actor_type not null,
  actor_id text,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  ip_hash text,
  correlation_id uuid,
  created_at timestamptz not null default now()
);

-- Codex MUST:
-- 1) add proper Supabase RLS policies;
-- 2) add updated_at triggers;
-- 3) reconcile external message uniqueness with actual channel adapter design;
-- 4) make all tenant-scoped access explicit;
-- 5) convert this draft into production migrations, not run blindly.
