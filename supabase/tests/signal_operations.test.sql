begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
\ir helpers/signal_operations_fixtures.sql

-- Queries never claim a provider connection, financial outcome or customer read.
do $$begin for n in 1..135 loop perform private.signal_record_fixture_v1(pg_temp.signal_input('ops-'||n));end loop;end;$$;
select private.signal_record_fixture_v1(pg_temp.signal_input('restricted',1,'51c03000-0000-4000-8000-000000000001','51c02000-0000-4000-8000-000000000001','RESTRICTED'));
create temp table ops_pages(n text primary key,v jsonb);grant all on ops_pages to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','51c01000-0000-4000-8000-000000000001',true);
insert into ops_pages values('first',public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events'));
select is(jsonb_array_length((select v->'items' from ops_pages where n='first')),25,'default page bounded25');
select is((select v->>'has_more' from ops_pages where n='first'),'true','first page has lookahead');
select is((select v->>'financial_authority' from ops_pages where n='first'),'NONE','no financial authority');
select is((select v->>'live_authority' from ops_pages where n='first'),'NONE','no live authority');
select is((select v#>>'{items,0,state}' from ops_pages where n='first'),'SOURCE_RESTRICTED','restricted source visible');
select is((select v#>>'{items,0,signal}' from ops_pages where n='first'),null,'protected content not projected');
insert into ops_pages values('second',public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events',cursor_value=>(select v->'next_cursor' from ops_pages where n='first')));
select is(jsonb_array_length((select v->'items' from ops_pages where n='second')),25,'middle page bounded');
select is((select count(*)::int from jsonb_array_elements((select v->'items' from ops_pages where n='first'))a join jsonb_array_elements((select v->'items' from ops_pages where n='second'))b on a->>'id'=b->>'id'),0,'page keys never duplicate');
select throws_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events',page_size_value=>101)$$,'22023','signal read invalid; refresh','hard maximum100');
select throws_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events',page_size_value=>0)$$,'22023','signal read invalid; refresh','zero page denied');
select throws_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events',cursor_value=>'{}')$$,'22023','signal read invalid; refresh','malformed cursor rejected');
select throws_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events',cursor_value=>jsonb_set((select v->'next_cursor' from ops_pages where n='first'),'{started_at}',to_jsonb((now()-interval '31 minutes')::text)))$$,'22023','signal read invalid; refresh','TTL30min');
select throws_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events',cursor_value=>jsonb_set((select v->'next_cursor' from ops_pages where n='first'),'{after}','"9223372036854775807"'))$$,'22023','signal read invalid; refresh','cursor out of range rejected');
select throws_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','deliveries',cursor_value=>(select v->'next_cursor' from ops_pages where n='first'))$$,'22023','signal read invalid; refresh','cursor cannot change collection');
select throws_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events',page_size_value=>50,cursor_value=>(select v->'next_cursor' from ops_pages where n='first'))$$,'22023','signal read invalid; refresh','cursor cannot change size');
select throws_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events',source_value=>'51c03000-0000-4000-8000-000000000002',cursor_value=>(select v->'next_cursor' from ops_pages where n='first'))$$,'22023','signal read invalid; refresh','cursor cannot change source filter');
select throws_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','history')$$,'22023','signal read invalid; refresh','history requires selected delivery');
select throws_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','sources',source_value=>'51c03000-0000-4000-8000-000000000003')$$,'22023','signal read invalid; refresh','foreign source same unavailable response');
select throws_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','sources',source_value=>'ffffffff-ffff-4fff-8fff-ffffffffffff')$$,'22023','signal read invalid; refresh','nonexistent source same response');
select throws_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000002','providers')$$,'42501','signal read denied','wrong tenant denied before reading');
select throws_ok($$select public.admin_signal_page_v1('ffffffff-ffff-4fff-8fff-ffffffffffff','providers')$$,'42501','signal read denied','nonexistent tenant also denied');
select is(jsonb_array_length(public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','sources')->'items'),2,'multiple sources visible');
select is(jsonb_array_length(public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','routes')->'items'),2,'multi-source single destination routes');
select is(jsonb_array_length(public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','destinations')->'items'),1,'approved fake destination only');
select is(jsonb_array_length(public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events',source_value=>'51c03000-0000-4000-8000-000000000002')->'items'),0,'honest empty source history');
select is(public.admin_signal_summary_v1('51c02000-0000-4000-8000-000000000001')#>>'{latency,p95_ms}',null,'unknown latency stays null');
select is(public.admin_signal_summary_v1('51c02000-0000-4000-8000-000000000001')#>>'{latency,valid}','0','zero valid sample is explicit');
select ok(public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','deliveries')::text !~ 'lease_token|source_ref|destination_ref|original_text|message_key|operation_key|fact_hash|target_ref|payload','manager projection has no raw secrets or content');
select set_config('request.jwt.claim.sub','51c01000-0000-4000-8000-000000000002',true);
select lives_ok($$select public.admin_signal_summary_v1('51c02000-0000-4000-8000-000000000001')$$,'support read allowed');
select throws_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events',cursor_value=>(select v->'next_cursor' from ops_pages where n='first'))$$,'22023','signal read invalid; refresh','cursor bound to authenticated user and role');
select set_config('request.jwt.claim.sub','51c01000-0000-4000-8000-000000000003',true);
select ok(public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events')::text !~ 'fixture:|original_text|message_key|fact_hash','analyst gets safe projection');
select set_config('request.jwt.claim.sub','51c01000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.admin_signal_summary_v1('51c02000-0000-4000-8000-000000000001')$$,'42501','signal read denied','readonly denied');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.admin_signal_summary_v1('51c02000-0000-4000-8000-000000000001')$$,'42501','signal read denied','missing identity denied');
reset role;
select ok(not has_function_privilege('anon','public.admin_signal_page_v1(uuid,text,uuid,uuid,uuid,uuid,text,integer,jsonb)','EXECUTE'),'no anonymous read');
select ok(not has_function_privilege('service_role','public.admin_signal_summary_v1(uuid)','EXECUTE'),'no service-role bypass read');
select ok(not has_function_privilege('authenticated','private.signal_admin_rows_v1(uuid,text,uuid,uuid,uuid,uuid,text,text,text,text[],integer)','EXECUTE'),'no raw helper execution');
select ok(not has_table_privilege('authenticated','private.signal_attempts','SELECT'),'no attempt payload select');
select ok(not has_function_privilege('authenticated','private.signal_finish_fixture_v1(uuid,uuid,uuid,text,boolean)','EXECUTE'),'no sender authority added');
-- New inserts never enter an anchored subsequent page.
select private.signal_record_fixture_v1(pg_temp.signal_input('new-after-first-page'));
set local role authenticated;select set_config('request.jwt.claim.sub','51c01000-0000-4000-8000-000000000001',true);
insert into ops_pages values('repeat-second',public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events',cursor_value=>(select v->'next_cursor' from ops_pages where n='first')));
select is((select v->'items' from ops_pages where n='repeat-second'),(select v->'items' from ops_pages where n='second'),'concurrent insert above anchor leaves next page stable');
do $$declare p jsonb;cur jsonb;total integer:=0;begin loop p:=public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events',cursor_value=>cur);total:=total+jsonb_array_length(p->'items');exit when not (p->>'has_more')::boolean;cur:=p->'next_cursor';if total>200 then raise exception 'unbounded';end if;end loop;insert into ops_pages values('walk',jsonb_build_object('total',total,'final_count',jsonb_array_length(p->'items'),'more',p->'has_more'));end;$$;
select is((select v->>'total' from ops_pages where n='walk'),'137','all history accessible beyond100');
select is((select v->>'more' from ops_pages where n='walk'),'false','final page completeness explicit');
select is((select v->>'final_count' from ops_pages where n='walk'),'12','bounded final page');
reset role;
-- A real private fake-ACK commit supplies operational latency, never Telegram authority.
insert into public.tenants(id,name,slug) values('51c22000-0000-4000-8000-000000000001','ACK fixture','signal-sandbox-ops-ack');
insert into public.tenant_members(tenant_id,user_id,role) values('51c22000-0000-4000-8000-000000000001','51c01000-0000-4000-8000-000000000001','manager');
select private.signal_fixture_configure_v1('51c22000-0000-4000-8000-000000000001','51c24000-0000-4000-8000-000000000001','51c23000-0000-4000-8000-000000000001','51c25000-0000-4000-8000-000000000001','51c26000-0000-4000-8000-000000000001','ACK fixture','fixture:ack-source','fixture:ack-destination',true);
create temp table ops_ack(id uuid);grant select on ops_ack to authenticated;
do $$declare l jsonb;p jsonb;result text;t uuid:='51c22000-0000-4000-8000-000000000001';begin
 perform private.signal_record_fixture_v1(jsonb_set(pg_temp.signal_input('ack',1,'51c23000-0000-4000-8000-000000000001',t)::jsonb,'{observed_at}',to_jsonb(clock_timestamp()-interval '1 second'))::text);
 l:=private.signal_claim_fixture_v1(t);p:=private.signal_begin_fixture_v1(t,(l->>'delivery_id')::uuid,(l->>'lease_token')::uuid)->'payload';
 result:=jsonb_build_object('outcome','ACK','mode','SYNTHETIC','tenant_id',t,'operation_key',p->>'operation_key','destination_ref',p->>'destination_ref','message_ref','fake-message:ops-proof','fact_hash',p->>'fact_hash','acknowledged_at',clock_timestamp())::text;
 perform private.signal_finish_fixture_v1(t,(l->>'delivery_id')::uuid,(l->>'lease_token')::uuid,result);insert into ops_ack values((l->>'delivery_id')::uuid);
end;$$;
set local role authenticated;select set_config('request.jwt.claim.sub','51c01000-0000-4000-8000-000000000001',true);
select is(public.admin_signal_summary_v1('51c22000-0000-4000-8000-000000000001')#>>'{latency,valid}','1','one actual fake ACK measurement');
select ok((public.admin_signal_summary_v1('51c22000-0000-4000-8000-000000000001')#>>'{latency,p95_ms}')::numeric>=0,'nonnegative latency from recorded source and ACK timestamps');
select is(public.admin_signal_page_v1('51c22000-0000-4000-8000-000000000001','deliveries')#>>'{items,0,state}','FAKE_CONFIRMED','fake acknowledgement correctly labeled');
select ok(public.admin_signal_page_v1('51c22000-0000-4000-8000-000000000001','history',delivery_value=>(select id from ops_ack))::text !~ 'fake-message:|destination_ref|fact_hash|lease_token','history projection excludes sensitive ACK evidence');
select is(public.admin_signal_page_v1('51c22000-0000-4000-8000-000000000001','history',delivery_value=>(select id from ops_ack))#>>'{items,0,source_label}','ACK fixture','history preserves selected source/destination context');
select ok(jsonb_array_length(public.admin_signal_page_v1('51c22000-0000-4000-8000-000000000001','history',delivery_value=>(select id from ops_ack))->'items')>=3,'bounded evidence preserves queue, begin and ACK history');
reset role;

-- Current unknown effect is visible without claiming acknowledgement or granting retry.
do $$declare l jsonb;t uuid:='51c22000-0000-4000-8000-000000000001';begin
 perform private.signal_record_fixture_v1(jsonb_set(pg_temp.signal_input('unknown',1,'51c23000-0000-4000-8000-000000000001',t)::jsonb,'{observed_at}',to_jsonb(clock_timestamp()))::text);
 l:=private.signal_claim_fixture_v1(t);perform private.signal_begin_fixture_v1(t,(l->>'delivery_id')::uuid,(l->>'lease_token')::uuid);
 perform private.signal_finish_fixture_v1(t,(l->>'delivery_id')::uuid,(l->>'lease_token')::uuid,'{"outcome":"UNKNOWN","retry_after_ms":null}');end;$$;
set local role authenticated;select set_config('request.jwt.claim.sub','51c01000-0000-4000-8000-000000000001',true);
select is(public.admin_signal_page_v1('51c22000-0000-4000-8000-000000000001','deliveries',status_value=>'UNKNOWN')#>>'{items,0,code}','UNKNOWN_EFFECT','actual unknown effect safely projected');
select is(public.admin_signal_page_v1('51c22000-0000-4000-8000-000000000001','deliveries',status_value=>'UNKNOWN')#>>'{items,0,acknowledged_at}',null,'unknown is not fake acknowledgement');
select is(public.admin_signal_summary_v1('51c22000-0000-4000-8000-000000000001')#>>'{latency,valid}','1','unknown does not enter acknowledged latency denominator');
reset role;
-- Bulk synthetic read fixture, not a recorder/throughput benchmark. Canonical facts, heads and route jobs remain linked.
with v as(select pg_temp.signal_input('large-'||n,1,'51c23000-0000-4000-8000-000000000001','51c22000-0000-4000-8000-000000000001')::jsonb x from generate_series(1,10001)n)
insert into private.signal_events(tenant_id,source_id,message_key,revision,kind,event_identity,fact_hash,original,parse_state)
select (x->>'tenant_id')::uuid,(x->>'source_id')::uuid,x->>'message_key',1,'MESSAGE',private.fse_hash(private.fse_canonical(jsonb_build_array('SIGNAL1',x->>'tenant_id',x->>'source_id',x->>'message_key','1'))),private.fse_hash(private.fse_canonical(x-'observed_at')),x,'STRUCTURED' from v;
insert into private.signal_heads(tenant_id,source_id,message_key,revision,event_id)
select tenant_id,source_id,message_key,revision,id from private.signal_events where tenant_id='51c22000-0000-4000-8000-000000000001' and message_key like 'large-%';
set local role authenticated;select set_config('request.jwt.claim.sub','51c01000-0000-4000-8000-000000000001',true);
select is((select value->>'value' from jsonb_array_elements(public.admin_signal_summary_v1('51c22000-0000-4000-8000-000000000001')->'counts')where value->>'status'='PENDING'),'10000','status count is hard bounded at10000');
select is((select value->>'complete' from jsonb_array_elements(public.admin_signal_summary_v1('51c22000-0000-4000-8000-000000000001')->'counts')where value->>'status'='PENDING'),'false','incomplete total explicitly lower bound');
select is(jsonb_array_length(public.admin_signal_page_v1('51c22000-0000-4000-8000-000000000001','deliveries',page_size_value=>100)->'items'),100,'large real SQL history stays bounded100');
reset role;

-- Byte-for-byte access state remains unchanged by read-only Admin operations.
create function pg_temp.ops_fingerprint() returns text language sql stable as $$select encode(extensions.digest(jsonb_build_object(
'events',(select jsonb_agg(to_jsonb(q) order by q.id) from private.signal_events q),'deliveries',(select jsonb_agg(to_jsonb(q) order by q.id) from private.signal_deliveries q),
'history',(select jsonb_agg(to_jsonb(q) order by q.id) from private.signal_delivery_history q),'attempts',(select jsonb_agg(to_jsonb(q) order by q.id) from private.signal_attempts q),
'receipts',(select jsonb_agg(to_jsonb(q) order by q.id) from private.verified_payment_receipts q),'periods',(select jsonb_agg(to_jsonb(q) order by q.id) from public.subscription_payments q),'access',(select jsonb_agg(to_jsonb(q) order by q.id) from public.channel_access q))::text,'sha256'),'hex')$$;
create temp table ops_before_read as select pg_temp.ops_fingerprint() value;
create temp table ops_after_seed as select (select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'[]'),'sha256'),'hex') from public.channel_access a) value;
set local role authenticated;select set_config('request.jwt.claim.sub','51c01000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','providers')$$,'provider registry safe read');
select lives_ok($$select public.admin_signal_page_v1('51c02000-0000-4000-8000-000000000001','events')$$,'event read');
select lives_ok($$select public.admin_signal_summary_v1('51c02000-0000-4000-8000-000000000001')$$,'summary read');
reset role;
select is((select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'[]'),'sha256'),'hex') from public.channel_access a),(select value from ops_after_seed),'all evidence and authority unchanged by Admin reads');
select is(pg_temp.ops_fingerprint(),(select value from ops_before_read),'all source/delivery/receipt/period/access evidence unchanged by Admin reads');
select * from finish();rollback;
