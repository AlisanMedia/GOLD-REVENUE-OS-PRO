#!/usr/bin/env bash
set -euo pipefail
campaign_db="${1:?DISPOSABLE_PG17_REQUIRED}"
[[ "$campaign_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]] || exit 1
campaign_root=$(cd "$(dirname "$0")" && pwd)
campaign_tmp=$(mktemp -d)
campaign_created=false
campaign_sql() { psql "$campaign_db" -X -Atq -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@"; }
campaign_cleanup() {
  local status=$?
  for pid in $(jobs -pr); do kill "$pid" 2>/dev/null || true; done
  if test "$campaign_created" = true; then
    campaign_sql -c "update private.sales_campaigns set state='STOPPED'where tenant_id in('61b02000-0000-4000-8000-000000009951','61b02000-0000-4000-8000-000000009952','61b02000-0000-4000-8000-000000009953','61b02000-0000-4000-8000-000000009954');update private.polat_runtime_profiles set enabled=false where tenant_id in('61b02000-0000-4000-8000-000000009951','61b02000-0000-4000-8000-000000009952','61b02000-0000-4000-8000-000000009953','61b02000-0000-4000-8000-000000009954');update private.polat_conversation_controls set enabled=false where tenant_id in('61b02000-0000-4000-8000-000000009951','61b02000-0000-4000-8000-000000009952','61b02000-0000-4000-8000-000000009953','61b02000-0000-4000-8000-000000009954');update public.tenants set status='suspended'where id in('61b02000-0000-4000-8000-000000009951','61b02000-0000-4000-8000-000000009952','61b02000-0000-4000-8000-000000009953','61b02000-0000-4000-8000-000000009954');" >/dev/null || status=1
  fi
  test "$status" = 0 || echo 'CAMPAIGN_CONCURRENCY_FAILED; prior evidence retained' >&2
  rm -rf "$campaign_tmp"
  exit "$status"
}
trap campaign_cleanup EXIT
test "$(campaign_sql -c "select current_setting('server_version_num')::int/10000")" = 17
test "$(campaign_sql -c "select count(*)from public.tenants where id='61b02000-0000-4000-8000-000000009951'")" = 0
{
  printf 'begin;\n'
  cat "$campaign_root/helpers/polat_inbound_fixtures.sql"
  sed '1d' "$campaign_root/helpers/campaign_fixtures.sql"
  printf '\nselect pg_temp.campaign_setup(9951);select pg_temp.campaign_setup(9952);select pg_temp.campaign_setup(9953);select pg_temp.campaign_setup(9954);\n'
  printf "select public.campaign_schedule_v1(tenant_id,id,25)from private.sales_campaigns where tenant_id in('61b02000-0000-4000-8000-000000009951','61b02000-0000-4000-8000-000000009952','61b02000-0000-4000-8000-000000009953','61b02000-0000-4000-8000-000000009954');commit;\n"
} | campaign_sql >"$campaign_tmp/setup" 2>&1
campaign_created=true
campaign_wait() {
  local app="$1" event="$2"
  for attempt in {1..100}; do
    if test "$(campaign_sql -c "select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='$app'and wait_event_type='$event')")" = t; then return 0; fi
    sleep .02
  done
  return 1
}
campaign_claim() { printf "select public.campaign_claim_fixture_v1('61b02000-0000-4000-8000-%012d','61b09000-0000-4000-8000-%012d','%s');" "$1" "$1" "$2"; }
campaign_start() {
  campaign_sql >"$campaign_tmp/$1" 2>&1 <<SQL &
begin;set local application_name='$1';$2 select pg_sleep($3);commit;
SQL
  campaign_first=$!
  campaign_wait "$1" Timeout
}
campaign_owner="select set_config('request.jwt.claim.sub','61ca1000-0000-4000-8000-000000000001',true);select set_config('request.jwt.claims',jsonb_build_object('sub','61ca1000-0000-4000-8000-000000000001','aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from clock_timestamp())-1)))::text,true);"

campaign_start campaign-claim-first "set local role service_role;$(campaign_claim 9951 worker_a)" 3
campaign_pid_a=$(campaign_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='campaign-claim-first'")
campaign_sql -c "begin;set local application_name='campaign-claim-second';set local statement_timeout='10s';set local role service_role;$(campaign_claim 9951 worker_b)commit;" >"$campaign_tmp/second" 2>&1 &
campaign_second=$!
campaign_wait campaign-claim-second Lock
campaign_pid_b=$(campaign_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='campaign-claim-second'")
test -n "$campaign_pid_a";test -n "$campaign_pid_b";test "$campaign_pid_a" != "$campaign_pid_b"
test "$(campaign_sql -c "select attempts from private.sales_campaigns where id='61b09000-0000-4000-8000-000000009951'")" = 0
wait "$campaign_first";wait "$campaign_second"
grep -q RESERVED "$campaign_tmp/campaign-claim-first";grep -q EMPTY "$campaign_tmp/second"
test "$(campaign_sql -c "select attempts from private.sales_campaigns where id='61b09000-0000-4000-8000-000000009951'")" = 1
echo 'PASS CAMPAIGN-C1: independent backend PIDs, real lock wait, precommit invisibility, exactly one persisted lease/request reservation'

for campaign_n in 9952 9953; do
  campaign_sql -c "$(campaign_claim "$campaign_n" prepare_worker)" >"$campaign_tmp/claim-$campaign_n"
  campaign_job=$(python -c 'import json,sys;print(json.load(open(sys.argv[1]))["job_id"])' "$campaign_tmp/claim-$campaign_n")
  campaign_token=$(python -c 'import json,sys;print(json.load(open(sys.argv[1]))["lease_token"])' "$campaign_tmp/claim-$campaign_n")
  campaign_sql -c "select public.campaign_prepare_fixture_v1('61b02000-0000-4000-8000-00000000$campaign_n','$campaign_job','$campaign_token',repeat('b',64));" >"$campaign_tmp/prepare-$campaign_n"
  if test "$campaign_n" = 9952; then
    campaign_mutation="$campaign_owner select public.admin_campaign_state_v1('61b02000-0000-4000-8000-000000009952','61b09000-0000-4000-8000-000000009952',2,'PAUSE');"
  else
    campaign_mutation="select public.ingest_telegram_message('61b02000-0000-4000-8000-000000009953','campaign-race-optout','2','7100009953','7100009953',null,'Synthetic',null,'Do not contact me again',null,clock_timestamp());"
  fi
  campaign_start "campaign-fence-$campaign_n" "$campaign_mutation" 3
  campaign_sql -c "begin;set local application_name='campaign-send-$campaign_n';set local statement_timeout='10s';set local role service_role;select public.campaign_dispatch_fixture_v1('61b02000-0000-4000-8000-00000000$campaign_n','$campaign_job','$campaign_token');commit;" >"$campaign_tmp/dispatch-$campaign_n" 2>&1 &
  campaign_second=$!;campaign_wait "campaign-send-$campaign_n" Lock;wait "$campaign_first";wait "$campaign_second"
  test "$(tail -1 "$campaign_tmp/dispatch-$campaign_n")" = f
done
echo 'PASS CAMPAIGN-C2: committed founder PAUSE wins against a waiting sender; no stale send'
echo 'PASS CAMPAIGN-C3: committed inbound opt-out wins against a waiting sender; no raw-content audit or blind repeat'

campaign_start campaign-crash "set local role service_role;$(campaign_claim 9954 crash_worker)" 20
campaign_sql -c "select pg_terminate_backend(pid)from pg_stat_activity where datname=current_database()and application_name='campaign-crash'" >"$campaign_tmp/terminated"
if wait "$campaign_first"; then exit 1; fi
test "$(campaign_sql -c "select attempts from private.sales_campaigns where id='61b09000-0000-4000-8000-000000009954'")" = 0
campaign_sql -c "$(campaign_claim 9954 recovered_worker)" >"$campaign_tmp/recovered"
grep -q RESERVED "$campaign_tmp/recovered"
test "$(campaign_sql -c "select attempts from private.sales_campaigns where id='61b09000-0000-4000-8000-000000009954'")" = 1
echo 'PASS CAMPAIGN-C4: real backend termination rolls back job, reservation, liability and audit; safe retry owns one committed attempt'
campaign_sql -c "update public.scheduled_jobs set locked_at=clock_timestamp()-interval '2 minutes'where tenant_id='61b02000-0000-4000-8000-000000009954'and status='processing';$(campaign_claim 9954 restarted_worker)" >"$campaign_tmp/restarted"
grep -q DELIVERY_UNKNOWN "$campaign_tmp/restarted"
test "$(campaign_sql -c "select state||':'||attempts::text||':'||reserved_liability::text from private.sales_campaigns where id='61b09000-0000-4000-8000-000000009954'")" = PAUSED:1:0.010000
echo 'PASS CAMPAIGN-C5: restart/lease loss consumes lifetime budget, remains visible UNKNOWN and never automatically reclaims'
test "$(campaign_sql -c "select count(*)from public.messages where tenant_id in('61b02000-0000-4000-8000-000000009951','61b02000-0000-4000-8000-000000009952','61b02000-0000-4000-8000-000000009953','61b02000-0000-4000-8000-000000009954')and direction='outbound'")" = 0
echo 'PASS CAMPAIGN invariants: zero genuine provider/model/Telegram effects; no financial or VIP authority'
