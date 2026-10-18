#!/usr/bin/env bash
set -euo pipefail
phase15_db_url="$1"
phase15_dir=$(mktemp -d)
trap 'rm -rf "$phase15_dir"' EXIT
psql "$phase15_db_url" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users(id,email) values('e1510000-0000-4000-8000-000000000001','phase15-concurrency@example.test');
insert into public.tenants(id,name,slug) values('e1510000-0000-4000-8000-000000000002','Synthetic Phase15 concurrency','phase15-sandbox-concurrency');
insert into public.tenant_members(tenant_id,user_id,role) values('e1510000-0000-4000-8000-000000000002','e1510000-0000-4000-8000-000000000001','manager');
SQL
submit="set role authenticated;select set_config('request.jwt.claim.sub','e1510000-0000-4000-8000-000000000001',false);select public.admin_analytics_cost_submit('e1510000-0000-4000-8000-000000000002','e1510000-0000-4000-8000-000000000003','SUPPLIER','ASSUMPTION','12.00000001','USD',current_date-30,current_date,'SYNTHETIC evidence only',null);"
psql "$phase15_db_url" -v ON_ERROR_STOP=1 -q -c "$submit" >"$phase15_dir/a" & p1=$!
psql "$phase15_db_url" -v ON_ERROR_STOP=1 -q -c "$submit" >"$phase15_dir/b" & p2=$!
wait "$p1";wait "$p2"
test "$(psql "$phase15_db_url" -Atqc "select count(*) from private.analytics_cost_evidence where tenant_id='e1510000-0000-4000-8000-000000000002'")" = 1
item=$(psql "$phase15_db_url" -Atqc "select id from private.analytics_cost_evidence where tenant_id='e1510000-0000-4000-8000-000000000002'")
review="set role authenticated;select set_config('request.jwt.claim.sub','e1510000-0000-4000-8000-000000000001',false);select public.admin_analytics_cost_review('e1510000-0000-4000-8000-000000000002','$item',1,true);"
set +e
psql "$phase15_db_url" -v ON_ERROR_STOP=1 -q -c "$review" >"$phase15_dir/review-a" 2>&1 & p1=$!
psql "$phase15_db_url" -v ON_ERROR_STOP=1 -q -c "$review" >"$phase15_dir/review-b" 2>&1 & p2=$!
wait "$p1";r1=$?;wait "$p2";r2=$?
set -e
test "$(( (r1==0) + (r2==0) ))" = 1
test "$(psql "$phase15_db_url" -Atqc "select count(*) from public.audit_logs where tenant_id='e1510000-0000-4000-8000-000000000002' and action='analytics.cost_reviewed'")" = 1
psql "$phase15_db_url" -v ON_ERROR_STOP=1 -q -c "update public.tenants set status='suspended' where id='e1510000-0000-4000-8000-000000000002';update public.tenant_members set status='disabled' where tenant_id='e1510000-0000-4000-8000-000000000002';" >/dev/null
echo 'PASS: concurrent cost request idempotency, exactly one revision-fenced review and audit, fixture shutdown; no financial/outbound authority'
