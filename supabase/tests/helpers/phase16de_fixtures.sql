-- Derived from the accepted Phase11 fixture; distinct disposable identities/slugs.
-- Only used inside disposable CI/pgTAP databases. Never staging or production.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at) values
 ('16de1000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase16de-manager@example.test','not-used',now()),
 ('16de1000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase16de-support@example.test','not-used',now()),
 ('16de1000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase16de-readonly@example.test','not-used',now());
insert into public.tenants(id,name,slug) values('16de2000-0000-4000-8000-000000000001','Payment Test A','phase11-sandbox-16de-a'),('16de2000-0000-4000-8000-000000000002','Payment Test B','phase11-sandbox-16de-b');
insert into public.tenant_members(tenant_id,user_id,role) values('16de2000-0000-4000-8000-000000000001','16de1000-0000-4000-8000-000000000001','manager'),('16de2000-0000-4000-8000-000000000001','16de1000-0000-4000-8000-000000000002','support'),('16de2000-0000-4000-8000-000000000001','16de1000-0000-4000-8000-000000000003','readonly');
insert into public.customers(id,tenant_id,display_name) values('16de3000-0000-4000-8000-000000000001','16de2000-0000-4000-8000-000000000001','Payment fixture customer'),('16de3000-0000-4000-8000-000000000002','16de2000-0000-4000-8000-000000000002','Other tenant fixture');
select public.ingest_telegram_message('16de2000-0000-4000-8000-000000000001','p10-source','9101','p10-chat','p10-user','test_fixture','Test','Only','Test-only payment offer',null,now());
update public.conversations set customer_id='16de3000-0000-4000-8000-000000000001' where tenant_id='16de2000-0000-4000-8000-000000000001';
insert into public.commercial_items(id,tenant_id,kind,created_by) values('16de4000-0000-4000-8000-000000000001','16de2000-0000-4000-8000-000000000001','product','16de1000-0000-4000-8000-000000000001'),('16de4000-0000-4000-8000-000000000002','16de2000-0000-4000-8000-000000000001','plan','16de1000-0000-4000-8000-000000000001');
insert into public.commercial_versions(id,tenant_id,item_id,version,payload,created_by,effective_from) values('16de5000-0000-4000-8000-000000000001','16de2000-0000-4000-8000-000000000001','16de4000-0000-4000-8000-000000000001',1,'{"title":"Synthetic membership","duration_unit":"calendar_month","duration_count":1}','16de1000-0000-4000-8000-000000000001',now()),('16de5000-0000-4000-8000-000000000002','16de2000-0000-4000-8000-000000000001','16de4000-0000-4000-8000-000000000002',1,'{"title":"Synthetic membership","duration_unit":"calendar_month","duration_count":1}','16de1000-0000-4000-8000-000000000001',now());
insert into public.commercial_offers(id,tenant_id,conversation_id,customer_id,source_event_id,plan_version_id,product_version_id,amount,currency,discount_bps,snapshot,status,expires_at)
select '16de6000-0000-4000-8000-000000000001',c.tenant_id,c.id,c.customer_id,e.id,'16de5000-0000-4000-8000-000000000002','16de5000-0000-4000-8000-000000000001',79,'USD',0,'{"fixture":"TEST ONLY"}','approved',now()+interval '2 hours' from public.conversations c join public.domain_events e on e.tenant_id=c.tenant_id and e.event_type='message.received' where c.tenant_id='16de2000-0000-4000-8000-000000000001';

-- Only TEST invoice/observation/subscription helpers; no genuine writer/event.
do $fixture$declare invoice_id uuid;snapshot_id uuid;subscription_id uuid;begin
 perform set_config('request.jwt.claim.sub','16de1000-0000-4000-8000-000000000001',true);
 invoice_id:=public.admin_create_test_payment_invoice('16de2000-0000-4000-8000-000000000001','16de6000-0000-4000-8000-000000000001','telegram_stars','XTR','100','phase16de-fixture');
 snapshot_id:=public.admin_simulate_test_payment('16de2000-0000-4000-8000-000000000001',invoice_id,'settled','phase16de-fixture');
 perform public.payment_record_test_observation('16de2000-0000-4000-8000-000000000001',invoice_id,snapshot_id,'test:phase16de',repeat('d',64),'reconcile');
 subscription_id:=public.admin_create_test_subscription('16de2000-0000-4000-8000-000000000001',invoice_id);
 perform public.admin_test_access_setup('16de2000-0000-4000-8000-000000000001','16de3000-0000-4000-8000-000000000001',(select id from public.domain_events where customer_id='16de3000-0000-4000-8000-000000000001' and event_type='customer.created'),'test:1616');
 perform public.admin_request_entitlement_access('16de2000-0000-4000-8000-000000000001',subscription_id);
end;$fixture$;
