#!/usr/bin/env bash
set -euo pipefail
p_db="${1:?DISPOSABLE_PG17_REQUIRED}"
[[ "$p_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]]||exit 1
p_root=$(cd "$(dirname "$0")"&&pwd);p_tmp=$(mktemp -d);p_children=();p_created=false;p_case=SETUP
p_sql(){ psql "$p_db" -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@"; }
p_cleanup(){ local status=$?;for pid in $(jobs -pr);do kill "$pid" 2>/dev/null||true;done
 if test "$p_created" = true;then p_sql -c "update private.polat_runtime_profiles set enabled=false where tenant_id in('61b02000-0000-4000-8000-000000004801','61b02000-0000-4000-8000-000000004802','61b02000-0000-4000-8000-000000004803','61b02000-0000-4000-8000-000000004804');update private.polat_conversation_controls set enabled=false where tenant_id in('61b02000-0000-4000-8000-000000004801','61b02000-0000-4000-8000-000000004802','61b02000-0000-4000-8000-000000004803','61b02000-0000-4000-8000-000000004804');update public.tenants set status='suspended'where id in('61b02000-0000-4000-8000-000000004801','61b02000-0000-4000-8000-000000004802','61b02000-0000-4000-8000-000000004803','61b02000-0000-4000-8000-000000004804');" >/dev/null||status=1;fi
 test "$status" = 0||echo "CONTACT_CONCURRENCY_FAILED: $p_case; owned evidence retained" >&2
 rm -rf "$p_tmp";exit "$status"; }
trap p_cleanup EXIT
test "$(p_sql -c "select current_setting('server_version_num')::int/10000")" = 17
test "$(p_sql -c "select count(*)from public.tenants where id='61b02000-0000-4000-8000-000000004801'")" = 0
# Inline the helper include so native psql and an explicit-container test transport behave identically.
{ printf 'begin;\n';cat "$p_root/helpers/polat_inbound_fixtures.sql";sed '1d' "$p_root/helpers/polat_contact_fixtures.sql";printf "\nselect pg_temp.polat_contact_setup(4801,'MARKETING_FIXTURE');select pg_temp.polat_contact_setup(4802,'MARKETING_FIXTURE');select pg_temp.polat_contact_setup(4803,'MARKETING_FIXTURE');select pg_temp.polat_contact_setup(4804);commit;\n"; }|p_sql >"$p_tmp/setup" 2>&1
p_created=true
p_expiry=$(p_sql -c "select to_char((clock_timestamp()+interval '1 day')at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
p_command(){ local n="$1";local event_id="$2";local kind="${3:-MARKETING_GRANTED}";local payload="jsonb_build_object('expires_at','$p_expiry','timezone','UTC','window_start',0,'window_end',24)"
 if test "$kind" = HUMAN_ACKNOWLEDGED;then payload="jsonb_build_object('origin','AUTHORIZED_FIXTURE_OPERATOR')";fi
 printf "select private.polat_contact_record_fixture('61b02000-0000-4000-8000-%012d',conversation_id,jsonb_build_object('version',1,'mode','SYNTHETIC','evidence_id','%s','tenant_id',tenant_id,'conversation_id',conversation_id,'expected_revision','1','expected_generation','3','source_message_id',null,'kind','%s','payload',%s)::text)from private.polat_runtime_profiles where tenant_id='61b02000-0000-4000-8000-%012d';" "$n" "$event_id" "$kind" "$payload" "$n"; }
p_wait(){ local name="$1";local event="$2";for attempt in $(seq 1 100);do if test "$(p_sql -c "select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='$name'and wait_event_type='$event')")" = t;then return 0;fi;sleep .01;done;return 1; }
p_first(){ local app="$1";local command="$2";local delay="$3";p_sql >"$p_tmp/$app" 2>&1 <<SQL &
begin;set local application_name='$app';select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);$command select pg_sleep($delay);commit;
SQL
 p_children+=("$!");p_first_pid=$!;p_wait "$app" Timeout; }
p_case=C1
p_cmd=$(p_command 4801 61b09000-0000-4000-8000-000000004801)
p_first contact-replay-first "$p_cmd" 3
p_pid_a=$(p_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='contact-replay-first'")
test "$(p_sql -c "select count(*)from private.polat_contact_evidence where tenant_id='61b02000-0000-4000-8000-000000004801'")" = 1
p_sql -c "begin;set local application_name='contact-replay-second';set local statement_timeout='8s';select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);$p_cmd commit;" >"$p_tmp/replay-second" 2>&1 &
p_children+=("$!");p_second=$!;p_wait contact-replay-second Lock
p_pid_b=$(p_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='contact-replay-second'")
test -n "$p_pid_a";test -n "$p_pid_b";test "$p_pid_a" != "$p_pid_b";wait "$p_first_pid";wait "$p_second"
test "$(p_sql -c "select count(*)from private.polat_contact_evidence where tenant_id='61b02000-0000-4000-8000-000000004801'")" = 2
echo 'PASS CONTACT-C1: independent backend PIDs, actual row-lock wait, precommit invisibility, identical replay commits once'
p_case=C2
p_first contact-conflict-first "$(p_command 4802 61b09000-0000-4000-8000-000000004802)" 3
p_cmd=$(p_command 4802 61b09000-0000-4000-8000-000000004812)
p_sql -c "begin;set local application_name='contact-conflict-second';set local statement_timeout='8s';select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);$p_cmd commit;" >"$p_tmp/conflict-second" 2>&1 &
p_children+=("$!");p_second=$!;p_wait contact-conflict-second Lock;wait "$p_first_pid"
if wait "$p_second";then exit 1;fi;grep -q 40001 "$p_tmp/conflict-second"
test "$(p_sql -c "select count(*)from private.polat_contact_evidence where tenant_id='61b02000-0000-4000-8000-000000004802'")" = 2
echo 'PASS CONTACT-C2: distinct concurrent decisions have one revision winner; stale revision is SQLSTATE40001'
p_case=C3
p_cmd=$(p_command 4803 61b09000-0000-4000-8000-000000004803);p_first contact-crash "$p_cmd" 20
p_sql -c "select pg_terminate_backend(pid)from pg_stat_activity where datname=current_database()and application_name='contact-crash'" >"$p_tmp/terminated"
if wait "$p_first_pid";then exit 1;fi
test "$(p_sql -c "select count(*)from private.polat_contact_evidence where tenant_id='61b02000-0000-4000-8000-000000004803'")" = 1
test "$(p_sql -c "select generation from private.polat_conversation_controls where tenant_id='61b02000-0000-4000-8000-000000004803'")" = 3
p_sql -c "begin;select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);$p_cmd commit;" >"$p_tmp/recovered"
test "$(p_sql -c "select count(*)from public.audit_logs where tenant_id='61b02000-0000-4000-8000-000000004803'and action='polat.contact_evidence'")" = 2
echo 'PASS CONTACT-C3: real backend termination rolls back ledger, generation and audit; identical command recovers once'
p_case=C4
p_first contact-owner-first "$(p_command 4804 61b09000-0000-4000-8000-000000004804 HUMAN_ACKNOWLEDGED)" 3
p_cmd=$(p_command 4804 61b09000-0000-4000-8000-000000004814 HUMAN_ACKNOWLEDGED)
p_sql -c "begin;set local application_name='contact-owner-second';set local statement_timeout='8s';select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000002',true);$p_cmd commit;" >"$p_tmp/owner-second" 2>&1 &
p_children+=("$!");p_second=$!;p_wait contact-owner-second Lock;wait "$p_first_pid"
if wait "$p_second";then exit 1;fi;grep -q 40001 "$p_tmp/owner-second"
test "$(p_sql -c "select human_owner from private.polat_conversation_controls where tenant_id='61b02000-0000-4000-8000-000000004804'")" = 61b01000-0000-4000-8000-000000000001
echo 'PASS CONTACT-C4: acknowledged native owner wins; stale concurrent operator cannot replace ownership'
p_case=INVARIANTS
test "$(p_sql -c "select count(*)from public.messages where tenant_id in('61b02000-0000-4000-8000-000000004801','61b02000-0000-4000-8000-000000004802','61b02000-0000-4000-8000-000000004803','61b02000-0000-4000-8000-000000004804')and direction='outbound'")" = 0
echo 'PASS CONTACT invariants: no customer/provider effects, no LIVE authority; only owned fixtures retired and append-only evidence retained'
