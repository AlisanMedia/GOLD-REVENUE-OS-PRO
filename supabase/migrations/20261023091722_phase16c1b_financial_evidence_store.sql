-- Phase16C-1B: SYNTHETIC evidence only. No receipt/event/fulfillment writer.
-- No seeds, runtime writer grants, workers, or hosted activation.
create function private.fse_hash(v text) returns text language sql immutable strict
set search_path=pg_catalog as $$select encode(extensions.digest(convert_to(v,'UTF8'),'sha256'),'hex')$$;

create function private.fse_canonical(v jsonb) returns text language plpgsql immutable strict
set search_path=pg_catalog as $$
declare result_value text;
begin
 if jsonb_typeof(v)='object' then
  select '{'||coalesce(string_agg(to_jsonb(k)::text||':'||private.fse_canonical(x),',' order by k collate "C"),'')||'}'
   into result_value from jsonb_each(v) e(k,x);return result_value;
 elsif jsonb_typeof(v)='array' then
  select '['||coalesce(string_agg(private.fse_canonical(x),',' order by n),'')||']'
   into result_value from jsonb_array_elements(v) with ordinality e(x,n);return result_value;
 else return v::text;end if;
end;$$;

create function private.fse_money_valid(v jsonb) returns boolean language plpgsql immutable
set search_path=pg_catalog as $$
begin
 if v='null'::jsonb then return true;end if;
 if not private.fse_keys(v,array['units','asset']) or not private.fse_asset_valid(v->'asset') then return false;end if;
 perform private.fse_units(v->'units');return v->>'units' is not null;
end;$$;

create function private.fse_tuple(domain_name text,parts jsonb) returns text language sql immutable strict
set search_path=pg_catalog as $$select private.fse_canonical(jsonb_build_array('FS1',domain_name)||parts)$$;

create function private.fse_storage_hash(parts jsonb) returns text language plpgsql immutable strict
set search_path=pg_catalog as $$
declare s text:='FSESTORE1;';x jsonb;v text;
begin
 if jsonb_typeof(parts)<>'array' then raise exception 'FSE_INVALID' using errcode='22023';end if;
 for x in select value from jsonb_array_elements(parts) loop
  if x='null'::jsonb then s:=s||'N;';
  elsif jsonb_typeof(x)='string' then v:=x#>>'{}';s:=s||'S'||octet_length(v)::text||':'||v||';';
  else raise exception 'FSE_INVALID' using errcode='22023';end if;
  if octet_length(s)>65536 then raise exception 'FSE_INVALID' using errcode='22023';end if;
 end loop;return private.fse_hash(s);
end;$$;

create function private.fse_keys(v jsonb,keys_value text[]) returns boolean language plpgsql immutable
set search_path=pg_catalog as $$begin
 if v is null or jsonb_typeof(v)<>'object' then return false;end if;
 return (select count(*)=cardinality(keys_value) and coalesce(bool_and(k=any(keys_value)),true) from jsonb_object_keys(v) k);
end;$$;

create function private.fse_strict_json(raw_value text) returns jsonb language plpgsql immutable
set search_path=pg_catalog as $$
declare d jsonb;n bigint;max_depth int;
begin
 if raw_value is null or octet_length(raw_value)>65536 or not(raw_value is json object with unique keys) then
  raise exception 'FSE_INVALID' using errcode='22023';end if;
 d:=raw_value::jsonb;
 with recursive tree(v,depth) as (
  select d,0 union all
  select child.v,t.depth+1 from tree t cross join lateral (
   select value v from jsonb_each(case when jsonb_typeof(t.v)='object' then t.v else '{}'::jsonb end)
   union all select value from jsonb_array_elements(case when jsonb_typeof(t.v)='array' then t.v else '[]'::jsonb end)
  ) child where t.depth<17
 ) select count(*),max(depth) into n,max_depth from tree;
 if n>4096 or max_depth>16 then raise exception 'FSE_INVALID' using errcode='22023';end if;
 return d;
exception when invalid_text_representation then raise exception 'FSE_INVALID' using errcode='22023';
end;$$;

create function private.fse_units(v jsonb) returns numeric language plpgsql immutable
set search_path=pg_catalog as $$
declare s text;
begin
 if v is null or v='null'::jsonb then return null;end if;
 s:=v#>>'{}';
 if jsonb_typeof(v)<>'string' or s!~'^(0|[1-9][0-9]{0,29})$' then raise exception 'FSE_INVALID' using errcode='22023';end if;
 return s::numeric;
end;$$;

create function private.fse_strings(v jsonb,required_value text[],nullable_value text[] default '{}') returns boolean language plpgsql immutable
set search_path=pg_catalog as $$declare k text;begin
 foreach k in array required_value loop if jsonb_typeof(v->k) is distinct from 'string' then return false;end if;end loop;
 foreach k in array nullable_value loop if v->k is distinct from 'null'::jsonb and jsonb_typeof(v->k) is distinct from 'string' then return false;end if;end loop;
 return true;
end;$$;

create function private.fse_reference(v text) returns boolean language plpgsql immutable
set search_path=pg_catalog as $$
declare n int:=0;i int;c int;
begin
 if v is null or length(v)=0 or octet_length(v)>800 then return false;end if;
 for i in 1..length(v) loop
  c:=ascii(substr(v,i,1));if c<32 or c=127 or c between 55296 and 57343 then return false;end if;
  n:=n+case when c>65535 then 2 else 1 end;
 end loop;return n<=200;
end;$$;

create function private.fse_asset_valid(v jsonb) returns boolean language plpgsql immutable
set search_path=pg_catalog as $$
begin
 if not private.fse_keys(v,array['kind','code','network','contract','decimals']) then return false;end if;
 return coalesce(private.fse_strings(v,array['kind','code'],array['network','contract']) and jsonb_typeof(v->'decimals')='number'
  and v->>'kind' in ('FIAT','IN_APP','NATIVE','TOKEN') and private.fse_reference(v->>'code')
  and (v->>'decimals')~'^(0|[1-9]|1[0-8])$'
  and (v->'network'='null'::jsonb or private.fse_reference(v->>'network'))
  and (v->'contract'='null'::jsonb or private.fse_reference(v->>'contract'))
  and case v->>'kind' when 'FIAT' then v->'network'='null'::jsonb and v->'contract'='null'::jsonb
   when 'TOKEN' then v->>'network' is not null and v->>'contract' is not null
   else v->>'network' is not null and v->'contract'='null'::jsonb end,false);
end;$$;

create function private.fse_asset_key(v jsonb) returns text language plpgsql immutable
set search_path=pg_catalog as $$
begin
 if not private.fse_asset_valid(v) then raise exception 'FSE_INVALID' using errcode='22023';end if;
 return private.fse_hash(private.fse_tuple('asset',jsonb_build_array(v->>'kind',v->>'code',v->>'network',v->>'contract',v->>'decimals')));
end;$$;

create table private.fse_namespaces(
 id uuid primary key default gen_random_uuid(),origin text not null default 'SYNTHETIC' check(origin='SYNTHETIC'),
 provider_environment text not null check(provider_environment in ('FIXTURE','SANDBOX')),
 admission_enabled boolean not null default false,revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default clock_timestamp()
);
create table private.fse_scopes(
 namespace_id uuid not null references private.fse_namespaces(id),tenant_id uuid not null references public.tenants(id),
 writes_enabled boolean not null default false,scope_revision bigint not null default 1 check(scope_revision>0),
 generation bigint not null default 0 check(generation>=0),retention_policy_ref text,delete_after timestamptz,
 legal_hold_state text not null default 'UNKNOWN' check(legal_hold_state in ('UNKNOWN','NONE','ACTIVE')),
 primary key(namespace_id,tenant_id)
);
create table private.fse_binding_versions(
 namespace_id uuid not null,tenant_id uuid not null,id uuid not null default gen_random_uuid(),
 merchant_binding_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740991),
 state text not null check(state in ('ACTIVE','REVOKED','INCOMPLETE')),
 provider_id text collate "C" not null check(private.fse_reference(provider_id)),
 merchant_account_id text collate "C" not null check(private.fse_reference(merchant_account_id)),
 environment text not null check(environment in ('FIXTURE','SANDBOX')),
 approval_reference text check(approval_reference is null or private.fse_reference(approval_reference)),
 evidence_origin text not null default 'SYNTHETIC' check(evidence_origin='SYNTHETIC'),
 policy_hash text not null check(policy_hash~'^[a-f0-9]{64}$'),policy_snapshot jsonb not null check(octet_length(policy_snapshot::text)<=8192),
 expected_asset jsonb not null check(private.fse_asset_valid(expected_asset)),
 expected_basis text not null check(expected_basis in ('GROSS_CREDIT','NET_SETTLEMENT','GROSS_DEBIT')),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(namespace_id,tenant_id,id),unique(namespace_id,tenant_id,merchant_binding_id,revision),
 check(jsonb_typeof(policy_snapshot)='object' and policy_snapshot->>'hash' is not distinct from policy_hash),
 foreign key(namespace_id,tenant_id) references private.fse_scopes(namespace_id,tenant_id)
);
create index fse_binding_current_idx on private.fse_binding_versions(namespace_id,tenant_id,merchant_binding_id,revision desc);

create table private.fse_commands(
 namespace_id uuid not null,tenant_id uuid not null,id uuid not null,
 request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),fence jsonb not null check(octet_length(fence::text)<=4096),
 evaluation_clock timestamptz not null,result_assessment_id uuid not null,audit_id bigint not null references public.audit_logs(id),
 result jsonb not null,recorded_at timestamptz not null default clock_timestamp(),
 primary key(namespace_id,tenant_id,id),foreign key(namespace_id,tenant_id) references private.fse_scopes(namespace_id,tenant_id)
);
create table private.fse_operations(
 namespace_id uuid not null references private.fse_namespaces(id),operation_key text not null check(operation_key~'^[a-f0-9]{64}$'),
 operation_tuple text collate "C" not null check(octet_length(operation_tuple)<=4096 and private.fse_hash(operation_tuple)=operation_key),
 identity_fingerprint_db1 text not null check(identity_fingerprint_db1~'^[a-f0-9]{64}$'),
 provider_id text collate "C" not null,environment text not null check(environment in ('FIXTURE','SANDBOX')),
 merchant_account_id text collate "C" not null,kind text not null check(kind in ('PAYMENT','REFUND','REFUND_REQUEST','DISPUTE')),
 direction text not null check(direction in ('IN','OUT','NONE')),transaction_id text collate "C" not null,transfer_index text collate "C",
 asset jsonb not null check(private.fse_asset_valid(asset)),original_operation_key text check(original_operation_key~'^[a-f0-9]{64}$'),
 owner_tenant_id uuid,owner_claim_id uuid,linked_refund_units numeric not null default 0 check(scale(linked_refund_units)=0 and linked_refund_units>=0 and linked_refund_units<1e30),
 review_latched boolean not null default false,guard_revision bigint not null default 0 check(guard_revision>=0),
 primary key(namespace_id,operation_key),unique(namespace_id,identity_fingerprint_db1),
 check((kind='PAYMENT' and direction='IN' and original_operation_key is null) or (kind='REFUND' and direction='OUT') or (kind in ('REFUND_REQUEST','DISPUTE') and direction='NONE')),
 check((owner_tenant_id is null)=(owner_claim_id is null))
);
create table private.fse_acquisitions(
 namespace_id uuid not null references private.fse_namespaces(id),acquisition_key text not null check(acquisition_key~'^[a-f0-9]{64}$'),
 kind text not null check(kind in ('CALLBACK','INDEPENDENT_READ')),identity_tuple text collate "C" not null,
 baseline_raw_hash text not null check(baseline_raw_hash~'^[a-f0-9]{64}$'),baseline_fact_hash text check(baseline_fact_hash~'^[a-f0-9]{64}$'),
 decoder_version text not null check(private.fse_reference(decoder_version)),recorded_at timestamptz not null default clock_timestamp(),
 primary key(namespace_id,acquisition_key),check(private.fse_hash(identity_tuple)=acquisition_key)
);
create table private.fse_observations(
 namespace_id uuid not null,tenant_id uuid not null,id uuid not null default gen_random_uuid(),command_id uuid not null,binding_version_id uuid not null,
 kind text not null check(kind in ('CALLBACK','INDEPENDENT_READ')),acquisition_key text,
 candidate_acquisition_key text not null check(candidate_acquisition_key~'^[a-f0-9]{64}$'),
 observation_fingerprint text not null check(observation_fingerprint~'^[a-f0-9]{64}$'),
 raw_hash text not null check(raw_hash~'^[a-f0-9]{64}$'),fact_hash text check(fact_hash~'^[a-f0-9]{64}$'),
 source_time timestamptz,observed_at timestamptz not null,source_revision bigint,
 source_status text not null,complete boolean not null,
 received_units numeric check(scale(received_units)=0 and received_units>=0 and received_units<1e30),
 refunded_units numeric check(scale(refunded_units)=0 and refunded_units>=0 and refunded_units<1e30),
 snapshot jsonb not null check(octet_length(snapshot::text)<=16384),raw_material text not null default 'HASH_ONLY' check(raw_material='HASH_ONLY'),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(namespace_id,tenant_id,id),unique(namespace_id,tenant_id,observation_fingerprint),
 foreign key(namespace_id,tenant_id,command_id) references private.fse_commands(namespace_id,tenant_id,id) deferrable initially deferred,
 foreign key(namespace_id,tenant_id,binding_version_id) references private.fse_binding_versions(namespace_id,tenant_id,id),
 foreign key(namespace_id,acquisition_key) references private.fse_acquisitions(namespace_id,acquisition_key)
);
create table private.fse_history_entries(
 namespace_id uuid not null,tenant_id uuid not null,id uuid not null default gen_random_uuid(),command_id uuid not null,
 entry_hash text not null check(entry_hash~'^[a-f0-9]{64}$'),canonical_history_v1 text collate "C" not null check(octet_length(canonical_history_v1)<=16384 and private.fse_hash(canonical_history_v1)=entry_hash),
 operation_key text not null,physical_key text,delivery_key text,invoice_key text,original_operation_key text,source_state text not null,
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(namespace_id,tenant_id,id),unique(namespace_id,tenant_id,entry_hash),
 foreign key(namespace_id,tenant_id,command_id) references private.fse_commands(namespace_id,tenant_id,id) deferrable initially deferred
);
create index fse_history_operation_idx on private.fse_history_entries(namespace_id,operation_key,entry_hash);
create index fse_history_physical_idx on private.fse_history_entries(namespace_id,physical_key,entry_hash) where physical_key is not null;
create index fse_history_delivery_idx on private.fse_history_entries(namespace_id,delivery_key,entry_hash) where delivery_key is not null;
create index fse_history_invoice_idx on private.fse_history_entries(namespace_id,invoice_key,entry_hash) where invoice_key is not null;
create index fse_history_original_idx on private.fse_history_entries(namespace_id,original_operation_key,entry_hash) where original_operation_key is not null;

create table private.fse_assessments(
 namespace_id uuid not null,tenant_id uuid not null,id uuid not null,command_id uuid not null,binding_version_id uuid not null,
 evaluation_series_id uuid not null,assessment_revision bigint not null check(assessment_revision>0),previous_assessment_id uuid,
 callback_observation_id uuid,read_observation_id uuid,operation_key text,
 source_envelope_hash text not null check(source_envelope_hash~'^[a-f0-9]{64}$'),context_hash text not null check(context_hash~'^[a-f0-9]{64}$'),
 history_set_hash text not null check(history_set_hash~'^[a-f0-9]{64}$'),evidence_binding_hash text not null check(evidence_binding_hash~'^[a-f0-9]{64}$'),
 result jsonb not null check(octet_length(result::text)<=16384 and result->>'financial_authority'='NONE'),
 source_state text not null check(source_state in ('PENDING','REVIEW','REJECTED','SOURCE_VERIFIED')),
 fulfillment_eligibility text not null check(fulfillment_eligibility in ('ELIGIBLE','PENDING','REVIEW','INELIGIBLE')),
 storage_outcome text not null check(storage_outcome in ('RECORDED','NO_NEW_EFFECT','PENDING','REVIEW_REQUIRED')),
 effect_kind text not null check(effect_kind in ('NONE','CLAIM_ONLY','ALLOCATION_CANDIDATE','REFUND_CORRELATION')),
 claim_id uuid,original_payment_claim_id uuid,invoice_id uuid,customer_id uuid,offer_id uuid,product_version_id uuid,plan_version_id uuid,
 effect_units numeric check(scale(effect_units)=0 and effect_units>0 and effect_units<1e30),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(namespace_id,tenant_id,id),unique(namespace_id,tenant_id,command_id),unique(namespace_id,tenant_id,evaluation_series_id,assessment_revision),
 foreign key(namespace_id,tenant_id,command_id) references private.fse_commands(namespace_id,tenant_id,id) deferrable initially deferred,
 foreign key(namespace_id,tenant_id,binding_version_id) references private.fse_binding_versions(namespace_id,tenant_id,id),
 foreign key(namespace_id,tenant_id,previous_assessment_id) references private.fse_assessments(namespace_id,tenant_id,id),
 foreign key(namespace_id,tenant_id,callback_observation_id) references private.fse_observations(namespace_id,tenant_id,id),
 foreign key(namespace_id,tenant_id,read_observation_id) references private.fse_observations(namespace_id,tenant_id,id),
 foreign key(tenant_id,invoice_id) references public.payment_invoices(tenant_id,id),
 foreign key(tenant_id,customer_id) references public.customers(tenant_id,id),
 foreign key(tenant_id,offer_id) references public.commercial_offers(tenant_id,id),
 foreign key(tenant_id,product_version_id) references public.commercial_versions(tenant_id,id),
 foreign key(tenant_id,plan_version_id) references public.commercial_versions(tenant_id,id),
 check((effect_kind='REFUND_CORRELATION' and original_payment_claim_id is not null and effect_units is not null) or (effect_kind<>'REFUND_CORRELATION' and original_payment_claim_id is null and effect_units is null)),
 check(effect_kind<>'ALLOCATION_CANDIDATE' or (invoice_id is not null and customer_id is not null and fulfillment_eligibility='ELIGIBLE' and source_state='SOURCE_VERIFIED'))
);
create unique index fse_one_allocation_idx on private.fse_assessments(namespace_id,tenant_id,invoice_id) where effect_kind='ALLOCATION_CANDIDATE';
create unique index fse_one_refund_correlation_idx on private.fse_assessments(namespace_id,operation_key) where effect_kind='REFUND_CORRELATION';
create index fse_assessment_series_idx on private.fse_assessments(namespace_id,tenant_id,evaluation_series_id,assessment_revision desc);
create table private.fse_operation_claims(
 namespace_id uuid not null,operation_key text not null,claim_id uuid not null default gen_random_uuid(),tenant_id uuid not null,binding_version_id uuid not null,first_assessment_id uuid not null,
 kind text not null check(kind in ('PAYMENT','REFUND')),units numeric not null check(scale(units)=0 and units>0 and units<1e30),asset jsonb not null check(private.fse_asset_valid(asset)),
 physical_key text check(physical_key~'^[a-f0-9]{64}$'),physical_tuple text collate "C",physical_fingerprint_db1 text,
 evidence_origin text not null default 'SYNTHETIC' check(evidence_origin='SYNTHETIC'),financial_authority text not null default 'NONE' check(financial_authority='NONE'),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(namespace_id,operation_key),unique(namespace_id,tenant_id,claim_id),
 unique(namespace_id,physical_key),unique(namespace_id,physical_fingerprint_db1),
 foreign key(namespace_id,operation_key) references private.fse_operations(namespace_id,operation_key),
 foreign key(namespace_id,tenant_id,binding_version_id) references private.fse_binding_versions(namespace_id,tenant_id,id),
 foreign key(namespace_id,tenant_id,first_assessment_id) references private.fse_assessments(namespace_id,tenant_id,id) deferrable initially deferred,
 check((physical_key is null and physical_tuple is null and physical_fingerprint_db1 is null) or (physical_key is not null and physical_tuple is not null and physical_fingerprint_db1 is not null and private.fse_hash(physical_tuple)=physical_key))
);
alter table private.fse_commands add foreign key(namespace_id,tenant_id,result_assessment_id) references private.fse_assessments(namespace_id,tenant_id,id) deferrable initially deferred;
alter table private.fse_assessments add foreign key(namespace_id,tenant_id,claim_id) references private.fse_operation_claims(namespace_id,tenant_id,claim_id) deferrable initially deferred;
alter table private.fse_assessments add foreign key(namespace_id,tenant_id,original_payment_claim_id) references private.fse_operation_claims(namespace_id,tenant_id,claim_id) deferrable initially deferred;
alter table private.fse_operations add foreign key(namespace_id,owner_tenant_id,owner_claim_id) references private.fse_operation_claims(namespace_id,tenant_id,claim_id) deferrable initially deferred;

create view private.fse_allocation_candidates_v1 with(security_invoker=true) as
 select namespace_id,tenant_id,id,claim_id,invoice_id,customer_id,offer_id,product_version_id,plan_version_id,recorded_at
 from private.fse_assessments where effect_kind='ALLOCATION_CANDIDATE';
create view private.fse_refund_correlations_v1 with(security_invoker=true) as
 select namespace_id,tenant_id,id,claim_id,original_payment_claim_id,effect_units,recorded_at
 from private.fse_assessments where effect_kind='REFUND_CORRELATION';

create function private.fse_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'FSE_IMMUTABLE' using errcode='42501';end;$$;

create function private.fse_control_guard() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception 'FSE_IMMUTABLE' using errcode='42501';end if;
 if tg_table_name='fse_namespaces' then
  if to_jsonb(new)-array['admission_enabled','revision'] is distinct from to_jsonb(old)-array['admission_enabled','revision'] then raise exception 'FSE_IMMUTABLE' using errcode='42501';end if;
  new.revision:=old.revision+1;
  insert into public.audit_logs(actor_type,action,entity_type,entity_id,after_data) values('SYSTEM','financial_evidence.namespace_control','fse_namespaces',new.id::text,jsonb_build_object('revision',new.revision::text,'admission_enabled',new.admission_enabled,'classification','SYNTHETIC','financial_authority','NONE'));
 elsif tg_table_name='fse_scopes' then
  if new.namespace_id<>old.namespace_id or new.tenant_id<>old.tenant_id or new.scope_revision<old.scope_revision then raise exception 'FSE_IMMUTABLE' using errcode='42501';end if;
  new.generation:=old.generation+1;
  if to_jsonb(new)-array['scope_revision','generation'] is distinct from to_jsonb(old)-array['scope_revision','generation'] then
   new.scope_revision:=old.scope_revision+1;
   insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data) values(new.tenant_id,'SYSTEM','financial_evidence.scope_control','fse_scopes',new.namespace_id::text,jsonb_build_object('revision',new.scope_revision::text,'writes_enabled',new.writes_enabled,'classification','SYNTHETIC','financial_authority','NONE'));
  end if;
 elsif tg_table_name='fse_operations' then
  if to_jsonb(new)-array['owner_tenant_id','owner_claim_id','linked_refund_units','review_latched','guard_revision'] is distinct from to_jsonb(old)-array['owner_tenant_id','owner_claim_id','linked_refund_units','review_latched','guard_revision']
   or (old.owner_tenant_id is not null and (new.owner_tenant_id is distinct from old.owner_tenant_id or new.owner_claim_id is distinct from old.owner_claim_id))
   or new.linked_refund_units<old.linked_refund_units or (old.review_latched and not new.review_latched) then raise exception 'FSE_IMMUTABLE' using errcode='42501';end if;
  new.guard_revision:=old.guard_revision+1;
 end if;return new;
end;$$;

create function private.fse_binding_publish() returns trigger language plpgsql set search_path=pg_catalog as $$
declare nr bigint;env text;account_old record;
begin
 select provider_environment into env from private.fse_namespaces where id=new.namespace_id for share;
 perform 1 from private.fse_scopes where namespace_id=new.namespace_id and tenant_id=new.tenant_id for update;
 select revision,provider_id,merchant_account_id into account_old from private.fse_binding_versions
  where namespace_id=new.namespace_id and tenant_id=new.tenant_id and merchant_binding_id=new.merchant_binding_id order by revision desc limit 1;
 nr:=coalesce(account_old.revision,0)+1;
 if new.environment<>env or new.revision<>nr or (account_old.revision is not null and (new.provider_id<>account_old.provider_id or new.merchant_account_id<>account_old.merchant_account_id)) then
  raise exception 'FSE_BINDING_INVALID' using errcode='22023';end if;
 update private.fse_scopes set scope_revision=scope_revision+1 where namespace_id=new.namespace_id and tenant_id=new.tenant_id;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data) values(new.tenant_id,'SYSTEM','financial_evidence.binding_published','fse_binding_versions',new.id::text,jsonb_build_object('revision',new.revision::text,'state',new.state,'classification','SYNTHETIC','financial_authority','NONE'));
 return new;
end;$$;
create trigger fse_binding_publish before insert on private.fse_binding_versions for each row execute function private.fse_binding_publish();

-- Defense in depth: no public or service-role table/writer access. Stable scoped
-- read wrappers below are the only new authenticated capabilities.
do $$declare tab text;
begin
 foreach tab in array array['fse_namespaces','fse_scopes','fse_binding_versions','fse_commands','fse_operations','fse_acquisitions','fse_observations','fse_history_entries','fse_assessments','fse_operation_claims'] loop
  execute format('alter table private.%I enable row level security',tab);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',tab);
  if tab in ('fse_namespaces','fse_scopes','fse_operations') then
   execute format('create trigger fse_control before update or delete on private.%I for each row execute function private.fse_control_guard()',tab);
  else execute format('create trigger fse_immutable before update or delete on private.%I for each row execute function private.fse_immutable()',tab);end if;
 end loop;
 foreach tab in array array['fse_binding_versions','fse_observations','fse_history_entries','fse_assessments'] loop
  execute format('create index %I on private.%I(namespace_id,tenant_id,recorded_at desc,id desc)',tab||'_page_idx',tab);
 end loop;
end;$$;
create index fse_claim_page_idx on private.fse_operation_claims(namespace_id,tenant_id,recorded_at desc,claim_id desc);
revoke all on private.fse_allocation_candidates_v1,private.fse_refund_correlations_v1 from public,anon,authenticated,service_role;

create function private.fse_history_context(ns uuid,t uuid,s jsonb) returns jsonb
language plpgsql stable set search_path=pg_catalog as $$
declare rows_value jsonb;complete_value boolean;hash_value text;invoice_key_value text;root_key text;guards jsonb;metadata jsonb;
begin
 invoice_key_value:=case when s->>'invoice_id' is null then null else private.fse_hash(private.fse_tuple('invoice',jsonb_build_array(t::text,s->>'invoice_id'))) end;
 root_key:=coalesce(s->>'original_operation_key',s->>'operation_key');
 with candidates as (
  (select h.entry_hash,h.id,octet_length(h.canonical_history_v1) bytes from private.fse_history_entries h where h.namespace_id=ns and h.operation_key=s->>'operation_key' order by h.entry_hash limit 65)
  union all (select h.entry_hash,h.id,octet_length(h.canonical_history_v1) from private.fse_history_entries h where h.namespace_id=ns and h.physical_key=s->>'physical_key' order by h.entry_hash limit 65)
  union all (select h.entry_hash,h.id,octet_length(h.canonical_history_v1) from private.fse_history_entries h where h.namespace_id=ns and h.delivery_key=s->>'delivery_key' order by h.entry_hash limit 65)
  union all (select h.entry_hash,h.id,octet_length(h.canonical_history_v1) from private.fse_history_entries h where h.namespace_id=ns and h.invoice_key=invoice_key_value order by h.entry_hash limit 65)
  union all (select h.entry_hash,h.id,octet_length(h.canonical_history_v1) from private.fse_history_entries h where h.namespace_id=ns and h.operation_key=s->>'original_operation_key' order by h.entry_hash limit 65)
  union all (select h.entry_hash,h.id,octet_length(h.canonical_history_v1) from private.fse_history_entries h where h.namespace_id=ns and h.original_operation_key=root_key order by h.entry_hash limit 65)
 ), bounded as (select distinct entry_hash,id,bytes from candidates order by entry_hash limit 65)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'hash',entry_hash) order by entry_hash),'[]'::jsonb),
  count(*)<=64 and coalesce(sum(bytes),0)<=262144,
  private.fse_storage_hash(jsonb_build_array('history')||coalesce(jsonb_agg(to_jsonb(entry_hash) order by entry_hash),'[]'::jsonb))
 into metadata,complete_value,hash_value from bounded;
 if complete_value then
  select coalesce(jsonb_agg(h.canonical_history_v1::jsonb order by h.entry_hash),'[]'::jsonb) into rows_value
   from private.fse_history_entries h join jsonb_array_elements(metadata) m on h.id=(m->>'id')::uuid and h.entry_hash=m->>'hash' where h.namespace_id=ns;
 else rows_value:='[]'::jsonb;end if;
 select coalesce(jsonb_agg(jsonb_build_array(o.operation_key,o.guard_revision::text) order by o.operation_key),'[]'::jsonb)
 into guards from private.fse_operations o where o.namespace_id=ns and o.operation_key in(s->>'operation_key',s->>'original_operation_key');
 return jsonb_build_object('history',case when complete_value then rows_value else '[]'::jsonb end,'complete',complete_value,
  'hash',private.fse_storage_hash(jsonb_build_array('history-context',hash_value,private.fse_canonical(guards))));
end;$$;

create function private.prepare_financial_evidence_v1(ns uuid,t uuid,binding_id uuid,selectors_value jsonb,evaluation_clock_value text) returns jsonb
language plpgsql stable set search_path=pg_catalog as $$
declare n private.fse_namespaces%rowtype;s private.fse_scopes%rowtype;b private.fse_binding_versions%rowtype;
 i public.payment_invoices%rowtype;o public.commercial_offers%rowtype;h jsonb;context_value jsonb;invoice_value jsonb;latest bigint;
begin
 if not private.fse_keys(selectors_value,array['operation_key','physical_key','delivery_key','invoice_id','original_operation_key','kind']) then raise exception 'FSE_INVALID' using errcode='22023';end if;
 if selectors_value->>'kind' is not null and selectors_value->>'kind' not in ('PAYMENT','REFUND','REFUND_REQUEST','DISPUTE') then raise exception 'FSE_INVALID' using errcode='22023';end if;
 if evaluation_clock_value is null or evaluation_clock_value!~'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?(Z|[+-]\d\d:\d\d)$' or not isfinite(evaluation_clock_value::timestamptz) then raise exception 'FSE_INVALID' using errcode='22023';end if;
 select * into n from private.fse_namespaces where id=ns;
 select * into s from private.fse_scopes where namespace_id=ns and tenant_id=t;
 select * into b from private.fse_binding_versions where namespace_id=ns and tenant_id=t and id=binding_id;
 if n.id is null or s.tenant_id is null or b.id is null or not exists(select 1 from public.tenants where id=t and status='active' and slug like 'phase16c1b-sandbox-%' and not outbound_messaging_enabled) then
  raise exception 'FSE_UNAVAILABLE' using errcode='42501';end if;
 select revision into latest from private.fse_binding_versions where namespace_id=ns and tenant_id=t and merchant_binding_id=b.merchant_binding_id order by revision desc limit 1;
 if b.revision<>latest then raise exception 'FSE_STALE_CONTEXT' using errcode='40001';end if;
 if selectors_value->>'invoice_id' is not null then
  select * into i from public.payment_invoices where tenant_id=t and id=(selectors_value->>'invoice_id')::uuid and mode='test';
  select * into o from public.commercial_offers where tenant_id=t and id=i.offer_id and customer_id=i.customer_id;
  if i.id is null or o.id is null then raise exception 'FSE_UNAVAILABLE' using errcode='42501';end if;
  invoice_value:=jsonb_build_object('invoice_id',i.id,'provider_invoice_id',i.provider_reference,'customer_id',i.customer_id,'offer_id',i.offer_id,
   'product_version_id',o.product_version_id,'plan_version_id',o.plan_version_id,'offer_snapshot_hash',private.fse_hash(private.fse_canonical(o.snapshot)));
 end if;
 h:=private.fse_history_context(ns,t,selectors_value);
 context_value:=jsonb_build_object('now',evaluation_clock_value,'expected_account',jsonb_build_object('provider_id',b.provider_id,'merchant_account_id',b.merchant_account_id),
  'expected_scope',jsonb_build_object('tenant_id',t,'merchant_binding_id',b.merchant_binding_id,'merchant_revision',b.revision),
  'expected_invoice',invoice_value,'merchant_status',case b.state when 'ACTIVE' then 'ACTIVE' when 'REVOKED' then 'REVOKED' else 'MISSING' end,
  'merchant_approval_reference',b.approval_reference,'expected_asset',b.expected_asset,'expected_units',i.amount_units::text,
  'expected_basis',case when selectors_value->>'kind'='REFUND' then 'GROSS_DEBIT' else b.expected_basis end,
  'expected_payer',i.payer_reference,'expected_recipient',i.recipient,
  'invoice_expires_at',case when i.expires_at is null then null else to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
  'policy',b.policy_snapshot,'history_complete',(h->>'complete')::boolean);
 return jsonb_build_object('version',1,'context',context_value,'history',h->'history',
  'fence',jsonb_build_object('namespace_revision',n.revision::text,'scope_revision',s.scope_revision::text,'generation',s.generation::text,
   'binding_revision',b.revision::text,'policy_hash',b.policy_hash,'history_hash',h->>'hash','prepared_at',clock_timestamp()));
end;$$;

create function private.fse_validate_history(v jsonb,t uuid,op jsonb,actual_value numeric) returns void
language plpgsql immutable set search_path=pg_catalog as $$
begin
 if not private.fse_keys(v,array['operation_key','operation_tuple','physical_key','physical_tuple','delivery_key','raw_hash','fact_hash','fact_tuple','tenant_key','account_key','invoice_key','asset_key','kind','original_operation_key','units','source_state'])
  or octet_length(private.fse_canonical(v))>16384 or private.fse_hash(v->>'operation_tuple') is distinct from v->>'operation_key'
  or private.fse_hash(v->>'fact_tuple') is distinct from v->>'fact_hash'
  or v->>'operation_key' is distinct from op->>'operation_key' or v->>'operation_tuple' is distinct from op->>'operation_tuple'
  or v->>'physical_key' is distinct from op->>'physical_key' or v->>'physical_tuple' is distinct from op->>'physical_tuple'
  or v->>'tenant_key' is distinct from private.fse_hash(private.fse_tuple('tenant',jsonb_build_array(t::text)))
  or v->>'asset_key' is distinct from private.fse_asset_key(op->'asset')
  or v->>'kind' is distinct from op->>'kind' or v->>'original_operation_key' is distinct from op->>'original_operation_key'
  or private.fse_units(v->'units') is distinct from actual_value then raise exception 'FSE_INVALID' using errcode='22023';end if;
end;$$;

create function private.fse_integrity() returns trigger language plpgsql set search_path=pg_catalog as $$
declare a private.fse_assessments%rowtype;p private.fse_assessments%rowtype;c private.fse_operation_claims%rowtype;
 o private.fse_operations%rowtype;cmd private.fse_commands%rowtype;linked numeric;ns uuid:=new.namespace_id;t uuid;
begin
 if tg_table_name='fse_commands' then
  select * into cmd from private.fse_commands where namespace_id=ns and tenant_id=new.tenant_id and id=new.id;
  if not exists(select 1 from private.fse_assessments x where x.namespace_id=ns and x.tenant_id=cmd.tenant_id and x.id=cmd.result_assessment_id and x.command_id=cmd.id)
   or not exists(select 1 from public.audit_logs u where u.id=cmd.audit_id and u.tenant_id=cmd.tenant_id and u.action='financial_evidence.recorded' and u.entity_id=cmd.id::text)
   or cmd.result->>'financial_authority' is distinct from 'NONE' then raise exception 'FSE_INTEGRITY' using errcode='23514';end if;
 elsif tg_table_name='fse_assessments' then
  select * into a from private.fse_assessments where namespace_id=ns and tenant_id=new.tenant_id and id=new.id;
  if a.previous_assessment_id is null then
   if a.assessment_revision<>1 or a.id<>a.evaluation_series_id then raise exception 'FSE_INTEGRITY' using errcode='23514';end if;
  else
   select * into p from private.fse_assessments where namespace_id=ns and tenant_id=a.tenant_id and id=a.previous_assessment_id;
   if p.evaluation_series_id<>a.evaluation_series_id or p.assessment_revision+1<>a.assessment_revision
    or (p.operation_key is not null and p.operation_key is distinct from a.operation_key) then raise exception 'FSE_INTEGRITY' using errcode='23514';end if;
  end if;
  if a.result->>'source_state' is distinct from a.source_state or a.result->>'fulfillment_eligibility' is distinct from a.fulfillment_eligibility
   or a.result->>'financial_authority' is distinct from 'NONE' then raise exception 'FSE_INTEGRITY' using errcode='23514';end if;
  if a.effect_kind='REFUND_CORRELATION' then
   select * into c from private.fse_operation_claims where namespace_id=ns and tenant_id=a.tenant_id and claim_id=a.claim_id;
   select * into o from private.fse_operations where namespace_id=ns and operation_key=c.operation_key;
   if c.kind is distinct from 'REFUND' or c.units is distinct from a.effect_units or a.source_state<>'SOURCE_VERIFIED'
    or not exists(select 1 from private.fse_operation_claims root join private.fse_assessments first_source on first_source.namespace_id=root.namespace_id and first_source.tenant_id=root.tenant_id and first_source.id=root.first_assessment_id
      join private.fse_binding_versions rb on rb.namespace_id=root.namespace_id and rb.tenant_id=root.tenant_id and rb.id=root.binding_version_id
      join private.fse_binding_versions cb on cb.namespace_id=c.namespace_id and cb.tenant_id=c.tenant_id and cb.id=c.binding_version_id
      where root.namespace_id=ns and root.tenant_id=a.tenant_id and root.claim_id=a.original_payment_claim_id and root.operation_key=o.original_operation_key and root.kind='PAYMENT' and root.asset=c.asset
      and a.invoice_id is not null and first_source.invoice_id=a.invoice_id and first_source.customer_id=a.customer_id and rb.provider_id=cb.provider_id and rb.merchant_account_id=cb.merchant_account_id and rb.environment=cb.environment)
    then raise exception 'FSE_INTEGRITY' using errcode='23514';end if;
  end if;
 elsif tg_table_name='fse_operation_claims' then
  select * into c from private.fse_operation_claims where namespace_id=ns and operation_key=new.operation_key;
  select * into a from private.fse_assessments where namespace_id=ns and tenant_id=c.tenant_id and id=c.first_assessment_id;
  if a.source_state is distinct from 'SOURCE_VERIFIED' or a.result->>'classification' is distinct from 'SANDBOX' or a.operation_key is distinct from c.operation_key
   or a.claim_id is distinct from c.claim_id or c.units is distinct from private.fse_units(case when c.kind='PAYMENT' then a.result->'received_units' else a.result->'refunded_units' end)
   or not exists(select 1 from private.fse_history_entries h where h.namespace_id=ns and h.tenant_id=c.tenant_id and h.entry_hash=private.fse_hash(private.fse_canonical(a.result->'history_record')))
   then raise exception 'FSE_INTEGRITY' using errcode='23514';end if;
  select * into o from private.fse_operations where namespace_id=ns and operation_key=c.operation_key;
  if o.owner_claim_id is distinct from c.claim_id or o.owner_tenant_id is distinct from c.tenant_id or o.asset is distinct from c.asset
   or not exists(select 1 from private.fse_binding_versions b where b.namespace_id=ns and b.tenant_id=c.tenant_id and b.id=c.binding_version_id and b.provider_id=o.provider_id and b.merchant_account_id=o.merchant_account_id and b.environment=o.environment)
   then raise exception 'FSE_INTEGRITY' using errcode='23514';end if;
 elsif tg_table_name='fse_operations' then
  select * into o from private.fse_operations where namespace_id=ns and operation_key=new.operation_key;
  if o.owner_claim_id is null then
   if o.linked_refund_units<>0 then raise exception 'FSE_INTEGRITY' using errcode='23514';end if;
  else
   select * into c from private.fse_operation_claims where namespace_id=ns and tenant_id=o.owner_tenant_id and claim_id=o.owner_claim_id;
   select coalesce(sum(effect_units),0) into linked from private.fse_assessments where namespace_id=ns and tenant_id=o.owner_tenant_id and original_payment_claim_id=c.claim_id and effect_kind='REFUND_CORRELATION';
   if c.operation_key is distinct from o.operation_key or o.linked_refund_units<>linked or linked>c.units then raise exception 'FSE_INTEGRITY' using errcode='23514';end if;
  end if;
 end if;return null;
end;$$;
create constraint trigger fse_command_integrity after insert on private.fse_commands deferrable initially deferred for each row execute function private.fse_integrity();
create constraint trigger fse_assessment_integrity after insert on private.fse_assessments deferrable initially deferred for each row execute function private.fse_integrity();
create constraint trigger fse_claim_integrity after insert on private.fse_operation_claims deferrable initially deferred for each row execute function private.fse_integrity();
create constraint trigger fse_guard_integrity after insert or update on private.fse_operations deferrable initially deferred for each row execute function private.fse_integrity();

create function private.read_financial_evidence_command_v1(ns uuid,t uuid,command_value uuid,request_hash_value text) returns jsonb
language plpgsql stable set search_path=pg_catalog as $$
declare c private.fse_commands%rowtype;
begin
 select * into c from private.fse_commands where namespace_id=ns and tenant_id=t and id=command_value;
 if c.id is null then return null;end if;
 if c.request_hash is distinct from request_hash_value then raise exception 'FSE_COMMAND_CONFLICT' using errcode='22023';end if;
 return c.result||jsonb_build_object('historical',true);
end;$$;

create function private.record_financial_evidence_v1(raw_command text,request_hash_value text) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare d jsonb:=private.fse_strict_json(raw_command);f jsonb;a jsonb;op jsonb;h jsonb;fresh jsonb;ob jsonb;cb jsonb;rd jsonb;old_ob jsonb;
 ns uuid;t uuid;bid uuid;cid uuid;sid uuid;aid uuid;previous_id uuid;rev bigint:=1;now_value text;read_ids uuid[]:=array[null::uuid,null::uuid];
 n private.fse_namespaces%rowtype;s private.fse_scopes%rowtype;b private.fse_binding_versions%rowtype;
 existing_op private.fse_operations%rowtype;existing_claim private.fse_operation_claims%rowtype;parent_claim private.fse_operation_claims%rowtype;
 inv public.payment_invoices%rowtype;offer_row public.commercial_offers%rowtype;old_result jsonb;previous_row private.fse_assessments%rowtype;
 claim_value uuid;parent_value uuid;audit_value bigint;ob_id uuid;acq text;acq_tuple text;fingerprint text;physical_fingerprint text;tuple_value text;asset_key_value text;
 key_value bigint;units_value numeric;actual_value numeric;effect_value text:='NONE';outcome_value text:='PENDING';result_value jsonb;entry text;
 claim_new boolean:=false;db_conflict boolean:=false;ctx jsonb;expected_hash text;fact_hash_value text;prior_count int;
begin
 if not private.fse_keys(d,array['version','evidence_origin','financial_authority','namespace_id','tenant_id','binding_version_id','command_id','evaluation_series_id','previous_assessment_id','evaluation_clock','fence','selectors','source_envelope_hash','context_hash','operation','observations','assessment','effect_kind'])
  or d->'version' is distinct from '1'::jsonb or d->>'version' is distinct from '1' or d->>'evidence_origin' is distinct from 'SYNTHETIC' or d->>'financial_authority' is distinct from 'NONE'
  or not private.fse_strings(d,array['namespace_id','tenant_id','binding_version_id','command_id','evaluation_series_id','evaluation_clock','source_envelope_hash','context_hash','effect_kind'],array['previous_assessment_id'])
  or d->>'effect_kind' not in ('NONE','CLAIM_ONLY','ALLOCATION_CANDIDATE','REFUND_CORRELATION')
  or d->>'source_envelope_hash'!~'^[a-f0-9]{64}$' or d->>'context_hash'!~'^[a-f0-9]{64}$'
  or request_hash_value is distinct from private.fse_storage_hash(jsonb_build_array('command',private.fse_canonical(d))) then raise exception 'FSE_INVALID' using errcode='22023';end if;
 ns:=(d->>'namespace_id')::uuid;t:=(d->>'tenant_id')::uuid;bid:=(d->>'binding_version_id')::uuid;cid:=(d->>'command_id')::uuid;
 sid:=(d->>'evaluation_series_id')::uuid;previous_id:=(d->>'previous_assessment_id')::uuid;now_value:=d->>'evaluation_clock';
 f:=d->'fence';a:=d->'assessment';op:=d->'operation';h:=a->'history_record';
 if not private.fse_keys(f,array['namespace_revision','scope_revision','generation','binding_revision','policy_hash','history_hash','prepared_at'])
  or not private.fse_keys(a,array['contract_version','source_state','fulfillment_eligibility','financial_authority','classification','completeness','reasons','received_units','refunded_units','fee','payout','replay','assessment_hash','history_record'])
  or a->'contract_version' is distinct from '1'::jsonb or a->>'contract_version' is distinct from '1' or a->>'financial_authority' is distinct from 'NONE'
  or not private.fse_strings(f,array['namespace_revision','scope_revision','generation','binding_revision','policy_hash','history_hash','prepared_at'])
  or not private.fse_strings(a,array['source_state','fulfillment_eligibility','financial_authority','classification','completeness'],array['assessment_hash'])
  or a->>'classification' not in ('SANDBOX','UNAVAILABLE') or a->>'source_state' not in ('PENDING','REVIEW','REJECTED','SOURCE_VERIFIED')
  or a->>'fulfillment_eligibility' not in ('ELIGIBLE','PENDING','REVIEW','INELIGIBLE')
  or a->>'completeness' not in ('COMPLETE_CORROBORATED','INCOMPLETE','CONFLICTED','UNVERIFIABLE')
  or jsonb_typeof(a->'replay')<>'boolean' or jsonb_typeof(a->'reasons')<>'array' or jsonb_array_length(a->'reasons') not between 1 and 8
  or octet_length(private.fse_canonical(a))>16384 or not private.fse_money_valid(a->'fee') or not private.fse_money_valid(a->'payout')
  or jsonb_typeof(d->'observations')<>'array' or jsonb_array_length(d->'observations')>2 then raise exception 'FSE_INVALID' using errcode='22023';end if;
 perform private.fse_units(a->'received_units');perform private.fse_units(a->'refunded_units');
 for entry in select value from jsonb_array_elements_text(a->'reasons') loop
  if entry not in ('SOURCE_READY','SCHEMA_INVALID','CONTEXT_INVALID','ORIGIN_UNVERIFIABLE','SYNTHETIC_LIVE_MISMATCH','AUTHORITY_UNAVAILABLE','AUTHENTICATION_FAILED','UNTRUSTED_SOURCE','CALLBACK_MISSING','REPLAY_WINDOW','SOURCE_UNAVAILABLE','SOURCE_INCOMPLETE','INDEPENDENCE_MISSING','MERCHANT_UNAUTHORIZED','SCOPE_MISMATCH','ASSET_MISMATCH','PAYER_MISMATCH','AMOUNT_MISSING','NO_ACTUAL_MOVEMENT','UNALLOCATED','LATE_PAYMENT','AMOUNT_MISMATCH','SPLIT_UNAPPROVED','INSUFFICIENT_FINALITY','POLICY_INCOMPLETE','SOURCE_TIME_MISSING','SOURCE_TIME_INVALID','SOURCE_STALE','SOURCE_REVERSED','DELIVERY_CONFLICT','OPERATION_CONFLICT','PHYSICAL_REUSE','SECOND_PAYMENT','REFUND_ORIGINAL_MISSING','REFUND_TOTAL_EXCEEDED','REFUND_PENDING','REFUND_EFFECT_REVIEW','HISTORY_INCOMPLETE','HISTORY_INVALID') then raise exception 'FSE_INVALID' using errcode='22023';end if;
 end loop;
 select * into n from private.fse_namespaces where id=ns for share;
 select * into s from private.fse_scopes where namespace_id=ns and tenant_id=t for update;
 if n.id is null or s.tenant_id is null then raise exception 'FSE_UNAVAILABLE' using errcode='42501';end if;
 old_result:=private.read_financial_evidence_command_v1(ns,t,cid,request_hash_value);if old_result is not null then return old_result;end if;
 if not n.admission_enabled or not s.writes_enabled or n.origin<>'SYNTHETIC'
  or not exists(select 1 from public.tenants where id=t and status='active' and slug like 'phase16c1b-sandbox-%' and not outbound_messaging_enabled) then raise exception 'FSE_DISABLED' using errcode='42501';end if;
 select * into b from private.fse_binding_versions where namespace_id=ns and tenant_id=t and id=bid;
 if b.id is null or b.state<>'ACTIVE' or b.approval_reference is null or b.environment<>n.provider_environment then raise exception 'FSE_UNAVAILABLE' using errcode='42501';end if;
 if d->'selectors'->>'invoice_id' is not null then
  select * into inv from public.payment_invoices where tenant_id=t and id=(d->'selectors'->>'invoice_id')::uuid and mode='test' for share;
  select * into offer_row from public.commercial_offers where tenant_id=t and id=inv.offer_id and customer_id=inv.customer_id for share;
  perform 1 from public.customers where tenant_id=t and id=inv.customer_id for share;
  if inv.id is null or offer_row.id is null then raise exception 'FSE_UNAVAILABLE' using errcode='42501';end if;
 end if;
 if op<>'null'::jsonb then
  if not private.fse_keys(op,array['operation_key','operation_tuple','provider_id','environment','merchant_account_id','kind','direction','transaction_id','transfer_index','asset','original_operation_key','physical_key','physical_tuple'])
   or not private.fse_strings(op,array['operation_key','operation_tuple','provider_id','environment','merchant_account_id','kind','direction','transaction_id'],array['transfer_index','original_operation_key','physical_key','physical_tuple'])
   or op->>'provider_id' is distinct from b.provider_id or op->>'environment' is distinct from b.environment or op->>'merchant_account_id' is distinct from b.merchant_account_id
   or not private.fse_reference(op->>'transaction_id') or (op->>'transfer_index' is not null and not private.fse_reference(op->>'transfer_index'))
   or op->>'kind' not in ('PAYMENT','REFUND','REFUND_REQUEST','DISPUTE')
   or op->>'direction' is distinct from (case op->>'kind' when 'PAYMENT' then 'IN' when 'REFUND' then 'OUT' else 'NONE' end)
   or (op->>'kind'='PAYMENT' and op->>'original_operation_key' is not null) then raise exception 'FSE_INVALID' using errcode='22023';end if;
  asset_key_value:=private.fse_asset_key(op->'asset');
  tuple_value:=private.fse_tuple('operation',jsonb_build_array(b.provider_id,b.environment,b.merchant_account_id,op->>'kind',op->>'direction',op->>'transaction_id',op->>'transfer_index',asset_key_value));
  if op->>'operation_tuple' is distinct from tuple_value or op->>'operation_key' is distinct from private.fse_hash(tuple_value)
   or op->>'operation_key' is distinct from d->'selectors'->>'operation_key' or op->>'physical_key' is distinct from d->'selectors'->>'physical_key'
   or op->>'original_operation_key' is distinct from d->'selectors'->>'original_operation_key' or op->>'kind' is distinct from d->'selectors'->>'kind'
   then raise exception 'FSE_INVALID' using errcode='22023';end if;
  fingerprint:=private.fse_storage_hash(jsonb_build_array('FSEDB1-operation',b.provider_id,b.environment,b.merchant_account_id,op->>'kind',op->>'direction',op->>'transaction_id',op->>'transfer_index',op->'asset'->>'kind',op->'asset'->>'code',op->'asset'->>'network',op->'asset'->>'contract',op->'asset'->>'decimals'));
  if op->>'physical_key' is not null then
   if private.fse_hash(op->>'physical_tuple') is distinct from op->>'physical_key' then raise exception 'FSE_INVALID' using errcode='22023';end if;
   ob:=(op->>'physical_tuple')::jsonb;
   if jsonb_typeof(ob)<>'array' or jsonb_array_length(ob)<>7 or ob->>0<>'FS1' or ob->>1<>'physical'
    or ob->>2 is distinct from op->'asset'->>'network' or ob->>3 is distinct from asset_key_value or ob->>4 is distinct from op->>'transaction_id'
    or ob->>5 is distinct from op->>'transfer_index' or ob->>6!~'^[a-f0-9]{64}$'
    or private.fse_canonical(ob) is distinct from op->>'physical_tuple' then raise exception 'FSE_INVALID' using errcode='22023';end if;
   physical_fingerprint:=private.fse_storage_hash(jsonb_build_array('FSEDB1-physical')|| (ob-0-0));
  elsif op->>'physical_tuple' is not null then raise exception 'FSE_INVALID' using errcode='22023';end if;
 end if;
 -- Actual signed advisory IDs are sorted (not the 256-bit source hashes).
 for key_value in select distinct hashtextextended(private.fse_storage_hash(jsonb_build_array('FSELOCK1',ns::text,v)),0) k
  from unnest(array[case when op->>'operation_key' is not null then 'operation:'||(op->>'operation_key') end,
   case when op->>'original_operation_key' is not null then 'operation:'||(op->>'original_operation_key') end,
   case when op->>'physical_key' is not null then 'physical:'||(op->>'physical_key') end,
   case when d->'selectors'->>'delivery_key' is not null then 'delivery:'||(d->'selectors'->>'delivery_key') end,
   case when inv.id is not null then 'invoice:'||t::text||':'||inv.id::text end]) v where v is not null order by k
 loop perform pg_advisory_xact_lock(key_value);end loop;
 perform 1 from private.fse_operations where namespace_id=ns and operation_key in(op->>'operation_key',op->>'original_operation_key') order by operation_key for update;
 fresh:=private.prepare_financial_evidence_v1(ns,t,bid,d->'selectors',now_value);ctx:=fresh->'context';
 if f->>'namespace_revision' is distinct from fresh->'fence'->>'namespace_revision' or f->>'scope_revision' is distinct from fresh->'fence'->>'scope_revision'
  or f->>'generation' is distinct from fresh->'fence'->>'generation' or f->>'binding_revision' is distinct from fresh->'fence'->>'binding_revision'
  or f->>'policy_hash' is distinct from fresh->'fence'->>'policy_hash' or f->>'history_hash' is distinct from fresh->'fence'->>'history_hash'
  or not isfinite((f->>'prepared_at')::timestamptz) or (f->>'prepared_at')::timestamptz>clock_timestamp()+interval '1 second'
  or (f->>'prepared_at')::timestamptz<clock_timestamp()-interval '5 seconds' then raise exception 'FSE_STALE_CONTEXT' using errcode='40001';end if;
 if d->>'context_hash' is distinct from private.fse_hash(private.fse_canonical(ctx)) then raise exception 'FSE_CONTEXT_INVALID' using errcode='22023';end if;
 if previous_id is null then
  if exists(select 1 from private.fse_assessments where namespace_id=ns and tenant_id=t and evaluation_series_id=sid) then raise exception 'FSE_SERIES_CONFLICT' using errcode='22023';end if;aid:=sid;
 else
  select * into previous_row from private.fse_assessments where namespace_id=ns and tenant_id=t and evaluation_series_id=sid order by assessment_revision desc limit 1;
  if previous_row.id is distinct from previous_id or (previous_row.operation_key is not null and previous_row.operation_key is distinct from op->>'operation_key') then raise exception 'FSE_SERIES_CONFLICT' using errcode='22023';end if;
  rev:=previous_row.assessment_revision+1;aid:=gen_random_uuid();
 end if;
 for ob in select value from jsonb_array_elements(d->'observations') loop
  if not private.fse_keys(ob,array['kind','acquisition','acquisition_key','source_id','source_record_id','delivery_id','event_id','read_acquisition_id','authentication','authentication_method','raw_hash','fact_hash','source_time','observed_at','source_revision','decoder_version','status','complete','received_units','refunded_units','asset','amount_basis','settlement_status','confirmations','canonical','fee','payout','payer_digest','recipient_digest'])
   or not private.fse_strings(ob,array['kind','acquisition','acquisition_key','source_id','source_record_id','authentication','authentication_method','raw_hash','observed_at','decoder_version','status'],array['delivery_id','event_id','read_acquisition_id','fact_hash','source_time','source_revision','amount_basis','settlement_status','confirmations','payer_digest','recipient_digest'])
   or ob->>'kind' not in ('CALLBACK','INDEPENDENT_READ') or not private.fse_reference(ob->>'source_id') or not private.fse_reference(ob->>'source_record_id')
   or not private.fse_reference(ob->>'decoder_version') or ob->>'raw_hash'!~'^[a-f0-9]{64}$' or (ob->>'fact_hash' is not null and ob->>'fact_hash'!~'^[a-f0-9]{64}$')
   or ob->>'authentication' not in ('AUTHENTICATED','INVALID','UNKNOWN') or ob->>'authentication_method' not in ('SYNTHETIC','UNKNOWN')
   or ob->>'status' not in ('OK','TIMEOUT','RATE_LIMITED','UNAVAILABLE','INVALID','UNKNOWN') or jsonb_typeof(ob->'complete')<>'boolean'
   or (ob->>'asset' is not null and not private.fse_asset_valid(ob->'asset')) or octet_length(private.fse_canonical(ob))>16384
   then raise exception 'FSE_INVALID' using errcode='22023';end if;
  if ob->>'acquisition' not in ('CALLBACK','PROVIDER_LEDGER','CALLBACK_CACHE','SCREENSHOT','CLIENT','PRECHECKOUT')
   or (ob->>'amount_basis' is not null and ob->>'amount_basis' not in ('GROSS_CREDIT','NET_SETTLEMENT','GROSS_DEBIT','BUYER_DEBIT','UNKNOWN'))
   or (ob->>'settlement_status' is not null and ob->>'settlement_status' not in ('SETTLED','PENDING','FAILED','REVERSED','UNKNOWN'))
   or (ob->'canonical'<>'null'::jsonb and jsonb_typeof(ob->'canonical')<>'boolean')
   or (ob->>'payer_digest' is not null and ob->>'payer_digest'!~'^[a-f0-9]{64}$') or (ob->>'recipient_digest' is not null and ob->>'recipient_digest'!~'^[a-f0-9]{64}$')
   or not private.fse_money_valid(ob->'fee') or not private.fse_money_valid(ob->'payout') then raise exception 'FSE_INVALID' using errcode='22023';end if;
  perform private.fse_units(ob->'received_units');perform private.fse_units(ob->'refunded_units');
  if ob->>'confirmations' is not null and (jsonb_typeof(ob->'confirmations')<>'string' or ob->>'confirmations'!~'^(0|[1-9][0-9]{0,15})$' or (ob->>'confirmations')::numeric>9007199254740991) then raise exception 'FSE_INVALID' using errcode='22023';end if;
  if ob->>'source_revision' is not null and (jsonb_typeof(ob->'source_revision')<>'string' or ob->>'source_revision'!~'^[1-9][0-9]{0,15}$' or (ob->>'source_revision')::numeric>9007199254740991) then raise exception 'FSE_INVALID' using errcode='22023';end if;
  if ob->>'kind'='CALLBACK' then
   if cb is not null or not private.fse_reference(ob->>'delivery_id') or not private.fse_reference(ob->>'event_id') or ob->>'read_acquisition_id' is not null then raise exception 'FSE_INVALID' using errcode='22023';end if;
   acq_tuple:=private.fse_tuple('delivery',jsonb_build_array(b.provider_id,b.environment,b.merchant_account_id,ob->>'delivery_id'));cb:=ob;
   if d->'selectors'->>'delivery_key' is distinct from private.fse_hash(acq_tuple) then raise exception 'FSE_INVALID' using errcode='22023';end if;
  else
   if rd is not null or ob->>'read_acquisition_id' is null or ob->>'delivery_id' is not null or ob->>'event_id' is not null then raise exception 'FSE_INVALID' using errcode='22023';end if;
   perform (ob->>'read_acquisition_id')::uuid;
   acq_tuple:=private.fse_tuple('read-acquisition',jsonb_build_array(b.provider_id,b.environment,b.merchant_account_id,ob->>'read_acquisition_id'));rd:=ob;
  end if;
  if ob->>'acquisition_key' is distinct from private.fse_hash(acq_tuple) then raise exception 'FSE_INVALID' using errcode='22023';end if;
  acq:=null;
  if ob->>'authentication'='AUTHENTICATED' and ob->>'authentication_method'='SYNTHETIC' and ob->>'status'='OK' and ob->>'acquisition' in ('CALLBACK','PROVIDER_LEDGER') then
   insert into private.fse_acquisitions(namespace_id,acquisition_key,kind,identity_tuple,baseline_raw_hash,baseline_fact_hash,decoder_version)
    values(ns,ob->>'acquisition_key',ob->>'kind',acq_tuple,ob->>'raw_hash',ob->>'fact_hash',ob->>'decoder_version') on conflict do nothing;
   if exists(select 1 from private.fse_acquisitions where namespace_id=ns and acquisition_key=ob->>'acquisition_key' and (identity_tuple is distinct from acq_tuple or baseline_raw_hash is distinct from ob->>'raw_hash' or baseline_fact_hash is distinct from ob->>'fact_hash')) then db_conflict:=true;end if;
   acq:=ob->>'acquisition_key';
  end if;
  fingerprint:=private.fse_storage_hash(jsonb_build_array('observation',private.fse_canonical(ob)));
  select id,snapshot into ob_id,old_ob from private.fse_observations where namespace_id=ns and tenant_id=t and observation_fingerprint=fingerprint;
  if ob_id is null then
   insert into private.fse_observations(namespace_id,tenant_id,command_id,binding_version_id,kind,acquisition_key,candidate_acquisition_key,observation_fingerprint,raw_hash,fact_hash,source_time,observed_at,source_revision,source_status,complete,received_units,refunded_units,snapshot)
    values(ns,t,cid,bid,ob->>'kind',acq,ob->>'acquisition_key',fingerprint,ob->>'raw_hash',ob->>'fact_hash',(ob->>'source_time')::timestamptz,(ob->>'observed_at')::timestamptz,(ob->>'source_revision')::bigint,ob->>'status',(ob->>'complete')::boolean,private.fse_units(ob->'received_units'),private.fse_units(ob->'refunded_units'),ob) returning id into ob_id;
  elsif old_ob is distinct from ob then raise exception 'FSE_CONFLICT' using errcode='23505';end if;
  read_ids[case when ob->>'kind'='CALLBACK' then 1 else 2 end]:=ob_id;
 end loop;
 -- Bind the immutable v1 assessment commitment without storing raw source/PII.
 if a->>'assessment_hash' is not null then
  expected_hash:=private.fse_hash(private.fse_canonical(jsonb_build_object('version',1,'facts',rd->>'fact_hash','callback_hash',cb->>'raw_hash','read_hash',rd->>'raw_hash',
   'now',to_char(now_value::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'read_at',case when rd is null then null else to_char((rd->>'observed_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
   'callback_at',case when cb is null then null else to_char((cb->>'observed_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
   'scope',private.fse_hash(private.fse_tuple('private-ref',jsonb_build_array(private.fse_canonical(ctx->'expected_scope')))),
   'invoice',private.fse_hash(private.fse_tuple('private-ref',jsonb_build_array(private.fse_canonical(ctx->'expected_invoice')))),
   'policy',ctx->'policy','state',a->>'source_state','eligibility',a->>'fulfillment_eligibility','reasons',a->'reasons',
   'source_envelope_hash',d->>'source_envelope_hash','context_hash',d->>'context_hash')));
  if a->>'assessment_hash' is distinct from expected_hash then raise exception 'FSE_ASSESSMENT_INVALID' using errcode='22023';end if;
 elsif a->>'source_state'<>'REJECTED' then raise exception 'FSE_ASSESSMENT_INVALID' using errcode='22023';end if;
 actual_value:=private.fse_units(case when op->>'kind'='REFUND' then rd->'refunded_units' else rd->'received_units' end);
 if h<>'null'::jsonb then
  perform private.fse_validate_history(h,t,op,actual_value);
  if h->>'account_key' is distinct from private.fse_hash(private.fse_tuple('account',jsonb_build_array(b.provider_id,b.environment,b.merchant_account_id)))
   or h->>'invoice_key' is distinct from (case when inv.id is null then null else private.fse_hash(private.fse_tuple('invoice',jsonb_build_array(t::text,inv.id::text))) end)
   or h->>'source_state' is distinct from a->>'source_state' or h->>'delivery_key' is distinct from d->'selectors'->>'delivery_key'
   or h->>'raw_hash' is distinct from cb->>'raw_hash' or h->>'fact_hash' is distinct from rd->>'fact_hash' then raise exception 'FSE_INVALID' using errcode='22023';end if;
  fingerprint:=private.fse_storage_hash(jsonb_build_array('FSEDB1-operation',b.provider_id,b.environment,b.merchant_account_id,op->>'kind',op->>'direction',op->>'transaction_id',op->>'transfer_index',op->'asset'->>'kind',op->'asset'->>'code',op->'asset'->>'network',op->'asset'->>'contract',op->'asset'->>'decimals'));
  insert into private.fse_operations(namespace_id,operation_key,operation_tuple,identity_fingerprint_db1,provider_id,environment,merchant_account_id,kind,direction,transaction_id,transfer_index,asset,original_operation_key)
   values(ns,op->>'operation_key',op->>'operation_tuple',fingerprint,b.provider_id,b.environment,b.merchant_account_id,op->>'kind',op->>'direction',op->>'transaction_id',op->>'transfer_index',op->'asset',op->>'original_operation_key') on conflict do nothing;
  select * into existing_op from private.fse_operations where namespace_id=ns and operation_key=op->>'operation_key';
  if existing_op.operation_key is null or existing_op.operation_tuple is distinct from op->>'operation_tuple' or existing_op.original_operation_key is distinct from op->>'original_operation_key' then db_conflict:=true;end if;
  entry:=private.fse_canonical(h);fingerprint:=private.fse_hash(entry);
  if exists(select 1 from private.fse_history_entries where namespace_id=ns and tenant_id=t and entry_hash=fingerprint and canonical_history_v1<>entry) then raise exception 'FSE_CONFLICT' using errcode='23505';end if;
  insert into private.fse_history_entries(namespace_id,tenant_id,command_id,entry_hash,canonical_history_v1,operation_key,physical_key,delivery_key,invoice_key,original_operation_key,source_state)
   values(ns,t,cid,fingerprint,entry,h->>'operation_key',h->>'physical_key',h->>'delivery_key',h->>'invoice_key',h->>'original_operation_key',h->>'source_state') on conflict do nothing;
 end if;
 if a->>'source_state'='SOURCE_VERIFIED' then
  if coalesce(h='null'::jsonb or not(ctx->>'history_complete')::boolean or cb is null or rd is null or cb->>'authentication'<>'AUTHENTICATED' or cb->>'authentication_method'<>'SYNTHETIC'
   or rd->>'authentication'<>'AUTHENTICATED' or rd->>'acquisition'<>'PROVIDER_LEDGER' or cb->>'acquisition'<>'CALLBACK'
   or cb->>'fact_hash' is distinct from rd->>'fact_hash' or cb->>'source_id'=rd->>'source_id' or cb->>'raw_hash'=rd->>'raw_hash'
   or not(rd->>'complete')::boolean or rd->>'status'<>'OK' or actual_value is null or actual_value<=0 or op->>'kind' not in ('PAYMENT','REFUND')
   or cb->>'settlement_status'<>'SETTLED' or rd->>'settlement_status'<>'SETTLED'
   or rd->>'source_revision' is distinct from b.policy_snapshot->>'source_revision'
   or b.policy_snapshot->>'callback_max_age_seconds' is null or b.policy_snapshot->>'read_max_age_seconds' is null or b.policy_snapshot->>'clock_skew_seconds' is null
   or b.policy_snapshot->>'min_confirmations' is null or b.policy_snapshot->>'require_canonical' is null or b.policy_snapshot->>'physical_transfer_required' is null
   or cb->>'source_time' is null or cb->>'observed_at' is null or rd->>'observed_at' is null
   or (cb->>'source_time')::timestamptz<now_value::timestamptz-make_interval(secs=>(b.policy_snapshot->>'callback_max_age_seconds')::int)
   or (rd->>'observed_at')::timestamptz<now_value::timestamptz-make_interval(secs=>(b.policy_snapshot->>'read_max_age_seconds')::int)
   or greatest((cb->>'source_time')::timestamptz,(cb->>'observed_at')::timestamptz,(rd->>'observed_at')::timestamptz)>now_value::timestamptz+make_interval(secs=>(b.policy_snapshot->>'clock_skew_seconds')::int)
   or (b.policy_snapshot->>'physical_transfer_required'='true' and op->>'physical_key' is null)
   or (rd->>'confirmations')::numeric<(b.policy_snapshot->>'min_confirmations')::numeric or (cb->>'confirmations')::numeric<(b.policy_snapshot->>'min_confirmations')::numeric
   or (b.policy_snapshot->>'require_canonical'='true' and (cb->>'canonical' is distinct from 'true' or rd->>'canonical' is distinct from 'true'))
   or op->'asset' is distinct from b.expected_asset or rd->'asset' is distinct from op->'asset'
   or actual_value is distinct from private.fse_units(case when op->>'kind'='REFUND' then a->'refunded_units' else a->'received_units' end),true)
   then raise exception 'FSE_ASSESSMENT_INVALID' using errcode='22023';end if;
  if op->>'kind'='REFUND' and (b.policy_snapshot->>'distinct_refund_identity_supported') is distinct from 'true' then db_conflict:=true;end if;
  if op->>'physical_key' is not null and exists(select 1 from private.fse_operation_claims where namespace_id=ns and (physical_key=op->>'physical_key' or physical_fingerprint_db1=physical_fingerprint) and (operation_key<>op->>'operation_key' or tenant_id<>t)) then db_conflict:=true;end if;
  select * into existing_claim from private.fse_operation_claims where namespace_id=ns and operation_key=op->>'operation_key';
  if existing_claim.claim_id is not null and (existing_claim.tenant_id<>t or existing_claim.units<>actual_value or existing_claim.asset<>op->'asset') then db_conflict:=true;end if;
  if not db_conflict then
   if existing_claim.claim_id is null then
    claim_value:=gen_random_uuid();claim_new:=true;
    insert into private.fse_operation_claims(namespace_id,operation_key,claim_id,tenant_id,binding_version_id,first_assessment_id,kind,units,asset,physical_key,physical_tuple,physical_fingerprint_db1)
     values(ns,op->>'operation_key',claim_value,t,bid,aid,op->>'kind',actual_value,op->'asset',op->>'physical_key',op->>'physical_tuple',physical_fingerprint);
    update private.fse_operations set owner_tenant_id=t,owner_claim_id=claim_value where namespace_id=ns and operation_key=op->>'operation_key';
   else claim_value:=existing_claim.claim_id;end if;
   effect_value:='CLAIM_ONLY';outcome_value:=case when claim_new then 'RECORDED' else 'NO_NEW_EFFECT' end;
   if d->>'effect_kind'='ALLOCATION_CANDIDATE' and op->>'kind'='PAYMENT' and a->>'fulfillment_eligibility'='ELIGIBLE' then
    if inv.id is not null and offer_row.status='approved' and inv.status in ('CREATED','PENDING') and actual_value=inv.amount_units
     and (op->'asset'->>'code')=inv.asset and (op->'asset'->>'network')=inv.network and (op->'asset'->>'decimals')::int=inv.decimals
     and not existing_op.review_latched
     and not exists(select 1 from private.fse_assessments where namespace_id=ns and tenant_id=t and invoice_id=inv.id and effect_kind='ALLOCATION_CANDIDATE')
     then effect_value:='ALLOCATION_CANDIDATE';outcome_value:='RECORDED';
    elsif not exists(select 1 from private.fse_assessments where namespace_id=ns and tenant_id=t and invoice_id=inv.id and claim_id=claim_value and effect_kind='ALLOCATION_CANDIDATE') then outcome_value:='REVIEW_REQUIRED';end if;
   elsif d->>'effect_kind'='REFUND_CORRELATION' and op->>'kind'='REFUND' and a->>'fulfillment_eligibility'='INELIGIBLE' and a->'reasons' ? 'REFUND_EFFECT_REVIEW' then
    select root.* into parent_claim from private.fse_operation_claims root
     join private.fse_assessments first_source on first_source.namespace_id=root.namespace_id and first_source.tenant_id=root.tenant_id and first_source.id=root.first_assessment_id
     join private.fse_binding_versions rb on rb.namespace_id=root.namespace_id and rb.tenant_id=root.tenant_id and rb.id=root.binding_version_id
     where root.namespace_id=ns and root.tenant_id=t and root.operation_key=op->>'original_operation_key' and root.kind='PAYMENT' and root.asset=op->'asset'
      and inv.id is not null and first_source.invoice_id=inv.id and first_source.customer_id=inv.customer_id and rb.provider_id=b.provider_id and rb.merchant_account_id=b.merchant_account_id and rb.environment=b.environment;
    if parent_claim.claim_id is not null and not exists(select 1 from private.fse_assessments where namespace_id=ns and operation_key=op->>'operation_key' and effect_kind='REFUND_CORRELATION')
     and exists(select 1 from private.fse_operations where namespace_id=ns and operation_key=parent_claim.operation_key and not review_latched and linked_refund_units+actual_value<=parent_claim.units)
     then effect_value:='REFUND_CORRELATION';parent_value:=parent_claim.claim_id;outcome_value:='RECORDED';
     update private.fse_operations set linked_refund_units=linked_refund_units+actual_value where namespace_id=ns and operation_key=parent_claim.operation_key and owner_tenant_id=t;
    else outcome_value:='REVIEW_REQUIRED';end if;
   end if;
  else outcome_value:='REVIEW_REQUIRED';end if;
 elsif a->>'source_state' in ('REVIEW','REJECTED') then outcome_value:='REVIEW_REQUIRED';end if;
 if a->'reasons' ? 'SOURCE_REVERSED' and op->>'operation_key' is not null then
  update private.fse_operations set review_latched=true where namespace_id=ns and operation_key=op->>'operation_key' and owner_tenant_id=t and not review_latched;
 end if;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)
  values(t,'SYSTEM','financial_evidence.recorded','fse_commands',cid::text,jsonb_build_object('command_id',cid,'assessment_id',aid,'classification','SYNTHETIC','outcome',outcome_value,'financial_authority','NONE')) returning id into audit_value;
 result_value:=jsonb_build_object('version',1,'command_id',cid,'assessment_id',aid,'assessment_revision',rev::text,'claim_id',claim_value,'storage_outcome',outcome_value,'financial_authority','NONE','historical',false);
 insert into private.fse_commands(namespace_id,tenant_id,id,request_hash,fence,evaluation_clock,result_assessment_id,audit_id,result)
  values(ns,t,cid,request_hash_value,f,now_value::timestamptz,aid,audit_value,result_value);
 insert into private.fse_assessments(namespace_id,tenant_id,id,command_id,binding_version_id,evaluation_series_id,assessment_revision,previous_assessment_id,callback_observation_id,read_observation_id,operation_key,source_envelope_hash,context_hash,history_set_hash,evidence_binding_hash,result,source_state,fulfillment_eligibility,storage_outcome,effect_kind,claim_id,original_payment_claim_id,invoice_id,customer_id,offer_id,product_version_id,plan_version_id,effect_units)
  values(ns,t,aid,cid,bid,sid,rev,previous_id,read_ids[1],read_ids[2],op->>'operation_key',d->>'source_envelope_hash',d->>'context_hash',f->>'history_hash',
   private.fse_storage_hash(jsonb_build_array('evidence-binding',a->>'assessment_hash',d->>'source_envelope_hash',d->>'context_hash',f->>'history_hash',read_ids[1]::text,read_ids[2]::text,bid::text,private.fse_canonical(f),sid::text,previous_id::text,rev::text,effect_value,outcome_value,claim_value::text,parent_value::text,inv.id::text)),
   a,a->>'source_state',a->>'fulfillment_eligibility',outcome_value,effect_value,claim_value,parent_value,inv.id,inv.customer_id,inv.offer_id,offer_row.product_version_id,offer_row.plan_version_id,case when effect_value='REFUND_CORRELATION' then actual_value else null end);
 update private.fse_scopes set generation=generation+1 where namespace_id=ns and tenant_id=t;
 return result_value;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception 'FSE_INVALID' using errcode='22023';
 when unique_violation then raise exception 'FSE_CONFLICT' using errcode='23505';
 when foreign_key_violation or check_violation then raise exception 'FSE_INTEGRITY' using errcode='23514';
end;$$;

create function private.fse_read_rows(ns uuid,t uuid,collection_value text,customer_value uuid,invoice_value uuid,role_value public.app_role,
 anchor_time_value timestamptz default null,anchor_id_value uuid default null,after_time_value timestamptz default null,after_id_value uuid default null,limit_value int default 101,record_value uuid default null)
returns table(id uuid,recorded_at timestamptz,item jsonb) language sql stable set search_path=pg_catalog as $$
 select bounded.id,bounded.recorded_at,bounded.item from (
 (select o.id,o.recorded_at,jsonb_build_object('id',o.id,'kind',o.kind,'status',o.source_status,'complete',o.complete,
  'received_units',case when role_value<>'analyst' then o.received_units::text end,'refunded_units',case when role_value<>'analyst' then o.refunded_units::text end,
  'asset',o.snapshot->'asset','recorded_at',o.recorded_at,'financial_authority','NONE','classification','SANDBOX')
 from private.fse_observations o where collection_value='observations' and o.namespace_id=ns and o.tenant_id=t
  and ((customer_value is null and invoice_value is null) or exists(select 1 from private.fse_assessments a where a.namespace_id=ns and a.tenant_id=t and (a.callback_observation_id=o.id or a.read_observation_id=o.id) and (customer_value is null or a.customer_id=customer_value) and (invoice_value is null or a.invoice_id=invoice_value)))
  and (record_value is null or o.id=record_value) and (anchor_time_value is null or (o.recorded_at,o.id)<=(anchor_time_value,anchor_id_value)) and (after_time_value is null or (o.recorded_at,o.id)<(after_time_value,after_id_value))
  order by o.recorded_at desc,o.id desc limit least(greatest(coalesce(limit_value,101),1),101))
 union all
 (select a.id,a.recorded_at,jsonb_build_object('id',a.id,'recorded_at',a.recorded_at,'source_state',a.source_state,'fulfillment_eligibility',a.fulfillment_eligibility,
  'storage_outcome',a.storage_outcome,'effect_kind',a.effect_kind,'assessment_revision',a.assessment_revision::text,
  'financial_authority','NONE','classification','SANDBOX','completeness',a.result->>'completeness',
  'received_units',case when role_value<>'analyst' then a.result->>'received_units' end,'refunded_units',case when role_value<>'analyst' then a.result->>'refunded_units' end,
  'reasons',case when a.result->'reasons' ?| array['OPERATION_CONFLICT','PHYSICAL_REUSE','DELIVERY_CONFLICT'] or a.storage_outcome='REVIEW_REQUIRED' then jsonb_build_array('REVIEW_REQUIRED') else a.result->'reasons' end)
 from private.fse_assessments a where a.namespace_id=ns and a.tenant_id=t
  and ((collection_value='assessments') or (collection_value='allocations' and a.effect_kind='ALLOCATION_CANDIDATE') or (collection_value='refunds' and a.effect_kind='REFUND_CORRELATION'))
  and (customer_value is null or a.customer_id=customer_value) and (invoice_value is null or a.invoice_id=invoice_value)
  and (record_value is null or a.id=record_value) and (anchor_time_value is null or (a.recorded_at,a.id)<=(anchor_time_value,anchor_id_value)) and (after_time_value is null or (a.recorded_at,a.id)<(after_time_value,after_id_value))
  order by a.recorded_at desc,a.id desc limit least(greatest(coalesce(limit_value,101),1),101))
 union all
 (select c.claim_id,c.recorded_at,jsonb_build_object('id',c.claim_id,'kind',c.kind,'units',case when role_value<>'analyst' then c.units::text end,
  'asset',c.asset,'financial_authority','NONE','classification','SANDBOX','recorded_at',c.recorded_at)
 from private.fse_operation_claims c where collection_value='claims' and c.namespace_id=ns and c.tenant_id=t
  and ((customer_value is null and invoice_value is null) or exists(select 1 from private.fse_assessments a where a.namespace_id=ns and a.tenant_id=t and a.claim_id=c.claim_id and (customer_value is null or a.customer_id=customer_value) and (invoice_value is null or a.invoice_id=invoice_value)))
  and (record_value is null or c.claim_id=record_value) and (anchor_time_value is null or (c.recorded_at,c.claim_id)<=(anchor_time_value,anchor_id_value)) and (after_time_value is null or (c.recorded_at,c.claim_id)<(after_time_value,after_id_value))
  order by c.recorded_at desc,c.claim_id desc limit least(greatest(coalesce(limit_value,101),1),101))
 union all
 (select h.id,h.recorded_at,jsonb_build_object('id',h.id,'source_state',h.source_state,'financial_authority','NONE','classification','SANDBOX','recorded_at',h.recorded_at)
 from private.fse_history_entries h where collection_value='history' and h.namespace_id=ns and h.tenant_id=t
  and (invoice_value is null or h.invoice_key=private.fse_hash(private.fse_tuple('invoice',jsonb_build_array(t::text,invoice_value::text))))
  and (customer_value is null or exists(select 1 from public.payment_invoices i where i.tenant_id=t and i.customer_id=customer_value and h.invoice_key=private.fse_hash(private.fse_tuple('invoice',jsonb_build_array(t::text,i.id::text)))))
  and (record_value is null or h.id=record_value) and (anchor_time_value is null or (h.recorded_at,h.id)<=(anchor_time_value,anchor_id_value)) and (after_time_value is null or (h.recorded_at,h.id)<(after_time_value,after_id_value))
  order by h.recorded_at desc,h.id desc limit least(greatest(coalesce(limit_value,101),1),101))
 ) bounded(id,recorded_at,item)
 where (record_value is null or bounded.id=record_value)
  and (anchor_time_value is null or (bounded.recorded_at,bounded.id)<=(anchor_time_value,anchor_id_value))
  and (after_time_value is null or (bounded.recorded_at,bounded.id)<(after_time_value,after_id_value))
 order by bounded.recorded_at desc,bounded.id desc limit least(greatest(coalesce(limit_value,101),1),101);
$$;

create function public.admin_financial_evidence_page_v1(target_namespace_id uuid,target_tenant_id uuid,collection_value text,target_customer_id uuid default null,target_invoice_id uuid default null,page_size integer default 25,cursor_value jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare role_value public.app_role;gen text;scope_hash text;anchor_time timestamptz;anchor_id uuid;after_time timestamptz;after_id uuid;
 started timestamptz:=statement_timestamp();items jsonb;has_more boolean;last_time timestamptz;last_id uuid;next_value jsonb;
begin
 select role into role_value from public.tenant_members where tenant_id=target_tenant_id and user_id=auth.uid() and status='active' and role in ('super_admin','manager','support','analyst');
 if auth.uid() is null or role_value is null then raise exception 'FSE_UNAVAILABLE' using errcode='42501';end if;
 if collection_value is null or collection_value not in ('observations','assessments','claims','allocations','refunds','history') or page_size is null or page_size not between 1 and 100 then raise exception 'FSE_INVALID' using errcode='22023';end if;
 select generation::text into gen from private.fse_scopes where namespace_id=target_namespace_id and tenant_id=target_tenant_id;
 if gen is null or (target_customer_id is not null and not exists(select 1 from public.customers where tenant_id=target_tenant_id and id=target_customer_id))
  or (target_invoice_id is not null and not exists(select 1 from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and (target_customer_id is null or customer_id=target_customer_id))) then return null;end if;
 scope_hash:=private.fse_hash(private.fse_canonical(jsonb_build_array(1,auth.uid(),role_value,target_tenant_id,target_namespace_id,collection_value,target_customer_id,target_invoice_id,page_size,'projection-v1')));
 if cursor_value is not null then
  if octet_length(cursor_value::text)>1024 or not private.fse_keys(cursor_value,array['version','scope_hash','generation','started_at','anchor_time','anchor_id','after_time','after_id'])
   or cursor_value->'version' is distinct from '1'::jsonb or cursor_value->>'version' is distinct from '1' or cursor_value->>'scope_hash' is distinct from scope_hash
   or not private.fse_strings(cursor_value,array['scope_hash','generation','started_at','anchor_time','anchor_id','after_time','after_id']) then raise exception 'FSE_CURSOR_INVALID' using errcode='22023';end if;
  if cursor_value->>'generation' is distinct from gen then raise exception 'FSE_CURSOR_REFRESH_REQUIRED' using errcode='40001';end if;
  started:=(cursor_value->>'started_at')::timestamptz;anchor_time:=(cursor_value->>'anchor_time')::timestamptz;anchor_id:=(cursor_value->>'anchor_id')::uuid;
  after_time:=(cursor_value->>'after_time')::timestamptz;after_id:=(cursor_value->>'after_id')::uuid;
  if not isfinite(started) or started>statement_timestamp()+interval '1 second' or started<statement_timestamp()-interval '30 minutes' or (after_time,after_id)>(anchor_time,anchor_id)
   or not exists(select 1 from private.fse_read_rows(target_namespace_id,target_tenant_id,collection_value,target_customer_id,target_invoice_id,role_value,limit_value=>1,record_value=>anchor_id) r where r.id=anchor_id and r.recorded_at=anchor_time)
   or not exists(select 1 from private.fse_read_rows(target_namespace_id,target_tenant_id,collection_value,target_customer_id,target_invoice_id,role_value,limit_value=>1,record_value=>after_id) r where r.id=after_id and r.recorded_at=after_time) then raise exception 'FSE_CURSOR_INVALID' using errcode='22023';end if;
 else
  select r.recorded_at,r.id into anchor_time,anchor_id from private.fse_read_rows(target_namespace_id,target_tenant_id,collection_value,target_customer_id,target_invoice_id,role_value,limit_value=>1) r order by r.recorded_at desc,r.id desc limit 1;
 end if;
 with page as materialized (
  select r.id,r.recorded_at,r.item from private.fse_read_rows(target_namespace_id,target_tenant_id,collection_value,target_customer_id,target_invoice_id,role_value,anchor_time,anchor_id,after_time,after_id,page_size+1) r
   where (anchor_time is null or (r.recorded_at,r.id)<=(anchor_time,anchor_id)) and (after_time is null or (r.recorded_at,r.id)<(after_time,after_id))
   order by r.recorded_at desc,r.id desc limit page_size+1
 ), numbered as (select *,row_number() over(order by recorded_at desc,id desc) rn from page)
 select coalesce(jsonb_agg(item order by recorded_at desc,id desc) filter(where rn<=page_size),'[]'::jsonb),count(*)>page_size,
  (array_agg(recorded_at order by recorded_at,id) filter(where rn<=page_size))[1],(array_agg(id order by recorded_at,id) filter(where rn<=page_size))[1]
 into items,has_more,last_time,last_id from numbered;
 if has_more then next_value:=jsonb_build_object('version',1,'scope_hash',scope_hash,'generation',gen,'started_at',started,'anchor_time',anchor_time,'anchor_id',anchor_id,'after_time',last_time,'after_id',last_id);end if;
 return jsonb_build_object('version',1,'collection',collection_value,'items',items,'has_more',has_more,'next_cursor',next_value,'page_size',page_size,'consistency','GENERATION_FENCED_KEYSET','financial_authority','NONE');
exception when invalid_text_representation or datetime_field_overflow then raise exception 'FSE_CURSOR_INVALID' using errcode='22023';
end;$$;

create function public.admin_financial_evidence_detail_v1(target_namespace_id uuid,target_tenant_id uuid,collection_value text,record_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare role_value public.app_role;result_value jsonb;
begin
 select role into role_value from public.tenant_members where tenant_id=target_tenant_id and user_id=auth.uid() and status='active' and role in ('super_admin','manager','support','analyst');
 if auth.uid() is null or role_value is null then raise exception 'FSE_UNAVAILABLE' using errcode='42501';end if;
 if collection_value is null or collection_value not in ('observations','assessments','claims','allocations','refunds','history') then raise exception 'FSE_INVALID' using errcode='22023';end if;
 select r.item into result_value from private.fse_read_rows(target_namespace_id,target_tenant_id,collection_value,null,null,role_value,limit_value=>1,record_value=>record_id) r where r.id=record_id;
 return result_value;
end;$$;

-- Every new helper is private, owner-only, and SECURITY INVOKER. The two public
-- functions above are read-only and independently authenticate tenant membership.
do $$declare f record;
begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and (p.proname like 'fse\_%' escape '\' or p.proname in ('prepare_financial_evidence_v1','record_financial_evidence_v1','read_financial_evidence_command_v1')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end;$$;
revoke all on function public.admin_financial_evidence_page_v1(uuid,uuid,text,uuid,uuid,integer,jsonb),public.admin_financial_evidence_detail_v1(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_financial_evidence_page_v1(uuid,uuid,text,uuid,uuid,integer,jsonb),public.admin_financial_evidence_detail_v1(uuid,uuid,text,uuid) to authenticated;
