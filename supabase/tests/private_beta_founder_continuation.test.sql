\ir helpers/historical/identity_domains_v1.sql
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
 'credential_custody_hash',private.fse_hash(private.fse_canonical(jsonb_build_array(pg_temp.jeff_domain('JEFF_UAT_CREDENTIAL_CUSTODY1'),scope_hash,key_hash))),
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
-- Disposable fixtures: no real auth, provider, billing or Telegram evidence.
create function pg_temp.continuation_unknown(n integer,error_value text default 'OPENAI_UAT_ENVELOPE_INVALID')returns void language plpgsql as $$declare r jsonb;begin
 perform pg_temp.recovery_unknown(n);perform pg_temp.recovery_observe(n);perform pg_temp.beta_auth(n);perform pg_temp.recovery_start(n);
 r:=public.private_beta_reserve_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),pg_temp.beta_id(n,'4002'),repeat('d',64),repeat('e',64),null,'0.0264704',pg_temp.beta_id(n,'4003'));
 perform public.private_beta_begin_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),(r->>'attempt_id')::uuid,pg_temp.beta_id(n,'5002'));
 perform public.private_beta_record_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),(r->>'attempt_id')::uuid,pg_temp.beta_id(n,'5002'),(pg_temp.beta_outcome('UNKNOWN','RESULT_UNKNOWN','NOT_EVALUATED')||jsonb_build_object('error_code',error_value))::text);
end;$$;
create function pg_temp.continuation_observe(n integer)returns void language plpgsql as $$declare v jsonb;begin
 v:=pg_temp.founder_model_fixture(n);v:=jsonb_set(v,'{observation,repository_sha}',to_jsonb(repeat('c',40)));
 perform private.private_beta_founder_model_record(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),v::text);
end;$$;
create function pg_temp.continuation_start(n integer)returns jsonb language plpgsql as $$declare p private.private_beta_programs;begin
 select * into p from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');
 return public.admin_private_beta_continue_founder_test_v1(p.tenant_id,p.id,p.generation,repeat('c',40));end;$$;
select pg_temp.continuation_unknown(6301);
select pg_temp.continuation_unknown(6302,'OPENAI_UAT_TIMEOUT_UNKNOWN');
select ok(private.private_beta_continuation_available((select p from private.private_beta_programs p where id=pg_temp.beta_id(6301,'3000'))),'exact second envelope UNKNOWN is eligible');
select ok(not private.private_beta_continuation_available((select p from private.private_beta_programs p where id=pg_temp.beta_id(6302,'3000'))),'different second failure is not eligible');
select ok(not has_function_privilege('service_role','public.admin_private_beta_continue_founder_test_v1(uuid,uuid,bigint,text)','execute'),'service role cannot reauthorize');
select ok(not has_function_privilege('anon','public.admin_private_beta_continue_founder_test_v1(uuid,uuid,bigint,text)','execute'),'anonymous cannot reauthorize');
select pg_temp.beta_auth(6301);
select throws_ok($q$select pg_temp.continuation_start(6301)$q$,'55000',null,'renewal needs fresh metadata for changed SHA');
select lives_ok($q$select pg_temp.continuation_observe(6301)$q$,'collector may observe eligible expired-or-held program without granting authority');
select is(public.admin_private_beta_workspace_v1(pg_temp.beta_id(6301,'2000'),25,null)#>>'{program,canary_state}','CONTINUATION_AVAILABLE','panel offers one fresh-owner continuation');
select throws_ok($q$select public.admin_private_beta_canary_scope_v1(pg_temp.beta_id(6301,'2000'),pg_temp.beta_id(6301,'3000'))$q$,'55000','PRIVATE_BETA_RECOVERY_REQUIRED','unexpired old scope must route owner action through fresh continuation');
create temp table continuation_before as select p.id,to_jsonb(p)as program,
 (select jsonb_agg(to_jsonb(a)order by a.id)from private.jeff_experiment_attempts a join private.private_beta_attempt_scope s on s.attempt_id=a.id where s.program_id=p.id)as attempts,
 (select jsonb_agg(to_jsonb(e)order by e.id)from private.jeff_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id=p.id)as evidence,
 (select jsonb_agg(to_jsonb(r)order by r.id)from private.jeff_experiment_runs r where r.id in(p.canary_run_id,(p.account_control->>'retained_unknown_run_id')::uuid))as runs
 from private.private_beta_programs p where id=pg_temp.beta_id(6301,'3000');
create function pg_temp.expired_projection()returns boolean language plpgsql as $$declare p private.private_beta_programs;v jsonb;begin
 select * into p from private.private_beta_programs where id=pg_temp.beta_id(6301,'3000');
 -- Composite fixture only; no guard/trigger is disabled and no stored history changes.
 p.configuration:=p.configuration||jsonb_build_object('notice_version','polat-private-beta-notice-openai-v1','starts_at',clock_timestamp()-interval '5 days','expires_at',clock_timestamp()-interval '4 days');
 p.account_control:=p.account_control||jsonb_build_object('expires_at',clock_timestamp()-interval '4 days');
 v:=private.private_beta_continuation_projection(p,repeat('c',40),private.private_beta_mfa_at(),clock_timestamp());
 return v#>>'{configuration,notice_version}'='jeff-private-beta-notice-openai-v1' and(v#>>'{configuration,expires_at}')::timestamptz>clock_timestamp()and(v#>>'{configuration,expires_at}')::timestamptz<=(v->>'approved_at')::timestamptz+interval '24 hours';end;$$;
select ok(pg_temp.expired_projection(),'fresh action normalizes legacy notice and renews expired window at most24 hours without waiving history');
select pg_temp.beta_auth(6301,'owner','aal1');
select throws_ok($q$select pg_temp.continuation_start(6301)$q$,'42501',null,'aal1 cannot continue');
select pg_temp.beta_auth(6301,'owner','aal2',301);
select throws_ok($q$select pg_temp.continuation_start(6301)$q$,'42501',null,'stale MFA cannot continue');
select pg_temp.beta_auth(6302);
select throws_ok($q$select pg_temp.continuation_start(6301)$q$,'42501',null,'foreign owner cannot continue');
select pg_temp.beta_auth(6301);
select throws_ok($q$select public.admin_private_beta_continue_founder_test_v1(pg_temp.beta_id(6301,'2000'),pg_temp.beta_id(6301,'3000'),1,repeat('c',40))$q$,'42501',null,'stale generation cannot continue');
select throws_ok($q$update private.private_beta_programs set account_control=account_control||'{"version":5}'::jsonb where id=pg_temp.beta_id(6301,'3000')$q$,'42501',null,'direct forged version upgrade fails immutable trigger');
select lives_ok($q$select pg_temp.continuation_start(6301)$q$,'fresh owner creates one bounded native continuation');
select is((select account_control->>'version'from private.private_beta_programs where id=pg_temp.beta_id(6301,'3000')),'5','distinct continuation protocol');
select is((select request_count from private.private_beta_programs where id=pg_temp.beta_id(6301,'3000')),2,'consumed calls retained');
select is(private.private_beta_exposure(pg_temp.beta_id(6301,'3000')),4.6549184::numeric,'both UNKNOWN liabilities retained');
select is((select reserved_liability from private.private_beta_programs where id=pg_temp.beta_id(6301,'3000')),4.6549184::numeric,'reserved total not reset');
select is((select account_control->>'retained_unknown_liability'from private.private_beta_programs where id=pg_temp.beta_id(6301,'3000')),(select program#>>'{account_control,retained_unknown_liability}'from continuation_before),'v4 historical debt field retained');
select is((select account_control->>'recovery_authority'from private.private_beta_programs where id=pg_temp.beta_id(6301,'3000')),(select program#>>'{account_control,recovery_authority}'from continuation_before),'original authority retained');
select is((select jsonb_array_length(account_control->'retained_unknown_attempts')from private.private_beta_programs where id=pg_temp.beta_id(6301,'3000')),2,'two exact retained attempts');
select is((select jsonb_agg(to_jsonb(a)order by a.id)from private.jeff_experiment_attempts a join private.private_beta_attempt_scope s on s.attempt_id=a.id where s.program_id=pg_temp.beta_id(6301,'3000')),(select attempts from continuation_before),'attempt history unchanged');
select is((select jsonb_agg(to_jsonb(e)order by e.id)from private.jeff_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id=pg_temp.beta_id(6301,'3000')),(select evidence from continuation_before),'UNKNOWN journal unchanged');
select is((select jsonb_agg(to_jsonb(r)order by r.id)from private.jeff_experiment_runs r where r.id in(select(value->>'id')::uuid from continuation_before,jsonb_array_elements(runs))),(select runs from continuation_before),'old stopped runs unchanged');
select is(public.private_beta_account_control_v1(pg_temp.beta_id(6301,'2000'),pg_temp.beta_id(6301,'3000'))#>>'{payload,unknown_outcome_count}','0','only explicitly retained failures exempt new run blocking');
select is(private.private_beta_binding((select p from private.private_beta_programs p where id=pg_temp.beta_id(6301,'3000')),true)->>'maximum_requests','3','global canary ordinal bound is3');
select throws_ok($q$select pg_temp.continuation_start(6301)$q$,'42501',null,'continuation cannot repeat');
select throws_ok($q$update private.private_beta_programs set account_control=jsonb_set(account_control,'{retained_unknown_attempts}','[]'::jsonb)where id=pg_temp.beta_id(6301,'3000')$q$,'42501',null,'retained exception cannot be widened after continuation');
create temp table continuation_new as select public.private_beta_reserve_v1(pg_temp.beta_id(6301,'2000'),pg_temp.beta_id(6301,'3000'),pg_temp.beta_id(6301,'4006'),repeat('d',64),repeat('e',64),null,'0.0264704',pg_temp.beta_id(6301,'4007'))as receipt;
select is((select request_count from private.private_beta_programs where id=pg_temp.beta_id(6301,'3000')),3,'new canary increments preserved count');
select is(private.private_beta_exposure(pg_temp.beta_id(6301,'3000')),4.6813888::numeric,'new reservation shares original5USD ceiling');
select throws_ok($q$select public.private_beta_reserve_v1(pg_temp.beta_id(6301,'2000'),pg_temp.beta_id(6301,'3000'),pg_temp.beta_id(6301,'4008'),repeat('d',64),repeat('e',64),null,'0.0264704',pg_temp.beta_id(6301,'4009'))$q$,'54000',null,'fourth canary denied');
select public.private_beta_begin_v1(pg_temp.beta_id(6301,'2000'),pg_temp.beta_id(6301,'3000'),(select(receipt->>'attempt_id')::uuid from continuation_new),pg_temp.beta_id(6301,'5006'));
select lives_ok($q$select public.private_beta_record_v1(pg_temp.beta_id(6301,'2000'),pg_temp.beta_id(6301,'3000'),(select(receipt->>'attempt_id')::uuid from continuation_new),pg_temp.beta_id(6301,'5006'),pg_temp.founder_observed_result()::text)$q$,'native QA/usage result recorded');
select ok(private.private_beta_founder_canary_hash((select p from private.private_beta_programs p where id=pg_temp.beta_id(6301,'3000')))is not null,'new real-format canary can succeed without rewriting failures');
select ok(private.private_beta_connection_setup_allowed((select p from private.private_beta_programs p where id=pg_temp.beta_id(6301,'3000'))),'Business setup allowed after third-ordinal success');
select throws_ok($q$select public.admin_private_beta_transition_v1(pg_temp.beta_id(6301,'2000'),pg_temp.beta_id(6301,'3000'),'FOUNDER',(select generation from private.private_beta_programs where id=pg_temp.beta_id(6301,'3000')))$q$,'55000',null,'Telegram permission still required');
select is((select count(*)::int from private.jeff_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id=pg_temp.beta_id(6301,'3000')and e.stage='RECONCILIATION'),0,'no billing fabricated');
-- Narrow continuation after the genuine usage-schema defect. All following
-- identities, authentication and results are disposable fixtures, not real UAT.
create function pg_temp.usage_unknown(n integer,error_value text default 'OPENAI_UAT_ENVELOPE_INVALID_USAGE') returns void language plpgsql as $$declare r jsonb;begin
 perform pg_temp.continuation_unknown(n);perform pg_temp.continuation_observe(n);perform pg_temp.beta_auth(n);perform pg_temp.continuation_start(n);
 r:=public.private_beta_reserve_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),pg_temp.beta_id(n,'4010'),repeat('d',64),repeat('e',64),null,'0.0264704',pg_temp.beta_id(n,'4011'));
 perform public.private_beta_begin_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),(r->>'attempt_id')::uuid,pg_temp.beta_id(n,'5010'));
 perform public.private_beta_record_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),(r->>'attempt_id')::uuid,pg_temp.beta_id(n,'5010'),(pg_temp.beta_outcome('UNKNOWN','RESULT_UNKNOWN','NOT_EVALUATED')||jsonb_build_object('error_code',error_value))::text);
end;$$;
create function pg_temp.usage_observe(n integer) returns void language plpgsql as $$declare v jsonb;begin
 v:=pg_temp.founder_model_fixture(n);v:=jsonb_set(v,'{observation,repository_sha}',to_jsonb(repeat('d',40)));
 perform private.private_beta_founder_model_record(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),v::text);
end;$$;
create function pg_temp.usage_start(n integer) returns jsonb language plpgsql as $$declare p private.private_beta_programs;begin
 select * into strict p from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');
 return public.admin_private_beta_continue_founder_test_v1(p.tenant_id,p.id,p.generation,repeat('d',40));end;$$;
select pg_temp.usage_unknown(6303);
select pg_temp.usage_unknown(6304,'OPENAI_UAT_TIMEOUT_UNKNOWN');
select ok(private.private_beta_usage_repair_available((select p from private.private_beta_programs p where id=pg_temp.beta_id(6303,'3000'))),'only exact third usage UNKNOWN is a repair candidate');
select ok(not private.private_beta_usage_repair_available((select p from private.private_beta_programs p where id=pg_temp.beta_id(6304,'3000'))),'unrelated third failure cannot use usage repair');
select pg_temp.beta_auth(6303);
select throws_ok($q$select pg_temp.usage_start(6303)$q$,'55000',null,'repair needs metadata from a different published commit');
select lives_ok($q$select pg_temp.usage_observe(6303)$q$,'same protected observer records repair metadata without inference');
select is(public.admin_private_beta_workspace_v1(pg_temp.beta_id(6303,'2000'),25,null)#>>'{program,canary_state}','CONTINUATION_AVAILABLE','same panel offers explicit usage repair');
create temp table usage_before as select p.id,
 (select jsonb_agg(to_jsonb(a)order by a.id)from private.jeff_experiment_attempts a join private.private_beta_attempt_scope s on s.attempt_id=a.id where s.program_id=p.id)as attempts,
 (select jsonb_agg(to_jsonb(e)order by e.id)from private.jeff_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id=p.id)as evidence,
 p.configuration as configuration,p.account_control as account_control
 from private.private_beta_programs p where id=pg_temp.beta_id(6303,'3000');
select pg_temp.beta_auth(6303,'owner','aal1');
select throws_ok($q$select pg_temp.usage_start(6303)$q$,'42501',null,'usage repair requires actual aal2');
select pg_temp.beta_auth(6303,'owner','aal2',301);
select throws_ok($q$select pg_temp.usage_start(6303)$q$,'42501',null,'usage repair rejects stale MFA');
select pg_temp.beta_auth(6304);
select throws_ok($q$select pg_temp.usage_start(6303)$q$,'42501',null,'usage repair rejects foreign owner');
select pg_temp.beta_auth(6303);
select throws_ok($q$select public.admin_private_beta_continue_founder_test_v1(pg_temp.beta_id(6303,'2000'),pg_temp.beta_id(6303,'3000'),1,repeat('d',40))$q$,'42501',null,'usage repair rejects stale generation');
select lives_ok($q$select pg_temp.usage_start(6303)$q$,'fresh owner reuses same continuation RPC after reviewed usage fix');
select is((select request_count from private.private_beta_programs where id=pg_temp.beta_id(6303,'3000')),3,'three consumed requests preserved before new generation');
select is((select reserved_liability from private.private_beta_programs where id=pg_temp.beta_id(6303,'3000')),4.6813888::numeric,'all three original reservations preserved');
select is((select jsonb_array_length(account_control->'retained_unknown_attempts')from private.private_beta_programs where id=pg_temp.beta_id(6303,'3000')),3,'all three exact UNKNOWN debts retained');
select is((select jsonb_agg(to_jsonb(a)order by a.id)from private.jeff_experiment_attempts a join private.private_beta_attempt_scope s on s.attempt_id=a.id where s.program_id=pg_temp.beta_id(6303,'3000')),(select attempts from usage_before),'repair leaves historical attempts byte-for-byte unchanged');
select is((select jsonb_agg(to_jsonb(e)order by e.id)from private.jeff_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id=pg_temp.beta_id(6303,'3000')),(select evidence from usage_before),'repair leaves all UNKNOWN evidence byte-for-byte unchanged');
select is(private.private_beta_binding((select p from private.private_beta_programs p where id=pg_temp.beta_id(6303,'3000')),true)->>'maximum_requests','4','only fourth global ordinal allowed');
select throws_ok($q$select pg_temp.usage_start(6303)$q$,'42501',null,'usage repair cannot repeat');
select throws_ok($q$update private.private_beta_programs set account_control=jsonb_set(account_control,'{retained_unknown_attempts}','[]'::jsonb)where id=pg_temp.beta_id(6303,'3000')$q$,'42501',null,'retained third debt cannot be removed');
create temp table usage_new as select public.private_beta_reserve_v1(pg_temp.beta_id(6303,'2000'),pg_temp.beta_id(6303,'3000'),pg_temp.beta_id(6303,'4012'),repeat('d',64),repeat('e',64),null,'0.0264704',pg_temp.beta_id(6303,'4013'))as receipt;
select is((select request_count from private.private_beta_programs where id=pg_temp.beta_id(6303,'3000')),4,'new canary increments existing global count');
select is(private.private_beta_exposure(pg_temp.beta_id(6303,'3000')),4.7078592::numeric,'fourth attempt remains under original 5USD ceiling');
select throws_ok($q$select public.private_beta_reserve_v1(pg_temp.beta_id(6303,'2000'),pg_temp.beta_id(6303,'3000'),pg_temp.beta_id(6303,'4014'),repeat('d',64),repeat('e',64),null,'0.0264704',pg_temp.beta_id(6303,'4015'))$q$,'54000',null,'fifth canary denied');
select public.private_beta_begin_v1(pg_temp.beta_id(6303,'2000'),pg_temp.beta_id(6303,'3000'),(select(receipt->>'attempt_id')::uuid from usage_new),pg_temp.beta_id(6303,'5012'));
select lives_ok($q$select public.private_beta_record_v1(pg_temp.beta_id(6303,'2000'),pg_temp.beta_id(6303,'3000'),(select(receipt->>'attempt_id')::uuid from usage_new),pg_temp.beta_id(6303,'5012'),pg_temp.founder_observed_result()::text)$q$,'native QA/usage result can pass after repaired decoder');
select ok(private.private_beta_founder_canary_hash((select p from private.private_beta_programs p where id=pg_temp.beta_id(6303,'3000')))is not null,'successful new canary is distinct from three historical UNKNOWNs');
select ok(private.private_beta_connection_setup_allowed((select p from private.private_beta_programs p where id=pg_temp.beta_id(6303,'3000'))),'Business setup accepts fourth-ordinal canary only after success');
select throws_ok($q$select public.admin_private_beta_transition_v1(pg_temp.beta_id(6303,'2000'),pg_temp.beta_id(6303,'3000'),'FOUNDER',(select generation from private.private_beta_programs where id=pg_temp.beta_id(6303,'3000')))$q$,'55000',null,'real Telegram permissions still required after repair');
-- A mistaken owner STOP before the repaired canary needs a NEW explicit owner
-- action. Never reopen during migration, metadata observation or runner setup.
create function pg_temp.stopped_rearm_start(n integer)returns jsonb language plpgsql as $$declare p private.private_beta_programs;begin
 select * into strict p from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');
 return public.admin_private_beta_rearm_founder_test_v1(p.tenant_id,p.id,p.generation,repeat('d',40));end;$$;
select pg_temp.usage_unknown(6305);
select pg_temp.usage_unknown(6306,'OPENAI_UAT_TIMEOUT_UNKNOWN');
select pg_temp.beta_auth(6305);
select throws_ok($q$select pg_temp.stopped_rearm_start(6305)$q$,'42501',null,'rearm cannot replace an ordinary continuation');
select public.admin_private_beta_transition_v1(pg_temp.beta_id(6305,'2000'),pg_temp.beta_id(6305,'3000'),'STOPPED',(select generation from private.private_beta_programs where id=pg_temp.beta_id(6305,'3000')));
select ok(private.private_beta_stopped_rearm_available((select p from private.private_beta_programs p where id=pg_temp.beta_id(6305,'3000'))),'exact owner STOP before usage-repair canary is eligible');
select ok(not has_function_privilege('service_role','public.admin_private_beta_rearm_founder_test_v1(uuid,uuid,bigint,text)','execute'),'service role cannot rearm owner STOP');
select ok(not has_function_privilege('anon','public.admin_private_beta_rearm_founder_test_v1(uuid,uuid,bigint,text)','execute'),'anonymous cannot rearm owner STOP');
select throws_ok($q$update private.private_beta_programs set stage='CANARY'where id=pg_temp.beta_id(6305,'3000')$q$,'42501',null,'privileged direct stage flip cannot undo STOP');
select throws_ok($q$select public.admin_private_beta_continue_founder_test_v1(pg_temp.beta_id(6305,'2000'),pg_temp.beta_id(6305,'3000'),(select generation from private.private_beta_programs where id=pg_temp.beta_id(6305,'3000')),repeat('d',40))$q$,'42501',null,'old continuation RPC cannot undo STOP');
select throws_ok($q$select pg_temp.stopped_rearm_start(6305)$q$,'55000',null,'rearm requires current observations from different release');
select lives_ok($q$select pg_temp.usage_observe(6305)$q$,'metadata may refresh while program remains stopped');
select is((select stage from private.private_beta_programs where id=pg_temp.beta_id(6305,'3000')),'STOPPED','metadata refresh never clears STOP');
select is(public.admin_private_beta_workspace_v1(pg_temp.beta_id(6305,'2000'),25,null)#>>'{program,canary_state}','CONTINUATION_AVAILABLE','owner sees explicit stopped-test action');
create temp table stopped_before as select p.id,p.request_count,p.reserved_liability,p.canary_run_id,p.generation,
 (select jsonb_agg(to_jsonb(e)order by e.id)from private.jeff_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id=p.id)as evidence
 from private.private_beta_programs p where id=pg_temp.beta_id(6305,'3000');
select pg_temp.beta_auth(6305,'owner','aal1');
select throws_ok($q$select pg_temp.stopped_rearm_start(6305)$q$,'42501',null,'rearm requires actual aal2');
select pg_temp.beta_auth(6305,'owner','aal2',301);
select throws_ok($q$select pg_temp.stopped_rearm_start(6305)$q$,'42501',null,'rearm rejects stale MFA');
select pg_temp.beta_auth(6306);
select throws_ok($q$select pg_temp.stopped_rearm_start(6305)$q$,'42501',null,'foreign owner cannot rearm');
select public.admin_private_beta_transition_v1(pg_temp.beta_id(6306,'2000'),pg_temp.beta_id(6306,'3000'),'STOPPED',(select generation from private.private_beta_programs where id=pg_temp.beta_id(6306,'3000')));
select ok(not private.private_beta_stopped_rearm_available((select p from private.private_beta_programs p where id=pg_temp.beta_id(6306,'3000'))),'unrelated stopped failure stays terminal');
select pg_temp.beta_auth(6305);
select throws_ok($q$select public.admin_private_beta_rearm_founder_test_v1(pg_temp.beta_id(6305,'2000'),pg_temp.beta_id(6305,'3000'),1,repeat('d',40))$q$,'42501',null,'rearm rejects stale generation');
select lives_ok($q$select pg_temp.stopped_rearm_start(6305)$q$,'only explicit fresh owner action rearms exact stopped setup');
select is((select stage from private.private_beta_programs where id=pg_temp.beta_id(6305,'3000')),'CANARY','rearm does not open conversation or customers');
select is((select request_count from private.private_beta_programs where id=pg_temp.beta_id(6305,'3000')),(select request_count from stopped_before),'consumed count not reset by rearm');
select is((select reserved_liability from private.private_beta_programs where id=pg_temp.beta_id(6305,'3000')),(select reserved_liability from stopped_before),'three UNKNOWN reservations not reset by rearm');
select is((select jsonb_agg(to_jsonb(e)order by e.id)from private.jeff_experiment_evidence e join private.private_beta_attempt_scope s on s.attempt_id=e.attempt_id where s.program_id=pg_temp.beta_id(6305,'3000')),(select evidence from stopped_before),'old model evidence unchanged');
select is((select count(*)::int from public.audit_logs where entity_id=pg_temp.beta_id(6305,'3000')::text and action='private_beta.program_transition' and after_data->>'stage'='STOPPED'),1,'original STOP audit retained');
select is((select count(*)::int from public.audit_logs where entity_id=pg_temp.beta_id(6305,'3000')::text and action='private_beta.owner_stopped_rearm'),1,'new owner rearm recorded separately');
select throws_ok($q$select pg_temp.stopped_rearm_start(6305)$q$,'42501',null,'rearm cannot repeat');
create temp table rearm_new as select public.private_beta_reserve_v1(pg_temp.beta_id(6305,'2000'),pg_temp.beta_id(6305,'3000'),pg_temp.beta_id(6305,'4016'),repeat('d',64),repeat('e',64),null,'0.0264704',pg_temp.beta_id(6305,'4017'))as receipt;
select is((select request_count from private.private_beta_programs where id=pg_temp.beta_id(6305,'3000')),4,'rearmed canary remains global fourth request');
select public.private_beta_begin_v1(pg_temp.beta_id(6305,'2000'),pg_temp.beta_id(6305,'3000'),(select(receipt->>'attempt_id')::uuid from rearm_new),pg_temp.beta_id(6305,'5016'));
select lives_ok($q$select public.private_beta_record_v1(pg_temp.beta_id(6305,'2000'),pg_temp.beta_id(6305,'3000'),(select(receipt->>'attempt_id')::uuid from rearm_new),pg_temp.beta_id(6305,'5016'),pg_temp.founder_observed_result()::text)$q$,'rearmed canary uses unchanged native QA/usage path');
select ok(private.private_beta_founder_canary_hash((select p from private.private_beta_programs p where id=pg_temp.beta_id(6305,'3000')))is not null,'rearmed canary can be verified distinctly from retained UNKNOWNs');
select public.admin_private_beta_transition_v1(pg_temp.beta_id(6305,'2000'),pg_temp.beta_id(6305,'3000'),'STOPPED',(select generation from private.private_beta_programs where id=pg_temp.beta_id(6305,'3000')));
select ok(not private.private_beta_stopped_rearm_available((select p from private.private_beta_programs p where id=pg_temp.beta_id(6305,'3000'))),'STOP after fourth attempt remains terminal');
select throws_ok($q$select pg_temp.stopped_rearm_start(6305)$q$,'42501',null,'rearm does not enable fifth canary or another restart');
select finish();
rollback;
