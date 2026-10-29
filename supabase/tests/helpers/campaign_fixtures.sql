\ir polat_inbound_fixtures.sql
insert into auth.users(id,email)values('61ca1000-0000-4000-8000-000000000001','campaign-founder@example.test')on conflict do nothing;

create function pg_temp.campaign_owner(n integer)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','61ca1000-0000-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','61ca1000-0000-4000-8000-000000000001','role','authenticated','aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from clock_timestamp())-1)))::text,true);
end;$$;
create function pg_temp.campaign_config(n integer,b uuid,p uuid)returns jsonb language sql stable as $$
 select jsonb_build_object('version',1,'name','Synthetic campaign','mode','SYNTHETIC','batch_id',b,'plan_version_id',p,'markets',jsonb_build_array('GB','DE'),'default_language','en',
 'starts_at',clock_timestamp()-interval '1 hour','expires_at',clock_timestamp()+interval '30 days','maximum_messages',100,'maximum_per_customer',3,'maximum_per_day',3,
 'minimum_interval_seconds',60,'follow_up_after_seconds',60,'maximum_model_calls',100,'budget_currency','USD','budget_amount','10.000000','maximum_liability_per_call','0.010000','maximum_output_tokens',512,
 'timezone','UTC','window_start',extract(hour from clock_timestamp())::int,'window_end',(extract(hour from clock_timestamp())::int+23)%24);
$$;
create function pg_temp.campaign_declaration(n integer,b uuid)returns jsonb language sql immutable as $$
 select jsonb_build_object('version',1,'classification','OWNER_ATTESTED_EXISTING_PERMISSION','batch_id',b,'dataset_version','synthetic-customers-v1','dataset_hash',repeat('a',64),'source','Synthetic historical fixture',
 'channel','TELEGRAM_BOT','markets',jsonb_build_array('GB','DE'),'purpose','SIGNAL_SERVICE_MARKETING','reference','SYNTHETIC_OWNER_ATTESTATION_NOT_REAL_PERMISSION');
$$;
create function pg_temp.campaign_setup(n integer,activate boolean default true,commercial boolean default false)returns uuid language plpgsql as $$
declare t uuid:=pg_temp.polat_id(n,'2000');cid uuid:=pg_temp.polat_id(n,'5000');b uuid;cv uuid;product uuid:=pg_temp.polat_id(n,'6000');plan_item uuid:=pg_temp.polat_id(n,'6001');plan_version uuid:=pg_temp.polat_id(n,'7001');r jsonb;begin
 perform pg_temp.polat_setup(n);cv:=pg_temp.polat_conv(n);
 perform private.polat_configure_runtime_fixture(t,cv);
 insert into public.tenant_members(tenant_id,user_id,role)values(t,'61ca1000-0000-4000-8000-000000000001','super_admin');
 insert into public.customers(id,tenant_id,display_name)values(cid,t,'Synthetic customer');
 insert into public.customer_identities(tenant_id,customer_id,identity_type,identity_value,normalized_value)values(t,cid,'telegram_user_id','710000'||n,'710000'||n);
 update public.messaging_contacts set customer_id=cid where tenant_id=t;
 update public.conversations set customer_id=cid where tenant_id=t;
 perform pg_temp.campaign_owner(n);
 r:=public.create_import_dry_run(t,'csv','Synthetic historical fixture','invented.csv',repeat('a',64),jsonb_build_array(
 jsonb_build_object('row_number',2,'classification','exact_match','candidate_customer_id',cid,'identity_fingerprint',repeat('b',64),'validation_error_count',0,
 'normalized_payload',jsonb_build_object('display_name','Synthetic customer','identities',jsonb_build_array(jsonb_build_object('identity_type','telegram_user_id','identity_value','710000'||n,'normalized_value','710000'||n,'identity_scope','global')),'profile','{}'::jsonb,'memory','[]'::jsonb,'contact',jsonb_build_object('market','GB','language','en'))),
 jsonb_build_object('row_number',3,'classification','exact_match','candidate_customer_id',cid,'identity_fingerprint',repeat('b',64),'validation_error_count',0,
 'normalized_payload',jsonb_build_object('display_name','Synthetic duplicate','identities',jsonb_build_array(jsonb_build_object('identity_type','telegram_user_id','identity_value','710000'||n,'normalized_value','710000'||n,'identity_scope','global')),'profile','{}'::jsonb,'memory','[]'::jsonb,'contact',jsonb_build_object('market','GB','language','en')))));
 b:=(r->>'batch_id')::uuid;
 perform public.admin_campaign_import_authorized_v1(t,pg_temp.campaign_declaration(n,b)::text);
 insert into public.commercial_items(id,tenant_id,kind,test_only,test_conversation_id,created_by)values(product,t,'product',not commercial,case when commercial then null else cv end,auth.uid()),(plan_item,t,'plan',not commercial,case when commercial then null else cv end,auth.uid());
 insert into public.commercial_versions(id,tenant_id,item_id,version,status,payload,created_by,published_at,effective_from)values
 (pg_temp.polat_id(n,'7000'),t,product,1,'published',jsonb_build_object('title','Fixture Service','locale','en','source','Invented test catalog','description','The fixture service provides synthetic signal summaries.','service_rights','Synthetic only'),auth.uid(),clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day'),
 (plan_version,t,plan_item,1,'published',jsonb_build_object('title','Fixture Membership','locale','en','source','Invented test catalog','product_id',product,'amount','10.00','currency','USD','duration_unit','calendar_month','duration_count',1,'billing','one_off','inclusions',jsonb_build_array('synthetic signal summaries'),'restrictions','[]'::jsonb,'terms','For synthetic evaluation only.','eligibility',jsonb_build_object('instrument',null,'actively_trades',null,'experience_level',null),'max_discount_bps',0,'trial',false,'offer_valid_hours',24,'tax_rule',null,'renewal_rule',null,'cancellation_rule',null,'disclosures','[]'::jsonb),auth.uid(),clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day');
 perform public.admin_campaign_save_v1(t,pg_temp.polat_id(n,'9000'),(pg_temp.campaign_config(n,b,plan_version)||jsonb_build_object('mode',case when commercial then 'COMMERCIAL'else 'SYNTHETIC'end))::text,0);
 if activate then perform public.admin_campaign_state_v1(t,pg_temp.polat_id(n,'9000'),1,'START');end if;
 return pg_temp.polat_id(n,'9000');
end;$$;
