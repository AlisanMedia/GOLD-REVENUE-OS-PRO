-- Explicit OpenAI private-UAT extension. No deployment, credential, provider,
-- financial receipt, subscription or Telegram authority is enabled by migration.
-- Historical Claude v1 and OFFLINE_SYNTHETIC evidence remain unchanged.

create function private.private_beta_openai(x private.private_beta_programs)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(x.configuration->>'model_provider'='openai' and x.configuration->>'model_name'='gpt-6.1-sol',false)
$$;


create or replace function private.private_beta_configuration(raw_value text)returns jsonb language plpgsql immutable set search_path=pg_catalog as $$declare v jsonb;k text;begin
 if raw_value is null or octet_length(raw_value)>4096 then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;v:=private.fse_strict_json(raw_value);
 if v ? 'model_provider' or v ? 'model_name' then
  if not private.fse_keys(v,array['repository_sha','starts_at','expires_at','retention_days','notice_version','primary_operator','backup_operator','model_provider','model_name'])
  or v->>'model_provider'is distinct from 'openai'or v->>'model_name'is distinct from 'gpt-6.1-sol'or v->>'notice_version'is distinct from 'polat-private-beta-notice-openai-v1'
  then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 else
  if not private.fse_keys(v,array['repository_sha','starts_at','expires_at','retention_days','notice_version','primary_operator','backup_operator'])or v->>'notice_version'is distinct from 'polat-private-beta-notice-v1'
  then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 end if;
 if v->'repository_sha'is distinct from 'null'::jsonb and(jsonb_typeof(v->'repository_sha')<>'string'or v->>'repository_sha'!~'^[a-f0-9]{40}$')then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 if v->'retention_days'is distinct from 'null'::jsonb and(jsonb_typeof(v->'retention_days')<>'number'or v->>'retention_days'!~'^[1-9][0-9]?$'or(v->>'retention_days')::int>30)then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 foreach k in array array['starts_at','expires_at']loop if v->k is distinct from 'null'::jsonb then if jsonb_typeof(v->k)<>'string'then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;perform(v->>k)::timestamptz;end if;end loop;
 foreach k in array array['primary_operator','backup_operator']loop if v->k is distinct from 'null'::jsonb then if jsonb_typeof(v->k)<>'string'then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;perform(v->>k)::uuid;end if;end loop;
 if v->>'starts_at'is not null and v->>'expires_at'is not null and((v->>'expires_at')::timestamptz<=(v->>'starts_at')::timestamptz or(v->>'expires_at')::timestamptz>(v->>'starts_at')::timestamptz+interval '7 days')then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 return v;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end;$$;

-- Versioned model selection is explicit, authenticated and only before any
-- experiment/invitation history. An env var or changed global model is not a grant.
create function public.admin_private_beta_select_openai_v1(target_tenant_id uuid,program_id_value uuid,expected_generation_value bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x private.private_beta_programs;v jsonb;begin
 perform private.private_beta_admin(target_tenant_id,true);perform private.private_beta_mfa_at();
 x:=private.private_beta_guard(target_tenant_id,program_id_value);
 select * into x from private.private_beta_programs where id=x.id for update;
 if x.owner_user_id<>auth.uid()or x.stage<>'DRAFT'or x.generation is distinct from expected_generation_value
 or x.request_count<>0 or exists(select 1 from private.private_beta_invites where program_id=x.id)
 or exists(select 1 from private.polat_experiment_runs where id in(x.canary_run_id,x.conversation_run_id))
 then raise exception 'PRIVATE_BETA_MODEL_SELECTION_UNAVAILABLE'using errcode='42501';end if;
 if private.private_beta_openai(x) then return jsonb_build_object('program_id',x.id,'provider','openai','model','gpt-6.1-sol','generation',x.generation::text);end if;
 v:=private.private_beta_configuration((x.configuration||jsonb_build_object('model_provider','openai','model_name','gpt-6.1-sol','notice_version','polat-private-beta-notice-openai-v1'))::text);
 update private.private_beta_programs set configuration=v,manifest_hash=private.fse_hash(private.fse_canonical(v)),account_control=null,pricing_control=null,generation=generation+1 where id=x.id returning * into x;
 perform private.private_beta_ensure_runtime(target_tenant_id);
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)
 values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.model_selected','private_beta_programs',x.id::text,jsonb_build_object('provider','openai','model','gpt-6.1-sol','generation',x.generation,'financial_authority','NONE'));
 return jsonb_build_object('program_id',x.id,'provider','openai','model','gpt-6.1-sol','generation',x.generation::text);
end;$$;
revoke all on function public.admin_private_beta_select_openai_v1(uuid,uuid,bigint)from public,anon,service_role;
grant execute on function public.admin_private_beta_select_openai_v1(uuid,uuid,bigint)to authenticated;


alter function private.private_beta_account_control_record(uuid,uuid,text)rename to private_beta_account_control_record_claude_v1;
create function private.private_beta_account_control_record(t uuid,p uuid,raw_value text)returns void language plpgsql set search_path=pg_catalog as $$
declare x private.private_beta_programs;envelope jsonb;v jsonb;pricing jsonb;k text;liability numeric;begin
 if current_user<>'postgres'then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 x:=private.private_beta_guard(t,p);select * into x from private.private_beta_programs where id=x.id for update;
 if raw_value is null or octet_length(raw_value)>16384 then raise exception 'PRIVATE_BETA_ACCOUNT_INVALID'using errcode='22023';end if;
 envelope:=private.fse_strict_json(raw_value);
 if not private.fse_keys(envelope,array['payload','pricing'])then raise exception 'PRIVATE_BETA_ACCOUNT_INVALID'using errcode='22023';end if;
 v:=envelope->'payload';pricing:=envelope->'pricing';
 if not coalesce(private.private_beta_openai(x),false) then
  perform private.private_beta_account_control_record_claude_v1(t,p,raw_value);return;
 end if;
 foreach k in array array['enforced_maximum_spend','independently_observed_spend','remaining_allowance']loop
  if jsonb_typeof(v->k)is distinct from 'string'then raise exception 'PRIVATE_BETA_ACCOUNT_INVALID'using errcode='22023';end if;
 end loop;
 if not private.fse_keys(v,array['version','origin','program_id','tenant_id','account_scope_hash','organization_id','project_id','credential_sha256','repository_sha','manifest_hash','authorization_record_hash','provider','model','model_access','policy_hash','credential_custody_hash','region_evidence_hash','retention_evidence_hash','training_evidence_hash','effective_limit_kind','currency','enforced_maximum_spend','independently_observed_spend','remaining_allowance','billing_state','billing_evidence_hash','canary_reconciliation_hash','unknown_outcome_count','request_bound','observed_at','expires_at'])
 or v->'version'is distinct from '2'::jsonb or v->>'origin'is distinct from 'INDEPENDENT_ACCOUNT_CONTROL'
 or v->>'program_id'is distinct from p::text or v->>'tenant_id'is distinct from t::text
 or v->>'provider'is distinct from 'openai'or v->>'model'is distinct from 'gpt-6.1-sol'
 or v->>'repository_sha'is distinct from x.configuration->>'repository_sha'or v->>'manifest_hash'is distinct from x.manifest_hash
 or v->>'authorization_record_hash'is distinct from x.authorization_record_hash
 or v->>'organization_id'!~'^org[-_][A-Za-z0-9_-]{1,120}$'or v->>'project_id'!~'^proj_[A-Za-z0-9_-]{1,120}$'
 or v->>'organization_id'is null or v->>'project_id'is null or v->>'credential_sha256'is null
 or v->>'account_scope_hash'is distinct from private.fse_hash(private.fse_canonical(jsonb_build_array('OPENAI_PROJECT1',v->>'organization_id',v->>'project_id')))
 or v->'model_access'is distinct from 'true'::jsonb or v->>'currency'is distinct from 'USD'
 or v->>'effective_limit_kind'is distinct from 'ENFORCED_EXPERIMENT_HARD_CAP'
 or private.polat_experiment_decimal(v->>'enforced_maximum_spend')>5 or private.polat_experiment_decimal(v->>'enforced_maximum_spend')<=0
 or private.polat_experiment_decimal(v->>'independently_observed_spend')>private.polat_experiment_decimal(v->>'enforced_maximum_spend')
 or private.polat_experiment_decimal(v->>'remaining_allowance')<=0
 or private.polat_experiment_decimal(v->>'remaining_allowance')>private.polat_experiment_decimal(v->>'enforced_maximum_spend')-private.polat_experiment_decimal(v->>'independently_observed_spend')
 or v->>'billing_state'is null or v->>'billing_state'not in('RECONCILED','BOUNDED_LIABILITY_RESERVED')
 or v->'unknown_outcome_count'is distinct from '0'::jsonb or v->'request_bound'is distinct from 'null'::jsonb
 or v->>'observed_at'is null or v->>'expires_at'is null
 or(v->>'observed_at')::timestamptz>clock_timestamp()or(v->>'observed_at')::timestamptz<clock_timestamp()-interval '5 minutes'
 or(v->>'expires_at')::timestamptz<=clock_timestamp()or(v->>'expires_at')::timestamptz>(v->>'observed_at')::timestamptz+interval '5 minutes'
 then raise exception 'PRIVATE_BETA_ACCOUNT_INVALID'using errcode='22023';end if;
 foreach k in array array['account_scope_hash','credential_sha256','policy_hash','credential_custody_hash','region_evidence_hash','retention_evidence_hash','training_evidence_hash','billing_evidence_hash']loop
  if v->>k is null or v->>k!~'^[a-f0-9]{64}$'then raise exception 'PRIVATE_BETA_ACCOUNT_INVALID'using errcode='22023';end if;
 end loop;
 if x.account_control is not null and x.account_control->>'account_scope_hash'<>v->>'account_scope_hash'then raise exception 'PRIVATE_BETA_ACCOUNT_IMMUTABLE'using errcode='42501';end if;
 if v->>'canary_reconciliation_hash'is not null then
  if v->>'canary_reconciliation_hash'!~'^[a-f0-9]{64}$'or v->>'canary_reconciliation_hash'is distinct from x.canary_reconciliation_hash
  or not exists(select 1 from private.polat_experiment_evidence e join private.polat_experiment_attempts a on a.id=e.attempt_id where e.run_id=x.canary_run_id and e.stage='PROVIDER_RESULT'and e.payload->>'status'='SUCCEEDED'and e.payload->>'qa'='APPROVED'and e.payload->>'input_tokens'is not null and e.payload->>'output_tokens'is not null)
  then raise exception 'PRIVATE_BETA_CANARY_UNVERIFIED'using errcode='42501';end if;
 end if;
 foreach k in array array['maximum_input_usd_per_million','maximum_output_usd_per_million']loop
  if jsonb_typeof(pricing->k)is distinct from 'string'then raise exception 'PRIVATE_BETA_PRICING_INVALID'using errcode='22023';end if;
 end loop;
 if not private.fse_keys(pricing,array['version','origin','model','currency','source_url','source_hash','maximum_input_tokens','maximum_input_usd_per_million','maximum_output_usd_per_million','observed_at','expires_at','all_billable_components_covered'])
 or pricing->'version'is distinct from '2'::jsonb or pricing->>'origin'is distinct from 'INDEPENDENT_OFFICIAL_PRICING_READ'
 or pricing->>'model'is distinct from 'gpt-6.1-sol'or pricing->>'currency'is distinct from 'USD'
 or pricing->>'source_url'is null or pricing->>'source_url'not in('https://developers.openai.com/api/docs/models/gpt-6.1-sol','https://developers.openai.com/api/docs/pricing')
 or pricing->>'source_hash'is null or pricing->>'source_hash'!~'^[a-f0-9]{64}$'or pricing->'maximum_input_tokens'is distinct from '1050000'::jsonb
 or private.polat_experiment_decimal(pricing->>'maximum_input_usd_per_million')<4 or private.polat_experiment_decimal(pricing->>'maximum_output_usd_per_million')<15
 or pricing->'all_billable_components_covered'is distinct from 'true'::jsonb or pricing->>'observed_at'is null or pricing->>'expires_at'is null
 or(pricing->>'observed_at')::timestamptz>clock_timestamp()or(pricing->>'expires_at')::timestamptz<=clock_timestamp()
 or(pricing->>'expires_at')::timestamptz>(pricing->>'observed_at')::timestamptz+interval '24 hours'
 then raise exception 'PRIVATE_BETA_PRICING_INVALID'using errcode='22023';end if;
 liability:=ceil(((pricing->>'maximum_input_tokens')::numeric*private.polat_experiment_decimal(pricing->>'maximum_input_usd_per_million')+512*private.polat_experiment_decimal(pricing->>'maximum_output_usd_per_million'))*1000000000000)/1000000000000000000;
 if liability<=0 or liability>private.polat_experiment_decimal(v->>'remaining_allowance')then raise exception 'PRIVATE_BETA_LIABILITY_EXCEEDS_ALLOWANCE'using errcode='22023';end if;
 update private.private_beta_programs set account_control=v,pricing_control=pricing,canary_reconciliation_hash=coalesce(canary_reconciliation_hash,v->>'canary_reconciliation_hash')where id=p;
 insert into private.private_beta_observations(tenant_id,program_id,command_id,kind,scenario,outcome,note)
 values(t,p,extensions.gen_random_uuid(),'ACCOUNT_CONTROL','OPENAI_ACCOUNT_READ','NOTE','Independent OpenAI account-control evidence recorded; key value and actual billed cost are not exposed.');
end;$$;


create or replace function private.private_beta_binding(x private.private_beta_programs,canary boolean)returns jsonb language plpgsql stable set search_path=pg_catalog as $$declare liability numeric;begin
 if x.account_control is null or x.pricing_control is null or x.configuration->>'repository_sha'is null or x.configuration->>'expires_at'is null then raise exception 'PRIVATE_BETA_ACCOUNT_MISSING'using errcode='55000';end if;
 liability:=ceil(((x.pricing_control->>'maximum_input_tokens')::numeric*private.polat_experiment_decimal(x.pricing_control->>'maximum_input_usd_per_million')+512*private.polat_experiment_decimal(x.pricing_control->>'maximum_output_usd_per_million'))*1000000000000)/1000000000000000000;
 return jsonb_build_object('version',case when private.private_beta_openai(x)then 2 else 1 end,'mode','PRIVATE_BETA_UAT','program_id',x.id,'tenant_id',x.tenant_id,'conversation_style','DIRECT','provider',coalesce(x.configuration->>'model_provider','anthropic'),'model',coalesce(x.configuration->>'model_name','claude-haiku-5-5'),'model_version',coalesce(x.configuration->>'model_name','claude-haiku-5-5'),'protocol_version',case when private.private_beta_openai(x)then 'responses-v1'else '2023-06-01'end,
 'repository_sha',x.configuration->>'repository_sha','manifest_hash',x.manifest_hash,'authorization_record_hash',x.authorization_record_hash,'account_scope_hash',x.account_control->>'account_scope_hash',
 'corpus_version',case when canary then case when private.private_beta_openai(x)then 'polat-openai-canary-v1'else 'polat-claude-canary-v1'end else 'polat-private-beta-conversation-v1'end,
 'corpus_hash',case when canary then case when private.private_beta_openai(x)then 'afda9041422b96eca4ccb86e95febfc920b35db01d38ffc42b96505a4f955fad'else '1afc425d131e4f3e7ee82976e034b703fffbd59bd388b6c1738a6617290d3630'end else private.fse_hash('POLAT_PRIVATE_BETA_CONVERSATION1')end,
 'plan_hash',case when canary then case when private.private_beta_openai(x)then '05ed93b8aef4c47bf86c333ce779dd0e408692cadcf3e2e167af74a6b256a71f'else '372b81b5017359aef85f3b4080c1ff7f6bf9193459c30a2505425fc5463066c5'end else private.fse_hash(private.fse_canonical(jsonb_build_array('POLAT_PRIVATE_BETA_PLAN1',x.id,x.manifest_hash,20,30,10,350,'5.00')))end,
 'maximum_requests',case when canary then 1 else 350 end,'maximum_spend','5.00','maximum_attempt_liability',trim_scale(liability)::text,'currency','USD','maximum_output_tokens',512,'timeout_ms',10000,
 'expires_at',to_char((x.configuration->>'expires_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'financial_authority','NONE','commercial_sales',false);
end;$$;

alter table private.polat_experiment_runs drop constraint polat_experiment_versioned_authority;
alter table private.polat_experiment_runs add constraint polat_experiment_versioned_authority check(
 (binding->>'mode'='OFFLINE_SYNTHETIC'and binding->>'financial_authority'='NONE'and binding->'execution_enabled'='false'::jsonb and binding->'authorized_external_requests'='0'::jsonb)
 or(binding->>'mode'='PRIVATE_BETA_UAT'and binding->>'financial_authority'='NONE'and binding->'commercial_sales'='false'::jsonb
 and((binding->'version'='1'::jsonb and binding->>'provider'='anthropic'and binding->>'model'='claude-haiku-5-5'and binding->>'model_version'='claude-haiku-5-5'and binding->>'protocol_version'='2023-06-01')
 or(binding->'version'='2'::jsonb and binding->>'provider'='openai'and binding->>'model'='gpt-6.1-sol'and binding->>'model_version'='gpt-6.1-sol'and binding->>'protocol_version'='responses-v1'))
 and binding->>'currency'='USD'and(binding->>'maximum_spend')::numeric<=5));


create or replace function private.private_beta_ensure_runtime(t uuid)returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare p private.private_beta_programs;v public.agent_versions;vid uuid;n int;begin
 select * into p from private.private_beta_programs where tenant_id=t for update;
 if p.id is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 perform private.private_beta_guard(t,p.id);
 vid:=private.ensure_shadow_agent(t);select * into strict v from public.agent_versions where tenant_id=t and id=vid;
 if v.model_provider=coalesce(p.configuration->>'model_provider','anthropic')and v.model_name=coalesce(p.configuration->>'model_name','claude-haiku-5-5')then return v.id;end if;
 perform private.ensure_conversation_quality_config(t);
 select coalesce(max(version),0)+1 into n from public.agent_versions where tenant_id=t and agent_definition_id=v.agent_definition_id;
 update public.agent_versions set superseded_at=clock_timestamp()where tenant_id=t and agent_definition_id=v.agent_definition_id and superseded_at is null;
 insert into public.agent_versions(tenant_id,agent_definition_id,version,prompt_template,output_schema_version,allowed_tools,model_provider,model_name,timeout_ms,max_attempts,retry_policy,prompt_version,director_version,renderer_version,qa_version,context_version,evaluation_set_version)
 values(t,v.agent_definition_id,n,'Polat VIP private beta; exact response QA; no financial or VIP authority.',4,'{}',coalesce(p.configuration->>'model_provider','anthropic'),coalesce(p.configuration->>'model_name','claude-haiku-5-5'),10000,1,'{"strategy":"none","maximum_retries":0}',v.prompt_version,v.director_version,v.renderer_version,v.qa_version,3,v.evaluation_set_version)returning id into vid;
 insert into private.escalation_controls(tenant_id,enabled,approval_reference,chat_id,bot_id)values(t,true,'private-beta-owner:'||p.id,null,null)on conflict(tenant_id)do nothing;
 return vid;end;$$;

create or replace function private.private_beta_capture_source(source_event public.domain_events)returns void language plpgsql security definer set search_path=pg_catalog as $$
declare a private.private_beta_participants;p private.private_beta_programs;m public.messages;c public.conversations;v public.agent_versions;captured uuid;reason text;begin
 if source_event.event_type<>'message.received'then return;end if;
 select * into a from private.private_beta_participants where tenant_id=source_event.tenant_id and conversation_id::text=source_event.payload->>'conversation_id';
 if a.id is null then return;end if;
 -- Ingestion already owns its conversation. Do not invert the dispatch lock
 -- order (program -> conversation) merely to capture a queued obligation.
 select * into p from private.private_beta_programs where id=a.program_id;
 select * into c from public.conversations where tenant_id=source_event.tenant_id and id=a.conversation_id;
 select * into m from public.messages where tenant_id=source_event.tenant_id and conversation_id=c.id and id::text=source_event.payload->>'message_id'and direction='inbound';
 if m.id is null then return;end if;
 if a.status='ACTIVE'and m.content~'^/unsupported 'then
  perform public.private_beta_hold_source_v1(source_event.tenant_id,c.id,source_event.id,'UNSUPPORTED_INPUT');return;
 end if;
 if m.content~'^/(start|agree|stop|delete|feedback)([[:space:]]|$)'then return;end if;
 select av.* into v from public.agent_versions av join public.agent_definitions ad on ad.tenant_id=av.tenant_id and ad.id=av.agent_definition_id where av.tenant_id=source_event.tenant_id and ad.agent_type='conversation_shadow'and av.model_provider=coalesce(p.configuration->>'model_provider','anthropic')and av.model_name=coalesce(p.configuration->>'model_name','claude-haiku-5-5')and av.superseded_at is null order by av.version desc limit 1;
 if v.id is null then raise exception 'PRIVATE_BETA_RUNTIME_NOT_PREPARED'using errcode='55000';end if;
 reason:=case when a.status<>'ACTIVE'or not private.private_beta_live_window(p)then 'PARTICIPATION_OR_WINDOW_BLOCKED'when c.runtime_mode<>'AI_ACTIVE'or c.human_takeover then 'HUMAN_OWNS_SOURCE'when not((a.kind='FOUNDER'and p.stage in('FOUNDER','FRIENDS'))or(a.kind='FRIEND'and p.stage='FRIENDS'))then 'STAGE_NOT_ENABLED'else null end;
 insert into public.agent_tasks(tenant_id,agent_definition_id,agent_version_id,customer_id,conversation_id,source_event_id,task_type,objective,execution_mode,status,priority,idempotency_key,correlation_id,causation_id,max_attempts,failure_code,cancellation_reason)
 values(source_event.tenant_id,v.agent_definition_id,v.id,c.customer_id,c.id,source_event.id,'private_beta.reply','Prepare one source-bound Polat private-beta reply; actual response QA; no retries or financial authority.','HUMAN_APPROVAL',case when reason is null then 'QUEUED'::public.agent_runtime_status else 'CANCELLED'::public.agent_runtime_status end,50,'private-beta-source-v1:'||m.id,source_event.correlation_id,source_event.id,1,reason,reason)on conflict(tenant_id,idempotency_key)do nothing returning id into captured;
 if captured is null then return;end if;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(source_event.tenant_id,'SYSTEM','private_beta.inbound_owned','messages',m.id::text,jsonb_build_object('state',coalesce(reason,'AI_RESPONSE_PENDING'),'source_event_id',source_event.id,'financial_authority','NONE'));
 return;end;$$;

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
  if x.canary_reconciliation_hash is null or source_message_id_value is null then raise exception 'PRIVATE_BETA_CANARY_UNVERIFIED'using errcode='55000';end if;
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

create or replace function private.private_beta_native_registry(t uuid,rid uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare r public.agent_runs;q public.agent_tasks;a private.private_beta_attempt_scope;expected jsonb;facts jsonb;begin
 select * into strict r from public.agent_runs where tenant_id=t and id=rid;select * into strict q from public.agent_tasks where tenant_id=t and id=r.task_id;
 select * into a from private.private_beta_attempt_scope where tenant_id=t and native_run_id=rid and conversation_id=q.conversation_id;
 if a.attempt_id is null or r.context_manifest->>'private_beta_profile'is distinct from 'polat-private-beta-v1'or r.context_manifest->>'private_beta_program_id'is distinct from a.program_id::text
 or r.context_manifest->>'private_beta_participant_id'is distinct from a.participant_id::text or r.context_manifest->>'private_beta_revision'is distinct from a.participant_revision::text or r.context_manifest->>'source_message_id'is distinct from a.source_message_id::text
 or not exists(select 1 from private.private_beta_programs p where p.id=a.program_id and p.tenant_id=t and r.model_provider=coalesce(p.configuration->>'model_provider','anthropic')and r.model_name=coalesce(p.configuration->>'model_name','claude-haiku-5-5')and r.context_manifest->>'private_beta_codec'=case when private.private_beta_openai(p)then 'openai-responses-v1'else 'claude-messages-v1'end)or r.context_manifest->>'financial_authority'is distinct from 'NONE'or jsonb_array_length(r.context_manifest->'included_message_ids')not between 1 and 25 then raise exception 'EVIDENCE_REGISTRY_NOT_AUTHORITATIVE'using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('handle',case when ids.value=a.source_message_id::text then 'EVIDENCE_CURRENT_MESSAGE'else 'EVIDENCE_MESSAGE_'||ids.ordinality::text end,'messageId',m.id,'direction',m.direction)order by ids.ordinality),'[]')into expected
 from jsonb_array_elements_text(r.context_manifest->'included_message_ids')with ordinality ids(value,ordinality)join public.messages m on m.tenant_id=t and m.conversation_id=q.conversation_id and m.id::text=ids.value and m.created_at<=a.source_boundary and(m.direction='inbound'or(m.direction='outbound'and m.status='sent'));
 if jsonb_array_length(expected)<>jsonb_array_length(r.context_manifest->'included_message_ids')then raise exception 'EVIDENCE_REGISTRY_NOT_AUTHORITATIVE'using errcode='22023';end if;
 facts:=jsonb_build_array(jsonb_build_object('id','polat:uat:identity:v1'),jsonb_build_object('id','polat:uat:identity:denial:v1'))||private.quality_commercial_facts(t,rid);
 expected:=expected||(select jsonb_agg(jsonb_build_object('handle','EVIDENCE_COMMERCIAL_'||f.ordinality::text,'messageId',f.value->>'id','direction','system')order by f.ordinality)from jsonb_array_elements(facts)with ordinality f(value,ordinality));return expected;end;$$;

create or replace function private.guard_quality_stage_refs()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare r public.agent_runs%rowtype; t public.agent_tasks%rowtype; expected jsonb;
  wire jsonb; resolved jsonb; claims jsonb:='[]'::jsonb; memories jsonb:='[]'::jsonb; item jsonb;
begin
  if coalesce((new.evidence#>>'{versions,outputSchema}')::integer,0)<4 then return new; end if;
  select * into strict r from public.agent_runs where tenant_id=new.tenant_id and id=new.run_id;
  select * into strict t from public.agent_tasks where tenant_id=new.tenant_id and id=r.task_id;
  perform private.assert_quality_output_refs(new.tenant_id,new.run_id,new.evidence->'original_output');
  perform private.assert_quality_output_refs(new.tenant_id,new.run_id,new.evidence->'rendered_output');
  if exists(select 1 from public.agent_versions where tenant_id=new.tenant_id and id=r.agent_version_id
    and model_provider in('openai','anthropic')) and coalesce(new.evidence->'authoritative_evidence_resolution','null'::jsonb)='null'::jsonb then
    raise exception 'EVIDENCE_RESOLUTION_REQUIRED' using errcode='22023';
  end if;
  if new.evidence->'authoritative_evidence_resolution' is not null
     and new.evidence->'authoritative_evidence_resolution'<>'null'::jsonb then
    select coalesce(jsonb_agg(jsonb_build_object(
      'handle',case when ids.value=r.context_manifest->>'source_message_id' then 'EVIDENCE_CURRENT_MESSAGE' else 'EVIDENCE_MESSAGE_'||ids.ordinality::text end,
      'messageId',m.id,'direction',m.direction) order by ids.ordinality),'[]'::jsonb)
    into expected from jsonb_array_elements_text(r.context_manifest->'included_message_ids') with ordinality ids(value,ordinality)
      join public.messages m on m.tenant_id=new.tenant_id and m.conversation_id=t.conversation_id and m.id::text=ids.value
      and m.created_at<=(r.context_manifest->>'context_boundary_timestamp')::timestamptz;
    expected:=expected||(select coalesce(jsonb_agg(jsonb_build_object(
      'handle','EVIDENCE_COMMERCIAL_'||f.ordinality::text,'messageId',f.value->>'id','direction','system') order by f.ordinality),'[]')
      from jsonb_array_elements(private.quality_commercial_facts(new.tenant_id,new.run_id)) with ordinality f(value,ordinality));
    if r.context_manifest->>'polat_offline_codec'='claude-messages-v1' then expected:=private.polat_native_quality_registry(new.tenant_id,new.run_id);end if;
    if r.context_manifest->>'private_beta_codec'in('claude-messages-v1','openai-responses-v1')then expected:=private.private_beta_native_registry(new.tenant_id,new.run_id);end if;
    if expected is distinct from r.context_manifest->'evidence_handle_registry'
       or expected is distinct from new.evidence#>'{authoritative_evidence_resolution,registry}'
       or new.evidence#>>'{authoritative_evidence_resolution,resolved}' is distinct from 'true' then
      raise exception 'EVIDENCE_REGISTRY_NOT_AUTHORITATIVE' using errcode='22023';
    end if;
    wire:=new.evidence#>'{authoritative_evidence_resolution,wireOutput}';
    resolved:=jsonb_set(wire,'{semantic_response,factual_grounding,evidence_refs}',
      private.resolve_quality_wire_refs(wire#>'{semantic_response,factual_grounding,evidence_refs}',expected));
    for item in select value from jsonb_array_elements(wire->'claims') loop
      claims:=claims||jsonb_build_array(jsonb_set(item,'{evidence_refs}',private.resolve_quality_wire_refs(item->'evidence_refs',expected)));
    end loop;
    for item in select value from jsonb_array_elements(wire->'memory_proposals') loop
      memories:=memories||jsonb_build_array((item-'provenance_evidence_refs')||jsonb_build_object(
        'provenance_message_ids',private.resolve_quality_wire_refs(item->'provenance_evidence_refs',expected,true)));
    end loop;
    resolved:=jsonb_set(jsonb_set(resolved,'{claims}',claims),'{memory_proposals}',memories);
    if resolved is distinct from new.evidence->'original_output' then
      raise exception 'EVIDENCE_RESOLUTION_MISMATCH' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;

create function private.private_beta_program_notice(x private.private_beta_programs)returns text language sql stable set search_path=pg_catalog as $$
 select case when private.private_beta_openai(x)then 'Polat VIP private beta: You are speaking with Polat''s AI assistant. Authorized human support may review and handle this conversation. Test messages may be processed by OpenAI. This is a free test with fictional service data; no paid membership, payment or financial outcome is promised. To participate, send /agree. You can stop with /stop or request applicable deletion with /delete. Messages are retained for '||(x.configuration->>'retention_days')||' days subject to required audit/legal exceptions.'
 else private.private_beta_notice((x.configuration->>'retention_days')::int)end
$$;


create or replace function public.private_beta_invite_accept_v1(target_tenant_id uuid,bot_id_value text,provider_user_id_value text,provider_chat_id_value text,command_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;a private.private_beta_participants;i private.private_beta_invites;notice text;begin
 select * into x from private.private_beta_programs where tenant_id=target_tenant_id for update;
 if x.id is null or x.bot_control->>'bot_id'is distinct from bot_id_value or provider_user_id_value is distinct from provider_chat_id_value or provider_user_id_value!~'^[1-9][0-9]{0,18}$'or command_value is null or length(command_value)>120 then return private.private_beta_participant_projection(x,a);end if;
 perform private.private_beta_guard(target_tenant_id,x.id);select * into a from private.private_beta_participants where program_id=x.id and provider_user_id=provider_user_id_value and provider_chat_id=provider_chat_id_value;
 if a.conversation_id is not null then perform 1 from public.conversations where tenant_id=target_tenant_id and id=a.conversation_id for update;end if;
 if a.id is not null then select * into a from private.private_beta_participants where id=a.id for update;end if;
 if a.id is null and command_value~'^/start [a-f0-9]{48}$'and x.stage<>'STOPPED'then
  select * into i from private.private_beta_invites where program_id=x.id and code_hash=private.fse_hash(substring(command_value from 8))and expires_at>clock_timestamp()for update;
  if i.id is null or i.accepted_by is not null then return private.private_beta_participant_projection(x,a);end if;
  if(select count(*)from private.private_beta_participants where program_id=x.id and kind=i.kind)>=(case i.kind when 'FOUNDER'then 1 else 10 end)then return private.private_beta_participant_projection(x,a);end if;
  notice:=private.private_beta_program_notice(x);
  insert into private.private_beta_participants(tenant_id,program_id,invite_id,kind,provider_user_id,provider_chat_id,notice_version,notice_hash)values(target_tenant_id,x.id,i.id,i.kind,provider_user_id_value,provider_chat_id_value,x.configuration->>'notice_version',private.fse_hash(notice))returning * into a;
  update private.private_beta_invites set accepted_by=provider_user_id_value,accepted_chat=provider_chat_id_value,accepted_at=clock_timestamp()where id=i.id;
 elsif a.id is not null and command_value='/agree'and a.status='PENDING_NOTICE'and x.stage<>'STOPPED'then
  notice:=private.private_beta_program_notice(x);
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

create or replace function public.private_beta_queue_notice_v1(target_tenant_id uuid,program_id_value uuid,participant_id_value uuid,target_conversation_id uuid,source_message_id_value uuid,kind_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p private.private_beta_programs;a private.private_beta_participants;c public.conversations;s public.messages;m public.messages;body text;key_value text;mid uuid;begin
 p:=private.private_beta_guard(target_tenant_id,program_id_value);perform 1 from private.private_beta_programs where id=p.id for update;
 select * into c from public.conversations where tenant_id=target_tenant_id and id=target_conversation_id for update;
 select * into a from private.private_beta_participants where tenant_id=target_tenant_id and program_id=p.id and id=participant_id_value for update;
 select * into s from public.messages where tenant_id=target_tenant_id and conversation_id=c.id and id=source_message_id_value and direction='inbound';
 if a.id is null or c.id is null or s.id is null or s.provider_chat_id<>a.provider_chat_id or not exists(select 1 from public.messaging_contacts where tenant_id=target_tenant_id and id=c.messaging_contact_id and provider_user_id=a.provider_user_id and provider_chat_id=a.provider_chat_id)
 or not exists(select 1 from public.messaging_provider_connections where tenant_id=target_tenant_id and id=c.provider_connection_id and provider_account_ref=p.bot_control->>'bot_id')then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 if (p.configuration->>'expires_at')is null or (p.configuration->>'expires_at')::timestamptz<=clock_timestamp()then return jsonb_build_object('queued',false);end if;
 if kind_value='NOTICE'and a.status='PENDING_NOTICE'then
  body:=private.private_beta_program_notice(p);key_value:='private-beta-notice:'||a.id||':'||a.notice_version;
 elsif kind_value='AGREED'and a.status='ACTIVE'and a.consented_at is not null then
  body:='Your private-beta participation has been recorded. AI replies are subject to the approved test window and limits. You can send /stop to leave or /feedback 1 1 1 1 to rate usefulness, naturalness, correctness and satisfaction from 1 to 5.';key_value:='private-beta-agreed:'||a.id||':'||a.notice_version;
 elsif kind_value='STOPPED'and a.status='REVOKED'then
  body:='Your participation has stopped. No further AI replies or marketing will be sent.';key_value:='private-beta-stopped:'||a.id;
 elsif kind_value='DELETE_REQUESTED'and a.status='REVOKED'and a.deletion_requested_at is not null and s.content='/delete'then
  body:='Your deletion request has been recorded and your participation has stopped. Deletion is subject to the applicable privacy, retention and legal-hold review; it has not been represented as completed.';key_value:='private-beta-delete:'||a.id;
 elsif kind_value='FEEDBACK_RECORDED'and a.status='ACTIVE'and s.content~'^/feedback [1-5] [1-5] [1-5] [1-5]$'and exists(select 1 from private.private_beta_observations where program_id=p.id and kind='TESTER_FEEDBACK'and conversation_id=c.id and command_id=s.id)then
  body:='Your beta feedback has been recorded. Thank you.';key_value:='private-beta-feedback:'||s.id;
 else return jsonb_build_object('queued',false);end if;
 select * into m from public.messages where tenant_id=target_tenant_id and idempotency_key=key_value;
 if m.id is not null then return jsonb_build_object('queued',true,'duplicate',true,'message_id',m.id);end if;
 insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_chat_id,reply_to_message_id,reply_to_provider_message_id,idempotency_key,actor_type,actor_id,correlation_id,occurred_at)
 values(target_tenant_id,c.id,c.customer_id,c.messaging_contact_id,c.provider_connection_id,'outbound','text',body,'pending',a.provider_chat_id,s.id,s.provider_message_id,key_value,'SYSTEM','private-beta-notice',extensions.gen_random_uuid(),clock_timestamp())returning id into mid;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','private_beta.notice_queued','messages',mid::text,jsonb_build_object('purpose',kind_value,'notice_version',a.notice_version,'body_in_audit',false));
 return jsonb_build_object('queued',true,'duplicate',false,'message_id',mid);end;$$;

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
 if x.id is not null and private.private_beta_openai(x)then program_value:=program_value||jsonb_build_object('model_provider','openai','model_name','gpt-6.1-sol');end if;
 return jsonb_build_object('version',1,'mode','PRIVATE_BETA_UAT','program',program_value,'participants',participants_value,'attempts',attempts_value,'notes',notes_value,'page_size',page_size_value,'has_more',more,'next_cursor',next_value,'notes_has_more',note_more,'financial_authority','NONE','commercial_sales',false);end;$$;

-- Existing public RPC execute grants are preserved by CREATE OR REPLACE.
-- New private helpers and both protected account writers are never client writers.
revoke all on function private.private_beta_openai(private.private_beta_programs),private.private_beta_program_notice(private.private_beta_programs),private.private_beta_account_control_record(uuid,uuid,text),private.private_beta_account_control_record_claude_v1(uuid,uuid,text)from public,anon,authenticated,service_role;


-- The historical configure route cannot bypass the explicit provider/notice selection fence.
create or replace function public.admin_private_beta_create_v1(target_tenant_id uuid,program_id_value uuid,configuration_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare v jsonb;x private.private_beta_programs;begin
 perform private.private_beta_admin(target_tenant_id,true);v:=private.private_beta_configuration(configuration_value);if v->>'model_provider'='openai'then perform private.private_beta_mfa_at();end if;
 if not exists(select 1 from public.tenants where id=target_tenant_id and status='active'and slug like 'private-beta-%'and not outbound_messaging_enabled)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 select * into x from private.private_beta_programs where tenant_id=target_tenant_id;
 if x.id is not null then if x.id<>program_id_value or x.owner_user_id<>auth.uid()or x.configuration<>v then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;return jsonb_build_object('program_id',x.id,'stage',x.stage,'generation',x.generation::text);end if;
 insert into private.private_beta_programs(id,tenant_id,owner_user_id,configuration,authorization_record_hash,manifest_hash,canary_run_id,conversation_run_id)
 values(program_id_value,target_tenant_id,auth.uid(),v,private.fse_hash(private.fse_canonical(jsonb_build_array('PRIVATE_BETA_FIRST_UAT_OWNER1',auth.uid(),'350_REQUESTS_5_USD'))),private.fse_hash(private.fse_canonical(v)),extensions.gen_random_uuid(),extensions.gen_random_uuid())returning * into x;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.draft_created','private_beta_programs',x.id::text,jsonb_build_object('stage','DRAFT','financial_authority','NONE'));
 return jsonb_build_object('program_id',x.id,'stage',x.stage,'generation',x.generation::text);end;$$;

create or replace function public.admin_private_beta_configure_v1(target_tenant_id uuid,program_id_value uuid,configuration_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;v jsonb;k text;begin
 perform private.private_beta_admin(target_tenant_id,true);x:=private.private_beta_guard(target_tenant_id,program_id_value);v:=private.private_beta_configuration(configuration_value);
 select * into x from private.private_beta_programs where id=x.id for update;
 if x.stage<>'DRAFT'or x.owner_user_id<>auth.uid()then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 if (v->'model_provider',v->'model_name',v->'notice_version')is distinct from(x.configuration->'model_provider',x.configuration->'model_name',x.configuration->'notice_version')then raise exception 'PRIVATE_BETA_MODEL_SELECTION_UNAVAILABLE'using errcode='42501';end if;
 foreach k in array array['primary_operator','backup_operator']loop if v->>k is not null and not exists(select 1 from public.tenant_members where tenant_id=target_tenant_id and user_id=(v->>k)::uuid and status='active'and role in('super_admin','manager'))then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;end loop;
 if v is distinct from x.configuration then update private.private_beta_programs set configuration=v,manifest_hash=private.fse_hash(private.fse_canonical(v)),account_control=null,pricing_control=null,bot_control=null,generation=generation+1 where id=x.id returning * into x;end if;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.draft_configured','private_beta_programs',x.id::text,jsonb_build_object('generation',x.generation,'financial_authority','NONE'));
 return jsonb_build_object('program_id',x.id,'stage',x.stage,'generation',x.generation::text);end;$$;

create or replace function public.admin_private_beta_canary_scope_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare p private.private_beta_programs;begin
 perform private.private_beta_admin(target_tenant_id,true);perform private.private_beta_mfa_at();p:=private.private_beta_guard(target_tenant_id,program_id_value);
 if p.owner_user_id is distinct from auth.uid()or p.stage<>'CANARY'or not private.private_beta_live_window(p)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 return jsonb_build_object('program_id',p.id,'tenant_id',p.tenant_id,'stage','CANARY','repository_sha',p.configuration->>'repository_sha')||case when private.private_beta_openai(p)then jsonb_build_object('provider','openai','model','gpt-6.1-sol')else '{}'::jsonb end;end;$$;
