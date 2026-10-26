-- Dedicated Telegram TEST network only. No LIVE receipt, payment.confirmed, or commercial authority.
create table private.private_beta_stars_controls(
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,program_id uuid not null unique,
 program_generation bigint not null,revision bigint not null default 1,configuration jsonb not null,
 request_count integer not null default 0 check(request_count between 0 and 100),created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,program_id)references private.private_beta_programs(tenant_id,id),unique(tenant_id,id)
);
create table private.private_beta_stars_attempts(
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,program_id uuid not null,control_id uuid not null,binding_revision bigint not null,
 operation text not null check(operation in('getMe','sendInvoice','answerPreCheckoutQuery','getStarTransactions','refundStarPayment','getChat','getChatMember','createChatInviteLink','revokeChatInviteLink','approveChatJoinRequest','banChatMember','sendMessage')),
 request_key text not null,effect_key text not null check(effect_key~'^[a-f0-9]{64}$'),request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 dispatch_nonce uuid not null,ordinal integer not null check(ordinal between 1 and 100),started_at timestamptz not null default clock_timestamp(),
 unique(program_id,request_key),unique(program_id,effect_key),unique(program_id,ordinal),unique(tenant_id,id),
 foreign key(tenant_id,program_id)references private.private_beta_programs(tenant_id,id),foreign key(tenant_id,control_id)references private.private_beta_stars_controls(tenant_id,id)
);
create table private.private_beta_stars_outcomes(
 attempt_id uuid primary key references private.private_beta_stars_attempts(id),tenant_id uuid not null,
 state text not null check(state in('ACKNOWLEDGED','REJECTED','UNKNOWN')),provider_status integer not null check(provider_status between 0 and 599),
 response_hash text,created_at timestamptz not null default clock_timestamp(),check(response_hash is null or response_hash~'^[a-f0-9]{64}$')
);
create table private.private_beta_stars_receipts(
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,program_id uuid not null,invoice_id uuid not null,
 bot_user_id text not null,charge_id text not null,kind text not null check(kind in('PAYMENT','REFUND')),update_id text not null,
 operation_key text not null unique,delivery_key text not null unique,raw_hash text not null,fact_hash text not null,
 amount_units numeric(30,0)not null check(amount_units>0),ledger_attempt_id uuid not null,ledger_hash text not null,event_id uuid not null,
 source_time timestamptz not null,created_at timestamptz not null default clock_timestamp(),origin text not null default 'TELEGRAM_DEDICATED_TEST'check(origin='TELEGRAM_DEDICATED_TEST'),
 financial_authority text not null default 'NONE'check(financial_authority='NONE'),unique(bot_user_id,charge_id,kind),unique(bot_user_id,update_id),unique(tenant_id,id),
 foreign key(tenant_id,program_id)references private.private_beta_programs(tenant_id,id),foreign key(tenant_id,invoice_id)references public.payment_invoices(tenant_id,id),
 foreign key(tenant_id,ledger_attempt_id)references private.private_beta_stars_attempts(tenant_id,id),foreign key(tenant_id,event_id)references public.domain_events(tenant_id,id)
);
create table private.private_beta_stars_deliveries(
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,receipt_id uuid not null,delivery_key text not null unique,
 bot_user_id text not null,update_id text not null,raw_hash text not null,ledger_attempt_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 unique(bot_user_id,update_id),foreign key(tenant_id,receipt_id)references private.private_beta_stars_receipts(tenant_id,id),foreign key(tenant_id,ledger_attempt_id)references private.private_beta_stars_attempts(tenant_id,id)
);
create table private.private_beta_stars_ingress(
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,program_id uuid not null,bot_user_id text not null,update_id text not null,raw_hash text not null,
 nonce uuid not null,state text not null default 'PENDING'check(state in('PENDING','COMPLETE','REVIEW')),reason_code text,received_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 unique(bot_user_id,update_id),foreign key(tenant_id,program_id)references private.private_beta_programs(tenant_id,id)
);
create index private_beta_stars_receipts_invoice on private.private_beta_stars_receipts(tenant_id,invoice_id,created_at,id);
create index private_beta_stars_attempts_unresolved on private.private_beta_stars_attempts(program_id,operation,ordinal);
create table private.private_beta_stars_access_leases(
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,program_id uuid not null,job_id uuid not null unique references public.entitlement_jobs(id),
 lease_token uuid not null unique,subscription_revision integer not null,program_generation bigint not null,binding_revision bigint not null,
 writer_txid bigint not null default txid_current(),created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 foreign key(tenant_id,program_id)references private.private_beta_programs(tenant_id,id)
);
create table private.private_beta_stars_access_proofs(
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,program_id uuid not null,job_id uuid not null unique references public.entitlement_jobs(id),
 access_id uuid not null,status text not null check(status in('INVITED','MEMBER','REVOKED','REVIEW')),primary_attempt_id uuid not null references private.private_beta_stars_attempts(id),
 verification_attempt_id uuid references private.private_beta_stars_attempts(id),invite_reference text,invite_expires_at timestamptz,writer_txid bigint not null default txid_current(),
 created_at timestamptz not null default clock_timestamp(),foreign key(tenant_id,program_id)references private.private_beta_programs(tenant_id,id),foreign key(tenant_id,access_id)references public.channel_access(tenant_id,id)
);
alter table private.private_beta_stars_access_leases enable row level security;alter table private.private_beta_stars_access_proofs enable row level security;
revoke all on private.private_beta_stars_access_leases,private.private_beta_stars_access_proofs from public,anon,authenticated,service_role;
create trigger private_beta_stars_access_lease_immutable before update or delete on private.private_beta_stars_access_leases for each row execute function private.fse_immutable();
create trigger private_beta_stars_access_proof_immutable before update or delete on private.private_beta_stars_access_proofs for each row execute function private.fse_immutable();
do $$declare n text;begin foreach n in array array['private_beta_stars_controls','private_beta_stars_attempts','private_beta_stars_outcomes','private_beta_stars_receipts','private_beta_stars_deliveries','private_beta_stars_ingress']loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);end loop;end;$$;
create trigger private_beta_stars_attempt_immutable before update or delete on private.private_beta_stars_attempts for each row execute function private.fse_immutable();
create trigger private_beta_stars_outcome_immutable before update or delete on private.private_beta_stars_outcomes for each row execute function private.fse_immutable();
create trigger private_beta_stars_receipt_immutable before update or delete on private.private_beta_stars_receipts for each row execute function private.fse_immutable();
create trigger private_beta_stars_delivery_immutable before update or delete on private.private_beta_stars_deliveries for each row execute function private.fse_immutable();

create function private.private_beta_stars_guard(t uuid,p uuid)returns private.private_beta_stars_controls language plpgsql stable set search_path=pg_catalog as $$
declare x private.private_beta_programs;c private.private_beta_stars_controls;begin
 x:=private.private_beta_guard(t,p);select * into c from private.private_beta_stars_controls where tenant_id=t and program_id=p;
 if c.id is null or x.approved_at is null or not private.private_beta_live_window(x)or c.program_generation<>x.generation
 or c.configuration->>'environment'is distinct from 'TELEGRAM_DEDICATED_TEST'or(c.configuration->>'expires_at')::timestamptz<=clock_timestamp()
 or not exists(select 1 from public.tenant_members where tenant_id=t and user_id=x.owner_user_id and role='super_admin'and status='active')then raise exception 'STARS_TEST_UNAVAILABLE'using errcode='42501';end if;
 return c;end;$$;
-- Independently collected /test/getMe and identity/consent records. Only protected postgres release custody may write this control.
create function private.private_beta_stars_control_record(t uuid,p uuid,raw_value text)returns void language plpgsql set search_path=pg_catalog as $$
declare x private.private_beta_programs;c private.private_beta_stars_controls;v jsonb;u jsonb;seen text[]:='{}';begin
 if current_user<>'postgres'then raise exception 'STARS_TEST_UNAVAILABLE'using errcode='42501';end if;
 perform 1 from private.private_beta_programs where tenant_id=t and id=p for share;x:=private.private_beta_guard(t,p);v:=private.fse_strict_json(raw_value);
 if not(private.fse_keys(v,array['version','environment','bot_user_id','get_me_hash','observed_at','expires_at','approved_test_amount_units','maximum_calls','test_users'])or private.fse_keys(v,array['version','environment','bot_user_id','get_me_hash','observed_at','expires_at','approved_test_amount_units','maximum_calls','test_users','test_channel_id','channel_source_hash']))then raise exception 'STARS_TEST_CONTROL_INVALID'using errcode='22023';end if;
 v:=v||jsonb_build_object('test_channel_id',coalesce(v->'test_channel_id','null'::jsonb),'channel_source_hash',coalesce(v->'channel_source_hash','null'::jsonb));
 if coalesce(v->'version'is distinct from '1'::jsonb
 or v->>'environment'is distinct from 'TELEGRAM_DEDICATED_TEST'or v->>'bot_user_id'!~'^[1-9][0-9]{0,15}$'or v->>'get_me_hash'!~'^[a-f0-9]{64}$'
 or v->>'approved_test_amount_units'!~'^[1-9][0-9]{0,15}$'or(v->>'approved_test_amount_units')::numeric>9007199254740991
 or v->>'maximum_calls'!~'^[1-9][0-9]?$|^100$'or jsonb_typeof(v->'test_users')is distinct from 'array'or jsonb_array_length(v->'test_users')not between 1 and 12
 or(v->>'observed_at')::timestamptz>clock_timestamp()or(v->>'observed_at')::timestamptz<clock_timestamp()-interval '5 minutes'
 or(v->>'expires_at')::timestamptz<=clock_timestamp()or(v->>'expires_at')::timestamptz>(x.configuration->>'expires_at')::timestamptz,true)
 then raise exception 'STARS_TEST_CONTROL_INVALID'using errcode='22023';end if;
 if(v->'test_channel_id'='null'::jsonb)is distinct from(v->'channel_source_hash'='null'::jsonb)or(v->>'test_channel_id'is not null and(coalesce(v->>'test_channel_id','')!~'^-[1-9][0-9]{0,15}$'or coalesce(v->>'channel_source_hash','')!~'^[a-f0-9]{64}$'))then raise exception 'STARS_TEST_CONTROL_INVALID'using errcode='22023';end if;
 for u in select value from jsonb_array_elements(v->'test_users')loop
  if coalesce(not private.fse_keys(u,array['test_user_id','customer_id','consent_hash'])or u->>'test_user_id'!~'^[1-9][0-9]{0,15}$'or u->>'consent_hash'!~'^[a-f0-9]{64}$'or u->>'test_user_id'=any(seen)
  or not exists(select 1 from private.private_beta_participants a join public.conversations q on q.tenant_id=a.tenant_id and q.id=a.conversation_id where a.tenant_id=t and a.program_id=p and a.status='ACTIVE'and q.customer_id=(u->>'customer_id')::uuid),true)
  then raise exception 'STARS_TEST_CONTROL_INVALID'using errcode='22023';end if;seen:=array_append(seen,u->>'test_user_id');
 end loop;
 select * into c from private.private_beta_stars_controls where tenant_id=t and program_id=p for update;
 if c.id is null then insert into private.private_beta_stars_controls(tenant_id,program_id,program_generation,configuration)values(t,p,x.generation,v);
 else
  if c.configuration->>'bot_user_id'<>v->>'bot_user_id'or(v->>'maximum_calls')::int<c.request_count or(c.request_count>0 and c.configuration->>'approved_test_amount_units'<>v->>'approved_test_amount_units')then raise exception 'STARS_TEST_CONTROL_IMMUTABLE'using errcode='42501';end if;
  update private.private_beta_stars_controls set configuration=v,program_generation=x.generation,revision=revision+1 where id=c.id;
 end if;
 insert into private.private_beta_observations(tenant_id,program_id,command_id,kind,scenario,outcome,note)values(t,p,extensions.gen_random_uuid(),'BOT_CONTROL','STARS_DEDICATED_TEST_CONTROL','NOTE','Dedicated Telegram test-network bot and explicit test price recorded; no financial authority.');
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'STARS_TEST_CONTROL_INVALID'using errcode='22023';end;$$;

create function public.private_beta_stars_binding_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare c private.private_beta_stars_controls;x private.private_beta_programs;users jsonb;repair_users jsonb;begin
 c:=private.private_beta_stars_guard(target_tenant_id,program_id_value);x:=private.private_beta_guard(target_tenant_id,program_id_value);
 select jsonb_agg(u->>'test_user_id'order by u->>'test_user_id')into users from jsonb_array_elements(c.configuration->'test_users')u
 where exists(select 1 from private.private_beta_participants a join public.conversations q on q.tenant_id=a.tenant_id and q.id=a.conversation_id where a.program_id=x.id and a.status='ACTIVE'and q.customer_id=(u->>'customer_id')::uuid);
 select jsonb_agg(u->>'test_user_id'order by u->>'test_user_id')into repair_users from jsonb_array_elements(c.configuration->'test_users')u;
 if users is null and repair_users is null then raise exception 'STARS_TEST_UNAVAILABLE'using errcode='42501';end if;
 return jsonb_build_object('version',1,'scope','TELEGRAM_STARS_PRIVATE_BETA_TEST','environment','TELEGRAM_DEDICATED_TEST','program_id',x.id,'tenant_id',x.tenant_id,
 'bot_user_id',c.configuration->>'bot_user_id','authority_record_id',c.id,'binding_revision',c.revision,'release_sha',x.configuration->>'repository_sha',
 'expires_at',c.configuration->>'expires_at','permitted_payers',coalesce(users,'[]'::jsonb),'revocable_payers',coalesce(repair_users,'[]'::jsonb),'approved_test_amount_units',c.configuration->>'approved_test_amount_units',
 'test_channel_id',c.configuration->'test_channel_id','allowed_operations',case when c.configuration->>'test_channel_id'is null then jsonb_build_array('getMe','sendInvoice','answerPreCheckoutQuery','getStarTransactions','refundStarPayment')else jsonb_build_array('getMe','sendInvoice','answerPreCheckoutQuery','getStarTransactions','refundStarPayment','getChat','getChatMember','createChatInviteLink','revokeChatInviteLink','approveChatJoinRequest','banChatMember','sendMessage')end);end;$$;
create function public.private_beta_stars_reserve_v1(target_tenant_id uuid,program_id_value uuid,binding_revision_value bigint,operation_value text,request_key_value text,effect_key_value text,request_hash_value text,dispatch_nonce_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.private_beta_stars_controls;a private.private_beta_stars_attempts;begin
 perform 1 from private.private_beta_programs where tenant_id=target_tenant_id and id=program_id_value for share;c:=private.private_beta_stars_guard(target_tenant_id,program_id_value);select * into c from private.private_beta_stars_controls where id=c.id for update;
 if binding_revision_value is null or c.revision<>binding_revision_value or operation_value is null or operation_value not in('getMe','sendInvoice','answerPreCheckoutQuery','getStarTransactions','refundStarPayment','getChat','getChatMember','createChatInviteLink','revokeChatInviteLink','approveChatJoinRequest','banChatMember','sendMessage')
 or request_key_value is null or request_key_value!~'^[A-Za-z0-9:_-]{1,120}$'or effect_key_value is null or effect_key_value!~'^[a-f0-9]{64}$'or request_hash_value is null or request_hash_value!~'^[a-f0-9]{64}$'or dispatch_nonce_value is null then raise exception 'STARS_TEST_DISPATCH_DENIED'using errcode='42501';end if;
 if operation_value in('getChat','getChatMember','createChatInviteLink','revokeChatInviteLink','approveChatJoinRequest','banChatMember','sendMessage')and c.configuration->>'test_channel_id'is null then raise exception 'STARS_TEST_CHANNEL_UNCONFIGURED'using errcode='42501';end if;
 select * into a from private.private_beta_stars_attempts where program_id=program_id_value and(request_key=request_key_value or effect_key=effect_key_value)order by ordinal limit 1;
 if a.id is not null then if a.request_hash<>request_hash_value or a.operation<>operation_value then raise exception 'STARS_TEST_REPLAY_CONFLICT'using errcode='23505';end if;return jsonb_build_object('attempt_id',a.id,'dispatch',false);end if;
 if c.request_count>=(c.configuration->>'maximum_calls')::int then raise exception 'STARS_TEST_BUDGET_EXHAUSTED'using errcode='42501';end if;
 if operation_value not in('getMe','getStarTransactions','getChat','getChatMember')and exists(select 1 from private.private_beta_stars_attempts aa left join private.private_beta_stars_outcomes o on o.attempt_id=aa.id where aa.program_id=program_id_value and aa.operation not in('getMe','getStarTransactions','getChat','getChatMember')and(o.attempt_id is null or o.state='UNKNOWN'))then raise exception 'STARS_TEST_UNRESOLVED_EFFECT'using errcode='42501';end if;
 insert into private.private_beta_stars_attempts(tenant_id,program_id,control_id,binding_revision,operation,request_key,effect_key,request_hash,dispatch_nonce,ordinal)
 values(target_tenant_id,program_id_value,c.id,c.revision,operation_value,request_key_value,effect_key_value,request_hash_value,dispatch_nonce_value,c.request_count+1)returning * into a;
 update private.private_beta_stars_controls set request_count=request_count+1 where id=c.id;
 return jsonb_build_object('attempt_id',a.id,'dispatch',true);end;$$;
create function public.private_beta_stars_record_attempt_v1(target_tenant_id uuid,program_id_value uuid,attempt_id_value uuid,dispatch_nonce_value uuid,raw_outcome_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a private.private_beta_stars_attempts;o private.private_beta_stars_outcomes;v jsonb;begin
 -- Outcomes remain recordable after stop/revision change; stopping cannot erase an uncertain external effect.
 select * into a from private.private_beta_stars_attempts where tenant_id=target_tenant_id and program_id=program_id_value and id=attempt_id_value for update;
 if a.id is null or a.dispatch_nonce is distinct from dispatch_nonce_value then raise exception 'STARS_TEST_DISPATCH_DENIED'using errcode='42501';end if;
 v:=private.fse_strict_json(raw_outcome_value);
 if coalesce(not private.fse_keys(v,array['attempt_id','state','provider_status','response_hash','financial_authority'])or v->>'attempt_id'<>a.id::text or v->>'financial_authority'is distinct from 'NONE'
 or v->>'state'not in('ACKNOWLEDGED','REJECTED','UNKNOWN')or v->>'provider_status'!~'^[0-9]{1,3}$'or(v->>'provider_status')::int>599
 or(v->'response_hash'is distinct from 'null'::jsonb and v->>'response_hash'!~'^[a-f0-9]{64}$')or(v->>'state'='ACKNOWLEDGED'and v->>'response_hash'is null),true)then raise exception 'STARS_TEST_OUTCOME_INVALID'using errcode='22023';end if;
 select * into o from private.private_beta_stars_outcomes where attempt_id=a.id;
 if o.attempt_id is not null then if o.state<>v->>'state'or o.provider_status<>(v->>'provider_status')::int or o.response_hash is distinct from v->>'response_hash'then raise exception 'STARS_TEST_OUTCOME_CONFLICT'using errcode='23505';end if;return jsonb_build_object('recorded',true,'replay',true);end if;
 insert into private.private_beta_stars_outcomes(attempt_id,tenant_id,state,provider_status,response_hash)values(a.id,a.tenant_id,v->>'state',(v->>'provider_status')::int,v->>'response_hash');
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(a.tenant_id,'SYSTEM','private_beta.stars_test_attempt','private_beta_stars_attempt',a.id::text,jsonb_build_object('operation',a.operation,'state',v->>'state','origin','TELEGRAM_DEDICATED_TEST','financial_authority','NONE'));
 return jsonb_build_object('recorded',true,'replay',false);end;$$;

create function public.private_beta_stars_invoice_v1(target_tenant_id uuid,program_id_value uuid,target_offer_id uuid,request_key_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.private_beta_stars_controls;x private.private_beta_programs;o public.commercial_offers;i public.payment_invoices;u jsonb;terms jsonb;iid uuid:=extensions.gen_random_uuid();begin
 perform 1 from private.private_beta_programs where tenant_id=target_tenant_id and id=program_id_value for share;c:=private.private_beta_stars_guard(target_tenant_id,program_id_value);x:=private.private_beta_guard(target_tenant_id,program_id_value);
 if request_key_value is null or request_key_value!~'^[A-Za-z0-9:_-]{1,120}$'then raise exception 'STARS_TEST_INVOICE_DENIED'using errcode='42501';end if;
 select * into o from public.commercial_offers where tenant_id=target_tenant_id and id=target_offer_id and status='approved'and expires_at>clock_timestamp()for update;
 select value into u from jsonb_array_elements(c.configuration->'test_users')where value->>'customer_id'=o.customer_id::text;
 select payload into terms from public.commercial_versions v join public.commercial_items item on item.id=v.item_id and item.tenant_id=v.tenant_id where v.tenant_id=target_tenant_id and v.id=o.plan_version_id and item.test_only;
 if o.id is null or u is null or terms->>'duration_unit'is distinct from 'fixed_days'or terms->>'duration_count'is distinct from '30'
 or not exists(select 1 from private.private_beta_participants a join public.conversations q on q.tenant_id=a.tenant_id and q.id=a.conversation_id where a.program_id=x.id and a.status='ACTIVE'and q.customer_id=o.customer_id)then raise exception 'STARS_TEST_INVOICE_DENIED'using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('stars-test-invoice:'||x.id::text||':'||request_key_value,0));
 select * into i from public.payment_invoices where tenant_id=target_tenant_id and idempotency_key=request_key_value;
 if i.id is not null then if i.offer_id<>o.id or i.quote_snapshot->>'origin'is distinct from 'TELEGRAM_DEDICATED_TEST'or i.amount_units<>(c.configuration->>'approved_test_amount_units')::numeric then raise exception 'STARS_TEST_INVOICE_CONFLICT'using errcode='23505';end if;
 else
  insert into public.payment_invoices(id,tenant_id,customer_id,offer_id,provider_id,provider_reference,channel,surface,amount_units,decimals,asset,network,recipient,payer_reference,min_confirmations,quote_snapshot,idempotency_key,expires_at,created_by)
  values(iid,target_tenant_id,o.customer_id,o.id,'telegram_stars_test','test:stars:'||iid::text,'telegram_stars','telegram_bot',(c.configuration->>'approved_test_amount_units')::numeric,0,'XTR','TELEGRAM_TEST','test:bot:'||(c.configuration->>'bot_user_id'),'test:'||(u->>'test_user_id'),1,
  jsonb_build_object('origin','TELEGRAM_DEDICATED_TEST','program_id',x.id,'control_id',c.id,'binding_revision',c.revision,'product_code','POLAT_VIP_30D_DRAFT','financial_authority','NONE','commercial_sales',false,'offer_snapshot',o.snapshot),request_key_value,least(o.expires_at,clock_timestamp()+interval '1 hour',(c.configuration->>'expires_at')::timestamptz),x.owner_user_id)returning * into i;
  insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(i.tenant_id,'SYSTEM','private_beta.stars_test_invoice','payment_invoices',i.id::text,jsonb_build_object('origin','TELEGRAM_DEDICATED_TEST','mode','test','financial_authority','NONE'));
 end if;
 return jsonb_build_object('version',1,'environment','TELEGRAM_DEDICATED_TEST','program_id',x.id,'tenant_id',i.tenant_id,'invoice_id',i.id,'bot_user_id',c.configuration->>'bot_user_id','payer_user_id',u->>'test_user_id','product_code','POLAT_VIP_30D_DRAFT','duration_days',30,'currency','XTR','amount_units',i.amount_units::text,'issued_at',i.created_at,'expires_at',i.expires_at);end;$$;

-- Preserve Phase11's accepted sandbox branch. Only independently configured dedicated Stars TEST scope is added.
create or replace function private.entitlement_test_tenant(t uuid)returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.tenants where id=t and slug like 'phase11-sandbox-%'and status='active'and not outbound_messaging_enabled)
 or exists(select 1 from private.private_beta_stars_controls c join private.private_beta_programs p on p.id=c.program_id and p.tenant_id=c.tenant_id join public.tenants n on n.id=c.tenant_id
 where c.tenant_id=t and n.slug like 'private-beta-%'and n.status='active'and not n.outbound_messaging_enabled and p.approved_at is not null and private.private_beta_live_window(p)
 and c.program_generation=p.generation and c.configuration->>'environment'='TELEGRAM_DEDICATED_TEST'and(c.configuration->>'expires_at')::timestamptz>clock_timestamp()
 and c.configuration->>'approved_test_amount_units'~'^[1-9][0-9]{0,15}$')
$$;
-- The existing fake worker never selects the newly distinguished dedicated TEST tenant.
create or replace function public.entitlement_ready_test_tenants()returns setof uuid language sql stable security definer set search_path=pg_catalog as $$
 select t.id from public.tenants t where private.entitlement_test_tenant(t.id)and not exists(select 1 from private.private_beta_stars_controls c where c.tenant_id=t.id)
 and exists(select 1 from public.subscriptions s where s.tenant_id=t.id and s.mode='test')limit 10
$$;
-- A direct legacy claim/completion cannot fabricate provider acknowledgement for a dedicated TEST receipt.
create function private.private_beta_stars_fake_effect_fence()returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare sid uuid;begin
 if tg_table_name='entitlement_jobs'then select subscription_id into sid from public.channel_access where id=new.access_id;
 else sid:=new.subscription_id;end if;
 if exists(select 1 from public.subscription_payments p join private.private_beta_stars_receipts r on r.tenant_id=p.tenant_id and r.invoice_id=p.test_invoice_id and r.kind='PAYMENT'where p.subscription_id=sid)
 and((tg_table_name='entitlement_jobs'and new.status='RUNNING')or(tg_table_name='channel_access'and new.status in('INVITED','MEMBER','REVOKED')))
 then
  if tg_table_name='entitlement_jobs'then
   if not exists(select 1 from private.private_beta_stars_access_leases l where l.job_id=new.id and l.lease_token=new.lease_token and l.writer_txid=txid_current())then raise exception 'STARS_TEST_PROVIDER_PROOF_REQUIRED'using errcode='42501';end if;
  elsif not exists(select 1 from private.private_beta_stars_access_proofs p where p.access_id=new.id and p.status=new.status and p.writer_txid=txid_current())then raise exception 'STARS_TEST_PROVIDER_PROOF_REQUIRED'using errcode='42501';end if;
 end if;
 return new;end;$$;
create trigger private_beta_stars_job_fake_fence before update on public.entitlement_jobs for each row when(new.status='RUNNING')execute function private.private_beta_stars_fake_effect_fence();
create trigger private_beta_stars_access_fake_fence before update on public.channel_access for each row when(new.status in('INVITED','MEMBER','REVOKED'))execute function private.private_beta_stars_fake_effect_fence();
create function private.private_beta_stars_simulation_fence()returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if exists(select 1 from public.payment_invoices where id=new.invoice_id and tenant_id=new.tenant_id and quote_snapshot->>'origin'='TELEGRAM_DEDICATED_TEST')then raise exception 'STARS_TEST_SIMULATION_DENIED'using errcode='42501';end if;return new;end;$$;
create trigger private_beta_stars_simulation_fence before insert on private.payment_test_snapshots for each row execute function private.private_beta_stars_simulation_fence();

create function public.private_beta_stars_history_v1(target_tenant_id uuid,program_id_value uuid,target_invoice_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare count_value integer;rows_value jsonb;begin
 perform private.private_beta_stars_guard(target_tenant_id,program_id_value);
 if not exists(select 1 from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and quote_snapshot->>'program_id'=program_id_value::text and quote_snapshot->>'origin'='TELEGRAM_DEDICATED_TEST')then raise exception 'STARS_TEST_UNAVAILABLE'using errcode='42501';end if;
 select count(*)into count_value from(select 1 from private.private_beta_stars_deliveries d join private.private_beta_stars_receipts r on r.id=d.receipt_id where r.invoice_id=target_invoice_id and r.tenant_id=target_tenant_id limit 101)s;
 if count_value>100 then raise exception 'STARS_TEST_HISTORY_INCOMPLETE'using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('tenant_id',r.tenant_id,'invoice_id',r.invoice_id,'operation_key',r.operation_key,'delivery_key',d.delivery_key,'raw_hash',d.raw_hash,'fact_hash',r.fact_hash,'kind',r.kind,'amount_units',r.amount_units::text)order by d.created_at,d.id),'[]'::jsonb)into rows_value from private.private_beta_stars_deliveries d join private.private_beta_stars_receipts r on r.id=d.receipt_id where r.invoice_id=target_invoice_id and r.tenant_id=target_tenant_id;
 return rows_value;end;$$;
create function public.private_beta_stars_record_evidence_v1(target_tenant_id uuid,program_id_value uuid,target_invoice_id uuid,ledger_attempt_id_value uuid,raw_evidence_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.private_beta_stars_controls;i public.payment_invoices;a private.private_beta_stars_attempts;v jsonb;e jsonb;l jsonb;t jsonb;candidate jsonb;r private.private_beta_stars_receipts;
 op text;delivery text;fact text;charge text;kind text;eid uuid;sid uuid;amount text;received_at timestamptz;d private.private_beta_stars_deliveries;begin
 perform 1 from private.private_beta_programs where tenant_id=target_tenant_id and id=program_id_value for share;c:=private.private_beta_stars_guard(target_tenant_id,program_id_value);select * into c from private.private_beta_stars_controls where id=c.id for update;
 v:=private.fse_strict_json(raw_evidence_value);
 if not private.fse_keys(v,array['event','ledger'])then raise exception 'STARS_TEST_EVIDENCE_INVALID'using errcode='22023';end if;e:=v->'event';l:=v->'ledger';
 select * into i from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and mode='test'and quote_snapshot->>'program_id'=program_id_value::text and quote_snapshot->>'origin'='TELEGRAM_DEDICATED_TEST'for update;
 select * into a from private.private_beta_stars_attempts where id=ledger_attempt_id_value and tenant_id=target_tenant_id and program_id=program_id_value and operation='getStarTransactions'and binding_revision=c.revision;
 if coalesce(i.id is null or a.id is null or a.started_at<clock_timestamp()-interval '5 minutes'or not exists(select 1 from private.private_beta_stars_outcomes where attempt_id=a.id and state='ACKNOWLEDGED'and response_hash=l->>'raw_hash')
 or not private.fse_keys(e,array['version','origin','kind','update_id','invoice_id','program_id','tenant_id','bot_user_id','amount_units','currency','charge_id','query_id','source_time','raw_hash','late'])
 or not private.fse_keys(l,array['version','origin','bot_user_id','read_at','raw_hash','complete','transactions'])
 or e->>'origin'is distinct from 'TELEGRAM_DEDICATED_TEST'or l->>'origin'is distinct from 'TELEGRAM_DEDICATED_TEST'or e->>'kind'not in('PAYMENT','REFUND')
 or e->>'invoice_id'<>i.id::text or e->>'tenant_id'<>i.tenant_id::text or e->>'program_id'<>program_id_value::text or e->>'bot_user_id'<>c.configuration->>'bot_user_id'or l->>'bot_user_id'<>e->>'bot_user_id'
 or e->>'currency'is distinct from 'XTR'or e->>'amount_units'is distinct from i.amount_units::text or e->>'raw_hash'!~'^[a-f0-9]{64}$'or e->>'update_id'!~'^[0-9]{1,16}$'
 or length(e->>'charge_id')not between 1 and 200 or l->'complete'is distinct from 'true'::jsonb or jsonb_typeof(l->'transactions')is distinct from 'array'or jsonb_array_length(l->'transactions')>25
 or(l->>'read_at')::timestamptz>clock_timestamp()+interval '1 minute'or(l->>'read_at')::timestamptz<clock_timestamp()-interval '5 minutes'
 or(e->>'source_time')::timestamptz>clock_timestamp()+interval '1 minute'or(e->>'source_time')::timestamptz<clock_timestamp()-interval '5 minutes',true)
 then raise exception 'STARS_TEST_EVIDENCE_INVALID'using errcode='22023';end if;
 if e->>'kind'='PAYMENT'and not exists(select 1 from jsonb_array_elements(c.configuration->'test_users')u join private.private_beta_participants part on part.program_id=program_id_value and part.status='ACTIVE'join public.conversations q on q.tenant_id=part.tenant_id and q.id=part.conversation_id where u->>'customer_id'=i.customer_id::text and q.customer_id=i.customer_id)then raise exception 'STARS_TEST_UNAVAILABLE'using errcode='42501';end if;
 for t in select value from jsonb_array_elements(l->'transactions')where value->>'charge_id'=e->>'charge_id'and value->>'kind'=e->>'kind'loop if candidate is not null then raise exception 'STARS_TEST_LEDGER_CONFLICT'using errcode='23505';end if;candidate:=t;end loop;
 if candidate is null then raise exception 'STARS_TEST_LEDGER_MISSING'using errcode='42501';end if;
 if coalesce(not private.fse_keys(candidate,array['charge_id','kind','payer_user_id','amount_units','source_time','invoice_payload'])or candidate->>'payer_user_id'<>substring(i.payer_reference from 6)or candidate->>'amount_units'<>i.amount_units::text
 or(candidate->>'invoice_payload'is not null and candidate->>'invoice_payload'<>'uat-stars:'||i.id::text)or abs(extract(epoch from((candidate->>'source_time')::timestamptz-(e->>'source_time')::timestamptz)))>300,true)then raise exception 'STARS_TEST_LEDGER_CONFLICT'using errcode='23505';end if;
 kind:=e->>'kind';charge:=e->>'charge_id';amount:=e->>'amount_units';received_at:=(e->>'source_time')::timestamptz;
 op:=private.fse_hash(private.fse_tuple('telegram-stars-test-operation',jsonb_build_array('TELEGRAM_DEDICATED_TEST',e->>'bot_user_id',kind,charge)));
 delivery:=private.fse_hash(private.fse_tuple('telegram-stars-test-delivery',jsonb_build_array('TELEGRAM_DEDICATED_TEST',e->>'bot_user_id',e->>'update_id')));
 fact:=private.fse_hash(private.fse_canonical(jsonb_build_object('version',1,'bot',e->>'bot_user_id','kind',kind,'charge',charge,'invoice','uat-stars:'||i.id::text,'payer',substring(i.payer_reference from 6),'units',amount,'currency','XTR')));
 perform pg_advisory_xact_lock(hashtextextended('stars-test-operation:'||op,0));
 select * into d from private.private_beta_stars_deliveries where delivery_key=delivery;
 if d.id is not null then
  select * into r from private.private_beta_stars_receipts where id=d.receipt_id;
  if r.operation_key<>op or r.tenant_id<>i.tenant_id or r.invoice_id<>i.id or d.raw_hash<>e->>'raw_hash'then raise exception 'STARS_TEST_OPERATION_CONFLICT'using errcode='23505';end if;
 end if;
 select * into r from private.private_beta_stars_receipts where operation_key=op;
 if r.id is not null then if r.tenant_id<>i.tenant_id or r.invoice_id<>i.id or r.operation_key<>op or r.fact_hash<>fact or(r.delivery_key=delivery and r.raw_hash<>e->>'raw_hash')then raise exception 'STARS_TEST_OPERATION_CONFLICT'using errcode='23505';end if;
  if d.id is null then insert into private.private_beta_stars_deliveries(tenant_id,receipt_id,delivery_key,bot_user_id,update_id,raw_hash,ledger_attempt_id)values(i.tenant_id,r.id,delivery,e->>'bot_user_id',e->>'update_id',e->>'raw_hash',a.id);end if;
  select subscription_id into sid from public.subscription_payments where test_invoice_id=i.id;return jsonb_build_object('recorded',true,'replay',true,'receipt_id',r.id,'subscription_id',sid,'mode','test','origin','TELEGRAM_DEDICATED_TEST','financial_authority','NONE');end if;
 if kind='PAYMENT'and(received_at>=i.expires_at or e->'late'is distinct from 'false'::jsonb or i.status in('REFUNDED','REVIEW','FAILED','EXPIRED')or exists(select 1 from private.private_beta_stars_receipts rr where rr.invoice_id=i.id and rr.kind='PAYMENT'))then raise exception 'STARS_TEST_PAYMENT_REVIEW_REQUIRED'using errcode='42501';end if;
 if kind='REFUND'and not exists(select 1 from private.private_beta_stars_receipts rr where rr.tenant_id=i.tenant_id and rr.invoice_id=i.id and rr.bot_user_id=e->>'bot_user_id'and rr.charge_id=charge and rr.kind='PAYMENT'and rr.amount_units=i.amount_units)then raise exception 'STARS_TEST_REFUND_ORIGINAL_REQUIRED'using errcode='42501';end if;
 eid:=private.append_domain_event(i.tenant_id,i.customer_id,'payment.test_observed',1,jsonb_build_object('payment_id',i.id,'mode','test','state',case kind when 'PAYMENT'then 'CONFIRMED'else 'REFUNDED'end,'origin','TELEGRAM_DEDICATED_TEST'),'SYSTEM',null,'payment_test_engine','TRUSTED',extensions.gen_random_uuid(),null,'stars-test:'||op,received_at);
 insert into private.private_beta_stars_receipts(tenant_id,program_id,invoice_id,bot_user_id,charge_id,kind,update_id,operation_key,delivery_key,raw_hash,fact_hash,amount_units,ledger_attempt_id,ledger_hash,event_id,source_time)
 values(i.tenant_id,program_id_value,i.id,e->>'bot_user_id',charge,kind,e->>'update_id',op,delivery,e->>'raw_hash',fact,i.amount_units,a.id,l->>'raw_hash',eid,received_at)returning * into r;
 insert into private.private_beta_stars_deliveries(tenant_id,receipt_id,delivery_key,bot_user_id,update_id,raw_hash,ledger_attempt_id)values(i.tenant_id,r.id,delivery,e->>'bot_user_id',e->>'update_id',e->>'raw_hash',a.id);
 update public.payment_invoices set status=case kind when 'PAYMENT'then 'CONFIRMED'else 'REFUNDED'end,last_evidence_at=greatest(last_evidence_at,received_at),confirmed_at=case kind when 'PAYMENT'then coalesce(confirmed_at,clock_timestamp())else confirmed_at end where id=i.id;
 if kind='PAYMENT'then
  insert into public.payment_transactions(tenant_id,invoice_id,provider_id,network,transaction_reference)values(i.tenant_id,i.id,'telegram_stars_test','TELEGRAM_TEST','test:stars:'||op);
  sid:=private.entitlement_apply(i.tenant_id,i.id,'test');
 else
  -- Exactly this TEST period is fenced in the receipt transaction; a busy tenant-wide maintenance cycle cannot postpone refund suppression.
  select subscription_id into sid from public.subscription_payments where test_invoice_id=i.id;
  if sid is not null then
   update public.subscriptions set state=case when state in('ACTIVE','RENEWAL_DUE')then 'SUSPENDED'else state end,revision=revision+1 where id=sid and tenant_id=i.tenant_id and mode='test';
   update public.channel_access set status='REVIEW',invite_expires_at=least(invite_expires_at,clock_timestamp())where subscription_id=sid and tenant_id=i.tenant_id and mode='test';
   perform private.entitlement_enqueue(sid,'revoke');perform private.entitlement_audit_record(sid,'stars_test_refund_hold',jsonb_build_object('receipt_id',r.id,'origin','TELEGRAM_DEDICATED_TEST'));
  end if;
 end if;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(i.tenant_id,'SYSTEM','private_beta.stars_test_receipt','payment_invoices',i.id::text,jsonb_build_object('origin','TELEGRAM_DEDICATED_TEST','kind',kind,'mode','test','financial_authority','NONE','receipt_id',r.id));
 return jsonb_build_object('recorded',true,'replay',false,'receipt_id',r.id,'subscription_id',sid,'mode','test','origin','TELEGRAM_DEDICATED_TEST','financial_authority','NONE');
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'STARS_TEST_EVIDENCE_INVALID'using errcode='22023';end;$$;

create function public.private_beta_stars_bind_access_v1(target_tenant_id uuid,program_id_value uuid,target_invoice_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.private_beta_stars_controls;r private.private_beta_stars_receipts;i public.payment_invoices;bid uuid;sid uuid;aid uuid;begin
 perform 1 from private.private_beta_programs where tenant_id=target_tenant_id and id=program_id_value for share;c:=private.private_beta_stars_guard(target_tenant_id,program_id_value);
 if c.configuration->>'test_channel_id'is null then raise exception 'STARS_TEST_CHANNEL_UNCONFIGURED'using errcode='42501';end if;
 select * into r from private.private_beta_stars_receipts where tenant_id=target_tenant_id and program_id=program_id_value and invoice_id=target_invoice_id and kind='PAYMENT';
 select * into i from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and status='CONFIRMED';
 select subscription_id into sid from public.subscription_payments where tenant_id=target_tenant_id and test_invoice_id=target_invoice_id and mode='test';
 if r.id is null or i.id is null or sid is null or not exists(select 1 from private.private_beta_participants part join public.conversations q on q.tenant_id=part.tenant_id and q.id=part.conversation_id where part.program_id=program_id_value and part.status='ACTIVE'and q.customer_id=i.customer_id)then raise exception 'STARS_TEST_RECEIPT_REQUIRED'using errcode='42501';end if;
 insert into public.telegram_entitlement_bindings(tenant_id,customer_id,mode,telegram_user_id,source_event_id)values(i.tenant_id,i.customer_id,'test',i.payer_reference,r.event_id)on conflict(tenant_id,customer_id,mode)do nothing;
 select id into bid from public.telegram_entitlement_bindings where tenant_id=i.tenant_id and customer_id=i.customer_id and mode='test'and telegram_user_id=i.payer_reference;
 if bid is null then raise exception 'STARS_TEST_IDENTITY_CONFLICT'using errcode='23505';end if;
 insert into public.vip_channels(tenant_id,mode,chat_id,enabled,private_verified)values(i.tenant_id,'test','test:'||(c.configuration->>'test_channel_id'),true,true)on conflict(tenant_id,mode)do nothing;
 if not exists(select 1 from public.vip_channels where tenant_id=i.tenant_id and mode='test'and chat_id='test:'||(c.configuration->>'test_channel_id')and private_verified and enabled)then raise exception 'STARS_TEST_CHANNEL_CONFLICT'using errcode='23505';end if;
 aid:=private.entitlement_request_access(i.tenant_id,sid);return jsonb_build_object('access_id',aid,'mode','test','origin','TELEGRAM_DEDICATED_TEST','financial_authority','NONE');end;$$;
create function public.private_beta_stars_access_claim_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.private_beta_stars_controls;j public.entitlement_jobs;s public.subscriptions;a public.channel_access;b public.telegram_entitlement_bindings;v public.vip_channels;l private.private_beta_stars_access_leases;oldlink text;processed integer:=0;begin
 perform 1 from private.private_beta_programs where tenant_id=target_tenant_id and id=program_id_value for share;c:=private.private_beta_stars_guard(target_tenant_id,program_id_value);select *into c from private.private_beta_stars_controls where id=c.id for update;
 if c.configuration->>'test_channel_id'is null then raise exception 'STARS_TEST_CHANNEL_UNCONFIGURED'using errcode='42501';end if;
 for processed in 1..12 loop
  select jj.*into j from public.entitlement_jobs jj join public.channel_access aa on aa.tenant_id=jj.tenant_id and aa.id=jj.access_id
  where jj.tenant_id=target_tenant_id and jj.available_at<=clock_timestamp()and(jj.status='PENDING'or(jj.status='RUNNING'and jj.lease_until<=clock_timestamp()))
  and exists(select 1 from public.subscription_payments pp join private.private_beta_stars_receipts rr on rr.tenant_id=pp.tenant_id and rr.invoice_id=pp.test_invoice_id and rr.kind='PAYMENT'where pp.subscription_id=aa.subscription_id and rr.program_id=program_id_value)
  order by case jj.operation when 'revoke'then 0 when 'reconcile'then 1 else 2 end,jj.available_at,jj.id for update of jj skip locked limit 1;
  if j.id is null then return jsonb_build_object('job',null,'processed',processed-1,'has_more',false);end if;
  select *into a from public.channel_access where id=j.access_id;select *into s from public.subscriptions where id=a.subscription_id for update;
  if j.status='RUNNING'then update public.entitlement_jobs set status='FAILED',last_error='STARS_TEST_UNKNOWN_LEASE',lease_token=null,lease_until=null where id=j.id;update public.channel_access set status='REVIEW'where id=a.id;perform private.entitlement_audit_record(s.id,'stars_test_unknown_lease',jsonb_build_object('job_id',j.id,'obligation','REVIEW_REQUIRED'));continue;end if;
  if j.revision<>s.revision or(j.operation in('invite','join')and(s.state not in('ACTIVE','RENEWAL_DUE')or s.grace_until<=clock_timestamp()
  or exists(select 1 from public.subscription_payments pp join public.payment_invoices ii on ii.tenant_id=pp.tenant_id and ii.id=pp.test_invoice_id where pp.subscription_id=s.id and ii.status<>'CONFIRMED')
  or not exists(select 1 from private.private_beta_participants part join public.conversations q on q.tenant_id=part.tenant_id and q.id=part.conversation_id where part.program_id=program_id_value and part.status='ACTIVE'and q.customer_id=s.customer_id)))then
   update public.entitlement_jobs set status='STALE',last_error='SOURCE_REVISION_STALE'where id=j.id;
   if j.operation='revoke'or s.state not in('ACTIVE','RENEWAL_DUE')or s.grace_until<=clock_timestamp()then perform private.entitlement_enqueue(s.id,'revoke');end if;continue;end if;
  select *into b from public.telegram_entitlement_bindings where id=a.binding_id;select *into v from public.vip_channels where id=a.channel_id;
  if s.mode<>'test'or a.mode<>'test'or b.mode<>'test'or v.mode<>'test'or b.telegram_user_id!~'^test:[1-9][0-9]{0,15}$'or v.chat_id<>'test:'||(c.configuration->>'test_channel_id')then raise exception 'STARS_TEST_ACCESS_SCOPE_DENIED'using errcode='42501';end if;
  insert into private.private_beta_stars_access_leases(tenant_id,program_id,job_id,lease_token,subscription_revision,program_generation,binding_revision,expires_at)
  values(target_tenant_id,program_id_value,j.id,extensions.gen_random_uuid(),s.revision,c.program_generation,c.revision,clock_timestamp()+interval '60 seconds')returning *into l;
  update public.entitlement_jobs set status='RUNNING',attempts=attempts+1,lease_token=l.lease_token,lease_until=l.expires_at where id=j.id;
  select invite_reference into oldlink from private.private_beta_stars_access_proofs where access_id=a.id and status='INVITED'order by created_at desc limit 1;
  return jsonb_build_object('job',jsonb_build_object('version',1,'program_id',program_id_value,'tenant_id',target_tenant_id,'job_id',j.id,'lease_token',l.lease_token,'operation',j.operation,'revision',s.revision,
  'payer_user_id',substring(b.telegram_user_id from 6),'channel_id',c.configuration->>'test_channel_id','invite_reference',oldlink,'invite_expires_at',least(s.grace_until,clock_timestamp()+interval '900 seconds'),'subscription_active',s.state in('ACTIVE','RENEWAL_DUE')and s.grace_until>clock_timestamp()),'processed',processed-1,'has_more',true);
 end loop;return jsonb_build_object('job',null,'processed',12,'has_more',true);end;$$;
create function public.private_beta_stars_access_complete_v1(target_tenant_id uuid,program_id_value uuid,job_id_value uuid,lease_token_value uuid,raw_outcome_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.private_beta_stars_controls;l private.private_beta_stars_access_leases;j public.entitlement_jobs;a public.channel_access;s public.subscriptions;p jsonb;primary_id uuid;verify_id uuid;method text;status_value text;ref text;expiry timestamptz;begin
 perform 1 from private.private_beta_programs where tenant_id=target_tenant_id and id=program_id_value for share;
 select *into c from private.private_beta_stars_controls where tenant_id=target_tenant_id and program_id=program_id_value for update;
 select *into l from private.private_beta_stars_access_leases where tenant_id=target_tenant_id and program_id=program_id_value and job_id=job_id_value and lease_token=lease_token_value;
 select *into j from public.entitlement_jobs where tenant_id=target_tenant_id and id=job_id_value for update;
 if l.id is null or j.id is null or j.status<>'RUNNING'or j.lease_token is distinct from lease_token_value then raise exception 'STARS_TEST_ACCESS_LEASE_DENIED'using errcode='42501';end if;
 select *into a from public.channel_access where id=j.access_id;select *into s from public.subscriptions where id=a.subscription_id for update;p:=private.fse_strict_json(raw_outcome_value);
 if not private.fse_keys(p,array['origin','status','primary_attempt_id','verification_attempt_id','invite_reference','expires_at','membership'])or p->>'origin'is distinct from 'TELEGRAM_DEDICATED_TEST'or p->>'status'not in('INVITED','MEMBER','REVOKED','REVIEW','UNKNOWN')then raise exception 'STARS_TEST_ACCESS_PROOF_INVALID'using errcode='22023';end if;
 if p->>'status'='UNKNOWN'or l.expires_at<=clock_timestamp()or l.subscription_revision<>s.revision or c.program_generation<>l.program_generation or c.revision<>l.binding_revision
 or(j.operation in('invite','join')and(s.state not in('ACTIVE','RENEWAL_DUE')or s.grace_until<=clock_timestamp()or exists(select 1 from public.subscription_payments pp join public.payment_invoices ii on ii.tenant_id=pp.tenant_id and ii.id=pp.test_invoice_id where pp.subscription_id=s.id and ii.status<>'CONFIRMED')))
 or not exists(select 1 from private.private_beta_programs x where x.id=program_id_value and x.generation=l.program_generation and private.private_beta_live_window(x))then
  update public.entitlement_jobs set status='FAILED',last_error='STARS_TEST_UNKNOWN_OR_STALE_EFFECT',lease_token=null,lease_until=null where id=j.id;update public.channel_access set status='REVIEW'where id=a.id;perform private.entitlement_audit_record(s.id,'stars_test_unknown_access',jsonb_build_object('job_id',j.id,'obligation','REVIEW_REQUIRED'));return jsonb_build_object('recorded',true,'status','REVIEW','effect_known',false);end if;
 primary_id:=(p->>'primary_attempt_id')::uuid;verify_id:=(p->>'verification_attempt_id')::uuid;method:=case j.operation when 'invite'then 'createChatInviteLink'when 'join'then 'approveChatJoinRequest'when 'revoke'then 'banChatMember'else 'getChatMember'end;
 if not exists(select 1 from private.private_beta_stars_attempts aa join private.private_beta_stars_outcomes oo on oo.attempt_id=aa.id where aa.tenant_id=target_tenant_id and aa.program_id=program_id_value and aa.id=primary_id and aa.operation=method and aa.binding_revision=c.revision and oo.state='ACKNOWLEDGED'
 and aa.effect_key=private.fse_hash(private.fse_tuple('telegram-stars-test-dispatch',jsonb_build_array(program_id_value::text,c.configuration->>'bot_user_id',method,j.id::text))))then raise exception 'STARS_TEST_ACCESS_PROOF_INVALID'using errcode='42501';end if;
 if j.operation='invite'then
  ref:=p->>'invite_reference';expiry:=(p->>'expires_at')::timestamptz;
  if p->>'status'<>'INVITED'or ref is null or ref!~'^https://t.me/\+[A-Za-z0-9_-]{1,200}$'or expiry is null or expiry<=clock_timestamp()or expiry>least(s.grace_until,clock_timestamp()+interval '901 seconds')then raise exception 'STARS_TEST_ACCESS_PROOF_INVALID'using errcode='22023';end if;status_value:='INVITED';
 else
  if not exists(select 1 from private.private_beta_stars_attempts aa join private.private_beta_stars_outcomes oo on oo.attempt_id=aa.id where aa.tenant_id=target_tenant_id and aa.program_id=program_id_value and aa.id=verify_id and aa.operation='getChatMember'and aa.binding_revision=c.revision and oo.state='ACKNOWLEDGED'
  and aa.effect_key=private.fse_hash(private.fse_tuple('telegram-stars-test-dispatch',jsonb_build_array(program_id_value::text,c.configuration->>'bot_user_id','getChatMember',j.id::text))))then raise exception 'STARS_TEST_ACCESS_PROOF_INVALID'using errcode='42501';end if;
  if j.operation='revoke'then if p->>'status'<>'REVOKED'or p->>'membership'not in('left','kicked')then raise exception 'STARS_TEST_ACCESS_PROOF_INVALID'using errcode='22023';end if;status_value:='REVOKED';
  elsif p->>'status'='MEMBER'and p->>'membership'='member'and s.state in('ACTIVE','RENEWAL_DUE')and s.grace_until>clock_timestamp()then status_value:='MEMBER';
  else status_value:='REVIEW';if p->>'membership'='member'then perform private.entitlement_enqueue(s.id,'revoke');end if;end if;
 end if;
 insert into private.private_beta_stars_access_proofs(tenant_id,program_id,job_id,access_id,status,primary_attempt_id,verification_attempt_id,invite_reference,invite_expires_at)
 values(target_tenant_id,program_id_value,j.id,a.id,status_value,primary_id,verify_id,ref,expiry);
 update public.channel_access set status=status_value,invite_reference=case when status_value='INVITED'then 'test:invite:'||private.fse_hash(ref)else null end,invite_expires_at=expiry,membership_checked_at=case when status_value<>'INVITED'then clock_timestamp()else membership_checked_at end where id=a.id;
 update public.entitlement_jobs set status='DONE',lease_token=null,lease_until=null,last_error=null where id=j.id;perform private.entitlement_audit_record(s.id,'stars_test_access_'||lower(status_value),jsonb_build_object('job_id',j.id,'origin','TELEGRAM_DEDICATED_TEST','financial_authority','NONE'));
 return jsonb_build_object('recorded',true,'status',status_value,'effect_known',true);end;$$;
create function public.private_beta_stars_join_request_v1(target_tenant_id uuid,program_id_value uuid,user_id_value text,channel_id_value text,invite_hash_value text,source_hash_value text,source_time_value timestamptz)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.private_beta_stars_controls;aid uuid;begin
 c:=private.private_beta_stars_guard(target_tenant_id,program_id_value);
 if channel_id_value is distinct from c.configuration->>'test_channel_id'or user_id_value!~'^[1-9][0-9]{0,15}$'or invite_hash_value!~'^[a-f0-9]{64}$'or source_hash_value!~'^[a-f0-9]{64}$'or source_time_value>clock_timestamp()+interval '1 minute'or source_time_value<clock_timestamp()-interval '5 minutes'then raise exception 'STARS_TEST_JOIN_DENIED'using errcode='42501';end if;
 select a.id into aid from public.channel_access a join public.telegram_entitlement_bindings b on b.id=a.binding_id join public.vip_channels v on v.id=a.channel_id join public.subscriptions s on s.id=a.subscription_id
 where a.tenant_id=target_tenant_id and a.mode='test'and a.status='INVITED'and a.invite_reference='test:invite:'||invite_hash_value and a.invite_expires_at>clock_timestamp()and b.telegram_user_id='test:'||user_id_value and v.chat_id='test:'||channel_id_value and s.state in('ACTIVE','RENEWAL_DUE')and s.grace_until>clock_timestamp()
 and exists(select 1 from private.private_beta_participants part join public.conversations q on q.tenant_id=part.tenant_id and q.id=part.conversation_id where part.program_id=program_id_value and part.status='ACTIVE'and q.customer_id=s.customer_id);
 if aid is null or not exists(select 1 from private.private_beta_stars_access_proofs where access_id=aid and status='INVITED'and private.fse_hash(invite_reference)=invite_hash_value)then raise exception 'STARS_TEST_JOIN_DENIED'using errcode='42501';end if;
 perform public.entitlement_join_request(target_tenant_id,aid,'test:'||user_id_value,'test:invite:'||invite_hash_value);
 return jsonb_build_object('queued',true,'mode','test','origin','TELEGRAM_DEDICATED_TEST');end;$$;
create function public.private_beta_stars_invoice_read_v1(target_tenant_id uuid,program_id_value uuid,target_invoice_id uuid,payer_user_id_value text)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare c private.private_beta_stars_controls;i public.payment_invoices;begin
 c:=private.private_beta_stars_guard(target_tenant_id,program_id_value);
 select *into i from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and mode='test'and quote_snapshot->>'origin'='TELEGRAM_DEDICATED_TEST'and quote_snapshot->>'program_id'=program_id_value::text and payer_reference='test:'||payer_user_id_value;
 if i.id is null then raise exception 'STARS_TEST_UNAVAILABLE'using errcode='42501';end if;
 return jsonb_build_object('version',1,'environment','TELEGRAM_DEDICATED_TEST','program_id',program_id_value,'tenant_id',i.tenant_id,'invoice_id',i.id,'bot_user_id',c.configuration->>'bot_user_id','payer_user_id',payer_user_id_value,'product_code','POLAT_VIP_30D_DRAFT','duration_days',30,'currency','XTR','amount_units',i.amount_units::text,'issued_at',i.created_at,'expires_at',i.expires_at);end;$$;
create function public.admin_private_beta_stars_invoice_scope_v1(target_tenant_id uuid,program_id_value uuid,approved_offer_id_value uuid,command_id_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x private.private_beta_programs;c private.private_beta_stars_controls;o public.commercial_offers;iid uuid;begin
 perform private.private_beta_admin(target_tenant_id,true);perform private.private_beta_mfa_at();x:=private.private_beta_guard(target_tenant_id,program_id_value);
 if x.owner_user_id is distinct from auth.uid()or command_id_value is null then raise exception 'STARS_TEST_OWNER_REQUIRED'using errcode='42501';end if;
 c:=private.private_beta_stars_guard(target_tenant_id,program_id_value);
 select *into o from public.commercial_offers where tenant_id=target_tenant_id and id=approved_offer_id_value and status='approved'and expires_at>clock_timestamp();
 if o.id is null or not exists(select 1 from private.private_beta_participants a join public.conversations q on q.tenant_id=a.tenant_id and q.id=a.conversation_id join jsonb_array_elements(c.configuration->'test_users')u on(u->>'customer_id')::uuid=q.customer_id
 where a.program_id=program_id_value and a.status='ACTIVE'and q.customer_id=o.customer_id)then raise exception 'STARS_TEST_INVOICE_DENIED'using errcode='42501';end if;
 select id into iid from public.payment_invoices where tenant_id=target_tenant_id and idempotency_key=command_id_value::text and quote_snapshot->>'origin'='TELEGRAM_DEDICATED_TEST'and quote_snapshot->>'program_id'=program_id_value::text;
 insert into private.private_beta_observations(tenant_id,program_id,command_id,kind,scenario,outcome,note,actor_id)values(target_tenant_id,program_id_value,command_id_value,'BOT_CONTROL','STARS_TEST_INVOICE_OWNER_REQUEST','NOTE','Fresh-MFA owner requested one dedicated Telegram TEST invoice using the verified server-owned price and tester binding.',auth.uid())on conflict(tenant_id,command_id)do nothing;
 return jsonb_build_object('tenant_id',target_tenant_id,'program_id',program_id_value,'approved_offer_id',approved_offer_id_value,'command_id',command_id_value,'repository_sha',x.configuration->>'repository_sha','already_created',iid is not null,'invoice_id',iid);end;$$;
create function public.admin_private_beta_stars_evidence_v1(target_tenant_id uuid,target_invoice_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare rows_value jsonb;jobs_value jsonb;sub_value jsonb;sub_id uuid;more_receipts boolean;more_jobs boolean;technical boolean;begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[])or not exists(select 1 from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and mode='test'and quote_snapshot->>'origin'='TELEGRAM_DEDICATED_TEST')then raise exception 'STARS_TEST_UNAVAILABLE'using errcode='42501';end if;
 technical:=private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]);
 with source as materialized(select id,kind,amount_units,created_at,source_time,raw_hash,ledger_hash from private.private_beta_stars_receipts where tenant_id=target_tenant_id and invoice_id=target_invoice_id order by created_at desc,id desc limit 26)
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind',s.kind,'amount_units',s.amount_units::text,'currency','XTR','recorded_at',s.created_at,'source_time',s.source_time,
 'source_hash',case when technical then s.raw_hash end,'ledger_hash',case when technical then s.ledger_hash end)order by s.created_at desc,s.id desc),'[]'::jsonb),(select count(*)>25 from source)
 into rows_value,more_receipts from(select *from source order by created_at desc,id desc limit 25)s;
 select subscription_id into sub_id from public.subscription_payments where tenant_id=target_tenant_id and test_invoice_id=target_invoice_id and mode='test';
 select jsonb_build_object('id',id,'state',state,'mode','test')into sub_value from public.subscriptions where tenant_id=target_tenant_id and id=sub_id and mode='test';
 with source as materialized(select j.id,j.operation,j.status,j.available_at from public.entitlement_jobs j join public.channel_access a on a.id=j.access_id and a.tenant_id=j.tenant_id where j.tenant_id=target_tenant_id and a.subscription_id=sub_id order by j.available_at desc,j.id desc limit 26)
 select coalesce(jsonb_agg(jsonb_build_object('operation',j.operation,'status',j.status)order by j.available_at desc,j.id desc),'[]'::jsonb),(select count(*)>25 from source)
 into jobs_value,more_jobs from(select *from source order by available_at desc,id desc limit 25)j;
 return jsonb_build_object('version',1,'invoice_id',target_invoice_id,'mode','test','origin','TELEGRAM_DEDICATED_TEST','financial_authority','NONE','receipts',rows_value,'subscription',sub_value,'jobs',jobs_value,'page_size',25,'has_more_receipts',more_receipts,'has_more_jobs',more_jobs);end;$$;
create function public.private_beta_stars_ingress_claim_v1(target_tenant_id uuid,program_id_value uuid,update_id_value text,raw_hash_value text,nonce_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.private_beta_stars_controls;i private.private_beta_stars_ingress;begin
 c:=private.private_beta_stars_guard(target_tenant_id,program_id_value);
 if update_id_value is null or update_id_value!~'^[0-9]{1,16}$'or raw_hash_value is null or raw_hash_value!~'^[a-f0-9]{64}$'or nonce_value is null then raise exception 'STARS_TEST_INGRESS_DENIED'using errcode='42501';end if;
 insert into private.private_beta_stars_ingress(tenant_id,program_id,bot_user_id,update_id,raw_hash,nonce)values(target_tenant_id,program_id_value,c.configuration->>'bot_user_id',update_id_value,raw_hash_value,nonce_value)on conflict(bot_user_id,update_id)do nothing;
 select *into i from private.private_beta_stars_ingress where bot_user_id=c.configuration->>'bot_user_id'and update_id=update_id_value for update;
 if i.tenant_id<>target_tenant_id or i.program_id<>program_id_value or i.raw_hash<>raw_hash_value then raise exception 'STARS_TEST_INGRESS_CONFLICT'using errcode='23505';end if;
 if i.nonce=nonce_value then insert into private.private_beta_observations(tenant_id,program_id,command_id,kind,scenario,outcome,note)values(target_tenant_id,program_id_value,extensions.gen_random_uuid(),'BOT_CONTROL','STARS_TEST_INBOUND_PENDING','NOTE','Authenticated dedicated TEST update captured; outcome pending and no paid-model call authorized.');end if;
 return jsonb_build_object('dispatch',i.nonce=nonce_value,'state',i.state,'ingress_id',i.id);end;$$;
create function public.private_beta_stars_ingress_complete_v1(target_tenant_id uuid,program_id_value uuid,ingress_id_value uuid,nonce_value uuid,state_value text,reason_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare i private.private_beta_stars_ingress;begin
 select *into i from private.private_beta_stars_ingress where id=ingress_id_value and tenant_id=target_tenant_id and program_id=program_id_value and nonce=nonce_value for update;
 if i.id is null or state_value is null or state_value not in('COMPLETE','REVIEW')or reason_value is null or reason_value!~'^[A-Z_]{1,80}$'then raise exception 'STARS_TEST_INGRESS_DENIED'using errcode='42501';end if;
 if i.state<>'PENDING'then if i.state<>state_value or i.reason_code<>reason_value then raise exception 'STARS_TEST_INGRESS_CONFLICT'using errcode='23505';end if;return jsonb_build_object('recorded',true);end if;
 update private.private_beta_stars_ingress set state=state_value,reason_code=reason_value,completed_at=clock_timestamp()where id=i.id;
 insert into private.private_beta_observations(tenant_id,program_id,command_id,kind,scenario,outcome,note)values(target_tenant_id,program_id_value,extensions.gen_random_uuid(),'BOT_CONTROL','STARS_TEST_'||reason_value,case state_value when 'COMPLETE'then 'NOTE'else 'BLOCKED'end,case state_value when 'COMPLETE'then 'Dedicated TEST update processed; no genuine financial authority.'else 'Dedicated TEST update requires operator review; no automatic replay or fabricated completion.'end);
 return jsonb_build_object('recorded',true);end;$$;

revoke all on function private.private_beta_stars_guard(uuid,uuid),private.private_beta_stars_control_record(uuid,uuid,text),private.private_beta_stars_fake_effect_fence(),private.private_beta_stars_simulation_fence()from public,anon,authenticated,service_role;
revoke all on function public.private_beta_stars_binding_v1(uuid,uuid),public.private_beta_stars_reserve_v1(uuid,uuid,bigint,text,text,text,text,uuid),public.private_beta_stars_record_attempt_v1(uuid,uuid,uuid,uuid,text),public.private_beta_stars_invoice_v1(uuid,uuid,uuid,text),public.private_beta_stars_history_v1(uuid,uuid,uuid),public.private_beta_stars_record_evidence_v1(uuid,uuid,uuid,uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.private_beta_stars_binding_v1(uuid,uuid),public.private_beta_stars_reserve_v1(uuid,uuid,bigint,text,text,text,text,uuid),public.private_beta_stars_record_attempt_v1(uuid,uuid,uuid,uuid,text),public.private_beta_stars_invoice_v1(uuid,uuid,uuid,text),public.private_beta_stars_history_v1(uuid,uuid,uuid),public.private_beta_stars_record_evidence_v1(uuid,uuid,uuid,uuid,text)to service_role;
revoke all on function public.private_beta_stars_bind_access_v1(uuid,uuid,uuid),public.private_beta_stars_access_claim_v1(uuid,uuid),public.private_beta_stars_access_complete_v1(uuid,uuid,uuid,uuid,text),public.private_beta_stars_join_request_v1(uuid,uuid,text,text,text,text,timestamptz)from public,anon,authenticated,service_role;
grant execute on function public.private_beta_stars_bind_access_v1(uuid,uuid,uuid),public.private_beta_stars_access_claim_v1(uuid,uuid),public.private_beta_stars_access_complete_v1(uuid,uuid,uuid,uuid,text),public.private_beta_stars_join_request_v1(uuid,uuid,text,text,text,text,timestamptz)to service_role;
revoke all on function public.private_beta_stars_invoice_read_v1(uuid,uuid,uuid,text),public.private_beta_stars_ingress_claim_v1(uuid,uuid,text,text,uuid),public.private_beta_stars_ingress_complete_v1(uuid,uuid,uuid,uuid,text,text)from public,anon,authenticated,service_role;
grant execute on function public.private_beta_stars_invoice_read_v1(uuid,uuid,uuid,text),public.private_beta_stars_ingress_claim_v1(uuid,uuid,text,text,uuid),public.private_beta_stars_ingress_complete_v1(uuid,uuid,uuid,uuid,text,text)to service_role;
revoke all on function public.admin_private_beta_stars_invoice_scope_v1(uuid,uuid,uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.admin_private_beta_stars_invoice_scope_v1(uuid,uuid,uuid,uuid)to authenticated;
revoke all on function public.admin_private_beta_stars_evidence_v1(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.admin_private_beta_stars_evidence_v1(uuid,uuid)to authenticated;
