#!/usr/bin/env bash
set -euo pipefail
s_db="${1:?DISPOSABLE_PG17_REQUIRED}"
[[ "$s_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]] || exit 1
s_root="$(cd "$(dirname "$0")" && pwd)";s_tmp=$(mktemp -d);s_children=()
trap 'for p in "${s_children[@]}";do kill "$p" 2>/dev/null || true;done;rm -rf "$s_tmp"' EXIT
s_sql(){ psql "$s_db" -X -qAt -v ON_ERROR_STOP=1 "$@"; }
s_expect(){ test "$(s_sql -c "$1")" = "$2" || { echo "SIGNAL_ASSERTION_FAILED: $3" >&2;exit 1; }; }
s_expect "select current_setting('server_version_num')::int/10000" 17 'local PG17 required'
s_expect "select count(*) from public.tenants where id='51b02000-0000-4000-8000-000000000101'" 0 'fresh owned fixtures'
{ cat "$s_root/helpers/signal_distribution_fixtures.sql";cat <<'SQL'
select pg_temp.signal_case_setup(n) from generate_series(101,104)n;
select private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(n)) from generate_series(101,103)n;
SQL
} | s_sql >"$s_tmp/setup" 2>&1
PGAPPNAME=signal-dist-claim-a s_sql >"$s_tmp/precommit" 2>&1 <<SQL &
set statement_timeout='10s';begin;select pg_backend_pid();select private.signal_claim_fixture_v1('51b02000-0000-4000-8000-000000000101')->>'state';
\! touch '$s_tmp/ready'
\! for n in \$(seq 1 500);do test ! -f '$s_tmp/release' || exit 0;sleep .02;done;exit 1
\if :SHELL_ERROR
select 1/0;
\endif
commit;
SQL
s_pid=$!;s_children+=("$s_pid")
for n in $(seq 1 300);do test ! -f "$s_tmp/ready" || break;sleep .02;done;test -f "$s_tmp/ready"
PGAPPNAME=signal-dist-claim-b s_sql >"$s_tmp/busy" <<'SQL'
set statement_timeout='2s';select pg_backend_pid();select private.signal_claim_fixture_v1('51b02000-0000-4000-8000-000000000101')->>'state';
SQL
test "$(head -1 "$s_tmp/precommit")" != "$(head -1 "$s_tmp/busy")";test "$(tail -1 "$s_tmp/busy")" = BUSY
s_expect "select pg_terminate_backend(pid) from pg_stat_activity where application_name='signal-dist-claim-a' and datname=current_database()" t 'only own precommit backend'
touch "$s_tmp/release";if wait "$s_pid";then echo PRECOMMIT_DEATH_REQUIRED >&2;exit 1;fi
s_expect "select claims from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000101'" 0 'claim rollback'
s_expect "select count(*) from private.signal_delivery_history where tenant_id='51b02000-0000-4000-8000-000000000101' and code='CLAIMED'" 0 'audit/evidence rollback'
echo 'PASS SIGNAL-B1: independent backend PIDs, bounded BUSY; precommit death rolls back lease/counter/audit'
for n in 1 2;do
 PGAPPNAME="signal-dist-race-$n" s_sql >"$s_tmp/race-$n" <<'SQL' &
set statement_timeout='5s';select pg_backend_pid();select private.signal_claim_fixture_v1('51b02000-0000-4000-8000-000000000102')->>'state';
SQL
 s_children+=("$!")
done
wait "${s_children[1]}";wait "${s_children[2]}"
test "$(head -1 "$s_tmp/race-1")" != "$(head -1 "$s_tmp/race-2")"
test "$(cat "$s_tmp/race-1" "$s_tmp/race-2" | grep -c '^LEASED$')" = 1
s_old=$(s_sql -c "select lease_token from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000102'")
s_sql -c "update private.signal_deliveries set lease_until=clock_timestamp()-interval '1 second' where tenant_id='51b02000-0000-4000-8000-000000000102';" >/dev/null
for n in 1 2;do
 PGAPPNAME="signal-dist-expiry-$n" s_sql >"$s_tmp/expiry-$n" <<'SQL' &
select pg_backend_pid();select private.signal_claim_fixture_v1('51b02000-0000-4000-8000-000000000102')->>'state';
SQL
 s_children+=("$!")
done
wait "${s_children[3]}";wait "${s_children[4]}"
test "$(cat "$s_tmp/expiry-1" "$s_tmp/expiry-2" | grep -c '^LEASED$')" = 1
s_expect "select claims from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000102'" 2 'one expiry winner'
s_sql -v old_token="$s_old" >"$s_tmp/fenced" <<'SQL'
select private.signal_begin_fixture_v1('51b02000-0000-4000-8000-000000000102',(select id from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000102'),:'old_token'::uuid)->>'state';
SQL
test "$(cat "$s_tmp/fenced")" = FENCED
echo 'PASS SIGNAL-B2: two actual claim/expiry races, one owner, stale token denied'
s_sql >"$s_tmp/begun" <<'SQL'
select private.signal_claim_fixture_v1('51b02000-0000-4000-8000-000000000103')->>'state';
select private.signal_begin_fixture_v1('51b02000-0000-4000-8000-000000000103',(select id from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000103'),(select lease_token from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000103'))->>'state';
update private.signal_deliveries set lease_until=clock_timestamp()-interval '1 second' where tenant_id='51b02000-0000-4000-8000-000000000103';
SQL
s_expect "select private.signal_claim_fixture_v1('51b02000-0000-4000-8000-000000000103')->>'state'" NO_LEASE 'begun effect not reclaimed'
s_expect "select status from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000103'" UNKNOWN 'unknown effect remains visible'
s_expect "select count(*) from private.signal_attempts where tenant_id='51b02000-0000-4000-8000-000000000103'" 1 'one begun attempt'
echo 'PASS SIGNAL-B3: committed begin plus lost acknowledgement is UNKNOWN, never blindly repeated'
{ cat "$s_root/helpers/signal_distribution_fixtures.sql";cat <<'SQL'
select private.signal_fixture_configure_v1(pg_temp.signal_case_id(104,'2000'),pg_temp.signal_case_id(104,'4000'),pg_temp.signal_case_id(104,'3001'),pg_temp.signal_case_id(104,'5001'),pg_temp.signal_case_id(104,'6001'),'Independent fair source','fixture:fair-source','fixture:fair-destination',true);
do $$begin for n in 1..4097 loop perform private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(104,'stale-burst',n));end loop;end;$$;
select private.signal_record_fixture_v1(jsonb_set(pg_temp.signal_dispatch_input(104,'fair-live')::jsonb,'{source_id}',to_jsonb(pg_temp.signal_case_id(104,'3001')::text))::text);
SQL
} | s_sql >"$s_tmp/stale-setup" 2>&1
s_sql >"$s_tmp/fair" <<'SQL'
select private.signal_claim_fixture_v1('51b02000-0000-4000-8000-000000000104')->>'state';
SQL
test "$(cat "$s_tmp/fair")" = LEASED
s_expect "select x.destination_id from private.signal_deliveries x where x.tenant_id='51b02000-0000-4000-8000-000000000104' and x.status='RUNNING'" 51b05001-0000-4000-8000-000000000104 'independent destination not starved'
s_expect "select count(*)>4000 from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000104' and status='PENDING'" t 'valid destination proceeds before full obsolete drain'
s_sql >"$s_tmp/drain" <<'SQL'
select private.signal_claim_fixture_v1('51b02000-0000-4000-8000-000000000104')->>'state' from generate_series(1,130);
SQL
s_expect "select count(*) from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000104' and status='STALE'" 4096 'all old revisions retained as stale'
s_expect "select count(*) from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000104' and status='RUNNING'" 2 'latest source and independent destination both leased once'
s_expect "select count(*) from private.signal_attempts where tenant_id='51b02000-0000-4000-8000-000000000104'" 0 'no external effect while draining'
echo 'PASS SIGNAL-B4:4096 obsolete jobs, deterministic bounded draining, independent destination fairness; zero external effects'
s_sql >"$s_tmp/disable" <<'SQL'
update private.signal_controls set enabled=false where tenant_id in ('51b02000-0000-4000-8000-000000000101','51b02000-0000-4000-8000-000000000102','51b02000-0000-4000-8000-000000000103','51b02000-0000-4000-8000-000000000104');
update public.tenants set status='suspended' where id in ('51b02000-0000-4000-8000-000000000101','51b02000-0000-4000-8000-000000000102','51b02000-0000-4000-8000-000000000103','51b02000-0000-4000-8000-000000000104');
SQL
