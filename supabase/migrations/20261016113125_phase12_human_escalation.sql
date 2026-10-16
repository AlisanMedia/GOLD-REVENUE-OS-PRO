-- Phase 12: isolated-staging, source-bound human escalation. No financial/access authority.
create table private.escalation_controls (
 tenant_id uuid primary key references public.tenants(id), enabled boolean not null default false,
 activated_at timestamptz not null default now(), approval_reference text not null,
 chat_id text, bot_id text,
 check(chat_id is null or (chat_id ~ '^-?[1-9][0-9]{0,15}$' and chat_id <> '-1003944824067')),
 check(bot_id is null or (bot_id ~ '^[1-9][0-9]{0,15}$' and bot_id<>'8673054837')), check((chat_id is null)=(bot_id is null))
);
create table public.escalation_cases (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, conversation_id uuid not null, customer_id uuid,
 category text not null check(category in ('payment_dispute','missing_access','refund_request','fraud_accusation','legal_threat','financial_loss','security_issue','vip_complaint','knowledge_conflict','low_confidence','human_request','general_review')),
 severity text not null check(severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
 status text not null default 'OPEN' check(status in ('OPEN','ACKNOWLEDGED','IN_PROGRESS','RESOLVED')),
 source_message_id uuid not null, assigned_to uuid, revision int not null default 1,
 created_at timestamptz not null default now(), acknowledged_at timestamptz, first_response_at timestamptz,
 resolved_at timestamptz, resolved_by uuid, resolution_code text, resolution_note text, returned_to_ai_at timestamptz,
 safe_reply_id uuid, locale text not null default 'en' check(locale in ('en','tr','ar','ru')),
 unique(tenant_id,id), foreign key(tenant_id,conversation_id) references public.conversations(tenant_id,id),
 foreign key(tenant_id,customer_id) references public.customers(tenant_id,id),
 foreign key(tenant_id,source_message_id) references public.messages(tenant_id,id),
 foreign key(tenant_id,assigned_to) references public.tenant_members(tenant_id,user_id),
 foreign key(tenant_id,safe_reply_id) references public.messages(tenant_id,id)
);
create unique index escalation_one_open on public.escalation_cases(tenant_id,conversation_id) where status<>'RESOLVED';
create index escalation_queue on public.escalation_cases(tenant_id,status,severity,created_at);
create table public.escalation_evidence (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,case_id uuid not null,message_id uuid not null,
 category text not null,source_kind text not null check(source_kind in ('inbound','quality')),source_id uuid not null,
 created_at timestamptz not null default now(),unique(case_id,source_kind,source_id,category),
 foreign key(tenant_id,case_id) references public.escalation_cases(tenant_id,id),
 foreign key(tenant_id,message_id) references public.messages(tenant_id,id)
);
create table public.escalation_history (
 id bigint generated always as identity primary key,tenant_id uuid not null,case_id uuid not null,
 action text not null,actor_id uuid,details jsonb not null default '{}',created_at timestamptz not null default now(),
 foreign key(tenant_id,case_id) references public.escalation_cases(tenant_id,id)
);
create table public.escalation_notifications (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,case_id uuid not null,
 status text not null default 'BLOCKED' check(status in ('BLOCKED','PENDING','RUNNING','SENT','FAILED','UNCERTAIN','CANCELLED')),
 attempts int not null default 0,available_at timestamptz not null default now(),lease_token uuid,lease_until timestamptz,
 provider_message_id text,last_error text,sent_at timestamptz,unique(case_id),unique(tenant_id,id),
 foreign key(tenant_id,case_id) references public.escalation_cases(tenant_id,id)
);
create index escalation_notification_ready on public.escalation_notifications(available_at) where status in ('PENDING','RUNNING');
create table public.escalation_notification_attempts (
 id bigint generated always as identity primary key,tenant_id uuid not null,notification_id uuid not null,attempt int not null,
 result text not null check(result in ('SENT','RETRY','FAILED','UNCERTAIN')),provider_status int not null,
 provider_message_id text,created_at timestamptz not null default now(),unique(notification_id,attempt),
 foreign key(tenant_id,notification_id) references public.escalation_notifications(tenant_id,id)
);
alter table public.conversations add column escalation_return_boundary timestamptz;

create function private.escalation_audit(cid uuid,act text,d jsonb default '{}') returns void language plpgsql set search_path=pg_catalog as $$
declare t uuid;begin select tenant_id into strict t from public.escalation_cases where id=cid;
 insert into public.escalation_history(tenant_id,case_id,action,actor_id,details) values(t,cid,act,auth.uid(),d);
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)
 values(t,case when auth.uid() is null then 'SYSTEM'::public.audit_actor_type else 'HUMAN'::public.audit_actor_type end,auth.uid(),'escalation.'||act,'escalation_cases',cid::text,d);
end;$$;
create function private.escalation_rank(s text) returns int language sql immutable set search_path=pg_catalog as $$select case s when 'CRITICAL' then 4 when 'HIGH' then 3 when 'MEDIUM' then 2 else 1 end;$$;
create function private.escalation_enabled(t uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from private.escalation_controls e join public.tenants x on x.id=e.tenant_id where e.tenant_id=t and e.enabled and x.status='active' and x.slug like 'phase12-sandbox-%');$$;
create function public.configure_phase12_escalation(target_tenant_id uuid,enabled_value boolean,approval_value text,chat_value text default null,bot_value text default null) returns void language plpgsql security definer set search_path=pg_catalog as $$begin
 if nullif(btrim(approval_value),'') is null or not exists(select 1 from public.tenants where id=target_tenant_id and status='active' and slug like 'phase12-sandbox-%') then raise exception 'isolated escalation scope required' using errcode='42501';end if;
 insert into private.escalation_controls(tenant_id,enabled,approval_reference,chat_id,bot_id) values(target_tenant_id,enabled_value,left(approval_value,200),chat_value,bot_value)
 on conflict(tenant_id) do update set enabled=excluded.enabled,approval_reference=excluded.approval_reference,chat_id=excluded.chat_id,bot_id=excluded.bot_id,activated_at=case when not escalation_controls.enabled then now() else escalation_controls.activated_at end;
 if enabled_value and chat_value is not null then update public.escalation_notifications n set status='PENDING',last_error=null from public.escalation_cases c where n.case_id=c.id and c.tenant_id=target_tenant_id and c.status<>'RESOLVED' and n.status='BLOCKED';end if;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data) values(target_tenant_id,'SYSTEM','escalation.configuration','tenants',target_tenant_id::text,jsonb_build_object('enabled',enabled_value,'destination_configured',chat_value is not null));
end;$$;

-- Conservative multilingual detection. Policy/how-to questions alone are not disputes.
create function public.classify_escalation(text_value text) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare s text:=lower(coalesce(text_value,''));cat text;sev text;loc text:='en';begin
 if s ~ '[а-яё]' then loc:='ru';elsif s ~ '[ء-ي]' then loc:='ar';elsif s ~ '[ıüğşöç]|insan|yetkili|iade|ödeme|erişim' then loc:='tr';end if;
 if s ~ 'grammar check|translate (this|the sentence)|for a grammar|dilbilgisi' then return null;end if;
 if s ~ 'hacked|account.*(stolen|compromised)|security (breach|problem|issue)|hesabım.*(çalındı|hack)|güvenlik (sorunu|ihlali)|взлом|украли.*аккаунт|اختراق|سرقة حساب' then cat:='security_issue';sev:='CRITICAL';
 elsif s ~ '(sue you|my lawyer|legal action|legal threat|dava aç|avukatım|подам.*суд|адвокат|سأقاضي|محامي)' then cat:='legal_threat';sev:='CRITICAL';
 elsif s ~ '(you are|this is|you.re|you have|you scammed).*(fraud|scam)|fraud accusation|dolandırıcı|dolandırıldım|мошенник|обманули|احتيال|نصاب' then cat:='fraud_accusation';sev:='CRITICAL';
 elsif s ~ '(i (have )?lost|lost my).*(money|funds|savings)|para(mı)? kaybettim|убыт|потерял.*деньги|خسرت.*مال|خسرت.*أموال' then cat:='financial_loss';sev:='CRITICAL';
 elsif s ~ '(i (want|need|request)|please|give me|would like).*(refund|money back)|refund (me|my)|iade (istiyorum|taleb)|paramı geri|хочу.*возврат|верните.*деньги|أريد.*استرداد|اريد.*استرداد' then cat:='refund_request';sev:='HIGH';
 elsif s ~ '(paid|payment).*(no access|not have access|cannot access|can.t access|missing access|without access)|access.*(after payment|after paying)|ödeme.*erişim|ödedim.*(erişim|giremiyorum)|оплатил.*(нет доступа|доступа нет)|دفعت.*(وصول|دخول)' then cat:='missing_access';sev:='HIGH';
 elsif s ~ '(paid|payment).*(not (received|reflected|credited)|missing|not confirmed)|ödeme.*(yansımadı|görünmüyor)|платеж.*(не|пропал)|оплата.*не|الدفع.*لم' then cat:='payment_dispute';sev:='HIGH';
 elsif s ~ '(speak|talk|connect).*(human|manager|person)|human (help|assistance|please)|request.*human|insanla.*(konuş|görüş)|yetkili.*(konuş|görüş)|позовите.*(человека|менеджера)|связаться.*человеком|أريد.*(إنسان|موظف)|اريد.*(إنسان|موظف)' then cat:='human_request';sev:='HIGH';
 elsif s ~ 'vip.*(complaint|unhappy|bad service|not working)|vip.*şikayet|vip.*жалоб|vip.*شكوى' then cat:='vip_complaint';sev:='MEDIUM';
 elsif s ~ '(prices?|knowledge|information).*(contradict|conflict)|fiyat.*çeliş|информац.*противореч|معلومات.*متناقض' then cat:='knowledge_conflict';sev:='HIGH';
 elsif s ~ 'non.urgent (feedback|review)|acil olmayan.*incele|не срочно.*провер|مراجعة غير عاجلة' then cat:='general_review';sev:='LOW';
 else return null;end if;
 return jsonb_build_object('category',cat,'severity',sev,'locale',loc);end;$$;
create function private.escalation_safe_text(loc text) returns text language sql immutable set search_path=pg_catalog as $$select case loc
 when 'tr' then 'Bu konuyu burada doğrulayamıyorum. İnsan incelemesi gerekiyor.'
 when 'ar' then 'لا أستطيع التحقق من هذا هنا. يحتاج الأمر إلى مراجعة بشرية.'
 when 'ru' then 'Я не могу проверить это здесь. Нужна проверка специалистом.'
 else 'I cannot verify this here. This needs human review.' end;$$;

create function private.escalation_open(t uuid,mid uuid,cat text,sev text,loc text,kind text,sid uuid) returns uuid language plpgsql set search_path=pg_catalog as $$
declare m public.messages%rowtype;c public.conversations%rowtype;e public.escalation_cases%rowtype;eid uuid;new_evidence uuid;begin
 if not private.escalation_enabled(t) then return null;end if;
 select * into m from public.messages where tenant_id=t and id=mid and direction='inbound';
 if m.id is null or m.created_at<(select activated_at from private.escalation_controls where tenant_id=t) or m.created_at<now()-interval '5 minutes' then return null;end if;
 select * into c from public.conversations where tenant_id=t and id=m.conversation_id for update;
 if c.escalation_return_boundary is not null and m.created_at<c.escalation_return_boundary then return null;end if;
 select * into e from public.escalation_cases where tenant_id=t and conversation_id=c.id and status<>'RESOLVED' for update;
 if e.id is null then
  insert into public.escalation_cases(tenant_id,conversation_id,customer_id,category,severity,source_message_id,locale) values(t,c.id,c.customer_id,cat,sev,m.id,loc) returning * into e;
  perform private.escalation_audit(e.id,'created',jsonb_build_object('category',cat,'severity',sev,'source_message_id',mid));
  eid:=private.append_domain_event(t,c.customer_id,'escalation.created',1,jsonb_build_object('escalation_id',e.id,'category',cat,'severity',sev),'SYSTEM',null,'escalation_engine','TRUSTED',gen_random_uuid(),null,'escalation:'||e.id::text,now());
 elsif private.escalation_rank(sev)>private.escalation_rank(e.severity) then
  update public.escalation_cases set severity=sev,category=cat,revision=revision+1 where id=e.id returning * into e;
  perform private.escalation_audit(e.id,'priority_raised',jsonb_build_object('category',cat,'severity',sev));
 end if;
 insert into public.escalation_evidence(tenant_id,case_id,message_id,category,source_kind,source_id) values(t,e.id,mid,cat,kind,sid) on conflict do nothing returning id into new_evidence;
 if new_evidence is not null then perform private.escalation_audit(e.id,'evidence_added',jsonb_build_object('evidence_id',new_evidence));end if;
 update public.conversations set attention_required=true where id=c.id;
 if private.escalation_rank(e.severity)>=3 then
  update public.conversations set runtime_mode='HUMAN_TAKEOVER',human_takeover=true,automatic_replies_enabled=false,automatic_replies_enabled_at=null where id=c.id;
  update public.messages set status='failed',failure_code='ESCALATION_HOLD' where tenant_id=t and conversation_id=c.id and direction='outbound' and actor_id='quality-approved-reply' and status in ('pending','retry_scheduled');
  insert into public.escalation_notifications(tenant_id,case_id,status,last_error) select t,e.id,case when chat_id is null then 'BLOCKED' else 'PENDING' end,case when chat_id is null then 'DESTINATION_NOT_CONFIGURED' end from private.escalation_controls where tenant_id=t on conflict(case_id) do nothing;
 end if;return e.id;end;$$;
create function private.escalation_on_inbound() returns trigger language plpgsql security definer set search_path=pg_catalog as $$declare v jsonb;begin
 if new.direction='inbound' and private.escalation_enabled(new.tenant_id) then v:=public.classify_escalation(new.content);
 if v is not null then perform private.escalation_open(new.tenant_id,new.id,v->>'category',v->>'severity',v->>'locale','inbound',new.id);end if;end if;return new;end;$$;
create trigger phase12_inbound after insert on public.messages for each row execute function private.escalation_on_inbound();
create function private.escalation_on_quality() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare t public.agent_tasks%rowtype;p jsonb;mid uuid;cat text;sev text;begin
 if not private.escalation_enabled(new.tenant_id) then return new;end if;
 select at.* into t from public.agent_runs r join public.agent_tasks at on at.id=r.task_id and at.tenant_id=r.tenant_id where r.tenant_id=new.tenant_id and r.id=new.run_id;
 select (payload->>'message_id')::uuid into mid from public.domain_events where tenant_id=new.tenant_id and id=t.source_event_id and event_type='message.received';
 if mid is null then return new;end if;
 if new.escalation_category in ('knowledge_conflict','payment_dispute','missing_access','refund_request','fraud_accusation','legal_threat','financial_loss','security_issue','vip_complaint','human_request') then cat:=new.escalation_category;sev:=case when cat in ('fraud_accusation','legal_threat','financial_loss','security_issue') then 'CRITICAL' when cat='vip_complaint' then 'MEDIUM' else 'HIGH' end;
 elsif new.qa_action in ('verify_or_escalate','block') and ('LOW_CONFIDENCE'=any(new.qa_reasons) or coalesce((select confidence from public.agent_proposals where run_id=new.run_id),1)<0.65) then cat:='low_confidence';sev:='MEDIUM';
 elsif 'ESCALATION_REQUIRED'=any(new.qa_reasons) then cat:='general_review';sev:='HIGH';else return new;end if;
 perform private.escalation_open(new.tenant_id,mid,cat,sev,'en','quality',new.id);return new;end;$$;
-- Deferred until the complete run/proposal transaction has persisted confidence and evidence.
create constraint trigger phase12_quality after insert on public.conversation_quality_evaluations deferrable initially deferred for each row execute function private.escalation_on_quality();

create function private.escalation_conversation_guard() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if (new.runtime_mode='AI_ACTIVE' or new.automatic_replies_enabled) and (old.runtime_mode<>'AI_ACTIVE' or not old.automatic_replies_enabled) and exists(select 1 from public.escalation_cases e where e.tenant_id=new.tenant_id and e.conversation_id=new.id and private.escalation_rank(e.severity)>=3 and (e.status<>'RESOLVED' or e.returned_to_ai_at is null)) then raise exception 'resolve and return through escalation control' using errcode='42501';end if;return new;end;$$;
create trigger phase12_conversation_guard before update on public.conversations for each row execute function private.escalation_conversation_guard();

create function public.admin_escalation_action(target_tenant_id uuid,target_case_id uuid,expected_revision int,action_value text,assignee_value uuid default null,note_value text default null) returns int language plpgsql security definer set search_path=pg_catalog as $$
declare e public.escalation_cases%rowtype;conv uuid;b timestamptz:=clock_timestamp();begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]) then raise exception 'escalation control denied' using errcode='42501';end if;
 select conversation_id into conv from public.escalation_cases where tenant_id=target_tenant_id and id=target_case_id;
 perform 1 from public.conversations where tenant_id=target_tenant_id and id=conv for update;
 select * into e from public.escalation_cases where tenant_id=target_tenant_id and id=target_case_id for update;
 if e.id is null then raise exception 'case scope denied' using errcode='42501';end if;
 if e.revision is distinct from expected_revision then raise exception 'case revision conflict' using errcode='40001';end if;
 if action_value not in ('assign','acknowledge','takeover','resolve','return') or action_value is null then raise exception 'case action invalid' using errcode='22023';end if;
 if e.status='RESOLVED' and action_value<>'return' then raise exception 'case already resolved' using errcode='55000';end if;
 if action_value='assign' then
  if not exists(select 1 from public.tenant_members where tenant_id=target_tenant_id and user_id=assignee_value and status='active' and role in ('manager','super_admin')) then raise exception 'active tenant manager required' using errcode='42501';end if;
  update public.escalation_cases set assigned_to=assignee_value where id=e.id;
 elsif action_value='acknowledge' then update public.escalation_cases set status='ACKNOWLEDGED',acknowledged_at=coalesce(acknowledged_at,b),assigned_to=coalesce(assigned_to,auth.uid()) where id=e.id;
 elsif action_value='takeover' then
  if exists(select 1 from public.messages where tenant_id=target_tenant_id and conversation_id=conv and direction='outbound' and status='sending') then raise exception 'delivery in flight; wait for evidence' using errcode='55000';end if;
  update public.escalation_cases set status='IN_PROGRESS',assigned_to=auth.uid(),acknowledged_at=coalesce(acknowledged_at,b) where id=e.id;
  update public.conversations set runtime_mode='HUMAN_TAKEOVER',human_takeover=true,automatic_replies_enabled=false,automatic_replies_enabled_at=null where id=conv;
 elsif action_value='resolve' then
  if nullif(btrim(note_value),'') is null or char_length(note_value)>1000 then raise exception 'resolution note required' using errcode='22023';end if;
  update public.escalation_cases set status='RESOLVED',resolved_at=b,resolved_by=auth.uid(),resolution_code='operator_review',resolution_note=note_value where id=e.id;
  update public.escalation_notifications set status='CANCELLED',last_error='CASE_RESOLVED' where case_id=e.id and status in ('BLOCKED','PENDING');
  perform private.append_domain_event(target_tenant_id,e.customer_id,'escalation.resolved',1,jsonb_build_object('escalation_id',e.id,'resolution','operator_review'),'HUMAN',auth.uid()::text,'escalation_engine','TRUSTED',gen_random_uuid(),null,'escalation-resolved:'||e.id::text,b);
 elsif action_value='return' then
  if e.status<>'RESOLVED' or e.resolution_note is null or e.returned_to_ai_at is not null then raise exception 'resolved case required for return' using errcode='55000';end if;
  if exists(select 1 from public.escalation_cases where tenant_id=target_tenant_id and conversation_id=conv and status<>'RESOLVED' and private.escalation_rank(severity)>=3) or exists(select 1 from public.messages where tenant_id=target_tenant_id and conversation_id=conv and direction='outbound' and status in ('pending','retry_scheduled','sending') and actor_type='HUMAN') or exists(select 1 from public.messages where tenant_id=target_tenant_id and conversation_id=conv and status='sending') then raise exception 'conversation still requires human control' using errcode='55000';end if;
  update public.escalation_cases set returned_to_ai_at=b where id=e.id;
  update public.agent_tasks set status='CANCELLED',cancellation_reason='ESCALATION_RETURN_BOUNDARY',completed_at=b where tenant_id=target_tenant_id and conversation_id=conv and created_at<=b and status in ('QUEUED','RUNNING','WAITING_FOR_APPROVAL');
  update public.messages set status='failed',failure_code='ESCALATION_RETURN_BOUNDARY' where tenant_id=target_tenant_id and conversation_id=conv and direction='outbound' and actor_type<>'HUMAN' and status in ('pending','retry_scheduled');
  update public.conversations set runtime_mode='AI_ACTIVE',human_takeover=false,automatic_replies_enabled=true,automatic_replies_enabled_at=b,escalation_return_boundary=b,attention_required=false where id=conv;
 end if;
 if action_value in ('takeover','resolve','assign','acknowledge') then update public.messages set status='failed',failure_code='HUMAN_OWNS_CASE' where id=e.safe_reply_id and status in ('pending','retry_scheduled');end if;
 update public.escalation_cases set revision=revision+1 where id=e.id returning revision into expected_revision;
 perform private.escalation_audit(e.id,action_value,jsonb_build_object('revision',expected_revision,'assignee',case when action_value='assign' then assignee_value else auth.uid() end,'resolution_recorded',action_value='resolve'));
 return expected_revision;end;$$;

create function private.escalation_message_guard() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare e public.escalation_cases%rowtype;c public.conversations%rowtype;begin
 if new.direction<>'outbound' then return new;end if;
 select * into c from public.conversations where tenant_id=new.tenant_id and id=new.conversation_id for update;
 select * into e from public.escalation_cases where tenant_id=new.tenant_id and conversation_id=c.id and status<>'RESOLVED' order by created_at desc limit 1;
 if new.actor_type='HUMAN' then
  if e.id is not null then
   if e.status<>'IN_PROGRESS' or e.assigned_to is distinct from auth.uid() then raise exception 'case takeover required before manual reply' using errcode='42501';end if;
   if exists(select 1 from public.messages where id=e.safe_reply_id and status='sending') then raise exception 'safe response in flight' using errcode='55000';end if;
   update public.messages set status='failed',failure_code='HUMAN_REPLY_SUPERSEDES_ACK' where id=e.safe_reply_id and status in ('pending','retry_scheduled');
  end if;return new;
 end if;
 if new.actor_id='escalation-safe-reply' then
  if e.id is null or private.escalation_rank(e.severity)<3 or new.content is distinct from private.escalation_safe_text(e.locale) or new.reply_to_message_id is distinct from e.source_message_id or new.idempotency_key is distinct from 'escalation-safe:'||e.id::text then raise exception 'safe response authority denied' using errcode='42501';end if;
 elsif (e.id is not null and private.escalation_rank(e.severity)>=3) or (c.escalation_return_boundary is not null and (new.created_at<c.escalation_return_boundary or new.reply_to_message_id is null or exists(select 1 from public.messages where id=new.reply_to_message_id and created_at<c.escalation_return_boundary))) then raise exception 'escalation blocks automatic reply' using errcode='42501';end if;return new;end;$$;
create trigger phase12_outbound_guard before insert on public.messages for each row execute function private.escalation_message_guard();
create function private.escalation_manual_receipt() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if new.direction='outbound' and new.actor_type='HUMAN' and new.status='sent' and old.status is distinct from 'sent' then update public.escalation_cases set first_response_at=coalesce(first_response_at,now()) where tenant_id=new.tenant_id and conversation_id=new.conversation_id and status<>'RESOLVED';end if;return new;end;$$;
create trigger phase12_manual_receipt after update on public.messages for each row execute function private.escalation_manual_receipt();

create function public.escalation_queue_safe_response(target_tenant_id uuid,target_case_id uuid) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare e public.escalation_cases%rowtype;c public.conversations%rowtype;m public.messages%rowtype;mid uuid;conv uuid;begin
 select conversation_id into conv from public.escalation_cases where tenant_id=target_tenant_id and id=target_case_id;
 select * into c from public.conversations where tenant_id=target_tenant_id and id=conv for update;
 select * into e from public.escalation_cases where tenant_id=target_tenant_id and id=target_case_id for update;
 if e.id is null or not private.escalation_enabled(target_tenant_id) or e.safe_reply_id is not null or e.status<>'OPEN' or private.escalation_rank(e.severity)<3 or c.status<>'open' then return null;end if;
 select * into m from public.messages where id=e.source_message_id;
 if m.created_at<now()-interval '5 minutes' or exists(select 1 from public.messages where tenant_id=target_tenant_id and conversation_id=conv and direction='outbound' and (status='sending' or (actor_type='HUMAN' and created_at>=e.created_at))) then return null;end if;
 if not exists(select 1 from public.tenants where id=target_tenant_id and status='active' and outbound_messaging_enabled) or not exists(select 1 from public.messaging_contacts where id=c.messaging_contact_id and contactability in ('user_initiated','allowed')) or not exists(select 1 from public.messaging_provider_connections where id=c.provider_connection_id and status='active') then return null;end if;
 insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_chat_id,reply_to_message_id,reply_to_provider_message_id,idempotency_key,actor_type,actor_id,correlation_id,occurred_at)
 values(target_tenant_id,conv,c.customer_id,c.messaging_contact_id,c.provider_connection_id,'outbound','text',private.escalation_safe_text(e.locale),'pending',m.provider_chat_id,m.id,m.provider_message_id,'escalation-safe:'||e.id::text,'SYSTEM','escalation-safe-reply',gen_random_uuid(),now()) returning id into mid;
 update public.escalation_cases set safe_reply_id=mid where id=e.id;perform private.escalation_audit(e.id,'safe_response_queued',jsonb_build_object('message_id',mid));return mid;end;$$;
create function public.escalation_claim_safe_response(target_tenant_id uuid,target_message_id uuid) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare m public.messages%rowtype;c public.conversations%rowtype;e public.escalation_cases%rowtype;begin
 select * into m from public.messages where tenant_id=target_tenant_id and id=target_message_id;
 select * into c from public.conversations where tenant_id=target_tenant_id and id=m.conversation_id for update;
 select * into e from public.escalation_cases where tenant_id=target_tenant_id and safe_reply_id=m.id for update;
 select * into m from public.messages where id=m.id for update;
 if e.id is null or not private.escalation_enabled(target_tenant_id) or e.status<>'OPEN' or m.status not in ('pending','retry_scheduled') or m.created_at<now()-interval '5 minutes' or (m.retry_after_at is not null and m.retry_after_at>now()) or m.content is distinct from private.escalation_safe_text(e.locale) or not c.human_takeover or not exists(select 1 from public.messaging_provider_connections where id=c.provider_connection_id and status='active') or (select count(*) from public.message_delivery_attempts where message_id=m.id)>=5 or not exists(select 1 from public.tenants where id=target_tenant_id and outbound_messaging_enabled and status='active') or not exists(select 1 from public.messaging_contacts where id=m.messaging_contact_id and contactability in ('user_initiated','allowed')) or exists(select 1 from public.messages where conversation_id=c.id and direction='outbound' and actor_type='HUMAN' and created_at>=e.created_at) then return false;end if;
 update public.messages set status='sending' where id=m.id;return true;end;$$;

create function public.escalation_claim_notification(target_tenant_id uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare n public.escalation_notifications%rowtype;e public.escalation_cases%rowtype;cfg private.escalation_controls%rowtype;begin
 update public.escalation_notifications set status='UNCERTAIN',last_error='LEASE_EXPIRED_DELIVERY_UNKNOWN',lease_token=null where status='RUNNING' and lease_until<now() and (target_tenant_id is null or tenant_id=target_tenant_id);
 select j.* into n from public.escalation_notifications j where j.status='PENDING' and j.available_at<=now() and (target_tenant_id is null or j.tenant_id=target_tenant_id) and private.escalation_enabled(j.tenant_id) order by j.available_at,j.id for update skip locked limit 1;
 if n.id is null then return null;end if;
 select * into cfg from private.escalation_controls where tenant_id=n.tenant_id;
 select * into e from public.escalation_cases where tenant_id=n.tenant_id and id=n.case_id;
 if cfg.chat_id is null then update public.escalation_notifications set status='BLOCKED',last_error='DESTINATION_NOT_CONFIGURED' where id=n.id;return null;end if;
 if e.status='RESOLVED' then update public.escalation_notifications set status='CANCELLED' where id=n.id;return null;end if;
 update public.escalation_notifications set status='RUNNING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where id=n.id returning * into n;
 return jsonb_build_object('id',n.id,'tenant_id',n.tenant_id,'case_id',e.id,'lease_token',n.lease_token,'attempt',n.attempts,'chat_id',cfg.chat_id,'bot_id',cfg.bot_id,'severity',e.severity,'category',e.category,'customer_id',e.customer_id,'waiting_seconds',greatest(0,extract(epoch from now()-e.created_at)::int));end;$$;
create function public.escalation_complete_notification(target_tenant_id uuid,target_job_id uuid,lease_value uuid,result_value jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare n public.escalation_notifications%rowtype;v text:=result_value->>'result';pid text:=result_value->>'provider_message_id';http int:=coalesce((result_value->>'provider_status')::int,0);begin
 select * into n from public.escalation_notifications where tenant_id=target_tenant_id and id=target_job_id for update;
 if n.id is null or n.status<>'RUNNING' or n.lease_token is distinct from lease_value or n.lease_until<=now() then raise exception 'notification lease denied' using errcode='42501';end if;
 if v not in ('SENT','RETRY','FAILED','UNCERTAIN') or v is null or (v='SENT' and (http<>200 or pid is null or pid!~'^[1-9][0-9]*$')) or (v='RETRY' and http<>429) then raise exception 'notification receipt invalid' using errcode='22023';end if;
 insert into public.escalation_notification_attempts(tenant_id,notification_id,attempt,result,provider_status,provider_message_id) values(n.tenant_id,n.id,n.attempts,v,http,case when v='SENT' then pid end);
 update public.escalation_notifications set status=case when v='RETRY' and attempts<5 then 'PENDING' when v='RETRY' then 'FAILED' else v end,
 available_at=now()+make_interval(secs=>least(300,greatest(1,coalesce((result_value->>'retry_after')::int,30)))),lease_token=null,lease_until=null,
 provider_message_id=case when v='SENT' then pid end,sent_at=case when v='SENT' then now() end,last_error=case when v='SENT' then null when v='RETRY' then 'RATE_LIMITED' else v end where id=n.id;
 perform private.escalation_audit(n.case_id,'notification_'||lower(v),jsonb_build_object('notification_id',n.id,'attempt',n.attempts,'provider_status',http,'provider_message_id',case when v='SENT' then pid end));return v='SENT';end;$$;

create function public.admin_escalation_list(target_tenant_id uuid,target_case_id uuid default null,target_conversation_id uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]) then raise exception 'escalation read denied' using errcode='42501';end if;
 if target_case_id is not null and not exists(select 1 from public.escalation_cases where tenant_id=target_tenant_id and id=target_case_id) then raise exception 'case scope denied' using errcode='42501';end if;
 return jsonb_build_object('cases',coalesce((select jsonb_agg(to_jsonb(q)) from (select e.*,greatest(0,extract(epoch from coalesce(e.acknowledged_at,now())-e.created_at)::int) waiting_seconds,
  (select to_jsonb(n)-array['lease_token','lease_until'] from public.escalation_notifications n where n.case_id=e.id) notification
 from public.escalation_cases e where e.tenant_id=target_tenant_id and (target_case_id is null or e.id=target_case_id) and (target_conversation_id is null or e.conversation_id=target_conversation_id)
 order by (e.status='RESOLVED'),private.escalation_rank(e.severity) desc,e.created_at limit 100)q),'[]'),
 'evidence',case when target_case_id is null then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(q)) from (select * from public.escalation_evidence where tenant_id=target_tenant_id and case_id=target_case_id order by created_at limit 100)q),'[]') end,
 'history',case when target_case_id is null then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(q)) from (select * from public.escalation_history where tenant_id=target_tenant_id and case_id=target_case_id order by created_at desc limit 100)q),'[]') end,
 'managers',coalesce((select jsonb_agg(jsonb_build_object('id',user_id,'role',role)) from public.tenant_members where tenant_id=target_tenant_id and status='active' and role in ('manager','super_admin')),'[]'));
end;$$;

-- Explicit table grants/RLS; evidence is append-only. No browser or model mutation API.
do $$declare t text;begin
 foreach t in array array['escalation_cases','escalation_evidence','escalation_history','escalation_notifications','escalation_notification_attempts'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated,service_role',t);
 execute format('create policy escalation_read on public.%I for select to authenticated using(private.has_tenant_role(tenant_id,array[''super_admin'',''manager'',''support'',''analyst'']::public.app_role[]))',t);
 end loop;
 foreach t in array array['escalation_evidence','escalation_history','escalation_notification_attempts'] loop execute format('create trigger immutable before update or delete on public.%I for each row execute function private.entitlement_immutable()',t);end loop;
end;$$;
alter table private.escalation_controls enable row level security;
revoke all on private.escalation_controls from public,anon,authenticated,service_role;
revoke all on function public.configure_phase12_escalation(uuid,boolean,text,text,text),public.escalation_queue_safe_response(uuid,uuid),public.escalation_claim_safe_response(uuid,uuid),public.escalation_claim_notification(uuid),public.escalation_complete_notification(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.configure_phase12_escalation(uuid,boolean,text,text,text),public.escalation_queue_safe_response(uuid,uuid),public.escalation_claim_safe_response(uuid,uuid),public.escalation_claim_notification(uuid),public.escalation_complete_notification(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.admin_escalation_action(uuid,uuid,int,text,uuid,text),public.admin_escalation_list(uuid,uuid,uuid),public.classify_escalation(text) from public,anon,authenticated;
grant execute on function public.admin_escalation_action(uuid,uuid,int,text,uuid,text),public.admin_escalation_list(uuid,uuid,uuid) to authenticated;
grant execute on function public.classify_escalation(text) to service_role;
revoke all on function private.escalation_audit(uuid,text,jsonb),private.escalation_rank(text),private.escalation_enabled(uuid),private.escalation_safe_text(text),private.escalation_open(uuid,uuid,text,text,text,text,uuid),private.escalation_on_inbound(),private.escalation_on_quality(),private.escalation_conversation_guard(),private.escalation_message_guard(),private.escalation_manual_receipt() from public,anon,authenticated,service_role;
