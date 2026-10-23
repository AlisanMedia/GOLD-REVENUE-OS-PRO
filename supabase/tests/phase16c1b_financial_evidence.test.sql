begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
\ir helpers/phase16c1b_fixtures.sql

select private.phase16c1b_id('namespace') ns,private.phase16c1b_id('tenant:1') t,private.phase16c1b_id('tenant:2') other_t,
 private.phase16c1b_id('user:1') admin_user,private.phase16c1b_id('user:2') manager_user,private.phase16c1b_id('user:3') support_user,
 private.phase16c1b_id('user:4') analyst_user,private.phase16c1b_id('user:5') readonly_user,private.phase16c1b_id('user:6') foreign_user,
 private.phase16c1b_id('customer:2') foreign_customer,private.phase16c1b_id('invoice:2') foreign_invoice \gset

create temp table fse_before as select jsonb_build_object('receipts',(select count(*) from private.verified_payment_receipts),
 'events',(select count(*) from public.domain_events),'outbox',(select count(*) from public.event_outbox),
 'periods',(select count(*) from public.subscription_payments),'subscriptions',(select count(*) from public.subscriptions),
 'access',(select count(*) from public.channel_access),'jobs',(select count(*) from public.entitlement_jobs),
 'invoice_state',(select jsonb_agg(jsonb_build_array(id,status,confirmed_at) order by id) from public.payment_invoices)) state;
create temp table fse_test_commands(k text primary key,d jsonb,r jsonb);
insert into fse_test_commands values('first',private.phase16c1b_command('first'),null);
update fse_test_commands set r=private.phase16c1b_apply(d) where k='first';
select is((select r->>'financial_authority' from fse_test_commands where k='first'),'NONE','B01 synthetic evidence never financial authority');
select is((select count(*) from private.fse_operation_claims),1::bigint,'B01 one global operation claim');
select is((select count(*) from private.fse_allocation_candidates_v1),1::bigint,'B01 one candidate, no receipt/period');
select ok((select (private.phase16c1b_apply(d)->>'historical')::boolean from fse_test_commands where k='first'),'B01 same command/hash returns exact historical result');
select is((select count(*) from private.fse_commands),1::bigint,'B01 idempotent command no extra write');
select is((select count(*) from public.audit_logs where action='financial_evidence.recorded'),1::bigint,'B01 one safe audit');
select throws_ok($q$select private.phase16c1b_apply(jsonb_set((select d from fse_test_commands where k='first'),'{source_envelope_hash}',to_jsonb(repeat('c',64))))$q$,'22023','FSE_COMMAND_CONFLICT','B01 same command/different hash denied');
select lives_ok($q$select private.phase16c1b_apply(private.phase16c1b_command('first'))$q$,'B01 new read same operation retained');
select is((select count(*) from private.fse_operation_claims),1::bigint,'B01 repeated read no second operation');
select is((select count(*) from private.fse_acquisitions where kind='CALLBACK'),1::bigint,'B01 callback delivery baseline deduplicated');
select lives_ok($q$select private.phase16c1b_apply(private.phase16c1b_command('first',2))$q$,'B01 foreign replay recorded without foreign mutation');
select is((select count(*) from private.fse_operation_claims),1::bigint,'B01 tenant-independent identity cannot be claimed again');
select is((select count(*) from private.fse_operation_claims where tenant_id=private.phase16c1b_id('tenant:2')),0::bigint,'B01 foreign tenant gets no claim');
select ok(not exists(select 1 from private.fse_operations where review_latched),'B01 foreign replay cannot latch legitimate owner');
select throws_ok($q$select private.phase16c1b_apply(jsonb_set(private.phase16c1b_command('tampered-operation'),'{operation,operation_key}',to_jsonb(repeat('c',64))))$q$,'22023','FSE_INVALID','B01 noncanonical operation identity denied');
select private.phase16c1b_apply(private.phase16c1b_command('invalid-then-valid',1,'1000','PAYMENT',null,false,'invalid_auth'));
select is((select count(*) from private.fse_acquisitions where acquisition_key=private.phase16c1b_command('invalid-then-valid')->'selectors'->>'delivery_key'),0::bigint,'B01 invalid authentication cannot reserve delivery');
select lives_ok($q$select private.phase16c1b_apply(private.phase16c1b_command('invalid-then-valid'))$q$,'B01 later valid fixture source can claim');
select is((select count(*) from private.fse_operation_claims c join private.fse_operations o using(namespace_id,operation_key) where o.transaction_id='fixture:transaction:invalid-then-valid'),1::bigint,'B01 valid source not poisoned by invalid callback');
select lives_ok($q$select private.phase16c1b_apply(private.phase16c1b_command('first',1,'700'))$q$,'B01 same delivery conflicting facts retained for review');
select is((select units from private.fse_operation_claims c join private.fse_operations o using(namespace_id,operation_key) where o.transaction_id='fixture:transaction:first'),1000::numeric,'B01 conflicting delivery never overwrites first financial fact');

-- B02: rollback every database effect; actual backend death/unknown COMMIT is
-- separately exercised by phase16c1b_concurrency.sh with independent connections.
create temp table fse_atomic_before as select (select count(*) from private.fse_commands) c,(select count(*) from private.fse_observations) o,
 (select count(*) from private.fse_operation_claims) p,(select count(*) from public.audit_logs where action='financial_evidence.recorded') a,
 (select generation from private.fse_scopes where namespace_id=:'ns' and tenant_id=:'t') g;
do $block$begin
 begin
  perform private.phase16c1b_apply(private.phase16c1b_command('rollback'));
  raise exception 'CONTROLLED_ROLLBACK';
 exception when raise_exception then if sqlerrm<>'CONTROLLED_ROLLBACK' then raise;end if;end;
end;$block$;
select is((select count(*) from private.fse_commands),(select c from fse_atomic_before),'B02 command rollback');
select is((select count(*) from private.fse_observations),(select o from fse_atomic_before),'B02 observations rollback');
select is((select count(*) from private.fse_operation_claims),(select p from fse_atomic_before),'B02 claim rollback');
select is((select count(*) from public.audit_logs where action='financial_evidence.recorded'),(select a from fse_atomic_before),'B02 audit rollback');
select is((select generation from private.fse_scopes where namespace_id=:'ns' and tenant_id=:'t'),(select g from fse_atomic_before),'B02 generation rollback');
create function private.phase16c1b_failpoint() returns trigger language plpgsql as $f$begin raise exception 'FSE_TEST_FAILPOINT';end;$f$;
revoke all on function private.phase16c1b_failpoint() from public,anon,authenticated,service_role;
create function private.phase16c1b_atomic_fault(tab text) returns boolean language plpgsql set search_path=pg_catalog as $f$
declare schema_value text:='private';before_value jsonb;after_value jsonb;
begin
 if tab not in ('fse_acquisitions','fse_observations','fse_operations','fse_history_entries','fse_operation_claims','audit_logs','fse_commands','fse_assessments','fse_scopes') then raise exception 'FIXTURE_TABLE_DENIED';end if;
 if tab='audit_logs' then schema_value:='public';end if;
 select jsonb_build_array((select count(*) from private.fse_commands),(select count(*) from private.fse_observations),(select count(*) from private.fse_operation_claims),(select count(*) from public.audit_logs),(select sum(generation) from private.fse_scopes)) into before_value;
 execute format('create trigger fse_test_failpoint after %s on %I.%I for each row %s execute function private.phase16c1b_failpoint()',
  case when tab='fse_scopes' then 'update' else 'insert' end,schema_value,tab,case when tab='audit_logs' then 'when (new.action=''financial_evidence.recorded'')' else '' end);
 begin
  perform private.phase16c1b_apply(private.phase16c1b_command('failpoint-'||tab,1,'1000','PAYMENT',null,false,'unallocated'));
  raise exception 'UNEXPECTED_SUCCESS';
 exception when raise_exception then if sqlerrm<>'FSE_TEST_FAILPOINT' then raise;end if;end;
 execute format('drop trigger fse_test_failpoint on %I.%I',schema_value,tab);
 select jsonb_build_array((select count(*) from private.fse_commands),(select count(*) from private.fse_observations),(select count(*) from private.fse_operation_claims),(select count(*) from public.audit_logs),(select sum(generation) from private.fse_scopes)) into after_value;
 return before_value=after_value;
end;$f$;
revoke all on function private.phase16c1b_atomic_fault(text) from public,anon,authenticated,service_role;
select ok(private.phase16c1b_atomic_fault(tab),'B02 rollback at write stage '||tab)
from unnest(array['fse_acquisitions','fse_observations','fse_operations','fse_history_entries','fse_operation_claims','audit_logs','fse_commands','fse_assessments','fse_scopes'])tab;
select throws_ok($q$insert into private.fse_commands(namespace_id,tenant_id,id,request_hash,fence,evaluation_clock,result_assessment_id,audit_id,result)
 select private.phase16c1b_id('namespace'),private.phase16c1b_id('tenant:1'),gen_random_uuid(),repeat('a',64),'{}',now(),gen_random_uuid(),-1,'{}'$q$,'23503',null,'B02 no audit-less command');
select diag('B02.D genuine receipt/event/outbox atomicity DEFERRED; no genuine writer exists in this package.');

-- B03: a changed generation invalidates a previously prepared context.
insert into fse_test_commands values('stale',private.phase16c1b_command('stale'),null);
select private.phase16c1b_apply(private.phase16c1b_command('generation-change',1,'1000','PAYMENT',null,false,'unallocated'));
select throws_ok($q$select private.phase16c1b_apply((select d from fse_test_commands where k='stale'))$q$,'40001','FSE_STALE_CONTEXT','B03 commit-time generation fence');
select is((select count(*) from private.fse_commands where id=(select (d->>'command_id')::uuid from fse_test_commands where k='stale')),0::bigint,'B03 stale commit writes nothing');

-- B04: strict JSON and monetary parsing before casts; immutable history.
select throws_ok($q$select private.fse_strict_json('{"a":1,"a":2}')$q$,'22023','FSE_INVALID','B04 duplicate top-level keys denied');
select throws_ok($q$select private.fse_strict_json('{"a":{"x":1,"\u0078":2}}')$q$,'22023','FSE_INVALID','B04 nested escaped duplicate key denied');
select throws_ok($q$select private.fse_strict_json('{"x":"'||repeat('x',65536)||'"}')$q$,'22023','FSE_INVALID','B04 bounded raw JSON');
select throws_ok($q$select private.phase16c1b_apply(private.phase16c1b_command('bad-authority')||'{"financial_authority":"LIVE"}')$q$,'22023','FSE_INVALID','B04 no LIVE authority');
select throws_ok($q$select private.phase16c1b_apply(private.phase16c1b_command('bad-boolean')||'{"verified":true}')$q$,'22023','FSE_INVALID','B04 extra authority field denied');
select throws_ok($q$select private.phase16c1b_apply(jsonb_set(private.phase16c1b_command('bad-nested'),'{observations,0,fee}','{"units":"1","asset":{},"financial_authority":"LIVE"}'))$q$,'22023','FSE_INVALID','B04 nested unexpected authority field denied');
select throws_ok($q$select private.fse_units('1'::jsonb)$q$,'22023','FSE_INVALID','B04 JSON numeric amount denied');
select throws_ok($q$select private.fse_units('"1.0"')$q$,'22023','FSE_INVALID','B04 no fractional rounding');
select throws_ok($q$select private.fse_units('"1e3"')$q$,'22023','FSE_INVALID','B04 exponent denied');
select throws_ok($q$select private.fse_units('"01"')$q$,'22023','FSE_INVALID','B04 leading zero denied');
select throws_ok($q$select private.fse_units(to_jsonb(repeat('9',31)))$q$,'22023','FSE_INVALID','B04 overflow denied');
select is(private.fse_units(to_jsonb(repeat('9',30))),999999999999999999999999999999::numeric,'B04 exact 30 digits');
select is(private.fse_units('null'),null::numeric,'B04 null remains unknown');
select ok(not private.fse_reference(repeat('🙂',101)) and private.fse_reference(repeat('🙂',100)),'B04 UTF16 unit bound matches v1');
select is(private.fse_storage_hash('["golden",null,"A|::B","🙂Z"]'),'53596389d3c30da10310a4b1b970b0a0f7308229a93b21e9e74825053457d0ee','B04 cross-language storage golden vector');
select throws_ok($q$update private.fse_observations set source_status='OK'$q$,'42501','FSE_IMMUTABLE','B04 observation immutable');
select throws_ok($q$delete from private.fse_assessments$q$,'42501','FSE_IMMUTABLE','B04 assessment immutable');
select throws_ok($q$update private.fse_operation_claims set financial_authority='LIVE'$q$,'42501','FSE_IMMUTABLE','B04 claim cannot be promoted');
select throws_ok($q$delete from private.fse_history_entries$q$,'42501','FSE_IMMUTABLE','B04 history immutable');
select throws_ok($q$update private.fse_namespaces set provider_environment='SANDBOX'$q$,'42501','FSE_IMMUTABLE','B04 namespace identity immutable');
select ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname like 'fse_%' and c.relkind='r' and not c.relrowsecurity),'B04 RLS enabled on every new table');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like 'fse_%' or p.proname in ('record_financial_evidence_v1','prepare_financial_evidence_v1','read_financial_evidence_command_v1')) and (p.prosecdef or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute'))),'B04 private functions invoker/owner-only');

set local role anon;
select throws_ok('select * from private.fse_namespaces','42501',null,'B04 anon raw denied');
reset role;
set local role service_role;
select throws_ok('select * from private.fse_operation_claims','42501',null,'B04 service role raw denied');
select throws_ok($q$select private.record_financial_evidence_v1('{}',repeat('a',64))$q$,'42501',null,'B04 service-role writer denied');
select throws_ok($q$select public.admin_financial_evidence_page_v1(null,null,'claims')$q$,'42501',null,'B04 service-role public wrapper not granted');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',:'manager_user',true);
select throws_ok('select * from private.fse_observations','42501',null,'B04 authenticated raw denied');
select throws_ok($q$select private.record_financial_evidence_v1('{}',repeat('a',64))$q$,'42501',null,'B04 authenticated writer denied');
select throws_ok(format('select public.admin_financial_evidence_page_v1(%L,%L,%L)',:'ns',:'other_t','claims'),'42501','FSE_UNAVAILABLE','B04 wrong tenant denied');
select is(public.admin_financial_evidence_page_v1(:'ns',:'t','claims',:'foreign_customer'),null::jsonb,'B04 foreign customer indistinguishable from absent');
select is(public.admin_financial_evidence_page_v1(:'ns',:'t','claims',null,:'foreign_invoice'),null::jsonb,'B04 foreign invoice unavailable');
select ok(public.admin_financial_evidence_detail_v1(:'ns',:'t','claims',gen_random_uuid()) is null,'B04 missing direct record null');
select set_config('request.jwt.claim.sub',:'support_user',true);
select ok(public.admin_financial_evidence_page_v1(:'ns',:'t','claims')->'items'->0->>'units' is not null,'B04 support permitted amount projection');
select set_config('request.jwt.claim.sub',:'analyst_user',true);
select is(public.admin_financial_evidence_page_v1(:'ns',:'t','claims')->'items'->0->>'units',null::text,'B04 analyst individual amount redacted');
select ok(public.admin_financial_evidence_page_v1(:'ns',:'t','observations')::text not like '%test:fse-payer%','B04 no private payer in public JSON');
select ok(public.admin_financial_evidence_page_v1(:'ns',:'t','observations')::text not like '%raw_hash%','B04 no raw source hash in public JSON');
select set_config('request.jwt.claim.sub',:'readonly_user',true);
select throws_ok(format('select public.admin_financial_evidence_page_v1(%L,%L,%L)',:'ns',:'t','claims'),'42501','FSE_UNAVAILABLE','B04 readonly denied');
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
select throws_ok(format('select public.admin_financial_evidence_page_v1(%L,%L,%L)',:'ns',:'t','claims'),'42501','FSE_UNAVAILABLE','B04 missing membership denied');
reset role;

-- B05 bounded history and real paginated cardinalities. Synthetic only.
select lives_ok($q$do $b$begin for n in 1..321 loop perform private.phase16c1b_apply(private.phase16c1b_command('page-'||n,1,'1000','PAYMENT',null,false,'unallocated'));end loop;end;$b$$q$,'B05 >100 source operations persist without financial effects');
set local role authenticated;select set_config('request.jwt.claim.sub',:'manager_user',true);
select is(jsonb_array_length(public.admin_financial_evidence_page_v1(:'ns',:'t','claims')->'items'),25,'B05 default page 25');
select is(jsonb_array_length(public.admin_financial_evidence_page_v1(:'ns',:'t','observations',null,null,100)->'items'),100,'B05 independent observation maximum100');
select ok((public.admin_financial_evidence_page_v1(:'ns',:'t','claims')->>'has_more')::boolean,'B05 incomplete list honestly has_more');
select throws_ok(format('select public.admin_financial_evidence_page_v1(%L,%L,%L,null,null,101)',:'ns',:'t','claims'),'22023','FSE_INVALID','B05 oversized page denied');
select throws_ok(format('select public.admin_financial_evidence_page_v1(%L,%L,%L,null,null,0)',:'ns',:'t','claims'),'22023','FSE_INVALID','B05 zero page denied');
select throws_ok(format('select public.admin_financial_evidence_page_v1(%L,%L,%L,null,null,25,%L)',:'ns',:'t','claims','{"version":1}'),'22023','FSE_CURSOR_INVALID','B05 malformed cursor denied');
reset role;
create temp table fse_pages(p jsonb);
set local role authenticated;select set_config('request.jwt.claim.sub',:'manager_user',true);
reset role;
insert into fse_pages select public.admin_financial_evidence_page_v1(:'ns',:'t','claims');
select is((select p->>'consistency' from fse_pages),'GENERATION_FENCED_KEYSET','B05 explicit consistency contract');
do $b$declare p jsonb;seen uuid[]:='{}';cur jsonb;total bigint;ns uuid:=private.phase16c1b_id('namespace');t uuid:=private.phase16c1b_id('tenant:1');begin
 loop
  p:=public.admin_financial_evidence_page_v1(ns,t,'claims',null,null,25,cur);
  seen:=seen||array(select (x->>'id')::uuid from jsonb_array_elements(p->'items')x);
  exit when not(p->>'has_more')::boolean;cur:=p->'next_cursor';
 end loop;
 select count(*) into total from private.fse_operation_claims where namespace_id=ns and tenant_id=t;
 if cardinality(seen)<>total or cardinality(seen)<>(select count(distinct v) from unnest(seen)v) then raise exception 'PAGINATION_LOSS_OR_DUPLICATE';end if;
end;$b$;
select pass('B05 first/middle/final pages cover all rows once');
select ok(public.admin_financial_evidence_detail_v1(:'ns',:'t','claims',(select (r->>'claim_id')::uuid from fse_test_commands where k='first')) is not null,'B05 direct detail beyond first100');
select private.phase16c1b_apply(private.phase16c1b_command('cursor-generation',1,'1000','PAYMENT',null,false,'unallocated'));
select throws_ok(format('select public.admin_financial_evidence_page_v1(%L,%L,%L,null,null,25,%L)',:'ns',:'t','claims',(select (p->'next_cursor')::text from fse_pages)),'40001','FSE_CURSOR_REFRESH_REQUIRED','B05 drift forces refresh');
select throws_ok(format('select public.admin_financial_evidence_page_v1(%L,%L,%L,null,null,25,%L)',:'ns',:'t','history',(select (p->'next_cursor')::text from fse_pages)),'22023','FSE_CURSOR_INVALID','B05 cursor cannot cross collection');
select ok(not exists(select 1 from private.fse_scopes where delete_after is not null or retention_policy_ref is not null or legal_hold_state<>'UNKNOWN'),'B05 no invented retention or cleanup');

select throws_ok(format('select public.admin_financial_evidence_page_v1(%L,%L,%L,null,null,25,%L)',:'ns',:'t','claims',
 jsonb_set(public.admin_financial_evidence_page_v1(:'ns',:'t','claims')->'next_cursor','{started_at}',to_jsonb(to_char((now()-interval '31 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))::text),'22023','FSE_CURSOR_INVALID','B05 expired cursor denied');
select private.phase16c1b_apply(private.phase16c1b_command('history-overflow',1,'1000','PAYMENT',null,false,'unallocated'));
insert into private.fse_history_entries(namespace_id,tenant_id,command_id,entry_hash,canonical_history_v1,operation_key,physical_key,delivery_key,invoice_key,original_operation_key,source_state)
select b.namespace_id,b.tenant_id,b.command_id,private.fse_hash(private.fse_canonical(x.v)),private.fse_canonical(x.v),b.operation_key,b.physical_key,x.v->>'delivery_key',b.invoice_key,b.original_operation_key,b.source_state
from private.fse_history_entries b join private.fse_operations o on o.namespace_id=b.namespace_id and o.operation_key=b.operation_key
cross join generate_series(1,63)n cross join lateral(select b.canonical_history_v1::jsonb||jsonb_build_object('delivery_key',private.fse_hash('overflow:'||n)) v)x
where o.transaction_id='fixture:transaction:history-overflow';
update private.fse_scopes set generation=generation+1 where namespace_id=:'ns' and tenant_id=:'t';
select is(private.phase16c1b_command('history-overflow',1,'1000','PAYMENT',null,false,'unallocated')->'assessment'->>'source_state','SOURCE_VERIFIED','B05 exactly64 complete history entries remain evaluable');
insert into private.fse_history_entries(namespace_id,tenant_id,command_id,entry_hash,canonical_history_v1,operation_key,physical_key,delivery_key,invoice_key,original_operation_key,source_state)
select b.namespace_id,b.tenant_id,b.command_id,private.fse_hash(private.fse_canonical(x.v)),private.fse_canonical(x.v),b.operation_key,b.physical_key,x.v->>'delivery_key',b.invoice_key,b.original_operation_key,b.source_state
from private.fse_history_entries b join private.fse_operations o on o.namespace_id=b.namespace_id and o.operation_key=b.operation_key
cross join lateral(select b.canonical_history_v1::jsonb||jsonb_build_object('delivery_key',private.fse_hash('overflow:64')) v)x
where o.transaction_id='fixture:transaction:history-overflow' order by b.id limit 1;
update private.fse_scopes set generation=generation+1 where namespace_id=:'ns' and tenant_id=:'t';
select is(private.phase16c1b_command('history-overflow',1,'1000','PAYMENT',null,false,'unallocated')->'assessment'->'reasons'->>0,'HISTORY_INCOMPLETE','B05 65 distinct history entries fail closed');
select lives_ok($q$select private.phase16c1b_apply(private.phase16c1b_command('history-overflow',1,'1000','PAYMENT',null,false,'unallocated'))$q$,'B05 incomplete evidence retained without new claim');
select private.phase16c1b_apply(private.phase16c1b_command('history-byte-budget',1,'1000','PAYMENT',null,false,'unallocated'));
insert into private.fse_history_entries(namespace_id,tenant_id,command_id,entry_hash,canonical_history_v1,operation_key,physical_key,delivery_key,invoice_key,original_operation_key,source_state)
select b.namespace_id,b.tenant_id,b.command_id,private.fse_hash(private.fse_canonical(x.v)),private.fse_canonical(x.v),b.operation_key,b.physical_key,x.v->>'delivery_key',b.invoice_key,b.original_operation_key,b.source_state
from private.fse_history_entries b join private.fse_operations o on o.namespace_id=b.namespace_id and o.operation_key=b.operation_key
cross join generate_series(1,40)n cross join lateral(select b.canonical_history_v1::jsonb||jsonb_build_object('delivery_key',private.fse_hash('bytes:'||n),'fact_tuple',repeat('x',7000),'fact_hash',private.fse_hash(repeat('x',7000))) v)x
where o.transaction_id='fixture:transaction:history-byte-budget';
update private.fse_scopes set generation=generation+1 where namespace_id=:'ns' and tenant_id=:'t';
select is(private.phase16c1b_command('history-byte-budget',1,'1000','PAYMENT',null,false,'unallocated')->'assessment'->'reasons'->>0,'HISTORY_INCOMPLETE','B05 byte budget fails closed below64 entries');
select private.phase16c1b_apply(private.phase16c1b_command('zero-credit',1,'0','PAYMENT',null,false,'unallocated'));
select is((select count(*) from private.fse_operation_claims c join private.fse_operations o using(namespace_id,operation_key) where o.transaction_id='fixture:transaction:zero-credit'),0::bigint,'B05 zero never credit authority');
select private.phase16c1b_apply(private.phase16c1b_command('missing-actual',1,null,'PAYMENT',null,false,'missing_amount'));
select ok(exists(select 1 from private.fse_observations o join private.fse_commands c on c.namespace_id=o.namespace_id and c.tenant_id=o.tenant_id and c.id=o.command_id where o.received_units is null and c.id in (select command_id from private.fse_assessments where result->'reasons' ? 'AMOUNT_MISSING')),'B05 missing amount stays null in storage');

-- B06 deterministic refund source movement is separate from correlation/VIP.
insert into fse_test_commands values('parent',private.phase16c1b_command('refund-parent'),null);
update fse_test_commands set r=private.phase16c1b_apply(d) where k='parent';
select (select d->'operation'->>'operation_key' from fse_test_commands where k='parent') parent_key \gset
select lives_ok(format('select private.phase16c1b_apply(private.phase16c1b_command(%L,1,%L,%L,%L))','refund-300','300','REFUND',:'parent_key'),'B06 first actual partial refund');
select lives_ok(format('select private.phase16c1b_apply(private.phase16c1b_command(%L,1,%L,%L,%L))','refund-400','400','REFUND',:'parent_key'),'B06 second actual partial refund');
select is((select linked_refund_units from private.fse_operations where namespace_id=:'ns' and operation_key=:'parent_key'),700::numeric,'B06 linked total exact700');
select lives_ok(format('select private.phase16c1b_apply(private.phase16c1b_command(%L,1,%L,%L,%L))','refund-300','300','REFUND',:'parent_key'),'B06 duplicate refund source replay retained');
select is((select linked_refund_units from private.fse_operations where namespace_id=:'ns' and operation_key=:'parent_key'),700::numeric,'B06 replay does not add refund twice');
select lives_ok(format('select private.phase16c1b_apply(private.phase16c1b_command(%L,1,%L,%L,%L))','refund-excess','500','REFUND',:'parent_key'),'B06 excess actual movement evidence retained');
select is((select linked_refund_units from private.fse_operations where namespace_id=:'ns' and operation_key=:'parent_key'),700::numeric,'B06 excess movement not correlated');
select lives_ok(format('select private.phase16c1b_apply(private.phase16c1b_command(%L,1,%L,%L,%L))','orphan-refund','100','REFUND',repeat('b',64)),'B06 refund-before-payment remains unresolved');
select is((select count(*) from private.fse_refund_correlations_v1),2::bigint,'B06 only two valid correlations');
select private.phase16c1b_apply(private.phase16c1b_command('refund-parent',1,'1000','PAYMENT',null,false,'reversed'));
select ok((select review_latched from private.fse_operations where namespace_id=:'ns' and operation_key=:'parent_key'),'B06 reversal new assessment latches owner review');
select is((select units from private.fse_operation_claims where namespace_id=:'ns' and operation_key=:'parent_key'),1000::numeric,'B06 historical financial claim unchanged');

-- B07 actual legacy tables and financial truth remain unchanged.
select is(jsonb_build_object('receipts',(select count(*) from private.verified_payment_receipts),
 'events',(select count(*) from public.domain_events),'outbox',(select count(*) from public.event_outbox),
 'periods',(select count(*) from public.subscription_payments),'subscriptions',(select count(*) from public.subscriptions),
 'access',(select count(*) from public.channel_access),'jobs',(select count(*) from public.entitlement_jobs),
 'invoice_state',(select jsonb_agg(jsonb_build_array(id,status,confirmed_at) order by id) from public.payment_invoices)),(select state from fse_before),'B07 no receipt/event/invoice/subscription/access/job/outbox mutation');
select ok(not exists(select 1 from public.audit_logs where action='financial_evidence.recorded' and (after_data::text like '%test:fse-payer%' or after_data::text like '%operation_key%' or after_data->>'financial_authority'<>'NONE')),'B07 safe append-only audit payload');
select ok(not exists(select 1 from private.fse_operation_claims where financial_authority<>'NONE' or evidence_origin<>'SYNTHETIC'),'B07 no synthetic-to-LIVE promotion');
select is(public.subscription_expiry('2028-01-31T00:00:00Z','{"duration_unit":"calendar_month","duration_count":1}'),'2028-02-29T00:00:00Z'::timestamptz,'B07 leap-year calendar month unchanged');
select diag('B07 genuine store-to-period and VIP activation DEFERRED-D/E; Phase10/11/14/15/C0 original suites remain independent mandatory regression gates.');
set constraints all immediate;
select * from finish();
rollback;
