begin;
select no_plan();
\ir helpers/private_beta_uat_fixtures.sql
select pg_temp.beta_setup(1901);
select pg_temp.beta_setup(1902);
select pg_temp.beta_enroll(1901);
select pg_temp.beta_auth(1901,'manager');
select lives_ok($q$select public.admin_private_beta_operator_accept_v1(pg_temp.beta_id(1901,'2000'),pg_temp.beta_id(1901,'3000'))$q$,'configured manager can accept generic support role with fresh MFA');
select pg_temp.beta_auth(1901,'support');
select throws_ok($q$select public.admin_private_beta_operator_accept_v1(pg_temp.beta_id(1901,'2000'),pg_temp.beta_id(1901,'3000'))$q$,'42501','PRIVATE_BETA_UNAVAILABLE','support cannot become named human operator');
select pg_temp.beta_auth(1901,'owner','aal2',301);
select throws_ok($q$select public.admin_private_beta_operator_accept_v1(pg_temp.beta_id(1901,'2000'),pg_temp.beta_id(1901,'3000'))$q$,'42501','PRIVATE_BETA_FRESH_AUTH_REQUIRED','token refresh cannot replace a fresh TOTP');
select pg_temp.beta_auth(1901);
select throws_ok($q$select public.admin_private_beta_canary_scope_v1(pg_temp.beta_id(1901,'2000'),pg_temp.beta_id(1901,'3000'))$q$,'42501','PRIVATE_BETA_UNAVAILABLE','founder stage cannot start another canary');
select ok(not has_function_privilege('service_role','public.admin_private_beta_canary_scope_v1(uuid,uuid)','execute'),'service credential cannot authenticate the owner canary action');
select ok(not has_function_privilege('authenticated','public.private_beta_claim_reply_v1(uuid,uuid)','execute'),'browser cannot claim Telegram dispatch');
select ok(not has_function_privilege('anon','public.claim_private_beta_tasks_v1(uuid,uuid,text)','execute'),'public cannot claim paid work');
select ok(not has_function_privilege('authenticated','public.private_beta_recover_delivery_v1(uuid,uuid,uuid)','execute'),'browser cannot invoke lease recovery');
select is((select count(*)::int from public.agent_tasks where tenant_id=pg_temp.beta_id(1901,'2000')and task_type='private_beta.reply'and status='QUEUED'),1,'actual message.received captures exactly one existing native task');
select is((select count(*)::int from public.agent_tasks where tenant_id=pg_temp.beta_id(1901,'2000')and task_type in('lead_intelligence','conversion.plan')),0,'beta inbound is not auto-selected by general commercial workers');
-- Retire only the additional SQL-only reservation fixture task. The task created
-- by the actual native message trigger remains the subject of these assertions.
update public.agent_tasks set status='CANCELLED',cancellation_reason='SQL_RESERVATION_FIXTURE_ONLY'where tenant_id=pg_temp.beta_id(1901,'2000')and idempotency_key='beta-source:1901';
select is((select count(*)::int from public.claim_private_beta_tasks_v1(pg_temp.beta_id(1901,'2000'),(select(ingest->>'conversation_id')::uuid from private_beta_cases where n=1901),'native-pgtap-worker')),1,'actual source-scoped task is claimed once');
select is((select count(*)::int from public.claim_private_beta_tasks_v1(pg_temp.beta_id(1901,'2000'),(select(ingest->>'conversation_id')::uuid from private_beta_cases where n=1901),'native-pgtap-worker-two')),0,'second worker cannot own the same valid lease');
select is((select count(*)::int from public.claim_private_beta_tasks_v1(pg_temp.beta_id(1902,'2000'),(select(ingest->>'conversation_id')::uuid from private_beta_cases where n=1901),'wrong-tenant')),0,'foreign conversation has no claimed work or existence detail');
select public.set_conversation_runtime_mode(pg_temp.beta_id(1901,'2000'),(select(ingest->>'conversation_id')::uuid from private_beta_cases where n=1901),'HUMAN_TAKEOVER','Synthetic takeover regression',pg_temp.beta_id(1901,'9900'));
select is((select automatic_replies_enabled from public.conversations where tenant_id=pg_temp.beta_id(1901,'2000')),false,'direct operator takeover explicitly pauses automatic replies before later attention writes');
update public.agent_tasks set locked_at=clock_timestamp()-interval '3 minutes'where tenant_id=pg_temp.beta_id(1901,'2000')and task_type='private_beta.reply'and status='RUNNING';
select is((select count(*)::int from public.claim_private_beta_tasks_v1(pg_temp.beta_id(1901,'2000'),(select(ingest->>'conversation_id')::uuid from private_beta_cases where n=1901),'native-crash-recovery')),0,'expired native lease is reviewed and never automatically sent again');
select is((select count(*)::int from public.agent_tasks where tenant_id=pg_temp.beta_id(1901,'2000')and failure_code='PRIVATE_BETA_LEASE_UNKNOWN'and status='DEAD_LETTER'),1,'unknown execution remains visible in durable terminal review');
select ok(exists(select 1 from public.escalation_cases where tenant_id=pg_temp.beta_id(1901,'2000')and status<>'RESOLVED'),'expired lease creates an existing Phase12 attention obligation');
-- Participation revocation must commit even with a high-priority support case.
select public.private_beta_invite_accept_v1(pg_temp.beta_id(1901,'2000'),(7000000+1901)::text,(5000000+1901)::text,(5000000+1901)::text,'/stop');
update private_beta_cases set ingest=public.ingest_telegram_message(pg_temp.beta_id(1901,'2000'),'native-pgtap-stop-1901','44',(5000000+1901)::text,(5000000+1901)::text,null,null,null,'/stop',null,clock_timestamp())where n=1901;
select lives_ok($q$select public.private_beta_queue_notice_v1(pg_temp.beta_id(1901,'2000'),pg_temp.beta_id(1901,'3000'),(select id from private.private_beta_participants where program_id=pg_temp.beta_id(1901,'3000')),(select(ingest->>'conversation_id')::uuid from private_beta_cases where n=1901),(select(ingest->>'message_id')::uuid from private_beta_cases where n=1901),'STOPPED')$q$,'fixed truthful opt-out receipt is permitted while a high support case holds AI');
select ok(exists(select 1 from public.messages where tenant_id=pg_temp.beta_id(1901,'2000')and actor_id='private-beta-notice'and content='Your participation has stopped. No further AI replies or marketing will be sent.'),'opt-out acknowledgement comes from a fixed server body');
select is((select count(*)::int from public.subscriptions where tenant_id=pg_temp.beta_id(1901,'2000')),0,'native conversations create no subscription authority');
select is((select count(*)::int from private.verified_payment_receipts where tenant_id=pg_temp.beta_id(1901,'2000')),0,'native conversations create no genuine financial receipts');
select is((select outbound_messaging_enabled from public.tenants where id=pg_temp.beta_id(1901,'2000')),false,'general tenant outbound switch remains disabled');
select * from finish();
rollback;
