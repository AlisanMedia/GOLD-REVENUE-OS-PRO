-- Durable SYNTHETIC pipeline only. No runtime writer grants or provider wiring.
alter table private.signal_sources add column fixture_offset bigint not null default 0 check(fixture_offset>=0), add column last_batch_hash text;
alter table private.signal_destinations add column last_scheduled_at timestamptz not null default 'epoch';
alter table private.signal_controls add column policy_revision bigint not null default 1;
alter table private.signal_providers add column revision bigint not null default 1;
alter table private.signal_sources add column revision bigint not null default 1;
alter table private.signal_destinations add column revision bigint not null default 1;
alter table private.signal_routes add column revision bigint not null default 1;
create function private.signal_policy_revision_fixture_v1() returns trigger language plpgsql set search_path=pg_catalog as $$
declare changed boolean;begin
 if tg_table_name='signal_controls' then
  new.policy_revision:=old.policy_revision+case when new.enabled is distinct from old.enabled then 1 else 0 end;return new;
 end if;
 changed:=(to_jsonb(new)-array['revision','last_scheduled_at','fixture_offset','last_batch_hash']) is distinct from (to_jsonb(old)-array['revision','last_scheduled_at','fixture_offset','last_batch_hash']);
 new.revision:=old.revision+case when changed then 1 else 0 end;
 if changed then insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data) values(new.tenant_id,'SYSTEM','signal.synthetic_policy_revision',tg_table_name,new.id,jsonb_build_object('revision',new.revision,'mode','SYNTHETIC'));end if;
 return new;
end;$$;
do $$declare n text;begin foreach n in array array['signal_controls','signal_providers','signal_sources','signal_destinations','signal_routes'] loop
 execute format('create trigger signal_policy_revision before update on private.%I for each row execute function private.signal_policy_revision_fixture_v1()',n);
end loop;end;$$;
create function private.signal_policy_hash_fixture_v1(t uuid,sid uuid,rid uuid,did uuid) returns text language sql stable set search_path=pg_catalog as $$
 select private.fse_hash(private.fse_canonical(jsonb_build_array('SIGPOLICY1',c.tenant_id,c.policy_revision,p.id,p.revision,s.id,s.revision,r.id,r.revision,d.id,d.revision)))
 from private.signal_controls c join private.signal_sources s on s.tenant_id=c.tenant_id and s.id=sid
 join private.signal_providers p on p.id=s.provider_id and p.tenant_id=s.tenant_id
 join private.signal_routes r on r.tenant_id=c.tenant_id and r.id=rid and r.source_id=s.id
 join private.signal_destinations d on d.tenant_id=r.tenant_id and d.id=r.destination_id and d.id=did where c.tenant_id=t
$$;

create table private.signal_deliveries (
 id uuid primary key default extensions.gen_random_uuid(),sequence bigint generated always as identity unique,
 tenant_id uuid not null,event_id uuid not null,route_id uuid not null,destination_id uuid not null,
 status text not null default 'PENDING' check(status in ('PENDING','RUNNING','RETRY','FAKE_CONFIRMED','UNKNOWN','REVIEW','STALE','NO_EFFECT','STALE_ACK')),
 claims integer not null default 0 check(claims between 0 and 7),reclaims integer not null default 0 check(reclaims between 0 and 2),failures integer not null default 0 check(failures between 0 and 5),
 lease_token uuid,lease_until timestamptz,dispatch_started boolean not null default false,
 available_at timestamptz not null default clock_timestamp(),enqueued_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 last_code text not null default 'QUEUED',last_result_hash text,policy_hash text not null check(policy_hash ~ '^[a-f0-9]{64}$'),
 unique(id,tenant_id),unique(tenant_id,event_id,route_id),
 foreign key(event_id,tenant_id) references private.signal_events(id,tenant_id),foreign key(route_id,tenant_id) references private.signal_routes(id,tenant_id),
 foreign key(destination_id,tenant_id) references private.signal_destinations(id,tenant_id)
);
create index signal_delivery_head on private.signal_deliveries(tenant_id,destination_id,sequence) where status in ('PENDING','RETRY','RUNNING','UNKNOWN');
create index signal_delivery_pending on private.signal_deliveries(tenant_id,sequence) where status in ('PENDING','RETRY');
create index signal_delivery_ack on private.signal_deliveries(tenant_id,completed_at desc,sequence desc) where completed_at is not null;
create index signal_events_source_sequence on private.signal_events(tenant_id,source_id,sequence desc);
create table private.signal_attempts (
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,delivery_id uuid not null,claim integer not null,
 operation_key text not null check(operation_key ~ '^[a-f0-9]{64}$'),operation text not null check(operation in ('SEND','EDIT','DELETE')),
 target_ref text,payload jsonb not null check(octet_length(payload::text)<=20000),started_at timestamptz not null default clock_timestamp(),
 unique(delivery_id,claim),foreign key(delivery_id,tenant_id) references private.signal_deliveries(id,tenant_id)
);
create table private.signal_delivery_history (
 id uuid primary key default extensions.gen_random_uuid(),sequence bigint generated always as identity unique,
 tenant_id uuid not null,delivery_id uuid not null,claim integer not null,code text not null check(length(code) between 1 and 64),
 evidence jsonb not null default '{}' check(octet_length(evidence::text)<=2048),recorded_at timestamptz not null default clock_timestamp(),
 foreign key(delivery_id,tenant_id) references private.signal_deliveries(id,tenant_id)
);
create index signal_history_delivery on private.signal_delivery_history(tenant_id,delivery_id,sequence desc);
create table private.signal_message_bindings (
 tenant_id uuid not null,source_id uuid not null,message_key text not null,destination_id uuid not null,
 message_ref text not null check(message_ref ~ '^fake-message:[A-Za-z0-9:_-]{1,120}$'),revision integer not null,event_id uuid not null,deleted boolean not null default false,
 primary key(tenant_id,source_id,message_key,destination_id),foreign key(event_id,tenant_id) references private.signal_events(id,tenant_id),
 foreign key(destination_id,tenant_id) references private.signal_destinations(id,tenant_id),foreign key(source_id,tenant_id) references private.signal_sources(id,tenant_id)
);
create trigger signal_attempts_immutable before update or delete on private.signal_attempts for each row execute function private.fse_immutable();
create trigger signal_history_immutable before update or delete on private.signal_delivery_history for each row execute function private.fse_immutable();

create function private.signal_fixture_history(j private.signal_deliveries,code_value text,evidence_value jsonb default '{}') returns void
language plpgsql set search_path=pg_catalog as $$begin
 insert into private.signal_delivery_history(tenant_id,delivery_id,claim,code,evidence) values(j.tenant_id,j.id,j.claims,code_value,evidence_value);
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)
 values(j.tenant_id,'SYSTEM','signal.synthetic_delivery','signal_delivery',j.id,jsonb_build_object('code',code_value,'mode','SYNTHETIC','financial_authority','NONE'));
end;$$;

create function private.signal_enqueue_fixture_event_v1() returns trigger language plpgsql set search_path=pg_catalog as $$
declare r record;j private.signal_deliveries; n integer:=0;state_value text;
begin
 perform private.signal_fixture_guard(new.tenant_id);
 for r in select x.id,x.destination_id from private.signal_routes x where x.tenant_id=new.tenant_id and x.source_id=new.source_id order by x.id limit 101 loop
  n:=n+1;if n>100 then raise exception 'SIGNAL_ROUTE_BOUND' using errcode='22023';end if;
  state_value:=case when exists(select 1 from private.signal_heads h where h.tenant_id=new.tenant_id and h.source_id=new.source_id and h.message_key=new.message_key and h.revision>=new.revision) then 'STALE'
   when new.kind in ('RESTRICTED','UNAVAILABLE') or new.parse_state='UNCERTAIN' then 'REVIEW' else 'PENDING' end;
  insert into private.signal_deliveries(tenant_id,event_id,route_id,destination_id,status,last_code,policy_hash)
  values(new.tenant_id,new.id,r.id,r.destination_id,state_value,case when new.kind='RESTRICTED' then 'SOURCE_RESTRICTED' when new.kind='UNAVAILABLE' then 'SOURCE_UNAVAILABLE' when new.parse_state='UNCERTAIN' then 'PARSE_UNCERTAIN' else state_value end,private.signal_policy_hash_fixture_v1(new.tenant_id,new.source_id,r.id,r.destination_id))
  returning * into j;
  perform private.signal_fixture_history(j,j.last_code);
 end loop;
 if n=0 then insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data) values(new.tenant_id,'SYSTEM','signal.synthetic_unrouted','signal_event',new.id,jsonb_build_object('mode','SYNTHETIC','code','NO_ROUTE'));end if;
 perform pg_notify('signal_fixture_dispatch','wake');return new;
end;$$;
create trigger signal_event_dispatch after insert on private.signal_events for each row execute function private.signal_enqueue_fixture_event_v1();

create function private.signal_record_fixture_batch_v1(t uuid,s uuid,expected_offset bigint,next_offset bigint,raw_events text[]) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare src private.signal_sources;raw_value text;v jsonb;h text;n integer:=0;
begin
 perform private.signal_fixture_guard(t);
 if expected_offset is null or next_offset is null or expected_offset<0 or next_offset<=expected_offset or next_offset-expected_offset>10000 or raw_events is null or cardinality(raw_events) not between 1 and 25
  or array_ndims(raw_events)<>1 or array_position(raw_events,null) is not null or octet_length(raw_events::text)>65536 then raise exception 'SIGNAL_BATCH_INVALID' using errcode='22023';end if;
 perform 1 from private.signal_controls where tenant_id=t for update;
 select * into src from private.signal_sources where tenant_id=t and id=s for update;
 if not found then raise exception 'signal scope unavailable' using errcode='42501';end if;
 h:=private.fse_hash(private.fse_canonical(jsonb_build_array('SIGBATCH1',t,s,expected_offset::text,next_offset::text,to_jsonb(raw_events))));
 if src.fixture_offset=next_offset and src.last_batch_hash=h then return jsonb_build_object('offset',next_offset::text,'replay',true);end if;
 if src.fixture_offset<>expected_offset then raise exception 'SIGNAL_CHECKPOINT_FENCED' using errcode='40001';end if;
 foreach raw_value in array raw_events loop
  v:=private.fse_strict_json(raw_value);
  if v->>'tenant_id' is distinct from t::text or v->>'source_id' is distinct from s::text then raise exception 'SIGNAL_BATCH_SCOPE' using errcode='22023';end if;
  perform private.signal_record_fixture_v1(raw_value);n:=n+1;
 end loop;
 update private.signal_sources set fixture_offset=next_offset,last_batch_hash=h where tenant_id=t and id=s;
 return jsonb_build_object('offset',next_offset::text,'replay',false,'processed',n);
end;$$;

create function private.signal_fixture_gate(j private.signal_deliveries) returns text language plpgsql stable set search_path=pg_catalog as $$
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

create function private.signal_claim_fixture_v1(t uuid) returns jsonb language plpgsql set search_path=pg_catalog as $$
declare j private.signal_deliveries;dest record;candidate record;code_value text;drained integer:=0;visited integer:=0;
begin
 perform private.signal_fixture_guard(t);
 if not pg_try_advisory_xact_lock(hashtextextended('SIGNAL_FIXTURE1:'||t::text,0)) then return jsonb_build_object('state','BUSY','drained',0,'has_more',true);end if;
 perform 1 from private.signal_controls where tenant_id=t and enabled for update;
 if not found then return jsonb_build_object('state','PAUSED','drained',0,'has_more',true);end if;
 for candidate in select x.id from private.signal_deliveries x join private.signal_events e on e.id=x.event_id and e.tenant_id=x.tenant_id
  join private.signal_heads h on h.tenant_id=e.tenant_id and h.source_id=e.source_id and h.message_key=e.message_key
  where x.tenant_id=t and x.status in ('PENDING','RETRY') and not x.dispatch_started and h.event_id<>e.id order by x.sequence limit 32 for update of x skip locked loop
  update private.signal_deliveries set status='STALE',last_code='SOURCE_STALE' where id=candidate.id returning * into j;
  perform private.signal_fixture_history(j,'SOURCE_STALE');drained:=drained+1;
 end loop;
 for dest in select d.id from private.signal_destinations d where d.tenant_id=t and not d.paused
  and exists(select 1 from private.signal_deliveries x where x.tenant_id=t and x.destination_id=d.id and x.status in ('PENDING','RETRY','RUNNING','UNKNOWN'))
  order by d.last_scheduled_at,d.id limit 16 for update of d skip locked loop
  visited:=visited+1;update private.signal_destinations set last_scheduled_at=clock_timestamp() where id=dest.id;
  select * into j from private.signal_deliveries where tenant_id=t and destination_id=dest.id and status in ('PENDING','RETRY','RUNNING','UNKNOWN') order by sequence limit 1 for update skip locked;
  if not found or j.status='UNKNOWN' or j.available_at>clock_timestamp() or (j.status='RUNNING' and j.lease_until>clock_timestamp()) then continue;end if;
  if j.status='RUNNING' then
   if j.dispatch_started then
    update private.signal_deliveries set status='UNKNOWN',last_code='UNKNOWN_EFFECT',lease_token=null,lease_until=null where id=j.id returning * into j;
    perform private.signal_fixture_history(j,'UNKNOWN_EFFECT');continue;
   end if;
   if j.reclaims>=2 then
    update private.signal_deliveries set status='REVIEW',last_code='LEASE_BUDGET',lease_token=null,lease_until=null where id=j.id returning * into j;
    perform private.signal_fixture_history(j,'LEASE_BUDGET');continue;
   end if;
   update private.signal_deliveries set reclaims=reclaims+1 where id=j.id returning * into j;
   perform private.signal_fixture_history(j,'LEASE_RECOVERED');
  end if;
  code_value:=private.signal_fixture_gate(j);
  if code_value is not null or j.claims>=7 then
   code_value:=coalesce(code_value,'CLAIM_BUDGET');
   update private.signal_deliveries set status=case when code_value='SOURCE_STALE' then 'STALE' else 'REVIEW' end,last_code=code_value,lease_token=null,lease_until=null where id=j.id returning * into j;
   perform private.signal_fixture_history(j,code_value);continue;
  end if;
  update private.signal_deliveries set status='RUNNING',claims=claims+1,dispatch_started=false,lease_token=extensions.gen_random_uuid(),lease_until=clock_timestamp()+interval '30 seconds',last_code='CLAIMED',last_result_hash=null where id=j.id returning * into j;
  perform private.signal_fixture_history(j,'CLAIMED');
  return jsonb_build_object('state','LEASED','mode','SYNTHETIC','tenant_id',t,'delivery_id',j.id,'lease_token',j.lease_token,'claim',j.claims,'drained',drained,'has_more',true);
 end loop;
 return jsonb_build_object('state','NO_LEASE','drained',drained,'visited',visited,'has_more',exists(select 1 from private.signal_deliveries where tenant_id=t and status in ('PENDING','RETRY','RUNNING','UNKNOWN') limit 1));
end;$$;

create function private.signal_begin_fixture_v1(t uuid,job_id uuid,token uuid) returns jsonb language plpgsql set search_path=pg_catalog as $$
declare j private.signal_deliveries;e private.signal_events;b private.signal_message_bindings;reply_ref text;dest_ref text;op text;op_key text;payload_value jsonb;code_value text;
begin
 perform private.signal_fixture_guard(t);perform 1 from private.signal_controls where tenant_id=t for update;
 select * into j from private.signal_deliveries where tenant_id=t and id=job_id for update;
 if not found or j.status<>'RUNNING' or j.lease_token is distinct from token or j.lease_until<=clock_timestamp() or j.dispatch_started then return jsonb_build_object('state','FENCED');end if;
 code_value:=private.signal_fixture_gate(j);
 if code_value is not null then
  update private.signal_deliveries set status=case when code_value='SOURCE_STALE' then 'STALE' else 'REVIEW' end,last_code=code_value,lease_token=null,lease_until=null where id=j.id returning * into j;
  perform private.signal_fixture_history(j,code_value);return jsonb_build_object('state','HELD');end if;
 select * into e from private.signal_events where id=j.event_id and tenant_id=t;
 select * into b from private.signal_message_bindings where tenant_id=t and source_id=e.source_id and message_key=e.message_key and destination_id=j.destination_id;
 op:=case when e.kind='DELETE' then 'DELETE' when b.message_ref is not null and not b.deleted then 'EDIT' else 'SEND' end;
 if op='DELETE' and (b.message_ref is null or b.deleted) then
  update private.signal_deliveries set status='NO_EFFECT',last_code='NO_DESTINATION_MESSAGE',lease_token=null,lease_until=null where id=j.id returning * into j;
  perform private.signal_fixture_history(j,'NO_DESTINATION_MESSAGE');return jsonb_build_object('state','NO_EFFECT');end if;
 if op='SEND' and e.kind='EDIT' and not exists(select 1 from private.signal_events where tenant_id=t and source_id=e.source_id and message_key=e.message_key and revision<e.revision and kind='MESSAGE' limit 1) then code_value:='REFERENCE_UNRESOLVED';end if;
 if e.original->>'reply_to' is not null then
  select message_ref into reply_ref from private.signal_message_bindings where tenant_id=t and source_id=e.source_id and message_key=e.original->>'reply_to' and destination_id=j.destination_id and not deleted;
  if reply_ref is null then code_value:='REFERENCE_UNRESOLVED';end if;
 end if;
 if op<>'DELETE' and ((e.original->>'original_text' is null and e.original->'attachments'='[]'::jsonb) or length(e.original->>'original_text')>4096) then code_value:='PAYLOAD_UNSUPPORTED';end if;
 if code_value is not null then
  update private.signal_deliveries set status='REVIEW',last_code=code_value,lease_token=null,lease_until=null where id=j.id returning * into j;
  perform private.signal_fixture_history(j,code_value);return jsonb_build_object('state','HELD');end if;
 select destination_ref into dest_ref from private.signal_destinations where id=j.destination_id and tenant_id=t;
 op_key:=private.fse_hash(private.fse_canonical(jsonb_build_array('SIGNAL_DELIVERY1',t,e.event_identity,j.route_id)));
 payload_value:=jsonb_build_object('version',1,'mode','SYNTHETIC','tenant_id',t,'operation_key',op_key,'operation',op,'destination_ref',dest_ref,'message_ref',case when op='SEND' then null else b.message_ref end,
  'reply_ref',reply_ref,'text',e.original->'original_text','attachments',e.original->'attachments','fact_hash',e.fact_hash,'observed_at',e.original->'observed_at');
 insert into private.signal_attempts(tenant_id,delivery_id,claim,operation_key,operation,target_ref,payload) values(t,j.id,j.claims,op_key,op,case when op='SEND' then null else b.message_ref end,payload_value);
 update private.signal_deliveries set dispatch_started=true,last_code='BEGUN' where id=j.id returning * into j;
 perform private.signal_fixture_history(j,'BEGUN',jsonb_build_object('operation',op));
 return jsonb_build_object('state','PREPARED','payload',payload_value);
end;$$;

create function private.signal_finish_fixture_v1(t uuid,job_id uuid,token uuid,raw_result text,reconciliation boolean default false) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare j private.signal_deliveries;e private.signal_events;a private.signal_attempts;v jsonb;h text;code_value text;new_state text;delay_value integer;
begin
 perform private.signal_fixture_guard(t);perform 1 from private.signal_controls where tenant_id=t for update;
 v:=private.fse_strict_json(raw_result);h:=private.fse_hash(private.fse_canonical(v));
 select * into j from private.signal_deliveries where tenant_id=t and id=job_id for update;
 if not found then return jsonb_build_object('state','FENCED');end if;
 if j.last_result_hash=h and j.status in ('FAKE_CONFIRMED','UNKNOWN','STALE_ACK') then return jsonb_build_object('state',j.status,'replay',true);end if;
 if reconciliation then
  if j.status<>'UNKNOWN' or v->>'outcome'<>'ACK' then return jsonb_build_object('state','FENCED');end if;
 elsif j.status<>'RUNNING' or j.lease_token is distinct from token or j.lease_until<=clock_timestamp() or not j.dispatch_started then return jsonb_build_object('state','FENCED');end if;
 select * into a from private.signal_attempts where tenant_id=t and delivery_id=j.id and claim=j.claims;
 if not found then return jsonb_build_object('state','FENCED');end if;
 select * into e from private.signal_events where tenant_id=t and id=j.event_id;
 if v->>'outcome'='ACK' then
  if not private.fse_keys(v,array['outcome','mode','tenant_id','operation_key','destination_ref','message_ref','fact_hash','acknowledged_at']) or v->>'mode' is distinct from 'SYNTHETIC'
   or v->>'tenant_id' is distinct from t::text or v->>'operation_key' is distinct from a.operation_key or v->>'destination_ref' is distinct from a.payload->>'destination_ref' or v->>'fact_hash' is distinct from e.fact_hash
   or v->>'acknowledged_at' is null or not isfinite((v->>'acknowledged_at')::timestamptz) or (v->>'acknowledged_at')::timestamptz>clock_timestamp()+interval '5 seconds' or (v->>'acknowledged_at')::timestamptz<a.started_at-interval '1 second'
   or coalesce(v->>'message_ref','') !~ '^fake-message:[A-Za-z0-9:_-]{1,120}$' or (a.operation<>'SEND' and v->>'message_ref' is distinct from a.target_ref) then raise exception 'SIGNAL_ACK_INVALID' using errcode='22023';end if;
  -- Historical acknowledgement is retained even if a newer source revision won.
  code_value:=private.signal_fixture_gate(j);new_state:=case when code_value is null then 'FAKE_CONFIRMED' when code_value='SOURCE_STALE' then 'STALE_ACK' else 'REVIEW' end;
  insert into private.signal_message_bindings(tenant_id,source_id,message_key,destination_id,message_ref,revision,event_id,deleted)
  values(t,e.source_id,e.message_key,j.destination_id,v->>'message_ref',e.revision,e.id,a.operation='DELETE')
  on conflict(tenant_id,source_id,message_key,destination_id) do update set message_ref=excluded.message_ref,revision=excluded.revision,event_id=excluded.event_id,deleted=excluded.deleted where private.signal_message_bindings.revision<=excluded.revision;
  update private.signal_deliveries set status=new_state,completed_at=clock_timestamp(),last_code=coalesce(code_value,case when reconciliation then 'RECONCILED_FAKE_ACK' else 'FAKE_ACK' end),last_result_hash=h,lease_token=null,lease_until=null where id=j.id returning * into j;
  perform private.signal_fixture_history(j,case when reconciliation then 'RECONCILED_FAKE_ACK' else 'FAKE_ACK' end,jsonb_build_object('mode','SYNTHETIC','message_ref',v->>'message_ref','destination_ref',v->>'destination_ref','operation',a.operation,'fact_hash',e.fact_hash,'acknowledged_at',v->>'acknowledged_at'));
 else
  if not private.fse_keys(v,array['outcome','retry_after_ms']) or coalesce(v->>'outcome','') not in ('KNOWN_FAILURE','RATE_LIMITED','UNKNOWN') then raise exception 'SIGNAL_RESULT_INVALID' using errcode='22023';end if;
  if v->>'outcome'='UNKNOWN' then new_state:='UNKNOWN';code_value:='UNKNOWN_EFFECT';
  else
   if v->'retry_after_ms'<>'null'::jsonb and (jsonb_typeof(v->'retry_after_ms')<>'number' or (v->>'retry_after_ms') !~ '^[0-9]{1,6}$' or (v->>'retry_after_ms')::int not between 1 and 300000) then raise exception 'SIGNAL_RESULT_INVALID' using errcode='22023';end if;
   j.failures:=j.failures+1;new_state:=case when j.failures>=5 then 'REVIEW' else 'RETRY' end;code_value:=case when j.failures>=5 then 'FAILURE_BUDGET' else v->>'outcome' end;
   delay_value:=greatest(coalesce((v->>'retry_after_ms')::integer,0),least(30000,(250*power(2,j.failures-1))::int));
  end if;
  update private.signal_deliveries set status=new_state,failures=j.failures,available_at=case when new_state='RETRY' then clock_timestamp()+make_interval(secs=>delay_value::double precision/1000) else available_at end,
   last_code=code_value,last_result_hash=h,lease_token=null,lease_until=null,dispatch_started=case when new_state='RETRY' then false else dispatch_started end where id=j.id returning * into j;
  perform private.signal_fixture_history(j,code_value);
 end if;
 return jsonb_build_object('state',j.status,'replay',false,'financial_authority','NONE');
end;$$;

-- Owner-only fixture pause control; no web/worker mutation authority.
create function private.signal_pause_fixture_v1(t uuid,kind_value text,id_value uuid,paused_value boolean) returns void language plpgsql set search_path=pg_catalog as $$
begin
 perform private.signal_fixture_guard(t);perform 1 from private.signal_controls where tenant_id=t for update;
 if paused_value is null then raise exception 'SIGNAL_POLICY_INVALID' using errcode='22023';end if;
 case kind_value
 when 'provider' then update private.signal_providers set paused=paused_value where tenant_id=t and id=id_value;
 when 'source' then update private.signal_sources set paused=paused_value where tenant_id=t and id=id_value;
 when 'destination' then update private.signal_destinations set paused=paused_value where tenant_id=t and id=id_value;
 when 'route' then update private.signal_routes set paused=paused_value where tenant_id=t and id=id_value;
 when 'global' then update private.signal_controls set enabled=not paused_value where tenant_id=t;
 else raise exception 'SIGNAL_POLICY_INVALID' using errcode='22023';end case;
 if not found then raise exception 'signal scope unavailable' using errcode='42501';end if;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,after_data) values(t,'SYSTEM','signal.synthetic_pause','signal_policy',jsonb_build_object('kind',kind_value,'paused',paused_value,'mode','SYNTHETIC'));
end;$$;

do $$declare n text;f record;begin
 foreach n in array array['signal_deliveries','signal_attempts','signal_delivery_history','signal_message_bindings'] loop
  execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 end loop;
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'signal_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 end loop;
end;$$;
revoke all on sequence private.signal_deliveries_sequence_seq,private.signal_delivery_history_sequence_seq from public,anon,authenticated,service_role;
