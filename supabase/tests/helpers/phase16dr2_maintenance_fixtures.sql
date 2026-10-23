-- Fresh disposable scope, imported by pgTAP and real-backend concurrency tests.
\ir phase16de_fixtures.sql
insert into public.customers(id,tenant_id,display_name)
select ('16a20000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'16de2000-0000-4000-8000-000000000001','Synthetic maintenance'
from generate_series(1,128) n;
insert into public.subscriptions(id,tenant_id,customer_id,plan_version_id,mode,state,plan_snapshot,commercial_snapshot,starts_at,ends_at,grace_until,renewal_due_at)
select ('16a21000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'16de2000-0000-4000-8000-000000000001',
 ('16a20000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'16de5000-0000-4000-8000-000000000002','test','ACTIVE','{}','{}',
 now()-interval '60 days',case when n<=64 then now()-interval '1 day' else now()+interval '1 day' end,
 case when n<=64 then now()-interval '1 day' else now()+interval '1 day' end,now()-interval '2 days'
from generate_series(1,128) n;

-- One historical TEST subscription has fake access; expiry retains its obligation.
do $$begin
 perform set_config('request.jwt.claim.sub','16de1000-0000-4000-8000-000000000001',true);
 perform public.admin_test_access_setup('16de2000-0000-4000-8000-000000000001','16a20000-0000-4000-8000-000000000001',
  (select id from public.domain_events where customer_id='16a20000-0000-4000-8000-000000000001' and event_type='customer.created'),'test:1622');
end;$$;
-- Owner-created historical fixture only: the runtime correctly refuses a new
-- admission for an already expired subscription. No permission is relaxed.
insert into public.channel_access(tenant_id,subscription_id,binding_id,channel_id,mode)
select '16de2000-0000-4000-8000-000000000001','16a21000-0000-4000-8000-000000000001',b.id,c.id,'test'
from public.telegram_entitlement_bindings b join public.vip_channels c on c.tenant_id=b.tenant_id and c.mode='test'
where b.customer_id='16a20000-0000-4000-8000-000000000001' and b.mode='test';
