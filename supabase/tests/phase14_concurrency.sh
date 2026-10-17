#!/usr/bin/env bash
set -euo pipefail
phase14_db_url="$1"
phase14_dir=$(mktemp -d)
trap 'rm -rf "$phase14_dir"' EXIT
psql "$phase14_db_url" -q -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users(id,email,raw_user_meta_data) values('e1400000-0000-4000-8000-000000000001','phase14-concurrency@example.test','{}');
insert into public.tenants(id,name,slug) values('e1400000-0000-4000-8000-000000000002','Synthetic Phase14 concurrency','phase14-sandbox-concurrency');
insert into public.tenant_members(tenant_id,user_id,role) values('e1400000-0000-4000-8000-000000000002','e1400000-0000-4000-8000-000000000001','manager');
select public.configure_phase14_sandbox('e1400000-0000-4000-8000-000000000002',true,true);
insert into public.survey_versions(id,tenant_id,survey_id,version,definition,owner_id,public_key) values('e1400000-0000-4000-8000-000000000003','e1400000-0000-4000-8000-000000000002','e1400000-0000-4000-8000-000000000004',1,'{"title":"Synthetic concurrency survey","language":"en","audience":"ALL","trigger":"REQUESTED","privacy":"ANONYMOUS","questions":[{"id":"q1","type":"RATING","topic":"VALUE","label":"Value?","choices":[]},{"id":"q2","type":"RATING","topic":"SUPPORT","label":"Support?","choices":[]},{"id":"q3","type":"RATING","topic":"SIGNAL","label":"Clarity?","choices":[]},{"id":"q4","type":"RATING","topic":"RENEWAL","label":"Renewal?","choices":[]}]}','e1400000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000005');
SQL
approve="set role authenticated;select set_config('request.jwt.claim.sub','e1400000-0000-4000-8000-000000000001',false);select public.admin_survey_state('e1400000-0000-4000-8000-000000000002','e1400000-0000-4000-8000-000000000003',1,'approve');"
set +e
psql "$phase14_db_url" -q -v ON_ERROR_STOP=1 -c "$approve" >"$phase14_dir/approve1" 2>&1 & p1=$!
psql "$phase14_db_url" -q -v ON_ERROR_STOP=1 -c "$approve" >"$phase14_dir/approve2" 2>&1 & p2=$!
wait "$p1"; r1=$?; wait "$p2"; r2=$?
set -e
test "$(( (r1==0) + (r2==0) ))" = 1
psql "$phase14_db_url" -q -v ON_ERROR_STOP=1 -c "set role authenticated;select set_config('request.jwt.claim.sub','e1400000-0000-4000-8000-000000000001',false);select public.admin_survey_state('e1400000-0000-4000-8000-000000000002','e1400000-0000-4000-8000-000000000003',2,'publish');" >/dev/null
complete="select public.survey_complete_anonymous('e1400000-0000-4000-8000-000000000005',repeat('a',64),now()+interval '10 minutes','[{\"question\":\"q1\",\"skipped\":false,\"value\":5},{\"question\":\"q2\",\"skipped\":true,\"value\":null},{\"question\":\"q3\",\"skipped\":true,\"value\":null},{\"question\":\"q4\",\"skipped\":true,\"value\":null}]');"
psql "$phase14_db_url" -q -v ON_ERROR_STOP=1 -c "$complete" >"$phase14_dir/complete1" & p1=$!
psql "$phase14_db_url" -q -v ON_ERROR_STOP=1 -c "$complete" >"$phase14_dir/complete2" & p2=$!
wait "$p1";wait "$p2"
test "$(psql "$phase14_db_url" -Atqc "select count(*) from private.survey_anonymous_responses where tenant_id='e1400000-0000-4000-8000-000000000002'")" = 1
test "$(psql "$phase14_db_url" -Atqc "select count(*) from private.survey_spent_permits where version_id='e1400000-0000-4000-8000-000000000003'")" = 1
psql "$phase14_db_url" -q -v ON_ERROR_STOP=1 -c "select private.survey_enqueue('e1400000-0000-4000-8000-000000000002','e1400000-0000-4000-8000-000000000003',date_trunc('month',now())::date)" >/dev/null
psql "$phase14_db_url" -q -v ON_ERROR_STOP=1 -c "select public.process_survey_jobs('e1400000-0000-4000-8000-000000000002')" >"$phase14_dir/worker1" & p1=$!
psql "$phase14_db_url" -q -v ON_ERROR_STOP=1 -c "select public.process_survey_jobs('e1400000-0000-4000-8000-000000000002')" >"$phase14_dir/worker2" & p2=$!
wait "$p1";wait "$p2"
test "$(psql "$phase14_db_url" -Atqc "select count(*) from public.scheduled_jobs where tenant_id='e1400000-0000-4000-8000-000000000002' and status='completed' and attempts=1")" = 1
policy="set role authenticated;select set_config('request.jwt.claim.sub','e1400000-0000-4000-8000-000000000001',false);select public.admin_survey_policy('e1400000-0000-4000-8000-000000000002','{\"legal_hold\":true,\"legal_hold_reference\":\"SYNTHETIC concurrent hold\"}',1);"
set +e
psql "$phase14_db_url" -q -v ON_ERROR_STOP=1 -c "$policy" >"$phase14_dir/policy1" 2>&1 & p1=$!
psql "$phase14_db_url" -q -v ON_ERROR_STOP=1 -c "$policy" >"$phase14_dir/policy2" 2>&1 & p2=$!
wait "$p1";r1=$?;wait "$p2";r2=$?
set -e
test "$(( (r1==0) + (r2==0) ))" = 1
psql "$phase14_db_url" -q -v ON_ERROR_STOP=1 -c "select public.configure_phase14_sandbox('e1400000-0000-4000-8000-000000000002',false);update public.tenants set status='suspended' where id='e1400000-0000-4000-8000-000000000002';update public.tenant_members set status='disabled' where tenant_id='e1400000-0000-4000-8000-000000000002';" >/dev/null
echo 'PASS: concurrent version approval, anonymous single completion, unlinked permit uniqueness, SKIP LOCKED worker, revision-fenced legal hold and fixture shutdown'
