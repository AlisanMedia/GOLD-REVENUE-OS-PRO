#!/usr/bin/env bash
set -euo pipefail
beta_db="${1:?DISPOSABLE_PG17_REQUIRED}"
[[ "$beta_db" =~ ^postgresql://[A-Za-z0-9_]+(:[A-Za-z0-9._~-]+)?@127\.0\.0\.1:[0-9]{1,5}/[A-Za-z0-9_]+$ ]] || exit 1
beta_root=$(cd "$(dirname "$0")" && pwd)
beta_tmp=$(mktemp -d); beta_created=false; beta_case=SETUP
beta_sql(){ psql "$beta_db" -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@"; }
beta_id(){ printf '9b00%s-0000-4000-8000-%012d' "$2" "$1"; }
beta_cleanup(){ local status=$?; for pid in $(jobs -pr); do kill "$pid" 2>/dev/null || true; done
 if test "$beta_created" = true; then beta_sql -c "update private.private_beta_programs set stage='STOPPED',generation=generation+1 where tenant_id in(select id from public.tenants where slug in('private-beta-fixture-9501','private-beta-fixture-9502','private-beta-fixture-9503','private-beta-fixture-9504','private-beta-fixture-9505','private-beta-fixture-9506','private-beta-fixture-9507'));update public.tenants set status='suspended'where slug in('private-beta-fixture-9501','private-beta-fixture-9502','private-beta-fixture-9503','private-beta-fixture-9504','private-beta-fixture-9505','private-beta-fixture-9506','private-beta-fixture-9507');" >/dev/null || status=1;fi
 if test "$status" = 0;then rm -rf "$beta_tmp";else echo "PRIVATE_BETA_CONCURRENCY_FAILED: $beta_case; original bounded test diagnostics retained at $beta_tmp" >&2;fi;exit "$status"; }
trap beta_cleanup EXIT
test "$(beta_sql -c "select current_setting('server_version_num')::int/10000")" = 17
test "$(beta_sql -c "select count(*)from public.tenants where id='$(beta_id 9501 2000)'")" = 0
{ printf 'begin;\n'; cat "$beta_root/helpers/private_beta_uat_fixtures.sql"; cat <<'SQL'
select pg_temp.beta_setup(9501);select pg_temp.beta_setup(9502);select pg_temp.beta_setup(9503);select pg_temp.beta_setup(9504);select pg_temp.beta_setup(9505);select pg_temp.beta_setup(9506);select pg_temp.beta_setup(9507);
do $$declare n integer;begin for n in 9501..9505 loop perform pg_temp.beta_account(n);perform pg_temp.beta_auth(n);perform public.admin_private_beta_transition_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),'CANARY',1);end loop;end;$$;
select pg_temp.beta_enroll(9506);select pg_temp.beta_enroll(9507);
do $$declare i integer;rid uuid;r jsonb;mid uuid;begin
 for i in 1..9 loop
  rid:=case when i=1 then pg_temp.beta_id(9506,'8000')else pg_temp.beta_next_source(9506,i)end;
  select(payload->>'message_id')::uuid into mid from public.domain_events where id=(select source_event_id from public.agent_tasks where id=(select task_id from public.agent_runs where id=rid));
  r:=public.private_beta_reserve_v1(pg_temp.beta_id(9506,'2000'),pg_temp.beta_id(9506,'3000'),rid,private.fse_hash(rid::text),repeat('b',64),mid,'0.50128',(select conversation_id from private.private_beta_participants where program_id=pg_temp.beta_id(9506,'3000')));
  perform public.private_beta_begin_v1(pg_temp.beta_id(9506,'2000'),pg_temp.beta_id(9506,'3000'),(r->>'attempt_id')::uuid,rid);
  perform public.private_beta_record_v1(pg_temp.beta_id(9506,'2000'),pg_temp.beta_id(9506,'3000'),(r->>'attempt_id')::uuid,rid,pg_temp.beta_outcome()::text);
 end loop;
 perform pg_temp.beta_next_source(9506,10);
end;$$;
commit;
SQL
} | beta_sql >"$beta_tmp/setup" 2>&1
beta_created=true
beta_reserve(){ local n="$1";local run="${2:-$(beta_id "$1" 4000)}";local source="null";local conversation="'$(beta_id "$n" 4001)'";local hash="repeat('a',64)"
 if test "$n" -ge 9506;then source="(select(e.payload->>'message_id')::uuid from public.agent_runs r join public.agent_tasks t on t.id=r.task_id join public.domain_events e on e.id=t.source_event_id where r.id='$run')";conversation="(select conversation_id from private.private_beta_participants where program_id='$(beta_id "$n" 3000)')";hash="private.fse_hash('$run')";fi
 printf "select public.private_beta_reserve_v1('%s','%s','%s',%s,repeat('b',64),%s,'0.50128',%s);" "$(beta_id "$n" 2000)" "$(beta_id "$n" 3000)" "$run" "$hash" "$source" "$conversation"; }
beta_begin(){ local n="$1";local nonce="${2:-$(beta_id "$1" 5000)}";printf "select public.private_beta_begin_v1('%s','%s',(select attempt_id from private.private_beta_attempt_scope where program_id='%s'order by global_ordinal desc limit 1),'%s');" "$(beta_id "$n" 2000)" "$(beta_id "$n" 3000)" "$(beta_id "$n" 3000)" "$nonce"; }
beta_wait(){ local app="$1";local kind="$2";for check in $(seq 1 100);do if test "$(beta_sql -c "select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='$app'and wait_event_type='$kind')")" = t;then return 0;fi;sleep .01;done;return 1; }
beta_first(){ local app="$1";local command="$2";local delay="$3";beta_sql >"$beta_tmp/$app" 2>&1 <<SQL &
begin;set local application_name='$app';$command select pg_sleep($delay);commit;
SQL
 beta_first_pid=$!;beta_wait "$app" Timeout; }
beta_case=C1
beta_command=$(beta_reserve 9501);beta_first beta-replay-first "$beta_command" 3
beta_pid_a=$(beta_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='beta-replay-first'")
test "$(beta_sql -c "select request_count from private.private_beta_programs where id='$(beta_id 9501 3000)'")" = 0
beta_sql -c "begin;set local application_name='beta-replay-second';set local statement_timeout='8s';$beta_command commit;" >"$beta_tmp/replay-second" 2>&1 &
beta_second=$!;beta_wait beta-replay-second Lock;beta_pid_b=$(beta_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='beta-replay-second'")
test -n "$beta_pid_a";test -n "$beta_pid_b";test "$beta_pid_a" != "$beta_pid_b";wait "$beta_first_pid";wait "$beta_second"
test "$(beta_sql -c "select request_count from private.private_beta_programs where id='$(beta_id 9501 3000)'")" = 1
echo 'PASS BETA-C1: distinct PostgreSQL backend PIDs, actual row-lock wait, precommit invisibility; identical reserve commits once'
beta_case=C2
beta_first beta-cap-first "$(beta_reserve 9502)" 3
beta_sql -c "begin;set local application_name='beta-cap-second';set local statement_timeout='8s';$(beta_reserve 9502 "$(beta_id 999 4000)")commit;" >"$beta_tmp/cap-second" 2>&1 &
beta_second=$!;beta_wait beta-cap-second Lock;wait "$beta_first_pid";if wait "$beta_second";then exit 1;fi;grep -q 54000 "$beta_tmp/cap-second"
test "$(beta_sql -c "select request_count::text||':'||reserved_liability::text from private.private_beta_programs where id='$(beta_id 9502 3000)'")" = '1:0.50128'
echo 'PASS BETA-C2: concurrent distinct canaries cannot exceed the single initiated request or exact liability reservation'
beta_case=C3
beta_first beta-crash "$(beta_reserve 9503)" 20
beta_sql -c "select pg_terminate_backend(pid)from pg_stat_activity where datname=current_database()and application_name='beta-crash'" >"$beta_tmp/killed"
if wait "$beta_first_pid";then exit 1;fi
test "$(beta_sql -c "select request_count from private.private_beta_programs where id='$(beta_id 9503 3000)'")" = 0
test "$(beta_sql -c "select count(*)from private.private_beta_attempt_scope where program_id='$(beta_id 9503 3000)'")" = 0
test "$(beta_sql -c "select count(*)from public.audit_logs where tenant_id='$(beta_id 9503 2000)'and action='private_beta.attempt_reserved'")" = 0
beta_sql -c "$(beta_reserve 9503)$(beta_begin 9503)" >"$beta_tmp/recovered"
beta_sql -c "$(beta_begin 9503)" >"$beta_tmp/lost-ack"
grep -q '"dispatch": false' "$beta_tmp/lost-ack"
echo 'PASS BETA-C3: actual backend death rolls back reservation/scope/counters/audit; lost committed start acknowledgement never permits resend'
beta_case=C4
beta_sql -c "$(beta_reserve 9504)" >"$beta_tmp/reserved"
beta_first beta-start-first "$(beta_begin 9504)" 3
beta_sql -c "begin;set local application_name='beta-start-second';set local statement_timeout='8s';$(beta_begin 9504 "$(beta_id 999 5000)")commit;" >"$beta_tmp/start-second" 2>&1 &
beta_second=$!;beta_wait beta-start-second Lock;wait "$beta_first_pid";wait "$beta_second";grep -q '"dispatch": false' "$beta_tmp/start-second"
test "$(beta_sql -c "select count(*)from private.polat_experiment_evidence where run_id=(select canary_run_id from private.private_beta_programs where id='$(beta_id 9504 3000)')and stage='DISPATCH_STARTED'")" = 1
echo 'PASS BETA-C4: independent workers receive exactly one dispatch start and the second nonce has no completion authority'
beta_case=C5
beta_sql -c "$(beta_reserve 9505)" >"$beta_tmp/stop-reserved"
beta_first beta-stop-first "update private.private_beta_programs set stage='STOPPED',generation=generation+1 where id='$(beta_id 9505 3000)';" 3
beta_sql -c "begin;set local application_name='beta-stop-second';set local statement_timeout='8s';$(beta_begin 9505)commit;" >"$beta_tmp/stop-second" 2>&1 &
beta_second=$!;beta_wait beta-stop-second Lock;wait "$beta_first_pid";if wait "$beta_second";then exit 1;fi;grep -q 55000 "$beta_tmp/stop-second"
test "$(beta_sql -c "select count(*)from private.polat_experiment_evidence where run_id=(select canary_run_id from private.private_beta_programs where id='$(beta_id 9505 3000)')and stage='DISPATCH_STARTED'")" = 0
echo 'PASS BETA-C5: committed program stop wins against reserved dispatch without releasing unknown liability or inventing an external effect'
beta_case=C6
beta_next=$(beta_id 950610 8000);beta_command=$(beta_reserve 9506 "$beta_next")
if beta_sql -c "$beta_command" >"$beta_tmp/before-settlement" 2>&1;then exit 1;fi;grep -q 54000 "$beta_tmp/before-settlement"
beta_settle="select private.private_beta_reconcile_attempt('$(beta_id 9506 2000)','$(beta_id 9506 3000)',s.attempt_id,jsonb_build_object('version',1,'origin','INDEPENDENT_PROVIDER_BILLING','coverage','COMPLETE_REQUEST_CHARGE','account_scope_hash',p.account_control->>'account_scope_hash','request_hash',a.request_hash,'actual_billed_amount','0.000025','currency','USD','source_hash',repeat('d',64),'observed_at',clock_timestamp())::text)from private.private_beta_programs p join private.private_beta_attempt_scope s on s.program_id=p.id join private.polat_experiment_attempts a on a.id=s.attempt_id where p.id='$(beta_id 9506 3000)'and s.participant_ordinal=1;"
beta_first beta-settle-first "$beta_settle" 3
beta_sql -c "begin;set local application_name='beta-settle-second';set local statement_timeout='8s';$beta_command commit;" >"$beta_tmp/settle-second" 2>&1 &
beta_second=$!;beta_wait beta-settle-second Lock;wait "$beta_first_pid";wait "$beta_second"
test "$(beta_sql -c "select private.private_beta_exposure('$(beta_id 9506 3000)')<=5")" = t
test "$(beta_sql -c "select reserved_liability>5 and request_count=11 from private.private_beta_programs where id='$(beta_id 9506 3000)'")" = t
echo 'PASS BETA-C6: reserve waits for independent complete billing settlement; current risk remains<=5USD while immutable gross reservations exceed5; no release from estimates'
beta_case=C7
beta_sql -c "$(beta_reserve 9507 "$(beta_id 9507 8000)")" >"$beta_tmp/human-reserved"
beta_first beta-human-first "update public.conversations set runtime_mode='HUMAN_TAKEOVER',human_takeover=true,automatic_replies_enabled=false where tenant_id='$(beta_id 9507 2000)';" 3
beta_sql -c "begin;set local application_name='beta-human-second';set local statement_timeout='8s';$(beta_begin 9507)commit;" >"$beta_tmp/human-second" 2>&1 &
beta_second=$!;beta_wait beta-human-second Lock;wait "$beta_first_pid";if wait "$beta_second";then exit 1;fi;grep -q 40001 "$beta_tmp/human-second"
echo 'PASS BETA-C7: real independent human ownership transaction fences the previously reserved AI source before dispatch'
beta_case=C8
if test "$(beta_sql -c "select to_regprocedure('public.claim_private_beta_tasks_v1(uuid,uuid,text)')is not null")" = t;then
 beta_sql >"$beta_tmp/order-worker" 2>&1 <<SQL &
begin;set local application_name='beta-order-worker';set local statement_timeout='10s';select 1 from private.private_beta_programs where id='$(beta_id 9507 3000)'for update;select pg_sleep(2);select 1 from public.conversations where tenant_id='$(beta_id 9507 2000)'for update;commit;
SQL
 beta_order_worker=$!;beta_wait beta-order-worker Timeout
 beta_sql >"$beta_tmp/order-inbound" 2>&1 <<SQL &
begin;set local application_name='beta-order-inbound';set local statement_timeout='10s';select 1 from public.conversations where tenant_id='$(beta_id 9507 2000)'for update;select pg_sleep(3);select public.ingest_telegram_message('$(beta_id 9507 2000)','private-beta-lock-order-9507','5000','5009507','5009507',null,null,null,'Fictional UAT inbound while a worker holds the program lock.',null,clock_timestamp());commit;
SQL
 beta_order_inbound=$!;beta_wait beta-order-inbound Timeout;beta_wait beta-order-worker Lock
 beta_pid_a=$(beta_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='beta-order-worker'")
 beta_pid_b=$(beta_sql -c "select pid from pg_stat_activity where datname=current_database()and application_name='beta-order-inbound'")
 test -n "$beta_pid_a";test -n "$beta_pid_b";test "$beta_pid_a" != "$beta_pid_b";wait "$beta_order_inbound";wait "$beta_order_worker"
 test "$(beta_sql -c "select count(*)from public.messages where tenant_id='$(beta_id 9507 2000)'and idempotency_key='telegram:update:private-beta-lock-order-9507'")" = 1
 test "$(beta_sql -c "select count(*)from public.agent_tasks t join public.domain_events e on e.tenant_id=t.tenant_id and e.id=t.source_event_id join public.messages m on m.tenant_id=e.tenant_id and m.id::text=e.payload->>'message_id'where t.tenant_id='$(beta_id 9507 2000)'and m.idempotency_key='telegram:update:private-beta-lock-order-9507'and t.task_type='private_beta.reply'and t.status='CANCELLED'and t.failure_code='HUMAN_OWNS_SOURCE'")" = 1
 echo 'PASS BETA-C8: independent inbound holds conversation while worker holds program and waits; source capture commits without lock inversion and retains human-owned inbound evidence'
 beta_case=C9
 { printf 'begin;\n';cat "$beta_root/helpers/private_beta_uat_fixtures.sql";cat <<'SQL'
select pg_temp.beta_friend_for_claim(9507);
update public.agent_tasks set status='SUCCEEDED',completed_at=clock_timestamp()where tenant_id=pg_temp.beta_id(9507,'2000')and status='RUNNING';
update public.agent_runs set status='SUCCEEDED',completed_at=clock_timestamp()where tenant_id=pg_temp.beta_id(9507,'2000')and status='RUNNING';
select set_config('request.jwt.claims','{"role":"service_role"}',true);select set_config('request.jwt.claim.role','service_role',true);
update public.conversations set runtime_mode='AI_ACTIVE',human_takeover=false,automatic_replies_enabled=true,automatic_replies_enabled_at=clock_timestamp()where tenant_id=pg_temp.beta_id(9507,'2000')and id=(select conversation_id from private.private_beta_participants where program_id=pg_temp.beta_id(9507,'3000')and kind='FOUNDER');
select public.ingest_telegram_message(pg_temp.beta_id(9507,'2000'),'private-beta-claim-9507','5001','5009507','5009507',null,null,null,'A fresh fictional founder question for queue fairness.',null,clock_timestamp());
commit;
SQL
 } | beta_sql >"$beta_tmp/claim-setup" 2>&1
 beta_requests_before=$(beta_sql -c "select request_count from private.private_beta_programs where id='$(beta_id 9507 3000)'")
 beta_first beta-claim-first "select count(*)from public.claim_private_beta_tasks_v1('$(beta_id 9507 2000)',(select conversation_id from private.private_beta_participants where program_id='$(beta_id 9507 3000)'and kind='FOUNDER'),'beta-claim-worker-a');" 3
 beta_sql -c "begin;set local application_name='beta-claim-second';set local statement_timeout='8s';select count(*)from public.claim_private_beta_tasks_v1('$(beta_id 9507 2000)',(select conversation_id from private.private_beta_participants where program_id='$(beta_id 9507 3000)'and kind='FRIEND'),'beta-claim-worker-b');commit;" >"$beta_tmp/claim-second" 2>&1 &
 beta_second=$!;beta_wait beta-claim-second Lock;wait "$beta_first_pid";wait "$beta_second"
 grep -qx '1' "$beta_tmp/beta-claim-first";grep -qx '0' "$beta_tmp/claim-second"
 test "$(beta_sql -c "select count(*)from public.agent_tasks where tenant_id='$(beta_id 9507 2000)'and task_type='private_beta.reply'and status='RUNNING'")" = 1
 test "$(beta_sql -c "select count(*)from public.agent_tasks where tenant_id='$(beta_id 9507 2000)'and conversation_id=(select conversation_id from private.private_beta_participants where program_id='$(beta_id 9507 3000)'and kind='FRIEND')and task_type='private_beta.reply'and status='QUEUED'")" = 1
 test "$(beta_sql -c "select request_count from private.private_beta_programs where id='$(beta_id 9507 3000)'")" = "$beta_requests_before"
 echo 'PASS BETA-C9: independent workers claim different invited conversations; one owns RUNNING, busy source stays QUEUED and no extra request/liability is reserved'
else
 echo 'NOT_TESTED BETA-C8/C9: native UAT migration is absent in this core-only disposable database; full Database CI must run both'
fi
test "$(beta_sql -c "select count(*)from private.verified_payment_receipts where tenant_id in(select id from public.tenants where slug like 'private-beta-fixture-950%')")" = 0
echo 'PASS BETA invariants: zero real inference, billing, Telegram, financial receipts, subscription/VIP or deployment effects; only synthetic fixture evidence retained'
