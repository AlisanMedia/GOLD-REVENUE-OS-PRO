-- Fixture-only append-only communication evidence; no consent/legal/LIVE authority.
-- Preserve Phase12's existing namespace; add only dual-controlled, outbound-disabled Polat fixtures with NO notification destination.
create or replace function private.escalation_enabled(t uuid)returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from private.escalation_controls e join public.tenants x on x.id=e.tenant_id where e.tenant_id=t and e.enabled and x.status='active'and(x.slug like 'phase12-sandbox-%'or(x.slug like 'polat-sandbox-%'and not x.outbound_messaging_enabled and e.chat_id is null and e.bot_id is null and exists(select 1 from private.polat_runtime_profiles p join private.polat_conversation_controls c on c.tenant_id=p.tenant_id and c.conversation_id=p.conversation_id where p.tenant_id=t and p.enabled and c.enabled))));
$$;
create table private.polat_contact_evidence(
 tenant_id uuid not null,conversation_id uuid not null,revision bigint not null check(revision>0),evidence_id uuid not null,
 kind text not null,source_message_id uuid,payload jsonb not null,command_hash text not null,previous_hash text,evidence_hash text not null,
 generation bigint not null,actor_id uuid,created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,conversation_id,revision),unique(tenant_id,evidence_id),
 foreign key(tenant_id,conversation_id)references private.polat_runtime_profiles(tenant_id,conversation_id),
 foreign key(tenant_id,source_message_id)references public.messages(tenant_id,id),
 check(kind in('SOURCE_RECORDED','MARKETING_GRANTED','MARKETING_REVOKED','OPT_OUT_RECORDED','CONTACT_SUPPRESSED','SUPPORT_REQUEST_RECORDED','HUMAN_REQUESTED','HUMAN_ACKNOWLEDGED','AI_PAUSED','AI_RESUMED','OFFER_PRESENTED'))
);
create unique index polat_contact_source_once on private.polat_contact_evidence(tenant_id,conversation_id,source_message_id,kind)where source_message_id is not null and kind in('OPT_OUT_RECORDED','SUPPORT_REQUEST_RECORDED','HUMAN_REQUESTED');
create index polat_contact_kind_head on private.polat_contact_evidence(tenant_id,conversation_id,kind,revision desc);
create table private.polat_contact_tickets(
 tenant_id uuid not null,operation_id uuid not null,conversation_id uuid not null,policy_revision bigint not null,generation bigint not null,
 purpose text not null check(purpose in('MARKETING','REQUESTED_SUPPORT')),snapshot_hash text not null,created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,operation_id),foreign key(tenant_id,operation_id)references private.polat_runtime_drafts(tenant_id,operation_id)
);
create trigger polat_contact_immutable before update or delete on private.polat_contact_evidence for each row execute function private.fse_immutable();
create trigger polat_contact_ticket_immutable before update or delete on private.polat_contact_tickets for each row execute function private.fse_immutable();
alter table private.polat_contact_evidence enable row level security;
alter table private.polat_contact_tickets enable row level security;
revoke all on private.polat_contact_evidence,private.polat_contact_tickets from public,anon,authenticated,service_role;
create function private.polat_contact_receipt(e private.polat_contact_evidence)returns jsonb language sql set search_path=pg_catalog as $$
 select jsonb_build_object('version',1,'mode','SYNTHETIC','tenant_id',e.tenant_id,'conversation_id',e.conversation_id,'evidence_id',e.evidence_id,'revision',e.revision::text,'generation',e.generation::text,'kind',e.kind,'evidence_hash',e.evidence_hash,'commit_state','FIXTURE_RECORDED','financial_authority','NONE','live_operations_authorized',false)
$$;
create function private.polat_contact_optout_requested(body text)returns boolean language sql immutable strict set search_path=pg_catalog as $$
 select case when replace(body,'İ','i')~*'((what|explain|mean|nedir).{0,40}unsubscribe|do not unsubscribe|don.t unsubscribe|not asking.{0,20}unsubscribe)'then false
 else replace(body,'İ','i')~*'(unsubscribe|((do not|don.t|stop|no more).{0,30}(contact|messag|marketing))|bir daha.{0,25}(yazma|mesaj)|iletişim istemiyorum)'end
$$;
create function private.polat_contact_record_fixture(t uuid,c uuid,raw_value text)returns jsonb language plpgsql set search_path=pg_catalog as $$
declare v jsonb;p jsonb;k text;h text;rev bigint;g bigint;m uuid;e private.polat_contact_evidence;prev text;cv public.conversations;role_value public.app_role;newgen bigint;d private.polat_runtime_drafts;o public.commercial_offers;proof jsonb;case_value public.escalation_cases;begin
 perform private.polat_runtime_guard(t,c);
 if raw_value is null or octet_length(raw_value)>8192 then raise exception 'Polat contact invalid'using errcode='22023';end if;
 v:=private.fse_strict_json(raw_value);p:=v->'payload';k:=v->>'kind';
 if not private.fse_keys(v,array['version','mode','evidence_id','tenant_id','conversation_id','expected_revision','expected_generation','source_message_id','kind','payload'])or v->'version'is distinct from '1'::jsonb or v->>'mode'is distinct from 'SYNTHETIC'or v->>'tenant_id'is distinct from t::text or v->>'conversation_id'is distinct from c::text
 or not private.fse_strings(v,array['mode','evidence_id','tenant_id','conversation_id','expected_revision','expected_generation','kind'],array['source_message_id'])or v->>'expected_revision'!~'^(0|[1-9][0-9]{0,17})$'or v->>'expected_generation'!~'^[1-9][0-9]{0,17}$'then raise exception 'Polat contact invalid'using errcode='22023';end if;
 select * into strict cv from public.conversations where tenant_id=t and id=c for no key update;
 select generation into strict g from private.polat_conversation_controls where tenant_id=t and conversation_id=c for update;
 m:=(v->>'source_message_id')::uuid;
 if m is not null and not exists(select 1 from public.messages where tenant_id=t and conversation_id=c and id=m and direction='inbound')then raise exception 'Polat contact unavailable'using errcode='42501';end if;
 select role into role_value from public.tenant_members where tenant_id=t and user_id=auth.uid()and status='active';
 if k not in('OPT_OUT_RECORDED','SUPPORT_REQUEST_RECORDED','HUMAN_REQUESTED')and(role_value is null or role_value not in('super_admin','manager','support'))then raise exception 'Polat contact unavailable'using errcode='42501';end if;
 if k in('SOURCE_RECORDED','MARKETING_GRANTED','MARKETING_REVOKED','AI_RESUMED')and role_value not in('super_admin','manager')then raise exception 'Polat contact unavailable'using errcode='42501';end if;
 h:=private.fse_hash(private.fse_canonical(v));select * into e from private.polat_contact_evidence where tenant_id=t and evidence_id=(v->>'evidence_id')::uuid;
 if e.evidence_id is not null then if e.conversation_id<>c or e.command_hash<>h then raise exception 'Polat contact invalid'using errcode='22023';end if;return private.polat_contact_receipt(e);end if;
 select revision,evidence_hash into rev,prev from private.polat_contact_evidence where tenant_id=t and conversation_id=c order by revision desc limit 1;rev:=coalesce(rev,0);
 if rev<>(v->>'expected_revision')::bigint or g<>(v->>'expected_generation')::bigint then raise exception 'Polat contact changed'using errcode='40001';end if;
 if k='SOURCE_RECORDED'then
  if not private.fse_keys(p,array['organization_ref','provenance_hash','lawful_scope','basis','retention_policy_ref'])or not private.fse_strings(p,array['organization_ref','provenance_hash','lawful_scope','basis'],array['retention_policy_ref'])or p->>'organization_ref'!~'^[A-Za-z0-9:_-]{3,100}$'or p->>'provenance_hash'!~'^[a-f0-9]{64}$'or p->>'lawful_scope'not in('UNKNOWN','REQUESTED_SUPPORT_FIXTURE','MARKETING_FIXTURE')or p->>'basis'not in('UNKNOWN','EXPLICIT_REQUEST_FIXTURE','CONSENT_FIXTURE')or(p->>'retention_policy_ref'is not null and p->>'retention_policy_ref'!~'^[A-Za-z0-9:_-]{3,100}$')then raise exception 'Polat contact invalid'using errcode='22023';end if;
 elsif k='MARKETING_GRANTED'then
  if not private.fse_keys(p,array['expires_at','timezone','window_start','window_end'])or not private.fse_strings(p,array['expires_at','timezone'])or jsonb_typeof(p->'window_start')is distinct from 'number'or jsonb_typeof(p->'window_end')is distinct from 'number'or p->>'window_start'!~'^([0-9]|1[0-9]|2[0-3])$'or p->>'window_end'!~'^([1-9]|1[0-9]|2[0-4])$'or p->>'window_start'=p->>'window_end'or not exists(select 1 from pg_timezone_names where name=p->>'timezone')or(p->>'expires_at')::timestamptz<=clock_timestamp()or(p->>'expires_at')::timestamptz>clock_timestamp()+interval '30 days'then raise exception 'Polat contact invalid'using errcode='22023';end if;
  select payload into proof from private.polat_contact_evidence where tenant_id=t and conversation_id=c and kind='SOURCE_RECORDED'order by revision desc limit 1;
  if proof->>'lawful_scope'is distinct from 'MARKETING_FIXTURE'or proof->>'basis'is distinct from 'CONSENT_FIXTURE'or exists(select 1 from private.polat_contact_evidence where tenant_id=t and conversation_id=c and kind in('OPT_OUT_RECORDED','CONTACT_SUPPRESSED'))then raise exception 'Polat contact unavailable'using errcode='42501';end if;
 elsif k in('OPT_OUT_RECORDED','SUPPORT_REQUEST_RECORDED','HUMAN_REQUESTED')then
  if not private.fse_keys(p,array['origin'])or p->>'origin'is distinct from 'CURRENT_CUSTOMER_REQUEST'or m is null or not exists(select 1 from private.polat_conversation_controls where tenant_id=t and conversation_id=c and last_inbound_id=m)then raise exception 'Polat contact unavailable'using errcode='42501';end if;
  if k='OPT_OUT_RECORDED'and not exists(select 1 from public.messages where tenant_id=t and id=m and private.polat_contact_optout_requested(content))then raise exception 'Polat contact unavailable'using errcode='42501';end if;
  if k='HUMAN_REQUESTED'and not exists(select 1 from public.messages where tenant_id=t and id=m and content~*'(speak.{0,20}(human|Polat)|talk.{0,20}(human|Polat)|insanla|temsilci|Polat.{0,15}görüş)')then raise exception 'Polat contact unavailable'using errcode='42501';end if;
 elsif k in('HUMAN_ACKNOWLEDGED','AI_PAUSED','AI_RESUMED')then
  if not private.fse_keys(p,array['origin'])or p->>'origin'is distinct from 'AUTHORIZED_FIXTURE_OPERATOR'then raise exception 'Polat contact invalid'using errcode='22023';end if;
  if k='HUMAN_ACKNOWLEDGED'then
   select * into case_value from public.escalation_cases where tenant_id=t and conversation_id=c and status<>'RESOLVED'order by created_at desc,id desc limit 1;
   if case_value.id is not null then perform public.admin_escalation_action(t,case_value.id,case_value.revision,'takeover');end if;
   select generation into strict g from private.polat_conversation_controls where tenant_id=t and conversation_id=c;
   perform private.polat_claim_human_fixture(t,c,g);
  elsif k='AI_PAUSED'then perform public.set_conversation_runtime_mode(t,c,'PAUSED','SYNTHETIC contact policy',extensions.gen_random_uuid());
  else
   if exists(select 1 from public.escalation_cases where tenant_id=t and conversation_id=c and status<>'RESOLVED')then raise exception 'Polat contact unavailable'using errcode='42501';end if;
   select * into case_value from public.escalation_cases where tenant_id=t and conversation_id=c and status='RESOLVED'and returned_to_ai_at is null order by created_at desc,id desc limit 1;
   if case_value.id is not null then perform public.admin_escalation_action(t,case_value.id,case_value.revision,'return');else perform public.set_conversation_runtime_mode(t,c,'AI_ACTIVE','SYNTHETIC reviewed return',extensions.gen_random_uuid());end if;
  end if;
 elsif k='CONTACT_SUPPRESSED'then
  if not private.fse_keys(p,array['reason'])or not private.fse_strings(p,array['reason'])or p->>'reason'not in('SAFETY','CUSTOMER_REQUEST','UNKNOWN_SCOPE')then raise exception 'Polat contact invalid'using errcode='22023';end if;
 elsif k='MARKETING_REVOKED'then
  if not private.fse_keys(p,array['reason'])or not private.fse_strings(p,array['reason'])or p->>'reason'not in('OWNER_REVIEW','CONSENT_EXPIRED','CUSTOMER_REQUEST')then raise exception 'Polat contact invalid'using errcode='22023';end if;
 elsif k='OFFER_PRESENTED'then
  if not private.fse_keys(p,array['offer_id','draft_id','snapshot_hash'])or not private.fse_strings(p,array['offer_id','draft_id','snapshot_hash'])then raise exception 'Polat contact invalid'using errcode='22023';end if;
  select * into d from private.polat_runtime_drafts where tenant_id=t and conversation_id=c and id=(p->>'draft_id')::uuid and qa_approved;
  select * into o from public.commercial_offers where tenant_id=t and conversation_id=c and id=(p->>'offer_id')::uuid and status='approved';
  if d.id is null or o.id is null or private.fse_hash(private.fse_canonical(o.snapshot))is distinct from p->>'snapshot_hash'or not exists(select 1 from private.polat_response_evidence where tenant_id=t and operation_id=d.operation_id and stage='FAKE_ACK')or not exists(select 1 from private.polat_inbound_work where tenant_id=t and message_id=d.message_id and responded_at is not null)or not exists(select 1 from public.agent_proposals ap cross join lateral jsonb_array_elements(ap.original_payload->'claims')cl where ap.tenant_id=t and ap.id=d.proposal_id and(cl->'evidence_refs')?(o.plan_version_id::text||':fact:1'))then raise exception 'Polat contact unavailable'using errcode='42501';end if;
 else raise exception 'Polat contact invalid'using errcode='22023';end if;
 -- All contact changes fence prepared work through the accepted generation check.
 update private.polat_conversation_controls set generation=generation+1 where tenant_id=t and conversation_id=c returning generation into newgen;
 insert into private.polat_contact_evidence(tenant_id,conversation_id,revision,evidence_id,kind,source_message_id,payload,command_hash,previous_hash,evidence_hash,generation,actor_id)
 values(t,c,rev+1,(v->>'evidence_id')::uuid,k,m,p,h,prev,private.fse_storage_hash(jsonb_build_array('POLAT_CONTACT1',t,c,(rev+1)::text,h,prev,newgen::text)),newgen,auth.uid())returning * into e;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(t,case when auth.uid()is null then 'SYSTEM'::public.audit_actor_type else 'HUMAN'::public.audit_actor_type end,auth.uid(),'polat.contact_evidence','conversations',c::text,jsonb_build_object('kind',k,'revision',rev+1,'generation',newgen,'financial_authority','NONE','mode','SYNTHETIC'));
 return private.polat_contact_receipt(e);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'Polat contact invalid'using errcode='22023';end;$$;
create function private.polat_contact_snapshot(t uuid,c uuid)returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare e private.polat_contact_evidence;grant_event private.polat_contact_evidence;rev bigint;ctrl private.polat_conversation_controls;cv public.conversations;out_flag boolean;sup boolean;begin
 select * into strict ctrl from private.polat_conversation_controls where tenant_id=t and conversation_id=c;
 select * into strict cv from public.conversations where tenant_id=t and id=c;
 select revision into rev from private.polat_contact_evidence where tenant_id=t and conversation_id=c order by revision desc limit 1;
 select * into e from private.polat_contact_evidence where tenant_id=t and conversation_id=c and kind='SOURCE_RECORDED'order by revision desc limit 1;
 select * into grant_event from private.polat_contact_evidence where tenant_id=t and conversation_id=c and kind in('MARKETING_GRANTED','MARKETING_REVOKED')order by revision desc limit 1;
 select exists(select 1 from private.polat_contact_evidence where tenant_id=t and conversation_id=c and kind='OPT_OUT_RECORDED'),exists(select 1 from private.polat_contact_evidence where tenant_id=t and conversation_id=c and kind='CONTACT_SUPPRESSED')into out_flag,sup;
 return jsonb_build_object('version',1,'mode','SYNTHETIC','revision',coalesce(rev,0)::text,'generation',ctrl.generation::text,'lawful_scope',coalesce(e.payload->>'lawful_scope','UNKNOWN'),'provenance_known',e.evidence_id is not null and e.payload->>'basis'<>'UNKNOWN','marketing_granted',coalesce(grant_event.kind='MARKETING_GRANTED',false),'marketing_expires_at',case when grant_event.kind='MARKETING_GRANTED'then grant_event.payload->'expires_at'else 'null'::jsonb end,'opted_out',out_flag,'suppressed',sup,'ownership',case when cv.runtime_mode='HUMAN_TAKEOVER'or cv.human_takeover then 'HUMAN_ACTIVE'else cv.runtime_mode::text end,'human_acknowledged',ctrl.human_owner is not null,'financial_authority','NONE','live_operations_authorized',false);
end;$$;
create function private.polat_contact_allowed(t uuid,c uuid,purpose_value text,exclude_operation uuid default null)returns boolean language plpgsql stable set search_path=pg_catalog as $$declare s jsonb;grant_payload jsonb;local_hour integer;start_hour integer;end_hour integer;begin
 s:=private.polat_contact_snapshot(t,c);
 if purpose_value not in('MARKETING','REQUESTED_SUPPORT')or s->>'lawful_scope'='UNKNOWN'or s->>'provenance_known'<>'true'or s->>'suppressed'='true'or s->>'ownership'<>'AI_ACTIVE'or exists(select 1 from public.escalation_cases where tenant_id=t and conversation_id=c and status<>'RESOLVED')then return false;end if;
 if purpose_value='REQUESTED_SUPPORT'then return exists(select 1 from private.polat_contact_evidence e join private.polat_conversation_controls ctrl on ctrl.tenant_id=e.tenant_id and ctrl.conversation_id=e.conversation_id and ctrl.last_inbound_id=e.source_message_id where e.tenant_id=t and e.conversation_id=c and e.kind='SUPPORT_REQUEST_RECORDED');end if;
 if s->>'lawful_scope'<>'MARKETING_FIXTURE'or s->>'marketing_granted'<>'true'or s->>'opted_out'='true'or(s->>'marketing_expires_at')is null or(s->>'marketing_expires_at')::timestamptz<=statement_timestamp()then return false;end if;
 select payload into grant_payload from private.polat_contact_evidence where tenant_id=t and conversation_id=c and kind='MARKETING_GRANTED'order by revision desc limit 1;
 local_hour:=extract(hour from statement_timestamp()at time zone(grant_payload->>'timezone'));start_hour:=(grant_payload->>'window_start')::integer;end_hour:=(grant_payload->>'window_end')::integer;
 if not(case when start_hour<end_hour then local_hour>=start_hour and local_hour<end_hour else local_hour>=start_hour or local_hour<end_hour end)then return false;end if;
 if exists(select 1 from private.polat_contact_tickets x where x.tenant_id=t and x.conversation_id=c and x.purpose='MARKETING'and x.operation_id is distinct from exclude_operation and x.created_at>statement_timestamp()-interval '24 hours')or(select count(*)from(select 1 from private.polat_contact_tickets x where x.tenant_id=t and x.conversation_id=c and x.purpose='MARKETING'and x.operation_id is distinct from exclude_operation and x.created_at>statement_timestamp()-interval '7 days'limit 3)bounded)>=3 then return false;end if;
 return true;
end;$$;
create function private.polat_contact_source_event(t uuid,c uuid,m uuid,k text)returns jsonb language plpgsql set search_path=pg_catalog as $$declare e private.polat_contact_evidence;rev bigint;g bigint;begin
 select * into e from private.polat_contact_evidence where tenant_id=t and conversation_id=c and source_message_id=m and kind=k;
 if e.evidence_id is not null then return private.polat_contact_receipt(e);end if;
 select coalesce((select revision from private.polat_contact_evidence where tenant_id=t and conversation_id=c order by revision desc limit 1),0),generation into rev,g from private.polat_conversation_controls where tenant_id=t and conversation_id=c;
 return private.polat_contact_record_fixture(t,c,jsonb_build_object('version',1,'mode','SYNTHETIC','evidence_id',extensions.gen_random_uuid(),'tenant_id',t,'conversation_id',c,'expected_revision',rev::text,'expected_generation',g::text,'source_message_id',m,'kind',k,'payload',jsonb_build_object('origin','CURRENT_CUSTOMER_REQUEST'))::text);
end;$$;
create function public.polat_test_contact_for_source_v1(target_tenant_id uuid,target_conversation_id uuid,target_event_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare m uuid;body text;g bigint;begin
 perform private.polat_runtime_guard(target_tenant_id,target_conversation_id);
 perform 1 from public.conversations where tenant_id=target_tenant_id and id=target_conversation_id for no key update;
 select x.id,x.content into m,body from public.messages x join public.domain_events e on e.tenant_id=x.tenant_id and e.payload->>'message_id'=x.id::text join private.polat_conversation_controls ctrl on ctrl.tenant_id=x.tenant_id and ctrl.conversation_id=x.conversation_id and ctrl.last_inbound_id=x.id
 where x.tenant_id=target_tenant_id and x.conversation_id=target_conversation_id and e.id=target_event_id and e.event_type='message.received'and x.direction='inbound';
 if m is null then raise exception 'Polat contact source unavailable'using errcode='42501';end if;
 perform private.polat_contact_source_event(target_tenant_id,target_conversation_id,m,'SUPPORT_REQUEST_RECORDED');
 if private.polat_contact_optout_requested(body)then perform private.polat_contact_source_event(target_tenant_id,target_conversation_id,m,'OPT_OUT_RECORDED');end if;
 if body~*'(speak.{0,20}(human|Polat)|talk.{0,20}(human|Polat)|insanla|temsilci|Polat.{0,15}görüş)'then
  perform private.polat_contact_source_event(target_tenant_id,target_conversation_id,m,'HUMAN_REQUESTED');
  select generation into strict g from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=target_conversation_id;
  perform private.polat_hold_fixture(target_tenant_id,m,g,'QA_HOLD');
 end if;
 return private.polat_contact_snapshot(target_tenant_id,target_conversation_id);
end;$$;
create function public.polat_test_contact_ticket_v1(target_tenant_id uuid,draft_id_value uuid,purpose_value text default 'REQUESTED_SUPPORT')returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d private.polat_runtime_drafts;s jsonb;ticket private.polat_contact_tickets;begin
 select * into d from private.polat_runtime_drafts where tenant_id=target_tenant_id and id=draft_id_value and qa_approved;
 if d.id is null then raise exception 'Polat contact unavailable'using errcode='42501';end if;
 perform private.polat_runtime_guard(target_tenant_id,d.conversation_id);
 perform 1 from public.conversations where tenant_id=target_tenant_id and id=d.conversation_id for no key update;
 perform 1 from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=d.conversation_id for update;
 s:=private.polat_contact_snapshot(target_tenant_id,d.conversation_id);
 if purpose_value is null or purpose_value not in('MARKETING','REQUESTED_SUPPORT')then raise exception 'Polat contact invalid'using errcode='22023';end if;
 select * into ticket from private.polat_contact_tickets where tenant_id=target_tenant_id and operation_id=d.operation_id;
 if s->>'generation'<>d.generation::text or not private.polat_contact_allowed(target_tenant_id,d.conversation_id,purpose_value,d.operation_id)or(ticket.operation_id is not null and(ticket.purpose<>purpose_value or ticket.policy_revision::text<>s->>'revision'or ticket.generation<>d.generation))then
  perform private.polat_set_work(target_tenant_id,d.message_id,'HUMAN_HANDOFF_PENDING','CONTACT_POLICY_REVIEW');
  return jsonb_build_object('state','REVIEW','financial_authority','NONE','live_operations_authorized',false);
 end if;
 if ticket.operation_id is null then insert into private.polat_contact_tickets values(target_tenant_id,d.operation_id,d.conversation_id,(s->>'revision')::bigint,d.generation,purpose_value,private.fse_hash(private.fse_canonical(s)),clock_timestamp());end if;
 return jsonb_build_object('state','FAKE_ELIGIBLE','revision',s->>'revision','generation',d.generation::text,'financial_authority','NONE','live_operations_authorized',false);
end;$$;
create function private.polat_contact_ticket_current(t uuid,op uuid)returns boolean language plpgsql stable set search_path=pg_catalog as $$declare x private.polat_contact_tickets;s jsonb;begin
 select * into x from private.polat_contact_tickets where tenant_id=t and operation_id=op;if x.operation_id is null then return false;end if;
 s:=private.polat_contact_snapshot(t,x.conversation_id);
 return s->>'revision'=x.policy_revision::text and s->>'generation'=x.generation::text and private.polat_contact_allowed(t,x.conversation_id,x.purpose,op);
end;$$;
create or replace function public.polat_test_runtime_prepare_v1(target_tenant_id uuid,draft_id_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare d private.polat_runtime_drafts;begin
 select * into d from private.polat_runtime_drafts where tenant_id=target_tenant_id and id=draft_id_value;if d.id is null or not d.qa_approved then raise exception 'Polat draft unavailable'using errcode='42501';end if;perform private.polat_runtime_guard(target_tenant_id,d.conversation_id);
 if not private.polat_contact_ticket_current(target_tenant_id,d.operation_id)then
  perform private.polat_set_work(target_tenant_id,d.message_id,'HUMAN_HANDOFF_PENDING','CONTACT_POLICY_REVIEW');return jsonb_build_object('state','HUMAN_HANDOFF_PENDING','financial_authority','NONE');
 end if;
 return private.polat_prepare_fixture(d.tenant_id,d.message_id,d.operation_id,d.generation,d.source_hash,d.body_hash,'AI');
end;$$;
create or replace function public.polat_test_runtime_can_send_v1(target_tenant_id uuid,draft_id_value uuid)returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$declare d private.polat_runtime_drafts;begin
 select * into d from private.polat_runtime_drafts where tenant_id=target_tenant_id and id=draft_id_value;if d.id is null or not d.qa_approved then return false;end if;perform private.polat_runtime_guard(target_tenant_id,d.conversation_id);
 return private.polat_contact_ticket_current(target_tenant_id,d.operation_id)and private.polat_can_dispatch_fixture(d.tenant_id,d.operation_id,d.generation);
end;$$;
-- Fixture provenance setup is deliberately PostgreSQL-owned, not a browser/service writer.
create function private.polat_contact_configure_fixture(t uuid,c uuid,scope_value text default 'REQUESTED_SUPPORT_FIXTURE')returns jsonb language plpgsql set search_path=pg_catalog as $$declare g bigint;rev bigint;begin
 perform private.polat_runtime_guard(t,c);
 insert into private.escalation_controls(tenant_id,enabled,approval_reference,activated_at)values(t,true,'POLAT_SYNTHETIC_NO_NOTIFICATION_DESTINATION',(select activation_at from private.polat_conversation_controls where tenant_id=t and conversation_id=c))on conflict(tenant_id)do nothing;
 select generation into strict g from private.polat_conversation_controls where tenant_id=t and conversation_id=c;
 select coalesce((select revision from private.polat_contact_evidence where tenant_id=t and conversation_id=c order by revision desc limit 1),0)into rev;
 return private.polat_contact_record_fixture(t,c,jsonb_build_object('version',1,'mode','SYNTHETIC','evidence_id',extensions.gen_random_uuid(),'tenant_id',t,'conversation_id',c,'expected_revision',rev::text,'expected_generation',g::text,'source_message_id',null,'kind','SOURCE_RECORDED','payload',jsonb_build_object('organization_ref','fixture:organization','provenance_hash',private.fse_hash('Synthetic owner-approved test fixture'),'lawful_scope',scope_value,'basis',case scope_value when 'MARKETING_FIXTURE'then 'CONSENT_FIXTURE'when 'REQUESTED_SUPPORT_FIXTURE'then 'EXPLICIT_REQUEST_FIXTURE'else 'UNKNOWN'end,'retention_policy_ref',null))::text);
end;$$;
do $$declare fn record;begin
 for fn in select oid::regprocedure sig from pg_proc where pronamespace='private'::regnamespace and proname like 'polat_contact_%'loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.sig);end loop;
 for fn in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and proname like 'polat_test_contact_%'loop execute format('revoke all on function %s from public,anon,authenticated',fn.sig);execute format('grant execute on function %s to service_role',fn.sig);end loop;
end;$$;
create function public.admin_polat_contact_page_v1(target_tenant_id uuid,conversation_value uuid,page_size_value integer default 25,cursor_value jsonb default null)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare role_value public.app_role;rev bigint;g bigint;b bigint;exp timestamptz;rows_value jsonb;more boolean;next_value jsonb;begin
 select role into role_value from public.tenant_members where tenant_id=target_tenant_id and user_id=auth.uid()and status='active';
 if role_value is null or role_value not in('super_admin','manager','support','analyst')or not exists(select 1 from private.polat_runtime_profiles where tenant_id=target_tenant_id and conversation_id=conversation_value)then raise exception 'Polat contact read unavailable'using errcode='42501';end if;
 if page_size_value is null or page_size_value<1 or page_size_value>100 then raise exception 'Polat contact page invalid'using errcode='22023';end if;
 select coalesce((select revision from private.polat_contact_evidence where tenant_id=target_tenant_id and conversation_id=conversation_value order by revision desc limit 1),0),generation into rev,g from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=conversation_value;
 b:=null;exp:=statement_timestamp()+interval '30 minutes';
 if cursor_value is not null then
  if not private.fse_keys(cursor_value,array['v','tenant','user','role','conversation','size','revision','generation','before','expires'])or not private.fse_strings(cursor_value,array['tenant','user','role','conversation','revision','generation','before','expires'])or cursor_value->'v'is distinct from '1'::jsonb or cursor_value->'size'is distinct from to_jsonb(page_size_value)or cursor_value->>'tenant'is distinct from target_tenant_id::text or cursor_value->>'conversation'is distinct from conversation_value::text or cursor_value->>'user'is distinct from auth.uid()::text or cursor_value->>'role'is distinct from role_value::text or cursor_value->>'revision'is distinct from rev::text or cursor_value->>'generation'is distinct from g::text or cursor_value->>'before'!~'^[1-9][0-9]{0,17}$'then raise exception 'Polat contact page invalid'using errcode='22023';end if;
  b:=(cursor_value->>'before')::bigint;exp:=(cursor_value->>'expires')::timestamptz;
  if b>rev or not exists(select 1 from private.polat_contact_evidence where tenant_id=target_tenant_id and conversation_id=conversation_value and revision=b)or exp<=statement_timestamp()or exp>statement_timestamp()+interval '30 minutes'then raise exception 'Polat contact page invalid'using errcode='22023';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('revision',e.revision::text,'kind',e.kind,'created_at',e.created_at,'actor',case when e.actor_id is null then 'SOURCE'else 'OPERATOR'end,'organization_ref',case when role_value in('super_admin','manager','support')and e.kind='SOURCE_RECORDED'then e.payload->>'organization_ref'end)order by e.revision desc),'[]'::jsonb)into rows_value from(select revision,kind,created_at,actor_id,payload from private.polat_contact_evidence where tenant_id=target_tenant_id and conversation_id=conversation_value and revision<=rev and(b is null or revision<b)order by revision desc limit page_size_value+1)e;
 more:=jsonb_array_length(rows_value)>page_size_value;
 if more then next_value:=jsonb_build_object('v',1,'tenant',target_tenant_id,'user',auth.uid(),'role',role_value,'conversation',conversation_value,'size',page_size_value,'revision',rev::text,'generation',g::text,'before',rows_value->(page_size_value-1)->>'revision','expires',exp);end if;
 if (select generation from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=conversation_value)<>g then raise exception 'Polat contact page changed'using errcode='22023';end if;
 return jsonb_build_object('version',1,'mode','SYNTHETIC','items',(select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb)from jsonb_array_elements(rows_value)with ordinality where ordinality<=page_size_value),'snapshot',private.polat_contact_snapshot(target_tenant_id,conversation_value),'page_size',page_size_value,'has_more',more,'next_cursor',next_value,'financial_authority','NONE','live_operations_authorized',false);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'Polat contact page invalid'using errcode='22023';end;$$;
revoke all on function public.admin_polat_contact_page_v1(uuid,uuid,integer,jsonb)from public,anon,service_role;
grant execute on function public.admin_polat_contact_page_v1(uuid,uuid,integer,jsonb)to authenticated;

create or replace function private.polat_work_projection(w private.polat_inbound_work)returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare cv public.conversations;ctrl private.polat_conversation_controls;s text:=w.state;r text:=w.reason;assigned boolean;begin
 select * into strict cv from public.conversations where tenant_id=w.tenant_id and id=w.conversation_id;
 select * into strict ctrl from private.polat_conversation_controls where tenant_id=w.tenant_id and conversation_id=w.conversation_id;
 assigned:=ctrl.human_owner is not null and exists(select 1 from public.tenant_members where tenant_id=w.tenant_id and user_id=ctrl.human_owner and status='active'and role in('super_admin','manager','support'));
 if s not in('AI_RESPONDED','CLOSED_WITH_EVIDENCE','DELIVERY_UNKNOWN')then
  if cv.runtime_mode='PAUSED'then s:='BLOCKED_WITH_REASON';r:='PAUSED';
  elsif cv.runtime_mode='HUMAN_TAKEOVER'or cv.human_takeover then s:=case when assigned then 'HUMAN_OWNED'else 'HUMAN_HANDOFF_PENDING'end;r:='HUMAN_CONTROL';
  elsif ctrl.last_inbound_id is distinct from w.message_id or(ctrl.return_boundary is not null and w.received_at<ctrl.return_boundary)then s:='HUMAN_HANDOFF_PENDING';r:='STALE_SOURCE';end if;
 end if;
 return jsonb_build_object('message_id',w.message_id,'conversation_id',w.conversation_id,'case_id',coalesce(w.resolution_case_id,(select e.id from public.escalation_cases e where e.tenant_id=w.tenant_id and e.conversation_id=w.conversation_id and(e.source_message_id=w.message_id or exists(select 1 from public.escalation_evidence z where z.tenant_id=w.tenant_id and z.case_id=e.id and z.message_id=w.message_id))order by e.created_at desc,e.id desc limit 1)),'state',s,'reason',r,'owner_mode',case when cv.runtime_mode='HUMAN_TAKEOVER'then 'HUMAN_ACTIVE'else cv.runtime_mode::text end,
  'human_assigned',assigned,'eligible_at_receipt',w.eligible_at_receipt,'received_at',w.received_at,'sandbox_ack_at',w.responded_at,'revision',w.revision::text,'overdue',w.responded_at is null and s not in('BLOCKED_WITH_REASON','CLOSED_WITH_EVIDENCE')and w.received_at<statement_timestamp()-interval '30 seconds','delivery',case when w.responded_at is not null then 'FAKE_ACKNOWLEDGED'when s='DELIVERY_UNKNOWN'then 'UNKNOWN'else 'NOT_CONFIRMED'end,
  'mode','SYNTHETIC','financial_authority','NONE','live_operations_authorized',false);
end;$$;
revoke all on function private.polat_work_projection(private.polat_inbound_work)from public,anon,authenticated,service_role;

create or replace function private.escalation_open(t uuid,mid uuid,cat text,sev text,loc text,kind text,sid uuid) returns uuid language plpgsql set search_path=pg_catalog as $$
declare m public.messages%rowtype;c public.conversations%rowtype;e public.escalation_cases%rowtype;eid uuid;new_evidence uuid;begin
 if not private.escalation_enabled(t) then return null;end if;
 select * into m from public.messages where tenant_id=t and id=mid and direction='inbound';
 if m.id is null or m.created_at<(select activated_at from private.escalation_controls where tenant_id=t) or m.created_at<now()-interval '5 minutes' then return null;end if;
 select * into c from public.conversations where tenant_id=t and id=m.conversation_id for update;
 if c.escalation_return_boundary is not null and m.created_at<c.escalation_return_boundary then return null;end if;
 -- Operator resolution is authoritative for that source, including a later/retried QA run.
 if exists(select 1 from public.escalation_cases prior_case join public.escalation_evidence prior_evidence on prior_evidence.case_id=prior_case.id and prior_evidence.tenant_id=prior_case.tenant_id where prior_case.tenant_id=t and prior_case.status='RESOLVED' and prior_evidence.message_id=mid) then return null;end if;
 -- TEST integration: pause a high-risk Polat fixture before the attention-only update.
 -- Native guard treats AI_ACTIVE + automatic_replies=false conservatively. Do not relax it.
 if private.escalation_rank(sev)>=3 and c.runtime_mode='AI_ACTIVE'and not c.automatic_replies_enabled
 and exists(select 1 from private.polat_runtime_profiles p join private.polat_conversation_controls pc on pc.tenant_id=p.tenant_id and pc.conversation_id=p.conversation_id join public.tenants tt on tt.id=p.tenant_id join private.escalation_controls ec on ec.tenant_id=tt.id where p.tenant_id=t and p.conversation_id=c.id and p.enabled and pc.enabled and tt.slug like 'polat-sandbox-%'and not tt.outbound_messaging_enabled and ec.enabled and ec.chat_id is null and ec.bot_id is null)then
  update public.conversations set runtime_mode='HUMAN_TAKEOVER',human_takeover=true,automatic_replies_enabled=false,automatic_replies_enabled_at=null where tenant_id=t and id=c.id;
 end if;
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
  update public.messages set status='failed',failure_code='ESCALATION_HOLD' where id in (select id from public.messages where tenant_id=t and conversation_id=c.id and direction='outbound' and actor_id='quality-approved-reply' and status in ('pending','retry_scheduled') for update skip locked);
  insert into public.escalation_notifications(tenant_id,case_id,status,last_error) select t,e.id,case when chat_id is null then 'BLOCKED' else 'PENDING' end,case when chat_id is null then 'DESTINATION_NOT_CONFIGURED' end from private.escalation_controls where tenant_id=t on conflict(case_id) do nothing;
 end if;return e.id;end;$$;
