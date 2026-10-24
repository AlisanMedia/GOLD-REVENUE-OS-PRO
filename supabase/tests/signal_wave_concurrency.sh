#!/usr/bin/env bash
set -euo pipefail
w_db="${1:?DISPOSABLE_PG17_REQUIRED}"
[[ "$w_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]]||exit 1
w_root=$(cd "$(dirname "$0")"&&pwd);w_tmp=$(mktemp -d);w_children=()
trap 'for p in "${w_children[@]}";do kill "$p" 2>/dev/null||true;done;rm -rf "$w_tmp"' EXIT
w_sql(){ psql "$w_db" -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@"; }
test "$(w_sql -c "select current_setting('server_version_num')::int/10000")" = 17
test "$(w_sql -c "select count(*)from public.tenants where id='51f02000-0000-4000-8000-000000000101'")" = 0
{ cat "$w_root/helpers/signal_wave_fixtures.sql";cat <<'SQL'
select pg_temp.signal_case_setup(n)from generate_series(101,102)n;
select private.signal_wave_configure_fixture_v1(pg_temp.signal_case_id(n,'2000'),pg_temp.signal_case_id(n,'5000'),2)from generate_series(101,102)n;
select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(n,'one-'||k))from generate_series(101,102)n cross join generate_series(1,2)k;
SQL
}|w_sql >"$w_tmp/seed" 2>&1
PGAPPNAME=signal-wave-precommit w_sql >"$w_tmp/precommit" 2>&1 <<SQL &
set statement_timeout='10s';begin;select pg_backend_pid();select private.signal_wave_prepare_fixture_v1('51f02000-0000-4000-8000-000000000101','51f05000-0000-4000-8000-000000000101')->>'state';
\! touch '$w_tmp/ready'
\! for n in \$(seq 1 400);do test ! -f '$w_tmp/release'||exit 0;sleep .02;done;exit 1
commit;
SQL
w_children+=("$!");w_pid=$!
for n in $(seq 1 300);do test ! -f "$w_tmp/ready"||break;sleep .02;done;test -f "$w_tmp/ready"
test "$(w_sql -c "select count(*)from private.signal_attempts where tenant_id='51f02000-0000-4000-8000-000000000101'")" = 0
PGAPPNAME=signal-wave-contender w_sql >"$w_tmp/contender" <<'SQL'
select pg_backend_pid();select private.signal_wave_prepare_fixture_v1('51f02000-0000-4000-8000-000000000101','51f05000-0000-4000-8000-000000000101')->>'state';
SQL
test "$(head -1 "$w_tmp/contender")" != "$(head -1 "$w_tmp/precommit")";test "$(tail -1 "$w_tmp/contender")" = BUSY
w_sql -c "select pg_terminate_backend(pid)from pg_stat_activity where application_name='signal-wave-precommit'and datname=current_database()" >"$w_tmp/killed"
touch "$w_tmp/release";if wait "$w_pid";then exit 1;fi
test "$(w_sql -c "select count(*)from private.signal_attempts where tenant_id='51f02000-0000-4000-8000-000000000101'")" = 0
test "$(w_sql -c "select sum(claims)from private.signal_deliveries where tenant_id='51f02000-0000-4000-8000-000000000101'")" = 0
for n in 1 2;do
 PGAPPNAME="signal-wave-race-$n" w_sql >"$w_tmp/race-$n" <<'SQL' &
select pg_backend_pid();select private.signal_wave_prepare_fixture_v1('51f02000-0000-4000-8000-000000000102','51f05000-0000-4000-8000-000000000102')->>'state';
SQL
 w_children+=("$!")
done
wait "${w_children[1]}";wait "${w_children[2]}"
test "$(head -1 "$w_tmp/race-1")" != "$(head -1 "$w_tmp/race-2")"
test "$(cat "$w_tmp/race-1" "$w_tmp/race-2"|grep -c '^PREPARED$')" = 1
test "$(w_sql -c "select count(*)from private.signal_attempts where tenant_id='51f02000-0000-4000-8000-000000000102'")" = 2
w_sql <<'SQL' >"$w_tmp/unknown"
update private.signal_deliveries set lease_until=clock_timestamp()-interval '1 second'where tenant_id='51f02000-0000-4000-8000-000000000102';
select private.signal_claim_fixture_v1('51f02000-0000-4000-8000-000000000102')->>'state';
select private.signal_wave_prepare_fixture_v1('51f02000-0000-4000-8000-000000000102','51f05000-0000-4000-8000-000000000102')->>'state';
SQL
test "$(tail -1 "$w_tmp/unknown")" = RECOVERY_REQUIRED
test "$(w_sql -c "select count(*)from private.signal_deliveries where tenant_id='51f02000-0000-4000-8000-000000000102'and status='UNKNOWN'")" = 1
w_sql -c "update private.signal_controls set enabled=false where tenant_id in('51f02000-0000-4000-8000-000000000101','51f02000-0000-4000-8000-000000000102');update public.tenants set status='suspended'where id in('51f02000-0000-4000-8000-000000000101','51f02000-0000-4000-8000-000000000102');" >/dev/null
echo 'PASS independent wave: actual backend race and precommit death; atomic rollback; one committed two-item wave; lost prepare and expired begun effect require recovery, no resend; fixtures disabled'
