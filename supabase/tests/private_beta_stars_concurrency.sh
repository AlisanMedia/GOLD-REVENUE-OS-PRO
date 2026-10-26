#!/usr/bin/env bash
set -euo pipefail
s_db="${1:?DISPOSABLE_PG17_REQUIRED}"
[[ "$s_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]]||exit 1
s_root=$(cd "$(dirname "$0")"&&pwd);s_tmp=$(mktemp -d);s_created=false;s_case=SETUP
s_sql(){ psql "$s_db" -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@"; }
s_id(){ printf '9b00%s-0000-4000-8000-%012d' "$2" "$1"; }
s_cleanup(){ local status=$?;for pid in $(jobs -pr);do kill "$pid" 2>/dev/null||true;done
 if test "$s_created" = true;then s_sql -c "update public.tenants set status='suspended'where slug in('private-beta-fixture-9401','private-beta-fixture-9402','private-beta-fixture-9403','private-beta-fixture-9404','private-beta-fixture-9405','private-beta-fixture-9406','private-beta-fixture-9407');" >/dev/null||status=1;fi
 if test "$status" = 0;then rm -rf "$s_tmp";else echo "STARS_TEST_CONCURRENCY_FAILED: $s_case; original synthetic evidence/logs retained at $s_tmp" >&2;fi
 exit "$status"; };trap s_cleanup EXIT
test "$(s_sql -c "select current_setting('server_version_num')::int/10000")" = 17
test "$(s_sql -c "select count(*)from public.tenants where id='$(s_id 9401 2000)'")" = 0
{ printf 'begin;\n';cat "$s_root/helpers/private_beta_uat_fixtures.sql";sed '/^\\ir /d' "$s_root/helpers/private_beta_stars_fixtures.sql";printf '\nselect pg_temp.stars_setup(9401);select pg_temp.stars_setup(9402,1);select pg_temp.stars_setup(9403);select pg_temp.stars_setup(9404);select pg_temp.stars_setup(9405);select pg_temp.stars_setup(9406);select pg_temp.stars_setup(9407);select pg_temp.stars_record(9407);select pg_temp.stars_access_setup(9407);select pg_temp.stars_prepare_ledger(9403);select pg_temp.stars_prepare_ledger(9404);select pg_temp.stars_prepare_ledger(9405);commit;\n'; }|s_sql >"$s_tmp/setup" 2>&1
s_created=true
s_reserve(){ local n="$1";local key="$2";printf "select public.private_beta_stars_reserve_v1('%s','%s',1,'getMe','%s',private.fse_hash('effect:%s'),private.fse_hash('request:%s'),'%s');" "$(s_id "$n" 2000)" "$(s_id "$n" 3000)" "$key" "$key" "$key" "$(s_id "$n" 6500)"; }
s_wait(){ local app="$1";local event="$2";for attempt in $(seq 1 150);do if test "$(s_sql -c "select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='$app'and wait_event_type='$event')")" = t;then return 0;fi;sleep .01;done;return 1; }
s_first(){ local app="$1";local command="$2";local delay="$3";s_sql >"$s_tmp/$app" 2>&1 <<SQL &
begin;set local application_name='$app';$command select pg_sleep($delay);commit;
SQL
 s_first_pid=$!;s_wait "$app" Timeout; }
s_record(){ local n="$1";local charge="$2";local app="$3";local pause="${4:-0}";local kind="${5:-PAYMENT}";{
 printf "begin;set local application_name='%s';set local statement_timeout='12s';\n" "$app";cat "$s_root/helpers/private_beta_uat_fixtures.sql";sed '/^\\ir /d' "$s_root/helpers/private_beta_stars_fixtures.sql";
 printf "insert into stars_cases(n,invoice)select %d,public.private_beta_stars_invoice_v1('%s','%s','%s','stars-fixture-invoice-%d');select pg_temp.stars_record(%d,'%s','%s');select pg_sleep(%d);commit;\n" "$n" "$(s_id "$n" 2000)" "$(s_id "$n" 3000)" "$(s_id "$n" 4600)" "$n" "$n" "$kind" "$charge" "$pause"; }|s_sql; }
s_case=C1
s_cmd=$(s_reserve 9401 identical);s_first stars-replay-a "$s_cmd" 2
s_pid_a=$(s_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='stars-replay-a'")
test "$(s_sql -c "select request_count from private.private_beta_stars_controls where program_id='$(s_id 9401 3000)'")" = 0
s_sql -c "begin;set local application_name='stars-replay-b';set local statement_timeout='8s';$s_cmd commit;" >"$s_tmp/replay-b" 2>&1 &
s_second=$!;s_wait stars-replay-b Lock
s_pid_b=$(s_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='stars-replay-b'")
test -n "$s_pid_a";test -n "$s_pid_b";test "$s_pid_a" != "$s_pid_b";wait "$s_first_pid";wait "$s_second"
test "$(s_sql -c "select request_count from private.private_beta_stars_controls where program_id='$(s_id 9401 3000)'")" = 1
echo "PASS STARS-C1: independent backend_a=$s_pid_a backend_b=$s_pid_b, actual lock wait, one committed reservation after replay"
s_case=C2
s_first stars-cap-a "$(s_reserve 9402 one)" 2
s_sql -c "begin;set local application_name='stars-cap-b';set local statement_timeout='8s';$(s_reserve 9402 two)commit;" >"$s_tmp/cap-b" 2>&1 &
s_second=$!;s_wait stars-cap-b Lock;wait "$s_first_pid";if wait "$s_second";then exit 1;fi;grep -q 42501 "$s_tmp/cap-b"
test "$(s_sql -c "select request_count from private.private_beta_stars_controls where program_id='$(s_id 9402 3000)'")" = 1
echo 'PASS STARS-C2: concurrent distinct requests cannot overshoot persisted TEST lifetime cap'
s_case=C3
s_record 9403 shared-TEST-charge stars-global-a 2 >"$s_tmp/global-a" 2>&1 &s_a=$!;s_wait stars-global-a Timeout
s_record 9404 shared-TEST-charge stars-global-b >"$s_tmp/global-b" 2>&1 &s_b=$!;s_wait stars-global-b Lock
wait "$s_a";if wait "$s_b";then exit 1;fi;grep -q 23505 "$s_tmp/global-b"
test "$(s_sql -c "select count(*)from private.private_beta_stars_receipts where charge_id='shared-TEST-charge'")" = 1
test "$(s_sql -c "select count(*)from public.subscriptions where tenant_id='$(s_id 9404 2000)'")" = 0
echo 'PASS STARS-C3: cross-tenant concurrent same physical TEST charge has one receipt/period owner'
s_case=C4
s_record 9405 rollback-TEST-charge stars-crash 10 >"$s_tmp/crash" 2>&1 &s_a=$!;s_wait stars-crash Timeout
test "$(s_sql -c "select count(*)from private.private_beta_stars_receipts where tenant_id='$(s_id 9405 2000)'")" = 0
s_sql -c "select pg_terminate_backend(pid)from pg_stat_activity where datname=current_database()and application_name='stars-crash'" >"$s_tmp/killed"
if wait "$s_a";then exit 1;fi
test "$(s_sql -c "select count(*)from public.subscription_payments where tenant_id='$(s_id 9405 2000)'")" = 0
test "$(s_sql -c "select count(*)from private.private_beta_stars_attempts where tenant_id='$(s_id 9405 2000)'")" = 1
s_record 9405 rollback-TEST-charge stars-recovered >"$s_tmp/recovered" 2>&1
test "$(s_sql -c "select count(*)from private.private_beta_stars_receipts where tenant_id='$(s_id 9405 2000)'")" = 1
test "$(s_sql -c "select count(*)from public.subscription_payments where tenant_id='$(s_id 9405 2000)'")" = 1
test "$(s_sql -c "select count(*)from public.domain_events where tenant_id='$(s_id 9405 2000)'and event_type='payment.test_observed'")" = 1
echo 'PASS STARS-C4: real backend crash rolls receipt/event/period back; committed provider attempt survives and recovers once'
s_case=C5
s_first stars-generation-a "update private.private_beta_programs set generation=generation+1 where id='$(s_id 9406 3000)';" 2
s_sql -c "begin;set local application_name='stars-generation-b';set local statement_timeout='8s';$(s_reserve 9406 stale)commit;" >"$s_tmp/stale" 2>&1 &s_second=$!;s_wait stars-generation-b Lock;wait "$s_first_pid";if wait "$s_second";then exit 1;fi;grep -q 42501 "$s_tmp/stale"
test "$(s_sql -c "select request_count from private.private_beta_stars_controls where program_id='$(s_id 9406 3000)'")" = 0
echo 'PASS STARS-C5: current program share-lock fences owner generation changes before reservation commit'
s_case=C6
s_first stars-access-a "select public.private_beta_stars_access_claim_v1('$(s_id 9407 2000)','$(s_id 9407 3000)');" 2
s_sql -c "begin;set local application_name='stars-access-b';set local statement_timeout='8s';select public.private_beta_stars_access_claim_v1('$(s_id 9407 2000)','$(s_id 9407 3000)');commit;" >"$s_tmp/access-b" 2>&1 &s_second=$!;s_wait stars-access-b Lock;wait "$s_first_pid";wait "$s_second"
test "$(s_sql -c "select count(*)from private.private_beta_stars_access_leases where program_id='$(s_id 9407 3000)'")" = 1
grep -q '"job": null' "$s_tmp/access-b"
echo 'PASS STARS-C6: two independent workers serialize on one durable dedicated TEST access lease'
s_case=C7
s_first stars-maintenance-guard "select pg_advisory_xact_lock(hashtextextended('entitlement-test-cycle-v1:$(s_id 9407 2000)',0));" 2
s_record 9407 TEST-opaque-charge-9407 stars-refund-atomic 0 REFUND >"$s_tmp/refund-atomic" 2>&1
test "$(s_sql -c "select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='stars-maintenance-guard'and wait_event_type='Timeout')")" = t
test "$(s_sql -c "select state from public.subscriptions where tenant_id='$(s_id 9407 2000)'")" = SUSPENDED
test "$(s_sql -c "select count(*)from public.entitlement_jobs where tenant_id='$(s_id 9407 2000)'and operation='revoke'and status='PENDING'")" = 1
wait "$s_first_pid"
echo 'PASS STARS-C7: a busy independent maintenance cycle cannot postpone atomic TEST refund suppression/revoke obligation'
test "$(s_sql -c "select count(*)from private.verified_payment_receipts")" = 0
test "$(s_sql -c "select count(*)from public.domain_events where event_type='payment.confirmed'")" = 0
echo 'PASS STARS invariants: provider calls0, genuine receipt/event0, LIVE authorityNONE; synthetic audit retained'
