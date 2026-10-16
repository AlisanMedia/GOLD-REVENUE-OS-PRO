#!/usr/bin/env bash
set -euo pipefail
phase13_db_url="$1"
phase13_tmp=$(mktemp -d)
trap 'rm -rf "$phase13_tmp"' EXIT
psql "$phase13_db_url" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at) values('c1300000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p13-concurrency@example.test','not-used',now());
insert into public.tenants(id,name,slug) values('c1310000-0000-4000-8000-000000000001','Phase13 concurrency TEST','phase13-sandbox-concurrent');
insert into public.tenant_members(tenant_id,user_id,role) values('c1310000-0000-4000-8000-000000000001','c1300000-0000-4000-8000-000000000001','manager');
select public.configure_phase13_sandbox('c1310000-0000-4000-8000-000000000001',true);
insert into public.customers(id,tenant_id,display_name) values('c1320000-0000-4000-8000-000000000001','c1310000-0000-4000-8000-000000000001','Concurrent synthetic customer');
select private.success_enqueue('c1310000-0000-4000-8000-000000000001','c1320000-0000-4000-8000-000000000001','second-source');
SQL
for worker in a b; do
 psql "$phase13_db_url" -v ON_ERROR_STOP=1 -Atq >"$phase13_tmp/worker-$worker" <<'SQL' &
begin;
select public.process_customer_success_jobs('c1310000-0000-4000-8000-000000000001',1);
select pg_sleep(.25);
commit;
SQL
done
wait
phase13_count=$(psql "$phase13_db_url" -Atq -c "select count(*) from public.customer_success_tasks where tenant_id='c1310000-0000-4000-8000-000000000001'")
test "$phase13_count" = 1
phase13_task=$(psql "$phase13_db_url" -Atq -c "select id from public.customer_success_tasks where tenant_id='c1310000-0000-4000-8000-000000000001'")
phase13_pids=()
for worker in a b; do
 psql "$phase13_db_url" -v ON_ERROR_STOP=1 -Atq >"$phase13_tmp/action-$worker" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','c1300000-0000-4000-8000-000000000001',true);
select public.admin_success_action('c1310000-0000-4000-8000-000000000001','$phase13_task',1,'claim');
commit;
SQL
 phase13_pids+=("$!")
done
phase13_success=0
for phase13_pid in "${phase13_pids[@]}"; do
 if wait "$phase13_pid"; then phase13_success=$((phase13_success+1)); fi
done
test "$phase13_success" = 1
psql "$phase13_db_url" -v ON_ERROR_STOP=1 -Atq <<'SQL'
do $$begin
 if (select revision from public.customer_success_tasks where tenant_id='c1310000-0000-4000-8000-000000000001')<>2 then raise exception 'revision fence failed';end if;
 if (select count(*) from public.customer_success_history where tenant_id='c1310000-0000-4000-8000-000000000001' and action='claim')<>1 then raise exception 'duplicate claim evidence';end if;
 if (select count(*) from public.customer_success_history where tenant_id='c1310000-0000-4000-8000-000000000001' and action='created')<>1 then raise exception 'duplicate task';end if;
 if exists(select 1 from public.messages where tenant_id='c1310000-0000-4000-8000-000000000001' and direction='outbound') then raise exception 'unauthorized message';end if;
end;$$;
select public.configure_phase13_sandbox('c1310000-0000-4000-8000-000000000001',false);
SQL
printf 'PASS: two workers/one customer create one task; concurrent actions have one winner; revision and audit agree; no outbound.\n'
