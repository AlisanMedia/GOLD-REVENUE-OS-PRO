#!/usr/bin/env bash
set -euo pipefail
# Real backend races, disposable PostgreSQL only. Never print the DSN.
fse_db_url="${1:?LOCAL_DATABASE_REQUIRED}"
if [[ ! "$fse_db_url" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]]; then
  echo 'LOCAL_DATABASE_REQUIRED' >&2; exit 1
fi
fse_tmp=$(mktemp -d)
fse_children=()
fse_cleanup() {
  fse_status=$?
  for fse_pid in "${fse_children[@]}"; do kill "$fse_pid" 2>/dev/null || true; done
  if test "$fse_status" -ne 0; then
    echo 'FSE_CONCURRENCY_FAILED; original sanitized fixture logs follow' >&2
    for fse_log in "$fse_tmp"/*.log; do test ! -f "$fse_log" || tail -12 "$fse_log" >&2; done
  fi
  rm -rf "$fse_tmp"
}
trap fse_cleanup EXIT
fse_sql() { psql "$fse_db_url" -X -qAt -v ON_ERROR_STOP=1 "$@"; }
fse_expect() { local actual;actual=$(fse_sql -c "$1");test "$actual" = "$2" || { echo "ASSERTION_FAILED: $3" >&2;exit 1; }; }
fse_fixture_root="$(cd "$(dirname "$0")" && pwd)"
if test -z "$(fse_sql -c "select coalesce(to_regprocedure('private.phase16c1b_command(text,integer,text,text,text,boolean,text)')::text,'')")"; then
 fse_sql -f "$fse_fixture_root/helpers/phase16c1b_fixtures.sql" >"$fse_tmp/setup.log" 2>&1
fi
fse_wait_file() {
 for fse_n in $(seq 1 150); do test ! -f "$1" || return 0;sleep .02;done
 echo 'BARRIER_TIMEOUT' >&2;exit 1
}
fse_wait_blocked() {
 for fse_n in $(seq 1 120); do
  if test "$(fse_sql -c "select count(*) from pg_stat_activity where application_name='$1' and datname=current_database() and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0")" = 1; then return 0;fi
  sleep .02
 done
 echo 'INDEPENDENT_BACKEND_LOCK_NOT_OBSERVED' >&2;exit 1
}
fse_writer() {
 local file="$1" name="$2" marker="$3"
 PGAPPNAME="$name" fse_sql -v d="$(cat "$file")" >"$fse_tmp/$name.log" 2>&1 <<SQL &
\set VERBOSITY verbose
begin;
select pg_backend_pid();
select private.phase16c1b_apply(:'d'::jsonb);
\! touch '$fse_tmp/$marker.ready'
\! for n in \$(seq 1 400); do test ! -f '$fse_tmp/$marker.release' || exit 0; sleep .02; done; exit 1
\if :SHELL_ERROR
select 1/0;
\endif
commit;
SQL
 fse_last_pid=$!;fse_children+=("$fse_last_pid")
}
fse_race() {
 local label="$1" first_tenant="$2" second_tenant="$3" physical="$4" second_scenario="$5" kind="${6:-PAYMENT}" a_units="${7:-1000}" b_units="${8:-1000}" root="${9:-null}" first_scenario="${10:-ready}" expected_refunds="${11:-${7:-1000}}"
 local a="$fse_tmp/$label-a.json" b="$fse_tmp/$label-b.json"
 fse_sql -c "select private.phase16c1b_command('$label',$first_tenant,'$a_units','$kind',$root,$physical,'$first_scenario')" >"$a"
 fse_sql -c "select private.phase16c1b_command('$label',$second_tenant,'$b_units','$kind',$root,$physical,'$second_scenario')" >"$b"
 # Different refund identities are essential: partial refunds are not events of
 # the same operation. Same physical/op replay cases intentionally share label.
 if test "$kind" = REFUND; then
  fse_sql -c "select private.phase16c1b_command('$label-second',$second_tenant,'$b_units','REFUND',$root,false,'ready')" >"$b"
 fi
 fse_writer "$a" "fse16c1b-s1" "$label";local first_pid="$fse_last_pid"
 fse_wait_file "$fse_tmp/$label.ready"
 PGAPPNAME=fse16c1b-s2 fse_sql -v d="$(cat "$b")" >"$fse_tmp/fse16c1b-s2.log" 2>&1 <<'SQL' &
\set VERBOSITY verbose
begin;
select pg_backend_pid();
select private.phase16c1b_apply(:'d'::jsonb);
commit;
SQL
 local second_pid=$!;fse_children+=("$second_pid")
 fse_wait_blocked fse16c1b-s2
 fse_expect "select count(distinct pid) from pg_stat_activity where application_name in ('fse16c1b-s1','fse16c1b-s2') and datname=current_database()" 2 'two actual backend PIDs'
 touch "$fse_tmp/$label.release";wait "$first_pid"
 if wait "$second_pid"; then echo 'STALE_CONTEXT_NOT_REJECTED' >&2;exit 1;fi
 grep -q 'FSE_STALE_CONTEXT' "$fse_tmp/fse16c1b-s2.log"
 local second_label="$label";test "$kind" != REFUND || second_label="$label-second"
 fse_sql -c "select private.phase16c1b_apply(private.phase16c1b_command('$second_label',$second_tenant,'$b_units','$kind',$root,$physical,'$second_scenario'))" >"$fse_tmp/retry.log"
 if test "$kind" = PAYMENT; then
  fse_expect "select count(*) from private.fse_operation_claims where namespace_id=private.phase16c1b_id('namespace') and operation_key=(select private.phase16c1b_command('$label',$first_tenant,'$a_units','PAYMENT',null,$physical,'$first_scenario')->'operation'->>'operation_key')" 1 'single financial operation'
  if test "$physical" = true; then
   fse_expect "select count(*) from private.fse_operation_claims where namespace_id=private.phase16c1b_id('namespace') and physical_key=(select private.phase16c1b_command('$label',$first_tenant,'$a_units','PAYMENT',null,true,'$first_scenario')->'operation'->>'physical_key')" 1 'one physical transfer across providers/tenants'
  fi
 else
  fse_expect "select linked_refund_units::text from private.fse_operations where namespace_id=private.phase16c1b_id('namespace') and operation_key=$root" "$expected_refunds" 'exact cumulative refund safety'
 fi
 echo "PASS $label: two backends, observed lock, stale rejection, fresh reconciliation"
}
fse_race 'global-operation-forward' 1 2 false ready
fse_race 'global-operation-reverse' 2 1 false ready
fse_race 'physical-provider-forward' 1 2 true other_provider
fse_race 'physical-provider-reverse' 2 1 true ready PAYMENT 1000 1000 null other_provider

# Original movement has source authority NONE even when a refund references it.
fse_sql -c "select private.phase16c1b_apply(private.phase16c1b_command('concurrent-refund-parent'))" >"$fse_tmp/parent.log"
fse_parent_key=$(fse_sql -c "select private.phase16c1b_command('concurrent-refund-parent')->'operation'->>'operation_key'")
fse_race 'refund-700-500' 1 1 false ready REFUND 700 500 "'$fse_parent_key'"
fse_sql -c "select private.phase16c1b_apply(private.phase16c1b_command('valid-refund-parent'))" >"$fse_tmp/valid-parent.log"
fse_valid_parent=$(fse_sql -c "select private.phase16c1b_command('valid-refund-parent')->'operation'->>'operation_key'")
fse_race 'refund-300-400' 1 1 false ready REFUND 300 400 "'$fse_valid_parent'" ready 700

# A binding revision committed after prepare must invalidate the whole command.
fse_sql -c "select private.phase16c1b_command('revision-before-commit')" >"$fse_tmp/revision.json"
fse_publish="insert into private.fse_binding_versions(namespace_id,tenant_id,id,merchant_binding_id,revision,state,provider_id,merchant_account_id,environment,approval_reference,policy_hash,policy_snapshot,expected_asset,expected_basis)
select namespace_id,tenant_id,gen_random_uuid(),merchant_binding_id,revision+1,state,provider_id,merchant_account_id,environment,approval_reference,policy_hash,policy_snapshot,expected_asset,expected_basis
from private.fse_binding_versions where namespace_id=private.phase16c1b_id('namespace') and tenant_id=private.phase16c1b_id('tenant:1') and merchant_binding_id=private.phase16c1b_id('merchant:1') order by revision desc limit 1;"
fse_sql -c "$fse_publish" >"$fse_tmp/revision-publication.log"
# psql variables are expanded in stdin; never interpolate raw command JSON in SQL.
fse_sql -v d="$(cat "$fse_tmp/revision.json")" >"$fse_tmp/revision.log" 2>&1 <<'SQL' && { echo 'REVISION_FENCE_NOT_ENFORCED' >&2;exit 1; } || true
select private.phase16c1b_apply(:'d'::jsonb);
SQL
grep -q 'FSE_STALE_CONTEXT' "$fse_tmp/revision.log"
echo 'PASS merchant revision committed before recorder: stale/no writes'

# Opposite ordering: recorder holds the scope; revision publication really waits.
fse_sql -c "select private.phase16c1b_command('revision-after-commit')" >"$fse_tmp/revision-after.json"
fse_writer "$fse_tmp/revision-after.json" fse16c1b-s1 revision-after;fse_revision_pid="$fse_last_pid"
fse_wait_file "$fse_tmp/revision-after.ready"
PGAPPNAME=fse16c1b-publisher fse_sql -c "$fse_publish" >"$fse_tmp/publication-wait.log" 2>&1 &
fse_publication_pid=$!;fse_children+=("$fse_publication_pid")
fse_wait_blocked fse16c1b-publisher;touch "$fse_tmp/revision-after.release";wait "$fse_revision_pid";wait "$fse_publication_pid"
echo 'PASS recorder before revision: observed wait, valid earlier commit'

# Crash only the exact local test backend while it has uncommitted effects.
fse_sql -c "select private.phase16c1b_command('crash-before-commit')" >"$fse_tmp/crash.json"
fse_writer "$fse_tmp/crash.json" fse16c1b-crash crash;fse_crash_pid="$fse_last_pid"
fse_wait_file "$fse_tmp/crash.ready"
fse_expect "select count(*) from pg_stat_activity where application_name='fse16c1b-crash' and datname=current_database() and state='idle in transaction'" 1 'exact crash fixture backend'
fse_sql -c "select pg_terminate_backend(pid) from pg_stat_activity where application_name='fse16c1b-crash' and datname=current_database() and state='idle in transaction'" >"$fse_tmp/terminate.log"
touch "$fse_tmp/crash.release";wait "$fse_crash_pid" || true
fse_sql -v d="$(cat "$fse_tmp/crash.json")" >"$fse_tmp/crash-retry.log" <<'SQL'
select count(*) from private.fse_commands where id=(:'d'::jsonb->>'command_id')::uuid;
select private.phase16c1b_apply(:'d'::jsonb);
select private.read_financial_evidence_command_v1((:'d'::jsonb->>'namespace_id')::uuid,(:'d'::jsonb->>'tenant_id')::uuid,(:'d'::jsonb->>'command_id')::uuid,private.fse_storage_hash(jsonb_build_array('command',private.fse_canonical(:'d'::jsonb))))->>'historical';
SQL
grep -q '^true$' "$fse_tmp/crash-retry.log"
test "$(head -1 "$fse_tmp/crash-retry.log")" = 0
echo 'PASS actual pre-COMMIT backend death: rollback and same-command recovery'

# Simulated lost acknowledgement: COMMIT already succeeded, discard first output.
fse_sql -c "select private.phase16c1b_command('lost-ack')" >"$fse_tmp/lost-ack.json"
fse_sql -v d="$(cat "$fse_tmp/lost-ack.json")" >"$fse_tmp/committed-response-discarded.log" <<'SQL'
begin;select private.phase16c1b_apply(:'d'::jsonb);commit;
SQL
fse_sql -v d="$(cat "$fse_tmp/lost-ack.json")" >"$fse_tmp/ack-recovery.log" <<'SQL'
select private.phase16c1b_apply(:'d'::jsonb)->>'historical';
select count(*) from private.fse_commands where id=(:'d'::jsonb->>'command_id')::uuid;
select count(*) from public.audit_logs where action='financial_evidence.recorded' and entity_id=:'d'::jsonb->>'command_id';
SQL
test "$(tr '\n' ' ' <"$fse_tmp/ack-recovery.log")" = 'true 1 1 '
echo 'PASS committed response loss: exact result, one command/audit/effect'

# A real PostgreSQL lock timeout must roll the whole second transaction back.
fse_sql -c "select private.phase16c1b_command('bounded-lock-timeout')" >"$fse_tmp/timeout-a.json"
fse_sql -c "select private.phase16c1b_command('bounded-lock-timeout')" >"$fse_tmp/timeout-b.json"
fse_writer "$fse_tmp/timeout-a.json" fse16c1b-timeout-holder timeout;fse_timeout_holder="$fse_last_pid"
fse_wait_file "$fse_tmp/timeout.ready"
PGAPPNAME=fse16c1b-timeout-waiter fse_sql -v d="$(cat "$fse_tmp/timeout-b.json")" >"$fse_tmp/lock-timeout.log" 2>&1 <<'SQL' &
\set VERBOSITY verbose
begin;
set local lock_timeout='750ms';
select private.phase16c1b_apply(:'d'::jsonb);
commit;
SQL
fse_timeout_waiter=$!;fse_children+=("$fse_timeout_waiter")
fse_wait_blocked fse16c1b-timeout-waiter
if wait "$fse_timeout_waiter"; then echo 'LOCK_TIMEOUT_NOT_ENFORCED' >&2;exit 1;fi
grep -q '55P03' "$fse_tmp/lock-timeout.log"
touch "$fse_tmp/timeout.release";wait "$fse_timeout_holder"
fse_sql -v d="$(cat "$fse_tmp/timeout-b.json")" >"$fse_tmp/timeout-state.log" <<'SQL'
select count(*) from private.fse_commands where id=(:'d'::jsonb->>'command_id')::uuid;
SQL
test "$(cat "$fse_tmp/timeout-state.log")" = 0
fse_sql -c "select private.phase16c1b_apply(private.phase16c1b_command('bounded-lock-timeout'))" >"$fse_tmp/timeout-fresh-retry.log"
echo 'PASS actual 55P03 timeout: no partial command, bounded fresh recovery'
fse_expect "select count(*) from private.verified_payment_receipts" 0 'no genuine receipt'
fse_expect "select count(*) from public.domain_events where event_type='payment.confirmed'" 0 'no trusted payment event'
fse_expect "select count(*) from public.subscriptions where mode='live'" 0 'no live subscription'
fse_expect "select count(*) from public.channel_access where mode='live'" 0 'no live access'
echo 'DEFERRED B02.D genuine receipt/event/outbox; D/E live period/VIP; actual provider acceptance'
