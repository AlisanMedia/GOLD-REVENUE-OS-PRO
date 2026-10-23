-- Disposable synthetic PostgreSQL17. All rows and time changes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
\ir helpers/phase16de_fixtures.sql
create temp table rctx(k text primary key,v jsonb);
create function pg_temp.rnew() returns uuid language plpgsql as $$
declare cid uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();aid uuid;
begin
 update public.entitlement_jobs set available_at='infinity' where tenant_id='16de2000-0000-4000-8000-000000000001' and status in ('PENDING','RUNNING');
 insert into public.customers(id,tenant_id,display_name) values(cid,'16de2000-0000-4000-8000-000000000001','Synthetic R1 fixture');
 insert into public.subscriptions(id,tenant_id,customer_id,plan_version_id,mode,state,plan_snapshot,commercial_snapshot,starts_at,ends_at,grace_until,renewal_due_at)
 values(sid,'16de2000-0000-4000-8000-000000000001',cid,'16de5000-0000-4000-8000-000000000002','test','ACTIVE','{}','{}',now(),now()+interval '30 days',now()+interval '30 days',now()+interval '27 days');
 perform public.admin_test_access_setup('16de2000-0000-4000-8000-000000000001',cid,(select id from public.domain_events where customer_id=cid and event_type='customer.created'),'test:'||(1600000+(select count(*) from public.customers where tenant_id='16de2000-0000-4000-8000-000000000001'))::text);
 aid:=public.admin_request_entitlement_access('16de2000-0000-4000-8000-000000000001',sid);
 insert into rctx values('access',to_jsonb(aid)) on conflict(k) do update set v=excluded.v;
 return aid;
end;$$;
create function pg_temp.raid() returns uuid language sql as $$select (v#>>'{}')::uuid from rctx where k='access'$$;
create function pg_temp.rjid() returns uuid language sql as $$select (v->>'id')::uuid from rctx where k='job'$$;
create function pg_temp.rtoken() returns uuid language sql as $$select (v->>'lease_token')::uuid from rctx where k='job'$$;
create function pg_temp.rclaim() returns boolean language plpgsql as $$declare j jsonb;begin
 j:=nullif(public.entitlement_test_claim_cycle_v1('16de2000-0000-4000-8000-000000000001')->'job','null'::jsonb);
 insert into rctx values('job',j) on conflict(k) do update set v=excluded.v;return j is not null;
end;$$;
create function pg_temp.rcycle() returns text language plpgsql as $$declare c jsonb;begin
 c:=public.entitlement_test_claim_cycle_v1('16de2000-0000-4000-8000-000000000001');
 insert into rctx values('cycle',c) on conflict(k) do update set v=excluded.v;
 insert into rctx values('job',c->'job') on conflict(k) do update set v=excluded.v;
 return c->'job'->>'operation';
end;$$;
create function pg_temp.rbegin() returns boolean language sql as $$select public.entitlement_test_begin_effect_v1('16de2000-0000-4000-8000-000000000001',pg_temp.rjid(),pg_temp.rtoken())$$;
create function pg_temp.rcomplete(r jsonb) returns boolean language sql as $$select public.entitlement_complete_job('16de2000-0000-4000-8000-000000000001',pg_temp.rjid(),pg_temp.rtoken(),r)$$;
create function pg_temp.rexpire() returns void language sql as $$update public.entitlement_jobs set lease_until=now()-interval '1 second' where id=pg_temp.rjid()$$;

select pg_temp.rnew();
select ok(pg_temp.rclaim(),'R01 initial TEST claim');
select pg_temp.rexpire();select ok(pg_temp.rclaim(),'R02 first pre-dispatch crash reclaim');
select pg_temp.rexpire();select ok(pg_temp.rclaim(),'R03 second pre-dispatch crash reclaim');
insert into rctx select 'last_budget_job',v from rctx where k='job';
select pg_temp.rexpire();select is(pg_temp.rclaim(),false,'R04 third crash requires review');
select is((select claims||':'||reclaims from private.entitlement_test_runtime where job_id=(select (v->>'id')::uuid from rctx where k='last_budget_job')),'3:2','R05 persisted lifetime counters');
select is((select status||':'||last_error from public.entitlement_jobs where access_id=pg_temp.raid()),'FAILED:TEST_RECLAIM_BUDGET_EXHAUSTED','R06 exhausted job stays visible');
select is((select status from public.channel_access where id=pg_temp.raid()),'REVIEW','R07 no assumed external success');
select is(pg_temp.rclaim(),false,'R08 terminal review cannot restart');

select pg_temp.rnew();
select pg_temp.rclaim();select pg_temp.rexpire();select pg_temp.rclaim();select pg_temp.rexpire();select pg_temp.rclaim();
create function pg_temp.rfailures() returns setof text language plpgsql as $$declare n integer;aid uuid:=pg_temp.raid();begin
 for n in 1..5 loop
  if n>1 then
   update public.entitlement_jobs set available_at=now()-interval '1 second' where access_id=aid;
   return next ok(pg_temp.rclaim(),'R09 retry after definite failure '||n);
  end if;
  return next is(pg_temp.rcomplete('{"ok":false}'),false,'R10 failure is not confirmation '||n);
  return next is((select provider_failures from private.entitlement_test_runtime where job_id=pg_temp.rjid()),n,'R11 provider failures separate from reclaims '||n);
  return next is((select extract(epoch from available_at-now())::integer from public.entitlement_jobs where id=pg_temp.rjid()),least(300,10*(2^n)::integer),'R12 original backoff '||n);
 end loop;
end;$$;
select * from pg_temp.rfailures();
select is((select claims from private.entitlement_test_runtime where job_id=pg_temp.rjid()),7,'R13 total claims bounded at seven');
select is((select status from public.entitlement_jobs where id=pg_temp.rjid()),'FAILED','R14 five definite failures remain terminal');

select pg_temp.rnew();select pg_temp.rclaim();
select ok(pg_temp.rbegin(),'R15 dispatch marker commits before fake effect');
select is(pg_temp.rbegin(),false,'R16 replay cannot begin a second effect');
insert into rctx select 'old_dispatched_job',v from rctx where k='job';
select pg_temp.rexpire();
select throws_ok($$select pg_temp.rcomplete('{"ok":true}')$$,'42501','access lease denied','R17 expired completion denied');
select is(pg_temp.rclaim(),false,'R18 dispatched expired lease is not replayed');
select is((select status||':'||last_error from public.entitlement_jobs where access_id=pg_temp.raid()),'FAILED:TEST_UNKNOWN_EFFECT','R19 unknown remains review');
select ok((select uncertain from private.entitlement_test_runtime where job_id=(select (v->>'id')::uuid from rctx where k='old_dispatched_job')),'R20 uncertainty persists');
select is((select status from public.channel_access where id=pg_temp.raid()),'REVIEW','R21 no invented revoked/member state');
select throws_ok($$select public.entitlement_complete_job('16de2000-0000-4000-8000-000000000001',(select (v->>'id')::uuid from rctx where k='old_dispatched_job'),(select (v->>'lease_token')::uuid from rctx where k='old_dispatched_job'),'{"ok":true}')$$,'42501','access lease denied','R22 old token cannot finish after uncertainty');

select pg_temp.rnew();select pg_temp.rclaim();select pg_temp.rbegin();
select is(pg_temp.rcomplete('{"ok":false,"outcome":"unknown"}'),false,'R23 timeout/unknown result is not definite failure');
select is((select provider_failures from private.entitlement_test_runtime where job_id=pg_temp.rjid()),0,'R24 uncertainty does not consume provider-failure budget');
select is((select status||':'||last_error from public.entitlement_jobs where id=pg_temp.rjid()),'FAILED:TEST_UNKNOWN_EFFECT','R25 unknown response is review immediately');
-- A new revision cannot silently bypass unresolved admission uncertainty.
update public.subscriptions set revision=revision+1 where id=(select subscription_id from public.channel_access where id=pg_temp.raid());
select private.entitlement_enqueue((select subscription_id from public.channel_access where id=pg_temp.raid()),'invite');
select is(pg_temp.rcycle(),null::text,'R26 later admission revision still suppressed');
select is((select count(*) from public.entitlement_audit where subscription_id=(select subscription_id from public.channel_access where id=pg_temp.raid()) and action='job_claimed'),1::bigint,'R27 no repeat effect claim');

select pg_temp.rnew();select pg_temp.rclaim();select pg_temp.rbegin();
select ok(pg_temp.rcomplete(jsonb_build_object('ok',true,'invite_reference','test:invite:r1-once','expires_at',now()+interval '300 seconds')),'R28 committed success before lost completion ACK');
select throws_ok($$select pg_temp.rcomplete('{"ok":true}')$$,'42501','access lease denied','R29 completion replay cannot duplicate evidence');
select is(pg_temp.rclaim(),false,'R30 completed work not reclaimed');
select is((select count(*) from public.entitlement_audit where subscription_id=(select subscription_id from public.channel_access where id=pg_temp.raid()) and action='job_invite'),1::bigint,'R31 exactly one confirmed synthetic effect');

select pg_temp.rnew();select pg_temp.rclaim();
insert into rctx select 'pre_dispatch_old_token',v from rctx where k='job';
select pg_temp.rexpire();select ok(pg_temp.rclaim(),'R31a safe pre-dispatch reclaim');
select throws_ok($$select public.entitlement_complete_job('16de2000-0000-4000-8000-000000000001',(select (v->>'id')::uuid from rctx where k='pre_dispatch_old_token'),(select (v->>'lease_token')::uuid from rctx where k='pre_dispatch_old_token'),'{"ok":true}')$$,'42501','access lease denied','R31b old token denied while replacement lease is valid');

create function pg_temp.rmalformed() returns setof text language plpgsql as $$declare bad jsonb;begin
 for bad in select value from jsonb_array_elements('[{}, {"ok":"false"}, {"ok":null}, null]') loop
  perform pg_temp.rnew();perform pg_temp.rclaim();perform pg_temp.rbegin();
  return next is(pg_temp.rcomplete(bad),false,'R31c missing/invalid evidence is uncertainty');
  return next is((select status||':'||last_error from public.entitlement_jobs where id=pg_temp.rjid()),'FAILED:TEST_UNKNOWN_EFFECT','R31d malformed evidence never enables blind retry');
 end loop;
end;$$;
select * from pg_temp.rmalformed();

-- An audit insert failure must roll back the budget/review/job state together.
select pg_temp.rnew();select pg_temp.rclaim();select pg_temp.rbegin();select pg_temp.rexpire();
create function pg_temp.r_audit_fail() returns trigger language plpgsql as $$begin
 if new.action='test_job_review' then raise exception 'synthetic audit failure' using errcode='P0001';end if;return new;
end;$$;
create trigger r_audit_fault before insert on public.entitlement_audit for each row execute function pg_temp.r_audit_fail();
select throws_ok($$select pg_temp.rclaim()$$,'P0001','synthetic audit failure','R31e failed audit aborts uncertainty transition');
select is((select status from public.entitlement_jobs where id=pg_temp.rjid()),'RUNNING','R31f atomic rollback retains previous job');
select is((select claims||':'||dispatch_started||':'||uncertain from private.entitlement_test_runtime where job_id=pg_temp.rjid()),'1:true:false','R31g budget/effect state also rolled back');
drop trigger r_audit_fault on public.entitlement_audit;
select is(pg_temp.rclaim(),false,'R31h safe recovery records uncertainty, never repeats effect');

select pg_temp.rnew();select pg_temp.rclaim();select pg_temp.rbegin();
insert into rctx select 'late_after_terminal',v from rctx where k='job';
select public.admin_subscription_control('16de2000-0000-4000-8000-000000000001',(select subscription_id from public.channel_access where id=pg_temp.raid()),'reconcile',gen_random_uuid());
select is(pg_temp.rcycle(),'reconcile','R31i current reconcile may finish before old in-flight result');
select pg_temp.rbegin();select ok(pg_temp.rcomplete('{"ok":true,"membership":"member"}'),'R31j current fake observation confirmed');
update rctx set v=(select v from rctx where k='late_after_terminal') where k='job';
select is(pg_temp.rcomplete(jsonb_build_object('ok',true,'invite_reference','test:invite:late-after-reconcile','expires_at',now()+interval '300 seconds')),false,'R31k old effect cannot reuse prior DONE observation');
select is((select status||':'||last_error from public.entitlement_jobs where id=pg_temp.rjid()),'FAILED:TEST_UNKNOWN_EFFECT','R31l new repair need remains visible for review');
select is((select status from public.channel_access where id=pg_temp.raid()),'REVIEW','R31m previous membership does not hide later uncertainty');

select pg_temp.rnew();
select ok(public.entitlement_claim_job('16de2000-0000-4000-8000-000000000001') is not null,'R31n legacy signature still returns a TEST lease');
select ok((select legacy_untracked from private.entitlement_test_runtime r join public.entitlement_jobs j on j.id=r.job_id where j.access_id=pg_temp.raid()),'R31o legacy effect cannot be assumed unstarted');
update public.entitlement_jobs set lease_until=now()-interval '1 second' where access_id=pg_temp.raid();
select is(public.entitlement_claim_job('16de2000-0000-4000-8000-000000000001'),null::jsonb,'R31p legacy RPC cannot bypass unknown-effect review');
select is((select status||':'||last_error from public.entitlement_jobs where access_id=pg_temp.raid()),'FAILED:TEST_UNKNOWN_EFFECT','R31q legacy unknown stays visible without resend');

select pg_temp.rnew();
insert into private.entitlement_test_policy(tenant_id,admission_enabled,reconciliation_enabled,revocation_enabled)
 values('16de2000-0000-4000-8000-000000000001',false,true,false)
 on conflict(tenant_id) do update set admission_enabled=false,reconciliation_enabled=true,revocation_enabled=false,next_lane=0;
select is(pg_temp.rcycle(),null::text,'R32 disabled admission cannot grant');
select is((select attempts from public.entitlement_jobs where access_id=pg_temp.raid()),0,'R33 denial does not burn claim budget');
select private.entitlement_enqueue((select subscription_id from public.channel_access where id=pg_temp.raid()),'revoke');
select private.entitlement_enqueue((select subscription_id from public.channel_access where id=pg_temp.raid()),'reconcile');
select is(pg_temp.rcycle(),'reconcile','R34 reconciliation independent of admission/revoke');
select ok(pg_temp.rbegin(),'R35 authorized TEST observation begins');
select ok(pg_temp.rcomplete('{"ok":true,"membership":"left"}'),'R36 observation is not access admission');
update private.entitlement_test_policy set reconciliation_enabled=false where tenant_id='16de2000-0000-4000-8000-000000000001';
select is(pg_temp.rcycle(),null::text,'R37 repair invitation still requires admission');
update public.subscriptions set state='HOLD',revision=revision+1 where id=(select subscription_id from public.channel_access where id=pg_temp.raid());
select private.entitlement_enqueue((select subscription_id from public.channel_access where id=pg_temp.raid()),'revoke');
update private.entitlement_test_policy set revocation_enabled=true where tenant_id='16de2000-0000-4000-8000-000000000001';
select is(pg_temp.rcycle(),'revoke','R38 TEST cleanup independent from new admission');
select ok(pg_temp.rbegin(),'R39 authorized fake revoke begins');
select ok(pg_temp.rcomplete('{"ok":true}'),'R40 only confirmed fake revoke changes state');
select is((select status from public.channel_access where id=pg_temp.raid()),'REVOKED','R41 evidence-backed TEST revoke');
update private.entitlement_test_policy set admission_enabled=true,reconciliation_enabled=true,revocation_enabled=true,next_lane=0 where tenant_id='16de2000-0000-4000-8000-000000000001';

-- Large same-lane backlog, duplicate timestamps, deterministic UUID tie-break.
select pg_temp.rnew();
update public.subscriptions set state='HOLD',revision=2049 where id=(select subscription_id from public.channel_access where id=pg_temp.raid());
insert into public.entitlement_jobs(id,tenant_id,access_id,revision,operation,available_at)
 select ('16f19000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'16de2000-0000-4000-8000-000000000001',pg_temp.raid(),n,'revoke',now()-interval '1 day' from generate_series(1,1024) n;
select private.entitlement_enqueue((select subscription_id from public.channel_access where id=pg_temp.raid()),'revoke');
select is(pg_temp.rcycle(),null::text,'R42 first batch does not fake completion');
select is((select (v->>'examined')::int from rctx where k='cycle'),32,'R43 hard per-cycle candidate bound');
select ok((select (v->>'has_more')::boolean from rctx where k='cycle'),'R44 incomplete queue reported honestly');
create function pg_temp.rdrain() returns setof text language plpgsql as $$declare cycle integer;op text;begin
 for cycle in 1..34 loop
  op:=pg_temp.rcycle();
  return next ok((select (v->>'examined')::int<=32 from rctx where k='cycle'),'R45 bounded drain cycle '||cycle);
  if op is not null then
   return next is(op,'revoke','R46 current revoke survives obsolete history');
   return next ok(cycle<=33,'R47 finite backlog cannot starve valid revoke');return;
  end if;
 end loop;
 return next ok(false,'R48 missing valid revoke after drain budget');
end;$$;
select * from pg_temp.rdrain();
select ok(pg_temp.rbegin(),'R49 only current valid revoke dispatched');
select ok(pg_temp.rcomplete('{"ok":true}'),'R50 confirmed fake cleanup after backlog');
select is((select count(*) from public.entitlement_jobs where access_id=pg_temp.raid() and operation='revoke' and status='STALE'),1024::bigint,'R51 old obligations retained as immutable-audited STALE jobs');
select is((select count(*) from public.entitlement_jobs where access_id=pg_temp.raid() and operation='revoke' and status='DONE'),1::bigint,'R52 exactly one current cleanup');

-- Equal timestamps do not override lane fairness; each workload gets its turn.
select pg_temp.rnew();insert into rctx select 'lane_revoke_access',v from rctx where k='access';
select pg_temp.rnew();insert into rctx select 'lane_reconcile_access',v from rctx where k='access';
select pg_temp.rnew();
select private.entitlement_enqueue((select subscription_id from public.channel_access where id=(select (v#>>'{}')::uuid from rctx where k='lane_revoke_access')),'revoke');
select private.entitlement_enqueue((select subscription_id from public.channel_access where id=(select (v#>>'{}')::uuid from rctx where k='lane_reconcile_access')),'reconcile');
update private.entitlement_test_policy set next_lane=0 where tenant_id='16de2000-0000-4000-8000-000000000001';
select is(pg_temp.rcycle(),'revoke','R52a fair lane 0');
select is(pg_temp.rcycle(),'reconcile','R52b fair lane 1');
select is(pg_temp.rcycle(),'invite','R52c fair lane 2');

-- Current revision is refreshed for obsolete reconcile/revoke, not dropped.
select pg_temp.rnew();
select private.entitlement_enqueue((select subscription_id from public.channel_access where id=pg_temp.raid()),'reconcile');
update public.subscriptions set state='HOLD',revision=2 where id=(select subscription_id from public.channel_access where id=pg_temp.raid());
select pg_temp.rcycle();
select is((select count(*) from public.entitlement_jobs where access_id=pg_temp.raid() and operation='revoke' and revision=2),1::bigint,'R53 stale reconciliation retains current cleanup obligation');

select ok(not has_table_privilege('service_role','private.entitlement_test_runtime','UPDATE'),'R54 runtime cannot reset lifetime budget');
select ok(not has_table_privilege('service_role','private.entitlement_test_policy','UPDATE'),'R55 runtime cannot change independent authorities');
select ok(not has_table_privilege('authenticated','private.entitlement_test_runtime','SELECT'),'R56 no public raw runtime state');
select ok(not has_function_privilege('authenticated','public.entitlement_test_claim_cycle_v1(uuid)','EXECUTE'),'R57 browser/AI cannot claim');
select ok(not has_function_privilege('authenticated','public.entitlement_test_begin_effect_v1(uuid,uuid,uuid)','EXECUTE'),'R58 browser/AI cannot dispatch');
select ok(has_function_privilege('service_role','public.entitlement_test_claim_cycle_v1(uuid)','EXECUTE'),'R59 existing backend can run TEST cycle');
select ok(not has_function_privilege('service_role','private.entitlement_test_claim_selected_v1(uuid)','EXECUTE'),'R60 no private helper bypass grant');
-- The second fixture tenant is itself a valid isolated TEST tenant; it may see
-- its own empty queue, never another tenant's job. This is service-role-only.
select is(public.entitlement_test_claim_cycle_v1('16de2000-0000-4000-8000-000000000002')->'job','null'::jsonb,'R62 cross-tenant job invisible');
select throws_ok($$select public.entitlement_test_begin_effect_v1('16de2000-0000-4000-8000-000000000002',pg_temp.rjid(),pg_temp.rtoken())$$,'42501','access lease denied','R63 foreign lease denied');
select throws_ok($$select public.entitlement_test_claim_cycle_v1(gen_random_uuid())$$,'42501','isolated test authority required','R64 unknown tenant denied');
update public.tenants set outbound_messaging_enabled=true where id='16de2000-0000-4000-8000-000000000001';
select throws_ok($$select public.entitlement_test_claim_cycle_v1('16de2000-0000-4000-8000-000000000001')$$,'42501','isolated test authority required','R65 outbound-on tenant is not a TEST namespace');
update public.tenants set outbound_messaging_enabled=false where id='16de2000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.entitlement_test_claim_cycle_v1('16de2000-0000-4000-8000-000000000001')$$,'42501',null,'R66 authenticated role denied');
reset role;
select throws_ok($$update public.entitlement_audit set details='{}'$$,'42501','entitlement evidence immutable','R67 audit remains append-only');
select is((select count(*) from private.verified_payment_receipts),0::bigint,'R68 no genuine financial receipts');
select is((select count(*) from public.domain_events where event_type='payment.confirmed'),0::bigint,'R69 no trusted live payment event');
select is((select count(*) from public.subscription_payments),1::bigint,'R70 original period count unchanged');
select ok(not exists(select 1 from private.entitlement_controls where live_enabled),'R71 global LIVE authority unchanged/off');
select ok(not private.entitlement_live_allowed('16de2000-0000-4000-8000-000000000001'),'R72 separate TEST policy cannot enable LIVE');

-- LIVE-shaped negative fixture only, in this rolled-back DB transaction; no
-- live receipt, event, entitlement consumer, adapter or external API is used.
select pg_temp.rnew();
do $$declare cid uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();bid uuid:=gen_random_uuid();chid uuid:=gen_random_uuid();aid uuid:=gen_random_uuid();jid uuid:=gen_random_uuid();begin
 update public.entitlement_jobs set available_at='infinity' where tenant_id='16de2000-0000-4000-8000-000000000001';
 insert into public.customers(id,tenant_id,display_name) values(cid,'16de2000-0000-4000-8000-000000000001','Synthetic LIVE-denial fixture');
 insert into public.subscriptions(id,tenant_id,customer_id,plan_version_id,mode,state,plan_snapshot,commercial_snapshot,starts_at,ends_at,grace_until,renewal_due_at)
 values(sid,'16de2000-0000-4000-8000-000000000001',cid,'16de5000-0000-4000-8000-000000000002','live','HOLD','{}','{}',now(),now()+interval '1 day',now()+interval '1 day',now());
 insert into public.telegram_entitlement_bindings(id,tenant_id,customer_id,mode,telegram_user_id,source_event_id)
 values(bid,'16de2000-0000-4000-8000-000000000001',cid,'live','160000000001',(select id from public.domain_events where customer_id=cid and event_type='customer.created'));
 insert into public.vip_channels(id,tenant_id,mode,chat_id,enabled,private_verified,approval_reference)
 values(chid,'16de2000-0000-4000-8000-000000000001','live','-100160000000001',true,true,'synthetic-negative-fixture-only');
 insert into public.channel_access(id,tenant_id,subscription_id,binding_id,channel_id,mode)
 values(aid,'16de2000-0000-4000-8000-000000000001',sid,bid,chid,'live');
 insert into public.entitlement_jobs(id,tenant_id,access_id,revision,operation) values(jid,'16de2000-0000-4000-8000-000000000001',aid,1,'revoke');
 insert into rctx values('live_negative_job',jsonb_build_object('id',jid,'lease_token',gen_random_uuid()));
end;$$;
select is(public.entitlement_claim_job('16de2000-0000-4000-8000-000000000001'),null::jsonb,'R73 original LIVE-off claim denies revoke');
select is(public.entitlement_test_claim_cycle_v1('16de2000-0000-4000-8000-000000000001')->'job','null'::jsonb,'R74 TEST cycle never leases LIVE-shaped work');
update public.entitlement_jobs set status='RUNNING',lease_until=now()+interval '60 seconds',lease_token=(select (v->>'lease_token')::uuid from rctx where k='live_negative_job') where id=(select (v->>'id')::uuid from rctx where k='live_negative_job');
select throws_ok($$select public.entitlement_test_begin_effect_v1('16de2000-0000-4000-8000-000000000001',(select (v->>'id')::uuid from rctx where k='live_negative_job'),(select (v->>'lease_token')::uuid from rctx where k='live_negative_job'))$$,'42501','isolated test authority required','R75 TEST policy cannot begin LIVE revoke');
select throws_ok($$select public.entitlement_complete_job('16de2000-0000-4000-8000-000000000001',(select (v->>'id')::uuid from rctx where k='live_negative_job'),(select (v->>'lease_token')::uuid from rctx where k='live_negative_job'),'{"ok":true}')$$,'42501','access mode denied','R76 original LIVE-off completion denied');
select is((select a.status from public.channel_access a join public.entitlement_jobs j on j.access_id=a.id where j.id=(select (v->>'id')::uuid from rctx where k='live_negative_job')),'PENDING','R77 no false LIVE revoke state');
select is((select count(*) from private.verified_payment_receipts),0::bigint,'R78 negative fixtures create no genuine authority');
select * from finish();
rollback;
