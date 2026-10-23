#!/usr/bin/env bash
set -euo pipefail
b_db="${1:?DISPOSABLE_PG17_REQUIRED}"
[[ "$b_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]] || exit 1
b_root="$(cd "$(dirname "$0")" && pwd)";b_tmp=$(mktemp -d);b_children=()
trap 'for p in "${b_children[@]}";do kill "$p" 2>/dev/null || true;done;rm -rf "$b_tmp"' EXIT
b_sql(){ psql "$b_db" -X -qAt -v ON_ERROR_STOP=1 "$@"; }
test "$(b_sql -c "select current_setting('server_version_num')::int/10000")" = 17
b_profile(){
 local first="$1" last="$2" delay="$3" label="$4" n step t started finished pid
 test "$(b_sql -c "select count(*) from public.tenants where id=('51b02000-0000-4000-8000-'||lpad('$first',12,'0'))::uuid")" = 0
 { cat "$b_root/helpers/signal_distribution_fixtures.sql";echo "select pg_temp.signal_case_setup(n) from generate_series($first,$last)n;"; } | b_sql >"$b_tmp/config-$label" 2>&1
 read -r started _ </proc/uptime
 { cat "$b_root/helpers/signal_distribution_fixtures.sql";cat <<SQL
do \$\$begin for n in $first..$last loop for k in 1..8 loop perform private.signal_record_fixture_v1(jsonb_set(pg_temp.signal_dispatch_input(n,'burst-'||k)::jsonb,'{observed_at}',to_jsonb(clock_timestamp()))::text);end loop;end loop;end;\$\$;
SQL
 } | b_sql >"$b_tmp/seed-$label" 2>&1
 b_children=()
 for n in $(seq "$first" "$last");do
  printf -v t '51b02000-0000-4000-8000-%012d' "$n"
  {
   cat "$b_root/helpers/signal_distribution_fixtures.sql"
   for step in $(seq 1 8);do
    cat <<SQL
select v->>'delivery_id' as job,v->>'lease_token' as token from (select private.signal_claim_fixture_v1('$t') v) q \gset
select private.signal_begin_fixture_v1('$t',:'job'::uuid,:'token'::uuid) as prepared \gset
select 1/((:'prepared'::jsonb->>'state'='PREPARED')::int);
select pg_sleep($delay);
select private.signal_finish_fixture_v1('$t',:'job'::uuid,:'token'::uuid,pg_temp.signal_ack(:'prepared'::jsonb->'payload'))->>'state' as result \gset
select 1/((:'result'='FAKE_CONFIRMED')::int);
SQL
   done
  } | PGAPPNAME="signal-benchmark-$n" b_sql >"$b_tmp/worker-$label-$n" 2>&1 &
  b_children+=("$!")
 done
 for pid in "${b_children[@]}";do if ! wait "$pid";then echo 'SIGNAL_BENCHMARK_FAILED; no private payload or lease disclosed' >&2;exit 1;fi;done
 read -r finished _ </proc/uptime
 b_sql <<SQL
with samples as (
 select 1000*extract(epoch from (h.evidence->>'acknowledged_at')::timestamptz-(e.original->>'observed_at')::timestamptz) latency,
  1000*extract(epoch from e.recorded_at-(e.original->>'observed_at')::timestamptz) ingest,
  1000*extract(epoch from j.enqueued_at-e.recorded_at) queue_insert,
  1000*extract(epoch from c.claimed_at-j.enqueued_at) queue_wait,
  1000*extract(epoch from a.started_at-c.claimed_at) preparation,
  1000*extract(epoch from (h.evidence->>'acknowledged_at')::timestamptz-a.started_at) dispatch_ack,
  1000*extract(epoch from h.recorded_at-(h.evidence->>'acknowledged_at')::timestamptz) record_ack
 from private.signal_deliveries j join private.signal_events e on e.id=j.event_id and e.tenant_id=j.tenant_id
 join private.signal_attempts a on a.delivery_id=j.id and a.tenant_id=j.tenant_id
 join private.signal_delivery_history h on h.delivery_id=j.id and h.tenant_id=j.tenant_id and h.code='FAKE_ACK'
 cross join lateral (select min(recorded_at) claimed_at from private.signal_delivery_history where tenant_id=j.tenant_id and delivery_id=j.id and code='CLAIMED') c
 where j.tenant_id=any(array(select ('51b02000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series($first,$last)n))
), summary as (
 select count(*) n,min(latency) minimum,percentile_disc(.5) within group(order by latency) p50,percentile_disc(.95) within group(order by latency) p95,percentile_disc(.99) within group(order by latency) p99,max(latency) maximum,
 percentile_disc(.95) within group(order by ingest) ingest_p95,percentile_disc(.95) within group(order by queue_insert) queue_insert_p95,percentile_disc(.95) within group(order by queue_wait) queue_wait_p95,
 percentile_disc(.95) within group(order by preparation) prepare_p95,percentile_disc(.95) within group(order by dispatch_ack) dispatch_ack_p95,percentile_disc(.95) within group(order by record_ack) record_p95 from samples
)
select jsonb_build_object('profile','$label','classification','SYNTHETIC_SQL_FAKE_ACK_HARNESS','tenant_count',11,'provider_count',11,'workers',11,'events',n,'fake_ack_delay_ms',$delay*1000,
 'p50_ms',round(p50,3),'p95_ms',round(p95,3),'p99_ms',round(p99,3),'max_ms',round(maximum,3),'minimum_ms',round(minimum,3),'target_p95_ms',1000,'target_met',p95<1000,
 'monotonic_total_ms',('$finished'::numeric-'$started'::numeric)*1000,'percentiles','NEAREST_RANK','time_basis','source observable receipt to fake API acknowledgement; same PostgreSQL clock',
 'stage_p95_ms',jsonb_build_object('sql_ingestion',round(ingest_p95,3),'queue_insert',round(queue_insert_p95,3),'queue_wait',round(queue_wait_p95,3),'prepare',round(prepare_p95,3),'dispatch_ack',round(dispatch_ack_p95,3),'persist_ack',round(record_p95,3)),
 'real_telegram_performance','UNVERIFIED','production_capacity','UNVERIFIED') from summary;
select 1/((count(*)=88 and bool_and(status='FAKE_CONFIRMED'))::int) as invariant from private.signal_deliveries where tenant_id=any(array(select ('51b02000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series($first,$last)n));
update private.signal_controls set enabled=false where tenant_id=any(array(select ('51b02000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series($first,$last)n));
update public.tenants set status='suspended' where id=any(array(select ('51b02000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series($first,$last)n));
SQL
}
b_profile 201 211 .002 BURST_11_TENANTS
b_profile 221 231 .150 DELAYED_ACK_11_TENANTS
echo 'PASS SIGNAL benchmark:176 acknowledged synthetic events; fixtures disabled; no Telegram/provider or production throughput claim'
