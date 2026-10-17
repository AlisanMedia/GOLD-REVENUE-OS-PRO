-- Phase 14: outbound-disabled survey collection and manager-reviewed intelligence.
-- Anonymous records deliberately have no identity, invitation, permit or exact-time column.
create table private.survey_controls (
 tenant_id uuid primary key references public.tenants(id),enabled boolean not null default false,forms_enabled boolean not null default false,
 cadence_days integer check(cadence_days between 7 and 365),cadence_approval text check(length(cadence_approval) between 8 and 300),
 retention_days integer check(retention_days between 1 and 3650),retention_approval text check(length(retention_approval) between 8 and 300),
 legal_hold boolean not null default false,legal_hold_reference text,periodic_cursor uuid,last_cohort_review_at timestamptz,revision integer not null default 1,
 check(cadence_days is null or cadence_approval is not null),check(retention_days is null or retention_approval is not null),check(not legal_hold or length(legal_hold_reference)>=8)
);
create table public.survey_versions (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),survey_id uuid not null,version integer not null check(version>0),
 state text not null default 'DRAFT' check(state in ('DRAFT','APPROVED','PUBLISHED','ARCHIVED')),definition jsonb not null,
 revision integer not null default 1,owner_id uuid not null references public.app_users(id),approved_by uuid references public.app_users(id),
 created_at timestamptz not null default now(),approved_at timestamptz,published_at timestamptz,
 public_key uuid not null default gen_random_uuid(),unique(tenant_id,id),unique(tenant_id,survey_id,version),unique(public_key)
);
create index survey_versions_tenant on public.survey_versions(tenant_id,created_at desc,id);
create table private.survey_history (
 id bigint generated always as identity primary key,tenant_id uuid not null,version_id uuid,action text not null,actor_id uuid,details jsonb not null default '{}',created_at timestamptz not null default now(),
 foreign key(tenant_id,version_id) references public.survey_versions(tenant_id,id)
);
create trigger survey_history_immutable before update or delete on private.survey_history for each row execute function private.entitlement_immutable();
create table private.survey_consents (
 tenant_id uuid not null,customer_id uuid not null,consent text not null default 'UNKNOWN' check(consent in ('UNKNOWN','GRANTED','DENIED')),
 scope text not null default 'SURVEY_FEEDBACK' check(scope='SURVEY_FEEDBACK'),evidence_reference text not null check(length(evidence_reference) between 8 and 300),
 expires_at timestamptz not null,reviewed_by uuid not null,revision integer not null default 1,
 primary key(tenant_id,customer_id),foreign key(tenant_id,customer_id) references public.customers(tenant_id,id)
);
create table private.survey_invitations (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,version_id uuid not null,customer_id uuid not null,conversation_id uuid not null,
 trigger_kind text not null,source_fingerprint text not null,consent_revision integer not null,policy_revision integer not null,
 status text not null default 'DRAFTED' check(status in ('DRAFTED','TEST_ACCESS','COMPLETED','STOPPED','EXPIRED')),
 mode text not null default 'SIMULATED' check(mode='SIMULATED'),token_hash text unique,expires_at timestamptz not null,created_at timestamptz not null default now(),
 request_id uuid not null,unique(tenant_id,request_id),unique(tenant_id,id),foreign key(tenant_id,version_id) references public.survey_versions(tenant_id,id),
 foreign key(tenant_id,customer_id) references public.customers(tenant_id,id),foreign key(tenant_id,conversation_id) references public.conversations(tenant_id,id)
);
create unique index survey_invite_source on private.survey_invitations(tenant_id,customer_id,version_id,source_fingerprint);
create index survey_invite_customer on private.survey_invitations(tenant_id,customer_id,created_at desc);
create table private.survey_identified_responses (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,version_id uuid not null,invitation_id uuid not null unique,customer_id uuid not null,conversation_id uuid not null,
 channel text not null check(channel in ('WEB','TELEGRAM')),answers jsonb not null,completed_at timestamptz not null default now(),case_id uuid,
 foreign key(tenant_id,version_id) references public.survey_versions(tenant_id,id),foreign key(tenant_id,invitation_id) references private.survey_invitations(tenant_id,id),
 foreign key(tenant_id,customer_id) references public.customers(tenant_id,id),foreign key(tenant_id,conversation_id) references public.conversations(tenant_id,id),
 foreign key(tenant_id,case_id) references public.escalation_cases(tenant_id,id)
);
create index survey_identified_window on private.survey_identified_responses(tenant_id,version_id,completed_at);
create table private.survey_anonymous_responses (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,version_id uuid not null,collection_month date not null,
 answers jsonb not null,classification jsonb,
 foreign key(tenant_id,version_id) references public.survey_versions(tenant_id,id),check(extract(day from collection_month)=1)
);
create index survey_anon_cohort on private.survey_anonymous_responses(tenant_id,version_id,collection_month);
-- Admission is anonymous, shared-cohort access, NOT a personalized invitation. No response FK.
create table private.survey_spent_permits (version_id uuid not null references public.survey_versions(id),permit_hash text not null,expires_at timestamptz not null,primary key(version_id,permit_hash));
create table private.survey_budgets (version_id uuid not null references public.survey_versions(id),bucket timestamptz not null,kind text not null,uses integer not null,primary key(version_id,bucket,kind));
create table private.survey_telegram_sessions (
 id text primary key check(id~'^[a-f0-9]{16}$'),tenant_id uuid not null,invitation_id uuid not null unique,provider_user_id text not null,provider_chat_id text not null,
 revision integer not null default 1,question integer not null default 0,answers jsonb not null default '[]',selected jsonb not null default '[]',last_update bigint not null default -1,
 last_callback text,last_payload_hash text,last_revision integer,last_question integer,last_result jsonb,stopped boolean not null default false,foreign key(tenant_id,invitation_id) references private.survey_invitations(tenant_id,id)
);
create table public.survey_insights (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,version_id uuid not null,collection_month date not null,privacy text not null check(privacy in ('IDENTIFIED','ANONYMOUS')),
 topic text not null,status text not null default 'NEW' check(status in ('NEW','REVIEW','APPROVED','REJECTED','PLANNED','COMPLETED')),
 evidence jsonb not null,source_fingerprint text not null,revision integer not null default 1,assigned_to uuid,internal_note text check(length(internal_note)<=1000),
 unique(tenant_id,version_id,collection_month,privacy,topic),foreign key(tenant_id,version_id) references public.survey_versions(tenant_id,id),
 foreign key(tenant_id,assigned_to) references public.tenant_members(tenant_id,user_id)
);
create table private.survey_triage (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,version_id uuid not null,collection_month date not null,category text not null,severity text not null,
 status text not null default 'NEW' check(status in ('NEW','REVIEW','COMPLETED')),revision integer not null default 1,assigned_to uuid,note text check(length(note)<=1000),
 unique(tenant_id,version_id,collection_month,category),foreign key(tenant_id,version_id) references public.survey_versions(tenant_id,id),foreign key(tenant_id,assigned_to) references public.tenant_members(tenant_id,user_id)
);
create table private.survey_alert_drafts (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,source_key text not null,category text not null,severity text not null,
 status text not null default 'DRAFTED' check(status='DRAFTED'),chat_id text not null default '-5537216841' check(chat_id='-5537216841'),
 bot_id text not null default '8915334711' check(bot_id='8915334711'),send_enabled boolean not null default false check(not send_enabled),unique(tenant_id,source_key)
);

create function private.survey_enabled(t uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from private.survey_controls s join public.tenants t on t.id=s.tenant_id where s.tenant_id=$1 and s.enabled and t.status='active' and t.slug like 'phase14-sandbox-%' and not t.outbound_messaging_enabled);
$$;
create function private.survey_require(t uuid,manage boolean default false) returns void language plpgsql stable security definer set search_path=pg_catalog as $$begin
 if not private.has_tenant_role(t,case when manage then array['super_admin','manager']::public.app_role[] else array['super_admin','manager','support','analyst']::public.app_role[] end)
 or not exists(select 1 from public.tenants where id=t and status='active') then raise exception 'survey permission denied' using errcode='42501';end if;
end;$$;
create function private.survey_log(t uuid,v uuid,a text,d jsonb default '{}') returns void language plpgsql set search_path=pg_catalog as $$begin
 insert into private.survey_history(tenant_id,version_id,action,actor_id,details) values(t,v,a,auth.uid(),d);
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)
 values(t,case when auth.uid() is null then 'SYSTEM'::public.audit_actor_type else 'HUMAN'::public.audit_actor_type end,auth.uid(),'survey.'||a,'survey_versions',v::text,d);
end;$$;
create function public.configure_phase14_sandbox(target_tenant_id uuid,enabled_value boolean,forms_value boolean default false) returns void language plpgsql security definer set search_path=pg_catalog as $$begin
 if not exists(select 1 from public.tenants where id=target_tenant_id and status='active' and slug like 'phase14-sandbox-%' and not outbound_messaging_enabled) then raise exception 'isolated survey sandbox required' using errcode='42501';end if;
 insert into private.survey_controls(tenant_id,enabled,forms_enabled) values(target_tenant_id,enabled_value,enabled_value and forms_value)
 on conflict(tenant_id) do update set enabled=excluded.enabled,forms_enabled=excluded.forms_enabled,revision=survey_controls.revision+1;
 if not enabled_value then update public.scheduled_jobs set status='cancelled',locked_at=null,locked_by=null where tenant_id=target_tenant_id and job_type like 'survey.%' and status in ('scheduled','processing');end if;
 perform private.survey_log(target_tenant_id,null,'sandbox_configured',jsonb_build_object('enabled',enabled_value,'forms',enabled_value and forms_value,'outbound',false));
end;$$;
-- Explicit validation mirrors the typed domain contract; SQL remains authoritative.
create function private.survey_definition_valid(d jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog as $$declare q jsonb;c jsonb;ids text[]:='{}';choices text[];begin
 if d is null or jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'title')<>'string' or exists(select 1 from jsonb_each(d) where value='null'::jsonb) or (select count(*) from jsonb_object_keys(d))<>6 or not d ?& array['title','language','audience','trigger','privacy','questions'] then return false;end if;
 if length(btrim(d->>'title')) not between 3 and 120 or d->>'language' not in ('en','tr','ar','ru') or d->>'audience' not in ('PROSPECT','TRIAL','VIP','ALL') or d->>'trigger' not in ('REQUESTED','VIP_JOIN','CANCELLATION','DEPARTURE','PERIODIC') or d->>'privacy' not in ('IDENTIFIED','ANONYMOUS','BOTH') or jsonb_typeof(d->'questions')<>'array' or jsonb_array_length(d->'questions') not between 4 and 5 then return false;end if;
 for q in select value from jsonb_array_elements(d->'questions') loop
  if jsonb_typeof(q)<>'object' or jsonb_typeof(q->'label')<>'string' or exists(select 1 from jsonb_each(q) where value='null'::jsonb) or (select count(*) from jsonb_object_keys(q))<>5 or not q ?& array['id','type','topic','label','choices'] or q->>'id' !~ '^[a-z][a-z0-9_]{0,19}$' or q->>'id'=any(ids) or q->>'type' not in ('RATING','SINGLE','MULTIPLE','TEXT') or q->>'topic' not in ('SIGNAL','VALUE','SUPPORT','RENEWAL','CANCELLATION','TRUST','FEATURE','IMPROVEMENT') or length(btrim(q->>'label')) not between 1 and 240 or jsonb_typeof(q->'choices')<>'array' then return false;end if;
  if lower(q::text) ~ 'guaranteed (profit|return|income)|risk.free (trading|return)|audited (returns|performance)' then return false;end if;
  ids:=array_append(ids,q->>'id');choices:='{}';
  if (q->>'type' in ('RATING','TEXT') and jsonb_array_length(q->'choices')<>0) or (q->>'type' in ('SINGLE','MULTIPLE') and jsonb_array_length(q->'choices') not between 2 and 8) then return false;end if;
  for c in select value from jsonb_array_elements(q->'choices') loop
   if jsonb_typeof(c)<>'object' or jsonb_typeof(c->'label')<>'string' or exists(select 1 from jsonb_each(c) where value='null'::jsonb) or (select count(*) from jsonb_object_keys(c))<>2 or not c ?& array['id','label'] or c->>'id' !~ '^[a-z][a-z0-9_]{0,19}$' or c->>'id'=any(choices) or c->>'id' in ('skip','stop','next','select','text') or c->>'id' like 'sel_%' or length(btrim(c->>'label')) not between 1 and 240 then return false;end if;choices:=array_append(choices,c->>'id');
  end loop;
 end loop;return true;exception when others then return false;end;$$;
alter table public.survey_versions add constraint survey_definition_valid check(private.survey_definition_valid(definition));
create function private.survey_version_guard() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_op='DELETE' or (old.state<>'DRAFT' and (new.definition is distinct from old.definition or new.owner_id<>old.owner_id or new.survey_id<>old.survey_id or new.version<>old.version or new.tenant_id<>old.tenant_id or new.public_key<>old.public_key)) then raise exception 'approved survey is immutable' using errcode='23514';end if;return new;
end;$$;
create trigger survey_version_immutable before update or delete on public.survey_versions for each row execute function private.survey_version_guard();
create function public.admin_survey_save(target_tenant_id uuid,definition_value jsonb,version_value uuid default null,expected_revision integer default 0) returns uuid language plpgsql security definer set search_path=pg_catalog as $$declare v public.survey_versions%rowtype;begin
 perform private.survey_require(target_tenant_id,true);
 if not private.survey_enabled(target_tenant_id) then raise exception 'survey sandbox disabled' using errcode='42501';end if;
 if not private.survey_definition_valid(definition_value) then raise exception 'four or five valid questions required' using errcode='22023';end if;
 if version_value is null then
 insert into public.survey_versions(tenant_id,survey_id,version,definition,owner_id) values(target_tenant_id,gen_random_uuid(),1,definition_value,auth.uid()) returning * into v;
 else
 select * into v from public.survey_versions where tenant_id=target_tenant_id and id=version_value for update;
 if v.id is null or v.revision<>expected_revision then raise exception 'survey changed' using errcode='PT409';end if;
 if v.state='DRAFT' then update public.survey_versions set definition=definition_value,revision=revision+1 where id=v.id returning * into v;
 else
 perform pg_advisory_xact_lock(hashtextextended(v.survey_id::text,14));
 insert into public.survey_versions(tenant_id,survey_id,version,definition,owner_id) values(target_tenant_id,v.survey_id,(select max(version)+1 from public.survey_versions where tenant_id=target_tenant_id and survey_id=v.survey_id),definition_value,auth.uid()) returning * into v;
 end if;end if;
 perform private.survey_log(target_tenant_id,v.id,'draft_saved',jsonb_build_object('revision',v.revision));return v.id;
end;$$;
create function public.admin_survey_state(target_tenant_id uuid,version_value uuid,expected_revision integer,action_value text) returns integer language plpgsql security definer set search_path=pg_catalog as $$declare v public.survey_versions%rowtype;ns text;begin
 perform private.survey_require(target_tenant_id,true);
 if not private.survey_enabled(target_tenant_id) then raise exception 'survey sandbox disabled' using errcode='42501';end if;
 select * into v from public.survey_versions where tenant_id=target_tenant_id and id=version_value for update;
 if v.id is null or v.revision<>expected_revision then raise exception 'survey changed' using errcode='PT409';end if;
 ns:=case when action_value='approve' and v.state='DRAFT' then 'APPROVED' when action_value='publish' and v.state='APPROVED' then 'PUBLISHED' when action_value='archive' and v.state in ('DRAFT','APPROVED','PUBLISHED') then 'ARCHIVED' end;
 if ns is null then raise exception 'invalid survey transition' using errcode='22023';end if;
 update public.survey_versions set state=ns,revision=revision+1,approved_by=case when ns='APPROVED' then auth.uid() else approved_by end,approved_at=case when ns='APPROVED' then now() else approved_at end,published_at=case when ns='PUBLISHED' then now() else published_at end where id=v.id;
 perform private.survey_log(target_tenant_id,v.id,lower(ns),jsonb_build_object('revision',v.revision+1,'send_enabled',false));return v.revision+1;
end;$$;
create function public.admin_survey_policy(target_tenant_id uuid,settings_value jsonb,expected_revision integer default 0) returns void language plpgsql security definer set search_path=pg_catalog as $$begin
 perform private.survey_require(target_tenant_id,true);
 if not private.survey_enabled(target_tenant_id) then raise exception 'survey sandbox disabled' using errcode='42501';end if;
 perform 1 from private.survey_controls where tenant_id=target_tenant_id and revision=expected_revision for update;
 if not found then raise exception 'survey policy changed' using errcode='PT409';end if;
 if settings_value is null or jsonb_typeof(settings_value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(settings_value) k where k not in ('cadence_days','cadence_approval','retention_days','retention_approval','legal_hold','legal_hold_reference')) then raise exception 'invalid settings' using errcode='22023';end if;
 update private.survey_controls set revision=revision+1,cadence_days=(settings_value->>'cadence_days')::integer,cadence_approval=nullif(settings_value->>'cadence_approval',''),retention_days=(settings_value->>'retention_days')::integer,retention_approval=nullif(settings_value->>'retention_approval',''),legal_hold=coalesce((settings_value->>'legal_hold')::boolean,false),legal_hold_reference=settings_value->>'legal_hold_reference' where tenant_id=target_tenant_id;
 perform private.survey_log(target_tenant_id,null,'policy_reviewed',jsonb_build_object('sandbox_only',true,'revision',expected_revision+1,'settings',settings_value));
end;$$;
create function public.admin_survey_consent(target_tenant_id uuid,customer_value uuid,expected_revision integer,consent_value text,evidence_value text,expires_value timestamptz) returns integer language plpgsql security definer set search_path=pg_catalog as $$declare r integer;begin
 perform private.survey_require(target_tenant_id,true);
 if not private.survey_enabled(target_tenant_id) then raise exception 'survey sandbox disabled' using errcode='42501';end if;
 perform 1 from public.customers where tenant_id=target_tenant_id and id=customer_value for update;if not found then raise exception 'customer unavailable' using errcode='42501';end if;
 select revision into r from private.survey_consents where tenant_id=target_tenant_id and customer_id=customer_value for update;
 if coalesce(r,0)<>expected_revision then raise exception 'consent changed' using errcode='PT409';end if;
 if expires_value<=now() or expires_value>now()+interval '1 year' then raise exception 'invalid consent expiry' using errcode='22023';end if;
 insert into private.survey_consents(tenant_id,customer_id,consent,evidence_reference,expires_at,reviewed_by) values(target_tenant_id,customer_value,consent_value,evidence_value,expires_value,auth.uid())
 on conflict(tenant_id,customer_id) do update set consent=excluded.consent,evidence_reference=excluded.evidence_reference,expires_at=excluded.expires_at,reviewed_by=excluded.reviewed_by,revision=survey_consents.revision+1 returning revision into r;
 perform private.survey_log(target_tenant_id,null,'consent_reviewed',jsonb_build_object('customer_id',customer_value,'revision',r,'scope','SURVEY_FEEDBACK'));return r;
end;$$;

-- No consent or contact record alone grants eligibility. This is a preview decision, never a sender.
create function private.survey_eligibility(t uuid,v_id uuid,c_id uuid,conversation_value uuid,requested boolean default false,exclude_invitation uuid default null) returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare v public.survey_versions%rowtype;p public.customer_success_contact_policies%rowtype;g private.survey_consents%rowtype;c public.conversations%rowtype;m public.messaging_contacts%rowtype;s public.subscriptions%rowtype;a public.channel_access%rowtype;b jsonb:='[]';h integer;fp text;st text;begin
 select * into v from public.survey_versions where tenant_id=t and id=v_id;
 select * into c from public.conversations where tenant_id=t and id=conversation_value and customer_id=c_id;
 select * into m from public.messaging_contacts where tenant_id=t and id=c.messaging_contact_id and customer_id=c_id;
 select * into p from public.customer_success_contact_policies where tenant_id=t and customer_id=c_id;
 select * into g from private.survey_consents where tenant_id=t and customer_id=c_id;
 select * into s from public.subscriptions where tenant_id=t and customer_id=c_id order by created_at desc,id desc limit 1;
 select * into a from public.channel_access where tenant_id=t and subscription_id=s.id;
 select state::text into st from public.customers where tenant_id=t and id=c_id;
 if not private.survey_enabled(t) then b:=b||'"SANDBOX_DISABLED"'::jsonb;end if;
 if v.id is null or v.state<>'PUBLISHED' then b:=b||'"SURVEY_UNAVAILABLE"'::jsonb;end if;
 if g.customer_id is null or g.consent<>'GRANTED' or g.expires_at<=now() then b:=b||'"SURVEY_CONSENT_REQUIRED"'::jsonb;end if;
 if p.customer_id is null or p.consent<>'GRANTED' or p.opted_out then b:=b||'"CONSENT_OR_OPT_OUT"'::jsonb;end if;
 if c.id is null or c.status<>'open' or m.id is null or m.contactability not in ('allowed','user_initiated') or m.review_required or m.identity_resolution not in ('exact_match','manual') or m.blocked_at is not null then b:=b||'"CONTACT_NOT_VERIFIED"'::jsonb;end if;
 if c.human_takeover or c.runtime_mode='HUMAN_TAKEOVER' or exists(select 1 from public.escalation_cases where tenant_id=t and customer_id=c_id and status<>'RESOLVED') then b:=b||'"HUMAN_REVIEW_ACTIVE"'::jsonb;end if;
 if p.timezone is null or not exists(select 1 from pg_timezone_names where name=p.timezone) then b:=b||'"TIMEZONE_UNKNOWN"'::jsonb;
 else h:=extract(hour from now() at time zone p.timezone);if h<p.window_start or h>=p.window_end then b:=b||'"OUTSIDE_CONTACT_WINDOW"'::jsonb;end if;end if;
 if v.definition->>'language' is distinct from coalesce(p.preferred_language,'en') then b:=b||'"CUSTOMER_LANGUAGE_REVIEW"'::jsonb;end if;
 if v.definition->>'audience'='VIP' and (s.id is null or not private.success_verified_subscription(t,s.id)) then b:=b||'"VERIFIED_SUBSCRIPTION_REQUIRED"'::jsonb;end if;
 if v.definition->>'audience'='PROSPECT' and (s.id is not null or st not in ('NEW','CONTACT_READY','CONTACTED','REPLIED','QUALIFIED','INTERESTED','NOT_INTERESTED','SURVEY_OFFERED','SURVEY_COMPLETED','OFFER_SENT')) then b:=b||'"AUDIENCE_MISMATCH"'::jsonb;end if;
 if v.definition->>'audience'='TRIAL' and st<>'TRIAL_ACTIVE' then b:=b||'"AUDIENCE_MISMATCH"'::jsonb;end if;
 if v.definition->>'trigger'='REQUESTED' and (requested is distinct from true) then b:=b||'"EXPLICIT_REQUEST_REQUIRED"'::jsonb;end if;
 if v.definition->>'trigger'='VIP_JOIN' and (a.id is null or a.status<>'MEMBER' or a.membership_checked_at is null or a.membership_checked_at>now() or a.membership_checked_at<now()-interval '7 days' or s.state not in ('ACTIVE','RENEWAL_DUE') or s.ends_at<=now() or not private.success_verified_subscription(t,s.id)) then b:=b||'"VERIFIED_JOIN_REQUIRED"'::jsonb;end if;
 if v.definition->>'trigger'='CANCELLATION' and (s.id is null or s.state<>'CANCELLED' or not private.success_verified_subscription(t,s.id)) then b:=b||'"VERIFIED_CANCELLATION_REQUIRED"'::jsonb;end if;
 if v.definition->>'trigger'='DEPARTURE' and (a.id is null or a.status<>'REVOKED' or a.membership_checked_at is null or a.membership_checked_at>now() or not private.success_verified_subscription(t,s.id)) then b:=b||'"VERIFIED_DEPARTURE_REQUIRED"'::jsonb;end if;
 if v.definition->>'trigger'='PERIODIC' and not exists(select 1 from private.survey_controls where tenant_id=t and cadence_days is not null and cadence_approval is not null) then b:=b||'"PERIODIC_DISABLED"'::jsonb;end if;
 if exists(select 1 from private.survey_invitations where tenant_id=t and customer_id=c_id and id is distinct from exclude_invitation and created_at>now()-interval '1 day') or (select count(*) from private.survey_invitations where tenant_id=t and customer_id=c_id and id is distinct from exclude_invitation and created_at>now()-interval '30 days')>=3 then b:=b||'"FREQUENCY_CAP"'::jsonb;end if;
 if v.definition->>'trigger'='PERIODIC' and exists(select 1 from private.survey_invitations i join public.survey_versions prior on prior.id=i.version_id join private.survey_controls ctrl on ctrl.tenant_id=t where i.tenant_id=t and i.customer_id=c_id and i.id is distinct from exclude_invitation and prior.survey_id=v.survey_id and i.created_at>now()-make_interval(days=>ctrl.cadence_days)) then b:=b||'"PERIODIC_NOT_DUE"'::jsonb;end if;
 fp:=md5(jsonb_build_object('customer',c_id,'state',st,'conversation',c.id,'contact',m.updated_at,'conversation_updated',c.updated_at,'return',c.escalation_return_boundary,'subscription',s.id,'revision',s.revision,'state_sub',s.state,'access',a.id,'membership',a.status,'checked',a.membership_checked_at,'policy',p.revision,'grant',g.revision,'version',v.revision)::text);
 return jsonb_build_object('review_ready',jsonb_array_length(b)=0,'invitation_eligible',false,'send_enabled',false,'blockers',b,'delivery_blockers',jsonb_build_array('OUTBOUND_DISABLED','PREVIEW_ONLY'),'mode','SIMULATED','language',coalesce(p.preferred_language,'en'),'source_fingerprint',fp,'consent_revision',coalesce(g.revision,0),'policy_revision',coalesce(p.revision,0));
end;$$;
create function public.admin_survey_eligibility(target_tenant_id uuid,version_value uuid,customer_value uuid,conversation_value uuid,requested_value boolean default false) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$begin
 perform private.survey_require(target_tenant_id,true);return private.survey_eligibility(target_tenant_id,version_value,customer_value,conversation_value,requested_value);end;$$;
create function public.admin_survey_invitation(target_tenant_id uuid,version_value uuid,customer_value uuid,conversation_value uuid,request_id_value uuid,requested_value boolean default false) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare e jsonb;i private.survey_invitations%rowtype;token text;begin
 perform private.survey_require(target_tenant_id,true);
 perform 1 from public.customers where tenant_id=target_tenant_id and id=customer_value for update;if not found then raise exception 'customer unavailable' using errcode='42501';end if;
 select * into i from private.survey_invitations where tenant_id=target_tenant_id and request_id=request_id_value;
 if i.id is not null then return jsonb_build_object('id',i.id,'status',i.status,'replayed',true,'send_enabled',false);end if;
 perform private.survey_lock_sources(target_tenant_id,customer_value,conversation_value);
 e:=private.survey_eligibility(target_tenant_id,version_value,customer_value,conversation_value,requested_value);
 if not (e->>'review_ready')::boolean then return e;end if;
 if (select definition->>'privacy' from public.survey_versions where id=version_value)='ANONYMOUS' then raise exception 'use shared anonymous entry' using errcode='22023';end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into private.survey_invitations(tenant_id,version_id,customer_id,conversation_id,trigger_kind,source_fingerprint,consent_revision,policy_revision,token_hash,expires_at,request_id,status)
 values(target_tenant_id,version_value,customer_value,conversation_value,(select definition->>'trigger' from public.survey_versions where id=version_value),e->>'source_fingerprint',(e->>'consent_revision')::integer,(e->>'policy_revision')::integer,encode(extensions.digest(token,'sha256'),'hex'),now()+interval '30 minutes',request_id_value,'TEST_ACCESS') returning * into i;
 perform private.survey_log(target_tenant_id,version_value,'test_access_created',jsonb_build_object('invitation_id',i.id,'send_enabled',false));
 return jsonb_build_object('id',i.id,'status',i.status,'token',token,'expires_at',i.expires_at,'send_enabled',false,'provider_delivered',false,'mode','SIMULATED');
end;$$;

create function private.survey_budget(v uuid,k text) returns void language plpgsql set search_path=pg_catalog as $$declare n integer;b timestamptz:=to_timestamp(floor(extract(epoch from now())/300)*300);begin
 insert into private.survey_budgets values(v,b,k,1) on conflict(version_id,bucket,kind) do update set uses=survey_budgets.uses+1 returning uses into n;
 if n>60 then raise exception 'survey rate limit' using errcode='PT429';end if;
 delete from private.survey_budgets where version_id=v and bucket<now()-interval '1 day';
end;$$;
create function private.survey_form(v public.survey_versions) returns jsonb language plpgsql set search_path=pg_catalog as $$begin
 perform 1 from public.survey_versions where id=v.id and tenant_id=v.tenant_id and state='PUBLISHED' for share;
 if not found then raise exception 'survey unavailable' using errcode='PT404';end if;
 perform 1 from public.tenants where id=v.tenant_id and status='active' and not outbound_messaging_enabled and slug like 'phase14-sandbox-%' for share;
 if not found then raise exception 'survey unavailable' using errcode='PT404';end if;
 perform 1 from private.survey_controls where tenant_id=v.tenant_id and enabled and forms_enabled for share;
 if not found then raise exception 'survey unavailable' using errcode='PT404';end if;
 if v.id is null or v.state<>'PUBLISHED' or not private.survey_enabled(v.tenant_id) or not exists(select 1 from private.survey_controls where tenant_id=v.tenant_id and forms_enabled) then raise exception 'survey unavailable' using errcode='PT404';end if;
 return jsonb_build_object('definition',v.definition,'anonymous_key',case when v.definition->>'privacy' in ('ANONYMOUS','BOTH') then v.public_key end,'environment','SYNTHETIC TEST','send_enabled',false);
end;$$;
create function public.survey_web_open(token_value text default null,anonymous_key_value uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare v public.survey_versions%rowtype;i private.survey_invitations%rowtype;r jsonb;begin
 if (token_value is null)=(anonymous_key_value is null) then raise exception 'invalid access' using errcode='22023';end if;
 if token_value is not null then
 if token_value !~ '^[a-f0-9]{64}$' then raise exception 'survey unavailable' using errcode='PT404';end if;
 select * into i from private.survey_invitations where token_hash=encode(extensions.digest(token_value,'sha256'),'hex');
 if i.id is null or i.expires_at<=now() or i.status not in ('TEST_ACCESS','COMPLETED') then raise exception 'survey unavailable' using errcode='PT404';end if;
 select * into v from public.survey_versions where id=i.version_id;
 r:=private.survey_form(v);perform private.survey_budget(v.id,'open');return r||jsonb_build_object('completed',i.status='COMPLETED','privacy','IDENTIFIED');
 else
 select * into v from public.survey_versions where public_key=anonymous_key_value and definition->>'privacy' in ('ANONYMOUS','BOTH');
 r:=private.survey_form(v);perform private.survey_budget(v.id,'open');return r||jsonb_build_object('privacy','ANONYMOUS');end if;
end;$$;
create function private.survey_answers_valid(d jsonb,a jsonb,anonymous_value boolean) returns boolean language plpgsql immutable set search_path=pg_catalog as $$declare q jsonb;x jsonb;v jsonb;begin
 if jsonb_typeof(a)<>'array' or jsonb_array_length(a)<>jsonb_array_length(d->'questions') or (select count(distinct value->>'question') from jsonb_array_elements(a))<>jsonb_array_length(a) then return false;end if;
 for q in select value from jsonb_array_elements(d->'questions') loop
 select value into x from jsonb_array_elements(a) where value->>'question'=q->>'id';
 if x is null or jsonb_typeof(x)<>'object' or (select count(*) from jsonb_object_keys(x))<>3 or not x ?& array['question','skipped','value'] or jsonb_typeof(x->'skipped')<>'boolean' then return false;end if;
 if (x->>'skipped')::boolean then if x->'value'<>'null'::jsonb then return false;end if;continue;end if;
 v:=x->'value';
 if q->>'type'='RATING' and (jsonb_typeof(v)<>'number' or v::text !~ '^[1-5]$') then return false;end if;
 if q->>'type'='TEXT' then
 if jsonb_typeof(v)<>'string' or length(btrim(x->>'value')) not between 1 and 500 then return false;end if;
 if anonymous_value and (x->>'value' ~* '[[:alnum:].+_-]+@[[:alnum:]._-]+\.[a-z]{2,}|https?://|www\.|@[a-z0-9_]{3,}|\+?[0-9][0-9 ()-]{7,}[0-9]') then return false;end if;end if;
 if q->>'type'='SINGLE' and (jsonb_typeof(v)<>'string' or not exists(select 1 from jsonb_array_elements(q->'choices') c where c->>'id'=x->>'value')) then return false;end if;
 if q->>'type'='MULTIPLE' then
 if jsonb_typeof(v)<>'array' or jsonb_array_length(v) not between 1 and 8 or (select count(distinct value) from jsonb_array_elements(v))<>jsonb_array_length(v) then return false;end if;
 if exists(select 1 from jsonb_array_elements_text(v) item where not exists(select 1 from jsonb_array_elements(q->'choices') c where c->>'id'=item)) then return false;end if;end if;
 end loop;return true;exception when others then return false;end;$$;
create function private.survey_classify(d jsonb,a jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$declare body text;begin
 select string_agg(x->>'value',' ') into body from jsonb_array_elements(a) x join jsonb_array_elements(d->'questions') q on q->>'id'=x->>'question' where q->>'type'='TEXT' and not (x->>'skipped')::boolean;
 return public.classify_escalation(left(body,2500));end;$$;

-- A new trusted feedback source enters the accepted case authority. It never activates its sender.
alter table public.escalation_evidence drop constraint escalation_evidence_source_kind_check;
alter table public.escalation_evidence add constraint escalation_evidence_source_kind_check check(source_kind in ('inbound','quality','survey'));
create function private.survey_escalate(r_id uuid) returns uuid language plpgsql set search_path=pg_catalog as $$declare r private.survey_identified_responses%rowtype;cl jsonb;c public.conversations%rowtype;m public.messages%rowtype;e public.escalation_cases%rowtype;ev uuid;begin
 select * into r from private.survey_identified_responses where id=r_id;
 cl:=private.survey_classify((select definition from public.survey_versions where id=r.version_id),r.answers);
 if cl is null or private.escalation_rank(cl->>'severity')<3 then return null;end if;
 select * into c from public.conversations where tenant_id=r.tenant_id and id=r.conversation_id and customer_id=r.customer_id for update;
 select * into m from public.messages where tenant_id=r.tenant_id and conversation_id=c.id and direction='inbound' order by created_at desc,id desc limit 1;
 -- Do not fabricate a conversation source or revive an already resolved/stale complaint.
 if m.id is null or m.created_at<now()-interval '1 day' or m.created_at<coalesce(c.escalation_return_boundary,'-infinity') then return null;end if;
 select * into e from public.escalation_cases where tenant_id=r.tenant_id and conversation_id=c.id and status<>'RESOLVED' for update;
 if e.id is null then
 insert into public.escalation_cases(tenant_id,conversation_id,customer_id,category,severity,source_message_id,locale) values(r.tenant_id,c.id,r.customer_id,cl->>'category',cl->>'severity',m.id,(select definition->>'language' from public.survey_versions where id=r.version_id)) returning * into e;
 perform private.escalation_audit(e.id,'created',jsonb_build_object('source','survey','survey_version',r.version_id));
 ev:=private.append_domain_event(r.tenant_id,r.customer_id,'escalation.created',1,jsonb_build_object('escalation_id',e.id,'category',e.category,'severity',e.severity),'SYSTEM',null,'escalation_engine','TRUSTED',gen_random_uuid(),null,'escalation:'||e.id::text,now());
 elsif private.escalation_rank(cl->>'severity')>private.escalation_rank(e.severity) then update public.escalation_cases set severity=cl->>'severity',category=cl->>'category',revision=revision+1 where id=e.id returning * into e;end if;
 insert into public.escalation_evidence(tenant_id,case_id,message_id,category,source_kind,source_id) values(r.tenant_id,e.id,m.id,cl->>'category','survey',r.id) on conflict do nothing;
 perform private.escalation_audit(e.id,'survey_evidence_added',jsonb_build_object('response_id',r.id,'survey_version',r.version_id));
 update public.conversations set attention_required=true,runtime_mode='HUMAN_TAKEOVER',human_takeover=true,automatic_replies_enabled=false,automatic_replies_enabled_at=null where id=c.id;
 update public.messages set status='failed',failure_code='ESCALATION_HOLD' where id in(select id from public.messages where tenant_id=r.tenant_id and conversation_id=c.id and direction='outbound' and actor_id='quality-approved-reply' and status in ('pending','retry_scheduled') for update skip locked);
 update private.survey_identified_responses set case_id=e.id where id=r.id;
 insert into private.survey_alert_drafts(tenant_id,source_key,category,severity) values(r.tenant_id,'case:'||e.id,cl->>'category',cl->>'severity') on conflict(tenant_id,source_key) do nothing;
 return e.id;
end;$$;
create function private.survey_enqueue(t uuid,v uuid,month_value date) returns void language plpgsql set search_path=pg_catalog as $$begin
 insert into public.scheduled_jobs(tenant_id,job_type,payload,idempotency_key,correlation_id,scheduled_at,max_attempts)
 values(t,'survey.intelligence',jsonb_build_object('version',v,'month',month_value),'survey.intelligence:'||v||':'||month_value,gen_random_uuid(),now(),3)
 on conflict(tenant_id,idempotency_key) do update set status='scheduled',scheduled_at=now(),completed_at=null,attempts=0 where scheduled_jobs.status in ('completed','cancelled');
end;$$;
create function private.survey_complete_invitation(invitation_value uuid,answers_value jsonb,channel_value text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare i private.survey_invitations%rowtype;v public.survey_versions%rowtype;r private.survey_identified_responses%rowtype;e jsonb;cid uuid;begin
 select * into i from private.survey_invitations where id=invitation_value for update;
 select * into v from public.survey_versions where id=i.version_id;perform private.survey_form(v);
 if i.id is null or i.expires_at<=now() then raise exception 'survey unavailable' using errcode='PT404';end if;
 select * into r from private.survey_identified_responses where invitation_id=i.id;
 if r.id is not null then if r.answers=answers_value and r.channel=channel_value then return jsonb_build_object('accepted',true,'duplicate',true);else raise exception 'survey already completed' using errcode='PT409';end if;end if;
 if i.status<>'TEST_ACCESS' then raise exception 'survey unavailable' using errcode='PT404';end if;
 perform private.survey_lock_sources(i.tenant_id,i.customer_id,i.conversation_id);
 e:=private.survey_eligibility(i.tenant_id,i.version_id,i.customer_id,i.conversation_id,true,i.id);
 if not (e->>'review_ready')::boolean or i.source_fingerprint is distinct from e->>'source_fingerprint' then raise exception 'survey eligibility changed' using errcode='PT409';end if;
 if not private.survey_answers_valid(v.definition,answers_value,false) or channel_value not in ('WEB','TELEGRAM') then raise exception 'invalid survey answers' using errcode='22023';end if;
 perform private.survey_budget(v.id,'submit');
 insert into private.survey_identified_responses(tenant_id,version_id,invitation_id,customer_id,conversation_id,channel,answers) values(i.tenant_id,i.version_id,i.id,i.customer_id,i.conversation_id,channel_value,answers_value) returning * into r;
 update private.survey_invitations set status='COMPLETED' where id=i.id;
 cid:=private.survey_escalate(r.id);
 perform private.survey_log(i.tenant_id,i.version_id,'identified_completed',jsonb_build_object('response_id',r.id,'channel',channel_value,'case_id',cid,'message_sent',false));
 perform private.survey_enqueue(i.tenant_id,i.version_id,date_trunc('month',now() at time zone 'UTC')::date);
 return jsonb_build_object('accepted',true,'duplicate',false);
end;$$;
create function public.survey_stop(token_value text) returns boolean language plpgsql security definer set search_path=pg_catalog as $$declare i private.survey_invitations%rowtype;begin
 select * into i from private.survey_invitations where token_hash=encode(extensions.digest(token_value,'sha256'),'hex') for update;
 if i.id is null or not private.survey_enabled(i.tenant_id) or i.status='COMPLETED' then return false;end if;
 if i.status='TEST_ACCESS' then update private.survey_invitations set status='STOPPED' where id=i.id;perform private.survey_log(i.tenant_id,i.version_id,'stopped',jsonb_build_object('invitation_id',i.id));end if;return true;
end;$$;
-- Permits are verified by the server adapter; nonce hashes are unlinked and not retained with answers.
create function public.survey_complete_anonymous(anonymous_key_value uuid,permit_hash_value text,expires_value timestamptz,answers_value jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare v public.survey_versions%rowtype;cl jsonb;month_value date:=date_trunc('month',now() at time zone 'UTC')::date;begin
 select * into v from public.survey_versions where public_key=anonymous_key_value and definition->>'privacy' in ('ANONYMOUS','BOTH');perform private.survey_form(v);
 if expires_value<=now() or expires_value>now()+interval '31 minutes' or permit_hash_value !~ '^[a-f0-9]{64}$' then raise exception 'invalid anonymous permit' using errcode='22023';end if;
 if not private.survey_answers_valid(v.definition,answers_value,true) then raise exception 'invalid or identifying answers' using errcode='22023';end if;
 insert into private.survey_spent_permits values(v.id,permit_hash_value,expires_value) on conflict do nothing;
 if not found then return jsonb_build_object('accepted',true,'duplicate',true);end if;
 perform private.survey_budget(v.id,'submit');
 cl:=private.survey_classify(v.definition,answers_value);
 insert into private.survey_anonymous_responses(tenant_id,version_id,collection_month,answers,classification) values(v.tenant_id,v.id,month_value,answers_value,cl);
 -- No response ID, source quote, contact mapping, exact timestamp or per-submission audit/outbox.
 -- Anonymous jobs are scheduled independently of individual submissions.
 return jsonb_build_object('accepted',true,'duplicate',false);
end;$$;
create function private.survey_lock_sources(t uuid,c uuid,conv uuid) returns void language plpgsql set search_path=pg_catalog as $$begin
 perform 1 from public.customers where tenant_id=t and id=c for update;
 perform 1 from public.conversations where tenant_id=t and id=conv for update;
 perform 1 from public.messaging_contacts where tenant_id=t and customer_id=c order by id for update;
 perform 1 from public.customer_success_contact_policies where tenant_id=t and customer_id=c for update;
 perform 1 from private.survey_consents where tenant_id=t and customer_id=c for update;
 perform 1 from public.subscriptions where tenant_id=t and customer_id=c order by id for update;
 perform 1 from public.channel_access where tenant_id=t and subscription_id in(select id from public.subscriptions where tenant_id=t and customer_id=c) order by id for update;
end;$$;
create function public.survey_complete_identified(token_value text,answers_value jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare i uuid;begin
 if token_value !~ '^[a-f0-9]{64}$' then raise exception 'survey unavailable' using errcode='PT404';end if;
 select id into i from private.survey_invitations where token_hash=encode(extensions.digest(token_value,'sha256'),'hex');
 return private.survey_complete_invitation(i,answers_value,'WEB');end;$$;
create function public.admin_survey_telegram_start(target_tenant_id uuid,invitation_value uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare i private.survey_invitations%rowtype;m public.messaging_contacts%rowtype;s private.survey_telegram_sessions%rowtype;begin
 perform private.survey_require(target_tenant_id,true);
 select * into i from private.survey_invitations where tenant_id=target_tenant_id and id=invitation_value and status='TEST_ACCESS';
 if i.id is null or i.expires_at<=now() or not private.survey_enabled(target_tenant_id) then raise exception 'survey unavailable' using errcode='PT404';end if;
 select mc.* into m from public.messaging_contacts mc join public.conversations c on c.tenant_id=mc.tenant_id and c.messaging_contact_id=mc.id where c.id=i.conversation_id and c.tenant_id=target_tenant_id;
 insert into private.survey_telegram_sessions(id,tenant_id,invitation_id,provider_user_id,provider_chat_id) values(encode(extensions.gen_random_bytes(8),'hex'),target_tenant_id,i.id,m.provider_user_id,m.provider_chat_id) on conflict(invitation_id) do nothing;
 select * into s from private.survey_telegram_sessions where invitation_id=i.id;
 return jsonb_build_object('session',s.id,'revision',s.revision,'question',s.question,'send_enabled',false,'transport','PREVIEW');
end;$$;
create function public.survey_telegram_step(session_value text,revision_value integer,question_value integer,choice_value text,update_value bigint,callback_value text,user_value text,chat_value text,text_value text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare s private.survey_telegram_sessions%rowtype;i private.survey_invitations%rowtype;v public.survey_versions%rowtype;q jsonb;x jsonb;result jsonb;e jsonb;payload_hash text:=md5(jsonb_build_array(revision_value,question_value,choice_value,text_value)::text);begin
 select * into s from private.survey_telegram_sessions where id=session_value for update;
 if s.id is null or s.provider_user_id<>user_value or s.provider_chat_id<>chat_value or not private.survey_enabled(s.tenant_id) then raise exception 'survey sender denied' using errcode='42501';end if;
 if update_value=s.last_update and callback_value=s.last_callback then if payload_hash is distinct from s.last_payload_hash then raise exception 'stale survey callback' using errcode='PT409';end if;return s.last_result||jsonb_build_object('duplicate',true);end if;
 if update_value<=s.last_update or s.revision<>revision_value or s.question<>question_value or s.stopped then raise exception 'stale survey callback' using errcode='PT409';end if;
 select * into i from private.survey_invitations where id=s.invitation_id for update;
 select * into v from public.survey_versions where id=i.version_id;perform private.survey_form(v);
 e:=private.survey_eligibility(s.tenant_id,i.version_id,i.customer_id,i.conversation_id,true,i.id);
 if i.status<>'TEST_ACCESS' or i.expires_at<=now() or not (e->>'review_ready')::boolean or i.source_fingerprint is distinct from e->>'source_fingerprint' then raise exception 'survey eligibility changed' using errcode='PT409';end if;
 q:=v.definition->'questions'->s.question;
 if choice_value='stop' then update private.survey_invitations set status='STOPPED' where id=i.id;s.stopped:=true;
 elsif choice_value='select' then
 if q->>'type'<>'MULTIPLE' or not exists(select 1 from jsonb_array_elements(q->'choices') c where c->>'id'=text_value) then raise exception 'invalid selection' using errcode='22023';end if;
 if s.selected ? text_value then s.selected:=s.selected-text_value;else s.selected:=s.selected||to_jsonb(text_value);end if;
 else
 x:=jsonb_build_object('question',q->>'id','skipped',choice_value='skip','value',case when choice_value='skip' then 'null'::jsonb when q->>'type'='RATING' and choice_value~'^[1-5]$' then to_jsonb(choice_value::integer) when q->>'type'='SINGLE' then to_jsonb(choice_value) when q->>'type'='MULTIPLE' and choice_value='next' then s.selected when q->>'type'='TEXT' and choice_value='text' then to_jsonb(text_value) else 'null'::jsonb end);
 s.answers:=s.answers||x;s.question:=s.question+1;s.selected:='[]';
 -- Validate each partial answer with skipped placeholders for remaining questions.
 if not private.survey_answers_valid(v.definition,s.answers||coalesce((select jsonb_agg(jsonb_build_object('question',qq->>'id','skipped',true,'value',null)) from jsonb_array_elements(v.definition->'questions') with ordinality z(qq,n) where n>s.question),'[]'),false) then raise exception 'invalid answer' using errcode='22023';end if;
 if s.question=jsonb_array_length(v.definition->'questions') then perform private.survey_complete_invitation(i.id,s.answers,'TELEGRAM');s.stopped:=true;end if;
 end if;
 result:=jsonb_build_object('session',s.id,'revision',s.revision+1,'question',s.question,'selected',s.selected,'completed',s.question=jsonb_array_length(v.definition->'questions'),'stopped',s.stopped,'send_enabled',false,'transport','PREVIEW','definition',v.definition,'anonymous_key',case when v.definition->>'privacy' in ('ANONYMOUS','BOTH') then v.public_key end);
 update private.survey_telegram_sessions set revision=s.revision+1,question=s.question,answers=s.answers,selected=s.selected,stopped=s.stopped,last_update=update_value,last_callback=callback_value,last_payload_hash=payload_hash,last_revision=revision_value,last_question=question_value,last_result=result where id=s.id;
 return result;
end;$$;

create function public.survey_telegram_text(update_value bigint,user_value text,chat_value text,message_value integer,text_value text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare s private.survey_telegram_sessions%rowtype;begin
 if length(btrim(text_value)) not between 1 and 500 then raise exception 'invalid text' using errcode='22023';end if;
 select ss.* into s from private.survey_telegram_sessions ss join private.survey_invitations i on i.id=ss.invitation_id where ss.provider_user_id=user_value and ss.provider_chat_id=chat_value and private.survey_enabled(ss.tenant_id) order by i.created_at desc,i.id desc limit 1 for update of ss;
 if s.id is null then raise exception 'survey sender denied' using errcode='42501';end if;
 return public.survey_telegram_step(s.id,case when update_value=s.last_update then s.last_revision else s.revision end,case when update_value=s.last_update then s.last_question else s.question end,'text',update_value,'text:'||message_value,user_value,chat_value,text_value);
end;$$;

-- Only fixed month/version/privacy cohorts are exposed for anonymous analysis.
create function private.survey_aggregate(t uuid,v uuid,month_value date,privacy_value text) returns jsonb language plpgsql stable set search_path=pg_catalog as $$declare n integer;questions jsonb:='[]';q jsonb;cells jsonb;den integer;unsafe boolean;ids jsonb;begin
 if privacy_value not in ('IDENTIFIED','ANONYMOUS') then raise exception 'invalid privacy' using errcode='22023';end if;
 if privacy_value='ANONYMOUS' then select count(*) into n from private.survey_anonymous_responses where tenant_id=t and version_id=v and collection_month=month_value;
 else select count(*) into n from private.survey_identified_responses where tenant_id=t and version_id=v and completed_at>=month_value::timestamp at time zone 'UTC' and completed_at<(month_value+interval '1 month')::timestamp at time zone 'UTC';select coalesce(jsonb_agg(id),'[]') into ids from (select id from private.survey_identified_responses where tenant_id=t and version_id=v and completed_at>=month_value::timestamp at time zone 'UTC' and completed_at<(month_value+interval '1 month')::timestamp at time zone 'UTC' order by completed_at,id limit 5000) r;end if;
 if privacy_value='ANONYMOUS' and (n<5 or month_value>=date_trunc('month',now() at time zone 'UTC')::date) then return jsonb_build_object('privacy',privacy_value,'sample_size',null,'suppressed',true,'questions','[]'::jsonb,'minimum_sample',5);end if;
 for q in select value from jsonb_array_elements((select definition->'questions' from public.survey_versions where id=v and tenant_id=t)) loop
 if q->>'type'='TEXT' then continue;end if;
 with answers as (
 select a->'value' value from private.survey_anonymous_responses r cross join lateral jsonb_array_elements(r.answers) a where privacy_value='ANONYMOUS' and r.tenant_id=t and r.version_id=v and r.collection_month=month_value and a->>'question'=q->>'id' and not (a->>'skipped')::boolean
 union all
 select a->'value' from private.survey_identified_responses r cross join lateral jsonb_array_elements(r.answers) a where privacy_value='IDENTIFIED' and r.tenant_id=t and r.version_id=v and r.completed_at>=month_value::timestamp at time zone 'UTC' and r.completed_at<(month_value+interval '1 month')::timestamp at time zone 'UTC' and a->>'question'=q->>'id' and not (a->>'skipped')::boolean
 ),counts as(select value#>>'{}' key,count(*) n from (select value from answers where jsonb_typeof(value)<>'array' union all select x from answers cross join lateral jsonb_array_elements(case when jsonb_typeof(value)='array' then value else '[]' end) x) normalized group by 1)
 select coalesce(jsonb_object_agg(counts.key,counts.n),'{}'),coalesce(bool_or(counts.n<5),false),(select count(*) from answers) into cells,unsafe,den from counts;
 unsafe:=privacy_value='ANONYMOUS' and (unsafe or den<5 or (n-den between 1 and 4));
 questions:=questions||jsonb_build_object('id',q->>'id','topic',q->>'topic','type',q->>'type','label',q->>'label','choices',q->'choices','denominator',case when unsafe then null else den end,'cells',case when unsafe then null else cells end,'suppressed',unsafe);
 end loop;
 return jsonb_build_object('privacy',privacy_value,'sample_size',n,'suppressed',false,'questions',questions,'source_response_ids',case when privacy_value='IDENTIFIED' then ids else null end,'minimum_sample',case when privacy_value='ANONYMOUS' then 5 else 1 end,'method','DETERMINISTIC_V1','uncertainty','SELF_REPORTED_PERCEPTION_NOT_CAUSATION','window_start',month_value,'window_end',(month_value+interval '1 month')::date);
end;$$;
create function private.survey_intelligence(t uuid,v uuid,month_value date) returns integer language plpgsql set search_path=pg_catalog as $$declare agg jsonb;q jsonb;privacy_value text;fp text;cl record;rid uuid;n integer:=0;begin
 for privacy_value in select unnest(array['IDENTIFIED','ANONYMOUS']) loop
 agg:=private.survey_aggregate(t,v,month_value,privacy_value);
 if coalesce((agg->>'sample_size')::integer,0)=0 then continue;end if;
 for q in select value from jsonb_array_elements(agg->'questions') where not (value->>'suppressed')::boolean and coalesce((value->>'denominator')::integer,0)>0 loop
 fp:=md5(jsonb_build_object('n',agg->'sample_size','q',q,'version',v,'privacy',privacy_value,'month',month_value)::text);
 insert into public.survey_insights(tenant_id,version_id,collection_month,privacy,topic,evidence,source_fingerprint)
 values(t,v,month_value,privacy_value,q->>'id',jsonb_build_object('aggregation',agg-'questions','question',q,'proposal_code','REVIEW_'||(q->>'topic'),'operational_area',q->>'topic','confidence','DESCRIPTIVE_ONLY_REQUIRES_MANAGER_REVIEW'),fp)
 on conflict(tenant_id,version_id,collection_month,privacy,topic) do update set evidence=excluded.evidence,source_fingerprint=excluded.source_fingerprint,status='REVIEW',revision=survey_insights.revision+1 where survey_insights.source_fingerprint<>excluded.source_fingerprint returning id into rid;
 if rid is not null then perform private.survey_log(t,v,'insight_refreshed',jsonb_build_object('insight_id',rid,'privacy',privacy_value,'method','DETERMINISTIC_V1'));n:=n+1;end if;
 end loop;end loop;
 -- Anonymous complaint triage has no response ID, exact time, quote or contact.
 for cl in select distinct classification->>'category' category,classification->>'severity' severity from private.survey_anonymous_responses where tenant_id=t and version_id=v and collection_month=month_value and private.escalation_rank(classification->>'severity')>=3 loop
 insert into private.survey_triage(tenant_id,version_id,collection_month,category,severity) values(t,v,month_value,cl.category,cl.severity) on conflict do nothing returning id into rid;
 if rid is not null then
 insert into private.survey_alert_drafts(tenant_id,source_key,category,severity) values(t,'anonymous-cohort:'||v||':'||month_value||':'||cl.category,cl.category,cl.severity) on conflict do nothing;
 perform private.survey_log(t,v,'anonymous_cohort_triage',jsonb_build_object('triage_id',rid,'identity_link',false,'message_sent',false));end if;
 end loop;
 return n;
end;$$;
create function public.admin_survey_review(target_tenant_id uuid,item_value uuid,expected_revision integer,action_value text,assignee_value uuid default null,note_value text default null,triage_value boolean default false) returns integer language plpgsql security definer set search_path=pg_catalog as $$declare x public.survey_insights%rowtype;tr private.survey_triage%rowtype;ns text;v uuid;begin
 perform private.survey_require(target_tenant_id,true);
 if not private.survey_enabled(target_tenant_id) then raise exception 'survey sandbox disabled' using errcode='42501';end if;
 if assignee_value is not null and not exists(select 1 from public.tenant_members where tenant_id=target_tenant_id and user_id=assignee_value and status='active' and role in ('super_admin','manager','support')) then raise exception 'invalid assignee' using errcode='42501';end if;
 if triage_value then
 select * into tr from private.survey_triage where tenant_id=target_tenant_id and id=item_value for update;
 if tr.id is null or tr.revision<>expected_revision then raise exception 'review changed' using errcode='PT409';end if;
 ns:=case when action_value='review' and tr.status='NEW' then 'REVIEW' when action_value='complete' and tr.status='REVIEW' and length(btrim(note_value))>=8 then 'COMPLETED' when action_value='assign' then tr.status end;
 if ns is null then raise exception 'invalid triage transition' using errcode='22023';end if;
 update private.survey_triage set status=ns,assigned_to=coalesce(assignee_value,assigned_to),note=coalesce(note_value,note),revision=revision+1 where id=tr.id;v:=tr.version_id;
 else
 select * into x from public.survey_insights where tenant_id=target_tenant_id and id=item_value for update;
 if x.id is null or x.revision<>expected_revision then raise exception 'review changed' using errcode='PT409';end if;
 -- Reviewed aggregates must still match their current persisted sources.
 if x.evidence->'aggregation'->>'sample_size' is distinct from private.survey_aggregate(target_tenant_id,x.version_id,x.collection_month,x.privacy)->>'sample_size' then raise exception 'insight source changed' using errcode='PT409';end if;
 ns:=case when action_value='review' and x.status='NEW' then 'REVIEW' when action_value='approve' and x.status='REVIEW' then 'APPROVED' when action_value='reject' and x.status in ('NEW','REVIEW') then 'REJECTED' when action_value='plan' and x.status='APPROVED' then 'PLANNED' when action_value='complete' and x.status='PLANNED' and length(btrim(note_value))>=8 then 'COMPLETED' when action_value='assign' then x.status end;
 if ns is null then raise exception 'invalid insight transition' using errcode='22023';end if;
 update public.survey_insights set status=ns,assigned_to=coalesce(assignee_value,assigned_to),internal_note=coalesce(note_value,internal_note),revision=revision+1 where id=x.id;v:=x.version_id;
 end if;
 perform private.survey_log(target_tenant_id,v,'review_'||action_value,jsonb_build_object('item_id',item_value,'status',ns,'assignee',assignee_value,'note',left(note_value,1000),'commercial_authority',false,'send_enabled',false));return expected_revision+1;
end;$$;

-- Bounded job/outbox reuse. No additional cron and no provider transport.
create function private.survey_source_changed() returns trigger language plpgsql security definer set search_path=pg_catalog as $$declare c uuid;k text;begin
 if not private.survey_enabled(new.tenant_id) then return new;end if;
 if tg_table_name='subscriptions' then c:=new.customer_id;k:='CANCELLATION';else select customer_id into c from public.subscriptions where tenant_id=new.tenant_id and id=new.subscription_id;k:=case when new.status='MEMBER' then 'VIP_JOIN' else 'DEPARTURE' end;end if;
 insert into public.scheduled_jobs(tenant_id,customer_id,job_type,payload,idempotency_key,correlation_id,scheduled_at,max_attempts)
 values(new.tenant_id,c,'survey.review',jsonb_build_object('source_table',tg_table_name,'source_id',new.id,'trigger',k),'survey.review:'||tg_table_name||':'||new.id||':'||md5(to_jsonb(new)::text),gen_random_uuid(),now(),3) on conflict do nothing;return new;
end;$$;
create trigger survey_subscription_source after insert or update on public.subscriptions for each row execute function private.survey_source_changed();
create trigger survey_access_source after insert or update on public.channel_access for each row execute function private.survey_source_changed();
create function public.process_survey_jobs(target_tenant_id uuid,limit_value integer default 25) returns integer language plpgsql security definer set search_path=pg_catalog as $$declare j public.scheduled_jobs%rowtype;n integer:=0;v record;c uuid;e jsonb;begin
 if not private.survey_enabled(target_tenant_id) then return 0;end if;
 for j in select * from public.scheduled_jobs where tenant_id=target_tenant_id and job_type in ('survey.review','survey.intelligence') and status='scheduled' and scheduled_at<=now() order by scheduled_at,id for update skip locked limit greatest(1,least(limit_value,25)) loop
 begin
 update public.scheduled_jobs set status='processing',attempts=attempts+1,locked_at=now(),locked_by='survey-worker' where id=j.id;
 if j.job_type='survey.intelligence' then perform private.survey_intelligence(j.tenant_id,(j.payload->>'version')::uuid,(j.payload->>'month')::date);
 else
 select id into c from public.conversations where tenant_id=j.tenant_id and customer_id=j.customer_id and status='open' order by updated_at desc,id desc limit 1;
 for v in select id from public.survey_versions where tenant_id=j.tenant_id and state='PUBLISHED' and definition->>'trigger'=j.payload->>'trigger' order by id limit 10 loop
 e:=private.survey_eligibility(j.tenant_id,v.id,j.customer_id,c,false);
 perform private.survey_log(j.tenant_id,v.id,'trigger_reviewed',jsonb_build_object('job_id',j.id,'review_ready',e->'review_ready','blockers',e->'blockers','send_enabled',false));
 end loop;end if;
 update public.scheduled_jobs set status='completed',completed_at=now(),locked_at=null,locked_by=null,last_error_code=null where id=j.id;n:=n+1;
 exception when others then
 update public.scheduled_jobs set attempts=j.attempts+1,status=case when j.attempts+1>=j.max_attempts then 'dead_letter' else 'scheduled' end,scheduled_at=now()+make_interval(secs=>least(300,5*(j.attempts+1))),locked_at=null,locked_by=null,last_error_code='SURVEY_REVIEW_FAILED',dead_lettered_at=case when j.attempts+1>=j.max_attempts then now() end where id=j.id;
 end;end loop;return n;
end;$$;
create function public.process_survey_due() returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare t uuid;v record;customer_row record;last_customer uuid;seen integer;ctl private.survey_controls%rowtype;n integer:=0;tenants integer:=0;begin
 for t in select tenant_id from private.survey_controls where enabled and private.survey_enabled(tenant_id) order by tenant_id limit 5 loop
 select * into ctl from private.survey_controls where tenant_id=t for update skip locked;
 if not found then continue;end if;
 if ctl.cadence_days is not null and ctl.cadence_approval is not null then
 seen:=0;last_customer:=null;
 for customer_row in select id from public.customers where tenant_id=t and (ctl.periodic_cursor is null or id>ctl.periodic_cursor) order by id limit 25 loop
 insert into public.scheduled_jobs(tenant_id,customer_id,job_type,payload,idempotency_key,correlation_id,scheduled_at,max_attempts)
 values(t,customer_row.id,'survey.review',jsonb_build_object('trigger','PERIODIC'),'survey.periodic:'||customer_row.id||':'||floor(extract(epoch from now())/(ctl.cadence_days*86400)),gen_random_uuid(),now(),3) on conflict do nothing;
 seen:=seen+1;last_customer:=customer_row.id;end loop;
 update private.survey_controls set periodic_cursor=case when seen=25 then last_customer end where tenant_id=t;
 end if;
 if ctl.last_cohort_review_at is null or ctl.last_cohort_review_at<now()-interval '5 minutes' then
 for v in select id from public.survey_versions where tenant_id=t and state='PUBLISHED' order by id limit 10 loop
 perform private.survey_enqueue(t,v.id,date_trunc('month',now() at time zone 'UTC')::date);
 end loop;update private.survey_controls set last_cohort_review_at=now() where tenant_id=t;end if;
 n:=n+public.process_survey_jobs(t,25);perform public.survey_retention(t);tenants:=tenants+1;end loop;return jsonb_build_object('tenants',tenants,'processed',n,'send_enabled',false);
end;$$;
create function public.admin_survey_refresh(target_tenant_id uuid,version_value uuid,month_value date) returns integer language plpgsql security definer set search_path=pg_catalog as $$begin
 perform private.survey_require(target_tenant_id,true);
 if not private.survey_enabled(target_tenant_id) or extract(day from month_value)<>1 or month_value>current_date or month_value<date_trunc('month',now())::date-interval '2 years' or not exists(select 1 from public.survey_versions where tenant_id=target_tenant_id and id=version_value) then raise exception 'invalid survey window' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(target_tenant_id::text||version_value::text||month_value::text,14));
 return private.survey_intelligence(target_tenant_id,version_value,month_value);end;$$;
create function public.survey_retention(target_tenant_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare ctl private.survey_controls%rowtype;n integer:=0;m integer:=0;begin
 select * into ctl from private.survey_controls where tenant_id=target_tenant_id for update;
 if not private.survey_enabled(target_tenant_id) or ctl.retention_days is null or ctl.legal_hold then return jsonb_build_object('deleted',0,'policy_active',false);end if;
 delete from private.survey_identified_responses r where r.id in(select id from private.survey_identified_responses where tenant_id=target_tenant_id and completed_at<now()-make_interval(days=>ctl.retention_days) and case_id is null order by completed_at limit 500);get diagnostics n=row_count;
 -- Whole month only: never retain hidden fine-grained anonymous timestamps.
 delete from private.survey_anonymous_responses r where r.id in(select id from private.survey_anonymous_responses where tenant_id=target_tenant_id and collection_month+interval '1 month'<current_date-make_interval(days=>ctl.retention_days) order by collection_month limit 500);get diagnostics m=row_count;
 delete from public.survey_insights where tenant_id=target_tenant_id and collection_month+interval '1 month'<current_date-make_interval(days=>ctl.retention_days);
 delete from private.survey_spent_permits where expires_at<now()-interval '1 day';
 perform private.survey_log(target_tenant_id,null,'retention_applied',jsonb_build_object('identified_deleted',n,'anonymous_deleted',case when m>=5 then m else null end,'complaint_evidence_retained',true));
 return jsonb_build_object('deleted',n+case when m>=5 then m else 0 end,'policy_active',true);
end;$$;
create function public.admin_survey_workspace(target_tenant_id uuid,version_value uuid default null,month_value date default null,customer_value uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare mo date:=coalesce(month_value,date_trunc('month',now() at time zone 'UTC')::date);current_version public.survey_versions%rowtype;aggregate_value jsonb:='[]';mg boolean;begin
 perform private.survey_require(target_tenant_id);mg:=private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]);
 if extract(day from mo)<>1 or mo>current_date or mo<date_trunc('month',now())::date-interval '2 years' then raise exception 'invalid fixed window' using errcode='22023';end if;
 if customer_value is not null and not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support']::public.app_role[]) then raise exception 'named feedback denied' using errcode='42501';end if;
 if customer_value is null then
 for current_version in select * from public.survey_versions where tenant_id=target_tenant_id and (version_value is null or id=version_value) order by created_at desc,id desc limit 50 loop
 aggregate_value:=aggregate_value||jsonb_build_object('version_id',current_version.id,'identified',private.survey_aggregate(target_tenant_id,current_version.id,mo,'IDENTIFIED')-'source_response_ids','anonymous',private.survey_aggregate(target_tenant_id,current_version.id,mo,'ANONYMOUS'));
 end loop;end if;
 return jsonb_build_object('sandbox_enabled',private.survey_enabled(target_tenant_id),'can_manage',mg,'month',mo,'send_enabled',false,'provider_delivered',0,
 'settings',case when mg then (select to_jsonb(s)-'tenant_id' from private.survey_controls s where tenant_id=target_tenant_id) end,
 'versions',coalesce((select jsonb_agg(to_jsonb(v)-'public_key') from(select * from public.survey_versions where tenant_id=target_tenant_id and (version_value is null or id=version_value) order by created_at desc,id desc limit 50) v),'[]'),
 'anonymous_keys',case when mg and private.survey_enabled(target_tenant_id) then coalesce((select jsonb_object_agg(id,public_key) from public.survey_versions where tenant_id=target_tenant_id and state='PUBLISHED' and definition->>'privacy' in ('ANONYMOUS','BOTH')),'{}') else '{}' end,
 'aggregates',aggregate_value,
 'invitations_created',(select count(*) from private.survey_invitations where tenant_id=target_tenant_id and (version_value is null or version_id=version_value) and (customer_value is null or customer_id=customer_value) and created_at>=mo::timestamp at time zone 'UTC' and created_at<(mo+interval '1 month')::timestamp at time zone 'UTC'),
 'responses',case when private.has_tenant_role(target_tenant_id,array['super_admin','manager','support']::public.app_role[]) then coalesce((select jsonb_agg(r) from(select id,version_id,customer_id,conversation_id,channel,answers,completed_at,case_id from private.survey_identified_responses where tenant_id=target_tenant_id and (version_value is null or version_id=version_value) and (customer_value is null or customer_id=customer_value) and completed_at>=mo::timestamp at time zone 'UTC' and completed_at<(mo+interval '1 month')::timestamp at time zone 'UTC' order by completed_at desc,id desc limit 50) r),'[]') else '[]' end,
 'insights',case when customer_value is null then coalesce((select jsonb_agg(i) from(select * from public.survey_insights where tenant_id=target_tenant_id and collection_month=mo and (version_value is null or version_id=version_value) order by id limit 100) i),'[]') else '[]' end,
 'triage',case when customer_value is null then coalesce((select jsonb_agg(t) from(select id,version_id,collection_month,category,severity,status,revision,assigned_to,note from private.survey_triage where tenant_id=target_tenant_id and collection_month=mo and (version_value is null or version_id=version_value) order by severity,id limit 100) t),'[]') else '[]' end,
 'drafts',case when mg and customer_value is null then coalesce((select jsonb_agg(d) from(select id,category,severity,status,send_enabled,chat_id,bot_id from private.survey_alert_drafts where tenant_id=target_tenant_id order by id limit 50) d),'[]') else '[]' end,
 'contacts',case when mg then coalesce((select jsonb_agg(x) from(select c.customer_id,c.id conversation_id,u.display_name,coalesce(g.revision,0) consent_revision,coalesce(g.consent,'UNKNOWN') consent,g.expires_at from public.conversations c join public.customers u on u.tenant_id=c.tenant_id and u.id=c.customer_id left join private.survey_consents g on g.tenant_id=c.tenant_id and g.customer_id=c.customer_id where c.tenant_id=target_tenant_id and c.status='open' order by c.updated_at desc,c.id desc limit 100) x),'[]') else '[]' end,
 'managers',case when mg then coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(u.display_name,'Manager'))) from public.tenant_members m join public.app_users u on u.id=m.user_id where m.tenant_id=target_tenant_id and m.status='active' and m.role in ('super_admin','manager','support')),'[]') else '[]' end,
 'history',case when mg and customer_value is null then coalesce((select jsonb_agg(h) from(select action,actor_id,details,created_at from private.survey_history where tenant_id=target_tenant_id and (version_value is null or version_id=version_value) order by id desc limit 50) h),'[]') else '[]' end);
end;$$;

-- No direct private-data or financial authority, including through service clients.
do $$declare t text;f record;begin
 foreach t in array array['survey_controls','survey_history','survey_consents','survey_invitations','survey_identified_responses','survey_anonymous_responses','survey_spent_permits','survey_budgets','survey_telegram_sessions','survey_triage','survey_alert_drafts'] loop
 execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);end loop;
 foreach t in array array['survey_versions','survey_insights'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy survey_read on public.%I for select to authenticated using(private.has_tenant_role(tenant_id,array[''super_admin'',''manager'',''support'',''analyst'']::public.app_role[]) and exists(select 1 from public.tenants where id=tenant_id and status=''active''))',t);
 end loop;
 for f in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and (p.proname like 'survey_%' or p.proname like 'admin_survey_%' or p.proname like 'process_survey_%' or p.proname='configure_phase14_sandbox') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.nspname='public' then execute format('grant execute on function %s to %I',f.signature,case when f.proname like 'admin_survey_%' then 'authenticated' else 'service_role' end);end if;
 end loop;
end;$$;
