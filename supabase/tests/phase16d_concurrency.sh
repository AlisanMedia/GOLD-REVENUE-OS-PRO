#!/usr/bin/env bash
set -euo pipefail
# Own disposable fixture only; no adapter, real bot or provider is instantiated.
d_db_url="${1:?LOCAL_DATABASE_REQUIRED}"
[[ "$d_db_url" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]] || { echo LOCAL_DATABASE_REQUIRED >&2;exit 1; }
d_tmp=$(mktemp -d);d_children=()
d_cleanup(){ local status=$?;for pid in "${d_children[@]}";do kill "$pid" 2>/dev/null || true;done;rm -rf "$d_tmp";test "$status" = 0 || echo 'SYNTHETIC_ENTITLEMENT_RACE_FAILED; no source/lease data printed' >&2; }
trap d_cleanup EXIT
d_sql(){ psql "$d_db_url" -X -qAt -v ON_ERROR_STOP=1 "$@"; }
d_expect(){ test "$(d_sql -c "$1")" = "$2" || { echo "ASSERTION_FAILED: $3" >&2;exit 1; }; }
d_root="$(cd "$(dirname "$0")" && pwd)"
d_expect "select current_setting('server_version_num')::integer/10000" 17 'PostgreSQL17 required'
d_expect "select count(*) from public.tenants where id='d3200000-0000-4000-8000-000000000001'" 0 'fresh synthetic fixture required'
d_sql -f "$d_root/helpers/phase16de_fixtures.sql" >"$d_tmp/setup" 2>&1
d_wait(){ for n in $(seq 1 200);do test ! -f "$1" || return 0;sleep .02;done;echo BARRIER_TIMEOUT >&2;exit 1; }
d_holder(){
 local name="$1" marker="$2"
 PGAPPNAME="$name" d_sql >"$d_tmp/$name" 2>&1 <<SQL &
begin;
select pg_backend_pid();
select public.entitlement_claim_job('d3200000-0000-4000-8000-000000000001') is not null;
\! touch '$d_tmp/$marker.ready'
\! for n in \$(seq 1 400);do test ! -f '$d_tmp/$marker.release' || exit 0;sleep .02;done;exit 1
\if :SHELL_ERROR
select 1/0;
\endif
commit;
SQL
 d_holder_pid=$!;d_children+=("$d_holder_pid")
}
d_holder phase16d-crash-s1 crash;d_wait "$d_tmp/crash.ready"
PGAPPNAME=phase16d-crash-s2 d_sql >"$d_tmp/second" <<'SQL'
select pg_backend_pid();
select public.entitlement_claim_job('d3200000-0000-4000-8000-000000000001') is null;
SQL
test "$(tail -1 "$d_tmp/second")" = t
test "$(head -1 "$d_tmp/phase16d-crash-s1")" != "$(head -1 "$d_tmp/second")"
d_expect "select count(*) from pg_stat_activity where application_name='phase16d-crash-s1' and datname=current_database() and state='idle in transaction'" 1 'exact own backend'
d_expect "select pg_terminate_backend(pid) from pg_stat_activity where application_name='phase16d-crash-s1' and datname=current_database()" t 'terminate own precommit fixture backend'
touch "$d_tmp/crash.release"
if wait "$d_holder_pid";then echo CRASH_NOT_OBSERVED >&2;exit 1;fi
d_expect "select status||':'||attempts::text from public.entitlement_jobs where tenant_id='d3200000-0000-4000-8000-000000000001'" PENDING:0 'uncommitted lease/attempt rolled back'
d_expect "select count(*) from public.entitlement_audit where tenant_id='d3200000-0000-4000-8000-000000000001' and action='job_claimed'" 0 'claim audit rolled back atomically'
echo 'PASS D-C1: distinct backend PIDs; SKIP LOCKED; real pre-COMMIT death rolls back lease/attempt/audit'

# A committed claim with a lost response remains exclusively leased. Only after
# fixture time expiry can another backend reclaim; no unsafe immediate retry.
d_expect "select public.entitlement_claim_job('d3200000-0000-4000-8000-000000000001') is not null" t 'recover after precommit death'
d_expect "select public.entitlement_claim_job('d3200000-0000-4000-8000-000000000001') is null" t 'lost claim ACK cannot duplicate lease'
d_sql -c "update public.entitlement_jobs set lease_until=now()-interval '1 second' where tenant_id='d3200000-0000-4000-8000-000000000001'" >"$d_tmp/expire"
d_holder phase16d-reclaim-s1 reclaim;d_wait "$d_tmp/reclaim.ready"
PGAPPNAME=phase16d-reclaim-s2 d_sql >"$d_tmp/reclaim-second" <<'SQL'
select pg_backend_pid();
select public.entitlement_claim_job('d3200000-0000-4000-8000-000000000001') is null;
SQL
test "$(tail -1 "$d_tmp/reclaim-second")" = t
test "$(head -1 "$d_tmp/phase16d-reclaim-s1")" != "$(head -1 "$d_tmp/reclaim-second")"
touch "$d_tmp/reclaim.release";wait "$d_holder_pid"
d_expect "select status||':'||attempts::text from public.entitlement_jobs where tenant_id='d3200000-0000-4000-8000-000000000001'" RUNNING:2 'one committed replacement lease'
echo 'PASS D-C2: committed response loss stays leased; two-backend expiry recovery has one winner'

# Hold after a claimed fake provider side effect, then compensation. No genuine
# financial event, live control, channel or Telegram transport is touched.
d_sql >"$d_tmp/hold" <<'SQL'
begin;
select set_config('request.jwt.claim.sub','d3100000-0000-4000-8000-000000000001',true);
select public.admin_subscription_control('d3200000-0000-4000-8000-000000000001',(select id from public.subscriptions where tenant_id='d3200000-0000-4000-8000-000000000001'),'hold',gen_random_uuid());
commit;
SQL
d_expect "select public.entitlement_complete_job(tenant_id,id,lease_token,jsonb_build_object('ok',true,'invite_reference','test:invite:late','expires_at',now()+interval '300 seconds')) from public.entitlement_jobs where tenant_id='d3200000-0000-4000-8000-000000000001' and status='RUNNING'" f 'stale fake grant rejected'
d_expect "select public.entitlement_claim_job('d3200000-0000-4000-8000-000000000001')->>'operation'" revoke 'compensation is revoke'
d_expect "select public.entitlement_complete_job(tenant_id,id,lease_token,'{\"ok\":true}') from public.entitlement_jobs where tenant_id='d3200000-0000-4000-8000-000000000001' and status='RUNNING'" t 'fake revocation confirmed'
d_expect "select status from public.channel_access where tenant_id='d3200000-0000-4000-8000-000000000001'" REVOKED 'final state agrees'
d_expect "select count(*) from public.subscription_payments where tenant_id='d3200000-0000-4000-8000-000000000001'" 1 'no duplicate period'
d_expect "select count(*) from private.verified_payment_receipts" 0 'no genuine receipt'
d_expect "select count(*) from public.domain_events where tenant_id='d3200000-0000-4000-8000-000000000001' and event_type='payment.confirmed'" 0 'no live payment event'
d_expect "select outbound_messaging_enabled from public.tenants where id='d3200000-0000-4000-8000-000000000001'" f 'outbound stays off'
echo 'PASS D-C3: late fake side effect fenced, queued compensation reconciles REVOKED; financial authority absent'
