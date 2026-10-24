begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions,pg_catalog;
select no_plan();
\ir helpers/polat_inbound_fixtures.sql
select pg_temp.polat_setup(4501);select pg_temp.polat_setup(4502);
select private.polat_configure_runtime_fixture(pg_temp.polat_id(4501,'2000'),pg_temp.polat_conv(4501));
create function pg_temp.model_summary(n integer)returns jsonb language sql stable as $$select public.admin_polat_model_summary_v1(pg_temp.polat_id(n,'2000'),current_date,current_date+1)$$;
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);
select is(pg_temp.model_summary(4501)->>'count','0','empty fixture has a known zero invocation count');
select is(pg_temp.model_summary(4501)#>>'{billing,coverage}',null,'empty billing denominator is unavailable');
select is(pg_temp.model_summary(4501)#>>'{tokens,input}',null,'no token source stays unknown');
select is(pg_temp.model_summary(4501)#>>'{latency,p95_ms}',null,'no latency sample stays unknown');
select ok((pg_temp.model_summary(4501)->>'complete')::boolean,'empty bounded snapshot is complete');
create function pg_temp.model_seed(n integer,k integer,status_value text default 'SUCCEEDED')returns void language plpgsql as $$
declare t uuid:=pg_temp.polat_id(n,'2000');v public.agent_versions;task uuid:=extensions.gen_random_uuid();run uuid:=extensions.gen_random_uuid();begin
 select av.* into strict v from public.agent_versions av join private.polat_runtime_profiles p on p.tenant_id=av.tenant_id and p.agent_version_id=av.id where p.tenant_id=t;
 insert into public.agent_tasks(id,tenant_id,agent_definition_id,agent_version_id,conversation_id,task_type,objective,execution_mode,idempotency_key,correlation_id)
 values(task,t,v.agent_definition_id,v.id,pg_temp.polat_conv(n),'conversation','Synthetic telemetry only','SHADOW','model-readiness-'||k,extensions.gen_random_uuid());
 insert into public.agent_runs(id,tenant_id,task_id,agent_version_id,attempt_number,execution_mode,worker_id,model_provider,model_name,context_manifest,billed_amount,billed_currency)
 values(run,t,task,v.id,1,'SHADOW','fixture-only','mock','polat-test-runtime-v1','{"polat_fixture_policy":"polat-ai-fixture-v2","PRIVATE_SECRET":"never project"}',99,'USD');
 insert into public.model_invocations(tenant_id,run_id,provider,model,status,latency_ms,request_fingerprint,error_code)
 values(t,run,'mock','polat-test-runtime-v1',status_value,k,repeat('a',64),'PRIVATE_ERROR_NOT_FOR_UI');
end;$$;
select pg_temp.model_seed(4501,1);select pg_temp.model_seed(4501,2,'TIMED_OUT');select pg_temp.model_seed(4501,3,'INVALID_OUTPUT');
select is(pg_temp.model_summary(4501)->>'count','3','only actual model_invocations are counted');
select is(pg_temp.model_summary(4501)->>'success','1','success does not imply QA approval or delivery');
select is(pg_temp.model_summary(4501)->>'errors','2','timeouts and invalid output remain errors');
select is(pg_temp.model_summary(4501)->>'timeouts','1','timeout measured independently');
select is(pg_temp.model_summary(4501)->>'invalid_output','1','invalid output measured independently');
select is(pg_temp.model_summary(4501)#>>'{latency,p50_ms}','2','ordered observed median');
select is(pg_temp.model_summary(4501)#>>'{latency,p95_ms}','3','observed discrete p95');
select is(pg_temp.model_summary(4501)#>>'{tokens,input}',null,'missing usage is not zero');
select is(pg_temp.model_summary(4501)#>>'{billing,known}','0','agent-run billing is never counted again');
select is((pg_temp.model_summary(4501)#>>'{billing,coverage}')::numeric,0::numeric,'known sample with zero billing coverage is distinct from zero cost');
select is(pg_temp.model_summary(4501)#>>'{billing,amount}',null,'no genuine cost is invented');
select is(pg_temp.model_summary(4501)->>'time_to_first_response_ms',null,'nonstreaming duration is not first-token timing');
select is(pg_temp.model_summary(4501)#>>'{versions,0,persona}','polat-ai-fixture-v2','observed persona version from native context manifest');
select is(pg_temp.model_summary(4501)->>'financial_authority','NONE','summary grants no authority');
select ok(not(pg_temp.model_summary(4501)::text~'PRIVATE|request_fingerprint|provider_request_id|tenant_id|run_id|structured_output|lease_token'),'no source, scope, raw error or secret serialization');
select throws_ok($$select public.admin_polat_model_summary_v1('ffffffff-0000-4000-8000-000000000001',current_date,current_date+1)$$,'42501',null,'foreign tenant denied uniformly');
select throws_ok($$select public.admin_polat_model_summary_v1(pg_temp.polat_id(4501,'2000'),current_date,current_date+91)$$,'22023',null,'window bounded at 90 days');
select throws_ok($$select public.admin_polat_model_summary_v1(pg_temp.polat_id(4501,'2000'),null,current_date+1)$$,'22023',null,'null window rejected');
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000002',true);
select is(pg_temp.model_summary(4501)#>>'{billing,status}','ROLE_RESTRICTED','support cannot see cost evidence');
select is(pg_temp.model_summary(4501)#>>'{billing,coverage}',null,'support cost coverage redacted at SQL boundary');
select is(pg_temp.model_summary(4501)->>'count','3','support retains safe operational evidence');
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000003',true);
select lives_ok($$select pg_temp.model_summary(4501)$$,'analyst can read safe telemetry');
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000004',true);
select throws_ok($$select pg_temp.model_summary(4501)$$,'42501',null,'readonly denied');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select pg_temp.model_summary(4501)$$,'42501',null,'no membership denied');
select ok(not has_function_privilege('service_role','public.admin_polat_model_summary_v1(uuid,date,date)','EXECUTE'),'no new service privilege');
select ok(not has_function_privilege('anon','public.admin_polat_model_summary_v1(uuid,date,date)','EXECUTE'),'anonymous cannot invoke');
select is((select provolatile::text from pg_proc where oid='public.admin_polat_model_summary_v1(uuid,date,date)'::regprocedure),'s','read uses one stable statement snapshot');
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);
do $$begin for n in 4..1005 loop perform pg_temp.model_seed(4501,n);end loop;end;$$;
select is(pg_temp.model_summary(4501)->>'count','1000','large source independently bounded');
select ok(not(pg_temp.model_summary(4501)->>'complete')::boolean,'lookahead declares incompleteness');
select is(pg_temp.model_summary(4501)#>>'{latency,p95_ms}',null,'partial period cannot claim full latency');
select is(pg_temp.model_summary(4501)#>>'{billing,coverage}',null,'partial billing denominator unavailable');
select ok(octet_length(pg_temp.model_summary(4501)::text)<5000,'response remains bounded');
select is((select count(*)from private.verified_payment_receipts where tenant_id=pg_temp.polat_id(4501,'2000')),0::bigint,'no financial writer');
select is((select count(*)from public.messages where tenant_id=pg_temp.polat_id(4501,'2000')and direction='outbound'),0::bigint,'no real customer outbound');
select is((select count(*)from public.subscriptions where tenant_id=pg_temp.polat_id(4501,'2000')),0::bigint,'no subscription activation');
do $$declare started timestamptz:=clock_timestamp();v jsonb;plan jsonb;body text;begin
 v:=pg_temp.model_summary(4501);raise notice 'POLAT_MODEL_MEASUREMENT %',jsonb_build_object('classification','SYNTHETIC','invocations',1005,'sample',v->'count','complete',v->'complete','response_bytes',octet_length(v::text),'elapsed_ms',extract(epoch from(clock_timestamp()-started))*1000);
 body:=pg_get_functiondef('public.admin_polat_model_summary_v1(uuid,date,date)'::regprocedure);
 body:='with source'||split_part(split_part(body,'with source',2),'into result',1)||'from stats cross join quality cross join bounds';
 body:=replace(replace(replace(replace(body,'target_tenant_id',quote_literal(pg_temp.polat_id(4501,'2000'))||'::uuid'),'start_value','current_date'),'end_value','(current_date+1)'),'can_bill','true');
 execute 'explain(analyze,buffers,format json) '||body into plan;raise notice 'POLAT_MODEL_READ_PLAN %',plan;
end;$$;
select * from finish();rollback;
