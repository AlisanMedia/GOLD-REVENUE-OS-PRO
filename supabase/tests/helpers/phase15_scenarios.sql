-- Reusable synthetic fixture generator. Loaded only by isolated tests/acceptance, never a migration/API.
create or replace function pg_temp.phase15_seed(t uuid,u uuid,c uuid,complete_billing boolean default false) returns jsonb language plpgsql as $$
declare anchor timestamptz:=(current_date-14)::timestamp at time zone 'UTC';v uuid;av uuid;task uuid;run1 uuid;run2 uuid;run3 uuid;prod uuid:=gen_random_uuid();plan uuid:=gen_random_uuid();fixed uuid:=gen_random_uuid();pv uuid:=gen_random_uuid();v1 uuid:=gen_random_uuid();v2 uuid:=gen_random_uuid();off1 uuid:=gen_random_uuid();off2 uuid:=gen_random_uuid();i0 uuid:=gen_random_uuid();i1 uuid:=gen_random_uuid();i2 uuid:=gen_random_uuid();i3 uuid:=gen_random_uuid();i4 uuid:=gen_random_uuid();s1 uuid:=gen_random_uuid();s2 uuid:=gen_random_uuid();e0 uuid;e1 uuid;e2 uuid;conv uuid;msg uuid;source1 uuid;source2 uuid;pc uuid;mc uuid;begin
 insert into public.customers(id,tenant_id,display_name) values(c,t,'Synthetic Analytics TEST');
 perform public.ingest_telegram_message(t,'phase15:'||t||':1','1','15001','15001',null,'Synthetic','TEST','Synthetic inbound analytics fixture',null,anchor);
 perform public.ingest_telegram_message(t,'phase15:'||t||':2','2','15002','15002',null,'Synthetic','TEST','Synthetic second contact same person',null,anchor+interval '10 seconds');
 perform public.ingest_telegram_message(t,'phase15:'||t||':3','3','15003','15003',null,'Synthetic','TEST','Synthetic unmatched inbound',null,anchor+interval '20 seconds');
 update public.messaging_contacts set customer_id=c,identity_resolution='manual',review_required=false where tenant_id=t and provider_user_id in ('15001','15002');
 update public.conversations set customer_id=c,human_takeover=true,automatic_replies_enabled=false where tenant_id=t and messaging_contact_id in(select id from public.messaging_contacts where tenant_id=t and customer_id=c);
 select id into conv from public.conversations where tenant_id=t and customer_id=c order by created_at,id limit 1;
 select id,provider_connection_id,messaging_contact_id into msg,pc,mc from public.messages where tenant_id=t and conversation_id=conv order by occurred_at,id limit 1;
 select id into source1 from public.domain_events where tenant_id=t and event_type='message.received' and payload->>'conversation_id' in(select id::text from public.conversations where tenant_id=t and customer_id=c) order by recorded_at,id limit 1;
 select id into source2 from public.domain_events where tenant_id=t and event_type='message.received' and id<>source1 and payload->>'conversation_id' in(select id::text from public.conversations where tenant_id=t and customer_id=c) order by recorded_at,id limit 1;
 insert into public.commercial_items(id,tenant_id,kind,created_by) values(prod,t,'product',u),(plan,t,'plan',u),(fixed,t,'plan',u);
 insert into public.commercial_versions(id,tenant_id,item_id,version,status,payload,created_by,effective_from) values
 (pv,t,prod,1,'published','{"title":"Synthetic product TEST"}',u,anchor),
 (v1,t,plan,1,'published','{"title":"Synthetic monthly TEST","duration_unit":"calendar_month","duration_count":1,"billing":"recurring"}',u,anchor),
 (v2,t,fixed,1,'published','{"title":"Synthetic fixed-days TEST","duration_unit":"fixed_days","duration_count":30,"billing":"recurring"}',u,anchor);
 insert into public.commercial_offers(id,tenant_id,conversation_id,customer_id,source_event_id,plan_version_id,product_version_id,amount,currency,discount_bps,snapshot,status,reviewer,reviewed_at,expires_at,created_at) values
 (off1,t,conv,c,source1,v1,pv,79,'USD',0,'{"mode":"SYNTHETIC"}','approved',u,anchor+interval '2 minutes',now()+interval '30 days',anchor+interval '1 minute'),
 (off2,t,conv,c,source2,v2,pv,99,'USD',0,'{"mode":"SYNTHETIC"}','approved',u,anchor+interval '2 minutes',now()+interval '30 days',anchor+interval '1 minute');
 insert into public.payment_invoices(id,tenant_id,customer_id,offer_id,provider_id,provider_reference,channel,surface,mode,amount_units,decimals,asset,network,recipient,payer_reference,min_confirmations,status,quote_snapshot,idempotency_key,expires_at,created_by,created_at,confirmed_at) values
 (i0,t,c,off1,'external_crypto_test','test:'||i0,'external_crypto','independent_web','test',1000000,6,'USDT','TRON','test:receiver','test:payer',20,'CONFIRMED','{}',i0::text,now()+interval '1 day',u,anchor-interval '30 days',anchor-interval '30 days'),
 (i1,t,c,off1,'external_crypto_test','test:'||i1,'external_crypto','independent_web','test',12345678901234567890123,6,'USDT','TRON','test:receiver','test:payer',20,'CONFIRMED','{}',i1::text,now()+interval '1 day',u,anchor+interval '3 minutes',anchor+interval '6 minutes'),
 (i2,t,c,off2,'telegram_stars_test','test:'||i2,'telegram_stars','telegram_bot','test',100,0,'XTR','TELEGRAM','test:receiver','test:payer',1,'CONFIRMED','{}',i2::text,now()+interval '1 day',u,anchor+interval '3 minutes',anchor+interval '6 minutes'),
 (i3,t,c,off1,'external_crypto_test','test:'||i3,'external_crypto','independent_web','test',999999999,6,'USDT','TRON','test:receiver','test:payer',20,'CONFIRMED','{}',i3::text,now()+interval '1 day',u,anchor+interval '3 minutes',anchor+interval '6 minutes'),
 (i4,t,c,off1,'external_crypto_test','test:'||i4,'external_crypto','independent_web','test',88888888,6,'USDT','TRON','test:receiver','test:payer',20,'CREATED','{}',i4::text,now()+interval '1 day',u,anchor+interval '3 minutes',null);
 e0:=private.append_domain_event(t,c,'payment.test_observed',1,jsonb_build_object('payment_id',i0,'mode','test','state','CONFIRMED'),'SYSTEM',null,'payment_test_engine','TRUSTED',gen_random_uuid(),null,'p15:'||i0,anchor-interval '30 days');
 e1:=private.append_domain_event(t,c,'payment.test_observed',1,jsonb_build_object('payment_id',i1,'mode','test','state','CONFIRMED'),'SYSTEM',null,'payment_test_engine','TRUSTED',gen_random_uuid(),null,'p15:'||i1,anchor+interval '6 minutes');
 e2:=private.append_domain_event(t,c,'payment.test_observed',1,jsonb_build_object('payment_id',i2,'mode','test','state','CONFIRMED'),'SYSTEM',null,'payment_test_engine','TRUSTED',gen_random_uuid(),null,'p15:'||i2,anchor+interval '6 minutes');
 insert into public.subscriptions(id,tenant_id,customer_id,plan_version_id,mode,state,plan_snapshot,commercial_snapshot,starts_at,ends_at,grace_until,renewal_due_at) values
 (s1,t,c,v1,'test','ACTIVE','{}','{}',anchor-interval '1 month',anchor+interval '1 month',anchor+interval '1 month',anchor+interval '1 month'-interval '3 days'),
 (s2,t,c,v2,'test','ACTIVE','{}','{}',anchor+interval '7 minutes',anchor+interval '30 days',anchor+interval '30 days',anchor+interval '27 days');
 insert into public.subscription_payments(tenant_id,subscription_id,mode,test_invoice_id,event_id,term_snapshot,period_start,period_end) values
 (t,s1,'test',i0,e0,'{"billing":"recurring","duration_unit":"calendar_month","duration_count":1}',anchor-interval '1 month',anchor),
 (t,s1,'test',i1,e1,'{"billing":"recurring","duration_unit":"calendar_month","duration_count":1}',anchor,anchor+interval '1 month'),
 (t,s2,'test',i2,e2,'{"billing":"recurring","duration_unit":"fixed_days","duration_count":30}',anchor+interval '7 minutes',anchor+interval '30 days');
 av:=private.ensure_shadow_agent(t);
 insert into public.agent_tasks(tenant_id,agent_definition_id,agent_version_id,customer_id,conversation_id,source_event_id,task_type,objective,execution_mode,status,idempotency_key,correlation_id) select t,agent_definition_id,av,c,conv,source1,'lead.intelligence','Synthetic analytics only','SHADOW','SUCCEEDED','p15:lead:'||t,gen_random_uuid() from public.agent_versions where id=av returning id into task;
 insert into public.agent_runs(tenant_id,task_id,agent_version_id,attempt_number,status,execution_mode,worker_id,structured_output,created_at,started_at,completed_at,billed_amount,billed_currency) values(t,task,av,1,'SUCCEEDED','SHADOW','phase15-synthetic','{"identity":"matched","completeness":0.5}',anchor,anchor,anchor+interval '1 minute',99999,'USD') returning id into run1;
 insert into public.agent_runs(tenant_id,task_id,agent_version_id,attempt_number,status,execution_mode,worker_id,created_at) values(t,task,av,2,'SUCCEEDED','SHADOW','phase15-synthetic',anchor) returning id into run2;
 insert into public.agent_runs(tenant_id,task_id,agent_version_id,attempt_number,status,execution_mode,worker_id,created_at) values(t,task,av,3,case when complete_billing then 'SUCCEEDED'::public.agent_runtime_status else 'FAILED'::public.agent_runtime_status end,'SHADOW','phase15-synthetic',anchor) returning id into run3;
 insert into public.model_invocations(tenant_id,run_id,provider,model,status,provider_request_id,input_tokens,output_tokens,billed_amount,billed_currency,latency_ms,request_fingerprint,created_at) values
 (t,run1,'synthetic','model-test','SUCCEEDED','synthetic:'||run1,100,25,0.10000001,'USD',100,'test',anchor),
 (t,run2,'synthetic','model-test','SUCCEEDED','synthetic:'||run2,200,50,0.20000002,'USD',200,'test',anchor),
 (t,run3,'synthetic','model-test',case when complete_billing then 'SUCCEEDED' else 'FAILED' end,case when complete_billing then 'synthetic:'||run3 end,null,null,case when complete_billing then 0.30000003 end,case when complete_billing then 'USD' end,null,'test',anchor);
 insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,content,status,provider_chat_id,provider_message_id,idempotency_key,actor_type,correlation_id,occurred_at,sent_at,provider_acknowledged_at,created_at) values
 (t,conv,c,mc,pc,'outbound','Synthetic failed draft only','failed','15001',null,'p15-failed:'||t,'SYSTEM',gen_random_uuid(),anchor,null,null,anchor),
 (t,conv,c,mc,pc,'outbound','Synthetic queued draft only','pending','15001',null,'p15-pending:'||t,'HUMAN',gen_random_uuid(),anchor,null,null,anchor);
 insert into public.escalation_cases(tenant_id,conversation_id,customer_id,category,severity,status,source_message_id,created_at) values(t,conv,c,'general_review','CRITICAL','OPEN',msg,anchor+interval '8 minutes');
 insert into public.customer_success_tasks(tenant_id,customer_id,kind,status,priority,mode,source_key,evidence,due_at,created_at,closed_at) values
 (t,c,'RENEWAL','OPEN','MEDIUM','test','p15:renewal','{"fixture":"SYNTHETIC no outreach"}',now(),anchor,null),
 (t,c,'CHURN','COMPLETED','LOW','test','p15:churn','{"fixture":"SYNTHETIC reason not causal"}',now(),anchor,anchor+interval '1 day');
 return jsonb_build_object('customer',c,'monthly_subscription',s1,'fixed_subscription',s2,'invoice',i1,'unverified_invoice',i3,'conversation',conv,'message',msg,'run',run1,'other_run',run2,'missing_cost_run',run3);
end;$$;
