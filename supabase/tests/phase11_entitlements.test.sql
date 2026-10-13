begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
\ir helpers/phase11_fixtures.sql
create temp table p11(key text primary key,value uuid);
grant all on p11 to authenticated,service_role;
select ok(not has_table_privilege('authenticated','public.subscriptions','INSERT'),'browser cannot create subscriptions');
select ok(not has_table_privilege('service_role','public.subscriptions','INSERT'),'service cannot bypass entitlement consumer');
select ok(not has_function_privilege('authenticated','public.consume_verified_payment(uuid,uuid)','EXECUTE'),'live verifier service only');
select ok(not has_function_privilege('authenticated','public.entitlement_complete_job(uuid,uuid,uuid,jsonb)','EXECUTE'),'AI/browser cannot complete access');
select ok(not has_table_privilege('service_role','private.entitlement_controls','UPDATE'),'runtime cannot activate live controls');
select ok(not has_table_privilege('service_role','private.verified_payment_receipts','INSERT'),'runtime cannot fabricate signed receipts');
select is(public.subscription_expiry('2028-01-31T10:00:00Z','{"duration_unit":"calendar_month","duration_count":1}'),'2028-02-29T10:00:00Z'::timestamptz,'leap calendar month');
select is(public.subscription_expiry('2027-01-31T10:00:00Z','{"duration_unit":"calendar_month","duration_count":1}'),'2027-02-28T10:00:00Z'::timestamptz,'month end clamp');
select is(public.subscription_expiry('2028-02-29T10:00:00Z','{"duration_unit":"calendar_year","duration_count":1}'),'2029-02-28T10:00:00Z'::timestamptz,'calendar year clamp');
select is(public.subscription_expiry('2028-02-29T10:00:00Z','{"duration_unit":"fixed_days","duration_count":30}'),'2028-03-30T10:00:00Z'::timestamptz,'fixed days');
select throws_ok($$select public.subscription_expiry(now(),'{"duration_unit":"fixed_days","duration_count":0}')$$,'22023','subscription terms invalid','invalid duration denied');
select throws_ok($$select public.subscription_expiry(now(),'{"duration_unit":"fixed_days","duration_count":1,"grace_days":1}')$$,'22023','grace not approved','unapproved grace denied');
select throws_ok($$select public.consume_verified_payment('e3200000-0000-4000-8000-000000000001',gen_random_uuid())$$,'42501','live entitlements disabled','production default closed');
set local role authenticated;
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000001',true);
insert into p11 values('invoice',public.admin_create_test_payment_invoice('e3200000-0000-4000-8000-000000000001','e3600000-0000-4000-8000-000000000001','telegram_stars','XTR','100','p11-test-invoice'));
select throws_ok($$select public.admin_create_test_subscription('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='invoice'))$$,'42501','confirmed test evidence required','unverified payment denied');
insert into p11 values('snapshot',public.admin_simulate_test_payment('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='invoice'),'settled','p11-settled'));
reset role;
select public.payment_record_test_observation('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='invoice'),(select value from p11 where key='snapshot'),'test:p11-payment',repeat('a',64),'webhook');
set local role authenticated;
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000001',true);
insert into p11 values('sub',public.admin_create_test_subscription('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='invoice')));
select is(public.admin_create_test_subscription('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='invoice')),(select value from p11 where key='sub'),'duplicate event one subscription');
select is((select count(*) from public.subscription_payments),1::bigint,'one immutable payment period');
select is((select mode from public.subscriptions where id=(select value from p11 where key='sub')),'test','simulation stays test entitlement');
select throws_ok($$select public.admin_request_entitlement_access('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='sub'))$$,'42501','verified binding and channel required','no username or unbound access');
select throws_ok($$select public.admin_test_access_setup('e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',(select id from public.domain_events where customer_id='e3300000-0000-4000-8000-000000000001' and event_type='customer.created'),'@username')$$,'42501','test identity evidence denied','username rejected');
select public.admin_test_access_setup('e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',(select id from public.domain_events where customer_id='e3300000-0000-4000-8000-000000000001' and event_type='customer.created'),'test:12345');
insert into p11 values('access',public.admin_request_entitlement_access('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='sub')));
select is(public.admin_request_entitlement_access('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='sub')),(select value from p11 where key='access'),'access request idempotent');
reset role;
create temp table job(value jsonb);insert into job values(public.entitlement_claim_job('e3200000-0000-4000-8000-000000000001'));
select is(public.entitlement_claim_job('e3200000-0000-4000-8000-000000000001'),null::jsonb,'only one worker leases job');
select throws_ok($$select public.entitlement_complete_job('e3200000-0000-4000-8000-000000000001',(select (value->>'id')::uuid from job),gen_random_uuid(),'{"ok":true}')$$,'42501','access lease denied','stale worker denied');
select is(public.entitlement_complete_job('e3200000-0000-4000-8000-000000000001',(select (value->>'id')::uuid from job),(select (value->>'lease_token')::uuid from job),'{"ok":false}'),false,'provider failure safe retry');
select is((select status from public.channel_access where id=(select value from p11 where key='access')),'REVIEW','failure holds access');
update public.entitlement_jobs set available_at=now()-interval '1 second';truncate job;insert into job values(public.entitlement_claim_job('e3200000-0000-4000-8000-000000000001'));
select throws_ok($$select public.entitlement_complete_job('e3200000-0000-4000-8000-000000000001',(select (value->>'id')::uuid from job),(select (value->>'lease_token')::uuid from job),jsonb_build_object('ok',true,'invite_reference','https://t.me/+fake','expires_at',now()+interval '300 seconds'))$$,'22023','restricted invite required','test engine cannot store real link');
select ok(public.entitlement_complete_job('e3200000-0000-4000-8000-000000000001',(select (value->>'id')::uuid from job),(select (value->>'lease_token')::uuid from job),jsonb_build_object('ok',true,'invite_reference','test:invite:123','expires_at',now()+interval '300 seconds')),'bounded test invite persisted');
select throws_ok($$select public.entitlement_join_request('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='access'),'test:999','test:invite:123')$$,'42501','join authority denied','wrong Telegram identity rejected');
select ok(public.entitlement_join_request('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='access'),'test:12345','test:invite:123'),'matching identity requests join');
truncate job;insert into job values(public.entitlement_claim_job('e3200000-0000-4000-8000-000000000001'));
select ok(public.entitlement_complete_job('e3200000-0000-4000-8000-000000000001',(select (value->>'id')::uuid from job),(select (value->>'lease_token')::uuid from job),'{"ok":true,"membership":"member"}'),'verified test membership');
select is((select status from public.channel_access where id=(select value from p11 where key='access')),'MEMBER','member state truthful');
set local role authenticated;
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000001',true);
select ok(public.admin_subscription_control('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='sub'),'hold','e3900000-0000-4000-8000-000000000001'),'manual hold');
select ok(public.admin_subscription_control('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='sub'),'hold','e3900000-0000-4000-8000-000000000001'),'hold idempotent');
select throws_ok($$select public.admin_request_entitlement_access('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='sub'))$$,'42501','valid entitlement required','hold denies invitation');
reset role;truncate job;insert into job values(public.entitlement_claim_job('e3200000-0000-4000-8000-000000000001'));
select ok(public.entitlement_complete_job('e3200000-0000-4000-8000-000000000001',(select (value->>'id')::uuid from job),(select (value->>'lease_token')::uuid from job),'{"ok":true}'),'held membership revocation');
select is((select status from public.channel_access where id=(select value from p11 where key='access')),'REVOKED','revocation confirmed');
set local role authenticated;select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_subscription_control('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='sub'),'release',gen_random_uuid())$$,'42501','entitlement permission denied','support write denied');
select throws_ok($$select public.admin_entitlement_list('e3200000-0000-4000-8000-000000000002')$$,'42501','entitlement permission denied','cross tenant denied');
select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.admin_entitlement_list('e3200000-0000-4000-8000-000000000001')$$,'42501','entitlement permission denied','readonly sensitive access denied');
select is((select count(*) from public.subscriptions),0::bigint,'RLS hides sensitive subscriptions');
reset role;
select throws_ok($$update public.subscriptions set plan_snapshot='{}'$$,'42501','subscription snapshot immutable','plan snapshot immutable');
select throws_ok($$delete from public.subscription_payments$$,'42501','entitlement evidence immutable','period evidence immutable');
select throws_ok($$delete from public.entitlement_audit$$,'42501','entitlement evidence immutable','audit immutable');
select is((select count(*) from public.subscriptions where mode='live'),0::bigint,'no production subscriptions from simulations');
select is((select count(*) from public.channel_access where mode='live'),0::bigint,'no production VIP access');
select is((select count(*) from public.domain_events where event_type='payment.confirmed'),0::bigint,'no real payment event');
select is((select count(*) from public.customers where state='PAID'),0::bigint,'no PAID customer');

-- Renewal evidence is a distinct verified test invoice; one event can extend once only.
set local role authenticated;select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000001',true);
select public.admin_subscription_control('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='sub'),'release','e3900000-0000-4000-8000-000000000002');
insert into p11 values('renewal',public.admin_create_test_payment_invoice('e3200000-0000-4000-8000-000000000001','e3600000-0000-4000-8000-000000000001','telegram_stars','XTR','100','p11-renewal'));
insert into p11 values('renewal-snapshot',public.admin_simulate_test_payment('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='renewal'),'settled','p11-renewal-settled'));
reset role;
select public.payment_record_test_observation('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='renewal'),(select value from p11 where key='renewal-snapshot'),'test:p11-renewal',repeat('b',64),'reconcile');
create temp table old_end(value timestamptz);insert into old_end select ends_at from public.subscriptions where id=(select value from p11 where key='sub');
set local role authenticated;
select is(public.admin_create_test_subscription('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='renewal')),(select value from p11 where key='sub'),'renewal extends same subscription');
reset role;
select is((select count(*) from public.subscriptions),1::bigint,'renewal does not duplicate subscription');
select is((select period_start from public.subscription_payments where test_invoice_id=(select value from p11 where key='renewal')),(select value from old_end),'renewal starts at previous expiry');
select is((select ends_at from public.subscriptions where id=(select value from p11 where key='sub')),public.subscription_expiry((select value from old_end),'{"duration_unit":"calendar_month","duration_count":1}'),'renewal correct calendar extension');
select is(public.entitlement_conversation_receipts('e3200000-0000-4000-8000-000000000001',(select id from public.conversations where tenant_id='e3200000-0000-4000-8000-000000000001'),now()),'[]'::jsonb,'simulations never become AI action receipts');

update public.subscriptions set renewal_due_at=now() where id=(select value from p11 where key='sub');
select ok(public.entitlement_tick('e3200000-0000-4000-8000-000000000001')>=1,'renewal scheduler processes due subscription');
select is((select state from public.subscriptions where id=(select value from p11 where key='sub')),'RENEWAL_DUE','renewal due state');
insert into public.customers(id,tenant_id,display_name) values('e3300000-0000-4000-8000-000000000003','e3200000-0000-4000-8000-000000000001','Disposable expiration fixture');
insert into public.subscriptions(id,tenant_id,customer_id,plan_version_id,mode,state,plan_snapshot,commercial_snapshot,starts_at,ends_at,grace_until,renewal_due_at) values('e3800000-0000-4000-8000-000000000001','e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000003','e3500000-0000-4000-8000-000000000002','test','ACTIVE','{}','{}',now()-interval '40 days',now()-interval '10 days',now()-interval '10 days',now()-interval '13 days');
select public.entitlement_tick('e3200000-0000-4000-8000-000000000001');
select is((select state from public.subscriptions where id='e3800000-0000-4000-8000-000000000001'),'EXPIRED','expiration scheduler safe terminal state');

set local role authenticated;select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000001',true);
insert into p11 values('refund-proof',public.admin_simulate_test_payment('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='invoice'),'refunded','p11-refund'));
reset role;
select public.payment_record_test_observation('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='invoice'),(select value from p11 where key='refund-proof'),'test:p11-refund',repeat('e',64),'reconcile');
select public.entitlement_tick('e3200000-0000-4000-8000-000000000001');
select is((select state from public.subscriptions where id=(select value from p11 where key='sub')),'SUSPENDED','provider reconciliation failure suspends entitlement');

insert into p11 values('race-job',gen_random_uuid());insert into p11 values('race-lease',gen_random_uuid());
insert into public.entitlement_jobs(id,tenant_id,access_id,revision,operation,status,lease_token,lease_until) select (select value from p11 where key='race-job'),s.tenant_id,(select value from p11 where key='access'),s.revision,'reconcile','RUNNING',(select value from p11 where key='race-lease'),now()+interval '60 seconds' from public.subscriptions s where s.id=(select value from p11 where key='sub');
set local role authenticated;select set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000001',true);
select public.admin_subscription_control('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='sub'),'hold','e3900000-0000-4000-8000-000000000003');reset role;
select is(public.entitlement_complete_job('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='race-job'),(select value from p11 where key='race-lease'),'{"ok":true,"membership":"member"}'),false,'concurrent hold invalidates in-flight completion');
select is((select status from public.entitlement_jobs where id=(select value from p11 where key='race-job')),'STALE','stale completion never revives access');
-- Disposable PostgreSQL fixture only: positive provenance contract, not genuine merchant evidence.
insert into private.entitlement_controls values('e3200000-0000-4000-8000-000000000001',true,'CI SYNTHETIC ONLY; rolled back');
select throws_ok($$select public.consume_verified_payment('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='invoice'))$$,'42501','genuine verified receipt required','test invoice denied even with live gate configured');
insert into p11 values('receipt',gen_random_uuid());
insert into p11 values('live-event',private.append_domain_event('e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','payment.confirmed',1,jsonb_build_object('payment_id',(select value from p11 where key='receipt'),'tx_hash','fixture:verified'),'SYSTEM',null,'payment_verifier','TRUSTED',gen_random_uuid(),null,'fixture:live-positive',now()));
insert into private.verified_payment_receipts(id,tenant_id,customer_id,offer_id,event_id,provider_id,provider_reference,signature_verified,independent_verified,evidence_hash,verified_at) values((select value from p11 where key='receipt'),'e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','e3600000-0000-4000-8000-000000000001',(select value from p11 where key='live-event'),'fixture-only','fixture:verified',true,true,repeat('c',64),now());
-- The immutable live commercial snapshot must match the plan; a synthetic offer is rejected.
select throws_ok($$select public.consume_verified_payment('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='receipt'))$$,'42501','commercial provenance denied','receipt cannot activate an unbound commercial snapshot');

insert into public.commercial_offers(id,tenant_id,conversation_id,customer_id,source_event_id,plan_version_id,product_version_id,amount,currency,discount_bps,snapshot,status,expires_at)
select 'e3600000-0000-4000-8000-000000000002','e3200000-0000-4000-8000-000000000001',c.id,c.customer_id,e.id,'e3500000-0000-4000-8000-000000000002','e3500000-0000-4000-8000-000000000001',79,'USD',0,jsonb_build_object('plan',jsonb_build_object('payload',v.payload)),'approved',now()+interval '1 hour' from public.conversations c join public.domain_events e on e.tenant_id=c.tenant_id and e.customer_id=c.customer_id and e.event_type='customer.created' join public.commercial_versions v on v.id='e3500000-0000-4000-8000-000000000002' where c.tenant_id='e3200000-0000-4000-8000-000000000001';
insert into p11 values('valid-receipt',gen_random_uuid());
insert into p11 values('valid-live-event',private.append_domain_event('e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','payment.confirmed',1,jsonb_build_object('payment_id',(select value from p11 where key='valid-receipt'),'tx_hash','fixture:verified:2'),'SYSTEM',null,'payment_verifier','TRUSTED',gen_random_uuid(),null,'fixture:live-positive:2',now()));
insert into private.verified_payment_receipts(id,tenant_id,customer_id,offer_id,event_id,provider_id,provider_reference,signature_verified,independent_verified,evidence_hash,verified_at) values((select value from p11 where key='valid-receipt'),'e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','e3600000-0000-4000-8000-000000000002',(select value from p11 where key='valid-live-event'),'fixture-only','fixture:verified:2',true,true,repeat('d',64),now());

-- Genuine-authority fixture uses the existing guarded Customer OS, never direct state writes.
do $$declare step record;ev uuid;res jsonb;begin
 for step in select * from (values ('NEW','CONTACT_READY','admin.manual_transition','{}'::jsonb),('CONTACT_READY','CONTACTED','admin.manual_transition','{}'),('CONTACTED','REPLIED','admin.manual_transition','{}'),('REPLIED','QUALIFIED','qualification.completed','{"qualification_id":"fixture"}'),('QUALIFIED','OFFER_SENT','offer.created','{"offer_id":"fixture"}'),('OFFER_SENT','INTERESTED','offer.accepted','{"offer_id":"fixture"}'),('INTERESTED','PAYMENT_PENDING','payment.intent_created','{"payment_id":"fixture","amount":"79","asset":"XTR","network":"TELEGRAM"}')) x(from_state,to_state,event_type,payload) loop
 ev:=null;if step.event_type<>'admin.manual_transition' then ev:=private.append_domain_event('e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',step.event_type,1,step.payload,'SYSTEM',null,'fixture_only','TRUSTED',gen_random_uuid(),null,'fixture-state:'||step.to_state,now());end if;
 res:=public.transition_customer_state('e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001',step.from_state::public.customer_state,step.to_state::public.customer_state,'disposable_ci_fixture','SYSTEM',null,gen_random_uuid(),ev,step.event_type,ev,'fixture-state:'||step.to_state,now());if res->>'accepted'<>'true' then raise exception 'fixture transition failed: %',res;end if;end loop;end;$$;
insert into p11 values('live-sub',public.consume_verified_payment('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='valid-receipt')));
select is((select state from public.customers where id='e3300000-0000-4000-8000-000000000001'),'PAID'::public.customer_state,'only authorized receipt advances guarded PAID');
select is((select state from public.subscriptions where id=(select value from p11 where key='live-sub')),'ACTIVE','authorized verified provenance contract creates subscription');
select is(public.consume_verified_payment('e3200000-0000-4000-8000-000000000001',(select value from p11 where key='valid-receipt')),(select value from p11 where key='live-sub'),'genuine authority contract duplicate is idempotent');
select is((select count(*) from public.subscription_payments where mode='live'),1::bigint,'single genuine authority period in disposable fixture');
select ok(not exists(select 1 from public.channel_access where mode='live'),'missing authorized real channel never grants access');
select * from finish();rollback;
