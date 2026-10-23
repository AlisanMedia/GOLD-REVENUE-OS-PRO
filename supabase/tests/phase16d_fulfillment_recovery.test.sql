-- Synthetic PostgreSQL only. Time changes affect only these rolled-back fixtures.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
\ir helpers/phase16de_fixtures.sql
create temp table dctx(k text primary key,v jsonb);
insert into dctx select 'subscription',to_jsonb(id) from public.subscriptions where tenant_id='16de2000-0000-4000-8000-000000000001';
insert into dctx select 'access',to_jsonb(id) from public.channel_access where tenant_id='16de2000-0000-4000-8000-000000000001';
create function pg_temp.dsub() returns uuid language sql as $$select (v#>>'{}')::uuid from dctx where k='subscription'$$;
create function pg_temp.daccess() returns uuid language sql as $$select (v#>>'{}')::uuid from dctx where k='access'$$;
create function pg_temp.dclaim() returns boolean language plpgsql as $$declare j jsonb;begin
 -- Explicit tracked TEST acquisition distinguishes a safe pre-dispatch loss
 -- from the conservative unknown-effect treatment of legacy issued leases.
 j:=nullif(public.entitlement_test_claim_cycle_v1('16de2000-0000-4000-8000-000000000001')->'job','null'::jsonb);
 insert into dctx values('job',j) on conflict(k) do update set v=excluded.v;return j is not null;end;$$;
create function pg_temp.dcomplete(result_value jsonb) returns boolean language sql as $$
 select public.entitlement_complete_job('16de2000-0000-4000-8000-000000000001',(v->>'id')::uuid,(v->>'lease_token')::uuid,result_value) from dctx where k='job';$$;
create function pg_temp.dcontrol(action_value text) returns boolean language sql as $$
 select public.admin_subscription_control('16de2000-0000-4000-8000-000000000001',pg_temp.dsub(),action_value,gen_random_uuid());$$;

select is((select count(*) from public.entitlement_jobs where tenant_id='16de2000-0000-4000-8000-000000000001'),1::bigint,'D01 one initial TEST invitation job');
select public.admin_request_entitlement_access('16de2000-0000-4000-8000-000000000001',pg_temp.dsub());
select is((select count(*) from public.entitlement_jobs where tenant_id='16de2000-0000-4000-8000-000000000001'),1::bigint,'D02 repeated request cannot duplicate job');
create function pg_temp.retry_assertions() returns setof text language plpgsql as $$declare j jsonb;attempt integer;delay_seconds integer;begin
 for attempt in 1..5 loop
  update public.entitlement_jobs set available_at=now()-interval '1 second' where tenant_id='16de2000-0000-4000-8000-000000000001';
  perform pg_temp.dclaim();select v into j from dctx where k='job';
  return next is((j->>'attempts')::integer,attempt,'D03 exact attempt '||attempt);
  return next ok(public.entitlement_claim_job('16de2000-0000-4000-8000-000000000001') is null,'D04 lease excludes duplicate worker '||attempt);
  return next is(pg_temp.dcomplete('{"ok":false}'),false,'D05 failure is not success '||attempt);
  return next is((select status from public.entitlement_jobs where id=(j->>'id')::uuid),case when attempt=5 then 'FAILED' else 'PENDING' end,'D06 bounded explicit-failure state '||attempt);
  select extract(epoch from available_at-now())::integer into delay_seconds from public.entitlement_jobs where id=(j->>'id')::uuid;
  return next is(delay_seconds,least(300,10*(2^attempt)::integer),'D07 bounded persisted backoff '||attempt);
 end loop;end;$$;
select * from pg_temp.retry_assertions();
select ok(public.entitlement_claim_job('16de2000-0000-4000-8000-000000000001') is null,'D08 failed job does not silently restart');
select is((select status from public.channel_access where id=pg_temp.daccess()),'REVIEW','D09 outage leaves visible review');

select ok(pg_temp.dcontrol('hold'),'D10 manager hold creates a new revision');
select pg_temp.dclaim();select ok(pg_temp.dcomplete('{"ok":true}'),'D11 fake revocation completed');
select ok(pg_temp.dcontrol('release'),'D12 explicit release recovers via a new invitation revision');
select pg_temp.dclaim();
insert into dctx select 'old_lease',v from dctx where k='job';
update public.entitlement_jobs set lease_until=now()-interval '1 second' where id=(select (v->>'id')::uuid from dctx where k='job');
select throws_ok($$select pg_temp.dcomplete('{"ok":true,"invite_reference":"test:invite:expired","expires_at":"2030-01-01Z"}')$$,'42501','access lease denied','D13 expired lease cannot complete');
select pg_temp.dclaim();
select ok((select v->>'lease_token' from dctx where k='job') is distinct from (select v->>'lease_token' from dctx where k='old_lease'),'D14 reclaimed lease token differs');
select throws_ok($$select public.entitlement_complete_job('16de2000-0000-4000-8000-000000000001',(select (v->>'id')::uuid from dctx where k='old_lease'),(select (v->>'lease_token')::uuid from dctx where k='old_lease'),'{"ok":true}')$$,'42501','access lease denied','D15 stale worker cannot use reclaimed token');
select ok(pg_temp.dcomplete(jsonb_build_object('ok',true,'invite_reference','test:invite:recovered','expires_at',now()+interval '300 seconds')),'D16 replacement lease commits safe TEST link');
select throws_ok($$select pg_temp.dcomplete('{"ok":true}')$$,'42501','access lease denied','D17 repeated completion cannot duplicate effects');
select throws_ok($$select public.entitlement_join_request('16de2000-0000-4000-8000-000000000001',pg_temp.daccess(),'test:999','test:invite:recovered')$$,'42501','join authority denied','D18 wrong user rejected');
select throws_ok($$select public.entitlement_join_request('16de2000-0000-4000-8000-000000000002',pg_temp.daccess(),'test:1616','test:invite:recovered')$$,'42501','join authority denied','D19 wrong tenant rejected');
update public.channel_access set invite_expires_at=now()-interval '1 second' where id=pg_temp.daccess();
select throws_ok($$select public.entitlement_join_request('16de2000-0000-4000-8000-000000000001',pg_temp.daccess(),'test:1616','test:invite:recovered')$$,'42501','join authority denied','D20 expired invitation rejected');
update public.channel_access set invite_expires_at=now()+interval '300 seconds' where id=pg_temp.daccess();
select ok(public.entitlement_join_request('16de2000-0000-4000-8000-000000000001',pg_temp.daccess(),'test:1616','test:invite:recovered'),'D21 exact request accepted');
select public.entitlement_join_request('16de2000-0000-4000-8000-000000000001',pg_temp.daccess(),'test:1616','test:invite:recovered');
select is((select count(*) from public.entitlement_jobs where access_id=pg_temp.daccess() and operation='join'),1::bigint,'D22 duplicate join is one job');
select pg_temp.dclaim();select ok(pg_temp.dcomplete('{"ok":true,"membership":"member"}'),'D23 fake member observation accepted');
select is((select status from public.channel_access where id=pg_temp.daccess()),'MEMBER','D24 observed TEST member');
select ok(pg_temp.dcontrol('reconcile'),'D25 explicit reconciliation queues once for revision');
select pg_temp.dclaim();select ok(pg_temp.dcomplete('{"ok":true,"membership":"left"}'),'D26 missing member creates repair invitation');
select is((select status from public.channel_access where id=pg_temp.daccess()),'PENDING','D27 missing member is not shown as delivered');
select pg_temp.dclaim();select ok(pg_temp.dcomplete(jsonb_build_object('ok',true,'invite_reference','test:invite:race','expires_at',now()+interval '300 seconds')),'D28 repair invitation completes');
select public.entitlement_join_request('16de2000-0000-4000-8000-000000000001',pg_temp.daccess(),'test:1616','test:invite:race');
select pg_temp.dclaim();
select public.entitlement_test_begin_effect_v1('16de2000-0000-4000-8000-000000000001',(select (v->>'id')::uuid from dctx where k='job'),(select (v->>'lease_token')::uuid from dctx where k='job'));
select ok(pg_temp.dcontrol('hold'),'D29 hold while fake grant in flight');
select is(pg_temp.dcomplete('{"ok":true,"membership":"member"}'),false,'D30 late fake side effect cannot revive held DB access');
select is((select status from public.channel_access where id=pg_temp.daccess()),'REVIEW','D31 stale side effect remains visible for compensation');
select pg_temp.dclaim();select ok(pg_temp.dcomplete('{"ok":true}'),'D32 queued fake revoke compensates');
select is((select status from public.channel_access where id=pg_temp.daccess()),'REVOKED','D33 final held access revoked');
select ok(pg_temp.dcontrol('cancel'),'D34 cancel is effective state not mere request');
select pg_temp.dclaim();select ok(pg_temp.dcomplete('{"ok":true}'),'D35 cancel revoke completes');
select throws_ok($$select pg_temp.dcontrol('release')$$,'42501','cancelled subscription','D36 cancelled subscription cannot be released');

-- Separate earlier TEST subscription demonstrates real time expiry without
-- editing the immutable start of the invoice-derived subscription.
insert into public.customers(id,tenant_id,display_name) values('16de3000-0000-4000-8000-000000000003','16de2000-0000-4000-8000-000000000001','Synthetic expiry fixture');
insert into public.subscriptions(id,tenant_id,customer_id,plan_version_id,mode,state,plan_snapshot,commercial_snapshot,starts_at,ends_at,grace_until,renewal_due_at)
values('16de8000-0000-4000-8000-000000000003','16de2000-0000-4000-8000-000000000001','16de3000-0000-4000-8000-000000000003','16de5000-0000-4000-8000-000000000002','test','ACTIVE','{}','{}',now()-interval '40 days',now()+interval '1 day',now()+interval '1 day',now()+interval '1 hour');
select public.admin_test_access_setup('16de2000-0000-4000-8000-000000000001','16de3000-0000-4000-8000-000000000003',(select id from public.domain_events where customer_id='16de3000-0000-4000-8000-000000000003' and event_type='customer.created'),'test:1633');
select public.admin_request_entitlement_access('16de2000-0000-4000-8000-000000000001','16de8000-0000-4000-8000-000000000003');
update public.subscriptions set ends_at=now()-interval '1 second',grace_until=now()-interval '1 second' where id='16de8000-0000-4000-8000-000000000003';
select public.entitlement_tick('16de2000-0000-4000-8000-000000000001');
select is((select state from public.subscriptions where id='16de8000-0000-4000-8000-000000000003'),'EXPIRED','D37 expired TEST subscription truth');
-- Explicitly put the obsolete fixture first. Equal available_at values may
-- correctly select revoke before invite via UUID tie-break; that is not a bug.
update public.entitlement_jobs set available_at=now()-interval '2 seconds' where tenant_id='16de2000-0000-4000-8000-000000000001' and access_id=(select id from public.channel_access where subscription_id='16de8000-0000-4000-8000-000000000003') and operation='invite';
select ok(public.entitlement_claim_job('16de2000-0000-4000-8000-000000000001') is null,'D38 obsolete invite drains as STALE');
select pg_temp.dclaim();select ok(pg_temp.dcomplete('{"ok":true}'),'D39 next call processes queued revoke');
select is((select status from public.channel_access where subscription_id='16de8000-0000-4000-8000-000000000003'),'REVOKED','D40 expired access safely revoked');

select is((select count(*) from public.subscription_payments where tenant_id='16de2000-0000-4000-8000-000000000001'),1::bigint,'D41 recovery did not invent payment periods');
select is((select count(*) from private.verified_payment_receipts),0::bigint,'D42 no genuine receipts');
select is((select count(*) from public.domain_events where event_type='payment.confirmed' and tenant_id='16de2000-0000-4000-8000-000000000001'),0::bigint,'D43 no trusted live payment event');
select is((select count(*) from public.channel_access where mode='live' and tenant_id='16de2000-0000-4000-8000-000000000001'),0::bigint,'D44 no live access');
select ok(not exists(select 1 from public.customers where tenant_id='16de2000-0000-4000-8000-000000000001' and state in ('PAID','ACTIVE','ACCESS_GRANTED')),'D45 TEST delivery cannot advance paid customer');
select ok(not exists(select 1 from private.entitlement_controls where tenant_id='16de2000-0000-4000-8000-000000000001' and live_enabled),'D46 live gate unchanged');
select ok(not exists(select 1 from public.tenants where id='16de2000-0000-4000-8000-000000000001' and outbound_messaging_enabled),'D47 outbound stays disabled');
select * from finish();rollback;
