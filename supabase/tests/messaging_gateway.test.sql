begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public','messaging_provider_connections','provider connections exist');
select has_table('public','messaging_contacts','messaging contacts exist');
select has_table('public','conversations','conversations exist');
select has_table('public','messages','messages exist');
select has_table('public','messaging_provider_updates','provider update dedupe ledger exists');
select has_table('public','message_delivery_attempts','delivery evidence exists');
select function_returns('public','ingest_telegram_message',array['uuid','text','text','text','text','text','text','text','text','text','timestamptz'],'jsonb','Telegram ingest RPC exists');
select function_returns('public','queue_outbound_message',array['uuid','uuid','text','text','uuid','uuid'],'jsonb','outbound queue RPC exists');
select function_returns('public','record_outbound_message_result',array['uuid','uuid','text','text','integer','text','integer'],'jsonb','provider acknowledgement RPC exists');
select function_returns('public','set_outbound_messaging_enabled',array['uuid','boolean','uuid'],'boolean','kill switch RPC exists');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at) values
('81000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase5-manager@example.test','not-used',now()),
('81000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase5-support@example.test','not-used',now()),
('81000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase5-analyst@example.test','not-used',now()),
('81000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase5-readonly@example.test','not-used',now()),
('81000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase5-other@example.test','not-used',now());

insert into public.tenants (id,name,slug) values
('82000000-0000-0000-0000-000000000001','Phase 5 Tenant A','phase5-tenant-a'),
('82000000-0000-0000-0000-000000000002','Phase 5 Tenant B','phase5-tenant-b');

insert into public.tenant_members (tenant_id,user_id,role) values
('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','manager'),
('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002','support'),
('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000003','analyst'),
('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000004','readonly'),
('82000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000005','manager');

insert into public.customers (id,tenant_id,display_name) values
('83000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001','Exact Telegram Customer'),
('83000000-0000-0000-0000-000000000002','82000000-0000-0000-0000-000000000001','Username Only Customer'),
('83000000-0000-0000-0000-000000000003','82000000-0000-0000-0000-000000000002','Other Tenant Customer');

insert into public.customer_identities (tenant_id,customer_id,identity_type,identity_value,normalized_value) values
('82000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000001','telegram_user_id','111','111'),
('82000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000002','telegram_username','LegacyName','legacyname');

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$
  select public.ingest_telegram_message(
    '82000000-0000-0000-0000-000000000001','1001','51','111','111',
    'ExactUser','Exact','Customer','hello',null,now()
  )
$$,'exact Telegram user ID inbound is accepted');
select lives_ok($$
  select public.ingest_telegram_message(
    '82000000-0000-0000-0000-000000000001','1001','51','111','111',
    'ExactUser','Exact','Customer','hello',null,now()
  )
$$,'duplicate Telegram update is replay-safe');
select lives_ok($$
  select public.ingest_telegram_message(
    '82000000-0000-0000-0000-000000000001','1002','52','222','222',
    'LegacyName','Unknown','Contact','question',null,now()
  )
$$,'historical username creates review instead of silent merge');
select lives_ok($$
  select public.ingest_telegram_message(
    '82000000-0000-0000-0000-000000000001','1003','53','333','333',
    null,'New','Contact','new contact',null,now()
  )
$$,'unknown Telegram contact is retained without customer creation');

select is((select count(*) from public.messaging_provider_updates where tenant_id='82000000-0000-0000-0000-000000000001'),3::bigint,'duplicate update creates one dedupe row');
select is((select count(*) from public.messages where tenant_id='82000000-0000-0000-0000-000000000001' and direction='inbound'),3::bigint,'duplicate update creates one inbound message');
select is((select count(*) from public.domain_events where tenant_id='82000000-0000-0000-0000-000000000001' and event_type='message.received'),3::bigint,'each accepted inbound creates one durable event');
select is((select customer_id from public.messaging_contacts where provider_user_id='111'),'83000000-0000-0000-0000-000000000001'::uuid,'exact Telegram user ID binds to Customer OS');
select is((select identity_resolution from public.messaging_contacts where provider_user_id='222'),'ambiguous','username-only match is ambiguous');
select ok((select review_required from public.messaging_contacts where provider_user_id='222'),'ambiguous identity requires review');
select is((select customer_id from public.messaging_contacts where provider_user_id='222'),null::uuid,'ambiguous identity is not silently merged');
select is((select identity_resolution from public.messaging_contacts where provider_user_id='333'),'unmatched','unknown contact remains unmatched');
select is((select customer_id from public.messaging_contacts where provider_user_id='333'),null::uuid,'unknown contact does not create or bind a customer');
select is((select payload from public.domain_events where event_type='message.received' order by recorded_at limit 1) ? 'content',false,'message event payload excludes content');

reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
set local role authenticated;

select throws_ok(
  format('select public.queue_outbound_message(%L,%L,%L,%L,%L,null)',
    '82000000-0000-0000-0000-000000000001',
    (select id::text from public.conversations where provider_conversation_id='111'),
    'blocked by switch','outbound-switch-test',
    '84000000-0000-0000-0000-000000000001'),
  '42501','outbound messaging disabled','kill switch defaults to deny'
);
select is(public.set_outbound_messaging_enabled(
  '82000000-0000-0000-0000-000000000001',true,
  '84000000-0000-0000-0000-000000000002'
),true,'manager can enable outbound with audited RPC');

select lives_ok(
  format('select public.queue_outbound_message(%L,%L,%L,%L,%L,null)',
    '82000000-0000-0000-0000-000000000001',
    (select id::text from public.conversations where provider_conversation_id='111'),
    'manual reply','outbound-idempotency-test',
    '84000000-0000-0000-0000-000000000003'),
  'manager can queue reachable outbound'
);
select lives_ok(
  format('select public.queue_outbound_message(%L,%L,%L,%L,%L,null)',
    '82000000-0000-0000-0000-000000000001',
    (select id::text from public.conversations where provider_conversation_id='111'),
    'manual reply','outbound-idempotency-test',
    '84000000-0000-0000-0000-000000000003'),
  'duplicate outbound idempotency key returns existing record'
);
select is((select count(*) from public.messages where idempotency_key='outbound-idempotency-test'),1::bigint,'duplicate outbound does not create a second record');
select is((select count(*) from public.audit_logs where action='messaging.kill_switch_changed' and tenant_id='82000000-0000-0000-0000-000000000001'),1::bigint,'kill switch mutation is audited');
select is((select count(*) from public.audit_logs where action='messaging.outbound_queued' and tenant_id='82000000-0000-0000-0000-000000000001'),1::bigint,'privileged outbound mutation is audited');

select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000002',true);
select lives_ok(
  format('select public.queue_outbound_message(%L,%L,%L,%L,%L,null)',
    '82000000-0000-0000-0000-000000000001',
    (select id::text from public.conversations where provider_conversation_id='111'),
    'support reply','support-send-test',
    '84000000-0000-0000-0000-000000000004'),
  'support can queue manual reply'
);

select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000003',true);
select throws_ok(
  format('select public.queue_outbound_message(%L,%L,%L,%L,%L,null)',
    '82000000-0000-0000-0000-000000000001',
    (select id::text from public.conversations where provider_conversation_id='111'),
    'analyst forbidden','analyst-send-test',
    '84000000-0000-0000-0000-000000000005'),
  '42501','messaging send denied','analyst cannot send'
);
select is((select count(*) from public.messages),0::bigint,'analyst RLS cannot read message content');

select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000004',true);
select throws_ok(
  format('select public.queue_outbound_message(%L,%L,%L,%L,%L,null)',
    '82000000-0000-0000-0000-000000000001',
    (select id::text from public.conversations where provider_conversation_id='111'),
    'readonly forbidden','readonly-send-test',
    '84000000-0000-0000-0000-000000000006'),
  '42501','messaging send denied','readonly cannot send'
);

select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
select is((public.admin_conversation_list('82000000-0000-0000-0000-000000000001',null,null,1,25)->>'total')::integer,3,'conversation list is tenant scoped');
select throws_ok(
  $$select public.admin_conversation_list('82000000-0000-0000-0000-000000000002',null,null,1,25)$$,
  '42501','messaging read denied','tenant A cannot inspect tenant B messaging'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok(
  format('select public.record_outbound_message_result(%L,%L,%L,%L,%s,null,null)',
    '82000000-0000-0000-0000-000000000001',
    (select id::text from public.messages where idempotency_key='outbound-idempotency-test'),
    'sent','7001',200),
  'Telegram success acknowledgement is recorded'
);
select is((select status from public.messages where idempotency_key='outbound-idempotency-test'),'sent'::public.message_status,'provider acknowledgement maps to sent');
select is((select count(*) from public.domain_events where event_type='message.sent' and payload->>'message_id'=(select id::text from public.messages where idempotency_key='outbound-idempotency-test')),1::bigint,'sent message creates one message.sent event');
select is((select payload from public.domain_events where event_type='message.sent' order by recorded_at desc limit 1) ? 'content',false,'sent event payload excludes message content');

select lives_ok(
  format('select public.record_outbound_message_result(%L,%L,%L,null,%s,%L,%s)',
    '82000000-0000-0000-0000-000000000001',
    (select id::text from public.messages where idempotency_key='support-send-test'),
    'retry_scheduled',429,'TELEGRAM_RATE_LIMITED',17),
  'Telegram 429 schedules retry'
);
select is((select status from public.messages where idempotency_key='support-send-test'),'retry_scheduled'::public.message_status,'429 is not falsely marked sent');
select ok((select retry_after_at > now() from public.messages where idempotency_key='support-send-test'),'retry-after is persisted');
select is((select count(*) from public.domain_events where event_type='message.sent' and payload->>'message_id'=(select id::text from public.messages where idempotency_key='support-send-test')),0::bigint,'failed/retry attempt does not emit message.sent');

select * from finish();
rollback;
