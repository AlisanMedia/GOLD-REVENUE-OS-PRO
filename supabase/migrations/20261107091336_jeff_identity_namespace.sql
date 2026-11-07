-- One physical runtime. Rename catalog objects in place; never rewrite ledger rows.
-- Old public RPCs below are invoker-only forwarding shims with copied ACLs.
-- Existing historical migrations and cryptographic domains remain byte-for-byte.
begin;
set local lock_timeout='5s';

create temporary table jeff_identity_rows_before(object_id oid primary key, schema_name text, old_name text, owner_id oid, acl aclitem[], rls boolean, force_rls boolean, row_count bigint, row_hash text) on commit drop;
create temporary table jeff_identity_rpc_before(object_id oid primary key, schema_name text, old_name text, new_name text, owner_id oid, acl aclitem[]) on commit drop;

do $$declare r record;n bigint;h text;begin
 for r in select c.oid,n.nspname,c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private')and c.relkind in('r','p')and (n.nspname='private' or c.relname in('customers','conversations','messages','model_invocations','agent_runs','subscriptions')) order by c.oid loop
  execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(v,'''' order by v),''''),''UTF8'')),''hex'')from(select to_jsonb(x)::text v from %I.%I x)q',r.nspname,r.relname)into n,h;
  insert into jeff_identity_rows_before values(r.oid,r.nspname,r.relname,r.relowner,r.relacl,r.relrowsecurity,r.relforcerowsecurity,n,h);
 end loop;
end;$$;

-- Catalog renames preserve table/function OIDs, rows, FKs, RLS and ownership.
do $$declare r record;target text;kind text;begin
 for r in select c.oid,n.nspname,c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private')and c.relname like '%polat%'and c.relkind in('r','p','v','m','S')order by c.oid loop
  target:=replace(r.relname,'polat','jeff');
  if to_regclass(format('%I.%I',r.nspname,target))is not null then raise exception 'JEFF_IDENTITY_TARGET_COLLISION';end if;
  kind:=case r.relkind when 'v'then 'view'when 'm'then 'materialized view'when 'S'then 'sequence'else 'table'end;
  execute format('alter %s %I.%I rename to %I',kind,r.nspname,r.relname,target);
 end loop;
 for r in select co.oid,n.nspname,c.relname,co.conname from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private')and co.conname like '%polat%'order by co.oid loop
  execute format('alter table %I.%I rename constraint %I to %I',r.nspname,r.relname,r.conname,replace(r.conname,'polat','jeff'));
 end loop;
 for r in select c.oid,n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private')and c.relkind='i'and c.relname like '%polat%'order by c.oid loop
  execute format('alter index %I.%I rename to %I',r.nspname,r.relname,replace(r.relname,'polat','jeff'));
 end loop;
 for r in select t.oid,n.nspname,c.relname,t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private')and not t.tgisinternal and t.tgname like '%polat%'order by t.oid loop
  execute format('alter trigger %I on %I.%I rename to %I',r.tgname,r.nspname,r.relname,replace(r.tgname,'polat','jeff'));
 end loop;
 for r in select p.oid,n.nspname,c.relname,p.polname from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private')and p.polname like '%polat%'order by p.oid loop
  execute format('alter policy %I on %I.%I rename to %I',r.polname,r.nspname,r.relname,replace(r.polname,'polat','jeff'));
 end loop;
 for r in select p.oid,n.nspname,p.proname,p.proowner,p.proacl,pg_get_function_identity_arguments(p.oid)args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')and p.prokind='f'and p.proname like '%polat%'order by p.oid loop
  target:=replace(r.proname,'polat','jeff');
  if exists(select 1 from pg_proc q where q.pronamespace=(select pronamespace from pg_proc where oid=r.oid)and q.proname=target and q.proargtypes=(select proargtypes from pg_proc where oid=r.oid))then raise exception 'JEFF_IDENTITY_TARGET_COLLISION';end if;
  insert into jeff_identity_rpc_before values(r.oid,r.nspname,r.proname,target,r.proowner,r.proacl);
  execute format('alter function %I.%I(%s)rename to %I',r.nspname,r.proname,r.args,target);
 end loop;
end;$$;

-- Read compatibility for existing immutable profile/model values. No dispatch grant.
create function private.jeff_identity_tag_v1(value text)returns text language sql immutable set search_path=pg_catalog as $$
 select case value
 when 'polat-test-runtime-v1'then 'jeff-test-runtime-v1'
 when 'polat-private-beta-v1'then 'jeff-private-beta-v1'
 when 'polat-campaign-v1'then 'jeff-campaign-v1'
 when 'polat-ai-fixture-v2'then 'jeff-ai-fixture-v2'
 when 'polat-fixture-v1'then 'jeff-fixture-v1'
 when 'polat-multiturn-v2'then 'jeff-multiturn-v2'
 else value end
$$;
revoke all on function private.jeff_identity_tag_v1(text)from public,anon,authenticated,service_role;

-- Frozen domains protect already-sealed evidence and cross-version lock scopes.
create or replace function pg_temp.jeff_identity_definition(source text)returns text language plpgsql set search_path=pg_catalog as $$
declare domains text[]:=array[
 'POLAT_ACCOUNT_CONTROL1','POLAT_ACCOUNT_CONTROL_UAT1','POLAT_BUSINESS_READ1','POLAT_CAMPAIGN_CREDENTIAL1','POLAT_CAMPAIGN_RELAY1','POLAT_CONTACT1','POLAT_EXPERIMENT1:','POLAT_EXPERIMENT_AUTH1','POLAT_EXPERIMENT_EVIDENCE1','POLAT_FAKE1','POLAT_FOLLOWUP1','POLAT_GUARD_TARGET_V1','POLAT_MODEL_MEASUREMENT_HASH_V1','POLAT_PRIVATE_BETA_CONVERSATION1','POLAT_PRIVATE_BETA_PLAN1','POLAT_REVIEW_CHUNKS_V1','POLAT_REVIEW_TARGET_V1','POLAT_STARS_MERCHANT_RELAY1','POLAT_UAT_ATTEMPT1','POLAT_UAT_BOT1:','POLAT_UAT_CREDENTIAL_CUSTODY1','POLAT_UAT_RELAY1','POLAT_UAT_STARS_RELAY1'];i integer;
begin
 for i in 1..array_length(domains,1)loop source:=replace(source,quote_literal(domains[i]),quote_literal('__JEFF_FROZEN_DOMAIN_'||i||'__'));end loop;
 source:=replace(replace(replace(source,'POLAT','JEFF'),'Polat','Jeff'),'polat','jeff');
 source:=replace(replace(replace(source,'بولات','جيف'),'Полат','Джефф'),'полат','джефф');
 for i in 1..array_length(domains,1)loop source:=replace(source,quote_literal('__JEFF_FROZEN_DOMAIN_'||i||'__'),quote_literal(domains[i]));end loop;
 -- New bindings use the renamed approved corpus; stored old bindings stay immutable.
 source:=replace(source,'a932be94ff95369905a1a92552ce61d8395b6c6a2eb0a2e7c30dedb38e78c0c9','d78ff2fb3149191b82a63679ef483c0266514b21ebd2ec1e23012f2ab3ea11f6');
 source:=replace(source,'ec2a008c1575660d9f97f9d17fb4e14956051b2f890557477e82fda611d10d4c','ef34656816b428e4da29a5559c192733f379753577ca80563dfdb21ab8074402');
 source:=replace(source,'372b81b5017359aef85f3b4080c1ff7f6bf9193459c30a2505425fc5463066c5','82dec46b30a7bf70d312b5732b2e118200a0e5157897d7ce7ae23202237530b9');
 source:=replace(source,'1afc425d131e4f3e7ee82976e034b703fffbd59bd388b6c1738a6617290d3630','1830661589932e08c76f3d0d6b7b22d64dbf4aa06234e3c8a119c20432c80a45');
 source:=replace(source,'05ed93b8aef4c47bf86c333ce779dd0e408692cadcf3e2e167af74a6b256a71f','f212b7d36268fcc5e40d1d70c1609c66db73dc42e394e90aa46dbeaf43ca8201');
 source:=replace(source,'afda9041422b96eca4ccb86e95febfc920b35db01d38ffc42b96505a4f955fad','9fea728644c8eac4cab2bb5e3e119ed43914da27d8e0f4707fe9b2dad4870247');
 -- Old fixture tenants and context stay the SAME records under the renamed API.
 source:=regexp_replace(source,'([a-z_][a-z_0-9]*\.slug) like ''jeff-sandbox-%''','(\1 like ''jeff-sandbox-%'' or \1 like ''polat-sandbox-%'')','g');
 source:=regexp_replace(source,'([a-z_][a-z_0-9]*\.context_manifest)->>''jeff_([a-z_]+)''','coalesce(\1->>''jeff_\2'',\1->>''polat_\2'')','g');
 source:=replace(source,'coalesce(r.context_manifest->>''jeff_profile'',r.context_manifest->>''polat_profile'')','private.jeff_identity_tag_v1(coalesce(r.context_manifest->>''jeff_profile'',r.context_manifest->>''polat_profile''))');
 -- Incoming requests for the former representative still require human takeover.
 source:=replace(source,'(human|Jeff)','(human|Jeff|Polat)');
 source:=replace(source,'|Jeff.{0,15}görüş','|(Jeff|Polat).{0,15}görüş');
 -- Current summaries include old evidence without changing the invocation rows.
 source:=replace(source,'i.model=''jeff-test-runtime-v1''','private.jeff_identity_tag_v1(i.model)=''jeff-test-runtime-v1''');
 source:=replace(source,'r.model_name=''jeff-test-runtime-v1''','private.jeff_identity_tag_v1(r.model_name)=''jeff-test-runtime-v1''');
 return source;
end;$$;

do $$declare r record;definition text;begin
 -- Rebind textual PL/pgSQL references, retaining each existing function's OID,
 -- volatility, search_path, security mode, owner and existing grants.
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')and p.prokind='f'and p.proname<>'jeff_identity_tag_v1'and (p.prosrc ilike '%polat%'or p.oid in(select object_id from jeff_identity_rpc_before))order by p.oid loop
  definition:=pg_get_functiondef(r.oid);execute pg_temp.jeff_identity_definition(definition);
 end loop;
 -- Only fake test receipt spelling is widened; financial receipt validation,
 -- uniqueness and real payment/access evidence are untouched.
 for r in select co.oid,n.nspname,c.relname,co.conname,pg_get_constraintdef(co.oid)definition from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'and co.contype='c'and pg_get_constraintdef(co.oid)like '%polat-fake:%'loop
  definition:=replace(r.definition,'^polat-fake:','^(polat|jeff)-fake:');
  execute format('alter table %I.%I drop constraint %I',r.nspname,r.relname,r.conname);
  execute format('alter table %I.%I add constraint %I %s',r.nspname,r.relname,r.conname,definition);
 end loop;
end;$$;

-- Compatibility is one invoker hop to the SAME renamed function. No new
-- security-definer implementation, table, agent, journal or ledger is created.
do $$declare r record;grant_row record;arguments text;signature text;result_type text;call_args text;owner_name text;begin
 for r in select b.*,p.pronargs,pg_get_function_arguments(p.oid)arguments,pg_get_function_identity_arguments(p.oid)identity_args,pg_get_function_result(p.oid)result_type from jeff_identity_rpc_before b join pg_proc p on p.oid=b.object_id where b.schema_name='public' order by b.object_id loop
  select coalesce(string_agg('$'||n,','order by n),'')into call_args from generate_series(1,r.pronargs)n;
  signature:=format('%I.%I(%s)',r.schema_name,r.old_name,r.identity_args);
  execute format('create function %I.%I(%s)returns %s language sql security invoker set search_path=pg_catalog as %L',r.schema_name,r.old_name,r.arguments,r.result_type,format('select * from %I.%I(%s)',r.schema_name,r.new_name,call_args));
  execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
  for grant_row in select *from aclexplode(coalesce(r.acl,acldefault('f',r.owner_id)))loop
   if grant_row.privilege_type='EXECUTE'then execute format('grant execute on function %s to %s%s',signature,case when grant_row.grantee=0 then 'public'else quote_ident(pg_get_userbyid(grant_row.grantee))end,case when grant_row.is_grantable then ' with grant option'else ''end);end if;
  end loop;
  execute format('alter function %s owner to %I',signature,pg_get_userbyid(r.owner_id));
  execute format('comment on function %s is %L',signature,'Historical RPC compatibility only; forwards to '||r.new_name||' under unchanged caller privileges.');
 end loop;
end;$$;

-- This is the existing founder-selected tenant, never an arbitrary customer.
do $$declare old_label text;new_label text;r record;begin
 select name into old_label from public.tenants where id='807b9abb-af42-45a8-bf7f-1436d7af384e'for update;
 if old_label~*'\mPolat\M'then
  new_label:=regexp_replace(old_label,'\mPolat\M','Jeff','gi');
  update public.tenants set name=new_label where id='807b9abb-af42-45a8-bf7f-1436d7af384e';
  insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,before_data,after_data)values('807b9abb-af42-45a8-bf7f-1436d7af384e','SYSTEM','identity.display_name_migrated','tenants','807b9abb-af42-45a8-bf7f-1436d7af384e',jsonb_build_object('name',old_label),jsonb_build_object('name',new_label,'public_username','jeffryfx','numeric_identity_verified',false));
 end if;
 for r in select id,name from public.agent_definitions where tenant_id='807b9abb-af42-45a8-bf7f-1436d7af384e'and name~*'\mPolat\M'for update loop
  new_label:=regexp_replace(r.name,'\mPolat\M','Jeff','gi');
  update public.agent_definitions set name=new_label where id=r.id;
  insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,before_data,after_data)values('807b9abb-af42-45a8-bf7f-1436d7af384e','SYSTEM','identity.display_name_migrated','agent_definitions',r.id,jsonb_build_object('name',r.name),jsonb_build_object('name',new_label));
 end loop;
end;$$;

-- Publish renamed wording on the SAME existing definition. The previous prompt
-- content/version and all references from historical runs remain unchanged;
-- superseded_at is the normal publication-lifecycle marker, not an evidence rewrite.
do $$declare old_version public.agent_versions;new_version public.agent_versions;next_version integer;begin
 for old_version in select v.*from public.agent_versions v
  join public.agent_definitions d on d.id=v.agent_definition_id and d.tenant_id=v.tenant_id
  where v.tenant_id='807b9abb-af42-45a8-bf7f-1436d7af384e'and v.published_at is not null and v.superseded_at is null and v.prompt_template ilike '%polat%'for update of v,d loop
  select coalesce(max(version),0)+1 into next_version from public.agent_versions where tenant_id=old_version.tenant_id and agent_definition_id=old_version.agent_definition_id;
  new_version:=old_version;
  new_version.id:=extensions.gen_random_uuid();new_version.version:=next_version;
  new_version.prompt_template:=replace(replace(replace(old_version.prompt_template,'POLAT','JEFF'),'Polat','Jeff'),'polat','jeff');
  new_version.prompt_version:=left(replace(replace(replace(old_version.prompt_version,'POLAT','JEFF'),'Polat','Jeff'),'polat','jeff'),60)||'-jeff-identity-v1';
  new_version.created_at:=statement_timestamp();new_version.published_at:=statement_timestamp();new_version.superseded_at:=null;
  update public.agent_versions set superseded_at=statement_timestamp()where id=old_version.id and tenant_id=old_version.tenant_id;
  insert into public.agent_versions select(new_version).*;
  insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,before_data,after_data)
   values(old_version.tenant_id,'SYSTEM','identity.prompt_version_published','agent_definitions',old_version.agent_definition_id,
    jsonb_build_object('version_id',old_version.id,'prompt_hash',private.fse_hash(old_version.prompt_template)),
    jsonb_build_object('version_id',new_version.id,'prompt_hash',private.fse_hash(new_version.prompt_template),'same_agent_definition',true));
 end loop;
end;$$;

-- Fail the entire transaction if any row, budget, attempt, journal, owner,
-- table OID, ACL or RLS flag changed during the namespace-only operation.
do $$declare r record;c record;n bigint;h text;begin
 for r in select *from jeff_identity_rows_before loop
  select cl.oid,ns.nspname,cl.relname,cl.relowner,cl.relacl,cl.relrowsecurity,cl.relforcerowsecurity into c from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace where cl.oid=r.object_id;
  if c.oid is null or c.relowner<>r.owner_id or c.relacl is distinct from r.acl or c.relrowsecurity<>r.rls or c.relforcerowsecurity<>r.force_rls then raise exception 'JEFF_IDENTITY_PRESERVATION_FAILED';end if;
  execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(v,'''' order by v),''''),''UTF8'')),''hex'')from(select to_jsonb(x)::text v from %I.%I x)q',c.nspname,c.relname)into n,h;
  if n<>r.row_count or h<>r.row_hash then raise exception 'JEFF_IDENTITY_HISTORY_CHANGED';end if;
 end loop;
end;$$;

notify pgrst,'reload schema';
commit;
