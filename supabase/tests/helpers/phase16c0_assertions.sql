-- Shared by the focused suite and the accepted Phase11 CI entry point.
reset role;
\ir phase16c0_fixtures.sql
create temp table bounded_results(k text primary key,v jsonb);
grant all on bounded_results to authenticated;
create function pg_temp.bounded_walk(k text,c uuid default null,sid uuid default null) returns jsonb language plpgsql as $$
declare p jsonb; cur jsonb; ids uuid[]:='{}'; max_rows integer:=0; pages integer:=0;begin
 loop
  p:=public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001',k,c,sid,100,cur);
  max_rows:=greatest(max_rows,jsonb_array_length(p->'items'));pages:=pages+1;
  ids:=ids||array(select (x->>'id')::uuid from jsonb_array_elements(p->'items') x);
  if p->>'has_more'='false' then exit;end if;
  if pages>1000 or p->'next_cursor'='null'::jsonb then raise exception 'pagination not progressing';end if;
  cur:=p->'next_cursor';
 end loop;
 return jsonb_build_object('ids',to_jsonb(ids),'pages',pages,'max_rows',max_rows,'last',p,'unique',(select count(distinct x) from unnest(ids) x));
end;$$;
create function pg_temp.bounded_integrity() returns jsonb language sql as $$
 select jsonb_build_object(
 'subscriptions',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from public.subscriptions x),
 'access',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from public.channel_access x),
 'payments',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from public.subscription_payments x),
 'jobs',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from public.entitlement_jobs x),
 'audit',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from public.entitlement_audit x),
 'receipts',(select count(*) from private.verified_payment_receipts),
 'live_controls',(select md5(string_agg(to_jsonb(x)::text,'' order by tenant_id)) from private.entitlement_controls x),
 'messages',(select count(*) from public.messages),'imports',(select count(*) from public.import_batches));
$$;
insert into bounded_results values('integrity',pg_temp.bounded_integrity());
insert into bounded_results values('expected',jsonb_build_object(
 'subscriptions',(select count(*) from public.subscriptions where tenant_id='e3200000-0000-4000-8000-000000000001'),
 'access',(select count(*) from public.channel_access where tenant_id='e3200000-0000-4000-8000-000000000001'),
 'payments',(select count(*) from public.subscription_payments where tenant_id='e3200000-0000-4000-8000-000000000001'),
 'jobs',(select count(*) from public.entitlement_jobs where tenant_id='e3200000-0000-4000-8000-000000000001'),
 'audit',(select count(*) from public.entitlement_audit where tenant_id='e3200000-0000-4000-8000-000000000001')));
set local role authenticated;
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000001',true);
insert into bounded_results select k,public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001',k) from unnest(array['subscriptions','access','payments','jobs','audit']) k;
select is(jsonb_array_length(v->'items'),25,'16C0 default page independently bounded: '||k) from bounded_results where k in ('subscriptions','access','payments','jobs','audit');
select is(v->>'has_more','true','16C0 explicit incomplete state: '||k) from bounded_results where k in ('subscriptions','access','payments','jobs','audit');
select ok(v->'next_cursor'<>'null'::jsonb,'16C0 next cursor supplied: '||k) from bounded_results where k in ('subscriptions','access','payments','jobs','audit');
insert into bounded_results select 'walk-'||k,pg_temp.bounded_walk(k) from unnest(array['subscriptions','access','payments','jobs','audit']) k;
select is((w.v->>'unique')::bigint,(e.v->>substring(w.k from 6))::bigint,'16C0 complete authorized history: '||w.k) from bounded_results w cross join bounded_results e where w.k like 'walk-%' and e.k='expected';
select is(jsonb_array_length(v->'ids'),(v->>'unique')::integer,'16C0 no duplicate sort ties: '||k) from bounded_results where k like 'walk-%';
select ok((v->>'max_rows')::integer<=100 and (v->>'pages')::integer>1,'16C0 middle/deep/final independently bounded: '||k) from bounded_results where k like 'walk-%';
select is(v->'last'->>'has_more','false','16C0 final page completeness: '||k) from bounded_results where k like 'walk-%';
select is(v->'last'->'next_cursor','null'::jsonb,'16C0 final page has no misleading next link: '||k) from bounded_results where k like 'walk-%';
select is(public.admin_subscription_detail_v1('e3200000-0000-4000-8000-000000000001','ec030000-0000-4000-8000-000000000321')->'subscription'->>'id','ec030000-0000-4000-8000-000000000321','16C0 direct detail outside first 100');
select is(jsonb_array_length(public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','subscriptions','ec020000-0000-4000-8000-000000000001')->'items'),2,'16C0 two plans remain scoped to one customer');
select is(jsonb_array_length(public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','payments',null,'ec030000-0000-4000-8000-000000000321')->'items'),0,'16C0 real empty evidence is explicit');
select is(public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','payments',null,'ec030000-0000-4000-8000-000000000321')->>'has_more','false','16C0 empty differs from incomplete');
select is(public.admin_subscription_detail_v1('e3200000-0000-4000-8000-000000000001',gen_random_uuid()),null::jsonb,'16C0 missing detail returns null');
select throws_ok($$select public.admin_subscription_detail_v1('e3200000-0000-4000-8000-000000000002','ec030000-0000-4000-8000-000000000001')$$,'42501','entitlement permission denied','16C0 wrong tenant detail denied before lookup');
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000002')$$,'42501','entitlement permission denied','16C0 wrong tenant list denied');
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','subscriptions','e3300000-0000-4000-8000-000000000002')$$,'22023','entitlement scope unavailable','16C0 foreign customer not inferred');
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','audit',null,'ec030000-0000-4000-8000-000000000999')$$,'22023','entitlement scope unavailable','16C0 foreign/missing subscription scope unavailable');
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','subscriptions',null,null,101)$$,'22023','entitlement page invalid','16C0 oversized limit rejected');
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','subscriptions',null,null,0)$$,'22023','entitlement page invalid','16C0 zero limit rejected');
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','lease_token')$$,'22023','entitlement page invalid','16C0 arbitrary collection/sort rejected');
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','audit',null,null,25,'{}')$$,'22023','entitlement cursor invalid; refresh','16C0 invalid cursor rejected');
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','jobs',null,null,25,(select v->'next_cursor' from bounded_results where k='audit'))$$,'22023','entitlement cursor invalid; refresh','16C0 collection cursor cannot cross scope');
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','subscriptions','ec020000-0000-4000-8000-000000000001',null,25,(select v->'next_cursor' from bounded_results where k='subscriptions'))$$,'22023','entitlement cursor invalid; refresh','16C0 customer filter cursor cannot cross scope');
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','subscriptions',null,null,100,(select v->'next_cursor' from bounded_results where k='subscriptions'))$$,'22023','entitlement cursor invalid; refresh','16C0 page-size change requires refresh');
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','audit',null,null,25,(select jsonb_set(v->'next_cursor','{after_id}','"ec030000-0000-4000-8000-000000000999"') from bounded_results where k='audit'))$$,'22023','entitlement cursor invalid; refresh','16C0 tampered boundary rejected');
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','audit',null,null,25,(select jsonb_set(v->'next_cursor','{after_time}','"2020-01-01T00:00:00Z"') from bounded_results where k='audit'))$$,'22023','entitlement cursor invalid; refresh','16C0 mismatched immutable sort key rejected');
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','audit',null,null,25,(select jsonb_set(v->'next_cursor','{started_at}','"2020-01-01T00:00:00Z"') from bounded_results where k='audit'))$$,'22023','entitlement cursor invalid; refresh','16C0 expired cursor requires refresh');
insert into bounded_results values('legacy',public.admin_entitlement_list('e3200000-0000-4000-8000-000000000001'));
select is(jsonb_array_length(v->x.name),100,'16C0 compatibility collection bounded: '||x.name) from bounded_results cross join unnest(array['subscriptions','access','payments','jobs','audit']) x(name) where bounded_results.k='legacy';
select is(v->'pages'->x.name->>'has_more','true','16C0 legacy incomplete metadata: '||x.name) from bounded_results cross join unnest(array['subscriptions','access','payments','jobs','audit']) x(name) where bounded_results.k='legacy';
select ok(not exists(select 1 from bounded_results where k='jobs' and v::text like '%lease_token%'),'16C0 no lease token in manager job projection');
select ok(not exists(select 1 from bounded_results where k in ('jobs','audit') and v::text like '%PRIVATE%'),'16C0 raw errors/audit details never exposed');
-- A legacy random access UUID can sort before the seeded INVITED rows. Select
-- the known eligible fixture rather than assuming the first tenant-wide row
-- has an invitation. Exact projection and all existing RBAC assertions remain.
select is((select v->'items'->0->'invite_reference' from bounded_results where k='access'),'null'::jsonb,'16C0 first access row may legitimately have no invitation');
select is(public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','access',null,'ec030000-0000-4000-8000-000000000001')->'items'->0->>'invite_reference','test:invite:PRIVATE-1','16C0 manager legacy operational invitation read preserved');
select ok(not exists(select 1 from bounded_results where k='subscriptions' and v::text like '%private_note%'),'16C0 plan/commercial projection allowlisted');
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','subscriptions',null,null,25,(select v->'next_cursor' from bounded_results where k='subscriptions'))$$,'22023','entitlement cursor invalid; refresh','16C0 another actor/role cannot reuse cursor');
insert into bounded_results values('support',public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001','access'));
select ok((select v->'items'->0->>'telegram_user_id' like 'test:%' from bounded_results where k='support'),'16C0 support identity verification preserved');
select ok((select v->'items'->0->'invite_reference'='null'::jsonb from bounded_results where k='support'),'16C0 support gets status, not transferable invitation');
select throws_ok($$select invite_reference from public.channel_access$$,'42501',null,'16C0 raw access cannot bypass source redaction');
select throws_ok($$select lease_token from public.entitlement_jobs$$,'42501',null,'16C0 raw job lease cannot bypass RPC');
select throws_ok($$select details from public.entitlement_audit$$,'42501',null,'16C0 raw audit cannot bypass projection');
select throws_ok($$select telegram_user_id from public.telegram_entitlement_bindings$$,'42501',null,'16C0 identity binding raw read denied');
select set_config('request.jwt.claim.sub','ec010000-0000-4000-8000-000000000001',true);
insert into bounded_results values('analyst',public.admin_entitlement_list('e3200000-0000-4000-8000-000000000001'));
select ok((select bool_and(x->'invite_reference'='null'::jsonb and x->'telegram_user_id'='null'::jsonb and x->'chat_id'='null'::jsonb) from bounded_results cross join lateral jsonb_array_elements(v->'access') x where k='analyst'),'16C0 analyst sensitive fields source-redacted');
select ok((select bool_and(x->'event_id'='null'::jsonb and x->'test_invoice_id'='null'::jsonb and x->'receipt_id'='null'::jsonb) from bounded_results cross join lateral jsonb_array_elements(v->'payments') x where k='analyst'),'16C0 analyst sensitive source references redacted');
select ok(not exists(select 1 from bounded_results where k='analyst' and (v::text like '%test:invite:%' or v::text like '%lease_token%' or v::text like '%PRIVATE%')),'16C0 analyst legacy projection has no hidden sensitive JSON');
select throws_ok($$select receipt_id from public.subscription_payments$$,'42501',null,'16C0 direct source-reference bypass denied');
select throws_ok($$select commercial_snapshot from public.subscriptions$$,'42501',null,'16C0 direct commercial snapshot bypass denied');
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001')$$,'42501','entitlement permission denied','16C0 readonly collection denied');
select throws_ok($$select public.admin_subscription_detail_v1('e3200000-0000-4000-8000-000000000001','ec030000-0000-4000-8000-000000000001')$$,'42501','entitlement permission denied','16C0 readonly direct detail denied');
select set_config('request.jwt.claim.sub','ec010000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_entitlement_page_v1('e3200000-0000-4000-8000-000000000001')$$,'42501','entitlement permission denied','16C0 missing membership denied');
select is(public.admin_subscription_detail_v1('e3200000-0000-4000-8000-000000000002','ec030000-0000-4000-8000-000000000001'),null::jsonb,'16C0 known foreign subscription indistinguishable from missing');
select is(public.admin_subscription_detail_v1('e3200000-0000-4000-8000-000000000002',gen_random_uuid()),null::jsonb,'16C0 unknown subscription same authorized-tenant response');
reset role;
select is(pg_temp.bounded_integrity(),(select v from bounded_results where k='integrity'),'16C0 read traversal changes no periods, subscriptions, access, jobs, audit, controls, receipts, messages or imports');
select is(jsonb_array_length(private.entitlement_admin_terms(jsonb_build_object('inclusions',(select jsonb_agg('Synthetic term'::text) from generate_series(1,1000))))->'inclusions'),12,'16C0 approved terms arrays independently bounded');
select ok(not private.entitlement_admin_terms('{"terms":"Original terms","private_note":"PRIVATE","lease_token":"PRIVATE"}')::text like '%PRIVATE%','16C0 detail terms keep approved content without hidden arbitrary fields');
select is(private.entitlement_admin_access(jsonb_populate_record(a,'{"mode":"live","invite_reference":"https://tXme/+synthetic"}'),'ec020000-0000-4000-8000-000000000001',true,true)->'invite_reference','null'::jsonb,'16C0 invitation projection accepts exact Telegram host only') from public.channel_access a where a.id='ec060000-0000-4000-8000-000000000001';
select ok(not has_table_privilege('authenticated','private.verified_payment_receipts','INSERT'),'16C0 no receipt authority');
select ok(not has_table_privilege('authenticated','private.entitlement_controls','UPDATE'),'16C0 no activation authority');
select ok(not has_table_privilege('authenticated','public.subscriptions','UPDATE'),'16C0 no subscription mutation grant');
select ok(not has_table_privilege('authenticated','public.channel_access','INSERT'),'16C0 no access mutation grant');
select ok(not has_function_privilege('anon','public.admin_entitlement_page_v1(uuid,text,uuid,uuid,integer,jsonb)','EXECUTE'),'16C0 anon denied');
select ok(not has_function_privilege('service_role','public.admin_entitlement_page_v1(uuid,text,uuid,uuid,integer,jsonb)','EXECUTE'),'16C0 worker cannot impersonate Admin via read RPC');
select ok(not has_function_privilege('authenticated','private.entitlement_admin_access(public.channel_access,uuid,boolean,boolean)','EXECUTE'),'16C0 private projection cannot be called with forged role flags');
select is((select provolatile::text from pg_proc where oid='public.admin_entitlement_page_v1(uuid,text,uuid,uuid,integer,jsonb)'::regprocedure),'s','16C0 RPC remains STABLE/read-only');
select ok((select proconfig @> array['search_path=pg_catalog'] from pg_proc where oid='public.admin_entitlement_page_v1(uuid,text,uuid,uuid,integer,jsonb)'::regprocedure),'16C0 definer search path fixed');
