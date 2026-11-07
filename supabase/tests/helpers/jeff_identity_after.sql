-- Disposable pre/post-migration assertions, never live authority.
do $$declare r record;c record;new_rpc record;old_rpc record;begin
 if(select request_count<>2 or reserved_liability<>4.6549184 from private.private_beta_programs limit 1)then raise exception 'IDENTITY_BUDGET_RESET';end if;
 if exists((select to_jsonb(p)from private.private_beta_programs p)except(select row_value from private.identity_program_before_test))then raise exception 'IDENTITY_PROGRAM_CHANGED';end if;
 if exists((select to_jsonb(p)from private.jeff_experiment_runs p)except(select row_value from private.identity_runs_before_test))then raise exception 'IDENTITY_RUNS_CHANGED';end if;
 if exists((select to_jsonb(p)from private.jeff_experiment_attempts p)except(select row_value from private.identity_attempts_before_test))then raise exception 'IDENTITY_ATTEMPTS_CHANGED';end if;
 if exists((select to_jsonb(p)from private.jeff_experiment_evidence p)except(select row_value from private.identity_evidence_before_test))then raise exception 'IDENTITY_EVIDENCE_CHANGED';end if;
 for r in select *from private.identity_before_test loop
  select *into c from pg_class where oid=r.object_id;
  if c.oid is null or c.relname<>replace(r.relname,'polat','jeff')or c.relowner<>r.relowner or c.relacl is distinct from r.relacl or c.relrowsecurity<>r.relrowsecurity or c.relforcerowsecurity<>r.relforcerowsecurity then raise exception 'IDENTITY_CATALOG_CHANGED';end if;
 end loop;
 for r in select *from private.identity_rpc_before_test loop
  select *into new_rpc from pg_proc where pronamespace='public'::regnamespace and proname=replace(r.proname,'polat','jeff')and proargtypes=r.proargtypes;
  select *into old_rpc from pg_proc where pronamespace='public'::regnamespace and proname=r.proname and proargtypes=r.proargtypes;
  if new_rpc.oid is null or new_rpc.proacl is distinct from r.proacl or new_rpc.proowner<>r.proowner or new_rpc.proconfig is distinct from r.proconfig or new_rpc.prosecdef<>r.prosecdef or new_rpc.provolatile<>r.provolatile then raise exception 'IDENTITY_RPC_POLICY_CHANGED';end if;
  if old_rpc.oid is null or old_rpc.prosecdef or old_rpc.proowner<>r.proowner or old_rpc.prosrc not like '%public.'||replace(r.proname,'polat','jeff')||'(%'then raise exception 'IDENTITY_RPC_ALIAS_INVALID';end if;
  if exists((select grantee,privilege_type,is_grantable from aclexplode(coalesce(old_rpc.proacl,acldefault('f',old_rpc.proowner))))except(select grantee,privilege_type,is_grantable from aclexplode(coalesce(r.proacl,acldefault('f',r.proowner)))))or exists((select grantee,privilege_type,is_grantable from aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))))except(select grantee,privilege_type,is_grantable from aclexplode(coalesce(old_rpc.proacl,acldefault('f',old_rpc.proowner)))))then raise exception 'IDENTITY_ALIAS_PRIVILEGES_CHANGED';end if;
 end loop;
 if(select name from public.tenants where id='807b9abb-af42-45a8-bf7f-1436d7af384e')<>'Jeff VIP'then raise exception 'IDENTITY_LABEL_NOT_MIGRATED';end if;
 if(select name from public.tenants where id='a0a4bbf0-2246-4c36-95d1-3105e3557ffe')<>'Jeff VIP Private Beta'then raise exception 'IDENTITY_PRIOR_SETUP_LABEL_NOT_MIGRATED';end if;
 if(select name from public.tenants where id='807b9abb-af42-45a8-bf7f-1436d7af384f')<>'Unrelated Polat person'then raise exception 'IDENTITY_UNRELATED_PERSON_CHANGED';end if;
 if not exists(select 1 from public.audit_logs where action='identity.display_name_migrated'and before_data->>'name'='Polat VIP'and after_data->>'name'='Jeff VIP')then raise exception 'IDENTITY_AUDIT_MISSING';end if;
 if(select count(*)from public.agent_definitions where tenant_id='807b9abb-af42-45a8-bf7f-1436d7af384e')<>1 then raise exception 'IDENTITY_AGENT_DUPLICATED';end if;
 if not exists(select 1 from public.agent_versions where agent_definition_id='807b9abb-af42-45a8-bf7f-1436d7af3850'and version=1 and prompt_template like '%Polat VIP%'and superseded_at is not null)then raise exception 'IDENTITY_OLD_PROMPT_REWRITTEN';end if;
 if not exists(select 1 from public.agent_versions where agent_definition_id='807b9abb-af42-45a8-bf7f-1436d7af3850'and version=2 and prompt_template like '%Jeff VIP%'and superseded_at is null and model_name='gpt-6.1-sol'and max_attempts=1)then raise exception 'IDENTITY_CURRENT_PROMPT_NOT_MIGRATED';end if;
 if private.jeff_identity_tag_v1('polat-test-runtime-v1')<>'jeff-test-runtime-v1'then raise exception 'IDENTITY_READ_ALIAS_BROKEN';end if;
 if has_function_privilege('anon','private.jeff_identity_tag_v1(text)','execute')then raise exception 'IDENTITY_PRIVATE_HELPER_EXPOSED';end if;
end;$$;
