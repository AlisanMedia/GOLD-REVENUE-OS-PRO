-- Disposable local/CI database ONLY. All records are synthetic TEST evidence.
-- Requires phase11_fixtures.sql. No receipt writer, provider, worker or live gate.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at) values
 ('ec010000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bounded-analyst@example.test','not-used',now()),
 ('ec010000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000000','authenticated','authenticated','bounded-outsider@example.test','not-used',now());
insert into public.tenant_members(tenant_id,user_id,role) values
 ('e3200000-0000-4000-8000-000000000001','ec010000-0000-4000-8000-000000000001','analyst'),
 ('e3200000-0000-4000-8000-000000000002','ec010000-0000-4000-8000-000000000002','manager');
insert into public.customers(id,tenant_id,display_name)
select ('ec020000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e3200000-0000-4000-8000-000000000001','Synthetic bounded customer '||n from generate_series(1,320)n;
insert into public.subscriptions(id,tenant_id,customer_id,plan_version_id,mode,state,plan_snapshot,commercial_snapshot,starts_at,ends_at,grace_until,renewal_due_at,created_at)
select ('ec030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e3200000-0000-4000-8000-000000000001',
 ('ec020000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e3500000-0000-4000-8000-000000000002','test','ACTIVE',
 '{"title":"Synthetic bounded plan","duration_unit":"calendar_month","duration_count":1,"private_note":"must not project"}','{"private_note":"must not project"}',
 '2026-01-01Z','2026-02-01Z','2026-02-01Z','2026-01-29Z','2026-01-01Z'::timestamptz+make_interval(secs=>(n/3)) from generate_series(1,320)n;
-- Two plans for the same customer; the oldest subscription is outside first 100.
insert into public.subscriptions(id,tenant_id,customer_id,plan_version_id,mode,state,plan_snapshot,commercial_snapshot,starts_at,ends_at,grace_until,renewal_due_at,created_at) values
 ('ec030000-0000-4000-8000-000000000321','e3200000-0000-4000-8000-000000000001','ec020000-0000-4000-8000-000000000001','e3500000-0000-4000-8000-000000000001','test','HOLD','{"title":"Second synthetic plan"}','{}','2025-01-01Z','2025-02-01Z','2025-02-01Z','2025-01-29Z','2025-01-01Z');
insert into public.vip_channels(id,tenant_id,mode,chat_id,enabled,private_verified) values('ec040000-0000-4000-8000-000000000001','e3200000-0000-4000-8000-000000000001','test','test:bounded',false,true) on conflict(tenant_id,mode) do nothing;
insert into public.telegram_entitlement_bindings(id,tenant_id,customer_id,mode,telegram_user_id,source_event_id)
select ('ec050000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e3200000-0000-4000-8000-000000000001',
 ('ec020000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'test','test:'||n,
 (select id from public.domain_events where customer_id='e3300000-0000-4000-8000-000000000001' and event_type='customer.created') from generate_series(1,320)n;
insert into public.channel_access(id,tenant_id,subscription_id,binding_id,channel_id,mode,status,invite_reference,invite_expires_at)
select ('ec060000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e3200000-0000-4000-8000-000000000001',
 ('ec030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('ec050000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 (select id from public.vip_channels where tenant_id='e3200000-0000-4000-8000-000000000001' and mode='test'),'test','INVITED','test:invite:PRIVATE-'||n,now()+interval '5 minutes' from generate_series(1,320)n;
insert into public.entitlement_jobs(id,tenant_id,access_id,revision,operation,status,attempts,available_at,lease_token,lease_until,last_error)
select ('ec070000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e3200000-0000-4000-8000-000000000001',
 ('ec060000-0000-4000-8000-'||lpad(((n-1)%320+1)::text,12,'0'))::uuid,((n-1)/320)+1,'reconcile','FAILED',2,'2026-01-01Z',gen_random_uuid(),now(),'PRIVATE ERROR test:invite:PRIVATE'
from generate_series(1,960)n;
insert into public.entitlement_jobs(id,tenant_id,access_id,revision,operation,status,available_at)
select ('ec071000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e3200000-0000-4000-8000-000000000001',
 'ec060000-0000-4000-8000-000000000001',n+3,'reconcile','STALE','2026-01-01Z' from generate_series(1,2200)n;
insert into public.entitlement_audit(id,tenant_id,subscription_id,action,mode,details,created_at)
select ('ec080000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e3200000-0000-4000-8000-000000000001',
 case when n<=1600 then 'ec030000-0000-4000-8000-000000000001'::uuid else ('ec030000-0000-4000-8000-'||lpad(((n-1)%320+1)::text,12,'0'))::uuid end,
 'retry','test','{"attempt":2,"private_note":"PRIVATE ERROR test:invite:PRIVATE","invite_reference":"test:invite:PRIVATE","lease_token":"must never project"}',
 '2026-01-01Z'::timestamptz+make_interval(secs=>(n/3)) from generate_series(1,3200)n;
insert into public.payment_invoices(id,tenant_id,customer_id,offer_id,provider_id,provider_reference,channel,surface,amount_units,decimals,asset,network,recipient,payer_reference,min_confirmations,status,quote_snapshot,idempotency_key,expires_at,created_by)
select ('ec090000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e3200000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001','e3600000-0000-4000-8000-000000000001',
 'telegram_stars_test','test:bounded:'||n,'telegram_stars','telegram_bot',100,0,'XTR','TELEGRAM','test:recipient','test:payer',1,'CREATED','{}','bounded-'||n,now(),'e3100000-0000-4000-8000-000000000001' from generate_series(1,1600)n;
insert into public.subscription_payments(id,tenant_id,subscription_id,mode,test_invoice_id,event_id,term_snapshot,period_start,period_end)
select ('ec100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e3200000-0000-4000-8000-000000000001',
 'ec030000-0000-4000-8000-000000000001','test',('ec090000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,gen_random_uuid(),
 '{"duration_unit":"fixed_days","duration_count":1}', '2020-01-01Z'::timestamptz+make_interval(days=>(n/3)), '2020-01-02Z'::timestamptz+make_interval(days=>(n/3)) from generate_series(1,1600)n;
