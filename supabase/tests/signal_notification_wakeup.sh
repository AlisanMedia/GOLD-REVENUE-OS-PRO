#!/usr/bin/env bash
set -euo pipefail
w_db="${1:?DISPOSABLE_PG17_REQUIRED}"
[[ "$w_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]] || exit 1
w_root="$(cd "$(dirname "$0")" && pwd)";w_tmp=$(mktemp -d);w_children=()
trap 'for p in "${w_children[@]}";do kill "$p" 2>/dev/null || true;done;rm -rf "$w_tmp"' EXIT
w_sql(){ psql "$w_db" -X -qAt -v ON_ERROR_STOP=1 "$@"; }
test "$(w_sql -c "select current_setting('server_version_num')::int/10000")" = 17
test "$(w_sql -c "select count(*) from public.tenants where id='51b02000-0000-4000-8000-000000000105'")" = 0
{ cat "$w_root/helpers/signal_distribution_fixtures.sql";echo 'select pg_temp.signal_case_setup(105);'; } | w_sql >"$w_tmp/setup" 2>&1
PGAPPNAME=signal-wakeup-listener w_sql >"$w_tmp/listener" 2>&1 <<SQL &
set statement_timeout='8s';listen signal_fixture_dispatch;select pg_backend_pid();
\! touch '$w_tmp/listening'
\! for n in \$(seq 1 500);do test ! -f '$w_tmp/recorded' || exit 0;sleep .01;done;exit 1
\if :SHELL_ERROR
select 1/0;
\endif
select count(*) from private.signal_events where tenant_id='51b02000-0000-4000-8000-000000000105';
\! touch '$w_tmp/checked'
\! for n in \$(seq 1 500);do test ! -f '$w_tmp/committed' || exit 0;sleep .01;done;exit 1
\if :SHELL_ERROR
select 1/0;
\endif
select 1;select count(*) from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000105';
SQL
w_listener=$!;w_children+=("$w_listener")
for n in $(seq 1 500);do test ! -f "$w_tmp/listening" || break;sleep .01;done;test -f "$w_tmp/listening"
{ cat "$w_root/helpers/signal_distribution_fixtures.sql";cat <<SQL
begin;select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(105))->>'duplicate';
\! touch '$w_tmp/recorded'
\! for n in \$(seq 1 500);do test ! -f '$w_tmp/release' || exit 0;sleep .01;done;exit 1
\if :SHELL_ERROR
select 1/0;
\endif
commit;
SQL
} | PGAPPNAME=signal-wakeup-producer w_sql >"$w_tmp/producer" 2>&1 &
w_producer=$!;w_children+=("$w_producer")
for n in $(seq 1 500);do test ! -f "$w_tmp/checked" || break;sleep .01;done;test -f "$w_tmp/checked"
test "$(grep -c '^0$' "$w_tmp/listener")" = 1
touch "$w_tmp/release";wait "$w_producer";touch "$w_tmp/committed";wait "$w_listener"
grep -q 'Asynchronous notification.*signal_fixture_dispatch.*wake' "$w_tmp/listener"
test "$(grep -c '^1$' "$w_tmp/listener")" -ge 2
w_sql -c "update private.signal_controls set enabled=false where tenant_id='51b02000-0000-4000-8000-000000000105';update public.tenants set status='suspended' where id='51b02000-0000-4000-8000-000000000105';" >/dev/null
echo 'PASS SIGNAL-B5: real LISTEN/NOTIFY wake after commit; precommit invisibility; durable queue available without message polling'
