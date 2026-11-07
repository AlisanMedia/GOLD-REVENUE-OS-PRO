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

select pg_temp.founder_local_setup(5101);
select pg_temp.founder_local_setup(5102);
select pg_temp.founder_local_setup(5103);
select pg_temp.founder_local_setup(5104);
select pg_temp.founder_local_setup(5105);
select pg_temp.beta_auth(5101);
select ok(not has_function_privilege('service_role','private.private_beta_founder_model_record(uuid,uuid,text)','execute'),'application cannot forge protected model/pricing observations');
select ok(not has_function_privilege('authenticated','private.private_beta_founder_model_record(uuid,uuid,text)','execute'),'owner web session cannot write provider observations');
select ok(not has_function_privilege('anon','private.private_beta_founder_model_record(uuid,uuid,text)','execute'),'anonymous caller cannot write provider observations');
select ok(not has_function_privilege('service_role','public.admin_private_beta_prepare_founder_test_v1(uuid,uuid,bigint,text)','execute'),'service role cannot grant owner-only test authority');
select ok(has_function_privilege('authenticated','public.admin_private_beta_prepare_founder_test_v1(uuid,uuid,bigint,text)','execute'),'authenticated entry still enforces actual owner and fresh MFA');
select throws_ok($q$select public.admin_private_beta_prepare_founder_test_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),3,repeat('e',40))$q$,'55000','PRIVATE_BETA_MODEL_OBSERVATION_REQUIRED','owner approval cannot replace missing protected model metadata');
select throws_ok($q$select private.private_beta_founder_model_record(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),jsonb_set(pg_temp.founder_model_fixture(5101),'{observation,credential_sha256}','"not-a-hash"')::text)$q$,'22023','PRIVATE_BETA_MODEL_OBSERVATION_INVALID','malformed key binding cannot seal model metadata');
select throws_ok($q$select private.private_beta_founder_model_record(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),jsonb_set(pg_temp.founder_model_fixture(5101),'{observation,account_scope_hash}',to_jsonb(repeat('f',64)))::text)$q$,'22023','PRIVATE_BETA_MODEL_OBSERVATION_INVALID','scope hash must match organization and project');
select throws_ok($q$select private.private_beta_founder_model_record(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),jsonb_set(pg_temp.founder_model_fixture(5101),'{observation,provider_enforced_cap}','true')::text)$q$,'22023','PRIVATE_BETA_MODEL_OBSERVATION_INVALID','a pasted cap claim cannot enter the metadata contract');
select throws_ok($q$select private.private_beta_founder_model_record(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),jsonb_set(pg_temp.founder_model_fixture(5101),'{observation,observed_at}',to_jsonb(clock_timestamp()-interval '6 minutes'))::text)$q$,'22023','PRIVATE_BETA_MODEL_OBSERVATION_INVALID','protected model observation must be fresh at collection');
select throws_ok($q$select private.private_beta_founder_model_record(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),jsonb_set(pg_temp.founder_model_fixture(5101),'{pricing,maximum_input_usd_per_million}','"4.0"')::text)$q$,'22023','PRIVATE_BETA_PRICING_INVALID','rate excluding regional premium cannot reduce reservation');
select lives_ok($q$select private.private_beta_founder_model_record(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),pg_temp.founder_model_fixture(5101)::text)$q$,'protected SQL fixture observation is stored separately from execution authority');
select is((select account_control from private.private_beta_programs where id=pg_temp.beta_id(5101,'3000')),null::jsonb,'metadata record alone does not create account control or owner approval');
select is(public.admin_private_beta_workspace_v1(pg_temp.beta_id(5101,'2000'))->'program'->>'account_state','OWNER_TEST_AVAILABLE','public projection distinguishes available metadata from authenticated activation');
select pg_temp.beta_auth(5101,'owner','aal2',301);
select throws_ok($q$select public.admin_private_beta_prepare_founder_test_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),3,repeat('e',40))$q$,'42501','PRIVATE_BETA_FRESH_AUTH_REQUIRED','stale actual MFA cannot prepare the owner test');
select pg_temp.beta_auth(5102);
select throws_ok($q$select public.admin_private_beta_prepare_founder_test_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),3,repeat('e',40))$q$,'42501','PRIVATE_BETA_UNAVAILABLE','another tenant cannot authorize the founder test');
select pg_temp.beta_auth(5101);
select throws_ok($q$select public.admin_private_beta_prepare_founder_test_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),2,repeat('e',40))$q$,'42501','PRIVATE_BETA_OWNER_TEST_UNAVAILABLE','stale program generation cannot prepare execution');
select throws_ok($q$select public.admin_private_beta_prepare_founder_test_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),3,repeat('f',40))$q$,'55000','PRIVATE_BETA_MODEL_OBSERVATION_REQUIRED','release must match the protected model observation');
select lives_ok($q$select pg_temp.founder_local_prepare(5101)$q$,'actual fixture owner with fresh MFA prepares the same native program');
select is((select configuration->>'repository_sha'from private.private_beta_programs where id=pg_temp.beta_id(5101,'3000')),repeat('e',40),'owner preparation binds observed release to the previously unconfigured draft');
select is((select configuration->>'primary_operator'from private.private_beta_programs where id=pg_temp.beta_id(5101,'3000')),pg_temp.beta_id(5101,'1000')::text,'primary operator is the authenticated owner');
select is((select configuration->>'backup_operator'from private.private_beta_programs where id=pg_temp.beta_id(5101,'3000')),null,'personal test does not invent a second operator');
select is(public.private_beta_account_control_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'))->'payload'->>'origin','SERVER_DERIVED_OWNER_ONLY_UAT_CONTROL','local control cannot impersonate independent provider account proof');
select is(public.private_beta_account_control_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'))->'payload'->>'provider_billing','UNKNOWN','owner waiver never fabricates reconciled billing');
select is(public.private_beta_account_control_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'))->'payload'->>'provider_enforced_cap','UNVERIFIED','provider cap remains unverified');
select is(private.private_beta_binding((select p from private.private_beta_programs p where id=pg_temp.beta_id(5101,'3000')),true)->>'version','3','owner-only authorization has a distinct binding version');
select is(private.private_beta_binding((select p from private.private_beta_programs p where id=pg_temp.beta_id(5101,'3000')),true)->>'scope','OWNER_ONLY','binding excludes friends and commercial operation');
select is(private.private_beta_binding((select p from private.private_beta_programs p where id=pg_temp.beta_id(5101,'3000')),true)->>'maximum_attempt_liability','4.628448','full context and512 output include regional-inclusive4.4/16.5 rates');
select ok((select(configuration->>'expires_at')::timestamptz<=(account_control->>'observed_at')::timestamptz+interval '24 hours'from private.private_beta_programs where id=pg_temp.beta_id(5101,'3000')),'owner test ends within the observed24-hour window');
select throws_ok($q$select public.admin_private_beta_invite_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),'FRIEND',pg_temp.beta_id(5101,'6001'))$q$,'42501','PRIVATE_BETA_OWNER_ONLY','owner-only mode cannot issue a friend invitation');
select throws_ok($q$select public.admin_private_beta_transition_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),'FRIENDS',4)$q$,'42501','PRIVATE_BETA_OWNER_ONLY','owner-only control cannot be promoted to friends');

select public.admin_private_beta_transition_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),'CANARY',4);
update private_beta_cases set canary=public.private_beta_reserve_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),pg_temp.beta_id(5101,'4000'),repeat('a',64),repeat('b',64),null,'4.628448',pg_temp.beta_id(5101,'4001'))where n=5101;
select is(private.private_beta_exposure(pg_temp.beta_id(5101,'3000')),4.628448::numeric,'complete full-context liability is reserved before the fixture result');
select is(public.private_beta_begin_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),(select(canary->>'attempt_id')::uuid from private_beta_cases where n=5101),pg_temp.beta_id(5101,'5000'))->>'dispatch','true','only the first durable start is dispatchable');
select is(public.private_beta_committed_attempt_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),(select(canary->>'attempt_id')::uuid from private_beta_cases where n=5101))->'payload'->>'reserved_liability','4.628448','permit payload reflects current durable exposure');
select lives_ok($q$select pg_temp.founder_local_record(5101,pg_temp.founder_observed_result())$q$,'native journal accepts a structured successful positive-usage QA-approved fixture result');
select is(private.private_beta_exposure(pg_temp.beta_id(5101,'3000')),0.0021593::numeric,'37input121output are conservatively valued at4.4/16.5 without actual billing');
select is((select reserved_liability from private.private_beta_programs where id=pg_temp.beta_id(5101,'3000')),4.628448::numeric,'original cumulative reservation counter is never rewritten downward');
select is((select reserved_liability from private.jeff_experiment_runs where id=(select canary_run_id from private.private_beta_programs where id=pg_temp.beta_id(5101,'3000'))),4.628448::numeric,'immutable native run retains original reservation history');
select is(public.private_beta_account_control_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'))->'payload'->>'local_reserved_liability','0.0021593','account getter derives local exposure from actual-shaped journal evidence');
select is(public.private_beta_account_control_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'))->'payload'->>'local_remaining_allowance','4.9978407','local allowance is exact5 minus journal exposure');
select ok(private.private_beta_founder_canary_hash((select p from private.private_beta_programs p where id=pg_temp.beta_id(5101,'3000')))~'^[a-f0-9]{64}$','technical canary acceptance derives from committed response identity/usage/QA');
select is((select canary_reconciliation_hash from private.private_beta_programs where id=pg_temp.beta_id(5101,'3000')),null,'technical acceptance never writes financial reconciliation');
select is(public.admin_private_beta_workspace_v1(pg_temp.beta_id(5101,'2000'))->'program'->>'actual_billed_amount',null,'actual provider bill stays unknown after the successful canary');
select is(public.admin_private_beta_workspace_v1(pg_temp.beta_id(5101,'2000'))->'program'->>'billing_status','UNKNOWN','usage valuation is not independently reconciled billing');
select is(public.admin_private_beta_workspace_v1(pg_temp.beta_id(5101,'2000'))->'program'->>'canary_state','OWNER_TEST_READY','local technical readiness has its own truthful display state');
select pg_temp.beta_bot(5101);
select throws_ok($q$select public.admin_private_beta_transition_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),'FOUNDER',5)$q$,'55000','PRIVATE_BETA_BUSINESS_UNVERIFIED','ordinary bot identity cannot authorize the selected Jeff Business conversation');
select ok(private.private_beta_connection_setup_allowed((select p from private.private_beta_programs p where id=pg_temp.beta_id(5101,'3000'))),'successful local canary permits protected Business setup without resetting the program');
select lives_ok($q$select public.admin_private_beta_business_configure_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),pg_temp.business_config(5101)::text,5)$q$,'fresh owner can configure exact representative and founder chat after technical canary');
select throws_ok($q$select public.admin_private_beta_transition_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),'FOUNDER',6)$q$,'55000','PRIVATE_BETA_BUSINESS_UNVERIFIED','configured connection without protected permission read remains blocked');
select lives_ok($q$select pg_temp.business_seal(5101)$q$,'SQL-only Business permission fixture can seal expected identity; no Telegram call is made');
select lives_ok($q$select public.admin_private_beta_transition_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),'FOUNDER',6)$q$,'same owner can start founder scope after technical canary and permitted Business binding');
select is((select stage from private.private_beta_programs where id=pg_temp.beta_id(5101,'3000')),'FOUNDER','native program advances without financial or friend activation');
select is(public.admin_private_beta_workspace_v1(pg_temp.beta_id(5101,'2000'))->'program'->>'founder_limit','20','personal conversation retains20reply ceiling');
select throws_ok($q$select public.admin_private_beta_transition_v1(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5101,'3000'),'FRIENDS',7)$q$,'42501','PRIVATE_BETA_OWNER_ONLY','successful local founder scope never grants friends');

select private.private_beta_founder_model_record(pg_temp.beta_id(5103,'2000'),pg_temp.beta_id(5103,'3000'),pg_temp.founder_model_fixture(5103)::text);
select pg_temp.founder_local_canary(5103);
select pg_temp.founder_local_record(5103,pg_temp.founder_observed_result()||'{"input_tokens":0,"output_tokens":0}'::jsonb);
select is(private.private_beta_exposure(pg_temp.beta_id(5103,'3000')),4.628448::numeric,'zero usage cannot erase a reserved charge');
select is((select stage from private.private_beta_programs where id=pg_temp.beta_id(5103,'3000')),'STOPPED','zero usage is a stop condition rather than technical acceptance');
select is(private.private_beta_founder_canary_hash((select p from private.private_beta_programs p where id=pg_temp.beta_id(5103,'3000'))),null,'zero usage cannot authorize founder');
select throws_ok($q$select pg_temp.founder_local_prepare(5103)$q$,'42501','PRIVATE_BETA_OWNER_TEST_UNAVAILABLE','stopped personal test cannot reset itself with another prepare');
select throws_ok($q$update private.private_beta_programs set request_count=0 where id=pg_temp.beta_id(5103,'3000')$q$,'42501','PRIVATE_BETA_IMMUTABLE','stopped attempts remain permanently counted');

select private.private_beta_founder_model_record(pg_temp.beta_id(5104,'2000'),pg_temp.beta_id(5104,'3000'),pg_temp.founder_model_fixture(5104)::text);
select pg_temp.founder_local_canary(5104);
select pg_temp.founder_local_record(5104,pg_temp.beta_outcome('UNKNOWN','RESULT_UNKNOWN','NOT_EVALUATED'));
select is(private.private_beta_exposure(pg_temp.beta_id(5104,'3000')),4.628448::numeric,'unknown completion retains its entire original reservation');
select is(public.private_beta_account_control_v1(pg_temp.beta_id(5104,'2000'),pg_temp.beta_id(5104,'3000'))->'payload'->>'unknown_outcome_count','1','unknown outcomes are derived live from journal evidence');
select is(private.private_beta_founder_canary_hash((select p from private.private_beta_programs p where id=pg_temp.beta_id(5104,'3000'))),null,'unknown completion cannot become a passed canary');
select is(public.private_beta_begin_v1(pg_temp.beta_id(5104,'2000'),pg_temp.beta_id(5104,'3000'),(select(canary->>'attempt_id')::uuid from private_beta_cases where n=5104),pg_temp.beta_id(5104,'5000'))->>'dispatch','false','unknown start cannot be dispatched again');
select throws_ok($q$update private.private_beta_programs set reserved_liability=0 where id=pg_temp.beta_id(5104,'3000')$q$,'42501','PRIVATE_BETA_IMMUTABLE','unknown reservation history cannot be reset');

select private.private_beta_founder_model_record(pg_temp.beta_id(5105,'2000'),pg_temp.beta_id(5105,'3000'),pg_temp.founder_model_fixture(5105)::text);
select pg_temp.founder_local_canary(5105);
select pg_temp.founder_local_record(5105,pg_temp.founder_observed_result()||'{"input_tokens":1050001}'::jsonb);
select is(private.private_beta_exposure(pg_temp.beta_id(5105,'3000')),4.628448::numeric,'usage beyond the reserved model capacity never reduces exposure');
select is((select stage from private.private_beta_programs where id=pg_temp.beta_id(5105,'3000')),'STOPPED','usage beyond the full-context bound stops further dispatch');
select is((select stop_reason from private.jeff_experiment_runs where id=(select canary_run_id from private.private_beta_programs where id=pg_temp.beta_id(5105,'3000'))),'OWNER_UAT_USAGE_BOUND_UNVERIFIED','usage-bound failure has a durable explicit reason');
select is((select count(*)from private.verified_payment_receipts where tenant_id in(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5103,'2000'),pg_temp.beta_id(5104,'2000'),pg_temp.beta_id(5105,'2000'))),0::bigint,'personal tests never create a genuine financial receipt');
select is((select count(*)from public.subscriptions where tenant_id in(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5103,'2000'),pg_temp.beta_id(5104,'2000'),pg_temp.beta_id(5105,'2000'))),0::bigint,'personal tests never grant a paid subscription or VIP entitlement');
select ok(not exists(select 1 from public.tenants where id in(pg_temp.beta_id(5101,'2000'),pg_temp.beta_id(5103,'2000'),pg_temp.beta_id(5104,'2000'),pg_temp.beta_id(5105,'2000'))and outbound_messaging_enabled),'general tenant outbound switches remain disabled');
select *from finish();
rollback;
