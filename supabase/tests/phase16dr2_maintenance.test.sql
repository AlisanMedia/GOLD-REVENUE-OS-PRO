begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
\ir helpers/phase16dr2_maintenance_fixtures.sql
create temp table progress(v jsonb);
insert into progress values(public.entitlement_test_maintenance_v1('16de2000-0000-4000-8000-000000000001'));
select is((select (v->>'processed')::int from progress),16,'two populated lanes each process eight');
select is((select (v->>'expired')::int from progress),8,'expiry lane bounded to eight');
select is((select (v->>'renewal_due')::int from progress),8,'renewal lane not starved by expiry backlog');
select ok((select (v->>'has_more')::boolean from progress),'incomplete maintenance explicitly reported');
select ok((select not (v->>'busy')::boolean from progress),'uncontended scheduler not busy');
select is((select count(*)::int from public.entitlement_audit where tenant_id='16de2000-0000-4000-8000-000000000001' and action='expired'),8,'one atomic audit for each expiry');
select is((select count(*)::int from public.entitlement_audit where tenant_id='16de2000-0000-4000-8000-000000000001' and action='renewal_due'),8,'one atomic audit for each due transition');
select is((select count(*)::int from public.subscriptions where tenant_id='16de2000-0000-4000-8000-000000000001' and state='ACTIVE'),113,'only bounded subscriptions changed');
-- Deterministic earliest expiry tie breaks by id; admitted original may sort later.
select is((select state from public.subscriptions where id='16a21000-0000-4000-8000-000000000001'),'EXPIRED','equal dates use deterministic id');
select ok(not has_function_privilege('authenticated','public.entitlement_test_maintenance_v1(uuid)','EXECUTE'),'browser/manager cannot invoke maintenance');
select ok(not has_function_privilege('anon','public.entitlement_test_maintenance_v1(uuid)','EXECUTE'),'anonymous denied');
select ok(has_function_privilege('service_role','public.entitlement_test_maintenance_v1(uuid)','EXECUTE'),'only existing worker role granted');
select throws_ok($$select public.entitlement_test_maintenance_v1('00000000-0000-4000-8000-000000000001')$$,'42501','isolated test authority required','unknown tenant fail closed');
update public.tenants set outbound_messaging_enabled=true where id='16de2000-0000-4000-8000-000000000002';
select throws_ok($$select public.entitlement_test_maintenance_v1('16de2000-0000-4000-8000-000000000002')$$,'42501','isolated test authority required','outbound-enabled tenant denied');
-- Fully drain without an unbounded runtime loop: the test driver alone is bounded.
do $$begin for i in 1..10 loop perform public.entitlement_test_maintenance_v1('16de2000-0000-4000-8000-000000000001');end loop;end;$$;
select is((select count(*)::int from public.subscriptions where tenant_id='16de2000-0000-4000-8000-000000000001' and state='EXPIRED'),64,'all expiry history eventually processed');
select is((select count(*)::int from public.subscriptions where tenant_id='16de2000-0000-4000-8000-000000000001' and state='RENEWAL_DUE'),64,'all renewal work eventually processed');
select is((public.entitlement_test_maintenance_v1('16de2000-0000-4000-8000-000000000001')->>'processed')::int,0,'already due rows do not repeat indefinitely');
select is(public.entitlement_test_maintenance_v1('16de2000-0000-4000-8000-000000000001')->>'has_more','false','final queue accurately empty');
select is((select count(*)::int from public.entitlement_audit where tenant_id='16de2000-0000-4000-8000-000000000001' and action='expired'),64,'no duplicate expiry audits');
select is((select count(*)::int from public.entitlement_audit where tenant_id='16de2000-0000-4000-8000-000000000001' and action='renewal_due'),64,'no duplicate due audits');
select is((select count(*)::int from public.entitlement_jobs where tenant_id='16de2000-0000-4000-8000-000000000001' and operation='revoke'),1,'admitted expiry retains revoke obligation');
select is((select status from public.channel_access where subscription_id='16a21000-0000-4000-8000-000000000001'),'REVIEW','expiry does not fabricate actual revocation');
select is((select count(*)::int from public.subscription_payments where tenant_id='16de2000-0000-4000-8000-000000000001'),1,'immutable test period unchanged');
select is((select count(*)::int from private.verified_payment_receipts),0,'no genuine receipt');
select is((select count(*)::int from public.domain_events where event_type='payment.confirmed'),0,'no trusted payment event');
select is((select count(*)::int from public.subscriptions where mode='live'),0,'no live subscription');
-- Bad payment evidence has precedence over renewal; disabled schedule not invented.
update public.subscriptions set state='ACTIVE',ends_at=now()+interval '1 day',grace_until=now()+interval '1 day' where tenant_id='16de2000-0000-4000-8000-000000000001' and id::text not like '16a21000%';
update public.payment_invoices set status='REFUNDED' where tenant_id='16de2000-0000-4000-8000-000000000001';
select is(public.entitlement_test_maintenance_v1('16de2000-0000-4000-8000-000000000001')->>'held','1','actual TEST invoice status suspends subscription');
select is((select state from public.subscriptions where tenant_id='16de2000-0000-4000-8000-000000000001' and id::text not like '16a21000%'),'SUSPENDED','bad source never treated as paid');
select is((select count(*)::int from public.entitlement_jobs where tenant_id='16de2000-0000-4000-8000-000000000001' and operation='revoke'),2,'new revision repair obligation retained');
select * from finish();
rollback;
