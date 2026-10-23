#!/usr/bin/env bash
set -euo pipefail
s_db="${1:?DISPOSABLE_PG17_REQUIRED}"
[[ "$s_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]] || exit 1
s_tmp=$(mktemp -d);s_pids=();trap 'for p in "${s_pids[@]}";do kill "$p" 2>/dev/null || true;done;rm -rf "$s_tmp"' EXIT
s_root="$(cd "$(dirname "$0")" && pwd)"
s_sql(){ psql "$s_db" -X -qAt -v ON_ERROR_STOP=1 "$@"; }
test "$(s_sql -c "select current_setting('server_version_num')::int/10000")" = 17
test "$(s_sql -c "select count(*) from public.tenants where id='51a12000-0000-4000-8000-000000000001'")" = 0
sed 's/51a0/51a1/g' "$s_root/helpers/signal_fixtures.sql" | s_sql >"$s_tmp/setup"
s_raw='{"version":1,"mode":"SYNTHETIC","tenant_id":"51a12000-0000-4000-8000-000000000001","source_id":"51a13000-0000-4000-8000-000000000001","message_key":"race","revision":1,"kind":"MESSAGE","observed_at":"2026-10-23T18:00:00Z","published_at":null,"reply_to":null,"original_text":"BUY XAUUSD","attachments":[],"interpretation":null}'

for n in 1 2;do
 PGAPPNAME="signal-ingestion-$n" s_sql >"$s_tmp/worker-$n" <<SQL &
set statement_timeout='8s';begin;select pg_backend_pid();select private.signal_record_fixture_v1(\$event\$$s_raw\$event\$)->>'duplicate';select pg_sleep(.1);commit;
SQL
 s_pids+=("$!")
done
wait "${s_pids[0]}";wait "${s_pids[1]}"
test "$(head -1 "$s_tmp/worker-1")" != "$(head -1 "$s_tmp/worker-2")"
test "$(cat "$s_tmp/worker-1" "$s_tmp/worker-2" | grep -c '^false$')" = 1
test "$(cat "$s_tmp/worker-1" "$s_tmp/worker-2" | grep -c '^true$')" = 1
test "$(s_sql -c "select count(*) from private.signal_events where tenant_id='51a12000-0000-4000-8000-000000000001'")" = 1
echo 'PASS SIGNAL-A1: distinct PostgreSQL backends; concurrent replay produces one event and one audit'
# A new connection after the original workers exit recovers the durable identity.
test "$(s_sql -c "select private.signal_record_fixture_v1(\$event\$$s_raw\$event\$)->>'duplicate'")" = true
test "$(s_sql -c "select count(*) from public.audit_logs where tenant_id='51a12000-0000-4000-8000-000000000001' and action='signal.synthetic_observed'")" = 1
echo 'PASS SIGNAL-A2: reconnect/replay retains identity, history and one audit'
