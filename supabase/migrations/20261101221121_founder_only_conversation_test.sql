-- Owner-authorized personal conversation UAT. This is application-local budgeting,
-- not independent provider billing/cap acceptance or commercial authority.
alter table private.private_beta_programs add column founder_model_observation jsonb;

create function private.private_beta_founder_only(x private.private_beta_programs) returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(x.account_control->'version'='3'::jsonb and x.account_control->>'origin'='SERVER_DERIVED_OWNER_ONLY_UAT_CONTROL' and x.account_control->>'scope'='OWNER_ONLY',false)
$$;
create function private.private_beta_founder_canary_hash(x private.private_beta_programs) returns text language sql stable set search_path=pg_catalog as $$
 select e.evidence_hash from private.polat_experiment_evidence e join private.polat_experiment_attempts a on a.id=e.attempt_id
 join private.private_beta_attempt_scope s on s.attempt_id=a.id join private.polat_experiment_runs r on r.id=a.run_id
 where s.program_id=x.id and s.tenant_id=x.tenant_id and s.scope='CANARY' and r.id=x.canary_run_id
 and private.private_beta_founder_only(x) and r.binding->'version'='3'::jsonb
 and e.stage='PROVIDER_RESULT' and e.payload->>'status'='SUCCEEDED' and e.payload->>'qa'='APPROVED'
 and (e.payload->>'input_tokens')~'^[0-9]{1,7}$' and (e.payload->>'input_tokens')::numeric between 1 and 1050000
 and (e.payload->>'output_tokens')~'^[0-9]{1,3}$' and (e.payload->>'output_tokens')::numeric between 1 and 512
 and e.payload->>'provider_usage_hash'~'^[a-f0-9]{64}$' and e.payload->>'response_hash'~'^[a-f0-9]{64}$' and e.payload->>'response_identity_hash'~'^[a-f0-9]{64}$' and r.stop_reason is null
 and not exists(select 1 from private.polat_experiment_evidence z join private.private_beta_attempt_scope zs on zs.attempt_id=z.attempt_id where zs.program_id=x.id and z.stage in('RESULT_UNKNOWN','DELAYED_RESULT'))
 order by e.sequence desc limit 1
$$;

alter function private.private_beta_exposure(uuid) rename to private_beta_external_exposure_v2;
create function private.private_beta_exposure(program_value uuid) returns numeric language plpgsql stable set search_path=pg_catalog as $$
declare x private.private_beta_programs; total numeric; begin
 select * into x from private.private_beta_programs where id=program_value;
 if not private.private_beta_founder_only(x) then return private.private_beta_external_exposure_v2(program_value); end if;
 -- Original full-context reservations stay immutable. Only this OWNER_ONLY mode
 -- may budget from observed successful usage at conservative public maximum rates.
 -- This is NOT a billing reconciliation; unknown/failure/missing usage holds all liability.
 select coalesce(sum(coalesce(
  (select (e.payload->>'actual_billed_amount')::numeric from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage='RECONCILIATION' and e.payload->>'origin'='INDEPENDENT_PROVIDER_BILLING' and e.payload->>'status'='ACTUAL_RECONCILED' and e.payload#>>'{source,coverage}'='COMPLETE_REQUEST_CHARGE' order by e.sequence desc limit 1),
  (select ceil(((e.payload->>'input_tokens')::numeric*(x.pricing_control->>'maximum_input_usd_per_million')::numeric+(e.payload->>'output_tokens')::numeric*(x.pricing_control->>'maximum_output_usd_per_million')::numeric)*1000000000000)/1000000000000000000
    from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage='PROVIDER_RESULT' and e.payload->>'status'='SUCCEEDED' and e.payload->>'qa'='APPROVED'
    and (e.payload->>'input_tokens')~'^[0-9]{1,7}$' and (e.payload->>'input_tokens')::numeric between 1 and 1050000
    and (e.payload->>'output_tokens')~'^[0-9]{1,3}$' and (e.payload->>'output_tokens')::numeric between 1 and 512
    and e.payload->>'provider_usage_hash'~'^[a-f0-9]{64}$' and e.payload->>'response_hash'~'^[a-f0-9]{64}$' and e.payload->>'response_identity_hash'~'^[a-f0-9]{64}$'
    and not exists(select 1 from private.polat_experiment_evidence z where z.attempt_id=a.id and z.stage in('RESULT_UNKNOWN','DELAYED_RESULT')) order by e.sequence desc limit 1),a.liability)),0)
 into total from private.private_beta_attempt_scope s join private.polat_experiment_attempts a on a.id=s.attempt_id where s.program_id=program_value;
 return total;
end;$$;

-- Executable protected collector is the sole writer. No authenticated/service-role
-- caller or supplied owner JSON can create account/model observation authority.
create function private.private_beta_founder_model_record(t uuid,p uuid,raw_value text) returns void language plpgsql set search_path=pg_catalog as $$
declare x private.private_beta_programs; v jsonb; o jsonb; pricing jsonb; k text; begin
 if current_user<>'postgres' then raise exception 'PRIVATE_BETA_UNAVAILABLE' using errcode='42501'; end if;
 x:=private.private_beta_evidence_guard(t,p); select * into x from private.private_beta_programs where id=p for update;
 v:=private.fse_strict_json(raw_value);o:=v->'observation';pricing:=v->'pricing';
 if not private.fse_keys(v,array['observation','pricing']) or not private.fse_keys(o,array['version','origin','program_id','tenant_id','repository_sha','organization_id','project_id','credential_sha256','account_scope_hash','credential_custody_hash','provider','model','model_access','model_response_hash','policy_hash','observed_at','expires_at'])
 or o->'version' is distinct from '1'::jsonb or o->>'origin' is distinct from 'PROTECTED_OPENAI_MODEL_AND_PRICING_OBSERVATION'
 or o->>'program_id' is distinct from p::text or o->>'tenant_id' is distinct from t::text
 or o->>'repository_sha' is null or o->>'repository_sha'!~'^[a-f0-9]{40}$'
 or o->>'provider' is distinct from 'openai' or o->>'model' is distinct from 'gpt-6.1-sol' or o->'model_access' is distinct from 'true'::jsonb
 or o->>'organization_id' is null or o->>'organization_id'!~'^org[-_][A-Za-z0-9_-]{1,120}$'
 or o->>'project_id' is null or o->>'project_id'!~'^proj_[A-Za-z0-9_-]{1,120}$'
 or o->>'account_scope_hash' is distinct from private.fse_hash(private.fse_canonical(jsonb_build_array('OPENAI_PROJECT1',o->>'organization_id',o->>'project_id')))
 or o->>'credential_custody_hash' is distinct from private.fse_hash(private.fse_canonical(jsonb_build_array('POLAT_UAT_CREDENTIAL_CUSTODY1',o->>'account_scope_hash',o->>'credential_sha256')))
 or not private.private_beta_openai(x) or x.stage<>'DRAFT' or x.request_count<>0
 or o->>'observed_at' is null or o->>'expires_at' is null or (o->>'observed_at')::timestamptz>clock_timestamp() or (o->>'observed_at')::timestamptz<clock_timestamp()-interval '5 minutes'
 or (o->>'expires_at')::timestamptz<=clock_timestamp() or (o->>'expires_at')::timestamptz>(o->>'observed_at')::timestamptz+interval '24 hours'
 then raise exception 'PRIVATE_BETA_MODEL_OBSERVATION_INVALID' using errcode='22023';end if;
 foreach k in array array['credential_sha256','model_response_hash','policy_hash'] loop
  if o->>k is null or o->>k!~'^[a-f0-9]{64}$' then raise exception 'PRIVATE_BETA_MODEL_OBSERVATION_INVALID' using errcode='22023';end if;
 end loop;
 if not private.fse_keys(pricing,array['version','origin','model','currency','source_url','source_hash','maximum_input_tokens','maximum_input_usd_per_million','maximum_output_usd_per_million','observed_at','expires_at','all_billable_components_covered'])
 or pricing->'version' is distinct from '2'::jsonb or pricing->>'origin' is distinct from 'INDEPENDENT_OFFICIAL_PRICING_READ'
 or pricing->>'model' is distinct from 'gpt-6.1-sol' or pricing->>'currency' is distinct from 'USD'
 or pricing->>'source_url' is distinct from 'https://developers.openai.com/api/docs/models/gpt-6.1-sol'
 or pricing->>'source_hash' is null or pricing->>'source_hash'!~'^[a-f0-9]{64}$' or pricing->'maximum_input_tokens' is distinct from '1050000'::jsonb
 or pricing->'maximum_input_usd_per_million' is distinct from '"4.4"'::jsonb or pricing->'maximum_output_usd_per_million' is distinct from '"16.5"'::jsonb
 or pricing->'all_billable_components_covered' is distinct from 'true'::jsonb or pricing->>'observed_at' is distinct from o->>'observed_at' or pricing->>'expires_at' is distinct from o->>'expires_at'
 then raise exception 'PRIVATE_BETA_PRICING_INVALID' using errcode='22023';end if;
 update private.private_beta_programs set founder_model_observation=v where id=p;
 insert into private.private_beta_observations(tenant_id,program_id,command_id,kind,scenario,outcome,note)values(t,p,extensions.gen_random_uuid(),'ACCOUNT_CONTROL','OWNER_TEST_MODEL_OBSERVATION','NOTE','Real protected model/key/pricing metadata observed. No owner grant, inference, provider-cap or billing acceptance.');
end;$$;

create function public.admin_private_beta_prepare_founder_test_v1(target_tenant_id uuid,program_id_value uuid,expected_generation_value bigint,repository_sha_value text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x private.private_beta_programs;o jsonb;v jsonb;ts timestamptz:=clock_timestamp();deadline timestamptz;begin
 perform private.private_beta_admin(target_tenant_id,true);perform private.private_beta_mfa_at();
 x:=private.private_beta_guard(target_tenant_id,program_id_value);select * into x from private.private_beta_programs where id=x.id for update;
 if x.owner_user_id<>auth.uid() or x.generation is distinct from expected_generation_value or x.stage<>'DRAFT' or x.request_count<>0 or not private.private_beta_openai(x)
 or exists(select 1 from private.private_beta_participants where program_id=x.id) or exists(select 1 from private.private_beta_invites where program_id=x.id and kind='FRIEND')
 then raise exception 'PRIVATE_BETA_OWNER_TEST_UNAVAILABLE' using errcode='42501';end if;
 o:=x.founder_model_observation->'observation';
 if o is null or o->>'repository_sha' is distinct from repository_sha_value or repository_sha_value is null or repository_sha_value!~'^[a-f0-9]{40}$' or (o->>'expires_at')::timestamptz<=ts+interval '1 minute'
 then raise exception 'PRIVATE_BETA_MODEL_OBSERVATION_REQUIRED' using errcode='55000';end if;
 deadline:=least(ts+interval '24 hours',(o->>'expires_at')::timestamptz);
 v:=private.private_beta_configuration((x.configuration||jsonb_build_object('repository_sha',repository_sha_value,'starts_at',to_char(ts at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'expires_at',to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'retention_days',coalesce((x.configuration->>'retention_days')::int,30),'primary_operator',auth.uid()))::text);
 update private.private_beta_programs set configuration=v,manifest_hash=private.fse_hash(private.fse_canonical(v)),pricing_control=founder_model_observation->'pricing',generation=generation+1 where id=x.id returning * into x;
 v:=jsonb_build_object('version',3,'origin','SERVER_DERIVED_OWNER_ONLY_UAT_CONTROL','scope','OWNER_ONLY','effective_limit_kind','LOCAL_DURABLE_RESERVATION_CAP','currency','USD','local_maximum_spend','5.00','local_reserved_liability','0','local_remaining_allowance','5.00','provider_billing','UNKNOWN','provider_enforced_cap','UNVERIFIED','canary_result_hash',null,'request_bound',null,'unknown_outcome_count',0,
 'program_id',x.id,'tenant_id',x.tenant_id,'account_scope_hash',o->>'account_scope_hash','repository_sha',repository_sha_value,'manifest_hash',x.manifest_hash,'authorization_record_hash',x.authorization_record_hash,'provider','openai','model','gpt-6.1-sol','model_access',true,'policy_hash',o->>'policy_hash','credential_custody_hash',o->>'credential_custody_hash','organization_id',o->>'organization_id','project_id',o->>'project_id','credential_sha256',o->>'credential_sha256','observed_at',o->>'observed_at','expires_at',to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 update private.private_beta_programs set account_control=v where id=x.id;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.owner_only_test_prepared','private_beta_programs',x.id::text,jsonb_build_object('repository_sha',repository_sha_value,'scope','OWNER_ONLY','local_budget','5.00','provider_billing','UNKNOWN','provider_enforced_cap','UNVERIFIED','financial_authority','NONE','commercial_sales',false));
 return jsonb_build_object('program_id',x.id,'stage','DRAFT','generation',x.generation::text);
end;$$;

alter function private.private_beta_binding(private.private_beta_programs,boolean) rename to private_beta_binding_external_v2;
create function private.private_beta_binding(x private.private_beta_programs,canary boolean) returns jsonb language plpgsql stable set search_path=pg_catalog as $$declare v jsonb;begin
 v:=private.private_beta_binding_external_v2(x,canary);
 if private.private_beta_founder_only(x) then v:=v||jsonb_build_object('version',3,'scope','OWNER_ONLY','effective_limit_kind','LOCAL_DURABLE_RESERVATION_CAP');end if;
 return v;
end;$$;

create or replace function public.private_beta_account_control_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;v jsonb;exposure numeric;unknown_count integer;begin
 x:=private.private_beta_guard(target_tenant_id,program_id_value);if x.account_control is null or(x.account_control->>'expires_at')::timestamptz<=clock_timestamp()then raise exception 'PRIVATE_BETA_ACCOUNT_MISSING'using errcode='55000';end if;
 v:=x.account_control;
 if private.private_beta_founder_only(x) then
  exposure:=private.private_beta_exposure(x.id);if exposure>5 then raise exception 'PRIVATE_BETA_LIMIT'using errcode='54000';end if;
  select count(*) into unknown_count from private.polat_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id=x.id and e.stage in('RESULT_UNKNOWN','DELAYED_RESULT');
  v:=v||jsonb_build_object('local_reserved_liability',trim_scale(exposure)::text,'local_remaining_allowance',trim_scale(5-exposure)::text,'unknown_outcome_count',unknown_count,'canary_result_hash',private.private_beta_founder_canary_hash(x));
 end if;
 return jsonb_build_object('payload',v,'pricing',x.pricing_control);end;$$;

-- Owner-only technical canary acceptance never writes the billing reconciliation field.
create or replace function public.admin_private_beta_transition_v1(target_tenant_id uuid,program_id_value uuid,stage_value text,expected_generation_value bigint)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;b jsonb;r uuid;ts timestamptz:=clock_timestamp();authenticated_value timestamptz;begin
 perform private.private_beta_admin(target_tenant_id,true);x:=case when stage_value='STOPPED'then private.private_beta_evidence_guard(target_tenant_id,program_id_value)else private.private_beta_guard(target_tenant_id,program_id_value)end;select * into x from private.private_beta_programs where id=x.id for update;
 if x.owner_user_id<>auth.uid()or x.generation is distinct from expected_generation_value then raise exception 'PRIVATE_BETA_REVISION_CHANGED'using errcode='40001';end if;
 if private.private_beta_founder_only(x) and stage_value='FRIENDS' then raise exception 'PRIVATE_BETA_OWNER_ONLY' using errcode='42501';end if;
 if stage_value is null or stage_value not in('CANARY','FOUNDER','FRIENDS','STOPPED')or x.stage='STOPPED'then raise exception 'PRIVATE_BETA_TRANSITION_INVALID'using errcode='22023';end if;
 if stage_value<>'STOPPED'then
  authenticated_value:=private.private_beta_mfa_at();
  if not((x.stage='DRAFT'and stage_value='CANARY')or(x.stage='CANARY'and stage_value='FOUNDER')or(x.stage='FOUNDER'and stage_value='FRIENDS'))then raise exception 'PRIVATE_BETA_TRANSITION_INVALID'using errcode='22023';end if;
  if x.configuration->>'starts_at'is null or x.configuration->>'expires_at'is null or x.configuration->>'retention_days'is null or(x.configuration->>'starts_at')::timestamptz>ts or(x.configuration->>'expires_at')::timestamptz<=ts
  or x.account_control is null or(x.account_control->>'expires_at')::timestamptz<=ts or x.account_control->>'manifest_hash'is distinct from x.manifest_hash or x.account_control->>'authorization_record_hash'is distinct from x.authorization_record_hash then raise exception 'PRIVATE_BETA_PREREQUISITES_MISSING'using errcode='55000';end if;
  if stage_value in('FOUNDER','FRIENDS')and(x.bot_control is null or x.bot_control->>'api_environment'is distinct from 'production'or x.bot_control->>'credential_sha256'is null or (x.canary_reconciliation_hash is null and private.private_beta_founder_canary_hash(x) is null) or x.configuration->>'primary_operator'is null or (not private.private_beta_founder_only(x) and x.configuration->>'backup_operator'is null)
  or not exists(select 1 from public.tenant_members where tenant_id=target_tenant_id and user_id=(x.configuration->>'primary_operator')::uuid and role in('super_admin','manager')and status='active')
  or (not private.private_beta_founder_only(x) and not exists(select 1 from public.tenant_members where tenant_id=target_tenant_id and user_id=(x.configuration->>'backup_operator')::uuid and role in('super_admin','manager')and status='active')))then raise exception 'PRIVATE_BETA_PREREQUISITES_MISSING'using errcode='55000';end if;
  if private.private_beta_founder_only(x) and stage_value='FOUNDER' and not exists(select 1 from private.private_beta_business_controls bc where bc.tenant_id=x.tenant_id and bc.program_id=x.id and private.private_beta_business_permitted(x,bc)) then raise exception 'PRIVATE_BETA_BUSINESS_UNVERIFIED'using errcode='55000';end if;
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


create or replace function public.private_beta_reserve_v1(target_tenant_id uuid,program_id_value uuid,native_run_id_value uuid,request_hash_value text,body_hash_value text,source_message_id_value uuid,liability_value text,conversation_id_value uuid default null)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
  if (x.canary_reconciliation_hash is null and private.private_beta_founder_canary_hash(x) is null) or source_message_id_value is null then raise exception 'PRIVATE_BETA_CANARY_UNVERIFIED'using errcode='55000';end if;
  select * into native from public.agent_runs where tenant_id=target_tenant_id and id=native_run_id_value;select * into task from public.agent_tasks where tenant_id=target_tenant_id and id=native.task_id;
  select * into msg from public.messages where tenant_id=target_tenant_id and id=source_message_id_value and direction='inbound'and conversation_id=task.conversation_id;
  select * into part from private.private_beta_participants where tenant_id=target_tenant_id and program_id=x.id and conversation_id=msg.conversation_id;
  select * into cv from public.conversations where tenant_id=target_tenant_id and id=part.conversation_id for update;
  if part.id is not null then select * into part from private.private_beta_participants where id=part.id for update;end if;
  if native.id is null or task.source_event_id is null or msg.id is null or part.id is null or part.status<>'ACTIVE'or part.consented_at is null or cv.runtime_mode<>'AI_ACTIVE'or cv.human_takeover or(conversation_id_value is not null and conversation_id_value<>cv.id)
  or task.task_type<>'private_beta.reply'or native.context_manifest->>'polat_profile'is distinct from 'polat-private-beta-v1'or native.context_manifest->>'private_beta_program_id'is distinct from x.id::text or native.context_manifest->>'private_beta_participant_id'is distinct from part.id::text or native.context_manifest->>'private_beta_revision'is distinct from part.revision::text
  or not exists(select 1 from public.agent_versions where tenant_id=target_tenant_id and id=native.agent_version_id and model_provider=coalesce(x.configuration->>'model_provider','anthropic')and model_name=coalesce(x.configuration->>'model_name','claude-haiku-5-5'))
  or not exists(select 1 from public.domain_events where tenant_id=target_tenant_id and id=task.source_event_id and payload->>'message_id'=msg.id::text)
  or not((part.kind='FOUNDER'and x.stage in('FOUNDER','FRIENDS'))or(part.kind='FRIEND'and x.stage='FRIENDS'))
  or (private.private_beta_founder_only(x) and part.kind<>'FOUNDER')
  or part.request_count>=(case part.kind when 'FOUNDER'then 20 else 30 end)
  or part.last_inbound_id is distinct from msg.id then raise exception 'PRIVATE_BETA_SOURCE_HELD'using errcode='55000';end if;
  run_value:=x.conversation_run_id;scope_value:=part.kind;
 end if;
 select * into r from private.polat_experiment_runs where tenant_id=target_tenant_id and id=run_value for update;if r.id is null or r.stop_reason is not null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 liability:=private.polat_experiment_decimal(liability_value);if liability::numeric<>(r.binding->>'maximum_attempt_liability')::numeric then raise exception 'PRIVATE_BETA_REVISION_CHANGED'using errcode='40001';end if;
 if x.request_count>=350 or private.private_beta_exposure(x.id)+liability>5 or liability>(case when private.private_beta_founder_only(x) then 5-private.private_beta_exposure(x.id) else private.polat_experiment_decimal(x.account_control->>'remaining_allowance') end)or r.request_count>=(r.binding->>'maximum_requests')::int then raise exception 'PRIVATE_BETA_LIMIT'using errcode='54000';end if;
 insert into private.polat_experiment_attempts(id,tenant_id,run_id,ordinal,target_hash,request_hash,body_hash,liability)values(extensions.gen_random_uuid(),target_tenant_id,r.id,r.request_count+1,private.fse_hash(private.fse_canonical(jsonb_build_array('POLAT_UAT_ATTEMPT1',native_run_id_value,source_message_id_value))),request_hash_value,body_hash_value,liability)returning * into a;
 update private.polat_experiment_runs set request_count=request_count+1,reserved_liability=reserved_liability+liability where id=r.id returning * into r;
 update private.private_beta_programs set request_count=request_count+1,reserved_liability=reserved_liability+liability where id=x.id returning * into x;
 if part.id is not null then update private.private_beta_participants set request_count=request_count+1 where id=part.id returning * into part;end if;
 insert into private.private_beta_attempt_scope(tenant_id,program_id,attempt_id,native_run_id,conversation_id,participant_id,source_message_id,scope,participant_revision,source_boundary,generation,global_ordinal,participant_ordinal)
 values(target_tenant_id,x.id,a.id,native_run_id_value,coalesce(cv.id,conversation_id_value),part.id,source_message_id_value,scope_value,part.revision,msg.created_at,coalesce(part.revision,x.generation),x.request_count,coalesce(part.request_count,0))returning * into s;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','private_beta.attempt_reserved','polat_experiment_attempts',a.id::text,jsonb_build_object('program_id',x.id,'ordinal',x.request_count,'request_hash',a.request_hash,'financial_authority','NONE'));
 return private.private_beta_reservation(x,r,a,s,false);end;$$;


create or replace function public.admin_private_beta_invite_v1(target_tenant_id uuid,program_id_value uuid,kind_value text,command_id_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;i private.private_beta_invites;code text;deadline timestamptz;begin
 perform private.private_beta_admin(target_tenant_id,true);x:=private.private_beta_guard(target_tenant_id,program_id_value);select * into x from private.private_beta_programs where id=x.id for update;
 if private.private_beta_founder_only(x) and kind_value is distinct from 'FOUNDER' then raise exception 'PRIVATE_BETA_OWNER_ONLY'using errcode='42501';end if;
 if x.stage='STOPPED'or x.owner_user_id<>auth.uid()or kind_value not in('FOUNDER','FRIEND')or kind_value is null or command_id_value is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 select * into i from private.private_beta_invites where tenant_id=target_tenant_id and command_id=command_id_value;
 if i.id is not null then if i.program_id<>x.id or i.kind<>kind_value then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;return jsonb_build_object('invite_id',i.id,'code',null,'expires_at',i.expires_at,'kind',i.kind,'replay',true);end if;
 if(select count(*)from private.private_beta_invites where program_id=x.id and kind=kind_value)>=(case kind_value when 'FOUNDER'then 1 else 10 end)then raise exception 'PRIVATE_BETA_LIMIT'using errcode='54000';end if;
 code:=encode(extensions.gen_random_bytes(24),'hex');deadline:=least(coalesce((x.configuration->>'expires_at')::timestamptz,clock_timestamp()+interval '24 hours'),clock_timestamp()+interval '24 hours');
 if deadline<=clock_timestamp()then raise exception 'PRIVATE_BETA_WINDOW'using errcode='55000';end if;
 insert into private.private_beta_invites(tenant_id,program_id,command_id,kind,code_hash,expires_at)values(target_tenant_id,x.id,command_id_value,kind_value,private.fse_hash(code),deadline)returning * into i;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.invite_created','private_beta_invites',i.id::text,jsonb_build_object('kind',i.kind,'expires_at',i.expires_at));
 return jsonb_build_object('invite_id',i.id,'code',code,'expires_at',i.expires_at,'kind',i.kind,'replay',false);end;$$;


create or replace function public.admin_private_beta_workspace_v1(target_tenant_id uuid,page_size_value integer default 25,cursor_value jsonb default null)returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
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
   'configuration_complete',x.configuration->>'repository_sha'is not null and x.configuration->>'starts_at'is not null and x.configuration->>'expires_at'is not null and x.configuration->>'retention_days'is not null and x.configuration->>'primary_operator'is not null and (private.private_beta_founder_only(x) or x.configuration->>'backup_operator'is not null),
   'account_state',case when x.account_control is null and private.private_beta_openai(x) and (x.founder_model_observation#>>'{observation,expires_at}')::timestamptz>clock_timestamp() then 'OWNER_TEST_AVAILABLE'when x.account_control is null then 'MISSING'when(x.account_control->>'expires_at')::timestamptz<=clock_timestamp()then 'STALE'else 'OBSERVED'end,
   'canary_state',case when private.private_beta_founder_canary_hash(x) is not null then 'OWNER_TEST_READY'when x.canary_reconciliation_hash is not null then 'RECONCILED'when exists(select 1 from private.polat_experiment_evidence where run_id=x.canary_run_id and(stage in('RESULT_UNKNOWN','DELAYED_RESULT')or(stage='PROVIDER_RESULT'and(payload->>'status'<>'SUCCEEDED'or payload->>'qa'<>'APPROVED'))))then 'REVIEW'when exists(select 1 from private.polat_experiment_attempts where run_id=x.canary_run_id)then 'PENDING'else 'NOT_STARTED'end,
   'global_requests',x.request_count,'maximum_requests',350,'reserved_liability',case when can_bill then trim_scale(private.private_beta_exposure(x.id))::text end,'currency',case when can_bill then 'USD'end,'actual_billed_amount',case when can_bill then actual_value end,'billing_status',case when not can_bill then 'ROLE_RESTRICTED'when actual_value is null then 'UNKNOWN'else 'INDEPENDENTLY_RECONCILED'end,
   'founder_limit',20,'friend_limit',30,'friend_limit_count',10,'primary_operator_configured',x.configuration->>'primary_operator'is not null,'backup_operator_configured',x.configuration->>'backup_operator'is not null);
  if private.private_beta_founder_only(x) then program_value:=program_value||jsonb_build_object('owner_only_test',true);end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'status',a.status,'conversation_id',a.conversation_id,'joined_at',a.joined_at,'revoked_at',a.revoked_at,'model_requests',a.request_count,'maximum_requests',case a.kind when 'FOUNDER'then 20 else 30 end)order by a.joined_at,a.id),'[]')into participants_value from(select * from private.private_beta_participants where tenant_id=target_tenant_id and program_id=x.id order by joined_at,id limit 12)a;
  with source as materialized(select a.id,a.created_at,s.scope from private.polat_experiment_attempts a join private.private_beta_attempt_scope s on s.attempt_id=a.id where s.tenant_id=target_tenant_id and s.program_id=x.id and(a.created_at,a.id)<=(anchor_time,anchor_id)and(before_time is null or(a.created_at,a.id)<(before_time,before_id))order by a.created_at desc,a.id desc limit page_size_value+1)
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'scope',a.scope,'created_at',a.created_at,'status',coalesce((select case when e.stage='DELAYED_RESULT'then 'UNKNOWN'when e.stage='DISPATCH_STARTED'then 'DISPATCH_STARTED'else e.payload->>'status'end from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage in('DISPATCH_STARTED','PROVIDER_RESULT','RESULT_UNKNOWN','DELAYED_RESULT')order by e.sequence desc limit 1),'RESERVED'),
   'qa',coalesce((select e.payload->>'qa'from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage in('PROVIDER_RESULT','RESULT_UNKNOWN','DELAYED_RESULT')order by sequence desc limit 1),'NOT_EVALUATED'),
   'input_tokens',(select(e.payload->>'input_tokens')::int from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage in('PROVIDER_RESULT','DELAYED_RESULT')order by sequence desc limit 1),'output_tokens',(select(e.payload->>'output_tokens')::int from private.polat_experiment_evidence e where e.attempt_id=a.id and e.stage in('PROVIDER_RESULT','DELAYED_RESULT')order by sequence desc limit 1),
   'actual_billed_amount',case when can_bill then private.private_beta_billing(a.id)end,'billing_status',case when not can_bill then 'ROLE_RESTRICTED'when private.private_beta_billing(a.id)is null then 'UNKNOWN'else 'INDEPENDENTLY_RECONCILED'end)order by a.created_at desc,a.id desc),'[]'),(select count(*)>page_size_value from source)into attempts_value,more from(select * from source order by created_at desc,id desc limit page_size_value)a;
  if more then tail:=attempts_value->(jsonb_array_length(attempts_value)-1);next_value:=jsonb_build_object('v',1,'tenant',target_tenant_id,'user',auth.uid(),'role',role_value,'size',page_size_value,'program',x.id,'generation',x.generation::text,'anchor',jsonb_build_object('at',anchor_time,'id',anchor_id),'before',jsonb_build_object('at',tail->>'created_at','id',tail->>'id'),'expires',expiry);next_value:=next_value||jsonb_build_object('seal',encode(extensions.hmac(convert_to(private.fse_canonical(next_value),'UTF8'),x.cursor_secret,'sha256'),'hex'));end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'conversation_id',n.conversation_id,'scenario',n.scenario,'outcome',n.outcome,'note',n.note,'created_at',n.created_at,'author',case when n.kind in('TESTER_FEEDBACK','PARTICIPATION','DELETION_REQUEST')then 'TESTER'when n.actor_id is null then 'SYSTEM'else 'OPERATOR'end)order by n.created_at desc,n.id desc),'[]'),(select count(*)>page_size_value from(select 1 from private.private_beta_observations where tenant_id=target_tenant_id and program_id=x.id limit page_size_value+1)q)into notes_value,note_more from(select id,conversation_id,scenario,outcome,note,created_at,kind,actor_id from private.private_beta_observations where tenant_id=target_tenant_id and program_id=x.id order by created_at desc,id desc limit page_size_value)n;
 elsif cursor_value is not null then raise exception 'PRIVATE_BETA_CURSOR_INVALID'using errcode='22023';end if;
 if x.id is not null and private.private_beta_openai(x)then program_value:=program_value||jsonb_build_object('model_provider','openai','model_name','gpt-6.1-sol');end if;
 return jsonb_build_object('version',1,'mode','PRIVATE_BETA_UAT','program',program_value,'participants',participants_value,'attempts',attempts_value,'notes',notes_value,'page_size',page_size_value,'has_more',more,'next_cursor',next_value,'notes_has_more',note_more,'financial_authority','NONE','commercial_sales',false);end;$$;


-- Preserve the separate genuine commercial and historical authorities.
alter table private.polat_experiment_runs drop constraint polat_experiment_versioned_authority;
alter table private.polat_experiment_runs add constraint polat_experiment_versioned_authority check(
 (binding->>'mode'='OFFLINE_SYNTHETIC'and binding->>'financial_authority'='NONE'and binding->'execution_enabled'='false'::jsonb and binding->'authorized_external_requests'='0'::jsonb)
 or(binding->>'mode'='PRIVATE_BETA_UAT'and binding->>'financial_authority'='NONE'and binding->'commercial_sales'='false'::jsonb
 and((binding->'version'='1'::jsonb and binding->>'provider'='anthropic'and binding->>'model'='claude-haiku-5-5'and binding->>'model_version'='claude-haiku-5-5'and binding->>'protocol_version'='2023-06-01')
 or(binding->'version'='3'::jsonb and binding->>'scope'='OWNER_ONLY' and binding->>'effective_limit_kind'='LOCAL_DURABLE_RESERVATION_CAP' and binding->>'provider'='openai' and binding->>'model'='gpt-6.1-sol' and binding->>'model_version'='gpt-6.1-sol' and binding->>'protocol_version'='responses-v1')
 or(binding->'version'='2'::jsonb and binding->>'provider'='openai'and binding->>'model'='gpt-6.1-sol'and binding->>'model_version'='gpt-6.1-sol'and binding->>'protocol_version'='responses-v1'))
 and binding->>'currency'='USD'and(binding->>'maximum_spend')::numeric<=5)
 or(binding->>'mode'='FOUNDER_CAMPAIGN'and binding->'version'='3'::jsonb and binding->>'provider'='openai'and binding->>'model'='gpt-6.1-sol'and binding->>'financial_authority'='NONE'and binding->>'currency'='USD'));

revoke all on function private.private_beta_founder_only(private.private_beta_programs),private.private_beta_founder_canary_hash(private.private_beta_programs),private.private_beta_external_exposure_v2(uuid),private.private_beta_exposure(uuid),private.private_beta_founder_model_record(uuid,uuid,text),private.private_beta_binding_external_v2(private.private_beta_programs,boolean),private.private_beta_binding(private.private_beta_programs,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_private_beta_prepare_founder_test_v1(uuid,uuid,bigint,text) from public,anon,service_role;
grant execute on function public.admin_private_beta_prepare_founder_test_v1(uuid,uuid,bigint,text) to authenticated;

create or replace function public.admin_private_beta_canary_scope_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare p private.private_beta_programs;begin
 perform private.private_beta_admin(target_tenant_id,true);perform private.private_beta_mfa_at();p:=private.private_beta_guard(target_tenant_id,program_id_value);
 if p.owner_user_id is distinct from auth.uid()or p.stage<>'CANARY'or not private.private_beta_live_window(p)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 return (case when private.private_beta_founder_only(p) then jsonb_build_object('owner_only',true) else '{}'::jsonb end)||jsonb_build_object('program_id',p.id,'tenant_id',p.tenant_id,'stage','CANARY','repository_sha',p.configuration->>'repository_sha')||case when private.private_beta_openai(p)then jsonb_build_object('provider','openai','model','gpt-6.1-sol')else '{}'::jsonb end;end;$$;


alter function public.private_beta_record_v1(uuid,uuid,uuid,uuid,text) rename to private_beta_record_external_v2;
create function public.private_beta_record_v1(target_tenant_id uuid,program_id_value uuid,attempt_id_value uuid,dispatch_nonce_value uuid,raw_outcome_value text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x private.private_beta_programs;v jsonb;result jsonb;begin
 result:=public.private_beta_record_external_v2(target_tenant_id,program_id_value,attempt_id_value,dispatch_nonce_value,raw_outcome_value);
 select * into strict x from private.private_beta_programs where tenant_id=target_tenant_id and id=program_id_value for update;
 v:=private.fse_strict_json(raw_outcome_value);
 if private.private_beta_founder_only(x) and v->>'status'='SUCCEEDED' and (
  coalesce(v->>'input_tokens','')!~'^[0-9]{1,7}$' or coalesce(v->>'output_tokens','')!~'^[0-9]{1,3}$'
  or coalesce((v->>'input_tokens')::numeric,0) not between 1 and 1050000 or coalesce((v->>'output_tokens')::numeric,0) not between 1 and 512
  or coalesce(v->>'provider_usage_hash','')!~'^[a-f0-9]{64}$' or coalesce(v->>'response_hash','')!~'^[a-f0-9]{64}$' or coalesce(v->>'response_identity_hash','')!~'^[a-f0-9]{64}$') then
  update private.polat_experiment_runs set stop_reason=coalesce(stop_reason,'OWNER_UAT_USAGE_BOUND_UNVERIFIED') where id in(x.canary_run_id,x.conversation_run_id);
  update private.private_beta_programs set stage='STOPPED',generation=generation+1 where id=x.id and stage<>'STOPPED';
  insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','private_beta.usage_bound_hold','polat_experiment_attempts',attempt_id_value::text,jsonb_build_object('financial_authority','NONE','provider_billing','UNKNOWN'));
 end if;
 return result;
end;$$;
revoke all on function public.private_beta_record_external_v2(uuid,uuid,uuid,uuid,text),public.private_beta_record_v1(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.private_beta_record_v1(uuid,uuid,uuid,uuid,text) to service_role;

-- Same numeric Business setup, also usable after this owner's successful canary.
-- A CANARY can never become a wider beta grant or bypass the real provider probe.
create function private.private_beta_connection_setup_allowed(x private.private_beta_programs) returns boolean language sql stable set search_path=pg_catalog as $$
 select (x.stage='DRAFT' and x.request_count=0) or (private.private_beta_founder_only(x) and x.stage='CANARY' and x.request_count=1 and private.private_beta_founder_canary_hash(x) is not null)
$$;

create or replace function private.private_beta_business_discovery_record(t uuid,p uuid,expected_program_generation bigint,raw_value text)returns void language plpgsql set search_path=pg_catalog as $$
declare x private.private_beta_programs;v jsonb;c jsonb;chat jsonb;at_value timestamptz;expiry timestamptz;keys_seen text[]:='{}';chats_seen text[];digest text;k text;begin
 if current_user<>'postgres'then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 x:=private.private_beta_guard(t,p);select * into x from private.private_beta_programs where id=p for update;
 if not private.private_beta_connection_setup_allowed(x)or exists(select 1 from private.private_beta_participants where tenant_id=t and program_id=p)
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


create or replace function public.admin_private_beta_business_discovery_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare p private.private_beta_programs;v jsonb;begin
 perform private.private_beta_admin(target_tenant_id,true);perform private.private_beta_mfa_at();p:=private.private_beta_guard(target_tenant_id,program_id_value);
 if p.owner_user_id is distinct from auth.uid()then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;v:=p.business_discovery;
 if v is null or not private.private_beta_connection_setup_allowed(p)or v->>'program_generation'is distinct from p.generation::text or v->>'program_id'is distinct from p.id::text or v->>'tenant_id'is distinct from target_tenant_id::text
 or v->>'repository_sha'is distinct from p.configuration->>'repository_sha'or v->>'bot_id'is distinct from p.bot_control->>'bot_id'or v->>'credential_sha256'is distinct from p.bot_control->>'credential_sha256'
 or(v->>'observed_at')::timestamptz>clock_timestamp()or(v->>'expires_at')::timestamptz<=clock_timestamp()
 then return null;end if;
 return v-'credential_sha256';end;$$;


create or replace function public.admin_private_beta_business_configure_v1(target_tenant_id uuid,program_id_value uuid,configuration_value text,expected_generation_value bigint)returns jsonb
 language plpgsql security definer set search_path=pg_catalog as $$declare p private.private_beta_programs;b private.private_beta_business_controls;v jsonb;begin
 perform private.private_beta_admin(target_tenant_id,true);perform private.private_beta_mfa_at();p:=private.private_beta_guard(target_tenant_id,program_id_value);
 select * into p from private.private_beta_programs where id=p.id for update;
 if p.owner_user_id is distinct from auth.uid()or not private.private_beta_connection_setup_allowed(p) or p.bot_control is null or p.bot_control->>'api_environment'is distinct from 'production'
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


revoke all on function private.private_beta_connection_setup_allowed(private.private_beta_programs) from public,anon,authenticated,service_role;
