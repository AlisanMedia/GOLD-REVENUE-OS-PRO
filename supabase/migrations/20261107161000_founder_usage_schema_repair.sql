-- Repair only the observed third-attempt usage-envelope failure after the codec
-- fix. Reuse the existing owner RPC/runtime; no automatic request or debt waiver.
create function private.private_beta_usage_repair_available(x private.private_beta_programs) returns boolean language sql stable set search_path=pg_catalog as $$
 select coalesce(private.private_beta_founder_only(x) and private.private_beta_openai(x)
 and x.account_control->'version'='5'::jsonb and x.stage='CANARY' and x.request_count=3
 and jsonb_array_length(x.account_control->'retained_unknown_attempts')=2
 and not exists(select 1 from private.private_beta_participants where program_id=x.id)
 and not exists(select 1 from private.private_beta_invites where program_id=x.id)
 and not exists(select 1 from private.private_beta_business_controls where program_id=x.id)
 and not exists(select 1 from private.jeff_experiment_runs where id=x.conversation_run_id)
 and (select count(*)from private.private_beta_attempt_scope where program_id=x.id)=3
 and exists(select 1 from private.private_beta_attempt_scope s join private.jeff_experiment_attempts a on a.id=s.attempt_id join private.jeff_experiment_runs r on r.id=a.run_id
  where s.program_id=x.id and s.tenant_id=x.tenant_id and s.global_ordinal=3 and s.scope='CANARY' and r.id=x.canary_run_id and r.binding->'version'='5'::jsonb
  and r.stop_reason='UNKNOWN_REMOTE_COMPLETION' and a.ordinal=1 and a.liability>0
  and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='RESULT_UNKNOWN' and e.payload->>'status'='UNKNOWN' and e.payload->>'qa'='NOT_EVALUATED' and e.payload->>'error_code'='OPENAI_UAT_ENVELOPE_INVALID_USAGE'))
 and not exists(select 1 from private.private_beta_attempt_scope s left join private.jeff_experiment_attempts a on a.id=s.attempt_id left join private.jeff_experiment_runs r on r.id=a.run_id
  where s.program_id=x.id and not coalesce(s.tenant_id=x.tenant_id and s.scope='CANARY' and s.global_ordinal between 1 and 3 and a.ordinal=1 and a.liability>0
   and r.tenant_id=x.tenant_id and r.stop_reason='UNKNOWN_REMOTE_COMPLETION' and r.request_count=1
   and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='DISPATCH_STARTED')
   and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='RESULT_UNKNOWN' and e.payload->>'status'='UNKNOWN' and e.payload->>'qa'='NOT_EVALUATED')
   and not exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage in('PROVIDER_RESULT','DELAYED_RESULT','RECONCILIATION'))
   and (s.global_ordinal=3 or exists(select 1 from jsonb_array_elements(x.account_control->'retained_unknown_attempts') old
    where old->>'attempt_id'=a.id::text and old->>'run_id'=a.run_id::text and (old->>'liability')::numeric=a.liability)),false)),false)
$$;
revoke all on function private.private_beta_usage_repair_available(private.private_beta_programs) from public,anon,authenticated,service_role;

-- Exact-definition patches fail closed if the accepted predecessor has drifted.
create function pg_temp.usage_repair_patch(target regprocedure,old_text text,new_text text) returns void language plpgsql as $$declare src text;begin
 src:=pg_get_functiondef(target);
 if position(old_text in src)=0 then raise exception 'USAGE_REPAIR_PATCH_CONTRACT_MISSING: %',target;end if;
 execute replace(src,old_text,new_text);
end;$$;
select pg_temp.usage_repair_patch('private.private_beta_continuation_available(private.private_beta_programs)',
 'select coalesce(', 'select coalesce(private.private_beta_usage_repair_available(x),false) or coalesce(');
-- The same projection preserves every historical attempt/liability and derives
-- the new grant from actual fresh owner MFA and a different published SHA.
select pg_temp.usage_repair_patch('private.private_beta_program_immutable()',
 'old.account_control->''version''=''4''::jsonb and new.account_control->''version''=''5''::jsonb',
 'old.account_control->''version''in(''4''::jsonb,''5''::jsonb) and new.account_control->''version''=''5''::jsonb');
select pg_temp.usage_repair_patch('private.private_beta_binding(private.private_beta_programs,boolean)',
 'case when canary then 3 else 350 end', 'case when canary then jsonb_array_length(x.account_control->''retained_unknown_attempts'')+1 else 350 end');
select pg_temp.usage_repair_patch('public.private_beta_reserve_v1(uuid,uuid,uuid,text,text,uuid,text,uuid)',
 'case when x.account_control->''version''=''5''::jsonb then 2 when',
 'case when x.account_control->''version''=''5''::jsonb then jsonb_array_length(x.account_control->''retained_unknown_attempts'') when');
select pg_temp.usage_repair_patch('private.private_beta_connection_setup_allowed(private.private_beta_programs)',
 'case when x.account_control->''version''=''5''::jsonb then 3 when',
 'case when x.account_control->''version''=''5''::jsonb then jsonb_array_length(x.account_control->''retained_unknown_attempts'')+1 when');

-- Extend only the existing v5 branch to retain the third UNKNOWN. All prior
-- version, budget, scope, provider, output and owner-MFA constraints remain.
do $$declare c text;old_text text:='jsonb_array_length((binding -> ''retained_unknown_attempts''::text)) = 2';begin
 select pg_get_constraintdef(oid)into strict c from pg_constraint where conrelid='private.jeff_experiment_runs'::regclass and conname='jeff_experiment_versioned_authority';
 if position(old_text in c)=0 then raise exception 'USAGE_REPAIR_CONSTRAINT_CONTRACT_MISSING';end if;
 execute 'alter table private.jeff_experiment_runs drop constraint jeff_experiment_versioned_authority';
 execute 'alter table private.jeff_experiment_runs add constraint jeff_experiment_versioned_authority '||replace(c,old_text,'jsonb_array_length((binding -> ''retained_unknown_attempts''::text)) between 2 and 3');
end;$$;
drop function pg_temp.usage_repair_patch(regprocedure,text,text);
