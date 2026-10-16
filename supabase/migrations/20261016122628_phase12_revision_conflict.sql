-- Business revision conflicts must return HTTP 409, not enter serialization retry loops.
-- Preserves the accepted Phase 12 authorization, row locks, revision check and audit.
create or replace function public.admin_escalation_action(target_tenant_id uuid,target_case_id uuid,expected_revision int,action_value text,assignee_value uuid default null,note_value text default null) returns int language plpgsql security definer set search_path=pg_catalog as $$
declare e public.escalation_cases%rowtype;conv uuid;b timestamptz:=clock_timestamp();begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[]) then raise exception 'escalation control denied' using errcode='42501';end if;
 select conversation_id into conv from public.escalation_cases where tenant_id=target_tenant_id and id=target_case_id;
 perform 1 from public.conversations where tenant_id=target_tenant_id and id=conv for update;
 select * into e from public.escalation_cases where tenant_id=target_tenant_id and id=target_case_id for update;
 if e.id is null then raise exception 'case scope denied' using errcode='42501';end if;
 if e.revision is distinct from expected_revision then raise exception 'case revision conflict' using errcode='PT409';end if;
 if action_value not in ('assign','acknowledge','takeover','resolve','return') or action_value is null then raise exception 'case action invalid' using errcode='22023';end if;
 if e.status='RESOLVED' and action_value<>'return' then raise exception 'case already resolved' using errcode='55000';end if;
 if action_value='assign' then
  if not exists(select 1 from public.tenant_members where tenant_id=target_tenant_id and user_id=assignee_value and status='active' and role in ('manager','super_admin')) then raise exception 'active tenant manager required' using errcode='42501';end if;
  update public.escalation_cases set assigned_to=assignee_value where id=e.id;
 elsif action_value='acknowledge' then update public.escalation_cases set status=case when status='IN_PROGRESS' then status else 'ACKNOWLEDGED' end,acknowledged_at=coalesce(acknowledged_at,b),assigned_to=coalesce(assigned_to,auth.uid()) where id=e.id;
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
  update public.agent_tasks set status='CANCELLED',cancellation_reason='ESCALATION_RETURN_BOUNDARY',completed_at=b where id in (select id from public.agent_tasks where tenant_id=target_tenant_id and conversation_id=conv and created_at<=b and status in ('QUEUED','WAITING_FOR_APPROVAL') for update skip locked);
  update public.messages set status='failed',failure_code='ESCALATION_RETURN_BOUNDARY' where id in (select id from public.messages where tenant_id=target_tenant_id and conversation_id=conv and direction='outbound' and actor_type<>'HUMAN' and status in ('pending','retry_scheduled') for update skip locked);
  update public.conversations set runtime_mode='AI_ACTIVE',human_takeover=false,automatic_replies_enabled=true,automatic_replies_enabled_at=b,escalation_return_boundary=b,attention_required=false where id=conv;
 end if;
 if action_value in ('takeover','resolve','assign','acknowledge') then update public.messages set status='failed',failure_code='HUMAN_OWNS_CASE' where id=e.safe_reply_id and status in ('pending','retry_scheduled');end if;
 update public.escalation_cases set revision=revision+1 where id=e.id returning revision into expected_revision;
 perform private.escalation_audit(e.id,action_value,jsonb_build_object('revision',expected_revision,'assignee',case when action_value='assign' then assignee_value else auth.uid() end,'resolution_recorded',action_value='resolve'));
 return expected_revision;end;$$;
