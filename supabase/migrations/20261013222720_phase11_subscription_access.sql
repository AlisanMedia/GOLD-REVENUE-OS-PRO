-- Phase 11: deterministic entitlement/access. Live controls default closed, no activation API.
create table private.entitlement_controls(tenant_id uuid primary key references public.tenants(id),live_enabled boolean not null default false,approval_reference text,check(not live_enabled or approval_reference is not null));
create table private.verified_payment_receipts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,customer_id uuid not null,offer_id uuid not null,event_id uuid not null,
 provider_id text not null,provider_reference text not null,signature_verified boolean not null check(signature_verified),independent_verified boolean not null check(independent_verified),
 evidence_hash text not null check(evidence_hash~'^[a-f0-9]{64}$'),verified_at timestamptz not null,unique(tenant_id,id),unique(tenant_id,event_id),unique(provider_id,provider_reference),
 foreign key(tenant_id,customer_id) references public.customers(tenant_id,id),foreign key(tenant_id,offer_id) references public.commercial_offers(tenant_id,id),foreign key(tenant_id,event_id) references public.domain_events(tenant_id,id)
);
create table public.subscriptions(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,customer_id uuid not null,plan_version_id uuid not null,mode text not null check(mode in ('test','live')),
 state text not null check(state in ('ACTIVE','RENEWAL_DUE','EXPIRED','HOLD','SUSPENDED','CANCELLED')),plan_snapshot jsonb not null,commercial_snapshot jsonb not null,
 starts_at timestamptz not null,ends_at timestamptz not null,grace_until timestamptz not null,renewal_due_at timestamptz not null,revision int not null default 1,
 created_at timestamptz not null default now(),unique(tenant_id,id),unique(tenant_id,customer_id,plan_version_id,mode),
 foreign key(tenant_id,customer_id) references public.customers(tenant_id,id),foreign key(tenant_id,plan_version_id) references public.commercial_versions(tenant_id,id),check(ends_at>starts_at and grace_until>=ends_at)
);
create table public.subscription_payments(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,subscription_id uuid not null,mode text not null check(mode in ('test','live')),
 test_invoice_id uuid,receipt_id uuid,event_id uuid not null,term_snapshot jsonb not null,period_start timestamptz not null,period_end timestamptz not null,
 unique(tenant_id,event_id),unique(test_invoice_id),unique(receipt_id),foreign key(tenant_id,subscription_id) references public.subscriptions(tenant_id,id),
 foreign key(tenant_id,test_invoice_id) references public.payment_invoices(tenant_id,id),foreign key(tenant_id,receipt_id) references private.verified_payment_receipts(tenant_id,id),
 check((mode='test' and test_invoice_id is not null and receipt_id is null) or (mode='live' and receipt_id is not null and test_invoice_id is null))
);
create table public.vip_channels(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),mode text not null check(mode in ('test','live')),chat_id text not null,
 enabled boolean not null default false,invite_ttl_seconds int not null default 300 check(invite_ttl_seconds between 60 and 900),approval_reference text,private_verified boolean not null default false,
 unique(tenant_id,id),unique(tenant_id,mode),check((mode='test' and chat_id~'^test:') or (mode='live' and chat_id~'^-100[0-9]+$' and approval_reference is not null and private_verified))
);
create table public.telegram_entitlement_bindings(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,customer_id uuid not null,mode text not null check(mode in ('test','live')),telegram_user_id text not null,
 source_event_id uuid not null,created_at timestamptz not null default now(),unique(tenant_id,id),unique(tenant_id,customer_id,mode),unique(tenant_id,telegram_user_id,mode),
 foreign key(tenant_id,customer_id) references public.customers(tenant_id,id),foreign key(tenant_id,source_event_id) references public.domain_events(tenant_id,id),
 check((mode='test' and telegram_user_id~'^test:[0-9]+$') or (mode='live' and telegram_user_id~'^[1-9][0-9]{0,15}$'))
);
create table public.channel_access(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,subscription_id uuid not null,binding_id uuid not null,channel_id uuid not null,mode text not null check(mode in ('test','live')),
 status text not null default 'PENDING' check(status in ('PENDING','INVITED','MEMBER','REVOKED','REVIEW')),invite_reference text,invite_expires_at timestamptz,membership_checked_at timestamptz,
 unique(tenant_id,id),unique(subscription_id),unique(binding_id,channel_id),foreign key(tenant_id,subscription_id) references public.subscriptions(tenant_id,id),foreign key(tenant_id,binding_id) references public.telegram_entitlement_bindings(tenant_id,id),foreign key(tenant_id,channel_id) references public.vip_channels(tenant_id,id),check(mode<>'test' or invite_reference is null or invite_reference~'^test:invite:')
);
create table public.entitlement_jobs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,access_id uuid not null,revision int not null,operation text not null check(operation in ('invite','join','revoke','reconcile')),
 status text not null default 'PENDING' check(status in ('PENDING','RUNNING','DONE','FAILED','STALE')),attempts int not null default 0,available_at timestamptz not null default now(),lease_token uuid,lease_until timestamptz,last_error text,
 unique(access_id,revision,operation),foreign key(tenant_id,access_id) references public.channel_access(tenant_id,id)
);
create index entitlement_jobs_ready on public.entitlement_jobs(tenant_id,available_at) where status in ('PENDING','RUNNING');
create table public.entitlement_audit(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,subscription_id uuid not null,action text not null,mode text not null,details jsonb not null default '{}',created_at timestamptz not null default clock_timestamp(),foreign key(tenant_id,subscription_id) references public.subscriptions(tenant_id,id));

create function private.entitlement_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin raise exception 'entitlement evidence immutable' using errcode='42501';end;$$;
create trigger receipt_immutable before update or delete on private.verified_payment_receipts for each row execute function private.entitlement_immutable();
create trigger binding_immutable before update or delete on public.telegram_entitlement_bindings for each row execute function private.entitlement_immutable();
create trigger subscription_payment_immutable before update or delete on public.subscription_payments for each row execute function private.entitlement_immutable();
create trigger entitlement_audit_immutable before update or delete on public.entitlement_audit for each row execute function private.entitlement_immutable();
create function private.subscription_guard() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_op='DELETE' or to_jsonb(new)-array['state','ends_at','grace_until','renewal_due_at','revision'] is distinct from to_jsonb(old)-array['state','ends_at','grace_until','renewal_due_at','revision'] then raise exception 'subscription snapshot immutable' using errcode='42501';end if;return new;end;$$;
create trigger subscription_snapshot_guard before update or delete on public.subscriptions for each row execute function private.subscription_guard();

create function private.entitlement_live_allowed(t uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from private.entitlement_controls c join public.tenants x on x.id=c.tenant_id where c.tenant_id=t and c.live_enabled and c.approval_reference is not null and x.status='active');$$;
create function private.entitlement_test_tenant(t uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from public.tenants where id=t and slug like 'phase11-sandbox-%' and status='active' and not outbound_messaging_enabled);$$;
create function public.subscription_expiry(start_value timestamptz,terms_value jsonb) returns timestamptz language plpgsql immutable set search_path=pg_catalog as $$
declare u text:=terms_value->>'duration_unit';n int;d timestamp;
begin
 if start_value is null or terms_value->>'duration_count' is null or terms_value->>'duration_count'!~'^[0-9]+$' then raise exception 'subscription terms invalid' using errcode='22023';end if;
 if coalesce((terms_value->>'renewal_notice_days')::int,3) not between 0 and 30 then raise exception 'subscription terms invalid' using errcode='22023';end if; n:=(terms_value->>'duration_count')::int;if n not between 1 and 366 or u not in ('fixed_days','calendar_month','calendar_year') or u is null then raise exception 'subscription terms invalid' using errcode='22023';end if;
 if coalesce((terms_value->>'grace_days')::int,0) not between 0 and 30 or (coalesce((terms_value->>'grace_days')::int,0)>0 and coalesce((terms_value->>'grace_approved')::boolean,false) is not true) then raise exception 'grace not approved' using errcode='22023';end if;
 d:=start_value at time zone 'UTC';return (d+case u when 'fixed_days' then make_interval(days=>n) when 'calendar_month' then make_interval(months=>n) else make_interval(years=>n) end) at time zone 'UTC';end;$$;

create function private.entitlement_enqueue(sid uuid,op text) returns void language sql set search_path=pg_catalog as $$
 insert into public.entitlement_jobs(tenant_id,access_id,revision,operation) select a.tenant_id,a.id,s.revision,op from public.channel_access a join public.subscriptions s on s.id=a.subscription_id where s.id=sid on conflict(access_id,revision,operation) do nothing;
$$;
create function private.entitlement_audit_record(sid uuid,act text,d jsonb default '{}') returns void language plpgsql set search_path=pg_catalog as $$declare s public.subscriptions%rowtype;begin
 select * into s from public.subscriptions where id=sid;
 insert into public.entitlement_audit(tenant_id,subscription_id,action,mode,details) values(s.tenant_id,sid,act,s.mode,d);
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data) values(s.tenant_id,case when auth.uid() is null then 'SYSTEM'::public.audit_actor_type else 'HUMAN'::public.audit_actor_type end,auth.uid(),'entitlement.'||act,'subscriptions',sid::text,d||jsonb_build_object('mode',s.mode));end;$$;

create function private.entitlement_apply(t uuid,source_id uuid,m text) returns uuid language plpgsql set search_path=pg_catalog as $$
declare i public.payment_invoices%rowtype;r private.verified_payment_receipts%rowtype;e public.domain_events%rowtype;o public.commercial_offers%rowtype;s public.subscriptions%rowtype;terms jsonb;eid uuid;cid uuid;oid uuid;pid uuid;start_at timestamptz;end_at timestamptz;existing uuid;
begin
 if m='test' then
  if not private.entitlement_test_tenant(t) then raise exception 'isolated test tenant required' using errcode='42501';end if;
  select * into i from public.payment_invoices where tenant_id=t and id=source_id and mode='test' and status='CONFIRMED' for update;
  select * into e from public.domain_events where tenant_id=t and customer_id=i.customer_id and event_type='payment.test_observed' and authority='TRUSTED' and producer='payment_test_engine' and payload->>'payment_id'=i.id::text and payload->>'state'='CONFIRMED' order by recorded_at limit 1;
  if i.id is null or e.id is null then raise exception 'confirmed test evidence required' using errcode='42501';end if;cid:=i.customer_id;oid:=i.offer_id;eid:=e.id;
 elsif m='live' then
  if not private.entitlement_live_allowed(t) then raise exception 'live entitlements disabled' using errcode='42501';end if;
  select * into r from private.verified_payment_receipts where tenant_id=t and id=source_id for update;
  select * into e from public.domain_events where tenant_id=t and id=r.event_id and customer_id=r.customer_id and event_type='payment.confirmed' and authority='TRUSTED' and producer='payment_verifier' and payload->>'payment_id'=r.id::text and payload->>'tx_hash'=r.provider_reference;
  if r.id is null or e.id is null then raise exception 'genuine verified receipt required' using errcode='42501';end if;cid:=r.customer_id;oid:=r.offer_id;eid:=e.id;
 else raise exception 'entitlement mode invalid' using errcode='22023';end if;
 select * into o from public.commercial_offers where tenant_id=t and id=oid and customer_id=cid and status='approved';
 if o.id is null then raise exception 'approved offer required' using errcode='42501';end if;
 select payload into terms from public.commercial_versions where tenant_id=t and id=o.plan_version_id;
 if m='live' and (not exists(select 1 from public.commercial_items x join public.commercial_versions v on v.item_id=x.id and v.tenant_id=x.tenant_id where v.id=o.plan_version_id and x.tenant_id=t and not x.test_only) or o.snapshot->'plan'->'payload' is distinct from terms) then raise exception 'commercial provenance denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':'||cid::text||':'||o.plan_version_id::text||':'||m,0));
 select subscription_id into existing from public.subscription_payments where tenant_id=t and event_id=eid;if existing is not null then return existing;end if;
 select * into s from public.subscriptions where tenant_id=t and customer_id=cid and plan_version_id=o.plan_version_id and mode=m for update;
 if s.state='CANCELLED' then raise exception 'cancelled subscription requires new offer' using errcode='42501';end if;
 start_at:=greatest(now(),coalesce(s.ends_at,now()));end_at:=public.subscription_expiry(start_at,terms);pid:=coalesce(s.id,gen_random_uuid());
 if s.id is null then insert into public.subscriptions(id,tenant_id,customer_id,plan_version_id,mode,state,plan_snapshot,commercial_snapshot,starts_at,ends_at,grace_until,renewal_due_at) values(pid,t,cid,o.plan_version_id,m,'ACTIVE',terms,o.snapshot,start_at,end_at,end_at+make_interval(days=>coalesce((terms->>'grace_days')::int,0)),end_at-make_interval(days=>coalesce((terms->>'renewal_notice_days')::int,3)));
 else update public.subscriptions set state=case when state in ('HOLD','SUSPENDED') then state else 'ACTIVE' end,ends_at=end_at,grace_until=end_at+make_interval(days=>coalesce((terms->>'grace_days')::int,0)),renewal_due_at=end_at-make_interval(days=>coalesce((terms->>'renewal_notice_days')::int,3)),revision=revision+1 where id=pid;end if;
 insert into public.subscription_payments(tenant_id,subscription_id,mode,test_invoice_id,receipt_id,event_id,term_snapshot,period_start,period_end) values(t,pid,m,case when m='test' then source_id end,case when m='live' then source_id end,eid,terms,start_at,end_at);
 perform private.entitlement_audit_record(pid,case when s.id is null then 'activated' else 'renewed' end,jsonb_build_object('payment_event',eid,'period_start',start_at,'period_end',end_at));
 if s.id is not null then perform private.entitlement_enqueue(pid,'reconcile');end if;
 if exists(select 1 from public.telegram_entitlement_bindings where tenant_id=t and customer_id=cid and mode=m) and exists(select 1 from public.vip_channels where tenant_id=t and mode=m and enabled and private_verified) and (s.id is null or s.state not in ('HOLD','SUSPENDED')) then
 if exists(select 1 from public.channel_access a join public.telegram_entitlement_bindings b on b.id=a.binding_id where b.tenant_id=t and b.customer_id=cid and a.mode=m and a.subscription_id<>pid) then update public.subscriptions set state='HOLD',revision=revision+1 where id=pid;perform private.entitlement_audit_record(pid,'access_scope_review');else perform private.entitlement_request_access(t,pid);end if;end if;return pid;
end;$$;
create function public.admin_create_test_subscription(target_tenant_id uuid,target_invoice_id uuid) returns uuid language plpgsql security definer set search_path=pg_catalog as $$begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]) then raise exception 'entitlement permission denied' using errcode='42501';end if;return private.entitlement_apply(target_tenant_id,target_invoice_id,'test');end;$$;
create function public.consume_verified_payment(target_tenant_id uuid,target_receipt_id uuid) returns uuid language plpgsql security definer set search_path=pg_catalog as $$begin return private.entitlement_apply(target_tenant_id,target_receipt_id,'live');end;$$;

create function public.admin_test_access_setup(target_tenant_id uuid,target_customer_id uuid,target_event_id uuid,user_id_value text) returns uuid language plpgsql security definer set search_path=pg_catalog as $$declare bid uuid;begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]) or not private.entitlement_test_tenant(target_tenant_id) then raise exception 'isolated test access denied' using errcode='42501';end if;
 if user_id_value is null or user_id_value!~'^test:[0-9]+$' or not exists(select 1 from public.domain_events where tenant_id=target_tenant_id and id=target_event_id and customer_id=target_customer_id and event_type='customer.created') then raise exception 'test identity evidence denied' using errcode='42501';end if;
 insert into public.telegram_entitlement_bindings(tenant_id,customer_id,mode,telegram_user_id,source_event_id) values(target_tenant_id,target_customer_id,'test',user_id_value,target_event_id) on conflict(tenant_id,customer_id,mode) do nothing returning id into bid;
 if bid is null then select id into bid from public.telegram_entitlement_bindings where tenant_id=target_tenant_id and customer_id=target_customer_id and mode='test' and telegram_user_id=user_id_value;if bid is null then raise exception 'identity conflict' using errcode='23505';end if;end if;
 insert into public.vip_channels(tenant_id,mode,chat_id,enabled,private_verified) values(target_tenant_id,'test','test:vip',true,true) on conflict(tenant_id,mode) do nothing;return bid;end;$$;
create function public.bind_verified_telegram_identity(target_tenant_id uuid,target_customer_id uuid,target_event_id uuid) returns uuid language plpgsql security definer set search_path=pg_catalog as $$declare uid text;bid uuid;begin
 if not private.entitlement_live_allowed(target_tenant_id) then raise exception 'live entitlements disabled' using errcode='42501';end if;
 select mc.provider_user_id into uid from public.domain_events e join public.messages m on m.tenant_id=e.tenant_id and m.id::text=e.payload->>'message_id' join public.messaging_contacts mc on mc.tenant_id=m.tenant_id and mc.id=m.messaging_contact_id where e.tenant_id=target_tenant_id and e.id=target_event_id and e.customer_id=target_customer_id and mc.customer_id=target_customer_id and mc.identity_resolution in ('exact_match','manual') and e.event_type='message.received' and e.producer='messaging.telegram.webhook' and m.direction='inbound';
 if uid is null or uid!~'^[1-9][0-9]{0,15}$' then raise exception 'verified telegram identity required' using errcode='42501';end if;
 insert into public.telegram_entitlement_bindings(tenant_id,customer_id,mode,telegram_user_id,source_event_id) values(target_tenant_id,target_customer_id,'live',uid,target_event_id) on conflict(tenant_id,customer_id,mode) do nothing returning id into bid;
 if bid is null then select id into bid from public.telegram_entitlement_bindings where tenant_id=target_tenant_id and customer_id=target_customer_id and mode='live' and telegram_user_id=uid;if bid is null then raise exception 'identity conflict' using errcode='23505';end if;end if;return bid;end;$$;

create function private.entitlement_request_access(target_tenant_id uuid,target_subscription_id uuid) returns uuid language plpgsql set search_path=pg_catalog as $$declare s public.subscriptions%rowtype;b public.telegram_entitlement_bindings%rowtype;c public.vip_channels%rowtype;aid uuid;begin
 select * into s from public.subscriptions where tenant_id=target_tenant_id and id=target_subscription_id for update;
 if s.id is null or s.state not in ('ACTIVE','RENEWAL_DUE') or s.grace_until<=now() then raise exception 'valid entitlement required' using errcode='42501';end if;
 if (s.mode='live' and not private.entitlement_live_allowed(s.tenant_id)) or (s.mode='test' and not private.entitlement_test_tenant(s.tenant_id)) then raise exception 'access mode denied' using errcode='42501';end if;
 select * into b from public.telegram_entitlement_bindings where tenant_id=s.tenant_id and customer_id=s.customer_id and mode=s.mode;
 select * into c from public.vip_channels where tenant_id=s.tenant_id and mode=s.mode and enabled and private_verified;
 if b.id is null or c.id is null then raise exception 'verified binding and channel required' using errcode='42501';end if;
 if exists(select 1 from public.channel_access where binding_id=b.id and channel_id=c.id and subscription_id<>s.id) then raise exception 'access scope conflict requires review' using errcode='42501';end if;
 insert into public.channel_access(tenant_id,subscription_id,binding_id,channel_id,mode) values(s.tenant_id,s.id,b.id,c.id,s.mode) on conflict(subscription_id) do nothing returning id into aid;
 if aid is null then select id into aid from public.channel_access where subscription_id=s.id;end if;
 perform private.entitlement_enqueue(s.id,'invite');perform private.entitlement_audit_record(s.id,'access_requested');return aid;end;$$;
create function public.admin_request_entitlement_access(target_tenant_id uuid,target_subscription_id uuid) returns uuid language plpgsql security definer set search_path=pg_catalog as $$begin if not private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]) then raise exception 'entitlement permission denied' using errcode='42501';end if;return private.entitlement_request_access(target_tenant_id,target_subscription_id);end;$$;
revoke all on function private.entitlement_request_access(uuid,uuid) from public,anon,authenticated,service_role;
create function public.admin_subscription_control(target_tenant_id uuid,target_subscription_id uuid,action_value text,request_id_value uuid) returns boolean language plpgsql security definer set search_path=pg_catalog as $$declare s public.subscriptions%rowtype;n text;begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]) then raise exception 'entitlement permission denied' using errcode='42501';end if;
 select * into s from public.subscriptions where tenant_id=target_tenant_id and id=target_subscription_id for update;if s.id is null then raise exception 'subscription scope denied' using errcode='42501';end if;
 if exists(select 1 from public.entitlement_audit where subscription_id=s.id and details->>'request_id'=request_id_value::text) then if not exists(select 1 from public.entitlement_audit where subscription_id=s.id and details->>'request_id'=request_id_value::text and action=action_value) then raise exception 'control idempotency conflict' using errcode='23505';end if;return true;end if;
 if request_id_value is null or action_value not in ('hold','suspend','cancel','release','reconcile','revoke') then raise exception 'control invalid' using errcode='22023';end if;
 if action_value='reconcile' then update public.subscriptions set revision=revision+1 where id=s.id;perform private.entitlement_enqueue(s.id,'reconcile');
 else
 if s.state='CANCELLED' and action_value<>'cancel' then raise exception 'cancelled subscription' using errcode='42501';end if;
 if action_value='release' and (s.state not in ('HOLD','SUSPENDED') or s.grace_until<=now()) then raise exception 'release denied' using errcode='42501';end if;
 n:=case action_value when 'hold' then 'HOLD' when 'revoke' then 'HOLD' when 'suspend' then 'SUSPENDED' when 'cancel' then 'CANCELLED' else 'ACTIVE' end;
 update public.subscriptions set state=n,revision=revision+1 where id=s.id;
 update public.channel_access set status=case when action_value='release' then 'PENDING' else 'REVIEW' end,invite_expires_at=least(invite_expires_at,now()) where subscription_id=s.id;
 perform private.entitlement_enqueue(s.id,case when action_value='release' then 'invite' else 'revoke' end);end if;
 perform private.entitlement_audit_record(s.id,action_value,jsonb_build_object('request_id',request_id_value));return true;end;$$;
create function public.entitlement_tick(target_tenant_id uuid) returns int language plpgsql security definer set search_path=pg_catalog as $$declare s public.subscriptions%rowtype;n int:=0;begin
 for s in select sub.* from public.subscriptions sub where sub.tenant_id=target_tenant_id and sub.state in ('ACTIVE','RENEWAL_DUE') and exists(select 1 from public.subscription_payments p left join public.payment_invoices i on i.tenant_id=p.tenant_id and i.id=p.test_invoice_id where p.tenant_id=sub.tenant_id and p.subscription_id=sub.id and ((p.mode='test' and i.status in ('REVIEW','REFUNDED','FAILED','EXPIRED')) or (p.mode='live' and exists(select 1 from public.domain_events e where e.tenant_id=p.tenant_id and e.customer_id=sub.customer_id and e.event_type='payment.failed' and e.authority='TRUSTED' and e.producer='payment_verifier' and e.payload->>'payment_id'=p.receipt_id::text)))) for update skip locked loop
 update public.subscriptions set state='SUSPENDED',revision=revision+1 where id=s.id;update public.channel_access set status='REVIEW',invite_expires_at=least(invite_expires_at,now()) where subscription_id=s.id;perform private.entitlement_enqueue(s.id,'revoke');perform private.entitlement_audit_record(s.id,'payment_evidence_hold');n:=n+1;end loop;
 for s in select * from public.subscriptions where tenant_id=target_tenant_id and state in ('ACTIVE','RENEWAL_DUE') and (renewal_due_at<=now() or grace_until<=now()) for update skip locked loop
 if s.grace_until<=now() then update public.subscriptions set state='EXPIRED',revision=revision+1 where id=s.id;update public.channel_access set status='REVIEW',invite_expires_at=least(invite_expires_at,now()) where subscription_id=s.id;perform private.entitlement_enqueue(s.id,'revoke');perform private.entitlement_audit_record(s.id,'expired');
 elsif s.state='ACTIVE' then update public.subscriptions set state='RENEWAL_DUE' where id=s.id;perform private.entitlement_audit_record(s.id,'renewal_due');end if;n:=n+1;end loop;return n;end;$$;

create function public.entitlement_claim_job(target_tenant_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare j public.entitlement_jobs%rowtype;s public.subscriptions%rowtype;a public.channel_access%rowtype;b public.telegram_entitlement_bindings%rowtype;c public.vip_channels%rowtype;begin
 select * into j from public.entitlement_jobs where tenant_id=target_tenant_id and available_at<=now() and (status='PENDING' or (status='RUNNING' and lease_until<now())) order by available_at,id for update skip locked limit 1;if j.id is null then return null;end if;
 select * into a from public.channel_access where tenant_id=j.tenant_id and id=j.access_id;select * into s from public.subscriptions where id=a.subscription_id for update;
 if (s.mode='live' and not private.entitlement_live_allowed(s.tenant_id)) or (s.mode='test' and not private.entitlement_test_tenant(s.tenant_id)) then return null;end if;
 if j.revision<>s.revision or (j.operation in ('invite','join') and (s.state not in ('ACTIVE','RENEWAL_DUE') or s.grace_until<=now())) then update public.entitlement_jobs set status='STALE' where id=j.id;return null;end if;
 select * into b from public.telegram_entitlement_bindings where id=a.binding_id;select * into c from public.vip_channels where id=a.channel_id;
 if b.mode<>s.mode or c.mode<>s.mode or not c.enabled or not c.private_verified then raise exception 'access configuration denied' using errcode='42501';end if;
 update public.entitlement_jobs set status='RUNNING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where id=j.id returning * into j;
 perform private.entitlement_audit_record(s.id,'job_claimed',jsonb_build_object('job_id',j.id,'operation',j.operation,'attempt',j.attempts));
 return to_jsonb(j)||jsonb_build_object('mode',s.mode,'subscription_id',s.id,'telegram_user_id',b.telegram_user_id,'chat_id',c.chat_id,'invite_reference',a.invite_reference,'invite_expires_at',least(s.grace_until,now()+make_interval(secs=>c.invite_ttl_seconds)));end;$$;
create function public.entitlement_complete_job(target_tenant_id uuid,target_job_id uuid,lease_value uuid,result_value jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog as $$declare j public.entitlement_jobs%rowtype;a public.channel_access%rowtype;s public.subscriptions%rowtype;ref text;member text;begin
 select * into j from public.entitlement_jobs where tenant_id=target_tenant_id and id=target_job_id for update;
 if j.id is null or j.status<>'RUNNING' or j.lease_token is distinct from lease_value or j.lease_until<=now() then raise exception 'access lease denied' using errcode='42501';end if;
 select * into a from public.channel_access where id=j.access_id;select * into s from public.subscriptions where id=a.subscription_id for update;
 if j.revision<>s.revision or (j.operation in ('invite','join') and (s.state not in ('ACTIVE','RENEWAL_DUE') or s.grace_until<=now())) then update public.entitlement_jobs set status='STALE' where id=j.id;return false;end if;
 if (s.mode='live' and not private.entitlement_live_allowed(s.tenant_id)) or (s.mode='test' and not private.entitlement_test_tenant(s.tenant_id)) then raise exception 'access mode denied' using errcode='42501';end if;
 if result_value->>'ok' is distinct from 'true' then
  update public.entitlement_jobs set status=case when attempts>=5 then 'FAILED' else 'PENDING' end,available_at=now()+make_interval(secs=>least(300,10*(2^least(attempts,5))::int)),last_error='PROVIDER_FAILURE',lease_token=null,lease_until=null where id=j.id;
  update public.channel_access set status='REVIEW' where id=a.id;perform private.entitlement_audit_record(s.id,'retry',jsonb_build_object('job_id',j.id,'attempt',j.attempts));return false;end if;
 if j.operation='invite' then ref:=result_value->>'invite_reference';if ref is null or result_value->>'expires_at' is null or (s.mode='test' and ref!~'^test:invite:') or (s.mode='live' and ref!~'^https://t.me/\+[A-Za-z0-9_-]+$') or (result_value->>'expires_at')::timestamptz>least(s.grace_until,now()+interval '900 seconds') or (result_value->>'expires_at')::timestamptz<=now() then raise exception 'restricted invite required' using errcode='22023';end if;
 update public.channel_access set status='INVITED',invite_reference=ref,invite_expires_at=(result_value->>'expires_at')::timestamptz where id=a.id;
 elsif j.operation='revoke' then update public.channel_access set status='REVOKED',invite_reference=null,invite_expires_at=null,membership_checked_at=now() where id=a.id;
 else member:=result_value->>'membership';if member not in ('member','left','kicked') or member is null then raise exception 'membership evidence required' using errcode='22023';end if;
 if member='member' and s.state in ('ACTIVE','RENEWAL_DUE') and s.grace_until>now() then update public.channel_access set status='MEMBER',invite_reference=null,invite_expires_at=null,membership_checked_at=now() where id=a.id;
 elsif member='member' then update public.subscriptions set revision=revision+1 where id=s.id;update public.channel_access set status='REVIEW' where id=a.id;perform private.entitlement_enqueue(s.id,'revoke');
 else update public.channel_access set status='PENDING',membership_checked_at=now() where id=a.id;if s.state in ('ACTIVE','RENEWAL_DUE') and s.grace_until>now() then update public.subscriptions set revision=revision+1 where id=s.id;perform private.entitlement_enqueue(s.id,'invite');end if;end if;end if;
 update public.entitlement_jobs set status='DONE',lease_token=null,lease_until=null,last_error=null where id=j.id;perform private.entitlement_audit_record(s.id,'job_'||j.operation,jsonb_build_object('job_id',j.id));return true;end;$$;
create function public.entitlement_join_request(target_tenant_id uuid,target_access_id uuid,user_id_value text,invite_value text) returns boolean language plpgsql security definer set search_path=pg_catalog as $$declare a public.channel_access%rowtype;s public.subscriptions%rowtype;b public.telegram_entitlement_bindings%rowtype;begin
 select * into a from public.channel_access where tenant_id=target_tenant_id and id=target_access_id for update;select * into s from public.subscriptions where id=a.subscription_id for update;select * into b from public.telegram_entitlement_bindings where id=a.binding_id;
 if a.id is null or b.telegram_user_id is distinct from user_id_value or a.status<>'INVITED' or a.invite_reference is distinct from invite_value or a.invite_expires_at<=now() or s.grace_until<=now() or s.state not in ('ACTIVE','RENEWAL_DUE') then raise exception 'join authority denied' using errcode='42501';end if;
 perform private.entitlement_enqueue(s.id,'join');return true;end;$$;

create function public.admin_entitlement_list(target_tenant_id uuid,target_customer_id uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]) then raise exception 'entitlement permission denied' using errcode='42501';end if;
 return jsonb_build_object('observed_at',now(),'subscriptions',coalesce((select jsonb_agg(to_jsonb(s)) from (select * from public.subscriptions where tenant_id=target_tenant_id and (target_customer_id is null or customer_id=target_customer_id) order by created_at desc limit 100)s),'[]'),'access',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('telegram_user_id',case when private.has_tenant_role(target_tenant_id,array['super_admin','manager','support']::public.app_role[]) then b.telegram_user_id else 'restricted' end,'chat_id',c.chat_id)) from public.channel_access a join public.telegram_entitlement_bindings b on b.id=a.binding_id join public.vip_channels c on c.id=a.channel_id join public.subscriptions s on s.id=a.subscription_id where a.tenant_id=target_tenant_id and (target_customer_id is null or s.customer_id=target_customer_id)),'[]'),'payments',coalesce((select jsonb_agg(to_jsonb(p)) from public.subscription_payments p join public.subscriptions s on s.id=p.subscription_id where p.tenant_id=target_tenant_id and (target_customer_id is null or s.customer_id=target_customer_id)),'[]'),'jobs',coalesce((select jsonb_agg(to_jsonb(j)-array['lease_token']) from public.entitlement_jobs j join public.channel_access a on a.id=j.access_id join public.subscriptions s on s.id=a.subscription_id where j.tenant_id=target_tenant_id and (target_customer_id is null or s.customer_id=target_customer_id)),'[]'),'audit',coalesce((select jsonb_agg(to_jsonb(h)) from public.entitlement_audit h join public.subscriptions s on s.id=h.subscription_id where h.tenant_id=target_tenant_id and (target_customer_id is null or s.customer_id=target_customer_id)),'[]'));end;$$;

-- Privileged mutation is available only through checked functions, never browser table writes.
do $$declare t text;begin
 foreach t in array array['subscriptions','subscription_payments','vip_channels','telegram_entitlement_bindings','channel_access','entitlement_jobs','entitlement_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated,service_role',t);
 execute format('create policy entitlement_read on public.%I for select to authenticated using(private.has_tenant_role(tenant_id,array[''super_admin'',''manager'',''support'',''analyst'']::public.app_role[]))',t);end loop;
 foreach t in array array['entitlement_controls','verified_payment_receipts'] loop execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);end loop;end;$$;
revoke all on function private.entitlement_live_allowed(uuid),private.entitlement_test_tenant(uuid),private.entitlement_apply(uuid,uuid,text),private.entitlement_enqueue(uuid,text),private.entitlement_audit_record(uuid,text,jsonb),private.entitlement_immutable(),private.subscription_guard() from public,anon,authenticated,service_role;
revoke all on function public.subscription_expiry(timestamptz,jsonb),public.admin_create_test_subscription(uuid,uuid),public.admin_test_access_setup(uuid,uuid,uuid,text),public.admin_request_entitlement_access(uuid,uuid),public.admin_subscription_control(uuid,uuid,text,uuid),public.admin_entitlement_list(uuid,uuid),public.consume_verified_payment(uuid,uuid),public.bind_verified_telegram_identity(uuid,uuid,uuid),public.entitlement_tick(uuid),public.entitlement_claim_job(uuid),public.entitlement_complete_job(uuid,uuid,uuid,jsonb),public.entitlement_join_request(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_create_test_subscription(uuid,uuid),public.admin_test_access_setup(uuid,uuid,uuid,text),public.admin_request_entitlement_access(uuid,uuid),public.admin_subscription_control(uuid,uuid,text,uuid),public.admin_entitlement_list(uuid,uuid) to authenticated;
grant execute on function public.consume_verified_payment(uuid,uuid),public.bind_verified_telegram_identity(uuid,uuid,uuid),public.entitlement_tick(uuid),public.entitlement_claim_job(uuid),public.entitlement_complete_job(uuid,uuid,uuid,jsonb),public.entitlement_join_request(uuid,uuid,text,text) to service_role;
-- Read-only receipts for the existing conversation quality evidence boundary.
create function public.entitlement_conversation_receipts(target_tenant_id uuid,target_conversation_id uuid,boundary_value timestamptz) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'subscription_id',s.id,'verified_at',r.verified_at,'starts_at',s.starts_at,'ends_at',s.ends_at,'state',s.state,'membership',a.status,'membership_checked_at',a.membership_checked_at)),'[]') from public.conversations c join public.subscriptions s on s.tenant_id=c.tenant_id and s.customer_id=c.customer_id join public.subscription_payments p on p.tenant_id=s.tenant_id and p.subscription_id=s.id join private.verified_payment_receipts r on r.tenant_id=p.tenant_id and r.id=p.receipt_id left join public.channel_access a on a.subscription_id=s.id where c.tenant_id=target_tenant_id and c.id=target_conversation_id and s.mode='live' and p.mode='live' and private.entitlement_live_allowed(s.tenant_id) and r.verified_at<=boundary_value and s.starts_at<=boundary_value and s.state in ('ACTIVE','RENEWAL_DUE') and s.grace_until>greatest(boundary_value,now());
$$;
revoke all on function public.entitlement_conversation_receipts(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.entitlement_conversation_receipts(uuid,uuid,timestamptz) to service_role;
create function public.entitlement_ready_test_tenants() returns setof uuid language sql stable security definer set search_path=pg_catalog as $$select t.id from public.tenants t where private.entitlement_test_tenant(t.id) and exists(select 1 from public.subscriptions s where s.tenant_id=t.id and s.mode='test') limit 10;$$;
revoke all on function public.entitlement_ready_test_tenants() from public,anon,authenticated;
grant execute on function public.entitlement_ready_test_tenants() to service_role;
-- Identity values are restricted consistently with the existing Customer OS role matrix.
drop policy entitlement_read on public.telegram_entitlement_bindings;
create policy entitlement_binding_read on public.telegram_entitlement_bindings for select to authenticated using(private.has_tenant_role(tenant_id,array['super_admin','manager','support']::public.app_role[]));
