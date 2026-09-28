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
      '{"context_version":2,"message_count":2,"knowledge_sources":["conversation.recent_messages"],"unavailable_sources":["pricing.source_of_truth"],"secrets_included":false}'::jsonb);
    output_value:=jsonb_build_object(
      'classification',case when risky then 'payment_not_reflected' else 'information_request' end,
      'semantic_response',jsonb_build_object(
        'response_goal',case when risky then 'Escalate payment mismatch safely.' else 'Answer concisely.' end,
        'key_points',jsonb_build_array('safe response'),
        'factual_grounding',jsonb_build_object(
          'classification',case when risky then 'unknown' else 'inferred' end,
          'evidence_refs',jsonb_build_array('701'),
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

select * from finish();
rollback;
