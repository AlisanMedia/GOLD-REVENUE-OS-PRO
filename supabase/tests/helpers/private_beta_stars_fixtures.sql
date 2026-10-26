-- Disposable PostgreSQL fixtures only. Claimed provider frames below are synthetic; no Telegram request is performed.
\ir private_beta_uat_fixtures.sql
create temp table stars_cases(n integer primary key,invoice jsonb,ledger_attempt uuid,evidence jsonb,receipt jsonb);
create function pg_temp.stars_setup(n integer,maximum_calls integer default 50,bot_id text default '7400000001')returns void language plpgsql as $$
declare t uuid:=pg_temp.beta_id(n,'2000');p uuid:=pg_temp.beta_id(n,'3000');cid uuid:=pg_temp.beta_id(n,'3300');conv uuid;u text:=(7300000000+n)::text;ev uuid;control jsonb;begin
 perform pg_temp.beta_setup(n);
 -- Deliberate test fixture authority, not genuine canary/model/account acceptance.
 update private.private_beta_programs set stage='FOUNDER',approved_at=clock_timestamp(),authenticated_at=clock_timestamp(),generation=2 where id=p;
 insert into public.customers(id,tenant_id,display_name)values(cid,t,'Synthetic Stars TEST participant');
 perform public.ingest_telegram_message(t,'stars-fixture-'||n,n::text,u,u,'synthetic_stars_tester','TEST','ONLY','Fictional Stars test membership',null,clock_timestamp());
 select id into conv from public.conversations where tenant_id=t limit 1;
 update public.conversations set customer_id=cid where id=conv;
 select id into ev from public.domain_events where tenant_id=t and event_type='message.received'order by recorded_at limit 1;
 insert into private.private_beta_invites(id,tenant_id,program_id,command_id,kind,code_hash,expires_at,accepted_by,accepted_chat,accepted_at)
 values(pg_temp.beta_id(n,'4100'),t,p,pg_temp.beta_id(n,'4101'),'FOUNDER',private.fse_hash('stars-fixture-invite-'||n),clock_timestamp()+interval '1 hour',u,u,clock_timestamp());
 insert into private.private_beta_participants(tenant_id,program_id,invite_id,kind,provider_user_id,provider_chat_id,conversation_id,status,notice_version,notice_hash,consented_at)
 values(t,p,pg_temp.beta_id(n,'4100'),'FOUNDER',u,u,conv,'ACTIVE','polat-private-beta-notice-v1',private.fse_hash('synthetic-consent-'||n),clock_timestamp());
 insert into public.commercial_items(id,tenant_id,kind,test_only,test_conversation_id,created_by)values(pg_temp.beta_id(n,'4400'),t,'product',true,conv,pg_temp.beta_id(n,'1000')),(pg_temp.beta_id(n,'4401'),t,'plan',true,conv,pg_temp.beta_id(n,'1000'));
 insert into public.commercial_versions(id,tenant_id,item_id,version,payload,created_by,effective_from)values
 (pg_temp.beta_id(n,'4500'),t,pg_temp.beta_id(n,'4400'),1,'{"title":"POLAT_VIP_30D_DRAFT — TEST ONLY"}',pg_temp.beta_id(n,'1000'),clock_timestamp()),
 (pg_temp.beta_id(n,'4501'),t,pg_temp.beta_id(n,'4401'),1,'{"title":"Fictional TEST membership","duration_unit":"fixed_days","duration_count":30}',pg_temp.beta_id(n,'1000'),clock_timestamp());
 insert into public.commercial_offers(id,tenant_id,conversation_id,customer_id,source_event_id,plan_version_id,product_version_id,amount,currency,discount_bps,snapshot,status,expires_at)
 values(pg_temp.beta_id(n,'4600'),t,conv,cid,ev,pg_temp.beta_id(n,'4501'),pg_temp.beta_id(n,'4500'),69,'USD',0,'{"fixture":"Fictional TEST ONLY;69USD reference is NOT an XTR price"}','approved',clock_timestamp()+interval '1 hour');
 control:=jsonb_build_object('version',1,'environment','TELEGRAM_DEDICATED_TEST','bot_user_id',bot_id,'get_me_hash',private.fse_hash('SYNTHETIC HTTP /test/getMe frame'),
 'observed_at',clock_timestamp(),'expires_at',clock_timestamp()+interval '30 minutes','approved_test_amount_units','1','maximum_calls',maximum_calls,
 'test_users',jsonb_build_array(jsonb_build_object('test_user_id',u,'customer_id',cid,'consent_hash',private.fse_hash('separate TEST identity synthetic consent-'||n))));
 perform private.private_beta_stars_control_record(t,p,control::text);
 insert into stars_cases(n,invoice)values(n,public.private_beta_stars_invoice_v1(t,p,pg_temp.beta_id(n,'4600'),'stars-fixture-invoice-'||n));
end;$$;
create function pg_temp.stars_reserve(n integer,op text default 'getStarTransactions',key_value text default 'ledger-1',hash_value text default null)returns jsonb language sql as $$
 select public.private_beta_stars_reserve_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),(select revision from private.private_beta_stars_controls where program_id=pg_temp.beta_id(n,'3000')),op,key_value,private.fse_hash('effect:'||key_value),coalesce(hash_value,private.fse_hash('request:'||key_value)),pg_temp.beta_id(n,'6500'))
$$;
create function pg_temp.stars_evidence(n integer,kind_value text default 'PAYMENT',charge_value text default null,update_value text default null)returns jsonb language plpgsql as $$
declare i jsonb;bot text;charge text:=coalesce(charge_value,'TEST-opaque-charge-'||n);uid text:=coalesce(update_value,(n*10+case kind_value when 'PAYMENT'then 1 else 2 end)::text);ts timestamptz:=clock_timestamp();begin
 select invoice into strict i from stars_cases where stars_cases.n=$1;bot:=i->>'bot_user_id';
 return jsonb_build_object('event',jsonb_build_object('version',1,'origin','TELEGRAM_DEDICATED_TEST','kind',kind_value,'update_id',uid,'invoice_id',i->>'invoice_id','program_id',i->>'program_id','tenant_id',i->>'tenant_id','bot_user_id',bot,
 'amount_units','1','currency','XTR','charge_id',charge,'query_id',null,'source_time',ts,'raw_hash',private.fse_hash('synthetic-callback:'||n||':'||kind_value||':'||uid),'late',false),
 'ledger',jsonb_build_object('version',1,'origin','TELEGRAM_DEDICATED_TEST','bot_user_id',bot,'read_at',ts,'raw_hash',private.fse_hash('synthetic-ledger:'||n||':'||kind_value),'complete',true,
 'transactions',jsonb_build_array(jsonb_build_object('charge_id',charge,'kind',kind_value,'payer_user_id',i->>'payer_user_id','amount_units','1','source_time',ts,'invoice_payload','uat-stars:'||(i->>'invoice_id')))));
end;$$;
create function pg_temp.stars_prepare_ledger(n integer,kind_value text default 'PAYMENT')returns uuid language plpgsql as $$
declare r jsonb;key_value text:='ledger-'||lower(kind_value);a uuid;begin
 r:=pg_temp.stars_reserve(n,'getStarTransactions',key_value);a:=(r->>'attempt_id')::uuid;
 perform public.private_beta_stars_record_attempt_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),a,pg_temp.beta_id(n,'6500'),jsonb_build_object('attempt_id',a,'state','ACKNOWLEDGED','provider_status',200,'response_hash',private.fse_hash('synthetic-ledger:'||n||':'||kind_value),'financial_authority','NONE')::text);
 return a;end;$$;
create function pg_temp.stars_record(n integer,kind_value text default 'PAYMENT',charge_value text default null,update_value text default null)returns jsonb language plpgsql as $$
declare v jsonb;r jsonb;a uuid;begin
 v:=pg_temp.stars_evidence(n,kind_value,charge_value,update_value);a:=pg_temp.stars_prepare_ledger(n,kind_value);
 r:=public.private_beta_stars_record_evidence_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),(v->'event'->>'invoice_id')::uuid,a,v::text);
 update stars_cases set evidence=v,ledger_attempt=a,receipt=r where stars_cases.n=$1;return r;
end;$$;
create function pg_temp.stars_access_setup(n integer)returns uuid language plpgsql as $$
declare c private.private_beta_stars_controls;i jsonb;begin
 select *into c from private.private_beta_stars_controls where program_id=pg_temp.beta_id(n,'3000');
 perform private.private_beta_stars_control_record(c.tenant_id,c.program_id,(c.configuration||jsonb_build_object('observed_at',clock_timestamp(),'test_channel_id','-1007400000001','channel_source_hash',private.fse_hash('SYNTHETIC TEST CHANNEL /test/getChat and bot rights')))::text);
 select invoice into i from stars_cases where stars_cases.n=$1;
 return(public.private_beta_stars_bind_access_v1(c.tenant_id,c.program_id,(i->>'invoice_id')::uuid)->>'access_id')::uuid;
end;$$;
create function pg_temp.stars_access_attempt(n integer,method_value text,job_value uuid)returns uuid language plpgsql as $$
declare c private.private_beta_stars_controls;r jsonb;a uuid;begin
 select *into c from private.private_beta_stars_controls where program_id=pg_temp.beta_id(n,'3000');
 r:=public.private_beta_stars_reserve_v1(c.tenant_id,c.program_id,c.revision,method_value,method_value||':'||job_value::text,
 private.fse_hash(private.fse_tuple('telegram-stars-test-dispatch',jsonb_build_array(c.program_id::text,c.configuration->>'bot_user_id',method_value,job_value::text))),private.fse_hash('SYNTHETIC TEST HTTP BODY:'||method_value||':'||job_value::text),pg_temp.beta_id(n,'6500'));
 a:=(r->>'attempt_id')::uuid;perform public.private_beta_stars_record_attempt_v1(c.tenant_id,c.program_id,a,pg_temp.beta_id(n,'6500'),jsonb_build_object('attempt_id',a,'state','ACKNOWLEDGED','provider_status',200,'response_hash',private.fse_hash('SYNTHETIC TEST HTTP RESPONSE:'||method_value||':'||job_value::text),'financial_authority','NONE')::text);return a;
end;$$;
