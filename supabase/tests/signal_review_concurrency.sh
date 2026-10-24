#!/usr/bin/env bash
set -euo pipefail
r_db="${1:?DISPOSABLE_PG17_REQUIRED}"
[[ "$r_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]]||exit 1
r_root=$(cd "$(dirname "$0")"&&pwd);r_tmp=$(mktemp -d);r_children=()
trap 'for p in "${r_children[@]}";do kill "$p" 2>/dev/null||true;done;rm -rf "$r_tmp"' EXIT
r_sql(){ psql "$r_db" -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@"; }
test "$(r_sql -c "select current_setting('server_version_num')::int/10000")" = 17
test "$(r_sql -c "select count(*)from public.tenants where id='51a52000-0000-4000-8000-000000000001'")" = 0
{ cat "$r_root/helpers/signal_reviews_fixtures.sql";cat <<'SQL'
select pg_temp.source_command(1,'RECONNECT',jsonb_build_object('at',clock_timestamp()));select pg_temp.source_observe(1,2,'second');
select pg_temp.source_command(2,'RECONNECT',jsonb_build_object('at',clock_timestamp()));select pg_temp.source_observe(2,1,'protected',1,'RESTRICTED');
SQL
}|r_sql >"$r_tmp/seed" 2>&1
r_input=$(r_sql -c "select jsonb_build_object('version',1,'mode','SYNTHETIC','source_id','51a53000-0000-4000-8000-000000000001','delivery_id',null,'issue','MISSING_EVENT','decision','OPEN','reason','EVIDENCE_MISSING','expected_context_hash',private.signal_review_context_v1('51a52000-0000-4000-8000-000000000001','51a53000-0000-4000-8000-000000000001',null),'evidence','[]'::jsonb)")
PGAPPNAME=signal-review-first r_sql -v command_json="$r_input" >"$r_tmp/first" 2>&1 <<SQL &
begin;select pg_backend_pid();select set_config('request.jwt.claim.sub','51a51000-0000-4000-8000-000000000001',true);
select private.signal_review_record_fixture_v1('51a52000-0000-4000-8000-000000000001','51a59000-0000-4000-8000-000000000101',:'command_json')->>'decision';
\! touch '$r_tmp/ready'
\! for n in \$(seq 1 500);do test ! -f '$r_tmp/release'||exit 0;sleep .02;done;exit 1
commit;
SQL
r_children+=("$!");r_first=$!
for n in $(seq 1 300);do test ! -f "$r_tmp/ready"||break;sleep .02;done;test -f "$r_tmp/ready"
PGAPPNAME=signal-review-reader r_sql >"$r_tmp/reader-before" <<'SQL'
select pg_backend_pid();begin;set local role authenticated;select set_config('request.jwt.claim.sub','51a51000-0000-4000-8000-000000000001',true);select jsonb_array_length(public.admin_signal_review_page_v1('51a52000-0000-4000-8000-000000000001')->'items');commit;
SQL
test "$(head -1 "$r_tmp/reader-before")" != "$(head -1 "$r_tmp/first")";test "$(tail -1 "$r_tmp/reader-before")" = 0
PGAPPNAME=signal-review-stale r_sql -v command_json="$r_input" >"$r_tmp/stale" 2>&1 <<'SQL' &
set statement_timeout='8s';begin;select set_config('request.jwt.claim.sub','51a51000-0000-4000-8000-000000000001',true);select private.signal_review_record_fixture_v1('51a52000-0000-4000-8000-000000000001','51a59000-0000-4000-8000-000000000102',:'command_json')->>'decision';commit;
SQL
r_children+=("$!");r_stale=$!
r_waited=0
for n in $(seq 1 200);do
 if [ "$(r_sql -c "select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='signal-review-stale'and wait_event_type='Lock')")" = t ];then r_waited=1;break;fi;sleep .01
done
test "$r_waited" = 1;touch "$r_tmp/release";wait "$r_first"
if wait "$r_stale";then echo 'STALE_REVIEW_MUST_FAIL' >&2;exit 1;fi
grep -q '40001' "$r_tmp/stale"
test "$(r_sql -c "select count(*)from private.signal_reviews where tenant_id='51a52000-0000-4000-8000-000000000001'")" = 1
test "$(r_sql -c "select count(*)from public.audit_logs where tenant_id='51a52000-0000-4000-8000-000000000001'and action='signal.synthetic_review_recorded'")" = 1
echo 'PASS REVIEW-C1: independent reviewer/reader backends, real observed row-lock wait, precommit invisibility, stale context rejected, one review/audit'
r_second=$(r_sql -c "select jsonb_build_object('version',1,'mode','SYNTHETIC','source_id','51a53000-0000-4000-8000-000000000002','delivery_id',null,'issue','SOURCE_RESTRICTED','decision','BLOCKED','reason','ALTERNATIVE_SOURCE_REQUIRED','expected_context_hash',private.signal_review_context_v1('51a52000-0000-4000-8000-000000000002','51a53000-0000-4000-8000-000000000002',null),'evidence','[]'::jsonb)")
PGAPPNAME=signal-review-crash r_sql -v command_json="$r_second" >"$r_tmp/crash" 2>&1 <<SQL &
begin;select set_config('request.jwt.claim.sub','51a51000-0000-4000-8000-000000000001',true);select private.signal_review_record_fixture_v1('51a52000-0000-4000-8000-000000000002','51a59000-0000-4000-8000-000000000103',:'command_json')->>'decision';
\! touch '$r_tmp/crash-ready'
\! for n in \$(seq 1 400);do test ! -f '$r_tmp/crash-release'||exit 0;sleep .02;done;exit 1
commit;
SQL
r_children+=("$!");r_crash=$!
for n in $(seq 1 300);do test ! -f "$r_tmp/crash-ready"||break;sleep .02;done;test -f "$r_tmp/crash-ready"
r_sql -c "select pg_terminate_backend(pid)from pg_stat_activity where datname=current_database()and application_name='signal-review-crash'" >"$r_tmp/killed"
touch "$r_tmp/crash-release";if wait "$r_crash";then exit 1;fi
test "$(r_sql -c "select count(*)from private.signal_reviews where tenant_id='51a52000-0000-4000-8000-000000000002'")" = 0
r_sql -v command_json="$r_second" >"$r_tmp/recovery" <<'SQL'
select set_config('request.jwt.claim.sub','51a51000-0000-4000-8000-000000000001',false);
select private.signal_review_record_fixture_v1('51a52000-0000-4000-8000-000000000002','51a59000-0000-4000-8000-000000000103',:'command_json')->>'replay';
select private.signal_review_record_fixture_v1('51a52000-0000-4000-8000-000000000002','51a59000-0000-4000-8000-000000000103',:'command_json')->>'replay';
SQL
test "$(tail -1 "$r_tmp/recovery")" = true
test "$(r_sql -c "select count(*)from private.signal_reviews where tenant_id='51a52000-0000-4000-8000-000000000002'")" = 1
test "$(r_sql -c "select state from private.signal_source_runtime where tenant_id='51a52000-0000-4000-8000-000000000002'")" = SOURCE_RESTRICTED
r_sql -c "update private.signal_controls set enabled=false where tenant_id in(select ('51a52000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,5)n);update public.tenants set status='suspended'where id in(select ('51a52000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,5)n);" >/dev/null
echo 'PASS REVIEW-C2: actual precommit death rolls back review/audit; same command recovers once and replays; source restriction persists; owned fixtures disabled'
