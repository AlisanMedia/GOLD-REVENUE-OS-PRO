-- FROZEN BEFORE-RENAME disposable fixture from protected source 96aa1c83dab1ffaff0975dfa0f62d33c38c48d8f.
-- Deliberately retains the factual old identity; no provider network or acceptance.
begin;
-- SQL-only fixtures. No account, token, inference, provider billing or customer acceptance.
create temp table private_beta_cases(n integer primary key,config jsonb,program uuid,invite jsonb,ingest jsonb,canary jsonb);
create function pg_temp.beta_id(n integer,k text)returns uuid language sql immutable as $$select('9b00'||k||'-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.beta_auth(n integer,kind text default 'owner',aal_value text default 'aal2',age_value integer default 0)returns void language plpgsql as $$declare uid uuid;begin
 uid:=pg_temp.beta_id(n,case kind when 'owner'then '1000'when 'support'then '1001'when 'analyst'then '1002'when 'readonly'then '1003'else '1004'end);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','aal',aal_value,'iat',floor(extract(epoch from clock_timestamp())),'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp()))-age_value)))::text,true);
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claim.role','authenticated',true);
end;$$;
create function pg_temp.beta_setup(n integer)returns void language plpgsql as $$declare t uuid:=pg_temp.beta_id(n,'2000');p uuid:=pg_temp.beta_id(n,'3000');c jsonb;u integer;begin
 for u in 0..4 loop insert into auth.users(id)values(pg_temp.beta_id(n,(1000+u)::text));end loop;
 insert into public.tenants(id,name,slug)values(t,'Synthetic private beta fixture','private-beta-fixture-'||n);
 insert into public.tenant_members(tenant_id,user_id,role)values(t,pg_temp.beta_id(n,'1000'),'super_admin'),(t,pg_temp.beta_id(n,'1001'),'support'),(t,pg_temp.beta_id(n,'1002'),'analyst'),(t,pg_temp.beta_id(n,'1003'),'readonly'),(t,pg_temp.beta_id(n,'1004'),'manager');
 c:=jsonb_build_object('repository_sha',repeat('a',40),'starts_at',to_char((clock_timestamp()-interval '1 minute')at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'expires_at',to_char((clock_timestamp()+interval '1 hour')at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'retention_days',7,'notice_version','polat-private-beta-notice-v1','primary_operator',pg_temp.beta_id(n,'1004'),'backup_operator',pg_temp.beta_id(n,'1000'));
 perform pg_temp.beta_auth(n);perform public.admin_private_beta_create_v1(t,p,c::text);insert into private_beta_cases(n,config,program)values(n,c,p);
end;$$;
create function pg_temp.beta_account(n integer,canary_hash text default null)returns void language plpgsql as $$declare x private.private_beta_programs;payload jsonb;pricing jsonb;begin
 select * into strict x from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');
 payload:=jsonb_build_object('version',1,'origin','INDEPENDENT_ACCOUNT_CONTROL','program_id',x.id,'tenant_id',x.tenant_id,'account_scope_hash',private.fse_hash('fixture-account-'||n),'workspace_id','wrkspc_fixture_'||n,'repository_sha',x.configuration->>'repository_sha','manifest_hash',x.manifest_hash,'authorization_record_hash',x.authorization_record_hash,'provider','anthropic','model','claude-haiku-5-5','model_access',true,'policy_hash',repeat('b',64),'credential_custody_hash',repeat('c',64),'region_evidence_hash',repeat('d',64),'retention_evidence_hash',repeat('e',64),'training_evidence_hash',repeat('f',64),'effective_limit_kind','ENFORCED_EXPERIMENT_HARD_CAP','currency','USD','enforced_maximum_spend','5.00','independently_observed_spend','0.00','remaining_allowance','5.00','billing_state','RECONCILED','billing_evidence_hash',repeat('b',64),'canary_reconciliation_hash',canary_hash,'unknown_outcome_count',0,'request_bound',null,'observed_at',clock_timestamp(),'expires_at',clock_timestamp()+interval '4 minutes');
 pricing:=jsonb_build_object('version',1,'origin','INDEPENDENT_OFFICIAL_PRICING_READ','model','claude-haiku-5-5','currency','USD','source_url','https://platform.claude.com/docs/en/models/haiku-5-5/overview','source_hash',repeat('a',64),'maximum_input_tokens',1000000,'maximum_input_usd_per_million','0.50','maximum_output_usd_per_million','2.50','observed_at',clock_timestamp(),'expires_at',clock_timestamp()+interval '1 day','all_billable_components_covered',true);
 perform private.private_beta_account_control_record(x.tenant_id,x.id,jsonb_build_object('payload',payload,'pricing',pricing)::text);
end;$$;
create function pg_temp.beta_bot(n integer)returns void language plpgsql as $$begin
 perform private.private_beta_bot_control_record(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),jsonb_build_object('version',1,'bot_id',(7000000+n)::text,'source_hash',repeat('d',64),'observed_at',clock_timestamp(),'api_environment','production','credential_sha256',repeat('e',64))::text);
end;$$;
create function pg_temp.beta_canary(n integer)returns jsonb language plpgsql as $$declare r jsonb;begin
 perform pg_temp.beta_account(n);perform pg_temp.beta_auth(n);perform public.admin_private_beta_transition_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),'CANARY',1);
 r:=public.private_beta_reserve_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),pg_temp.beta_id(n,'4000'),repeat('a',64),repeat('b',64),null,'0.50128',pg_temp.beta_id(n,'4001'));
 update private_beta_cases set canary=r where private_beta_cases.n=$1;return r;
end;$$;
create function pg_temp.beta_outcome(status_value text default 'SUCCEEDED',stage_value text default 'PROVIDER_RESULT',qa_value text default 'APPROVED')returns jsonb language sql as $$
 select jsonb_build_object('version',1,'stage',stage_value,'status',status_value,'response_hash',case when status_value='SUCCEEDED'then repeat('a',64)end,'response_identity_hash',case when status_value='SUCCEEDED'then private.fse_hash(extensions.gen_random_uuid()::text)end,'elapsed_ms','12.5','input_tokens',case when status_value='SUCCEEDED'then 5 end,'output_tokens',case when status_value='SUCCEEDED'then 10 end,'qa',qa_value,'actual_billed_amount',null,'actual_billed_currency',null,'financial_authority','NONE','error_code',case when status_value<>'SUCCEEDED'then 'PROVIDER_TIMEOUT'end,'provider_usage_hash',case when status_value='SUCCEEDED'then repeat('c',64)end)
$$;
create function pg_temp.beta_founder(n integer)returns void language plpgsql as $$declare r jsonb;x private.private_beta_programs;begin
 r:=pg_temp.beta_canary(n);perform public.private_beta_begin_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),(r->>'attempt_id')::uuid,pg_temp.beta_id(n,'5000'));
 perform public.private_beta_record_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),(r->>'attempt_id')::uuid,pg_temp.beta_id(n,'5000'),pg_temp.beta_outcome()::text);
 select * into x from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');
 perform private.private_beta_reconcile_attempt(x.tenant_id,x.id,(r->>'attempt_id')::uuid,jsonb_build_object('version',1,'origin','INDEPENDENT_PROVIDER_BILLING','coverage','COMPLETE_REQUEST_CHARGE','account_scope_hash',x.account_control->>'account_scope_hash','request_hash',repeat('a',64),'actual_billed_amount','0.000025','currency','USD','source_hash',repeat('f',64),'observed_at',clock_timestamp())::text);
 perform pg_temp.beta_account(n,repeat('f',64));perform pg_temp.beta_bot(n);perform pg_temp.beta_auth(n);perform public.admin_private_beta_transition_v1(x.tenant_id,x.id,'FOUNDER',2);
end;$$;
create function pg_temp.beta_notice_ack(n integer)returns void language plpgsql as $$declare a private.private_beta_participants;x private.private_beta_programs;c public.conversations;r jsonb;begin
 select * into strict a from private.private_beta_participants where program_id=pg_temp.beta_id(n,'3000')and kind='FOUNDER';select * into strict x from private.private_beta_programs where id=a.program_id;
 r:=public.ingest_telegram_message(a.tenant_id,'beta-notice-'||n,'1',a.provider_chat_id,a.provider_user_id,null,null,null,'/start [REDACTED]',null,clock_timestamp());
 select * into strict c from public.conversations where tenant_id=a.tenant_id and id=(r->>'conversation_id')::uuid;
 -- This is a deterministic SQL fixture ACK, never real Telegram evidence.
 insert into public.messages(tenant_id,conversation_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_message_id,provider_chat_id,idempotency_key,actor_type,actor_id,correlation_id,occurred_at,provider_acknowledged_at)
 values(a.tenant_id,c.id,c.messaging_contact_id,c.provider_connection_id,'outbound','text',private.private_beta_notice((x.configuration->>'retention_days')::int),'sent','2',a.provider_chat_id,'private-beta-notice:'||a.id::text||':'||a.notice_version,'SYSTEM','private-beta-notice',extensions.gen_random_uuid(),clock_timestamp(),clock_timestamp());
end;$$;
create function pg_temp.beta_enroll(n integer)returns void language plpgsql as $$declare t uuid:=pg_temp.beta_id(n,'2000');p uuid:=pg_temp.beta_id(n,'3000');a private.private_beta_participants;i jsonb;r jsonb;c public.conversations;def uuid;v uuid;task_id uuid;runid uuid:=pg_temp.beta_id(n,'8000');begin
 perform pg_temp.beta_founder(n);perform pg_temp.beta_auth(n);i:=public.admin_private_beta_invite_v1(t,p,'FOUNDER',pg_temp.beta_id(n,'6000'));
 perform public.private_beta_invite_accept_v1(t,(7000000+n)::text,(5000000+n)::text,(5000000+n)::text,'/start '||(i->>'code'));perform pg_temp.beta_notice_ack(n);
 perform public.private_beta_invite_accept_v1(t,(7000000+n)::text,(5000000+n)::text,(5000000+n)::text,'/agree');
 select * into strict a from private.private_beta_participants where program_id=p and kind='FOUNDER';select * into strict c from public.conversations where tenant_id=t and provider_conversation_id=a.provider_chat_id;
 if to_regprocedure('public.admin_private_beta_operator_accept_v1(uuid,uuid)')is not null then perform public.admin_private_beta_operator_accept_v1(t,p);end if;
 perform public.private_beta_bind_conversation_v1(t,a.id,c.id);
 r:=public.ingest_telegram_message(t,'beta-source-'||n,'3',a.provider_chat_id,a.provider_user_id,null,null,null,'Hi, tell me about this fictional private beta.',null,clock_timestamp());
 select * into strict a from private.private_beta_participants where id=a.id;select * into strict c from public.conversations where tenant_id=t and id=c.id;
 insert into public.agent_definitions(tenant_id,agent_type,name,default_execution_mode)values(t,'private_beta_fixture','Private Beta SQL Fixture','HUMAN_APPROVAL')returning id into def;
 insert into public.agent_versions(tenant_id,agent_definition_id,version,prompt_template,output_schema_version,model_provider,model_name,timeout_ms,max_attempts,prompt_version)values(t,def,1,'Offline SQL fixture; no provider effects.',4,'anthropic','claude-haiku-5-5',10000,1,'polat-private-beta-v1')returning id into v;
 insert into public.agent_tasks(tenant_id,agent_definition_id,agent_version_id,customer_id,conversation_id,source_event_id,task_type,objective,execution_mode,status,idempotency_key,correlation_id,attempts,max_attempts)
 values(t,def,v,c.customer_id,c.id,(r->>'event_id')::uuid,'private_beta.reply','SQL fixture reservation acceptance only','HUMAN_APPROVAL','RUNNING','beta-source:'||n,extensions.gen_random_uuid(),1,1)returning id into task_id;
 insert into public.agent_runs(id,tenant_id,task_id,agent_version_id,attempt_number,execution_mode,worker_id,context_manifest,model_provider,model_name)
 values(runid,t,task_id,v,1,'HUMAN_APPROVAL','beta-sql-fixture',jsonb_build_object('polat_profile','polat-private-beta-v1','private_beta_program_id',p,'private_beta_participant_id',a.id,'private_beta_revision',a.revision::text),'anthropic','claude-haiku-5-5');
 update private_beta_cases set invite=i,ingest=r where private_beta_cases.n=$1;
end;$$;
create function pg_temp.beta_next_source(n integer,turn_value integer)returns uuid language plpgsql as $$declare t uuid:=pg_temp.beta_id(n,'2000');p uuid:=pg_temp.beta_id(n,'3000');a private.private_beta_participants;c public.conversations;r jsonb;v public.agent_versions;task_id uuid;runid uuid:=pg_temp.beta_id(n*100+turn_value,'8000');begin
 select * into strict a from private.private_beta_participants where program_id=p and kind='FOUNDER';select * into strict c from public.conversations where tenant_id=t and id=a.conversation_id;
 r:=public.ingest_telegram_message(t,'beta-source-'||n||'-'||turn_value,(10+turn_value)::text,a.provider_chat_id,a.provider_user_id,null,null,null,'Another fictional beta question number '||turn_value,null,clock_timestamp());
 select * into strict a from private.private_beta_participants where id=a.id;select * into v from public.agent_versions where tenant_id=t and model_provider='anthropic'and model_name='claude-haiku-5-5'order by created_at desc limit 1;
 insert into public.agent_tasks(tenant_id,agent_definition_id,agent_version_id,customer_id,conversation_id,source_event_id,task_type,objective,execution_mode,status,idempotency_key,correlation_id,attempts,max_attempts)
 values(t,v.agent_definition_id,v.id,c.customer_id,c.id,(r->>'event_id')::uuid,'private_beta.reply','SQL fixture only','HUMAN_APPROVAL','RUNNING','beta-source:'||n||':'||turn_value,extensions.gen_random_uuid(),1,1)returning id into task_id;
 insert into public.agent_runs(id,tenant_id,task_id,agent_version_id,attempt_number,execution_mode,worker_id,context_manifest,model_provider,model_name)
 values(runid,t,task_id,v.id,1,'HUMAN_APPROVAL','beta-sql-fixture',jsonb_build_object('polat_profile','polat-private-beta-v1','private_beta_program_id',p,'private_beta_participant_id',a.id,'private_beta_revision',a.revision::text),'anthropic','claude-haiku-5-5');
 update private_beta_cases set ingest=r where private_beta_cases.n=$1;return runid;end;$$;
create function pg_temp.beta_friend_for_claim(n integer)returns void language plpgsql as $$declare t uuid:=pg_temp.beta_id(n,'2000');p uuid:=pg_temp.beta_id(n,'3000');a private.private_beta_participants;c public.conversations;x private.private_beta_programs;i jsonb;r jsonb;begin
 perform pg_temp.beta_auth(n);select * into strict x from private.private_beta_programs where id=p;perform public.admin_private_beta_transition_v1(t,p,'FRIENDS',x.generation);
 i:=public.admin_private_beta_invite_v1(t,p,'FRIEND',pg_temp.beta_id(n,'6100'));perform public.private_beta_invite_accept_v1(t,(7000000+n)::text,(6000000+n)::text,(6000000+n)::text,'/start '||(i->>'code'));
 select * into strict a from private.private_beta_participants where program_id=p and kind='FRIEND';
 r:=public.ingest_telegram_message(t,'beta-friend-notice-'||n,'1',a.provider_chat_id,a.provider_user_id,null,null,null,'/start [REDACTED]',null,clock_timestamp());select * into strict c from public.conversations where tenant_id=t and id=(r->>'conversation_id')::uuid;
 insert into public.messages(tenant_id,conversation_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_message_id,provider_chat_id,idempotency_key,actor_type,actor_id,correlation_id,occurred_at,provider_acknowledged_at)
 values(t,c.id,c.messaging_contact_id,c.provider_connection_id,'outbound','text',private.private_beta_notice((x.configuration->>'retention_days')::int),'sent','2',a.provider_chat_id,'private-beta-notice:'||a.id::text||':'||a.notice_version,'SYSTEM','private-beta-notice',extensions.gen_random_uuid(),clock_timestamp(),clock_timestamp());
 perform public.private_beta_invite_accept_v1(t,(7000000+n)::text,a.provider_user_id,a.provider_chat_id,'/agree');perform public.private_beta_bind_conversation_v1(t,a.id,c.id);
 perform public.ingest_telegram_message(t,'beta-friend-question-'||n,'3',a.provider_chat_id,a.provider_user_id,null,null,null,'A fictional beta question from a separate invited friend.',null,clock_timestamp());end;$$;
-- PostgreSQL fixtures only. These are not genuine account, spending or billing proofs.
create function pg_temp.beta_openai_envelope(n integer)returns jsonb language plpgsql as $$
declare x private.private_beta_programs;at_value timestamptz:=clock_timestamp();payload jsonb;pricing jsonb;begin
 select * into strict x from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');
 payload:=jsonb_build_object('version',2,'origin','INDEPENDENT_ACCOUNT_CONTROL','program_id',x.id,'tenant_id',x.tenant_id,
 'organization_id','org-fixture-'||n,'project_id','proj_fixture_'||n,'account_scope_hash',private.fse_hash(private.fse_canonical(jsonb_build_array('OPENAI_PROJECT1','org-fixture-'||n,'proj_fixture_'||n))),
 'credential_sha256',repeat('1',64),'repository_sha',x.configuration->>'repository_sha','manifest_hash',x.manifest_hash,'authorization_record_hash',x.authorization_record_hash,
 'provider','openai','model','gpt-6.1-sol','model_access',true,'policy_hash',repeat('b',64),'credential_custody_hash',repeat('c',64),'region_evidence_hash',repeat('d',64),'retention_evidence_hash',repeat('e',64),'training_evidence_hash',repeat('f',64),
 'effective_limit_kind','ENFORCED_EXPERIMENT_HARD_CAP','currency','USD','enforced_maximum_spend','5.00','independently_observed_spend','0','remaining_allowance','5.00','billing_state','RECONCILED','billing_evidence_hash',repeat('b',64),
 'canary_reconciliation_hash',null,'unknown_outcome_count',0,'request_bound',null,'observed_at',at_value,'expires_at',at_value+interval '4 minutes');
 pricing:=jsonb_build_object('version',2,'origin','INDEPENDENT_OFFICIAL_PRICING_READ','model','gpt-6.1-sol','currency','USD','source_url','https://developers.openai.com/api/docs/pricing','source_hash',repeat('a',64),
 'maximum_input_tokens',1050000,'maximum_input_usd_per_million','4.00','maximum_output_usd_per_million','15.00','observed_at',at_value,'expires_at',at_value+interval '1 day','all_billable_components_covered',true);
 return jsonb_build_object('payload',payload,'pricing',pricing);end;$$;
-- Load the real temporary read-only backup predicates, before these fixtures.

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

select pg_temp.recovery_unknown(6201);
select pg_temp.recovery_observe(6201);
select pg_temp.recovery_start(6201);
create temp table recovery_new as select public.private_beta_reserve_v1(pg_temp.beta_id(6201,'2000'),pg_temp.beta_id(6201,'3000'),pg_temp.beta_id(6201,'4002'),repeat('d',64),repeat('e',64),null,'0.0264704',pg_temp.beta_id(6201,'4003'))as receipt;
select public.private_beta_begin_v1(pg_temp.beta_id(6201,'2000'),pg_temp.beta_id(6201,'3000'),(select(receipt->>'attempt_id')::uuid from recovery_new),pg_temp.beta_id(6201,'5002'));
select public.private_beta_record_v1(pg_temp.beta_id(6201,'2000'),pg_temp.beta_id(6201,'3000'),(select(receipt->>'attempt_id')::uuid from recovery_new),pg_temp.beta_id(6201,'5002'),(pg_temp.beta_outcome('UNKNOWN','RESULT_UNKNOWN','NOT_EVALUATED')||jsonb_build_object('error_code','OPENAI_UAT_ENVELOPE_INVALID'))::text);
create table private.identity_before_test as
 select c.oid object_id,n.nspname,c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'and c.relkind='r';
create table private.identity_program_before_test as select to_jsonb(p)row_value from private.private_beta_programs p;
create table private.identity_runs_before_test as select to_jsonb(p)row_value from private.polat_experiment_runs p;
create table private.identity_attempts_before_test as select to_jsonb(p)row_value from private.polat_experiment_attempts p;
create table private.identity_evidence_before_test as select to_jsonb(p)row_value from private.polat_experiment_evidence p;
create table private.identity_rpc_before_test as select p.proname,p.proargtypes,p.proacl,p.proowner,p.proconfig,p.prosecdef,p.provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like '%polat%';
insert into public.tenants(id,name,slug)values('807b9abb-af42-45a8-bf7f-1436d7af384e','Polat VIP','private-beta-identity-owner');
insert into public.agent_definitions(id,tenant_id,agent_type,name,enabled,default_execution_mode)values('807b9abb-af42-45a8-bf7f-1436d7af3850','807b9abb-af42-45a8-bf7f-1436d7af384e','conversation_shadow','Polat Operations',true,'SHADOW');
insert into public.agent_versions(tenant_id,agent_definition_id,version,prompt_template,output_schema_version,allowed_tools,model_provider,model_name,timeout_ms,max_attempts,prompt_version)values('807b9abb-af42-45a8-bf7f-1436d7af384e','807b9abb-af42-45a8-bf7f-1436d7af3850',1,'Represent Polat VIP support. Never claim verified payments without evidence.',4,array[]::text[],'openai','gpt-6.1-sol',10000,1,'fixture-prompt-v1');
insert into public.tenants(id,name,slug)values('807b9abb-af42-45a8-bf7f-1436d7af384f','Unrelated Polat person','unrelated-identity-fixture');
commit;
