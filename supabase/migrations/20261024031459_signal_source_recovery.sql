-- Opt-in, fixture-only source continuity. No live account/session/provider authority.
create table private.signal_source_capabilities(
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,source_id uuid not null,epoch uuid not null,
 declaration jsonb not null check(octet_length(declaration::text)<=2048),created_at timestamptz not null default clock_timestamp(),
 unique(id,tenant_id,source_id),foreign key(source_id,tenant_id) references private.signal_sources(id,tenant_id)
);
create table private.signal_source_runtime(
 tenant_id uuid not null,source_id uuid not null,capability_id uuid not null,epoch uuid not null,generation integer not null default 1,
 authority_revision bigint not null default 1,last_sequence integer not null default 0 check(last_sequence>=0),
 state text not null default 'DISCONNECTED' check(state in('CONNECTED','DISCONNECTED','RECOVERING','GAP_DETECTED','SOURCE_RESTRICTED','UNRECOVERABLE','CONFLICT','LIMITED','BLOCKED')),
 last_activity_at timestamptz,disconnected_at timestamptz,recovery_required boolean not null default false,recovery_attempts integer not null default 0 check(recovery_attempts between 0 and 3),
 primary key(tenant_id,source_id),foreign key(capability_id,tenant_id,source_id) references private.signal_source_capabilities(id,tenant_id,source_id)
);
create table private.signal_source_observations(
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,source_id uuid not null,epoch uuid not null,
 sequence integer not null check(sequence>0),fact_hash text not null check(fact_hash~'^[a-f0-9]{64}$'),original jsonb not null check(octet_length(original::text)<=20000),
 recorded_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,source_id,epoch,sequence),foreign key(source_id,tenant_id) references private.signal_sources(id,tenant_id)
);
-- Original observations are immutable; promotion bookkeeping lives in the checkpoint.
create trigger signal_source_observations_immutable before update or delete on private.signal_source_observations for each row execute function private.fse_immutable();
create table private.signal_source_recovery_log(
 id uuid primary key default extensions.gen_random_uuid(),sequence bigint generated always as identity unique,
 tenant_id uuid not null,source_id uuid not null,command_id uuid not null,command_hash text not null,
 action text not null,outcome text not null,generation integer not null,processed integer not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,source_id,command_id),foreign key(source_id,tenant_id) references private.signal_sources(id,tenant_id)
);
create index signal_source_recovery_history on private.signal_source_recovery_log(tenant_id,source_id,sequence desc);
create trigger signal_source_caps_immutable before update or delete on private.signal_source_capabilities for each row execute function private.fse_immutable();
create trigger signal_source_log_immutable before update or delete on private.signal_source_recovery_log for each row execute function private.fse_immutable();

create function private.signal_source_result_v1(t uuid,s uuid,n integer default 0,replayed boolean default false) returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('version',1,'mode','SYNTHETIC','state',r.state,'generation',r.generation,'epoch',r.epoch,'last_sequence',r.last_sequence,'processed',n,'replay',replayed,
 'can_dispatch',coalesce(r.state='CONNECTED' and not r.recovery_required and r.last_activity_at>=statement_timestamp()-interval '60 seconds' and exists(select 1 from private.signal_controls c join private.signal_sources a on a.tenant_id=c.tenant_id and a.id=s join private.signal_providers p on p.tenant_id=a.tenant_id and p.id=a.provider_id where c.tenant_id=t and c.enabled and not a.paused and not p.paused and p.authorization_status='SYNTHETIC_APPROVED'),false),'financial_authority','NONE','live_operations_authorized',false)
 from private.signal_source_runtime r where r.tenant_id=t and r.source_id=s
$$;
create function private.signal_source_configure_fixture_v1(t uuid,s uuid,raw_caps text) returns jsonb language plpgsql set search_path=pg_catalog as $$
declare v jsonb;c uuid;e uuid:=extensions.gen_random_uuid();begin
 perform private.signal_fixture_guard(t);perform 1 from private.signal_controls where tenant_id=t for update;
 if not exists(select 1 from private.signal_sources where tenant_id=t and id=s) then raise exception 'source scope unavailable' using errcode='42501';end if;
 if raw_caps is null or octet_length(raw_caps)>2048 then raise exception 'SOURCE_CAPABILITY_INVALID' using errcode='22023';end if;v:=private.fse_strict_json(raw_caps);
 if not private.fse_keys(v,array['version','mode','adapter','identity_reference','member_role','authorization','protected_policy','events','sequence','recovery'])
 or v->'version' is distinct from '1'::jsonb or v->>'mode' is distinct from 'SYNTHETIC' or v->>'adapter' is distinct from 'FAKE' or v->>'authorization' is distinct from 'SYNTHETIC_ONLY'
 or v->>'protected_policy' is distinct from 'SOURCE_RESTRICTED' or coalesce(v->>'identity_reference','') !~ '^fixture:[A-Za-z0-9:._-]{1,100}$'
 or coalesce(v->>'member_role','') not in('MEMBER','SUPPLIER_FEED') or coalesce(v->>'sequence','') not in('MONOTONIC_INT','UNSUPPORTED') or coalesce(v->>'recovery','') not in('INDEPENDENT_FAKE_HISTORY','UNSUPPORTED')
 or jsonb_typeof(v->'events')<>'array' or jsonb_array_length(v->'events') not between 1 and 3 or exists(select 1 from jsonb_array_elements_text(v->'events')x(v)where x.v not in('MESSAGE','EDIT','DELETE'))
 or (select count(distinct x.v) from jsonb_array_elements_text(v->'events')x(v))<>jsonb_array_length(v->'events') then raise exception 'SOURCE_CAPABILITY_INVALID' using errcode='22023';end if;
 if exists(select 1 from private.signal_source_runtime where tenant_id=t and source_id=s)then raise exception 'SOURCE_CONFIG_IMMUTABLE' using errcode='42501';end if;
 insert into private.signal_source_capabilities(tenant_id,source_id,epoch,declaration)values(t,s,e,v)returning id into c;
 insert into private.signal_source_runtime(tenant_id,source_id,capability_id,epoch)values(t,s,c,e);
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(t,'SYSTEM','signal.synthetic_source_configured','signal_source',s,jsonb_build_object('mode','SYNTHETIC','financial_authority','NONE'));
 return private.signal_source_result_v1(t,s);
end;$$;
create function private.signal_source_packet_fixture_v1(t uuid,s uuid,e uuid,number_value integer,v jsonb) returns boolean language plpgsql set search_path=pg_catalog as $$
declare h text;old_h text;begin
 if number_value is null or number_value<1 or not private.fse_keys(v,array['version','mode','tenant_id','source_id','message_key','revision','kind','observed_at','published_at','reply_to','original_text','attachments','interpretation'])
 or v->'version' is distinct from '1'::jsonb or v->>'mode' is distinct from 'SYNTHETIC' or v->>'tenant_id' is distinct from t::text or v->>'source_id' is distinct from s::text
 or coalesce(v->>'kind','') not in('MESSAGE','EDIT','DELETE','RESTRICTED','UNAVAILABLE') or octet_length(v::text)>16384
 or (v->>'kind' in('DELETE','RESTRICTED','UNAVAILABLE') and (v->'original_text' is distinct from 'null'::jsonb or v->'interpretation' is distinct from 'null'::jsonb or v->'attachments' is distinct from '[]'::jsonb)) then raise exception 'SOURCE_PACKET_INVALID' using errcode='22023';end if;
 h:=private.fse_hash(private.fse_canonical(v-'observed_at'));select fact_hash into old_h from private.signal_source_observations where tenant_id=t and source_id=s and epoch=e and sequence=number_value;
 if found then if h<>old_h then raise exception 'SOURCE_SEQUENCE_CONFLICT' using errcode='23505';end if;return true;end if;
 insert into private.signal_source_observations(tenant_id,source_id,epoch,sequence,fact_hash,original)values(t,s,e,number_value,h,v);return false;
end;$$;
create function private.signal_source_command_fixture_v1(t uuid,s uuid,expected_generation integer,cmd uuid,raw_command text) returns jsonb language plpgsql set search_path=pg_catalog as $$
declare r private.signal_source_runtime;cap jsonb;v jsonb;h text;a text;entry_value jsonb;n integer:=0;i integer;from_value integer;to_value integer;prior_state text;prior_authority bigint;o private.signal_source_observations;old_hash text;event_value jsonb;reason text;clock_value timestamptz;
begin
 perform private.signal_fixture_guard(t);perform 1 from private.signal_controls where tenant_id=t for update;
 select * into r from private.signal_source_runtime where tenant_id=t and source_id=s for update;
 if not found then raise exception 'source scope unavailable' using errcode='42501';end if;
 if cmd is null or raw_command is null or octet_length(raw_command)>65536 then raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;v:=private.fse_strict_json(raw_command);h:=private.fse_hash(private.fse_canonical(v));
 select command_hash into old_hash from private.signal_source_recovery_log where tenant_id=t and source_id=s and command_id=cmd;
 if found then if h<>old_hash then raise exception 'SOURCE_COMMAND_CONFLICT' using errcode='22023';end if;return private.signal_source_result_v1(t,s,0,true);end if;
 if expected_generation is distinct from r.generation then raise exception 'SOURCE_CHECKPOINT_FENCED' using errcode='40001';end if;
 if v->>'epoch' is distinct from r.epoch::text then raise exception 'SOURCE_CHECKPOINT_FENCED' using errcode='40001';end if;
 a:=v->>'action';prior_state:=r.state;prior_authority:=r.authority_revision;select declaration into cap from private.signal_source_capabilities where id=r.capability_id and tenant_id=t and source_id=s;
 if a in('DISCONNECT','RECONNECT') then
  if not private.fse_keys(v,array['action','epoch','at']) then raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;
  clock_value:=(v->>'at')::timestamptz;if clock_value is null or not isfinite(clock_value)or clock_value>clock_timestamp()+interval '5 seconds' then raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;
  if a='DISCONNECT' then if r.state not in('SOURCE_RESTRICTED','UNRECOVERABLE','CONFLICT','BLOCKED','LIMITED')then r.state:='DISCONNECTED';end if;r.disconnected_at:=clock_value;r.recovery_required:=r.last_sequence>0 or r.recovery_required;
  elsif r.state in('SOURCE_RESTRICTED','UNRECOVERABLE','CONFLICT','BLOCKED','LIMITED') then r.state:=prior_state;
  elsif cap->>'sequence'<>'MONOTONIC_INT' then r.state:='LIMITED';
  elsif r.disconnected_at<clock_timestamp()-interval '15 minutes' or (r.last_sequence>0 and cap->>'recovery'<>'INDEPENDENT_FAKE_HISTORY') then r.state:='UNRECOVERABLE';
  else r.state:=case when r.last_sequence=0 and not exists(select 1 from private.signal_source_observations where tenant_id=t and source_id=s and epoch=r.epoch)then 'CONNECTED' else 'RECOVERING' end;end if;
 elsif a='OBSERVE' then
  if not private.fse_keys(v,array['action','epoch','sequence','event']) then raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;
  if jsonb_typeof(v->'sequence')<>'number' or (v->>'sequence') !~ '^[1-9][0-9]{0,9}$' or (v->>'sequence')::numeric>2147483647 then raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;
  begin perform private.signal_source_packet_fixture_v1(t,s,r.epoch,(v->>'sequence')::integer,v->'event');exception when unique_violation then r.state:='CONFLICT';end;
  r.last_activity_at:=clock_timestamp();
  if v#>>'{event,kind}'='RESTRICTED' then r.state:='SOURCE_RESTRICTED';
  elsif cap->>'sequence'<>'MONOTONIC_INT' then r.state:='LIMITED';
  elsif r.state in('CONNECTED','GAP_DETECTED','RECOVERING') then
   if r.recovery_required then r.state:='RECOVERING';elsif (v->>'sequence')::integer>r.last_sequence+1 then r.state:='GAP_DETECTED';end if;
  end if;
 elsif a='RECOVER' then
  if not private.fse_keys(v,array['action','epoch','page'])then raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;
  r.recovery_attempts:=least(3,r.recovery_attempts+1);
  event_value:=v->'page';
  if r.state in('SOURCE_RESTRICTED','CONFLICT','UNRECOVERABLE','LIMITED')then reason:='SOURCE_NOT_RECOVERABLE';
  elsif cap->>'recovery'<>'INDEPENDENT_FAKE_HISTORY' or cap->>'sequence'<>'MONOTONIC_INT' then reason:='SOURCE_CAPABILITY_UNKNOWN';
  elsif r.disconnected_at<clock_timestamp()-interval '15 minutes' then reason:='RECOVERY_WINDOW_EXPIRED';
  elsif not private.fse_keys(event_value,array['version','mode','origin','tenant_id','source_id','epoch','from','to','complete','entries'])or event_value->'version' is distinct from '1'::jsonb or event_value->>'mode' is distinct from 'SYNTHETIC'
   or event_value->>'origin' is distinct from 'INDEPENDENT_FAKE_HISTORY' or event_value->>'tenant_id' is distinct from t::text or event_value->>'source_id' is distinct from s::text or event_value->>'epoch' is distinct from r.epoch::text or event_value->'complete' is distinct from 'true'::jsonb then reason:='RECOVERY_INCOMPLETE';
  else
   begin
    if jsonb_typeof(event_value->'from') is distinct from 'number' or jsonb_typeof(event_value->'to') is distinct from 'number'
     or (event_value->>'from') !~ '^[1-9][0-9]{0,9}$' or (event_value->>'to') !~ '^[1-9][0-9]{0,9}$' then raise exception 'invalid range';end if;
    from_value:=(event_value->>'from')::integer;to_value:=(event_value->>'to')::integer;
    if from_value<>r.last_sequence+1 or to_value<from_value or to_value-from_value>=64 or jsonb_typeof(event_value->'entries')<>'array' or jsonb_array_length(event_value->'entries')<>to_value-from_value+1 then raise exception 'invalid range';end if;
    for i in from_value..to_value loop
     select value into entry_value from jsonb_array_elements(event_value->'entries') where value->>'sequence'=i::text;
     if not found or (select count(*) from jsonb_array_elements(event_value->'entries') where value->>'sequence'=i::text)<>1 or not private.fse_keys(entry_value,array['sequence','event']) or jsonb_typeof(entry_value->'sequence') is distinct from 'number' then raise exception 'missing range entry';end if;
     perform private.signal_source_packet_fixture_v1(t,s,r.epoch,i,entry_value->'event');
    end loop;
   exception when others then reason:='RECOVERY_CONFLICT_OR_INVALID';end;
  end if;
  if reason is null then r.state:='RECOVERING';r.last_activity_at:=clock_timestamp();else r.state:=case when r.recovery_attempts>=3 or reason in('SOURCE_NOT_RECOVERABLE','RECOVERY_WINDOW_EXPIRED')then 'UNRECOVERABLE' else 'RECOVERING' end;end if;
 else raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;
 -- No gap skipping: promote only consecutive observed events, at most64 per call.
 if reason is null and a in('OBSERVE','RECOVER') and (not r.recovery_required or a='RECOVER') and r.state in('CONNECTED','GAP_DETECTED','RECOVERING')then
  begin
   while n<64 loop
    select * into o from private.signal_source_observations where tenant_id=t and source_id=s and epoch=r.epoch and sequence=r.last_sequence+1;
    exit when not found;
    if o.original->>'kind' in('RESTRICTED','UNAVAILABLE') then r.state:=case when o.original->>'kind'='RESTRICTED'then 'SOURCE_RESTRICTED' else 'BLOCKED'end;exit;end if;
    if not (cap->'events' ? (o.original->>'kind')) then r.state:='BLOCKED';exit;end if;
    r.last_sequence:=o.sequence;n:=n+1;
   end loop;
   if r.state not in('SOURCE_RESTRICTED','BLOCKED')then
    r.state:=case when exists(select 1 from private.signal_source_observations where tenant_id=t and source_id=s and epoch=r.epoch and sequence>r.last_sequence)then 'GAP_DETECTED' else 'CONNECTED'end;
   end if;
   r.authority_revision:=prior_authority+case when r.state<>prior_state then 1 else 0 end;
   update private.signal_source_runtime set state=r.state,authority_revision=r.authority_revision,last_activity_at=r.last_activity_at where tenant_id=t and source_id=s;
   if n>0 then
    for o in select x.* from private.signal_source_observations x where x.tenant_id=t and x.source_id=s and x.epoch=r.epoch and x.sequence>r.last_sequence-n and x.sequence<=r.last_sequence order by x.sequence limit 64 loop
     perform private.signal_record_fixture_v1(o.original::text);
    end loop;
   end if;
  exception when others then n:=0;r.state:='BLOCKED';r.last_sequence:=(select last_sequence from private.signal_source_runtime where tenant_id=t and source_id=s);reason:='SOURCE_PACKET_INVALID';end;
 end if;
 r.authority_revision:=prior_authority+case when r.state<>prior_state then 1 else 0 end;
 if a='RECOVER' and reason is null and r.state='CONNECTED' then r.recovery_required:=false;r.disconnected_at:=null;end if;
 update private.signal_source_runtime set generation=generation+1,recovery_required=r.recovery_required,state=r.state,authority_revision=r.authority_revision,last_sequence=r.last_sequence,last_activity_at=r.last_activity_at,disconnected_at=r.disconnected_at,recovery_attempts=case when r.state='CONNECTED'then 0 else r.recovery_attempts end where tenant_id=t and source_id=s returning generation into r.generation;
 insert into private.signal_source_recovery_log(tenant_id,source_id,command_id,command_hash,action,outcome,generation,processed)values(t,s,cmd,h,a,coalesce(reason,r.state),r.generation,n);
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(t,'SYSTEM','signal.synthetic_source_transition','signal_source',s,jsonb_build_object('state',r.state,'generation',r.generation,'financial_authority','NONE'));
 return private.signal_source_result_v1(t,s,n);
end;$$;

create function private.signal_policy_hash_before_source_v1(t uuid,sid uuid,rid uuid,did uuid) returns text language sql stable set search_path=pg_catalog as $$
 select private.fse_hash(private.fse_canonical(jsonb_build_array('SIGPOLICY1',c.tenant_id,c.policy_revision,p.id,p.revision,s.id,s.revision,r.id,r.revision,d.id,d.revision)))
 from private.signal_controls c join private.signal_sources s on s.tenant_id=c.tenant_id and s.id=sid
 join private.signal_providers p on p.id=s.provider_id and p.tenant_id=s.tenant_id
 join private.signal_routes r on r.tenant_id=c.tenant_id and r.id=rid and r.source_id=s.id
 join private.signal_destinations d on d.tenant_id=r.tenant_id and d.id=r.destination_id and d.id=did where c.tenant_id=t
$$;

create function private.signal_gate_before_source_v1(j private.signal_deliveries) returns text language plpgsql stable set search_path=pg_catalog as $$
declare e private.signal_events;active_value boolean;
begin
 select * into e from private.signal_events where id=j.event_id and tenant_id=j.tenant_id;
 if not exists(select 1 from private.signal_heads where tenant_id=e.tenant_id and source_id=e.source_id and message_key=e.message_key and event_id=e.id) then return 'SOURCE_STALE';end if;
 select c.enabled and not s.paused and not p.paused and p.authorization_status='SYNTHETIC_APPROVED' and not r.paused and not d.paused into active_value
 from private.signal_controls c join private.signal_sources s on s.tenant_id=c.tenant_id and s.id=e.source_id
 join private.signal_providers p on p.id=s.provider_id and p.tenant_id=s.tenant_id
 join private.signal_routes r on r.tenant_id=c.tenant_id and r.id=j.route_id and r.source_id=s.id
 join private.signal_destinations d on d.id=r.destination_id and d.tenant_id=r.tenant_id
 where c.tenant_id=j.tenant_id and d.id=j.destination_id;
 if not coalesce(active_value,false) then return 'POLICY_DISABLED';end if;
 if j.policy_hash is distinct from private.signal_policy_hash_fixture_v1(j.tenant_id,e.source_id,j.route_id,j.destination_id) then return 'CONFIG_CHANGED';end if;
 if e.kind in ('RESTRICTED','UNAVAILABLE') then return 'SOURCE_RESTRICTED';end if;
 if e.kind<>'DELETE' and e.parse_state<>'STRUCTURED' then return 'PARSE_UNCERTAIN';end if;
 -- Conservative fixture-only freshness, not a LIVE signal SLA or provider policy.
 if (e.original->>'observed_at')::timestamptz>clock_timestamp() or (e.original->>'observed_at')::timestamptz<clock_timestamp()-interval '60 seconds' then return 'SOURCE_AGE_REVIEW';end if;
 return null;
end;$$;

create or replace function private.signal_policy_hash_fixture_v1(t uuid,sid uuid,rid uuid,did uuid) returns text language sql stable set search_path=pg_catalog as $$
 select case when r.source_id is null then b.h else private.fse_hash(private.fse_canonical(jsonb_build_array('SIG_SOURCE_POLICY1',b.h,r.epoch,r.authority_revision::text,r.capability_id)))end
 from(select private.signal_policy_hash_before_source_v1(t,sid,rid,did)h)b left join private.signal_source_runtime r on r.tenant_id=t and r.source_id=sid
$$;
create or replace function private.signal_fixture_gate(j private.signal_deliveries) returns text language plpgsql stable set search_path=pg_catalog as $$
declare code_value text;s uuid;begin
 code_value:=private.signal_gate_before_source_v1(j);if code_value is not null then return code_value;end if;
 select source_id into s from private.signal_events where tenant_id=j.tenant_id and id=j.event_id;
 if exists(select 1 from private.signal_source_runtime r where r.tenant_id=j.tenant_id and r.source_id=s and (r.state<>'CONNECTED' or r.recovery_required or r.last_activity_at is null or r.last_activity_at<clock_timestamp()-interval '60 seconds'))then return 'POLICY_DISABLED';end if;
 return null;
end;$$;
do $$declare n text;p record;begin
 foreach n in array array['signal_source_capabilities','signal_source_runtime','signal_source_observations','signal_source_recovery_log']loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);end loop;
 for p in select oid::regprocedure signature from pg_proc where pronamespace='private'::regnamespace and (proname like 'signal_source_%' or proname in('signal_policy_hash_before_source_v1','signal_gate_before_source_v1'))loop execute format('revoke all on function %s from public,anon,authenticated,service_role',p.signature);end loop;
end;$$;
revoke all on sequence private.signal_source_recovery_log_sequence_seq from public,anon,authenticated,service_role;
