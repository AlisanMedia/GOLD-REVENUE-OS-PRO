#!/usr/bin/env bash
set -euo pipefail
r_db="${1:?DISPOSABLE_PG17_REQUIRED}";[[ "$r_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]] || exit 1
r_root=$(cd "$(dirname "$0")" && pwd);r_tmp=$(mktemp -d);r_children=()
trap 'for p in "${r_children[@]}";do kill "$p" 2>/dev/null || true;done;rm -rf "$r_tmp"' EXIT
r_sql(){ psql "$r_db" -X -qAt -v ON_ERROR_STOP=1 "$@"; }
test "$(r_sql -c "select current_setting('server_version_num')::integer/10000")" = 17
test "$(r_sql -c "select count(*) from public.tenants where id='51d02000-0000-4000-8000-000000000101'")" = 0
{ cat "$r_root/helpers/signal_recovery_fixtures.sql";cat <<'SQL'
select pg_temp.source_setup(n)from generate_series(101,102)n;
select pg_temp.source_command(n,'RECONNECT',jsonb_build_object('at',clock_timestamp()))from generate_series(101,102)n;
select pg_temp.source_observe(101,2,'second');
SQL
} | r_sql >"$r_tmp/seed"
{ cat "$r_root/helpers/signal_distribution_fixtures.sql" | sed 's/51b0/51d0/g;s/signal-sandbox-dispatch-/signal-sandbox-recovery-/g';cat "$r_root/helpers/signal_recovery_fixtures.sql" | sed -n '/create function pg_temp.source_caps/,$p';cat <<SQL
begin;
select pg_backend_pid();
select pg_temp.source_command(101,'RECOVER',jsonb_build_object('page',pg_temp.source_page(101,1,2,jsonb_build_array(jsonb_build_object('sequence',1,'event',pg_temp.signal_dispatch_input(101)::jsonb),jsonb_build_object('sequence',2,'event',pg_temp.signal_dispatch_input(101,'second')::jsonb)))))->>'state';
\! touch '$r_tmp/ready'
\! for n in \$(seq 1 400);do test ! -f '$r_tmp/release' || exit 0;sleep .02;done;exit 1
commit;
SQL
} | PGAPPNAME=signal-source-precommit r_sql >"$r_tmp/crash" 2>&1 &
r_children+=("$!");r_pid=$!
for n in $(seq 1 300);do test ! -f "$r_tmp/ready" || break;sleep .02;done;test -f "$r_tmp/ready"
test "$(r_sql -c "select count(*) from private.signal_events where tenant_id='51d02000-0000-4000-8000-000000000101'")" = 0
r_sql -c "select pg_terminate_backend(pid)from pg_stat_activity where application_name='signal-source-precommit' and datname=current_database()" >"$r_tmp/killed"
touch "$r_tmp/release";if wait "$r_pid";then exit 1;fi
test "$(r_sql -c "select last_sequence from private.signal_source_runtime where tenant_id='51d02000-0000-4000-8000-000000000101'")" = 0
# Rebuild only temporary helper functions, never reseed permanent fixtures.
{ sed '/^create function/,$!d' "$r_root/helpers/signal_distribution_fixtures.sql" | sed 's/51b0/51d0/g;s/signal-sandbox-dispatch-/signal-sandbox-recovery-/g';sed -n '/create function pg_temp.source_caps/,$p' "$r_root/helpers/signal_recovery_fixtures.sql";cat <<'SQL'
select pg_backend_pid();
select pg_temp.source_command(101,'RECOVER',jsonb_build_object('page',pg_temp.source_page(101,1,2,jsonb_build_array(jsonb_build_object('sequence',1,'event',pg_temp.signal_dispatch_input(101)::jsonb),jsonb_build_object('sequence',2,'event',pg_temp.signal_dispatch_input(101,'second')::jsonb)))))->>'last_sequence';
SQL
} | r_sql >"$r_tmp/recovered"
test "$(tail -1 "$r_tmp/recovered")" = 2
# Two distinct backend attempts with the same checkpoint: exactly one may commit.
r_gen=$(r_sql -c "select generation from private.signal_source_runtime where tenant_id='51d02000-0000-4000-8000-000000000102'")
for k in 1 2;do
 { cat "$r_root/helpers/signal_recovery_fixtures.sql";echo "select pg_backend_pid();select pg_temp.source_command(102,'OBSERVE',jsonb_build_object('sequence',1,'event',pg_temp.signal_dispatch_input(102)::jsonb),null,$r_gen)->>'last_sequence';"; } | r_sql >"$r_tmp/race-$k" 2>&1 &
 r_children+=("$!");done
r_ok=0;r_failed=0
for k in "${r_children[@]:1}";do if wait "$k";then r_ok=$((r_ok+1));else r_failed=$((r_failed+1));fi;done
test "$r_ok" = 1;test "$r_failed" = 1
test "$(head -1 "$r_tmp/race-1")" != "$(head -1 "$r_tmp/race-2")"
test "$(r_sql -c "select count(*)from private.signal_events where tenant_id='51d02000-0000-4000-8000-000000000102'")" = 1
r_sql -c "update private.signal_controls set enabled=false where tenant_id in('51d02000-0000-4000-8000-000000000101','51d02000-0000-4000-8000-000000000102');update public.tenants set status='suspended'where id in('51d02000-0000-4000-8000-000000000101','51d02000-0000-4000-8000-000000000102');" >/dev/null
echo 'PASS source recovery: independent crash/reader/recovery backends; precommit rollback; exact checkpoint recovery; two competing workers one generation winner; fixtures disabled'
