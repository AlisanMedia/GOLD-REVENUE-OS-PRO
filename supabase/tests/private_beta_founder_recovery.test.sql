-- Load the real temporary read-only backup predicates, before these fixtures.
\o /dev/null
\ir helpers/private_beta_backup_fingerprint.sql
\o
begin;
select no_plan();
\ir helpers/private_beta_openai_fixtures.sql
\ir helpers/private_beta_business_fixtures.sql

-- Disposable PostgreSQL fixtures only: no real metadata, key, provider response,
-- Telegram permission, actual bill or owner acceptance is established here.
create function pg_temp.founder_model_fixture(n integer) returns jsonb language plpgsql as $$
declare p private.private_beta_programs;o jsonb;q jsonb;at_value timestamptz:=clock_timestamp();scope_hash text;key_hash text:=repeat('1',64);begin
 select * into strict p from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');
 scope_hash:=private.fse_hash(private.fse_canonical(jsonb_build_array('OPENAI_PROJECT1','org-fixture-'||n,'proj_fixture_'||n)));
 o:=jsonb_build_object('version',1,'origin','PROTECTED_OPENAI_MODEL_AND_PRICING_OBSERVATION','program_id',p.id,'tenant_id',p.tenant_id,'repository_sha',repeat('e',40),
 'organization_id','org-fixture-'||n,'project_id','proj_fixture_'||n,'credential_sha256',key_hash,'account_scope_hash',scope_hash,
 'credential_custody_hash',private.fse_hash(private.fse_canonical(jsonb_build_array('POLAT_UAT_CREDENTIAL_CUSTODY1',scope_hash,key_hash))),
 'provider','openai','model','gpt-6.1-sol','model_access',true,'model_response_hash',repeat('2',64),'policy_hash',repeat('3',64),'observed_at',at_value,'expires_at',at_value+interval '24 hours');
 q:=(pg_temp.beta_openai_envelope(n)->'pricing')||jsonb_build_object('source_url','https://developers.openai.com/api/docs/models/gpt-6.1-sol',
 'maximum_input_usd_per_million','4.4','maximum_output_usd_per_million','16.5','observed_at',at_value,'expires_at',at_value+interval '24 hours');
 return jsonb_build_object('observation',o,'pricing',q);end;$$;
create function pg_temp.founder_local_setup(n integer) returns void language plpgsql as $$declare p private.private_beta_programs;begin
 perform pg_temp.beta_setup(n);perform pg_temp.beta_auth(n);
 perform public.admin_private_beta_select_openai_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),1);
 select * into strict p from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');
 perform public.admin_private_beta_configure_v1(p.tenant_id,p.id,(p.configuration||jsonb_build_object('repository_sha',null,'starts_at',null,'expires_at',null,'backup_operator',null))::text);
end;$$;
create function pg_temp.founder_local_prepare(n integer) returns void language plpgsql as $$declare p private.private_beta_programs;begin
 perform pg_temp.beta_auth(n);select * into strict p from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');
 perform public.admin_private_beta_prepare_founder_test_v1(p.tenant_id,p.id,p.generation,repeat('e',40));end;$$;
create function pg_temp.founder_local_canary(n integer) returns void language plpgsql as $$declare p private.private_beta_programs;r jsonb;begin
 perform pg_temp.founder_local_prepare(n);select * into strict p from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');
 perform public.admin_private_beta_transition_v1(p.tenant_id,p.id,'CANARY',p.generation);
 r:=public.private_beta_reserve_v1(p.tenant_id,p.id,pg_temp.beta_id(n,'4000'),repeat('a',64),repeat('b',64),null,'4.628448',pg_temp.beta_id(n,'4001'));
 update private_beta_cases set canary=r where private_beta_cases.n=$1;
 perform public.private_beta_begin_v1(p.tenant_id,p.id,(r->>'attempt_id')::uuid,pg_temp.beta_id(n,'5000'));end;$$;
create function pg_temp.founder_local_record(n integer,v jsonb) returns jsonb language sql as $$
 select public.private_beta_record_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),(select(canary->>'attempt_id')::uuid from private_beta_cases where private_beta_cases.n=$1),pg_temp.beta_id(n,'5000'),v::text)
$$;
create function pg_temp.founder_observed_result() returns jsonb language sql as $$
 select pg_temp.beta_outcome()||jsonb_build_object('input_tokens',37,'output_tokens',121)
$$;


-- All following users, grants, models and outcomes are disposable SQL fixtures.
-- They never constitute genuine founder login or provider acceptance.
create function pg_temp.recovery_unknown(n integer) returns void language plpgsql as $$begin
 perform pg_temp.founder_local_setup(n);
 perform private.private_beta_founder_model_record(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),pg_temp.founder_model_fixture(n)::text);
 perform pg_temp.founder_local_canary(n);
 perform pg_temp.founder_local_record(n,pg_temp.beta_outcome('UNKNOWN','RESULT_UNKNOWN','NOT_EVALUATED')||jsonb_build_object('error_code','OPENAI_UAT_RESPONSE_CORRELATION_INVALID'));
end;$$;
create function pg_temp.recovery_observe(n integer) returns void language plpgsql as $$declare v jsonb;begin
 v:=pg_temp.founder_model_fixture(n);v:=jsonb_set(v,'{observation,repository_sha}',to_jsonb(repeat('f',40)));
 perform private.private_beta_founder_model_record(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),v::text);
end;$$;
create function pg_temp.recovery_start(n integer)returns jsonb language plpgsql as $$declare p private.private_beta_programs;begin
 select * into p from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');
 return public.admin_private_beta_recover_founder_test_v1(p.tenant_id,p.id,p.generation,repeat('f',40));end;$$;
-- Backup must distinguish a stopped native journal from a live CANARY window.
select pg_temp.founder_local_setup(6290);
select private.private_beta_founder_model_record(pg_temp.beta_id(6290,'2000'),pg_temp.beta_id(6290,'3000'),pg_temp.founder_model_fixture(6290)::text);
select pg_temp.founder_local_canary(6290);
select throws_ok($q$select pg_temp.private_beta_require_quiescent(pg_temp.beta_id(6290,'3000'))$q$,'P0001','PRIVATE_BETA_RELEASE_REQUIRES_PAUSED_PROGRAMS','even an explicitly selected in-flight canary still blocks backup');
select pg_temp.founder_local_record(6290,pg_temp.beta_outcome('UNKNOWN','RESULT_UNKNOWN','NOT_EVALUATED')||jsonb_build_object('error_code','OPENAI_UAT_TIMEOUT_UNKNOWN'));
select throws_ok($q$select pg_temp.private_beta_require_quiescent(pg_temp.beta_id(6290,'3000'))$q$,'P0001','PRIVATE_BETA_RELEASE_REQUIRES_PAUSED_PROGRAMS','an unrelated UNKNOWN type cannot use correlation recovery backup');
select public.admin_private_beta_transition_v1(pg_temp.beta_id(6290,'2000'),pg_temp.beta_id(6290,'3000'),'STOPPED',(select generation from private.private_beta_programs where id=pg_temp.beta_id(6290,'3000')));
select lives_ok($q$select pg_temp.private_beta_require_quiescent()$q$,'the unchanged default permits stopped programs');
select pg_temp.recovery_unknown(6201);
select throws_ok($q$select pg_temp.private_beta_require_quiescent()$q$,'P0001','PRIVATE_BETA_RELEASE_REQUIRES_PAUSED_PROGRAMS','held correlation canary remains denied without an explicit recovery target');
select throws_ok($q$select pg_temp.private_beta_require_quiescent(pg_temp.beta_id(6290,'3000'))$q$,'P0001','PRIVATE_BETA_RELEASE_REQUIRES_PAUSED_PROGRAMS','a different program ID grants no backup exception');
select lives_ok($q$select pg_temp.private_beta_require_quiescent(pg_temp.beta_id(6201,'3000'))$q$,'only the selected stopped first owner-only correlation canary is quiescent');
select ok((pg_temp.private_beta_snapshot(pg_temp.beta_id(6201,'3000'))#>>'{tables,private.polat_experiment_evidence,rows}')::integer>0,'full snapshot retains the failed canary journal instead of excluding it');
select is((select request_count from private.private_beta_programs where id=pg_temp.beta_id(6201,'3000')),1,'read-only backup eligibility never resets initiated calls');
select is((select reserved_liability from private.private_beta_programs where id=pg_temp.beta_id(6201,'3000')),4.628448::numeric,'read-only backup eligibility retains the complete UNKNOWN liability');
select pg_temp.recovery_unknown(6202);
select throws_ok($q$select pg_temp.private_beta_require_quiescent(pg_temp.beta_id(6201,'3000'))$q$,'P0001','PRIVATE_BETA_RELEASE_REQUIRES_PAUSED_PROGRAMS','the exception never silently includes another non-paused program');
select pg_temp.recovery_unknown(6203);
create temp table recovery_before as select p.id,p.canary_run_id,p.request_count,p.reserved_liability,p.configuration,p.generation,to_jsonb(r) as run_row,
 (select jsonb_agg(to_jsonb(a)order by a.id)from private.polat_experiment_attempts a where a.run_id=r.id)as attempts,
 (select jsonb_agg(to_jsonb(e)order by e.sequence)from private.polat_experiment_evidence e where e.run_id=r.id)as evidence
 from private.private_beta_programs p join private.polat_experiment_runs r on r.id=p.canary_run_id where p.id=pg_temp.beta_id(6201,'3000');
select ok(private.private_beta_recovery_available((select p from private.private_beta_programs p where p.id=pg_temp.beta_id(6201,'3000'))),'exact first correlation UNKNOWN is recoverable');
select ok(not has_function_privilege('service_role','public.admin_private_beta_recover_founder_test_v1(uuid,uuid,bigint,text)','execute'),'service role cannot manufacture owner recovery');
select ok(not has_function_privilege('anon','public.admin_private_beta_recover_founder_test_v1(uuid,uuid,bigint,text)','execute'),'anonymous cannot recover owner test');
select pg_temp.beta_auth(6201);
select throws_ok($q$select pg_temp.recovery_start(6201)$q$,'55000',null,'new real protected model observation must match repaired source');
select lives_ok($q$select pg_temp.recovery_observe(6201)$q$,'protected model refresh can observe the held founder program without resetting it');
select is(public.admin_private_beta_workspace_v1(pg_temp.beta_id(6201,'2000'),25,null)#>>'{program,canary_state}','RECOVERY_AVAILABLE','existing panel shows one recovery after repaired-source observation');
select pg_temp.beta_auth(6201,'owner','aal1');
select throws_ok($q$select pg_temp.recovery_start(6201)$q$,'42501',null,'fresh real MFA is still required');
select pg_temp.beta_auth(6202);
select throws_ok($q$select pg_temp.recovery_start(6201)$q$,'42501',null,'foreign owner cannot recover another tenant');
select pg_temp.beta_auth(6201);
select throws_ok($q$select public.admin_private_beta_recover_founder_test_v1(pg_temp.beta_id(6201,'2000'),pg_temp.beta_id(6201,'3000'),1,repeat('f',40))$q$,'42501',null,'stale generation cannot grant recovery');
select lives_ok($q$select pg_temp.recovery_start(6201)$q$,'owner action creates exactly one additional bounded canary run');
select is((select request_count from private.private_beta_programs where id=pg_temp.beta_id(6201,'3000')),1,'old initiated count never resets');
select is((select reserved_liability from private.private_beta_programs where id=pg_temp.beta_id(6201,'3000')),4.628448::numeric,'historical full reservation never resets');
select is((select configuration->>'starts_at'from private.private_beta_programs where id=pg_temp.beta_id(6201,'3000')),(select configuration->>'starts_at'from recovery_before),'original start remains unchanged');
select is((select configuration->>'expires_at'from private.private_beta_programs where id=pg_temp.beta_id(6201,'3000')),(select configuration->>'expires_at'from recovery_before),'recovery never extends the original deadline');
select is((select account_control->>'provider_billing'from private.private_beta_programs where id=pg_temp.beta_id(6201,'3000')),'UNKNOWN','owner screenshot is not fabricated reconciled billing');
select is((select account_control->>'provider_enforced_cap'from private.private_beta_programs where id=pg_temp.beta_id(6201,'3000')),'UNVERIFIED','external cap is not fabricated');
select is((select account_control->>'version'from private.private_beta_programs where id=pg_temp.beta_id(6201,'3000')),'4','recovery has a distinct native binding protocol');
select is((select to_jsonb(r)from private.polat_experiment_runs r join recovery_before b on r.id=b.canary_run_id),(select run_row from recovery_before),'original held run is byte-for-byte unchanged');
select is((select jsonb_agg(to_jsonb(a)order by a.id)from private.polat_experiment_attempts a join recovery_before b on a.run_id=b.canary_run_id),(select attempts from recovery_before),'original attempt is unchanged');
select is((select jsonb_agg(to_jsonb(e)order by e.sequence)from private.polat_experiment_evidence e join recovery_before b on e.run_id=b.canary_run_id),(select evidence from recovery_before),'original UNKNOWN/audit evidence is unchanged');
select is(private.private_beta_exposure(pg_temp.beta_id(6201,'3000')),4.628448::numeric,'historical UNKNOWN remains in global exposure');
select is(public.private_beta_account_control_v1(pg_temp.beta_id(6201,'2000'),pg_temp.beta_id(6201,'3000'))#>>'{payload,retained_unknown_liability}','4.628448','retained debt is explicit in the server control');
select is(private.private_beta_binding((select p from private.private_beta_programs p where id=pg_temp.beta_id(6201,'3000')),true)->>'maximum_attempt_liability','0.0264704','new request has provider-count-enforced4096 input plus512 output bound');
select is(private.private_beta_binding((select p from private.private_beta_programs p where id=pg_temp.beta_id(6201,'3000')),true)->>'maximum_requests','2','global canary ordinal includes the original consumed attempt');
select throws_ok($q$select pg_temp.recovery_start(6201)$q$,'42501',null,'recovery itself is one-use and cannot be repeated');
create temp table recovery_new as select public.private_beta_reserve_v1(pg_temp.beta_id(6201,'2000'),pg_temp.beta_id(6201,'3000'),pg_temp.beta_id(6201,'4002'),repeat('d',64),repeat('e',64),null,'0.0264704',pg_temp.beta_id(6201,'4003'))as receipt;
select is(private.private_beta_exposure(pg_temp.beta_id(6201,'3000')),4.6549184::numeric,'both original UNKNOWN and new reservation count toward the same5USD cap');
select is((select request_count from private.private_beta_programs where id=pg_temp.beta_id(6201,'3000')),2,'second initiated request increments the preserved global count');
select throws_ok($q$select public.private_beta_reserve_v1(pg_temp.beta_id(6201,'2000'),pg_temp.beta_id(6201,'3000'),pg_temp.beta_id(6201,'4004'),repeat('d',64),repeat('e',64),null,'0.0264704',pg_temp.beta_id(6201,'4005'))$q$,'54000',null,'third canary is denied before dispatch');
select public.private_beta_begin_v1(pg_temp.beta_id(6201,'2000'),pg_temp.beta_id(6201,'3000'),(select(receipt->>'attempt_id')::uuid from recovery_new),pg_temp.beta_id(6201,'5002'));
select lives_ok($q$select public.private_beta_record_v1(pg_temp.beta_id(6201,'2000'),pg_temp.beta_id(6201,'3000'),(select(receipt->>'attempt_id')::uuid from recovery_new),pg_temp.beta_id(6201,'5002'),pg_temp.founder_observed_result()::text)$q$,'new genuine-format outcome still requires actual native QA/usage evidence');
select ok(private.private_beta_founder_canary_hash((select p from private.private_beta_programs p where id=pg_temp.beta_id(6201,'3000')))is not null,'current successful native canary can pass while old failure stays retained');
select is(public.admin_private_beta_workspace_v1(pg_temp.beta_id(6201,'2000'),25,null)#>>'{program,canary_state}','OWNER_TEST_READY','existing founder conversation controls become available after current QA evidence');
select ok(private.private_beta_connection_setup_allowed((select p from private.private_beta_programs p where id=pg_temp.beta_id(6201,'3000'))),'numeric Business setup can continue at the preserved second ordinal');
select ok(private.private_beta_exposure(pg_temp.beta_id(6201,'3000'))>=4.628448,'successful new usage never releases old UNKNOWN debt');
select is((select count(*)::int from private.polat_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id=pg_temp.beta_id(6201,'3000')and e.stage='RECONCILIATION'),0,'no provider bill is fabricated');
select throws_ok($q$select public.admin_private_beta_transition_v1(pg_temp.beta_id(6201,'2000'),pg_temp.beta_id(6201,'3000'),'FOUNDER',6)$q$,'55000',null,'real bot/Business permissions are still required before conversation dispatch');
select public.admin_private_beta_transition_v1(pg_temp.beta_id(6201,'2000'),pg_temp.beta_id(6201,'3000'),'STOPPED',6);
select throws_ok($q$select public.admin_private_beta_canary_scope_v1(pg_temp.beta_id(6201,'2000'),pg_temp.beta_id(6201,'3000'))$q$,'42501',null,'emergency STOP still prevents scope issuance');
select is((select to_jsonb(r)from private.polat_experiment_runs r join recovery_before b on r.id=b.canary_run_id),(select run_row from recovery_before),'STOP also leaves the historical UNKNOWN run intact');

-- Protected-runner fixture. This is not a genuine GitHub review, founder login,
-- MFA verification, provider inference or bill. No fixture is applied hosted.
select pg_temp.recovery_unknown(6204);
select pg_temp.recovery_observe(6204);
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,created_at,updated_at)values(pg_temp.beta_id(6204,'7100'),pg_temp.beta_id(6204,'1000'),'totp','verified','SQL_FIXTURE_NOT_A_REAL_TOTP_SECRET',clock_timestamp(),clock_timestamp());
create temp table standing_auth_before as select p.id,p.approved_at,p.authenticated_at,p.request_count,p.reserved_liability,p.canary_run_id,
 (select f.status::text from auth.mfa_factors f where f.user_id=p.owner_user_id)as factor_status from private.private_beta_programs p where p.id=pg_temp.beta_id(6204,'3000');
select ok(not has_function_privilege('authenticated','private.private_beta_recover_founder_test(uuid,uuid,bigint,text,text)','execute'),'browser role cannot invoke the protected recovery primitive');
select ok(not has_function_privilege('service_role','private.private_beta_recover_founder_test(uuid,uuid,bigint,text,text)','execute'),'runtime role cannot invoke the protected recovery primitive');
select ok(not has_function_privilege('service_role','private.private_beta_protected_canary_scope(uuid,uuid,text)','execute'),'runtime role cannot manufacture a protected canary scope');
select pg_temp.beta_auth(6204);
select throws_ok($q$select private.private_beta_recover_founder_test(pg_temp.beta_id(6204,'2000'),pg_temp.beta_id(6204,'3000'),5,repeat('f',40),'GITHUB_RUN:1234:'||repeat('f',40))$q$,'42501',null,'protected mode cannot masquerade as a fresh owner browser session');
select set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.role','',true);
select ok(private.private_beta_standing_owner_valid((select p from private.private_beta_programs p where id=pg_temp.beta_id(6204,'3000'))),'recorded initial grant plus currently verified factor establishes the bounded standing grant');
select throws_ok($q$select private.private_beta_recover_founder_test(pg_temp.beta_id(6204,'2000'),pg_temp.beta_id(6204,'3000'),5,repeat('f',40),'GITHUB_RUN:1234:'||repeat('e',40))$q$,'42501',null,'protected execution reference must bind the actual repaired source');
select lives_ok($q$select private.private_beta_recover_founder_test(pg_temp.beta_id(6204,'2000'),pg_temp.beta_id(6204,'3000'),5,repeat('f',40),'GITHUB_RUN:1234:'||repeat('f',40))$q$,'protected backend can perform the explicitly authorized bounded recovery without forging MFA');
select is((select approved_at from private.private_beta_programs where id=pg_temp.beta_id(6204,'3000')),(select approved_at from standing_auth_before),'protected recovery preserves the original real approval timestamp');
select is((select authenticated_at from private.private_beta_programs where id=pg_temp.beta_id(6204,'3000')),(select authenticated_at from standing_auth_before),'protected recovery preserves the original real MFA timestamp');
select is((select status::text from auth.mfa_factors where user_id=pg_temp.beta_id(6204,'1000')),(select factor_status from standing_auth_before),'protected recovery never verifies or alters an Auth factor');
select is((select request_count from private.private_beta_programs where id=pg_temp.beta_id(6204,'3000')),1,'protected recovery preserves the consumed global request count');
select is((select reserved_liability from private.private_beta_programs where id=pg_temp.beta_id(6204,'3000')),4.628448::numeric,'protected recovery preserves the entire unknown reservation');
select is((select actor_type::text from public.audit_logs where tenant_id=pg_temp.beta_id(6204,'2000')and action='private_beta.owner_correlation_recovery'order by created_at desc limit 1),'SYSTEM','backend execution is audited as SYSTEM, not a fabricated human session');
select is((select actor_id from public.audit_logs where tenant_id=pg_temp.beta_id(6204,'2000')and action='private_beta.owner_correlation_recovery'order by created_at desc limit 1),null,'backend does not impersonate the founder as the mutation actor');
select is((select account_control->>'recovery_authority'from private.private_beta_programs where id=pg_temp.beta_id(6204,'3000')),'PROTECTED_EXISTING_OWNER_GRANT','control states its actual authorization provenance');
select is(private.private_beta_protected_canary_scope(pg_temp.beta_id(6204,'2000'),pg_temp.beta_id(6204,'3000'),repeat('f',40))->>'model','gpt-6.1-sol','protected scope pins the configured real model');
select is(private.private_beta_exposure(pg_temp.beta_id(6204,'3000')),4.628448::numeric,'standing execution has not consumed or waived any old exposure');
update auth.mfa_factors set status='unverified'where user_id=pg_temp.beta_id(6204,'1000');
select throws_ok($q$select private.private_beta_protected_canary_scope(pg_temp.beta_id(6204,'2000'),pg_temp.beta_id(6204,'3000'),repeat('f',40))$q$,'42501',null,'revoked or unfinished factor blocks protected dispatch');
select pg_temp.recovery_unknown(6205);
select pg_temp.recovery_observe(6205);
select set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.role','',true);
select throws_ok($q$select private.private_beta_recover_founder_test(pg_temp.beta_id(6205,'2000'),pg_temp.beta_id(6205,'3000'),5,repeat('f',40),'GITHUB_RUN:1234:'||repeat('f',40))$q$,'42501',null,'a historical claim without a current verified factor cannot create protected authority');
select is((select account_control->>'version'from private.private_beta_programs where id=pg_temp.beta_id(6205,'3000')),'3','blocked protected mutation leaves the original version intact');

select finish();
rollback;
