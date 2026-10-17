-- Phase 14 correction: fresh survey evidence must not disappear because its conversation anchor is old.
-- No new message, provider dispatch, financial or entitlement authority.
create or replace function private.survey_eligibility(t uuid,v_id uuid,c_id uuid,conversation_value uuid,requested boolean default false,exclude_invitation uuid default null) returns jsonb language plpgsql stable set search_path=pg_catalog as $$
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
 if c.id is not null and not exists(select 1 from public.messages msg where msg.tenant_id=t and msg.conversation_id=c.id and msg.direction='inbound') then b:=b||'"CONVERSATION_EVIDENCE_REQUIRED"'::jsonb;end if;
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
 fp:=md5(jsonb_build_object('inbound_anchor',(select msg.id from public.messages msg where msg.tenant_id=t and msg.conversation_id=c.id and msg.direction='inbound' order by msg.created_at desc,msg.id desc limit 1),'customer',c_id,'state',st,'conversation',c.id,'contact',m.updated_at,'conversation_updated',c.updated_at,'return',c.escalation_return_boundary,'subscription',s.id,'revision',s.revision,'state_sub',s.state,'access',a.id,'membership',a.status,'checked',a.membership_checked_at,'policy',p.revision,'grant',g.revision,'version',v.revision)::text);
 return jsonb_build_object('review_ready',jsonb_array_length(b)=0,'invitation_eligible',false,'send_enabled',false,'blockers',b,'delivery_blockers',jsonb_build_array('OUTBOUND_DISABLED','PREVIEW_ONLY'),'mode','SIMULATED','language',coalesce(p.preferred_language,'en'),'source_fingerprint',fp,'consent_revision',coalesce(g.revision,0),'policy_revision',coalesce(p.revision,0));
end;$$;

create or replace function private.survey_escalate(r_id uuid) returns uuid language plpgsql set search_path=pg_catalog as $$declare r private.survey_identified_responses%rowtype;cl jsonb;c public.conversations%rowtype;m public.messages%rowtype;e public.escalation_cases%rowtype;ev uuid;begin
 select * into r from private.survey_identified_responses where id=r_id;
 cl:=private.survey_classify((select definition from public.survey_versions where id=r.version_id),r.answers);
 if cl is null or private.escalation_rank(cl->>'severity')<3 then return null;end if;
 if not private.survey_enabled(r.tenant_id) or r.completed_at<now()-interval '5 minutes' then raise exception 'survey review source changed' using errcode='PT409';end if;
 select * into c from public.conversations where tenant_id=r.tenant_id and id=r.conversation_id and customer_id=r.customer_id for update;
 select * into m from public.messages where tenant_id=r.tenant_id and conversation_id=c.id and direction='inbound' order by created_at desc,id desc limit 1;
 -- The fresh identified survey is the current source. An older real inbound only anchors its conversation.
 -- A changed return boundary or missing anchor must roll back, never silently accept an untriaged complaint.
 if m.id is null or r.completed_at<coalesce(c.escalation_return_boundary,'-infinity') then raise exception 'survey review source changed' using errcode='PT409';end if;
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
revoke all on function private.survey_eligibility(uuid,uuid,uuid,uuid,boolean,uuid),private.survey_escalate(uuid) from public,anon,authenticated,service_role;
