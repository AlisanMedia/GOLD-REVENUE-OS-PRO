-- Dormant experiment persistence. Fixture-only, no runtime writer grant or hosted activation.
-- This is an alternative backend to the existing local journal, never a second billing ledger.
create table private.polat_experiment_runs(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),account_scope_hash text not null,authorization_record_hash text not null,
 binding jsonb not null,binding_hash text not null,request_count integer not null default 0,reserved_liability numeric not null default 0,
 event_sequence integer not null default 0,stop_reason text,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),unique(account_scope_hash,authorization_record_hash),
 check(request_count between 0 and 290 and request_count<=(binding->>'maximum_requests')::int and reserved_liability>=0 and reserved_liability<=(binding->>'maximum_spend')::numeric and event_sequence between 0 and 1024),
 check(binding_hash~'^[a-f0-9]{64}$'and account_scope_hash~'^[a-f0-9]{64}$'and authorization_record_hash~'^[a-f0-9]{64}$'),
 check(binding->>'mode'='OFFLINE_SYNTHETIC'and binding->>'financial_authority'='NONE'and binding->'execution_enabled'='false'::jsonb and binding->'authorized_external_requests'='0'::jsonb)
);
create table private.polat_experiment_attempts(
 id uuid primary key,tenant_id uuid not null,run_id uuid not null,ordinal integer not null,target_hash text not null,request_hash text not null,body_hash text not null,
 liability numeric not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,run_id,id),unique(run_id,ordinal),unique(run_id,target_hash),foreign key(tenant_id,run_id)references private.polat_experiment_runs(tenant_id,id),
 check(ordinal between 1 and 290 and liability>0 and target_hash~'^[a-f0-9]{64}$'and request_hash~'^[a-f0-9]{64}$'and body_hash~'^[a-f0-9]{64}$')
);
create table private.polat_experiment_evidence(
 id uuid primary key,tenant_id uuid not null,run_id uuid not null,attempt_id uuid not null,sequence integer not null,
 stage text not null check(stage in('DISPATCH_STARTED','PROVIDER_RESULT','RESULT_UNKNOWN','DELAYED_RESULT','RECONCILIATION','RUN_CANCELLED')),
 payload jsonb not null,command_hash text not null,previous_hash text,evidence_hash text not null,
 dispatch_key_hash text,deadline timestamptz,account_scope_hash text not null,response_identity_hash text,created_at timestamptz not null default clock_timestamp(),
 unique(run_id,sequence),foreign key(tenant_id,run_id,attempt_id)references private.polat_experiment_attempts(tenant_id,run_id,id),
 check(sequence between 1 and 1024 and octet_length(payload::text)<=8192 and command_hash~'^[a-f0-9]{64}$'and evidence_hash~'^[a-f0-9]{64}$')
);
create unique index polat_experiment_begin_once on private.polat_experiment_evidence(attempt_id)where stage='DISPATCH_STARTED';
create unique index polat_experiment_result_once on private.polat_experiment_evidence(attempt_id)where stage in('PROVIDER_RESULT','RESULT_UNKNOWN');
create unique index polat_experiment_response_once on private.polat_experiment_evidence(account_scope_hash,response_identity_hash)where stage='PROVIDER_RESULT'and response_identity_hash is not null;
create index polat_experiment_evidence_page on private.polat_experiment_evidence(tenant_id,run_id,sequence);
create trigger polat_experiment_attempt_immutable before update or delete on private.polat_experiment_attempts for each row execute function private.fse_immutable();
create trigger polat_experiment_evidence_immutable before update or delete on private.polat_experiment_evidence for each row execute function private.fse_immutable();
create function private.polat_experiment_run_guard()returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_op='DELETE'or to_jsonb(new)-array['request_count','reserved_liability','event_sequence','stop_reason']is distinct from to_jsonb(old)-array['request_count','reserved_liability','event_sequence','stop_reason']
 or new.request_count<old.request_count or new.reserved_liability<old.reserved_liability or new.event_sequence<old.event_sequence or(old.stop_reason is not null and new.stop_reason is distinct from old.stop_reason)
 then raise exception 'POLAT_EXPERIMENT_IMMUTABLE'using errcode='42501';end if;return new;
end;$$;
create trigger polat_experiment_run_immutable before update or delete on private.polat_experiment_runs for each row execute function private.polat_experiment_run_guard();
alter table private.polat_experiment_runs enable row level security;
alter table private.polat_experiment_attempts enable row level security;
alter table private.polat_experiment_evidence enable row level security;
revoke all on private.polat_experiment_runs,private.polat_experiment_attempts,private.polat_experiment_evidence from public,anon,authenticated,service_role;

create function private.polat_experiment_fixture_guard(t uuid)returns void language plpgsql stable set search_path=pg_catalog as $$begin
 if current_user<>'postgres'or not exists(select 1 from public.tenants where id=t and status='active'and slug like 'polat-sandbox-%'and not outbound_messaging_enabled)
 then raise exception 'POLAT_EXPERIMENT_UNAVAILABLE'using errcode='42501';end if;
end;$$;
create function private.polat_experiment_decimal(v text)returns numeric language plpgsql immutable set search_path=pg_catalog as $$begin
 if v is null or v!~'^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$'or length(replace(v,'.',''))>30 then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;return v::numeric;
end;$$;
create function private.polat_experiment_prepare_fixture(t uuid,r uuid,raw_value text)returns jsonb language plpgsql set search_path=pg_catalog as $$
declare b jsonb;h text;x private.polat_experiment_runs;k text;begin
 perform private.polat_experiment_fixture_guard(t);b:=private.fse_strict_json(raw_value);
 if not private.fse_keys(b,array['version','mode','provider','model','model_version','protocol_version','repository_sha','corpus_version','corpus_hash','plan_hash','manifest_hash','authorization_record_hash','account_scope_hash','profile_version','maximum_requests','maximum_spend','maximum_attempt_liability','currency','maximum_output_tokens','timeout_ms','targets','expires_at','financial_authority','live_operations_authorized','authorized_external_requests','execution_enabled'])
 or not private.fse_strings(b,array['mode','provider','model','model_version','protocol_version','repository_sha','corpus_version','corpus_hash','plan_hash','manifest_hash','authorization_record_hash','account_scope_hash','profile_version','maximum_spend','maximum_attempt_liability','currency','expires_at','financial_authority'])
 or b->'version'is distinct from '1'::jsonb or b->>'mode'is distinct from 'OFFLINE_SYNTHETIC'or b->>'provider'is distinct from 'anthropic'or b->>'model'is distinct from 'claude-haiku-5-5'or b->>'model_version'is distinct from 'claude-haiku-5-5'or b->>'protocol_version'is distinct from '2023-06-01'
 or b->>'corpus_version'not in('polat-multiturn-v2','polat-claude-canary-v1')or b->>'repository_sha'!~'^[a-f0-9]{40}$'or b->>'profile_version'!~'^[a-zA-Z0-9_.:-]{1,80}$'or b->>'currency'!~'^[A-Z]{3}$'
 or b->>'financial_authority'is distinct from 'NONE'or b->'live_operations_authorized'is distinct from 'false'::jsonb or b->'execution_enabled'is distinct from 'false'::jsonb or b->'authorized_external_requests'is distinct from '0'::jsonb
 or jsonb_typeof(b->'targets')is distinct from 'array'then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
 foreach k in array array['corpus_hash','plan_hash','manifest_hash','authorization_record_hash','account_scope_hash']loop if b->>k!~'^[a-f0-9]{64}$'then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;end loop;
 foreach k in array array['maximum_requests','maximum_output_tokens','timeout_ms']loop if jsonb_typeof(b->k)is distinct from 'number'or b->>k!~'^[1-9][0-9]{0,5}$'then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;end loop;
 if(b->>'maximum_requests')::int>290 or(b->>'maximum_output_tokens')::int>4096 or(b->>'timeout_ms')::int>60000 or jsonb_array_length(b->'targets')not between 1 and 290
 or(b->>'maximum_requests')::int>jsonb_array_length(b->'targets')or exists(select 1 from jsonb_array_elements(b->'targets')v where jsonb_typeof(v)<>'string'or v#>>'{}'!~'^[a-f0-9]{64}$')
 or(select count(distinct v)from jsonb_array_elements(b->'targets')v)<>jsonb_array_length(b->'targets')or private.polat_experiment_decimal(b->>'maximum_attempt_liability')<=0 or private.polat_experiment_decimal(b->>'maximum_spend')<private.polat_experiment_decimal(b->>'maximum_attempt_liability')
 or(b->>'expires_at')::timestamptz<=clock_timestamp()or(b->>'expires_at')::timestamptz>clock_timestamp()+interval '30 minutes'then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
 h:=private.fse_hash(private.fse_canonical(b));
 -- Global account/authorization lock first. A new run UUID/directory cannot reset this scope.
 perform pg_advisory_xact_lock(hashtextextended('POLAT_EXPERIMENT1:'||(b->>'account_scope_hash')||':'||(b->>'authorization_record_hash'),0));
 select * into x from private.polat_experiment_runs where account_scope_hash=b->>'account_scope_hash'and authorization_record_hash=b->>'authorization_record_hash'for update;
 if x.id is not null then
  if x.tenant_id<>t or x.binding_hash<>h then raise exception 'POLAT_EXPERIMENT_UNAVAILABLE'using errcode='42501';end if;
  return jsonb_build_object('run_id',x.id,'binding_hash',h,'replay',true,'financial_authority','NONE','execution_enabled',false);
 end if;
 if exists(select 1 from private.polat_experiment_runs where id=r)then raise exception 'POLAT_EXPERIMENT_UNAVAILABLE'using errcode='42501';end if;
 insert into private.polat_experiment_runs(id,tenant_id,account_scope_hash,authorization_record_hash,binding,binding_hash)values(r,t,b->>'account_scope_hash',b->>'authorization_record_hash',b,h);
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(t,'SYSTEM','polat.experiment_prepared','polat_experiment_runs',r::text,jsonb_build_object('mode','OFFLINE_SYNTHETIC','binding_hash',h,'financial_authority','NONE'));
 return jsonb_build_object('run_id',r,'binding_hash',h,'replay',false,'financial_authority','NONE','execution_enabled',false);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end;$$;

create function private.polat_experiment_reservation(a private.polat_experiment_attempts,x private.polat_experiment_runs,replayed boolean)returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('version',1,'mode','OFFLINE_SYNTHETIC','run_id',x.id,'attempt_id',a.id,'binding_hash',x.binding_hash,'request_hash',a.request_hash,'body_hash',a.body_hash,'target_hash',a.target_hash,'ordinal',a.ordinal,'generation','1','currency',x.binding->>'currency','liability',a.liability::text,'dispatch_started',exists(select 1 from private.polat_experiment_evidence where attempt_id=a.id and stage='DISPATCH_STARTED'),'replay',replayed,'financial_authority','NONE','live_operations_authorized',false)
$$;
create function private.polat_experiment_reserve_fixture(t uuid,r uuid,a_id uuid,target_value text,request_value text,body_value text,binding_value text)returns jsonb language plpgsql set search_path=pg_catalog as $$
declare x private.polat_experiment_runs;a private.polat_experiment_attempts;liability_value numeric;begin
 perform private.polat_experiment_fixture_guard(t);select * into x from private.polat_experiment_runs where tenant_id=t and id=r for update;
 if x.id is null then raise exception 'POLAT_EXPERIMENT_UNAVAILABLE'using errcode='42501';end if;
 if binding_value is distinct from x.binding_hash or target_value is null or not(x.binding->'targets'?target_value)or request_value is null or request_value!~'^[a-f0-9]{64}$'or body_value is null or body_value!~'^[a-f0-9]{64}$'then raise exception 'POLAT_EXPERIMENT_BINDING_CHANGED'using errcode='40001';end if;
 select * into a from private.polat_experiment_attempts where run_id=r and target_hash=target_value;
 if a.id is not null then
  if a.request_hash<>request_value or a.body_hash<>body_value then raise exception 'POLAT_EXPERIMENT_BINDING_CHANGED'using errcode='40001';end if;return private.polat_experiment_reservation(a,x,true);
 end if;
 if x.stop_reason is not null or(x.binding->>'expires_at')::timestamptz<=clock_timestamp()then raise exception 'POLAT_EXPERIMENT_STOPPED'using errcode='55000';end if;
 liability_value:=private.polat_experiment_decimal(x.binding->>'maximum_attempt_liability');
 if x.request_count>=(x.binding->>'maximum_requests')::int or x.reserved_liability+liability_value>private.polat_experiment_decimal(x.binding->>'maximum_spend')then raise exception 'POLAT_EXPERIMENT_LIMIT'using errcode='54000';end if;
 if exists(select 1 from private.polat_experiment_attempts where id=a_id)then raise exception 'POLAT_EXPERIMENT_UNAVAILABLE'using errcode='42501';end if;
 insert into private.polat_experiment_attempts(id,tenant_id,run_id,ordinal,target_hash,request_hash,body_hash,liability)values(a_id,t,r,x.request_count+1,target_value,request_value,body_value,liability_value)returning * into a;
 update private.polat_experiment_runs set request_count=request_count+1,reserved_liability=reserved_liability+liability_value where id=r returning * into x;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(t,'SYSTEM','polat.experiment_reserved','polat_experiment_attempts',a.id::text,jsonb_build_object('run_id',r,'ordinal',a.ordinal,'request_hash',request_value,'financial_authority','NONE'));
 return private.polat_experiment_reservation(a,x,false);
end;$$;

create function private.polat_experiment_append(x private.polat_experiment_runs,a private.polat_experiment_attempts,event_id uuid,kind text,p jsonb,key_hash text default null,deadline_value timestamptz default null)returns text language plpgsql set search_path=pg_catalog set timezone='UTC' as $$
declare prev text;h text;n integer;begin
 if x.event_sequence>=1024 then raise exception 'POLAT_EXPERIMENT_HISTORY_LIMIT'using errcode='54000';end if;
 n:=x.event_sequence+1;select evidence_hash into prev from private.polat_experiment_evidence where run_id=x.id order by sequence desc limit 1;
 h:=private.fse_hash(private.fse_canonical(jsonb_build_array('POLAT_EXPERIMENT_EVIDENCE1',x.binding_hash,a.id,n,kind,p,prev,key_hash,deadline_value)));
 insert into private.polat_experiment_evidence(id,tenant_id,run_id,attempt_id,sequence,stage,payload,command_hash,previous_hash,evidence_hash,dispatch_key_hash,deadline,account_scope_hash,response_identity_hash)
 values(event_id,x.tenant_id,x.id,a.id,n,kind,p,private.fse_hash(private.fse_canonical(p)),prev,h,key_hash,deadline_value,x.account_scope_hash,p->>'response_identity_hash');
 update private.polat_experiment_runs set event_sequence=n where id=x.id;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(x.tenant_id,'SYSTEM','polat.experiment_evidence','polat_experiment_attempts',a.id::text,jsonb_build_object('run_id',x.id,'stage',kind,'sequence',n,'evidence_hash',h,'financial_authority','NONE'));
 return h;
end;$$;

create function private.polat_experiment_begin_fixture(t uuid,r uuid,a_id uuid,binding_value text,key_value uuid,worker_value uuid)returns jsonb language plpgsql set search_path=pg_catalog as $$
declare x private.polat_experiment_runs;a private.polat_experiment_attempts;h text;begin
 perform private.polat_experiment_fixture_guard(t);select * into x from private.polat_experiment_runs where tenant_id=t and id=r for update;
 select * into a from private.polat_experiment_attempts where tenant_id=t and run_id=r and id=a_id for update;
 if x.id is null or a.id is null then raise exception 'POLAT_EXPERIMENT_UNAVAILABLE'using errcode='42501';end if;
 if binding_value is distinct from x.binding_hash or key_value is null or worker_value is null then raise exception 'POLAT_EXPERIMENT_BINDING_CHANGED'using errcode='40001';end if;
 if exists(select 1 from private.polat_experiment_evidence where attempt_id=a.id and stage='DISPATCH_STARTED')then return jsonb_build_object('dispatch',false,'state','ALREADY_STARTED_REVIEW_REQUIRED','financial_authority','NONE');end if;
 if x.stop_reason is not null or(x.binding->>'expires_at')::timestamptz<=clock_timestamp()then raise exception 'POLAT_EXPERIMENT_STOPPED'using errcode='55000';end if;
 -- One in-flight request per experiment. No lease expiry ever authorizes a resend.
 if exists(select 1 from private.polat_experiment_evidence e where e.run_id=r and e.stage='DISPATCH_STARTED'and not exists(select 1 from private.polat_experiment_evidence q where q.attempt_id=e.attempt_id and q.stage='RECONCILIATION'and q.payload->>'status'='SIMULATED_RECONCILED'))then raise exception 'POLAT_EXPERIMENT_UNSETTLED'using errcode='55000';end if;
 h:=private.polat_experiment_append(x,a,extensions.gen_random_uuid(),'DISPATCH_STARTED',jsonb_build_object('worker_hash',private.fse_hash(worker_value::text),'request_hash',a.request_hash,'body_hash',a.body_hash,'retry','NONE'),private.fse_hash(key_value::text),clock_timestamp()+make_interval(secs=>(x.binding->>'timeout_ms')::numeric/1000));
 return jsonb_build_object('dispatch',true,'state','FIXTURE_DISPATCH_RECORDED','evidence_hash',h,'financial_authority','NONE','authorized_external_requests',0);
end;$$;

create function private.polat_experiment_record_fixture(t uuid,r uuid,a_id uuid,binding_value text,key_value uuid,raw_value text)returns jsonb language plpgsql set search_path=pg_catalog as $$
declare x private.polat_experiment_runs;a private.polat_experiment_attempts;p jsonb;e private.polat_experiment_evidence;started private.polat_experiment_evidence;k text;effective_kind text;h text;reason_value text;v text;begin
 perform private.polat_experiment_fixture_guard(t);p:=private.fse_strict_json(raw_value);
 if octet_length(raw_value)>8192 or not private.fse_keys(p,array['version','evidence_id','stage','status','response_hash','response_identity_hash','elapsed_ms','input_tokens','output_tokens','qa','reconciliation_hash','simulated_billed_amount','currency','actual_billed_amount','actual_billed_currency','financial_authority','live_operations_authorized'])
 or p->'version'is distinct from '1'::jsonb or not private.fse_strings(p,array['evidence_id','stage','status','qa','currency','financial_authority'],array['response_hash','response_identity_hash','elapsed_ms','reconciliation_hash','simulated_billed_amount'])
 or p->>'financial_authority'is distinct from 'NONE'or p->'live_operations_authorized'is distinct from 'false'::jsonb or p->'actual_billed_amount'is distinct from 'null'::jsonb or p->'actual_billed_currency'is distinct from 'null'::jsonb
 or p->>'stage'not in('PROVIDER_RESULT','RESULT_UNKNOWN','DELAYED_RESULT','RECONCILIATION','RUN_CANCELLED')or p->>'status'not in('SUCCEEDED','FAILED','UNKNOWN','INCOMPLETE','CONFLICT','SIMULATED_RECONCILED','CANCELLED')or p->>'qa'not in('APPROVED','HELD','NOT_EVALUATED')then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
 foreach k in array array['response_hash','response_identity_hash','reconciliation_hash']loop if p->>k is not null and p->>k!~'^[a-f0-9]{64}$'then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;end loop;
 foreach k in array array['input_tokens','output_tokens']loop if p->k is distinct from 'null'::jsonb and(jsonb_typeof(p->k)is distinct from 'number'or p->>k!~'^(0|[1-9][0-9]{0,9})$'or(p->>k)::bigint>2147483647)then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;end loop;
 if p->>'elapsed_ms'is not null and p->>'elapsed_ms'!~'^(0|[1-9][0-9]{0,7})(\.[0-9]{1,8})?$'then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
 select * into x from private.polat_experiment_runs where tenant_id=t and id=r for update;select * into a from private.polat_experiment_attempts where tenant_id=t and run_id=r and id=a_id for update;
 if x.id is null or a.id is null then raise exception 'POLAT_EXPERIMENT_UNAVAILABLE'using errcode='42501';end if;
 if binding_value is distinct from x.binding_hash or p->>'currency'is distinct from x.binding->>'currency'then raise exception 'POLAT_EXPERIMENT_BINDING_CHANGED'using errcode='40001';end if;
 select * into e from private.polat_experiment_evidence where id=(p->>'evidence_id')::uuid;
 if e.id is not null then if e.tenant_id<>t or e.run_id<>r or e.attempt_id<>a_id or e.command_hash<>private.fse_hash(private.fse_canonical(p))then raise exception 'POLAT_EXPERIMENT_UNAVAILABLE'using errcode='42501';end if;return jsonb_build_object('recorded',true,'replay',true,'stage',e.stage,'evidence_hash',e.evidence_hash,'actual_billed_amount',null);end if;
 select * into started from private.polat_experiment_evidence where attempt_id=a_id and stage='DISPATCH_STARTED';
 k:=p->>'stage';effective_kind:=k;
 if k<>'RECONCILIATION'and(p->>'simulated_billed_amount'is not null or p->>'reconciliation_hash'is not null)then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
 if k<>'RUN_CANCELLED'and(started.id is null or key_value is null or private.fse_hash(key_value::text)is distinct from started.dispatch_key_hash)then raise exception 'POLAT_EXPERIMENT_UNAVAILABLE'using errcode='42501';end if;
 if k='PROVIDER_RESULT'then
  if p->>'status'not in('SUCCEEDED','FAILED')or p->>'simulated_billed_amount'is not null or p->>'reconciliation_hash'is not null then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
  if p->>'status'='SUCCEEDED'and(p->>'response_hash'is null or p->>'response_identity_hash'is null)then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
  if clock_timestamp()>started.deadline or exists(select 1 from private.polat_experiment_evidence where attempt_id=a_id and stage='RESULT_UNKNOWN')then effective_kind:='DELAYED_RESULT';end if;
 elsif k='RESULT_UNKNOWN'then
  if p->>'status'<>'UNKNOWN'or p->>'qa'<>'NOT_EVALUATED'or p->>'response_hash'is not null or p->>'response_identity_hash'is not null or p->>'input_tokens'is not null or p->>'output_tokens'is not null then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
 elsif k='DELAYED_RESULT'then
  if not(clock_timestamp()>started.deadline or exists(select 1 from private.polat_experiment_evidence where attempt_id=a_id and stage='RESULT_UNKNOWN'))then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
 elsif k='RECONCILIATION'then
  if p->>'status'not in('SIMULATED_RECONCILED','INCOMPLETE','CONFLICT')or p->>'reconciliation_hash'is null then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
  if p->>'status'='SIMULATED_RECONCILED'then
   if p->>'simulated_billed_amount'is null or private.polat_experiment_decimal(p->>'simulated_billed_amount')>a.liability or not exists(select 1 from private.polat_experiment_evidence where attempt_id=a_id and stage in('PROVIDER_RESULT','RESULT_UNKNOWN','DELAYED_RESULT'))then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
  elsif p->>'simulated_billed_amount'is not null then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
 elsif k='RUN_CANCELLED'and p->>'status'<>'CANCELLED'then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
 if p->>'response_identity_hash'is not null and exists(select 1 from private.polat_experiment_evidence where account_scope_hash=x.account_scope_hash and response_identity_hash=p->>'response_identity_hash'and attempt_id<>a_id)then raise exception 'POLAT_EXPERIMENT_RESPONSE_REPLAY'using errcode='23505';end if;
 h:=private.polat_experiment_append(x,a,(p->>'evidence_id')::uuid,effective_kind,p);
 reason_value:=case when effective_kind in('RESULT_UNKNOWN','DELAYED_RESULT')then 'UNKNOWN_REMOTE_COMPLETION'when p->>'qa'='HELD'then 'QA_REVIEW_REQUIRED'when k='RUN_CANCELLED'then 'OWNER_CANCELLED'else 'BILLING_UNVERIFIED'end;
 update private.polat_experiment_runs set stop_reason=coalesce(stop_reason,reason_value)where id=r;
 return jsonb_build_object('recorded',true,'replay',false,'stage',effective_kind,'evidence_hash',h,'actual_billed_amount',null);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end;$$;

create function private.polat_experiment_read_fixture(t uuid,r uuid,after_value integer default 0,limit_value integer default 25,anchor_value integer default null)returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare x private.polat_experiment_runs;n integer;items jsonb;more boolean;next_value integer;begin
 perform private.polat_experiment_fixture_guard(t);
 if after_value is null or after_value<0 or limit_value is null or limit_value not between 1 and 100 then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
 select * into x from private.polat_experiment_runs where tenant_id=t and id=r;
 if x.id is null then raise exception 'POLAT_EXPERIMENT_UNAVAILABLE'using errcode='42501';end if;
 n:=coalesce(anchor_value,x.event_sequence);if n<after_value or n>x.event_sequence then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
 with page as materialized(select sequence,attempt_id,stage,evidence_hash,previous_hash,created_at,payload->>'status'status from private.polat_experiment_evidence where tenant_id=t and run_id=r and sequence>after_value and sequence<=n order by sequence limit limit_value+1),shown as(select * from page order by sequence limit limit_value)
 select coalesce((select jsonb_agg(to_jsonb(s)order by sequence)from shown s),'[]'),(select count(*)from page)>limit_value,(select max(sequence)from shown)into items,more,next_value;
 return jsonb_build_object('version',1,'mode','OFFLINE_SYNTHETIC','run_id',r,'binding_hash',x.binding_hash,'request_count',x.request_count,'reserved_liability',x.reserved_liability::text,'currency',x.binding->>'currency','stop_reason',x.stop_reason,'actual_billed_amount',null,'financial_authority','NONE','authorized_external_requests',0,'execution_enabled',false,
  'reserved_not_dispatched',(select count(*)from private.polat_experiment_attempts a where a.run_id=r and not exists(select 1 from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage='DISPATCH_STARTED')),
  'completion_unresolved',(select count(*)from private.polat_experiment_attempts a where a.run_id=r and exists(select 1 from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage='DISPATCH_STARTED')and not exists(select 1 from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage='PROVIDER_RESULT')),
  'anchor',n,'has_newer',x.event_sequence>n,'items',items,'has_more',more,'next',case when more then next_value end);
end;$$;
-- No runtime writer, public RPC, service-role grant, key loader or activation function.
revoke all on function private.polat_experiment_run_guard(),private.polat_experiment_fixture_guard(uuid),private.polat_experiment_decimal(text),private.polat_experiment_prepare_fixture(uuid,uuid,text),private.polat_experiment_reservation(private.polat_experiment_attempts,private.polat_experiment_runs,boolean),private.polat_experiment_reserve_fixture(uuid,uuid,uuid,text,text,text,text),private.polat_experiment_append(private.polat_experiment_runs,private.polat_experiment_attempts,uuid,text,jsonb,text,timestamptz),private.polat_experiment_begin_fixture(uuid,uuid,uuid,text,uuid,uuid),private.polat_experiment_record_fixture(uuid,uuid,uuid,text,uuid,text),private.polat_experiment_read_fixture(uuid,uuid,integer,integer,integer)from public,anon,authenticated,service_role;
