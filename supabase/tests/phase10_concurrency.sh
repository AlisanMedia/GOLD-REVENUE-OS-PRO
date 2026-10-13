#!/usr/bin/env bash
set -euo pipefail
phase10_db_url="$1"
phase10_tmp=$(mktemp -d)
trap 'rm -rf "$phase10_tmp"' EXIT
psql "$phase10_db_url" -v ON_ERROR_STOP=1 -q -f supabase/tests/helpers/phase10_fixtures.sql >"$phase10_tmp/setup"
# Concurrent callers share the same authorized invoice request.
for worker in a b; do
 psql "$phase10_db_url" -v ON_ERROR_STOP=1 -Atq >"$phase10_tmp/create-$worker" <<'SQL' &
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','d3100000-0000-4000-8000-000000000001',true);
select public.admin_create_test_payment_invoice('d3200000-0000-4000-8000-000000000001','d3600000-0000-4000-8000-000000000001','external_crypto','USDT','79000000','concurrent-invoice');
commit;
SQL
done
wait
psql "$phase10_db_url" -v ON_ERROR_STOP=1 -Atq >"$phase10_tmp/snapshot" <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','d3100000-0000-4000-8000-000000000001',true);
select public.admin_simulate_test_payment('d3200000-0000-4000-8000-000000000001',(select id from public.payment_invoices where idempotency_key='concurrent-invoice'),'settled','concurrent-fixture');
commit;
SQL
for worker in a b; do
 psql "$phase10_db_url" -v ON_ERROR_STOP=1 -Atq >"$phase10_tmp/record-$worker" <<'SQL' &
begin;
select public.payment_record_test_observation('d3200000-0000-4000-8000-000000000001',(select id from public.payment_invoices where idempotency_key='concurrent-invoice'),(select id from private.payment_test_snapshots where request_key='concurrent-fixture'),'test:concurrent:event',repeat('a',64),'webhook');
commit;
SQL
done
wait
phase10_counts=$(psql "$phase10_db_url" -v ON_ERROR_STOP=1 -Atq <<'SQL'
select (select count(*) from public.payment_invoices where idempotency_key='concurrent-invoice')||':'||(select count(*) from public.payment_observations where event_id='test:concurrent:event')||':'||(select count(*) from public.payment_transactions where tenant_id='d3200000-0000-4000-8000-000000000001')||':'||(select count(*) from public.audit_logs where action='payment.test_evidence_recorded' and tenant_id='d3200000-0000-4000-8000-000000000001')||':'||(select count(*) from public.domain_events where event_type='payment.test_observed' and tenant_id='d3200000-0000-4000-8000-000000000001');
SQL
)
test "$phase10_counts" = "1:1:1:1:1"
echo 'PASS: concurrent requests created one invoice, transaction, observation, audit and test event.'
