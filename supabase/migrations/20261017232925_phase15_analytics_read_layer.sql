-- Phase 15 analytical read layer. No payment, entitlement, messaging or import authority.
create index analytics_messages_period on public.messages(tenant_id,occurred_at,id);
create index analytics_messages_sent on public.messages(tenant_id,sent_at,id) where direction='outbound' and status='sent';
create index analytics_invocations_period on public.model_invocations(tenant_id,created_at,id);
create index analytics_period_start on public.subscription_payments(tenant_id,period_start,id);
create index analytics_invocation_request on public.model_invocations(tenant_id,provider,provider_request_id) where provider_request_id is not null;
create index analytics_period_subscription on public.subscription_payments(tenant_id,subscription_id,period_start,period_end);
create index analytics_contact_inbound on public.messages(tenant_id,messaging_contact_id,occurred_at) where direction='inbound' and status='received';
create index analytics_test_payment_event on public.domain_events(tenant_id,(payload->>'payment_id')) where event_type='payment.test_observed' and authority='TRUSTED' and producer='payment_test_engine';
create index analytics_receipts_time on private.verified_payment_receipts(tenant_id,verified_at,id);

create table private.analytics_cost_evidence(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 category text not null check(category in ('SUPPLIER','PROCESSING','INFRASTRUCTURE','SUPPORT','COMMISSION','OTHER')),
 classification text not null check(classification in ('ASSUMPTION','DOCUMENTED')),mode text not null default 'SANDBOX' check(mode='SANDBOX'),
 amount numeric(30,8) not null check(amount>=0),currency text not null check(currency~'^[A-Z]{3,6}$'),
 period_start date not null,period_end date not null check(period_end>period_start and period_end-period_start<=366),
 evidence_reference text not null check(length(evidence_reference) between 8 and 240),evidence_hash text check(evidence_hash~'^[a-f0-9]{64}$'),
 status text not null default 'DRAFT' check(status in ('DRAFT','REVIEWED','REJECTED')),revision integer not null default 1,
 created_by uuid not null references public.app_users(id),reviewed_by uuid references public.app_users(id),request_id uuid not null,
 created_at timestamptz not null default now(),unique(tenant_id,request_id),unique(tenant_id,id),
 check(classification<>'DOCUMENTED' or evidence_hash is not null)
);
alter table private.analytics_cost_evidence enable row level security;
revoke all on private.analytics_cost_evidence from public,anon,authenticated,service_role;
create index analytics_economic_period on private.analytics_cost_evidence(tenant_id,period_start,id);
create function private.analytics_require(t uuid,manage boolean default false) returns void language plpgsql stable security definer set search_path=pg_catalog as $$begin
 if auth.uid() is null or not private.has_tenant_role(t,case when manage then array['super_admin','manager']::public.app_role[] else array['super_admin','manager','analyst']::public.app_role[] end)
 or not exists(select 1 from public.tenants where id=t and status='active') then raise exception 'analytics permission denied' using errcode='42501';end if;
end;$$;
create function private.analytics_sandbox(t uuid) returns boolean language sql stable set search_path=pg_catalog as $$select exists(select 1 from public.tenants where id=t and slug~'^phase[0-9]+-sandbox-' and not outbound_messaging_enabled);$$;
create function private.analytics_validate(t uuid,a date,b date,m text) returns void language plpgsql stable set search_path=pg_catalog as $$begin
 perform private.analytics_require(t);
 if a is null or b is null or m is null or m not in ('LIVE','SANDBOX') or b<=a or b-a>366 or a<current_date-interval '3 years' or b>current_date+1 then raise exception 'analytics period invalid' using errcode='22023';end if;
 -- Bound source populations without dynamically constructed relation names.
 if greatest((select count(*) from(select 1 from public.messaging_contacts where tenant_id=t limit 50001) q),
(select count(*) from(select 1 from public.subscriptions where tenant_id=t limit 50001) q),
(select count(*) from(select 1 from public.subscription_payments where tenant_id=t limit 50001) q),
(select count(*) from(select 1 from public.payment_invoices where tenant_id=t limit 50001) q),
(select count(*) from(select 1 from public.commercial_offers where tenant_id=t limit 50001) q),
(select count(*) from(select 1 from public.escalation_cases where tenant_id=t limit 50001) q),
(select count(*) from(select 1 from public.survey_versions where tenant_id=t limit 50001) q),
(select count(*) from(select 1 from public.customer_success_tasks where tenant_id=t limit 50001) q),
(select count(*) from(select 1 from public.agent_runs where tenant_id=t limit 50001) q),
(select count(*) from(select 1 from public.domain_events where tenant_id=t limit 50001) q))>50000 then raise exception 'analytics narrow the scope; source capacity requires review' using errcode='PT422';end if;
 -- Fail instead of silently truncating an analytical window. Existing indexes bound scans.
 if (select count(*) from(select 1 from public.messages where tenant_id=t and occurred_at>=(a-(b-a))::timestamp at time zone 'UTC' and occurred_at<b::timestamp at time zone 'UTC' limit 50001) s)>50000
 or (select count(*) from(select 1 from public.model_invocations where tenant_id=t and created_at>=(a-(b-a))::timestamp at time zone 'UTC' and created_at<b::timestamp at time zone 'UTC' limit 50001) s)>50000 then raise exception 'analytics narrow the period' using errcode='PT422';end if;
end;$$;
create function private.analytics_metric(k text,v numeric,u text default 'count',n bigint default 0,d bigint default null,r text default '',basis_value text default 'PERIOD',partial boolean default false) returns jsonb language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('id',k,'status',case when v is null then 'UNAVAILABLE' when partial then 'INCOMPLETE' else 'AVAILABLE' end,'value',v::text,'unit',u,'sample',n,'denominator',d,'reason',r,'basis',basis_value);
$$;
-- Receipt identity is not an amount. LIVE rows intentionally carry NULL amount/currency.
create function private.analytics_periods(t uuid,m text) returns table(id uuid,subscription_id uuid,customer_id uuid,plan_id uuid,period_start timestamptz,period_end timestamptz,amount numeric,currency text,network text,terms jsonb) language sql stable set search_path=pg_catalog as $$
 select p.id,s.id,s.customer_id,s.plan_version_id,p.period_start,p.period_end,
 case when m='SANDBOX' then i.amount_units/power(10::numeric,i.decimals) end,
 case when m='SANDBOX' then i.asset end,case when m='SANDBOX' then i.network end,p.term_snapshot
 from public.subscription_payments p join public.subscriptions s on s.tenant_id=p.tenant_id and s.id=p.subscription_id and s.mode=p.mode
 join public.domain_events e on e.tenant_id=p.tenant_id and e.id=p.event_id and e.customer_id=s.customer_id and e.authority='TRUSTED'
 left join public.payment_invoices i on i.tenant_id=p.tenant_id and i.id=p.test_invoice_id
 left join private.verified_payment_receipts r on r.tenant_id=p.tenant_id and r.id=p.receipt_id
 where p.tenant_id=t and p.mode=case m when 'LIVE' then 'live' else 'test' end and p.period_end>p.period_start
 and ((m='SANDBOX' and i.mode='test' and i.status='CONFIRMED' and i.customer_id=s.customer_id and i.confirmed_at<=now() and e.event_type='payment.test_observed' and e.producer='payment_test_engine' and e.payload->>'payment_id'=i.id::text and e.payload->>'state'='CONFIRMED')
 or(m='LIVE' and r.signature_verified and r.independent_verified and r.customer_id=s.customer_id and r.verified_at<=now() and r.event_id=e.id and e.event_type='payment.confirmed' and e.producer='payment_verifier' and e.payload->>'payment_id'=r.id::text and e.payload->>'tx_hash'=r.provider_reference));
$$;
create function private.analytics_monthly(v numeric,terms jsonb) returns numeric language plpgsql immutable set search_path=pg_catalog as $$declare n numeric;begin
 if v is null or terms->>'billing' is distinct from 'recurring' or coalesce(terms->>'duration_count','')!~'^[1-9][0-9]{0,2}$' then return null;end if;
 n:=(terms->>'duration_count')::numeric;
 return case terms->>'duration_unit' when 'calendar_month' then v/n when 'calendar_year' then v/(12*n) else null end;
end;$$;
create function private.analytics_hash(v text) returns text language sql immutable set search_path=pg_catalog as $$select encode(extensions.digest(v,'sha256'),'hex');$$;
create function private.analytics_fingerprint(t uuid,a date,b date,m text) returns text language sql stable set search_path=pg_catalog as $$
 select encode(extensions.digest(m||a::text||b::text||coalesce(string_agg(h,'' order by kind,id),''),'sha256'),'hex') from(
 select 'message' kind,id,private.analytics_hash(jsonb_build_array(id,status,actor_type,occurred_at,sent_at,provider_acknowledged_at,provider_message_id is not null)::text) h from public.messages where tenant_id=t and (occurred_at>=a::timestamp at time zone 'UTC' and occurred_at<b::timestamp at time zone 'UTC')
 union all select 'invocation',id,private.analytics_hash(to_jsonb(i)::text) from public.model_invocations i where tenant_id=t and created_at>=a::timestamp at time zone 'UTC' and created_at<b::timestamp at time zone 'UTC'
 union all select 'subscription',id,private.analytics_hash(to_jsonb(s)::text) from public.subscriptions s where tenant_id=t
 union all select 'invoice',id,private.analytics_hash(jsonb_build_array(id,status,confirmed_at)::text) from public.payment_invoices where tenant_id=t
 union all select 'receipt',id,private.analytics_hash(jsonb_build_array(id,event_id,verified_at)::text) from private.verified_payment_receipts where tenant_id=t
 union all select 'cost',id,private.analytics_hash(jsonb_build_array(id,revision)::text) from private.analytics_cost_evidence where tenant_id=t
 union all select 'case',id,private.analytics_hash(jsonb_build_array(id,revision,first_response_at,resolved_at)::text) from public.escalation_cases where tenant_id=t
 union all select 'offer',id,private.analytics_hash(jsonb_build_array(id,status,reviewed_at)::text) from public.commercial_offers where tenant_id=t
 union all select 'contact',id,private.analytics_hash(jsonb_build_array(id,customer_id,identity_resolution,review_required)::text) from public.messaging_contacts where tenant_id=t
 union all select 'period',id,private.analytics_hash(jsonb_build_array(id,event_id,period_start,period_end,period_start<=now() and period_end>now())::text) from public.subscription_payments where tenant_id=t
 union all select 'run',id,private.analytics_hash(jsonb_build_array(id,status,completed_at,structured_output)::text) from public.agent_runs where tenant_id=t
 union all select 'trusted_payment_event',id,private.analytics_hash(jsonb_build_array(id,customer_id,event_type,payload)::text) from public.domain_events where tenant_id=t and event_type in ('payment.confirmed','payment.test_observed') and authority='TRUSTED'
 union all select 'success',id,private.analytics_hash(jsonb_build_array(id,revision,status,reason_code)::text) from public.customer_success_tasks where tenant_id=t
 ) q;
$$;
create function private.analytics_funnel(t uuid,a date,b date,m text) returns jsonb language sql stable set search_path=pg_catalog as $$
 with contacts as(
 select mc.id,case when mc.customer_id is not null and mc.identity_resolution in ('exact_match','manual') and not mc.review_required then mc.customer_id end customer,
 (select min(x.occurred_at) from public.messages x where x.tenant_id=t and x.messaging_contact_id=mc.id and x.direction='inbound' and x.status='received' and x.occurred_at<b::timestamp at time zone 'UTC') entered
 from public.messaging_contacts mc where mc.tenant_id=t and private.analytics_sandbox(t) and m='SANDBOX'
 ), cohort as(
 select coalesce(customer::text,'contact:'||id::text) key,customer,min(entered) entered from contacts where entered is not null group by coalesce(customer::text,'contact:'||id::text),customer
 having min(entered)>=a::timestamp at time zone 'UTC' and min(entered)<b::timestamp at time zone 'UTC'
 ), evidence as(
 select c.*,qual.at q,offr.at o,inv.at i,pay.at p,sub.at s,acc.at v from cohort c
 left join lateral(select min(r.completed_at) at from public.agent_runs r join public.agent_tasks at on at.tenant_id=r.tenant_id and at.id=r.task_id where r.tenant_id=t and at.customer_id=c.customer and at.task_type='lead.intelligence' and r.status='SUCCEEDED' and r.structured_output->>'identity'='matched' and r.completed_at>=c.entered and r.completed_at<b::timestamp at time zone 'UTC') qual on true
 left join lateral(select min(o.reviewed_at) at from public.commercial_offers o where o.tenant_id=t and o.customer_id=c.customer and o.status='approved' and o.reviewer is not null and o.reviewed_at>=c.entered and o.reviewed_at<least(o.expires_at,b::timestamp at time zone 'UTC')) offr on true
 left join lateral(select min(i.created_at) at from public.payment_invoices i join public.commercial_offers o on o.tenant_id=i.tenant_id and o.id=i.offer_id where i.tenant_id=t and i.customer_id=c.customer and o.status='approved' and i.created_at>=c.entered and i.created_at<b::timestamp at time zone 'UTC') inv on true
 left join lateral(select min(i.confirmed_at) at from public.payment_invoices i where i.tenant_id=t and i.customer_id=c.customer and i.status='CONFIRMED' and i.confirmed_at>=c.entered and i.confirmed_at<b::timestamp at time zone 'UTC' and exists(select 1 from public.domain_events e where e.tenant_id=t and e.customer_id=c.customer and e.event_type='payment.test_observed' and e.authority='TRUSTED' and e.producer='payment_test_engine' and e.payload->>'payment_id'=i.id::text and e.payload->>'state'='CONFIRMED')) pay on true
 left join lateral(select min(p.period_start) at from private.analytics_periods(t,m) p where p.customer_id=c.customer and p.period_start>=c.entered and p.period_start<b::timestamp at time zone 'UTC') sub on true
 left join lateral(select min(ac.membership_checked_at) at from public.channel_access ac join public.subscriptions su on su.tenant_id=ac.tenant_id and su.id=ac.subscription_id where ac.tenant_id=t and su.customer_id=c.customer and ac.mode='test' and ac.status='MEMBER' and ac.membership_checked_at>=c.entered and ac.membership_checked_at<b::timestamp at time zone 'UTC') acc on true
 ), stages as(select e.key,x.* from evidence e cross join lateral(values(0,'inbound',e.entered,null::timestamptz),(1,'identity',case when e.customer is not null then e.entered end,e.entered),(2,'qualification',e.q,case when e.customer is not null then e.entered end),(3,'offer',e.o,e.q),(4,'invoice',e.i,e.o),(5,'payment',e.p,e.i),(6,'subscription',e.s,e.p),(7,'access',e.v,e.s)) x(n,stage,at,prior)), counts as(
 select n,stage,count(*) filter(where at is not null) num,count(*) filter(where at is not null and prior is not null and at>=prior) overlap,case when n>0 then count(*) filter(where prior is not null) end prev from stages group by n,stage
 ), all_stages as(select * from(values(0,'inbound'),(1,'identity'),(2,'qualification'),(3,'offer'),(4,'invoice'),(5,'payment'),(6,'subscription'),(7,'access')) x(n,stage))
 select jsonb_agg(jsonb_build_object('stage',x.stage,'count',coalesce(c.num,0),'overlap',coalesce(c.overlap,0),'previous',case when x.n>0 then coalesce(c.prev,0) end,'rate',case when c.prev>0 then (c.overlap::numeric/c.prev)::text end) order by x.n) from all_stages x left join counts c on c.n=x.n;
$$;
create function private.analytics_metrics(t uuid,a date,b date,m text) returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare result jsonb:='[]';n bigint;k bigint;v numeric;known bigint;den bigint;rec record;st timestamptz:=a::timestamp at time zone 'UTC';en timestamptz:=b::timestamp at time zone 'UTC';begin
 select count(*),count(*) filter(where input_tokens is not null) into n,known from public.model_invocations where tenant_id=t and created_at>=st and created_at<en;
 result:=result||private.analytics_metric('invocations',n,'count',n);
 for rec in select * from(values('input_tokens'),('output_tokens')) x(k) loop
 execute format('select sum(%I),count(%I) from public.model_invocations where tenant_id=$1 and created_at>=$2 and created_at<$3',rec.k,rec.k) into v,known using t,st,en;
 result:=result||private.analytics_metric(rec.k,v,'count',known,n,'TOKEN_COVERAGE','PERIOD',known<n);
 end loop;
 select count(*) filter(where status='SUCCEEDED'),count(*) filter(where latency_ms is not null) into k,known from public.model_invocations where tenant_id=t and created_at>=st and created_at<en;
 result:=result||private.analytics_metric('model_success',k::numeric/nullif(n,0),'ratio',k,n,'NO_DENOMINATOR')||private.analytics_metric('model_errors',(n-k)::numeric/nullif(n,0),'ratio',n-k,n,'NO_DENOMINATOR');
 -- Separate expressions keep percentile values numeric and sample denominators explicit.
 select percentile_cont(0.5) within group(order by latency_ms) into v from public.model_invocations where tenant_id=t and created_at>=st and created_at<en;
 result:=result||private.analytics_metric('median_latency',v,'ms',known,n,'LATENCY_SAMPLE','PERIOD',known<n);
 select percentile_cont(0.95) within group(order by latency_ms) into v from public.model_invocations where tenant_id=t and created_at>=st and created_at<en;
 result:=result||private.analytics_metric('p95_latency',v,'ms',known,n,'LATENCY_SAMPLE','PERIOD',known<n);
 select count(*) into known from public.model_invocations i where i.tenant_id=t and i.created_at>=st and i.created_at<en and i.billed_amount>=0 and i.billed_currency~'^[A-Z]{3,6}$' and i.provider_request_id is not null and not exists(select 1 from public.model_invocations d where d.tenant_id=t and d.provider=i.provider and d.provider_request_id=i.provider_request_id and d.id<>i.id);
 result:=result||private.analytics_metric('billing_coverage',known::numeric/nullif(n,0),'ratio',known,n,'RECORDED_NOT_PROVIDER_VERIFIED');
 result:=result||private.analytics_metric('ai_cost',null,'money',known,n,'CURRENCY_GROUPS_RECORDED_UNVERIFIED');
 result:=result||private.analytics_metric('cost_per_operation',null,'money',known,n,'COMPLETE_RUN_BILLING_REQUIRED');
 select count(*) into k from public.messages where tenant_id=t and direction='inbound' and status='received' and occurred_at>=st and occurred_at<en;
 result:=result||private.analytics_metric('inbound',k,'count',k);
 select count(*) into k from public.messages where tenant_id=t and direction='outbound' and status='sent' and provider_message_id is not null and provider_acknowledged_at is not null and sent_at>=st and sent_at<en;
 result:=result||private.analytics_metric('outbound',k,'count',k);
 for rec in select * from(values('human_handled','HUMAN'),('ai_handled','SYSTEM')) x(k,actor) loop
 select count(*) into k from public.messages where tenant_id=t and direction='outbound' and status='sent' and provider_message_id is not null and provider_acknowledged_at is not null and sent_at>=st and sent_at<en and actor_type::text=rec.actor;
 result:=result||private.analytics_metric(rec.k,k,'count',k);
 end loop;
 select count(*) into k from public.agent_runs where tenant_id=t and created_at>=st and created_at<en;result:=result||private.analytics_metric('agent_runs',k,'count',k);
 select count(distinct conversation_id) into den from public.messages where tenant_id=t and direction='inbound' and status='received' and occurred_at>=st and occurred_at<en;
 select count(distinct e.conversation_id) into k from public.escalation_cases e where e.tenant_id=t and e.created_at>=st and e.created_at<en and exists(select 1 from public.messages mm where mm.tenant_id=t and mm.conversation_id=e.conversation_id and mm.direction='inbound' and mm.status='received' and mm.occurred_at>=st and mm.occurred_at<en);
 result:=result||private.analytics_metric('escalation_rate',k::numeric/nullif(den,0),'ratio',k,den,'NO_DENOMINATOR');
 select count(*) into k from public.escalation_cases where tenant_id=t and severity='CRITICAL' and status<>'RESOLVED';result:=result||private.analytics_metric('critical_cases',k,'count',k,null,'CURRENT_BACKLOG','CURRENT');
 select count(*) into den from public.escalation_cases where tenant_id=t and created_at>=st and created_at<en;
 select percentile_cont(.5) within group(order by extract(epoch from e.first_response_at-e.created_at)),count(*) into v,k from public.escalation_cases e where e.tenant_id=t and e.created_at>=st and e.created_at<en and e.first_response_at>=e.created_at and exists(select 1 from public.messages mm where mm.tenant_id=t and mm.conversation_id=e.conversation_id and mm.actor_type='HUMAN' and mm.direction='outbound' and mm.status='sent' and mm.provider_message_id is not null and mm.provider_acknowledged_at is not null and mm.sent_at=e.first_response_at);
 result:=result||private.analytics_metric('first_human_response',v,'seconds',k,den,'VERIFIED_HUMAN_RESPONSE_SAMPLE');
 select percentile_cont(.5) within group(order by extract(epoch from resolved_at-created_at)),count(*) into v,k from public.escalation_cases where tenant_id=t and status='RESOLVED' and resolved_at>=st and resolved_at<en and resolved_at>=created_at;
 result:=result||private.analytics_metric('resolution_time',v,'seconds',k,null,'RECORDED_RESOLUTION_SAMPLE');
 select max(extract(epoch from now()-created_at)),count(*) into v,k from public.escalation_cases where tenant_id=t and status<>'RESOLVED' and created_at<=now();result:=result||private.analytics_metric('queue_age',v,'seconds',k,null,'CURRENT_BACKLOG','CURRENT');
 select count(*) into k from public.messages where tenant_id=t and direction='outbound' and status in ('failed','retry_scheduled') and created_at>=st and created_at<en;result:=result||private.analytics_metric('failed_deliveries',k,'count',k);
 select count(*) into k from public.customer_success_tasks where tenant_id=t and created_at>=st and created_at<en and mode=case m when 'LIVE' then 'live' else 'test' end;result:=result||private.analytics_metric('success_tasks',k,'count',k);
 select count(distinct s.id) into k from public.subscriptions s where s.tenant_id=t and s.state in ('ACTIVE','RENEWAL_DUE') and exists(select 1 from private.analytics_periods(t,m) p where p.subscription_id=s.id and p.period_start<=now() and p.period_end>now());result:=result||private.analytics_metric('active_subscriptions',k,'count',k,null,'CURRENT_EVIDENCED_PERIOD','CURRENT');
 select count(*) into k from private.analytics_periods(t,m) p where p.period_start>=st and p.period_start<en and exists(select 1 from private.analytics_periods(t,m) x where x.subscription_id=p.subscription_id and x.period_start<p.period_start);result:=result||private.analytics_metric('renewal_events',k,'count',k);
 with due as(select p.subscription_id,max(p.period_end) boundary from private.analytics_periods(t,m) p where p.period_end>=st and p.period_end<least(en,now()-interval '1 day') group by p.subscription_id)
 select count(*),count(*) filter(where exists(select 1 from private.analytics_periods(t,m) p where p.subscription_id=d.subscription_id and p.period_start>=d.boundary and p.period_start<en and p.period_start<=now())) into den,k from due d;
 result:=result||private.analytics_metric('renewal_rate',k::numeric/nullif(den,0),'ratio',k,den,'OBSERVED_CONTINUATION_PROVISIONAL');
 for rec in select * from(values('expired','EXPIRED'),('cancelled','CANCELLED')) x(k,s) loop
 select count(*) into k from public.subscriptions where tenant_id=t and state=rec.s and mode=case m when 'LIVE' then 'live' else 'test' end and (rec.s<>'EXPIRED' or ends_at<=now());result:=result||private.analytics_metric(rec.k,k,'count',k,null,'CURRENT_STATE_NOT_REQUEST','CURRENT');end loop;
 with opening as(select distinct customer_id from private.analytics_periods(t,m) where period_start<=st and period_end>st)
 select count(*),count(*) filter(where not exists(select 1 from private.analytics_periods(t,m) p where p.customer_id=o.customer_id and p.period_start<=en and p.period_end>en)) into den,k from opening o;
 result:=result||private.analytics_metric('customer_churn',case when en<=now() then k::numeric/nullif(den,0) end,'ratio',k,den,case when en>now() then 'OBSERVATION_WINDOW_OPEN' when den=0 then 'NO_DENOMINATOR' else 'PERIOD_COVERAGE_PROVISIONAL' end,'COHORT');
 for rec in select * from(values('collected',case when m='SANDBOX' then 'CURRENCY_GROUPS_REQUIRED' else 'AUTHORITATIVE_AMOUNT_MISSING' end),('mrr','COMPLETE_RECURRING_CURRENCY_GROUPS_REQUIRED'),('arr','DEFENSIBLE_MRR_REQUIRED'),('refunds','NO_REFUND_RECEIPTS'),('revenue_churn','HISTORICAL_RECURRING_POLICY_MISSING'),('nrr','HISTORICAL_RECURRING_POLICY_MISSING'),('grr','HISTORICAL_RECURRING_POLICY_MISSING'),('margin','CRITICAL_COSTS_AND_NET_RECEIPTS_MISSING'),('cac','ACQUISITION_ATTRIBUTION_MISSING'),('ltv','LIFETIME_POLICY_MISSING'),('roi','RETURN_AND_INVESTMENT_EVIDENCE_MISSING')) x(k,r) loop
 result:=result||private.analytics_metric(rec.k,null,case when rec.k in ('revenue_churn','nrr','grr','margin','roi') then 'ratio' else 'money' end,0,null,rec.r,case when rec.k in ('mrr','arr') then 'CURRENT' else 'PERIOD' end);end loop;
 return result;
end;$$;
create function private.analytics_money(t uuid,a date,b date,m text) returns jsonb language sql stable set search_path=pg_catalog as $$
 with cash as(
 select i.id,i.offer_id,i.asset currency,i.network,i.amount_units/power(10::numeric,i.decimals) amount from public.payment_invoices i
 where i.tenant_id=t and m='SANDBOX' and i.mode='test' and i.status='CONFIRMED' and i.confirmed_at>=a::timestamp at time zone 'UTC' and i.confirmed_at<least(b::timestamp at time zone 'UTC',now())
 and exists(select 1 from public.domain_events e where e.tenant_id=t and e.customer_id=i.customer_id and e.authority='TRUSTED' and e.event_type='payment.test_observed' and e.producer='payment_test_engine' and e.payload->>'payment_id'=i.id::text and e.payload->>'state'='CONFIRMED')
 ), recurring as(
 select p.*,case when exists(select 1 from private.analytics_periods(t,m) other where other.subscription_id=p.subscription_id and other.id<>p.id and other.period_start<=now() and other.period_end>now()) then null else private.analytics_monthly(p.amount,p.terms) end monthly from private.analytics_periods(t,m) p join public.subscriptions s on s.tenant_id=t and s.id=p.subscription_id and s.state in ('ACTIVE','RENEWAL_DUE')
 where m='SANDBOX' and p.period_start<=now() and p.period_end>now() and p.terms->>'billing'='recurring'
 ), bill as(
 select i.*,i.billed_amount>=0 and i.billed_currency~'^[A-Z]{3,6}$' and i.provider_request_id is not null and not exists(select 1 from public.model_invocations d where d.tenant_id=t and d.provider=i.provider and d.provider_request_id=i.provider_request_id and d.id<>i.id) complete
 from public.model_invocations i where i.tenant_id=t and i.created_at>=a::timestamp at time zone 'UTC' and i.created_at<b::timestamp at time zone 'UTC'
 ), operation_scope as(
 select count(*) total,count(*) filter(where complete) complete from bill
 ), valid_runs as(
 select count(distinct r.id) n from public.agent_runs r join bill i on i.run_id=r.id where r.tenant_id=t and r.status='SUCCEEDED'
 and not exists(select 1 from public.model_invocations d where d.tenant_id=t and d.run_id=r.id and (d.created_at<a::timestamp at time zone 'UTC' or d.created_at>=b::timestamp at time zone 'UTC'))
 ), rows as(
 select 'collected' kind,currency,network,sum(amount)::text amount,'SANDBOX' status,count(*) sample,0::bigint missing from cash group by currency,network
 union all select 'plan:'||(v.payload->>'title'),c.currency,c.network,sum(c.amount)::text,'SANDBOX',count(*),0 from cash c join public.commercial_offers o on o.tenant_id=t and o.id=c.offer_id join public.commercial_versions v on v.tenant_id=t and v.id=o.plan_version_id group by v.id,v.payload,c.currency,c.network
 union all select 'mrr',coalesce(currency,'UNKNOWN'),coalesce(network,''),case when count(*) filter(where monthly is null)=0 then sum(monthly)::text end,'PROVISIONAL_SANDBOX',count(*),count(*) filter(where monthly is null) from recurring group by currency,network
 union all select 'arr',coalesce(currency,'UNKNOWN'),coalesce(network,''),case when count(*) filter(where monthly is null)=0 then (sum(monthly)*12)::text end,'PROVISIONAL_SANDBOX',count(*),count(*) filter(where monthly is null) from recurring group by currency,network
 union all select 'ai_cost',billed_currency,'',sum(billed_amount)::text,'RECORDED_UNVERIFIED',count(*),(select total-complete from operation_scope) from bill where complete group by billed_currency
 union all select 'cost_per_operation',billed_currency,'',(sum(billed_amount)/(select n from valid_runs))::text,'RECORDED_UNVERIFIED',count(*),0 from bill where complete and (select total=complete and total>0 from operation_scope) and (select n>0 from valid_runs) and not exists(select 1 from bill bi join public.agent_runs r on r.tenant_id=t and r.id=bi.run_id where r.status<>'SUCCEEDED') and not exists(select 1 from bill bi where exists(select 1 from public.model_invocations d where d.tenant_id=t and d.run_id=bi.run_id and (d.created_at<a::timestamp at time zone 'UTC' or d.created_at>=b::timestamp at time zone 'UTC'))) group by billed_currency
 ) select coalesce(jsonb_agg(to_jsonb(rows) order by kind,currency,network),'[]') from rows;
$$;
create function public.admin_analytics_workspace(target_tenant_id uuid,start_value date,end_value date,mode_value text default 'LIVE',cost_after uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
declare t uuid:=target_tenant_id;a date:=start_value;b date:=end_value;m text:=mode_value;st timestamptz;en timestamptz;result jsonb;dist jsonb:='{}';r record;feed jsonb:='[]';agg jsonb;v record;begin
 perform private.analytics_validate(t,a,b,m);st:=a::timestamp at time zone 'UTC';en:=b::timestamp at time zone 'UTC';
 for r in select * from(values('models'),('runs'),('success'),('renewal_reviews'),('churn_reasons'),('cases'),('insights'),('survey_topics'),('handling')) x(k) loop
 case r.k
 when 'models' then select coalesce(jsonb_object_agg(k,n),'{}') into agg from(select provider||' / '||model k,count(*) n from public.model_invocations where tenant_id=t and created_at>=st and created_at<en group by provider,model order by count(*) desc,provider,model limit 30) q;
 when 'runs' then select coalesce(jsonb_object_agg(k,n),'{}') into agg from(select status::text k,count(*) n from public.agent_runs where tenant_id=t and created_at>=st and created_at<en group by status) q;
 when 'success' then select coalesce(jsonb_object_agg(k,n),'{}') into agg from(select status k,count(*) n from public.customer_success_tasks where tenant_id=t and created_at>=st and created_at<en and mode=case m when 'LIVE' then 'live' else 'test' end group by status) q;
 when 'renewal_reviews' then select coalesce(jsonb_object_agg(k,n),'{}') into agg from(select status k,count(*) n from public.customer_success_tasks where tenant_id=t and kind='RENEWAL' and created_at>=st and created_at<en and mode=case m when 'LIVE' then 'live' else 'test' end group by status) q;
 when 'churn_reasons' then select coalesce(jsonb_object_agg(k,n),'{}') into agg from(select coalesce(reason_code,'UNKNOWN') k,count(*) n from public.customer_success_tasks where tenant_id=t and kind='CHURN' and created_at>=st and created_at<en and mode=case m when 'LIVE' then 'live' else 'test' end group by reason_code) q;
 when 'cases' then select coalesce(jsonb_object_agg(k,n),'{}') into agg from(select status k,count(*) n from public.escalation_cases where tenant_id=t and created_at>=st and created_at<en group by status) q;
 when 'insights' then select coalesce(jsonb_object_agg(k,n),'{}') into agg from(select status k,count(*) n from public.survey_insights where tenant_id=t and privacy='IDENTIFIED' and collection_month>=a and collection_month+interval '1 month'<=b and collection_month<date_trunc('month',now() at time zone 'UTC')::date and ((m='SANDBOX')=private.analytics_sandbox(t)) group by status) q;
 when 'survey_topics' then select coalesce(jsonb_object_agg(k,n),'{}') into agg from(select evidence->'question'->>'topic' k,count(*) n from public.survey_insights where tenant_id=t and privacy='IDENTIFIED' and evidence->'question'->>'topic' is not null and collection_month>=a and collection_month+interval '1 month'<=b and collection_month<date_trunc('month',now() at time zone 'UTC')::date and ((m='SANDBOX')=private.analytics_sandbox(t)) group by evidence->'question'->>'topic') q;
 else select coalesce(jsonb_object_agg(k,n),'{}') into agg from(select case when human_takeover then 'HUMAN' else 'AI' end k,count(*) n from public.conversations where tenant_id=t group by human_takeover) q;
 end case;dist:=dist||jsonb_build_object(r.k,agg);end loop;
 -- Reuse the accepted privacy function. No anonymous row ID/text/contact projection or join.
 if (m='SANDBOX')=private.analytics_sandbox(t) then
 for v in select sv.id,mo::date mo from public.survey_versions sv cross join generate_series(date_trunc('month',st at time zone 'UTC'),date_trunc('month',en at time zone 'UTC'),interval '1 month') mo where sv.tenant_id=t and mo::date>=a and mo::date+interval '1 month'<=b and mo::date<date_trunc('month',now() at time zone 'UTC')::date order by mo,sv.id limit 50 loop
 agg:=private.survey_aggregate(t,v.id,v.mo,'ANONYMOUS');feed:=feed||jsonb_build_object('version',v.id,'month',v.mo,'privacy','ANONYMOUS','sample',case when coalesce((agg->>'suppressed')::boolean,true) then null else (agg->>'sample_size')::int end,'suppressed',coalesce((agg->>'suppressed')::boolean,true));
 end loop;end if;
 result:=jsonb_build_object('checked_at',now(),'start',a,'end',b,'mode',m,'operational_scope',case when private.analytics_sandbox(t) then 'SANDBOX' else 'UNCLASSIFIED' end,
 'metrics',private.analytics_metrics(t,a,b,m),'comparison',private.analytics_metrics(t,a-(b-a),a,m),'previous_start',a-(b-a),'funnel',private.analytics_funnel(t,a,b,m),'money',private.analytics_money(t,a,b,m),'distributions',dist,'feedback',feed,
 'sources',jsonb_build_object('invoices',(select count(*) from public.payment_invoices where tenant_id=t and m='SANDBOX' and created_at>=st and created_at<en),'receipts',(select count(*) from private.verified_payment_receipts where tenant_id=t and m='LIVE' and verified_at>=st and verified_at<en),'periods',(select count(*) from private.analytics_periods(t,m) where period_start>=st and period_start<en),'incomplete_receipt_amounts',(select count(*) from private.verified_payment_receipts where tenant_id=t and m='LIVE' and verified_at>=st and verified_at<en)),
 'cost_evidence',coalesce((select jsonb_agg(to_jsonb(x) order by id) from(select id,category,classification,status,currency,amount::text,revision,period_start,period_end,case when private.has_tenant_role(t,array['super_admin','manager']::public.app_role[]) then evidence_reference end reference,case when private.has_tenant_role(t,array['super_admin','manager']::public.app_role[]) then evidence_hash end hash from private.analytics_cost_evidence where tenant_id=t and m='SANDBOX' and (cost_after is null or id>cost_after) and period_start<b and period_end>a order by id limit 25) x),'[]'),
 'cost_evidence_more',(select count(*)>25 from(select 1 from private.analytics_cost_evidence where tenant_id=t and m='SANDBOX' and (cost_after is null or id>cost_after) and period_start<b and period_end>a limit 26) q),
 'fingerprint',private.analytics_fingerprint(t,a,b,m));
 return result||jsonb_build_object('series',(select coalesce(jsonb_agg(jsonb_build_object('day',d::date,'inbound',(select count(*) from public.messages where tenant_id=t and direction='inbound' and status='received' and occurred_at>=d and occurred_at<d+interval '1 day'),'outbound',(select count(*) from public.messages where tenant_id=t and direction='outbound' and status='sent' and provider_message_id is not null and provider_acknowledged_at is not null and sent_at>=d and sent_at<d+interval '1 day'),'invocations',(select count(*) from public.model_invocations where tenant_id=t and created_at>=d and created_at<d+interval '1 day'),'cases',(select count(*) from public.escalation_cases where tenant_id=t and created_at>=d and created_at<d+interval '1 day')) order by d),'[]') from generate_series(st,en-interval '1 day',interval '1 day') d));
end;$$;
create function public.admin_analytics_sources(target_tenant_id uuid,start_value date,end_value date,mode_value text,kind_value text,fingerprint_value text,after_value uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' as $$declare rows_value jsonb;begin
 perform private.analytics_validate(target_tenant_id,start_value,end_value,mode_value);
 if fingerprint_value is distinct from private.analytics_fingerprint(target_tenant_id,start_value,end_value,mode_value) then raise exception 'analytics source changed' using errcode='PT409';end if;
 if kind_value is null or kind_value not in ('invocations','invoices','subscriptions','cases','offers') then raise exception 'analytics source invalid' using errcode='22023';end if;
 with sources as(
 select id,created_at at,'model_invocations' source,status state from public.model_invocations where kind_value='invocations' and tenant_id=target_tenant_id and created_at>=start_value::timestamp at time zone 'UTC' and created_at<end_value::timestamp at time zone 'UTC'
 union all select i.id,i.confirmed_at,'payment_invoices',i.status from public.payment_invoices i where kind_value='invoices' and mode_value='SANDBOX' and i.tenant_id=target_tenant_id and i.status='CONFIRMED' and i.confirmed_at>=start_value::timestamp at time zone 'UTC' and i.confirmed_at<least(end_value::timestamp at time zone 'UTC',now()) and exists(select 1 from public.domain_events e where e.tenant_id=i.tenant_id and e.customer_id=i.customer_id and e.authority='TRUSTED' and e.event_type='payment.test_observed' and e.producer='payment_test_engine' and e.payload->>'payment_id'=i.id::text and e.payload->>'state'='CONFIRMED')
 union all select r.id,r.verified_at,'verified_payment_receipts','AMOUNT_UNAVAILABLE' from private.verified_payment_receipts r join public.domain_events e on e.tenant_id=r.tenant_id and e.id=r.event_id where kind_value='invoices' and mode_value='LIVE' and r.tenant_id=target_tenant_id and r.verified_at>=start_value::timestamp at time zone 'UTC' and r.verified_at<least(end_value::timestamp at time zone 'UTC',now()) and e.customer_id=r.customer_id and e.authority='TRUSTED' and e.event_type='payment.confirmed' and e.producer='payment_verifier' and e.payload->>'payment_id'=r.id::text and e.payload->>'tx_hash'=r.provider_reference
 union all select s.id,s.created_at,'subscriptions',s.state from public.subscriptions s where kind_value='subscriptions' and s.tenant_id=target_tenant_id and s.mode=case mode_value when 'LIVE' then 'live' else 'test' end and s.state in ('ACTIVE','RENEWAL_DUE') and exists(select 1 from private.analytics_periods(target_tenant_id,mode_value) p where p.subscription_id=s.id and p.period_start<=now() and p.period_end>now())
 union all select id,created_at,'escalation_cases',status from public.escalation_cases where kind_value='cases' and tenant_id=target_tenant_id and severity='CRITICAL' and status<>'RESOLVED'
 union all select id,created_at,'commercial_offers',status from public.commercial_offers where kind_value='offers' and status='approved' and reviewer is not null and reviewed_at<expires_at and mode_value='SANDBOX' and private.analytics_sandbox(target_tenant_id) and tenant_id=target_tenant_id and created_at>=start_value::timestamp at time zone 'UTC' and created_at<end_value::timestamp at time zone 'UTC'
 ) select coalesce(jsonb_agg(to_jsonb(q) order by id),'[]') into rows_value from(select * from sources where after_value is null or id>after_value order by id limit 26) q;
 return jsonb_build_object('rows',case when jsonb_array_length(rows_value)>25 then rows_value-25 else rows_value end,'more',jsonb_array_length(rows_value)>25,'fingerprint',fingerprint_value);
end;$$;
create function public.admin_analytics_cost_submit(target_tenant_id uuid,request_value uuid,category_value text,classification_value text,amount_value text,currency_value text,start_value date,end_value date,reference_value text,hash_value text default null) returns uuid language plpgsql security definer set search_path=pg_catalog as $$declare x private.analytics_cost_evidence%rowtype;begin
 perform private.analytics_require(target_tenant_id,true);
 if not private.analytics_sandbox(target_tenant_id) or not exists(select 1 from public.tenants where id=target_tenant_id and slug like 'phase15-sandbox-%') then raise exception 'economic evidence sandbox required' using errcode='42501';end if;
 if amount_value is null or amount_value!~'^(0|[1-9][0-9]{0,20})(\.[0-9]{1,8})?$' or request_value is null then raise exception 'economic amount invalid' using errcode='22023';end if;
 insert into private.analytics_cost_evidence(tenant_id,request_id,category,classification,amount,currency,period_start,period_end,evidence_reference,evidence_hash,created_by) values(target_tenant_id,request_value,category_value,classification_value,amount_value::numeric,currency_value,start_value,end_value,reference_value,hash_value,auth.uid()) on conflict(tenant_id,request_id) do nothing returning * into x;
 if x.id is null then
 select * into x from private.analytics_cost_evidence where tenant_id=target_tenant_id and request_id=request_value;
 if x.category is distinct from category_value or x.classification is distinct from classification_value or x.amount is distinct from amount_value::numeric or x.currency is distinct from currency_value or x.period_start is distinct from start_value or x.period_end is distinct from end_value or x.evidence_reference is distinct from reference_value or x.evidence_hash is distinct from hash_value then raise exception 'economic request conflict' using errcode='PT409';end if;return x.id;
 end if;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data) values(target_tenant_id,'HUMAN',auth.uid(),'analytics.cost_drafted','analytics_cost_evidence',x.id::text,jsonb_build_object('classification',x.classification,'financial_authority',false,'mode','SANDBOX'));
 return x.id;
end;$$;
create function public.admin_analytics_cost_review(target_tenant_id uuid,item_value uuid,expected_revision integer,approve_value boolean) returns integer language plpgsql security definer set search_path=pg_catalog as $$declare x private.analytics_cost_evidence%rowtype;begin
 perform private.analytics_require(target_tenant_id,true);
 if not private.analytics_sandbox(target_tenant_id) or not exists(select 1 from public.tenants where id=target_tenant_id and slug like 'phase15-sandbox-%') then raise exception 'economic evidence sandbox required' using errcode='42501';end if;
 select * into x from private.analytics_cost_evidence where tenant_id=target_tenant_id and id=item_value for update;
 if x.id is null then raise exception 'economic evidence denied' using errcode='42501';end if;
 if approve_value is null then raise exception 'economic review invalid' using errcode='22023';end if;
 if expected_revision is null or x.revision<>expected_revision or x.status<>'DRAFT' then raise exception 'economic review conflict' using errcode='PT409';end if;
 update private.analytics_cost_evidence set status=case when approve_value then 'REVIEWED' else 'REJECTED' end,revision=revision+1,reviewed_by=auth.uid() where id=x.id;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data) values(target_tenant_id,'HUMAN',auth.uid(),'analytics.cost_reviewed','analytics_cost_evidence',x.id::text,jsonb_build_object('reviewed',approve_value,'revision',x.revision+1,'provider_verified',false,'financial_authority',false));return x.revision+1;
end;$$;
-- Explicit grants: no PUBLIC definer API; private read helpers are not Data API endpoints.
revoke all on function private.analytics_hash(text),private.analytics_require(uuid,boolean),private.analytics_sandbox(uuid),private.analytics_validate(uuid,date,date,text),private.analytics_metric(text,numeric,text,bigint,bigint,text,text,boolean),private.analytics_periods(uuid,text),private.analytics_monthly(numeric,jsonb),private.analytics_fingerprint(uuid,date,date,text),private.analytics_funnel(uuid,date,date,text),private.analytics_metrics(uuid,date,date,text),private.analytics_money(uuid,date,date,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_analytics_workspace(uuid,date,date,text,uuid),public.admin_analytics_sources(uuid,date,date,text,text,text,uuid),public.admin_analytics_cost_submit(uuid,uuid,text,text,text,text,date,date,text,text),public.admin_analytics_cost_review(uuid,uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_analytics_workspace(uuid,date,date,text,uuid),public.admin_analytics_sources(uuid,date,date,text,text,text,uuid),public.admin_analytics_cost_submit(uuid,uuid,text,text,text,text,date,date,text,text),public.admin_analytics_cost_review(uuid,uuid,integer,boolean) to authenticated;
