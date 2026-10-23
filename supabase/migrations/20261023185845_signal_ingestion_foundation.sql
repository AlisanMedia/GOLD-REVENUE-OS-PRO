-- Offline synthetic fixtures only. No runtime writer or Telegram connection.
create table private.signal_controls (
 tenant_id uuid primary key references public.tenants(id), enabled boolean not null default false,
 generation bigint not null default 1 check(generation>0)
);
create table private.signal_providers (
 id uuid primary key, tenant_id uuid not null references private.signal_controls(tenant_id),
 label text not null check(length(label) between 1 and 100), adapter text not null default 'FAKE' check(adapter='FAKE'),
 authorization_status text not null default 'UNVERIFIED' check(authorization_status in ('UNVERIFIED','SYNTHETIC_APPROVED','REVOKED')),
 paused boolean not null default true, unique(id,tenant_id)
);
create table private.signal_sources (
 id uuid primary key, tenant_id uuid not null, provider_id uuid not null,
 label text not null check(length(label) between 1 and 100), source_ref text not null check(source_ref ~ '^fixture:[A-Za-z0-9:._-]{1,120}$'),
 paused boolean not null default true, unique(id,tenant_id), unique(tenant_id,provider_id,source_ref),
 foreign key(provider_id,tenant_id) references private.signal_providers(id,tenant_id)
);
create table private.signal_destinations (
 id uuid primary key, tenant_id uuid not null references private.signal_controls(tenant_id),
 label text not null check(length(label) between 1 and 100), destination_ref text not null check(destination_ref ~ '^fixture:[A-Za-z0-9:._-]{1,120}$'),
 paused boolean not null default true, unique(id,tenant_id), unique(tenant_id,destination_ref)
);
create table private.signal_routes (
 id uuid primary key, tenant_id uuid not null, source_id uuid not null,destination_id uuid not null, paused boolean not null default true,
 unique(id,tenant_id), unique(tenant_id,source_id,destination_id),
 foreign key(source_id,tenant_id) references private.signal_sources(id,tenant_id),
 foreign key(destination_id,tenant_id) references private.signal_destinations(id,tenant_id)
);
create table private.signal_events (
 id uuid primary key default extensions.gen_random_uuid(), sequence bigint generated always as identity unique,
 tenant_id uuid not null, source_id uuid not null, message_key text not null check(length(message_key) between 1 and 128),
 revision integer not null check(revision>0), kind text not null check(kind in ('MESSAGE','EDIT','DELETE','RESTRICTED','UNAVAILABLE')),
 event_identity text not null unique check(event_identity ~ '^[a-f0-9]{64}$'), fact_hash text not null check(fact_hash ~ '^[a-f0-9]{64}$'),
 original jsonb not null check(octet_length(original::text)<=20000), parse_state text not null check(parse_state in ('UNAVAILABLE','UNCERTAIN','STRUCTURED')),
 recorded_at timestamptz not null default clock_timestamp(), unique(tenant_id,source_id,message_key,revision),unique(id,tenant_id),
 foreign key(source_id,tenant_id) references private.signal_sources(id,tenant_id)
);
create index signal_events_tenant_sequence on private.signal_events(tenant_id,sequence);
create table private.signal_heads (
 tenant_id uuid not null,source_id uuid not null,message_key text not null,revision integer not null,event_id uuid not null,
 primary key(tenant_id,source_id,message_key), foreign key(event_id,tenant_id) references private.signal_events(id,tenant_id),
 foreign key(source_id,tenant_id) references private.signal_sources(id,tenant_id)
);
create trigger signal_events_immutable before update or delete on private.signal_events for each row execute function private.fse_immutable();

create function private.signal_fixture_guard(t uuid) returns void language plpgsql stable set search_path=pg_catalog as $$
begin
 if not exists(select 1 from public.tenants where id=t and slug like 'signal-sandbox-%' and status='active' and not outbound_messaging_enabled) then
  raise exception 'isolated signal fixture required' using errcode='42501';end if;
end;$$;

create function private.signal_fixture_configure_v1(t uuid,p uuid,s uuid,d uuid,r uuid,label_value text,source_value text,destination_value text,enabled_value boolean default false)
returns void language plpgsql set search_path=pg_catalog as $$
begin
 perform private.signal_fixture_guard(t);
 insert into private.signal_controls(tenant_id,enabled) values(t,enabled_value) on conflict(tenant_id) do nothing;
 insert into private.signal_providers(id,tenant_id,label,authorization_status,paused) values(p,t,label_value,'SYNTHETIC_APPROVED',not enabled_value) on conflict(id) do nothing;
 insert into private.signal_sources(id,tenant_id,provider_id,label,source_ref,paused) values(s,t,p,label_value,source_value,not enabled_value);
 insert into private.signal_destinations(id,tenant_id,label,destination_ref,paused) values(d,t,label_value,destination_value,not enabled_value) on conflict(id) do nothing;
 insert into private.signal_routes(id,tenant_id,source_id,destination_id,paused) values(r,t,s,d,not enabled_value);
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,after_data) values(t,'SYSTEM','signal.synthetic_configured','signal_source',jsonb_build_object('mode','SYNTHETIC','financial_authority','NONE'));
end;$$;

create function private.signal_record_fixture_v1(raw_value text) returns jsonb language plpgsql set search_path=pg_catalog as $$
declare v jsonb;t uuid;s uuid;e private.signal_events; hash_value text;identity_value text;parse_value text;i jsonb;x jsonb;
begin
 if raw_value is null or octet_length(raw_value)>16384 then raise exception 'SIGNAL_INVALID' using errcode='22023';end if;
 v:=private.fse_strict_json(raw_value);
 if not private.fse_keys(v,array['version','mode','tenant_id','source_id','message_key','revision','kind','observed_at','published_at','reply_to','original_text','attachments','interpretation'])
  or v->'version' is distinct from '1'::jsonb or v->>'mode' is distinct from 'SYNTHETIC' or coalesce(v->>'kind','') not in ('MESSAGE','EDIT','DELETE','RESTRICTED','UNAVAILABLE')
  or jsonb_typeof(v->'revision')<>'number' or (v->>'revision') !~ '^[1-9][0-9]{0,9}$' or (v->>'revision')::numeric>2147483647
  or jsonb_typeof(v->'message_key')<>'string' or length(v->>'message_key') not between 1 and 128 or v->>'message_key' ~ '[[:cntrl:]]'
  or jsonb_typeof(v->'attachments')<>'array' or jsonb_array_length(v->'attachments')>8
  or (v->'original_text'<>'null'::jsonb and (jsonb_typeof(v->'original_text')<>'string' or length(v->>'original_text')>12000))
  or (v->'reply_to'<>'null'::jsonb and (jsonb_typeof(v->'reply_to')<>'string' or length(v->>'reply_to') not between 1 and 128)) then
  raise exception 'SIGNAL_INVALID' using errcode='22023';end if;
 t:=(v->>'tenant_id')::uuid;s:=(v->>'source_id')::uuid;perform private.signal_fixture_guard(t);
 if v->>'observed_at' is null or (v->>'observed_at')::timestamptz>clock_timestamp()+interval '5 minutes'
  or (v->>'published_at')::timestamptz>(v->>'observed_at')::timestamptz+interval '5 minutes' then raise exception 'SIGNAL_INVALID' using errcode='22023';end if;
 -- One tenant lock orders configuration/ingestion commits; no network while held.
 perform 1 from private.signal_controls where tenant_id=t and enabled for update;
 if not found or not exists(select 1 from private.signal_sources a join private.signal_providers p on p.id=a.provider_id and p.tenant_id=a.tenant_id
  where a.id=s and a.tenant_id=t and not a.paused and not p.paused and p.authorization_status='SYNTHETIC_APPROVED') then
  raise exception 'signal scope unavailable' using errcode='42501';end if;
 i:=v->'interpretation';
 if v->>'kind' in ('DELETE','RESTRICTED','UNAVAILABLE') and (v->'original_text'<>'null'::jsonb or i<>'null'::jsonb or v->'attachments'<>'[]'::jsonb) then raise exception 'SIGNAL_INVALID' using errcode='22023';end if;
 for x in select value from jsonb_array_elements(v->'attachments') loop
  if not private.fse_keys(x,array['reference','kind','sha256']) or coalesce(x->>'reference','') !~ '^fixture:[A-Za-z0-9:._-]{1,120}$'
   or coalesce(x->>'kind','') not in ('IMAGE','VIDEO','DOCUMENT') or coalesce(x->>'sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'SIGNAL_INVALID' using errcode='22023';end if;
 end loop;
 if i<>'null'::jsonb then
  if not private.fse_keys(i,array['action','direction','symbol','order_type','entry','stop_loss','take_profits'])
   or coalesce(i->>'action','') not in ('OPEN','UPDATE','BREAK_EVEN','PARTIAL_PROFIT','CLOSE','CANCEL','COMMENTARY')
   or (i->'direction'<>'null'::jsonb and coalesce(i->>'direction','') not in ('BUY','SELL'))
   or (i->'order_type'<>'null'::jsonb and coalesce(i->>'order_type','') not in ('MARKET','LIMIT','STOP'))
   or (i->'symbol'<>'null'::jsonb and coalesce(i->>'symbol','') !~ '^[A-Z0-9._/-]{1,24}$')
   or jsonb_typeof(i->'entry')<>'array' or jsonb_array_length(i->'entry')>2 or jsonb_typeof(i->'take_profits')<>'array' or jsonb_array_length(i->'take_profits')>12 then raise exception 'SIGNAL_INVALID' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements((i->'entry')||(i->'take_profits')) q(level_value) where jsonb_typeof(q.level_value)<>'string') then raise exception 'SIGNAL_INVALID' using errcode='22023';end if;
  for x in select value from jsonb_array_elements((i->'entry')||(i->'take_profits')||jsonb_build_array(i->'stop_loss')) loop
   if x<>'null'::jsonb and (jsonb_typeof(x)<>'string' or (x#>>'{}') !~ '^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$') then raise exception 'SIGNAL_INVALID' using errcode='22023';end if;
  end loop;
 end if;
 parse_value:=case when v->>'kind' in ('DELETE','RESTRICTED','UNAVAILABLE') then 'UNAVAILABLE'
  when i='null'::jsonb or (i->>'action'='OPEN' and (i->>'direction' is null or i->>'symbol' is null or i->>'order_type' is null or (i->>'order_type'<>'MARKET' and i->'entry'='[]'::jsonb))) then 'UNCERTAIN' else 'STRUCTURED' end;
 hash_value:=private.fse_hash(private.fse_canonical(v-'observed_at'));
 identity_value:=private.fse_hash(private.fse_canonical(jsonb_build_array('SIGNAL1',t::text,s::text,v->>'message_key',v->>'revision')));
 select * into e from private.signal_events where event_identity=identity_value;
 if found then
  if e.fact_hash<>hash_value then raise exception 'SIGNAL_REPLAY_CONFLICT' using errcode='22023';end if;
  return jsonb_build_object('event_id',e.id,'sequence',e.sequence,'duplicate',true,'current',(select event_id=e.id from private.signal_heads where tenant_id=t and source_id=s and message_key=v->>'message_key'));
 end if;
 insert into private.signal_events(tenant_id,source_id,message_key,revision,kind,event_identity,fact_hash,original,parse_state)
 values(t,s,v->>'message_key',(v->>'revision')::int,v->>'kind',identity_value,hash_value,v,parse_value) returning * into e;
 insert into private.signal_heads(tenant_id,source_id,message_key,revision,event_id) values(t,s,e.message_key,e.revision,e.id)
 on conflict(tenant_id,source_id,message_key) do update set revision=excluded.revision,event_id=excluded.event_id where private.signal_heads.revision<excluded.revision;
 update private.signal_controls set generation=generation+1 where tenant_id=t;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)
 values(t,'SYSTEM','signal.synthetic_observed','signal_event',e.id,jsonb_build_object('kind',e.kind,'parse_state',parse_value,'financial_authority','NONE'));
 -- Advisory wake-up is not the ledger; reconnect reads durable rows instead.
 perform pg_notify('signal_fixture_events',t::text);
 return jsonb_build_object('event_id',e.id,'sequence',e.sequence,'duplicate',false,'current',(select event_id=e.id from private.signal_heads where tenant_id=t and source_id=s and message_key=e.message_key));
end;$$;

do $$declare n text;begin
 foreach n in array array['signal_controls','signal_providers','signal_sources','signal_destinations','signal_routes','signal_events','signal_heads'] loop
  execute format('alter table private.%I enable row level security',n);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 end loop;
end;$$;
revoke all on sequence private.signal_events_sequence_seq from public,anon,authenticated,service_role;
revoke all on function private.signal_fixture_guard(uuid) from public,anon,authenticated,service_role;
revoke all on function private.signal_fixture_configure_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function private.signal_record_fixture_v1(text) from public,anon,authenticated,service_role;
