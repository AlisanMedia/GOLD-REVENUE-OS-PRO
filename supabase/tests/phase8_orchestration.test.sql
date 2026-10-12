begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('authenticated','public.complete_lead_intelligence(uuid,uuid,text,jsonb)','EXECUTE'),'AI/browser cannot write lead memory');
select ok(not has_function_privilege('authenticated','public.configure_phase8_orchestration(uuid,boolean)','EXECUTE'),'activation is a privileged operator action');
select is((select count(*) from private.agent_tool_registry),7::bigint,'no arbitrary or new AI mutation tools');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at) values('b8100000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase8-manager@example.test','not-used',now());
insert into public.tenants(id,name,slug) values('b8200000-0000-4000-8000-000000000001','Phase 8 A','phase8-a'),('b8200000-0000-4000-8000-000000000002','Phase 8 B','phase8-b');
insert into public.tenant_members(tenant_id,user_id,role) values('b8200000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001','manager');
select public.configure_phase8_orchestration('b8200000-0000-4000-8000-000000000001',true);
insert into public.customers(id,tenant_id,display_name) values('b8300000-0000-4000-8000-000000000001','b8200000-0000-4000-8000-000000000001','Lead fixture');
insert into public.customer_identities(tenant_id,customer_id,identity_type,identity_value,normalized_value) values('b8200000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000001','telegram_user_id','88001','88001');
select public.ingest_telegram_message('b8200000-0000-4000-8000-000000000001','phase8-u1','88001','88001','88001','lead_fixture','Lead','Fixture','I am a beginner. I mainly trade XAUUSD. I am actively trading.',null,now());
update public.conversations set runtime_mode='AI_ACTIVE',human_takeover=false where tenant_id='b8200000-0000-4000-8000-000000000001';
create temporary table phase8_scope as select e.id event_id,m.id source_id,m.created_at boundary,m.occurred_at observed,m.conversation_id,m.customer_id from public.domain_events e join public.messages m on m.tenant_id=e.tenant_id and m.id::text=e.payload->>'message_id' where e.tenant_id='b8200000-0000-4000-8000-000000000001' and e.event_type='message.received';
select lives_ok($$select public.consume_event_for_agent_runtime('b8200000-0000-4000-8000-000000000001',(select event_id from phase8_scope),'route-1')$$,'event routes through orchestrator');
select lives_ok($$select public.consume_event_for_agent_runtime('b8200000-0000-4000-8000-000000000001',(select event_id from phase8_scope),'route-2')$$,'duplicate event is safe');
select is((select count(*) from public.agent_tasks where tenant_id='b8200000-0000-4000-8000-000000000001' and task_type='lead.intelligence'),1::bigint,'one specialist task per source event');
select is((select count(*) from public.agent_tasks where tenant_id='b8200000-0000-4000-8000-000000000001' and task_type='conversation.shadow_draft'),1::bigint,'one conversation task; no duplicate sender');
select is((select count(*) from public.audit_logs where tenant_id='b8200000-0000-4000-8000-000000000001' and action='orchestrator.routed'),1::bigint,'routing audit idempotent');
select throws_ok($$select public.consume_event_for_agent_runtime('b8200000-0000-4000-8000-000000000002',(select event_id from phase8_scope),'wrong-tenant')$$,'42501','event scope denied','wrong tenant cannot route event');
create temporary table phase8_claim as select * from public.claim_agent_tasks('lead-owner',1,120);
select is((select task_type from phase8_claim),'lead.intelligence','Lead runs first using existing priority queue');
select is((select count(*) from public.claim_agent_tasks('other-owner',1,120) where task_type='lead.intelligence'),0::bigint,'leased specialist cannot be double-claimed');
create temporary table phase8_run as select public.begin_agent_run('b8200000-0000-4000-8000-000000000001',(select task_id from phase8_claim),'lead-owner',jsonb_build_object('context_version',3,'context_boundary_timestamp',(select boundary from phase8_scope),'source_event_id',(select event_id from phase8_scope),'source_message_id',(select source_id from phase8_scope),'secrets_included',false)) id;
create temporary table phase8_result as
select jsonb_build_object('version','lead-intelligence-v1','identity','matched','completeness',2.0/13,'missing_fields',array['primary_instrument','actively_trades','previous_service_experience','goals','requirements','pain_points','objections','communication_style','preferred_language','preferred_signal_frequency','price_sensitivity'], 'next_action',jsonb_build_object('action','CONTINUE_CONVERSATION','reason','No interruption','field',null,'question',null,'delivery','proposal_only'),'fields',
(select jsonb_agg(case when key='lead_source' then jsonb_build_object('key',key,'value','telegram','classification','verified_system','confidence',1,'source',jsonb_build_object('type','system','id',(select event_id from phase8_scope),'quote','','observed_at',(select boundary from phase8_scope)))
when key='experience_level' then jsonb_build_object('key',key,'value','beginner','classification','explicit','confidence',0.98,'source',jsonb_build_object('type','message','id',(select source_id from phase8_scope),'quote','I am a beginner.','observed_at',(select observed from phase8_scope))) else jsonb_build_object('key',key,'value',null,'classification','unknown','confidence',0,'source',null) end order by ord)
from unnest(array['experience_level','primary_instrument','actively_trades','previous_service_experience','goals','requirements','pain_points','objections','communication_style','preferred_language','preferred_signal_frequency','price_sensitivity','lead_source']) with ordinality as k(key,ord))) value;
select throws_ok($$select public.complete_lead_intelligence('b8200000-0000-4000-8000-000000000001',(select id from phase8_run),'lead-owner',jsonb_set((select value from phase8_result),'{fields,0,source,id}','"00000000-0000-4000-8000-000000000001"'))$$,'42501','lead provenance denied','fabricated source rejected');
select throws_ok($$select public.complete_lead_intelligence('b8200000-0000-4000-8000-000000000001',(select id from phase8_run),'lead-owner',jsonb_set((select value from phase8_result),'{fields,0,classification}','"verified_system"'))$$,'42501','system attribute forged','model cannot promote self-report to verified system fact');
select lives_ok($$select public.complete_lead_intelligence('b8200000-0000-4000-8000-000000000001',(select id from phase8_run),'lead-owner',(select value from phase8_result))$$,'supported extraction completes atomically');
select is((select status::text from public.agent_runs where id=(select id from phase8_run)),'SUCCEEDED','internal task completes without human reply proposal');
select is((select field_metadata->'phase8_qualification'->>'identity' from public.customer_profiles where customer_id='b8300000-0000-4000-8000-000000000001'),'matched','existing profile receives qualification metadata');
select is((select count(*) from public.customer_memory where customer_id='b8300000-0000-4000-8000-000000000001' and memory_key='experience_level' and source_id=(select source_id::text from phase8_scope)),1::bigint,'existing memory retains exact inbound provenance');
select is((select count(*) from public.agent_proposals where run_id=(select id from phase8_run)),0::bigint,'specialist creates no customer-facing proposal');
select is((select count(*) from public.model_invocations where run_id=(select id from phase8_run)),0::bigint,'deterministic intelligence uses no paid model');
select is((select state::text from public.customers where id='b8300000-0000-4000-8000-000000000001'),'NEW','qualification cannot transition customer state');
select is((select count(*) from public.messages where tenant_id='b8200000-0000-4000-8000-000000000001' and direction='outbound'),0::bigint,'no outbound send from intelligence');
-- Unmatched identity: even a username identical to a known customer cannot link it.
select public.ingest_telegram_message('b8200000-0000-4000-8000-000000000001','phase8-u2','88002','88002','88002','lead_fixture','Other','Fixture','XAUUSD',null,now());
update public.conversations set runtime_mode='AI_ACTIVE',human_takeover=false where tenant_id='b8200000-0000-4000-8000-000000000001';
select is((select count(*) from public.conversations where tenant_id='b8200000-0000-4000-8000-000000000001' and customer_id is null),1::bigint,'username does not merge unmatched identity');
select public.consume_event_for_agent_runtime('b8200000-0000-4000-8000-000000000001',(select id from public.domain_events where tenant_id='b8200000-0000-4000-8000-000000000001' and event_type='message.received' and customer_id is null),'unmatched-route');
select is((select count(*) from public.agent_tasks where tenant_id='b8200000-0000-4000-8000-000000000001' and task_type='lead.intelligence' and customer_id is null),1::bigint,'unmatched profiling stays conversation scoped');
-- Stale and human-control routing decisions cannot start additional Lead tasks.
update public.messages set created_at=now()-interval '10 minutes' where provider_message_id='88002';
select is(public.consume_event_for_agent_runtime('b8200000-0000-4000-8000-000000000001',(select id from public.domain_events where tenant_id='b8200000-0000-4000-8000-000000000001' and event_type='message.received' and customer_id is null),'stale')->>'routing','stale_source','stale source held without replay');
update public.conversations set human_takeover=true where tenant_id='b8200000-0000-4000-8000-000000000001';
select is(public.consume_event_for_agent_runtime('b8200000-0000-4000-8000-000000000001',(select event_id from phase8_scope),'takeover')->>'routing','human_control','human takeover wins over qualification');
grant select on phase8_scope to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','b8100000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.admin_lead_intelligence('b8200000-0000-4000-8000-000000000001',(select conversation_id from phase8_scope))$$,'authorized admin sees evidence and next action');
select throws_ok($$select public.admin_lead_intelligence('b8200000-0000-4000-8000-000000000002',(select conversation_id from phase8_scope))$$,'42501','lead read denied','admin cannot read another tenant');
select * from finish();
rollback;
