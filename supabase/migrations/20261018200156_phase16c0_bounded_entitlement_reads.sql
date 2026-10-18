-- Phase 16C-0: read authority only. No worker, receipt, lifecycle or live switch changes.
-- Existing channel_access(tenant_id,id) and Phase15 payment indexes are reused.
create index entitlement_admin_subscriptions_page on public.subscriptions(tenant_id,created_at desc,id desc);
create index entitlement_admin_jobs_page on public.entitlement_jobs(tenant_id,id desc);
create index entitlement_admin_jobs_access_page on public.entitlement_jobs(tenant_id,access_id,id desc);
create index entitlement_admin_audit_page on public.entitlement_audit(tenant_id,created_at desc,id desc);
create index entitlement_admin_audit_subscription_page on public.entitlement_audit(tenant_id,subscription_id,created_at desc,id desc);

-- Explicit allowlists; a future source column never becomes an Admin response field.
create function private.entitlement_admin_subscription(s public.subscriptions) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('id',s.id,'customer_id',s.customer_id,'plan_version_id',s.plan_version_id,
  'mode',s.mode,'state',s.state,'starts_at',s.starts_at,'ends_at',s.ends_at,'grace_until',s.grace_until,
  'renewal_due_at',s.renewal_due_at,'created_at',s.created_at,'revision',s.revision,
  'plan_snapshot',jsonb_build_object('title',left(s.plan_snapshot->>'title',160),
   'duration_unit',case when s.plan_snapshot->>'duration_unit' in ('fixed_days','calendar_month','calendar_year') then s.plan_snapshot->>'duration_unit' end,
   'duration_count',case when jsonb_typeof(s.plan_snapshot->'duration_count')='number' then s.plan_snapshot->'duration_count' end,
   'grace_days',case when jsonb_typeof(s.plan_snapshot->'grace_days')='number' then s.plan_snapshot->'grace_days' end,
   'renewal_notice_days',case when jsonb_typeof(s.plan_snapshot->'renewal_notice_days')='number' then s.plan_snapshot->'renewal_notice_days' end),
  'has_payment',exists(select 1 from public.subscription_payments p where p.tenant_id=s.tenant_id and p.subscription_id=s.id),
  'access_status',(select a.status from public.channel_access a where a.tenant_id=s.tenant_id and a.subscription_id=s.id));
$$;

create function private.entitlement_admin_access(a public.channel_access,cid uuid,identity_allowed boolean,invite_allowed boolean) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('id',a.id,'subscription_id',a.subscription_id,'customer_id',cid,'mode',a.mode,'status',a.status,
  'telegram_user_id',case when identity_allowed then b.telegram_user_id end,'chat_id',case when identity_allowed then c.chat_id end,
  'invite_reference',case when invite_allowed and length(a.invite_reference)<=512 and a.invite_reference~'^(test:invite:|https://t\.me/\+[A-Za-z0-9_-]+$)' then a.invite_reference end,
  'invite_present',a.invite_reference is not null,'invite_expires_at',a.invite_expires_at,'membership_checked_at',a.membership_checked_at)
 from public.telegram_entitlement_bindings b join public.vip_channels c on c.tenant_id=b.tenant_id
 where b.tenant_id=a.tenant_id and b.id=a.binding_id and c.id=a.channel_id;
$$;

-- Cursor is navigation data, never authorization. Its scope hash binds the current
-- authenticated actor, role, tenant, filters and size without placing those in URLs.
-- Boundary/anchor rows are independently validated within the authorized scope.
-- Immutable sort keys prevent worker updates from reordering rows. Concurrent new
-- rows behind an already visited boundary require refresh (explicit in UI/contract).
create function public.admin_entitlement_page_v1(
 target_tenant_id uuid,collection_value text default 'subscriptions',target_customer_id uuid default null,
 target_subscription_id uuid default null,page_size_value integer default 25,cursor_value jsonb default null
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog set plan_cache_mode=force_custom_plan as $$
declare
 r public.app_role; identity_allowed boolean; invite_allowed boolean; scope_value text;
 n integer:=coalesce(page_size_value,25); started timestamptz:=statement_timestamp();
 after_id uuid; after_time timestamptz; anchor_id uuid; anchor_time timestamptz;
 after_actual timestamptz; anchor_actual timestamptz; boundary_found boolean; anchor_found boolean;
 rows_value jsonb; items_value jsonb; last_value jsonb; first_value jsonb; more_value boolean;
begin
 if auth.uid() is null or not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]) then
  raise exception 'entitlement permission denied' using errcode='42501';
 end if;
 select m.role into r from public.tenant_members m where m.tenant_id=target_tenant_id and m.user_id=auth.uid() and m.status='active';
 identity_allowed:=r in ('super_admin','manager','support'); invite_allowed:=r in ('super_admin','manager');
 if collection_value is null or collection_value not in ('subscriptions','access','payments','jobs','audit') or n not between 1 and 100 then
  raise exception 'entitlement page invalid' using errcode='22023';
 end if;
 -- Foreign and nonexistent IDs have the same response; no foreign row is inspected.
 if target_customer_id is not null and not exists(select 1 from public.customers c where c.tenant_id=target_tenant_id and c.id=target_customer_id) then
  raise exception 'entitlement scope unavailable' using errcode='22023';
 end if;
 if target_subscription_id is not null and not exists(select 1 from public.subscriptions s where s.tenant_id=target_tenant_id and s.id=target_subscription_id and (target_customer_id is null or s.customer_id=target_customer_id)) then
  raise exception 'entitlement scope unavailable' using errcode='22023';
 end if;
 scope_value:=encode(extensions.digest(jsonb_build_array(1,target_tenant_id,auth.uid(),r,collection_value,target_customer_id,target_subscription_id,n)::text,'sha256'),'hex');
 if cursor_value is not null then
  begin
   if jsonb_typeof(cursor_value)<>'object' or octet_length(cursor_value::text)>1024 or
    (select count(*) from jsonb_object_keys(cursor_value))<>7 or cursor_value->>'scope' is distinct from scope_value or
    not (cursor_value ?& array['scope','started_at','after_id','after_time','anchor_id','anchor_time','version']) or cursor_value->>'version'<>'1' then
    raise exception 'invalid cursor';
   end if;
   started:=(cursor_value->>'started_at')::timestamptz;
   after_id:=(cursor_value->>'after_id')::uuid; anchor_id:=(cursor_value->>'anchor_id')::uuid;
   after_time:=(cursor_value->>'after_time')::timestamptz; anchor_time:=(cursor_value->>'anchor_time')::timestamptz;
   if started is null or not isfinite(started) or started>statement_timestamp() or started<statement_timestamp()-interval '30 minutes' or after_id is null or anchor_id is null or
    (collection_value in ('subscriptions','payments','audit') and (after_time is null or anchor_time is null or not isfinite(after_time) or not isfinite(anchor_time))) or
    (collection_value in ('access','jobs') and (after_time is not null or anchor_time is not null)) then raise exception 'invalid cursor';end if;
   if collection_value in ('subscriptions','payments','audit') then
    if (after_time,after_id)>(anchor_time,anchor_id) then raise exception 'invalid cursor';end if;
   elsif after_id>anchor_id then raise exception 'invalid cursor';end if;
  exception when others then raise exception 'entitlement cursor invalid; refresh' using errcode='22023';end;
 end if;

 if collection_value='subscriptions' then
  if cursor_value is not null then
   select s.created_at into after_actual from public.subscriptions s where s.tenant_id=target_tenant_id and s.id=after_id and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id);boundary_found:=found;
   select s.created_at into anchor_actual from public.subscriptions s where s.tenant_id=target_tenant_id and s.id=anchor_id and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id);anchor_found:=found;
  end if;
  select coalesce(jsonb_agg(q.row_value order by q.sort_time desc,q.id desc),'[]'::jsonb) into rows_value from (
   select s.id,s.created_at as sort_time,jsonb_build_object('id',s.id,'time',s.created_at,'data',private.entitlement_admin_subscription(s)) as row_value
   from public.subscriptions s where s.tenant_id=target_tenant_id and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id)
    and (after_id is null or (s.created_at,s.id)<(after_time,after_id)) and (anchor_id is null or (s.created_at,s.id)<=(anchor_time,anchor_id))
   order by s.created_at desc,s.id desc limit n+1
  ) q;
 elsif collection_value='access' then
  if cursor_value is not null then
   select true into boundary_found from public.channel_access a join public.subscriptions s on s.tenant_id=a.tenant_id and s.id=a.subscription_id where a.tenant_id=target_tenant_id and a.id=after_id and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id);
   select true into anchor_found from public.channel_access a join public.subscriptions s on s.tenant_id=a.tenant_id and s.id=a.subscription_id where a.tenant_id=target_tenant_id and a.id=anchor_id and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id);
  end if;
  select coalesce(jsonb_agg(q.row_value order by q.id desc),'[]'::jsonb) into rows_value from (
   select a.id,jsonb_build_object('id',a.id,'time',null,'data',private.entitlement_admin_access(a,s.customer_id,identity_allowed,invite_allowed)) as row_value
   from public.channel_access a join public.subscriptions s on s.tenant_id=a.tenant_id and s.id=a.subscription_id where a.tenant_id=target_tenant_id
    and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id)
    and (after_id is null or a.id<after_id) and (anchor_id is null or a.id<=anchor_id)
   order by a.id desc limit n+1
  ) q;
 elsif collection_value='payments' then
  if cursor_value is not null then
   select p.period_start into after_actual from public.subscription_payments p join public.subscriptions s on s.tenant_id=p.tenant_id and s.id=p.subscription_id where p.tenant_id=target_tenant_id and p.id=after_id and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id);boundary_found:=found;
   select p.period_start into anchor_actual from public.subscription_payments p join public.subscriptions s on s.tenant_id=p.tenant_id and s.id=p.subscription_id where p.tenant_id=target_tenant_id and p.id=anchor_id and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id);anchor_found:=found;
  end if;
  select coalesce(jsonb_agg(q.row_value order by q.sort_time desc,q.id desc),'[]'::jsonb) into rows_value from (
   select p.id,p.period_start as sort_time,jsonb_build_object('id',p.id,'time',p.period_start,'data',jsonb_build_object('id',p.id,'subscription_id',p.subscription_id,'mode',p.mode,
    'event_id',case when identity_allowed then p.event_id end,'test_invoice_id',case when identity_allowed then p.test_invoice_id end,'receipt_id',case when identity_allowed then p.receipt_id end,
    'period_start',p.period_start,'period_end',p.period_end)) as row_value
   from public.subscription_payments p join public.subscriptions s on s.tenant_id=p.tenant_id and s.id=p.subscription_id where p.tenant_id=target_tenant_id
    and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id)
    and (after_id is null or (p.period_start,p.id)<(after_time,after_id)) and (anchor_id is null or (p.period_start,p.id)<=(anchor_time,anchor_id))
   order by p.period_start desc,p.id desc limit n+1
  ) q;
 elsif collection_value='jobs' then
  if cursor_value is not null then
   select true into boundary_found from public.entitlement_jobs j join public.channel_access a on a.tenant_id=j.tenant_id and a.id=j.access_id join public.subscriptions s on s.tenant_id=a.tenant_id and s.id=a.subscription_id where j.tenant_id=target_tenant_id and j.id=after_id and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id);
   select true into anchor_found from public.entitlement_jobs j join public.channel_access a on a.tenant_id=j.tenant_id and a.id=j.access_id join public.subscriptions s on s.tenant_id=a.tenant_id and s.id=a.subscription_id where j.tenant_id=target_tenant_id and j.id=anchor_id and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id);
  end if;
  select coalesce(jsonb_agg(q.row_value order by q.id desc),'[]'::jsonb) into rows_value from (
   select j.id,jsonb_build_object('id',j.id,'time',null,'data',jsonb_build_object('id',j.id,'access_id',j.access_id,'subscription_id',s.id,
    'operation',j.operation,'status',j.status,'attempts',j.attempts,'available_at',j.available_at,
    'last_error',case when j.last_error='PROVIDER_FAILURE' then 'PROVIDER_FAILURE' when j.last_error is not null then 'DETAILS_RESTRICTED' end)) as row_value
   from public.entitlement_jobs j join public.channel_access a on a.tenant_id=j.tenant_id and a.id=j.access_id join public.subscriptions s on s.tenant_id=a.tenant_id and s.id=a.subscription_id
   where j.tenant_id=target_tenant_id and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id)
    and (after_id is null or j.id<after_id) and (anchor_id is null or j.id<=anchor_id)
   order by j.id desc limit n+1
  ) q;
 else
  if cursor_value is not null then
   select h.created_at into after_actual from public.entitlement_audit h join public.subscriptions s on s.tenant_id=h.tenant_id and s.id=h.subscription_id where h.tenant_id=target_tenant_id and h.id=after_id and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id);boundary_found:=found;
   select h.created_at into anchor_actual from public.entitlement_audit h join public.subscriptions s on s.tenant_id=h.tenant_id and s.id=h.subscription_id where h.tenant_id=target_tenant_id and h.id=anchor_id and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id);anchor_found:=found;
  end if;
  select coalesce(jsonb_agg(q.row_value order by q.sort_time desc,q.id desc),'[]'::jsonb) into rows_value from (
   select h.id,h.created_at as sort_time,jsonb_build_object('id',h.id,'time',h.created_at,'data',jsonb_build_object('id',h.id,'subscription_id',h.subscription_id,
    'action',case when h.action in ('activated','renewed','access_scope_review','access_requested','hold','suspend','cancel','release','reconcile','revoke','payment_evidence_hold','expired','renewal_due','job_claimed','retry','job_invite','job_join','job_revoke','job_reconcile') then h.action else 'OTHER' end,'mode',h.mode,'created_at',h.created_at,'details',case when identity_allowed then jsonb_strip_nulls(jsonb_build_object(
     'operation',case when h.details->>'operation' in ('invite','join','revoke','reconcile') then h.details->>'operation' end,
     'attempt',case when h.details->>'attempt'~'^[0-9]{1,5}$' then (h.details->>'attempt')::integer end)) else '{}'::jsonb end)) as row_value
   from public.entitlement_audit h join public.subscriptions s on s.tenant_id=h.tenant_id and s.id=h.subscription_id where h.tenant_id=target_tenant_id
    and (target_customer_id is null or s.customer_id=target_customer_id) and (target_subscription_id is null or s.id=target_subscription_id)
    and (after_id is null or (h.created_at,h.id)<(after_time,after_id)) and (anchor_id is null or (h.created_at,h.id)<=(anchor_time,anchor_id))
   order by h.created_at desc,h.id desc limit n+1
  ) q;
 end if;
 if cursor_value is not null and (not coalesce(boundary_found,false) or not coalesce(anchor_found,false) or
  (collection_value in ('subscriptions','payments','audit') and (after_actual is distinct from after_time or anchor_actual is distinct from anchor_time))) then
  raise exception 'entitlement cursor invalid; refresh' using errcode='22023';
 end if;
 more_value:=jsonb_array_length(rows_value)>n;
 select coalesce(jsonb_agg(e.value->'data' order by e.ordinality),'[]'::jsonb) into items_value from jsonb_array_elements(rows_value) with ordinality e where e.ordinality<=n;
 first_value:=rows_value->0; last_value:=rows_value->(least(n,jsonb_array_length(rows_value))-1);
 return jsonb_build_object('version',1,'collection',collection_value,'observed_at',statement_timestamp(),'started_at',started,'page_size',n,
  'items',items_value,'has_more',more_value,'consistency','LIVE_KEYSET_REFRESH_FOR_CHANGES','next_cursor',case when more_value then jsonb_build_object(
   'version',1,'scope',scope_value,'started_at',started,'after_id',last_value->'id','after_time',last_value->'time',
   'anchor_id',coalesce(to_jsonb(anchor_id),first_value->'id'),'anchor_time',case when anchor_id is not null then to_jsonb(anchor_time) else first_value->'time' end) end);
end;$$;

create function private.entitlement_admin_terms(d jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('locale',case when d->>'locale' in ('en','tr','ar','ru') then d->>'locale' end,
  'amount',case when d->>'amount'~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$' then d->>'amount' end,
  'currency',case when d->>'currency'~'^[A-Z]{3}$' then d->>'currency' end,
  'billing',case when d->>'billing' in ('one_off','recurring','unknown') then d->>'billing' end,
  'terms',left(d->>'terms',1200),'tax_rule',left(d->>'tax_rule',300),
  'renewal_rule',left(d->>'renewal_rule',300),'cancellation_rule',left(d->>'cancellation_rule',300),
  'inclusions',coalesce((select jsonb_agg(left(d->'inclusions'->>x.n,300) order by x.n) from generate_series(0,11) x(n) where jsonb_typeof(d->'inclusions')='array' and jsonb_typeof(d->'inclusions'->x.n)='string'),'[]'::jsonb),
  'restrictions',coalesce((select jsonb_agg(left(d->'restrictions'->>x.n,300) order by x.n) from generate_series(0,11) x(n) where jsonb_typeof(d->'restrictions')='array' and jsonb_typeof(d->'restrictions'->x.n)='string'),'[]'::jsonb),
  'disclosures',coalesce((select jsonb_agg(left(d->'disclosures'->>x.n,300) order by x.n) from generate_series(0,11) x(n) where jsonb_typeof(d->'disclosures')='array' and jsonb_typeof(d->'disclosures'->x.n)='string'),'[]'::jsonb));
$$;

create function public.admin_subscription_detail_v1(target_tenant_id uuid,target_subscription_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare s public.subscriptions%rowtype; result_value jsonb; identity_allowed boolean; invite_allowed boolean;
begin
 if auth.uid() is null or not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]) then
  raise exception 'entitlement permission denied' using errcode='42501';end if;
 select s0.id,s0.tenant_id,s0.customer_id,s0.plan_version_id,s0.mode,s0.state,s0.plan_snapshot,s0.commercial_snapshot,s0.starts_at,s0.ends_at,s0.grace_until,s0.renewal_due_at,s0.revision,s0.created_at into s
 from public.subscriptions s0 where s0.tenant_id=target_tenant_id and s0.id=target_subscription_id;
 if not found then return null;end if;
 identity_allowed:=private.has_tenant_role(target_tenant_id,array['super_admin','manager','support']::public.app_role[]);
 invite_allowed:=private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]);
 select private.entitlement_admin_access(a,s.customer_id,identity_allowed,invite_allowed) into result_value from public.channel_access a where a.tenant_id=target_tenant_id and a.subscription_id=s.id;
 return jsonb_build_object('version',1,'observed_at',statement_timestamp(),'subscription',private.entitlement_admin_subscription(s),'access',result_value,'plan_terms',private.entitlement_admin_terms(s.plan_snapshot));
end;$$;

-- Compatibility for the accepted Phase11 verifier. All five collections now have
-- independent limits and explicit incomplete metadata. New UI uses versioned pages.
create or replace function public.admin_entitlement_list(target_tenant_id uuid,target_customer_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare k text; p jsonb; result_value jsonb:=jsonb_build_object('observed_at',statement_timestamp()); pages_value jsonb:='{}';
begin
 foreach k in array array['subscriptions','access','payments','jobs','audit'] loop
  p:=public.admin_entitlement_page_v1(target_tenant_id,k,target_customer_id,null,100,null);
  result_value:=result_value||jsonb_build_object(k,p->'items');pages_value:=pages_value||jsonb_build_object(k,p-'items');
 end loop;
 return result_value||jsonb_build_object('pages',pages_value,'compatibility','BOUNDED_V1_USE_PAGED_RPC');
end;$$;

-- Close raw-row projection bypasses. Safe column reads retain accepted Phase11
-- RLS/count contracts; sensitive records are accessible only via checked projections.
revoke select on public.subscriptions,public.subscription_payments,public.channel_access,public.entitlement_jobs,public.entitlement_audit,public.telegram_entitlement_bindings,public.vip_channels from authenticated;
grant select(id,tenant_id,customer_id,plan_version_id,mode,state,starts_at,ends_at,grace_until,renewal_due_at,revision,created_at) on public.subscriptions to authenticated;
grant select(id,tenant_id,subscription_id,mode,period_start,period_end) on public.subscription_payments to authenticated;
revoke all on function private.entitlement_admin_subscription(public.subscriptions),private.entitlement_admin_access(public.channel_access,uuid,boolean,boolean),private.entitlement_admin_terms(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_entitlement_page_v1(uuid,text,uuid,uuid,integer,jsonb),public.admin_subscription_detail_v1(uuid,uuid),public.admin_entitlement_list(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_entitlement_page_v1(uuid,text,uuid,uuid,integer,jsonb),public.admin_subscription_detail_v1(uuid,uuid),public.admin_entitlement_list(uuid,uuid) to authenticated;
