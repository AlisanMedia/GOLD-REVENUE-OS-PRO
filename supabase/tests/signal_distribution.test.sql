begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
\ir helpers/signal_distribution_fixtures.sql
create temp table signal_d(k text primary key,v jsonb);
create temp table signal_financial_before as select jsonb_build_object('invoices',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'[]')) from public.payment_invoices x),'periods',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'[]')) from public.subscription_payments x),'subscriptions',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'[]')) from public.subscriptions x),'access',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'[]')) from public.channel_access x),'receipts',(select count(*) from private.verified_payment_receipts),'trusted',(select count(*) from public.domain_events where event_type='payment.confirmed')) v;
select pg_temp.signal_case_setup(n) from generate_series(1,15)n;
select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(1));
select is((select count(*)::int from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(1,'2000')),1,'event and one routed delivery commit atomically');
select is(private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(1))->>'duplicate','true','source replay is idempotent');
select is((select count(*)::int from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(1,'2000')),1,'replay creates no second destination job');
insert into signal_d values('lease',private.signal_claim_fixture_v1(pg_temp.signal_case_id(1,'2000')));
select is((select v->>'state' from signal_d where k='lease'),'LEASED','valid fake job leased');
insert into signal_d select 'prepared',private.signal_begin_fixture_v1(pg_temp.signal_case_id(1,'2000'),(v->>'delivery_id')::uuid,(v->>'lease_token')::uuid) from signal_d where k='lease';
select is((select v->'payload'->>'operation' from signal_d where k='prepared'),'SEND','initial source becomes first synthetic send');
select is((select v->'payload'->>'text' from signal_d where k='prepared'),'BUY XAUUSD LIMIT 2700.010 SL 2690.000 TP 2720.10','original levels and precision unchanged');
select is(private.signal_begin_fixture_v1(pg_temp.signal_case_id(1,'2000'),(select (v->>'delivery_id')::uuid from signal_d where k='lease'),(select (v->>'lease_token')::uuid from signal_d where k='lease'))->>'state','FENCED','durable begin cannot execute twice');
insert into signal_d values('first-ack',pg_temp.signal_ack((select v->'payload' from signal_d where k='prepared'))::jsonb);
select is(private.signal_finish_fixture_v1(pg_temp.signal_case_id(1,'2000'),(select (v->>'delivery_id')::uuid from signal_d where k='lease'),(select (v->>'lease_token')::uuid from signal_d where k='lease'),(select v::text from signal_d where k='first-ack'))->>'state','FAKE_CONFIRMED','only matching fake acknowledgement confirms');
select is(private.signal_finish_fixture_v1(pg_temp.signal_case_id(1,'2000'),(select (v->>'delivery_id')::uuid from signal_d where k='lease'),(select (v->>'lease_token')::uuid from signal_d where k='lease'),(select v::text from signal_d where k='first-ack'))->>'replay','true','lost completion response safely replayed');
select is((select count(*)::int from private.signal_delivery_history where tenant_id=pg_temp.signal_case_id(1,'2000') and code='FAKE_ACK'),1,'one fake acknowledgement history');
select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(1,'one',2,'EDIT'));
select is(pg_temp.signal_work(1)->>'state','FAKE_CONFIRMED','source edit processed');
select is((select operation from private.signal_attempts where tenant_id=pg_temp.signal_case_id(1,'2000') order by started_at desc limit 1),'EDIT','edit targets prior fake message instead of duplicate new signal');
select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(1,'one',3,'DELETE'));
select is(pg_temp.signal_work(1)->>'state','FAKE_CONFIRMED','known fake deletion acknowledged');
select ok((select deleted from private.signal_message_bindings where tenant_id=pg_temp.signal_case_id(1,'2000')),'fake deletion state retained separately from original evidence');
select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(1,'one',4,'DELETE'));
select is(pg_temp.signal_work(1)->>'state','NO_EFFECT','deletion without an existing target is not a claimed successful send');
select is((select count(*)::int from private.signal_events where tenant_id=pg_temp.signal_case_id(1,'2000')),4,'edit/delete never erase history');

-- Unknown acknowledgement, expiry and independent fixture reconciliation.
select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(2));
insert into signal_d values('unknown-lease',private.signal_claim_fixture_v1(pg_temp.signal_case_id(2,'2000')));
insert into signal_d select 'unknown-prepared',private.signal_begin_fixture_v1(pg_temp.signal_case_id(2,'2000'),(v->>'delivery_id')::uuid,(v->>'lease_token')::uuid) from signal_d where k='unknown-lease';
select throws_ok($$select private.signal_finish_fixture_v1(pg_temp.signal_case_id(2,'2000'),(select (v->>'delivery_id')::uuid from signal_d where k='unknown-lease'),(select (v->>'lease_token')::uuid from signal_d where k='unknown-lease'),jsonb_set(pg_temp.signal_ack((select v->'payload' from signal_d where k='unknown-prepared'))::jsonb,'{destination_ref}','"fixture:foreign"')::text)$$,'22023','SIGNAL_ACK_INVALID','wrong destination cannot confirm a delivery');
update private.signal_deliveries set lease_until=clock_timestamp()-interval '1 second' where tenant_id=pg_temp.signal_case_id(2,'2000');
select is(private.signal_claim_fixture_v1(pg_temp.signal_case_id(2,'2000'))->>'state','NO_LEASE','expired begun effect does not get another lease');
select is((select status from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(2,'2000')),'UNKNOWN','possible external effect remains explicitly unknown');
select is((select count(*)::int from private.signal_attempts where tenant_id=pg_temp.signal_case_id(2,'2000')),1,'no blind repeat of started effect');
select is(private.signal_begin_fixture_v1(pg_temp.signal_case_id(2,'2000'),(select (v->>'delivery_id')::uuid from signal_d where k='unknown-lease'),(select (v->>'lease_token')::uuid from signal_d where k='unknown-lease'))->>'state','FENCED','stale token cannot dispatch');
select is(private.signal_finish_fixture_v1(pg_temp.signal_case_id(2,'2000'),(select (v->>'delivery_id')::uuid from signal_d where k='unknown-lease'),null,pg_temp.signal_ack((select v->'payload' from signal_d where k='unknown-prepared')),true)->>'state','FAKE_CONFIRMED','separate fake ledger acknowledgement reconciles unknown');
select is((select count(*)::int from private.signal_delivery_history where tenant_id=pg_temp.signal_case_id(2,'2000') and code='UNKNOWN_EFFECT'),1,'uncertain history is not rewritten after reconciliation');

select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(3));
select private.signal_claim_fixture_v1(pg_temp.signal_case_id(3,'2000'));
do $$begin for n in 1..3 loop update private.signal_deliveries set lease_until=clock_timestamp()-interval '1 second' where tenant_id=pg_temp.signal_case_id(3,'2000');perform private.signal_claim_fixture_v1(pg_temp.signal_case_id(3,'2000'));end loop;end;$$;
select is((select claims from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(3,'2000')),3,'two safe pre-effect reclaims form finite lifetime budget');
select is((select reclaims from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(3,'2000')),2,'persisted reclaim budget');
select is((select status from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(3,'2000')),'REVIEW','crash budget exhaustion visible for review');
select is((select count(*)::int from private.signal_attempts where tenant_id=pg_temp.signal_case_id(3,'2000')),0,'pre-effect crash is not a claimed provider attempt');

select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(4));
do $$begin for n in 1..5 loop perform pg_temp.signal_work(4,'KNOWN_FAILURE');update private.signal_deliveries set available_at=clock_timestamp()-interval '1 second' where tenant_id=pg_temp.signal_case_id(4,'2000') and status='RETRY';end loop;end;$$;
select is((select failures from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(4,'2000')),5,'five definite failures retained');
select is((select status from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(4,'2000')),'REVIEW','provider failure budget exhausted safely');
select is((select claims from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(4,'2000')),5,'no unlimited claims after failures');
select is((select count(*)::int from private.signal_delivery_history where tenant_id=pg_temp.signal_case_id(4,'2000') and code='FAKE_ACK'),0,'failures never fabricated as fake success');
select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(5));
select is(pg_temp.signal_work(5,'RATE_LIMITED',2000)->>'state','RETRY','rate limit creates bounded deferred work');
select ok((select available_at>clock_timestamp()+interval '1500 milliseconds' from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(5,'2000')),'honors bounded retry-after');
select is(private.signal_claim_fixture_v1(pg_temp.signal_case_id(5,'2000'))->>'state','NO_LEASE','does not spin during backoff');
update private.signal_deliveries set available_at=clock_timestamp()-interval '1 second' where tenant_id=pg_temp.signal_case_id(5,'2000');
select is(pg_temp.signal_work(5)->>'state','FAKE_CONFIRMED','safe explicit failure can later retry');

select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(6));
insert into signal_d values('old-lease',private.signal_claim_fixture_v1(pg_temp.signal_case_id(6,'2000')));
insert into signal_d select 'old-prepared',private.signal_begin_fixture_v1(pg_temp.signal_case_id(6,'2000'),(v->>'delivery_id')::uuid,(v->>'lease_token')::uuid) from signal_d where k='old-lease';
select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(6,'one',2,'EDIT'));
select is(private.signal_finish_fixture_v1(pg_temp.signal_case_id(6,'2000'),(select (v->>'delivery_id')::uuid from signal_d where k='old-lease'),(select (v->>'lease_token')::uuid from signal_d where k='old-lease'),pg_temp.signal_ack((select v->'payload' from signal_d where k='old-prepared')))->>'state','STALE_ACK','late old effect is recorded but not declared current');
select is(pg_temp.signal_work(6)->>'state','FAKE_CONFIRMED','current edit uses the known prior fake binding');
select is((select revision from private.signal_message_bindings where tenant_id=pg_temp.signal_case_id(6,'2000')),2,'stale effect cannot overwrite newer binding');

-- Deep obsolete queue; every cycle bounded, latest valid work eventually runs.
do $$begin for n in 1..129 loop perform private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(7,'burst',n));end loop;end;$$;
create temp table signal_drains as select private.signal_claim_fixture_v1(pg_temp.signal_case_id(7,'2000')) v from generate_series(1,8);
select ok((select max((v->>'drained')::int)<=32 from signal_drains),'stale draining bounded to32 per cycle');
select is((select count(*)::int from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(7,'2000') and status='STALE'),128,'obsolete queue evidence retained and drained');
select is((select count(*)::int from signal_drains where v->>'state'='LEASED'),1,'one latest valid lease after stale backlog');
select is(private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(7,'burst',2))->>'duplicate','true','old replay does not requeue trading instructions');

select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(8));
select private.signal_pause_fixture_v1(pg_temp.signal_case_id(8,'2000'),'provider',pg_temp.signal_case_id(8,'4000'),true);
select is(private.signal_claim_fixture_v1(pg_temp.signal_case_id(8,'2000'))->>'state','NO_LEASE','provider pause prevents dispatch');
select is((select status from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(8,'2000')),'REVIEW','held obligation is not silently discarded');
select private.signal_pause_fixture_v1(pg_temp.signal_case_id(8,'2000'),'provider',pg_temp.signal_case_id(8,'4000'),false);
select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(8,'fresh'));
select is(pg_temp.signal_work(8)->>'state','FAKE_CONFIRMED','new event after resume uses current policy');
select private.signal_pause_fixture_v1(pg_temp.signal_case_id(8,'2000'),'global',null,true);
select is(private.signal_claim_fixture_v1(pg_temp.signal_case_id(8,'2000'))->>'state','PAUSED','global pause preserved');
select throws_ok($$select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(8,'global-stopped'))$$,'42501','signal scope unavailable','global stop also blocks new ingestion');

select private.signal_record_fixture_v1(jsonb_set(pg_temp.signal_dispatch_input(9)::jsonb,'{observed_at}',to_jsonb(clock_timestamp()-interval '61 seconds'))::text);
select is(private.signal_claim_fixture_v1(pg_temp.signal_case_id(9,'2000'))->>'state','NO_LEASE','expired source does not dispatch');
select is((select last_code from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(9,'2000')),'SOURCE_AGE_REVIEW','source age measured from observation, not publication guess');
select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(10,'protected',1,'RESTRICTED'));
select private.signal_record_fixture_v1(jsonb_set(pg_temp.signal_dispatch_input(10,'uncertain')::jsonb,'{interpretation}','null')::text);
select is(private.signal_claim_fixture_v1(pg_temp.signal_case_id(10,'2000'))->>'state','NO_LEASE','protected and ambiguous content never silently forwarded');
select is((select count(*)::int from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(10,'2000') and status='REVIEW'),2,'both review obligations visible');
select is((select count(*)::int from private.signal_attempts where tenant_id=pg_temp.signal_case_id(10,'2000')),0,'no effect on restricted source');

select is(private.signal_record_fixture_batch_v1(pg_temp.signal_case_id(11,'2000'),pg_temp.signal_case_id(11,'3000'),0,2,array[pg_temp.signal_dispatch_input(11,'a'),pg_temp.signal_dispatch_input(11,'b')])->>'processed','2','checkpoint and event/job/audit batch commit together');
select is(private.signal_record_fixture_batch_v1(pg_temp.signal_case_id(11,'2000'),pg_temp.signal_case_id(11,'3000'),0,2,array[pg_temp.signal_dispatch_input(11,'a'),pg_temp.signal_dispatch_input(11,'b')])->>'replay','true','unknown COMMIT replay recovers same checkpoint');
select throws_ok($$select private.signal_record_fixture_batch_v1(pg_temp.signal_case_id(11,'2000'),pg_temp.signal_case_id(11,'3000'),2,4,array[pg_temp.signal_dispatch_input(11,'c'),pg_temp.signal_dispatch_input(12,'foreign')])$$,'22023','SIGNAL_BATCH_SCOPE','partial failed batch cannot advance checkpoint');
select is((select fixture_offset::text from private.signal_sources where id=pg_temp.signal_case_id(11,'3000')),'2','failed batch rollback preserves offset');
select is((select count(*)::int from private.signal_events where tenant_id=pg_temp.signal_case_id(11,'2000')),2,'partial failed batch leaves no half evidence');
select throws_ok($$select private.signal_record_fixture_batch_v1(pg_temp.signal_case_id(11,'2000'),pg_temp.signal_case_id(11,'3000'),0,3,array[pg_temp.signal_dispatch_input(11,'c')])$$,'40001','SIGNAL_CHECKPOINT_FENCED','stale producer fenced');
select throws_ok($$select private.signal_record_fixture_batch_v1(pg_temp.signal_case_id(11,'2000'),pg_temp.signal_case_id(11,'3000'),2,28,array_fill(pg_temp.signal_dispatch_input(11),array[26]))$$,'22023','SIGNAL_BATCH_INVALID','batch hard bound enforced');

select private.signal_record_fixture_v1(jsonb_set(pg_temp.signal_dispatch_input(12)::jsonb,'{reply_to}','"unobserved-parent"')::text);
select is(pg_temp.signal_work(12)->>'state','HELD','unresolved reply cannot lose its context silently');
select is((select last_code from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(12,'2000')),'REFERENCE_UNRESOLVED','reply review reason retained');
select private.signal_record_fixture_v1(jsonb_set(pg_temp.signal_dispatch_input(13)::jsonb,'{original_text}',to_jsonb(repeat('x',4097)))::text);
select is(pg_temp.signal_work(13)->>'state','HELD','oversized original is not truncated or split into invented instructions');
select is((select length(original->>'original_text') from private.signal_events where tenant_id=pg_temp.signal_case_id(13,'2000')),4097,'original oversized evidence preserved');
select is((select count(*)::int from private.signal_attempts where tenant_id=pg_temp.signal_case_id(13,'2000')),0,'no transport attempt for unsupported content');
select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(14));
insert into signal_d values('policy-lease',private.signal_claim_fixture_v1(pg_temp.signal_case_id(14,'2000')));
select private.signal_pause_fixture_v1(pg_temp.signal_case_id(14,'2000'),'route',pg_temp.signal_case_id(14,'6000'),true);
select private.signal_pause_fixture_v1(pg_temp.signal_case_id(14,'2000'),'route',pg_temp.signal_case_id(14,'6000'),false);
select is(private.signal_begin_fixture_v1(pg_temp.signal_case_id(14,'2000'),(select (v->>'delivery_id')::uuid from signal_d where k='policy-lease'),(select (v->>'lease_token')::uuid from signal_d where k='policy-lease'))->>'state','HELD','pause/resume revision cannot revive an old lease');
select is((select last_code from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(14,'2000')),'CONFIG_CHANGED','policy revision fenced at durable begin');

-- The100-route bound is enforced atomically; never silently truncate fan-out.
insert into private.signal_destinations(id,tenant_id,label,destination_ref,paused) select pg_temp.signal_case_id(n,'5a00'),pg_temp.signal_case_id(15,'2000'),'Synthetic fanout','fixture:fanout-'||n,false from generate_series(1,100)n;
insert into private.signal_routes(id,tenant_id,source_id,destination_id,paused) select pg_temp.signal_case_id(n,'6a00'),pg_temp.signal_case_id(15,'2000'),pg_temp.signal_case_id(15,'3000'),pg_temp.signal_case_id(n,'5a00'),false from generate_series(1,100)n;
select throws_ok($$select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(15))$$,'22023','SIGNAL_ROUTE_BOUND','oversized routing fails closed rather than dropping targets');
select is((select count(*)::int from private.signal_deliveries where tenant_id=pg_temp.signal_case_id(15,'2000')),0,'failed fanout leaves no partial delivery queue');
select is((select count(*)::int from private.signal_events where tenant_id=pg_temp.signal_case_id(15,'2000')),0,'failed fanout leaves no partial event');
select is((select count(*)::int from private.signal_delivery_history where tenant_id=pg_temp.signal_case_id(15,'2000')),0,'failed fanout leaves no phantom audit receipts');
select ok(not has_function_privilege('service_role','private.signal_claim_fixture_v1(uuid)','EXECUTE'),'no service worker claim authority');
select ok(not has_function_privilege('authenticated','private.signal_finish_fixture_v1(uuid,uuid,uuid,text,boolean)','EXECUTE'),'no browser fake acknowledgement writer');
select ok(not has_table_privilege('authenticated','private.signal_attempts','SELECT'),'private payload/lease evidence not exposed');
select ok(not has_table_privilege('service_role','private.signal_message_bindings','INSERT'),'no raw mapping writer');
set local role authenticated;
select throws_ok($$select private.signal_claim_fixture_v1('51b02000-0000-4000-8000-000000000001')$$,'42501',null,'actual authenticated fixture writer denial');
reset role;
select throws_ok($$update private.signal_attempts set operation='SEND'$$,'42501','FSE_IMMUTABLE','attempts immutable');
select throws_ok($$delete from private.signal_delivery_history$$,'42501','FSE_IMMUTABLE','delivery history immutable');
select is(jsonb_build_object('invoices',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'[]')) from public.payment_invoices x),'periods',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'[]')) from public.subscription_payments x),'subscriptions',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'[]')) from public.subscriptions x),'access',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'[]')) from public.channel_access x),'receipts',(select count(*) from private.verified_payment_receipts),'trusted',(select count(*) from public.domain_events where event_type='payment.confirmed')),(select v from signal_financial_before),'all financial/subscription/access records and authority unchanged');
select * from finish();rollback;
