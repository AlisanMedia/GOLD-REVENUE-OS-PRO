#!/usr/bin/env bash
set -euo pipefail
p_db="${1:?DISPOSABLE_PG17_REQUIRED}"
[[ "$p_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]]||exit 1
p_root=$(cd "$(dirname "$0")"&&pwd);p_tmp=$(mktemp -d);p_created=false;p_case=SETUP
p_sql(){ psql "$p_db" -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@"; }
p_id(){ printf "91cb%s-0000-4000-8000-%012d" "$2" "$1"; }
p_cleanup(){ local status=$?;for pid in $(jobs -pr);do kill "$pid" 2>/dev/null||true;done
 if test "$p_created" = true;then p_sql -c "update public.tenants set status='suspended'where slug in('polat-sandbox-experiment-8501','polat-sandbox-experiment-8502','polat-sandbox-experiment-8503','polat-sandbox-experiment-8504','polat-sandbox-experiment-8505');" >/dev/null||status=1;fi
 test "$status" = 0||echo "POLAT_BRIDGE_CONCURRENCY_FAILED: $p_case; committed synthetic evidence retained" >&2
 rm -rf "$p_tmp";exit "$status"; }
trap p_cleanup EXIT
test "$(p_sql -c "select current_setting('server_version_num')::int/10000")" = 17
test "$(p_sql -c "select count(*)from public.tenants where id='$(p_id 8501 1000)'")" = 0
{ printf 'begin;\n';cat "$p_root/helpers/polat_experiment_fixtures.sql";printf '\nselect pg_temp.bridge_setup(8501);select pg_temp.bridge_setup(8502,1);select pg_temp.bridge_setup(8503);select pg_temp.bridge_setup(8504);select pg_temp.bridge_setup(8505,1,\x270.02\x27,1);commit;\n'; }|p_sql >"$p_tmp/setup" 2>&1
p_created=true
p_reserve(){ local n="$1";local s="${2:-1}";local ordinal=$((n*100+s));printf "select private.polat_experiment_reserve_fixture('%s','%s','%s',(select binding->'targets'->>%d from private.polat_experiment_runs where id='%s'),repeat('e',64),repeat('f',64),(select binding_hash from private.polat_experiment_runs where id='%s'));" "$(p_id "$n" 1000)" "$(p_id "$n" 2000)" "$(p_id "$ordinal" 3000)" "$((s-1))" "$(p_id "$n" 2000)" "$(p_id "$n" 2000)"; }
p_begin(){ local n="$1";local key="${2:-$((n*100+1))}";printf "select private.polat_experiment_begin_fixture('%s','%s','%s',(select binding_hash from private.polat_experiment_runs where id='%s'),'%s','%s');" "$(p_id "$n" 1000)" "$(p_id "$n" 2000)" "$(p_id "$((n*100+1))" 3000)" "$(p_id "$n" 2000)" "$(p_id "$key" 4000)" "$(p_id "$n" 6000)"; }
p_wait(){ local app="$1";local event="$2";for attempt in $(seq 1 100);do if test "$(p_sql -c "select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='$app'and wait_event_type='$event')")" = t;then return 0;fi;sleep .01;done;return 1; }
p_first(){ local app="$1";local command="$2";local delay="$3";p_sql >"$p_tmp/$app" 2>&1 <<SQL &
begin;set local application_name='$app';$command select pg_sleep($delay);commit;
SQL
 p_first_pid=$!;p_wait "$app" Timeout; }
p_case=C1
p_cmd=$(p_reserve 8501);p_first bridge-replay-first "$p_cmd" 3
p_pid_a=$(p_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='bridge-replay-first'")
test "$(p_sql -c "select request_count from private.polat_experiment_runs where id='$(p_id 8501 2000)'")" = 0
p_sql -c "begin;set local application_name='bridge-replay-second';set local statement_timeout='8s';$p_cmd commit;" >"$p_tmp/replay-second" 2>&1 &
p_second=$!;p_wait bridge-replay-second Lock
p_pid_b=$(p_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='bridge-replay-second'")
test -n "$p_pid_a";test -n "$p_pid_b";test "$p_pid_a" != "$p_pid_b";wait "$p_first_pid";wait "$p_second"
test "$(p_sql -c "select request_count from private.polat_experiment_runs where id='$(p_id 8501 2000)'")" = 1
echo 'PASS BRIDGE-C1: independent backend PIDs, actual lock wait, precommit invisibility, duplicate reserve counts once'
p_case=C2
p_first bridge-cap-first "$(p_reserve 8502)" 3
p_sql -c "begin;set local application_name='bridge-cap-second';set local statement_timeout='8s';$(p_reserve 8502 2)commit;" >"$p_tmp/cap-second" 2>&1 &
p_second=$!;p_wait bridge-cap-second Lock;wait "$p_first_pid"
if wait "$p_second";then exit 1;fi;rg -q 54000 "$p_tmp/cap-second"
test "$(p_sql -c "select request_count::text||':'||reserved_liability::text from private.polat_experiment_runs where id='$(p_id 8502 2000)'")" = '1:0.02'
echo 'PASS BRIDGE-C2: concurrent distinct requests cannot overshoot count or exact-decimal liability'
p_case=C3
p_first bridge-crash "$(p_reserve 8503)" 20
p_sql -c "select pg_terminate_backend(pid)from pg_stat_activity where datname=current_database()and application_name='bridge-crash'" >"$p_tmp/killed"
if wait "$p_first_pid";then exit 1;fi
test "$(p_sql -c "select request_count from private.polat_experiment_runs where id='$(p_id 8503 2000)'")" = 0
test "$(p_sql -c "select count(*)from public.audit_logs where tenant_id='$(p_id 8503 1000)'and action='polat.experiment_reserved'")" = 0
p_sql -c "$(p_reserve 8503)" >"$p_tmp/recovered"
p_sql -c "$(p_begin 8503)" >/dev/null
p_sql -c "$(p_begin 8503)" >"$p_tmp/lost-ack-replay"
rg -q '"dispatch": false' "$p_tmp/lost-ack-replay"
test "$(p_sql -c "select count(*)from private.polat_experiment_evidence where run_id='$(p_id 8503 2000)'and stage='DISPATCH_STARTED'")" = 1
test "$(p_sql -c "select request_count from private.polat_experiment_runs where id='$(p_id 8503 2000)'")" = 1
echo 'PASS BRIDGE-C3: actual backend death rolls back attempt/counter/audit; lost committed start ACK never authorizes another send'
p_case=C4
p_sql -c "$(p_reserve 8504)" >"$p_tmp/dispatch-reserved"
p_first bridge-start-first "$(p_begin 8504)" 3
p_sql -c "begin;set local application_name='bridge-start-second';set local statement_timeout='8s';$(p_begin 8504 9999)commit;" >"$p_tmp/start-second" 2>&1 &
p_second=$!;p_wait bridge-start-second Lock;wait "$p_first_pid";wait "$p_second"
rg -q '"dispatch": false' "$p_tmp/start-second"
test "$(p_sql -c "select count(*)from private.polat_experiment_evidence where run_id='$(p_id 8504 2000)'and stage='DISPATCH_STARTED'")" = 1
echo 'PASS BRIDGE-C4: two workers cannot own the same dispatch; second key is never a completion capability'
p_case=C5
p_sql -c "$(p_reserve 8505)$(p_begin 8505)" >"$p_tmp/late-start"
sleep .01
{ cat "$p_root/helpers/polat_experiment_fixtures.sql";printf "\nselect private.polat_experiment_record_fixture('%s','%s','%s',(select binding_hash from private.polat_experiment_runs where id='%s'),'%s',pg_temp.bridge_outcome(8505)::text);\n" "$(p_id 8505 1000)" "$(p_id 8505 2000)" "$(p_id 850501 3000)" "$(p_id 8505 2000)" "$(p_id 850501 4000)"; }|p_sql >"$p_tmp/late-result" 2>&1
rg -q 'DELAYED_RESULT' "$p_tmp/late-result"
test "$(p_sql -c "select stop_reason from private.polat_experiment_runs where id='$(p_id 8505 2000)'")" = UNKNOWN_REMOTE_COMPLETION
test "$(p_sql -c "select count(*)from private.polat_experiment_evidence where run_id='$(p_id 8505 2000)'and stage='PROVIDER_RESULT'")" = 0
echo 'PASS BRIDGE-C5: expired attempt appends delayed evidence, remains blocked, never claims successful completion'
p_case=INVARIANTS
test "$(p_sql -c "select count(*)from private.verified_payment_receipts where tenant_id in(select id from public.tenants where slug between 'polat-sandbox-experiment-8501'and 'polat-sandbox-experiment-8505')")" = 0
echo 'PASS BRIDGE invariants: no live model, genuine bill, receipt, subscription, Telegram, customer or deployment effect'
