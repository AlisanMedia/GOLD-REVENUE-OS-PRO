#!/usr/bin/env bash
set -euo pipefail
phase8_db_url="$1"
phase8_tmp=$(mktemp -d)
trap 'rm -rf "$phase8_tmp"' EXIT
# Fixtures exist only in the disposable CI database, which is destroyed after checks.
psql "$phase8_db_url" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into public.tenants(id,name,slug) values('b8400000-0000-4000-8000-000000000001','Phase8 concurrent','phase8-concurrent');
select public.configure_phase8_orchestration('b8400000-0000-4000-8000-000000000001',true);
insert into public.customers(id,tenant_id,display_name) values('b8500000-0000-4000-8000-000000000001','b8400000-0000-4000-8000-000000000001','Disposable concurrent fixture');
select public.consume_event_for_agent_runtime('b8400000-0000-4000-8000-000000000001',(select id from public.domain_events where customer_id='b8500000-0000-4000-8000-000000000001' and event_type='customer.created'),'concurrent-route');
SQL
for worker in a b; do
  psql "$phase8_db_url" -v ON_ERROR_STOP=1 -Atq >"$phase8_tmp/$worker" <<SQL &
begin;
select count(*) from public.claim_agent_tasks('phase8-concurrent-$worker',1,120);
select pg_sleep(2);
commit;
SQL
done
wait
phase8_total=$(awk '/^[01]$/ {n+=$1} END {print n+0}' "$phase8_tmp/a" "$phase8_tmp/b")
test "$phase8_total" = "1"
echo 'PASS: two concurrent workers claimed the specialist task exactly once.'
