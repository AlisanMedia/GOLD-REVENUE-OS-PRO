-- One explicit fresh-owner rearm only for the stopped, never-connected personal
-- setup whose three UNKNOWN attempts already qualify for the usage-codec repair.
-- STOP remains effective until this separate owner action; no automatic resume.
create function private.private_beta_stopped_rearm_available(x private.private_beta_programs) returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare candidate private.private_beta_programs;begin
 if x.stage is distinct from 'STOPPED' then return false;end if;
 candidate:=x;candidate.stage:='CANARY';
 return private.private_beta_usage_repair_available(candidate) and exists(
  select 1 from public.audit_logs a where a.tenant_id=x.tenant_id and a.entity_type='private_beta_programs' and a.entity_id=x.id::text
  and a.action='private_beta.program_transition' and a.actor_type='HUMAN' and a.actor_id=x.owner_user_id
  and a.after_data->>'stage'='STOPPED' and a.after_data->>'generation'=x.generation::text);
end;$$;
revoke all on function private.private_beta_stopped_rearm_available(private.private_beta_programs)from public,anon,authenticated,service_role;

create function pg_temp.stopped_rearm_patch(target regprocedure,old_text text,new_text text)returns void language plpgsql as $$declare src text;begin
 src:=pg_get_functiondef(target);
 if position(old_text in src)=0 then raise exception 'STOPPED_REARM_PATCH_CONTRACT_MISSING: %',target;end if;
 execute replace(src,old_text,new_text);
end;$$;
select pg_temp.stopped_rearm_patch('private.private_beta_continuation_available(private.private_beta_programs)',
 'select coalesce(private.private_beta_usage_repair_available(x),false)',
 'select coalesce(private.private_beta_stopped_rearm_available(x),false) or coalesce(private.private_beta_usage_repair_available(x),false)');
select pg_temp.stopped_rearm_patch('public.admin_private_beta_continue_founder_test_v1(uuid,uuid,bigint,text)',
 'if x.owner_user_id is distinct from auth.uid()',
 'if x.stage=''STOPPED'' or x.owner_user_id is distinct from auth.uid()');

-- The immutable trigger independently reconstructs the entire permitted row
-- from the actual fresh MFA, recorded owner STOP and unchanged journal/budget.
-- Every other STOPPED transition still reaches the existing terminal guard.
select pg_temp.stopped_rearm_patch('private.private_beta_program_immutable()',
 'if tg_op=''UPDATE'' and old.account_control->''version''in(''4''::jsonb,''5''::jsonb)',
 $patch$if tg_op='UPDATE' and old.stage='STOPPED' and new.stage='STOPPED' and new.account_control is distinct from old.account_control then
 raise exception 'PRIVATE_BETA_STOPPED_REARM_INVALID'using errcode='42501';
 end if;
 if tg_op='UPDATE' and old.stage='STOPPED' and new.stage<>'STOPPED' then
 perform private.private_beta_admin(old.tenant_id,true);auth_at:=private.private_beta_mfa_at();
 if new.stage='CANARY' and auth.uid()=old.owner_user_id and private.private_beta_stopped_rearm_available(old)
 and new.canary_run_id<>old.canary_run_id and new.conversation_run_id<>old.conversation_run_id and new.canary_run_id<>new.conversation_run_id
 and not exists(select 1 from private.jeff_experiment_runs where id in(new.canary_run_id,new.conversation_run_id))
 and to_jsonb(new)=to_jsonb(old)||private.private_beta_continuation_projection(old,new.configuration->>'repository_sha',auth_at,new.approved_at)||jsonb_build_object('stage','CANARY','canary_run_id',new.canary_run_id,'conversation_run_id',new.conversation_run_id)
 then return new;end if;
 raise exception 'PRIVATE_BETA_STOPPED_REARM_INVALID'using errcode='42501';
 end if;
 if tg_op='UPDATE' and old.account_control->'version'in('4'::jsonb,'5'::jsonb)$patch$);

create function public.admin_private_beta_rearm_founder_test_v1(target_tenant_id uuid,program_id_value uuid,expected_generation_value bigint,repository_sha_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x private.private_beta_programs;v jsonb;b jsonb;prior jsonb;auth_at timestamptz;approved_value timestamptz:=clock_timestamp();new_run uuid:=extensions.gen_random_uuid();conversation_run uuid:=extensions.gen_random_uuid();begin
 perform private.private_beta_admin(target_tenant_id,true);auth_at:=private.private_beta_mfa_at();x:=private.private_beta_guard(target_tenant_id,program_id_value);
 select * into x from private.private_beta_programs where id=x.id for update;
 if x.owner_user_id is distinct from auth.uid()or x.generation is distinct from expected_generation_value or not private.private_beta_stopped_rearm_available(x)
 then raise exception 'PRIVATE_BETA_STOPPED_REARM_UNAVAILABLE'using errcode='42501';end if;
 prior:=jsonb_build_object('stage',x.stage,'generation',x.generation,'configuration',x.configuration);
 v:=private.private_beta_continuation_projection(x,repository_sha_value,auth_at,approved_value);
 update private.private_beta_programs set stage='CANARY',configuration=v->'configuration',manifest_hash=v->>'manifest_hash',account_control=v->'account_control',pricing_control=v->'pricing_control',generation=generation+1,
 canary_run_id=new_run,conversation_run_id=conversation_run,approved_at=approved_value,authenticated_at=auth_at where id=x.id returning * into x;
 b:=private.private_beta_binding(x,true);
 insert into private.jeff_experiment_runs(id,tenant_id,account_scope_hash,authorization_record_hash,binding,binding_hash)values(new_run,x.tenant_id,x.account_control->>'account_scope_hash',private.fse_hash(x.authorization_record_hash||':CANARY:STOPPED_REARM:'||(x.account_control->>'continuation_authorization_hash')),b,private.fse_hash(private.fse_canonical(b)));
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,before_data,after_data)values(x.tenant_id,'HUMAN',auth.uid(),'private_beta.owner_stopped_rearm','private_beta_programs',x.id::text,prior,
 jsonb_build_object('stage','CANARY','generation',x.generation,'authority','OWNER_FRESH_MFA','actual_authenticated_at',auth_at,'actual_approved_at',approved_value,'retained_unknown_attempts',x.account_control->'retained_unknown_attempts','new_run_id',new_run,'repository_sha',repository_sha_value,'maximum_additional_canary',1,'financial_authority','NONE'));
 return jsonb_build_object('program_id',x.id,'stage','CANARY','generation',x.generation::text);
end;$$;
revoke all on function public.admin_private_beta_rearm_founder_test_v1(uuid,uuid,bigint,text)from public,anon,authenticated,service_role;
grant execute on function public.admin_private_beta_rearm_founder_test_v1(uuid,uuid,bigint,text)to authenticated;
drop function pg_temp.stopped_rearm_patch(regprocedure,text,text);

-- Clarify only the two colliding current test-workspace labels. No tenant,
-- program, conversation, audit or customer is removed or moved.
do $$declare t record;label text;begin
 for t in select n.id,n.name,exists(select 1 from private.private_beta_programs p where p.tenant_id=n.id)has_program
  from public.tenants n where n.slug like 'private-beta-%' and n.name='Jeff VIP Private Beta' loop
  label:=case when t.has_program then 'Jeff VIP Private Beta — Kişisel test' else 'Jeff VIP Private Beta — Eski boş kurulum' end;
  update public.tenants set name=label where id=t.id;
  insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,before_data,after_data)values(t.id,'SYSTEM','private_beta.workspace_label_clarified','tenants',t.id::text,jsonb_build_object('name',t.name),jsonb_build_object('name',label));
 end loop;
end;$$;
