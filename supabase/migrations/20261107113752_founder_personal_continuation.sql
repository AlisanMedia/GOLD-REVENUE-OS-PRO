-- One fresh-MFA owner continuation after the preserved second envelope UNKNOWN.
-- No provider call, journal reset, debt waiver, authentication claim or commercial authority.
create function private.private_beta_continuation_available(x private.private_beta_programs) returns boolean language sql stable set search_path=pg_catalog as $$
 select coalesce(private.private_beta_founder_only(x) and private.private_beta_openai(x) and x.account_control->'version'='4'::jsonb and x.stage='CANARY' and x.request_count=2
 and not exists(select 1 from private.private_beta_participants where program_id=x.id)
 and not exists(select 1 from private.private_beta_invites where program_id=x.id)
 and not exists(select 1 from private.private_beta_business_controls where program_id=x.id)
 and (select count(*)from private.private_beta_attempt_scope where program_id=x.id)=2
 and exists(select 1 from private.jeff_experiment_attempts a join private.private_beta_attempt_scope s on s.attempt_id=a.id join private.jeff_experiment_runs r on r.id=a.run_id
  where s.program_id=x.id and s.tenant_id=x.tenant_id and s.scope='CANARY' and r.id=x.canary_run_id and r.binding->'version'='4'::jsonb and a.ordinal=1 and a.liability>0
  and r.stop_reason='UNKNOWN_REMOTE_COMPLETION'
  and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='DISPATCH_STARTED')
  and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='RESULT_UNKNOWN' and e.payload->>'status'='UNKNOWN' and e.payload->>'qa'='NOT_EVALUATED' and e.payload->>'error_code'='OPENAI_UAT_ENVELOPE_INVALID')
  and not exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage in('PROVIDER_RESULT','DELAYED_RESULT','RECONCILIATION')))
 and exists(select 1 from private.jeff_experiment_attempts a join private.private_beta_attempt_scope s on s.attempt_id=a.id join private.jeff_experiment_runs r on r.id=a.run_id
  where s.program_id=x.id and s.tenant_id=x.tenant_id and s.scope='CANARY' and a.id::text=x.account_control->>'retained_unknown_attempt_id' and r.id::text=x.account_control->>'retained_unknown_run_id'
  and a.liability=(x.account_control->>'retained_unknown_liability')::numeric and a.liability>0 and r.stop_reason='UNKNOWN_REMOTE_COMPLETION'
  and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='RESULT_UNKNOWN')
  and not exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage in('PROVIDER_RESULT','DELAYED_RESULT','RECONCILIATION'))),false)
$$;

-- Derive the exact authorized replacement; caller data cannot choose retained IDs,
-- liabilities, scope, provider, budget, window or authentication provenance.
create function private.private_beta_continuation_projection(x private.private_beta_programs,sha_value text,auth_at timestamptz,approved_value timestamptz) returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare o jsonb;cfg jsonb;ctl jsonb;retained jsonb;mh text;ch text;deadline timestamptz;exposure numeric;begin
 if not private.private_beta_continuation_available(x)then raise exception 'PRIVATE_BETA_CONTINUATION_UNAVAILABLE'using errcode='42501';end if;
 o:=x.founder_model_observation->'observation';
 if o is null or sha_value is null or sha_value!~'^[a-f0-9]{40}$'or o->>'repository_sha'is distinct from sha_value or sha_value=x.configuration->>'repository_sha'
 or(o->>'expires_at')::timestamptz<=approved_value+interval '1 minute' or approved_value<auth_at or approved_value-auth_at>interval '5 minutes' or approved_value>clock_timestamp()
 then raise exception 'PRIVATE_BETA_MODEL_OBSERVATION_REQUIRED'using errcode='55000';end if;
 exposure:=private.private_beta_exposure(x.id);
 if exposure>=5 then raise exception 'PRIVATE_BETA_LIMIT'using errcode='54000';end if;
 select jsonb_agg(jsonb_build_object('attempt_id',a.id,'run_id',a.run_id,'liability',trim_scale(a.liability)::text)order by s.global_ordinal)into retained
 from private.jeff_experiment_attempts a join private.private_beta_attempt_scope s on s.attempt_id=a.id where s.program_id=x.id and s.tenant_id=x.tenant_id;
 deadline:=least(approved_value+interval '24 hours',(o->>'expires_at')::timestamptz);
 cfg:=private.private_beta_configuration((x.configuration||jsonb_build_object('notice_version','jeff-private-beta-notice-openai-v1','repository_sha',sha_value,'starts_at',to_char(approved_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'expires_at',to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))::text);
 mh:=private.fse_hash(private.fse_canonical(cfg));
 ch:=private.fse_hash(private.fse_canonical(jsonb_build_array('OWNER_ENVELOPE_CONTINUATION1',x.id,x.tenant_id,x.owner_user_id,x.generation,x.configuration,retained,sha_value,auth_at,approved_value)));
 ctl:=x.account_control||jsonb_build_object('version',5,'repository_sha',sha_value,'manifest_hash',mh,'observed_at',o->>'observed_at','expires_at',to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'credential_sha256',o->>'credential_sha256','credential_custody_hash',o->>'credential_custody_hash','account_scope_hash',o->>'account_scope_hash','organization_id',o->>'organization_id','project_id',o->>'project_id','policy_hash',o->>'policy_hash',
 'retained_unknown_attempts',retained,'continuation_authorization_hash',ch,'continuation_authority','OWNER_FRESH_MFA','continuation_execution_ref','OWNER_RPC',
 'continuation_authenticated_at',to_char(auth_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'continuation_approved_at',to_char(approved_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'continuation_source_generation',x.generation::text,'unknown_outcome_count',0,'canary_result_hash',null);
 return jsonb_build_object('configuration',cfg,'manifest_hash',mh,'account_control',ctl,'pricing_control',x.founder_model_observation->'pricing','generation',x.generation+1,'approved_at',approved_value,'authenticated_at',auth_at);
end;$$;

create function public.admin_private_beta_continue_founder_test_v1(target_tenant_id uuid,program_id_value uuid,expected_generation_value bigint,repository_sha_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x private.private_beta_programs;v jsonb;b jsonb;prior_configuration jsonb;auth_at timestamptz;approved_value timestamptz:=clock_timestamp();new_run uuid:=extensions.gen_random_uuid();conversation_run uuid:=extensions.gen_random_uuid();begin
 perform private.private_beta_admin(target_tenant_id,true);auth_at:=private.private_beta_mfa_at();x:=private.private_beta_guard(target_tenant_id,program_id_value);
 select * into x from private.private_beta_programs where id=x.id for update;
 if x.owner_user_id is distinct from auth.uid()or x.generation is distinct from expected_generation_value then raise exception 'PRIVATE_BETA_CONTINUATION_UNAVAILABLE'using errcode='42501';end if;
 prior_configuration:=x.configuration;
 v:=private.private_beta_continuation_projection(x,repository_sha_value,auth_at,approved_value);
 update private.private_beta_programs set configuration=v->'configuration',manifest_hash=v->>'manifest_hash',account_control=v->'account_control',pricing_control=v->'pricing_control',generation=generation+1,
 canary_run_id=new_run,conversation_run_id=conversation_run,approved_at=approved_value,authenticated_at=auth_at where id=x.id returning * into x;
 b:=private.private_beta_binding(x,true);
 insert into private.jeff_experiment_runs(id,tenant_id,account_scope_hash,authorization_record_hash,binding,binding_hash)values(new_run,x.tenant_id,x.account_control->>'account_scope_hash',private.fse_hash(x.authorization_record_hash||':CANARY:CONTINUATION:'||(x.account_control->>'continuation_authorization_hash')),b,private.fse_hash(private.fse_canonical(b)));
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(x.tenant_id,'HUMAN',auth.uid(),'private_beta.owner_envelope_continuation','private_beta_programs',x.id::text,
 jsonb_build_object('prior_configuration',prior_configuration,'authority','OWNER_FRESH_MFA','actual_authenticated_at',auth_at,'actual_approved_at',approved_value,'retained_unknown_attempts',x.account_control->'retained_unknown_attempts','authorization_hash',x.account_control->>'continuation_authorization_hash','new_run_id',new_run,'repository_sha',repository_sha_value,'maximum_additional_canary',1,'provider_billing','UNKNOWN','financial_authority','NONE'));
 return jsonb_build_object('program_id',x.id,'stage','CANARY','generation',x.generation::text);
end;$$;
revoke all on function private.private_beta_continuation_available(private.private_beta_programs),private.private_beta_continuation_projection(private.private_beta_programs,text,timestamptz,timestamptz)from public,anon,authenticated,service_role;
revoke all on function public.admin_private_beta_continue_founder_test_v1(uuid,uuid,bigint,text)from public,anon,authenticated,service_role;
grant execute on function public.admin_private_beta_continue_founder_test_v1(uuid,uuid,bigint,text)to authenticated;

-- Historical UNKNOWN is excluded only from blocking the newly authorized run;
-- all retained liabilities remain in private_beta_exposure and the global cap.
create function private.private_beta_retained_unknown(x private.private_beta_programs,attempt_value uuid)returns boolean language sql immutable set search_path=pg_catalog as $$
 select case when x.account_control->'version'='5'::jsonb then exists(select 1 from jsonb_array_elements(x.account_control->'retained_unknown_attempts')a where a->>'attempt_id'=attempt_value::text)
 when x.account_control->'version'='4'::jsonb then attempt_value::text=x.account_control->>'retained_unknown_attempt_id' else false end
$$;
revoke all on function private.private_beta_retained_unknown(private.private_beta_programs,uuid)from public,anon,authenticated,service_role;

-- Modify the exact accepted native functions without replacing their unrelated
-- tenant, source, STOP, generation, admission, financial or historic-ID rules.
create function pg_temp.continuation_patch(target regprocedure,old_text text,new_text text)returns void language plpgsql as $$declare src text;begin
 src:=pg_get_functiondef(target);
 if position(old_text in src)=0 then raise exception 'CONTINUATION_PATCH_CONTRACT_MISSING: %',target;end if;
 execute replace(src,old_text,new_text);
end;$$;
select pg_temp.continuation_patch('private.private_beta_founder_only(private.private_beta_programs)','in(''3''::jsonb,''4''::jsonb)','in(''3''::jsonb,''4''::jsonb,''5''::jsonb)');
select pg_temp.continuation_patch('private.private_beta_founder_model_record(uuid,uuid,text)','and not private.private_beta_recovery_available(x))','and not private.private_beta_recovery_available(x) and not private.private_beta_continuation_available(x))');
select pg_temp.continuation_patch('private.private_beta_founder_canary_hash(private.private_beta_programs)','in(''3''::jsonb,''4''::jsonb)','in(''3''::jsonb,''4''::jsonb,''5''::jsonb)');
select pg_temp.continuation_patch('private.private_beta_founder_canary_hash(private.private_beta_programs)','(x.account_control->''version''<>''4''::jsonb or z.attempt_id::text is distinct from x.account_control->>''retained_unknown_attempt_id'')','not private.private_beta_retained_unknown(x,z.attempt_id)');
select pg_temp.continuation_patch('public.private_beta_account_control_v1(uuid,uuid)','(x.account_control->''version''<>''4''::jsonb or e.attempt_id::text is distinct from x.account_control->>''retained_unknown_attempt_id'')','not private.private_beta_retained_unknown(x,e.attempt_id)');
select pg_temp.continuation_patch('public.private_beta_reserve_v1(uuid,uuid,uuid,text,text,uuid,text,uuid)','(x.account_control->''version''<>''4''::jsonb or e.attempt_id::text is distinct from x.account_control->>''retained_unknown_attempt_id'')','not private.private_beta_retained_unknown(x,e.attempt_id)');
select pg_temp.continuation_patch('public.private_beta_reserve_v1(uuid,uuid,uuid,text,text,uuid,text,uuid)','case when x.account_control->''version''=''4''::jsonb then 1 else 0 end','case when x.account_control->''version''=''5''::jsonb then 2 when x.account_control->''version''=''4''::jsonb then 1 else 0 end');
select pg_temp.continuation_patch('public.admin_private_beta_canary_scope_v1(uuid,uuid)','if private.private_beta_recovery_available(p)then','if private.private_beta_recovery_available(p) or private.private_beta_continuation_available(p)then');
select pg_temp.continuation_patch('private.private_beta_connection_setup_allowed(private.private_beta_programs)','case when x.account_control->''version''=''4''::jsonb then 2 else 1 end','case when x.account_control->''version''=''5''::jsonb then 3 when x.account_control->''version''=''4''::jsonb then 2 else 1 end');
select pg_temp.continuation_patch('public.private_beta_record_v1(uuid,uuid,uuid,uuid,text)','x.account_control->''version''=''4''::jsonb','x.account_control->''version''in(''4''::jsonb,''5''::jsonb)');
select pg_temp.continuation_patch('public.admin_private_beta_workspace_v1(uuid,integer,jsonb)',
 '''canary_state'',case when private.private_beta_recovery_available(x)',
 '''canary_state'',case when private.private_beta_continuation_available(x) and x.founder_model_observation#>>''{observation,repository_sha}'' is distinct from x.configuration->>''repository_sha'' and (x.founder_model_observation#>>''{observation,expires_at}'')::timestamptz>clock_timestamp() then ''CONTINUATION_AVAILABLE'' when private.private_beta_recovery_available(x)');
select pg_temp.continuation_patch('private.private_beta_binding(private.private_beta_programs,boolean)','return v;',
 $new$if x.account_control->'version'='5'::jsonb then
 v:=v||jsonb_build_object('version',5,'maximum_input_tokens',4096,'maximum_requests',case when canary then 3 else 350 end,
 'maximum_attempt_liability',trim_scale(ceil((4096*(x.pricing_control->>'maximum_input_usd_per_million')::numeric+512*(x.pricing_control->>'maximum_output_usd_per_million')::numeric)*1000000000000)/1000000000000000000)::text,
 'retained_unknown_attempt_id',x.account_control->>'retained_unknown_attempt_id','retained_unknown_run_id',x.account_control->>'retained_unknown_run_id','recovery_authorization_hash',x.account_control->>'recovery_authorization_hash','recovery_authority',x.account_control->>'recovery_authority','recovery_execution_ref',x.account_control->>'recovery_execution_ref',
 'retained_unknown_attempts',x.account_control->'retained_unknown_attempts','continuation_authorization_hash',x.account_control->>'continuation_authorization_hash','continuation_authority','OWNER_FRESH_MFA','continuation_execution_ref','OWNER_RPC',
 'continuation_authenticated_at',x.account_control->>'continuation_authenticated_at','continuation_approved_at',x.account_control->>'continuation_approved_at','continuation_source_generation',x.account_control->>'continuation_source_generation');
 end if;return v;$new$);

-- The trigger independently recomputes the entire permitted replacement under
-- actual fresh MFA; a privileged UPDATE cannot forge or widen v5 authorization.
select pg_temp.continuation_patch('private.private_beta_program_immutable()',
 'if tg_op=''UPDATE'' and old.account_control->''version''=''3''::jsonb',
 $new$if tg_op='UPDATE' and old.account_control->'version'='4'::jsonb and new.account_control->'version'='5'::jsonb then
 perform private.private_beta_admin(old.tenant_id,true);auth_at:=private.private_beta_mfa_at();
 if auth.uid()=old.owner_user_id and new.canary_run_id<>old.canary_run_id and new.conversation_run_id<>old.conversation_run_id and new.canary_run_id<>new.conversation_run_id
 and not exists(select 1 from private.jeff_experiment_runs where id in(new.canary_run_id,new.conversation_run_id))
 and to_jsonb(new)=to_jsonb(old)||private.private_beta_continuation_projection(old,new.configuration->>'repository_sha',auth_at,new.approved_at)||jsonb_build_object('canary_run_id',new.canary_run_id,'conversation_run_id',new.conversation_run_id)
 then return new;end if;
 raise exception 'PRIVATE_BETA_CONTINUATION_INVALID'using errcode='42501';
 end if;
 if tg_op='UPDATE' and (new.account_control->'version'='5'::jsonb and old.account_control->'version' is distinct from '5'::jsonb
 or old.account_control->'version'='5'::jsonb and new.account_control is distinct from old.account_control)then raise exception 'PRIVATE_BETA_IMMUTABLE'using errcode='42501';end if;
 if tg_op='UPDATE' and old.account_control->'version'='3'::jsonb$new$);

-- v5 extends only the existing owner-only experiment protocol constraint.
do $$declare c text;begin
 select pg_get_constraintdef(oid)into strict c from pg_constraint where conrelid='private.jeff_experiment_runs'::regclass and conname='jeff_experiment_versioned_authority';
 execute 'alter table private.jeff_experiment_runs drop constraint jeff_experiment_versioned_authority';
 execute 'alter table private.jeff_experiment_runs add constraint jeff_experiment_versioned_authority '||left(c,length(c)-1)||' OR coalesce((binding->>''mode''=''PRIVATE_BETA_UAT'' and binding->''version''=''5''::jsonb and binding->>''scope''=''OWNER_ONLY'' and binding->>''financial_authority''=''NONE'' and binding->''commercial_sales''=''false''::jsonb and binding->>''provider''=''openai'' and binding->>''model''=''gpt-6.1-sol'' and binding->>''model_version''=''gpt-6.1-sol'' and binding->>''protocol_version''=''responses-v1'' and binding->>''currency''=''USD'' and (binding->>''maximum_spend'')::numeric<=5 and binding->>''effective_limit_kind''=''LOCAL_DURABLE_RESERVATION_CAP'' and binding->''maximum_input_tokens''=''4096''::jsonb and binding->''maximum_output_tokens''=''512''::jsonb and (binding->>''maximum_requests'')::int between 1 and 350 and binding->>''continuation_authority''=''OWNER_FRESH_MFA'' and binding->>''continuation_execution_ref''=''OWNER_RPC'' and binding->>''continuation_authorization_hash''~''^[a-f0-9]{64}$'' and jsonb_array_length(binding->''retained_unknown_attempts'')=2),false))';
end;$$;
drop function pg_temp.continuation_patch(regprocedure,text,text);
