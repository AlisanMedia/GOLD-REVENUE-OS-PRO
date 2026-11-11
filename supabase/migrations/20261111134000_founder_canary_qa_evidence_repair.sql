-- Preserve the four UNKNOWNs and the distinct fifth SUCCEEDED/HELD response.
-- One explicit fresh-owner continuation after the diagnostic/prompt repair;
-- never approve, overwrite or relabel the old result and never dispatch here.
create function private.private_beta_qa_repair_available(x private.private_beta_programs)returns boolean language sql stable set search_path=pg_catalog as $$
 select coalesce(private.private_beta_founder_only(x) and private.private_beta_openai(x)
 and x.stage='CANARY' and x.request_count=5 and x.account_control->'version'='5'::jsonb
 and jsonb_array_length(x.account_control->'retained_unknown_attempts')=4 and not(x.account_control?'retained_qa_held_attempt')
 and not exists(select 1 from private.private_beta_participants where program_id=x.id)
 and not exists(select 1 from private.private_beta_invites where program_id=x.id)
 and not exists(select 1 from private.private_beta_business_controls where program_id=x.id)
 and not exists(select 1 from private.jeff_experiment_runs where id=x.conversation_run_id)
 and(select count(*)from private.private_beta_attempt_scope where program_id=x.id)=5
 and not exists(select 1 from private.private_beta_attempt_scope s left join private.jeff_experiment_attempts a on a.id=s.attempt_id left join private.jeff_experiment_runs r on r.id=a.run_id
  where s.program_id=x.id and not coalesce(s.tenant_id=x.tenant_id and s.scope='CANARY' and s.global_ordinal between 1 and 5 and a.ordinal=1 and a.liability>0
  and r.tenant_id=x.tenant_id and r.request_count=1 and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='DISPATCH_STARTED')
  and not exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage in('DELAYED_RESULT','RECONCILIATION'))
  and(case when s.global_ordinal=5 then r.id=x.canary_run_id and r.binding->'version'='5'::jsonb and r.stop_reason='PROVIDER_OR_QA_HOLD'
   and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='PROVIDER_RESULT' and e.payload->>'status'='SUCCEEDED' and e.payload->>'qa'='HELD'
    and e.payload->'error_code'='null'::jsonb and(e.payload->>'input_tokens')::int between 1 and 4096 and(e.payload->>'output_tokens')::int between 1 and 512
    and e.payload->>'response_hash'~'^[a-f0-9]{64}$' and e.payload->>'response_identity_hash'~'^[a-f0-9]{64}$' and e.payload->>'provider_usage_hash'~'^[a-f0-9]{64}$')
   and not exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='RESULT_UNKNOWN')
  else r.stop_reason='UNKNOWN_REMOTE_COMPLETION'
   and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='RESULT_UNKNOWN' and e.payload->>'status'='UNKNOWN' and e.payload->>'qa'='NOT_EVALUATED')
   and not exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='PROVIDER_RESULT')
   and exists(select 1 from jsonb_array_elements(x.account_control->'retained_unknown_attempts') old where old->>'attempt_id'=a.id::text and old->>'run_id'=a.run_id::text and(old->>'liability')::numeric=a.liability)
  end),false)),false)
$$;
revoke all on function private.private_beta_qa_repair_available(private.private_beta_programs)from public,anon,authenticated,service_role;
create function private.private_beta_continuation_offset(x private.private_beta_programs)returns integer language sql immutable set search_path=pg_catalog as $$
 select jsonb_array_length(x.account_control->'retained_unknown_attempts')+case when x.account_control?'retained_qa_held_attempt'then 1 else 0 end
$$;
revoke all on function private.private_beta_continuation_offset(private.private_beta_programs)from public,anon,authenticated,service_role;
create function pg_temp.qa_repair_patch(target regprocedure,old_text text,new_text text)returns void language plpgsql as $$declare src text;begin
 src:=pg_get_functiondef(target);if position(old_text in src)=0 then raise exception 'QA_REPAIR_PATCH_CONTRACT_MISSING: %',target;end if;execute replace(src,old_text,new_text);end;$$;
select pg_temp.qa_repair_patch('private.private_beta_continuation_available(private.private_beta_programs)',
 'select coalesce(private.private_beta_reasoning_repair_available(x),false)',
 'select coalesce(private.private_beta_qa_repair_available(x),false) or coalesce(private.private_beta_reasoning_repair_available(x),false)');
select pg_temp.qa_repair_patch('private.private_beta_continuation_projection(private.private_beta_programs,text,timestamptz,timestamptz)',
 'where s.program_id=x.id and s.tenant_id=x.tenant_id;',
 'where s.program_id=x.id and s.tenant_id=x.tenant_id and(not private.private_beta_qa_repair_available(x)or s.global_ordinal<5);');
select pg_temp.qa_repair_patch('private.private_beta_continuation_projection(private.private_beta_programs,text,timestamptz,timestamptz)',
 'return jsonb_build_object(''configuration'',cfg',
 $patch$if private.private_beta_qa_repair_available(x)then
  select jsonb_build_object('attempt_id',a.id,'run_id',a.run_id,'liability',trim_scale(a.liability)::text,'status','SUCCEEDED','qa','HELD','response_hash',e.payload->>'response_hash')into strict o
  from private.private_beta_attempt_scope s join private.jeff_experiment_attempts a on a.id=s.attempt_id join private.jeff_experiment_evidence e on e.attempt_id=a.id and e.stage='PROVIDER_RESULT'
  where s.program_id=x.id and s.tenant_id=x.tenant_id and s.global_ordinal=5;
  ctl:=ctl||jsonb_build_object('retained_qa_held_attempt',o,'continuation_authorization_hash',private.fse_hash(ch||':QA_HELD:'||private.fse_canonical(o)));
 end if;
 return jsonb_build_object('configuration',cfg$patch$);
select pg_temp.qa_repair_patch('private.private_beta_binding(private.private_beta_programs,boolean)',
 'jsonb_array_length(x.account_control->''retained_unknown_attempts'')+1','private.private_beta_continuation_offset(x)+1');
select pg_temp.qa_repair_patch('private.private_beta_binding(private.private_beta_programs,boolean)',
 'end if;return v;',
 'end if;if x.account_control?''retained_qa_held_attempt''then v:=v||jsonb_build_object(''retained_qa_held_attempt'',x.account_control->''retained_qa_held_attempt'');end if;return v;');
select pg_temp.qa_repair_patch('public.private_beta_reserve_v1(uuid,uuid,uuid,text,text,uuid,text,uuid)',
 'then jsonb_array_length(x.account_control->''retained_unknown_attempts'')','then private.private_beta_continuation_offset(x)');
select pg_temp.qa_repair_patch('private.private_beta_connection_setup_allowed(private.private_beta_programs)',
 'jsonb_array_length(x.account_control->''retained_unknown_attempts'')+1','private.private_beta_continuation_offset(x)+1');
-- Read-only account evidence must include the same separately typed retained hold.
select pg_temp.qa_repair_patch('public.private_beta_account_control_v1(uuid,uuid)',
 'return jsonb_build_object(''payload'',v',
 'if x.account_control?''retained_qa_held_attempt''then v:=v||jsonb_build_object(''retained_qa_held_attempt'',x.account_control->''retained_qa_held_attempt'');end if;return jsonb_build_object(''payload'',v');
alter table private.jeff_experiment_runs add constraint jeff_experiment_retained_qa_held check(not(binding?'retained_qa_held_attempt')or coalesce(
 binding->'version'='5'::jsonb and binding->>'scope'='OWNER_ONLY' and jsonb_array_length(binding->'retained_unknown_attempts')=4
 and binding#>>'{retained_qa_held_attempt,status}'='SUCCEEDED' and binding#>>'{retained_qa_held_attempt,qa}'='HELD'
 and(binding#>>'{retained_qa_held_attempt,liability}')::numeric>0 and binding#>>'{retained_qa_held_attempt,response_hash}'~'^[a-f0-9]{64}$',false));
drop function pg_temp.qa_repair_patch(regprocedure,text,text);
