-- Dormant genuine Stars admission into EXISTING invoice/receipt/subscription ledgers.
-- No merchant, price, financial authority or channel approval is provisioned here.
alter table private.entitlement_controls add column stars_binding jsonb;
alter table private.payment_adapter_registry drop constraint payment_adapter_registry_mode_check;
alter table private.payment_adapter_registry add constraint payment_adapter_registry_mode_check check(mode='test'or mode='live'and id='telegram_stars_live'and channel='telegram_stars');
-- The genuine registry entry is NOT seeded. Reviewed eligible merchant setup
-- must register it atomically with the existing private financial control.
alter table public.payment_invoices drop constraint payment_invoices_mode_check,drop constraint payment_invoices_provider_reference_check,drop constraint payment_invoices_payer_reference_check,drop constraint payment_invoices_recipient_check;
alter table public.payment_invoices add constraint payment_invoice_mode_scope check(
 (mode='test'and provider_reference~'^test:[A-Za-z0-9:_-]+$'and recipient~'^test:'and payer_reference~'^test:')or
 (mode='live'and provider_id='telegram_stars_live'and channel='telegram_stars'and surface='telegram_bot'and asset='XTR'and network='TELEGRAM'and decimals=0 and min_confirmations=1 and amount_units<=9007199254740991 and provider_reference='stars-live:'||id::text and recipient~'^[1-9][0-9]{0,15}$'and payer_reference~'^[1-9][0-9]{0,15}$'));
alter table public.payment_transactions drop constraint payment_transactions_mode_check,drop constraint payment_transactions_transaction_reference_check;
alter table public.payment_transactions add constraint payment_transaction_mode_scope check((mode='test'and transaction_reference~'^test:')or(mode='live'and provider_id='telegram_stars_live'and network='TELEGRAM'and char_length(transaction_reference)between 1 and 200 and transaction_reference!~'^test:'));
alter table public.payment_observations alter column snapshot_id drop not null,add column provider_evidence jsonb;
alter table public.payment_observations drop constraint payment_observations_event_id_check,drop constraint payment_observations_mode_check;
alter table public.payment_observations add constraint payment_observation_mode_scope check(
 (mode='test'and event_id~'^test:[A-Za-z0-9:_-]{1,160}$'and snapshot_id is not null and provider_evidence is null)or
 (mode='live'and provider_id='telegram_stars_live'and event_id~'^stars:[A-Za-z0-9:_-]{1,180}$'and snapshot_id is null and provider_evidence is not null and jsonb_typeof(provider_evidence)='object'and octet_length(provider_evidence::text)<=65536));
alter table private.verified_payment_receipts add column invoice_id uuid,add column amount_units numeric(30,0),add column asset text,add column network text,add column payer_reference text,add column recipient text;
alter table private.verified_payment_receipts add foreign key(tenant_id,invoice_id)references public.payment_invoices(tenant_id,id);
alter table private.verified_payment_receipts add constraint stars_receipt_amount_provenance check(provider_id<>'telegram_stars_live'or(invoice_id is not null and amount_units is not null and asset is not null and network is not null and payer_reference is not null and recipient is not null and amount_units>0 and asset='XTR'and network='TELEGRAM'and payer_reference~'^[1-9][0-9]{0,15}$'and recipient~'^[1-9][0-9]{0,15}$'));

-- Existing privileged controls, not a new approval engine. Only reviewed protected
-- database-owner setup may populate this field from independent eligibility evidence.
create function private.stars_commerce_guard(t uuid)returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare c private.entitlement_controls;b jsonb;begin
 select * into c from private.entitlement_controls where tenant_id=t;b:=c.stars_binding;
 if not private.entitlement_live_allowed(t)or not exists(select 1 from private.payment_adapter_registry where id='telegram_stars_live'and channel='telegram_stars'and mode='live')or b is null or not private.fse_keys(b,array['version','environment','tenant_id','financial_authority','approval_reference','repository_sha','bot_user_id','credential_sha256','webhook_secret_sha256','owner_user_id','eligibility_evidence_hash','owner_authorization_hash','channel_id','expires_at','allowed_markets'])or not private.fse_strings(b,array['environment','tenant_id','financial_authority','approval_reference','repository_sha','bot_user_id','credential_sha256','webhook_secret_sha256','owner_user_id','eligibility_evidence_hash','owner_authorization_hash','channel_id','expires_at'])or b->'version'is distinct from '1'::jsonb or b->>'environment'is distinct from 'TELEGRAM_PRODUCTION'
 or b->>'tenant_id'is distinct from t::text or b->>'financial_authority'is distinct from 'VERIFIED_STARS_RECEIPT'
 or b->>'approval_reference'is distinct from c.approval_reference or b->>'repository_sha'!~'^[a-f0-9]{40}$'
 or b->>'bot_user_id'!~'^[1-9][0-9]{0,15}$'or b->>'credential_sha256'!~'^[a-f0-9]{64}$'or b->>'webhook_secret_sha256'!~'^[a-f0-9]{64}$'
 or b->>'eligibility_evidence_hash'!~'^[a-f0-9]{64}$'or b->>'owner_authorization_hash'!~'^[a-f0-9]{64}$'
 or jsonb_typeof(b->'allowed_markets')is distinct from 'array'or jsonb_array_length(b->'allowed_markets')not between 1 and 250 or exists(select 1 from jsonb_array_elements_text(b->'allowed_markets')country where country!~'^[A-Z]{2}$'or country='TR')
 or b->>'channel_id'!~'^-100[0-9]{1,13}$'or(b->>'expires_at')::timestamptz<=clock_timestamp()
 or not exists(select 1 from public.tenant_members where tenant_id=t and user_id=(b->>'owner_user_id')::uuid and role='super_admin'and status='active')
 or not exists(select 1 from public.vip_channels where tenant_id=t and mode='live'and chat_id=b->>'channel_id'and enabled and private_verified and approval_reference is not null)
 then raise exception 'STARS_COMMERCE_EXTERNAL_AUTHORITY_REQUIRED'using errcode='42501';end if;return b;end;$$;
create function public.stars_commerce_scope_v1(target_tenant_id uuid)returns jsonb language sql stable security definer set search_path=pg_catalog as $$select private.stars_commerce_guard(target_tenant_id);$$;
create function private.stars_intent(i public.payment_invoices)returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('version',1,'environment','TELEGRAM_PRODUCTION','tenant_id',i.tenant_id,'invoice_id',i.id,'offer_id',i.offer_id,'customer_id',i.customer_id,'bot_user_id',i.recipient,'payer_user_id',i.payer_reference,'amount_units',i.amount_units::text,'currency','XTR','title',i.quote_snapshot->>'title','description',i.quote_snapshot->>'description','expires_at',i.expires_at);$$;
create function public.stars_commerce_intent_v1(target_tenant_id uuid,target_invoice_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare i public.payment_invoices;begin
 perform private.stars_commerce_guard(target_tenant_id);select * into i from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and mode='live'and provider_id='telegram_stars_live';if i.id is null then raise exception 'STARS_INVOICE_UNAVAILABLE'using errcode='42501';end if;return private.stars_intent(i);end;$$;

create function public.stars_commerce_prepare_v1(target_tenant_id uuid,target_offer_id uuid,request_key_value text,purchase_source_event_id_value uuid default null)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b jsonb;o public.commercial_offers;cv public.conversations;mc public.messaging_contacts;i public.payment_invoices;v public.commercial_versions;uid text;source_message public.messages;source_job private.campaign_jobs;customer_state public.customer_state;intent_event uuid;tr jsonb;begin
 b:=private.stars_commerce_guard(target_tenant_id);
 if not exists(select 1 from private.campaign_audience audience join private.sales_campaigns campaign on campaign.tenant_id=audience.tenant_id and campaign.id=audience.campaign_id join public.commercial_offers offer_row on offer_row.tenant_id=audience.tenant_id and offer_row.customer_id=audience.customer_id where audience.tenant_id=target_tenant_id and offer_row.id=target_offer_id and campaign.state='ACTIVE'and campaign.configuration->>'plan_version_id'=offer_row.plan_version_id::text and b->'allowed_markets'?audience.market and audience.market<>'TR')then raise exception 'STARS_ELIGIBLE_CAMPAIGN_MARKET_REQUIRED'using errcode='42501';end if;
 if exists(select 1 from private.campaign_audience a join private.sales_campaigns c on c.tenant_id=a.tenant_id and c.id=a.campaign_id join public.commercial_offers offer_row on offer_row.tenant_id=a.tenant_id and offer_row.customer_id=a.customer_id where offer_row.tenant_id=target_tenant_id and offer_row.id=target_offer_id and c.state<>'ACTIVE')then raise exception 'STARS_CAMPAIGN_NOT_ACTIVE'using errcode='42501';end if;
 if request_key_value is null or request_key_value!~'^[A-Za-z0-9:_-]{1,100}$'then raise exception 'STARS_REQUEST_INVALID'using errcode='22023';end if;
 select * into o from public.commercial_offers where tenant_id=target_tenant_id and id=target_offer_id for update;
 select * into v from public.commercial_versions where tenant_id=target_tenant_id and id=o.plan_version_id;
 select * into cv from public.conversations where tenant_id=target_tenant_id and id=o.conversation_id;
 select * into mc from public.messaging_contacts where tenant_id=target_tenant_id and id=cv.messaging_contact_id and customer_id=o.customer_id;
 if o.id is null or o.status<>'approved'or o.expires_at<=clock_timestamp()or o.currency<>'XTR'or o.amount<>trunc(o.amount)or o.amount not between 1 and 9007199254740991
 or o.snapshot#>'{plan,payload}'is distinct from v.payload or not private.valid_commercial_payload('plan',v.payload)or v.status<>'published'or v.effective_from>clock_timestamp()or coalesce(v.expires_at,'infinity')<=clock_timestamp()or coalesce(v.superseded_at,'infinity')<=clock_timestamp()
 or not exists(select 1 from public.commercial_items where tenant_id=target_tenant_id and id=v.item_id and not test_only and archived_at is null)
 or v.payload->>'currency'<>'XTR'or(v.payload->>'amount')::numeric is distinct from o.amount
 or char_length(v.payload->>'title')not between 1 and 32 or char_length(v.payload->>'terms')not between 1 and 255
 or mc.id is null or mc.provider_user_id!~'^[1-9][0-9]{0,15}$'or mc.provider_user_id is distinct from mc.provider_chat_id or mc.contactability not in('allowed','user_initiated')
 or not exists(select 1 from public.customer_identities where tenant_id=target_tenant_id and customer_id=o.customer_id and identity_type='telegram_user_id'and normalized_value=mc.provider_user_id)
 or exists(select 1 from private.campaign_suppressions where tenant_id=target_tenant_id and customer_id=o.customer_id)
 or not exists(select 1 from public.customers where tenant_id=target_tenant_id and id=o.customer_id and(state in('PAYMENT_PENDING','PAID','ACTIVE','RENEWAL_DUE','RENEWED','EXPIRED')or state='INTERESTED'and purchase_source_event_id_value is not null))
 then raise exception 'STARS_APPROVED_PURCHASE_REQUIRED'using errcode='42501';end if;
 if purchase_source_event_id_value is not null then
  select m.* into source_message from public.domain_events e join public.messages m on m.tenant_id=e.tenant_id and m.id::text=e.payload->>'message_id'where e.tenant_id=target_tenant_id and e.id=purchase_source_event_id_value and e.event_type='message.received'and m.customer_id=o.customer_id and m.conversation_id=o.conversation_id and m.direction='inbound'and lower(btrim(m.content))in('/buy','/subscribe');
  select cj.* into source_job from private.campaign_jobs cj join public.agent_tasks atask on atask.tenant_id=cj.tenant_id and atask.id=cj.agent_task_id where cj.tenant_id=target_tenant_id and cj.conversation_id=o.conversation_id and cj.source_message_id=source_message.id and atask.source_event_id=purchase_source_event_id_value and atask.status='RUNNING'limit 1;
  if source_message.id is null or source_job.job_id is null then raise exception 'STARS_EXPLICIT_PURCHASE_SOURCE_REQUIRED'using errcode='42501';end if;
  perform private.campaign_native_source(target_tenant_id,source_job.campaign_id,source_job.job_id);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('STARS_ORDER:'||target_tenant_id::text||':'||request_key_value,0));
 select * into i from public.payment_invoices where tenant_id=target_tenant_id and(idempotency_key='stars:'||request_key_value or offer_id=o.id and mode='live')order by created_at limit 1;
 if i.id is not null then if i.offer_id<>o.id or i.mode<>'live'then raise exception 'STARS_ORDER_CONFLICT'using errcode='23505';end if;return private.stars_intent(i);end if;
 i.id:=extensions.gen_random_uuid();
 insert into public.payment_invoices(id,tenant_id,customer_id,offer_id,provider_id,provider_reference,channel,surface,mode,amount_units,decimals,asset,network,recipient,payer_reference,min_confirmations,quote_snapshot,idempotency_key,expires_at,created_by)
 values(i.id,target_tenant_id,o.customer_id,o.id,'telegram_stars_live','stars-live:'||i.id::text,'telegram_stars','telegram_bot','live',o.amount,0,'XTR','TELEGRAM',b->>'bot_user_id',mc.provider_user_id,1,
 jsonb_build_object('origin','TELEGRAM_PRODUCTION','title',v.payload->>'title','description',v.payload->>'terms','offer_snapshot',o.snapshot,'amount_basis','GROSS_XTR_NOT_USD_OR_PAYOUT'),'stars:'||request_key_value,least(o.expires_at,clock_timestamp()+interval '1 hour'),(b->>'owner_user_id')::uuid)returning * into i;
 select state into customer_state from public.customers where tenant_id=target_tenant_id and id=o.customer_id for update;
 if customer_state='INTERESTED'then
  intent_event:=private.append_domain_event(target_tenant_id,o.customer_id,'payment.intent_created',1,jsonb_build_object('payment_id',i.id,'amount',o.amount::text,'asset','XTR','network','TELEGRAM','source_event_id',purchase_source_event_id_value),'SYSTEM',null,'stars_commerce','TRUSTED',extensions.gen_random_uuid(),purchase_source_event_id_value,'stars-intent:'||i.id::text,clock_timestamp());
  tr:=public.transition_customer_state(target_tenant_id,o.customer_id,'INTERESTED','PAYMENT_PENDING','customer_requested_stars_checkout','SYSTEM',null,extensions.gen_random_uuid(),intent_event,'payment.intent_created',intent_event,'stars-intent:'||i.id::text,clock_timestamp());
  if tr->>'accepted'is distinct from 'true'then raise exception 'STARS_PURCHASE_LIFECYCLE_DENIED'using errcode='42501';end if;
 end if;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','payment.stars_intent_prepared','payment_invoices',i.id::text,jsonb_build_object('offer_id',o.id,'currency','XTR','receipt_created',false));
 return private.stars_intent(i);end;$$;

-- The existing observation ledger holds append-only reservations/results. A restart
-- never erases an attempt or authorizes another mutation after unknown completion.
create function public.stars_commerce_reserve_v1(target_tenant_id uuid,target_invoice_id uuid,operation_value text,request_key_value text,request_hash_value text,nonce_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b jsonb;i public.payment_invoices;old public.payment_observations;oid uuid:=extensions.gen_random_uuid();key_value text;begin
 b:=private.stars_commerce_guard(target_tenant_id);select * into i from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and mode='live'and recipient=b->>'bot_user_id'for update;
 if i.id is null or operation_value not in('getMe','createInvoiceLink','answerPreCheckoutQuery','getStarTransactions','refundStarPayment','sendMessage')or nonce_value is null or request_key_value!~'^[A-Za-z0-9:_-]{1,100}$'or request_hash_value!~'^[a-f0-9]{64}$'
 then raise exception 'STARS_DISPATCH_DENIED'using errcode='42501';end if;
 key_value:='stars:attempt:'||private.fse_hash(i.id::text||':'||operation_value||':'||request_key_value);
 select * into old from public.payment_observations where provider_id='telegram_stars_live'and event_id=key_value;
 if old.id is not null then return jsonb_build_object('dispatch',false,'attempt_id',old.id);end if;
 if operation_value in('createInvoiceLink','answerPreCheckoutQuery')and(i.status not in('CREATED','PENDING')or i.expires_at<=clock_timestamp())then raise exception 'STARS_INTENT_CLOSED'using errcode='42501';end if;
 if operation_value='answerPreCheckoutQuery'and exists(select 1 from public.payment_observations where tenant_id=target_tenant_id and invoice_id=i.id and proposed_state='DISPATCH_STARTED'and provider_evidence->>'operation'=operation_value)then raise exception 'STARS_PRECHECKOUT_ALREADY_ACCOUNTED'using errcode='42501';end if;
 if operation_value in('refundStarPayment','sendMessage')and i.status<>'CONFIRMED'then raise exception 'STARS_ORIGINAL_RECEIPT_REQUIRED'using errcode='42501';end if;
 if operation_value in('createInvoiceLink','answerPreCheckoutQuery','refundStarPayment')and exists(select 1 from public.payment_observations x where x.tenant_id=target_tenant_id and x.invoice_id=i.id and x.proposed_state='DISPATCH_STARTED'and x.provider_evidence->>'operation'=operation_value and not exists(select 1 from public.payment_observations y where y.tenant_id=x.tenant_id and y.provider_evidence->>'attempt_id'=x.id::text and y.proposed_state='PROVIDER_RESULT'and y.resulting_state='ACKNOWLEDGED'))then raise exception 'STARS_UNKNOWN_EFFECT_RECONCILE_REQUIRED'using errcode='42501';end if;
 insert into public.payment_observations(id,tenant_id,invoice_id,provider_id,event_id,raw_body_hash,method,proposed_state,resulting_state,reason,mode,provider_evidence)
 values(oid,target_tenant_id,i.id,'telegram_stars_live',key_value,request_hash_value,'reconcile','DISPATCH_STARTED','PENDING','ONE_ACCOUNTABLE_ATTEMPT','live',jsonb_build_object('operation',operation_value,'nonce',nonce_value,'request_hash',request_hash_value,'repository_sha',b->>'repository_sha','bot_user_id',b->>'bot_user_id'));
 return jsonb_build_object('dispatch',true,'attempt_id',oid);end;$$;
create function public.stars_commerce_result_v1(target_tenant_id uuid,target_invoice_id uuid,attempt_id_value uuid,nonce_value uuid,state_value text,response_hash_value text,evidence_value text)returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare a public.payment_observations;v jsonb;old public.payment_observations;begin
 perform private.stars_commerce_guard(target_tenant_id);perform 1 from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id for update;
 select * into a from public.payment_observations where tenant_id=target_tenant_id and invoice_id=target_invoice_id and id=attempt_id_value and proposed_state='DISPATCH_STARTED'and provider_evidence->>'nonce'=nonce_value::text;
 if a.id is null or state_value not in('ACKNOWLEDGED','REJECTED','UNKNOWN')or response_hash_value is not null and response_hash_value!~'^[a-f0-9]{64}$'then raise exception 'STARS_RESULT_DENIED'using errcode='42501';end if;
 v:=private.fse_strict_json(evidence_value);if jsonb_typeof(v)<>'object'or octet_length(evidence_value)>60000 then raise exception 'STARS_RESULT_INVALID'using errcode='22023';end if;
 select * into old from public.payment_observations where provider_id='telegram_stars_live'and event_id='stars:result:'||a.id::text;
 if old.id is not null then if old.resulting_state<>state_value or old.raw_body_hash<>coalesce(response_hash_value,repeat('0',64))or old.provider_evidence->'result'is distinct from v then raise exception 'STARS_RESULT_CONFLICT'using errcode='23505';end if;return true;end if;
 insert into public.payment_observations(tenant_id,invoice_id,provider_id,event_id,raw_body_hash,method,proposed_state,resulting_state,reason,mode,provider_evidence)
 values(target_tenant_id,target_invoice_id,'telegram_stars_live','stars:result:'||a.id::text,coalesce(response_hash_value,repeat('0',64)),'reconcile','PROVIDER_RESULT',state_value,'ACK_IS_NOT_A_RECEIPT','live',jsonb_build_object('attempt_id',a.id,'operation',a.provider_evidence->>'operation','result',v));
 if state_value='UNKNOWN'and a.provider_evidence->>'operation'in('createInvoiceLink','answerPreCheckoutQuery','refundStarPayment')then update public.payment_invoices set status='REVIEW'where tenant_id=target_tenant_id and id=target_invoice_id;end if;
 return true;end;$$;

create function public.stars_commerce_callback_v1(target_tenant_id uuid,target_invoice_id uuid,event_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b jsonb;i public.payment_invoices;v jsonb;old public.payment_observations;key_value text;begin
 b:=private.stars_commerce_guard(target_tenant_id);select * into i from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and mode='live'and recipient=b->>'bot_user_id'for update;v:=private.fse_strict_json(event_value);
 if i.id is null or not private.fse_keys(v,array['kind','update_id','charge_id','query_id','source_time','raw_hash'])or v->>'kind'not in('PAYMENT','REFUND','PRE_CHECKOUT')or v->>'update_id'!~'^[0-9]{1,16}$'or v->>'raw_hash'!~'^[a-f0-9]{64}$'
 or v->>'kind'<>'PRE_CHECKOUT'and(v->>'charge_id'is null or v->>'charge_id'like 'test:%'or char_length(v->>'charge_id')not between 1 and 200 or(v->>'source_time')::timestamptz>clock_timestamp()+interval '1 minute'or(v->>'source_time')::timestamptz<clock_timestamp()-interval '5 minutes')
 then raise exception 'STARS_CALLBACK_INVALID'using errcode='22023';end if;
 key_value:='stars:update:'||(b->>'bot_user_id')||':'||(v->>'update_id');
 select * into old from public.payment_observations where provider_id='telegram_stars_live'and event_id=key_value;
 if old.id is not null then if old.invoice_id<>i.id or old.raw_body_hash<>v->>'raw_hash'or old.provider_evidence is distinct from v then raise exception 'STARS_CALLBACK_CONFLICT'using errcode='23505';end if;return jsonb_build_object('recorded',true,'duplicate',true);end if;
 insert into public.payment_observations(tenant_id,invoice_id,provider_id,event_id,raw_body_hash,method,proposed_state,resulting_state,reason,mode,provider_evidence)
 values(target_tenant_id,i.id,'telegram_stars_live',key_value,v->>'raw_hash','webhook','AUTHENTICATED_CALLBACK','PENDING','INDEPENDENT_LEDGER_REQUIRED','live',v);
 return jsonb_build_object('recorded',true,'duplicate',false);end;$$;

create function public.stars_commerce_admit_v1(target_tenant_id uuid,target_invoice_id uuid,update_id_value text,ledger_attempt_id_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b jsonb;i public.payment_invoices;callback public.payment_observations;read_value public.payment_observations;ledger jsonb;fact jsonb;kind_value text;charge text;r private.verified_payment_receipts;rid uuid;eid uuid;sid uuid;obid uuid;ref text;begin
 b:=private.stars_commerce_guard(target_tenant_id);select * into i from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and mode='live'and recipient=b->>'bot_user_id'for update;
 select * into callback from public.payment_observations where tenant_id=target_tenant_id and invoice_id=i.id and event_id='stars:update:'||(b->>'bot_user_id')||':'||update_id_value and proposed_state='AUTHENTICATED_CALLBACK';
 select outcome.* into read_value from public.payment_observations attempt join public.payment_observations outcome on outcome.tenant_id=attempt.tenant_id and outcome.invoice_id=attempt.invoice_id and outcome.provider_evidence->>'attempt_id'=attempt.id::text
 where attempt.tenant_id=target_tenant_id and attempt.invoice_id=i.id and attempt.id=ledger_attempt_id_value and attempt.provider_evidence->>'operation'='getStarTransactions'and attempt.proposed_state='DISPATCH_STARTED'and outcome.proposed_state='PROVIDER_RESULT'and outcome.resulting_state='ACKNOWLEDGED';
 ledger:=read_value.provider_evidence->'result';kind_value:=callback.provider_evidence->>'kind';charge:=callback.provider_evidence->>'charge_id';
 if i.id is null or callback.id is null or kind_value='PRE_CHECKOUT'or read_value.id is null or ledger->>'page_complete'is distinct from 'true'or read_value.raw_body_hash=callback.raw_body_hash
 or ledger->>'raw_hash'is distinct from read_value.raw_body_hash or(ledger->>'read_at')::timestamptz<clock_timestamp()-interval '5 minutes'or(ledger->>'read_at')::timestamptz>clock_timestamp()+interval '1 minute'
 then return jsonb_build_object('state','PENDING','reason','CORROBORATION_REQUIRED');end if;
 if(select count(*)from jsonb_array_elements(ledger->'entries')v where v->>'charge_id'=charge and v->>'kind'=kind_value)<>1 then return jsonb_build_object('state','PENDING','reason','UNIQUE_CHARGE_NOT_OBSERVED');end if;
 select v into fact from jsonb_array_elements(ledger->'entries')v where v->>'charge_id'=charge and v->>'kind'=kind_value;
 if fact->>'payer_user_id'is distinct from i.payer_reference or fact->>'amount_units'is distinct from i.amount_units::text or fact->>'invoice_payload'is distinct from i.provider_reference
 or(fact->>'source_time')::timestamptz is distinct from(callback.provider_evidence->>'source_time')::timestamptz
 or kind_value='PAYMENT'and exists(select 1 from jsonb_array_elements(ledger->'entries')v where v->>'charge_id'=charge and v->>'kind'='REFUND')
 then update public.payment_invoices set status='REVIEW'where id=i.id;return jsonb_build_object('state','REVIEW','reason','PAYMENT_FACT_MISMATCH');end if;
 ref:=(b->>'bot_user_id')||':'||charge;
 select * into r from private.verified_payment_receipts where provider_id='telegram_stars_live'and provider_reference=ref;
 if kind_value='PAYMENT'then
  if r.id is not null then if r.tenant_id<>target_tenant_id or r.invoice_id<>i.id then raise exception 'STARS_CHARGE_ALREADY_CLAIMED'using errcode='23505';end if;
   select subscription_id into sid from public.subscription_payments where receipt_id=r.id;
   insert into public.payment_observations(tenant_id,invoice_id,provider_id,event_id,raw_body_hash,method,proposed_state,resulting_state,reason,mode,provider_evidence)
   values(target_tenant_id,i.id,'telegram_stars_live','stars:admitted:'||callback.id::text,callback.raw_body_hash,'reconcile',kind_value,i.status,'EXISTING_RECEIPT_REPLAY','live',jsonb_build_object('callback_id',callback.id,'ledger_attempt_id',ledger_attempt_id_value,'receipt_id',r.id))on conflict(provider_id,event_id)do nothing;
   return jsonb_build_object('state',i.status,'replay',true,'receipt_id',r.id,'subscription_id',sid);end if;
  if i.status not in('CREATED','PENDING','REVIEW')or(callback.provider_evidence->>'source_time')::timestamptz>=i.expires_at then return jsonb_build_object('state','REVIEW','reason','INTENT_CLOSED_OR_LATE');end if;
  rid:=extensions.gen_random_uuid();eid:=private.append_domain_event(target_tenant_id,i.customer_id,'payment.confirmed',1,jsonb_build_object('payment_id',rid,'tx_hash',ref,'amount_units',i.amount_units::text,'currency','XTR','network','TELEGRAM'),'SYSTEM',null,'payment_verifier','TRUSTED',extensions.gen_random_uuid(),null,'stars-receipt:'||ref,clock_timestamp());
  insert into private.verified_payment_receipts(id,tenant_id,customer_id,offer_id,event_id,provider_id,provider_reference,signature_verified,independent_verified,evidence_hash,verified_at,invoice_id,amount_units,asset,network,payer_reference,recipient)
  values(rid,target_tenant_id,i.customer_id,i.offer_id,eid,'telegram_stars_live',ref,true,true,private.fse_hash(callback.raw_body_hash||':'||read_value.raw_body_hash),clock_timestamp(),i.id,i.amount_units,'XTR','TELEGRAM',i.payer_reference,i.recipient);
  insert into public.payment_transactions(tenant_id,invoice_id,provider_id,network,transaction_reference,mode)values(target_tenant_id,i.id,'telegram_stars_live','TELEGRAM',ref,'live');
  update public.payment_invoices set status='CONFIRMED',confirmed_at=clock_timestamp(),last_evidence_at=clock_timestamp(),reconciliation_count=reconciliation_count+1 where id=i.id;
  -- An authenticated matching Stars payer corroborates the imported numeric ID;
  -- refresh only a uniquely matching native contact, never a username/ambiguous link.
  update public.messaging_contacts mc set identity_resolution='exact_match',review_required=false
  from public.commercial_offers o join public.domain_events e on e.tenant_id=o.tenant_id and e.id=o.source_event_id join public.messages msg on msg.tenant_id=e.tenant_id and msg.id::text=e.payload->>'message_id'
  where o.tenant_id=target_tenant_id and o.id=i.offer_id and e.event_type='message.received'and e.producer='messaging.telegram.webhook'and e.customer_id=i.customer_id and msg.direction='inbound'
  and mc.tenant_id=target_tenant_id and mc.id=msg.messaging_contact_id and mc.customer_id=i.customer_id and mc.provider_user_id=i.payer_reference and mc.provider_chat_id=i.payer_reference and mc.identity_resolution='unmatched'
  and(select count(distinct customer_id)from public.customer_identities where tenant_id=target_tenant_id and identity_type='telegram_user_id'and normalized_value=i.payer_reference)=1
  and exists(select 1 from public.customer_identities where tenant_id=target_tenant_id and customer_id=i.customer_id and identity_type='telegram_user_id'and normalized_value=i.payer_reference);
  perform public.bind_verified_telegram_identity(target_tenant_id,i.customer_id,(select source_event_id from public.commercial_offers where tenant_id=target_tenant_id and id=i.offer_id));
  sid:=private.entitlement_apply(target_tenant_id,rid,'live');
 else
  if r.id is null or r.tenant_id<>target_tenant_id or r.invoice_id<>i.id then return jsonb_build_object('state','REVIEW','reason','ORIGINAL_RECEIPT_REQUIRED');end if;
  select subscription_id into sid from public.subscription_payments where receipt_id=r.id;
  if i.status='REFUNDED'then
   insert into public.payment_observations(tenant_id,invoice_id,provider_id,event_id,raw_body_hash,method,proposed_state,resulting_state,reason,mode,provider_evidence)
   values(target_tenant_id,i.id,'telegram_stars_live','stars:admitted:'||callback.id::text,callback.raw_body_hash,'reconcile',kind_value,'REFUNDED','EXISTING_REFUND_REPLAY','live',jsonb_build_object('callback_id',callback.id,'ledger_attempt_id',ledger_attempt_id_value,'receipt_id',r.id))on conflict(provider_id,event_id)do nothing;
   return jsonb_build_object('state','REFUNDED','replay',true,'receipt_id',r.id,'subscription_id',sid);end if;
  update public.payment_invoices set status='REFUNDED',last_evidence_at=clock_timestamp(),reconciliation_count=reconciliation_count+1 where id=i.id;
  -- Preserve the original receipt. Refund is new evidence; prevent access restoration.
  update public.subscriptions set state='CANCELLED',revision=revision+1 where tenant_id=target_tenant_id and id=sid and state<>'CANCELLED';
  perform private.entitlement_enqueue(sid,'revoke');perform private.entitlement_audit_record(sid,'stars_refund_confirmed',jsonb_build_object('receipt_id',r.id,'charge_hash',private.fse_hash(charge)));
 end if;
 insert into public.payment_observations(tenant_id,invoice_id,provider_id,event_id,raw_body_hash,method,proposed_state,resulting_state,reason,mode,provider_evidence)
 values(target_tenant_id,i.id,'telegram_stars_live','stars:admitted:'||callback.id::text,callback.raw_body_hash,'reconcile',kind_value,case when kind_value='PAYMENT'then 'CONFIRMED'else 'REFUNDED'end,'WEBHOOK_PLUS_INDEPENDENT_LEDGER','live',jsonb_build_object('callback_id',callback.id,'ledger_attempt_id',ledger_attempt_id_value,'receipt_id',coalesce(rid,r.id),'authentication_method','TELEGRAM_SECRET_TOKEN','amount_basis','GROSS_XTR_NOT_PAYOUT'));
 return jsonb_build_object('state',case when kind_value='PAYMENT'then 'CONFIRMED'else 'REFUNDED'end,'replay',false,'receipt_id',coalesce(rid,r.id),'subscription_id',sid);end;$$;

-- Recovery reads bounded persisted callbacks, never fabricates a provider result.
create function public.stars_commerce_pending_v1(target_tenant_id uuid,target_invoice_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare result jsonb;begin
 perform private.stars_commerce_guard(target_tenant_id);select coalesce(jsonb_agg(row_value),'[]')into result from(select o.provider_evidence from public.payment_observations o where o.tenant_id=target_tenant_id and o.invoice_id=target_invoice_id and o.mode='live'and o.proposed_state='AUTHENTICATED_CALLBACK'and o.provider_evidence->>'kind'in('PAYMENT','REFUND')and not exists(select 1 from public.payment_observations settled where settled.tenant_id=o.tenant_id and settled.event_id='stars:admitted:'||o.id::text)order by o.created_at,o.id limit 25)row_value;return result;end;$$;

do $$declare r record;begin
 for r in select oid::regprocedure signature from pg_proc where pronamespace='private'::regnamespace and proname in('stars_commerce_guard','stars_intent')loop execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);end loop;
 for r in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'stars_commerce_%'loop execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;
end;$$;

-- Internal transport custody/evidence is never projected to support/browser reads.
revoke select on public.payment_observations from authenticated;
grant select(id,tenant_id,invoice_id,snapshot_id,provider_id,event_id,raw_body_hash,method,proposed_state,resulting_state,reason,mode,created_at)on public.payment_observations to authenticated;
create or replace function public.admin_payment_list(target_tenant_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare tech boolean;result jsonb;begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[])then raise exception 'payment read denied'using errcode='42501';end if;
 tech:=private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]);
 select coalesce(jsonb_agg(x.value),'[]')into result from(select to_jsonb(i)||jsonb_build_object('amount_units',i.amount_units::text,'expires_at',to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))||case when i.mode='live'and not tech then jsonb_build_object('recipient','restricted','payer_reference','restricted','quote_snapshot',jsonb_build_object('origin','TELEGRAM_PRODUCTION','amount_basis','GROSS_XTR_NOT_USD_OR_PAYOUT'))else '{}'end value from public.payment_invoices i where tenant_id=target_tenant_id order by created_at desc,id limit 100)x;return result;end;$$;
-- Existing TEST detail semantics remain; LIVE detail deliberately returns redacted summaries.
alter function public.admin_payment_detail(uuid,uuid)rename to payment_detail_before_stars;
alter function public.payment_detail_before_stars(uuid,uuid)set schema private;
create function public.admin_payment_detail(target_tenant_id uuid,target_invoice_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare i public.payment_invoices;invoice_value jsonb;result jsonb;begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[])then raise exception 'payment read denied'using errcode='42501';end if;
 select * into i from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id;
 if i.id is null then return null;end if;if i.mode='test'then return private.payment_detail_before_stars(target_tenant_id,target_invoice_id);end if;
 select value into invoice_value from jsonb_array_elements(public.admin_payment_list(target_tenant_id))where value->>'id'=i.id::text;
 if invoice_value is null then invoice_value:=to_jsonb(i)||jsonb_build_object('amount_units',i.amount_units::text,'expires_at',to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'recipient','restricted','payer_reference','restricted','quote_snapshot',jsonb_build_object('origin','TELEGRAM_PRODUCTION'));end if;
 select jsonb_build_object('invoice',invoice_value,'observations',coalesce((select jsonb_agg(x)from(select id,event_id,method,proposed_state,resulting_state,reason,case when private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[])then raw_body_hash else repeat('0',64)end raw_body_hash,created_at,null::jsonb evidence from public.payment_observations where tenant_id=target_tenant_id and invoice_id=i.id order by created_at desc,id limit 100)x),'[]'),'transactions',coalesce((select jsonb_agg(x)from(select provider_id,case when private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[])then transaction_reference else 'restricted'end transaction_reference,network,created_at from public.payment_transactions where tenant_id=target_tenant_id and invoice_id=i.id order by created_at desc,id limit 100)x),'[]'))into result;return result;end;$$;
revoke all on function private.payment_detail_before_stars(uuid,uuid)from public,anon,authenticated,service_role;
revoke all on function public.admin_payment_detail(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.admin_payment_detail(uuid,uuid)to authenticated;
create function public.stars_commerce_original_charge_v1(target_tenant_id uuid,target_invoice_id uuid)returns text language plpgsql stable security definer set search_path=pg_catalog as $$declare result text;b jsonb;begin
 b:=private.stars_commerce_guard(target_tenant_id);select substring(r.provider_reference from char_length(b->>'bot_user_id')+2)into result from private.verified_payment_receipts r join public.payment_invoices i on i.tenant_id=r.tenant_id and i.id=r.invoice_id where r.tenant_id=target_tenant_id and r.invoice_id=target_invoice_id and r.provider_id='telegram_stars_live'and r.recipient=b->>'bot_user_id'and i.status='CONFIRMED';if result is null then raise exception 'STARS_ORIGINAL_RECEIPT_REQUIRED'using errcode='42501';end if;return result;end;$$;
revoke all on function public.stars_commerce_original_charge_v1(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.stars_commerce_original_charge_v1(uuid,uuid)to service_role;

-- Reuse Phase11 jobs/leases/audit, with a genuine one-start fence. TEST delegates
-- unchanged; unknown LIVE mutations are never put back into the retry queue.
alter function public.entitlement_claim_job(uuid)rename to entitlement_claim_before_genuine;
alter function public.entitlement_claim_before_genuine(uuid)set schema private;
create function public.entitlement_claim_job(target_tenant_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.entitlement_jobs;s public.subscriptions;a public.channel_access;begin
 if not private.entitlement_live_allowed(target_tenant_id)then return private.entitlement_claim_before_genuine(target_tenant_id);end if;
 select q.* into j from public.entitlement_jobs q where q.tenant_id=target_tenant_id and q.available_at<=clock_timestamp()and(q.status='PENDING'or q.status='RUNNING'and q.lease_until<clock_timestamp())order by q.available_at,q.id for update skip locked limit 1;
 if j.id is null then return null;end if;
 select * into a from public.channel_access where tenant_id=target_tenant_id and id=j.access_id;select * into s from public.subscriptions where tenant_id=target_tenant_id and id=a.subscription_id;
 if s.mode='live'then
  perform private.stars_commerce_guard(target_tenant_id);
  if j.status='RUNNING'or exists(select 1 from public.entitlement_audit where tenant_id=target_tenant_id and subscription_id=s.id and action='genuine_effect_started'and details->>'job_id'=j.id::text)then
   update public.entitlement_jobs set status='FAILED',last_error='GENUINE_EFFECT_UNKNOWN_RECONCILE_REQUIRED',lease_token=null,lease_until=null where id=j.id;update public.channel_access set status='REVIEW'where id=a.id;
   perform private.entitlement_audit_record(s.id,'genuine_unknown_obligation',jsonb_build_object('job_id',j.id,'automatic_retry',false));return null;
  end if;
  if a.status='REVOKED'and j.operation in('invite','join','reconcile')then update public.entitlement_jobs set status='STALE',last_error='REVOKED_ACCESS_NOT_AUTO_RESTORED'where id=j.id;return null;end if;
 end if;
 return private.entitlement_claim_before_genuine(target_tenant_id);end;$$;
create function public.entitlement_begin_genuine_v1(target_tenant_id uuid,target_job_id uuid,lease_value uuid,nonce_value uuid)returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j public.entitlement_jobs;s public.subscriptions;a public.channel_access;b jsonb;begin
 b:=private.stars_commerce_guard(target_tenant_id);select * into j from public.entitlement_jobs where tenant_id=target_tenant_id and id=target_job_id for update;
 select * into a from public.channel_access where tenant_id=target_tenant_id and id=j.access_id;select * into s from public.subscriptions where tenant_id=target_tenant_id and id=a.subscription_id for update;
 if j.id is null or j.status<>'RUNNING'or j.lease_token is distinct from lease_value or j.lease_until<=clock_timestamp()or nonce_value is null or s.mode<>'live'or a.mode<>'live'or j.revision<>s.revision
 or j.operation in('invite','join')and(s.state not in('ACTIVE','RENEWAL_DUE')or s.grace_until<=clock_timestamp()or a.status='REVOKED')
 or not exists(select 1 from public.vip_channels where tenant_id=target_tenant_id and id=a.channel_id and mode='live'and chat_id=b->>'channel_id'and enabled and private_verified)
 or exists(select 1 from public.entitlement_audit where tenant_id=target_tenant_id and action='genuine_effect_started'and details->>'job_id'=j.id::text)then return false;end if;
 perform private.entitlement_audit_record(s.id,'genuine_effect_started',jsonb_build_object('job_id',j.id,'lease',j.lease_token,'nonce',nonce_value,'revision',s.revision,'operation',j.operation));return true;end;$$;
alter function public.entitlement_complete_job(uuid,uuid,uuid,jsonb)rename to entitlement_complete_before_genuine;
alter function public.entitlement_complete_before_genuine(uuid,uuid,uuid,jsonb)set schema private;
create function public.entitlement_complete_job(target_tenant_id uuid,target_job_id uuid,lease_value uuid,result_value jsonb)returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j public.entitlement_jobs;s public.subscriptions;a public.channel_access;begin
 select * into j from public.entitlement_jobs where tenant_id=target_tenant_id and id=target_job_id for update;
 select * into a from public.channel_access where tenant_id=target_tenant_id and id=j.access_id;select * into s from public.subscriptions where tenant_id=target_tenant_id and id=a.subscription_id for update;
 if s.mode is distinct from 'live'or not private.entitlement_live_allowed(target_tenant_id)then return private.entitlement_complete_before_genuine(target_tenant_id,target_job_id,lease_value,result_value);end if;
 if s.mode='live'then
  perform private.stars_commerce_guard(target_tenant_id);
  if j.status<>'RUNNING'or j.lease_token is distinct from lease_value or j.lease_until<=clock_timestamp()or not exists(select 1 from public.entitlement_audit where tenant_id=target_tenant_id and subscription_id=s.id and action='genuine_effect_started'and details->>'job_id'=j.id::text and details->>'lease'=lease_value::text and details->>'nonce'=result_value->>'dispatch_nonce')then raise exception 'GENUINE_ACCESS_OWNED_START_REQUIRED'using errcode='42501';end if;
  if j.revision<>s.revision or j.operation in('invite','join')and(s.state not in('ACTIVE','RENEWAL_DUE')or s.grace_until<=clock_timestamp())then
   update public.entitlement_jobs set status='STALE',last_error='GENUINE_ACK_AFTER_REVISION_FENCE',lease_token=null,lease_until=null where id=j.id;update public.channel_access set status='REVIEW'where id=a.id;
   perform private.entitlement_enqueue(s.id,case when s.state in('ACTIVE','RENEWAL_DUE')and s.grace_until>clock_timestamp()then 'reconcile'else 'revoke'end);
   perform private.entitlement_audit_record(s.id,'genuine_late_outcome_obligation',jsonb_build_object('job_id',j.id,'result',result_value-'dispatch_nonce'));return false;
  end if;
  if result_value->>'ok'is distinct from 'true'then
   update public.entitlement_jobs set status='FAILED',last_error='GENUINE_EFFECT_UNKNOWN_RECONCILE_REQUIRED',lease_token=null,lease_until=null where id=j.id;update public.channel_access set status='REVIEW'where id=a.id;
   perform private.entitlement_audit_record(s.id,'genuine_unknown_obligation',jsonb_build_object('job_id',j.id,'automatic_retry',false));return false;
  end if;
  perform private.entitlement_audit_record(s.id,'genuine_provider_result',jsonb_build_object('job_id',j.id,'result',result_value-'dispatch_nonce','customer_read','UNKNOWN'));
 end if;
 return private.entitlement_complete_before_genuine(target_tenant_id,target_job_id,lease_value,case when s.mode='live'then result_value-'dispatch_nonce'else result_value end);end;$$;
revoke all on function private.entitlement_claim_before_genuine(uuid),private.entitlement_complete_before_genuine(uuid,uuid,uuid,jsonb)from public,anon,authenticated,service_role;
revoke all on function public.entitlement_begin_genuine_v1(uuid,uuid,uuid,uuid),public.entitlement_claim_job(uuid),public.entitlement_complete_job(uuid,uuid,uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.entitlement_begin_genuine_v1(uuid,uuid,uuid,uuid),public.entitlement_claim_job(uuid),public.entitlement_complete_job(uuid,uuid,uuid,jsonb)to service_role;

-- Extend the same catalogue validator; preserve payload/price/currency verbatim.
create or replace function private.valid_commercial_payload(kind_value text,p jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare keys text[]; k text; x jsonb;
begin
 if jsonb_typeof(p)<>'object' or char_length(p::text)>12000 or p::text~*'(ignore.{0,30}(instructions|rules|policy)|system prompt|developer message|reveal.{0,30}(secret|token|prompt)|sk-[A-Za-z0-9_-]{12,}|service_role|BEGIN PRIVATE KEY|guarantee(d|s)?.{0,15}(profit|return)|risk.free|garanti.{0,15}(kazanç|kâr)|(payment|access).{0,15}(confirmed|activated))' then return false; end if;
 keys:=case kind_value when 'product' then array['title','locale','source','description','service_rights']
 when 'plan' then array['title','locale','source','product_id','amount','currency','duration_unit','duration_count','billing','inclusions','restrictions','terms','eligibility','max_discount_bps','trial','offer_valid_hours','tax_rule','renewal_rule','cancellation_rule','disclosures']
 when 'knowledge' then array['title','locale','source','content','category','plan_id','declared_amount','declared_currency'] else '{}'::text[] end;
 if cardinality(keys)=0 or (select count(*) from jsonb_object_keys(p))<>cardinality(keys) or not p ?& keys then return false; end if;
 foreach k in array keys loop
 if p->k='null'::jsonb and k not in ('tax_rule','renewal_rule','cancellation_rule','plan_id','declared_amount','declared_currency') then return false; end if;
 end loop;
 foreach k in array array['title','locale','source'] loop
 if jsonb_typeof(p->k)<>'string' or char_length(btrim(p->>k))=0 or char_length(p->>k)>1200 then return false; end if; end loop;
 if p->>'locale' not in ('en','tr','ar','ru') or char_length(p->>'title')>120 then return false; end if;
 if kind_value='product' then return jsonb_typeof(p->'description')='string' and char_length(p->>'description') between 1 and 1200 and jsonb_typeof(p->'service_rights')='string' and char_length(p->>'service_rights') between 1 and 1200; end if;
 if kind_value='knowledge' then
 return jsonb_typeof(p->'content')='string' and char_length(p->>'content') between 1 and 1200 and p->>'category' in ('Product','Pricing','Support','Signal Service','Payment Information','Telegram','Trial','Renewal','Policies','FAQ')
 and (p->'plan_id'='null'::jsonb or (p->>'plan_id')~'^[0-9a-f-]{36}$')
 and (p->'declared_amount'='null'::jsonb or (p->>'declared_amount')~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$')
 and (p->'declared_currency'='null'::jsonb or p->>'declared_currency'~'^[A-Z]{3}$')
 and (p->>'category'<>'Pricing' or (p->>'plan_id' is not null and p->>'declared_amount' is not null and p->>'declared_currency' is not null))
 and not ((p->>'content' ~* '(price|pricing|cost|fee|fiyat|ücret|سعر|стоим)' and p->>'content' ~ '[0-9]') or p->>'content' ~ '[0-9]+([.,][0-9]+)?[[:space:]]*(XTR|USD|EUR|GBP|TRY|AED|SAR|RUB|JPY|CAD|AUD|CHF|TL)|[$€£][[:space:]]*[0-9]');
 end if;
 if p->>'currency'='XTR'and(p->>'amount'!~'^[1-9][0-9]*(\.0{1,6})?$'or p->>'billing'<>'one_off')then return false;end if;
 if p->>'amount' !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$' or jsonb_typeof(p->'amount')<>'string' or p->>'currency' not in ('XTR','USD','EUR','GBP','TRY','AED','SAR','RUB','JPY','CAD','AUD','CHF','CNY','INR','BRL','SGD','HKD','NZD','ZAR','KRW','KWD','BHD','OMR','QAR','SEK','NOK','DKK','PLN','CZK','HUF','MXN','IDR','MYR','THB','PHP','EGP','ILS','RON','BGN','VND') or p->>'product_id' !~ '^[0-9a-f-]{36}$' or p->>'duration_unit' not in ('fixed_days','calendar_month','calendar_year') or p->>'billing' not in ('one_off','recurring','unknown') then return false; end if;
 if jsonb_typeof(p->'duration_count')<>'number' or (p->>'duration_count')!~'^[0-9]+$' or (p->>'duration_count')::int not between 1 and 366 or jsonb_typeof(p->'max_discount_bps')<>'number' or (p->>'max_discount_bps')!~'^[0-9]+$' or (p->>'max_discount_bps')::int not between 0 and 10000 or (p->>'offer_valid_hours')!~'^[0-9]+$' or (p->>'offer_valid_hours')::int not between 1 and 168 or jsonb_typeof(p->'trial')<>'boolean' or jsonb_typeof(p->'terms')<>'string' or char_length(p->>'terms') not between 1 and 1200 then return false; end if;
 foreach k in array array['inclusions','restrictions','disclosures'] loop
 if jsonb_typeof(p->k)<>'array' or jsonb_array_length(p->k)>12 then return false; end if;
 for x in select value from jsonb_array_elements(p->k) loop if jsonb_typeof(x)<>'string' or char_length(x#>>'{}') not between 1 and 300 then return false; end if; end loop; end loop;
 foreach k in array array['tax_rule','renewal_rule','cancellation_rule'] loop if p->k<>'null'::jsonb and (jsonb_typeof(p->k)<>'string' or char_length(p->>k)>300) then return false; end if; end loop;
 if jsonb_typeof(p->'eligibility')<>'object' or not (p->'eligibility') ?& array['instrument','actively_trades','experience_level'] or (select count(*) from jsonb_object_keys(p->'eligibility'))<>3 then return false; end if;
 foreach k in array array['instrument','experience_level'] loop if p->'eligibility'->k<>'null'::jsonb and (jsonb_typeof(p->'eligibility'->k)<>'string' or char_length(p->'eligibility'->>k)>40) then return false; end if; end loop;
 return p->'eligibility'->'actively_trades'='null'::jsonb or jsonb_typeof(p->'eligibility'->'actively_trades')='boolean';
exception when others then return false;
end; $$;

create unique index one_genuine_stars_order_per_offer on public.payment_invoices(tenant_id,offer_id)where mode='live'and provider_id='telegram_stars_live';
create function public.stars_commerce_join_v1(target_tenant_id uuid,user_id_value text,channel_id_value text,invite_value text,source_hash_value text,occurred_at_value timestamptz)returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare b jsonb;aid uuid;begin
 b:=private.stars_commerce_guard(target_tenant_id);
 if channel_id_value is distinct from b->>'channel_id'or user_id_value!~'^[1-9][0-9]{0,15}$'or source_hash_value!~'^[a-f0-9]{64}$'or occurred_at_value<clock_timestamp()-interval '5 minutes'or occurred_at_value>clock_timestamp()+interval '1 minute'then return false;end if;
 select a.id into aid from public.channel_access a join public.telegram_entitlement_bindings binding on binding.tenant_id=a.tenant_id and binding.id=a.binding_id join public.vip_channels c on c.tenant_id=a.tenant_id and c.id=a.channel_id
 where a.tenant_id=target_tenant_id and a.mode='live'and binding.mode='live'and binding.telegram_user_id=user_id_value and c.chat_id=channel_id_value and a.invite_reference=invite_value and a.status='INVITED'and a.invite_expires_at>clock_timestamp();
 if aid is null then return false;end if;
 return public.entitlement_join_request(target_tenant_id,aid,user_id_value,invite_value);end;$$;
revoke all on function public.stars_commerce_join_v1(uuid,text,text,text,text,timestamptz)from public,anon,authenticated,service_role;
grant execute on function public.stars_commerce_join_v1(uuid,text,text,text,text,timestamptz)to service_role;
create function public.stars_commerce_callback_by_hash_v1(target_tenant_id uuid,target_invoice_id uuid,raw_hash_value text)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare result jsonb;begin
 perform private.stars_commerce_guard(target_tenant_id);
 select o.provider_evidence into result from public.payment_observations o where o.tenant_id=target_tenant_id and o.invoice_id=target_invoice_id and o.mode='live'and o.proposed_state='AUTHENTICATED_CALLBACK'and o.raw_body_hash=raw_hash_value order by o.created_at desc limit 1;return result;end;$$;
revoke all on function public.stars_commerce_callback_by_hash_v1(uuid,uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.stars_commerce_callback_by_hash_v1(uuid,uuid,text)to service_role;
create function public.stars_commerce_recovery_targets_v1(target_tenant_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare result jsonb;begin
 perform private.stars_commerce_guard(target_tenant_id);select coalesce(jsonb_agg(invoice_id),'[]')into result from(select distinct o.invoice_id from public.payment_observations o where o.tenant_id=target_tenant_id and o.mode='live'and o.proposed_state='AUTHENTICATED_CALLBACK'and o.provider_evidence->>'kind'in('PAYMENT','REFUND')and not exists(select 1 from public.payment_observations settled where settled.tenant_id=o.tenant_id and settled.event_id='stars:admitted:'||o.id::text)order by o.invoice_id limit 3)x;return result;end;$$;
revoke all on function public.stars_commerce_recovery_targets_v1(uuid)from public,anon,authenticated,service_role;
grant execute on function public.stars_commerce_recovery_targets_v1(uuid)to service_role;
create function public.stars_commerce_replay_state_v1(target_tenant_id uuid,target_invoice_id uuid,raw_hash_value text)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare result jsonb;begin
 perform private.stars_commerce_guard(target_tenant_id);
 select jsonb_build_object('state',i.status,'replay',true,'receipt_id',r.id,'subscription_id',p.subscription_id)into result
 from public.payment_observations cb join public.payment_observations admitted on admitted.tenant_id=cb.tenant_id and admitted.event_id='stars:admitted:'||cb.id::text
 join public.payment_invoices i on i.tenant_id=cb.tenant_id and i.id=cb.invoice_id join private.verified_payment_receipts r on r.tenant_id=i.tenant_id and r.invoice_id=i.id join public.subscription_payments p on p.tenant_id=r.tenant_id and p.receipt_id=r.id
 where cb.tenant_id=target_tenant_id and cb.invoice_id=target_invoice_id and cb.raw_body_hash=raw_hash_value and cb.proposed_state='AUTHENTICATED_CALLBACK'limit 1;return result;end;$$;
revoke all on function public.stars_commerce_replay_state_v1(uuid,uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.stars_commerce_replay_state_v1(uuid,uuid,text)to service_role;

-- Source-bound checkout uses the existing state graph, native QA/ACK, catalogue,
-- invoice and event ledgers. It never invents offer delivery or collected revenue.
create function public.campaign_prepare_purchase_v1(target_tenant_id uuid,campaign_id_value uuid,job_id_value uuid,source_event_id_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare job private.campaign_jobs;control private.campaign_execution_controls;campaign private.sales_campaigns;offer public.commercial_offers;ack public.messages;st public.customer_state;step record;ev uuid;tr jsonb;prepared_offer_id uuid;begin
 perform 1 from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 control:=private.campaign_execution_guard(target_tenant_id,campaign_id_value);
 if control.scope<>'COMMERCIAL'then raise exception 'STARS_COMMERCIAL_AUTHORITY_REQUIRED'using errcode='42501';end if;
 perform private.stars_commerce_guard(target_tenant_id);
 job:=private.campaign_native_source(target_tenant_id,campaign_id_value,job_id_value);
 select * into campaign from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value;
 if exists(select 1 from private.campaign_jobs prior join public.scheduled_jobs q on q.id=prior.job_id where prior.tenant_id=target_tenant_id and prior.campaign_id=campaign_id_value and prior.source_message_id=job.source_message_id and prior.job_id<>job.job_id and q.status='completed')or not exists(select 1 from public.domain_events e join public.messages m on m.tenant_id=e.tenant_id and m.id::text=e.payload->>'message_id'where e.tenant_id=target_tenant_id and e.id=source_event_id_value and e.event_type='message.received'and m.id=job.source_message_id and lower(btrim(m.content))in('/buy','/subscribe'))then raise exception 'STARS_EXPLICIT_PURCHASE_SOURCE_REQUIRED'using errcode='42501';end if;
 perform 1 from public.conversations where tenant_id=target_tenant_id and id=job.conversation_id for update;
 -- An acknowledged native response must actually cite this immutable plan price.
 -- API acknowledgement proves provider acceptance, never that the customer read it.
 select m.* into ack from public.agent_proposals p join public.agent_tasks t on t.tenant_id=p.tenant_id and t.id=p.task_id join private.campaign_jobs cj on cj.tenant_id=t.tenant_id and cj.agent_task_id=t.id join public.messages m on m.tenant_id=p.tenant_id and m.id=p.sent_message_id join public.conversation_quality_evaluations qa on qa.tenant_id=p.tenant_id and qa.run_id=p.run_id
 where p.tenant_id=target_tenant_id and cj.campaign_id=campaign_id_value and cj.conversation_id=job.conversation_id and m.status='sent'and m.provider_message_id is not null and m.actor_id like 'campaign-ai:%'and p.approval_status='approved'and not p.customer_facing_blocked and qa.qa_action='approve'and not qa.customer_facing_blocked and m.content=p.original_payload->>'proposed_response'and exists(select 1 from jsonb_array_elements(p.original_payload->'claims')cl where cl->'evidence_refs'?((campaign.configuration->>'plan_version_id')||':fact:1'))order by m.created_at desc limit 1;
 if ack.id is null then return jsonb_build_object('offer_id',null);end if;
 select o.* into offer from public.commercial_offers o join public.payment_invoices i on i.tenant_id=o.tenant_id and i.offer_id=o.id where o.tenant_id=target_tenant_id and o.customer_id=job.customer_id and o.conversation_id=job.conversation_id and o.plan_version_id=(campaign.configuration->>'plan_version_id')::uuid and o.status='approved'and o.expires_at>clock_timestamp()and i.provider_id='telegram_stars_live'and i.mode='live'and i.status in('CREATED','PENDING')and i.expires_at>clock_timestamp()order by i.created_at limit 1;
 -- A verified current inbound is genuinely user-initiated; this is not a consent event.
 update public.messaging_contacts set contactability='user_initiated'where tenant_id=target_tenant_id and id=(select messaging_contact_id from public.conversations where tenant_id=target_tenant_id and id=job.conversation_id)and customer_id=job.customer_id and contactability='allowed';
 if found then perform private.campaign_audit(target_tenant_id,campaign_id_value,'inbound_contact_classified',jsonb_build_object('source_event_id',source_event_id_value,'classification','USER_INITIATED','individual_consent_created',false));end if;
 if offer.id is null then prepared_offer_id:=private.prepare_commercial_offer(target_tenant_id,source_event_id_value,(campaign.configuration->>'plan_version_id')::uuid,0);select * into offer from public.commercial_offers where tenant_id=target_tenant_id and id=prepared_offer_id;end if;
 -- The legacy standalone trigger may see this running native source as a
 -- delivery conflict. Native source ownership was independently verified above;
 -- approve only this exact source/configured immutable price, never a rejection.
 if offer.status='draft'and offer.source_event_id=source_event_id_value and offer.customer_id=job.customer_id and offer.conversation_id=job.conversation_id and offer.plan_version_id=(campaign.configuration->>'plan_version_id')::uuid and offer.discount_bps=0 and offer.currency='XTR'and offer.expires_at>clock_timestamp()and exists(select 1 from public.commercial_versions v where v.tenant_id=target_tenant_id and v.id=offer.plan_version_id and v.status='published'and offer.snapshot#>'{plan,payload}'=v.payload and offer.amount=(v.payload->>'amount')::numeric and v.payload->>'currency'='XTR')then
  update public.commercial_offers set status='approved',reviewer=null,reviewed_at=clock_timestamp()where tenant_id=target_tenant_id and id=offer.id and status='draft'returning * into offer;
  perform private.campaign_audit(target_tenant_id,campaign_id_value,'offer_source_preapproved',jsonb_build_object('offer_id',offer.id,'source_event_id',source_event_id_value,'job_id',job_id_value,'activation_revision',campaign.revision,'human_per_offer_review',false,'payment_verified',false));
 end if;
 if offer.id is null or offer.status is distinct from 'approved'then raise exception 'STARS_CAMPAIGN_OFFER_NOT_APPROVED'using errcode='42501';end if;
 select state into st from public.customers where tenant_id=target_tenant_id and id=job.customer_id for update;
 for step in select * from(values('NEW','CONTACT_READY',null::text),('CONTACT_READY','CONTACTED',null),('CONTACTED','REPLIED',null),('REPLIED','QUALIFIED','qualification.completed'),('QUALIFIED','OFFER_SENT','offer.created'),('OFFER_SENT','INTERESTED','offer.accepted'))v(a,b,e)loop
  if st::text=step.a then
   ev:=source_event_id_value;
   if step.e is not null then ev:=private.append_domain_event(target_tenant_id,job.customer_id,step.e,1,case when step.e='qualification.completed'then jsonb_build_object('qualification_id',offer.id,'approved_offer_id',offer.id,'source_event_id',source_event_id_value)else jsonb_build_object('offer_id',offer.id,'source_event_id',source_event_id_value,'provider_ack_message_id',ack.id)end,'SYSTEM',null,'campaign_checkout','TRUSTED',extensions.gen_random_uuid(),source_event_id_value,'campaign-checkout:'||job_id_value::text||':'||step.b,clock_timestamp());end if;
   tr:=public.transition_customer_state(target_tenant_id,job.customer_id,st,step.b::public.customer_state,'source_bound_purchase_and_price_ack','SYSTEM',null,extensions.gen_random_uuid(),ev,coalesce(step.e,'message.received'),ev,'campaign-checkout:'||job_id_value::text||':'||step.b,clock_timestamp());
   if tr->>'accepted'is distinct from 'true'then raise exception 'STARS_PURCHASE_LIFECYCLE_DENIED'using errcode='42501';end if;st:=step.b::public.customer_state;
  end if;
 end loop;
 if st not in('INTERESTED','PAYMENT_PENDING','PAID','ACTIVE','RENEWAL_DUE','RENEWED','EXPIRED')then raise exception 'STARS_PURCHASE_LIFECYCLE_REVIEW'using errcode='42501';end if;
 return jsonb_build_object('offer_id',offer.id);
end;$$;
create function public.stars_commerce_checkout_evidence_v1(target_tenant_id uuid,target_invoice_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare b jsonb;url text;observed timestamptz;i public.payment_invoices;begin
 b:=private.stars_commerce_guard(target_tenant_id);
 select * into i from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and provider_id='telegram_stars_live'and mode='live'and recipient=b->>'bot_user_id';
 if i.id is null then raise exception 'STARS_INTENT_SCOPE_DENIED'using errcode='42501';end if;
 if i.status='REVIEW'then return jsonb_build_object('state','UNKNOWN','checkout_url',null,'observed_at',null);end if;
 if i.status not in('CREATED','PENDING')or i.expires_at<=clock_timestamp()then return jsonb_build_object('state','CLOSED','checkout_url',null,'observed_at',null);end if;
 select r.provider_evidence#>>'{result,checkout_url}',r.created_at into url,observed from public.payment_observations a join public.payment_observations r on r.tenant_id=a.tenant_id and r.provider_evidence->>'attempt_id'=a.id::text where a.tenant_id=target_tenant_id and a.invoice_id=target_invoice_id and a.proposed_state='DISPATCH_STARTED'and a.provider_evidence->>'operation'='createInvoiceLink'and r.proposed_state='PROVIDER_RESULT'and r.resulting_state='ACKNOWLEDGED'order by r.created_at desc limit 1;
 if url is not null and url!~'^https://t\.me/\$[A-Za-z0-9_-]{1,200}$'then raise exception 'STARS_CHECKOUT_EVIDENCE_INVALID'using errcode='42501';end if;
 return jsonb_build_object('state','READY','checkout_url',url,'observed_at',observed);end;$$;
revoke all on function public.campaign_prepare_purchase_v1(uuid,uuid,uuid,uuid),public.stars_commerce_checkout_evidence_v1(uuid,uuid)from public,anon,authenticated;
grant execute on function public.campaign_prepare_purchase_v1(uuid,uuid,uuid,uuid),public.stars_commerce_checkout_evidence_v1(uuid,uuid)to service_role;

-- Recheck the committed reservation immediately before the fixed HTTP boundary.
-- STOP/suppression/ownership fences new checkout and pre-checkout effects; reads,
-- receipt reconciliation and refunds remain available for already owed duties.
create function public.stars_commerce_authorize_attempt_v1(target_tenant_id uuid,target_invoice_id uuid,attempt_id_value uuid,nonce_value uuid)returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare b jsonb;a public.payment_observations;i public.payment_invoices;begin
 b:=private.stars_commerce_guard(target_tenant_id);
 select * into i from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and mode='live'and provider_id='telegram_stars_live'and recipient=b->>'bot_user_id';
 select * into a from public.payment_observations where tenant_id=target_tenant_id and invoice_id=i.id and id=attempt_id_value and proposed_state='DISPATCH_STARTED'and provider_evidence->>'nonce'=nonce_value::text and provider_evidence->>'repository_sha'=b->>'repository_sha';
 if i.id is null or a.id is null or exists(select 1 from public.payment_observations where tenant_id=target_tenant_id and provider_evidence->>'attempt_id'=a.id::text and proposed_state='PROVIDER_RESULT')then return false;end if;
 if a.provider_evidence->>'operation'in('createInvoiceLink','answerPreCheckoutQuery')then
  return i.status in('CREATED','PENDING')and i.expires_at>clock_timestamp()
   and not exists(select 1 from private.campaign_suppressions where tenant_id=target_tenant_id and customer_id=i.customer_id)
   and exists(select 1 from public.tenants where id=target_tenant_id and status='active'and outbound_messaging_enabled)
   and exists(select 1 from public.commercial_offers o join public.conversations cv on cv.tenant_id=o.tenant_id and cv.id=o.conversation_id join private.campaign_audience audience on audience.tenant_id=o.tenant_id and audience.customer_id=o.customer_id join private.sales_campaigns c on c.tenant_id=audience.tenant_id and c.id=audience.campaign_id where o.tenant_id=target_tenant_id and o.id=i.offer_id and c.state='ACTIVE'and c.configuration->>'plan_version_id'=o.plan_version_id::text and b->'allowed_markets'?audience.market and cv.runtime_mode='AI_ACTIVE'and not cv.human_takeover and cv.status='open');
 end if;
 if a.provider_evidence->>'operation'='sendMessage'then return i.status='CONFIRMED'and public.stars_commerce_access_v1(target_tenant_id,i.payer_reference)is not null;end if;
 return a.provider_evidence->>'operation'in('getMe','getStarTransactions','refundStarPayment');
end;$$;
revoke all on function public.stars_commerce_authorize_attempt_v1(uuid,uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.stars_commerce_authorize_attempt_v1(uuid,uuid,uuid,uuid)to service_role;

create function private.campaign_checkout_facts(t uuid,rid uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare r public.agent_runs;task public.agent_tasks;facts jsonb;ids jsonb;begin
 select * into strict r from public.agent_runs where tenant_id=t and id=rid;select * into strict task from public.agent_tasks where tenant_id=t and id=r.task_id;
 ids:=coalesce(r.context_manifest->'checkout_evidence_ids','[]');
 if jsonb_typeof(ids)<>'array'or jsonb_array_length(ids)>1 then raise exception 'STARS_CHECKOUT_REGISTRY_INVALID'using errcode='22023';end if;
 if ids='[]'::jsonb then return '[]'::jsonb;end if;
 if r.context_manifest->>'source_context_boundary'is distinct from r.context_manifest->>'context_boundary_timestamp'or (r.context_manifest->>'backend_observation_boundary')::timestamptz>r.started_at then raise exception 'STARS_CHECKOUT_BOUNDARY_INVALID'using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id','stars:checkout:'||i.id::text)),'[]')into facts from public.payment_invoices i join public.commercial_offers o on o.tenant_id=i.tenant_id and o.id=i.offer_id where i.tenant_id=t and i.customer_id=task.customer_id and o.conversation_id=task.conversation_id and i.provider_id='telegram_stars_live'and i.mode='live'and ids?('stars:checkout:'||i.id::text)and exists(select 1 from public.payment_observations a join public.payment_observations result on result.tenant_id=a.tenant_id and result.provider_evidence->>'attempt_id'=a.id::text where a.tenant_id=t and a.invoice_id=i.id and a.proposed_state='DISPATCH_STARTED'and a.provider_evidence->>'operation'='createInvoiceLink'and result.proposed_state='PROVIDER_RESULT'and result.resulting_state='ACKNOWLEDGED'and result.created_at<=(r.context_manifest->>'backend_observation_boundary')::timestamptz and result.created_at<=r.started_at and result.provider_evidence#>>'{result,checkout_url}'~'^https://t\.me/\$[A-Za-z0-9_-]{1,200}$');
 if ids is distinct from(select coalesce(jsonb_agg(x->'id'),'[]')from jsonb_array_elements(facts)x)then raise exception 'STARS_CHECKOUT_REGISTRY_MISMATCH'using errcode='22023';end if;
 return facts;end;$$;
revoke all on function private.campaign_checkout_facts(uuid,uuid)from public,anon,authenticated,service_role;
create or replace function private.campaign_native_registry(t uuid,rid uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare r public.agent_runs;q public.agent_tasks;a private.campaign_model_attempts;x private.campaign_jobs;expected jsonb;facts jsonb;begin
 select * into strict r from public.agent_runs where tenant_id=t and id=rid;select * into strict q from public.agent_tasks where tenant_id=t and id=r.task_id;
 select * into a from private.campaign_model_attempts where tenant_id=t and native_run_id=rid;
 select * into x from private.campaign_jobs where tenant_id=t and job_id=a.job_id;
 if a.attempt_id is null or q.id is distinct from x.agent_task_id or r.context_manifest->>'campaign_profile'is distinct from 'polat-campaign-v1'
 or r.context_manifest->>'campaign_id'is distinct from a.campaign_id::text or r.context_manifest->>'campaign_job_id'is distinct from a.job_id::text
 or r.context_manifest->>'campaign_revision'is distinct from a.revision::text or r.context_manifest->>'source_message_id'is distinct from x.source_message_id::text
 or r.model_provider<>'openai'or r.model_name<>'gpt-6.1-sol'or jsonb_array_length(r.context_manifest->'included_message_ids')not between 1 and 25
 then raise exception 'EVIDENCE_REGISTRY_NOT_AUTHORITATIVE'using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('handle',case when ids.value=x.source_message_id::text then 'EVIDENCE_CURRENT_MESSAGE'else 'EVIDENCE_MESSAGE_'||ids.ordinality::text end,'messageId',m.id,'direction',m.direction)order by ids.ordinality),'[]')into expected
 from jsonb_array_elements_text(r.context_manifest->'included_message_ids')with ordinality ids(value,ordinality)join public.messages m on m.tenant_id=t and m.conversation_id=q.conversation_id and m.id::text=ids.value and m.created_at<=(r.context_manifest->>'context_boundary_timestamp')::timestamptz and(m.direction='inbound'or(m.direction='outbound'and m.status='sent'));
 if jsonb_array_length(expected)<>jsonb_array_length(r.context_manifest->'included_message_ids')then raise exception 'EVIDENCE_REGISTRY_NOT_AUTHORITATIVE'using errcode='22023';end if;
 facts:=jsonb_build_array(jsonb_build_object('id','polat:campaign:identity:v1'),jsonb_build_object('id','polat:campaign:identity:denial:v1'))||private.quality_commercial_facts(t,rid)||private.campaign_receipt_facts(t,rid)||private.campaign_checkout_facts(t,rid);
 expected:=expected||(select jsonb_agg(jsonb_build_object('handle','EVIDENCE_COMMERCIAL_'||f.ordinality::text,'messageId',f.value->>'id','direction','system')order by f.ordinality)from jsonb_array_elements(facts)with ordinality f(value,ordinality));return expected;
end;$$;

-- Transactional /vip is initiated by the numeric payer through the merchant bot.
-- It sends only a current receipt-backed invitation; no marketing or AI authority.
create function public.stars_commerce_access_v1(target_tenant_id uuid,user_id_value text)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare b jsonb;i public.payment_invoices;a public.channel_access;iid uuid;aid uuid;begin
 b:=private.stars_commerce_guard(target_tenant_id);
 if user_id_value!~'^[1-9][0-9]{0,15}$'then return null;end if;
 select inv.id,access_row.id into iid,aid from public.payment_invoices inv join private.verified_payment_receipts receipt on receipt.tenant_id=inv.tenant_id and receipt.invoice_id=inv.id and receipt.provider_id='telegram_stars_live'and receipt.signature_verified and receipt.independent_verified join public.subscription_payments payment on payment.tenant_id=receipt.tenant_id and payment.receipt_id=receipt.id join public.subscriptions sub on sub.tenant_id=payment.tenant_id and sub.id=payment.subscription_id join public.channel_access access_row on access_row.tenant_id=sub.tenant_id and access_row.subscription_id=sub.id join public.telegram_entitlement_bindings binding on binding.tenant_id=access_row.tenant_id and binding.id=access_row.binding_id join public.vip_channels channel on channel.tenant_id=access_row.tenant_id and channel.id=access_row.channel_id
 where inv.tenant_id=target_tenant_id and inv.provider_id='telegram_stars_live'and inv.mode='live'and inv.status='CONFIRMED'and inv.payer_reference=user_id_value and inv.recipient=b->>'bot_user_id'and receipt.customer_id=inv.customer_id and receipt.offer_id=inv.offer_id and sub.mode='live'and sub.state in('ACTIVE','RENEWAL_DUE')and sub.grace_until>clock_timestamp()and binding.telegram_user_id=user_id_value and binding.mode='live'and channel.chat_id=b->>'channel_id'and channel.mode='live'and channel.enabled and channel.private_verified and access_row.mode='live'and access_row.status='INVITED'and access_row.invite_expires_at>clock_timestamp()and access_row.invite_reference~'^https://t\.me/\+[A-Za-z0-9_-]{1,200}$'order by inv.created_at desc limit 1;
 if iid is null then return null;end if;
 select * into strict i from public.payment_invoices where tenant_id=target_tenant_id and id=iid;select * into strict a from public.channel_access where tenant_id=target_tenant_id and id=aid;
 return jsonb_build_object('intent',private.stars_intent(i),'message','Your verified subscription has a personal VIP join link: '||a.invite_reference||' Request to join using the same Telegram account; membership is not confirmed until the channel check.');end;$$;
create function public.stars_commerce_access_result_v1(target_tenant_id uuid,target_invoice_id uuid,request_key_value text)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare b jsonb;a public.payment_observations;r public.payment_observations;begin
 b:=private.stars_commerce_guard(target_tenant_id);
 if request_key_value!~'^access:[0-9]{1,16}$'or not exists(select 1 from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and provider_id='telegram_stars_live'and mode='live'and recipient=b->>'bot_user_id')then raise exception 'STARS_ACCESS_SCOPE_INVALID'using errcode='42501';end if;
 select * into a from public.payment_observations where tenant_id=target_tenant_id and invoice_id=target_invoice_id and event_id='stars:attempt:'||private.fse_hash(target_invoice_id::text||':sendMessage:'||request_key_value);
 if a.id is null then return null;end if;
 select * into r from public.payment_observations where tenant_id=target_tenant_id and provider_evidence->>'attempt_id'=a.id::text and proposed_state='PROVIDER_RESULT';
 return jsonb_build_object('state',case when r.resulting_state='ACKNOWLEDGED'then 'ACKNOWLEDGED'else 'UNKNOWN'end,'provider_message_id',case when r.resulting_state='ACKNOWLEDGED'then r.provider_evidence#>>'{result,provider_message_id}'end);end;$$;
revoke all on function public.stars_commerce_access_v1(uuid,text),public.stars_commerce_access_result_v1(uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.stars_commerce_access_v1(uuid,text),public.stars_commerce_access_result_v1(uuid,uuid,text)to service_role;
