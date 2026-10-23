-- Disposable PostgreSQL fixtures only. Never invoke against hosted databases.
create function private.phase16c1b_id(label_value text) returns uuid language sql immutable set search_path=pg_catalog as $$
 select (substr(x,1,8)||'-'||substr(x,9,4)||'-4'||substr(x,14,3)||'-8'||substr(x,18,3)||'-'||substr(x,21,12))::uuid from (select md5('phase16c1b:'||label_value) x) s;
$$;
revoke all on function private.phase16c1b_id(text) from public,anon,authenticated,service_role;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at)
select private.phase16c1b_id('user:'||n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','fse-role-'||n||'@example.test','not-used',now() from generate_series(1,6)n;
insert into public.tenants(id,name,slug) select private.phase16c1b_id('tenant:'||n),'FSE synthetic '||n,'phase16c1b-sandbox-'||n from generate_series(1,2)n;
insert into public.tenant_members(tenant_id,user_id,role)
select private.phase16c1b_id('tenant:1'),private.phase16c1b_id('user:'||n),(array['super_admin','manager','support','analyst','readonly'])[n]::public.app_role from generate_series(1,5)n;
insert into public.tenant_members(tenant_id,user_id,role) values(private.phase16c1b_id('tenant:2'),private.phase16c1b_id('user:6'),'manager');
insert into public.customers(id,tenant_id,display_name) select private.phase16c1b_id('customer:'||n),private.phase16c1b_id('tenant:'||n),'Synthetic evidence customer '||n from generate_series(1,2)n;
do $$declare n int;t uuid;u uuid;con uuid;evt uuid;
begin
 for n in 1..2 loop
  t:=private.phase16c1b_id('tenant:'||n);u:=private.phase16c1b_id(case when n=1 then 'user:2' else 'user:6' end);
  perform public.ingest_telegram_message(t,'fse-fixture','fse-'||n,'test:chat:'||n,'test:user:'||n,'test_fixture','Synthetic','Only','Network-free financial evidence fixture',null,now());
  update public.conversations set customer_id=private.phase16c1b_id('customer:'||n) where tenant_id=t;
  select id into con from public.conversations where tenant_id=t limit 1;
  select id into evt from public.domain_events where tenant_id=t and event_type='message.received' limit 1;
  insert into public.commercial_items(id,tenant_id,kind,created_by) values(private.phase16c1b_id('product:'||n),t,'product',u),(private.phase16c1b_id('plan:'||n),t,'plan',u);
  insert into public.commercial_versions(id,tenant_id,item_id,version,payload,created_by,effective_from)
   values(private.phase16c1b_id('product-version:'||n),t,private.phase16c1b_id('product:'||n),1,'{"title":"Synthetic fixture only"}',u,now()),
   (private.phase16c1b_id('plan-version:'||n),t,private.phase16c1b_id('plan:'||n),1,'{"title":"Synthetic plan","duration_unit":"calendar_month","duration_count":1}',u,now());
  insert into public.commercial_offers(id,tenant_id,conversation_id,customer_id,source_event_id,plan_version_id,product_version_id,amount,currency,discount_bps,snapshot,status,expires_at)
   values(private.phase16c1b_id('offer:'||n),t,con,private.phase16c1b_id('customer:'||n),evt,private.phase16c1b_id('plan-version:'||n),private.phase16c1b_id('product-version:'||n),1,'USD',0,'{"classification":"SYNTHETIC","authority":"NONE"}','approved',now()+interval '1 day');
  insert into public.payment_invoices(id,tenant_id,customer_id,offer_id,provider_id,provider_reference,channel,surface,amount_units,decimals,asset,network,recipient,payer_reference,min_confirmations,quote_snapshot,idempotency_key,expires_at,created_by)
   values(private.phase16c1b_id('invoice:'||n),t,private.phase16c1b_id('customer:'||n),private.phase16c1b_id('offer:'||n),'external_crypto_test','test:fse-invoice:'||n,'external_crypto','independent_web',1000,6,'USDT','TRON','test:fse-recipient','test:fse-payer',20,'{"mode":"test","source":"explicit_fixture"}','fse-fixture-'||n,now()+interval '1 day',u);
 end loop;
end;$$;
insert into private.fse_namespaces(id,provider_environment,admission_enabled) values(private.phase16c1b_id('namespace'),'FIXTURE',true);
insert into private.fse_scopes(namespace_id,tenant_id,writes_enabled) select private.phase16c1b_id('namespace'),private.phase16c1b_id('tenant:'||n),true from generate_series(1,2)n;
insert into private.fse_binding_versions(namespace_id,tenant_id,id,merchant_binding_id,revision,state,provider_id,merchant_account_id,environment,approval_reference,policy_hash,policy_snapshot,expected_asset,expected_basis)
select private.phase16c1b_id('namespace'),private.phase16c1b_id('tenant:'||n),private.phase16c1b_id('binding:'||n),private.phase16c1b_id('merchant:'||n),1,'ACTIVE','fixture:provider','fixture:shared-account','FIXTURE','fixture:approval',private.fse_hash('policy'),
 jsonb_build_object('version','fixture:v1','hash',private.fse_hash('policy'),'source_revision',1,'callback_max_age_seconds',300,'read_max_age_seconds',120,'clock_skew_seconds',2,'min_confirmations',20,'require_canonical',true,'physical_transfer_required',false,'distinct_refund_identity_supported',true),
 '{"kind":"TOKEN","code":"USDT","network":"TRON","contract":"fixture:contract-not-a-real-asset","decimals":6}','GROSS_CREDIT' from generate_series(1,2)n;

insert into private.fse_binding_versions(namespace_id,tenant_id,id,merchant_binding_id,revision,state,provider_id,merchant_account_id,environment,approval_reference,policy_hash,policy_snapshot,expected_asset,expected_basis)
select namespace_id,tenant_id,private.phase16c1b_id('binding:2:alternate'),private.phase16c1b_id('merchant:2:alternate'),1,state,'fixture:other-provider','fixture:other-account',environment,approval_reference,policy_hash,policy_snapshot,expected_asset,expected_basis
from private.fse_binding_versions where id=private.phase16c1b_id('binding:2');

create function private.phase16c1b_bundle(label_value text,tenant_number int default 1,units_value text default '1000',kind_value text default 'PAYMENT',original_value text default null,physical_value boolean default false,scenario_value text default 'ready') returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare ns uuid:=private.phase16c1b_id('namespace');t uuid:=private.phase16c1b_id('tenant:'||tenant_number);bid uuid:=private.phase16c1b_id('binding:'||tenant_number);
 b private.fse_binding_versions%rowtype;ctx jsonb;p jsonb;facts jsonb;operation_value jsonb;op_tuple text;phys_tuple text;selectors jsonb;src jsonb;invoice_id_value uuid;stamp text;occurred_value text;asset_key text;delivery text;
begin
 select * into b from private.fse_binding_versions where namespace_id=ns and tenant_id=t and merchant_binding_id=private.phase16c1b_id('merchant:'||tenant_number||case when scenario_value='other_provider' then ':alternate' else '' end) order by revision desc limit 1;bid:=b.id;
 stamp:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 select to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') into occurred_value from public.payment_invoices where tenant_id=t and id=private.phase16c1b_id('invoice:'||tenant_number);
 asset_key:=private.fse_asset_key(b.expected_asset);delivery:='fixture:delivery:'||label_value;
 operation_value:=jsonb_build_object('kind',kind_value,'direction',case kind_value when 'PAYMENT' then 'IN' when 'REFUND' then 'OUT' else 'NONE' end,
  'transaction_id','fixture:transaction:'||label_value,'transfer_index',case when physical_value then '0' else null end,'original_operation_key',original_value,
  'physical_transfer',case when physical_value then jsonb_build_object('ledger_id','TRON','transaction_id','fixture:transaction:'||label_value,'transfer_index','0','recipient','test:fse-recipient') else null end);
 op_tuple:=private.fse_tuple('operation',jsonb_build_array(b.provider_id,b.environment,b.merchant_account_id,kind_value,operation_value->>'direction',operation_value->>'transaction_id',operation_value->>'transfer_index',asset_key));
 if physical_value then phys_tuple:=private.fse_tuple('physical',jsonb_build_array('TRON',asset_key,operation_value->>'transaction_id','0',private.fse_hash(private.fse_tuple('private-ref','["test:fse-recipient"]'))));end if;
 invoice_id_value:=case when scenario_value='unallocated' then null else private.phase16c1b_id('invoice:'||tenant_number) end;
 selectors:=jsonb_build_object('operation_key',private.fse_hash(op_tuple),'physical_key',private.fse_hash(phys_tuple),'delivery_key',private.fse_hash(private.fse_tuple('delivery',jsonb_build_array(b.provider_id,b.environment,b.merchant_account_id,delivery))),
  'invoice_id',invoice_id_value,'original_operation_key',original_value,'kind',kind_value);
 p:=private.prepare_financial_evidence_v1(ns,t,bid,selectors,stamp);ctx:=p->'context';
 facts:=jsonb_build_object('account',ctx->'expected_account','provider_invoice_id',ctx->'expected_invoice'->>'provider_invoice_id','operation',operation_value,
  'received_units',case when kind_value='PAYMENT' and scenario_value<>'missing_amount' then units_value else null end,
  'refunded_units',case when kind_value='REFUND' and scenario_value<>'missing_amount' then units_value else null end,
  'amount_basis',case kind_value when 'REFUND' then 'GROSS_DEBIT' else 'GROSS_CREDIT' end,'asset',b.expected_asset,
  'payer_reference','test:fse-payer','recipient_reference','test:fse-recipient','occurred_at',occurred_value,'canonical',true,'confirmations',20,
  'settlement_status',case when scenario_value='reversed' then 'REVERSED' else 'SETTLED' end,'fee',null,'payout',null);
 src:=jsonb_build_object('contract_version',1,'evidence_origin','SYNTHETIC','provider_environment','FIXTURE','account',ctx->'expected_account','scope',ctx->'expected_scope','invoice_binding',ctx->'expected_invoice',
  'callback',jsonb_build_object('delivery_id',delivery,'event_id','fixture:event:'||label_value,'raw_hash',private.fse_hash('callback:'||label_value||':'||coalesce(units_value,'null')||':'||scenario_value),'source_id','fixture:callback','acquisition','CALLBACK',
   'authentication',case when scenario_value='invalid_auth' then 'INVALID' else 'AUTHENTICATED' end,'authentication_method','SYNTHETIC','key_reference','fixture:key','source_time',stamp,'received_at',stamp,'facts',facts),
  'independent_read',jsonb_build_object('acquisition','PROVIDER_LEDGER','status',case when scenario_value='timeout' then 'TIMEOUT' else 'OK' end,'source_id','fixture:independent-ledger',
   'source_record_id','fixture:record:'||label_value,'response_hash',private.fse_hash('ledger:'||label_value||':'||coalesce(units_value,'null')||':'||scenario_value),'authenticated_account',ctx->'expected_account','decoder_version','fixture:v1','read_at',stamp,'complete',scenario_value<>'timeout','source_revision',1,'facts',case when scenario_value='timeout' then null else facts end));
 return jsonb_build_object('namespace_id',ns,'binding_version_id',bid,'selectors',selectors,'source',src,'context',ctx,'history',p->'history','fence',p->'fence',
  'command_id',gen_random_uuid(),'series_id',gen_random_uuid(),'read_acquisition_id',gen_random_uuid());
end;$$;
revoke all on function private.phase16c1b_bundle(text,integer,text,text,text,boolean,text) from public,anon,authenticated,service_role;

-- A controlled fake assessor used only to exercise SQL invariants. The separate
-- DB integration test uses the actual accepted TypeScript v1 assessor instead.
create function private.phase16c1b_command(label_value text,tenant_number int default 1,units_value text default '1000',kind_value text default 'PAYMENT',original_value text default null,physical_value boolean default false,scenario_value text default 'ready') returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare bundle jsonb:=private.phase16c1b_bundle(label_value,tenant_number,units_value,kind_value,original_value,physical_value,scenario_value);
 src jsonb:=bundle->'source';ctx jsonb:=bundle->'context';hist jsonb:=bundle->'history';facts jsonb;cb jsonb;rd jsonb;op jsonb;op_tuple text;physical_tuple text;fact_tuple text;record_value jsonb;
 state_value text:='SOURCE_VERIFIED';eligibility text:='ELIGIBLE';reason_value text:='SOURCE_READY';assessment_value jsonb;hash_value text;obs jsonb:='[]';x jsonb;is_callback boolean;metadata jsonb;operation_metadata jsonb;original_units numeric;refund_units numeric;
begin
 cb:=src->'callback';rd:=src->'independent_read';facts:=cb->'facts';op:=facts->'operation';
 op_tuple:=private.fse_tuple('operation',jsonb_build_array(src->'account'->>'provider_id',src->>'provider_environment',src->'account'->>'merchant_account_id',kind_value,op->>'direction',op->>'transaction_id',op->>'transfer_index',private.fse_asset_key(facts->'asset')));
 if physical_value then physical_tuple:=private.fse_tuple('physical',jsonb_build_array('TRON',private.fse_asset_key(facts->'asset'),op->>'transaction_id',op->>'transfer_index',private.fse_hash(private.fse_tuple('private-ref','["test:fse-recipient"]'))));end if;
 fact_tuple:=private.fse_canonical(jsonb_build_object('version',1,'account',private.fse_hash(private.fse_tuple('private-ref',jsonb_build_array(private.fse_canonical(facts->'account')))),
  'invoice',case when facts->>'provider_invoice_id' is null then null else private.fse_hash(private.fse_tuple('private-ref',jsonb_build_array(facts->>'provider_invoice_id'))) end,
  'operation',private.fse_hash(private.fse_tuple('private-ref',jsonb_build_array(private.fse_canonical(op)))),
  'received_units',facts->'received_units','refunded_units',facts->'refunded_units','amount_basis',facts->>'amount_basis','asset',private.fse_asset_key(facts->'asset'),
  'payer',private.fse_hash(private.fse_tuple('private-ref','["test:fse-payer"]')),'recipient',private.fse_hash(private.fse_tuple('private-ref','["test:fse-recipient"]')),'occurred_at',facts->>'occurred_at'));
 record_value:=jsonb_build_object('operation_key',private.fse_hash(op_tuple),'operation_tuple',op_tuple,'physical_key',private.fse_hash(physical_tuple),'physical_tuple',physical_tuple,
  'delivery_key',bundle->'selectors'->>'delivery_key','raw_hash',cb->>'raw_hash','fact_hash',private.fse_hash(fact_tuple),'fact_tuple',fact_tuple,
  'tenant_key',private.fse_hash(private.fse_tuple('tenant',jsonb_build_array(src->'scope'->>'tenant_id'))),
  'account_key',private.fse_hash(private.fse_tuple('account',jsonb_build_array(src->'account'->>'provider_id',src->>'provider_environment',src->'account'->>'merchant_account_id'))),
  'invoice_key',case when ctx->'expected_invoice'<>'null'::jsonb then private.fse_hash(private.fse_tuple('invoice',jsonb_build_array(src->'scope'->>'tenant_id',ctx->'expected_invoice'->>'invoice_id'))) else null end,
  'asset_key',private.fse_asset_key(facts->'asset'),'kind',kind_value,'original_operation_key',original_value,'units',case when kind_value='REFUND' then facts->'refunded_units' else facts->'received_units' end,'source_state',state_value);
 if not(ctx->>'history_complete')::boolean then state_value:='PENDING';eligibility:='PENDING';reason_value:='HISTORY_INCOMPLETE';record_value:=null;
 elsif scenario_value='invalid_auth' then state_value:='REJECTED';eligibility:='INELIGIBLE';reason_value:='AUTHENTICATION_FAILED';record_value:=null;
 elsif scenario_value='timeout' then state_value:='PENDING';eligibility:='PENDING';reason_value:='SOURCE_UNAVAILABLE';record_value:=null;
 elsif scenario_value='reversed' then state_value:='REVIEW';eligibility:='REVIEW';reason_value:='SOURCE_REVERSED';record_value:=null;
 elsif exists(select 1 from jsonb_array_elements(hist) q where q->>'delivery_key'=record_value->>'delivery_key' and (q->>'raw_hash'<>cb->>'raw_hash' or q->>'operation_key'<>record_value->>'operation_key' or q->>'fact_tuple'<>fact_tuple)) then state_value:='REVIEW';eligibility:='REVIEW';reason_value:='DELIVERY_CONFLICT';
 elsif exists(select 1 from jsonb_array_elements(hist) q where q->>'operation_key'=record_value->>'operation_key' and (q->>'tenant_key'<>record_value->>'tenant_key' or q->>'fact_tuple'<>fact_tuple or q->>'invoice_key' is distinct from record_value->>'invoice_key')) then state_value:='REVIEW';eligibility:='REVIEW';reason_value:='OPERATION_CONFLICT';
 elsif exists(select 1 from jsonb_array_elements(hist) q where physical_value and q->>'physical_key'=record_value->>'physical_key' and (q->>'operation_key'<>record_value->>'operation_key' or q->>'tenant_key'<>record_value->>'tenant_key')) then state_value:='REVIEW';eligibility:='REVIEW';reason_value:='PHYSICAL_REUSE';
 elsif kind_value in ('REFUND_REQUEST','DISPUTE') then state_value:='REVIEW';eligibility:='REVIEW';reason_value:='NO_ACTUAL_MOVEMENT';
 elsif scenario_value='missing_amount' then state_value:='PENDING';eligibility:='PENDING';reason_value:='AMOUNT_MISSING';
 elsif units_value='0' then state_value:='PENDING';eligibility:='PENDING';reason_value:='NO_ACTUAL_MOVEMENT';
 elsif scenario_value='unallocated' then eligibility:='REVIEW';reason_value:='UNALLOCATED';
 elsif kind_value='REFUND' then
  select (q->>'units')::numeric into original_units from jsonb_array_elements(hist) q where q->>'operation_key'=original_value and q->>'source_state'='SOURCE_VERIFIED' and q->>'kind'='PAYMENT' limit 1;
  select coalesce(sum((q->>'units')::numeric),0) into refund_units from (select distinct on(q->>'operation_key') q from jsonb_array_elements(hist) q where q->>'kind'='REFUND' and q->>'original_operation_key'=original_value and q->>'source_state'='SOURCE_VERIFIED' and q->>'operation_key'<>record_value->>'operation_key') r;
  if original_units is null then eligibility:='REVIEW';reason_value:='REFUND_ORIGINAL_MISSING';
  elsif refund_units+units_value::numeric>original_units then eligibility:='REVIEW';reason_value:='REFUND_TOTAL_EXCEEDED';
  else eligibility:='INELIGIBLE';reason_value:='REFUND_EFFECT_REVIEW';end if;
 elsif exists(select 1 from jsonb_array_elements(hist) q where q->>'kind'='PAYMENT' and q->>'source_state'='SOURCE_VERIFIED' and q->>'invoice_key'=record_value->>'invoice_key' and q->>'operation_key'<>record_value->>'operation_key') then eligibility:='REVIEW';reason_value:='SECOND_PAYMENT';
 elsif units_value<>(ctx->>'expected_units') then eligibility:='REVIEW';reason_value:='AMOUNT_MISMATCH';end if;
 if record_value is not null then record_value:=record_value||jsonb_build_object('source_state',state_value);end if;
 for is_callback in select unnest(array[true,false]) loop
  x:=case when is_callback then cb else rd end;
  metadata:=jsonb_build_object('kind',case when is_callback then 'CALLBACK' else 'INDEPENDENT_READ' end,'acquisition',x->>'acquisition',
   'acquisition_key',case when is_callback then bundle->'selectors'->>'delivery_key' else private.fse_hash(private.fse_tuple('read-acquisition',jsonb_build_array(src->'account'->>'provider_id',src->>'provider_environment',src->'account'->>'merchant_account_id',bundle->>'read_acquisition_id'))) end,
   'source_id',x->>'source_id','source_record_id',case when is_callback then x->>'event_id' else x->>'source_record_id' end,
   'delivery_id',case when is_callback then x->>'delivery_id' else null end,'event_id',case when is_callback then x->>'event_id' else null end,
   'read_acquisition_id',case when is_callback then null else bundle->>'read_acquisition_id' end,
   'authentication',case when is_callback then x->>'authentication' else 'AUTHENTICATED' end,'authentication_method','SYNTHETIC',
   'raw_hash',case when is_callback then x->>'raw_hash' else x->>'response_hash' end,'fact_hash',case when x->'facts'='null'::jsonb then null else private.fse_hash(fact_tuple) end,
   'source_time',case when is_callback then x->>'source_time' else x->'facts'->>'occurred_at' end,'observed_at',case when is_callback then x->>'received_at' else x->>'read_at' end,
   'source_revision',case when is_callback then null else '1' end,'decoder_version',case when is_callback then 'financial-source-v1' else x->>'decoder_version' end,
   'status',case when is_callback then case when scenario_value='invalid_auth' then 'INVALID' else 'OK' end else x->>'status' end,'complete',case when is_callback then true else (x->>'complete')::boolean end,
   'received_units',x->'facts'->'received_units','refunded_units',x->'facts'->'refunded_units','asset',x->'facts'->'asset','amount_basis',x->'facts'->'amount_basis',
   'settlement_status',x->'facts'->'settlement_status','confirmations',case when x->'facts'='null'::jsonb then null else '20' end,'canonical',x->'facts'->'canonical',
   'fee',x->'facts'->'fee','payout',x->'facts'->'payout','payer_digest',case when x->'facts'='null'::jsonb then null else private.fse_hash(private.fse_tuple('private-ref','["test:fse-payer"]')) end,
   'recipient_digest',case when x->'facts'='null'::jsonb then null else private.fse_hash(private.fse_tuple('private-ref','["test:fse-recipient"]')) end);
  obs:=obs||jsonb_build_array(metadata);
 end loop;
 hash_value:=private.fse_hash(private.fse_canonical(jsonb_build_object('version',1,'facts',case when rd->'facts'='null'::jsonb then null else private.fse_hash(fact_tuple) end,'callback_hash',cb->>'raw_hash','read_hash',rd->>'response_hash',
  'now',ctx->>'now','read_at',rd->>'read_at','callback_at',cb->>'received_at',
  'scope',private.fse_hash(private.fse_tuple('private-ref',jsonb_build_array(private.fse_canonical(ctx->'expected_scope')))),
  'invoice',private.fse_hash(private.fse_tuple('private-ref',jsonb_build_array(private.fse_canonical(ctx->'expected_invoice')))),
  'policy',ctx->'policy','state',state_value,'eligibility',eligibility,'reasons',jsonb_build_array(reason_value),
  'source_envelope_hash',private.fse_hash(private.fse_canonical(src)),'context_hash',private.fse_hash(private.fse_canonical(ctx)))));
 assessment_value:=jsonb_build_object('contract_version',1,'source_state',state_value,'fulfillment_eligibility',eligibility,'financial_authority','NONE','classification','SANDBOX',
  'completeness',case state_value when 'SOURCE_VERIFIED' then 'COMPLETE_CORROBORATED' when 'REVIEW' then 'CONFLICTED' when 'PENDING' then 'INCOMPLETE' else 'UNVERIFIABLE' end,
  'reasons',jsonb_build_array(reason_value),'received_units',case when state_value='SOURCE_VERIFIED' then facts->'received_units' else null end,'refunded_units',case when state_value='SOURCE_VERIFIED' then facts->'refunded_units' else null end,
  'fee',null,'payout',null,'replay',exists(select 1 from jsonb_array_elements(hist) q where q->>'operation_key'=private.fse_hash(op_tuple) and q->>'source_state'='SOURCE_VERIFIED'),'assessment_hash',hash_value,'history_record',record_value);
 operation_metadata:=jsonb_build_object('operation_key',private.fse_hash(op_tuple),'operation_tuple',op_tuple,'provider_id',src->'account'->>'provider_id','environment',src->>'provider_environment','merchant_account_id',src->'account'->>'merchant_account_id',
  'kind',kind_value,'direction',op->>'direction','transaction_id',op->>'transaction_id','transfer_index',op->>'transfer_index','asset',facts->'asset','original_operation_key',original_value,'physical_key',private.fse_hash(physical_tuple),'physical_tuple',physical_tuple);
 return jsonb_build_object('version',1,'evidence_origin','SYNTHETIC','financial_authority','NONE','namespace_id',bundle->'namespace_id','tenant_id',src->'scope'->>'tenant_id','binding_version_id',bundle->'binding_version_id',
  'command_id',bundle->'command_id','evaluation_series_id',bundle->'series_id','previous_assessment_id',null,'evaluation_clock',ctx->>'now','fence',bundle->'fence','selectors',bundle->'selectors',
  'source_envelope_hash',private.fse_hash(private.fse_canonical(src)),'context_hash',private.fse_hash(private.fse_canonical(ctx)),'operation',operation_metadata,'observations',obs,'assessment',assessment_value,
  'effect_kind',case when state_value<>'SOURCE_VERIFIED' then 'NONE' when kind_value='PAYMENT' and eligibility='ELIGIBLE' then 'ALLOCATION_CANDIDATE' when kind_value='REFUND' and eligibility='INELIGIBLE' then 'REFUND_CORRELATION' else 'CLAIM_ONLY' end);
end;$$;
revoke all on function private.phase16c1b_command(text,integer,text,text,text,boolean,text) from public,anon,authenticated,service_role;

create function private.phase16c1b_apply(d jsonb) returns jsonb language sql set search_path=pg_catalog as $$
 select private.record_financial_evidence_v1(private.fse_canonical(d),private.fse_storage_hash(jsonb_build_array('command',private.fse_canonical(d))));
$$;
revoke all on function private.phase16c1b_apply(jsonb) from public,anon,authenticated,service_role;
