begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'domain_events', 'domain event store exists');
select has_table('public', 'event_outbox', 'transactional outbox exists');
select has_table('public', 'event_inbox', 'idempotent consumer inbox exists');
select has_table('public', 'event_processing_attempts', 'event processing evidence exists');
select has_table('public', 'customer_state_transition_attempts', 'transition attempt evidence exists');
select has_table('public', 'scheduled_jobs', 'scheduled job base exists');

select is((select count(*) from private.customer_state_transition_rules), 23::bigint, 'complete transition matrix has 23 directed edges');
select is((select count(*) from private.event_contracts), 23::bigint, 'all Phase 3 event contracts are versioned');

select is((select relrowsecurity from pg_class where oid = 'public.domain_events'::regclass), true, 'event store has RLS');
select is((select relrowsecurity from pg_class where oid = 'public.event_outbox'::regclass), true, 'outbox has RLS');
select is((select relrowsecurity from pg_class where oid = 'public.event_inbox'::regclass), true, 'inbox has RLS');
select is((select relrowsecurity from pg_class where oid = 'public.customer_state_transition_attempts'::regclass), true, 'transition attempts have RLS');
select is((select relrowsecurity from pg_class where oid = 'public.scheduled_jobs'::regclass), true, 'scheduled jobs have RLS');
select ok(not has_table_privilege('authenticated', 'public.domain_events', 'INSERT'), 'browser cannot append domain events directly');
select ok(not has_table_privilege('authenticated', 'public.event_outbox', 'UPDATE'), 'browser cannot drive the outbox directly');
select ok(not has_table_privilege('authenticated', 'public.customers', 'UPDATE'), 'browser cannot bypass lifecycle service with direct customer update');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('61000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase3-a@example.test', 'not-used', now()),
  ('61000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase3-b@example.test', 'not-used', now());

insert into public.tenants (id, name, slug) values
  ('62000000-0000-0000-0000-000000000001', 'Phase 3 Tenant A', 'phase3-tenant-a'),
  ('62000000-0000-0000-0000-000000000002', 'Phase 3 Tenant B', 'phase3-tenant-b');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'manager'),
  ('62000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000002', 'manager');

insert into public.customers (id, tenant_id, display_name) values
  ('63000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000001', 'Lifecycle A'),
  ('63000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000002', 'Lifecycle B');

select is(
  (select count(*) from public.domain_events where event_type = 'customer.created' and customer_id in (
    '63000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000002'
  )),
  2::bigint,
  'customer creation stores durable customer.created events'
);
select is(
  (select count(*) from public.event_outbox eo join public.domain_events de on de.id = eo.event_id
   where de.customer_id in ('63000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000002')),
  2::bigint,
  'customer event and outbox record commit atomically'
);

select throws_ok(
  $$update public.customers set state = 'PAID' where id = '63000000-0000-0000-0000-000000000001'$$,
  '42501',
  'customer state can only change through transition_customer_state',
  'direct state mutation is rejected even for a privileged SQL caller'
);

select lives_ok(
  $test$
  do $body$
  declare
    rule_value record;
    customer_value uuid;
    correlation_value uuid;
    trigger_event_id_value uuid;
    event_payload jsonb;
    result_value jsonb;
  begin
    for rule_value in
      select * from private.customer_state_transition_rules order by from_state::text, to_state::text
    loop
      customer_value := gen_random_uuid();
      correlation_value := gen_random_uuid();
      trigger_event_id_value := null;
      insert into public.customers (id, tenant_id, display_name)
      values (customer_value, '62000000-0000-0000-0000-000000000001', 'Matrix fixture');
      perform set_config('app.state_transition_context', 'guarded', true);
      update public.customers set state = rule_value.from_state where id = customer_value;

      if rule_value.trusted_event_required then
        event_payload := case rule_value.required_event_type
          when 'payment.intent_created' then jsonb_build_object('payment_id','p','amount',1,'asset','USDT','network','TRON')
          when 'payment.confirmed' then jsonb_build_object('payment_id','p','tx_hash','tx')
          when 'access.granted' then jsonb_build_object('channel_access_id','a','channel_id','c')
          when 'subscription.started' then jsonb_build_object('subscription_id','s','starts_at',now(),'ends_at',now() + interval '30 days')
          when 'subscription.renewal_due' then jsonb_build_object('subscription_id','s','ends_at',now())
          when 'subscription.renewed' then jsonb_build_object('subscription_id','s','new_ends_at',now() + interval '30 days')
          when 'subscription.expired' then jsonb_build_object('subscription_id','s')
          else '{}'::jsonb
        end;
        trigger_event_id_value := public.append_domain_event(
          '62000000-0000-0000-0000-000000000001', customer_value,
          rule_value.required_event_type, 1, event_payload, 'SYSTEM', null,
          'pgtap-verified-service', 'TRUSTED', correlation_value, null,
          'guard:' || customer_value::text, now()
        );
      end if;

      result_value := public.transition_customer_state(
        '62000000-0000-0000-0000-000000000001', customer_value,
        rule_value.from_state, rule_value.to_state, 'matrix_test', 'SYSTEM', null,
        correlation_value, trigger_event_id_value,
        coalesce(rule_value.required_event_type, 'operator.requested'),
        trigger_event_id_value, 'transition:' || customer_value::text, now()
      );
      if coalesce((result_value ->> 'accepted')::boolean, false) is not true then
        raise exception 'allowed transition rejected: % -> %: %', rule_value.from_state, rule_value.to_state, result_value;
      end if;
    end loop;
  end
  $body$
  $test$,
  'every allowed transition executes through the guarded service'
);

select is(
  (select count(*) from public.customer_state_transition_attempts
   where tenant_id = '62000000-0000-0000-0000-000000000001'
     and reason_code = 'matrix_test' and result = 'accepted'),
  23::bigint,
  'all 23 allowed transitions created accepted evidence'
);

select is(
  (public.transition_customer_state(
    '62000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000001',
    'NEW', 'PAID', 'forbidden_jump', 'SYSTEM', null,
    '64000000-0000-0000-0000-000000000001', null,
    'operator.requested', null, 'forbidden-jump-1', now()
  ) ->> 'rejection_code'),
  'invalid_transition',
  'important forbidden transition fails safely'
);
select is(
  (select state from public.customers where id = '63000000-0000-0000-0000-000000000001'),
  'NEW'::public.customer_state,
  'forbidden transition does not mutate customer state'
);
select is(
  (select count(*) from public.audit_logs where correlation_id = '64000000-0000-0000-0000-000000000001'
    and action = 'customer.state_transition_rejected'),
  1::bigint,
  'forbidden transition leaves auditable evidence'
);
select is(
  (select count(*) from public.domain_events where correlation_id = '64000000-0000-0000-0000-000000000001'
    and event_type = 'lifecycle.transition_rejected'),
  1::bigint,
  'forbidden transition remains observable as an event'
);

select is(
  (public.transition_customer_state(
    '62000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000001',
    'NEW', 'CONTACT_READY', 'contact_ready', 'SYSTEM', null,
    '64000000-0000-0000-0000-000000000002', null,
    'operator.requested', null, 'duplicate-transition-1', now()
  ) ->> 'result'),
  'accepted',
  'first idempotent transition is accepted'
);
select is(
  (public.transition_customer_state(
    '62000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000001',
    'NEW', 'CONTACT_READY', 'contact_ready', 'SYSTEM', null,
    '64000000-0000-0000-0000-000000000002', null,
    'operator.requested', null, 'duplicate-transition-1', now()
  ) ->> 'result'),
  'accepted',
  'duplicate transition delivery returns its original accepted result'
);
select is(
  (select count(*) from public.customer_state_history
   where customer_id = '63000000-0000-0000-0000-000000000001' and from_state = 'NEW' and to_state = 'CONTACT_READY'),
  1::bigint,
  'duplicate event cannot create duplicate state history'
);
select is(
  (select count(*) from public.domain_events
   where customer_id = '63000000-0000-0000-0000-000000000001' and event_type = 'customer.state_changed'),
  1::bigint,
  'duplicate transition cannot create duplicate state events'
);

select is(
  (public.transition_customer_state(
    '62000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000001',
    'NEW', 'CONTACT_READY', 'concurrent_loser', 'SYSTEM', null,
    '64000000-0000-0000-0000-000000000003', null,
    'operator.requested', null, 'stale-transition-2', now()
  ) ->> 'rejection_code'),
  'stale_state',
  'a competing transition using stale expected state is rejected'
);

select throws_ok(
  $$select public.append_domain_event(
    '62000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000001',
    'payment.confirmed', 1, '{"payment_id":"p","tx_hash":"tx"}'::jsonb,
    'AGENT', 'agent-1', 'llm-runtime', 'UNTRUSTED',
    gen_random_uuid(), null, 'llm-payment-claim', now()
  )$$,
  '42501',
  'event requires a trusted deterministic producer',
  'an LLM/agent cannot manufacture a verified payment event'
);

select is(
  (select count(*) from public.audit_logs where correlation_id = '64000000-0000-0000-0000-000000000002'
    and action = 'customer.state_transition'),
  1::bigint,
  'accepted privileged transition is explicitly audited'
);
select is(
  (select count(*) from public.customer_state_history where correlation_id = '64000000-0000-0000-0000-000000000002'
    and state_change_event_id is not null),
  1::bigint,
  'state history is linked to its state event and correlation chain'
);

-- Isolate one event for retry/dead-letter and consumer idempotency checks.
update public.event_outbox set status = 'completed', completed_at = now() where status <> 'completed';

select public.append_domain_event(
  '62000000-0000-0000-0000-000000000001',
  '63000000-0000-0000-0000-000000000001',
  'customer.updated', 1, '{"changed_fields":["segment"]}'::jsonb,
  'SYSTEM', null, 'customer-os', 'TRUSTED',
  '64000000-0000-0000-0000-000000000004', null, 'retry-event-1', now()
);
update public.event_outbox set max_attempts = 2
where event_id = (select id from public.domain_events where idempotency_key = 'retry-event-1');

select is((select count(*) from public.claim_event_outbox('worker-a', 10, 60)), 1::bigint, 'dispatcher claims an available event');
select ok(public.begin_event_consumption(
  '62000000-0000-0000-0000-000000000001',
  (select id from public.domain_events where idempotency_key = 'retry-event-1'),
  'customer-projection', 'worker-a'
), 'first consumer delivery acquires the inbox key');
select ok(public.complete_event_consumption(
  '62000000-0000-0000-0000-000000000001',
  (select id from public.domain_events where idempotency_key = 'retry-event-1'),
  'customer-projection', 'worker-a', 'result-1'
), 'consumer completion is recorded');
select ok(not public.begin_event_consumption(
  '62000000-0000-0000-0000-000000000001',
  (select id from public.domain_events where idempotency_key = 'retry-event-1'),
  'customer-projection', 'worker-b'
), 'duplicate completed consumer delivery is skipped');

select is(
  public.fail_event_outbox(
    (select id from public.event_outbox where event_id = (select id from public.domain_events where idempotency_key = 'retry-event-1')),
    'worker-a', 'transient_database_error', 'temporary'
  ),
  'pending',
  'transient failure schedules a retry'
);
update public.event_outbox set available_at = now() - interval '1 second'
where event_id = (select id from public.domain_events where idempotency_key = 'retry-event-1');
select is((select count(*) from public.claim_event_outbox('worker-b', 10, 60)), 1::bigint, 'event is processable after transient failure');
select is(
  public.fail_event_outbox(
    (select id from public.event_outbox where event_id = (select id from public.domain_events where idempotency_key = 'retry-event-1')),
    'worker-b', 'terminal_error', 'failed twice'
  ),
  'dead_letter',
  'max-attempt failure enters dead-letter state'
);
select is(
  (select status from public.event_outbox where event_id = (select id from public.domain_events where idempotency_key = 'retry-event-1')),
  'dead_letter',
  'failed event remains observable'
);
select ok(
  (select count(*) >= 2 from public.event_processing_attempts where event_id = (select id from public.domain_events where idempotency_key = 'retry-event-1')),
  'retry and dead-letter processing attempts are append-only evidence'
);

select throws_ok(
  $$update public.domain_events set event_type = 'customer.created' where idempotency_key = 'retry-event-1'$$,
  '42501',
  'domain_events is append-only',
  'event history rejects tampering'
);

select is(
  public.enqueue_scheduled_job(
    '62000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000001',
    'lifecycle.renewal_due', '{}'::jsonb, 'schedule-1',
    '64000000-0000-0000-0000-000000000005', null, now() - interval '1 second'
  ),
  public.enqueue_scheduled_job(
    '62000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000001',
    'lifecycle.renewal_due', '{}'::jsonb, 'schedule-1',
    '64000000-0000-0000-0000-000000000005', null, now() - interval '1 second'
  ),
  'scheduled jobs are idempotent by tenant key'
);
select is((select count(*) from public.claim_scheduled_jobs('scheduler-a', 10, 60)), 1::bigint, 'scheduled job abstraction claims due work with a lease');
select ok(
  public.complete_scheduled_job(
    (select id from public.scheduled_jobs where idempotency_key = 'schedule-1'),
    'scheduler-a'
  ),
  'scheduled job completion releases the lease and records terminal status'
);
select is(
  (select status from public.scheduled_jobs where idempotency_key = 'schedule-1'),
  'completed',
  'scheduled job completion remains observable'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select results_eq(
  $$select distinct tenant_id from public.domain_events order by tenant_id$$,
  array['62000000-0000-0000-0000-000000000001'::uuid],
  'tenant A manager sees only tenant A events'
);
select results_eq(
  $$select count(*) from public.event_outbox where tenant_id = '62000000-0000-0000-0000-000000000002'$$,
  array[0::bigint],
  'tenant A manager cannot see tenant B outbox state'
);
select results_eq(
  $$select count(*) from public.customer_state_transition_attempts where tenant_id = '62000000-0000-0000-0000-000000000002'$$,
  array[0::bigint],
  'tenant A manager cannot see tenant B transition evidence'
);

set local role postgres;
select * from finish();
rollback;
