-- One owner-MFA continuation for the observed sixth delayed/held native result.
-- Original UNKNOWN/HELD/DELAYED rows and liabilities are never rewritten.
create function private.private_beta_identity_repair_available(x private.private_beta_programs)returns boolean language sql stable set search_path=pg_catalog as $$
 select coalesce(private.private_beta_founder_only(x) and private.private_beta_openai(x)
 and x.stage='CANARY' and x.request_count=6 and x.account_control->'version'='5'::jsonb
 and jsonb_array_length(x.account_control->'retained_unknown_attempts')=4 and x.account_control?'retained_qa_held_attempt'
 and not(x.account_control?'retained_delayed_qa_held_attempt')
 and not exists(select 1 from private.private_beta_participants where program_id=x.id)
 and not exists(select 1 from private.private_beta_invites where program_id=x.id)
 and not exists(select 1 from private.private_beta_business_controls where program_id=x.id)
 and not exists(select 1 from private.jeff_experiment_runs where id=x.conversation_run_id)
 and(select count(*)from private.private_beta_attempt_scope where program_id=x.id)=6
 and not exists(select 1 from private.private_beta_attempt_scope s left join private.jeff_experiment_attempts a on a.id=s.attempt_id left join private.jeff_experiment_runs r on r.id=a.run_id
  where s.program_id=x.id and not coalesce(s.tenant_id=x.tenant_id and s.scope='CANARY' and s.global_ordinal between 1 and 6 and a.ordinal=1 and a.liability>0
  and r.tenant_id=x.tenant_id and r.request_count=1
  and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='DISPATCH_STARTED')
  and not exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='RECONCILIATION')
  and(case when s.global_ordinal=6 then r.id=x.canary_run_id and r.binding->'version'='5'::jsonb and r.stop_reason='UNKNOWN_REMOTE_COMPLETION'
   and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='DELAYED_RESULT' and e.payload->>'status'='SUCCEEDED' and e.payload->>'qa'='HELD'
    and e.payload->>'error_code'='JEFF_UAT_QA_UNSUPPORTED_CLAIM' and(e.payload->>'elapsed_ms')::numeric between 0 and 10000
    and e.created_at>s.deadline and e.created_at<=s.deadline+interval '2 seconds'
    and(e.payload->>'input_tokens')::int between 1 and 4096 and(e.payload->>'output_tokens')::int between 1 and 512
    and e.payload->>'response_hash'~'^[a-f0-9]{64}$' and e.payload->>'response_identity_hash'~'^[a-f0-9]{64}$' and e.payload->>'provider_usage_hash'~'^[a-f0-9]{64}$')
   and not exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage in('RESULT_UNKNOWN','PROVIDER_RESULT'))
  when s.global_ordinal=5 then r.stop_reason='PROVIDER_OR_QA_HOLD'
   and a.id::text=x.account_control#>>'{retained_qa_held_attempt,attempt_id}' and a.run_id::text=x.account_control#>>'{retained_qa_held_attempt,run_id}'
   and a.liability=(x.account_control#>>'{retained_qa_held_attempt,liability}')::numeric
   and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='PROVIDER_RESULT' and e.payload->>'status'='SUCCEEDED' and e.payload->>'qa'='HELD' and e.payload->>'response_hash'=x.account_control#>>'{retained_qa_held_attempt,response_hash}')
   and not exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage in('RESULT_UNKNOWN','DELAYED_RESULT'))
  else r.stop_reason='UNKNOWN_REMOTE_COMPLETION'
   and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='RESULT_UNKNOWN' and e.payload->>'status'='UNKNOWN' and e.payload->>'qa'='NOT_EVALUATED')
   and not exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage in('PROVIDER_RESULT','DELAYED_RESULT'))
   and exists(select 1 from jsonb_array_elements(x.account_control->'retained_unknown_attempts') old where old->>'attempt_id'=a.id::text and old->>'run_id'=a.run_id::text and(old->>'liability')::numeric=a.liability)
  end),false)),false)
$$;
revoke all on function private.private_beta_identity_repair_available(private.private_beta_programs)from public,anon,authenticated,service_role;
-- Storage-only grace, limited to the newly owner-authorized repaired CANARY.
-- The HTTPS model timeout remains10s. No customer result, STOP, expired window,
-- over-limit usage, unknown response or previously held run gains this grace.
create function private.private_beta_canary_record_grace(x private.private_beta_programs,s private.private_beta_attempt_scope,r private.jeff_experiment_runs,p jsonb)returns boolean language sql volatile set search_path=pg_catalog as $$
 select coalesce(x.stage='CANARY' and x.request_count=7 and x.account_control->'version'='5'::jsonb and private.private_beta_founder_only(x) and private.private_beta_openai(x)
 and x.account_control?'retained_delayed_qa_held_attempt' and private.private_beta_live_window(x)
 and s.program_id=x.id and s.tenant_id=x.tenant_id and s.scope='CANARY' and s.source_message_id is null and s.participant_id is null and s.participant_ordinal=0 and s.global_ordinal=7 and s.generation=x.generation
 and r.id=x.canary_run_id and r.request_count=1 and exists(select 1 from private.jeff_experiment_attempts a where a.id=s.attempt_id and a.run_id=r.id) and r.tenant_id=x.tenant_id and r.stop_reason is null
 and r.binding->>'repository_sha'=x.configuration->>'repository_sha' and r.binding->'timeout_ms'='10000'::jsonb
 and p->>'stage'='PROVIDER_RESULT' and p->>'status'='SUCCEEDED' and p->>'qa'in('APPROVED','HELD')
 and(p->>'elapsed_ms')::numeric between 0 and 10000 and(p->>'input_tokens')::int between 1 and 4096 and(p->>'output_tokens')::int between 1 and 512
 and p->>'response_hash'~'^[a-f0-9]{64}$' and p->>'response_identity_hash'~'^[a-f0-9]{64}$' and p->>'provider_usage_hash'~'^[a-f0-9]{64}$'
 and clock_timestamp()<=s.deadline+interval '2 seconds',false)
$$;
revoke all on function private.private_beta_canary_record_grace(private.private_beta_programs,private.private_beta_attempt_scope,private.jeff_experiment_runs,jsonb)from public,anon,authenticated,service_role;
create function pg_temp.identity_repair_patch(target regprocedure,old_text text,new_text text)returns void language plpgsql as $$declare src text;begin
 src:=pg_get_functiondef(target);if position(old_text in src)=0 then raise exception 'IDENTITY_REPAIR_PATCH_CONTRACT_MISSING: %',target;end if;execute replace(src,old_text,new_text);end;$$;
select pg_temp.identity_repair_patch('private.private_beta_continuation_available(private.private_beta_programs)',
 'select coalesce(private.private_beta_qa_repair_available(x),false)',
 'select coalesce(private.private_beta_identity_repair_available(x),false) or coalesce(private.private_beta_qa_repair_available(x),false)');
select pg_temp.identity_repair_patch('private.private_beta_continuation_projection(private.private_beta_programs,text,timestamptz,timestamptz)',
 'not private.private_beta_qa_repair_available(x)or s.global_ordinal<5',
 'not(private.private_beta_qa_repair_available(x)or private.private_beta_identity_repair_available(x))or s.global_ordinal<5');
select pg_temp.identity_repair_patch('private.private_beta_continuation_projection(private.private_beta_programs,text,timestamptz,timestamptz)',
 'return jsonb_build_object(''configuration'',cfg',
 $patch$if private.private_beta_identity_repair_available(x)then
 select jsonb_build_object('attempt_id',a.id,'run_id',a.run_id,'liability',trim_scale(a.liability)::text,'stage','DELAYED_RESULT','status','SUCCEEDED','qa','HELD','response_hash',e.payload->>'response_hash')into strict o
 from private.private_beta_attempt_scope s join private.jeff_experiment_attempts a on a.id=s.attempt_id join private.jeff_experiment_evidence e on e.attempt_id=a.id and e.stage='DELAYED_RESULT'
 where s.program_id=x.id and s.tenant_id=x.tenant_id and s.global_ordinal=6;
 ctl:=ctl||jsonb_build_object('retained_delayed_qa_held_attempt',o,'continuation_authorization_hash',private.fse_hash((ctl->>'continuation_authorization_hash')||':DELAYED_QA_HELD:'||private.fse_canonical(o)));
 end if;
 return jsonb_build_object('configuration',cfg$patch$);
select pg_temp.identity_repair_patch('private.private_beta_continuation_offset(private.private_beta_programs)',
 'then 1 else 0 end', 'then 1 else 0 end+case when x.account_control?''retained_delayed_qa_held_attempt''then 1 else 0 end');
select pg_temp.identity_repair_patch('private.private_beta_binding(private.private_beta_programs,boolean)',
 'end if;return v;', 'end if;if x.account_control?''retained_delayed_qa_held_attempt''then v:=v||jsonb_build_object(''retained_delayed_qa_held_attempt'',x.account_control->''retained_delayed_qa_held_attempt'');end if;return v;');
select pg_temp.identity_repair_patch('public.private_beta_account_control_v1(uuid,uuid)',
 'return jsonb_build_object(''payload'',v', 'if x.account_control?''retained_delayed_qa_held_attempt''then v:=v||jsonb_build_object(''retained_delayed_qa_held_attempt'',x.account_control->''retained_delayed_qa_held_attempt'');end if;return jsonb_build_object(''payload'',v');
select pg_temp.identity_repair_patch('public.private_beta_record_external_v2(uuid,uuid,uuid,uuid,text)',
 's.deadline<clock_timestamp()and stage_value=''PROVIDER_RESULT''',
 's.deadline<clock_timestamp()and stage_value=''PROVIDER_RESULT''and not private.private_beta_canary_record_grace(x,s,r,p)');
select pg_temp.identity_repair_patch('public.private_beta_record_external_v2(uuid,uuid,uuid,uuid,text)',
 'perform private.private_beta_append(r,a,stage_value,p,private.fse_hash(dispatch_nonce_value::text),s.deadline);',
 $audit$if stage_value='PROVIDER_RESULT' and s.deadline<clock_timestamp()then
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(x.tenant_id,'SYSTEM','private_beta.canary_record_grace','jeff_experiment_attempts',a.id::text,
 jsonb_build_object('deadline',s.deadline,'recorded_at',clock_timestamp(),'provider_elapsed_ms',p->>'elapsed_ms','maximum_journal_grace_ms',2000,'provider_timeout_ms',10000,'financial_authority','NONE'));
 end if;
 perform private.private_beta_append(r,a,stage_value,p,private.fse_hash(dispatch_nonce_value::text),s.deadline);$audit$);
alter table private.jeff_experiment_runs add constraint jeff_experiment_retained_delayed_qa check(not(binding?'retained_delayed_qa_held_attempt')or coalesce(
 binding->'version'='5'::jsonb and binding->>'scope'='OWNER_ONLY' and binding?'retained_qa_held_attempt' and jsonb_array_length(binding->'retained_unknown_attempts')=4
 and binding#>>'{retained_delayed_qa_held_attempt,stage}'='DELAYED_RESULT' and binding#>>'{retained_delayed_qa_held_attempt,status}'='SUCCEEDED' and binding#>>'{retained_delayed_qa_held_attempt,qa}'='HELD'
 and(binding#>>'{retained_delayed_qa_held_attempt,liability}')::numeric>0 and binding#>>'{retained_delayed_qa_held_attempt,response_hash}'~'^[a-f0-9]{64}$',false));
drop function pg_temp.identity_repair_patch(regprocedure,text,text);
