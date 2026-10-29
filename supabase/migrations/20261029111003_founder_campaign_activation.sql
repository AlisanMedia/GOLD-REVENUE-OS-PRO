-- One founder campaign activation replaces routine internal message/offer approval.
-- Existing security, transport, QA, payment and financial-authority gates are unchanged.
create table private.campaign_permissions (
 tenant_id uuid not null, batch_id uuid not null, declaration jsonb not null,
 declaration_hash text not null check(declaration_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid not null references auth.users(id), attested_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,batch_id),
 foreign key(tenant_id,batch_id) references public.import_batches(tenant_id,id)
);
create table private.sales_campaigns (
 tenant_id uuid not null references public.tenants(id), id uuid not null,
 configuration jsonb not null, state text not null default 'CONFIGURING'
 check(state in('CONFIGURING','READY','ACTIVE','PAUSED','STOPPED')),
 owner_id uuid not null references auth.users(id), revision integer not null default 1 check(revision>0),
 activated_at timestamptz, attempts integer not null default 0 check(attempts>=0),
 reserved_liability numeric(18,6) not null default 0 check(reserved_liability>=0),
 created_at timestamptz not null default clock_timestamp(), last_cycle_at timestamptz, primary key(tenant_id,id)
);
create table private.campaign_audience (
 tenant_id uuid not null, campaign_id uuid not null, customer_id uuid not null,
 market text check(market ~ '^[A-Z]{2}$'), language text not null default 'en' check(language in('en','tr','ar','ru')),
 primary key(tenant_id,campaign_id,customer_id),
 foreign key(tenant_id,campaign_id) references private.sales_campaigns(tenant_id,id),
 foreign key(tenant_id,customer_id) references public.customers(tenant_id,id)
);
create index campaign_audience_customer on private.campaign_audience(tenant_id,customer_id,campaign_id);
create table private.campaign_suppressions (
 tenant_id uuid not null, customer_id uuid not null, source_message_id uuid not null,
 reason text not null check(reason='CUSTOMER_OPT_OUT'), created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,customer_id,source_message_id),
 foreign key(tenant_id,customer_id) references public.customers(tenant_id,id),
 foreign key(tenant_id,source_message_id) references public.messages(tenant_id,id)
);
-- Bind the existing durable scheduled_jobs queue, not a second sender or event ledger.
create table private.campaign_jobs (
 tenant_id uuid not null, job_id uuid not null references public.scheduled_jobs(id), campaign_id uuid not null,
 customer_id uuid not null, conversation_id uuid not null, source_message_id uuid not null,
 campaign_revision integer not null, source_hash text not null,
 lease_token uuid, body_hash text, body text check(body is null or char_length(body)between 1 and 600),native_generation bigint,outcome jsonb,
 primary key(tenant_id,job_id),
 foreign key(tenant_id,campaign_id,customer_id) references private.campaign_audience(tenant_id,campaign_id,customer_id),
 foreign key(tenant_id,conversation_id) references public.conversations(tenant_id,id),
 foreign key(tenant_id,source_message_id) references public.messages(tenant_id,id)
);
create index campaign_jobs_campaign on private.campaign_jobs(tenant_id,campaign_id,job_id);

create function private.campaign_admin(t uuid, owner_only boolean default true, fresh boolean default false)
returns void language plpgsql stable set search_path=pg_catalog as $$begin
 if auth.uid() is null or auth.jwt()->>'aal' is distinct from 'aal2'
 or not private.has_tenant_role(t,case when owner_only then array['super_admin']::public.app_role[] else array['super_admin','manager']::public.app_role[] end)
 then raise exception 'CAMPAIGN_UNAVAILABLE' using errcode='42501';end if;
 if fresh then perform private.private_beta_mfa_at();end if;
end;$$;
create function private.campaign_audit(t uuid, entity uuid, action_value text, data_value jsonb)
returns void language sql set search_path=pg_catalog as $$
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)
 values(t,case when auth.uid() is null then 'SYSTEM'::public.audit_actor_type else 'HUMAN'::public.audit_actor_type end,
 auth.uid(),'campaign.'||action_value,'sales_campaigns',entity::text,data_value);
$$;
create function private.campaign_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 raise exception 'CAMPAIGN_EVIDENCE_IMMUTABLE' using errcode='42501';end;$$;
create trigger campaign_permission_immutable before update or delete on private.campaign_permissions for each row execute function private.campaign_immutable();
create trigger campaign_suppression_immutable before update or delete on private.campaign_suppressions for each row execute function private.campaign_immutable();

create function public.admin_campaign_permission_v1(target_tenant_id uuid, declaration_value text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v jsonb; b public.import_batches; e private.campaign_permissions; h text;begin
 perform private.campaign_admin(target_tenant_id,true,true);
 v:=private.fse_strict_json(declaration_value);
 if not private.fse_keys(v,array['version','classification','batch_id','dataset_version','dataset_hash','source','channel','markets','purpose','reference'])
 or not private.fse_strings(v,array['classification','batch_id','dataset_version','dataset_hash','source','channel','purpose','reference'])
 or v->'version'<>'1'::jsonb or v->>'classification'<>'OWNER_ATTESTED_EXISTING_PERMISSION'
 or v->>'purpose'<>'SIGNAL_SERVICE_MARKETING' or v->>'channel' not in('TELEGRAM_BOT','TELEGRAM_BUSINESS')
 or char_length(v->>'dataset_version') not between 1 and 80 or char_length(v->>'source') not between 1 and 160
 or char_length(v->>'reference') not between 1 and 160 or v->>'dataset_hash'!~'^[a-f0-9]{64}$'
 or jsonb_typeof(v->'markets') is distinct from 'array' or jsonb_array_length(v->'markets') not between 1 and 100
 or exists(select 1 from jsonb_array_elements(v->'markets') x where jsonb_typeof(x)<>'string' or x#>>'{}'!~'^[A-Z]{2}$' or x#>>'{}'='TR')
 or (select count(*)<>count(distinct x) from jsonb_array_elements(v->'markets') x)
 then raise exception 'CAMPAIGN_INVALID' using errcode='22023';end if;
 select * into b from public.import_batches where tenant_id=target_tenant_id and id=(v->>'batch_id')::uuid for update;
 if b.id is null or b.file_sha256 is distinct from v->>'dataset_hash' or b.source_name is distinct from v->>'source'
 then raise exception 'CAMPAIGN_UNAVAILABLE' using errcode='42501';end if;
 h:=private.fse_hash(private.fse_canonical(v));
 select * into e from private.campaign_permissions where tenant_id=target_tenant_id and batch_id=b.id;
 if e.batch_id is not null then
  if e.declaration_hash<>h then raise exception 'CAMPAIGN_DECLARATION_CONFLICT' using errcode='23505';end if;
  return jsonb_build_object('recorded',true,'replay',true,'classification',e.declaration->>'classification');
 end if;
 insert into private.campaign_permissions values(target_tenant_id,b.id,v,h,auth.uid(),clock_timestamp());
 perform private.campaign_audit(target_tenant_id,b.id,'permission_attested',jsonb_build_object('declaration_hash',h,'classification',v->>'classification','individually_verified',false));
 return jsonb_build_object('recorded',true,'replay',false,'classification',v->>'classification');
exception when invalid_text_representation then raise exception 'CAMPAIGN_INVALID' using errcode='22023';end;$$;

create function private.campaign_configuration(raw_value text) returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare v jsonb; k text;begin
 v:=private.fse_strict_json(raw_value);
 if not private.fse_keys(v,array['version','name','mode','batch_id','plan_version_id','markets','default_language','starts_at','expires_at','maximum_messages','maximum_per_customer','maximum_per_day','minimum_interval_seconds','follow_up_after_seconds','maximum_model_calls','budget_currency','budget_amount','maximum_liability_per_call','maximum_output_tokens','timezone','window_start','window_end'])
 or not private.fse_strings(v,array['name','mode','batch_id','plan_version_id','default_language','starts_at','expires_at','budget_currency','budget_amount','maximum_liability_per_call','timezone'])
 or v->'version'<>'1'::jsonb or v->>'mode' not in('SYNTHETIC','COMMERCIAL') or char_length(btrim(v->>'name')) not between 1 and 120
 or v->>'default_language'<>'en' or v->>'budget_currency'<>'USD'
 or v->>'budget_amount'!~'^(0|[1-9][0-9]{0,8})\.[0-9]{6}$' or (v->>'budget_amount')::numeric<=0
 or v->>'maximum_liability_per_call'!~'^(0|[1-9][0-9]{0,8})\.[0-9]{6}$' or (v->>'maximum_liability_per_call')::numeric<=0
 or (v->>'maximum_liability_per_call')::numeric>(v->>'budget_amount')::numeric
 or jsonb_typeof(v->'markets') is distinct from 'array' or jsonb_array_length(v->'markets') not between 1 and 100
 or exists(select 1 from jsonb_array_elements(v->'markets') x where jsonb_typeof(x)<>'string' or x#>>'{}'!~'^[A-Z]{2}$' or x#>>'{}'='TR')
 or (select count(*)<>count(distinct x) from jsonb_array_elements(v->'markets') x)
 then raise exception 'CAMPAIGN_INVALID' using errcode='22023';end if;
 foreach k in array array['maximum_messages','maximum_per_customer','maximum_per_day','minimum_interval_seconds','follow_up_after_seconds','maximum_model_calls','maximum_output_tokens','window_start','window_end'] loop
  if jsonb_typeof(v->k)<>'number' or v->>k!~'^[0-9]{1,7}$' then raise exception 'CAMPAIGN_INVALID' using errcode='22023';end if;
 end loop;
 if (v->>'maximum_messages')::int not between 1 and 1000000 or (v->>'maximum_model_calls')::int not between 1 and 1000000
 or (v->>'maximum_per_customer')::int not between 1 and 100 or (v->>'maximum_per_day')::int not between 1 and 50
 or (v->>'minimum_interval_seconds')::int not between 60 and 2592000 or (v->>'follow_up_after_seconds')::int not between 60 and 2592000
 or (v->>'maximum_output_tokens')::int not between 1 and 4096 or (v->>'window_start')::int not between 0 and 23 or (v->>'window_end')::int not between 0 and 23
 or v->>'window_start'=v->>'window_end' or not exists(select 1 from pg_timezone_names where name=v->>'timezone')
 or (v->>'expires_at')::timestamptz<=(v->>'starts_at')::timestamptz
 then raise exception 'CAMPAIGN_INVALID' using errcode='22023';end if;
 perform (v->>'batch_id')::uuid,(v->>'plan_version_id')::uuid;
 return v;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 raise exception 'CAMPAIGN_INVALID' using errcode='22023';end;$$;

create function private.campaign_blockers(t uuid,p uuid) returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare c private.sales_campaigns; d private.campaign_permissions; v public.commercial_versions; i public.commercial_items; b jsonb:='[]';begin
 select * into c from private.sales_campaigns where tenant_id=t and id=p;
 if c.id is null then return '["CAMPAIGN_UNAVAILABLE"]'::jsonb;end if;
 select * into d from private.campaign_permissions where tenant_id=t and batch_id=(c.configuration->>'batch_id')::uuid;
 if d.batch_id is null or not (d.declaration->'markets') @> (c.configuration->'markets') then b:=b||'"PERMISSION_SCOPE_MISSING"'::jsonb;end if;
 if not exists(select 1 from public.import_batches ib where ib.tenant_id=t and ib.id=(c.configuration->>'batch_id')::uuid and ib.status in('completed','review_required')and ib.completed_at is not null
 and exists(select 1 from public.import_rows ir where ir.tenant_id=t and ir.batch_id=ib.id and ir.status='imported'))then b:=b||'"IMPORT_NOT_COMPLETED"'::jsonb;end if;
 select * into v from public.commercial_versions where tenant_id=t and id=(c.configuration->>'plan_version_id')::uuid;
 select * into i from public.commercial_items where tenant_id=t and id=v.item_id;
 if v.id is null or i.kind<>'plan' or v.status<>'published' or i.archived_at is not null or v.effective_from>clock_timestamp()
 or coalesce(v.expires_at,'infinity')<=clock_timestamp() or coalesce(v.superseded_at,'infinity')<=clock_timestamp()
 or not private.valid_commercial_payload('plan',v.payload)
 or (c.configuration->>'mode'='COMMERCIAL' and i.test_only)
 then b:=b||'"PUBLISHED_PLAN_MISSING"'::jsonb;end if;
 if (c.configuration->>'expires_at')::timestamptz<=clock_timestamp() then b:=b||'"CAMPAIGN_WINDOW_EXPIRED"'::jsonb;end if;
 if not exists(select 1 from public.tenants where id=t and status='active')then b:=b||'"TENANT_DISABLED"'::jsonb;end if;
 if not exists(select 1 from public.tenant_members where tenant_id=t and user_id=c.owner_id and role='super_admin'and status='active')then b:=b||'"CAMPAIGN_OWNER_REVOKED"'::jsonb;end if;
 if c.configuration->>'mode'='SYNTHETIC' and not exists(select 1 from public.tenants where id=t and slug like 'polat-sandbox-%' and not outbound_messaging_enabled)then b:=b||'"ISOLATED_FIXTURE_REQUIRED"'::jsonb;end if;
 return b;
end;$$;

create function private.campaign_contact_reason(t uuid,p uuid,cid uuid,exclude_job uuid default null) returns text language plpgsql stable set search_path=pg_catalog as $$
declare a private.campaign_audience; c private.sales_campaigns; cv public.conversations; mc public.messaging_contacts; d private.campaign_permissions;begin
 select * into c from private.sales_campaigns where tenant_id=t and id=p;
 select * into a from private.campaign_audience where tenant_id=t and campaign_id=p and customer_id=cid;
 if c.id is null or a.customer_id is null then return 'AUDIENCE_UNAVAILABLE';end if;
 select * into d from private.campaign_permissions where tenant_id=t and batch_id=(c.configuration->>'batch_id')::uuid;
 if d.batch_id is null then return 'PERMISSION_SCOPE_MISSING';end if;
 if exists(select 1 from private.campaign_jobs x join public.scheduled_jobs j on j.id=x.job_id where x.tenant_id=t and x.customer_id=cid and x.job_id is distinct from exclude_job
 and(j.status='processing'or j.status='dead_letter'and j.last_error_code='DELIVERY_UNKNOWN'))then return 'DELIVERY_REVIEW_REQUIRED';end if;
 if a.market is null or not(c.configuration->'markets')?a.market then return 'MARKET_UNKNOWN_OR_EXCLUDED';end if;
 if exists(select 1 from private.campaign_suppressions where tenant_id=t and customer_id=cid)
 or exists(select 1 from public.customer_success_contact_policies where tenant_id=t and customer_id=cid and (opted_out or consent='DENIED'))
 or exists(select 1 from private.polat_contact_evidence e join public.conversations x on x.tenant_id=e.tenant_id and x.id=e.conversation_id where e.tenant_id=t and x.customer_id=cid and e.kind in('OPT_OUT_RECORDED','CONTACT_SUPPRESSED','MARKETING_REVOKED'))
 then return 'CONTACT_SUPPRESSED';end if;
 select * into cv from public.conversations where tenant_id=t and customer_id=cid and status='open' order by last_message_at desc nulls last,id limit 1;
 select * into mc from public.messaging_contacts where tenant_id=t and id=cv.messaging_contact_id and customer_id=cid;
 if cv.id is null or mc.id is null or mc.contactability not in('user_initiated','allowed') or mc.provider_user_id!~'^[1-9][0-9]{0,18}$'
 or mc.provider_chat_id is distinct from mc.provider_user_id
 or not exists(select 1 from public.customer_identities ci where ci.tenant_id=t and ci.customer_id=cid and ci.identity_type='telegram_user_id' and ci.normalized_value=mc.provider_user_id)
 or not exists(select 1 from public.messaging_provider_connections where tenant_id=t and id=cv.provider_connection_id and status='active')
 then return 'PLATFORM_ROUTE_UNAVAILABLE';end if;
 -- BOT cannot initiate contact. Business routes still require an active, observed platform reply window.
 if mc.last_inbound_at is null or (d.declaration->>'channel'='TELEGRAM_BUSINESS' and mc.last_inbound_at<clock_timestamp()-interval '24 hours')
 then return 'PLATFORM_ROUTE_UNAVAILABLE';end if;
 if cv.human_takeover or cv.runtime_mode<>'AI_ACTIVE' or exists(select 1 from public.customers where tenant_id=t and id=cid and automation_paused)
 or exists(select 1 from public.escalation_cases where tenant_id=t and customer_id=cid and status<>'RESOLVED')then return 'HUMAN_OWNERSHIP';end if;
 return null;
end;$$;

create function public.admin_campaign_save_v1(target_tenant_id uuid,campaign_id_value uuid,configuration_value text,expected_revision integer default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v jsonb;c private.sales_campaigns;d private.campaign_permissions;b public.import_batches;begin
 perform private.campaign_admin(target_tenant_id,true,true);v:=private.campaign_configuration(configuration_value);
 perform pg_advisory_xact_lock(hashtextextended('campaign-config:'||target_tenant_id::text,0));
 select * into b from public.import_batches where tenant_id=target_tenant_id and id=(v->>'batch_id')::uuid;
 select * into d from private.campaign_permissions where tenant_id=target_tenant_id and batch_id=b.id;
 if campaign_id_value is null or b.id is null or d.batch_id is null or not(d.declaration->'markets')@>(v->'markets')then raise exception 'CAMPAIGN_UNAVAILABLE' using errcode='42501';end if;
 select * into c from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 if c.id is not null and(c.state not in('CONFIGURING','READY')or c.revision is distinct from expected_revision)then raise exception 'CAMPAIGN_CHANGED' using errcode='40001';end if;
 if c.id is null and expected_revision<>0 then raise exception 'CAMPAIGN_CHANGED' using errcode='40001';end if;
 insert into private.sales_campaigns(tenant_id,id,configuration,owner_id)values(target_tenant_id,campaign_id_value,v,auth.uid())
 on conflict(tenant_id,id)do update set configuration=excluded.configuration,revision=private.sales_campaigns.revision+1;
 delete from private.campaign_audience where tenant_id=target_tenant_id and campaign_id=campaign_id_value;
 insert into private.campaign_audience(tenant_id,campaign_id,customer_id,market,language)
 select target_tenant_id,campaign_id_value,q.imported_customer_id,q.normalized_payload#>>'{contact,market}',coalesce(q.normalized_payload#>>'{contact,language}','en')
 from(select distinct on(imported_customer_id) imported_customer_id,normalized_payload from public.import_rows
 where tenant_id=target_tenant_id and batch_id=b.id and status='imported' and imported_customer_id is not null order by imported_customer_id,row_number)q;
 update private.sales_campaigns set state=case when private.campaign_blockers(target_tenant_id,campaign_id_value)='[]'::jsonb then 'READY' else 'CONFIGURING' end
 where tenant_id=target_tenant_id and id=campaign_id_value returning * into c;
 perform private.campaign_audit(target_tenant_id,c.id,'configured',jsonb_build_object('revision',c.revision,'state',c.state,'financial_authority','NONE'));
 return jsonb_build_object('id',c.id,'state',c.state,'revision',c.revision);
end;$$;

create function public.admin_campaign_state_v1(target_tenant_id uuid,campaign_id_value uuid,expected_revision integer,action_value text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.sales_campaigns;next_state text;begin
 perform private.campaign_admin(target_tenant_id,true,action_value='START');
 perform pg_advisory_xact_lock(hashtextextended('campaign-config:'||target_tenant_id::text,0));
 select * into c from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 if c.id is null then raise exception 'CAMPAIGN_UNAVAILABLE' using errcode='42501';end if;
 if c.revision is distinct from expected_revision then raise exception 'CAMPAIGN_CHANGED' using errcode='40001';end if;
 if action_value='START' and c.state in('CONFIGURING','READY','PAUSED')then
  if private.campaign_blockers(target_tenant_id,c.id)<>'[]'::jsonb then raise exception 'CAMPAIGN_NOT_READY' using errcode='55000';end if;
  if exists(select 1 from private.campaign_audience a join private.campaign_audience b on b.tenant_id=a.tenant_id and b.customer_id=a.customer_id
   join private.sales_campaigns z on z.tenant_id=b.tenant_id and z.id=b.campaign_id
   where a.tenant_id=target_tenant_id and a.campaign_id=c.id and b.campaign_id<>c.id and z.state='ACTIVE')then raise exception 'CAMPAIGN_AUDIENCE_ALREADY_ACTIVE' using errcode='55000';end if;
  next_state:='ACTIVE';
 elsif action_value='PAUSE' and c.state='ACTIVE'then next_state:='PAUSED';
 elsif action_value='STOP' and c.state<>'STOPPED'then next_state:='STOPPED';
 else raise exception 'CAMPAIGN_STATE_INVALID' using errcode='22023';end if;
 update private.sales_campaigns set state=next_state,revision=revision+1,
 activated_at=case when next_state='ACTIVE'then clock_timestamp()else activated_at end where tenant_id=target_tenant_id and id=c.id returning * into c;
 if next_state='ACTIVE'then
  -- One founder activation includes unowned default conversations, never actual human ownership.
  update public.conversations cv set automatic_replies_enabled=true,automatic_replies_enabled_at=c.activated_at,
   runtime_mode='AI_ACTIVE',human_takeover=false
  where cv.tenant_id=target_tenant_id and cv.status='open'
  and exists(select 1 from private.campaign_audience a where a.tenant_id=cv.tenant_id and a.campaign_id=c.id and a.customer_id=cv.customer_id)
  and not exists(select 1 from public.customers where tenant_id=cv.tenant_id and id=cv.customer_id and automation_paused)
  and not exists(select 1 from public.escalation_cases where tenant_id=cv.tenant_id and conversation_id=cv.id and status<>'RESOLVED')
  and(cv.runtime_mode='AI_ACTIVE'and not cv.human_takeover or cv.runtime_mode='HUMAN_TAKEOVER'
   and not exists(select 1 from public.audit_logs where tenant_id=cv.tenant_id and entity_id=cv.id::text and action='conversation.runtime_mode_changed')
   and not exists(select 1 from public.messages where tenant_id=cv.tenant_id and conversation_id=cv.id and direction='outbound'and actor_type='HUMAN'));
 end if;
 -- Prepared jobs from an older activation cannot become fresh after resume.
 update public.scheduled_jobs j set status='cancelled',last_error_code='CAMPAIGN_GENERATION_CHANGED'
 from private.campaign_jobs x where x.tenant_id=target_tenant_id and x.campaign_id=c.id and j.id=x.job_id and j.status='scheduled';
 perform private.campaign_audit(target_tenant_id,c.id,'state_changed',jsonb_build_object('state',c.state,'revision',c.revision,'routine_message_review',false,'financial_authority','NONE'));
 return jsonb_build_object('id',c.id,'state',c.state,'revision',c.revision);
end;$$;

-- Preserve source-bound opt-out evidence. A batch declaration cannot undo it.
create function private.campaign_inbound_suppression() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if new.direction='inbound' and new.customer_id is not null and private.polat_contact_optout_requested(new.content)
 and exists(select 1 from private.campaign_audience where tenant_id=new.tenant_id and customer_id=new.customer_id)then
  insert into private.campaign_suppressions(tenant_id,customer_id,source_message_id,reason) values(new.tenant_id,new.customer_id,new.id,'CUSTOMER_OPT_OUT')on conflict do nothing;
  perform private.campaign_audit(new.tenant_id,new.customer_id,'opt_out_recorded',jsonb_build_object('reason','CUSTOMER_OPT_OUT','raw_content_redacted',true));
 end if;return new;
end;$$;
create trigger campaign_inbound_optout after insert on public.messages for each row execute function private.campaign_inbound_suppression();

-- Auto-approve only an immutable configured plan, at its exact existing snapshot price.
-- Outside ACTIVE campaign scope the accepted manual offer path remains unchanged.
create function private.campaign_offer_preapproval() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare c private.sales_campaigns;v public.commercial_versions;ctx jsonb;p jsonb;pv jsonb;lead jsonb;k text;expected text;begin
 select x.* into c from private.sales_campaigns x join private.campaign_audience a on a.tenant_id=x.tenant_id and a.campaign_id=x.id
 where x.tenant_id=new.tenant_id and a.customer_id=new.customer_id and x.state='ACTIVE' and x.configuration->>'mode'='COMMERCIAL'
 and x.configuration->>'plan_version_id'=new.plan_version_id::text;
 if c.id is null then return new;end if;
 select * into v from public.commercial_versions where tenant_id=new.tenant_id and id=new.plan_version_id;
 ctx:=private.commercial_for_source(new.tenant_id,new.source_event_id);
 select value into p from jsonb_array_elements(ctx->'documents') where value->>'version_id'=new.plan_version_id::text and value->>'kind'='plan';
 select value into pv from jsonb_array_elements(ctx->'documents') where value->>'version_id'=new.product_version_id::text and value->>'kind'='product'and value->>'item_id'=p->'payload'->>'product_id';
 if private.campaign_blockers(c.tenant_id,c.id)<>'[]'::jsonb or private.campaign_contact_reason(c.tenant_id,c.id,new.customer_id)is not null
 or p is null or pv is null or ctx->>'conflict'='true'
 or not exists(select 1 from public.domain_events e join public.messages m on m.tenant_id=e.tenant_id and m.id::text=e.payload->>'message_id'where e.tenant_id=new.tenant_id and e.id=new.source_event_id and m.conversation_id=new.conversation_id and m.customer_id=new.customer_id and m.created_at>=c.activated_at)
 or new.snapshot is distinct from jsonb_build_object('plan',p,'product',pv,'delivery','none','follow_up',jsonb_build_object('action','WAIT','delivery','none'),'payment_created',false,'access_granted',false)
 or new.discount_bps<>0 or new.currency is distinct from v.payload->>'currency' or new.amount is distinct from(v.payload->>'amount')::numeric
 or new.expires_at<=clock_timestamp()or new.expires_at>least(coalesce(v.expires_at,'infinity'),clock_timestamp()+make_interval(hours=>(v.payload->>'offer_valid_hours')::int))then return new;end if;
 lead:=public.phase8_qualification_for_source(new.tenant_id,new.source_event_id);
 foreach k in array array['instrument','actively_trades','experience_level']loop
  expected:=v.payload->'eligibility'->>k;
  if expected is not null and not exists(select 1 from jsonb_array_elements(lead->'fields') f where f->>'key'=case k when 'instrument'then 'primary_instrument'else k end
  and f->>'classification'in('explicit','verified_system')and lower(f->>'value')=lower(case when k='actively_trades'then case expected when 'true'then 'yes'else 'no'end else expected end))then return new;end if;
 end loop;
 new.status:='approved';new.reviewer:=null;new.reviewed_at:=clock_timestamp();
 perform private.campaign_audit(c.tenant_id,c.id,'offer_preapproved',jsonb_build_object('offer_id',new.id,'plan_version_id',new.plan_version_id,'human_per_offer_review',false,'activation_revision',c.revision,'payment_verified',false));
 return new;
end;$$;
create trigger campaign_offer_preapproval before insert on public.commercial_offers for each row execute function private.campaign_offer_preapproval();

-- Reuse the accepted identity/profile/memory importer behind the new batch authority.
create or replace function private.commit_campaign_import_resolved(target_batch_id uuid, approval_phrase text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  batch_value record;
  row_value record;
  identity_record jsonb;
  memory_value jsonb;
  target_customer_id uuid;
  observed_customers uuid[];
  imported_count integer := 0;
  created_count integer := 0;
  linked_count integer := 0;
begin
  if approval_phrase <> 'IMPORT_APPROVED' then
    raise exception 'explicit import approval is required' using errcode = '42501';
  end if;
  select * into strict batch_value from public.import_batches where id = target_batch_id for update;
  if auth.uid() is null or not private.has_tenant_role(batch_value.tenant_id, array['super_admin']::public.app_role[]) then
    raise exception 'only a super_admin can commit an import' using errcode = '42501';
  end if;
  if batch_value.status not in ('dry_run_ready', 'review_required', 'approved') then
    raise exception 'batch is not commit-ready' using errcode = '22023';
  end if;
  -- Unresolved identities remain visible for exception review; known rows need no row approval.

  update public.import_batches set status = 'importing' where id = target_batch_id;
  for row_value in
    select * from public.import_rows
    where batch_id = target_batch_id and status not in ('rejected', 'imported', 'skipped')
      and (classification in ('new_customer','exact_match') or review_status='approved')
      and validation_error_count=0
    order by row_number
  loop
    -- Re-derive every match after preceding rows commit inside this same transaction.
    -- A caller-supplied candidate/hash is lineage, never identity authority.
    select array_agg(distinct ci.customer_id) into observed_customers from public.customer_identities ci
    join jsonb_array_elements(row_value.normalized_payload->'identities') ident(value)
    on ci.identity_type=ident.value->>'identity_type'and ci.identity_scope=coalesce(ident.value->>'identity_scope','global')and ci.normalized_value=ident.value->>'normalized_value'
    where ci.tenant_id=batch_value.tenant_id;
    if coalesce(cardinality(observed_customers),0)>1 or row_value.classification='exact_match'and coalesce(cardinality(observed_customers),0)=0 then
      update public.import_rows set classification='ambiguous',status='review_required',review_status='pending',resolution=null,candidate_customer_id=null where id=row_value.id;
      continue;
    elsif cardinality(observed_customers)=1 then
      target_customer_id:=observed_customers[1];linked_count:=linked_count+1;
    elsif row_value.resolution = 'exact_match' and row_value.review_status='approved' then
      target_customer_id := row_value.candidate_customer_id;
      if target_customer_id is null or not exists (
        select 1 from public.customers where id = target_customer_id and tenant_id = batch_value.tenant_id
      ) then
        raise exception 'exact match row has no valid tenant or batch candidate' using errcode = '42501';
      end if;
      linked_count := linked_count + 1;
    else
      insert into public.customers (tenant_id, external_ref, display_name, source_type, source_name, source_record_ref)
      values (batch_value.tenant_id, nullif(row_value.normalized_payload ->> 'external_id', ''), nullif(row_value.normalized_payload ->> 'display_name', ''), batch_value.source_type, batch_value.source_name, row_value.source_record_ref)
      returning id into target_customer_id;
      created_count := created_count + 1;
    end if;

    for identity_record in select value from jsonb_array_elements(coalesce(row_value.normalized_payload -> 'identities', '[]'::jsonb)) loop
      if exists (
        select 1 from public.customer_identities as ci
        where ci.tenant_id = batch_value.tenant_id
          and ci.identity_type = identity_record ->> 'identity_type'
          and ci.identity_scope = coalesce(identity_record ->> 'identity_scope', 'global')
          and ci.normalized_value = identity_record ->> 'normalized_value'
          and ci.customer_id <> target_customer_id
      ) then
        raise exception 'identity conflict detected during import' using errcode = '23505';
      end if;
      insert into public.customer_identities (tenant_id, customer_id, identity_type, identity_value, normalized_value, identity_scope, is_primary, source_type, source_name, source_record_ref)
      values (batch_value.tenant_id, target_customer_id, identity_record ->> 'identity_type', identity_record ->> 'identity_value', identity_record ->> 'normalized_value', coalesce(identity_record ->> 'identity_scope', 'global'), coalesce((identity_record ->> 'is_primary')::boolean, false), batch_value.source_type, batch_value.source_name, row_value.source_record_ref)
      on conflict (tenant_id, identity_type, identity_scope, normalized_value) do nothing;
    end loop;

    insert into public.customer_profiles (tenant_id, customer_id, experience_level, primary_instrument, trading_style, risk_preference, preferred_signal_frequency, previous_service_experience, pain_points, objections, communication_style, preferred_message_length, price_sensitivity, trust_level, churn_reason, last_conversation_summary, next_best_action, retention_risk)
    values (
      batch_value.tenant_id, target_customer_id,
      row_value.normalized_payload #>> '{profile,experience_level}', row_value.normalized_payload #>> '{profile,primary_instrument}', row_value.normalized_payload #>> '{profile,trading_style}', row_value.normalized_payload #>> '{profile,risk_preference}', row_value.normalized_payload #>> '{profile,preferred_signal_frequency}',
      coalesce(row_value.normalized_payload #> '{profile,previous_service_experience}', '{}'::jsonb), coalesce(row_value.normalized_payload #> '{profile,pain_points}', '[]'::jsonb), coalesce(row_value.normalized_payload #> '{profile,objections}', '[]'::jsonb),
      row_value.normalized_payload #>> '{profile,communication_style}', row_value.normalized_payload #>> '{profile,preferred_message_length}', row_value.normalized_payload #>> '{profile,price_sensitivity}', row_value.normalized_payload #>> '{profile,trust_level}', row_value.normalized_payload #>> '{profile,churn_reason}', row_value.normalized_payload #>> '{profile,last_conversation_summary}', row_value.normalized_payload #>> '{profile,next_best_action}', row_value.normalized_payload #>> '{profile,retention_risk}'
    )
    on conflict (customer_id) do update set
      experience_level = coalesce(excluded.experience_level, public.customer_profiles.experience_level),
      primary_instrument = coalesce(excluded.primary_instrument, public.customer_profiles.primary_instrument),
      trading_style = coalesce(excluded.trading_style, public.customer_profiles.trading_style),
      risk_preference = coalesce(excluded.risk_preference, public.customer_profiles.risk_preference),
      preferred_signal_frequency = coalesce(excluded.preferred_signal_frequency, public.customer_profiles.preferred_signal_frequency),
      communication_style = coalesce(excluded.communication_style, public.customer_profiles.communication_style),
      preferred_message_length = coalesce(excluded.preferred_message_length, public.customer_profiles.preferred_message_length),
      price_sensitivity = coalesce(excluded.price_sensitivity, public.customer_profiles.price_sensitivity),
      trust_level = coalesce(excluded.trust_level, public.customer_profiles.trust_level),
      churn_reason = coalesce(excluded.churn_reason, public.customer_profiles.churn_reason),
      last_conversation_summary = coalesce(excluded.last_conversation_summary, public.customer_profiles.last_conversation_summary),
      next_best_action = coalesce(excluded.next_best_action, public.customer_profiles.next_best_action),
      retention_risk = coalesce(excluded.retention_risk, public.customer_profiles.retention_risk),
      updated_at = now();

    for memory_value in select value from jsonb_array_elements(coalesce(row_value.normalized_payload -> 'memory', '[]'::jsonb)) loop
      insert into public.customer_memory (tenant_id, customer_id, memory_key, memory_value, source_type, source_id, source_name, source_record_ref, confidence)
      values (batch_value.tenant_id, target_customer_id, memory_value ->> 'key', memory_value -> 'value', 'import', target_batch_id::text, batch_value.source_name, row_value.source_record_ref, least(greatest(coalesce((memory_value ->> 'confidence')::numeric, 0.8), 0), 1));
    end loop;
    update public.import_rows set status = 'imported', imported_customer_id = target_customer_id where id = row_value.id;
    imported_count := imported_count + 1;
  end loop;
  update public.import_batches set status=case when exists(select 1 from public.import_rows where batch_id=target_batch_id and status='review_required')then 'review_required'else 'completed'end,completed_at=now() where id=target_batch_id;
  return jsonb_build_object('status', 'completed', 'imported_count', imported_count, 'created_count', created_count, 'linked_count', linked_count);
end;
$$;

create function public.admin_campaign_commit_batch_v1(target_tenant_id uuid,batch_id_value uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b public.import_batches; r public.import_rows; ids uuid[]; result_value jsonb; x jsonb;begin
 perform private.campaign_admin(target_tenant_id,true,true);
 perform pg_advisory_xact_lock(hashtextextended('campaign-import:'||target_tenant_id::text,0));
 select * into b from public.import_batches where tenant_id=target_tenant_id and id=batch_id_value for update;
 if b.id is null or not exists(select 1 from private.campaign_permissions where tenant_id=target_tenant_id and batch_id=b.id and declaration->>'dataset_hash'=b.file_sha256)
 then raise exception 'IMPORT_EXECUTION_LOCKED' using errcode='42501';end if;
 if b.status='completed'then result_value:=jsonb_build_object('replay',true);
 else
  if b.status not in('dry_run_ready','review_required','approved')then raise exception 'CAMPAIGN_IMPORT_NOT_READY' using errcode='55000';end if;
  -- Reconcile against CURRENT identities under a tenant-wide import lock; dry-run IDs are not authority.
  for r in select * from public.import_rows where tenant_id=target_tenant_id and batch_id=b.id and status not in('imported','rejected','skipped')order by row_number for update loop
   if r.validation_error_count>0 then continue;end if;
   if jsonb_typeof(r.normalized_payload->'identities')is distinct from 'array' or jsonb_array_length(r.normalized_payload->'identities')>5
   or jsonb_typeof(r.normalized_payload->'memory')is distinct from 'array' or jsonb_array_length(r.normalized_payload->'memory')>16
   then raise exception 'CAMPAIGN_IMPORT_INVALID' using errcode='22023';end if;
   if jsonb_array_length(r.normalized_payload->'identities')=0 then
    update public.import_rows set classification='ambiguous',status='review_required',review_status='pending',resolution=null,candidate_customer_id=null where id=r.id;
    continue;
   end if;
   for x in select value from jsonb_array_elements(r.normalized_payload->'identities')loop
    if jsonb_typeof(x)<>'object' or x->>'identity_type' not in('email','telegram_username','telegram_user_id','external_id','phone')
    or jsonb_typeof(x->'normalized_value')is distinct from 'string' or char_length(x->>'normalized_value')not between 1 and 320
    or jsonb_typeof(x->'identity_value')is distinct from 'string' or char_length(x->>'identity_value')not between 1 and 320
    or(x->>'identity_type'='telegram_user_id'and x->>'normalized_value'!~'^[1-9][0-9]{0,18}$')
    or(x->>'identity_type'='phone'and x->>'normalized_value'!~'^\+[1-9][0-9]{7,14}$')
    then raise exception 'CAMPAIGN_IMPORT_INVALID' using errcode='22023';end if;
   end loop;
   if(r.normalized_payload#>>'{contact,market}')is not null and r.normalized_payload#>>'{contact,market}'!~'^[A-Z]{2}$'
   or coalesce(r.normalized_payload#>>'{contact,language}','en')not in('en','tr','ar','ru')then raise exception 'CAMPAIGN_IMPORT_INVALID' using errcode='22023';end if;
   select array_agg(distinct ci.customer_id)into ids from public.customer_identities ci join jsonb_array_elements(r.normalized_payload->'identities') as ident(value)
   on ci.identity_type=ident.value->>'identity_type'and ci.identity_scope=coalesce(ident.value->>'identity_scope','global')and ci.normalized_value=ident.value->>'normalized_value' where ci.tenant_id=target_tenant_id;
   if coalesce(cardinality(ids),0)>1 then
    update public.import_rows set classification='ambiguous',status='review_required',review_status='pending',resolution=null,candidate_customer_id=null where id=r.id;
   elsif cardinality(ids)=1 then
    update public.import_rows set classification='exact_match',resolution='exact_match',candidate_customer_id=ids[1],review_status='approved',status='planned'where id=r.id;
   end if;
  end loop;
  result_value:=private.commit_campaign_import_resolved(b.id,'IMPORT_APPROVED');
  perform private.campaign_audit(target_tenant_id,b.id,'batch_imported',jsonb_build_object('raw_records_redacted',true,'created',result_value->'created_count','linked',result_value->'linked_count','permission','OWNER_ATTESTED_EXISTING_PERMISSION'));
 end if;
 return result_value||jsonb_build_object('batch_id',b.id,'status',(select status from public.import_batches where tenant_id=target_tenant_id and id=b.id),'classification','OWNER_ATTESTED_EXISTING_PERMISSION',
 'imported_rows',(select count(*)from public.import_rows where tenant_id=target_tenant_id and batch_id=b.id and status='imported'),
 'unique_customers',(select count(distinct imported_customer_id)from public.import_rows where tenant_id=target_tenant_id and batch_id=b.id and status='imported'),
 'pending_identity_review',(select count(*)from public.import_rows where tenant_id=target_tenant_id and batch_id=b.id and status='review_required'),
 'rejected_rows',(select count(*)from public.import_rows where tenant_id=target_tenant_id and batch_id=b.id and status='rejected'),
 'messages_sent',0,'financial_authority','NONE');
end;$$;

-- A scheduling cycle is bounded and uses the existing PostgreSQL queue. No external effect here.
create function public.campaign_schedule_v1(target_tenant_id uuid,campaign_id_value uuid,limit_value integer default 25)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.sales_campaigns;a private.campaign_audience;cv public.conversations;m public.messages;jid uuid;n integer:=0;scanned integer:=0;begin
 if limit_value is null or limit_value not between 1 and 100 then raise exception 'CAMPAIGN_INVALID' using errcode='22023';end if;
 select * into c from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 if c.id is null then raise exception 'CAMPAIGN_UNAVAILABLE' using errcode='42501';end if;
 if c.state<>'ACTIVE' or private.campaign_blockers(target_tenant_id,c.id)<>'[]'::jsonb or (c.configuration->>'starts_at')::timestamptz>clock_timestamp()
 then return jsonb_build_object('scheduled',0,'state',c.state);end if;
 for a in select * from private.campaign_audience aa where aa.tenant_id=target_tenant_id and aa.campaign_id=c.id
 and not exists(select 1 from private.campaign_jobs x join public.scheduled_jobs j on j.id=x.job_id where x.tenant_id=aa.tenant_id and x.campaign_id=aa.campaign_id and x.customer_id=aa.customer_id
 and(j.status in('scheduled','processing','dead_letter')or j.completed_at>clock_timestamp()-make_interval(secs=>(c.configuration->>'follow_up_after_seconds')::integer)))
 and(select count(*)from private.campaign_jobs x join public.scheduled_jobs j on j.id=x.job_id where x.tenant_id=aa.tenant_id and x.campaign_id=aa.campaign_id and x.customer_id=aa.customer_id and j.attempts>0)<(c.configuration->>'maximum_per_customer')::int
 and private.campaign_contact_reason(target_tenant_id,c.id,aa.customer_id)is null
 order by aa.customer_id limit limit_value loop
  scanned:=scanned+1;if private.campaign_contact_reason(target_tenant_id,c.id,a.customer_id)is not null then continue;end if;
  select * into cv from public.conversations where tenant_id=target_tenant_id and customer_id=a.customer_id and status='open'order by last_message_at desc nulls last,id limit 1;
  select * into m from public.messages where tenant_id=target_tenant_id and conversation_id=cv.id and direction='inbound'
  and(c.configuration->>'mode'<>'SYNTHETIC'or id=(select last_inbound_id from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=cv.id))
  order by created_at desc,id desc limit 1;
  if m.id is null then continue;end if;
  jid:=extensions.gen_random_uuid();
  insert into public.scheduled_jobs(id,tenant_id,customer_id,job_type,payload,idempotency_key,correlation_id,scheduled_at,max_attempts)
  values(jid,target_tenant_id,a.customer_id,'campaign.sales_reply',jsonb_build_object('campaign_id',c.id,'revision',c.revision,'scope',c.configuration->>'mode'),
  'campaign:'||c.id::text||':'||a.customer_id::text||':'||c.revision::text||':'||(select count(*)from private.campaign_jobs where tenant_id=target_tenant_id and campaign_id=c.id and customer_id=a.customer_id)::text,
  extensions.gen_random_uuid(),clock_timestamp(),1);
  insert into private.campaign_jobs(tenant_id,job_id,campaign_id,customer_id,conversation_id,source_message_id,campaign_revision,source_hash)
  values(target_tenant_id,jid,c.id,a.customer_id,cv.id,m.id,c.revision,private.fse_hash(m.content));n:=n+1;
 end loop;
 perform private.campaign_audit(target_tenant_id,c.id,'scheduled',jsonb_build_object('scheduled',n,'scanned',scanned,'human_per_message_review',false));
 return jsonb_build_object('scheduled',n,'scanned',scanned,'state',c.state);
end;$$;

create function private.campaign_fixture(t uuid,p uuid)returns private.sales_campaigns language plpgsql stable set search_path=pg_catalog as $$
declare c private.sales_campaigns;begin
 select * into c from private.sales_campaigns where tenant_id=t and id=p;
 if c.id is null or c.configuration->>'mode'<>'SYNTHETIC' or not exists(select 1 from public.tenants where id=t and slug like 'polat-sandbox-%'and status='active'and not outbound_messaging_enabled)
 then raise exception 'CAMPAIGN_GENUINE_EXECUTOR_UNAVAILABLE' using errcode='42501';end if;
 return c;
end;$$;

create function public.campaign_claim_fixture_v1(target_tenant_id uuid,campaign_id_value uuid,worker_id_value text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.sales_campaigns;x private.campaign_jobs;j public.scheduled_jobs;token uuid;hour_value int;begin
 perform private.campaign_fixture(target_tenant_id,campaign_id_value);
 if worker_id_value is null or worker_id_value!~'^[A-Za-z0-9_-]{1,80}$'then raise exception 'CAMPAIGN_INVALID' using errcode='22023';end if;
 select * into c from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 -- Unknown completion survives restart; no lease reclaim or free request-budget reset.
 update public.scheduled_jobs q set status='dead_letter',last_error_code='DELIVERY_UNKNOWN',dead_lettered_at=clock_timestamp()
 from private.campaign_jobs z where z.tenant_id=target_tenant_id and z.campaign_id=c.id and z.job_id=q.id and q.status='processing'and q.locked_at<clock_timestamp()-interval '60 seconds';
 if found then
  update private.sales_campaigns set state='PAUSED',revision=revision+1 where tenant_id=target_tenant_id and id=c.id;
  perform private.campaign_audit(target_tenant_id,c.id,'lease_unknown',jsonb_build_object('automatic_retry',false));
  return jsonb_build_object('state','DELIVERY_UNKNOWN');
 end if;
 if c.state<>'ACTIVE' or private.campaign_blockers(target_tenant_id,c.id)<>'[]'::jsonb or(c.configuration->>'starts_at')::timestamptz>clock_timestamp()then return jsonb_build_object('state','HELD');end if;
 if c.attempts>=(c.configuration->>'maximum_model_calls')::int or c.attempts>=(c.configuration->>'maximum_messages')::int
 or c.reserved_liability+(c.configuration->>'maximum_liability_per_call')::numeric>(c.configuration->>'budget_amount')::numeric then
  update private.sales_campaigns set state='PAUSED',revision=revision+1 where tenant_id=target_tenant_id and id=c.id;
  perform private.campaign_audit(target_tenant_id,c.id,'budget_exhausted',jsonb_build_object('actual_cost','UNKNOWN'));
  return jsonb_build_object('state','BUDGET_EXHAUSTED');
 end if;
 hour_value:=extract(hour from clock_timestamp()at time zone(c.configuration->>'timezone'));
 if not(case when(c.configuration->>'window_start')::int<(c.configuration->>'window_end')::int then hour_value>=(c.configuration->>'window_start')::int and hour_value<(c.configuration->>'window_end')::int
 else hour_value>=(c.configuration->>'window_start')::int or hour_value<(c.configuration->>'window_end')::int end)then return jsonb_build_object('state','CONTACT_WINDOW');end if;
 -- At most 100 stale/unsafe intents drained per cycle; valid later work is retained.
 for x in select z.* from private.campaign_jobs z join public.scheduled_jobs q on q.id=z.job_id
 where z.tenant_id=target_tenant_id and z.campaign_id=c.id and q.status='scheduled'and q.scheduled_at<=clock_timestamp()
 order by q.scheduled_at,q.id limit 100 for update of q skip locked loop
  select * into j from public.scheduled_jobs where id=x.job_id;
  if x.campaign_revision<>c.revision or private.campaign_contact_reason(target_tenant_id,c.id,x.customer_id)is not null then
   update public.scheduled_jobs set status='cancelled',last_error_code='CAMPAIGN_CONTACT_OR_GENERATION_CHANGED'where id=j.id;
   perform private.campaign_audit(target_tenant_id,c.id,'intent_held',jsonb_build_object('job_id',j.id));continue;
  end if;
  if exists(select 1 from private.campaign_jobs z join public.scheduled_jobs q on q.id=z.job_id where z.tenant_id=target_tenant_id and z.campaign_id=c.id and z.customer_id=x.customer_id
   and q.id<>j.id and(q.status='processing' or q.attempts>0 and q.locked_at>clock_timestamp()-make_interval(secs=>(c.configuration->>'minimum_interval_seconds')::int)))then continue;end if;
  if(select count(*)from private.campaign_jobs z join public.scheduled_jobs q on q.id=z.job_id where z.tenant_id=target_tenant_id and z.customer_id=x.customer_id and q.attempts>0 and q.locked_at>clock_timestamp()-interval '24 hours')>=(c.configuration->>'maximum_per_day')::int then continue;end if;
  token:=extensions.gen_random_uuid();
  update public.scheduled_jobs set status='processing',attempts=attempts+1,locked_by=worker_id_value,locked_at=clock_timestamp(),payload=payload||jsonb_build_object('stage','RESERVED')where id=j.id;
  update private.campaign_jobs set lease_token=token,native_generation=(select generation from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=x.conversation_id)where tenant_id=target_tenant_id and job_id=j.id;
  update private.sales_campaigns set attempts=attempts+1,reserved_liability=reserved_liability+(configuration->>'maximum_liability_per_call')::numeric where tenant_id=target_tenant_id and id=c.id;
  perform private.campaign_audit(target_tenant_id,c.id,'attempt_reserved',jsonb_build_object('job_id',j.id,'actual_cost','UNKNOWN','scope','SYNTHETIC'));
  return jsonb_build_object('state','RESERVED','job_id',j.id,'lease_token',token,'conversation_id',x.conversation_id,'source_message_id',x.source_message_id,'source_hash',x.source_hash,'generation',c.revision::text);
 end loop;
 return jsonb_build_object('state','EMPTY');
end;$$;

create function public.campaign_prepare_fixture_v1(target_tenant_id uuid,job_id_value uuid,lease_token_value uuid,body_hash_value text,body_value text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x private.campaign_jobs;j public.scheduled_jobs;g bigint;native_value jsonb;begin
 select * into x from private.campaign_jobs where tenant_id=target_tenant_id and job_id=job_id_value;
 perform private.campaign_fixture(target_tenant_id,x.campaign_id);
 perform 1 from private.sales_campaigns where tenant_id=target_tenant_id and id=x.campaign_id for share;
 perform 1 from public.conversations where tenant_id=target_tenant_id and id=x.conversation_id for update;
 select * into j from public.scheduled_jobs where id=x.job_id for update;
 if j.status<>'processing'or x.lease_token is distinct from lease_token_value or j.locked_at<clock_timestamp()-interval '60 seconds' or body_hash_value is null or body_hash_value!~'^[a-f0-9]{64}$'
 or body_value is not null and(char_length(body_value)not between 1 and 600 or private.fse_hash(body_value)<>body_hash_value)
 or x.body_hash is not null and x.body_hash<>body_hash_value then raise exception 'CAMPAIGN_LEASE_INVALID'using errcode='42501';end if;
 select generation into g from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=x.conversation_id;
 if x.native_generation is distinct from g then return jsonb_build_object('state','HUMAN_HANDOFF_PENDING','reason','CAMPAIGN_SOURCE_CHANGED');end if;
 native_value:=private.polat_prepare_fixture(target_tenant_id,x.source_message_id,x.job_id,g,x.source_hash,body_hash_value,'AI');
 if native_value->>'state'<>'PREPARED'then return native_value;end if;
 update private.campaign_jobs set body_hash=body_hash_value,body=body_value,native_generation=g where tenant_id=target_tenant_id and job_id=x.job_id;
 return jsonb_build_object('state','PREPARED','operation_id',x.job_id,'generation',x.campaign_revision::text,'mode','SYNTHETIC');
end;$$;

create function public.campaign_dispatch_fixture_v1(target_tenant_id uuid,job_id_value uuid,lease_token_value uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare x private.campaign_jobs;c private.sales_campaigns;j public.scheduled_jobs;begin
 select * into x from private.campaign_jobs where tenant_id=target_tenant_id and job_id=job_id_value;
 perform private.campaign_fixture(target_tenant_id,x.campaign_id);
 select * into c from private.sales_campaigns where tenant_id=target_tenant_id and id=x.campaign_id for share;
 perform 1 from private.sales_campaigns where tenant_id=target_tenant_id and id=x.campaign_id for share;
 perform 1 from public.conversations where tenant_id=target_tenant_id and id=x.conversation_id for update;
 select * into j from public.scheduled_jobs where id=x.job_id for update;
 if c.state<>'ACTIVE' or c.revision<>x.campaign_revision or private.campaign_blockers(target_tenant_id,c.id)<>'[]'::jsonb
 or private.campaign_contact_reason(target_tenant_id,c.id,x.customer_id,x.job_id)is not null
 or j.status<>'processing' or j.payload->>'stage'<>'RESERVED' or x.lease_token is distinct from lease_token_value or x.body_hash is null
 or j.locked_at<clock_timestamp()-interval '60 seconds'
 or not exists(select 1 from public.messages where tenant_id=target_tenant_id and id=x.source_message_id and private.fse_hash(content)=x.source_hash)
 or not exists(select 1 from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=x.conversation_id and last_inbound_id=x.source_message_id)
 or x.native_generation is null or not private.polat_can_dispatch_fixture(target_tenant_id,x.job_id,x.native_generation)
 then return false;end if;
 update public.scheduled_jobs set payload=payload||jsonb_build_object('stage','DISPATCHED')where id=j.id;
 return true;
end;$$;

create function public.campaign_finish_fixture_v1(target_tenant_id uuid,job_id_value uuid,lease_token_value uuid,receipt_value text)
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare x private.campaign_jobs;j public.scheduled_jobs;r jsonb;c private.sales_campaigns;begin
 select * into x from private.campaign_jobs where tenant_id=target_tenant_id and job_id=job_id_value;
 perform private.campaign_fixture(target_tenant_id,x.campaign_id);
 select * into c from private.sales_campaigns where tenant_id=target_tenant_id and id=x.campaign_id for update;
 perform 1 from private.sales_campaigns where tenant_id=target_tenant_id and id=x.campaign_id for share;
 perform 1 from public.conversations where tenant_id=target_tenant_id and id=x.conversation_id for update;
 select * into j from public.scheduled_jobs where id=x.job_id for update;
 r:=private.fse_strict_json(receipt_value);
 if not private.fse_keys(r,array['version','mode','origin','tenant_id','conversation_id','message_id','operation_id','body_hash','result','reference'])
 or r->'version'<>'1'::jsonb or r->>'mode'<>'SYNTHETIC'or r->>'origin'<>'FAKE' or r->>'tenant_id' is distinct from target_tenant_id::text
 or r->>'conversation_id' is distinct from x.conversation_id::text or r->>'message_id' is distinct from x.source_message_id::text or r->>'operation_id' is distinct from x.job_id::text
 or r->>'body_hash' is distinct from x.body_hash or r->>'result'not in('FAKE_ACK','UNKNOWN','FAILED_BEFORE_SEND')
 or r->>'result'='FAKE_ACK'and r->>'reference' is distinct from 'polat-fake:'||x.job_id::text
 or r->>'result'<>'FAKE_ACK'and r->'reference'<>'null'::jsonb or x.lease_token is distinct from lease_token_value
 then raise exception 'CAMPAIGN_RECEIPT_INVALID' using errcode='22023';end if;
 if x.outcome is not null then
  if x.outcome<>r then raise exception 'CAMPAIGN_OUTCOME_CONFLICT'using errcode='23505';end if;
 else
  if j.status<>'processing' or j.locked_at<clock_timestamp()-interval '60 seconds' or r->>'result'='FAKE_ACK'and(j.payload->>'stage'<>'DISPATCHED'or x.body is null) then raise exception 'CAMPAIGN_LEASE_INVALID'using errcode='42501';end if;
  perform private.polat_outcome_fixture(target_tenant_id,x.job_id,r::text);
  -- The legacy fixture permits explicit pre-send retry. This campaign intent has
  -- a one-attempt budget: retain a visible terminal block rather than pending retry.
  if r->>'result'='FAILED_BEFORE_SEND'and exists(select 1 from private.polat_inbound_work where tenant_id=target_tenant_id and message_id=x.source_message_id and state='AI_RESPONSE_PENDING')then
   perform private.polat_set_work(target_tenant_id,x.source_message_id,'BLOCKED_WITH_REASON','CAMPAIGN_NOT_SENT');
  end if;
  update private.campaign_jobs set outcome=r where tenant_id=target_tenant_id and job_id=x.job_id;
  update public.scheduled_jobs set status=case when r->>'result'='FAKE_ACK'then 'completed'else 'dead_letter'end,
   completed_at=case when r->>'result'='FAKE_ACK'then clock_timestamp()end,
   dead_lettered_at=case when r->>'result'<>'FAKE_ACK'then clock_timestamp()end,
   last_error_code=case when r->>'result'='UNKNOWN'then 'DELIVERY_UNKNOWN'when r->>'result'='FAILED_BEFORE_SEND'then 'NOT_SENT'end where id=x.job_id;
  if r->>'result'='UNKNOWN'then update private.sales_campaigns set state='PAUSED',revision=revision+1 where tenant_id=target_tenant_id and id=c.id;end if;
  perform private.campaign_audit(target_tenant_id,c.id,'fixture_outcome',jsonb_build_object('job_id',x.job_id,'result',r->>'result','actual_delivery',false,'actual_cost','UNKNOWN'));
 end if;
 return(select state from private.polat_inbound_work where tenant_id=target_tenant_id and message_id=x.source_message_id);
end;$$;

create function public.campaign_hold_fixture_v1(target_tenant_id uuid,job_id_value uuid,lease_token_value uuid,reason_value text)
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare x private.campaign_jobs;j public.scheduled_jobs;begin
 select * into x from private.campaign_jobs where tenant_id=target_tenant_id and job_id=job_id_value;
 perform private.campaign_fixture(target_tenant_id,x.campaign_id);
 perform 1 from private.sales_campaigns where tenant_id=target_tenant_id and id=x.campaign_id for share;
 perform 1 from public.conversations where tenant_id=target_tenant_id and id=x.conversation_id for update;
 select * into j from public.scheduled_jobs where id=x.job_id for update;
 if x.lease_token is distinct from lease_token_value or j.status<>'processing'or j.locked_at<clock_timestamp()-interval '60 seconds' or j.payload->>'stage'<>'RESERVED'or reason_value not in('QA_HOLD','MODEL_UNAVAILABLE')then raise exception 'CAMPAIGN_LEASE_INVALID'using errcode='42501';end if;
 update public.scheduled_jobs set status='dead_letter',last_error_code=reason_value,dead_lettered_at=clock_timestamp()where id=j.id;
 update public.conversations set attention_required=true where tenant_id=target_tenant_id and id=x.conversation_id;
 if x.native_generation=(select generation from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=x.conversation_id)then
  perform private.polat_hold_fixture(target_tenant_id,x.source_message_id,x.native_generation,reason_value);
 else perform private.polat_set_work(target_tenant_id,x.source_message_id,'HUMAN_HANDOFF_PENDING','CAMPAIGN_STALE_SOURCE');end if;
 perform private.campaign_audit(target_tenant_id,x.campaign_id,'review_obligation',jsonb_build_object('job_id',x.job_id,'reason',reason_value));
 return 'HUMAN_HANDOFF_PENDING';
end;$$;

-- Native replies retain all accepted QA/send gates and add the current campaign fence.
alter function public.queue_quality_approved_reply(uuid,uuid) rename to campaign_native_quality_queue;
alter function public.campaign_native_quality_queue(uuid,uuid) set schema private;
create function public.queue_quality_approved_reply(target_tenant_id uuid,target_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare cid uuid;cv public.conversations;c private.sales_campaigns;begin
 select t.conversation_id into cid from public.agent_proposals p join public.agent_tasks t on t.tenant_id=p.tenant_id and t.id=p.task_id where p.tenant_id=target_tenant_id and p.id=target_proposal_id;
 select * into cv from public.conversations where tenant_id=target_tenant_id and id=cid;
 if exists(select 1 from private.campaign_audience where tenant_id=target_tenant_id and customer_id=cv.customer_id)then
  select x.* into c from private.sales_campaigns x join private.campaign_audience a on a.tenant_id=x.tenant_id and a.campaign_id=x.id where x.tenant_id=target_tenant_id and a.customer_id=cv.customer_id and x.state='ACTIVE'for share of x;
  if c.id is null or private.campaign_blockers(target_tenant_id,c.id)<>'[]'::jsonb or private.campaign_contact_reason(target_tenant_id,c.id,cv.customer_id)is not null then return jsonb_build_object('queued',false,'reason','CAMPAIGN_HELD');end if;
  update public.conversations set automatic_replies_enabled=true,automatic_replies_enabled_at=greatest(c.activated_at,escalation_return_boundary)
  where tenant_id=target_tenant_id and id=cv.id and runtime_mode='AI_ACTIVE'and not human_takeover;
 end if;
 return private.campaign_native_quality_queue(target_tenant_id,target_proposal_id);
end;$$;
alter function public.claim_quality_reply_delivery(uuid,uuid) rename to campaign_native_quality_claim;
alter function public.campaign_native_quality_claim(uuid,uuid) set schema private;
create function public.claim_quality_reply_delivery(target_tenant_id uuid,target_message_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare m public.messages;c private.sales_campaigns;cid uuid;begin
 select * into m from public.messages where tenant_id=target_tenant_id and id=target_message_id;
 select customer_id into cid from public.conversations where tenant_id=target_tenant_id and id=m.conversation_id;
 if exists(select 1 from private.campaign_audience where tenant_id=target_tenant_id and customer_id=cid)then
  select x.* into c from private.sales_campaigns x join private.campaign_audience a on a.tenant_id=x.tenant_id and a.campaign_id=x.id where x.tenant_id=target_tenant_id and a.customer_id=cid and x.state='ACTIVE'for share of x;
  if c.id is null or m.created_at<c.activated_at or private.campaign_blockers(target_tenant_id,c.id)<>'[]'::jsonb or private.campaign_contact_reason(target_tenant_id,c.id,cid)is not null then return false;end if;
 end if;
 return private.campaign_native_quality_claim(target_tenant_id,target_message_id);
end;$$;

-- Restriction only: a campaign START never selects an unaccepted paid runtime.
-- Existing independently account-bound UAT remains a separate authorization scope.
create function public.campaign_runtime_scope_v1(target_tenant_id uuid,target_conversation_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('bound',exists(select 1 from private.campaign_audience a join public.conversations c on c.tenant_id=a.tenant_id and c.customer_id=a.customer_id where a.tenant_id=target_tenant_id and c.id=target_conversation_id),
 'genuine_executor_accepted',false,'reason','COMMERCIAL_PROVIDER_ACCOUNT_AND_TRANSPORT_ACCEPTANCE_REQUIRED');
$$;

create function public.admin_campaign_import_status_v1(target_tenant_id uuid,batch_id_value uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare b public.import_batches;d private.campaign_permissions;begin
 perform private.campaign_admin(target_tenant_id,false);
 select * into b from public.import_batches where tenant_id=target_tenant_id and id=batch_id_value;
 if b.id is null then raise exception 'CAMPAIGN_UNAVAILABLE' using errcode='42501';end if;
 select * into d from private.campaign_permissions where tenant_id=target_tenant_id and batch_id=b.id;
 return jsonb_build_object('batch_id',b.id,'source',b.source_name,'dataset_hash',b.file_sha256,'status',b.status,
 'permission_recorded',d.batch_id is not null,'classification',d.declaration->>'classification',
 'total_rows',b.total_rows,'imported_rows',(select count(*)from public.import_rows where tenant_id=target_tenant_id and batch_id=b.id and status='imported'),
 'unique_customers',(select count(distinct imported_customer_id)from public.import_rows where tenant_id=target_tenant_id and batch_id=b.id and status='imported'),
 'pending_identity_review',(select count(*)from public.import_rows where tenant_id=target_tenant_id and batch_id=b.id and status='review_required'));
end;$$;

create function public.admin_campaign_workspace_v1(target_tenant_id uuid,after_value uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare c private.sales_campaigns;items jsonb:='[]';row_value jsonb;last_id uuid;begin
 perform private.campaign_admin(target_tenant_id,false);
 for c in select * from private.sales_campaigns where tenant_id=target_tenant_id and(after_value is null or id>after_value)order by id limit 25 loop
  select jsonb_build_object('id',c.id,'name',c.configuration->>'name','state',c.state,'mode',c.configuration->>'mode','revision',c.revision,'configuration',c.configuration,
   'blockers',private.campaign_blockers(target_tenant_id,c.id)||case when c.configuration->>'mode'='COMMERCIAL'then '["GENUINE_PROVIDER_ACCOUNT_AND_TRANSPORT_NOT_ACCEPTED"]'::jsonb else '[]'::jsonb end,
   'imported',count(*),'eligible',count(*)filter(where private.campaign_contact_reason(target_tenant_id,c.id,a.customer_id)is null),
   'reachable',count(*)filter(where exists(select 1 from public.messaging_contacts m where m.tenant_id=a.tenant_id and m.customer_id=a.customer_id and m.contactability in('user_initiated','allowed')and m.last_inbound_at is not null)),
   'active_conversations',count(*)filter(where exists(select 1 from public.conversations cv where cv.tenant_id=a.tenant_id and cv.customer_id=a.customer_id and cv.status='open')),
   'awaiting_responses',count(*)filter(where exists(select 1 from public.conversations cv where cv.tenant_id=a.tenant_id and cv.customer_id=a.customer_id and cv.unread_count>0)),
   'suppressed',count(*)filter(where private.campaign_contact_reason(target_tenant_id,c.id,a.customer_id)='CONTACT_SUPPRESSED'),
   'interested',count(*)filter(where exists(select 1 from public.customers z where z.tenant_id=a.tenant_id and z.id=a.customer_id and z.state='INTERESTED')),
   'pending_payments',count(*)filter(where exists(select 1 from public.customers z where z.tenant_id=a.tenant_id and z.id=a.customer_id and z.state='PAYMENT_PENDING')),
   'verified_sales',(select count(*)from public.subscription_payments p join private.verified_payment_receipts r on r.tenant_id=p.tenant_id and r.id=p.receipt_id join private.campaign_audience aa on aa.tenant_id=p.tenant_id and aa.customer_id=r.customer_id where p.tenant_id=target_tenant_id and aa.campaign_id=c.id and p.mode='live'and private.entitlement_live_allowed(target_tenant_id)),
   'active_vip',(select count(*)from public.channel_access v join public.subscriptions s on s.tenant_id=v.tenant_id and s.id=v.subscription_id join private.campaign_audience aa on aa.tenant_id=s.tenant_id and aa.customer_id=s.customer_id where aa.tenant_id=target_tenant_id and aa.campaign_id=c.id and s.mode='live'and s.state in('ACTIVE','RENEWAL_DUE')and s.ends_at>clock_timestamp()and v.status='MEMBER'and v.membership_checked_at is not null and private.entitlement_live_allowed(target_tenant_id)),
   'scheduled',(select count(*)from private.campaign_jobs x join public.scheduled_jobs j on j.id=x.job_id where x.tenant_id=target_tenant_id and x.campaign_id=c.id and j.status='scheduled'),
   'completed',(select count(*)from private.campaign_jobs x join public.scheduled_jobs j on j.id=x.job_id where x.tenant_id=target_tenant_id and x.campaign_id=c.id and j.status='completed'),
   'unknown',(select count(*)from private.campaign_jobs x join public.scheduled_jobs j on j.id=x.job_id where x.tenant_id=target_tenant_id and x.campaign_id=c.id and j.status='dead_letter'),
   'attempts',c.attempts,'reserved_liability',c.reserved_liability::text,'revenue',null,'actual_cost',null,'financial_authority','NONE','live_dispatch_enabled',false)
   into row_value from private.campaign_audience a where a.tenant_id=target_tenant_id and a.campaign_id=c.id;
  items:=items||jsonb_build_array(row_value);last_id:=c.id;
 end loop;
 return jsonb_build_object('items',items,'next_after',case when exists(select 1 from private.sales_campaigns where tenant_id=target_tenant_id and id>last_id)then last_id end);
end;$$;

do $$declare r record;begin
 for r in select oid::regclass as relation from pg_class where relnamespace='private'::regnamespace and relname in('campaign_permissions','sales_campaigns','campaign_audience','campaign_suppressions','campaign_jobs')loop
  execute format('alter table %s enable row level security',r.relation);
  execute format('revoke all on %s from public,anon,authenticated,service_role',r.relation);
 end loop;
 for r in select oid::regprocedure as signature from pg_proc where pronamespace='private'::regnamespace and(proname like 'campaign_%'or proname='commit_campaign_import_resolved')loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
 end loop;
 for r in select oid::regprocedure as signature,proname from pg_proc where pronamespace='public'::regnamespace and(proname like 'admin_campaign_%'or proname like 'campaign_%'or proname in('queue_quality_approved_reply','claim_quality_reply_delivery'))loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
  if r.proname like 'admin_campaign_%'then execute format('grant execute on function %s to authenticated',r.signature);
  else execute format('grant execute on function %s to service_role',r.signature);end if;
 end loop;
end;$$;

-- A single batch submission records authenticated provenance and imports atomically.
create function public.admin_campaign_import_authorized_v1(target_tenant_id uuid,declaration_value text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v jsonb;begin
 perform public.admin_campaign_permission_v1(target_tenant_id,declaration_value);
 v:=private.fse_strict_json(declaration_value);
 return public.admin_campaign_commit_batch_v1(target_tenant_id,(v->>'batch_id')::uuid);
end;$$;
revoke all on function public.admin_campaign_import_authorized_v1(uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.admin_campaign_import_authorized_v1(uuid,text)to authenticated;

-- New customer-initiated conversations inherit the already activated founder policy,
-- not a new per-lead approval. Existing operator-owned conversations are untouched.
create function private.campaign_new_conversation()returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare c private.sales_campaigns;begin
 select x.* into c from private.sales_campaigns x join private.campaign_audience a on a.tenant_id=x.tenant_id and a.campaign_id=x.id
 where x.tenant_id=new.tenant_id and a.customer_id=new.customer_id and x.state='ACTIVE'and x.configuration->'markets'?a.market;
 if c.id is null or new.runtime_mode<>'HUMAN_TAKEOVER'or new.status<>'open'
 or exists(select 1 from public.customers where tenant_id=new.tenant_id and id=new.customer_id and automation_paused)
 or exists(select 1 from private.campaign_suppressions where tenant_id=new.tenant_id and customer_id=new.customer_id)
 then return new;end if;
 update public.conversations set runtime_mode='AI_ACTIVE',human_takeover=false,automatic_replies_enabled=true,automatic_replies_enabled_at=clock_timestamp()
 where tenant_id=new.tenant_id and id=new.id;
 perform private.campaign_audit(new.tenant_id,c.id,'conversation_enrolled',jsonb_build_object('conversation_id',new.id,'activation_revision',c.revision,'human_per_lead_review',false));
 return new;
end;$$;
create trigger campaign_default_conversation after insert on public.conversations for each row execute function private.campaign_new_conversation();
revoke all on function private.campaign_new_conversation()from public,anon,authenticated,service_role;

-- Reuse the accepted bounded native Polat context and source-grounded catalog.
create function public.campaign_context_fixture_v1(target_tenant_id uuid,job_id_value uuid,lease_token_value uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x private.campaign_jobs;j public.scheduled_jobs;e uuid;ctx jsonb;commercial jsonb;docs jsonb;history jsonb;begin
 select * into x from private.campaign_jobs where tenant_id=target_tenant_id and job_id=job_id_value;
 perform private.campaign_fixture(target_tenant_id,x.campaign_id);
 select * into j from public.scheduled_jobs where id=x.job_id;
 if j.status<>'processing'or x.lease_token is distinct from lease_token_value or j.locked_at<clock_timestamp()-interval '60 seconds'then raise exception 'CAMPAIGN_LEASE_INVALID'using errcode='42501';end if;
 select id into e from public.domain_events where tenant_id=target_tenant_id and event_type='message.received'and payload->>'message_id'=x.source_message_id::text order by recorded_at,id limit 1;
 ctx:=public.polat_test_runtime_context_v1(target_tenant_id,x.conversation_id,e);
 -- Only independently recorded native FAKE_ACK evidence adds generated text to history.
 -- Never add queued, failed, unknown or future output to model context.
 with candidates as(
  select value from jsonb_array_elements(ctx#>'{input,messages}')
  union all
  select jsonb_build_object('id',z.job_id,'tenant_id',z.tenant_id,'conversation_id',z.conversation_id,'direction','outbound','content',z.body,'occurred_at',a.created_at,'author','AI','delivery','FAKE_ACKNOWLEDGED')
  from private.campaign_jobs z join private.polat_response_evidence a on a.tenant_id=z.tenant_id and a.operation_id=z.job_id and a.stage='FAKE_ACK'and a.body_hash=z.body_hash
  where z.tenant_id=target_tenant_id and z.conversation_id=x.conversation_id and z.source_message_id<>x.source_message_id and z.outcome->>'result'='FAKE_ACK'and z.body is not null
  and a.created_at<=(ctx#>>'{input,boundary}')::timestamptz
 ), page as(select value from candidates order by(value->>'occurred_at')::timestamptz desc,value->>'id'desc limit 20),
 bounded as(select value,sum(char_length(value->>'content'))over(order by(value->>'occurred_at')::timestamptz desc,value->>'id'desc)chars from page)
 select coalesce(jsonb_agg(value order by(value->>'occurred_at')::timestamptz,value->>'id'),'[]')into history from bounded where chars<=16000;
 ctx:=jsonb_set(ctx,'{input,messages}',history);
 commercial:=private.commercial_for_source(target_tenant_id,e);
 select coalesce(jsonb_agg(jsonb_build_object('tenant_id',target_tenant_id,'conversation_id',x.conversation_id,'approval','APPROVED_SYNTHETIC','item_id',d->'item_id','version_id',d->'version_id',
 'version',d->'version','kind',d->'kind','published_at',d->'published_at','effective_from',d->'effective_from','expires_at',d->'expires_at','test_only',true,'payload',d->'payload')),'[]')into docs
 from jsonb_array_elements(commercial->'documents')d where d->>'test_only'='true';
 return jsonb_build_object('context',ctx,'sales',jsonb_build_object('version',1,'mode','SYNTHETIC','conversation',ctx->'input','catalog',docs,'catalog_conflict',commercial->'conflict','style','DIRECT'));
end;$$;
revoke all on function public.campaign_context_fixture_v1(uuid,uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.campaign_context_fixture_v1(uuid,uuid,uuid)to service_role;

-- Existing customer-success cron drains this queue; no new cron or live sender.
create function public.process_campaign_due_v1()returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.sales_campaigns;r jsonb;n integer:=0;seen integer:=0;begin
 for c in select * from private.sales_campaigns where state='ACTIVE'order by last_cycle_at nulls first,id limit 5 for update skip locked loop
  r:=public.campaign_schedule_v1(c.tenant_id,c.id,25);n:=n+(r->>'scheduled')::int;seen:=seen+1;
  update private.sales_campaigns set last_cycle_at=clock_timestamp()where tenant_id=c.tenant_id and id=c.id;
 end loop;
 return jsonb_build_object('scheduled',n,'campaigns',seen,'external_dispatch',false);
end;$$;
revoke all on function public.process_campaign_due_v1()from public,anon,authenticated,service_role;
grant execute on function public.process_campaign_due_v1()to service_role;

create function private.campaign_job_guard()returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_op='DELETE'or to_jsonb(new)-array['lease_token','body_hash','body','native_generation','outcome']is distinct from to_jsonb(old)-array['lease_token','body_hash','body','native_generation','outcome']
 or old.lease_token is not null and new.lease_token is distinct from old.lease_token
 or old.body_hash is not null and new.body_hash is distinct from old.body_hash
 or old.body is not null and new.body is distinct from old.body
 or old.native_generation is not null and new.native_generation is distinct from old.native_generation
 or old.outcome is not null and new.outcome is distinct from old.outcome
 then raise exception 'CAMPAIGN_EVIDENCE_IMMUTABLE'using errcode='42501';end if;return new;
end;$$;
create trigger campaign_job_immutable_binding before update or delete on private.campaign_jobs for each row execute function private.campaign_job_guard();
revoke all on function private.campaign_job_guard()from public,anon,authenticated,service_role;

create function private.campaign_budget_guard()returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_op='DELETE'or to_jsonb(new)-array['configuration','state','revision','activated_at','attempts','reserved_liability','last_cycle_at']is distinct from to_jsonb(old)-array['configuration','state','revision','activated_at','attempts','reserved_liability','last_cycle_at']
 or old.state not in('CONFIGURING','READY')and new.configuration is distinct from old.configuration
 or new.attempts<old.attempts or new.reserved_liability<old.reserved_liability or new.revision<old.revision or old.state='STOPPED'and new.state<>'STOPPED'
 then raise exception 'CAMPAIGN_HISTORY_OR_BUDGET_IMMUTABLE'using errcode='42501';end if;return new;
end;$$;
create trigger campaign_budget_no_reset before update or delete on private.sales_campaigns for each row execute function private.campaign_budget_guard();
revoke all on function private.campaign_budget_guard()from public,anon,authenticated,service_role;

create function public.admin_campaign_options_v1(target_tenant_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$begin
 perform private.campaign_admin(target_tenant_id,false);
 return jsonb_build_object('batches',coalesce((select jsonb_agg(to_jsonb(q))from(select b.id,b.source_name source,(select count(distinct r.imported_customer_id)from public.import_rows r where r.tenant_id=b.tenant_id and r.batch_id=b.id and r.status='imported')unique_customers
 from public.import_batches b join private.campaign_permissions d on d.tenant_id=b.tenant_id and d.batch_id=b.id where b.tenant_id=target_tenant_id and b.completed_at is not null and b.status in('completed','review_required')order by b.created_at desc,b.id limit 100)q),'[]'),
 'plans',coalesce((select jsonb_agg(to_jsonb(q))from(select v.id,v.payload->>'title'title,v.payload->>'amount'amount,v.payload->>'currency'currency,i.test_only from public.commercial_versions v join public.commercial_items i on i.tenant_id=v.tenant_id and i.id=v.item_id
 where v.tenant_id=target_tenant_id and i.kind='plan'and i.archived_at is null and v.status='published'and v.effective_from<=clock_timestamp()and coalesce(v.expires_at,'infinity')>clock_timestamp()and coalesce(v.superseded_at,'infinity')>clock_timestamp()
 order by v.published_at desc,v.id limit 100)q),'[]'));
end;$$;
revoke all on function public.admin_campaign_options_v1(uuid)from public,anon,authenticated,service_role;
grant execute on function public.admin_campaign_options_v1(uuid)to authenticated;

-- One policy also fences the accepted native fake sender for campaign-owned operations.
alter function private.polat_can_dispatch_fixture(uuid,uuid,bigint)rename to campaign_native_can_dispatch;
create function private.polat_can_dispatch_fixture(t uuid,op uuid,g bigint)returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select private.campaign_native_can_dispatch(t,op,g)and(
 not exists(select 1 from private.campaign_jobs where tenant_id=t and job_id=op)
 or exists(select 1 from private.campaign_jobs x join private.sales_campaigns c on c.tenant_id=x.tenant_id and c.id=x.campaign_id
 where x.tenant_id=t and x.job_id=op and c.state='ACTIVE'and c.revision=x.campaign_revision and x.native_generation=g
 and private.campaign_blockers(t,c.id)='[]'::jsonb and private.campaign_contact_reason(t,c.id,x.customer_id,x.job_id)is null));
$$;
revoke all on function private.campaign_native_can_dispatch(uuid,uuid,bigint),private.polat_can_dispatch_fixture(uuid,uuid,bigint)from public,anon,authenticated,service_role;
