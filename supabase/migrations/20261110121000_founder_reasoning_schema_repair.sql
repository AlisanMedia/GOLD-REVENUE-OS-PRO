-- One reviewed continuation for the observed fourth-attempt reasoning-envelope
-- failure. No data reset, owner impersonation, inference or Telegram activation.
create function private.private_beta_reasoning_repair_available(x private.private_beta_programs) returns boolean language sql stable set search_path=pg_catalog as $$
 select coalesce(private.private_beta_founder_only(x) and private.private_beta_openai(x)
 and x.account_control->'version'='5'::jsonb and x.stage='CANARY' and x.request_count=4
 and jsonb_array_length(x.account_control->'retained_unknown_attempts')=3
 and not exists(select 1 from private.private_beta_participants where program_id=x.id)
 and not exists(select 1 from private.private_beta_invites where program_id=x.id)
 and not exists(select 1 from private.private_beta_business_controls where program_id=x.id)
 and not exists(select 1 from private.jeff_experiment_runs where id=x.conversation_run_id)
 and (select count(*)from private.private_beta_attempt_scope where program_id=x.id)=4
 and exists(select 1 from private.private_beta_attempt_scope s join private.jeff_experiment_attempts a on a.id=s.attempt_id join private.jeff_experiment_runs r on r.id=a.run_id
  where s.program_id=x.id and s.tenant_id=x.tenant_id and s.global_ordinal=4 and s.scope='CANARY' and r.id=x.canary_run_id and r.binding->'version'='5'::jsonb
  and r.stop_reason='UNKNOWN_REMOTE_COMPLETION' and a.ordinal=1 and a.liability>0
  and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='RESULT_UNKNOWN' and e.payload->>'status'='UNKNOWN' and e.payload->>'qa'='NOT_EVALUATED' and e.payload->>'error_code'='OPENAI_UAT_ENVELOPE_INVALID_REASONING'))
 and not exists(select 1 from private.private_beta_attempt_scope s left join private.jeff_experiment_attempts a on a.id=s.attempt_id left join private.jeff_experiment_runs r on r.id=a.run_id
  where s.program_id=x.id and not coalesce(s.tenant_id=x.tenant_id and s.scope='CANARY' and s.global_ordinal between 1 and 4 and a.ordinal=1 and a.liability>0
   and r.tenant_id=x.tenant_id and r.stop_reason='UNKNOWN_REMOTE_COMPLETION' and r.request_count=1
   and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='DISPATCH_STARTED')
   and exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage='RESULT_UNKNOWN' and e.payload->>'status'='UNKNOWN' and e.payload->>'qa'='NOT_EVALUATED')
   and not exists(select 1 from private.jeff_experiment_evidence e where e.attempt_id=a.id and e.stage in('PROVIDER_RESULT','DELAYED_RESULT','RECONCILIATION'))
   and (s.global_ordinal=4 or exists(select 1 from jsonb_array_elements(x.account_control->'retained_unknown_attempts') old
    where old->>'attempt_id'=a.id::text and old->>'run_id'=a.run_id::text and (old->>'liability')::numeric=a.liability)),false)),false)
$$;
revoke all on function private.private_beta_reasoning_repair_available(private.private_beta_programs) from public,anon,authenticated,service_role;

create function pg_temp.reasoning_repair_patch(target regprocedure,old_text text,new_text text)returns void language plpgsql as $$declare src text;begin
 src:=pg_get_functiondef(target);
 if position(old_text in src)=0 then raise exception 'REASONING_REPAIR_PATCH_CONTRACT_MISSING: %',target;end if;
 execute replace(src,old_text,new_text);
end;$$;
select pg_temp.reasoning_repair_patch('private.private_beta_continuation_available(private.private_beta_programs)',
 'select coalesce(private.private_beta_stopped_rearm_available(x),false)',
 'select coalesce(private.private_beta_reasoning_repair_available(x),false) or coalesce(private.private_beta_stopped_rearm_available(x),false)');

-- The accepted v5 projection/trigger requires a different published SHA,
-- current protected metadata and genuine fresh owner MFA. Existing dynamic
-- ordinal/budget checks now retain all four UNKNOWNs and admit only ordinal5.
-- STOP rearm remains limited to the earlier three-attempt setup; do not extend it.
do $$declare c text;old_text text:='jsonb_array_length((binding -> ''retained_unknown_attempts''::text)) <= 3';begin
 select pg_get_constraintdef(oid)into strict c from pg_constraint where conrelid='private.jeff_experiment_runs'::regclass and conname='jeff_experiment_versioned_authority';
 if position(old_text in c)=0 then raise exception 'REASONING_REPAIR_CONSTRAINT_CONTRACT_MISSING';end if;
 execute 'alter table private.jeff_experiment_runs drop constraint jeff_experiment_versioned_authority';
 execute 'alter table private.jeff_experiment_runs add constraint jeff_experiment_versioned_authority '||replace(c,old_text,'jsonb_array_length((binding -> ''retained_unknown_attempts''::text)) <= 4');
end;$$;
drop function pg_temp.reasoning_repair_patch(regprocedure,text,text);
