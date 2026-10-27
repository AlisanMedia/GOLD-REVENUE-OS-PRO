-- One owner-selected Telegram Business connection for an isolated, free founder UAT.
-- No financial, subscription, VIP, signal-source or general outbound authority.
-- Candidate discovery is private short-lived metadata, never a public artifact
-- or an authenticated account/participant binding.
alter table private.private_beta_programs add column business_discovery jsonb;
alter table private.private_beta_programs add constraint private_beta_business_discovery_bound check(business_discovery is null or(jsonb_typeof(business_discovery)='object'and octet_length(business_discovery::text)<=32768));
create table private.private_beta_business_controls (
 tenant_id uuid not null, program_id uuid primary key,
 bot_id text not null, credential_sha256 text not null, representative_user_id text not null,
 founder_chat_id text not null, business_connection_id text not null,
 generation bigint not null default 1 check(generation between 1 and 999999999),
 configured_by uuid not null references public.app_users(id), configured_at timestamptz not null default clock_timestamp(),
 seal jsonb, observed_at timestamptz, expires_at timestamptz,
 restricted boolean not null default true, restricted_at timestamptz, restriction_reason text,
 reverify_at timestamptz, last_inbound_at timestamptz, last_inbound_message_id text, last_inbound_update_id text,
 foreign key(tenant_id,program_id) references private.private_beta_programs(tenant_id,id),
 unique(tenant_id,program_id), unique(bot_id,business_connection_id),
 check(bot_id~'^[1-9][0-9]{0,18}$' and representative_user_id~'^[1-9][0-9]{0,18}$' and founder_chat_id~'^[1-9][0-9]{0,18}$'),
 check(representative_user_id<>founder_chat_id and credential_sha256~'^[a-f0-9]{64}$'),
 check(octet_length(business_connection_id) between 1 and 160 and business_connection_id!~'[[:cntrl:][:space:]]')
);
create table private.private_beta_business_events (
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,program_id uuid not null,
 event_key text not null check(event_key~'^[a-f0-9]{64}$'),kind text not null,
 update_id text,provider_user_id text,provider_chat_id text,provider_message_id text,
 source_hash text not null check(source_hash~'^[a-f0-9]{64}$'),content_hash text,
 occurred_at timestamptz not null,control_generation bigint not null,
 action text not null check(action in('INBOUND','HELD','IGNORED')),evidence jsonb,
 created_at timestamptz not null default clock_timestamp(),
 unique(program_id,event_key),foreign key(tenant_id,program_id)references private.private_beta_business_controls(tenant_id,program_id),
 check(kind in('CONTROL_SEALED','INBOUND','HUMAN_REPLY','BOT_ECHO','EDIT','DELETE','CONNECTION_DISABLED','CONNECTION_OBSERVED','CALLBACK_CONFLICT')),
 check(content_hash is null or content_hash~'^[a-f0-9]{64}$'),check(evidence is null or octet_length(evidence::text)<=4096)
);
create index private_beta_business_event_source on private.private_beta_business_events(tenant_id,program_id,kind,provider_message_id,update_id);
alter table private.private_beta_business_controls enable row level security;
alter table private.private_beta_business_events enable row level security;
revoke all on private.private_beta_business_controls,private.private_beta_business_events from public,anon,authenticated,service_role;
create trigger private_beta_business_events_immutable before update or delete on private.private_beta_business_events for each row execute function private.fse_immutable();
create function private.private_beta_business_immutable()returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_op='DELETE' or(new.tenant_id,new.program_id,new.bot_id,new.credential_sha256,new.representative_user_id,new.founder_chat_id,new.business_connection_id,new.configured_by,new.configured_at)
 is distinct from(old.tenant_id,old.program_id,old.bot_id,old.credential_sha256,old.representative_user_id,old.founder_chat_id,old.business_connection_id,old.configured_by,old.configured_at)
 or new.generation<old.generation or(old.last_inbound_at is not null and(new.last_inbound_at is null or new.last_inbound_at<old.last_inbound_at))
 then raise exception 'PRIVATE_BETA_BUSINESS_IMMUTABLE'using errcode='42501';end if;return new;end;$$;
create trigger private_beta_business_control_bound before update or delete on private.private_beta_business_controls for each row execute function private.private_beta_business_immutable();

create function private.private_beta_business_discovery_record(t uuid,p uuid,expected_program_generation bigint,raw_value text)returns void language plpgsql set search_path=pg_catalog as $$
declare x private.private_beta_programs;v jsonb;c jsonb;chat jsonb;at_value timestamptz;expiry timestamptz;keys_seen text[]:='{}';chats_seen text[];digest text;k text;begin
 if current_user<>'postgres'then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 x:=private.private_beta_guard(t,p);select * into x from private.private_beta_programs where id=p for update;
 if x.stage<>'DRAFT'or exists(select 1 from private.private_beta_participants where tenant_id=t and program_id=p)
 or x.bot_control is null or x.bot_control->>'api_environment'is distinct from 'production'or x.configuration->>'repository_sha'is null
 then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 if x.generation is distinct from expected_program_generation then raise exception 'PRIVATE_BETA_REVISION_CHANGED'using errcode='40001';end if;
 if raw_value is null or octet_length(raw_value)>32768 then raise exception 'PRIVATE_BETA_BUSINESS_DISCOVERY_INVALID'using errcode='22023';end if;v:=private.fse_strict_json(raw_value);
 if not private.fse_keys(v,array['version','program_id','tenant_id','repository_sha','program_generation','bot_id','credential_sha256','source_hash','observed_at','expires_at','candidates'])
 or v->'version'is distinct from '1'::jsonb or v->>'program_id'is distinct from p::text or v->>'tenant_id'is distinct from t::text
 or v->>'repository_sha'is distinct from x.configuration->>'repository_sha'or v->>'program_generation'is distinct from x.generation::text
 or v->>'bot_id'is distinct from x.bot_control->>'bot_id'or v->>'credential_sha256'is distinct from x.bot_control->>'credential_sha256'
 or jsonb_typeof(v->'source_hash')is distinct from 'string'or v->>'source_hash'!~'^[a-f0-9]{64}$'
 or jsonb_typeof(v->'candidates')is distinct from 'array'or jsonb_array_length(v->'candidates')>10
 or jsonb_typeof(v->'observed_at')is distinct from 'string'or jsonb_typeof(v->'expires_at')is distinct from 'string'
 then raise exception 'PRIVATE_BETA_BUSINESS_DISCOVERY_INVALID'using errcode='22023';end if;
 foreach k in array array['program_id','tenant_id','repository_sha','program_generation','bot_id','credential_sha256','source_hash','observed_at','expires_at']loop
  if jsonb_typeof(v->k)is distinct from 'string'then raise exception 'PRIVATE_BETA_BUSINESS_DISCOVERY_INVALID'using errcode='22023';end if;
 end loop;
 at_value:=(v->>'observed_at')::timestamptz;expiry:=(v->>'expires_at')::timestamptz;
 if at_value is null or expiry is null or not isfinite(at_value)or not isfinite(expiry)or at_value>clock_timestamp()or at_value<clock_timestamp()-interval '5 minutes'
 or expiry<=clock_timestamp()or expiry>at_value+interval '5 minutes'
 or(x.configuration->>'expires_at'is not null and expiry>(x.configuration->>'expires_at')::timestamptz)
 then raise exception 'PRIVATE_BETA_BUSINESS_DISCOVERY_INVALID'using errcode='22023';end if;
 for c in select value from jsonb_array_elements(v->'candidates')loop
  if not private.fse_keys(c,array['business_connection_id','representative_user_id','update_id','source_hash','founder_chat_ids'])
  or jsonb_typeof(c->'business_connection_id')is distinct from 'string'or octet_length(c->>'business_connection_id')not between 1 and 160 or c->>'business_connection_id'~'[[:cntrl:][:space:]]'
  or c->>'business_connection_id'=any(keys_seen)
  or jsonb_typeof(c->'representative_user_id')is distinct from 'string'or c->>'representative_user_id'!~'^[1-9][0-9]{0,18}$'
  or jsonb_typeof(c->'update_id')is distinct from 'string'or c->>'update_id'!~'^(0|[1-9][0-9]{0,18})$'
  or jsonb_typeof(c->'source_hash')is distinct from 'string'or c->>'source_hash'!~'^[a-f0-9]{64}$'
  or jsonb_typeof(c->'founder_chat_ids')is distinct from 'array'or jsonb_array_length(c->'founder_chat_ids')>10
  then raise exception 'PRIVATE_BETA_BUSINESS_DISCOVERY_INVALID'using errcode='22023';end if;
  keys_seen:=array_append(keys_seen,c->>'business_connection_id');chats_seen:='{}';
  for chat in select value from jsonb_array_elements(c->'founder_chat_ids')loop
   if jsonb_typeof(chat)is distinct from 'string'or chat#>>'{}'!~'^[1-9][0-9]{0,18}$'or chat#>>'{}'=c->>'representative_user_id'or chat#>>'{}'=any(chats_seen)
   then raise exception 'PRIVATE_BETA_BUSINESS_DISCOVERY_INVALID'using errcode='22023';end if;
   chats_seen:=array_append(chats_seen,chat#>>'{}');
  end loop;
 end loop;
 digest:=private.fse_hash(private.fse_canonical(v));
 if x.business_discovery is not null and private.fse_hash(private.fse_canonical(x.business_discovery))=digest then return;end if;
 update private.private_beta_programs set business_discovery=v where id=p;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(t,'SYSTEM','private_beta.business_discovery','private_beta_programs',p::text,
  jsonb_build_object('discovery_hash',digest,'candidate_count',jsonb_array_length(v->'candidates'),'expires_at',v->>'expires_at','authority','CANDIDATE_ONLY'));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'PRIVATE_BETA_BUSINESS_DISCOVERY_INVALID'using errcode='22023';end;$$;

create function public.admin_private_beta_business_discovery_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare p private.private_beta_programs;v jsonb;begin
 perform private.private_beta_admin(target_tenant_id,true);perform private.private_beta_mfa_at();p:=private.private_beta_guard(target_tenant_id,program_id_value);
 if p.owner_user_id is distinct from auth.uid()then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;v:=p.business_discovery;
 if v is null or p.stage<>'DRAFT'or v->>'program_generation'is distinct from p.generation::text or v->>'program_id'is distinct from p.id::text or v->>'tenant_id'is distinct from target_tenant_id::text
 or v->>'repository_sha'is distinct from p.configuration->>'repository_sha'or v->>'bot_id'is distinct from p.bot_control->>'bot_id'or v->>'credential_sha256'is distinct from p.bot_control->>'credential_sha256'
 or(v->>'observed_at')::timestamptz>clock_timestamp()or(v->>'expires_at')::timestamptz<=clock_timestamp()
 then return null;end if;
 return v-'credential_sha256';end;$$;

create function public.admin_private_beta_business_configure_v1(target_tenant_id uuid,program_id_value uuid,configuration_value text,expected_generation_value bigint)returns jsonb
 language plpgsql security definer set search_path=pg_catalog as $$declare p private.private_beta_programs;b private.private_beta_business_controls;v jsonb;begin
 perform private.private_beta_admin(target_tenant_id,true);perform private.private_beta_mfa_at();p:=private.private_beta_guard(target_tenant_id,program_id_value);
 select * into p from private.private_beta_programs where id=p.id for update;
 if p.owner_user_id is distinct from auth.uid()or p.stage<>'DRAFT'or p.request_count<>0 or p.bot_control is null or p.bot_control->>'api_environment'is distinct from 'production'
 or exists(select 1 from private.private_beta_participants where program_id=p.id)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 if configuration_value is null or octet_length(configuration_value)>2048 then raise exception 'PRIVATE_BETA_BUSINESS_INVALID'using errcode='22023';end if;
 v:=private.fse_strict_json(configuration_value);
 if not private.fse_keys(v,array['representative_user_id','founder_chat_id','business_connection_id'])or jsonb_typeof(v->'representative_user_id')is distinct from 'string'or v->>'representative_user_id'!~'^[1-9][0-9]{0,18}$'
 or jsonb_typeof(v->'founder_chat_id')is distinct from 'string'or v->>'founder_chat_id'!~'^[1-9][0-9]{0,18}$'or v->>'representative_user_id'=v->>'founder_chat_id'
 or jsonb_typeof(v->'business_connection_id')is distinct from 'string'or octet_length(v->>'business_connection_id')not between 1 and 160 or v->>'business_connection_id'~'[[:cntrl:][:space:]]'
 then raise exception 'PRIVATE_BETA_BUSINESS_INVALID'using errcode='22023';end if;
 select * into b from private.private_beta_business_controls where program_id=p.id;
 if b.program_id is not null then
  if(b.representative_user_id,b.founder_chat_id,b.business_connection_id)is distinct from(v->>'representative_user_id',v->>'founder_chat_id',v->>'business_connection_id')then raise exception 'PRIVATE_BETA_BUSINESS_IMMUTABLE'using errcode='42501';end if;
 else
  if p.generation is distinct from expected_generation_value then raise exception 'PRIVATE_BETA_REVISION_CHANGED'using errcode='40001';end if;
  insert into private.private_beta_business_controls(tenant_id,program_id,bot_id,credential_sha256,representative_user_id,founder_chat_id,business_connection_id,configured_by)
  values(target_tenant_id,p.id,p.bot_control->>'bot_id',p.bot_control->>'credential_sha256',v->>'representative_user_id',v->>'founder_chat_id',v->>'business_connection_id',auth.uid())returning * into b;
  update private.private_beta_programs set generation=generation+1 where id=p.id returning * into p;
  insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.business_configured','private_beta_programs',p.id::text,
   jsonb_build_object('mode','BUSINESS','scope_hash',private.fse_hash(private.fse_canonical(v)),'allowlisted_chats',1,'authority','EXPECTED_BINDING_ONLY'));
 end if;
 return jsonb_build_object('program_id',p.id,'mode','BUSINESS','business_generation',b.generation::text,'program_generation',p.generation::text,'state',case when b.seal is null then 'UNVERIFIED'when b.restricted then 'BLOCKED'else 'INDEPENDENTLY_OBSERVED'end);
end;$$;

create function public.admin_private_beta_business_reverify_v1(target_tenant_id uuid,program_id_value uuid,expected_generation_value bigint)returns jsonb
 language plpgsql security definer set search_path=pg_catalog as $$declare p private.private_beta_programs;b private.private_beta_business_controls;begin
 perform private.private_beta_admin(target_tenant_id,true);perform private.private_beta_mfa_at();p:=private.private_beta_guard(target_tenant_id,program_id_value);
 select * into p from private.private_beta_programs where id=p.id for update;
 select * into b from private.private_beta_business_controls where tenant_id=target_tenant_id and program_id=p.id for update;
 if p.owner_user_id is distinct from auth.uid()or p.stage='STOPPED'or b.program_id is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 if b.generation is distinct from expected_generation_value then raise exception 'PRIVATE_BETA_REVISION_CHANGED'using errcode='40001';end if;
 update private.private_beta_business_controls set reverify_at=clock_timestamp(),generation=generation+1 where program_id=p.id returning * into b;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.business_reverification_requested','private_beta_programs',p.id::text,
  jsonb_build_object('business_generation',b.generation::text,'enabled_by_request',false));
 return jsonb_build_object('program_id',p.id,'business_generation',b.generation::text,'state','INDEPENDENT_REVERIFICATION_REQUIRED');end;$$;

-- Protected control process only. A callback, JSON flag, service role or ordinary
-- administrator cannot attest that Telegram granted account permissions.
create function private.private_beta_business_control_seed(t uuid,p uuid)returns jsonb language plpgsql stable set search_path=pg_catalog as $$declare x private.private_beta_programs;b private.private_beta_business_controls;begin
 if current_user<>'postgres'then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;x:=private.private_beta_guard(t,p);
 select * into b from private.private_beta_business_controls where tenant_id=t and program_id=p;
 if b.program_id is null or x.configuration->>'repository_sha'is null or x.configuration->>'expires_at'is null or x.bot_control->>'bot_id'is distinct from b.bot_id or x.bot_control->>'credential_sha256'is distinct from b.credential_sha256
 then raise exception 'PRIVATE_BETA_BUSINESS_UNVERIFIED'using errcode='55000';end if;
 return jsonb_build_object('version',1,'program_id',p,'tenant_id',t,'bot_id',b.bot_id,'credential_sha256',b.credential_sha256,'repository_sha',x.configuration->>'repository_sha',
  'representative_user_id',b.representative_user_id,'founder_chat_id',b.founder_chat_id,'business_connection_id',b.business_connection_id,'business_generation',b.generation::text,'program_generation',x.generation::text,'expires_at',x.configuration->>'expires_at');end;$$;
create function private.private_beta_business_control_record(t uuid,p uuid,raw_value text)returns void language plpgsql set search_path=pg_catalog as $$
declare x private.private_beta_programs;b private.private_beta_business_controls;v jsonb;at_value timestamptz;expiry timestamptz;proof_hash text;begin
 if current_user<>'postgres'then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;x:=private.private_beta_guard(t,p);
 select * into x from private.private_beta_programs where id=p for update;select * into b from private.private_beta_business_controls where tenant_id=t and program_id=p for update;
 if b.program_id is null or x.stage='STOPPED' or raw_value is null or octet_length(raw_value)>4096 then raise exception 'PRIVATE_BETA_BUSINESS_INVALID'using errcode='22023';end if;v:=private.fse_strict_json(raw_value);
 if not private.fse_keys(v,array['version','origin','bot_id','credential_sha256','repository_sha','business_connection_id','representative_user_id','expected_generation','enabled','can_reply','source_hash','observed_at','expires_at'])
 or v->'version'is distinct from '1'::jsonb or v->>'origin'is distinct from 'INDEPENDENT_TELEGRAM_BUSINESS_READ'
 or(v->>'bot_id',v->>'credential_sha256',v->>'business_connection_id',v->>'representative_user_id')is distinct from(b.bot_id,b.credential_sha256,b.business_connection_id,b.representative_user_id)
 or v->>'repository_sha'is distinct from x.configuration->>'repository_sha'or x.bot_control->>'bot_id'is distinct from b.bot_id or x.bot_control->>'credential_sha256'is distinct from b.credential_sha256
 or jsonb_typeof(v->'enabled')is distinct from 'boolean'or jsonb_typeof(v->'can_reply')is distinct from 'boolean'or v->>'source_hash'!~'^[a-f0-9]{64}$'
 or v->>'expected_generation'is null or v->>'expected_generation'!~'^[1-9][0-9]{0,8}$'then raise exception 'PRIVATE_BETA_BUSINESS_INVALID'using errcode='22023';end if;
 at_value:=(v->>'observed_at')::timestamptz;expiry:=(v->>'expires_at')::timestamptz;
 if at_value is null or expiry is null or not isfinite(at_value)or not isfinite(expiry)or at_value>clock_timestamp()or at_value<clock_timestamp()-interval '5 minutes'or expiry<=clock_timestamp()or expiry>(x.configuration->>'expires_at')::timestamptz
 then raise exception 'PRIVATE_BETA_BUSINESS_INVALID'using errcode='22023';end if;
 proof_hash:=private.fse_hash(private.fse_canonical(v));
 if b.seal is not null and private.fse_hash(private.fse_canonical(b.seal))=proof_hash then return;end if;
 if(v->>'expected_generation')::bigint<>b.generation then raise exception 'PRIVATE_BETA_REVISION_CHANGED'using errcode='40001';end if;
 if b.seal is not null and b.restricted and(v->>'enabled')::boolean and(v->>'can_reply')::boolean and(b.reverify_at is null or b.reverify_at<=b.restricted_at or b.reverify_at<clock_timestamp()-interval '5 minutes')
 then raise exception 'PRIVATE_BETA_BUSINESS_REVERIFICATION_REQUIRED'using errcode='42501';end if;
 update private.private_beta_business_controls set seal=v,observed_at=at_value,expires_at=expiry,generation=generation+1,
 restricted=not((v->>'enabled')::boolean and(v->>'can_reply')::boolean),restricted_at=case when not((v->>'enabled')::boolean and(v->>'can_reply')::boolean)then clock_timestamp()else null end,
 restriction_reason=case when not((v->>'enabled')::boolean and(v->>'can_reply')::boolean)then 'PROVIDER_PERMISSION_DENIED'else null end,reverify_at=null where program_id=p returning * into b;
 insert into private.private_beta_business_events(tenant_id,program_id,event_key,kind,source_hash,occurred_at,control_generation,action,evidence)
 values(t,p,proof_hash,'CONTROL_SEALED',v->>'source_hash',at_value,b.generation,'IGNORED',v);
 insert into private.private_beta_observations(tenant_id,program_id,command_id,kind,scenario,outcome,note)values(t,p,extensions.gen_random_uuid(),'BOT_CONTROL','BUSINESS_CONNECTION_READ','NOTE','Independent Telegram Business account observation recorded; each actual send still requires a fresh provider read.');
end;$$;

create function private.private_beta_business_permitted(x private.private_beta_programs,b private.private_beta_business_controls)returns boolean language sql stable set search_path=pg_catalog as $$
 select coalesce(b.program_id=x.id and b.tenant_id=x.tenant_id and b.seal is not null and not b.restricted and b.expires_at>clock_timestamp()
 and b.seal->'enabled'='true'::jsonb and b.seal->'can_reply'='true'::jsonb
 and b.seal->>'repository_sha'=x.configuration->>'repository_sha'and x.bot_control->>'bot_id'=b.bot_id and x.bot_control->>'credential_sha256'=b.credential_sha256,false)
$$;

create function public.admin_private_beta_business_scope_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare p private.private_beta_programs;b private.private_beta_business_controls;begin
 perform private.private_beta_admin(target_tenant_id,true);perform private.private_beta_mfa_at();p:=private.private_beta_guard(target_tenant_id,program_id_value);
 if p.owner_user_id is distinct from auth.uid()then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 select * into b from private.private_beta_business_controls where tenant_id=target_tenant_id and program_id=p.id;
 if b.program_id is null then return null;end if;
 return jsonb_build_object('version',1,'mode','BUSINESS','program_id',p.id,'business_generation',b.generation::text,'program_generation',p.generation::text,
 'state',case when b.seal is null then 'CONFIGURED_UNVERIFIED'when b.expires_at<=clock_timestamp()then 'EXPIRED'when p.stage='STOPPED'or not private.private_beta_business_permitted(p,b)then 'BLOCKED'else 'READY_FOR_FRESH_PROVIDER_READ'end,
 'representative_user_id',b.representative_user_id,'founder_chat_id',b.founder_chat_id,'connection_hash',private.fse_hash(b.business_connection_id),
 'configured_at',b.configured_at,'observed_at',b.observed_at,'expires_at',b.expires_at,'last_inbound_at',b.last_inbound_at,'restriction_reason',b.restriction_reason,'financial_authority','NONE');end;$$;
create function private.private_beta_business_stage_guard()returns trigger language plpgsql security definer set search_path=pg_catalog as $$declare b private.private_beta_business_controls;begin
 if new.stage is not distinct from old.stage or new.stage not in('FOUNDER','FRIENDS')then return new;end if;
 select * into b from private.private_beta_business_controls where tenant_id=new.tenant_id and program_id=new.id;
 if b.program_id is null then return new;end if;
 if new.stage='FRIENDS'then raise exception 'PRIVATE_BETA_BUSINESS_FOUNDER_ONLY'using errcode='42501';end if;
 if not private.private_beta_business_permitted(new,b)then raise exception 'PRIVATE_BETA_BUSINESS_UNVERIFIED'using errcode='55000';end if;return new;end;$$;
create trigger private_beta_business_program_stage before update of stage on private.private_beta_programs for each row execute function private.private_beta_business_stage_guard();

-- Move the accepted BOT implementations behind private wrappers, rather than
-- leaving a second public claim path that could bypass BUSINESS fences.
alter function public.private_beta_transport_config_v1(uuid,uuid)rename to private_beta_transport_bot_v1;
alter function public.private_beta_transport_bot_v1(uuid,uuid)set schema private;
revoke all on function private.private_beta_transport_bot_v1(uuid,uuid)from public,anon,authenticated,service_role;
create function public.private_beta_transport_config_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare x private.private_beta_programs;b private.private_beta_business_controls;v jsonb;begin
 v:=private.private_beta_transport_bot_v1(target_tenant_id,program_id_value);
 select * into b from private.private_beta_business_controls where tenant_id=target_tenant_id and program_id=program_id_value;
 if b.program_id is null then return v;end if;x:=private.private_beta_guard(target_tenant_id,program_id_value);
 if b.seal is null or b.expires_at<=clock_timestamp()then raise exception 'PRIVATE_BETA_BUSINESS_UNVERIFIED'using errcode='55000';end if;
 return v||jsonb_build_object('version',2,'mode','BUSINESS','representative_user_id',b.representative_user_id,'business_connection_id',b.business_connection_id,'founder_chat_id',b.founder_chat_id,
  'business_generation',b.generation::text,'enabled',private.private_beta_business_permitted(x,b),'can_reply',private.private_beta_business_permitted(x,b),'observed_at',b.observed_at,'expires_at',b.expires_at);end;$$;

create function private.private_beta_business_observed_message(m public.messages)returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(m.direction='outbound'and m.actor_type='SYSTEM'and m.actor_id='private-beta-telegram-human-observed'and m.status='sent'and m.provider_acknowledged_at is null
 and exists(select 1 from private.private_beta_business_events e join private.private_beta_business_controls b on b.tenant_id=e.tenant_id and b.program_id=e.program_id
 join public.messaging_provider_connections c on c.tenant_id=b.tenant_id and c.provider_account_ref=b.bot_id
 where e.tenant_id=m.tenant_id and e.kind='HUMAN_REPLY'and e.action='HELD'and m.idempotency_key='private-beta-business-human:'||e.id::text and m.provider_connection_id=c.id
 and e.provider_message_id=m.provider_message_id and e.provider_chat_id=m.provider_chat_id and e.content_hash=private.fse_hash(m.content)),false)
$$;

-- Existing conversation triggers remain authoritative for all other messages.
create or replace function private.escalation_message_guard()returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare e public.escalation_cases;c public.conversations;begin
 if new.direction<>'outbound'then return new;end if;
 select * into c from public.conversations where tenant_id=new.tenant_id and id=new.conversation_id for update;
 select * into e from public.escalation_cases where tenant_id=new.tenant_id and conversation_id=c.id and status<>'RESOLVED'order by created_at desc limit 1;
 if private.private_beta_notice_message(new)or private.private_beta_business_observed_message(new)then return new;end if;
 if new.actor_type='HUMAN'then
  if e.id is not null then
   if e.status<>'IN_PROGRESS'or e.assigned_to is distinct from auth.uid()or not private.has_tenant_role(new.tenant_id,array['super_admin','manager']::public.app_role[])then raise exception 'case takeover required before manual reply'using errcode='42501';end if;
   if exists(select 1 from public.messages where id=e.safe_reply_id and status='sending')then raise exception 'safe response in flight'using errcode='55000';end if;
   update public.messages set status='failed',failure_code='HUMAN_REPLY_SUPERSEDES_ACK'where id=e.safe_reply_id and status in('pending','retry_scheduled');
  end if;return new;
 end if;
 if new.actor_id='escalation-safe-reply'then
  if e.id is null or private.escalation_rank(e.severity)<3 or new.content is distinct from private.escalation_safe_text(e.locale)or new.reply_to_message_id is distinct from e.source_message_id or new.idempotency_key is distinct from 'escalation-safe:'||e.id::text then raise exception 'safe response authority denied'using errcode='42501';end if;
 elsif(e.id is not null and private.escalation_rank(e.severity)>=3)or(c.escalation_return_boundary is not null and(new.created_at<c.escalation_return_boundary or new.reply_to_message_id is null or exists(select 1 from public.messages where id=new.reply_to_message_id and created_at<c.escalation_return_boundary)))then raise exception 'escalation blocks automatic reply'using errcode='42501';end if;return new;end;$$;

create function public.private_beta_business_event_v1(target_tenant_id uuid,program_id_value uuid,event_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p private.private_beta_programs;b private.private_beta_business_controls;v jsonb;e private.private_beta_business_events;old private.private_beta_business_events;
 a private.private_beta_participants;c public.conversations;at_value timestamptz;key_value text;conflict_key text;action_value text;source_mid uuid;begin
 p:=private.private_beta_guard(target_tenant_id,program_id_value);select * into p from private.private_beta_programs where id=p.id for update;
 select * into b from private.private_beta_business_controls where tenant_id=target_tenant_id and program_id=p.id for update;
 if b.program_id is null then return jsonb_build_object('accepted',false,'duplicate',false,'action','IGNORED','business_generation','0');end if;
 if event_value is null or octet_length(event_value)>8192 then raise exception 'PRIVATE_BETA_BUSINESS_INVALID'using errcode='22023';end if;v:=private.fse_strict_json(event_value);
 if not private.fse_keys(v,array['version','kind','update_id','business_connection_id','provider_user_id','provider_chat_id','provider_message_id','source_hash','occurred_at','content'])
 or v->'version'is distinct from '1'::jsonb or jsonb_typeof(v->'kind')is distinct from 'string'or v->>'kind'not in('INBOUND','HUMAN_REPLY','BOT_ECHO','EDIT','DELETE','CONNECTION_DISABLED','CONNECTION_OBSERVED')
 or jsonb_typeof(v->'update_id')is distinct from 'string'or v->>'update_id'!~'^(0|[1-9][0-9]{0,18})$'or jsonb_typeof(v->'source_hash')is distinct from 'string'or v->>'source_hash'!~'^[a-f0-9]{64}$'
 or jsonb_typeof(v->'occurred_at')is distinct from 'string'
 or(v->>'provider_user_id'is not null and jsonb_typeof(v->'provider_user_id')is distinct from 'string')
 or(v->>'provider_chat_id'is not null and jsonb_typeof(v->'provider_chat_id')is distinct from 'string')
 or(v->>'provider_message_id'is not null and(jsonb_typeof(v->'provider_message_id')is distinct from 'string'or v->>'provider_message_id'!~'^[1-9][0-9]{0,18}$'))
 or(v->>'kind'='HUMAN_REPLY'and(jsonb_typeof(v->'content')is distinct from 'string'or length(v->>'content')not between 1 and 4096))
 or(v->>'kind'<>'HUMAN_REPLY'and v->'content'is distinct from 'null'::jsonb)
 then raise exception 'PRIVATE_BETA_BUSINESS_INVALID'using errcode='22023';end if;
 if v->>'business_connection_id'is distinct from b.business_connection_id
 or(v->>'kind'in('CONNECTION_DISABLED','CONNECTION_OBSERVED')and(v->>'provider_user_id'is distinct from b.representative_user_id or v->>'provider_chat_id'is not null or v->>'provider_message_id'is not null))
 or(v->>'kind'not in('CONNECTION_DISABLED','CONNECTION_OBSERVED')and(v->>'provider_chat_id'is distinct from b.founder_chat_id or v->>'provider_message_id'is null))
 or(v->>'kind'='INBOUND'and v->>'provider_user_id'is distinct from b.founder_chat_id)
 or(v->>'kind'='HUMAN_REPLY'and v->>'provider_user_id'is distinct from b.representative_user_id)
 or(v->>'kind'='EDIT'and coalesce(v->>'provider_user_id','')not in(b.founder_chat_id,b.representative_user_id))
 or(v->>'kind'='BOT_ECHO'and coalesce(v->>'provider_user_id','')not in(b.bot_id,b.representative_user_id))
 or(v->>'kind'='DELETE'and v->>'provider_user_id'is not null and v->>'provider_user_id'not in(b.founder_chat_id,b.representative_user_id))
 then return jsonb_build_object('accepted',false,'duplicate',false,'action','IGNORED','business_generation','0');end if;
 at_value:=(v->>'occurred_at')::timestamptz;
 if at_value is null or not isfinite(at_value)or at_value>clock_timestamp()+interval '5 seconds'then raise exception 'PRIVATE_BETA_BUSINESS_INVALID'using errcode='22023';end if;
 key_value:=private.fse_hash(private.fse_canonical(jsonb_build_array('BUSINESS_CALLBACK1',b.business_connection_id,v->>'kind',v->>'update_id',v->>'provider_message_id')));
 select * into old from private.private_beta_business_events where program_id=p.id and event_key=key_value;
 if old.id is null then
  select * into old from private.private_beta_business_events where program_id=p.id and update_id=v->>'update_id'
   and(source_hash is distinct from v->>'source_hash'or kind is distinct from v->>'kind'or(kind<>'DELETE'and provider_message_id is distinct from v->>'provider_message_id'))
   order by created_at,id limit 1;
 end if;
 if old.id is not null then
  if old.event_key=key_value and old.source_hash=v->>'source_hash'and old.content_hash is not distinct from(case when v->>'kind'='HUMAN_REPLY'then private.fse_hash(v->>'content')end)then
   return jsonb_build_object('accepted',true,'duplicate',true,'action',case when old.action='INBOUND'and(b.restricted or old.control_generation<>b.generation)then 'HELD'else old.action end,'business_generation',b.generation::text);
  end if;
  conflict_key:=private.fse_hash(private.fse_canonical(jsonb_build_array('BUSINESS_CONFLICT1',key_value,v->>'source_hash')));
  if not exists(select 1 from private.private_beta_business_events where program_id=p.id and event_key=conflict_key)then
   update private.private_beta_business_controls set restricted=true,restricted_at=clock_timestamp(),restriction_reason='CALLBACK_CONFLICT',generation=generation+1 where program_id=p.id returning * into b;
   insert into private.private_beta_business_events(tenant_id,program_id,event_key,kind,source_hash,occurred_at,control_generation,action)values(target_tenant_id,p.id,conflict_key,'CALLBACK_CONFLICT',v->>'source_hash',at_value,b.generation,'HELD');
  end if;
  return jsonb_build_object('accepted',false,'duplicate',true,'action','HELD','business_generation',b.generation::text);
 end if;
 action_value:=case when v->>'kind'='INBOUND'and private.private_beta_business_permitted(p,b)and at_value>clock_timestamp()-interval '24 hours'
  and(b.last_inbound_at is null or(at_value,(v->>'update_id')::numeric)>=(b.last_inbound_at,coalesce(b.last_inbound_update_id,'0')::numeric))then 'INBOUND'
 when v->>'kind'in('BOT_ECHO','CONNECTION_OBSERVED')then 'IGNORED'else 'HELD'end;
 if action_value='INBOUND'then update private.private_beta_business_controls set last_inbound_at=at_value,last_inbound_message_id=v->>'provider_message_id',last_inbound_update_id=v->>'update_id'where program_id=p.id returning * into b;
 elsif v->>'kind'not in('BOT_ECHO','CONNECTION_OBSERVED')then
  update private.private_beta_business_controls set generation=generation+1,restricted=restricted or v->>'kind'in('EDIT','DELETE','CONNECTION_DISABLED'),restricted_at=case when v->>'kind'in('EDIT','DELETE','CONNECTION_DISABLED')then clock_timestamp()else restricted_at end,
   restriction_reason=case when v->>'kind'in('EDIT','DELETE','CONNECTION_DISABLED')then v->>'kind'else restriction_reason end where program_id=p.id returning * into b;
 end if;
 insert into private.private_beta_business_events(tenant_id,program_id,event_key,kind,update_id,provider_user_id,provider_chat_id,provider_message_id,source_hash,content_hash,occurred_at,control_generation,action)
 values(target_tenant_id,p.id,key_value,v->>'kind',v->>'update_id',v->>'provider_user_id',v->>'provider_chat_id',v->>'provider_message_id',v->>'source_hash',case when v->>'kind'='HUMAN_REPLY'then private.fse_hash(v->>'content')end,at_value,b.generation,action_value)returning * into e;
 select * into a from private.private_beta_participants where tenant_id=target_tenant_id and program_id=p.id and provider_chat_id=b.founder_chat_id;
 if a.conversation_id is not null and action_value='HELD'then
  select * into c from public.conversations where tenant_id=target_tenant_id and id=a.conversation_id for update;
  perform 1 from private.private_beta_participants where id=a.id for update;
  update public.conversations set runtime_mode=case when v->>'kind'='HUMAN_REPLY'then 'HUMAN_TAKEOVER'::public.conversation_runtime_mode else 'PAUSED'::public.conversation_runtime_mode end,human_takeover=true,automatic_replies_enabled=false,automatic_replies_enabled_at=null,attention_required=true where tenant_id=target_tenant_id and id=c.id;
  update public.messages set status='blocked',failure_code='PRIVATE_BETA_BUSINESS_REVIEW'where tenant_id=target_tenant_id and conversation_id=c.id and direction='outbound'and status in('pending','retry_scheduled');
  -- Already-started effects remain uncertain; they are never marked cancelled or successful here.
  select id into source_mid from public.messages where tenant_id=target_tenant_id and conversation_id=c.id and direction='inbound'order by created_at desc,id desc limit 1;
  if source_mid is not null and not exists(select 1 from public.escalation_cases where tenant_id=target_tenant_id and conversation_id=c.id and status<>'RESOLVED')then perform private.escalation_open(target_tenant_id,source_mid,'general_review','HIGH','en','quality',e.id);end if;
  -- Phase12 opens an unassigned HIGH case in takeover mode. A source/permission
  -- uncertainty is still PAUSED, not evidence that a human accepted ownership.
  if v->>'kind'<>'HUMAN_REPLY'then update public.conversations set runtime_mode='PAUSED',human_takeover=true,automatic_replies_enabled=false,automatic_replies_enabled_at=null,attention_required=true where tenant_id=target_tenant_id and id=c.id;end if;
  if v->>'kind'='HUMAN_REPLY'then
   insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_message_id,provider_chat_id,idempotency_key,actor_type,actor_id,correlation_id,occurred_at)
   values(target_tenant_id,c.id,c.customer_id,c.messaging_contact_id,c.provider_connection_id,'outbound','text',v->>'content','sent',v->>'provider_message_id',b.founder_chat_id,'private-beta-business-human:'||e.id,'SYSTEM','private-beta-telegram-human-observed',extensions.gen_random_uuid(),at_value);
  end if;
 end if;
 if action_value='HELD'then insert into private.private_beta_observations(tenant_id,program_id,conversation_id,command_id,kind,scenario,outcome,note)values(target_tenant_id,p.id,a.conversation_id,e.id,'BOT_CONTROL','BUSINESS_'||(v->>'kind'),'BLOCKED','Telegram Business observation requires review; no staff identity, delivery cancellation or successful resend inferred.');end if;
 return jsonb_build_object('accepted',true,'duplicate',false,'action',action_value,'business_generation',b.generation::text);
end;$$;

-- Read failures are review obligations, not proof that Telegram disabled an
-- account and not evidence that any external send began.
create function public.private_beta_business_transport_hold_v1(target_tenant_id uuid,program_id_value uuid,target_message_id uuid,reason_value text)returns jsonb
 language plpgsql security definer set search_path=pg_catalog as $$declare p private.private_beta_programs;b private.private_beta_business_controls;m public.messages;source_mid uuid;begin
 p:=private.private_beta_guard(target_tenant_id,program_id_value);select * into p from private.private_beta_programs where id=p.id for update;
 select * into b from private.private_beta_business_controls where tenant_id=target_tenant_id and program_id=p.id for update;
 select * into m from public.messages where tenant_id=target_tenant_id and id=target_message_id;
 if b.program_id is null or m.id is null or m.provider_chat_id is distinct from b.founder_chat_id then return jsonb_build_object('held',false);end if;
 if reason_value is null or reason_value not in('PERMISSION_READ_UNVERIFIED','SCOPE_CHANGED')then raise exception 'PRIVATE_BETA_BUSINESS_INVALID'using errcode='22023';end if;
 perform 1 from public.conversations where tenant_id=target_tenant_id and id=m.conversation_id for update;
 update private.private_beta_business_controls set restricted=true,restricted_at=clock_timestamp(),restriction_reason=reason_value,generation=generation+1 where program_id=p.id;
 update public.conversations set runtime_mode='PAUSED',human_takeover=true,automatic_replies_enabled=false,automatic_replies_enabled_at=null,attention_required=true where tenant_id=target_tenant_id and id=m.conversation_id;
 update public.messages set status='blocked',failure_code='PRIVATE_BETA_BUSINESS_REVIEW'where tenant_id=target_tenant_id and conversation_id=m.conversation_id and direction='outbound'and status in('pending','retry_scheduled');
 select id into source_mid from public.messages where tenant_id=target_tenant_id and conversation_id=m.conversation_id and direction='inbound'order by created_at desc,id desc limit 1;
 if source_mid is not null and not exists(select 1 from public.escalation_cases where tenant_id=target_tenant_id and conversation_id=m.conversation_id and status<>'RESOLVED')then perform private.escalation_open(target_tenant_id,source_mid,'general_review','HIGH','en','quality',target_message_id);end if;
 update public.conversations set runtime_mode='PAUSED',human_takeover=true,automatic_replies_enabled=false,automatic_replies_enabled_at=null,attention_required=true where tenant_id=target_tenant_id and id=m.conversation_id;
 insert into private.private_beta_observations(tenant_id,program_id,conversation_id,command_id,kind,scenario,outcome,note)values(target_tenant_id,p.id,m.conversation_id,extensions.gen_random_uuid(),'BOT_CONTROL','BUSINESS_TRANSPORT_READ','BLOCKED','Current Business transport permission could not be independently verified; no external send outcome inferred.');
 return jsonb_build_object('held',true);end;$$;

create function private.private_beta_business_participant_guard()returns trigger language plpgsql security definer set search_path=pg_catalog as $$declare b private.private_beta_business_controls;begin
 select * into b from private.private_beta_business_controls where tenant_id=new.tenant_id and program_id=new.program_id;
 if b.program_id is not null and(new.kind<>'FOUNDER'or new.provider_user_id<>b.founder_chat_id or new.provider_chat_id<>b.founder_chat_id)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;return new;end;$$;
create trigger private_beta_business_participant_scope before insert on private.private_beta_participants for each row execute function private.private_beta_business_participant_guard();

create function private.private_beta_business_message_guard()returns trigger language plpgsql security definer set search_path=pg_catalog as $$declare b private.private_beta_business_controls;begin
 select * into b from private.private_beta_business_controls where tenant_id=new.tenant_id;
 if b.program_id is null then return new;end if;
 if new.provider_chat_id is distinct from b.founder_chat_id or not exists(select 1 from public.messaging_provider_connections c where c.tenant_id=new.tenant_id and c.id=new.provider_connection_id and c.provider_account_ref=b.bot_id)
 then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 if new.direction='inbound'and not exists(select 1 from private.private_beta_business_events e where e.tenant_id=new.tenant_id and e.program_id=b.program_id and e.kind='INBOUND'and e.action='INBOUND'
  and e.provider_message_id=new.provider_message_id and new.idempotency_key='telegram:update:business:'||private.fse_hash(b.business_connection_id)||':'||e.update_id)
 then raise exception 'PRIVATE_BETA_BUSINESS_SOURCE_UNVERIFIED'using errcode='42501';end if;return new;end;$$;
create trigger private_beta_business_message_scope before insert on public.messages for each row execute function private.private_beta_business_message_guard();

create function private.private_beta_business_attempt_guard()returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare x private.private_beta_programs;b private.private_beta_business_controls;m public.messages;a private.private_beta_participants;begin
 select * into b from private.private_beta_business_controls where tenant_id=new.tenant_id and program_id=new.program_id;
 if b.program_id is null or new.scope='CANARY'then return new;end if;
 select * into x from private.private_beta_programs where id=b.program_id for update;select * into b from private.private_beta_business_controls where program_id=x.id for update;
 select * into a from private.private_beta_participants where tenant_id=new.tenant_id and id=new.participant_id;
 select * into m from public.messages where tenant_id=new.tenant_id and id=new.source_message_id;
 if new.scope<>'FOUNDER'or a.id is null or m.id is null or a.kind is distinct from 'FOUNDER'or a.provider_user_id is distinct from b.founder_chat_id or not private.private_beta_business_permitted(x,b)
 or b.last_inbound_at is null or b.last_inbound_at<=clock_timestamp()-interval '24 hours'or b.last_inbound_at>clock_timestamp()+interval '5 seconds'
 or m.provider_message_id is distinct from b.last_inbound_message_id or not exists(select 1 from private.private_beta_business_events e where e.program_id=x.id and e.kind='INBOUND'and e.action='INBOUND'and e.control_generation=b.generation
  and e.update_id=b.last_inbound_update_id and e.provider_message_id=m.provider_message_id and m.idempotency_key='telegram:update:business:'||private.fse_hash(b.business_connection_id)||':'||e.update_id)
 then raise exception 'PRIVATE_BETA_BUSINESS_SOURCE_UNVERIFIED'using errcode='42501';end if;return new;end;$$;
create trigger private_beta_business_reservation_scope before insert on private.private_beta_attempt_scope for each row execute function private.private_beta_business_attempt_guard();

alter function public.private_beta_claim_reply_v1(uuid,uuid)rename to private_beta_claim_reply_bot_v1;
alter function public.private_beta_claim_reply_bot_v1(uuid,uuid)set schema private;
revoke all on function private.private_beta_claim_reply_bot_v1(uuid,uuid)from public,anon,authenticated,service_role;
create function public.private_beta_claim_reply_v1(target_tenant_id uuid,target_message_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p private.private_beta_programs;b private.private_beta_business_controls;m public.messages;v jsonb;begin
 select * into b from private.private_beta_business_controls where tenant_id=target_tenant_id;
 if b.program_id is null then return private.private_beta_claim_reply_bot_v1(target_tenant_id,target_message_id);end if;
 p:=private.private_beta_guard(target_tenant_id,b.program_id);select * into p from private.private_beta_programs where id=p.id for update;
 select * into b from private.private_beta_business_controls where program_id=p.id for update;
 select * into m from public.messages where tenant_id=target_tenant_id and id=target_message_id;
 if m.id is null or m.provider_chat_id is distinct from b.founder_chat_id or not private.private_beta_business_permitted(p,b)
 or b.last_inbound_at is null or b.last_inbound_at<=clock_timestamp()-interval '24 hours'or b.last_inbound_at>clock_timestamp()+interval '5 seconds'
 then return jsonb_build_object('dispatch',false);end if;
 v:=private.private_beta_claim_reply_bot_v1(target_tenant_id,target_message_id);
 if v->'dispatch'='true'::jsonb then return v||jsonb_build_object('mode','BUSINESS','business_connection_id',b.business_connection_id,'business_generation',b.generation::text);end if;return v;end;$$;

-- No public raw SELECT or attestation writer grants. Server wrappers retain the
-- original service role boundary; owner configuration requires verified MFA.
revoke all on function private.private_beta_business_immutable(),private.private_beta_business_control_seed(uuid,uuid),private.private_beta_business_control_record(uuid,uuid,text),
 private.private_beta_business_permitted(private.private_beta_programs,private.private_beta_business_controls),private.private_beta_business_observed_message(public.messages),
 private.private_beta_business_participant_guard(),private.private_beta_business_message_guard(),private.private_beta_business_attempt_guard(),private.private_beta_business_stage_guard()from public,anon,authenticated,service_role;
revoke all on function private.private_beta_business_discovery_record(uuid,uuid,bigint,text)from public,anon,authenticated,service_role;
revoke all on function public.admin_private_beta_business_configure_v1(uuid,uuid,text,bigint),public.admin_private_beta_business_reverify_v1(uuid,uuid,bigint),
 public.private_beta_business_event_v1(uuid,uuid,text),public.private_beta_transport_config_v1(uuid,uuid),public.private_beta_claim_reply_v1(uuid,uuid)from public,anon,authenticated,service_role;
revoke all on function public.private_beta_business_transport_hold_v1(uuid,uuid,uuid,text)from public,anon,authenticated,service_role;
revoke all on function public.admin_private_beta_business_scope_v1(uuid,uuid)from public,anon,authenticated,service_role;
revoke all on function public.admin_private_beta_business_discovery_v1(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.admin_private_beta_business_configure_v1(uuid,uuid,text,bigint),public.admin_private_beta_business_reverify_v1(uuid,uuid,bigint),public.admin_private_beta_business_scope_v1(uuid,uuid)to authenticated;
grant execute on function public.admin_private_beta_business_discovery_v1(uuid,uuid)to authenticated;
grant execute on function public.private_beta_business_event_v1(uuid,uuid,text),public.private_beta_transport_config_v1(uuid,uuid),public.private_beta_claim_reply_v1(uuid,uuid)to service_role;
grant execute on function public.private_beta_business_transport_hold_v1(uuid,uuid,uuid,text)to service_role;
