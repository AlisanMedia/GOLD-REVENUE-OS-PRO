-- Bounded TEST maintenance only. Legacy entitlement_tick/LIVE semantics are unchanged.
-- These partial indexes support due-date heads without sorting tenant-wide history.
create index entitlement_test_expiry_due on public.subscriptions(tenant_id,grace_until,id)
 where mode='test' and state in ('ACTIVE','RENEWAL_DUE');
create index entitlement_test_renewal_due on public.subscriptions(tenant_id,renewal_due_at,id)
 where mode='test' and state='ACTIVE';

create function public.entitlement_test_maintenance_v1(target_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.subscriptions%rowtype; held integer:=0; expired integer:=0; due integer:=0; more boolean;
begin
 if not private.entitlement_test_tenant(target_tenant_id) then
  raise exception 'isolated test authority required' using errcode='42501';end if;
 -- Shares the claimant's nonblocking tenant scheduler guard. No policy reset or
 -- new retry authority; a contended cycle explicitly reports incomplete work.
 if not pg_try_advisory_xact_lock(hashtextextended('entitlement-test-cycle-v1:'||target_tenant_id::text,0)) then
  return jsonb_build_object('version',1,'processed',0,'held',0,'expired',0,'renewal_due',0,'has_more',true,'busy',true);end if;
 -- Each lane has a fixed independent quota; recurring RENEWAL_DUE rows are not
 -- counted as fresh work. Skip locked subscriptions instead of waiting on workers.
 for s in select sub.* from public.subscriptions sub
  where sub.tenant_id=target_tenant_id and sub.mode='test' and sub.state in ('ACTIVE','RENEWAL_DUE')
   and exists(select 1 from public.subscription_payments p join public.payment_invoices i on i.tenant_id=p.tenant_id and i.id=p.test_invoice_id
    where p.tenant_id=sub.tenant_id and p.subscription_id=sub.id and p.mode='test' and i.status in ('REVIEW','REFUNDED','FAILED','EXPIRED'))
  order by sub.id for update of sub skip locked limit 9 loop
  update public.subscriptions set state='SUSPENDED',revision=revision+1 where id=s.id;
  update public.channel_access set status='REVIEW',invite_expires_at=least(invite_expires_at,now()) where subscription_id=s.id;
  perform private.entitlement_enqueue(s.id,'revoke');
  perform private.entitlement_audit_record(s.id,'payment_evidence_hold');held:=held+1;
 end loop;
 for s in select sub.* from public.subscriptions sub
  where sub.tenant_id=target_tenant_id and sub.mode='test' and sub.state in ('ACTIVE','RENEWAL_DUE') and sub.grace_until<=now()
 and not exists(select 1 from public.subscription_payments p join public.payment_invoices i on i.tenant_id=p.tenant_id and i.id=p.test_invoice_id
   where p.tenant_id=sub.tenant_id and p.subscription_id=sub.id and p.mode='test' and i.status in ('REVIEW','REFUNDED','FAILED','EXPIRED'))
  order by sub.grace_until,sub.id for update of sub skip locked limit 8 loop
  update public.subscriptions set state='EXPIRED',revision=revision+1 where id=s.id;
  update public.channel_access set status='REVIEW',invite_expires_at=least(invite_expires_at,now()) where subscription_id=s.id;
  perform private.entitlement_enqueue(s.id,'revoke');
  perform private.entitlement_audit_record(s.id,'expired');expired:=expired+1;
 end loop;
 for s in select sub.* from public.subscriptions sub
  where sub.tenant_id=target_tenant_id and sub.mode='test' and sub.state='ACTIVE' and sub.grace_until>now() and sub.renewal_due_at<=now()
 and not exists(select 1 from public.subscription_payments p join public.payment_invoices i on i.tenant_id=p.tenant_id and i.id=p.test_invoice_id
   where p.tenant_id=sub.tenant_id and p.subscription_id=sub.id and p.mode='test' and i.status in ('REVIEW','REFUNDED','FAILED','EXPIRED'))
  order by sub.renewal_due_at,sub.id for update of sub skip locked limit 8 loop
  update public.subscriptions set state='RENEWAL_DUE' where id=s.id;
  perform private.entitlement_audit_record(s.id,'renewal_due');due:=due+1;
 end loop;
 select exists(select 1 from public.subscriptions sub where sub.tenant_id=target_tenant_id and sub.mode='test' and sub.state in ('ACTIVE','RENEWAL_DUE')
  and (sub.grace_until<=now() or (sub.state='ACTIVE' and sub.renewal_due_at<=now()) or exists(
   select 1 from public.subscription_payments p join public.payment_invoices i on i.tenant_id=p.tenant_id and i.id=p.test_invoice_id
   where p.tenant_id=sub.tenant_id and p.subscription_id=sub.id and p.mode='test' and i.status in ('REVIEW','REFUNDED','FAILED','EXPIRED')))) into more;
 return jsonb_build_object('version',1,'processed',held+expired+due,'held',held,'expired',expired,'renewal_due',due,'has_more',more,'busy',false);
end;$$;
revoke all on function public.entitlement_test_maintenance_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.entitlement_test_maintenance_v1(uuid) to service_role;
