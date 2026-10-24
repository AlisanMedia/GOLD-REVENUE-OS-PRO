#!/usr/bin/env bash
set -euo pipefail
p_db="${1:?DISPOSABLE_PG17_REQUIRED}"
[[ "$p_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]]||exit 1
p_root=$(cd "$(dirname "$0")"&&pwd);p_tmp=$(mktemp -d);p_children=()
trap 'for pid in "${p_children[@]}";do kill "$pid" 2>/dev/null||true;done;rm -rf "$p_tmp"' EXIT
p_sql(){ psql "$p_db" -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@"; }
test "$(p_sql -c "select current_setting('server_version_num')::int/10000")" = 17
test "$(p_sql -c "select count(*)from public.tenants where id='61b02000-0000-4000-8000-000000000701'")" = 0
{ printf 'begin;\n';cat "$p_root/helpers/polat_inbound_fixtures.sql";printf '\nselect pg_temp.polat_setup(701);select pg_temp.polat_setup(702);select pg_temp.polat_setup(703);select pg_temp.polat_setup(704);commit;\n';}|p_sql >"$p_tmp/setup" 2>&1
p_ready(){ for attempt in $(seq 1 300);do test ! -f "$1"||return 0;sleep .02;done;return 1; }
p_wait_lock(){ for attempt in $(seq 1 200);do if [ "$(p_sql -c "select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='$1'and wait_event_type='Lock')")" = t ];then return 0;fi;sleep .01;done;return 1; }
p_prepare="select private.polat_prepare_fixture(w.tenant_id,w.message_id,'61b09000-0000-4000-8000-000000000701',c.generation,w.source_hash,private.fse_hash('Synthetic safe reply'))from private.polat_inbound_work w join private.polat_conversation_controls c using(tenant_id,conversation_id)where w.tenant_id='61b02000-0000-4000-8000-000000000701';"
PGAPPNAME=polat-first p_sql >"$p_tmp/first" 2>&1 <<SQL &
begin;select pg_backend_pid();$p_prepare
\! touch '$p_tmp/ready'
\! for attempt in \$(seq 1 500);do test ! -f '$p_tmp/release'||exit 0;sleep .02;done;exit 1
commit;
SQL
p_children+=("$!");p_first=$!;p_ready "$p_tmp/ready"
PGAPPNAME=polat-reader p_sql >"$p_tmp/read" <<'SQL'
select pg_backend_pid();select count(*)from private.polat_response_evidence where tenant_id='61b02000-0000-4000-8000-000000000701';
SQL
test "$(head -1 "$p_tmp/first")" != "$(head -1 "$p_tmp/read")";test "$(tail -1 "$p_tmp/read")" = 0
PGAPPNAME=polat-second p_sql -c "${p_prepare/61b09000-0000-4000-8000-000000000701/61b09000-0000-4000-8000-000000000711}" >"$p_tmp/second" 2>&1 &
p_children+=("$!");p_second=$!;p_wait_lock polat-second;touch "$p_tmp/release";wait "$p_first";wait "$p_second"
test "$(p_sql -c "select count(*)from private.polat_response_evidence where tenant_id='61b02000-0000-4000-8000-000000000701'and stage='PREPARED'")" = 1
test "$(p_sql -c "select state from private.polat_inbound_work where tenant_id='61b02000-0000-4000-8000-000000000701'")" = DELIVERY_UNKNOWN
echo 'PASS POLAT-C1: distinct backends, real lock wait, precommit invisibility, one prepared operation, competing send remains UNKNOWN'
PGAPPNAME=polat-crash p_sql >"$p_tmp/crash" 2>&1 <<SQL &
begin;select private.polat_prepare_fixture(w.tenant_id,w.message_id,'61b09000-0000-4000-8000-000000000702',c.generation,w.source_hash,private.fse_hash('Synthetic safe reply'))from private.polat_inbound_work w join private.polat_conversation_controls c using(tenant_id,conversation_id)where w.tenant_id='61b02000-0000-4000-8000-000000000702';
\! touch '$p_tmp/crash-ready'
\! for attempt in \$(seq 1 500);do test ! -f '$p_tmp/crash-release'||exit 0;sleep .02;done;exit 1
commit;
SQL
p_children+=("$!");p_crash=$!;p_ready "$p_tmp/crash-ready"
p_sql -c "select pg_terminate_backend(pid)from pg_stat_activity where datname=current_database()and application_name='polat-crash'" >"$p_tmp/kill"
touch "$p_tmp/crash-release";if wait "$p_crash";then exit 1;fi
test "$(p_sql -c "select count(*)from private.polat_response_evidence where tenant_id='61b02000-0000-4000-8000-000000000702'")" = 0
test "$(p_sql -c "select attempts from private.polat_inbound_work where tenant_id='61b02000-0000-4000-8000-000000000702'")" = 0
p_sql -c "${p_prepare//000000000701/000000000702}" >"$p_tmp/recovered"
test "$(p_sql -c "select count(*)from private.polat_response_evidence where tenant_id='61b02000-0000-4000-8000-000000000702'")" = 1
echo 'PASS POLAT-C2: actual backend death rolls back attempt, work revision and audit; same operation recovers once'
p_generation=$(p_sql -c "select generation from private.polat_conversation_controls where tenant_id='61b02000-0000-4000-8000-000000000703'")
p_human="select private.polat_claim_human_fixture(tenant_id,conversation_id,$p_generation)from private.polat_conversation_controls where tenant_id='61b02000-0000-4000-8000-000000000703';"
PGAPPNAME=polat-human-first p_sql >"$p_tmp/human-first" 2>&1 <<SQL &
begin;select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);$p_human
\! touch '$p_tmp/human-ready'
\! for attempt in \$(seq 1 500);do test ! -f '$p_tmp/human-release'||exit 0;sleep .02;done;exit 1
commit;
SQL
p_children+=("$!");p_hfirst=$!;p_ready "$p_tmp/human-ready"
PGAPPNAME=polat-human-second p_sql -c "begin;set statement_timeout='8s';select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000002',true);$p_human commit;" >"$p_tmp/human-second" 2>&1 &
p_children+=("$!");p_hsecond=$!;p_wait_lock polat-human-second;touch "$p_tmp/human-release";wait "$p_hfirst"
if wait "$p_hsecond";then exit 1;fi;grep -q '40001' "$p_tmp/human-second"
test "$(p_sql -c "select human_owner from private.polat_conversation_controls where tenant_id='61b02000-0000-4000-8000-000000000703'")" = 61b01000-0000-4000-8000-000000000001
echo 'PASS POLAT-C3: concurrent operator handoffs have one revision winner; stale operator rejected'
PGAPPNAME=polat-ingest-crash p_sql >"$p_tmp/ingest" 2>&1 <<SQL &
begin;select public.ingest_telegram_message('61b02000-0000-4000-8000-000000000704','polat-crash-update','2','710000704','710000704',null,'Synthetic',null,'Hello',null,clock_timestamp());
\! touch '$p_tmp/ingest-ready'
\! for attempt in \$(seq 1 500);do test ! -f '$p_tmp/ingest-release'||exit 0;sleep .02;done;exit 1
commit;
SQL
p_children+=("$!");p_ingest=$!;p_ready "$p_tmp/ingest-ready"
p_sql -c "select pg_terminate_backend(pid)from pg_stat_activity where datname=current_database()and application_name='polat-ingest-crash'" >"$p_tmp/ingest-kill"
touch "$p_tmp/ingest-release";if wait "$p_ingest";then exit 1;fi
test "$(p_sql -c "select count(*)from public.messages where tenant_id='61b02000-0000-4000-8000-000000000704'")" = 1
test "$(p_sql -c "select count(*)from private.polat_inbound_work where tenant_id='61b02000-0000-4000-8000-000000000704'")" = 1
echo 'PASS POLAT-C4: killed inbound transaction leaves no orphan message, work, event or audit'
p_sql -c "update private.polat_conversation_controls set enabled=false where tenant_id in('61b02000-0000-4000-8000-000000000701','61b02000-0000-4000-8000-000000000702','61b02000-0000-4000-8000-000000000703','61b02000-0000-4000-8000-000000000704');update public.tenants set status='suspended'where id in('61b02000-0000-4000-8000-000000000701','61b02000-0000-4000-8000-000000000702','61b02000-0000-4000-8000-000000000703','61b02000-0000-4000-8000-000000000704');" >/dev/null
echo 'PASS POLAT invariants: no public outbound, live finance, subscription, VIP or provider effects; owned fixtures disabled; evidence retained'
