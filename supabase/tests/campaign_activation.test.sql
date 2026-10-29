begin;
set local search_path=public,extensions;
create extension if not exists pgtap with schema extensions;
select no_plan();
\ir helpers/campaign_fixtures.sql
select pg_temp.campaign_setup(9901);
select pg_temp.campaign_setup(9902,false);
select pg_temp.campaign_owner(9901);

select is((select state from private.sales_campaigns where id=pg_temp.polat_id(9901,'9000')),'ACTIVE','one founder START activates configured campaign');
select is((select count(*)from private.campaign_permissions where tenant_id=pg_temp.polat_id(9901,'2000')),1::bigint,'one immutable declaration for whole dataset');
select is((select count(*)from public.import_rows where tenant_id=pg_temp.polat_id(9901,'2000')and status='imported'),2::bigint,'both duplicate rows reconciled');
select is((select count(*)from private.campaign_audience where tenant_id=pg_temp.polat_id(9901,'2000')),1::bigint,'audience deduplicated to one real fixture customer');
select is((public.admin_campaign_commit_batch_v1(pg_temp.polat_id(9901,'2000'),(select batch_id from private.campaign_permissions where tenant_id=pg_temp.polat_id(9901,'2000')))->>'replay'),'true','committed import is idempotent');
select is((select count(*)from private.verified_payment_receipts where tenant_id=pg_temp.polat_id(9901,'2000')),0::bigint,'import cannot create a receipt');
select is((select count(*)from public.messages where tenant_id=pg_temp.polat_id(9901,'2000')and direction='outbound'),0::bigint,'batch import/activation send zero real messages');
select throws_ok($$update private.campaign_permissions set declaration='{}' where tenant_id=pg_temp.polat_id(9901,'2000')$$,'42501','CAMPAIGN_EVIDENCE_IMMUTABLE','permission history immutable');
select is((public.campaign_schedule_v1(pg_temp.polat_id(9901,'2000'),pg_temp.polat_id(9901,'9000'))->>'scheduled')::int,1,'follow-up scheduled without per-message founder approval');
select is((public.campaign_schedule_v1(pg_temp.polat_id(9901,'2000'),pg_temp.polat_id(9901,'9000'))->>'scheduled')::int,0,'duplicate scheduling produces no duplicate job');
select is((select max_attempts from public.scheduled_jobs where tenant_id=pg_temp.polat_id(9901,'2000')and job_type='campaign.sales_reply'),1,'one accountable attempt, no hidden retry');
create temp table campaign_claim as select public.campaign_claim_fixture_v1(pg_temp.polat_id(9901,'2000'),pg_temp.polat_id(9901,'9000'),'worker_a')v;
select is((select v->>'state'from campaign_claim),'RESERVED','real PG reservation commits before dispatch');
select is((select attempts from private.sales_campaigns where id=pg_temp.polat_id(9901,'9000')),1,'claim consumes persistent request budget');
select is((select reserved_liability::text from private.sales_campaigns where id=pg_temp.polat_id(9901,'9000')),'0.010000','exact decimal maximum liability reserved');
select is((public.campaign_claim_fixture_v1(pg_temp.polat_id(9901,'2000'),pg_temp.polat_id(9901,'9000'),'worker_b')->>'state'),'EMPTY','second worker cannot own reserved valid lease');
select is((public.campaign_prepare_fixture_v1(pg_temp.polat_id(9901,'2000'),(select(v->>'job_id')::uuid from campaign_claim),(select(v->>'lease_token')::uuid from campaign_claim),repeat('b',64))->>'state'),'PREPARED','fixture preparation binds exact body hash');
select throws_ok($$select public.campaign_prepare_fixture_v1(pg_temp.polat_id(9901,'2000'),(select(v->>'job_id')::uuid from campaign_claim),extensions.gen_random_uuid(),repeat('b',64))$$,'42501','CAMPAIGN_LEASE_INVALID','wrong lease token denied');
select public.admin_campaign_state_v1(pg_temp.polat_id(9901,'2000'),pg_temp.polat_id(9901,'9000'),2,'PAUSE');
select is(public.campaign_dispatch_fixture_v1(pg_temp.polat_id(9901,'2000'),(select(v->>'job_id')::uuid from campaign_claim),(select(v->>'lease_token')::uuid from campaign_claim)),false,'PAUSE fences a prepared intent');
select public.admin_campaign_state_v1(pg_temp.polat_id(9901,'2000'),pg_temp.polat_id(9901,'9000'),3,'START');
select is(public.campaign_dispatch_fixture_v1(pg_temp.polat_id(9901,'2000'),(select(v->>'job_id')::uuid from campaign_claim),(select(v->>'lease_token')::uuid from campaign_claim)),false,'resume never revives an old generation');
select throws_ok($$select public.admin_campaign_state_v1(pg_temp.polat_id(9901,'2000'),pg_temp.polat_id(9901,'9000'),2,'STOP')$$,'40001','CAMPAIGN_CHANGED','stale founder action rejected');
select public.admin_campaign_state_v1(pg_temp.polat_id(9901,'2000'),pg_temp.polat_id(9901,'9000'),4,'STOP');
select is((public.campaign_schedule_v1(pg_temp.polat_id(9901,'2000'),pg_temp.polat_id(9901,'9000'))->>'scheduled')::int,0,'STOP prevents more scheduling');
select throws_ok($$select public.admin_campaign_state_v1(pg_temp.polat_id(9901,'2000'),pg_temp.polat_id(9901,'9000'),5,'START')$$,'22023','CAMPAIGN_STATE_INVALID','STOP is terminal');
select pg_temp.campaign_owner(9902);
select public.admin_campaign_state_v1(pg_temp.polat_id(9902,'2000'),pg_temp.polat_id(9902,'9000'),1,'START');
select is(private.campaign_contact_reason(pg_temp.polat_id(9902,'2000'),pg_temp.polat_id(9902,'9000'),pg_temp.polat_id(9902,'5000')),null,'batch declaration applies without claiming individual consent');
select pg_temp.polat_send(9902,'2');
select public.ingest_telegram_message(pg_temp.polat_id(9902,'2000'),'campaign-optout','3','7100009902','7100009902',null,'Synthetic',null,'Do not contact me again',null,clock_timestamp());
select is(private.campaign_contact_reason(pg_temp.polat_id(9902,'2000'),pg_temp.polat_id(9902,'9000'),pg_temp.polat_id(9902,'5000')),'CONTACT_SUPPRESSED','fresh opt-out immediately blocks future outreach');
select is((public.campaign_schedule_v1(pg_temp.polat_id(9902,'2000'),pg_temp.polat_id(9902,'9000'))->>'scheduled')::int,0,'no scheduled outbound after opt-out');
select throws_ok($$delete from private.campaign_suppressions where tenant_id=pg_temp.polat_id(9902,'2000')$$,'42501','CAMPAIGN_EVIDENCE_IMMUTABLE','batch cannot erase opt-out');
select is((public.admin_campaign_workspace_v1(pg_temp.polat_id(9902,'2000'))->'items'->0->>'financial_authority'),'NONE','read model preserves financial authority NONE');
select is((public.admin_campaign_workspace_v1(pg_temp.polat_id(9902,'2000'))->'items'->0->>'actual_cost'),null,'unknown cost is null, not zero');
select is((public.campaign_runtime_scope_v1(pg_temp.polat_id(9902,'2000'),pg_temp.polat_conv(9902))->>'genuine_executor_accepted'),'false','campaign alone grants no real provider execution');
select ok(not has_table_privilege('authenticated','private.sales_campaigns','SELECT'),'raw campaign SELECT denied');
select ok(not has_table_privilege('service_role','private.campaign_permissions','INSERT'),'service role cannot forge founder attestation');
select ok(not has_function_privilege('authenticated','public.campaign_claim_fixture_v1(uuid,uuid,text)','EXECUTE'),'browser cannot claim worker jobs');
select ok(not has_function_privilege('anon','public.admin_campaign_state_v1(uuid,uuid,integer,text)','EXECUTE'),'anonymous cannot activate campaigns');
select ok(not has_function_privilege('authenticated','public.commit_import_batch(uuid,text)','EXECUTE'),'legacy unbound import RPC remains locked');
set local role authenticated;
select set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"61b01000-0000-4000-8000-000000000002","aal":"aal2"}',true);
select throws_ok($$select public.admin_campaign_state_v1(pg_temp.polat_id(9902,'2000'),pg_temp.polat_id(9902,'9000'),2,'PAUSE')$$,'42501','CAMPAIGN_UNAVAILABLE','support role cannot activate/change campaign');
select throws_ok($$select public.admin_campaign_workspace_v1(pg_temp.polat_id(9902,'2000'))$$,'42501','CAMPAIGN_UNAVAILABLE','support cannot read private commercial budgets');
set local role postgres;
select pg_temp.campaign_owner(9902);
select set_config('request.jwt.claims','{"sub":"61ca1000-0000-4000-8000-000000000001","aal":"aal1"}',true);
select throws_ok($$select public.admin_campaign_state_v1(pg_temp.polat_id(9902,'2000'),pg_temp.polat_id(9902,'9000'),2,'PAUSE')$$,'42501','CAMPAIGN_UNAVAILABLE','MFA authentication retained');
-- Commercial-shaped fixtures are local only. They grant no live receipt/model authority.
select pg_temp.campaign_setup(9903,true,true);
update public.tenants set outbound_messaging_enabled=true where id=pg_temp.polat_id(9903,'2000');
select pg_temp.polat_send(9903,'2');
-- pgTAP's one surrounding transaction pins now(); set this fixture's observed insertion boundary explicitly.
update public.messages set created_at=clock_timestamp()where tenant_id=pg_temp.polat_id(9903,'2000')and provider_message_id='2';
create temp table campaign_offer as select private.prepare_commercial_offer(pg_temp.polat_id(9903,'2000'),
 (select e.id from public.domain_events e join public.messages m on m.tenant_id=e.tenant_id and m.id::text=e.payload->>'message_id'where e.tenant_id=pg_temp.polat_id(9903,'2000')and m.provider_message_id='2'and e.event_type='message.received'),pg_temp.polat_id(9903,'7001'),0)id;
select is((select status from public.commercial_offers where id=(select id from campaign_offer)),'approved','configured published exact-price offer auto-approved without per-offer human review');
select is((select reviewer from public.commercial_offers where id=(select id from campaign_offer)),null,'system approval never fabricates a human reviewer');
select is((select count(*)from public.audit_logs where tenant_id=pg_temp.polat_id(9903,'2000')and action='campaign.offer_preapproved'),1::bigint,'automatic offer approval retains explicit audit');
select pg_temp.polat_send(9903,'3');
update public.messages set created_at=clock_timestamp()where tenant_id=pg_temp.polat_id(9903,'2000')and provider_message_id='3';
insert into public.commercial_offers(tenant_id,conversation_id,customer_id,source_event_id,plan_version_id,product_version_id,amount,currency,discount_bps,snapshot,expires_at)
select o.tenant_id,o.conversation_id,o.customer_id,(select e.id from public.domain_events e join public.messages m on m.tenant_id=e.tenant_id and m.id::text=e.payload->>'message_id'where e.tenant_id=o.tenant_id and m.provider_message_id='3'and e.event_type='message.received'),o.plan_version_id,o.product_version_id,1,o.currency,0,o.snapshot,o.expires_at
from public.commercial_offers o where o.id=(select id from campaign_offer);
select is((select count(*)from public.commercial_offers where tenant_id=pg_temp.polat_id(9903,'2000')and amount=1 and status='draft'),1::bigint,'wrong price stays in exception review');
select throws_ok($$select public.consume_verified_payment(pg_temp.polat_id(9903,'2000'),extensions.gen_random_uuid())$$,'42501','live entitlements disabled','campaign activation does not enable genuine receipts or paid VIP');
select is((select count(*)from public.subscriptions where tenant_id=pg_temp.polat_id(9903,'2000')),0::bigint,'commercial-shaped fixture creates no subscription without receipt');
select throws_ok($$select public.campaign_claim_fixture_v1(pg_temp.polat_id(9903,'2000'),pg_temp.polat_id(9903,'9000'),'forged_worker')$$,'42501','CAMPAIGN_GENUINE_EXECUTOR_UNAVAILABLE','fake worker cannot dispatch a commercial campaign');
select throws_ok($$update private.sales_campaigns set attempts=0,reserved_liability=0 where id=pg_temp.polat_id(9901,'9000')$$,'42501','CAMPAIGN_HISTORY_OR_BUDGET_IMMUTABLE','restart cannot reset persisted lifetime budget');
select throws_ok($$update private.campaign_jobs set source_hash=repeat('c',64)where tenant_id=pg_temp.polat_id(9901,'2000')$$,'42501','CAMPAIGN_EVIDENCE_IMMUTABLE','operation/source binding is immutable');
select throws_ok($$select public.admin_campaign_commit_batch_v1('ffffffff-ffff-4fff-8fff-ffffffffffff',extensions.gen_random_uuid())$$,'42501','CAMPAIGN_UNAVAILABLE','unknown tenant and existing foreign tenant both remain unavailable');
select is((public.admin_campaign_options_v1(pg_temp.polat_id(9903,'2000'))->'batches'->0->>'unique_customers')::int,1,'operator selects a reconciled audience without reading raw customer data');
select ok(not has_function_privilege('authenticated','public.process_campaign_due_v1()','EXECUTE'),'browser cannot invoke the scheduler');
select pg_temp.campaign_owner(9902);
-- Two distinct identities share a forged batch hash, one exact duplicate and two unresolved rows.
create temp table campaign_partial as select public.create_import_dry_run(pg_temp.polat_id(9902,'2000'),'csv','Synthetic historical fixture','partial-invented.csv',repeat('a',64),
 (select jsonb_agg(jsonb_build_object('row_number',n,'classification',case when n in(5,6)then 'exact_match'else 'new_customer'end,'candidate_customer_id',case when n=5 then pg_temp.polat_id(9902,'5000')end,
 'batch_customer_ref',repeat('d',64),'identity_fingerprint',repeat('c',64),'validation_error_count',0,'normalized_payload',jsonb_build_object('display_name','Invented import row','identities',
 case when n=4 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('identity_type','telegram_user_id','identity_value',case when n=6 then '7990000002'else '799000000'||n::text end,
 'normalized_value',case when n=6 then '7990000002'else '799000000'||n::text end,'identity_scope','global'))end,'profile','{}'::jsonb,'memory','[]'::jsonb,'contact',jsonb_build_object('market','GB','language','en'))))from generate_series(2,6)n))v;
create temp table campaign_partial_result as select public.admin_campaign_import_authorized_v1(pg_temp.polat_id(9902,'2000'),pg_temp.campaign_declaration(9902,(select(v->>'batch_id')::uuid from campaign_partial))::text)v;
select is((select(v->>'unique_customers')::int from campaign_partial_result),2,'fresh identity matches defeat forged within-batch grouping hashes');
select is((select(v->>'imported_rows')::int from campaign_partial_result),3,'exact duplicate safely links after prior rows commit in same transaction');
select is((select(v->>'pending_identity_review')::int from campaign_partial_result),2,'name-only and forged candidate rows remain visible exceptions');
select is((select v->>'status'from campaign_partial_result),'review_required','partial import report does not claim every row completed');
select is((public.admin_campaign_save_v1(pg_temp.polat_id(9902,'2000'),pg_temp.polat_id(9904,'9000'),pg_temp.campaign_config(9902,(select(v->>'batch_id')::uuid from campaign_partial),pg_temp.polat_id(9902,'7001'))::text,0)->>'state'),'READY','safe imported subset can proceed without approving every unresolved row');
select is((public.admin_campaign_commit_batch_v1(pg_temp.polat_id(9902,'2000'),(select(v->>'batch_id')::uuid from campaign_partial))->>'unique_customers')::int,2,'partial import replay creates no duplicate customers');
select * from finish();
rollback;
