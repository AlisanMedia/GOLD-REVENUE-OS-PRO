#!/usr/bin/env bash
set -euo pipefail
ops_db="${1:?DISPOSABLE_LOCAL_PG17_REQUIRED}"
[[ "$ops_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/(postgres|goldsignal[A-Za-z0-9_]*)$ ]] || exit 1
ops_root=$(cd "$(dirname "$0")" && pwd);ops_tmp=$(mktemp -d);ops_child='';ops_seeded=false
ops_sql(){ psql "$ops_db" -X -Atq -v ON_ERROR_STOP=1 "$@"; }
ops_cleanup(){
 if test -n "$ops_child";then kill "$ops_child" 2>/dev/null || true;wait "$ops_child" 2>/dev/null || true;fi
 if "$ops_seeded";then ops_sql -c "update private.signal_controls set enabled=false where tenant_id in('51c32000-0000-4000-8000-000000000001','51c32000-0000-4000-8000-000000000002');update public.tenant_members set status='disabled' where tenant_id in('51c32000-0000-4000-8000-000000000001','51c32000-0000-4000-8000-000000000002');update public.tenants set status='suspended' where id in('51c32000-0000-4000-8000-000000000001','51c32000-0000-4000-8000-000000000002');" >/dev/null;fi
 rm -rf "$ops_tmp"
}
trap ops_cleanup EXIT
[[ "$(ops_sql -c "select current_setting('server_version_num')::integer/10000")" = 17 ]]
[[ "$(ops_sql -c "select count(*) from public.tenants where id='51c32000-0000-4000-8000-000000000001'")" = 0 ]]
sed -e 's/51c0/51c3/g' -e 's/signal-ops-fixture-/signal-ops-race-fixture-/g' -e 's/signal-sandbox-ops-/signal-sandbox-ops-race-/g' "$ops_root/helpers/signal_operations_fixtures.sql" >"$ops_tmp/fixture.sql"
{ cat "$ops_tmp/fixture.sql";printf '\n';cat <<'SQL'
select private.signal_record_fixture_v1(pg_temp.signal_input('race-'||n)) from generate_series(1,5)n;
SQL
} | ops_sql >"$ops_tmp/seed";ops_seeded=true
ops_sql >"$ops_tmp/reader" 2>&1 <<SQL &
begin isolation level read committed;
select pg_backend_pid() as reader_pid \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','51c31000-0000-4000-8000-000000000001',true) as ignored \gset
select public.admin_signal_page_v1('51c32000-0000-4000-8000-000000000001','events',page_size_value=>1) as first \gset
\! touch '$ops_tmp/ready'
\! for n in \$(seq 1 500);do test ! -f '$ops_tmp/release' || exit 0;sleep .02;done;exit 1
\if :SHELL_ERROR
select 1/0;
\endif
select public.admin_signal_page_v1('51c32000-0000-4000-8000-000000000001','events',page_size_value=>1,cursor_value=>:'first'::jsonb->'next_cursor') as second \gset
select public.admin_signal_page_v1('51c32000-0000-4000-8000-000000000001','events',page_size_value=>1) as refreshed \gset
select :reader_pid;
select (:'second'::jsonb#>>'{items,0,id}')<>(:'first'::jsonb#>>'{items,0,id}');
select ((:'second'::jsonb#>>'{next_cursor,anchor}')::bigint)=((:'first'::jsonb#>>'{next_cursor,anchor}')::bigint);
select (:'refreshed'::jsonb#>>'{items,0,id}')<>(:'first'::jsonb#>>'{items,0,id}');
commit;
SQL
ops_child=$!
for n in $(seq 1 300);do test ! -f "$ops_tmp/ready" || break;sleep .02;done;test -f "$ops_tmp/ready"
ops_sql >"$ops_tmp/writer" <<'SQL'
select pg_backend_pid();
select private.signal_record_fixture_v1(jsonb_build_object('version',1,'mode','SYNTHETIC','tenant_id','51c32000-0000-4000-8000-000000000001','source_id','51c33000-0000-4000-8000-000000000001','message_key','concurrently-committed','revision',1,'kind','MESSAGE','observed_at',clock_timestamp(),'published_at',null,'reply_to',null,'original_text','Synthetic source commentary','attachments','[]'::jsonb,'interpretation',null)::text)->>'duplicate';
SQL
[[ "$(tail -1 "$ops_tmp/writer")" = false ]];touch "$ops_tmp/release";wait "$ops_child";ops_child=''
[[ "$(head -1 "$ops_tmp/reader")" != "$(head -1 "$ops_tmp/writer")" ]]
[[ "$(tail -3 "$ops_tmp/reader" | tr '\n' ' ')" = 't t t ' ]]
echo 'PASS SIGNAL Admin pagination: distinct reader/writer backends; committed new event excluded from anchored next page and visible after refresh; no duplicate row'
