-- Repository/disposable PostgreSQL only. No hosted migration or LIVE policy approval.
-- Legacy LIVE function bodies are retained below; all new branches require TEST.
create table private.entitlement_test_runtime (
 job_id uuid primary key references public.entitlement_jobs(id),
 tenant_id uuid not null references public.tenants(id),
 claims integer not null default 0 check (claims between 0 and 7),
 reclaims integer not null default 0 check (reclaims between 0 and 2),
 provider_failures integer not null default 0 check (provider_failures between 0 and 5),
 dispatch_started boolean not null default false,
 legacy_untracked boolean not null default false,
 uncertain boolean not null default false
);
create table private.entitlement_test_policy (
 tenant_id uuid primary key references public.tenants(id),
 admission_enabled boolean not null default true,
 reconciliation_enabled boolean not null default true,
 revocation_enabled boolean not null default true,
 next_lane integer not null default 0 check (next_lane between 0 and 2)
);
alter table private.entitlement_test_runtime enable row level security;
alter table private.entitlement_test_policy enable row level security;
revoke all on private.entitlement_test_runtime,private.entitlement_test_policy from public,anon,authenticated,service_role;

-- Three indexed heads, not an unbounded sort of the entire due queue.
create index entitlement_jobs_test_lanes on public.entitlement_jobs
 (tenant_id,(case operation when 'revoke' then 0 when 'reconcile' then 1 else 2 end),available_at,id)
 where status in ('PENDING','RUNNING');

create function private.entitlement_test_authority_v1(t uuid,op text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select private.entitlement_test_tenant(t) and case
  when op in ('invite','join') then coalesce(p.admission_enabled,true)
  when op='reconcile' then coalesce(p.reconciliation_enabled,true)
  when op='revoke' then coalesce(p.revocation_enabled,true)
  else false end
 from (select 1) anchor left join private.entitlement_test_policy p on p.tenant_id=t;
$$;

create function private.entitlement_test_review_v1(jid uuid,reason text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.entitlement_jobs%rowtype; a public.channel_access%rowtype; sid uuid;
begin
 select * into j from public.entitlement_jobs where id=jid for update;
 select * into a from public.channel_access where id=j.access_id and tenant_id=j.tenant_id;
 select id into sid from public.subscriptions where id=a.subscription_id and tenant_id=j.tenant_id and mode='test' for update;
 if sid is null or a.mode<>'test' or not private.entitlement_test_tenant(j.tenant_id)
  or reason not in ('TEST_RECLAIM_BUDGET_EXHAUSTED','TEST_CLAIM_BUDGET_EXHAUSTED','TEST_UNKNOWN_EFFECT','TEST_PROVIDER_FAILURE_BUDGET')
 then raise exception 'isolated test authority required' using errcode='42501'; end if;
 update public.entitlement_jobs set status='FAILED',last_error=reason,lease_token=null,lease_until=null where id=j.id;
 update private.entitlement_test_runtime set uncertain=uncertain or reason='TEST_UNKNOWN_EFFECT' where job_id=j.id;
 update public.channel_access set status='REVIEW' where id=a.id;
 perform private.entitlement_audit_record(sid,'test_job_review',jsonb_build_object('job_id',j.id,'operation',j.operation,'reason',reason));
 -- FAILED retains the revoke/reconcile obligation. No success or revocation is inferred.
end;$$;

create function private.entitlement_test_stale_v1(jid uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.entitlement_jobs%rowtype; a public.channel_access%rowtype; s public.subscriptions%rowtype; started boolean; repair text;
begin
 select * into j from public.entitlement_jobs where id=jid for update;
 select * into a from public.channel_access where id=j.access_id and tenant_id=j.tenant_id;
 select * into s from public.subscriptions where id=a.subscription_id and tenant_id=j.tenant_id and mode='test' for update;
 if s.id is null or a.mode<>'test' or not private.entitlement_test_tenant(j.tenant_id) then
  raise exception 'isolated test authority required' using errcode='42501'; end if;
 select dispatch_started or legacy_untracked into started from private.entitlement_test_runtime where job_id=j.id;
 started:=coalesce(started,j.status='RUNNING');
 update public.entitlement_jobs set status='STALE',last_error='TEST_REVISION_STALE',lease_token=null,lease_until=null where id=j.id;
 if coalesce(started,false) then
  update private.entitlement_test_runtime set uncertain=true where job_id=j.id;
  update public.channel_access set status='REVIEW' where id=a.id;
 end if;
 if j.operation in ('revoke','reconcile') or coalesce(started,false) then
  repair:=case when s.state in ('ACTIVE','RENEWAL_DUE') and s.grace_until>now() then 'reconcile' else 'revoke' end;
  perform private.entitlement_enqueue(s.id,repair);
  if coalesce(started,false) and exists(select 1 from public.entitlement_jobs current_job
   where current_job.access_id=a.id and current_job.revision=s.revision and current_job.operation=repair and current_job.status in ('DONE','FAILED','STALE')) then
   -- A late unknown effect cannot reuse an earlier terminal reconciliation as
   -- proof of recovery. Retain the source obligation in visible FAILED/REVIEW.
   perform private.entitlement_test_review_v1(j.id,'TEST_UNKNOWN_EFFECT');
  end if;
 end if;
 perform private.entitlement_audit_record(s.id,'test_job_stale',jsonb_build_object('job_id',j.id,'operation',j.operation,'repair_operation',repair,'uncertain',coalesce(started,false)));
end;$$;

-- Caller holds the job then subscription lock. Legacy single-claim callers and
-- the bounded cycle share budgets; neither can bypass them with a different RPC.
create function private.entitlement_test_claim_selected_v1(jid uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.entitlement_jobs%rowtype; a public.channel_access%rowtype; s public.subscriptions%rowtype;
 b public.telegram_entitlement_bindings%rowtype; c public.vip_channels%rowtype; r private.entitlement_test_runtime%rowtype; existed boolean;
begin
 select * into j from public.entitlement_jobs where id=jid for update;
 select * into a from public.channel_access where id=j.access_id and tenant_id=j.tenant_id;
 select * into s from public.subscriptions where id=a.subscription_id and tenant_id=j.tenant_id for update;
 if s.mode is distinct from 'test' or a.mode is distinct from 'test' or not private.entitlement_test_tenant(j.tenant_id) then
  raise exception 'isolated test authority required' using errcode='42501'; end if;
 if j.available_at>now() or not (j.status='PENDING' or (j.status='RUNNING' and j.lease_until<now())) then return null; end if;
 if j.revision<>s.revision or (j.operation in ('invite','join') and (s.state not in ('ACTIVE','RENEWAL_DUE') or s.grace_until<=now())) then
  perform private.entitlement_test_stale_v1(j.id); return null; end if;
 if not private.entitlement_test_authority_v1(j.tenant_id,j.operation) then return null; end if;
 if j.operation in ('invite','join') and exists(select 1 from private.entitlement_test_runtime x join public.entitlement_jobs y on y.id=x.job_id where y.access_id=a.id and x.uncertain) then
  perform private.entitlement_test_review_v1(j.id,'TEST_UNKNOWN_EFFECT');return null;end if;
 select * into b from public.telegram_entitlement_bindings where id=a.binding_id and tenant_id=j.tenant_id;
 select * into c from public.vip_channels where id=a.channel_id and tenant_id=j.tenant_id;
 if b.mode is distinct from 'test' or c.mode is distinct from 'test' or b.telegram_user_id!~'^test:[0-9]+$' or c.chat_id!~'^test:' or not c.enabled or not c.private_verified then
  raise exception 'access configuration denied' using errcode='42501'; end if;
 select exists(select 1 from private.entitlement_test_runtime where job_id=j.id) into existed;
 insert into private.entitlement_test_runtime(job_id,tenant_id,claims,provider_failures)
 values(j.id,j.tenant_id,least(greatest(j.attempts,0),7),case when j.last_error='PROVIDER_FAILURE' then least(greatest(j.attempts,0),5) else 0 end) on conflict(job_id) do nothing;
 select * into r from private.entitlement_test_runtime where job_id=j.id for update;
 if j.status='RUNNING' then
  if not existed or r.dispatch_started or r.legacy_untracked then
   perform private.entitlement_test_review_v1(j.id,'TEST_UNKNOWN_EFFECT'); return null; end if;
  if r.reclaims>=2 then
   perform private.entitlement_test_review_v1(j.id,'TEST_RECLAIM_BUDGET_EXHAUSTED'); return null; end if;
 end if;
 if r.claims>=7 then perform private.entitlement_test_review_v1(j.id,'TEST_CLAIM_BUDGET_EXHAUSTED'); return null; end if;
 update private.entitlement_test_runtime set claims=claims+1,reclaims=reclaims+case when j.status='RUNNING' then 1 else 0 end,dispatch_started=false,legacy_untracked=false where job_id=j.id;
 update public.entitlement_jobs set status='RUNNING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds',last_error=null where id=j.id returning * into j;
 perform private.entitlement_audit_record(s.id,'job_claimed',jsonb_build_object('job_id',j.id,'operation',j.operation,'attempt',j.attempts));
 return to_jsonb(j)||jsonb_build_object('mode','test','subscription_id',s.id,'telegram_user_id',b.telegram_user_id,'chat_id',c.chat_id,'invite_reference',a.invite_reference,'invite_expires_at',least(s.grace_until,now()+make_interval(secs=>c.invite_ttl_seconds)));
end;$$;

create function public.entitlement_test_claim_cycle_v1(target_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p private.entitlement_test_policy%rowtype; j public.entitlement_jobs%rowtype; s public.subscriptions%rowtype;
 result jsonb; seen uuid[]:='{}'; lane integer; offset_value integer; examined integer:=0; stale_count integer:=0; review_count integer:=0; blocked_count integer:=0; more boolean;
begin
 if not private.entitlement_test_tenant(target_tenant_id) then raise exception 'isolated test authority required' using errcode='42501'; end if;
 -- The nonblocking advisory guard also fences first-time policy initialization.
 -- Even INSERT .. ON CONFLICT DO NOTHING can wait for another row updater.
 if pg_try_advisory_xact_lock(hashtextextended('entitlement-test-cycle-v1:'||target_tenant_id::text,0)) then
  if not exists(select 1 from private.entitlement_test_policy where tenant_id=target_tenant_id) then
   insert into private.entitlement_test_policy(tenant_id) values(target_tenant_id) on conflict(tenant_id) do nothing;
  end if;
  select * into p from private.entitlement_test_policy where tenant_id=target_tenant_id for update skip locked;
 end if;
 if p.tenant_id is not null then
  for work in 1..32 loop
   j:=null;
   for offset_value in 0..2 loop
    lane:=(p.next_lane+offset_value)%3;
    if (lane=0 and not p.revocation_enabled) or (lane=1 and not p.reconciliation_enabled) or (lane=2 and not p.admission_enabled) then continue;end if;
    select jobs.* into j from public.entitlement_jobs jobs join public.channel_access a on a.id=jobs.access_id and a.tenant_id=jobs.tenant_id and a.mode='test'
     where jobs.tenant_id=target_tenant_id and jobs.available_at<=now() and jobs.status in ('PENDING','RUNNING')
      and (jobs.status='PENDING' or jobs.lease_until<now()) and not(jobs.id=any(seen))
      and (case jobs.operation when 'revoke' then 0 when 'reconcile' then 1 else 2 end)=lane
     order by jobs.available_at,jobs.id for update of jobs skip locked limit 1;
    exit when j.id is not null;
   end loop;
   exit when j.id is null;
   seen:=array_append(seen,j.id);examined:=examined+1;p.next_lane:=(lane+1)%3;
   select sub.* into s from public.subscriptions sub join public.channel_access a on a.subscription_id=sub.id and a.tenant_id=sub.tenant_id
    where a.id=j.access_id and sub.tenant_id=target_tenant_id and sub.mode='test' for update of sub skip locked;
   if s.id is null then blocked_count:=blocked_count+1;continue;end if;
   result:=private.entitlement_test_claim_selected_v1(j.id);
   exit when result is not null;
   select status into j.status from public.entitlement_jobs where id=j.id;
   if j.status='STALE' then stale_count:=stale_count+1;
   elsif j.status='FAILED' then review_count:=review_count+1;
   else blocked_count:=blocked_count+1;end if;
  end loop;
  update private.entitlement_test_policy set next_lane=p.next_lane where tenant_id=target_tenant_id;
 end if;
 select exists(select 1 from public.entitlement_jobs jobs join public.channel_access a on a.id=jobs.access_id and a.tenant_id=jobs.tenant_id and a.mode='test'
  where jobs.tenant_id=target_tenant_id and jobs.available_at<=now() and (jobs.status='PENDING' or (jobs.status='RUNNING' and jobs.lease_until<now()))) into more;
 return jsonb_build_object('version',1,'job',result,'examined',examined,'stale',stale_count,'review',review_count,'blocked',blocked_count,'has_more',more);
end;$$;

-- Persisted before the injected TEST adapter is invoked. A replay cannot execute
-- again, and an expired dispatched lease becomes uncertain REVIEW, not a retry.
create function public.entitlement_test_begin_effect_v1(target_tenant_id uuid,target_job_id uuid,lease_value uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.entitlement_jobs%rowtype; a public.channel_access%rowtype; s public.subscriptions%rowtype; changed integer;
begin
 select * into j from public.entitlement_jobs where id=target_job_id and tenant_id=target_tenant_id for update;
 if j.id is null or j.status<>'RUNNING' or j.lease_token is distinct from lease_value or j.lease_until<=now() then raise exception 'access lease denied' using errcode='42501';end if;
 select * into a from public.channel_access where id=j.access_id and tenant_id=target_tenant_id;
 select * into s from public.subscriptions where id=a.subscription_id and tenant_id=target_tenant_id for update;
 if s.mode is distinct from 'test' or a.mode is distinct from 'test' or not private.entitlement_test_tenant(target_tenant_id) then raise exception 'isolated test authority required' using errcode='42501';end if;
 if j.revision<>s.revision or (j.operation in ('invite','join') and (s.state not in ('ACTIVE','RENEWAL_DUE') or s.grace_until<=now())) then perform private.entitlement_test_stale_v1(j.id);return false;end if;
 if not private.entitlement_test_authority_v1(target_tenant_id,j.operation) then return false;end if;
 if not exists(select 1 from public.telegram_entitlement_bindings b join public.vip_channels c on c.id=a.channel_id and c.tenant_id=a.tenant_id
  where b.id=a.binding_id and b.tenant_id=a.tenant_id and b.mode='test' and b.telegram_user_id~'^test:[0-9]+$' and c.mode='test' and c.chat_id~'^test:' and c.enabled and c.private_verified)
 then raise exception 'access configuration denied' using errcode='42501';end if;
 if j.operation in ('invite','join') and exists(select 1 from private.entitlement_test_runtime r join public.entitlement_jobs other on other.id=r.job_id where other.access_id=a.id and r.uncertain) then return false;end if;
 update private.entitlement_test_runtime set dispatch_started=true where job_id=j.id and tenant_id=target_tenant_id and not dispatch_started and not legacy_untracked and not uncertain;
 get diagnostics changed=row_count;
 if changed=1 then perform private.entitlement_audit_record(s.id,'test_effect_started',jsonb_build_object('job_id',j.id,'operation',j.operation));end if;
 return changed=1;
end;$$;

-- NULL means continue into the unmodified Phase11 success validator. All effects
-- and this state change roll back together if that validator rejects evidence.
create function private.entitlement_test_precomplete_v1(jid uuid,result_value jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.entitlement_jobs%rowtype; a public.channel_access%rowtype; s public.subscriptions%rowtype; failures integer;
begin
 select * into j from public.entitlement_jobs where id=jid for update;
 select * into a from public.channel_access where id=j.access_id and tenant_id=j.tenant_id;
 select * into s from public.subscriptions where id=a.subscription_id and tenant_id=j.tenant_id for update;
 if s.mode is distinct from 'test' or a.mode is distinct from 'test' or not private.entitlement_test_tenant(j.tenant_id) then raise exception 'access mode denied' using errcode='42501';end if;
 if j.revision<>s.revision or (j.operation in ('invite','join') and (s.state not in ('ACTIVE','RENEWAL_DUE') or s.grace_until<=now())) then perform private.entitlement_test_stale_v1(j.id);return false;end if;
 if not private.entitlement_test_authority_v1(j.tenant_id,j.operation) then
  perform private.entitlement_test_review_v1(j.id,'TEST_UNKNOWN_EFFECT');return false;end if;
 if jsonb_typeof(result_value) is distinct from 'object' or jsonb_typeof(result_value->'ok') is distinct from 'boolean'
  or result_value ? 'outcome' then perform private.entitlement_test_review_v1(j.id,'TEST_UNKNOWN_EFFECT');return false;end if;
 if result_value->>'ok' is distinct from 'true' then
  update private.entitlement_test_runtime set provider_failures=provider_failures+1,dispatch_started=false,legacy_untracked=false where job_id=j.id and provider_failures<5 returning provider_failures into failures;
  if failures is null or failures>=5 then
   update public.entitlement_jobs set available_at=now()+interval '300 seconds' where id=j.id;
   perform private.entitlement_test_review_v1(j.id,'TEST_PROVIDER_FAILURE_BUDGET');return false;end if;
  update public.entitlement_jobs set status='PENDING',available_at=now()+make_interval(secs=>least(300,10*(2^failures)::integer)),last_error='PROVIDER_FAILURE',lease_token=null,lease_until=null where id=j.id;
  update public.channel_access set status='REVIEW' where id=a.id;
  perform private.entitlement_audit_record(s.id,'retry',jsonb_build_object('job_id',j.id,'attempt',j.attempts,'provider_failure',failures));return false;
 end if;
 return null;
end;$$;

revoke all on function private.entitlement_test_authority_v1(uuid,text),private.entitlement_test_review_v1(uuid,text),private.entitlement_test_stale_v1(uuid),private.entitlement_test_claim_selected_v1(uuid),private.entitlement_test_precomplete_v1(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.entitlement_test_claim_cycle_v1(uuid),public.entitlement_test_begin_effect_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.entitlement_test_claim_cycle_v1(uuid),public.entitlement_test_begin_effect_v1(uuid,uuid,uuid) to service_role;

-- Same Phase11 LIVE semantics, with guarded TEST-only delegation.
create or replace function public.entitlement_claim_job(target_tenant_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare j public.entitlement_jobs%rowtype;s public.subscriptions%rowtype;a public.channel_access%rowtype;b public.telegram_entitlement_bindings%rowtype;c public.vip_channels%rowtype;test_job jsonb;begin
 select * into j from public.entitlement_jobs where tenant_id=target_tenant_id and available_at<=now() and (status='PENDING' or (status='RUNNING' and lease_until<now())) order by available_at,id for update skip locked limit 1;if j.id is null then return null;end if;
 select * into a from public.channel_access where tenant_id=j.tenant_id and id=j.access_id;select * into s from public.subscriptions where id=a.subscription_id for update;
 if s.mode='test' then
  test_job:=private.entitlement_test_claim_selected_v1(j.id);
  if test_job is not null then
   update private.entitlement_test_runtime set legacy_untracked=true where job_id=j.id;
   perform private.entitlement_audit_record(s.id,'test_legacy_lease_issued',jsonb_build_object('job_id',j.id,'effect','UNKNOWN_UNTIL_RESULT'));
  end if;
  return test_job;
 end if;
 if (s.mode='live' and not private.entitlement_live_allowed(s.tenant_id)) or (s.mode='test' and not private.entitlement_test_tenant(s.tenant_id)) then return null;end if;
 if j.revision<>s.revision or (j.operation in ('invite','join') and (s.state not in ('ACTIVE','RENEWAL_DUE') or s.grace_until<=now())) then update public.entitlement_jobs set status='STALE' where id=j.id;return null;end if;
 select * into b from public.telegram_entitlement_bindings where id=a.binding_id;select * into c from public.vip_channels where id=a.channel_id;
 if b.mode<>s.mode or c.mode<>s.mode or not c.enabled or not c.private_verified then raise exception 'access configuration denied' using errcode='42501';end if;
 update public.entitlement_jobs set status='RUNNING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where id=j.id returning * into j;
 perform private.entitlement_audit_record(s.id,'job_claimed',jsonb_build_object('job_id',j.id,'operation',j.operation,'attempt',j.attempts));
 return to_jsonb(j)||jsonb_build_object('mode',s.mode,'subscription_id',s.id,'telegram_user_id',b.telegram_user_id,'chat_id',c.chat_id,'invite_reference',a.invite_reference,'invite_expires_at',least(s.grace_until,now()+make_interval(secs=>c.invite_ttl_seconds)));end;$$;
create or replace function public.entitlement_complete_job(target_tenant_id uuid,target_job_id uuid,lease_value uuid,result_value jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog as $$declare j public.entitlement_jobs%rowtype;a public.channel_access%rowtype;s public.subscriptions%rowtype;ref text;member text;access_event uuid;start_event uuid;customer_state_value public.customer_state;transition_result jsonb;test_result boolean;begin
 select * into j from public.entitlement_jobs where tenant_id=target_tenant_id and id=target_job_id for update;
 if j.id is null or j.status<>'RUNNING' or j.lease_token is distinct from lease_value or j.lease_until<=now() then raise exception 'access lease denied' using errcode='42501';end if;
 select * into a from public.channel_access where id=j.access_id;select * into s from public.subscriptions where id=a.subscription_id for update;
 if s.mode='test' then test_result:=private.entitlement_test_precomplete_v1(j.id,result_value);if test_result is not null then return test_result;end if;end if;
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
 if s.mode='live' then
  access_event:=private.append_domain_event(s.tenant_id,s.customer_id,'access.granted',1,jsonb_build_object('channel_access_id',a.id,'channel_id',a.channel_id),'SYSTEM',null,'access_engine','TRUSTED',gen_random_uuid(),null,'access-grant:'||j.id::text,now());
  select state into customer_state_value from public.customers where tenant_id=s.tenant_id and id=s.customer_id for update;
  if customer_state_value='PAID' then transition_result:=public.transition_customer_state(s.tenant_id,s.customer_id,'PAID','ACCESS_GRANTED','verified_channel_membership','SYSTEM',null,gen_random_uuid(),access_event,'access.granted',access_event,'access-state:'||j.id::text,now());if transition_result->>'accepted' is distinct from 'true' then raise exception 'verified access transition denied' using errcode='42501';end if;customer_state_value:='ACCESS_GRANTED';end if;
  if customer_state_value='ACCESS_GRANTED' then select id into start_event from public.domain_events where tenant_id=s.tenant_id and customer_id=s.customer_id and event_type='subscription.started' and producer='subscription_engine' and authority='TRUSTED' and payload->>'subscription_id'=s.id::text order by recorded_at desc limit 1;transition_result:=public.transition_customer_state(s.tenant_id,s.customer_id,'ACCESS_GRANTED','ACTIVE','verified_membership_activation','SYSTEM',null,gen_random_uuid(),access_event,'subscription.started',start_event,'membership-state:'||j.id::text,now());if transition_result->>'accepted' is distinct from 'true' then raise exception 'verified subscription transition denied' using errcode='42501';end if;end if;
 end if;

 elsif member='member' then update public.subscriptions set revision=revision+1 where id=s.id;update public.channel_access set status='REVIEW' where id=a.id;perform private.entitlement_enqueue(s.id,'revoke');
 else update public.channel_access set status='PENDING',membership_checked_at=now() where id=a.id;if s.state in ('ACTIVE','RENEWAL_DUE') and s.grace_until>now() then update public.subscriptions set revision=revision+1 where id=s.id;perform private.entitlement_enqueue(s.id,'invite');end if;end if;end if;
 update public.entitlement_jobs set status='DONE',lease_token=null,lease_until=null,last_error=null where id=j.id;perform private.entitlement_audit_record(s.id,'job_'||j.operation,jsonb_build_object('job_id',j.id));return true;end;$$;
