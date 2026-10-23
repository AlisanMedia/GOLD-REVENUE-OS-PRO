#!/usr/bin/env bash
set -euo pipefail
r_db="${1:?LOCAL_POSTGRESQL17_REQUIRED}"
[[ "$r_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]] || { echo LOCAL_POSTGRESQL17_REQUIRED >&2;exit 1; }
r_tmp=$(mktemp -d);r_children=();r_root="$(cd "$(dirname "$0")" && pwd)"
r_cleanup(){ local status=$?;for pid in "${r_children[@]}";do kill "$pid" 2>/dev/null || true;done;rm -rf "$r_tmp";test "$status" = 0 || echo 'SYNTHETIC_R1_FAILED; no lease/source/credential data printed' >&2; }
trap r_cleanup EXIT
r_sql(){ psql "$r_db" -X -qAt -v ON_ERROR_STOP=1 "$@"; }
r_expect(){ test "$(r_sql -c "$1")" = "$2" || { echo "ASSERTION_FAILED: $3" >&2;exit 1; }; }
r_wait(){ for n in $(seq 1 300);do test ! -f "$1" || return 0;sleep .02;done;echo BARRIER_TIMEOUT >&2;exit 1; }
r_setup(){
 local scope="$1"
 r_expect "select count(*) from public.tenants where id='${scope}2000-0000-4000-8000-000000000001'" 0 'fresh owned fixture required'
 sed "s/16de/$scope/g" "$r_root/helpers/phase16de_fixtures.sql" | r_sql >"$r_tmp/setup-$scope" 2>&1
 r_sql -c "insert into private.entitlement_test_policy(tenant_id) values('${scope}2000-0000-4000-8000-000000000001')" >"$r_tmp/policy-$scope"
}
r_expect "select current_setting('server_version_num')::integer/10000" 17 'PostgreSQL17 required'

# C1: real pre-COMMIT death; a different connection cannot own its lease.
r_setup 16f2
PGAPPNAME=phase16dr1-crash-a r_sql >"$r_tmp/crash-a" 2>&1 <<SQL &
set statement_timeout='5s';begin;
select pg_backend_pid();
select public.entitlement_test_claim_cycle_v1('16f22000-0000-4000-8000-000000000001')->'job' is distinct from 'null'::jsonb;
\! touch '$r_tmp/crash.ready'
\! for n in \$(seq 1 400);do test ! -f '$r_tmp/crash.release' || exit 0;sleep .02;done;exit 1
\if :SHELL_ERROR
select 1/0;
\endif
commit;
SQL
r_pid=$!;r_children+=("$r_pid");r_wait "$r_tmp/crash.ready"
PGAPPNAME=phase16dr1-crash-b r_sql >"$r_tmp/crash-b" <<'SQL'
set statement_timeout='3s';select pg_backend_pid();
select public.entitlement_test_claim_cycle_v1('16f22000-0000-4000-8000-000000000001')->'job'='null'::jsonb;
SQL
test "$(tail -1 "$r_tmp/crash-b")" = t;test "$(head -1 "$r_tmp/crash-a")" != "$(head -1 "$r_tmp/crash-b")"
r_expect "select pg_terminate_backend(pid) from pg_stat_activity where application_name='phase16dr1-crash-a' and datname=current_database()" t 'only own precommit backend'
touch "$r_tmp/crash.release";if wait "$r_pid";then echo CRASH_NOT_OBSERVED >&2;exit 1;fi
r_expect "select status||':'||attempts from public.entitlement_jobs where tenant_id='16f22000-0000-4000-8000-000000000001'" PENDING:0 'claim rollback'
r_expect "select count(*) from private.entitlement_test_runtime where tenant_id='16f22000-0000-4000-8000-000000000001'" 0 'counter rollback'
r_expect "select count(*) from public.entitlement_audit where tenant_id='16f22000-0000-4000-8000-000000000001' and action='job_claimed'" 0 'audit rollback'
echo 'PASS R1-C1: independent backend PIDs, exclusive lease, real precommit death rolls back job/counter/audit'

# C2: committed dispatch + lost ACK. Never re-send an unknown revoke effect.
r_setup 16f3
r_sql >"$r_tmp/uncertain" <<'SQL'
update public.entitlement_jobs set available_at='infinity' where tenant_id='16f32000-0000-4000-8000-000000000001';
update public.subscriptions set state='HOLD',revision=2 where tenant_id='16f32000-0000-4000-8000-000000000001';
select private.entitlement_enqueue((select id from public.subscriptions where tenant_id='16f32000-0000-4000-8000-000000000001'),'revoke');
select public.entitlement_test_claim_cycle_v1('16f32000-0000-4000-8000-000000000001')->'job' is distinct from 'null'::jsonb;
select public.entitlement_test_begin_effect_v1(tenant_id,id,lease_token) from public.entitlement_jobs where tenant_id='16f32000-0000-4000-8000-000000000001' and status='RUNNING';
SQL
test "$(tail -1 "$r_tmp/uncertain")" = t
# The only fake external effect is this local marker; there is no adapter/network.
printf 'one synthetic effect\n' >"$r_tmp/fake-effect"
r_sql -c "update public.entitlement_jobs set lease_until=now()-interval '1 second' where tenant_id='16f32000-0000-4000-8000-000000000001' and status='RUNNING'" >"$r_tmp/expire"
r_pair=();for worker in a b;do
 PGAPPNAME="phase16dr1-uncertain-$worker" r_sql >"$r_tmp/uncertain-$worker" <<'SQL' &
select pg_backend_pid();select public.entitlement_test_claim_cycle_v1('16f32000-0000-4000-8000-000000000001')->'job'='null'::jsonb;
SQL
 r_pair+=("$!");r_children+=("$!")
done
for r_child in "${r_pair[@]}";do wait "$r_child";done
test "$(head -1 "$r_tmp/uncertain-a")" != "$(head -1 "$r_tmp/uncertain-b")"
test "$(tail -1 "$r_tmp/uncertain-a")" = t;test "$(tail -1 "$r_tmp/uncertain-b")" = t
r_expect "select status||':'||last_error from public.entitlement_jobs where tenant_id='16f32000-0000-4000-8000-000000000001' and operation='revoke'" FAILED:TEST_UNKNOWN_EFFECT 'unknown revoke retained'
r_expect "select status from public.channel_access where tenant_id='16f32000-0000-4000-8000-000000000001'" REVIEW 'not falsely revoked'
r_expect "select claims from private.entitlement_test_runtime where tenant_id='16f32000-0000-4000-8000-000000000001'" 1 'no automatic repeat'
test "$(wc -l <"$r_tmp/fake-effect")" = 1
echo 'PASS R1-C2: two workers cannot reclaim dispatched uncertainty; one fake effect, revoke obligation visible in REVIEW'

# C3: 4096 obsolete same-lane jobs; two actual persistent connections. Each call
# is its own transaction; <=1024 calls/worker, <=32 candidates/call. A busy
# nonblocking claim backs off2ms; busy returns are not counted as drained work.
r_setup 16f4
r_sql >"$r_tmp/backlog" <<'SQL'
update public.subscriptions set state='HOLD',revision=8192 where tenant_id='16f42000-0000-4000-8000-000000000001';
insert into public.entitlement_jobs(id,tenant_id,access_id,revision,operation,available_at)
 select ('16f49000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'16f42000-0000-4000-8000-000000000001',a.id,n,'revoke',now()-interval '1 day'
 from public.channel_access a cross join generate_series(1,4096) n where a.tenant_id='16f42000-0000-4000-8000-000000000001';
select private.entitlement_enqueue((select id from public.subscriptions where tenant_id='16f42000-0000-4000-8000-000000000001'),'revoke');
analyze public.entitlement_jobs;
SQL
echo 'R1 inspected same4096 workload: legacy global head vs indexed lane head (synthetic only)'
r_sql <<'SQL'
explain (analyze,buffers,costs off) select id from public.entitlement_jobs where tenant_id='16f42000-0000-4000-8000-000000000001' and available_at<=now() and (status='PENDING' or (status='RUNNING' and lease_until<now())) order by available_at,id limit 1;
explain (analyze,buffers,costs off) select id from public.entitlement_jobs where tenant_id='16f42000-0000-4000-8000-000000000001' and status in ('PENDING','RUNNING') and available_at<=now() and (status='PENDING' or lease_until<now()) and (case operation when 'revoke' then 0 when 'reconcile' then 1 else 2 end)=0 order by available_at,id limit 1;
SQL
r_pair=();for worker in a b;do
 {
  cat <<'SQL'
set statement_timeout='8s';select pg_backend_pid();
create function pg_temp.rstep() returns boolean language plpgsql as $$declare c jsonb;j jsonb;begin
 c:=public.entitlement_test_claim_cycle_v1('16f42000-0000-4000-8000-000000000001');
 if (c->>'examined')::int>32 then raise exception 'cycle budget violated';end if;
 j:=c->'job';if j is distinct from 'null'::jsonb then
  if j->>'operation'<>'revoke' or (j->>'revision')::int<>8192 then raise exception 'invalid obligation';end if;
  if not public.entitlement_test_begin_effect_v1('16f42000-0000-4000-8000-000000000001',(j->>'id')::uuid,(j->>'lease_token')::uuid) then raise exception 'dispatch denied';end if;
  return public.entitlement_complete_job('16f42000-0000-4000-8000-000000000001',(j->>'id')::uuid,(j->>'lease_token')::uuid,'{"ok":true}');
 end if;
 if not (c->>'has_more')::boolean then return true;end if;
 if (c->>'examined')::integer=0 then perform pg_sleep(.002);end if;
 return false;
end;$$;
SQL
  for cycle in $(seq 1 1024);do
   printf '%s\n' 'select pg_temp.rstep() as r_done \gset' '\if :r_done' '\quit' '\endif'
  done
  printf '%s\n' '\echo R1_BOUNDED_DRAIN_EXHAUSTED' '\quit 1'
 } >"$r_tmp/drain-$worker.sql"
 PGAPPNAME="phase16dr1-drain-$worker" r_sql -f "$r_tmp/drain-$worker.sql" >"$r_tmp/drain-$worker" 2>&1 &
 r_pair+=("$!");r_children+=("$!")
done
for r_child in "${r_pair[@]}";do wait "$r_child";done
test "$(head -1 "$r_tmp/drain-a")" != "$(head -1 "$r_tmp/drain-b")"
r_expect "select count(*) from public.entitlement_jobs where tenant_id='16f42000-0000-4000-8000-000000000001' and operation='revoke' and status='STALE'" 4096 'all stale history retained'
r_expect "select count(*) from public.entitlement_jobs where tenant_id='16f42000-0000-4000-8000-000000000001' and operation='revoke' and status='DONE'" 1 'single valid cleanup'
r_expect "select count(*) from public.entitlement_audit where tenant_id='16f42000-0000-4000-8000-000000000001' and action='job_revoke'" 1 'one receipt of fake effect'
r_expect "select status from public.channel_access where tenant_id='16f42000-0000-4000-8000-000000000001'" REVOKED 'fake final status agrees'
echo 'PASS R1-C3: two independent connections drain4096 obsolete jobs, <=32 candidates/call, exactly one current fake revoke'

# C4: revision changes while an independently connected fake worker is in flight.
r_setup 16f5
PGAPPNAME=phase16dr1-late-a r_sql >"$r_tmp/late-a" 2>&1 <<SQL &
select pg_backend_pid();
select public.entitlement_test_claim_cycle_v1('16f52000-0000-4000-8000-000000000001')->'job' is distinct from 'null'::jsonb;
select public.entitlement_test_begin_effect_v1(tenant_id,id,lease_token) from public.entitlement_jobs where tenant_id='16f52000-0000-4000-8000-000000000001' and status='RUNNING';
select id as old_id,lease_token as old_token from public.entitlement_jobs where tenant_id='16f52000-0000-4000-8000-000000000001' and status='RUNNING' \gset
\! touch '$r_tmp/late.ready'
\! for n in \$(seq 1 400);do test ! -f '$r_tmp/late.release' || exit 0;sleep .02;done;exit 1
\if :SHELL_ERROR
select 1/0;
\endif
select public.entitlement_complete_job('16f52000-0000-4000-8000-000000000001',:'old_id'::uuid,:'old_token'::uuid,jsonb_build_object('ok',true,'invite_reference','test:invite:r1-late','expires_at',now()+interval '300 seconds'));
SQL
r_pid=$!;r_children+=("$r_pid");r_wait "$r_tmp/late.ready"
PGAPPNAME=phase16dr1-hold-b r_sql >"$r_tmp/hold-b" <<'SQL'
select pg_backend_pid();
begin;select set_config('request.jwt.claim.sub','16f51000-0000-4000-8000-000000000001',true);
select public.admin_subscription_control('16f52000-0000-4000-8000-000000000001',(select id from public.subscriptions where tenant_id='16f52000-0000-4000-8000-000000000001'),'hold',gen_random_uuid());commit;
SQL
test "$(head -1 "$r_tmp/late-a")" != "$(head -1 "$r_tmp/hold-b")"
touch "$r_tmp/late.release";wait "$r_pid";test "$(tail -1 "$r_tmp/late-a")" = f
r_expect "select count(*) from public.entitlement_jobs where tenant_id='16f52000-0000-4000-8000-000000000001' and operation='revoke' and revision=2" 1 'current cleanup deduplicated'
r_expect "select uncertain from private.entitlement_test_runtime where tenant_id='16f52000-0000-4000-8000-000000000001'" t 'stale external result remains uncertain'
r_sql >"$r_tmp/compensate" <<'SQL'
select public.entitlement_test_claim_cycle_v1('16f52000-0000-4000-8000-000000000001')->'job'->>'operation';
select public.entitlement_test_begin_effect_v1(tenant_id,id,lease_token) from public.entitlement_jobs where tenant_id='16f52000-0000-4000-8000-000000000001' and status='RUNNING';
select public.entitlement_complete_job(tenant_id,id,lease_token,'{"ok":true}') from public.entitlement_jobs where tenant_id='16f52000-0000-4000-8000-000000000001' and status='RUNNING';
SQL
test "$(head -1 "$r_tmp/compensate")" = revoke;test "$(tail -1 "$r_tmp/compensate")" = t
r_expect "select status from public.channel_access where tenant_id='16f52000-0000-4000-8000-000000000001'" REVOKED 'only fake confirmed cleanup revokes'
echo 'PASS R1-C4: real concurrent revision change fences late result, keeps uncertainty and deduplicates compensating revoke'

r_expect "select count(*) from private.verified_payment_receipts" 0 'no genuine receipts'
r_expect "select count(*) from public.domain_events where event_type='payment.confirmed'" 0 'no trusted live event'
r_expect "select count(*) from public.subscriptions where mode='live'" 0 'no live subscription'
r_expect "select count(*) from private.entitlement_controls where live_enabled" 0 'global LIVE remains off'
r_expect "select count(*) from public.tenants where id in ('16f22000-0000-4000-8000-000000000001','16f32000-0000-4000-8000-000000000001','16f42000-0000-4000-8000-000000000001','16f52000-0000-4000-8000-000000000001') and outbound_messaging_enabled" 0 'outbound stays off'
# Retain audits/history/failed repair obligations, disable only owned fixtures.
r_sql -c "update public.tenants set status='suspended' where id in ('16f22000-0000-4000-8000-000000000001','16f32000-0000-4000-8000-000000000001','16f42000-0000-4000-8000-000000000001','16f52000-0000-4000-8000-000000000001')" >"$r_tmp/disabled"
echo 'PASS R1 invariants: no genuine financial/LIVE/outbound authority; only owned fixtures disabled, evidence retained'
