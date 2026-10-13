-- Owner-authorized Phase 10 clarification. Test interfaces only; live financial
-- events, customer lifecycle changes, subscriptions and access are prohibited.
create table private.payment_adapter_registry (
 id text primary key, channel text not null check(channel in ('telegram_stars','external_crypto')),
 mode text not null check(mode='test'), rules jsonb not null
);
insert into private.payment_adapter_registry values
 ('telegram_stars_test','telegram_stars','test','{"XTR":{"network":"TELEGRAM","decimals":0,"confirmations":1}}'),
 ('external_crypto_test','external_crypto','test','{"USDT":{"network":"TRON","decimals":6,"confirmations":20},"USDC":{"network":"ETHEREUM","decimals":6,"confirmations":12}}');
revoke all on private.payment_adapter_registry from public,anon,authenticated;
grant select on private.payment_adapter_registry to service_role;

create table public.payment_invoices (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 customer_id uuid not null, offer_id uuid not null, provider_id text not null references private.payment_adapter_registry(id),
 provider_reference text not null unique check(provider_reference~'^test:[A-Za-z0-9:_-]+$'),
 channel text not null check(channel in ('telegram_stars','external_crypto')),
 surface text not null check(surface in ('telegram_bot','telegram_mini_app','independent_web')),
 mode text not null default 'test' check(mode='test'),
 amount_units numeric(30,0) not null check(amount_units>0), decimals int not null check(decimals between 0 and 18),
 asset text not null, network text not null, recipient text not null check(recipient~'^test:'),
 payer_reference text not null check(payer_reference~'^test:'),
 min_confirmations int not null check(min_confirmations between 1 and 10000),
 status text not null default 'CREATED' check(status in ('CREATED','PENDING','CONFIRMED','FAILED','EXPIRED','REFUNDED','REVIEW')),
 quote_snapshot jsonb not null, idempotency_key text not null check(char_length(idempotency_key) between 1 and 120),
 expires_at timestamptz not null, created_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id), last_evidence_at timestamptz, confirmed_at timestamptz,
 reconciliation_count int not null default 0,
 unique(tenant_id,id),unique(tenant_id,idempotency_key),
 foreign key(tenant_id,customer_id) references public.customers(tenant_id,id),
 foreign key(tenant_id,offer_id) references public.commercial_offers(tenant_id,id),
 check((channel='external_crypto' and surface='independent_web') or (channel='telegram_stars' and surface in ('telegram_bot','telegram_mini_app')))
);
create index payment_invoices_tenant_created_idx on public.payment_invoices(tenant_id,created_at desc);
create table private.payment_test_snapshots (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,invoice_id uuid not null,
 request_key text not null,scenario text not null,snapshot jsonb not null,
 created_at timestamptz not null default clock_timestamp(),unique(tenant_id,invoice_id,request_key),
 foreign key(tenant_id,invoice_id) references public.payment_invoices(tenant_id,id)
);
create index payment_test_snapshots_invoice_idx on private.payment_test_snapshots(tenant_id,invoice_id,created_at desc);
create table public.payment_transactions (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, invoice_id uuid not null,
 provider_id text not null, network text not null, transaction_reference text not null check(transaction_reference~'^test:'),
 mode text not null default 'test' check(mode='test'),created_at timestamptz not null default now(),
 unique(provider_id,network,transaction_reference),
 foreign key(tenant_id,invoice_id) references public.payment_invoices(tenant_id,id)
);
create table public.payment_observations (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,invoice_id uuid not null,snapshot_id uuid not null references private.payment_test_snapshots(id),
 provider_id text not null,event_id text not null check(event_id~'^test:[A-Za-z0-9:_-]{1,160}$'),
 raw_body_hash text not null check(raw_body_hash~'^[a-f0-9]{64}$'),
 method text not null check(method in ('webhook','reconcile')),
 proposed_state text not null,resulting_state text not null,reason text not null,
 mode text not null default 'test' check(mode='test'),created_at timestamptz not null default clock_timestamp(),
 unique(provider_id,event_id),foreign key(tenant_id,invoice_id) references public.payment_invoices(tenant_id,id)
);
create index payment_observations_invoice_idx on public.payment_observations(tenant_id,invoice_id,created_at desc);

alter table public.payment_invoices enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.payment_observations enable row level security;
alter table private.payment_test_snapshots enable row level security;
alter table private.payment_adapter_registry enable row level security;
create policy payment_invoices_read on public.payment_invoices for select to authenticated using(private.has_tenant_role(tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]));
create policy payment_transactions_read on public.payment_transactions for select to authenticated using(private.has_tenant_role(tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]));
create policy payment_observations_read on public.payment_observations for select to authenticated using(private.has_tenant_role(tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]));
revoke all on public.payment_invoices,public.payment_transactions,public.payment_observations,private.payment_test_snapshots from public,anon,authenticated;
grant select on public.payment_invoices,public.payment_transactions,public.payment_observations to authenticated;
grant all on public.payment_invoices,public.payment_transactions,public.payment_observations,private.payment_test_snapshots to service_role;

create function private.payment_history_guard() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' or tg_table_name<>'payment_invoices' then raise exception 'payment history immutable' using errcode='42501'; end if;
 if to_jsonb(new)-array['status','last_evidence_at','confirmed_at','reconciliation_count'] is distinct from to_jsonb(old)-array['status','last_evidence_at','confirmed_at','reconciliation_count'] then raise exception 'invoice snapshot immutable' using errcode='42501'; end if;
 return new;
end; $$;
create trigger payment_invoice_immutable before update or delete on public.payment_invoices for each row execute function private.payment_history_guard();
create trigger payment_observation_immutable before update or delete on public.payment_observations for each row execute function private.payment_history_guard();
create trigger payment_transaction_immutable before update or delete on public.payment_transactions for each row execute function private.payment_history_guard();
create trigger payment_test_snapshot_immutable before update or delete on private.payment_test_snapshots for each row execute function private.payment_history_guard();
revoke all on function private.payment_history_guard() from public,anon,authenticated;

create function public.admin_create_test_payment_invoice(target_tenant_id uuid,target_offer_id uuid,channel_value text,asset_value text,amount_units_value text,idempotency_key_value text)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare o public.commercial_offers%rowtype;i public.payment_invoices%rowtype; r jsonb; pid text; iid uuid:=gen_random_uuid();
begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]) then raise exception 'payment test permission denied' using errcode='42501';end if;
 if channel_value is null or asset_value is null or amount_units_value is null or idempotency_key_value is null or amount_units_value!~'^[1-9][0-9]{0,29}$' or char_length(idempotency_key_value) not between 1 and 120 then raise exception 'test invoice input invalid' using errcode='22023';end if;
 pid:=case channel_value when 'telegram_stars' then 'telegram_stars_test' when 'external_crypto' then 'external_crypto_test' end;
 select rules->asset_value into r from private.payment_adapter_registry where id=pid and channel=channel_value and mode='test';
 if r is null or (asset_value='XTR' and amount_units_value::numeric>9007199254740991) then raise exception 'test asset channel not approved' using errcode='22023';end if;
 -- Offer row also serializes invoice creation using the same request key.
 select * into o from public.commercial_offers where tenant_id=target_tenant_id and id=target_offer_id for update;
 if o.id is null or o.customer_id is null or o.status<>'approved' or o.expires_at<=now() then raise exception 'approved current customer offer required' using errcode='22023';end if;
 -- Serialize keys even when callers select different offers, avoiding duplicate races.
 perform pg_advisory_xact_lock(hashtextextended(target_tenant_id::text||':'||idempotency_key_value,0));
 select * into i from public.payment_invoices where tenant_id=target_tenant_id and idempotency_key=idempotency_key_value;
 if i.id is not null then
  if i.offer_id<>o.id or i.provider_id<>pid or i.asset<>asset_value or i.amount_units<>amount_units_value::numeric then raise exception 'payment idempotency conflict' using errcode='23505';end if;
  return i.id;
 end if;
 insert into public.payment_invoices(id,tenant_id,customer_id,offer_id,provider_id,provider_reference,channel,surface,amount_units,decimals,asset,network,recipient,payer_reference,min_confirmations,quote_snapshot,idempotency_key,expires_at,created_by)
 values(iid,target_tenant_id,o.customer_id,o.id,pid,'test:'||iid::text,channel_value,case channel_value when 'external_crypto' then 'independent_web' else 'telegram_bot' end,amount_units_value::numeric,(r->>'decimals')::int,asset_value,r->>'network','test:merchant:'||target_tenant_id::text,'test:customer:'||o.customer_id::text,(r->>'confirmations')::int,
 jsonb_build_object('mode','test','rate_authority','explicit_simulation_fixture','offer_amount',o.amount::text,'offer_currency',o.currency,'offer_snapshot',o.snapshot,'settlement_units',amount_units_value,'asset',asset_value,'rules',r,'approved_by',auth.uid()),idempotency_key_value,least(o.expires_at,now()+interval '1 hour'),auth.uid());
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data) values(target_tenant_id,'HUMAN',auth.uid(),'payment.test_invoice_created','payment_invoices',iid::text,jsonb_build_object('mode','test','channel',channel_value,'offer_id',o.id,'live_activation',false));
 return iid;
end; $$;

create function public.admin_simulate_test_payment(target_tenant_id uuid,target_invoice_id uuid,scenario_value text,request_key_value text)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare i public.payment_invoices%rowtype; sid uuid:=gen_random_uuid();s jsonb;previous private.payment_test_snapshots%rowtype;
begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]) then raise exception 'payment test permission denied' using errcode='42501';end if;
 select * into i from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and mode='test' for update;
 if i.id is null then raise exception 'test invoice scope denied' using errcode='42501';end if;
 if scenario_value is null or request_key_value is null or scenario_value not in ('pending','settled','insufficient_confirmations','underpaid','overpaid','wrong_asset','wrong_network','wrong_recipient','failed','refunded','reorg','late') or char_length(request_key_value) not between 1 and 120 then raise exception 'test scenario invalid' using errcode='22023';end if;
 select * into previous from private.payment_test_snapshots where tenant_id=target_tenant_id and invoice_id=i.id and request_key=request_key_value;
 if previous.id is not null then
  if previous.scenario<>scenario_value then raise exception 'simulation idempotency conflict' using errcode='23505';end if;return previous.id;
 end if;
 s:=jsonb_build_object('id',sid,'invoice_id',i.id,'provider_id',i.provider_id,'provider_reference',i.provider_reference,'mode','test','source','simulation',
 'amount_units',(case scenario_value when 'underpaid' then i.amount_units-1 when 'overpaid' then i.amount_units+1 else i.amount_units end)::text,
 'asset',case scenario_value when 'wrong_asset' then 'UNAPPROVED' else i.asset end,'network',case scenario_value when 'wrong_network' then 'WRONG_NETWORK' else i.network end,
 'recipient',case scenario_value when 'wrong_recipient' then 'test:wrong:recipient' else i.recipient end,'payer_reference',i.payer_reference,
 'transaction_reference',case scenario_value when 'pending' then null else 'test:tx:'||i.id::text end,
 'confirmations',case scenario_value when 'insufficient_confirmations' then i.min_confirmations-1 when 'pending' then 0 else i.min_confirmations end,
 'provider_status',case scenario_value when 'pending' then 'pending' when 'failed' then 'failed' when 'refunded' then 'refunded' when 'reorg' then 'reorg' else 'settled' end,
 'observed_at',to_char((case scenario_value when 'late' then i.expires_at+interval '1 second' else clock_timestamp() end) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 insert into private.payment_test_snapshots(id,tenant_id,invoice_id,request_key,scenario,snapshot) values(sid,target_tenant_id,i.id,request_key_value,scenario_value,s);
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data) values(target_tenant_id,'HUMAN',auth.uid(),'payment.test_provider_simulated','payment_invoices',i.id::text,jsonb_build_object('snapshot_id',sid,'scenario',scenario_value,'mode','test'));
 return sid;
end; $$;

create function public.payment_get_test_invoice(target_invoice_id uuid) returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('id',id,'tenant_id',tenant_id,'customer_id',customer_id,'offer_id',offer_id,'provider_id',provider_id,'provider_reference',provider_reference,'channel',channel,'surface',surface,'mode',mode,'amount_units',amount_units::text,'decimals',decimals,'asset',asset,'network',network,'recipient',recipient,'payer_reference',payer_reference,'min_confirmations',min_confirmations,'status',status,'expires_at',to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) from public.payment_invoices where id=target_invoice_id and mode='test';
$$;
create function public.payment_get_test_snapshot(target_snapshot_id uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select snapshot from private.payment_test_snapshots where id=target_snapshot_id;
$$;

create function public.payment_record_test_observation(target_tenant_id uuid,target_invoice_id uuid,target_snapshot_id uuid,event_id_value text,raw_hash_value text,method_value text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare i public.payment_invoices%rowtype;old public.payment_observations%rowtype;s jsonb;proposed text;result text;reason_code text;ref_value text;owner_value uuid;observed timestamptz;
begin
 if event_id_value is null or raw_hash_value is null or method_value is null or event_id_value!~'^test:[A-Za-z0-9:_-]{1,160}$' or raw_hash_value!~'^[a-f0-9]{64}$' or method_value not in ('webhook','reconcile') then raise exception 'test evidence invalid' using errcode='22023';end if;
 select * into i from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and mode='test' for update;
 if i.id is null then raise exception 'test invoice scope denied' using errcode='42501';end if;
 -- Provider/event keys may race across invoices: serialize before duplicate lookup.
 perform pg_advisory_xact_lock(hashtextextended(i.provider_id||':'||event_id_value,0));
 select * into old from public.payment_observations where provider_id=i.provider_id and event_id=event_id_value;
 if old.id is not null then
  if old.invoice_id<>i.id or old.snapshot_id<>target_snapshot_id or old.raw_body_hash<>raw_hash_value or old.method<>method_value then raise exception 'payment event content conflict' using errcode='23505';end if;
  return jsonb_build_object('duplicate',true,'state',i.status,'mode','test');
 end if;
 select snapshot into s from private.payment_test_snapshots where id=target_snapshot_id and tenant_id=target_tenant_id and invoice_id=i.id;
 if s is null or s->>'mode'<>'test' or s->>'source'<>'simulation' or s->>'provider_id'<>i.provider_id or s->>'provider_reference'<>i.provider_reference then raise exception 'test evidence scope denied' using errcode='42501';end if;
 observed:=(s->>'observed_at')::timestamptz; ref_value:=s->>'transaction_reference';
 if s->>'asset'<>i.asset or s->>'network'<>i.network or s->>'recipient'<>i.recipient or s->>'payer_reference'<>i.payer_reference then proposed:='REVIEW';reason_code:='PAYMENT_BINDING_MISMATCH';
 elsif s->>'provider_status'='reorg' then proposed:='REVIEW';reason_code:='CHAIN_REORG';
 elsif s->>'provider_status'='refunded' then proposed:='REFUNDED';reason_code:='PROVIDER_REFUND_EVIDENCE';
 elsif s->>'provider_status'='failed' then proposed:='FAILED';reason_code:='PROVIDER_FAILURE';
 elsif observed>i.expires_at then proposed:=case when ref_value is null then 'EXPIRED' else 'REVIEW' end;reason_code:=case when ref_value is null then 'INVOICE_EXPIRED' else 'LATE_PAYMENT' end;
 elsif s->>'provider_status'<>'settled' then proposed:='PENDING';reason_code:='AWAITING_PROVIDER_SETTLEMENT';
 elsif ref_value is null then proposed:='REVIEW';reason_code:='MISSING_TRANSACTION_REFERENCE';
 elsif (s->>'amount_units')::numeric<>i.amount_units then proposed:='REVIEW';reason_code:=case when (s->>'amount_units')::numeric<i.amount_units then 'UNDERPAYMENT' else 'OVERPAYMENT' end;
 elsif (s->>'confirmations')::int<i.min_confirmations then proposed:='PENDING';reason_code:='AWAITING_CONFIRMATIONS';
 else proposed:='CONFIRMED';reason_code:='TEST_EVIDENCE_CONFIRMED';end if;
 -- One provider/network transfer can never pay two invoices, even across tenants.
 if ref_value is not null then
  insert into public.payment_transactions(tenant_id,invoice_id,provider_id,network,transaction_reference) values(target_tenant_id,i.id,i.provider_id,s->>'network',ref_value) on conflict(provider_id,network,transaction_reference) do nothing;
  select invoice_id into owner_value from public.payment_transactions where provider_id=i.provider_id and network=s->>'network' and transaction_reference=ref_value;
  if owner_value<>i.id then proposed:='REVIEW';reason_code:='DUPLICATE_TRANSACTION';end if;
 end if;
 if i.last_evidence_at is not null and observed<i.last_evidence_at then result:=i.status;reason_code:='STALE_EVIDENCE_RETAINED';
 elsif i.status=proposed then result:=i.status;
 elsif i.status='REVIEW' then result:='REVIEW';reason_code:='REVIEW_HOLD';
 elsif i.status='CONFIRMED' then result:=case proposed when 'REFUNDED' then 'REFUNDED' else 'REVIEW' end;
 elsif i.status in ('FAILED','EXPIRED','REFUNDED') then result:='REVIEW';
 else result:=proposed;end if;
 insert into public.payment_observations(tenant_id,invoice_id,snapshot_id,provider_id,event_id,raw_body_hash,method,proposed_state,resulting_state,reason) values(target_tenant_id,i.id,target_snapshot_id,i.provider_id,event_id_value,raw_hash_value,method_value,proposed,result,reason_code);
 update public.payment_invoices set status=result,last_evidence_at=greatest(last_evidence_at,observed),confirmed_at=case when result='CONFIRMED' then coalesce(confirmed_at,now()) else confirmed_at end,reconciliation_count=reconciliation_count+case method_value when 'reconcile' then 1 else 0 end where id=i.id;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,before_data,after_data) values(target_tenant_id,'SYSTEM','payment.test_evidence_recorded','payment_invoices',i.id::text,jsonb_build_object('state',i.status),jsonb_build_object('mode','test','state',result,'reason',reason_code,'event_id',event_id_value,'snapshot_id',target_snapshot_id,'method',method_value,'live_payment_verified',false));
 -- A simulation can never emit payment.confirmed or drive PAID / access guards.
 perform private.append_domain_event(target_tenant_id,i.customer_id,'payment.test_observed',1,jsonb_build_object('payment_id',i.id,'mode','test','state',result), 'SYSTEM',null,'payment_test_engine','TRUSTED',gen_random_uuid(),null,'payment-test:'||i.provider_id||':'||event_id_value,now());
 return jsonb_build_object('duplicate',false,'state',result,'reason',reason_code,'mode','test');
end; $$;
insert into private.event_contracts(event_type,version,required_payload_keys,trusted_producer_required,description) values('payment.test_observed',1,array['payment_id','mode','state'],true,'Test-only payment observation; no customer lifecycle authority.');

create function public.admin_request_test_reconciliation(target_tenant_id uuid,target_invoice_id uuid,request_key_value text)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare sid uuid;
begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]) or not exists(select 1 from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id and mode='test') then raise exception 'reconciliation denied' using errcode='42501';end if;
 if request_key_value is null or char_length(request_key_value) not between 1 and 120 then raise exception 'request key invalid' using errcode='22023';end if;
 select id into sid from private.payment_test_snapshots where tenant_id=target_tenant_id and invoice_id=target_invoice_id order by created_at desc,id desc limit 1;
 if sid is not null then insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,request_id,after_data) values(target_tenant_id,'HUMAN',auth.uid(),'payment.test_reconciliation_requested','payment_invoices',target_invoice_id::text,request_key_value,jsonb_build_object('snapshot_id',sid,'mode','test'));end if;
 return sid;
end; $$;
create function public.admin_payment_list(target_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]) then raise exception 'payment read denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(x.value) from(select to_jsonb(i)||jsonb_build_object('amount_units',i.amount_units::text,'expires_at',to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) value from public.payment_invoices i where tenant_id=target_tenant_id order by created_at desc limit 100)x),'[]');
end; $$;
create function public.admin_payment_detail(target_tenant_id uuid,target_invoice_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare i public.payment_invoices%rowtype;
begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]) then raise exception 'payment read denied' using errcode='42501';end if;
 select * into i from public.payment_invoices where tenant_id=target_tenant_id and id=target_invoice_id;
 if i.id is null then return null;end if;
 return jsonb_build_object('invoice',to_jsonb(i)||jsonb_build_object('amount_units',i.amount_units::text,'expires_at',to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),'observations',coalesce((select jsonb_agg(x.value) from(select to_jsonb(o)||jsonb_build_object('evidence',s.snapshot) value from public.payment_observations o join private.payment_test_snapshots s on s.id=o.snapshot_id and s.tenant_id=o.tenant_id and s.invoice_id=o.invoice_id where o.tenant_id=target_tenant_id and o.invoice_id=i.id order by o.created_at desc limit 100)x),'[]'),'transactions',coalesce((select jsonb_agg(to_jsonb(t)) from public.payment_transactions t where tenant_id=target_tenant_id and invoice_id=i.id),'[]'));
end; $$;

revoke all on function public.admin_create_test_payment_invoice(uuid,uuid,text,text,text,text),public.admin_simulate_test_payment(uuid,uuid,text,text),public.admin_request_test_reconciliation(uuid,uuid,text),public.admin_payment_list(uuid),public.admin_payment_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_create_test_payment_invoice(uuid,uuid,text,text,text,text),public.admin_simulate_test_payment(uuid,uuid,text,text),public.admin_request_test_reconciliation(uuid,uuid,text),public.admin_payment_list(uuid),public.admin_payment_detail(uuid,uuid) to authenticated;
revoke all on function public.payment_get_test_invoice(uuid),public.payment_get_test_snapshot(uuid),public.payment_record_test_observation(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.payment_get_test_invoice(uuid),public.payment_get_test_snapshot(uuid),public.payment_record_test_observation(uuid,uuid,uuid,text,text,text) to service_role;
