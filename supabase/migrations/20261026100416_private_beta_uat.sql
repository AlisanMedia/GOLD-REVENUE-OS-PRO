-- Invitation-only free private beta. No commercial financial, subscription or VIP authority.
-- Historical OFFLINE_SYNTHETIC writers retain their existing guards and exact semantics.
create table private.private_beta_programs(
 id uuid primary key,tenant_id uuid not null unique references public.tenants(id),owner_user_id uuid not null references public.app_users(id),
 configuration jsonb not null,stage text not null default 'DRAFT' check(stage in('DRAFT','CANARY','FOUNDER','FRIENDS','STOPPED')),
 generation bigint not null default 1 check(generation between 1 and 999999999),authorization_record_hash text not null unique,
 manifest_hash text not null,cursor_secret bytea not null default extensions.gen_random_bytes(32),account_control jsonb,pricing_control jsonb,bot_control jsonb,approved_at timestamptz,authenticated_at timestamptz,
 request_count integer not null default 0 check(request_count between 0 and 350),reserved_liability numeric not null default 0 check(reserved_liability between 0 and 1750),
 canary_run_id uuid not null unique,conversation_run_id uuid not null unique,canary_reconciliation_hash text,
 created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id),
 check(authorization_record_hash~'^[a-f0-9]{64}$'and manifest_hash~'^[a-f0-9]{64}$')
);
create table private.private_beta_invites(
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,program_id uuid not null,command_id uuid not null,
 kind text not null check(kind in('FOUNDER','FRIEND')),code_hash text not null unique check(code_hash~'^[a-f0-9]{64}$'),
 expires_at timestamptz not null,accepted_by text,accepted_chat text,accepted_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,command_id),foreign key(tenant_id,program_id)references private.private_beta_programs(tenant_id,id)
);
create table private.private_beta_participants(
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,program_id uuid not null,invite_id uuid not null unique,
 kind text not null check(kind in('FOUNDER','FRIEND')),provider_user_id text not null check(provider_user_id~'^[1-9][0-9]{0,18}$'),
 provider_chat_id text not null check(provider_chat_id~'^[1-9][0-9]{0,18}$'),conversation_id uuid,last_inbound_id uuid,
 status text not null default 'PENDING_NOTICE'check(status in('PENDING_NOTICE','ACTIVE','REVOKED')),revision bigint not null default 1,
 notice_version text not null,notice_hash text not null,consented_at timestamptz,revoked_at timestamptz,deletion_requested_at timestamptz,
 request_count integer not null default 0 check(request_count between 0 and 30),joined_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),unique(program_id,provider_user_id),unique(program_id,provider_chat_id),unique(tenant_id,conversation_id),
 foreign key(tenant_id,program_id)references private.private_beta_programs(tenant_id,id),
 foreign key(invite_id)references private.private_beta_invites(id),foreign key(tenant_id,conversation_id)references public.conversations(tenant_id,id),
 check(provider_user_id=provider_chat_id),check(kind<>'FOUNDER'or request_count<=20)
);
-- Mapping only. Attempt reservation, dispatch and outcome evidence remain in the accepted experiment journal.
create table private.private_beta_attempt_scope(
 tenant_id uuid not null,program_id uuid not null,attempt_id uuid primary key,native_run_id uuid not null,conversation_id uuid not null,
 participant_id uuid,source_message_id uuid,scope text not null check(scope in('CANARY','FOUNDER','FRIEND')),participant_revision bigint,
 source_boundary timestamptz,generation bigint not null,global_ordinal integer not null check(global_ordinal between 1 and 350),
 participant_ordinal integer not null check(participant_ordinal between 0 and 30),dispatch_nonce uuid,dispatch_started_at timestamptz,deadline timestamptz,
 unique(program_id,native_run_id),unique(program_id,global_ordinal),
 foreign key(tenant_id,program_id)references private.private_beta_programs(tenant_id,id),foreign key(attempt_id)references private.polat_experiment_attempts(id),
 foreign key(tenant_id,participant_id)references private.private_beta_participants(tenant_id,id),foreign key(tenant_id,source_message_id)references public.messages(tenant_id,id)
);
create table private.private_beta_observations(
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,program_id uuid not null,conversation_id uuid,command_id uuid not null,
 kind text not null check(kind in('OPERATOR_NOTE','TESTER_FEEDBACK','DELETION_REQUEST','PARTICIPATION','ACCOUNT_CONTROL','BOT_CONTROL','PROGRAM_CONTROL')),
 scenario text not null check(length(scenario)between 1 and 80),outcome text not null check(outcome in('PASS','FAIL','NOT_TESTED','BLOCKED','NOTE')),
 note text not null check(length(note)<=1000),actor_id uuid,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,command_id),foreign key(tenant_id,program_id)references private.private_beta_programs(tenant_id,id),foreign key(tenant_id,conversation_id)references public.conversations(tenant_id,id)
);
create index private_beta_attempt_scope_program on private.private_beta_attempt_scope(tenant_id,program_id,global_ordinal desc);
create index private_beta_observations_page on private.private_beta_observations(tenant_id,program_id,created_at desc,id desc);
create trigger private_beta_observations_immutable before update or delete on private.private_beta_observations for each row execute function private.fse_immutable();
do $$declare n text;begin foreach n in array array['private_beta_programs','private_beta_invites','private_beta_participants','private_beta_attempt_scope','private_beta_observations']loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);end loop;end;$$;

-- Expand only the newly distinguished genuine-UAT mode. Fixture writers and their max290/max1024 checks are untouched.
do $$declare x record;begin
 for x in select conname from pg_constraint where conrelid='private.polat_experiment_runs'::regclass and contype='c'and(pg_get_constraintdef(oid)like '%request_count%'or pg_get_constraintdef(oid)like '%OFFLINE_SYNTHETIC%')loop execute format('alter table private.polat_experiment_runs drop constraint %I',x.conname);end loop;
 for x in select conname from pg_constraint where conrelid='private.polat_experiment_attempts'::regclass and contype='c'and pg_get_constraintdef(oid)like '%ordinal%'loop execute format('alter table private.polat_experiment_attempts drop constraint %I',x.conname);end loop;
 for x in select conname from pg_constraint where conrelid='private.polat_experiment_evidence'::regclass and contype='c'and pg_get_constraintdef(oid)like '%sequence%'loop execute format('alter table private.polat_experiment_evidence drop constraint %I',x.conname);end loop;
end;$$;

create unique index private_beta_account_authority_once on private.private_beta_programs((account_control->>'account_scope_hash'))where account_control is not null;
create unique index private_beta_source_attempt_once on private.private_beta_attempt_scope(program_id,source_message_id)where source_message_id is not null;
create function public.admin_private_beta_notes_page_v1(target_tenant_id uuid,page_size_value integer default 25,cursor_value jsonb default null)returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
declare x private.private_beta_programs;role_value public.app_role;rows_value jsonb;more boolean;tail jsonb;next_value jsonb;anchor_time timestamptz:=statement_timestamp();anchor_id uuid:='ffffffff-ffff-ffff-ffff-ffffffffffff';before_time timestamptz;before_id uuid;expiry timestamptz:=statement_timestamp()+interval '30 minutes';begin
 if auth.uid()is null or not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support']::public.app_role[])then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 select role into strict role_value from public.tenant_members where tenant_id=target_tenant_id and user_id=auth.uid()and status='active';
 if page_size_value is null or page_size_value not between 1 and 100 then raise exception 'PRIVATE_BETA_CURSOR_INVALID'using errcode='22023';end if;
 select * into x from private.private_beta_programs where tenant_id=target_tenant_id;if x.id is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;perform private.private_beta_evidence_guard(target_tenant_id,x.id);
 if cursor_value is not null then begin
  if not private.fse_keys(cursor_value,array['v','collection','tenant','user','role','size','program','generation','anchor','before','expires','seal'])or cursor_value->'v'is distinct from '1'::jsonb or cursor_value->>'collection'is distinct from 'notes'
  or cursor_value->>'tenant'is distinct from target_tenant_id::text or cursor_value->>'user'is distinct from auth.uid()::text or cursor_value->>'role'is distinct from role_value::text or cursor_value->'size'is distinct from to_jsonb(page_size_value)
  or cursor_value->>'program'is distinct from x.id::text or cursor_value->>'generation'is distinct from x.generation::text or cursor_value->>'seal'is distinct from encode(extensions.hmac(convert_to(private.fse_canonical(cursor_value-'seal'),'UTF8'),x.cursor_secret,'sha256'),'hex')or not private.fse_keys(cursor_value->'anchor',array['at','id'])or not private.fse_keys(cursor_value->'before',array['at','id'])then raise exception 'invalid';end if;
  anchor_time:=(cursor_value#>>'{anchor,at}')::timestamptz;anchor_id:=(cursor_value#>>'{anchor,id}')::uuid;before_time:=(cursor_value#>>'{before,at}')::timestamptz;before_id:=(cursor_value#>>'{before,id}')::uuid;expiry:=(cursor_value->>'expires')::timestamptz;
  if anchor_time is null or anchor_id is null or before_time is null or before_id is null or expiry is null or anchor_time>statement_timestamp()or expiry<=statement_timestamp()or expiry>statement_timestamp()+interval '30 minutes'or expiry>anchor_time+interval '30 minutes'or(before_time,before_id)>(anchor_time,anchor_id)
  or not exists(select 1 from private.private_beta_observations where tenant_id=target_tenant_id and program_id=x.id and id=before_id and created_at=before_time)then raise exception 'invalid';end if;
 exception when others then raise exception 'PRIVATE_BETA_CURSOR_INVALID'using errcode='22023';end;end if;
 with source as materialized(select id,conversation_id,kind,scenario,outcome,note,actor_id,created_at from private.private_beta_observations where tenant_id=target_tenant_id and program_id=x.id and(created_at,id)<=(anchor_time,anchor_id)and(before_time is null or(created_at,id)<(before_time,before_id))order by created_at desc,id desc limit page_size_value+1)
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'conversation_id',n.conversation_id,'scenario',n.scenario,'outcome',n.outcome,'note',n.note,'created_at',n.created_at,
 'author',case when n.kind in('TESTER_FEEDBACK','PARTICIPATION','DELETION_REQUEST')then 'TESTER'when n.actor_id is null then 'SYSTEM'else 'OPERATOR'end)order by n.created_at desc,n.id desc),'[]'),(select count(*)>page_size_value from source)into rows_value,more from(select * from source order by created_at desc,id desc limit page_size_value)n;
 if more then tail:=rows_value->(jsonb_array_length(rows_value)-1);next_value:=jsonb_build_object('v',1,'collection','notes','tenant',target_tenant_id,'user',auth.uid(),'role',role_value,'size',page_size_value,'program',x.id,'generation',x.generation::text,'anchor',jsonb_build_object('at',anchor_time,'id',anchor_id),'before',jsonb_build_object('at',tail->>'created_at','id',tail->>'id'),'expires',expiry);next_value:=next_value||jsonb_build_object('seal',encode(extensions.hmac(convert_to(private.fse_canonical(next_value),'UTF8'),x.cursor_secret,'sha256'),'hex'));end if;
 return jsonb_build_object('version',1,'program_id',x.id,'program_generation',x.generation::text,'items',rows_value,'page_size',page_size_value,'has_more',more,'next_cursor',next_value);end;$$;
revoke all on function public.admin_private_beta_notes_page_v1(uuid,integer,jsonb)from public,anon,service_role;
grant execute on function public.admin_private_beta_notes_page_v1(uuid,integer,jsonb)to authenticated;
alter table private.polat_experiment_runs add constraint polat_experiment_versioned_limits check(
 request_count between 0 and case when binding->>'mode'='PRIVATE_BETA_UAT'then 350 else 290 end
 and request_count<=(binding->>'maximum_requests')::int and reserved_liability>=0 and reserved_liability<=(case when binding->>'mode'='PRIVATE_BETA_UAT'then (binding->>'maximum_attempt_liability')::numeric*(binding->>'maximum_requests')::numeric else (binding->>'maximum_spend')::numeric end)
 and event_sequence between 0 and case when binding->>'mode'='PRIVATE_BETA_UAT'then 2048 else 1024 end);
alter table private.polat_experiment_runs add constraint polat_experiment_versioned_authority check(
 (binding->>'mode'='OFFLINE_SYNTHETIC'and binding->>'financial_authority'='NONE'and binding->'execution_enabled'='false'::jsonb and binding->'authorized_external_requests'='0'::jsonb)
 or(binding->>'mode'='PRIVATE_BETA_UAT'and binding->>'financial_authority'='NONE'and binding->'commercial_sales'='false'::jsonb and binding->>'provider'='anthropic'and binding->>'model'='claude-haiku-5-5'and binding->>'currency'='USD'and(binding->>'maximum_spend')::numeric<=5));
alter table private.polat_experiment_attempts add constraint polat_experiment_attempt_versioned_bound check(ordinal between 1 and 350 and liability>0 and target_hash~'^[a-f0-9]{64}$'and request_hash~'^[a-f0-9]{64}$'and body_hash~'^[a-f0-9]{64}$');
alter table private.polat_experiment_evidence add constraint polat_experiment_evidence_versioned_bound check(sequence between 1 and 2048 and octet_length(payload::text)<=8192 and command_hash~'^[a-f0-9]{64}$'and evidence_hash~'^[a-f0-9]{64}$');
create function private.private_beta_journal_bound()returns trigger language plpgsql set search_path=pg_catalog as $$declare b jsonb;begin
 select binding into strict b from private.polat_experiment_runs where id=new.run_id;
 if tg_table_name='polat_experiment_attempts'then if new.ordinal>(case when b->>'mode'='PRIVATE_BETA_UAT'then 350 else 290 end)then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
 else if new.sequence>(case when b->>'mode'='PRIVATE_BETA_UAT'then 2048 else 1024 end)then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;end if;return new;end;$$;
create trigger private_beta_attempt_versioned_limit before insert on private.polat_experiment_attempts for each row execute function private.private_beta_journal_bound();
create trigger private_beta_evidence_versioned_limit before insert on private.polat_experiment_evidence for each row execute function private.private_beta_journal_bound();

create function private.private_beta_admin(t uuid,owner_only boolean default false)returns void language plpgsql stable set search_path=pg_catalog as $$begin
 if auth.uid()is null or auth.jwt()->>'aal'is distinct from 'aal2'or not private.has_tenant_role(t,case when owner_only then array['super_admin']::public.app_role[]else array['super_admin','manager','support']::public.app_role[]end)
 then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
end;$$;
-- Supabase verified JWT AMR uses method=totp and epoch timestamp; refreshed iat is not a new factor challenge.
-- https://supabase.com/docs/guides/auth/auth-mfa#how-do-i-check-when-a-user-went-through-mfa
create function private.private_beta_mfa_at()returns timestamptz language plpgsql stable set search_path=pg_catalog as $$declare at_value timestamptz;begin
 if auth.jwt()->>'aal'is distinct from 'aal2'or jsonb_typeof(auth.jwt()->'amr')is distinct from 'array'or jsonb_array_length(auth.jwt()->'amr')>16 then raise exception 'PRIVATE_BETA_FRESH_AUTH_REQUIRED'using errcode='42501';end if;
 select max(to_timestamp((v->>'timestamp')::numeric))into at_value from jsonb_array_elements(auth.jwt()->'amr')v where v->>'method'='totp'and jsonb_typeof(v->'timestamp')='number'and v->>'timestamp'~'^[0-9]{1,12}(\.[0-9]{1,6})?$';
 if at_value is null or at_value>clock_timestamp()or clock_timestamp()-at_value>interval '5 minutes'then raise exception 'PRIVATE_BETA_FRESH_AUTH_REQUIRED'using errcode='42501';end if;return at_value;end;$$;
create function private.private_beta_guard(t uuid,p uuid)returns private.private_beta_programs language plpgsql stable set search_path=pg_catalog as $$declare x private.private_beta_programs;begin
 select b.* into x from private.private_beta_programs b join public.tenants n on n.id=b.tenant_id where b.tenant_id=t and b.id=p and n.status='active'and n.slug like 'private-beta-%'and not n.outbound_messaging_enabled;
 if x.id is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;return x;
end;$$;
-- Completion evidence remains recordable after a stop/suspension. This helper never grants new dispatch authority.
create function private.private_beta_evidence_guard(t uuid,p uuid)returns private.private_beta_programs language plpgsql stable set search_path=pg_catalog as $$declare x private.private_beta_programs;begin
 select b.* into x from private.private_beta_programs b join public.tenants n on n.id=b.tenant_id where b.tenant_id=t and b.id=p and n.slug like 'private-beta-%';
 if x.id is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;return x;end;$$;
create function private.private_beta_configuration(raw_value text)returns jsonb language plpgsql immutable set search_path=pg_catalog as $$declare v jsonb;k text;begin
 if raw_value is null or octet_length(raw_value)>4096 then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;v:=private.fse_strict_json(raw_value);
 if not private.fse_keys(v,array['repository_sha','starts_at','expires_at','retention_days','notice_version','primary_operator','backup_operator'])or v->>'notice_version'is distinct from 'polat-private-beta-notice-v1'then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 if v->'repository_sha'is distinct from 'null'::jsonb and(jsonb_typeof(v->'repository_sha')<>'string'or v->>'repository_sha'!~'^[a-f0-9]{40}$')then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 if v->'retention_days'is distinct from 'null'::jsonb and(jsonb_typeof(v->'retention_days')<>'number'or v->>'retention_days'!~'^[1-9][0-9]?$'or(v->>'retention_days')::int>30)then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 foreach k in array array['starts_at','expires_at']loop if v->k is distinct from 'null'::jsonb then if jsonb_typeof(v->k)<>'string'then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;perform(v->>k)::timestamptz;end if;end loop;
 foreach k in array array['primary_operator','backup_operator']loop if v->k is distinct from 'null'::jsonb then if jsonb_typeof(v->k)<>'string'then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;perform(v->>k)::uuid;end if;end loop;
 if v->>'starts_at'is not null and v->>'expires_at'is not null and((v->>'expires_at')::timestamptz<=(v->>'starts_at')::timestamptz or(v->>'expires_at')::timestamptz>(v->>'starts_at')::timestamptz+interval '7 days')then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 return v;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end;$$;
create function public.admin_private_beta_bootstrap_tenant_v1(source_tenant_id uuid,new_tenant_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$begin
 perform private.private_beta_admin(source_tenant_id,true);if new_tenant_id is null or exists(select 1 from public.tenants where id=new_tenant_id)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 insert into public.tenants(id,name,slug,outbound_messaging_enabled)values(new_tenant_id,'Polat VIP Private Beta','private-beta-'||new_tenant_id::text,false);
 insert into public.tenant_members(tenant_id,user_id,role)values(new_tenant_id,auth.uid(),'super_admin');
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(new_tenant_id,'HUMAN',auth.uid(),'private_beta.tenant_created','tenants',new_tenant_id::text,jsonb_build_object('outbound_enabled',false,'financial_authority','NONE'));
 return jsonb_build_object('tenant_id',new_tenant_id,'slug','private-beta-'||new_tenant_id::text,'outbound_enabled',false);end;$$;
create function public.admin_private_beta_create_v1(target_tenant_id uuid,program_id_value uuid,configuration_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare v jsonb;x private.private_beta_programs;begin
 perform private.private_beta_admin(target_tenant_id,true);v:=private.private_beta_configuration(configuration_value);
 if not exists(select 1 from public.tenants where id=target_tenant_id and status='active'and slug like 'private-beta-%'and not outbound_messaging_enabled)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 select * into x from private.private_beta_programs where tenant_id=target_tenant_id;
 if x.id is not null then if x.id<>program_id_value or x.owner_user_id<>auth.uid()or x.configuration<>v then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;return jsonb_build_object('program_id',x.id,'stage',x.stage,'generation',x.generation::text);end if;
 insert into private.private_beta_programs(id,tenant_id,owner_user_id,configuration,authorization_record_hash,manifest_hash,canary_run_id,conversation_run_id)
 values(program_id_value,target_tenant_id,auth.uid(),v,private.fse_hash(private.fse_canonical(jsonb_build_array('PRIVATE_BETA_FIRST_UAT_OWNER1',auth.uid(),'350_REQUESTS_5_USD'))),private.fse_hash(private.fse_canonical(v)),extensions.gen_random_uuid(),extensions.gen_random_uuid())returning * into x;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.draft_created','private_beta_programs',x.id::text,jsonb_build_object('stage','DRAFT','financial_authority','NONE'));
 return jsonb_build_object('program_id',x.id,'stage',x.stage,'generation',x.generation::text);end;$$;
create function public.admin_private_beta_configure_v1(target_tenant_id uuid,program_id_value uuid,configuration_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;v jsonb;k text;begin
 perform private.private_beta_admin(target_tenant_id,true);x:=private.private_beta_guard(target_tenant_id,program_id_value);v:=private.private_beta_configuration(configuration_value);
 select * into x from private.private_beta_programs where id=x.id for update;
 if x.stage<>'DRAFT'or x.owner_user_id<>auth.uid()then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 foreach k in array array['primary_operator','backup_operator']loop if v->>k is not null and not exists(select 1 from public.tenant_members where tenant_id=target_tenant_id and user_id=(v->>k)::uuid and status='active'and role in('super_admin','manager'))then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;end loop;
 if v is distinct from x.configuration then update private.private_beta_programs set configuration=v,manifest_hash=private.fse_hash(private.fse_canonical(v)),account_control=null,bot_control=null,generation=generation+1 where id=x.id returning * into x;end if;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.draft_configured','private_beta_programs',x.id::text,jsonb_build_object('generation',x.generation,'financial_authority','NONE'));
 return jsonb_build_object('program_id',x.id,'stage',x.stage,'generation',x.generation::text);end;$$;
create function public.admin_private_beta_invite_v1(target_tenant_id uuid,program_id_value uuid,kind_value text,command_id_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;i private.private_beta_invites;code text;deadline timestamptz;begin
 perform private.private_beta_admin(target_tenant_id,true);x:=private.private_beta_guard(target_tenant_id,program_id_value);select * into x from private.private_beta_programs where id=x.id for update;
 if x.stage='STOPPED'or x.owner_user_id<>auth.uid()or kind_value not in('FOUNDER','FRIEND')or kind_value is null or command_id_value is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 select * into i from private.private_beta_invites where tenant_id=target_tenant_id and command_id=command_id_value;
 if i.id is not null then if i.program_id<>x.id or i.kind<>kind_value then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;return jsonb_build_object('invite_id',i.id,'code',null,'expires_at',i.expires_at,'kind',i.kind,'replay',true);end if;
 if(select count(*)from private.private_beta_invites where program_id=x.id and kind=kind_value)>=(case kind_value when 'FOUNDER'then 1 else 10 end)then raise exception 'PRIVATE_BETA_LIMIT'using errcode='54000';end if;
 code:=encode(extensions.gen_random_bytes(24),'hex');deadline:=least(coalesce((x.configuration->>'expires_at')::timestamptz,clock_timestamp()+interval '24 hours'),clock_timestamp()+interval '24 hours');
 if deadline<=clock_timestamp()then raise exception 'PRIVATE_BETA_WINDOW'using errcode='55000';end if;
 insert into private.private_beta_invites(tenant_id,program_id,command_id,kind,code_hash,expires_at)values(target_tenant_id,x.id,command_id_value,kind_value,private.fse_hash(code),deadline)returning * into i;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.invite_created','private_beta_invites',i.id::text,jsonb_build_object('kind',i.kind,'expires_at',i.expires_at));
 return jsonb_build_object('invite_id',i.id,'code',code,'expires_at',i.expires_at,'kind',i.kind,'replay',false);end;$$;
create function public.admin_private_beta_note_v1(target_tenant_id uuid,program_id_value uuid,conversation_id_value uuid,scenario_value text,outcome_value text,note_value text,command_id_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;n private.private_beta_observations;begin
 perform private.private_beta_admin(target_tenant_id);x:=private.private_beta_guard(target_tenant_id,program_id_value);
 if auth.uid()<>x.owner_user_id and not(auth.uid()::text=any(array[x.configuration->>'primary_operator',x.configuration->>'backup_operator']))then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 if conversation_id_value is not null and not exists(select 1 from private.private_beta_participants where tenant_id=target_tenant_id and program_id=x.id and conversation_id=conversation_id_value)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 if scenario_value is null or length(scenario_value)not between 1 and 80 or outcome_value is null or outcome_value not in('PASS','FAIL','NOT_TESTED','BLOCKED','NOTE')or note_value is null or length(note_value)>1000 or command_id_value is null then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 select * into n from private.private_beta_observations where tenant_id=target_tenant_id and command_id=command_id_value;
 if n.id is not null then if(n.program_id,n.conversation_id,n.scenario,n.outcome,n.note,n.actor_id)is distinct from(x.id,conversation_id_value,scenario_value,outcome_value,note_value,auth.uid())then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;return jsonb_build_object('recorded',true,'note_id',n.id);end if;
 insert into private.private_beta_observations(tenant_id,program_id,conversation_id,command_id,kind,scenario,outcome,note,actor_id)values(target_tenant_id,x.id,conversation_id_value,command_id_value,'OPERATOR_NOTE',scenario_value,outcome_value,note_value,auth.uid())returning * into n;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.observation_recorded','private_beta_observations',n.id::text,jsonb_build_object('scenario',scenario_value,'outcome',outcome_value,'note_redacted',true));
 return jsonb_build_object('recorded',true,'note_id',n.id);end;$$;

-- Protected account-control process only. No Data API/application role can declare account verification or reconciled billing.
create function private.private_beta_account_control_record(t uuid,p uuid,raw_value text)returns void language plpgsql set search_path=pg_catalog as $$declare x private.private_beta_programs;v jsonb;envelope jsonb;pricing jsonb;k text;begin
 if current_user<>'postgres'then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;x:=private.private_beta_guard(t,p);envelope:=private.fse_strict_json(raw_value);
 if not private.fse_keys(envelope,array['payload','pricing'])then raise exception 'PRIVATE_BETA_ACCOUNT_INVALID'using errcode='22023';end if;v:=envelope->'payload';pricing:=envelope->'pricing';
 if octet_length(raw_value)>16384 or v->>'origin'is distinct from 'INDEPENDENT_ACCOUNT_CONTROL'or v->>'program_id'is distinct from p::text or v->>'tenant_id'is distinct from t::text
 or v->>'provider'is distinct from 'anthropic'or v->>'model'is distinct from 'claude-haiku-5-5'or v->>'repository_sha'is distinct from x.configuration->>'repository_sha'
 or v->>'manifest_hash'is distinct from x.manifest_hash or v->>'authorization_record_hash'is distinct from x.authorization_record_hash
 or v->'model_access'is distinct from 'true'::jsonb or v->>'currency'is distinct from 'USD'or v->>'effective_limit_kind'is distinct from 'ENFORCED_EXPERIMENT_HARD_CAP'
 or private.polat_experiment_decimal(v->>'enforced_maximum_spend')>5 or private.polat_experiment_decimal(v->>'remaining_allowance')<=0
 or v->>'billing_state'not in('RECONCILED','BOUNDED_LIABILITY_RESERVED')or v->'unknown_outcome_count'is distinct from '0'::jsonb
 or(v->>'observed_at')::timestamptz>clock_timestamp()or(v->>'expires_at')::timestamptz<=clock_timestamp()or(v->>'expires_at')::timestamptz>(v->>'observed_at')::timestamptz+interval '5 minutes'
 then raise exception 'PRIVATE_BETA_ACCOUNT_INVALID'using errcode='22023';end if;
 foreach k in array array['account_scope_hash','policy_hash','credential_custody_hash','region_evidence_hash','retention_evidence_hash','training_evidence_hash','billing_evidence_hash']loop if v->>k is null or v->>k!~'^[a-f0-9]{64}$'then raise exception 'PRIVATE_BETA_ACCOUNT_INVALID'using errcode='22023';end if;end loop;
 if x.account_control is not null and x.account_control->>'account_scope_hash'<>v->>'account_scope_hash'then raise exception 'PRIVATE_BETA_ACCOUNT_IMMUTABLE'using errcode='42501';end if;
 perform 1 from private.private_beta_programs where id=p for update;
 if v->>'canary_reconciliation_hash'is not null then
  if v->>'canary_reconciliation_hash'!~'^[a-f0-9]{64}$'or not exists(select 1 from private.polat_experiment_evidence e join private.polat_experiment_attempts a on a.id=e.attempt_id where e.run_id=x.canary_run_id and e.stage='PROVIDER_RESULT'and e.payload->>'status'='SUCCEEDED'and e.payload->>'qa'='APPROVED'and e.payload->>'input_tokens'is not null and e.payload->>'output_tokens'is not null)then raise exception 'PRIVATE_BETA_CANARY_UNVERIFIED'using errcode='42501';end if;
 end if;
 if pricing->>'origin'is distinct from 'INDEPENDENT_OFFICIAL_PRICING_READ'or pricing->>'model'is distinct from 'claude-haiku-5-5'or pricing->>'currency'is distinct from 'USD'
 or pricing->>'source_url'is distinct from 'https://platform.claude.com/docs/en/models/haiku-5-5/overview'or pricing->>'source_hash'!~'^[a-f0-9]{64}$'
 or pricing->>'maximum_input_tokens'is distinct from '1000000'or pricing->>'maximum_input_usd_per_million'is distinct from '0.50'or pricing->>'maximum_output_usd_per_million'is distinct from '2.50'
 or pricing->'all_billable_components_covered'is distinct from 'true'::jsonb or(pricing->>'observed_at')::timestamptz>clock_timestamp()or(pricing->>'expires_at')::timestamptz<=clock_timestamp()then raise exception 'PRIVATE_BETA_PRICING_INVALID'using errcode='22023';end if;
 update private.private_beta_programs set account_control=v,pricing_control=pricing,canary_reconciliation_hash=coalesce(canary_reconciliation_hash,v->>'canary_reconciliation_hash')where id=p;
 insert into private.private_beta_observations(tenant_id,program_id,command_id,kind,scenario,outcome,note)values(t,p,extensions.gen_random_uuid(),'ACCOUNT_CONTROL','ACCOUNT_READ','NOTE','Independent account-control observation recorded; actual billed amount remains unknown.');
end;$$;
create function private.private_beta_bot_control_record(t uuid,p uuid,raw_value text)returns void language plpgsql set search_path=pg_catalog as $$declare x private.private_beta_programs;v jsonb;begin
 if current_user<>'postgres'then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;x:=private.private_beta_guard(t,p);v:=private.fse_strict_json(raw_value);
 if not private.fse_keys(v,array['version','bot_id','source_hash','observed_at','api_environment','credential_sha256'])or v->'version'is distinct from '1'::jsonb or v->>'bot_id'!~'^[1-9][0-9]{0,18}$'or v->>'source_hash'!~'^[a-f0-9]{64}$'or v->>'api_environment'is distinct from 'production'or v->>'credential_sha256'is null or v->>'credential_sha256'!~'^[a-f0-9]{64}$'or(v->>'observed_at')::timestamptz>clock_timestamp()or(v->>'observed_at')::timestamptz<clock_timestamp()-interval '5 minutes'then raise exception 'PRIVATE_BETA_BOT_INVALID'using errcode='22023';end if;
 if x.bot_control is not null and x.bot_control->>'bot_id'<>v->>'bot_id'then raise exception 'PRIVATE_BETA_BOT_IMMUTABLE'using errcode='42501';end if;
 update private.private_beta_programs set bot_control=v where id=p;
 insert into public.messaging_provider_connections(tenant_id,provider,label,status,provider_account_ref)values(t,'telegram','Polat VIP private beta','active',v->>'bot_id')on conflict(tenant_id,provider)do update set provider_account_ref=excluded.provider_account_ref,status='active';
 insert into private.private_beta_observations(tenant_id,program_id,command_id,kind,scenario,outcome,note)values(t,p,extensions.gen_random_uuid(),'BOT_CONTROL','GET_ME','NOTE','Dedicated bot numeric identity independently observed.');
end;$$;
create function public.private_beta_account_control_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;begin
 x:=private.private_beta_guard(target_tenant_id,program_id_value);if x.account_control is null or(x.account_control->>'expires_at')::timestamptz<=clock_timestamp()then raise exception 'PRIVATE_BETA_ACCOUNT_MISSING'using errcode='55000';end if;return jsonb_build_object('payload',x.account_control,'pricing',x.pricing_control);end;$$;
create function private.private_beta_notice(retention_days integer)returns text language sql immutable set search_path=pg_catalog as $$
 select 'Polat VIP private beta: you will chat with Polat''s AI assistant, and authorized human support may review or handle messages. Test messages may be processed by Anthropic. This free beta uses fictional service data and promises no paid subscription, trading outcome or genuine VIP access. Participation is voluntary. Send /stop to leave or /delete to record a deletion request; required audit/legal exceptions may apply. Message retention: '||case when retention_days is null then 'not yet configured; testing remains disabled'else retention_days::text||' days' end||'. Send /agree to accept this notice and participate.'
$$;
create function private.private_beta_participant_projection(x private.private_beta_programs,a private.private_beta_participants)returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('status',case when a.id is null then 'UNINVITED'when a.status='PENDING_NOTICE'then 'NOTICE_REQUIRED'when a.status='REVOKED'and a.deletion_requested_at is not null then 'DELETE_REQUESTED'else a.status end,'program_id',case when a.id is not null then x.id end,'participant_id',a.id,'notice_version',case when a.id is not null then x.configuration->>'notice_version'end,'notice_text',case when a.id is not null and a.status='PENDING_NOTICE'then private.private_beta_notice((x.configuration->>'retention_days')::int)end)
$$;
create function public.private_beta_participant_for_chat_v1(target_tenant_id uuid,bot_id_value text,provider_user_id_value text,provider_chat_id_value text)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;a private.private_beta_participants;begin
 select * into x from private.private_beta_programs where tenant_id=target_tenant_id;
 if x.id is null or x.bot_control->>'bot_id'is distinct from bot_id_value or provider_user_id_value is distinct from provider_chat_id_value or provider_user_id_value!~'^[1-9][0-9]{0,18}$'then return private.private_beta_participant_projection(x,a);end if;
 perform private.private_beta_guard(target_tenant_id,x.id);select * into a from private.private_beta_participants where program_id=x.id and provider_user_id=provider_user_id_value and provider_chat_id=provider_chat_id_value;
 return private.private_beta_participant_projection(x,a);end;$$;
create function public.private_beta_invite_accept_v1(target_tenant_id uuid,bot_id_value text,provider_user_id_value text,provider_chat_id_value text,command_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;a private.private_beta_participants;i private.private_beta_invites;notice text;begin
 select * into x from private.private_beta_programs where tenant_id=target_tenant_id for update;
 if x.id is null or x.bot_control->>'bot_id'is distinct from bot_id_value or provider_user_id_value is distinct from provider_chat_id_value or provider_user_id_value!~'^[1-9][0-9]{0,18}$'or command_value is null or length(command_value)>120 then return private.private_beta_participant_projection(x,a);end if;
 perform private.private_beta_guard(target_tenant_id,x.id);select * into a from private.private_beta_participants where program_id=x.id and provider_user_id=provider_user_id_value and provider_chat_id=provider_chat_id_value;
 if a.conversation_id is not null then perform 1 from public.conversations where tenant_id=target_tenant_id and id=a.conversation_id for update;end if;
 if a.id is not null then select * into a from private.private_beta_participants where id=a.id for update;end if;
 if a.id is null and command_value~'^/start [a-f0-9]{48}$'and x.stage<>'STOPPED'then
  select * into i from private.private_beta_invites where program_id=x.id and code_hash=private.fse_hash(substring(command_value from 8))and expires_at>clock_timestamp()for update;
  if i.id is null or i.accepted_by is not null then return private.private_beta_participant_projection(x,a);end if;
  if(select count(*)from private.private_beta_participants where program_id=x.id and kind=i.kind)>=(case i.kind when 'FOUNDER'then 1 else 10 end)then return private.private_beta_participant_projection(x,a);end if;
  notice:=private.private_beta_notice((x.configuration->>'retention_days')::int);
  insert into private.private_beta_participants(tenant_id,program_id,invite_id,kind,provider_user_id,provider_chat_id,notice_version,notice_hash)values(target_tenant_id,x.id,i.id,i.kind,provider_user_id_value,provider_chat_id_value,x.configuration->>'notice_version',private.fse_hash(notice))returning * into a;
  update private.private_beta_invites set accepted_by=provider_user_id_value,accepted_chat=provider_chat_id_value,accepted_at=clock_timestamp()where id=i.id;
 elsif a.id is not null and command_value='/agree'and a.status='PENDING_NOTICE'and x.stage<>'STOPPED'then
  notice:=private.private_beta_notice((x.configuration->>'retention_days')::int);
  if x.configuration->>'retention_days'is null or a.notice_hash is distinct from private.fse_hash(notice)or not exists(select 1 from public.messages m where m.tenant_id=target_tenant_id and m.direction='outbound'and m.status='sent'and m.provider_message_id~'^[1-9][0-9]*$'and m.provider_chat_id=a.provider_chat_id and m.actor_id='private-beta-notice'and m.content=notice and m.idempotency_key='private-beta-notice:'||a.id::text||':'||a.notice_version)then return private.private_beta_participant_projection(x,a);end if;
  update private.private_beta_participants set status='ACTIVE',consented_at=clock_timestamp(),revision=revision+1 where id=a.id returning * into a;
 elsif a.id is not null and command_value in('/stop','/delete')then
  update private.private_beta_participants set status='REVOKED',revoked_at=coalesce(revoked_at,clock_timestamp()),deletion_requested_at=case when command_value='/delete'then coalesce(deletion_requested_at,clock_timestamp())else deletion_requested_at end,revision=revision+1 where id=a.id returning * into a;
  if a.conversation_id is not null then
   update public.conversations set runtime_mode='PAUSED',human_takeover=true,automatic_replies_enabled=false,automatic_replies_enabled_at=null,attention_required=command_value='/delete'where tenant_id=target_tenant_id and id=a.conversation_id;
   update public.messaging_contacts set contactability='revoked'where tenant_id=target_tenant_id and id=(select messaging_contact_id from public.conversations where tenant_id=target_tenant_id and id=a.conversation_id);
   update public.messages set status='blocked',failure_code='PRIVATE_BETA_PARTICIPATION_REVOKED'where tenant_id=target_tenant_id and conversation_id=a.conversation_id and direction='outbound'and status in('pending','retry_scheduled');
  end if;
  insert into private.private_beta_observations(tenant_id,program_id,conversation_id,command_id,kind,scenario,outcome,note)values(target_tenant_id,x.id,a.conversation_id,extensions.gen_random_uuid(),case when command_value='/delete'then 'DELETION_REQUEST'else 'PARTICIPATION'end,'PARTICIPATION_REVOKED',case when command_value='/delete'then 'BLOCKED'else 'NOTE'end,case when command_value='/delete'then 'Deletion requested; no deletion represented as completed. Review retention, privacy and legal-hold boundaries.'else 'Participation revoked by matching numeric Telegram user.'end);
 end if;
 if a.id is not null then insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','private_beta.participation','private_beta_participants',a.id::text,jsonb_build_object('status',a.status,'notice_version',a.notice_version,'revision',a.revision,'identity_redacted',true));end if;
 return private.private_beta_participant_projection(x,a);end;$$;
create function public.private_beta_bind_conversation_v1(target_tenant_id uuid,participant_id_value uuid,target_conversation_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare a private.private_beta_participants;x private.private_beta_programs;c public.conversations;customer_value uuid;begin
 select * into a from private.private_beta_participants where tenant_id=target_tenant_id and id=participant_id_value;if a.id is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;x:=private.private_beta_guard(target_tenant_id,a.program_id);select * into x from private.private_beta_programs where id=x.id for update;
 select v.* into c from public.conversations v join public.messaging_contacts m on m.tenant_id=v.tenant_id and m.id=v.messaging_contact_id join public.messaging_provider_connections b on b.tenant_id=v.tenant_id and b.id=v.provider_connection_id where v.tenant_id=target_tenant_id and v.id=target_conversation_id and m.provider_user_id=a.provider_user_id and m.provider_chat_id=a.provider_chat_id and b.provider_account_ref=x.bot_control->>'bot_id'for update of v;
 select * into a from private.private_beta_participants where id=a.id for update;
 if x.stage='STOPPED'or c.id is null or a.status<>'ACTIVE'or(a.conversation_id is not null and a.conversation_id<>c.id)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 if a.conversation_id is null then
  customer_value:=c.customer_id;if customer_value is null then insert into public.customers(tenant_id,external_ref,display_name,source_type,source_name,source_metadata)values(target_tenant_id,'private-beta:'||a.id::text,'Invited private beta participant','invited_beta','Polat VIP',jsonb_build_object('commercial_sales',false,'financial_authority','NONE'))returning id into customer_value;
   update public.conversations set customer_id=customer_value where tenant_id=target_tenant_id and id=c.id;update public.messaging_contacts set customer_id=customer_value,contactability='user_initiated',identity_resolution='manual',review_required=false where tenant_id=target_tenant_id and id=c.messaging_contact_id;
   update public.messages set customer_id=customer_value where tenant_id=target_tenant_id and conversation_id=c.id and customer_id is null;
  end if;
  update private.private_beta_participants set conversation_id=c.id,revision=revision+1 where id=a.id;
  update public.conversations set runtime_mode='AI_ACTIVE',human_takeover=false,automatic_replies_enabled=true,automatic_replies_enabled_at=clock_timestamp()where tenant_id=target_tenant_id and id=c.id;
 end if;
 return jsonb_build_object('bound',true);end;$$;

create function private.private_beta_live_window(x private.private_beta_programs)returns boolean language sql stable set search_path=pg_catalog as $$
 select coalesce(x.stage in('CANARY','FOUNDER','FRIENDS')and x.configuration->>'repository_sha'is not null and x.configuration->>'retention_days'is not null
 and(x.configuration->>'starts_at')::timestamptz<=clock_timestamp()and(x.configuration->>'expires_at')::timestamptz>clock_timestamp(),false)
$$;
create function private.private_beta_binding(x private.private_beta_programs,canary boolean)returns jsonb language plpgsql stable set search_path=pg_catalog as $$declare liability numeric;begin
 if x.account_control is null or x.pricing_control is null or x.configuration->>'repository_sha'is null or x.configuration->>'expires_at'is null then raise exception 'PRIVATE_BETA_ACCOUNT_MISSING'using errcode='55000';end if;
 liability:=(x.pricing_control->>'maximum_input_tokens')::numeric*(x.pricing_control->>'maximum_input_usd_per_million')::numeric/1000000+512*(x.pricing_control->>'maximum_output_usd_per_million')::numeric/1000000;
 return jsonb_build_object('version',1,'mode','PRIVATE_BETA_UAT','program_id',x.id,'tenant_id',x.tenant_id,'conversation_style','DIRECT','provider','anthropic','model','claude-haiku-5-5','model_version','claude-haiku-5-5','protocol_version','2023-06-01',
 'repository_sha',x.configuration->>'repository_sha','manifest_hash',x.manifest_hash,'authorization_record_hash',x.authorization_record_hash,'account_scope_hash',x.account_control->>'account_scope_hash',
 'corpus_version',case when canary then 'polat-claude-canary-v1'else 'polat-private-beta-conversation-v1'end,
 'corpus_hash',case when canary then '1afc425d131e4f3e7ee82976e034b703fffbd59bd388b6c1738a6617290d3630'else private.fse_hash('POLAT_PRIVATE_BETA_CONVERSATION1')end,
 'plan_hash',case when canary then '372b81b5017359aef85f3b4080c1ff7f6bf9193459c30a2505425fc5463066c5'else private.fse_hash(private.fse_canonical(jsonb_build_array('POLAT_PRIVATE_BETA_PLAN1',x.id,x.manifest_hash,20,30,10,350,'5.00')))end,
 'maximum_requests',case when canary then 1 else 350 end,'maximum_spend','5.00','maximum_attempt_liability',trim_scale(liability)::text,'currency','USD','maximum_output_tokens',512,'timeout_ms',10000,
 'expires_at',to_char((x.configuration->>'expires_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'financial_authority','NONE','commercial_sales',false);
end;$$;
create function public.admin_private_beta_transition_v1(target_tenant_id uuid,program_id_value uuid,stage_value text,expected_generation_value bigint)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;b jsonb;r uuid;ts timestamptz:=clock_timestamp();authenticated_value timestamptz;begin
 perform private.private_beta_admin(target_tenant_id,true);x:=case when stage_value='STOPPED'then private.private_beta_evidence_guard(target_tenant_id,program_id_value)else private.private_beta_guard(target_tenant_id,program_id_value)end;select * into x from private.private_beta_programs where id=x.id for update;
 if x.owner_user_id<>auth.uid()or x.generation is distinct from expected_generation_value then raise exception 'PRIVATE_BETA_REVISION_CHANGED'using errcode='40001';end if;
 if stage_value is null or stage_value not in('CANARY','FOUNDER','FRIENDS','STOPPED')or x.stage='STOPPED'then raise exception 'PRIVATE_BETA_TRANSITION_INVALID'using errcode='22023';end if;
 if stage_value<>'STOPPED'then
  authenticated_value:=private.private_beta_mfa_at();
  if not((x.stage='DRAFT'and stage_value='CANARY')or(x.stage='CANARY'and stage_value='FOUNDER')or(x.stage='FOUNDER'and stage_value='FRIENDS'))then raise exception 'PRIVATE_BETA_TRANSITION_INVALID'using errcode='22023';end if;
  if x.configuration->>'starts_at'is null or x.configuration->>'expires_at'is null or x.configuration->>'retention_days'is null or(x.configuration->>'starts_at')::timestamptz>ts or(x.configuration->>'expires_at')::timestamptz<=ts
  or x.account_control is null or(x.account_control->>'expires_at')::timestamptz<=ts or x.account_control->>'manifest_hash'is distinct from x.manifest_hash or x.account_control->>'authorization_record_hash'is distinct from x.authorization_record_hash then raise exception 'PRIVATE_BETA_PREREQUISITES_MISSING'using errcode='55000';end if;
  if stage_value in('FOUNDER','FRIENDS')and(x.bot_control is null or x.bot_control->>'api_environment'is distinct from 'production'or x.bot_control->>'credential_sha256'is null or x.canary_reconciliation_hash is null or x.configuration->>'primary_operator'is null or x.configuration->>'backup_operator'is null
  or not exists(select 1 from public.tenant_members where tenant_id=target_tenant_id and user_id=(x.configuration->>'primary_operator')::uuid and role in('super_admin','manager')and status='active')
  or not exists(select 1 from public.tenant_members where tenant_id=target_tenant_id and user_id=(x.configuration->>'backup_operator')::uuid and role in('super_admin','manager')and status='active'))then raise exception 'PRIVATE_BETA_PREREQUISITES_MISSING'using errcode='55000';end if;
  b:=private.private_beta_binding(x,stage_value='CANARY');r:=case when stage_value='CANARY'then x.canary_run_id else x.conversation_run_id end;
  if not exists(select 1 from private.polat_experiment_runs where id=r)then
   insert into private.polat_experiment_runs(id,tenant_id,account_scope_hash,authorization_record_hash,binding,binding_hash)values(r,target_tenant_id,x.account_control->>'account_scope_hash',private.fse_hash(x.authorization_record_hash||case when stage_value='CANARY'then ':CANARY'else ':CONVERSATION'end),b,private.fse_hash(private.fse_canonical(b)));
  end if;
 end if;
 update private.private_beta_programs set stage=stage_value,generation=generation+1,approved_at=case when stage_value='STOPPED'then approved_at else ts end,authenticated_at=case when stage_value='STOPPED'then authenticated_at else authenticated_value end where id=x.id returning * into x;
 if stage_value='STOPPED'then
  update public.messages set status='blocked',failure_code='PRIVATE_BETA_STOPPED'where tenant_id=target_tenant_id and direction='outbound'and status in('pending','retry_scheduled')and conversation_id in(select conversation_id from private.private_beta_participants where program_id=x.id);
  update public.conversations set automatic_replies_enabled=false,runtime_mode='PAUSED',human_takeover=true,automatic_replies_enabled_at=null where tenant_id=target_tenant_id and id in(select conversation_id from private.private_beta_participants where program_id=x.id);
 end if;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.program_transition','private_beta_programs',x.id::text,jsonb_build_object('stage',stage_value,'generation',x.generation,'financial_authority','NONE','commercial_sales',false));
 return jsonb_build_object('program_id',x.id,'stage',x.stage,'generation',x.generation::text);end;$$;
create function public.private_beta_binding_v1(target_tenant_id uuid,program_id_value uuid,scope_value text)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;r private.polat_experiment_runs;begin
 x:=private.private_beta_guard(target_tenant_id,program_id_value);if scope_value is null or scope_value not in('CANARY','CONVERSATION')then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 select * into r from private.polat_experiment_runs where tenant_id=target_tenant_id and id=case scope_value when 'CANARY'then x.canary_run_id else x.conversation_run_id end;
 if r.id is null or not private.private_beta_live_window(x)or(scope_value='CANARY'and x.stage<>'CANARY')or(scope_value='CONVERSATION'and x.stage not in('FOUNDER','FRIENDS'))then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 return r.binding;end;$$;
create function public.private_beta_owner_grant_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;r private.polat_experiment_runs;begin
 x:=private.private_beta_guard(target_tenant_id,program_id_value);if not private.private_beta_live_window(x)or x.approved_at is null or not exists(select 1 from public.tenant_members where tenant_id=target_tenant_id and user_id=x.owner_user_id and role='super_admin'and status='active')then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 select * into strict r from private.polat_experiment_runs where id=case when x.stage='CANARY'then x.canary_run_id else x.conversation_run_id end;
 return jsonb_build_object('version',1,'origin','SERVER_AUTHENTICATED_OWNER_GRANT','program_id',x.id,'tenant_id',x.tenant_id,'owner_user_id',x.owner_user_id,'role','super_admin','aal','aal2','authenticated_at',x.authenticated_at,'approved_at',x.approved_at,'starts_at',(x.configuration->>'starts_at')::timestamptz,'expires_at',(x.configuration->>'expires_at')::timestamptz,'revoked',false,'phase',x.stage,'binding_hash',r.binding_hash,'policy_hash',x.account_control->>'policy_hash','credential_custody_hash',x.account_control->>'credential_custody_hash');end;$$;

create function public.private_beta_source_scope_v1(target_tenant_id uuid,target_conversation_id uuid,target_event_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare a private.private_beta_participants;x private.private_beta_programs;c public.conversations;m public.messages;begin
 select * into a from private.private_beta_participants where tenant_id=target_tenant_id and conversation_id=target_conversation_id;
 if a.id is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;x:=private.private_beta_guard(target_tenant_id,a.program_id);
 select * into c from public.conversations where tenant_id=target_tenant_id and id=target_conversation_id;
 select s.* into m from public.messages s join public.domain_events e on e.tenant_id=s.tenant_id and e.payload->>'message_id'=s.id::text where e.tenant_id=target_tenant_id and e.id=target_event_id and e.event_type='message.received'and s.conversation_id=c.id and s.direction='inbound';
 if not private.private_beta_live_window(x)or a.status<>'ACTIVE'or a.consented_at is null or m.id is null or c.runtime_mode<>'AI_ACTIVE'or c.human_takeover or not c.automatic_replies_enabled
 or not((a.kind='FOUNDER'and x.stage in('FOUNDER','FRIENDS'))or(a.kind='FRIEND'and x.stage='FRIENDS'))
 or a.last_inbound_id is distinct from m.id
 or exists(select 1 from public.messages s where s.tenant_id=target_tenant_id and s.conversation_id=c.id and s.direction='outbound'and(s.status='sending'or s.failure_code='TELEGRAM_DELIVERY_UNCERTAIN'))
 or not exists(select 1 from public.messaging_contacts where tenant_id=target_tenant_id and id=c.messaging_contact_id and provider_user_id=a.provider_user_id and provider_chat_id=a.provider_chat_id and contactability in('user_initiated','allowed'))
 then raise exception 'PRIVATE_BETA_SOURCE_HELD'using errcode='55000';end if;
 return jsonb_build_object('program_id',x.id,'participant_id',a.id,'tenant_id',target_tenant_id,'conversation_id',c.id,'source_message_id',m.id,'revision',a.revision,'boundary',m.created_at);end;$$;
create function public.private_beta_conversation_scope_v1(target_tenant_id uuid,target_conversation_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare a private.private_beta_participants;x private.private_beta_programs;c public.conversations;begin
 select * into a from private.private_beta_participants where tenant_id=target_tenant_id and conversation_id=target_conversation_id;if a.id is null then return null;end if;x:=private.private_beta_guard(target_tenant_id,a.program_id);select * into strict c from public.conversations where tenant_id=target_tenant_id and id=target_conversation_id;
 return jsonb_build_object('program_id',x.id,'participant_id',a.id,'tenant_id',target_tenant_id,'conversation_id',c.id,'stage',x.stage,'participation',a.status,'ownership',c.runtime_mode,'generation',a.revision::text,'window_active',private.private_beta_live_window(x),'bot_id',x.bot_control->>'bot_id','provider_user_id',a.provider_user_id,'provider_chat_id',a.provider_chat_id,'kind',a.kind,'maximum_requests',case a.kind when 'FOUNDER'then 20 else 30 end,'request_count',a.request_count,'last_inbound_id',a.last_inbound_id,'financial_authority','NONE');end;$$;
create function private.private_beta_revision_fence()returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if tg_table_name='messages'then if new.direction='inbound'then update private.private_beta_participants set revision=revision+1,last_inbound_id=new.id where tenant_id=new.tenant_id and conversation_id=new.conversation_id;end if;
 elsif(new.runtime_mode,new.human_takeover,new.automatic_replies_enabled)is distinct from(old.runtime_mode,old.human_takeover,old.automatic_replies_enabled)then update private.private_beta_participants set revision=revision+1,last_inbound_id=null where tenant_id=new.tenant_id and conversation_id=new.id;end if;return new;end;$$;
create trigger private_beta_inbound_revision after insert on public.messages for each row execute function private.private_beta_revision_fence();
create trigger private_beta_ownership_revision after update of runtime_mode,human_takeover,automatic_replies_enabled on public.conversations for each row execute function private.private_beta_revision_fence();

create function private.private_beta_append(x private.polat_experiment_runs,a private.polat_experiment_attempts,kind text,p jsonb,key_hash text default null,deadline_value timestamptz default null)returns text language plpgsql set search_path=pg_catalog as $$declare prev text;h text;n integer;begin
 if x.binding->>'mode'<>'PRIVATE_BETA_UAT'or x.event_sequence>=2048 then raise exception 'PRIVATE_BETA_HISTORY_LIMIT'using errcode='54000';end if;
 n:=x.event_sequence+1;select evidence_hash into prev from private.polat_experiment_evidence where run_id=x.id order by sequence desc limit 1;
 h:=private.fse_hash(private.fse_canonical(jsonb_build_array('POLAT_EXPERIMENT_EVIDENCE1',x.binding_hash,a.id,n,kind,p,prev,key_hash,deadline_value)));
 insert into private.polat_experiment_evidence(id,tenant_id,run_id,attempt_id,sequence,stage,payload,command_hash,previous_hash,evidence_hash,dispatch_key_hash,deadline,account_scope_hash,response_identity_hash)
 values(extensions.gen_random_uuid(),x.tenant_id,x.id,a.id,n,kind,p,private.fse_hash(private.fse_canonical(p)),prev,h,key_hash,deadline_value,x.account_scope_hash,p->>'response_identity_hash');
 update private.polat_experiment_runs set event_sequence=n where id=x.id;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(x.tenant_id,'SYSTEM','private_beta.attempt_evidence','polat_experiment_attempts',a.id::text,jsonb_build_object('stage',kind,'sequence',n,'evidence_hash',h,'financial_authority','NONE'));
 return h;end;$$;
-- Current maximum exposure is derived from the existing immutable journal, never from token-price estimates.
-- Historical gross reservation counters remain monotonic and independently auditable.
create function private.private_beta_exposure(program_value uuid)returns numeric language sql stable set search_path=pg_catalog as $$
 select coalesce(sum(coalesce((select (e.payload->>'actual_billed_amount')::numeric from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage='RECONCILIATION'and e.payload->>'origin'='INDEPENDENT_PROVIDER_BILLING'and e.payload->>'status'='ACTUAL_RECONCILED'and e.payload#>>'{source,coverage}'='COMPLETE_REQUEST_CHARGE'order by e.sequence desc limit 1),a.liability)),0)
 from private.private_beta_attempt_scope s join private.polat_experiment_attempts a on a.id=s.attempt_id where s.program_id=program_value
$$;
create function private.private_beta_reservation(x private.private_beta_programs,r private.polat_experiment_runs,a private.polat_experiment_attempts,s private.private_beta_attempt_scope,replayed boolean)returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('version',1,'mode','PRIVATE_BETA_UAT','program_id',x.id,'tenant_id',x.tenant_id,'run_id',r.id,'native_run_id',s.native_run_id,'attempt_id',a.id,'binding_hash',r.binding_hash,'request_hash',a.request_hash,'body_hash',a.body_hash,'liability',trim_scale(a.liability)::text,'replay',replayed,'dispatch_started',s.dispatch_started_at is not null)
$$;
create function private.private_beta_control_seed(t uuid,p uuid)returns jsonb language plpgsql stable set search_path=pg_catalog as $$declare x private.private_beta_programs;begin
 if current_user<>'postgres'then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;x:=private.private_beta_evidence_guard(t,p);
 return jsonb_build_object('version',1,'program_id',x.id,'tenant_id',x.tenant_id,'stage',x.stage,'repository_sha',x.configuration->>'repository_sha','manifest_hash',x.manifest_hash,'authorization_record_hash',x.authorization_record_hash,'starts_at',x.configuration->>'starts_at','expires_at',x.configuration->>'expires_at','retention_days',x.configuration->>'retention_days','maximum_requests',350,'maximum_spend','5.00','currency','USD','request_count',x.request_count,'budget_exposure',trim_scale(private.private_beta_exposure(x.id))::text,'bot_id',x.bot_control->>'bot_id','bot_credential_sha256',x.bot_control->>'credential_sha256','canary_reconciliation_hash',x.canary_reconciliation_hash);
end;$$;
create function public.private_beta_reserve_v1(target_tenant_id uuid,program_id_value uuid,native_run_id_value uuid,request_hash_value text,body_hash_value text,source_message_id_value uuid,liability_value text,conversation_id_value uuid default null)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x private.private_beta_programs;r private.polat_experiment_runs;a private.polat_experiment_attempts;s private.private_beta_attempt_scope;part private.private_beta_participants;cv public.conversations;msg public.messages;native public.agent_runs;task public.agent_tasks;liability numeric;run_value uuid;scope_value text;begin
 x:=private.private_beta_guard(target_tenant_id,program_id_value);select * into x from private.private_beta_programs where id=x.id for update;
 if request_hash_value is null or request_hash_value!~'^[a-f0-9]{64}$'or body_hash_value is null or body_hash_value!~'^[a-f0-9]{64}$'or native_run_id_value is null then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 if source_message_id_value is not null and exists(select 1 from private.private_beta_attempt_scope where program_id=x.id and source_message_id=source_message_id_value and native_run_id<>native_run_id_value)then raise exception 'PRIVATE_BETA_SOURCE_ALREADY_RESERVED'using errcode='55000';end if;
 select * into s from private.private_beta_attempt_scope where program_id=x.id and native_run_id=native_run_id_value;
 if s.attempt_id is not null then select * into strict a from private.polat_experiment_attempts where id=s.attempt_id;select * into strict r from private.polat_experiment_runs where id=a.run_id;
  if a.request_hash<>request_hash_value or a.body_hash<>body_hash_value or s.source_message_id is distinct from source_message_id_value then raise exception 'PRIVATE_BETA_REVISION_CHANGED'using errcode='40001';end if;return private.private_beta_reservation(x,r,a,s,true);end if;
 if not private.private_beta_live_window(x)or x.account_control is null or(x.account_control->>'expires_at')::timestamptz<=clock_timestamp()or x.account_control->'unknown_outcome_count'is distinct from '0'::jsonb then raise exception 'PRIVATE_BETA_PREREQUISITES_MISSING'using errcode='55000';end if;
 if exists(select 1 from private.polat_experiment_evidence e join private.private_beta_attempt_scope z on z.attempt_id=e.attempt_id where z.program_id=x.id and e.stage='RESULT_UNKNOWN')then raise exception 'PRIVATE_BETA_UNRESOLVED_ATTEMPT'using errcode='55000';end if;
 if x.stage='CANARY'then
  if source_message_id_value is not null or conversation_id_value is null or x.request_count<>0 then raise exception 'PRIVATE_BETA_LIMIT'using errcode='54000';end if;run_value:=x.canary_run_id;scope_value:='CANARY';
 else
  if x.canary_reconciliation_hash is null or source_message_id_value is null then raise exception 'PRIVATE_BETA_CANARY_UNVERIFIED'using errcode='55000';end if;
  select * into native from public.agent_runs where tenant_id=target_tenant_id and id=native_run_id_value;select * into task from public.agent_tasks where tenant_id=target_tenant_id and id=native.task_id;
  select * into msg from public.messages where tenant_id=target_tenant_id and id=source_message_id_value and direction='inbound'and conversation_id=task.conversation_id;
  select * into part from private.private_beta_participants where tenant_id=target_tenant_id and program_id=x.id and conversation_id=msg.conversation_id;
  select * into cv from public.conversations where tenant_id=target_tenant_id and id=part.conversation_id for update;
  if part.id is not null then select * into part from private.private_beta_participants where id=part.id for update;end if;
  if native.id is null or task.source_event_id is null or msg.id is null or part.id is null or part.status<>'ACTIVE'or part.consented_at is null or cv.runtime_mode<>'AI_ACTIVE'or cv.human_takeover or(conversation_id_value is not null and conversation_id_value<>cv.id)
  or task.task_type<>'private_beta.reply'or native.context_manifest->>'polat_profile'is distinct from 'polat-private-beta-v1'or native.context_manifest->>'private_beta_program_id'is distinct from x.id::text or native.context_manifest->>'private_beta_participant_id'is distinct from part.id::text or native.context_manifest->>'private_beta_revision'is distinct from part.revision::text
  or not exists(select 1 from public.agent_versions where tenant_id=target_tenant_id and id=native.agent_version_id and model_provider='anthropic'and model_name='claude-haiku-5-5')
  or not exists(select 1 from public.domain_events where tenant_id=target_tenant_id and id=task.source_event_id and payload->>'message_id'=msg.id::text)
  or not((part.kind='FOUNDER'and x.stage in('FOUNDER','FRIENDS'))or(part.kind='FRIEND'and x.stage='FRIENDS'))
  or part.request_count>=(case part.kind when 'FOUNDER'then 20 else 30 end)
  or part.last_inbound_id is distinct from msg.id then raise exception 'PRIVATE_BETA_SOURCE_HELD'using errcode='55000';end if;
  run_value:=x.conversation_run_id;scope_value:=part.kind;
 end if;
 select * into r from private.polat_experiment_runs where tenant_id=target_tenant_id and id=run_value for update;if r.id is null or r.stop_reason is not null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 liability:=private.polat_experiment_decimal(liability_value);if liability::numeric<>(r.binding->>'maximum_attempt_liability')::numeric then raise exception 'PRIVATE_BETA_REVISION_CHANGED'using errcode='40001';end if;
 if x.request_count>=350 or private.private_beta_exposure(x.id)+liability>5 or liability>private.polat_experiment_decimal(x.account_control->>'remaining_allowance')or r.request_count>=(r.binding->>'maximum_requests')::int then raise exception 'PRIVATE_BETA_LIMIT'using errcode='54000';end if;
 insert into private.polat_experiment_attempts(id,tenant_id,run_id,ordinal,target_hash,request_hash,body_hash,liability)values(extensions.gen_random_uuid(),target_tenant_id,r.id,r.request_count+1,private.fse_hash(private.fse_canonical(jsonb_build_array('POLAT_UAT_ATTEMPT1',native_run_id_value,source_message_id_value))),request_hash_value,body_hash_value,liability)returning * into a;
 update private.polat_experiment_runs set request_count=request_count+1,reserved_liability=reserved_liability+liability where id=r.id returning * into r;
 update private.private_beta_programs set request_count=request_count+1,reserved_liability=reserved_liability+liability where id=x.id returning * into x;
 if part.id is not null then update private.private_beta_participants set request_count=request_count+1 where id=part.id returning * into part;end if;
 insert into private.private_beta_attempt_scope(tenant_id,program_id,attempt_id,native_run_id,conversation_id,participant_id,source_message_id,scope,participant_revision,source_boundary,generation,global_ordinal,participant_ordinal)
 values(target_tenant_id,x.id,a.id,native_run_id_value,coalesce(cv.id,conversation_id_value),part.id,source_message_id_value,scope_value,part.revision,msg.created_at,coalesce(part.revision,x.generation),x.request_count,coalesce(part.request_count,0))returning * into s;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','private_beta.attempt_reserved','polat_experiment_attempts',a.id::text,jsonb_build_object('program_id',x.id,'ordinal',x.request_count,'request_hash',a.request_hash,'financial_authority','NONE'));
 return private.private_beta_reservation(x,r,a,s,false);end;$$;
create function public.private_beta_begin_v1(target_tenant_id uuid,program_id_value uuid,attempt_id_value uuid,dispatch_nonce_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;r private.polat_experiment_runs;a private.polat_experiment_attempts;s private.private_beta_attempt_scope;part private.private_beta_participants;c public.conversations;begin
 x:=private.private_beta_guard(target_tenant_id,program_id_value);select * into x from private.private_beta_programs where id=x.id for update;select * into s from private.private_beta_attempt_scope where tenant_id=target_tenant_id and program_id=x.id and attempt_id=attempt_id_value for update;
 if s.attempt_id is null or dispatch_nonce_value is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;if s.dispatch_started_at is not null then return jsonb_build_object('dispatch',false);end if;
 if not private.private_beta_live_window(x)or x.account_control is null or(x.account_control->>'expires_at')::timestamptz<=clock_timestamp()then raise exception 'PRIVATE_BETA_PREREQUISITES_MISSING'using errcode='55000';end if;
 if s.scope<>'CANARY'then
  select * into c from public.conversations where tenant_id=target_tenant_id and id=s.conversation_id for update;select * into part from private.private_beta_participants where tenant_id=target_tenant_id and id=s.participant_id for update;
  if part.status<>'ACTIVE'or part.revision is distinct from s.participant_revision or c.runtime_mode<>'AI_ACTIVE'or c.human_takeover or not c.automatic_replies_enabled
  or part.last_inbound_id is distinct from s.source_message_id then raise exception 'PRIVATE_BETA_REVISION_CHANGED'using errcode='40001';end if;
 end if;
 select * into strict a from private.polat_experiment_attempts where id=s.attempt_id;select * into strict r from private.polat_experiment_runs where id=a.run_id for update;
 if r.stop_reason is not null then raise exception 'PRIVATE_BETA_UNRESOLVED_ATTEMPT'using errcode='55000';end if;if private.private_beta_exposure(x.id)>5 then raise exception 'PRIVATE_BETA_LIMIT'using errcode='54000';end if;
 if exists(select 1 from private.polat_experiment_evidence e where e.run_id=r.id and e.stage='DISPATCH_STARTED'and not exists(select 1 from private.polat_experiment_evidence q where q.attempt_id=e.attempt_id and q.stage='PROVIDER_RESULT'))then raise exception 'PRIVATE_BETA_UNRESOLVED_ATTEMPT'using errcode='55000';end if;
 update private.private_beta_attempt_scope set dispatch_nonce=dispatch_nonce_value,dispatch_started_at=clock_timestamp(),deadline=least(clock_timestamp()+interval '10 seconds',(x.configuration->>'expires_at')::timestamptz)where attempt_id=s.attempt_id returning * into s;
 perform private.private_beta_append(r,a,'DISPATCH_STARTED',jsonb_build_object('status','STARTED','request_hash',a.request_hash,'body_hash',a.body_hash,'retry','NONE'),private.fse_hash(dispatch_nonce_value::text),s.deadline);
 return jsonb_build_object('dispatch',true);end;$$;
create function public.private_beta_committed_attempt_v1(target_tenant_id uuid,program_id_value uuid,attempt_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;r private.polat_experiment_runs;a private.polat_experiment_attempts;s private.private_beta_attempt_scope;part private.private_beta_participants;c public.conversations;p jsonb;begin
 x:=private.private_beta_guard(target_tenant_id,program_id_value);select * into s from private.private_beta_attempt_scope where tenant_id=target_tenant_id and program_id=x.id and attempt_id=attempt_id_value;
 if s.attempt_id is null or s.dispatch_nonce is null or s.dispatch_started_at is null or s.deadline<=clock_timestamp()or private.private_beta_exposure(x.id)>5 or not private.private_beta_live_window(x)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 if s.scope<>'CANARY'then select * into part from private.private_beta_participants where tenant_id=target_tenant_id and id=s.participant_id;select * into c from public.conversations where tenant_id=target_tenant_id and id=s.conversation_id;
  if part.status<>'ACTIVE'or part.revision is distinct from s.participant_revision or c.runtime_mode<>'AI_ACTIVE'or c.human_takeover then raise exception 'PRIVATE_BETA_REVISION_CHANGED'using errcode='40001';end if;end if;
 select * into strict a from private.polat_experiment_attempts where id=s.attempt_id;select * into strict r from private.polat_experiment_runs where id=a.run_id;
 p:=jsonb_build_object('version',2,'purpose','POLAT_PRIVATE_BETA_UAT','program_id',x.id,'tenant_id',target_tenant_id,'run_id',r.id,'native_run_id',s.native_run_id,'conversation_id',s.conversation_id,'attempt_id',a.id,'participant_id',s.participant_id,'scope',s.scope,'source_message_id',s.source_message_id,'binding_hash',r.binding_hash,'request_hash',a.request_hash,'body_hash',a.body_hash,'account_scope_hash',r.binding->>'account_scope_hash','authorization_record_hash',x.authorization_record_hash,'global_ordinal',s.global_ordinal,'participant_ordinal',s.participant_ordinal,'liability',trim_scale(a.liability)::text,'reserved_liability',trim_scale(private.private_beta_exposure(x.id))::text,'generation',s.generation::text,'dispatch_nonce',s.dispatch_nonce,'issued_at',s.dispatch_started_at,'expires_at',s.deadline);
 return jsonb_build_object('version',1,'mode','PRIVATE_BETA_UAT','state','DISPATCH_STARTED','ownership','AI_ACTIVE','participation','ACTIVE','program_id',x.id,'tenant_id',target_tenant_id,'run_id',r.id,'native_run_id',s.native_run_id,'conversation_id',s.conversation_id,'attempt_id',a.id,'request_hash',a.request_hash,'body_hash',a.body_hash,'binding_hash',r.binding_hash,'generation',s.generation::text,'dispatch_nonce',s.dispatch_nonce,'payload',p);end;$$;
create function public.private_beta_record_v1(target_tenant_id uuid,program_id_value uuid,attempt_id_value uuid,dispatch_nonce_value uuid,raw_outcome_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;r private.polat_experiment_runs;a private.polat_experiment_attempts;s private.private_beta_attempt_scope;p jsonb;old private.polat_experiment_evidence;k text;stage_value text;begin
 x:=private.private_beta_evidence_guard(target_tenant_id,program_id_value);select * into x from private.private_beta_programs where id=x.id for update;select * into s from private.private_beta_attempt_scope where tenant_id=target_tenant_id and program_id=x.id and attempt_id=attempt_id_value for update;
 if s.attempt_id is null or s.dispatch_nonce is distinct from dispatch_nonce_value or s.dispatch_started_at is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 p:=private.fse_strict_json(raw_outcome_value);if octet_length(raw_outcome_value)>8192 or not private.fse_keys(p,array['version','stage','status','response_hash','response_identity_hash','elapsed_ms','input_tokens','output_tokens','qa','actual_billed_amount','actual_billed_currency','financial_authority','error_code','provider_usage_hash'])
 or not private.fse_strings(p,array['stage','status','qa','financial_authority'],array['response_hash','response_identity_hash','elapsed_ms','error_code','provider_usage_hash'])or p->'version'is distinct from '1'::jsonb or p->>'stage'not in('PROVIDER_RESULT','RESULT_UNKNOWN')or p->>'status'not in('SUCCEEDED','FAILED','UNKNOWN')or p->>'qa'not in('APPROVED','HELD','NOT_EVALUATED')or p->'actual_billed_amount'is distinct from 'null'::jsonb or p->'actual_billed_currency'is distinct from 'null'::jsonb or p->>'financial_authority'is distinct from 'NONE'then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 foreach k in array array['response_hash','response_identity_hash','provider_usage_hash']loop if p->>k is not null and p->>k!~'^[a-f0-9]{64}$'then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;end loop;
 foreach k in array array['input_tokens','output_tokens']loop if p->k is distinct from 'null'::jsonb and(jsonb_typeof(p->k)<>'number'or p->>k!~'^(0|[1-9][0-9]{0,8})$')then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;end loop;
 if p->>'elapsed_ms'is not null and p->>'elapsed_ms'!~'^(0|[1-9][0-9]{0,7})(\.[0-9]{1,8})?$'or p->>'error_code'is not null and p->>'error_code'!~'^[A-Z0-9_]{1,120}$'then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 select * into strict a from private.polat_experiment_attempts where id=s.attempt_id;select * into strict r from private.polat_experiment_runs where id=a.run_id for update;
 if exists(select 1 from private.polat_experiment_evidence where attempt_id=a.id and stage in('PROVIDER_RESULT','RESULT_UNKNOWN','DELAYED_RESULT')and payload=p)then return jsonb_build_object('recorded',true);end if;
 select * into old from private.polat_experiment_evidence where attempt_id=a.id and stage in('PROVIDER_RESULT','RESULT_UNKNOWN')order by sequence limit 1;
 if old.id is not null then if old.payload=p then return jsonb_build_object('recorded',true);end if;if old.stage='PROVIDER_RESULT'then raise exception 'PRIVATE_BETA_RESULT_CONFLICT'using errcode='40001';end if;stage_value:='DELAYED_RESULT';else stage_value:=p->>'stage';if s.deadline<clock_timestamp()and stage_value='PROVIDER_RESULT'then stage_value:='DELAYED_RESULT';end if;end if;
 perform private.private_beta_append(r,a,stage_value,p,private.fse_hash(dispatch_nonce_value::text),s.deadline);
 if stage_value in('RESULT_UNKNOWN','DELAYED_RESULT')then update private.polat_experiment_runs set stop_reason=coalesce(stop_reason,'UNKNOWN_REMOTE_COMPLETION')where id=r.id;
 elsif p->>'status'<>'SUCCEEDED'or p->>'qa'<>'APPROVED'then update private.polat_experiment_runs set stop_reason=coalesce(stop_reason,'PROVIDER_OR_QA_HOLD')where id=r.id;
 end if;
 return jsonb_build_object('recorded',true);end;$$;

create function private.private_beta_reconcile_attempt(t uuid,p uuid,attempt_value uuid,raw_value text)returns void language plpgsql set search_path=pg_catalog as $$declare x private.private_beta_programs;r private.polat_experiment_runs;a private.polat_experiment_attempts;s private.private_beta_attempt_scope;v jsonb;old jsonb;amount numeric;begin
 if current_user<>'postgres'then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;x:=private.private_beta_evidence_guard(t,p);select * into x from private.private_beta_programs where id=p for update;
 select * into s from private.private_beta_attempt_scope where tenant_id=t and program_id=p and attempt_id=attempt_value;
 if s.attempt_id is null or s.dispatch_started_at is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 v:=private.fse_strict_json(raw_value);
 if not private.fse_keys(v,array['version','origin','account_scope_hash','request_hash','actual_billed_amount','currency','source_hash','observed_at','coverage'])or v->'version'is distinct from '1'::jsonb or v->>'origin'is distinct from 'INDEPENDENT_PROVIDER_BILLING'
 or v->>'coverage'is distinct from 'COMPLETE_REQUEST_CHARGE'or v->>'currency'is distinct from 'USD'or v->>'source_hash'is null or v->>'source_hash'!~'^[a-f0-9]{64}$'or(v->>'observed_at')::timestamptz>clock_timestamp()then raise exception 'PRIVATE_BETA_BILLING_INVALID'using errcode='22023';end if;
 amount:=private.polat_experiment_decimal(v->>'actual_billed_amount');select * into strict a from private.polat_experiment_attempts where id=attempt_value;select * into strict r from private.polat_experiment_runs where id=a.run_id for update;
 if v->>'account_scope_hash'is distinct from r.account_scope_hash or v->>'request_hash'is distinct from a.request_hash then raise exception 'PRIVATE_BETA_BILLING_INVALID'using errcode='22023';end if;
 select payload into old from private.polat_experiment_evidence where attempt_id=a.id and stage='RECONCILIATION'and payload->>'origin'='INDEPENDENT_PROVIDER_BILLING'limit 1;
 if old is not null then if old->'source'is distinct from v then raise exception 'PRIVATE_BETA_BILLING_CONFLICT'using errcode='40001';end if;return;end if;
 perform private.private_beta_append(r,a,'RECONCILIATION',jsonb_build_object('status','ACTUAL_RECONCILED','origin','INDEPENDENT_PROVIDER_BILLING','actual_billed_amount',v->>'actual_billed_amount','currency','USD','source',v,'financial_authority','NONE'));
 if amount>a.liability then update private.private_beta_programs set stage='STOPPED',generation=generation+1 where id=p;end if;
 if s.scope='CANARY'and exists(select 1 from private.polat_experiment_evidence where attempt_id=a.id and stage='PROVIDER_RESULT'and payload->>'status'='SUCCEEDED'and payload->>'qa'='APPROVED')then update private.private_beta_programs set canary_reconciliation_hash=v->>'source_hash'where id=p;end if;
end;$$;
create function public.private_beta_feedback_v1(target_tenant_id uuid,participant_id_value uuid,source_message_id_value uuid,useful_value integer,natural_value integer,correct_value integer,satisfied_value integer)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare a private.private_beta_participants;m public.messages;x private.private_beta_programs;n private.private_beta_observations;note_value text;begin
 select * into a from private.private_beta_participants where tenant_id=target_tenant_id and id=participant_id_value;if a.id is null or a.status<>'ACTIVE'then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;x:=private.private_beta_guard(target_tenant_id,a.program_id);
 if useful_value is null or natural_value is null or correct_value is null or satisfied_value is null or useful_value not between 1 and 5 or natural_value not between 1 and 5 or correct_value not between 1 and 5 or satisfied_value not between 1 and 5 then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 select * into m from public.messages where tenant_id=target_tenant_id and id=source_message_id_value and conversation_id=a.conversation_id and direction='inbound';
 if m.id is null or m.content is distinct from format('/feedback %s %s %s %s',useful_value,natural_value,correct_value,satisfied_value)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 note_value:=jsonb_build_object('review_kind','INFORMAL_UAT_FEEDBACK','useful',useful_value,'natural',natural_value,'correct',correct_value,'satisfied',satisfied_value)::text;
 select * into n from private.private_beta_observations where tenant_id=target_tenant_id and command_id=m.id;
 if n.id is not null then if n.note<>note_value then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;return jsonb_build_object('recorded',true,'observation_id',n.id,'review_kind','INFORMAL_UAT_FEEDBACK');end if;
 insert into private.private_beta_observations(tenant_id,program_id,conversation_id,command_id,kind,scenario,outcome,note)values(target_tenant_id,x.id,a.conversation_id,m.id,'TESTER_FEEDBACK','INFORMAL_UAT_FEEDBACK','NOTE',note_value)returning * into n;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','private_beta.feedback_recorded','private_beta_observations',n.id::text,jsonb_build_object('kind','INFORMAL_UAT_FEEDBACK','independent_human_review',false));
 return jsonb_build_object('recorded',true,'observation_id',n.id,'review_kind','INFORMAL_UAT_FEEDBACK');end;$$;
create function private.private_beta_billing(attempt_value uuid)returns text language sql stable set search_path=pg_catalog as $$
 select payload->>'actual_billed_amount'from private.polat_experiment_evidence where attempt_id=attempt_value and stage='RECONCILIATION'and payload->>'origin'='INDEPENDENT_PROVIDER_BILLING'and payload->>'status'='ACTUAL_RECONCILED'order by sequence desc limit 1
$$;
create function public.admin_private_beta_workspace_v1(target_tenant_id uuid,page_size_value integer default 25,cursor_value jsonb default null)returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
declare x private.private_beta_programs;role_value public.app_role;program_value jsonb;participants_value jsonb:='[]';attempts_value jsonb:='[]';notes_value jsonb:='[]';more boolean:=false;note_more boolean:=false;can_bill boolean;actual_value text;anchor_time timestamptz:=statement_timestamp();anchor_id uuid:='ffffffff-ffff-ffff-ffff-ffffffffffff';before_time timestamptz;before_id uuid;expiry timestamptz:=statement_timestamp()+interval '30 minutes';tail jsonb;next_value jsonb;begin
 if auth.uid()is null or not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support']::public.app_role[])then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 select role into strict role_value from public.tenant_members where tenant_id=target_tenant_id and user_id=auth.uid()and status='active';can_bill:=role_value in('super_admin','manager');
 if page_size_value is null or page_size_value not between 1 and 100 then raise exception 'PRIVATE_BETA_CURSOR_INVALID'using errcode='22023';end if;
 select * into x from private.private_beta_programs where tenant_id=target_tenant_id;
 if x.id is not null then
  perform private.private_beta_evidence_guard(target_tenant_id,x.id);
  if cursor_value is not null then begin
   if not private.fse_keys(cursor_value,array['v','tenant','user','role','size','program','generation','anchor','before','expires','seal'])or cursor_value->'v'is distinct from '1'::jsonb or cursor_value->>'tenant'is distinct from target_tenant_id::text or cursor_value->>'user'is distinct from auth.uid()::text or cursor_value->>'role'is distinct from role_value::text or cursor_value->'size'is distinct from to_jsonb(page_size_value)or cursor_value->>'program'is distinct from x.id::text or cursor_value->>'generation'is distinct from x.generation::text or cursor_value->>'seal'is distinct from encode(extensions.hmac(convert_to(private.fse_canonical(cursor_value-'seal'),'UTF8'),x.cursor_secret,'sha256'),'hex')or not private.fse_keys(cursor_value->'anchor',array['at','id'])or not private.fse_keys(cursor_value->'before',array['at','id'])then raise exception 'invalid';end if;
   anchor_time:=(cursor_value#>>'{anchor,at}')::timestamptz;anchor_id:=(cursor_value#>>'{anchor,id}')::uuid;before_time:=(cursor_value#>>'{before,at}')::timestamptz;before_id:=(cursor_value#>>'{before,id}')::uuid;expiry:=(cursor_value->>'expires')::timestamptz;
   if anchor_time is null or anchor_id is null or before_time is null or before_id is null or expiry is null or anchor_time>statement_timestamp()or expiry<=statement_timestamp()or expiry>statement_timestamp()+interval '30 minutes'or expiry>anchor_time+interval '30 minutes'or(before_time,before_id)>(anchor_time,anchor_id)or not exists(select 1 from private.polat_experiment_attempts a join private.private_beta_attempt_scope s on s.attempt_id=a.id where s.tenant_id=target_tenant_id and s.program_id=x.id and a.id=before_id and a.created_at=before_time)then raise exception 'invalid';end if;
  exception when others then raise exception 'PRIVATE_BETA_CURSOR_INVALID'using errcode='22023';end;end if;
  select case when count(*)>0 and count(*)=count(private.private_beta_billing(s.attempt_id))then sum(private.private_beta_billing(s.attempt_id)::numeric)::text end into actual_value from private.private_beta_attempt_scope s where s.program_id=x.id and s.dispatch_started_at is not null;
  program_value:=jsonb_build_object('id',x.id,'stage',x.stage,'generation',x.generation::text,'repository_sha',x.configuration->>'repository_sha','starts_at',(x.configuration->>'starts_at')::timestamptz,'expires_at',(x.configuration->>'expires_at')::timestamptz,'retention_days',(x.configuration->>'retention_days')::int,'notice_version',x.configuration->>'notice_version',
   'configuration_complete',x.configuration->>'repository_sha'is not null and x.configuration->>'starts_at'is not null and x.configuration->>'expires_at'is not null and x.configuration->>'retention_days'is not null and x.configuration->>'primary_operator'is not null and x.configuration->>'backup_operator'is not null,
   'account_state',case when x.account_control is null then 'MISSING'when(x.account_control->>'expires_at')::timestamptz<=clock_timestamp()then 'STALE'else 'OBSERVED'end,
   'canary_state',case when x.canary_reconciliation_hash is not null then 'RECONCILED'when exists(select 1 from private.polat_experiment_evidence where run_id=x.canary_run_id and(stage in('RESULT_UNKNOWN','DELAYED_RESULT')or(stage='PROVIDER_RESULT'and(payload->>'status'<>'SUCCEEDED'or payload->>'qa'<>'APPROVED'))))then 'REVIEW'when exists(select 1 from private.polat_experiment_attempts where run_id=x.canary_run_id)then 'PENDING'else 'NOT_STARTED'end,
   'global_requests',x.request_count,'maximum_requests',350,'reserved_liability',case when can_bill then trim_scale(private.private_beta_exposure(x.id))::text end,'currency',case when can_bill then 'USD'end,'actual_billed_amount',case when can_bill then actual_value end,'billing_status',case when not can_bill then 'ROLE_RESTRICTED'when actual_value is null then 'UNKNOWN'else 'INDEPENDENTLY_RECONCILED'end,
   'founder_limit',20,'friend_limit',30,'friend_limit_count',10,'primary_operator_configured',x.configuration->>'primary_operator'is not null,'backup_operator_configured',x.configuration->>'backup_operator'is not null);
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'status',a.status,'conversation_id',a.conversation_id,'joined_at',a.joined_at,'revoked_at',a.revoked_at,'model_requests',a.request_count,'maximum_requests',case a.kind when 'FOUNDER'then 20 else 30 end)order by a.joined_at,a.id),'[]')into participants_value from(select * from private.private_beta_participants where tenant_id=target_tenant_id and program_id=x.id order by joined_at,id limit 12)a;
  with source as materialized(select a.id,a.created_at,s.scope from private.polat_experiment_attempts a join private.private_beta_attempt_scope s on s.attempt_id=a.id where s.tenant_id=target_tenant_id and s.program_id=x.id and(a.created_at,a.id)<=(anchor_time,anchor_id)and(before_time is null or(a.created_at,a.id)<(before_time,before_id))order by a.created_at desc,a.id desc limit page_size_value+1)
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'scope',a.scope,'created_at',a.created_at,'status',coalesce((select case when e.stage='DELAYED_RESULT'then 'UNKNOWN'when e.stage='DISPATCH_STARTED'then 'DISPATCH_STARTED'else e.payload->>'status'end from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage in('DISPATCH_STARTED','PROVIDER_RESULT','RESULT_UNKNOWN','DELAYED_RESULT')order by e.sequence desc limit 1),'RESERVED'),
   'qa',coalesce((select e.payload->>'qa'from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage in('PROVIDER_RESULT','RESULT_UNKNOWN','DELAYED_RESULT')order by sequence desc limit 1),'NOT_EVALUATED'),
   'input_tokens',(select(e.payload->>'input_tokens')::int from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage in('PROVIDER_RESULT','DELAYED_RESULT')order by sequence desc limit 1),'output_tokens',(select(e.payload->>'output_tokens')::int from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage in('PROVIDER_RESULT','DELAYED_RESULT')order by sequence desc limit 1),
   'actual_billed_amount',case when can_bill then private.private_beta_billing(a.id)end,'billing_status',case when not can_bill then 'ROLE_RESTRICTED'when private.private_beta_billing(a.id)is null then 'UNKNOWN'else 'INDEPENDENTLY_RECONCILED'end)order by a.created_at desc,a.id desc),'[]'),(select count(*)>page_size_value from source)into attempts_value,more from(select * from source order by created_at desc,id desc limit page_size_value)a;
  if more then tail:=attempts_value->(jsonb_array_length(attempts_value)-1);next_value:=jsonb_build_object('v',1,'tenant',target_tenant_id,'user',auth.uid(),'role',role_value,'size',page_size_value,'program',x.id,'generation',x.generation::text,'anchor',jsonb_build_object('at',anchor_time,'id',anchor_id),'before',jsonb_build_object('at',tail->>'created_at','id',tail->>'id'),'expires',expiry);next_value:=next_value||jsonb_build_object('seal',encode(extensions.hmac(convert_to(private.fse_canonical(next_value),'UTF8'),x.cursor_secret,'sha256'),'hex'));end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'conversation_id',n.conversation_id,'scenario',n.scenario,'outcome',n.outcome,'note',n.note,'created_at',n.created_at,'author',case when n.kind in('TESTER_FEEDBACK','PARTICIPATION','DELETION_REQUEST')then 'TESTER'when n.actor_id is null then 'SYSTEM'else 'OPERATOR'end)order by n.created_at desc,n.id desc),'[]'),(select count(*)>page_size_value from(select 1 from private.private_beta_observations where tenant_id=target_tenant_id and program_id=x.id limit page_size_value+1)q)into notes_value,note_more from(select id,conversation_id,scenario,outcome,note,created_at,kind,actor_id from private.private_beta_observations where tenant_id=target_tenant_id and program_id=x.id order by created_at desc,id desc limit page_size_value)n;
 elsif cursor_value is not null then raise exception 'PRIVATE_BETA_CURSOR_INVALID'using errcode='22023';end if;
 return jsonb_build_object('version',1,'mode','PRIVATE_BETA_UAT','program',program_value,'participants',participants_value,'attempts',attempts_value,'notes',notes_value,'page_size',page_size_value,'has_more',more,'next_cursor',next_value,'notes_has_more',note_more,'financial_authority','NONE','commercial_sales',false);end;$$;

create function private.private_beta_program_immutable()returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_op='DELETE'or(new.id,new.tenant_id,new.owner_user_id,new.authorization_record_hash,new.canary_run_id,new.conversation_run_id,new.created_at,new.cursor_secret)is distinct from(old.id,old.tenant_id,old.owner_user_id,old.authorization_record_hash,old.canary_run_id,old.conversation_run_id,old.created_at,old.cursor_secret)
 or new.request_count<old.request_count or new.reserved_liability<old.reserved_liability or new.generation<old.generation or(old.stage='STOPPED'and new.stage<>'STOPPED')
 or(old.stage<>'DRAFT'and(new.configuration,new.manifest_hash)is distinct from(old.configuration,old.manifest_hash))then raise exception 'PRIVATE_BETA_IMMUTABLE'using errcode='42501';end if;return new;end;$$;
create trigger private_beta_program_append_bound before update or delete on private.private_beta_programs for each row execute function private.private_beta_program_immutable();
create function private.private_beta_participant_immutable()returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_op='DELETE'or(new.id,new.tenant_id,new.program_id,new.invite_id,new.kind,new.provider_user_id,new.provider_chat_id,new.notice_version,new.notice_hash,new.joined_at)is distinct from(old.id,old.tenant_id,old.program_id,old.invite_id,old.kind,old.provider_user_id,old.provider_chat_id,old.notice_version,old.notice_hash,old.joined_at)
 or new.request_count<old.request_count or new.revision<old.revision or(old.status='REVOKED'and new.status<>'REVOKED')or(old.conversation_id is not null and new.conversation_id is distinct from old.conversation_id)then raise exception 'PRIVATE_BETA_IMMUTABLE'using errcode='42501';end if;return new;end;$$;
create trigger private_beta_participant_bound before update or delete on private.private_beta_participants for each row execute function private.private_beta_participant_immutable();
create function private.private_beta_attempt_scope_immutable()returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_op='DELETE'or(to_jsonb(new)-array['dispatch_nonce','dispatch_started_at','deadline'])is distinct from(to_jsonb(old)-array['dispatch_nonce','dispatch_started_at','deadline'])or(old.dispatch_started_at is not null and(new.dispatch_nonce,new.dispatch_started_at,new.deadline)is distinct from(old.dispatch_nonce,old.dispatch_started_at,old.deadline))then raise exception 'PRIVATE_BETA_IMMUTABLE'using errcode='42501';end if;return new;end;$$;
create trigger private_beta_attempt_scope_bound before update or delete on private.private_beta_attempt_scope for each row execute function private.private_beta_attempt_scope_immutable();

-- Minimal function grants; no private table grants, no account/billing writer available to the application.
do $$declare f record;begin
 for f in select oid::regprocedure sig from pg_proc where pronamespace='private'::regnamespace and proname like 'private_beta_%'loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);end loop;
 for f in select oid::regprocedure sig,proname from pg_proc where pronamespace='public'::regnamespace and(proname like 'private_beta_%'or proname like 'admin_private_beta_%')loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
  if f.proname like 'admin_private_beta_%'then execute format('grant execute on function %s to authenticated',f.sig);else execute format('grant execute on function %s to service_role',f.sig);end if;
 end loop;
end;$$;

-- Historical offline Admin tab must never relabel genuine UAT observations as fixture evidence.
create or replace function public.admin_polat_experiment_page_v1(target_tenant_id uuid,page_size_value integer default 25,cursor_value jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' set plan_cache_mode=force_custom_plan as $$
declare role_value public.app_role;anchor_time timestamptz:=statement_timestamp();anchor_id uuid:='ffffffff-ffff-ffff-ffff-ffffffffffff';before_time timestamptz;before_id uuid;expiry timestamptz:=statement_timestamp()+interval '30 minutes';items jsonb;more boolean;tail jsonb;can_bill boolean;begin
 if auth.uid()is null or not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[])then raise exception 'POLAT_EXPERIMENT_UNAVAILABLE'using errcode='42501';end if;
 select role into role_value from public.tenant_members where tenant_id=target_tenant_id and user_id=auth.uid()and status='active';
 if page_size_value is null or page_size_value not between 1 and 100 then raise exception 'POLAT_EXPERIMENT_CURSOR_INVALID'using errcode='22023';end if;
 can_bill:=role_value in('super_admin','manager','analyst');
 if cursor_value is not null then
  begin
   if not private.fse_keys(cursor_value,array['v','tenant','user','role','size','anchor_time','anchor_id','before_time','before_id','expires'])
   or cursor_value->'v'is distinct from '1'::jsonb or cursor_value->>'tenant'is distinct from target_tenant_id::text or cursor_value->>'user'is distinct from auth.uid()::text
   or cursor_value->>'role'is distinct from role_value::text or cursor_value->'size'is distinct from to_jsonb(page_size_value)
   then raise exception 'invalid';end if;
   anchor_time:=(cursor_value->>'anchor_time')::timestamptz;anchor_id:=(cursor_value->>'anchor_id')::uuid;before_time:=(cursor_value->>'before_time')::timestamptz;before_id:=(cursor_value->>'before_id')::uuid;expiry:=(cursor_value->>'expires')::timestamptz;
   if anchor_time is null or anchor_id is null or before_time is null or before_id is null or expiry is null or expiry<=statement_timestamp()or expiry>statement_timestamp()+interval '30 minutes'
   or anchor_time>statement_timestamp()or(before_time,before_id)>(anchor_time,anchor_id)
   or not exists(select 1 from private.polat_experiment_runs where tenant_id=target_tenant_id and binding->>'mode'='OFFLINE_SYNTHETIC'and id=before_id and created_at=before_time)then raise exception 'invalid';end if;
  exception when others then raise exception 'POLAT_EXPERIMENT_CURSOR_INVALID'using errcode='22023';end;
 end if;
 with source as materialized(
  select id,created_at,request_count,event_sequence,stop_reason,binding,reserved_liability from private.polat_experiment_runs
  where tenant_id=target_tenant_id and binding->>'mode'='OFFLINE_SYNTHETIC'and(created_at,id)<=(anchor_time,anchor_id)and(before_time is null or(created_at,id)<(before_time,before_id))
  order by created_at desc,id desc limit page_size_value+1
 ),bounded as materialized(select * from source order by created_at desc,id desc limit page_size_value)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'mode','OFFLINE_SYNTHETIC','provider','anthropic','model',binding->>'model',
 'repository_sha',binding->>'repository_sha','corpus_version',binding->>'corpus_version','request_count',request_count,'maximum_requests',(binding->>'maximum_requests')::int,
 'evidence_count',event_sequence,'stop_reason',stop_reason,'reserved_liability',case when can_bill then reserved_liability::text end,'currency',case when can_bill then binding->>'currency'end,
 'actual_billed_amount',null,'financial_authority','NONE','execution_enabled',false)order by created_at desc,id desc),'[]'::jsonb),
 (select count(*)>page_size_value from source)into items,more from bounded;
 tail:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('version',1,'observed_at',statement_timestamp(),'items',items,'has_more',more,'page_size',page_size_value,'billing_readable',can_bill,
 'next_cursor',case when more then jsonb_build_object('v',1,'tenant',target_tenant_id,'user',auth.uid(),'role',role_value,'size',page_size_value,'anchor_time',anchor_time,'anchor_id',anchor_id,'before_time',tail->'created_at','before_id',tail->'id','expires',expiry)end,
 'financial_authority','NONE','authorized_external_requests',0,'execution_enabled',false);
end;$$;
