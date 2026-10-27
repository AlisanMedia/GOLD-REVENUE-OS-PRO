#!/usr/bin/env bash
set -euo pipefail
business_db="${1:?DISPOSABLE_PG17_REQUIRED}"
[[ "$business_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/(postgres|goldpolat_runtime_[A-Za-z0-9_]+)$ ]] || exit 1
business_root=$(cd "$(dirname "$0")" && pwd)
business_tmp=$(mktemp -d);business_created=false;business_case=SETUP
business_sql(){ psql "$business_db" -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@"; }
business_id(){ printf '9b00%s-0000-4000-8000-%012d' "$2" "$1"; }
business_cleanup(){ local status=$?;for pid in $(jobs -pr);do kill "$pid" 2>/dev/null || true;done
 if test "$business_created" = true;then business_sql -c "update private.private_beta_programs set stage='STOPPED',generation=generation+1 where tenant_id in(select id from public.tenants where slug in('private-beta-fixture-9821','private-beta-fixture-9822','private-beta-fixture-9823','private-beta-fixture-9824','private-beta-fixture-9825','private-beta-fixture-9826','private-beta-fixture-9827'));update public.tenants set status='suspended'where slug in('private-beta-fixture-9821','private-beta-fixture-9822','private-beta-fixture-9823','private-beta-fixture-9824','private-beta-fixture-9825','private-beta-fixture-9826','private-beta-fixture-9827');" >"$business_tmp/cleanup" 2>&1 || status=1;fi
 if test "$status" = 0;then rm -rf "$business_tmp";else echo "PRIVATE_BETA_BUSINESS_CONCURRENCY_FAILED: $business_case; original diagnostics retained at $business_tmp" >&2;fi;exit "$status"; }
trap business_cleanup EXIT
test "$(business_sql -c "select current_setting('server_version_num')::int/10000")" = 17
test "$(business_sql -c "select count(*)from public.tenants where id='$(business_id 9821 2000)'")" = 0
{ printf 'begin;\n';cat "$business_root/helpers/private_beta_uat_fixtures.sql";cat "$business_root/helpers/private_beta_business_fixtures.sql";cat <<'SQL'
do $$declare n integer;begin
 for n in 9821..9827 loop
  perform pg_temp.business_setup(n);perform pg_temp.business_seal(n);
  if n>9821 then perform pg_temp.business_enroll(n);end if;
  if n in(9825,9827)then perform pg_temp.business_prepare_run(n);end if;
 end loop;
end;$$;
insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_chat_id,reply_to_message_id,idempotency_key,actor_type,actor_id,correlation_id,occurred_at)
select c.tenant_id,c.id,c.customer_id,c.messaging_contact_id,c.provider_connection_id,'outbound','text','Synthetic concurrency draft.','pending',a.provider_chat_id,a.last_inbound_id,'business-concurrency-draft','SYSTEM','private-beta-ai:'||a.revision,extensions.gen_random_uuid(),clock_timestamp()
from public.conversations c join private.private_beta_participants a on a.conversation_id=c.id where c.tenant_id in(select pg_temp.beta_id(n,'2000')from generate_series(9822,9827)n);
select public.private_beta_reserve_v1(pg_temp.beta_id(9827,'2000'),pg_temp.beta_id(9827,'3000'),(select run_id from business_cases where n=9827),repeat('c',64),repeat('d',64),(select(ingest->>'message_id')::uuid from private_beta_cases where n=9827),'0.50128',(select(ingest->>'conversation_id')::uuid from private_beta_cases where n=9827));
commit;
SQL
} | business_sql >"$business_tmp/setup" 2>&1
business_created=true
business_wait(){ local app="$1";local kind="$2";for check in $(seq 1 200);do if test "$(business_sql -c "select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='$app'and wait_event_type='$kind')")" = t;then return 0;fi;sleep .01;done;return 1; }
business_first(){ local app="$1";local command="$2";local delay="${3:-2}";business_sql >"$business_tmp/$app" 2>&1 <<SQL &
begin;set local application_name='$app';$command select pg_sleep($delay);commit;
SQL
 business_first_pid=$!;business_wait "$app" Timeout; }
business_event(){ local n="$1";local kind="$2";local u="$3";local msg="${4:-$3}";
 printf "select public.private_beta_business_event_v1('%s','%s',jsonb_build_object('version',1,'kind','%s','update_id','%s','business_connection_id',b.business_connection_id,'provider_user_id',case when '%s'='INBOUND'then b.founder_chat_id else b.representative_user_id end,'provider_chat_id',case when '%s'='CONNECTION_DISABLED'then null else b.founder_chat_id end,'provider_message_id',case when '%s'='CONNECTION_DISABLED'then null else '%s'end,'source_hash',private.fse_hash('concurrency:%s:%s:%s'),'occurred_at',(p.configuration->>'starts_at')::timestamptz+interval '30 seconds','content',case when '%s'='HUMAN_REPLY'then 'Synthetic observed representative reply.'else null end)::text)from private.private_beta_business_controls b join private.private_beta_programs p on p.id=b.program_id where b.program_id='%s';" "$(business_id "$n" 2000)" "$(business_id "$n" 3000)" "$kind" "$u" "$kind" "$kind" "$kind" "$msg" "$n" "$kind" "$u" "$kind" "$(business_id "$n" 3000)"; }
business_claim(){ local n="$1";printf "select public.private_beta_claim_reply_v1('%s',(select id from public.messages where tenant_id='%s'and idempotency_key='business-concurrency-draft'));" "$(business_id "$n" 2000)" "$(business_id "$n" 2000)"; }
business_case=C1
business_command=$(business_event 9821 INBOUND 40)
business_first business-replay-first "$business_command"
business_pid_a=$(business_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='business-replay-first'")
test "$(business_sql -c "select count(*)from private.private_beta_business_events where program_id='$(business_id 9821 3000)'and update_id='40'")" = 0
business_sql -c "begin;set local application_name='business-replay-second';set local statement_timeout='8s';$business_command commit;" >"$business_tmp/replay-second" 2>&1 &
business_second=$!;business_wait business-replay-second Lock
business_pid_b=$(business_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='business-replay-second'")
test -n "$business_pid_a";test -n "$business_pid_b";test "$business_pid_a" != "$business_pid_b"
wait "$business_first_pid";wait "$business_second"
grep -q '"duplicate": true' "$business_tmp/replay-second"
test "$(business_sql -c "select count(*)from private.private_beta_business_events where program_id='$(business_id 9821 3000)'and update_id='40'")" = 1
echo 'PASS BUSINESS-C1: independent PostgreSQL backend PIDs, real row-lock wait and precommit invisibility; callback replay persists once'
business_case=C2
business_first business-human-first "$(business_event 9822 HUMAN_REPLY 41)"
business_sql -c "begin;set local application_name='business-human-claim';set local statement_timeout='8s';$(business_claim 9822)commit;" >"$business_tmp/human-claim" 2>&1 &
business_second=$!;business_wait business-human-claim Lock;wait "$business_first_pid";wait "$business_second"
grep -q '"dispatch": false' "$business_tmp/human-claim"
test "$(business_sql -c "select count(*)from public.messages where tenant_id='$(business_id 9822 2000)'and idempotency_key='business-concurrency-draft'and status='blocked'")" = 1
echo 'PASS BUSINESS-C2: provider-observed representative takeover wins against queued AI claim; no send authority or staff impersonation'
business_case=C3
business_first business-claim-first "$(business_claim 9823)"
business_sql -c "begin;set local application_name='business-after-claim-human';set local statement_timeout='8s';$(business_event 9823 HUMAN_REPLY 42)commit;" >"$business_tmp/after-claim-human" 2>&1 &
business_second=$!;business_wait business-after-claim-human Lock;wait "$business_first_pid";wait "$business_second"
test "$(business_sql -c "select runtime_mode::text from public.conversations where tenant_id='$(business_id 9823 2000)'")" = PAUSED
test "$(business_sql -c "select count(*)from public.messages where tenant_id='$(business_id 9823 2000)'and idempotency_key='business-concurrency-draft'and status='sending'")" = 1
echo 'PASS BUSINESS-C3: already-started claim remains uncertain under later takeover; no false cancellation or clean-success state'
business_case=C4
business_first business-worker-first "$(business_claim 9824)"
business_sql -c "begin;set local application_name='business-worker-second';set local statement_timeout='8s';$(business_claim 9824)commit;" >"$business_tmp/worker-second" 2>&1 &
business_second=$!;business_wait business-worker-second Lock;wait "$business_first_pid";wait "$business_second"
grep -q '"dispatch": true' "$business_tmp/business-worker-first";grep -q '"dispatch": false' "$business_tmp/worker-second"
echo 'PASS BUSINESS-C4: independent workers cannot claim the same Business delivery twice'
business_case=C5
business_first business-disable-first "$(business_event 9825 CONNECTION_DISABLED 43)"
business_reserve="select public.private_beta_reserve_v1('$(business_id 9825 2000)','$(business_id 9825 3000)',r.id,repeat('c',64),repeat('d',64),a.last_inbound_id,'0.50128',a.conversation_id)from public.agent_runs r join private.private_beta_participants a on a.tenant_id=r.tenant_id and a.conversation_id=(select conversation_id from public.agent_tasks where id=r.task_id)where r.tenant_id='$(business_id 9825 2000)';"
business_sql -c "begin;set local application_name='business-after-disable-reserve';set local statement_timeout='8s';$business_reserve commit;" >"$business_tmp/after-disable-reserve" 2>&1 &
business_second=$!;business_wait business-after-disable-reserve Lock;wait "$business_first_pid";if wait "$business_second";then exit 1;fi
grep -q 55000 "$business_tmp/after-disable-reserve"
test "$(business_sql -c "select request_count from private.private_beta_programs where id='$(business_id 9825 3000)'")" = 1
echo 'PASS BUSINESS-C5: committed permission loss fences concurrent reservation without another model attempt'
business_case=C6
business_first business-atomic-crash "$(business_event 9826 HUMAN_REPLY 44)" 20
business_sql -c "select pg_terminate_backend(pid)from pg_stat_activity where datname=current_database()and application_name='business-atomic-crash';" >"$business_tmp/terminated"
if wait "$business_first_pid";then exit 1;fi
test "$(business_sql -c "select count(*)from private.private_beta_business_events where program_id='$(business_id 9826 3000)'and kind='HUMAN_REPLY'")" = 0
test "$(business_sql -c "select runtime_mode::text from public.conversations where tenant_id='$(business_id 9826 2000)'")" = AI_ACTIVE
test "$(business_sql -c "select count(*)from public.messages where tenant_id='$(business_id 9826 2000)'and actor_id='private-beta-telegram-human-observed'")" = 0
business_sql -c "$(business_event 9826 HUMAN_REPLY 44)" >"$business_tmp/crash-recovered"
test "$(business_sql -c "select count(*)from private.private_beta_business_events where program_id='$(business_id 9826 3000)'and kind='HUMAN_REPLY'")" = 1
echo 'PASS BUSINESS-C6: actual backend termination atomically rolls back callback, ownership, observed message and review; recovery commits once'
business_case=C7
business_hold="select public.private_beta_business_transport_hold_v1('$(business_id 9827 2000)','$(business_id 9827 3000)',(select id from public.messages where tenant_id='$(business_id 9827 2000)'and idempotency_key='business-concurrency-draft'),'PERMISSION_READ_UNVERIFIED');"
business_first business-read-hold "$business_hold"
business_sql -c "begin;set local application_name='business-after-hold-begin';set local statement_timeout='8s';select public.private_beta_begin_v1('$(business_id 9827 2000)','$(business_id 9827 3000)',(select attempt_id from private.private_beta_attempt_scope where program_id='$(business_id 9827 3000)'and scope='FOUNDER'),'$(business_id 9827 5000)');commit;" >"$business_tmp/after-hold-begin" 2>&1 &
business_second=$!;business_wait business-after-hold-begin Lock;wait "$business_first_pid";if wait "$business_second";then exit 1;fi
grep -q 40001 "$business_tmp/after-hold-begin"
test "$(business_sql -c "select count(*)from private.polat_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id='$(business_id 9827 3000)'and s.scope='FOUNDER'and e.stage='DISPATCH_STARTED'")" = 0
test "$(business_sql -c "select request_count from private.private_beta_programs where id='$(business_id 9827 3000)'")" = 2
test "$(business_sql -c "select count(*)from public.message_delivery_attempts where tenant_id in(select id from public.tenants where slug in('private-beta-fixture-9821','private-beta-fixture-9822','private-beta-fixture-9823','private-beta-fixture-9824','private-beta-fixture-9825','private-beta-fixture-9826','private-beta-fixture-9827'))")" = 0
echo 'PASS BUSINESS-C7: permission-read uncertainty fences reserved AI start while preserving its consumed request/liability; no external dispatch evidence invented'
