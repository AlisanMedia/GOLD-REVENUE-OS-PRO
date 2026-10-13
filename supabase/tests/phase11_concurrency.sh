#!/usr/bin/env bash
set -euo pipefail
phase11_db_url="$1"
phase11_tmp=$(mktemp -d)
trap 'rm -rf "$phase11_tmp"' EXIT
sed 's/e3/f3/g' supabase/tests/helpers/phase11_fixtures.sql | psql "$phase11_db_url" -v ON_ERROR_STOP=1 -q >"$phase11_tmp/setup"
psql "$phase11_db_url" -v ON_ERROR_STOP=1 -Atq >"$phase11_tmp/payment" <<'SQL'
begin;set local role authenticated;select set_config('request.jwt.claim.sub','f3100000-0000-4000-8000-000000000001',true);
select public.admin_create_test_payment_invoice('f3200000-0000-4000-8000-000000000001','f3600000-0000-4000-8000-000000000001','telegram_stars','XTR','100','p11-concurrent');
select public.admin_simulate_test_payment('f3200000-0000-4000-8000-000000000001',(select id from public.payment_invoices where idempotency_key='p11-concurrent'),'settled','p11-concurrent');commit;
select public.payment_record_test_observation('f3200000-0000-4000-8000-000000000001',(select id from public.payment_invoices where idempotency_key='p11-concurrent'),(select id from private.payment_test_snapshots where request_key='p11-concurrent'),'test:p11-concurrent',repeat('a',64),'reconcile');
SQL
for phase11_worker in a b; do
psql "$phase11_db_url" -v ON_ERROR_STOP=1 -Atq >"$phase11_tmp/sub-$phase11_worker" <<'SQL' &
begin;set local role authenticated;select set_config('request.jwt.claim.sub','f3100000-0000-4000-8000-000000000001',true);
select public.admin_create_test_subscription('f3200000-0000-4000-8000-000000000001',(select id from public.payment_invoices where idempotency_key='p11-concurrent'));commit;
SQL
done
wait
psql "$phase11_db_url" -v ON_ERROR_STOP=1 -Atq >"$phase11_tmp/access" <<'SQL'
begin;set local role authenticated;select set_config('request.jwt.claim.sub','f3100000-0000-4000-8000-000000000001',true);
select public.admin_test_access_setup('f3200000-0000-4000-8000-000000000001','f3300000-0000-4000-8000-000000000001',(select id from public.domain_events where customer_id='f3300000-0000-4000-8000-000000000001' and event_type='customer.created'),'test:123');
select public.admin_request_entitlement_access('f3200000-0000-4000-8000-000000000001',(select id from public.subscriptions where tenant_id='f3200000-0000-4000-8000-000000000001'));commit;
SQL
for phase11_worker in a b; do
psql "$phase11_db_url" -v ON_ERROR_STOP=1 -Atq >"$phase11_tmp/job-$phase11_worker" <<'SQL' &
select public.entitlement_claim_job('f3200000-0000-4000-8000-000000000001');
SQL
done
wait
phase11_counts=$(psql "$phase11_db_url" -v ON_ERROR_STOP=1 -Atq <<'SQL'
select (select count(*) from public.subscriptions where tenant_id='f3200000-0000-4000-8000-000000000001')||':'||(select count(*) from public.subscription_payments where tenant_id='f3200000-0000-4000-8000-000000000001')||':'||(select count(*) from public.channel_access where tenant_id='f3200000-0000-4000-8000-000000000001')||':'||(select count(*) from public.entitlement_jobs where tenant_id='f3200000-0000-4000-8000-000000000001' and status='RUNNING');
SQL
)
test "$phase11_counts" = '1:1:1:1'
echo 'PASS: concurrent verified test payment consumers create one subscription, period, access record and exclusive worker lease.'
