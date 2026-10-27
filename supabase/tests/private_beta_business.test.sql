begin;
select no_plan();
\ir helpers/private_beta_uat_fixtures.sql
\ir helpers/private_beta_business_fixtures.sql

select ok((select relrowsecurity from pg_class where oid='private.private_beta_business_controls'::regclass),'Business control table uses RLS');
select ok((select relrowsecurity from pg_class where oid='private.private_beta_business_events'::regclass),'Business evidence table uses RLS');
select ok(not has_table_privilege('service_role','private.private_beta_business_controls','SELECT'),'service cannot select raw Business control');
select ok(not has_table_privilege('authenticated','private.private_beta_business_events','SELECT'),'browser cannot select private callback evidence');
select ok(not has_function_privilege('service_role','private.private_beta_business_control_record(uuid,uuid,text)','EXECUTE'),'service cannot attest independent Business identity/permissions');
select ok(not has_function_privilege('authenticated','public.private_beta_business_event_v1(uuid,uuid,text)','EXECUTE'),'browser cannot inject provider events');
select ok(not has_function_privilege('service_role','public.admin_private_beta_business_configure_v1(uuid,uuid,text,bigint)','EXECUTE'),'service cannot select an owner account binding');
select ok(not has_function_privilege('service_role','private.private_beta_claim_reply_bot_v1(uuid,uuid)','EXECUTE'),'private legacy claim cannot bypass Business checks');
select ok(not has_function_privilege('authenticated','private.private_beta_transport_bot_v1(uuid,uuid)','EXECUTE'),'private legacy scope has no browser execute grant');

select pg_temp.business_setup(2801);
select is(public.admin_private_beta_business_configure_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),pg_temp.business_config(2801)::text,1)->>'state','UNVERIFIED','identical owner setup replay does not invent verification');
select throws_ok($q$select public.private_beta_transport_config_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'))$q$,'55000','PRIVATE_BETA_BUSINESS_UNVERIFIED','Secretary Mode callback/configuration alone is not account proof');
select throws_ok($q$select public.admin_private_beta_business_configure_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(pg_temp.business_config(2801)||'{"representative_user_id":"999999"}')::text,2)$q$,'42501','PRIVATE_BETA_BUSINESS_IMMUTABLE','expected representative cannot drift');
select pg_temp.beta_auth(2801,'support');
select throws_ok($q$select public.admin_private_beta_business_configure_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),pg_temp.business_config(2801)::text,2)$q$,'42501','PRIVATE_BETA_UNAVAILABLE','support cannot approve account access');
select pg_temp.beta_auth(2801,'owner','aal2',301);
select throws_ok($q$select public.admin_private_beta_business_configure_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),pg_temp.business_config(2801)::text,2)$q$,'42501','PRIVATE_BETA_FRESH_AUTH_REQUIRED','stale MFA does not approve account binding');
select pg_temp.beta_auth(2801);
select throws_ok($q$select private.private_beta_business_control_record(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(pg_temp.business_proof(2801)||'{"expected_generation":null}')::text)$q$,'22023','PRIVATE_BETA_BUSINESS_INVALID','null generation cannot bypass commit fencing');
select throws_ok($q$select private.private_beta_business_control_record(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(pg_temp.business_proof(2801)||'{"representative_user_id":"99999"}')::text)$q$,'22023','PRIVATE_BETA_BUSINESS_INVALID','wrong Telegram representative proof is rejected');
select throws_ok($q$select private.private_beta_business_control_record(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(pg_temp.business_proof(2801)||jsonb_build_object('credential_sha256',repeat('f',64)))::text)$q$,'22023','PRIVATE_BETA_BUSINESS_INVALID','wrong bot credential custody is rejected');
select throws_ok($q$select private.private_beta_business_control_record(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(pg_temp.business_proof(2801)||jsonb_build_object('observed_at',clock_timestamp()-interval '6 minutes'))::text)$q$,'22023','PRIVATE_BETA_BUSINESS_INVALID','stale enrollment observation is rejected');
select throws_ok($q$select private.private_beta_business_control_record(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(pg_temp.business_proof(2801)||jsonb_build_object('expires_at',clock_timestamp()+interval '2 hours'))::text)$q$,'22023','PRIVATE_BETA_BUSINESS_INVALID','seal cannot extend approved program expiry');
select throws_ok($q$select private.private_beta_business_control_record(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(pg_temp.business_proof(2801)||'{"verified":true}')::text)$q$,'22023','PRIVATE_BETA_BUSINESS_INVALID','unexpected authority flags are rejected');
select pg_temp.business_seal(2801);
select is(public.private_beta_transport_config_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'))->>'version','2','Business has an explicit transport version');
select is(public.private_beta_transport_config_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'))->>'mode','BUSINESS','Business mode is explicit');
select is(public.private_beta_transport_config_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'))->>'founder_chat_id','5002801','server allowlist is one exact numeric founder identity');
select is((select generation from private.private_beta_business_controls where program_id=pg_temp.beta_id(2801,'3000')),2::bigint,'initial independent seal advances generation');
select is((select count(*)from private.private_beta_business_events where program_id=pg_temp.beta_id(2801,'3000')and kind='CONTROL_SEALED'),1::bigint,'initial proof is append-only evidence');
select throws_ok($q$delete from private.private_beta_business_events where program_id=pg_temp.beta_id(2801,'3000')$q$,'42501','FSE_IMMUTABLE','Business source evidence cannot be deleted');
select throws_ok($q$update private.private_beta_business_controls set founder_chat_id='99999'where program_id=pg_temp.beta_id(2801,'3000')$q$,'42501','PRIVATE_BETA_BUSINESS_IMMUTABLE','allowed founder cannot be replaced in place');

select pg_temp.business_service();
select is(public.private_beta_business_event_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(pg_temp.business_event_value(2801,'INBOUND',1,1)||'{"business_connection_id":"foreign"}')::text)->>'accepted','false','another Business connection is ignored without enrollment');
select is(public.private_beta_business_event_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(pg_temp.business_event_value(2801,'INBOUND',1,1)||'{"provider_user_id":"99999","provider_chat_id":"99999"}')::text)->>'accepted','false','unallowlisted customer cannot enter the native pipeline');
select is((select count(*)from public.messages where tenant_id=pg_temp.beta_id(2801,'2000')),0::bigint,'denied source creates no message');
select is((select request_count from private.private_beta_programs where id=pg_temp.beta_id(2801,'3000')),0,'denied source consumes no model attempt');
select throws_ok($q$select public.private_beta_business_event_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(pg_temp.business_event_value(2801,'INBOUND',1,1)||jsonb_build_object('occurred_at',clock_timestamp()+interval '1 hour'))::text)$q$,'22023','PRIVATE_BETA_BUSINESS_INVALID','future source timestamps are rejected');
select is(pg_temp.business_event(2801,'BOT_ECHO',9,9)->>'action','IGNORED','bot echo never becomes eligible customer input');
select is(pg_temp.business_event(2801,'CONNECTION_OBSERVED',10)->>'action','IGNORED','positive callback is not independent permission authority');
select is((select count(*)from public.agent_tasks where tenant_id=pg_temp.beta_id(2801,'2000')),0::bigint,'metadata and echo create no paid model work');

select pg_temp.business_enroll(2801);
select is((select status from private.private_beta_participants where program_id=pg_temp.beta_id(2801,'3000')),'ACTIVE','matching founder still completes invitation and exact notice agreement');
select is((select count(*)from public.agent_tasks where tenant_id=pg_temp.beta_id(2801,'2000')and task_type='private_beta.reply'and status='QUEUED'),1::bigint,'verified source enters the original native runtime');
select is(pg_temp.business_event(2801,'INBOUND',3,4)->>'duplicate','true','same source update replay is idempotent');
select is((select count(*)from private.private_beta_business_events where program_id=pg_temp.beta_id(2801,'3000')and kind='INBOUND'and update_id='3'),1::bigint,'one source evidence identity is retained');
select throws_ok($q$select public.ingest_telegram_message(pg_temp.beta_id(2801,'2000'),'unscoped-business-update','88','5002801','5002801',null,null,null,'Unscoped source must not create work',null,clock_timestamp())$q$,'42501','PRIVATE_BETA_BUSINESS_SOURCE_UNVERIFIED','generic ingest cannot bypass Business source evidence');
select is((select count(*)from public.messages where tenant_id=pg_temp.beta_id(2801,'2000')and provider_message_id='88'),0::bigint,'failed source insertion rolls back rather than silently creating history');
select pg_temp.business_prepare_run(2801);
select lives_ok($q$select public.private_beta_reserve_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(select run_id from business_cases where n=2801),repeat('c',64),repeat('d',64),(select(ingest->>'message_id')::uuid from private_beta_cases where n=2801),'0.50128',(select(ingest->>'conversation_id')::uuid from private_beta_cases where n=2801))$q$,'current scoped Business source may reserve one existing journal attempt');
select is((select request_count from private.private_beta_programs where id=pg_temp.beta_id(2801,'3000')),2,'one synthetic canary plus one source reservation counted exactly');

-- Simulate queued and already-started outbound work. No network exists in SQL.
insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_chat_id,reply_to_message_id,idempotency_key,actor_type,actor_id,correlation_id,occurred_at)
select c.tenant_id,c.id,c.customer_id,c.messaging_contact_id,c.provider_connection_id,'outbound','text','Synthetic queued draft.',s.status::public.message_status,a.provider_chat_id,a.last_inbound_id,'business-fixture-'||s.status,'SYSTEM','private-beta-ai:'||a.revision,extensions.gen_random_uuid(),clock_timestamp()
from public.conversations c join private.private_beta_participants a on a.conversation_id=c.id cross join(values('pending'),('sending'))s(status)where c.tenant_id=pg_temp.beta_id(2801,'2000');
select is(pg_temp.business_event(2801,'HUMAN_REPLY',11,11,'A real provider-observed representative reply in a SQL fixture.')->>'action','HELD','representative reply pauses AI rather than creating another model turn');
select is((select runtime_mode::text from public.conversations where tenant_id=pg_temp.beta_id(2801,'2000')),'PAUSED','already-started uncertain send prevents a false clean takeover');
select is((select count(*)from public.messages where tenant_id=pg_temp.beta_id(2801,'2000')and idempotency_key='business-fixture-pending'and status='blocked'),1::bigint,'old queued AI draft is blocked');
select is((select count(*)from public.messages where tenant_id=pg_temp.beta_id(2801,'2000')and idempotency_key='business-fixture-sending'and status='sending'),1::bigint,'already-started send is neither erased nor declared cancelled');
select is((select count(*)from public.messages where tenant_id=pg_temp.beta_id(2801,'2000')and actor_id='private-beta-telegram-human-observed'and actor_type='SYSTEM'and provider_message_id='11'and provider_acknowledged_at is null),1::bigint,'observed representative reply retains actual provider ID without inventing staff login or API ACK');
select is(pg_temp.business_event(2801,'HUMAN_REPLY',11,11,'A real provider-observed representative reply in a SQL fixture.')->>'duplicate','true','duplicate representative callback cannot duplicate the external message');
select is((select count(*)from public.messages where tenant_id=pg_temp.beta_id(2801,'2000')and actor_id='private-beta-telegram-human-observed'),1::bigint,'one observed reply remains in history');
select ok(exists(select 1 from public.escalation_cases where tenant_id=pg_temp.beta_id(2801,'2000')and status<>'RESOLVED'),'human/unknown work uses existing Phase12 attention');
select is((select count(*)from public.message_delivery_attempts where tenant_id=pg_temp.beta_id(2801,'2000')),0::bigint,'provider-observed human reply does not fabricate a dispatch attempt');

select pg_temp.business_setup(2802);select pg_temp.business_seal(2802);select pg_temp.business_enroll(2802);
select pg_temp.business_service();
select is(pg_temp.business_event(2802,'EDIT',20,4)->>'action','HELD','source edit holds rather than regenerating automatically');
select is((select runtime_mode::text from public.conversations where tenant_id=pg_temp.beta_id(2802,'2000')),'PAUSED','edit review does not imply an operator accepted human ownership');
select is((select content from public.messages where tenant_id=pg_temp.beta_id(2802,'2000')and direction='inbound'and provider_message_id='4'),'Hi, a fictional free beta question.','source edit does not rewrite original source text');
select is(pg_temp.business_event(2802,'DELETE',21,4)->>'action','HELD','delete is a review obligation, not delivery revocation');
select is((select count(*)from public.messages where tenant_id=pg_temp.beta_id(2802,'2000')and direction='inbound'and provider_message_id='4'),1::bigint,'source deletion preserves historical evidence');
select is(pg_temp.business_event(2802,'CONNECTION_OBSERVED',22)->>'action','IGNORED','positive callback cannot restore edited/deleted restricted scope');
select is(public.private_beta_transport_config_v1(pg_temp.beta_id(2802,'2000'),pg_temp.beta_id(2802,'3000'))->>'enabled','false','restrict-only state remains closed');
select throws_ok($q$select private.private_beta_business_control_record(pg_temp.beta_id(2802,'2000'),pg_temp.beta_id(2802,'3000'),pg_temp.business_proof(2802)::text)$q$,'42501','PRIVATE_BETA_BUSINESS_REVERIFICATION_REQUIRED','re-enable requires new authenticated owner intent before independent proof');
select pg_temp.beta_auth(2802);
select public.admin_private_beta_business_reverify_v1(pg_temp.beta_id(2802,'2000'),pg_temp.beta_id(2802,'3000'),(select generation from private.private_beta_business_controls where program_id=pg_temp.beta_id(2802,'3000')));
select lives_ok($q$select pg_temp.business_seal(2802)$q$,'fresh owner intent plus new protected proof can restore connection permission');
select is((select runtime_mode::text from public.conversations where tenant_id=pg_temp.beta_id(2802,'2000')),'PAUSED','connection re-verification never silently returns conversation to AI');

select pg_temp.business_setup(2803);select pg_temp.business_seal(2803);select pg_temp.business_enroll(2803);select pg_temp.business_prepare_run(2803);
select pg_temp.business_service();
select is(pg_temp.business_event(2803,'CONNECTION_DISABLED',30)->>'action','HELD','permission-loss callback commits a sticky restriction');
select throws_ok($q$select public.private_beta_reserve_v1(pg_temp.beta_id(2803,'2000'),pg_temp.beta_id(2803,'3000'),(select run_id from business_cases where n=2803),repeat('c',64),repeat('d',64),(select(ingest->>'message_id')::uuid from private_beta_cases where n=2803),'0.50128',(select(ingest->>'conversation_id')::uuid from private_beta_cases where n=2803))$q$,'55000','PRIVATE_BETA_SOURCE_HELD','permission loss prevents the next model reservation');
select is((select request_count from private.private_beta_programs where id=pg_temp.beta_id(2803,'3000')),1,'denied dispatch does not consume another reservation or mutate canary history');
select is(pg_temp.business_event(2803,'CONNECTION_OBSERVED',31)->>'action','IGNORED','later enabled callback cannot independently reauthorize an account');

select pg_temp.business_setup(2804);select pg_temp.business_seal(2804);
select pg_temp.business_service();
select pg_temp.business_event(2804,'INBOUND',1,1);
select is(public.private_beta_business_event_v1(pg_temp.beta_id(2804,'2000'),pg_temp.beta_id(2804,'3000'),(pg_temp.business_event_value(2804,'INBOUND',1,1)||jsonb_build_object('source_hash',repeat('f',64)))::text)->>'action','HELD','conflicting callback source hash fails closed');
select is((select count(*)from private.private_beta_business_events where program_id=pg_temp.beta_id(2804,'3000')and kind='CALLBACK_CONFLICT'),1::bigint,'conflicting evidence is append-only, not overwritten');
select is(public.private_beta_transport_config_v1(pg_temp.beta_id(2804,'2000'),pg_temp.beta_id(2804,'3000'))->>'enabled','false','conflicting identity closes connection authority');

select pg_temp.business_setup(2805);select pg_temp.business_seal(2805);select pg_temp.business_enroll(2805);
select pg_temp.business_service();
select is(public.private_beta_business_transport_hold_v1(pg_temp.beta_id(2805,'2000'),pg_temp.beta_id(2805,'3000'),(select(ingest->>'message_id')::uuid from private_beta_cases where n=2805),'PERMISSION_READ_UNVERIFIED')->>'held','true','unverifiable live read becomes visible bounded review work');
select is((select runtime_mode::text from public.conversations where tenant_id=pg_temp.beta_id(2805,'2000')),'PAUSED','permission-read uncertainty remains paused after the unassigned HIGH case is opened');
select is((select seal->>'enabled'from private.private_beta_business_controls where program_id=pg_temp.beta_id(2805,'3000')),'true','read failure does not rewrite historical provider permission proof as disabled');
select is((select restriction_reason from private.private_beta_business_controls where program_id=pg_temp.beta_id(2805,'3000')),'PERMISSION_READ_UNVERIFIED','failure reason stays truthful');
select is((select count(*)from public.message_delivery_attempts where tenant_id=pg_temp.beta_id(2805,'2000')),0::bigint,'failed permission read cannot create a remote send attempt');
select is((select outbound_messaging_enabled from public.tenants where id=pg_temp.beta_id(2805,'2000')),false,'general outbound switch remains disabled');
select is((select count(*)from public.subscriptions where tenant_id in(select tenant_id from private.private_beta_business_controls)),0::bigint,'Business conversations grant no subscription');
select is((select count(*)from private.verified_payment_receipts where tenant_id in(select tenant_id from private.private_beta_business_controls)),0::bigint,'Business observations create no genuine receipt');
select is((select count(*)from public.channel_access where tenant_id in(select tenant_id from private.private_beta_business_controls)),0::bigint,'Business observations grant no VIP access');

-- Historical BOT read/claim behavior remains available only through wrappers.
select pg_temp.beta_setup(2806);select pg_temp.beta_bot(2806);
select is(public.private_beta_transport_config_v1(pg_temp.beta_id(2806,'2000'),pg_temp.beta_id(2806,'3000'))->>'version','1','old BOT scope remains version1');
select is(public.private_beta_transport_config_v1(pg_temp.beta_id(2806,'2000'),pg_temp.beta_id(2806,'3000'))->>'mode',null,'old BOT projection does not gain Business fields');
select pg_temp.beta_auth(2806);
select is(public.admin_private_beta_business_scope_v1(pg_temp.beta_id(2806,'2000'),pg_temp.beta_id(2806,'3000')),null::jsonb,'old BOT has no invented Business status');
select pg_temp.beta_auth(2801);
select is(public.admin_private_beta_business_scope_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'))->>'mode','BUSINESS','owner reads one scoped Business configuration');
select ok(not(public.admin_private_beta_business_scope_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'))?'credential_sha256'),'owner status never exposes credential binding hash');
select ok(not(public.admin_private_beta_business_scope_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'))?'business_connection_id'),'owner status projects opaque connection hash rather than raw connection reference');
select throws_ok($q$select public.admin_private_beta_business_scope_v1(pg_temp.beta_id(2802,'2000'),pg_temp.beta_id(2802,'3000'))$q$,'42501','PRIVATE_BETA_UNAVAILABLE','foreign tenant configuration is not readable');
select pg_temp.beta_auth(2801,'analyst');
select throws_ok($q$select public.admin_private_beta_business_scope_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'))$q$,'42501','PRIVATE_BETA_UNAVAILABLE','analyst cannot inspect representative/customer binding');
select pg_temp.business_service();
select throws_ok($q$select public.private_beta_business_event_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2802,'3000'),pg_temp.business_event_value(2801,'INBOUND',100,100)::text)$q$,'42501','PRIVATE_BETA_UNAVAILABLE','foreign program lookup uses the same tenant denial');
select throws_ok($q$select public.private_beta_business_event_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(pg_temp.business_event_value(2801,'INBOUND',100,100)||'{"update_id":null}')::text)$q$,'22023','PRIVATE_BETA_BUSINESS_INVALID','null delivery identity cannot bypass replay fencing');
select throws_ok($q$select public.private_beta_business_event_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(pg_temp.business_event_value(2801,'INBOUND',100,100)||'{"provider_message_id":100}')::text)$q$,'22023','PRIVATE_BETA_BUSINESS_INVALID','numeric JSON does not replace canonical provider ID strings');
select throws_ok($q$select public.private_beta_business_event_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),(pg_temp.business_event_value(2801,'INBOUND',100,100)||'{"enabled":true}')::text)$q$,'22023','PRIVATE_BETA_BUSINESS_INVALID','callback cannot smuggle positive authority fields');
set local role service_role;
select throws_ok($q$select private.private_beta_business_control_record(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'3000'),'{}')$q$,'42501',null,'actual service role cannot invoke protected attestation writer');
select throws_ok($q$select * from private.private_beta_business_events$q$,'42501',null,'actual service role cannot query raw evidence table');
select throws_ok($q$select private.private_beta_claim_reply_bot_v1(pg_temp.beta_id(2801,'2000'),pg_temp.beta_id(2801,'9900'))$q$,'42501',null,'actual service role cannot invoke old unfenced claim');
reset role;
select pg_temp.business_setup(2807);select pg_temp.business_seal(2807);select pg_temp.business_service();
select pg_temp.business_event(2807,'INBOUND',1,1);
select is(pg_temp.business_event(2807,'HUMAN_REPLY',1,2,'Contradictory callback class fixture.')->>'action','HELD','same update ID cannot change kind or message identity');
select is((select count(*)from private.private_beta_business_events where program_id=pg_temp.beta_id(2807,'3000')and kind='CALLBACK_CONFLICT'),1::bigint,'cross-kind replay conflict remains independently visible');
select pg_temp.business_setup(2808);select pg_temp.business_seal(2808);select pg_temp.business_service();
select public.private_beta_business_event_v1(pg_temp.beta_id(2808,'2000'),pg_temp.beta_id(2808,'3000'),(pg_temp.business_event_value(2808,'DELETE',55,11)||jsonb_build_object('source_hash',repeat('b',64)))::text);
select public.private_beta_business_event_v1(pg_temp.beta_id(2808,'2000'),pg_temp.beta_id(2808,'3000'),(pg_temp.business_event_value(2808,'DELETE',55,12)||jsonb_build_object('source_hash',repeat('b',64)))::text);
select is((select count(*)from private.private_beta_business_events where program_id=pg_temp.beta_id(2808,'3000')and kind='DELETE'and update_id='55'),2::bigint,'one bounded deletion callback preserves distinct message identities');
select is((select count(*)from private.private_beta_business_events where program_id=pg_temp.beta_id(2808,'3000')and kind='CALLBACK_CONFLICT'),0::bigint,'same authenticated delete body hash is not mistaken for a replay conflict');
select pg_temp.beta_auth(2805);
select throws_ok($q$select public.admin_private_beta_transition_v1(pg_temp.beta_id(2805,'2000'),pg_temp.beta_id(2805,'3000'),'FRIENDS',(select generation from private.private_beta_programs where id=pg_temp.beta_id(2805,'3000')))$q$,'42501','PRIVATE_BETA_BUSINESS_FOUNDER_ONLY','first Business release cannot broaden one-chat test into friend/customer access');
select * from finish();
rollback;
