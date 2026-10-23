-- Read-only supplement to the existing paged Admin jobs. No retry/reset writer.
create function public.admin_entitlement_job_health_v1(target_tenant_id uuid,target_subscription_id uuid,job_ids_value uuid[]) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare role_value public.app_role; detail_allowed boolean; items_value jsonb; n integer;
begin
 if auth.uid() is null or not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]) then
  raise exception 'entitlement permission denied' using errcode='42501';end if;
 select role into role_value from public.tenant_members where tenant_id=target_tenant_id and user_id=auth.uid() and status='active';
 detail_allowed:=role_value in ('super_admin','manager','support');
 if job_ids_value is null or coalesce(array_ndims(job_ids_value),1)<>1 or cardinality(job_ids_value)>100 or array_position(job_ids_value,null) is not null
  or (select count(distinct x) from unnest(job_ids_value) x)<>cardinality(job_ids_value) then
  raise exception 'entitlement scope unavailable' using errcode='22023';end if;
 if not exists(select 1 from public.subscriptions where tenant_id=target_tenant_id and id=target_subscription_id) then
  raise exception 'entitlement scope unavailable' using errcode='22023';end if;
 select count(*) into n from public.entitlement_jobs j join public.channel_access a on a.tenant_id=j.tenant_id and a.id=j.access_id
  where j.tenant_id=target_tenant_id and a.subscription_id=target_subscription_id and j.id=any(job_ids_value);
 if n<>cardinality(job_ids_value) then raise exception 'entitlement scope unavailable' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'job_id',j.id,'mode',a.mode,'financial_authority','NONE','retry_authority','NONE',
  'revision_current',j.revision=s.revision,
  'review_required',j.status='FAILED' or coalesce(r.uncertain,false),
  'obligation',case when j.operation in ('revoke','reconcile') and j.status<>'DONE' then upper(j.operation) else 'NONE' end,
  'reason',case when not detail_allowed then 'RESTRICTED' when a.mode<>'test' then 'UNRECORDED'
   when coalesce(r.uncertain,false) or j.last_error='TEST_UNKNOWN_EFFECT' then 'UNKNOWN_EFFECT'
   when j.last_error='TEST_RECLAIM_BUDGET_EXHAUSTED' then 'RECLAIM_BUDGET'
   when j.last_error='TEST_CLAIM_BUDGET_EXHAUSTED' then 'CLAIM_BUDGET'
   when j.last_error='TEST_PROVIDER_FAILURE_BUDGET' then 'PROVIDER_FAILURE_BUDGET'
   when j.last_error='PROVIDER_FAILURE' then 'PROVIDER_FAILURE'
   when j.last_error='TEST_REVISION_STALE' then 'REVISION_STALE' else 'UNRECORDED' end,
  'claims',case when detail_allowed and a.mode='test' then r.claims end,
  'reclaims',case when detail_allowed and a.mode='test' then r.reclaims end,
  'provider_failures',case when detail_allowed and a.mode='test' then r.provider_failures end,
  'effect_state',case when not detail_allowed then 'RESTRICTED' when a.mode<>'test' or r.job_id is null then 'UNRECORDED'
   when r.uncertain then 'UNCERTAIN' when r.legacy_untracked then 'UNTRACKED' when r.dispatch_started then 'STARTED' else 'NOT_STARTED' end,
  'lease_state',case when not detail_allowed then 'RESTRICTED' when j.status<>'RUNNING' then 'NONE'
   when j.lease_until is null then 'UNKNOWN' when j.lease_until<=statement_timestamp() then 'EXPIRED' else 'ACTIVE' end
 ) order by j.id),'[]'::jsonb) into items_value
 from public.entitlement_jobs j join public.channel_access a on a.tenant_id=j.tenant_id and a.id=j.access_id
 join public.subscriptions s on s.tenant_id=a.tenant_id and s.id=a.subscription_id
 left join private.entitlement_test_runtime r on r.job_id=j.id and r.tenant_id=j.tenant_id
 where j.tenant_id=target_tenant_id and s.id=target_subscription_id and j.id=any(job_ids_value);
 return jsonb_build_object('version',1,'subscription_id',target_subscription_id,'observed_at',statement_timestamp(),'items',items_value);
end;$$;
revoke all on function public.admin_entitlement_job_health_v1(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_entitlement_job_health_v1(uuid,uuid,uuid[]) to authenticated;
