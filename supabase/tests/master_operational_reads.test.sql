begin;
select no_plan();
\ir helpers/polat_inbound_fixtures.sql
\ir helpers/polat_experiment_fixtures.sql
select pg_temp.polat_setup(6301);select pg_temp.bridge_setup(8601);
insert into public.tenant_members(tenant_id,user_id,role)
select pg_temp.bridge_id(8601,'1000'),user_id,role from public.tenant_members where tenant_id=pg_temp.polat_id(6301,'2000');
select pg_temp.bridge_reserve(8601);select pg_temp.bridge_begin(8601);select pg_temp.bridge_record(8601);
create function pg_temp.experiments(size_value integer default 25,c jsonb default null)returns jsonb language sql as $$select public.admin_polat_experiment_page_v1(pg_temp.bridge_id(8601,'1000'),size_value,c)$$;
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);
select is(jsonb_array_length(pg_temp.experiments()->'items'),1,'existing experiment visible without exposing its private binding');
select is(pg_temp.experiments()#>>'{items,0,stop_reason}','BILLING_UNVERIFIED','actual unresolved billing remains visible');
select is(pg_temp.experiments()#>>'{items,0,actual_billed_amount}',null,'reserved liability never becomes genuine cost');
select is(pg_temp.experiments()->>'authorized_external_requests','0','read grants no provider requests');
select ok(not(pg_temp.experiments()::text~'account_scope|authorization_record|dispatch_key|body_hash|request_hash|credential|PRIVATE'),'safe explicit projection only');
select throws_ok($$select pg_temp.experiments(101)$$,'22023','POLAT_EXPERIMENT_CURSOR_INVALID','hard maximum 100');
select throws_ok($$select pg_temp.experiments(0)$$,'22023','POLAT_EXPERIMENT_CURSOR_INVALID','zero page denied');
select throws_ok($$select public.admin_polat_experiment_page_v1('ffffffff-0000-4000-8000-000000000001')$$,'42501','POLAT_EXPERIMENT_UNAVAILABLE','foreign tenant indistinguishable from unavailable');
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000002',true);
select is(pg_temp.experiments()#>>'{items,0,reserved_liability}',null,'support liability redacted at SQL boundary');
select is(pg_temp.experiments()#>>'{items,0,currency}',null,'support billing currency redacted');
select is(pg_temp.experiments()#>>'{items,0,request_count}','1','support retains operational count');
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000003',true);
select lives_ok($$select pg_temp.experiments()$$,'analyst may inspect safe operation evidence');
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000004',true);
select throws_ok($$select pg_temp.experiments()$$,'42501','POLAT_EXPERIMENT_UNAVAILABLE','readonly denied');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select pg_temp.experiments()$$,'42501','POLAT_EXPERIMENT_UNAVAILABLE','missing membership denied');
select ok(not has_function_privilege('service_role','public.admin_polat_experiment_page_v1(uuid,integer,jsonb)','EXECUTE'),'no new service privilege');
select ok(not has_function_privilege('anon','public.admin_polat_experiment_page_v1(uuid,integer,jsonb)','EXECUTE'),'anonymous denied');
select ok(not has_table_privilege('authenticated','private.polat_experiment_runs','SELECT'),'no raw private select grant');
select ok(not has_table_privilege('service_role','private.polat_experiment_runs','INSERT'),'no genuine writer authority');
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);
insert into private.polat_experiment_runs(id,tenant_id,account_scope_hash,authorization_record_hash,binding,binding_hash,created_at)
select extensions.gen_random_uuid(),tenant_id,private.fse_hash('account-page-'||n),private.fse_hash('auth-page-'||n),binding,binding_hash,'2020-01-01'::timestamptz
from private.polat_experiment_runs cross join generate_series(1,251)n where id=pg_temp.bridge_id(8601,'2000');
create temp table exp_pages(page jsonb);insert into exp_pages values(pg_temp.experiments());
select is(jsonb_array_length((select page->'items'from exp_pages)),25,'first page bounded with duplicate timestamps');
select ok((select(page->>'has_more')::boolean from exp_pages),'bounded lookahead reports more');
select throws_ok($$select pg_temp.experiments(100,(select page->'next_cursor'from exp_pages))$$,'22023','POLAT_EXPERIMENT_CURSOR_INVALID','cursor cannot change page size');
select throws_ok($$select pg_temp.experiments(25,jsonb_set((select page->'next_cursor'from exp_pages),'{expires}','"2000-01-01"'))$$,'22023','POLAT_EXPERIMENT_CURSOR_INVALID','expired cursor denied');
select throws_ok($$select pg_temp.experiments(25,jsonb_set((select page->'next_cursor'from exp_pages),'{role}','"support"'))$$,'22023','POLAT_EXPERIMENT_CURSOR_INVALID','cursor cannot cross role');
select throws_ok($$select pg_temp.experiments(25,jsonb_set((select page->'next_cursor'from exp_pages),'{tenant}','"ffffffff-0000-4000-8000-000000000001"'))$$,'22023','POLAT_EXPERIMENT_CURSOR_INVALID','cursor cannot cross tenant');
select throws_ok($$select pg_temp.experiments(25,'{}')$$,'22023','POLAT_EXPERIMENT_CURSOR_INVALID','incomplete cursor denied');
do $$declare p jsonb;seen uuid[]:='{}';k integer:=0;begin
 p:=pg_temp.experiments();loop
  seen:=seen||array(select(x->>'id')::uuid from jsonb_array_elements(p->'items')x);k:=k+1;
  exit when not(p->>'has_more')::boolean;if k>11 then raise exception 'unbounded pagination';end if;
  p:=pg_temp.experiments(25,p->'next_cursor');
 end loop;
 perform extensions.is(cardinality(seen),252,'all historical runs remain reachable');
 perform extensions.is((select count(distinct x)::integer from unnest(seen)x),252,'tie-breaking never duplicates or skips a run');
end;$$;
select ok(octet_length(pg_temp.experiments()::text)<30000,'bounded response size');
do $$declare plan jsonb;begin
 execute format('explain(analyze,buffers,format json)select id from private.polat_experiment_runs where tenant_id=%L order by created_at desc,id desc limit 26',pg_temp.bridge_id(8601,'1000'))into plan;
 raise notice 'MASTER_READ_PLAN %',plan;
end;$$;
select is((select count(*)from private.verified_payment_receipts where tenant_id=pg_temp.bridge_id(8601,'1000')),0::bigint,'no genuine receipt created');
select is((select count(*)from public.channel_access where tenant_id=pg_temp.bridge_id(8601,'1000')),0::bigint,'no VIP state created');
-- The same operator can now inspect more than 100 messages without timestamp-tie loss.
create function pg_temp.message_page(c jsonb default null)returns jsonb language sql as $$select public.admin_conversation_message_page_v1(pg_temp.polat_id(6301,'2000'),pg_temp.polat_conv(6301),25,c)$$;
with seed as materialized(select * from public.messages where tenant_id=pg_temp.polat_id(6301,'2000')limit 1)
insert into public.messages(tenant_id,conversation_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_chat_id,actor_type,correlation_id,occurred_at,idempotency_key)
select tenant_id,conversation_id,messaging_contact_id,provider_connection_id,'inbound','text','Synthetic history only','received',provider_chat_id,'WEBHOOK',extensions.gen_random_uuid(),'2020-01-01'::timestamptz,'master-history-fixture-'||s from seed cross join generate_series(1,251)s;
select is(jsonb_array_length(pg_temp.message_page()->'items'),25,'message collection independently defaults to 25');
select ok((pg_temp.message_page()->>'has_more')::boolean,'more than 100 messages accessible through lookahead');
select ok(not(pg_temp.message_page()::text~'provider_user_id|provider_chat_id|provider_connection_id|payer|secret'),'message projection omits technical routing identities');
select throws_ok($$select public.admin_conversation_message_page_v1(pg_temp.polat_id(6301,'2000'),pg_temp.polat_conv(6301),101)$$,'22023','MESSAGE_CURSOR_INVALID','message maximum enforced');
select throws_ok($$select public.admin_conversation_message_page_v1(pg_temp.polat_id(6301,'2000'),'ffffffff-0000-4000-8000-000000000001')$$,'42501','MESSAGE_HISTORY_UNAVAILABLE','foreign conversation uniformly unavailable');
select throws_ok($$select pg_temp.message_page(jsonb_set(pg_temp.message_page()->'next_cursor','{scope}',to_jsonb(repeat('0',64))))$$,'22023','MESSAGE_CURSOR_INVALID','message cursor cannot change scope');
do $$declare p jsonb;seen uuid[]:='{}';k integer:=0;begin
 p:=pg_temp.message_page();loop
  seen:=seen||array(select(x->>'id')::uuid from jsonb_array_elements(p->'items')x);k:=k+1;
  exit when not(p->>'has_more')::boolean;if k>11 then raise exception 'unbounded message pagination';end if;p:=pg_temp.message_page(p->'next_cursor');
 end loop;
 perform extensions.is(cardinality(seen),252,'all 252 messages retained across pages');
 perform extensions.is((select count(distinct x)::integer from unnest(seen)x),252,'equal occurred_at never duplicates or skips messages');
end;$$;
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000002',true);
select lives_ok($$select pg_temp.message_page()$$,'support retains authorized conversation context');
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000003',true);
select throws_ok($$select pg_temp.message_page()$$,'42501','MESSAGE_HISTORY_UNAVAILABLE','analyst cannot read private conversations');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select pg_temp.message_page()$$,'42501','MESSAGE_HISTORY_UNAVAILABLE','anonymous context denied');
select ok(not has_function_privilege('service_role','public.admin_conversation_message_page_v1(uuid,uuid,integer,jsonb)','EXECUTE'),'no new messaging service capability');
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);
set local role authenticated;
select lives_ok($$select public.admin_conversation_message_page_v1('61b02000-0000-4000-8000-000000006301',pg_temp.polat_conv(6301))$$,'actual authenticated role can execute its message read');
select lives_ok($$select public.admin_polat_experiment_page_v1('91cb1000-0000-4000-8000-000000008601')$$,'actual authenticated role can execute its experiment read');
select throws_ok($$select * from private.polat_experiment_runs$$,'42501',null,'actual authenticated role cannot select raw private evidence');
reset role;
with seed as materialized(select * from public.messages where tenant_id=pg_temp.polat_id(6301,'2000')limit 1)
insert into public.messages(id,tenant_id,conversation_id,messaging_contact_id,provider_connection_id,direction,content,status,provider_chat_id,idempotency_key,actor_type,correlation_id,occurred_at)
select '91cc9000-0000-4000-8000-000000000001',tenant_id,conversation_id,messaging_contact_id,provider_connection_id,'outbound','Synthetic unknown reply','pending',provider_chat_id,'master-unknown-review','HUMAN',extensions.gen_random_uuid(),clock_timestamp()from seed;
update public.conversations set attention_required=false where tenant_id=pg_temp.polat_id(6301,'2000');
select public.record_outbound_message_result(pg_temp.polat_id(6301,'2000'),'91cc9000-0000-4000-8000-000000000001','failed',null,0,'TELEGRAM_DELIVERY_UNCERTAIN',null);
select ok((select attention_required from public.conversations where tenant_id=pg_temp.polat_id(6301,'2000')),'unknown delivery is visible in the existing attention work list');
select is((select count(*)from public.audit_logs where tenant_id=pg_temp.polat_id(6301,'2000')and action='messaging.delivery_review_required'),1::bigint,'review marker and sanitized audit commit with the result');
select is((select retry_after_at from public.messages where id='91cc9000-0000-4000-8000-000000000001'),null::timestamptz,'review marker never schedules a blind retry');
select * from finish();rollback;
