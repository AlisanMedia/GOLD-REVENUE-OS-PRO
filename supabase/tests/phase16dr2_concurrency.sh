#!/usr/bin/env bash
set -euo pipefail
m_db="${1:?LOCAL_POSTGRESQL17_REQUIRED}"
[[ "$m_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]] || exit 1
m_tmp=$(mktemp -d);m_children=();m_root="$(cd "$(dirname "$0")" && pwd)"
m_cleanup(){ local result=$?;for pid in "${m_children[@]}";do kill "$pid" 2>/dev/null || true;done;rm -rf "$m_tmp";return "$result"; };trap m_cleanup EXIT
m_sql(){ psql "$m_db" -X -qAt -v ON_ERROR_STOP=1 "$@"; }
m_expect(){ test "$(m_sql -c "$1")" = "$2" || { echo "MAINTENANCE_ASSERTION_FAILED: $3" >&2;exit 1; }; }
m_expect "select current_setting('server_version_num')::int/10000" 17 'PG17 only'
m_expect "select count(*) from public.tenants where id='16b22000-0000-4000-8000-000000000001'" 0 'fresh own fixture required'
# Resolve the two include levels explicitly so the remapped fixtures stay isolated.
sed 's/16de/16b2/g' "$m_root/helpers/phase16de_fixtures.sql" | m_sql >"$m_tmp/setup" 2>&1
sed '/^\\ir /d;s/16de/16b2/g;s/16a2/16b3/g' "$m_root/helpers/phase16dr2_maintenance_fixtures.sql" | m_sql >"$m_tmp/history" 2>&1
PGAPPNAME=phase16dr2-maintenance-a m_sql >"$m_tmp/a" 2>&1 <<SQL &
set statement_timeout='8s';begin;
select pg_backend_pid();
select public.entitlement_test_maintenance_v1('16b22000-0000-4000-8000-000000000001')->>'processed';
\! touch '$m_tmp/ready'
\! for n in \$(seq 1 500);do test ! -f '$m_tmp/release' || exit 0;sleep .02;done;exit 1
\if :SHELL_ERROR
select 1/0;
\endif
commit;
SQL
m_pid=$!;m_children+=("$m_pid")
for n in $(seq 1 300);do test ! -f "$m_tmp/ready" || break;sleep .02;done;test -f "$m_tmp/ready"
PGAPPNAME=phase16dr2-maintenance-b m_sql >"$m_tmp/b" <<'SQL'
set statement_timeout='2s';select pg_backend_pid();
select public.entitlement_test_maintenance_v1('16b22000-0000-4000-8000-000000000001')->>'busy';
SQL
test "$(head -1 "$m_tmp/a")" != "$(head -1 "$m_tmp/b")";test "$(tail -1 "$m_tmp/b")" = true
echo 'PASS R2-C1: two independent backend PIDs, nonblocking busy response, no duplicated maintenance'
m_expect "select pg_terminate_backend(pid) from pg_stat_activity where application_name='phase16dr2-maintenance-a' and datname=current_database()" t 'only own precommit backend'
touch "$m_tmp/release";if wait "$m_pid";then echo PRECOMMIT_DEATH_REQUIRED >&2;exit 1;fi
m_expect "select count(*) from public.subscriptions where tenant_id='16b22000-0000-4000-8000-000000000001' and state='EXPIRED'" 0 'state rolls back'
m_expect "select count(*) from public.entitlement_audit where tenant_id='16b22000-0000-4000-8000-000000000001' and action in ('expired','renewal_due')" 0 'audit rolls back'
m_expect "select count(*) from public.entitlement_jobs where tenant_id='16b22000-0000-4000-8000-000000000001' and operation='revoke'" 0 'obligation insert rolls back atomically'
echo 'PASS R2-C2: killed precommit maintenance rolls back state, audit and queued compensation'
for worker in 1 2;do
 PGAPPNAME="phase16dr2-drain-$worker" m_sql >"$m_tmp/drain-$worker" 2>&1 <<'SQL' &
select pg_backend_pid();
select 'select public.entitlement_test_maintenance_v1(''16b22000-0000-4000-8000-000000000001'');select pg_sleep(0.002);' from generate_series(1,24) \gexec
SQL
 m_children+=("$!")
done
wait "${m_children[1]}";wait "${m_children[2]}"
test "$(head -1 "$m_tmp/drain-1")" != "$(head -1 "$m_tmp/drain-2")"
m_expect "select count(*) from public.subscriptions where tenant_id='16b22000-0000-4000-8000-000000000001' and state='EXPIRED'" 64 'expiry completes'
m_expect "select count(*) from public.subscriptions where tenant_id='16b22000-0000-4000-8000-000000000001' and state='RENEWAL_DUE'" 64 'renewal completes'
m_expect "select count(*) from public.entitlement_audit where tenant_id='16b22000-0000-4000-8000-000000000001' and action in ('expired','renewal_due')" 128 'one audit per transition'
m_expect "select count(*) from public.entitlement_jobs where tenant_id='16b22000-0000-4000-8000-000000000001' and operation='revoke'" 1 'admitted expiry retains one obligation'
m_expect "select status from public.channel_access where subscription_id='16b31000-0000-4000-8000-000000000001'" REVIEW 'never falsely reports revoked'
echo 'PASS R2-C3: bounded independent concurrent drain, 128 unique transitions, retained revoke obligation'
