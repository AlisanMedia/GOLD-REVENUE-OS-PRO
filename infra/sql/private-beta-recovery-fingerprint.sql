-- Ephemeral, bounded recovery fingerprint. Catalog-derived identifiers only;
-- result contains aggregate hashes/counts, never rows or source definitions.
set timezone='UTC';
create or replace function pg_temp.private_beta_snapshot() returns jsonb language plpgsql set search_path=pg_catalog as $$
declare r record; n bigint; total_rows bigint=0; h text; result jsonb='{}'; definitions text; privileges text; security text; sequences jsonb='{}'; sequence_value text; sequence_called boolean;
begin
 -- Initial/recovery releases never race an active private-beta model/Telegram window.
 -- This is a read-only prerequisite; it does not cancel or rewrite an owner's grant.
 if to_regclass('private.private_beta_programs')is not null then
  execute 'select count(*)from private.private_beta_programs where stage not in(''DRAFT'',''STOPPED'')'into n;
  if n<>0 then raise exception 'PRIVATE_BETA_RELEASE_REQUIRES_PAUSED_PROGRAMS';end if;
 end if;
 if(select coalesce(sum(pg_total_relation_size(c.oid)),0)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth')and c.relkind in('r','p','m'))>268435456 then raise exception 'BACKUP_SIZE_BOUND_EXCEEDED';end if;
 for r in select schemaname,tablename from pg_catalog.pg_tables where schemaname in('public','private','auth') order by schemaname,tablename loop
  execute format('select count(*) from %I.%I',r.schemaname,r.tablename) into n;
  if n>200000 then raise exception 'BACKUP_TABLE_BOUND_EXCEEDED';end if;
  total_rows:=total_rows+n;if total_rows>500000 then raise exception 'BACKUP_TOTAL_ROW_BOUND_EXCEEDED';end if;
  execute format('select encode(sha256(convert_to(coalesce(string_agg(row_hash,'''' order by row_hash),''''),''UTF8'')),''hex'') from(select encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'')row_hash from %I.%I t)hashed',r.schemaname,r.tablename) into h;
  result:=result||jsonb_build_object(r.schemaname||'.'||r.tablename,jsonb_build_object('rows',n,'sha256',h));
 end loop;
 select encode(sha256(convert_to(coalesce(string_agg(pg_get_functiondef(p.oid),E'\n' order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),''),'UTF8')),'hex') into definitions from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private','auth') and p.prokind='f';
 -- pg_restore may reorder ACL arrays or spell an implicit owner ACL explicitly.
 -- Canonical EFFECTIVE grants retain every grantor/grantee/privilege/grant-option,
 -- plus ownership. No privilege or deny assertion is omitted to obtain equality.
 with objects as(
  select 'relation:'||n.nspname||'.'||c.relname object_name,c.relowner owner_id,coalesce(c.relacl,acldefault(case when c.relkind='S'then 's'::"char"else 'r'::"char"end,c.relowner)) acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth')and c.relkind in('r','p','v','m','S')
  union all select 'function:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',p.proowner,coalesce(p.proacl,acldefault('f',p.proowner))from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private','auth')and p.prokind in('f','p')
  union all select 'schema:'||n.nspname,n.nspowner,coalesce(n.nspacl,acldefault('n',n.nspowner))from pg_namespace n where n.nspname in('public','private','auth')
 ), canonical as(
  select o.object_name,pg_get_userbyid(o.owner_id)::text owner_name,(select coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor)::text,case when a.grantee=0 then 'PUBLIC'else pg_get_userbyid(a.grantee)::text end,a.privilege_type,a.is_grantable)order by pg_get_userbyid(a.grantor)::text,case when a.grantee=0 then 'PUBLIC'else pg_get_userbyid(a.grantee)::text end,a.privilege_type,a.is_grantable),'[]')from aclexplode(o.acl)a)grants from objects o
 )select encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(object_name,owner_name,grants)order by object_name)::text,'[]'),'UTF8')),'hex')into privileges from canonical;
 select encode(sha256(convert_to(coalesce(string_agg(v,E'\n' order by v),''),'UTF8')),'hex') into security from (
  select n.nspname||'.'||c.relname||':'||c.relrowsecurity||':'||c.relforcerowsecurity v from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth') and c.relkind in('r','p')
  union all select n.nspname||'.'||c.relname||':'||con.conname||':'||pg_get_constraintdef(con.oid,true) from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth')
  union all select n.nspname||'.'||c.relname||':'||p.polname||':'||p.polcmd::text||':'||p.polpermissive||':'||array(select case when role_id=0 then 'PUBLIC'else pg_get_userbyid(role_id)end from unnest(p.polroles)role_id order by 1)::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth')
 ) items;
 for r in select * from pg_sequences where schemaname in('public','private','auth') order by schemaname,sequencename loop
  execute format('select last_value::text,is_called from %I.%I',r.schemaname,r.sequencename)into sequence_value,sequence_called;
  sequences:=sequences||jsonb_build_object(r.schemaname||'.'||r.sequencename,jsonb_build_object('last_value',case when sequence_called then sequence_value else null end,'state_value',sequence_value,'is_called',sequence_called,'increment',r.increment_by::text,'min',r.min_value::text,'max',r.max_value::text,'cycle',r.cycle));
 end loop;
 return jsonb_build_object('tables',result,'function_hash',definitions,'ownership_acl_hash',privileges,'rls_constraints_policy_hash',security,'sequences',sequences,'database_owner',(select pg_get_userbyid(datdba)::text from pg_database where datname=current_database()),'public_schema_owner',(select pg_get_userbyid(nspowner)::text from pg_namespace where nspname='public'),'pg_major',current_setting('server_version_num')::int/10000);
end;$$;
-- One MVCC view for all data/catalog reads; pg_dump imports this same exported
-- snapshot. A fresh post-dump invocation separately fences catalog/UAT drift.
begin isolation level repeatable read read only;
\if :{?private_beta_snapshot}
set transaction snapshot :'private_beta_snapshot';
\endif
select pg_temp.private_beta_snapshot();
commit;
