-- Account-owned UI preference. It never selects a customer's communication language.
create table public.admin_preferences (
 user_id uuid primary key references public.app_users(id) on delete cascade,
 locale text not null default 'tr-TR' check(locale in ('tr-TR','en-US'))
);
alter table public.admin_preferences enable row level security;
create policy admin_preferences_self on public.admin_preferences for all to authenticated
 using (user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and exists(select 1 from public.tenant_members m where m.user_id=(select auth.uid()) and m.status='active'));
revoke all on public.admin_preferences from public,anon,authenticated,service_role;
grant select,insert,update on public.admin_preferences to authenticated;

-- Phase 13 has NO message sender, payment writer or entitlement authority.
-- All event-driven processing is restricted to explicitly enabled isolated fixtures.
create table private.customer_success_controls(tenant_id uuid primary key references public.tenants(id),sandbox_enabled boolean not null default false);
create table public.customer_success_tasks(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,customer_id uuid not null,
 kind text not null check(kind in ('ONBOARDING','SUPPORT','INACTIVITY','RENEWAL','CHURN','WINBACK')),
 status text not null default 'OPEN' check(status in ('OPEN','IN_PROGRESS','WAITING_REVIEW','COMPLETED','DISMISSED')),
 priority text not null check(priority in ('LOW','MEDIUM','HIGH','CRITICAL')),
 mode text not null check(mode in ('test','live','unknown')),source_key text not null check(length(source_key)<=240),
 source_id uuid,source_revision integer,evidence jsonb not null default '{}' check(jsonb_typeof(evidence)='object'),
 assigned_to uuid references public.app_users(id),due_at timestamptz,revision integer not null default 1,
 reason_code text check(reason_code in ('UNKNOWN','PRICE','SERVICE_ISSUE','NO_LONGER_NEEDED','PAYMENT_ISSUE','OTHER')),
 resolution_note text check(length(resolution_note)<=1000),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),closed_at timestamptz,
 unique(tenant_id,id),unique(tenant_id,customer_id,kind,source_key),foreign key(tenant_id,customer_id) references public.customers(tenant_id,id)
);
create index success_queue on public.customer_success_tasks(tenant_id,status,due_at,id);
create index success_customer on public.customer_success_tasks(tenant_id,customer_id,created_at desc,id);
create table public.customer_success_history(
 id bigint generated always as identity primary key,tenant_id uuid not null,task_id uuid not null,action text not null,
 actor_id uuid,revision integer not null,details jsonb not null default '{}',created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,task_id) references public.customer_success_tasks(tenant_id,id)
);
create index success_history on public.customer_success_history(tenant_id,task_id,id desc);
create trigger success_history_immutable before update or delete on public.customer_success_history for each row execute function private.entitlement_immutable();
create table public.customer_success_contact_policies(
 tenant_id uuid not null,customer_id uuid not null,consent text not null default 'UNKNOWN' check(consent in ('UNKNOWN','GRANTED','DENIED')),
 opted_out boolean not null default true,preferred_language text not null default 'en' check(preferred_language in ('en','tr','ar','ru')),
 timezone text,window_start integer not null default 9 check(window_start between 0 and 23),window_end integer not null default 18 check(window_end between 1 and 24 and window_end>window_start),
 evidence_reference text not null check(length(evidence_reference) between 8 and 300),reviewed_by uuid not null,reviewed_at timestamptz not null default clock_timestamp(),revision integer not null default 1,
 primary key(tenant_id,customer_id),foreign key(tenant_id,customer_id) references public.customers(tenant_id,id)
);
create table public.customer_success_previews(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,task_id uuid not null,task_revision integer not null,policy_revision integer not null,
 language text not null,content text not null check(length(content)<=1000),blockers jsonb not null,created_by uuid not null,created_at timestamptz not null default now(),
 unique(task_id,task_revision,policy_revision),foreign key(tenant_id,task_id) references public.customer_success_tasks(tenant_id,id)
);
create trigger success_preview_immutable before update or delete on public.customer_success_previews for each row execute function private.entitlement_immutable();

create function private.success_enabled(t uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from private.customer_success_controls x join public.tenants y on y.id=x.tenant_id where x.tenant_id=t and x.sandbox_enabled and y.slug like 'phase13-sandbox-%' and y.status='active' and not y.outbound_messaging_enabled);
$$;
create function public.configure_phase13_sandbox(target_tenant_id uuid,enabled_value boolean) returns void language plpgsql security definer set search_path=pg_catalog as $$begin
 if not exists(select 1 from public.tenants where id=target_tenant_id and slug like 'phase13-sandbox-%' and status='active' and not outbound_messaging_enabled) then raise exception 'isolated sandbox required' using errcode='42501';end if;
 insert into private.customer_success_controls values(target_tenant_id,enabled_value) on conflict(tenant_id) do update set sandbox_enabled=excluded.sandbox_enabled;
 if not enabled_value then update public.scheduled_jobs set status='cancelled',locked_at=null,locked_by=null where tenant_id=target_tenant_id and job_type='customer_success.review' and status in ('scheduled','processing');end if;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data) values(target_tenant_id,'SYSTEM','success.sandbox_configured','tenants',target_tenant_id::text,jsonb_build_object('enabled',enabled_value));
end;$$;
create function private.success_log(t uuid,task uuid,act text,rev integer,d jsonb default '{}') returns void language plpgsql set search_path=pg_catalog as $$begin
 insert into public.customer_success_history(tenant_id,task_id,action,actor_id,revision,details) values(t,task,act,auth.uid(),rev,d);
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data) values(t,case when auth.uid() is null then 'SYSTEM'::public.audit_actor_type else 'HUMAN'::public.audit_actor_type end,auth.uid(),'success.'||act,'customer_success_tasks',task::text,d||jsonb_build_object('revision',rev));
end;$$;
create function private.success_upsert(t uuid,c uuid,k text,p text,m text,sk text,source uuid,srev integer,e jsonb,due timestamptz) returns uuid language plpgsql set search_path=pg_catalog as $$declare x public.customer_success_tasks%rowtype;begin
 insert into public.customer_success_tasks(tenant_id,customer_id,kind,priority,mode,source_key,source_id,source_revision,evidence,due_at) values(t,c,k,p,m,sk,source,srev,e,due) on conflict(tenant_id,customer_id,kind,source_key) do nothing returning * into x;
 if x.id is not null then perform private.success_log(t,x.id,'created',x.revision,jsonb_build_object('kind',k,'mode',m));return x.id;end if;
 select * into x from public.customer_success_tasks where tenant_id=t and customer_id=c and kind=k and source_key=sk for update;
 if x.evidence is distinct from e or x.priority is distinct from p or x.mode is distinct from m or x.source_id is distinct from source or x.source_revision is distinct from srev then
 update public.customer_success_tasks set evidence=e,priority=p,mode=m,source_id=source,source_revision=srev,due_at=due,revision=revision+1,updated_at=now() where id=x.id returning * into x;
 perform private.success_log(t,x.id,'evidence_refreshed',x.revision);
 end if;return x.id;
end;$$;
create function private.success_verified_subscription(t uuid,sid uuid) returns boolean language sql stable set search_path=pg_catalog as $$
 select exists(select 1 from public.subscriptions s join public.subscription_payments p on p.tenant_id=s.tenant_id and p.subscription_id=s.id and p.mode=s.mode
 left join public.payment_invoices i on i.tenant_id=p.tenant_id and i.id=p.test_invoice_id
 left join private.verified_payment_receipts r on r.tenant_id=p.tenant_id and r.id=p.receipt_id
 join public.domain_events e on e.tenant_id=p.tenant_id and e.id=p.event_id and e.customer_id=s.customer_id and e.authority='TRUSTED'
 where s.tenant_id=t and s.id=sid and p.period_end>p.period_start and p.period_end=s.ends_at
 and ((s.mode='test' and i.status='CONFIRMED' and i.mode='test' and i.customer_id=s.customer_id and e.event_type='payment.test_observed' and e.producer='payment_test_engine' and e.payload->>'payment_id'=i.id::text and e.payload->>'state'='CONFIRMED')
 or (s.mode='live' and r.signature_verified and r.independent_verified and r.verified_at<=now() and r.customer_id=s.customer_id and r.offer_id is not null and r.event_id=e.id and e.event_type='payment.confirmed' and e.producer='payment_verifier' and e.payload->>'payment_id'=r.id::text and e.payload->>'tx_hash'=r.provider_reference)));
$$;
create function private.success_last_activity(t uuid,cid uuid) returns timestamptz language sql stable set search_path=pg_catalog as $$
 select greatest((select max(last_inbound_at) from public.messaging_contacts where tenant_id=t and customer_id=cid),
 (select max(m.occurred_at) from public.messages m join public.conversations c on c.tenant_id=m.tenant_id and c.id=m.conversation_id where m.tenant_id=t and m.direction='inbound' and m.occurred_at<=now() and (m.customer_id=cid or (m.customer_id is null and c.customer_id=cid))));
$$;
create function private.success_reconcile(t uuid,cid uuid) returns integer language plpgsql set search_path=pg_catalog as $$
declare c public.customers%rowtype;s public.subscriptions%rowtype;e public.escalation_cases%rowtype;x public.customer_success_tasks%rowtype;last_activity timestamptz;task uuid;stage text;n integer:=0;begin
 if not private.success_enabled(t) then raise exception 'customer success sandbox disabled' using errcode='42501';end if;
 select * into c from public.customers where tenant_id=t and id=cid for update;if c.id is null then raise exception 'customer unavailable' using errcode='42501';end if;
 -- Known inbound observations only. An absent observation remains UNKNOWN.
 last_activity:=private.success_last_activity(t,cid);
 if last_activity is not null and last_activity+interval '14 days'>now() then perform private.success_enqueue_due(t,cid,'inactivity:'||extract(epoch from last_activity)::text,last_activity+interval '14 days');end if;
 select * into s from public.subscriptions where tenant_id=t and customer_id=cid and private.success_verified_subscription(t,id) order by (mode='live') desc,ends_at desc,id limit 1;
 stage:=case when s.id is null then 'PAYMENT_REVIEW' when s.state in ('ACTIVE','RENEWAL_DUE') and s.ends_at>now() and exists(select 1 from public.channel_access a where a.tenant_id=t and a.subscription_id=s.id and a.mode=s.mode and a.status='MEMBER' and a.membership_checked_at is not null and a.membership_checked_at<=now()) then 'READY' else 'ACCESS_REVIEW' end;
 task:=private.success_upsert(t,cid,'ONBOARDING','MEDIUM',coalesce(s.mode,'unknown'),'onboarding',s.id,s.revision,jsonb_build_object('step',stage,'subscription_id',s.id,'subscription_revision',s.revision,'subscription_state',s.state,'payment_evidence',case when s.id is null then 'UNKNOWN' when s.mode='test' then 'SANDBOX_VERIFIED' else 'VERIFIED_RECEIPT' end,'access_evidence',case when stage='READY' and s.mode='test' then 'SANDBOX_MEMBER' when stage='READY' then 'VERIFIED_MEMBER' else 'NOT_VERIFIED' end,'last_verified_inbound_at',last_activity),c.created_at);n:=n+1;
 for e in select * from public.escalation_cases where tenant_id=t and customer_id=cid order by created_at desc,id limit 100 loop
  task:=private.success_upsert(t,cid,'SUPPORT',e.severity,'unknown','case:'||e.id::text,e.id,e.revision,jsonb_build_object('case_id',e.id,'case_status',e.status,'case_revision',e.revision,'category',e.category),e.created_at);n:=n+1;
  if e.status='RESOLVED' then update public.customer_success_tasks set status='COMPLETED',closed_at=e.resolved_at,updated_at=now(),revision=revision+1 where id=task and status not in ('COMPLETED','DISMISSED') returning * into x;if found then perform private.success_log(t,task,'case_resolved',x.revision);end if;end if;
 end loop;
 if last_activity is not null and last_activity<=now()-interval '14 days' then task:=private.success_upsert(t,cid,'INACTIVITY','LOW','unknown','inbound:'||extract(epoch from last_activity)::text,null,null,jsonb_build_object('last_verified_inbound_at',last_activity,'threshold_days',14,'meaning','REVIEW_NOT_ABANDONMENT'),last_activity+interval '14 days');n:=n+1;end if;
 for s in select * from public.subscriptions where tenant_id=t and customer_id=cid and private.success_verified_subscription(t,id) order by ends_at desc,id limit 100 loop
  if s.state in ('ACTIVE','RENEWAL_DUE') and s.renewal_due_at>now() then perform private.success_enqueue_due(t,cid,'renewal:'||s.id::text||':'||s.revision,s.renewal_due_at);end if;
  if s.state in ('ACTIVE','RENEWAL_DUE') and s.ends_at>now() then perform private.success_enqueue_due(t,cid,'term-end:'||s.id::text||':'||s.revision,s.ends_at);end if;
  if s.state in ('ACTIVE','RENEWAL_DUE') and s.renewal_due_at<=now() and s.ends_at>now() then task:=private.success_upsert(t,cid,'RENEWAL','HIGH',s.mode,'subscription:'||s.id::text||':'||s.revision,s.id,s.revision,jsonb_build_object('subscription_id',s.id,'subscription_revision',s.revision,'ends_at',s.ends_at,'renewal_due_at',s.renewal_due_at,'payment_evidence',case when s.mode='test' then 'SANDBOX_VERIFIED' else 'VERIFIED_RECEIPT' end),s.renewal_due_at);n:=n+1;end if;
  if s.state in ('EXPIRED','CANCELLED') or s.ends_at<=now() then task:=private.success_upsert(t,cid,'CHURN','MEDIUM',s.mode,'subscription:'||s.id::text||':'||s.revision,s.id,s.revision,jsonb_build_object('subscription_id',s.id,'subscription_revision',s.revision,'ends_at',s.ends_at,'meaning','REVIEW_NOT_CONFIRMED_CHURN'),case when s.state='CANCELLED' then now() else s.ends_at end);n:=n+1;end if;
 end loop;
 -- Superseded renewal/churn evidence never remains actionable after a new term or hold.
 for x in select a.* from public.customer_success_tasks a where a.tenant_id=t and a.customer_id=cid and a.kind in ('RENEWAL','CHURN') and a.status not in ('COMPLETED','DISMISSED') and not exists(select 1 from public.subscriptions b where b.tenant_id=t and b.id=a.source_id and b.revision=a.source_revision and private.success_verified_subscription(t,b.id) and ((a.kind='RENEWAL' and b.state in ('ACTIVE','RENEWAL_DUE') and b.renewal_due_at<=now() and b.ends_at>now()) or (a.kind='CHURN' and (b.state in ('EXPIRED','CANCELLED') or b.ends_at<=now())))) for update loop
  update public.customer_success_tasks set status='DISMISSED',resolution_note='SOURCE_SUPERSEDED',closed_at=now(),updated_at=now(),revision=revision+1 where id=x.id returning revision into x.revision;perform private.success_log(t,x.id,'source_superseded',x.revision);
 end loop;
 for x in select * from public.customer_success_tasks a where a.tenant_id=t and a.customer_id=cid and a.status not in ('COMPLETED','DISMISSED') and
 ((a.kind='INACTIVITY' and (last_activity is distinct from (a.evidence->>'last_verified_inbound_at')::timestamptz or last_activity>now()-interval '14 days')) or
 (a.kind='WINBACK' and (exists(select 1 from public.subscriptions q where q.tenant_id=t and q.customer_id=cid and q.state in ('ACTIVE','RENEWAL_DUE') and q.ends_at>now() and private.success_verified_subscription(t,q.id)) or not exists(select 1 from public.customer_success_tasks q join public.subscriptions r on r.tenant_id=q.tenant_id and r.id=q.source_id and r.revision=q.source_revision where q.tenant_id=t and q.id=a.source_id and q.revision=a.source_revision and q.status='COMPLETED' and q.reason_code<>'UNKNOWN' and private.success_verified_subscription(t,r.id))))) for update loop
  update public.customer_success_tasks set status='DISMISSED',resolution_note='SOURCE_SUPERSEDED',closed_at=now(),updated_at=now(),revision=revision+1 where id=x.id returning revision into x.revision;perform private.success_log(t,x.id,'source_superseded',x.revision);
 end loop;return n;
end;$$;
create function private.success_enqueue_due(t uuid,c uuid,k text,due timestamptz) returns void language plpgsql set search_path=pg_catalog as $$begin
 if c is null or due is null or due<=now() or not private.success_enabled(t) then return;end if;
 insert into public.scheduled_jobs(tenant_id,customer_id,job_type,payload,idempotency_key,correlation_id,scheduled_at) values(t,c,'customer_success.review','{}','success-due:'||c::text||':'||left(k,140),gen_random_uuid(),due) on conflict(tenant_id,idempotency_key) do nothing;
end;$$;
create function private.success_enqueue(t uuid,c uuid,k text) returns void language plpgsql set search_path=pg_catalog as $$begin
 if c is null or not private.success_enabled(t) then return;end if;
 insert into public.scheduled_jobs(tenant_id,customer_id,job_type,payload,idempotency_key,correlation_id,scheduled_at) values(t,c,'customer_success.review','{}','success:'||c::text||':'||left(k,140),gen_random_uuid(),now()) on conflict(tenant_id,idempotency_key) do nothing;
end;$$;
create function private.success_source_changed() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if tg_table_name='channel_access' then perform private.success_enqueue(new.tenant_id,(select customer_id from public.subscriptions where tenant_id=new.tenant_id and id=new.subscription_id),tg_table_name||':'||new.id::text||':'||md5(to_jsonb(new)::text));elsif tg_table_name='customers' then perform private.success_enqueue(new.tenant_id,new.id,tg_table_name||':'||new.id::text||':'||md5(to_jsonb(new)::text));else perform private.success_enqueue(new.tenant_id,new.customer_id,tg_table_name||':'||new.id::text||':'||md5(to_jsonb(new)::text));end if;return new;
end;$$;
create trigger success_customer_changed after insert or update on public.customers for each row execute function private.success_source_changed();
create trigger success_subscription_changed after insert or update on public.subscriptions for each row execute function private.success_source_changed();
create trigger success_case_changed after insert or update on public.escalation_cases for each row execute function private.success_source_changed();
create trigger success_contact_changed after insert or update on public.messaging_contacts for each row execute function private.success_source_changed();
create trigger success_access_changed after insert or update on public.channel_access for each row execute function private.success_source_changed();
create trigger success_payment_changed after update on public.payment_invoices for each row execute function private.success_source_changed();
create function public.process_customer_success_jobs(target_tenant_id uuid,limit_value integer default 25) returns integer language plpgsql security definer set search_path=pg_catalog as $$declare j public.scheduled_jobs%rowtype;n integer:=0;begin
 if not private.success_enabled(target_tenant_id) then raise exception 'isolated sandbox required' using errcode='42501';end if;
 for j in select * from public.scheduled_jobs where tenant_id=target_tenant_id and job_type='customer_success.review' and ((status='scheduled' and scheduled_at<=now()) or (status='processing' and locked_at<now()-interval '2 minutes')) order by scheduled_at,id limit least(greatest(coalesce(limit_value,25),1),100) for update skip locked loop
  -- The customer lock serializes workers; evaluate current evidence, never stale job payload.
  begin
   perform private.success_reconcile(j.tenant_id,j.customer_id);update public.scheduled_jobs set status='completed',attempts=attempts+1,completed_at=now(),locked_at=null,locked_by=null where id=j.id;n:=n+1;
  exception when others then
   update public.scheduled_jobs set attempts=attempts+1,status=case when attempts+1>=max_attempts then 'dead_letter' else 'scheduled' end,scheduled_at=now()+make_interval(secs=>least(300,5*power(2,least(attempts,5))::integer)),last_error_code=sqlstate,dead_lettered_at=case when attempts+1>=max_attempts then now() else null end,locked_at=null,locked_by=null where id=j.id;
   insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data) values(j.tenant_id,'SYSTEM','success.review_job_failed','scheduled_jobs',j.id::text,jsonb_build_object('attempt',j.attempts+1,'code',sqlstate));
  end;
 end loop;return n;
end;$$;
create function public.process_customer_success_due() returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare t uuid;n integer:=0;tenants integer:=0;begin
 for t in select c.tenant_id from private.customer_success_controls c where private.success_enabled(c.tenant_id) and exists(select 1 from public.scheduled_jobs j where j.tenant_id=c.tenant_id and j.job_type='customer_success.review' and ((j.status='scheduled' and j.scheduled_at<=now()) or (j.status='processing' and j.locked_at<now()-interval '2 minutes'))) order by c.tenant_id limit 5 loop
  n:=n+public.process_customer_success_jobs(t,25);tenants:=tenants+1;
 end loop;return jsonb_build_object('processed',n,'tenants',tenants,'mode','PREVIEW_ONLY');
end;$$;
create function public.admin_success_refresh(target_tenant_id uuid,request_id_value uuid,customer_value uuid default null,after_value uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare c uuid;next_cursor uuid;n integer:=0;begin
 if not exists(select 1 from public.tenants where id=target_tenant_id and status='active') then raise exception 'active tenant required' using errcode='42501';end if;
 perform private.require_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]);
 if not private.success_enabled(target_tenant_id) or request_id_value is null then raise exception 'isolated sandbox required' using errcode='42501';end if;
 if customer_value is not null and not exists(select 1 from public.customers where tenant_id=target_tenant_id and id=customer_value) then raise exception 'customer unavailable' using errcode='42501';end if;
 for c in select id from public.customers where tenant_id=target_tenant_id and (customer_value is null or id=customer_value) and (after_value is null or id>after_value) order by id limit 100 loop perform private.success_enqueue(target_tenant_id,c,request_id_value::text);next_cursor:=c;n:=n+1;end loop;
 return jsonb_build_object('queued',n,'processed',public.process_customer_success_jobs(target_tenant_id,100),'next_cursor',case when n=100 then next_cursor else null end);
end;$$;

create function public.admin_success_list(target_tenant_id uuid,kind_value text default null,status_value text default null,customer_value uuid default null,search_value text default null,page_value integer default 1,assignee_value uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare result jsonb;begin
 if not exists(select 1 from public.tenants where id=target_tenant_id and status='active') then raise exception 'active tenant required' using errcode='42501';end if;
 perform private.require_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]);
 with filtered as(select x.*,c.display_name customer_name from public.customer_success_tasks x join public.customers c on c.tenant_id=x.tenant_id and c.id=x.customer_id where x.tenant_id=target_tenant_id and (kind_value is null or x.kind=kind_value) and (status_value is null or x.status=status_value) and (customer_value is null or x.customer_id=customer_value) and (assignee_value is null or x.assigned_to=assignee_value) and (nullif(search_value,'') is null or c.display_name ilike '%'||left(search_value,100)||'%')),
 page as(select * from filtered order by case priority when 'CRITICAL' then 4 when 'HIGH' then 3 when 'MEDIUM' then 2 else 1 end desc,due_at nulls last,id limit 25 offset (least(greatest(coalesce(page_value,1),1),10000)-1)*25)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'::jsonb),'total',(select count(*) from filtered),'page',greatest(coalesce(page_value,1),1),'page_size',25,'sandbox_enabled',private.success_enabled(target_tenant_id),'queue_health',jsonb_build_object('pending',(select count(*) from public.scheduled_jobs where tenant_id=target_tenant_id and job_type='customer_success.review' and status in ('scheduled','processing') and scheduled_at<=now()),'failed',(select count(*) from public.scheduled_jobs where tenant_id=target_tenant_id and job_type='customer_success.review' and status='dead_letter'),'jobs',coalesce((select jsonb_agg(j) from(select id,attempts,last_error_code from public.scheduled_jobs where tenant_id=target_tenant_id and job_type='customer_success.review' and status='dead_letter' order by dead_lettered_at,id limit 25) j),'[]'::jsonb)),'managers',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',u.display_name)) from public.tenant_members m join public.app_users u on u.id=m.user_id where m.tenant_id=target_tenant_id and m.status='active' and m.role in ('super_admin','manager')),'[]'::jsonb)) into result;return result;
end;$$;
create function public.admin_success_detail(target_tenant_id uuid,task_value uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare x public.customer_success_tasks%rowtype;begin
 if not exists(select 1 from public.tenants where id=target_tenant_id and status='active') then raise exception 'active tenant required' using errcode='42501';end if;
 perform private.require_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]);
 select * into x from public.customer_success_tasks where tenant_id=target_tenant_id and id=task_value;if x.id is null then return null;end if;
 return jsonb_build_object('task',to_jsonb(x),'customer_name',(select display_name from public.customers where tenant_id=target_tenant_id and id=x.customer_id),'policy',(select case when private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]) then to_jsonb(p) else null end from public.customer_success_contact_policies p where p.tenant_id=target_tenant_id and p.customer_id=x.customer_id),'history',coalesce((select jsonb_agg(h) from (select action,actor_id,revision,details,created_at from public.customer_success_history where tenant_id=target_tenant_id and task_id=x.id order by id desc limit 100) h),'[]'::jsonb),'previews',coalesce((select jsonb_agg(p) from (select id,task_revision,policy_revision,language,content,blockers,created_at from public.customer_success_previews where tenant_id=target_tenant_id and task_id=x.id and private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]) order by created_at desc,id desc limit 10) p),'[]'::jsonb));
end;$$;
create function public.admin_success_action(target_tenant_id uuid,task_value uuid,expected_revision integer,action_value text,assignee_value uuid default null,note_value text default null,reason_value text default null) returns integer language plpgsql security definer set search_path=pg_catalog as $$declare x public.customer_success_tasks%rowtype;new_status text;new_task uuid;begin
 if not exists(select 1 from public.tenants where id=target_tenant_id and status='active') then raise exception 'active tenant required' using errcode='42501';end if;
 perform private.require_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]);
 -- Lock the same customer as reconciliation, before locking the task: consistent order.
 perform 1 from public.customers c where c.tenant_id=target_tenant_id and c.id=(select customer_id from public.customer_success_tasks where tenant_id=target_tenant_id and id=task_value) for update;
 select * into x from public.customer_success_tasks where tenant_id=target_tenant_id and id=task_value for update;
 if x.id is null then raise exception 'task unavailable' using errcode='42501';end if;
 if expected_revision is distinct from x.revision then raise exception 'task changed' using errcode='PT409';end if;
 if not private.success_enabled(target_tenant_id) then raise exception 'isolated sandbox required' using errcode='42501';end if;
 if action_value='recommend_winback' then
  if x.kind<>'CHURN' or x.status<>'COMPLETED' or x.reason_code is null or x.reason_code='UNKNOWN' then raise exception 'reasoned review required' using errcode='55000';end if;
  new_task:=private.success_upsert(target_tenant_id,x.customer_id,'WINBACK','LOW',x.mode,'churn:'||x.id::text,x.id,x.revision,jsonb_build_object('churn_task_id',x.id,'reason_code',x.reason_code,'provenance','MANAGER_REVIEW','recommendation_only',true),now());
  return x.revision;
 end if;
 if x.status in ('COMPLETED','DISMISSED') then raise exception 'task already closed' using errcode='55000';end if;
 if action_value='complete' and x.kind in ('RENEWAL','CHURN') and not exists(select 1 from public.subscriptions b where b.tenant_id=target_tenant_id and b.id=x.source_id and b.revision=x.source_revision and private.success_verified_subscription(target_tenant_id,b.id)) then raise exception 'source changed' using errcode='PT409';end if;
 if x.kind='SUPPORT' and action_value in ('complete','dismiss') then raise exception 'resolve linked escalation instead' using errcode='42501';end if;
 if action_value='claim' then assignee_value:=auth.uid();new_status:='IN_PROGRESS';
 elsif action_value='assign' then
  if assignee_value is null or not exists(select 1 from public.tenant_members where tenant_id=target_tenant_id and user_id=assignee_value and status='active' and role in ('super_admin','manager')) then raise exception 'manager unavailable' using errcode='42501';end if;new_status:=x.status;
 elsif action_value='wait' then new_status:='WAITING_REVIEW';
 elsif action_value in ('complete','dismiss') then
  if x.assigned_to is distinct from auth.uid() or length(btrim(coalesce(note_value,''))) not between 8 and 1000 then raise exception 'ownership and resolution required' using errcode='42501';end if;
  if action_value='complete' and x.kind='ONBOARDING' then
   perform private.success_reconcile(target_tenant_id,x.customer_id);
   select * into x from public.customer_success_tasks where id=x.id;
   if x.revision is distinct from expected_revision then raise exception 'refresh onboarding evidence' using errcode='PT409';end if;
   if x.evidence->>'step' is distinct from 'READY' then raise exception 'verified payment and membership required' using errcode='55000';end if;
  end if;
  if x.kind='CHURN' and action_value='complete' and (reason_value is null or reason_value not in ('PRICE','SERVICE_ISSUE','NO_LONGER_NEEDED','PAYMENT_ISSUE','OTHER')) then raise exception 'evidenced reason required' using errcode='22023';end if;
  new_status:=case action_value when 'complete' then 'COMPLETED' else 'DISMISSED' end;
 else raise exception 'invalid action' using errcode='22023';end if;
 update public.customer_success_tasks set status=new_status,assigned_to=case when action_value in ('claim','assign') then assignee_value else assigned_to end,reason_code=case when kind='CHURN' and action_value='complete' then reason_value else reason_code end,resolution_note=case when action_value in ('complete','dismiss') then btrim(note_value) else resolution_note end,closed_at=case when new_status in ('COMPLETED','DISMISSED') then now() else null end,revision=revision+1,updated_at=now() where id=x.id returning revision into x.revision;
 perform private.success_log(target_tenant_id,x.id,action_value,x.revision,jsonb_build_object('status',new_status,'reason_code',reason_value,'assignee',case when action_value in ('claim','assign') then assignee_value else x.assigned_to end,'provenance',case when action_value='complete' and x.kind='CHURN' then 'MANAGER_ATTESTATION' else 'OPERATOR_ACTION' end));return x.revision;
end;$$;
create function public.admin_success_retry_review(target_tenant_id uuid,job_value uuid,expected_attempts integer) returns boolean language plpgsql security definer set search_path=pg_catalog as $$declare j public.scheduled_jobs%rowtype;begin
 perform private.require_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]);
 if not private.success_enabled(target_tenant_id) then raise exception 'isolated sandbox required' using errcode='42501';end if;
 select * into j from public.scheduled_jobs where tenant_id=target_tenant_id and id=job_value and job_type='customer_success.review' for update;
 if j.id is null then raise exception 'review job unavailable' using errcode='42501';end if;
 if j.status<>'dead_letter' or j.attempts is distinct from expected_attempts then raise exception 'review job changed' using errcode='PT409';end if;
 update public.scheduled_jobs set status='scheduled',attempts=0,scheduled_at=now(),dead_lettered_at=null,locked_at=null,locked_by=null where id=j.id;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,before_data,after_data) values(target_tenant_id,'HUMAN',auth.uid(),'success.review_job_retried','scheduled_jobs',j.id::text,jsonb_build_object('attempts',j.attempts,'error_code',j.last_error_code),jsonb_build_object('status','scheduled'));return true;
end;$$;
create function public.admin_success_contact_policy(target_tenant_id uuid,customer_value uuid,expected_revision integer,consent_value text,opted_out_value boolean,language_value text,timezone_value text,window_start_value integer,window_end_value integer,evidence_value text) returns integer language plpgsql security definer set search_path=pg_catalog as $$declare rev integer;begin
 if not exists(select 1 from public.tenants where id=target_tenant_id and status='active') then raise exception 'active tenant required' using errcode='42501';end if;
 perform private.require_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]);
 if not private.success_enabled(target_tenant_id) then raise exception 'isolated sandbox required' using errcode='42501';end if;
 perform 1 from public.customers where tenant_id=target_tenant_id and id=customer_value for update;if not found then raise exception 'customer unavailable' using errcode='42501';end if;
 select revision into rev from public.customer_success_contact_policies where tenant_id=target_tenant_id and customer_id=customer_value;
 if coalesce(rev,0) is distinct from expected_revision then raise exception 'policy changed' using errcode='PT409';end if;
 if timezone_value is not null and not exists(select 1 from pg_timezone_names where name=timezone_value) then raise exception 'invalid timezone' using errcode='22023';end if;
 insert into public.customer_success_contact_policies(tenant_id,customer_id,consent,opted_out,preferred_language,timezone,window_start,window_end,evidence_reference,reviewed_by)
 values(target_tenant_id,customer_value,consent_value,opted_out_value,language_value,timezone_value,window_start_value,window_end_value,evidence_value,auth.uid())
 on conflict(tenant_id,customer_id) do update set consent=excluded.consent,opted_out=excluded.opted_out,preferred_language=excluded.preferred_language,timezone=excluded.timezone,window_start=excluded.window_start,window_end=excluded.window_end,evidence_reference=excluded.evidence_reference,reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),revision=public.customer_success_contact_policies.revision+1 returning revision into rev;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data) values(target_tenant_id,'HUMAN',auth.uid(),'success.contact_policy_reviewed','customers',customer_value::text,jsonb_build_object('revision',rev,'consent',consent_value,'opted_out',opted_out_value,'language',language_value,'provenance','MANAGER_ATTESTATION'));
 return rev;
end;$$;
create function public.admin_success_preview(target_tenant_id uuid,task_value uuid,expected_revision integer) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x public.customer_success_tasks%rowtype;p public.customer_success_contact_policies%rowtype;b jsonb:='["PREVIEW_ONLY_NO_SEND"]';lang text:='en';body text;result public.customer_success_previews%rowtype;local_hour integer;begin
 if not exists(select 1 from public.tenants where id=target_tenant_id and status='active') then raise exception 'active tenant required' using errcode='42501';end if;
 perform private.require_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]);
 perform 1 from public.customers c where c.tenant_id=target_tenant_id and c.id=(select customer_id from public.customer_success_tasks where tenant_id=target_tenant_id and id=task_value) for update;
 select * into x from public.customer_success_tasks where tenant_id=target_tenant_id and id=task_value for update;if x.id is null then raise exception 'task unavailable' using errcode='42501';end if;
 if x.revision is distinct from expected_revision then raise exception 'task changed' using errcode='PT409';end if;
 if not private.success_enabled(target_tenant_id) then raise exception 'isolated sandbox required' using errcode='42501';end if;
 select * into p from public.customer_success_contact_policies where tenant_id=target_tenant_id and customer_id=x.customer_id;
 if p.consent is distinct from 'GRANTED' or p.opted_out is distinct from false then b:=b||'"CONSENT_OR_OPT_OUT"'::jsonb;end if;
 if p.timezone is null then b:=b||'"TIMEZONE_UNKNOWN"'::jsonb;else local_hour:=extract(hour from clock_timestamp() at time zone p.timezone);if local_hour<p.window_start or local_hour>=p.window_end then b:=b||'"OUTSIDE_CONTACT_WINDOW"'::jsonb;end if;end if;
 if p.reviewed_at is not null then lang:=p.preferred_language;end if;
 if not exists(select 1 from public.conversations c join public.messaging_contacts m on m.tenant_id=c.tenant_id and m.id=c.messaging_contact_id where c.tenant_id=target_tenant_id and c.customer_id=x.customer_id and c.status='open' and m.contactability in ('allowed','user_initiated') and not m.review_required and m.identity_resolution in ('exact_match','manual') and m.blocked_at is null) then b:=b||'"CONTACT_NOT_VERIFIED"'::jsonb;end if;
 if exists(select 1 from public.conversations where tenant_id=target_tenant_id and customer_id=x.customer_id and (human_takeover or runtime_mode<>'AI_ACTIVE')) or exists(select 1 from public.customers where tenant_id=target_tenant_id and id=x.customer_id and automation_paused) or exists(select 1 from public.escalation_cases where tenant_id=target_tenant_id and customer_id=x.customer_id and status<>'RESOLVED') then b:=b||'"HUMAN_REVIEW_ACTIVE"'::jsonb;end if;
 if (select count(*) from public.messages m join public.conversations c on c.tenant_id=m.tenant_id and c.id=m.conversation_id where m.tenant_id=target_tenant_id and (m.customer_id=x.customer_id or (m.customer_id is null and c.customer_id=x.customer_id)) and m.direction='outbound' and m.status in ('sent','pending','sending','retry_scheduled') and m.created_at>now()-interval '24 hours')>=1 or (select count(*) from public.messages m join public.conversations c on c.tenant_id=m.tenant_id and c.id=m.conversation_id where m.tenant_id=target_tenant_id and (m.customer_id=x.customer_id or (m.customer_id is null and c.customer_id=x.customer_id)) and m.direction='outbound' and m.status in ('sent','pending','sending','retry_scheduled') and m.created_at>now()-interval '7 days')>=3 then b:=b||'"FREQUENCY_CAP"'::jsonb;end if;
 if not (select outbound_messaging_enabled from public.tenants where id=target_tenant_id) then b:=b||'"OUTBOUND_DISABLED"'::jsonb;end if;
 if x.status in ('COMPLETED','DISMISSED') then b:=b||'"TASK_CLOSED"'::jsonb;end if;
 if x.kind='RENEWAL' and not exists(select 1 from public.subscriptions s where s.tenant_id=target_tenant_id and s.id=x.source_id and s.revision=x.source_revision and s.state in ('ACTIVE','RENEWAL_DUE') and s.ends_at>now() and s.renewal_due_at<=now() and private.success_verified_subscription(target_tenant_id,s.id)) then b:=b||'"SOURCE_STALE"'::jsonb;end if;
 if x.kind='SUPPORT' then b:=b||'"USE_ESCALATION_CASE"'::jsonb;end if;
 if x.kind='INACTIVITY' and (private.success_last_activity(target_tenant_id,x.customer_id) is distinct from (x.evidence->>'last_verified_inbound_at')::timestamptz or private.success_last_activity(target_tenant_id,x.customer_id)>now()-interval '14 days') then b:=b||'"SOURCE_STALE"'::jsonb;end if;
 if x.kind='WINBACK' and (exists(select 1 from public.subscriptions where tenant_id=target_tenant_id and customer_id=x.customer_id and state in ('ACTIVE','RENEWAL_DUE') and ends_at>now() and private.success_verified_subscription(target_tenant_id,id)) or not exists(select 1 from public.customer_success_tasks c join public.subscriptions s on s.tenant_id=c.tenant_id and s.id=c.source_id and s.revision=c.source_revision where c.tenant_id=target_tenant_id and c.id=x.source_id and c.kind='CHURN' and c.status='COMPLETED' and c.reason_code<>'UNKNOWN' and c.revision=x.source_revision and private.success_verified_subscription(target_tenant_id,s.id))) then b:=b||'"SOURCE_STALE"'::jsonb;end if;
 -- Fixed, grounded language. No payment, access, refund, discount or performance claim.
 body:=case lang when 'tr' then 'Merhaba, Gold Revenue OS destek ekibi olarak yardımcı olmak için buradayız. Üyeliğiniz veya hizmetimiz hakkında görüşmek ister misiniz? Yanıt vermek istemiyorsanız lütfen bize bildirin.' when 'ar' then 'مرحباً، نحن فريق دعم Gold Revenue OS ويسعدنا مساعدتك. هل ترغب في مناقشة عضويتك أو خدمتنا؟ أخبرنا إذا كنت لا ترغب في تلقي المتابعة.' when 'ru' then 'Здравствуйте! Команда поддержки Gold Revenue OS готова помочь. Хотите обсудить ваше членство или наш сервис? Сообщите, если не хотите получать дальнейшие сообщения.' else 'Hello, the Gold Revenue OS support team is here to help. Would you like to discuss your membership or our service? Please let us know if you prefer not to receive follow-ups.' end;
 if x.kind='RENEWAL' and not (b ? 'SOURCE_STALE') then
  body:=case lang when 'tr' then 'Merhaba, mevcut üyelik döneminiz ' when 'ar' then 'مرحباً، تنتهي فترة عضويتك الحالية في ' when 'ru' then 'Здравствуйте! Текущий срок вашего членства заканчивается ' else 'Hello, your current membership term ends on ' end
   ||(select to_char(ends_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC' from public.subscriptions where tenant_id=target_tenant_id and id=x.source_id)
   ||case lang when 'tr' then '. Yenileme seçeneklerini incelemek isterseniz yardımcı olabiliriz. Otomatik ödeme veya yenileme yapılmaz.' when 'ar' then '. يمكننا مساعدتك في مراجعة خيارات التجديد. لا يتم إجراء أي دفع أو تجديد تلقائي.' when 'ru' then '. Мы можем помочь рассмотреть варианты продления. Автоматических платежей или продления нет.' else '. We can help you review renewal options. No automatic payment or renewal takes place.' end;
 end if;
 insert into public.customer_success_previews(tenant_id,task_id,task_revision,policy_revision,language,content,blockers,created_by) values(target_tenant_id,x.id,x.revision,coalesce(p.revision,0),lang,body,b,auth.uid()) on conflict(task_id,task_revision,policy_revision) do nothing returning * into result;
 if result.id is null then select * into result from public.customer_success_previews where task_id=x.id and task_revision=x.revision and policy_revision=coalesce(p.revision,0);else perform private.success_log(target_tenant_id,x.id,'preview_created',x.revision,jsonb_build_object('preview_id',result.id,'send_enabled',false));end if;
 -- Return current guards even when rendering an idempotent historical preview.
 return to_jsonb(result)||jsonb_build_object('current_blockers',b,'send_enabled',false,'approval','REVIEW_REQUIRED');
end;$$;

create function public.admin_success_review_preview(target_tenant_id uuid,preview_value uuid,expected_revision integer) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare p public.customer_success_previews%rowtype;x public.customer_success_tasks%rowtype;fresh jsonb;begin
 perform private.require_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]);
 select * into p from public.customer_success_previews where tenant_id=target_tenant_id and id=preview_value;if p.id is null then raise exception 'preview unavailable' using errcode='42501';end if;
 fresh:=public.admin_success_preview(target_tenant_id,p.task_id,expected_revision);
 select * into x from public.customer_success_tasks where tenant_id=target_tenant_id and id=p.task_id;
 if x.assigned_to is distinct from auth.uid() then raise exception 'task ownership required' using errcode='42501';end if;
 if fresh->>'id' is distinct from p.id::text then raise exception 'preview evidence changed' using errcode='PT409';end if;
 if jsonb_array_length((fresh->'current_blockers')-'PREVIEW_ONLY_NO_SEND'-'OUTBOUND_DISABLED')>0 then raise exception 'contact review incomplete' using errcode='55000';end if;
 if not exists(select 1 from public.customer_success_history where tenant_id=target_tenant_id and task_id=p.task_id and action='preview_reviewed' and details->>'preview_id'=p.id::text) then
 perform private.success_log(target_tenant_id,p.task_id,'preview_reviewed',x.revision,jsonb_build_object('preview_id',p.id,'review_scope','INTERNAL_DRY_RUN','approved_for_delivery',false,'policy_revision',p.policy_revision));end if;return true;
end;$$;

-- Source-bound language evidence only; administrator preferences are never consulted.
create function public.customer_success_language_for_source(target_tenant_id uuid,target_event_id uuid) returns text language sql stable security definer set search_path=pg_catalog as $$
 select p.preferred_language from public.customer_success_contact_policies p join public.domain_events e on e.tenant_id=p.tenant_id and e.customer_id=p.customer_id join public.tenants t on t.id=p.tenant_id
 where p.tenant_id=target_tenant_id and e.id=target_event_id and e.event_type='message.received' and p.reviewed_at<=e.recorded_at and t.status='active';
$$;
revoke all on function public.customer_success_language_for_source(uuid,uuid) from public,anon,authenticated;
grant execute on function public.customer_success_language_for_source(uuid,uuid) to service_role;

-- Read-only, bounded time window and tenant-prefixed indexes. No financial sums.
create index success_messages_activity on public.messages(tenant_id,created_at,direction);
create index success_cases_activity on public.escalation_cases(tenant_id,created_at,severity);
create function public.admin_operational_dashboard(target_tenant_id uuid,days_value integer default 30) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare days integer:=case when days_value in (7,30,90) then days_value else 30 end;since timestamptz;result jsonb;r public.app_role;begin
 if not exists(select 1 from public.tenants where id=target_tenant_id and status='active') then raise exception 'active tenant required' using errcode='42501';end if;
 r:=private.require_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst','readonly']::public.app_role[]);since:=(now() at time zone 'UTC')::date::timestamp at time zone 'UTC'-make_interval(days=>days-1);
 with dates as(select generate_series(since,(now() at time zone 'UTC')::date::timestamp at time zone 'UTC','1 day'::interval) bucket),
 activity as(select date_trunc('day',created_at at time zone 'UTC')::date bucket,count(*) filter(where direction='inbound') inbound,count(*) filter(where direction='outbound') outbound from public.messages where tenant_id=target_tenant_id and created_at>=since and r<>'readonly' group by 1),
 opened as(select (created_at at time zone 'UTC')::date bucket,count(*) opened,count(*) filter(where severity='CRITICAL') critical from public.escalation_cases where tenant_id=target_tenant_id and created_at>=since and r<>'readonly' group by 1),
 resolved as(select (resolved_at at time zone 'UTC')::date bucket,count(*) resolved from public.escalation_cases where tenant_id=target_tenant_id and resolved_at>=since and r<>'readonly' group by 1)
 select jsonb_build_object('days',days,'timezone','UTC','dataset',case when (select slug from public.tenants where id=target_tenant_id)~'^phase[0-9]+-sandbox-' then 'SANDBOX' else 'OPERATIONAL' end,
 'lifecycle',coalesce((select jsonb_object_agg(state,n) from(select state,count(*) n from public.customers where tenant_id=target_tenant_id group by state) q),'{}'::jsonb),
 'activity',case when r='readonly' then null else (select jsonb_agg(jsonb_build_object('day',to_char(d.bucket at time zone 'UTC','YYYY-MM-DD'),'inbound',coalesce(a.inbound,0),'outbound',coalesce(a.outbound,0),'opened',coalesce(o.opened,0),'critical',coalesce(o.critical,0),'resolved',coalesce(z.resolved,0)) order by d.bucket) from dates d left join activity a on a.bucket=(d.bucket at time zone 'UTC')::date left join opened o on o.bucket=(d.bucket at time zone 'UTC')::date left join resolved z on z.bucket=(d.bucket at time zone 'UTC')::date) end,
 'tasks',case when r='readonly' then null else coalesce((select jsonb_object_agg(status,n) from(select status,count(*) n from public.customer_success_tasks where tenant_id=target_tenant_id group by status) q),'{}'::jsonb) end,
 'workload',case when r='readonly' then null else coalesce((select jsonb_object_agg(kind,n) from(select kind,count(*) n from public.customer_success_tasks where tenant_id=target_tenant_id and status in ('OPEN','IN_PROGRESS','WAITING_REVIEW') group by kind) q),'{}'::jsonb) end,
 'conversation_control',case when r not in ('super_admin','manager','support') then null else coalesce((select jsonb_object_agg(control,n) from(select case when human_takeover or runtime_mode='HUMAN_TAKEOVER' then 'HUMAN' when runtime_mode='AI_ACTIVE' and automatic_replies_enabled then 'AI' else 'PAUSED' end control,count(*) n from public.conversations where tenant_id=target_tenant_id and status='open' group by 1) q),'{}'::jsonb) end,
 'open_cases',case when r='readonly' then null else(select count(*) from public.escalation_cases where tenant_id=target_tenant_id and status<>'RESOLVED') end,'critical_cases',case when r='readonly' then null else(select count(*) from public.escalation_cases where tenant_id=target_tenant_id and status<>'RESOLVED' and severity='CRITICAL') end,
 'total_customers',(select count(*) from public.customers where tenant_id=target_tenant_id),'financial_metrics_available',false,'checked_at',now()) into result;return result;
end;$$;

alter table private.customer_success_controls enable row level security;
alter table public.customer_success_tasks enable row level security;
alter table public.customer_success_history enable row level security;
alter table public.customer_success_contact_policies enable row level security;
alter table public.customer_success_previews enable row level security;
create policy success_tasks_read on public.customer_success_tasks for select to authenticated using(private.has_tenant_role(tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]) and exists(select 1 from public.tenants t where t.id=customer_success_tasks.tenant_id and t.status='active'));
create policy success_history_read on public.customer_success_history for select to authenticated using(private.has_tenant_role(tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]) and exists(select 1 from public.tenants t where t.id=customer_success_history.tenant_id and t.status='active'));
create policy success_policy_read on public.customer_success_contact_policies for select to authenticated using(private.has_tenant_role(tenant_id,array['super_admin','manager']::public.app_role[]) and exists(select 1 from public.tenants t where t.id=customer_success_contact_policies.tenant_id and t.status='active'));
create policy success_preview_read on public.customer_success_previews for select to authenticated using(private.has_tenant_role(tenant_id,array['super_admin','manager']::public.app_role[]) and exists(select 1 from public.tenants t where t.id=customer_success_previews.tenant_id and t.status='active'));
revoke all on public.customer_success_tasks,public.customer_success_history,public.customer_success_contact_policies,public.customer_success_previews,private.customer_success_controls from public,anon,authenticated,service_role;
grant select on public.customer_success_tasks,public.customer_success_history to authenticated;
-- Sensitive contact-policy attestations/previews are projected through management RPC only.
do $$declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='private'::regnamespace and proname like 'success_%' loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and (proname like 'admin_success_%' or proname in ('configure_phase13_sandbox','process_customer_success_jobs','process_customer_success_due','admin_operational_dashboard')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.signature::text like '%configure_phase13_sandbox%' or f.signature::text like '%process_customer_success_%' then execute format('grant execute on function %s to service_role',f.signature);else execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end;$$;
