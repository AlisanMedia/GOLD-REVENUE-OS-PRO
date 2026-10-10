begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public','conversation_quality_configs','versioned quality configuration exists');
select has_table('public','conversation_quality_evaluations','append-only quality evidence exists');
select has_table('public','agent_memory_proposals','memory proposals are isolated from durable memory');
select has_table('public','agent_proposal_review_evidence','human review evidence exists');
select has_table('public','conversation_evaluation_results','evaluation dataset result framework exists');
select ok(not has_table_privilege('authenticated','public.conversation_quality_evaluations','INSERT'),'browser cannot forge QA evidence');
select ok(not has_table_privilege('authenticated','public.agent_memory_proposals','UPDATE'),'browser cannot accept model memory directly');
select ok(not has_function_privilege('authenticated','public.activate_phase7_openai_shadow(uuid,text)','EXECUTE'),'browser cannot activate a model provider');
select ok(has_function_privilege('service_role','public.activate_phase7_openai_shadow(uuid,text)','EXECUTE'),'service role may activate an explicitly configured shadow provider');
select ok(not has_function_privilege('authenticated','public.retry_resolved_agent_dead_letters(uuid,text,text,integer)','EXECUTE'),'browser cannot recover dead-letter tasks');
select ok(has_function_privilege('service_role','public.retry_resolved_agent_dead_letters(uuid,text,text,integer)','EXECUTE'),'service role may perform an explicit audited provider recovery');
select ok(not has_function_privilege('authenticated','public.complete_quality_agent_run(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text[],integer,boolean,text,text,text,integer,integer,integer,text)','EXECUTE'),'browser cannot complete model runs');

insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at) values
('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase7-manager@example.test','not-used',now()),
('a1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase7-analyst@example.test','not-used',now()),
('a1000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase7-other@example.test','not-used',now());
insert into public.tenants (id,name,slug) values
('a2000000-0000-4000-8000-000000000001','Phase 7 Tenant A','phase7-tenant-a'),
('a2000000-0000-4000-8000-000000000002','Phase 7 Tenant B','phase7-tenant-b');
insert into public.tenant_members (tenant_id,user_id,role) values
('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','manager'),
('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','analyst'),
('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003','manager');
insert into public.customers (id,tenant_id,display_name) values
('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Quality Fixture');
insert into public.customer_identities (tenant_id,customer_id,identity_type,identity_value,normalized_value) values
('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','telegram_user_id','777','777');

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$
  select public.ingest_telegram_message(
    'a2000000-0000-4000-8000-000000000001','phase7-update-safe','701','777','777',
    'quality_fixture','Quality','Fixture','Selam, bilgi alabilir miyim?',null,now()
  )
$$,'safe fixture is ingested');
select lives_ok($$
  select public.ingest_telegram_message(
    'a2000000-0000-4000-8000-000000000001','phase7-update-risk','702','777','777',
    'quality_fixture','Quality','Fixture','Ödedim ama sistemde görünmüyor',null,now()
  )
$$,'high-risk fixture is ingested');

select lives_ok($test$
do $body$
declare event_value record;
begin
  for event_value in
    select de.tenant_id,de.id from public.domain_events de
    join public.messages m on m.id=(de.payload->>'message_id')::uuid
    where de.event_type='message.received' and m.content in ('Selam, bilgi alabilir miyim?','Ödedim ama sistemde görünmüyor')
  loop
    perform public.begin_event_consumption(event_value.tenant_id,event_value.id,'agent-runtime.v1','phase7-event-worker');
    perform public.consume_event_for_agent_runtime(event_value.tenant_id,event_value.id,'phase7-event-worker');
    perform public.complete_event_consumption(event_value.tenant_id,event_value.id,'agent-runtime.v1','phase7-event-worker','ok');
  end loop;
end
$body$
$test$,'message events create idempotent quality tasks');

update public.agent_tasks set status='DEAD_LETTER',failure_category='MODEL_RATE_LIMIT',
  failure_code='OPENAI_credit_balance_exhausted',completed_at=now()
where id=(select id from public.agent_tasks where tenant_id='a2000000-0000-4000-8000-000000000001'
  order by id limit 1);
select is(
  (public.retry_resolved_agent_dead_letters(
    'a2000000-0000-4000-8000-000000000001','OPENAI_credit_balance_exhausted',
    'billing restored by owner',1
  )->>'requeued')::integer,
  1,
  'operator recovery requeues one eligible dead-letter task'
);
select is((select count(*) from public.audit_logs where tenant_id='a2000000-0000-4000-8000-000000000001'
  and action='agent.dead_letters_requeued'),1::bigint,'dead-letter recovery is audited');
select throws_ok(
  $$select public.retry_resolved_agent_dead_letters(
    'a2000000-0000-4000-8000-000000000001','OPENAI_arbitrary_error','invalid',1)$$,
  '22023','failure code is not eligible for operator recovery',
  'arbitrary failures cannot be operator-requeued through the quota recovery path'
);

select is((select count(*) from public.claim_agent_tasks('phase7-worker',10,120)),2::bigint,'quality worker claims both tasks');

select lives_ok($test$
do $body$
declare task_value record; run_id_value uuid; risky boolean; output_value jsonb;
begin
  for task_value in
    select at.*,m.content from public.agent_tasks at
    join public.domain_events de on de.id=at.source_event_id
    join public.messages m on m.id=(de.payload->>'message_id')::uuid
    where at.tenant_id='a2000000-0000-4000-8000-000000000001'
  loop
    risky:=task_value.content like 'Ödedim%';
    run_id_value:=public.begin_agent_run(task_value.tenant_id,task_value.id,'phase7-worker',
      jsonb_build_object('context_version',3,'message_count',1,'source_event_id',task_value.source_event_id,
        'source_message_id',(select payload->>'message_id' from public.domain_events where tenant_id=task_value.tenant_id and id=task_value.source_event_id),
        'included_message_ids',jsonb_build_array((select payload->>'message_id' from public.domain_events where tenant_id=task_value.tenant_id and id=task_value.source_event_id)),
        'knowledge_sources',jsonb_build_array('conversation.recent_messages'),'secrets_included',false));
    output_value:=jsonb_build_object(
      'classification',case when risky then 'payment_not_reflected' else 'information_request' end,
      'semantic_response',jsonb_build_object(
        'response_goal',case when risky then 'Escalate payment mismatch safely.' else 'Answer concisely.' end,
        'key_points',jsonb_build_array('safe response'),
        'factual_grounding',jsonb_build_object(
          'classification',case when risky then 'unknown' else 'inferred' end,
          'evidence_refs',jsonb_build_array((select payload->>'message_id' from public.domain_events where tenant_id=task_value.tenant_id and id=task_value.source_event_id)),
          'missing_information',case when risky then jsonb_build_array('verified_payment_status') else '[]'::jsonb end
        )
      ),
      'proposed_response',case when risky then 'Ödemeyi doğrulamadan yorum yapamam; yetkili incelemesi gerekiyor.' else 'Merhaba! Nasıl yardımcı olabilirim?' end,
      'confidence',case when risky then 0.5 else 0.8 end,
      'escalation_recommended',risky,
      'escalation_category',case when risky then to_jsonb('payment_not_reflected'::text) else 'null'::jsonb end,
      'memory_proposals','[]'::jsonb,'proposed_tool_calls','[]'::jsonb
    );
    perform public.record_model_invocation(task_value.tenant_id,run_id_value,1,'generation','mock','deterministic-shadow-v1','SUCCEEDED','mock-request',null,null,null,1,null,'fingerprint');
    perform public.complete_quality_agent_run(
      task_value.tenant_id,run_id_value,'phase7-worker',output_value,
      jsonb_build_object('primary_intent',case when risky then 'payment_not_reflected' else 'information_request' end,'conversation_stage',case when risky then 'risk' else 'information' end,'response_goal',case when risky then 'Escalate payment mismatch safely.' else 'Answer concisely.' end,'information_gap',case when risky then 'verified payment status' else null end,'should_ask_question',false,'should_answer_directly',not risky,'should_sell',false,'should_wait',false,'should_escalate',risky,'desired_response_length','short','desired_style_profile','neutral'),
      '{"formality":"neutral","preferred_message_length":"short","emoji_tolerance":"none","jargon_level":"low","language":"tr","response_energy":"medium","confidence":0.8,"provenance":"bounded_conversation_inference"}'::jsonb,
      jsonb_build_object('robotic_language',0,'context_fit',90,'tone_fit',90,'excessive_length',0,'repetition',0,'sales_pressure',0,'factual_confidence',case when risky then 50 else 80 end,'policy_risk',0,'escalation_need',case when risky then 100 else 0 end),
      case when risky then 'block' else 'approve' end,
      case when risky then array['ESCALATION_REQUIRED']::text[] else '{}'::text[] end,
      0,risky,'mock','deterministic-shadow-v1','mock-request',null,null,1,'fingerprint'
    );
  end loop;
end
$body$
$test$,'quality runs persist director, style, QA and proposals without sending');

select is((select count(*) from public.conversation_quality_evaluations where tenant_id='a2000000-0000-4000-8000-000000000001'),2::bigint,'both quality evaluations are append-only evidence');
select is((select context_version from public.conversation_quality_configs where tenant_id='a2000000-0000-4000-8000-000000000001' and superseded_at is null),3,'active quality configuration uses source-message-anchored context v3');
select is((select count(*) from public.agent_tasks at join public.domain_events de on de.tenant_id=at.tenant_id and de.id=at.source_event_id join public.messages m on m.tenant_id=at.tenant_id and m.id=(de.payload->>'message_id')::uuid where at.tenant_id='a2000000-0000-4000-8000-000000000001' and m.conversation_id=at.conversation_id),2::bigint,'every quality task has an exact tenant-scoped source message anchor');
select is((select count(*) from public.agent_proposals where customer_facing_blocked),1::bigint,'high-risk proposal is blocked');
select is((select count(*) from public.messages where tenant_id='a2000000-0000-4000-8000-000000000001' and direction='outbound'),0::bigint,'quality generation never sends automatically');
select throws_ok(
  $$update public.conversation_quality_evaluations set qa_action='approve' where customer_facing_blocked$$,
  '42501','conversation_quality_evaluations is append-only','quality evidence cannot be rewritten'
);

reset role;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select throws_ok(
  format('select public.review_agent_proposal(%L,%L,%L,null,null,%L)',
    'a2000000-0000-4000-8000-000000000001',
    (select id::text from public.agent_proposals where tenant_id='a2000000-0000-4000-8000-000000000001' and not customer_facing_blocked),
    'approve','a4000000-0000-4000-8000-000000000001'),
  '42501','proposal review denied','analyst cannot approve a proposal'
);
select is((select count(*) from public.admin_agent_versions('a2000000-0000-4000-8000-000000000002')),0::bigint,'tenant A analyst cannot enumerate tenant B agent versions');

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select throws_ok(
  format('select public.review_agent_proposal(%L,%L,%L,null,null,%L)',
    'a2000000-0000-4000-8000-000000000001',
    (select id::text from public.agent_proposals where tenant_id='a2000000-0000-4000-8000-000000000001' and customer_facing_blocked),
    'approve','a4000000-0000-4000-8000-000000000002'),
  '42501','proposal blocked by quality policy','manager cannot override a high-risk block'
);
select lives_ok(
  format('select public.review_agent_proposal(%L,%L,%L,null,%L,%L)',
    'a2000000-0000-4000-8000-000000000001',
    (select id::text from public.agent_proposals where tenant_id='a2000000-0000-4000-8000-000000000001' and not customer_facing_blocked),
    'approve','reviewed','a4000000-0000-4000-8000-000000000003'),
  'manager approves a safe proposal without sending it'
);
select is((select count(*) from public.agent_proposal_review_evidence where tenant_id='a2000000-0000-4000-8000-000000000001'),1::bigint,'human decision evidence is preserved');
select is((select count(*) from public.messages where tenant_id='a2000000-0000-4000-8000-000000000001' and direction='outbound'),0::bigint,'approval alone still sends nothing');

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
update public.conversations set runtime_mode='AI_ACTIVE',human_takeover=false
where tenant_id='a2000000-0000-4000-8000-000000000001';
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok(
  format('select public.queue_approved_agent_proposal(%L,%L,%L)',
    'a2000000-0000-4000-8000-000000000001',
    (select id::text from public.agent_proposals where tenant_id='a2000000-0000-4000-8000-000000000001' and approval_status='approved'),
    'a4000000-0000-4000-8000-000000000004'),
  '42501','outbound messaging disabled','kill switch blocks approved AI draft sending'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
update public.tenants set outbound_messaging_enabled=true where id='a2000000-0000-4000-8000-000000000001';
update public.conversations set runtime_mode='HUMAN_TAKEOVER'
where tenant_id='a2000000-0000-4000-8000-000000000001';
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok(
  format('select public.queue_approved_agent_proposal(%L,%L,%L)',
    'a2000000-0000-4000-8000-000000000001',
    (select id::text from public.agent_proposals where tenant_id='a2000000-0000-4000-8000-000000000001' and approval_status='approved'),
    'a4000000-0000-4000-8000-000000000005'),
  '42501','human takeover blocks approved agent send','human takeover blocks the approved-draft send path'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
update public.conversations set runtime_mode='AI_ACTIVE',human_takeover=false
where tenant_id='a2000000-0000-4000-8000-000000000001';
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select lives_ok(
  format('select public.queue_approved_agent_proposal(%L,%L,%L)',
    'a2000000-0000-4000-8000-000000000001',
    (select id::text from public.agent_proposals where tenant_id='a2000000-0000-4000-8000-000000000001' and approval_status='approved'),
    'a4000000-0000-4000-8000-000000000006'),
  'explicit approved send queues exactly one provider message after every gate'
);
select lives_ok(
  format('select public.queue_approved_agent_proposal(%L,%L,%L)',
    'a2000000-0000-4000-8000-000000000001',
    (select id::text from public.agent_proposals where tenant_id='a2000000-0000-4000-8000-000000000001' and approval_status='approved'),
    'a4000000-0000-4000-8000-000000000007'),
  'approved send retry is idempotent'
);
select is((select count(*) from public.messages where tenant_id='a2000000-0000-4000-8000-000000000001' and direction='outbound'),1::bigint,'approved-draft idempotency creates one outbound record');
select is((select state from public.customers where id='a3000000-0000-4000-8000-000000000001'),'NEW'::public.customer_state,'conversation quality cannot mutate lifecycle state');

-- Corrective fixtures are transaction-local only; never used as live evidence.
reset role;
select has_table('public','quality_stage_evidence','original/rewrite evidence is persisted separately');
select has_table('public','memory_provenance_failures','provenance failures have append-only structured evidence');
select ok(not has_table_privilege('authenticated','public.quality_stage_evidence','INSERT'),'browser cannot fabricate generation evidence');
select ok(not has_function_privilege('authenticated','public.record_quality_stage_evidence(uuid,uuid,text,integer,jsonb)','EXECUTE'),'browser cannot append model stage evidence');

update public.agent_runs r set context_manifest=jsonb_build_object(
  'context_version',3,'manifest_version',2,'source_event_id',t.source_event_id,
  'source_message_id',de.payload->>'message_id',
  'included_message_ids',jsonb_build_array(de.payload->>'message_id')
)
from public.agent_tasks t join public.domain_events de on de.tenant_id=t.tenant_id and de.id=t.source_event_id
where r.tenant_id=t.tenant_id and r.task_id=t.id and r.tenant_id='a2000000-0000-4000-8000-000000000001';

insert into public.agent_memory_proposals(tenant_id,run_id,customer_id,memory_key,proposed_value,classification,confidence,provenance_message_ids)
select r.tenant_id,r.id,t.customer_id,'preferred_language','Turkish','explicit_customer_fact',0.9,
  array[(de.payload->>'message_id')::uuid]
from public.agent_runs r join public.agent_tasks t on t.tenant_id=r.tenant_id and t.id=r.task_id
join public.domain_events de on de.tenant_id=t.tenant_id and de.id=t.source_event_id
where r.tenant_id='a2000000-0000-4000-8000-000000000001' order by r.id limit 1;
select is((select classification from public.agent_memory_proposals where memory_key='preferred_language'),'inferred_preference','inferred language is not an explicit customer fact');
select is((select status from public.agent_memory_proposals where memory_key='preferred_language'),'pending','valid bounded provenance may wait for human review');

insert into public.agent_memory_proposals(tenant_id,run_id,customer_id,memory_key,proposed_value,classification,confidence,provenance_message_ids)
select r.tenant_id,r.id,t.customer_id,'bad_reference','fixture','temporary_context',0.9,
  array[(de.payload->>'message_id')::uuid,'a9000000-0000-4000-8000-000000000099'::uuid]
from public.agent_runs r join public.agent_tasks t on t.tenant_id=r.tenant_id and t.id=r.task_id
join public.domain_events de on de.tenant_id=t.tenant_id and de.id=t.source_event_id
where r.tenant_id='a2000000-0000-4000-8000-000000000001' order by r.id limit 1;
select is((select status from public.agent_memory_proposals where memory_key='bad_reference'),'rejected','one bad UUID rejects the entire proposal, not just the UUID');
select is((select cardinality(provenance_message_ids) from public.agent_memory_proposals where memory_key='bad_reference'),2,'failure keeps the full rejected proposal provenance');
select is((select count(*) from public.memory_provenance_failures),1::bigint,'rejection has structured evidence');
update public.agent_memory_proposals set status='accepted' where memory_key='bad_reference';
select is((select status from public.agent_memory_proposals where memory_key='bad_reference'),'rejected','invalid pending/rejected memory can never become accepted');

insert into public.agent_memory_proposals(tenant_id,run_id,customer_id,memory_key,proposed_value,classification,confidence,provenance_message_ids)
select r.tenant_id,r.id,null,'wrong_customer','fixture','temporary_context',0.9,
  array[(r.context_manifest->>'source_message_id')::uuid]
from public.agent_runs r where r.tenant_id='a2000000-0000-4000-8000-000000000001' order by r.id limit 1;
select is((select status from public.agent_memory_proposals where memory_key='wrong_customer'),'rejected','customer scope mismatch is rejected');

update public.agent_runs set status='RUNNING'
where tenant_id='a2000000-0000-4000-8000-000000000001';
update public.agent_tasks set status='RUNNING',locked_by='corrective-evidence-worker'
where tenant_id='a2000000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok(format('select public.record_quality_stage_evidence(%L,%L,%L,1,%L::jsonb)',
  'a2000000-0000-4000-8000-000000000001',(select id from public.agent_runs order by id limit 1),
  'corrective-evidence-worker','{"fixture":true,"stage":"generation"}'),'successful invocation stage is stored');
select throws_ok(format('select public.record_quality_stage_evidence(%L,%L,%L,2,%L::jsonb)',
  'a2000000-0000-4000-8000-000000000001',(select id from public.agent_runs order by id limit 1),
  'corrective-evidence-worker','{"fixture":true,"stage":"rewrite"}'),
  '55000','successful invocation required','rewrite evidence requires a real recorded successful invocation');
select throws_ok(format('select public.record_quality_stage_evidence(%L,%L,%L,1,%L::jsonb)',
  'a2000000-0000-4000-8000-000000000002',(select id from public.agent_runs order by id limit 1),
  'corrective-evidence-worker','{"fixture":true}'),
  '42501','quality stage lease unavailable','cross-tenant evidence write is denied');
reset role;
select throws_ok($$update public.quality_stage_evidence set evidence='{}'::jsonb$$,
  '42501','quality_stage_evidence is append-only','original output evidence is immutable');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.quality_stage_evidence),0::bigint,'other tenant cannot see stage evidence');
select is((select count(*) from public.memory_provenance_failures),0::bigint,'other tenant cannot see provenance failures');

-- All adversarial identities below are local transactional pgTAP fixtures.
reset role;
select ok(not has_function_privilege('authenticated','public.validate_agent_memory_provenance(uuid,uuid,uuid,uuid[])','EXECUTE'),'memory validation RPC is service-only');
create temporary table provenance_scope as
select r.tenant_id,r.id run_id,t.customer_id,t.conversation_id,m.id source_id,m.created_at source_at
from public.agent_runs r join public.agent_tasks t on t.tenant_id=r.tenant_id and t.id=r.task_id
join public.messages m on m.tenant_id=r.tenant_id and m.id::text=r.context_manifest->>'source_message_id'
where r.tenant_id='a2000000-0000-4000-8000-000000000001' order by r.id limit 1;

select public.ingest_telegram_message('a2000000-0000-4000-8000-000000000001','provenance-other-conversation','801','888','888',
  'local_fixture','Local','Fixture','LOCAL_PROVENANCE_OTHER_CONVERSATION',null,now());
select public.ingest_telegram_message('a2000000-0000-4000-8000-000000000002','provenance-other-tenant','802','999','999',
  'local_fixture','Local','Fixture','LOCAL_PROVENANCE_OTHER_TENANT',null,now());

insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,
  content,status,provider_chat_id,idempotency_key,actor_type,correlation_id,occurred_at,created_at)
select m.tenant_id,m.conversation_id,m.customer_id,m.messaging_contact_id,m.provider_connection_id,'inbound',
  fixture.content,'received',m.provider_chat_id,fixture.content,'SYSTEM',gen_random_uuid(),s.source_at+fixture.delta,s.source_at+fixture.delta
from provenance_scope s join public.messages m on m.tenant_id=s.tenant_id and m.id=s.source_id
cross join (values ('LOCAL_PROVENANCE_FUTURE',interval '1 minute'),('LOCAL_PROVENANCE_EXCLUDED',interval '-1 minute')) fixture(content,delta);

create temporary table provenance_cases as
select 'nonexistent' name,'a9000000-0000-4000-8000-000000000098'::uuid ref,'PROVENANCE_MESSAGE_NOT_AUTHORIZED' code
union all select 'other_conversation',id,'PROVENANCE_MESSAGE_NOT_AUTHORIZED' from public.messages where content='LOCAL_PROVENANCE_OTHER_CONVERSATION'
union all select 'other_tenant',id,'PROVENANCE_MESSAGE_NOT_AUTHORIZED' from public.messages where content='LOCAL_PROVENANCE_OTHER_TENANT'
union all select 'future',id,'PROVENANCE_AFTER_SOURCE_BOUNDARY' from public.messages where content='LOCAL_PROVENANCE_FUTURE'
union all select 'excluded',id,'PROVENANCE_NOT_IN_BOUNDED_CONTEXT' from public.messages where content='LOCAL_PROVENANCE_EXCLUDED';

select is(public.validate_agent_memory_provenance(s.tenant_id,s.run_id,s.customer_id,array[c.ref])->>'code',c.code,
  'server provenance RPC rejects '||c.name) from provenance_scope s cross join provenance_cases c;
select is(public.validate_agent_memory_provenance(s.tenant_id,s.run_id,s.customer_id,array[c.ref])->>'valid','false',
  'server provenance validity is false for '||c.name) from provenance_scope s cross join provenance_cases c;
select is(public.validate_agent_memory_provenance(s.tenant_id,s.run_id,s.customer_id,array[s.source_id])->>'code','PROVENANCE_VALID',
  'server provenance RPC permits exact bounded inbound source') from provenance_scope s;

insert into public.agent_memory_proposals(tenant_id,run_id,customer_id,memory_key,proposed_value,classification,confidence,provenance_message_ids)
select s.tenant_id,s.run_id,s.customer_id,'deterministic_'||c.name,'fixture','temporary_context',0.9,array[c.ref]
from provenance_scope s cross join provenance_cases c;
select is(p.status,'rejected','database trigger rejects '||c.name)
from provenance_cases c join public.agent_memory_proposals p on p.memory_key='deterministic_'||c.name;
update public.agent_memory_proposals set status='accepted' where memory_key like 'deterministic_%';
select is((select count(*) from public.agent_memory_proposals where memory_key like 'deterministic_%' and status='accepted'),0::bigint,
  'none of the five invalid provenance cases can become accepted');
select is((select count(distinct p.memory_key) from public.memory_provenance_failures f join public.agent_memory_proposals p on p.tenant_id=f.tenant_id and p.id=f.proposal_id
  where p.memory_key like 'deterministic_%'),5::bigint,'every invalid proposal has structured rejection evidence');

insert into public.agent_memory_proposals(tenant_id,run_id,customer_id,memory_key,proposed_value,classification,confidence,provenance_message_ids)
select tenant_id,run_id,customer_id,'deterministic_valid_pending','fixture','temporary_context',0.9,array[source_id] from provenance_scope;
select is((select status from public.agent_memory_proposals where memory_key='deterministic_valid_pending'),'pending','valid provenance stays pending without automatic acceptance');
select throws_ok(format('select private.assert_quality_output_refs(%L,%L,%L::jsonb)',s.tenant_id,s.run_id,
  '{"claims":[{"kind":"uncertainty","evidence_refs":["invented-message-id"]}]}'),
  '22023','EVIDENCE_REFERENCE_NOT_ALLOWED','database rejects fabricated references even on uncertainty claims') from provenance_scope s;
select throws_ok($$select private.resolve_quality_wire_refs('["EVIDENCE_MESSAGE_999"]','[{"handle":"EVIDENCE_CURRENT_MESSAGE","messageId":"real","direction":"inbound"}]')$$,
  '22023','EVIDENCE_REFERENCE_NOT_ALLOWED','database independently rejects unknown wire handles');
select throws_ok($$select private.resolve_quality_wire_refs('["EVIDENCE_CURRENT_MESSAGE"]','[{"handle":"EVIDENCE_CURRENT_MESSAGE","messageId":"real","direction":"outbound"}]',true)$$,
  '22023','EVIDENCE_REFERENCE_NOT_ALLOWED','database independently rejects outbound memory provenance');

-- New fixture proposals reuse valid immutable run/QA evidence; no live data is changed.
reset role;
select ok(not has_function_privilege('authenticated','public.queue_quality_approved_reply(uuid,uuid)','EXECUTE'),'browser cannot forge an automatic QA send');
select ok(not has_function_privilege('authenticated','public.claim_quality_reply_delivery(uuid,uuid)','EXECUTE'),'browser cannot claim an automatic send lease');
create temporary table auto_fixture as
select p.tenant_id,p.task_id,p.run_id,t.conversation_id,gen_random_uuid() as proposal_id
from public.agent_proposals p join public.agent_tasks t on t.id=p.task_id
join public.conversation_quality_evaluations q on q.run_id=p.run_id
where p.tenant_id='a2000000-0000-4000-8000-000000000001' and q.qa_action='approve'
order by p.created_at limit 1;
insert into public.agent_proposals(id,tenant_id,task_id,run_id,proposal_type,original_payload,approval_status,confidence)
select f.proposal_id,f.tenant_id,f.task_id,f.run_id,'message_draft',p.original_payload,'pending',p.confidence
from auto_fixture f join public.agent_proposals p on p.run_id=f.run_id limit 1;
select is(public.queue_quality_approved_reply(tenant_id,proposal_id)->>'queued','false','default-off conversation does not send automatically') from auto_fixture;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select throws_ok(format('select public.set_conversation_automatic_replies(%L,%L,true,gen_random_uuid())',tenant_id,conversation_id),
  '42501','automatic replies denied','analyst cannot enable automatic replies') from auto_fixture;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
select throws_ok(format('select public.set_conversation_automatic_replies(%L,%L,true,gen_random_uuid())',tenant_id,conversation_id),
  '42501','automatic replies denied','other tenant manager cannot enable automatic replies') from auto_fixture;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select is(public.set_conversation_automatic_replies(tenant_id,conversation_id,true,gen_random_uuid()),true,'manager enables only the target conversation') from auto_fixture;
update public.conversations set automatic_replies_enabled_at=now()+interval '1 second' where id=(select conversation_id from auto_fixture);
select is(public.queue_quality_approved_reply(tenant_id,proposal_id)->>'queued','false','historical source messages are never automatically sent') from auto_fixture;
update public.conversations set automatic_replies_enabled_at=now()-interval '1 second' where id=(select conversation_id from auto_fixture);
update public.tenants set outbound_messaging_enabled=false where id=(select tenant_id from auto_fixture);
select is(public.queue_quality_approved_reply(tenant_id,proposal_id)->>'queued','false','outbound kill switch stops automatic queuing') from auto_fixture;
update public.tenants set outbound_messaging_enabled=true where id=(select tenant_id from auto_fixture);
update public.conversations set runtime_mode='HUMAN_TAKEOVER',human_takeover=true where id=(select conversation_id from auto_fixture);
select is(public.queue_quality_approved_reply(tenant_id,proposal_id)->>'queued','false','human takeover stops automatic queuing') from auto_fixture;
update public.conversations set runtime_mode='AI_ACTIVE',human_takeover=false where id=(select conversation_id from auto_fixture);
update public.messaging_contacts set contactability='blocked' where id=(select messaging_contact_id from public.conversations where id=(select conversation_id from auto_fixture));
select is(public.queue_quality_approved_reply(tenant_id,proposal_id)->>'queued','false','blocked contact stops automatic queuing') from auto_fixture;
update public.messaging_contacts set contactability='user_initiated' where id=(select messaging_contact_id from public.conversations where id=(select conversation_id from auto_fixture));
update public.agent_proposals set customer_facing_blocked=true where id=(select proposal_id from auto_fixture);
select is(public.queue_quality_approved_reply(tenant_id,proposal_id)->>'queued','false','blocked QA proposal never queues') from auto_fixture;
update public.agent_proposals set customer_facing_blocked=false where id=(select proposal_id from auto_fixture);
select is(public.queue_quality_approved_reply(tenant_id,proposal_id)->>'queued','true','eligible new QA-approved reply queues automatically') from auto_fixture;
select is(public.queue_quality_approved_reply(tenant_id,proposal_id)->>'duplicate','true','repeated automatic queue is idempotent') from auto_fixture;
select is((select count(*) from public.messages where actor_id='quality-approved-reply'),1::bigint,'one automatic message exists');
update public.tenants set outbound_messaging_enabled=false where id=(select tenant_id from auto_fixture);
select is(public.claim_quality_reply_delivery(f.tenant_id,p.sent_message_id),false,'kill switch is rechecked at send time') from auto_fixture f join public.agent_proposals p on p.id=f.proposal_id;
update public.tenants set outbound_messaging_enabled=true where id=(select tenant_id from auto_fixture);
select is(public.claim_quality_reply_delivery(f.tenant_id,p.sent_message_id),true,'eligible send obtains its lease') from auto_fixture f join public.agent_proposals p on p.id=f.proposal_id;
select is(public.claim_quality_reply_delivery(f.tenant_id,p.sent_message_id),false,'overlapping dispatcher cannot obtain a second send lease') from auto_fixture f join public.agent_proposals p on p.id=f.proposal_id;
-- Local transactional burst fixtures only. Source reception order differs
-- from task creation order; no real inbound/provider send is fabricated.
reset role;
select ok(not has_function_privilege('authenticated','private.conversation_reply_source_ready(uuid,uuid)','EXECUTE'),'browser cannot bypass source ordering');
select public.ingest_telegram_message('a2000000-0000-4000-8000-000000000001','local-burst-1','1101','777','777','quality_fixture','Quality','Fixture','LOCAL_BURST_FIRST',null,now());
select public.ingest_telegram_message('a2000000-0000-4000-8000-000000000001','local-burst-2','1102','777','777','quality_fixture','Quality','Fixture','LOCAL_BURST_SECOND',null,now());
select public.ingest_telegram_message('a2000000-0000-4000-8000-000000000001','local-burst-3','1103','777','777','quality_fixture','Quality','Fixture','LOCAL_BURST_THIRD',null,now());
update public.conversations set automatic_replies_enabled_at=now()+interval '100 seconds' where id=(select conversation_id from auto_fixture);
update public.messages set created_at=now()+make_interval(secs=>101+(provider_message_id::integer-1101))
where tenant_id='a2000000-0000-4000-8000-000000000001' and provider_message_id in ('1101','1102','1103');
do $$ declare e record; begin
  for e in select de.tenant_id,de.id from public.domain_events de join public.messages m on m.tenant_id=de.tenant_id and m.id::text=de.payload->>'message_id'
    where de.event_type='message.received' and m.provider_message_id in ('1102','1103')
  loop
    perform public.begin_event_consumption(e.tenant_id,e.id,'agent-runtime.v1','local-burst');
    perform public.consume_event_for_agent_runtime(e.tenant_id,e.id,'local-burst');
    perform public.complete_event_consumption(e.tenant_id,e.id,'agent-runtime.v1','local-burst','ok');
  end loop;
end $$;
select is((select count(*) from public.claim_conversation_reply_tasks(f.tenant_id,f.conversation_id,'local-out-of-order',1,120)),0::bigint,
  'later scoped source cannot skip unconsumed earlier inbound') from auto_fixture f;
select is((select count(*) from public.claim_agent_tasks('local-out-of-order-cron',1,120)),0::bigint,
  'cron cannot skip unconsumed earlier inbound');
do $$ declare e record; begin
  select de.tenant_id,de.id into e from public.domain_events de join public.messages m on m.tenant_id=de.tenant_id and m.id::text=de.payload->>'message_id'
    where de.event_type='message.received' and m.provider_message_id='1101';
  perform public.begin_event_consumption(e.tenant_id,e.id,'agent-runtime.v1','local-burst');
  perform public.consume_event_for_agent_runtime(e.tenant_id,e.id,'local-burst');
  perform public.complete_event_consumption(e.tenant_id,e.id,'agent-runtime.v1','local-burst','ok');
end $$;
create temporary table burst_tasks as
select t.id,t.tenant_id,t.conversation_id,m.id message_id,m.provider_message_id from public.agent_tasks t
join public.domain_events e on e.tenant_id=t.tenant_id and e.id=t.source_event_id
join public.messages m on m.tenant_id=t.tenant_id and m.id::text=e.payload->>'message_id'
where t.tenant_id='a2000000-0000-4000-8000-000000000001' and m.provider_message_id in ('1101','1102','1103');
update public.agent_tasks set priority=100,available_at=now()-interval '1 minute' where id in(select id from burst_tasks where provider_message_id<>'1101');
select is((select task_id from public.claim_conversation_reply_tasks(f.tenant_id,f.conversation_id,'local-first',1,120)),
  (select id from burst_tasks where provider_message_id='1101'),'reception order wins over reversed task creation and priority') from auto_fixture f;
select is((select count(*) from public.claim_conversation_reply_tasks(f.tenant_id,f.conversation_id,'local-overlap',1,120)),0::bigint,
  'second worker cannot overlap first source lease') from auto_fixture f;
update public.agent_tasks set status='WAITING_FOR_APPROVAL',locked_by=null,locked_at=null where id=(select id from burst_tasks where provider_message_id='1101');
insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,content,status,provider_chat_id,
  idempotency_key,actor_type,actor_id,correlation_id,occurred_at,created_at,reply_to_message_id)
select m.tenant_id,m.conversation_id,m.customer_id,m.messaging_contact_id,m.provider_connection_id,'outbound','LOCAL_BURST_SEND','pending',m.provider_chat_id,
  'LOCAL_BURST_SEND','SYSTEM','quality-approved-reply',gen_random_uuid(),now(),now(),m.id
from public.messages m join burst_tasks b on b.message_id=m.id where b.provider_message_id='1101';
select is((select count(*) from public.claim_conversation_reply_tasks(f.tenant_id,f.conversation_id,'local-pending-send',1,120)),0::bigint,
  'later reply waits for earlier queued provider delivery') from auto_fixture f;
update public.messages set status='sent',sent_at=now(),provider_message_id='local-provider-fixture' where idempotency_key='LOCAL_BURST_SEND';
select is((select task_id from public.claim_conversation_reply_tasks(f.tenant_id,f.conversation_id,'local-second',1,120)),
  (select id from burst_tasks where provider_message_id='1102'),'second source becomes eligible after terminal first generation and delivery') from auto_fixture f;
update public.agent_tasks set status='WAITING_FOR_APPROVAL',locked_by=null,locked_at=null where id=(select id from burst_tasks where provider_message_id='1102');
select is((select task_id from public.claim_agent_tasks('local-third-cron',1,120)),
  (select id from burst_tasks where provider_message_id='1103'),'cron uses the same order for the final source');
select is(private.conversation_reply_source_ready('a2000000-0000-4000-8000-000000000002',(select id from burst_tasks where provider_message_id='1101')),false,
  'other tenant cannot make a source eligible');

select * from finish();
rollback;
