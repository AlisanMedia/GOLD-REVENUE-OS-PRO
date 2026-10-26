-- Native, invitation-scoped UAT integration. No global outbound, financial or LIVE VIP authority.

create or replace function public.claim_conversation_reply_tasks(
  target_tenant_id uuid, target_conversation_id uuid, worker_id_value text,
  batch_size_value integer default 10,
  lease_seconds_value integer default 120
)
returns table (
  task_id uuid, tenant_id uuid, agent_version_id uuid, customer_id uuid,
  conversation_id uuid, source_event_id uuid, task_type text,
  execution_mode public.agent_execution_mode, correlation_id uuid,
  causation_id uuid, attempt_number integer, timeout_ms integer,
  model_provider text, model_name text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if nullif(btrim(worker_id_value),'') is null then
    raise exception 'worker_id is required' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select at.id
    from public.agent_tasks at
    where not exists(select 1 from private.private_beta_programs beta where beta.tenant_id=at.tenant_id) and at.tenant_id=target_tenant_id and at.conversation_id=target_conversation_id and ((
      at.status = 'QUEUED' and at.available_at <= now()
    ) or (
      at.status = 'RUNNING'
      and at.locked_at < now() - make_interval(secs => greatest(30, least(lease_seconds_value,3600)))
    )
    )
    and private.conversation_reply_source_ready(at.tenant_id,at.id)
    and pg_try_advisory_xact_lock(hashtextextended(at.tenant_id::text||':'||at.conversation_id::text,0))
    and not exists(select 1 from public.agent_tasks busy where busy.tenant_id=at.tenant_id
      and busy.conversation_id=at.conversation_id and busy.id<>at.id and busy.status='RUNNING'
      and busy.locked_at>=now()-make_interval(secs=>greatest(30,least(lease_seconds_value,3600))))
    order by at.priority desc, at.available_at, at.created_at, at.id
    for update skip locked
    limit greatest(1,least(batch_size_value,50))
  ), claimed as (
    update public.agent_tasks at
    set status = 'RUNNING', attempts = at.attempts + 1,
        locked_at = now(), locked_by = left(worker_id_value,120),
        started_at = coalesce(at.started_at,now()),
        timeout_at = now() + make_interval(secs => greatest(1,av.timeout_ms / 1000))
    from candidates c, public.agent_versions av
    where at.id = c.id and av.tenant_id = at.tenant_id and av.id = at.agent_version_id
    returning at.*, av.timeout_ms, av.model_provider, av.model_name
  ), logged as (
    insert into public.agent_run_attempts (
      tenant_id, task_id, attempt_number, stage, worker_id
    ) select c.tenant_id, c.id, c.attempts, 'claimed', left(worker_id_value,120)
      from claimed c returning id
  )
  select c.id, c.tenant_id, c.agent_version_id, c.customer_id,
    c.conversation_id, c.source_event_id, c.task_type, c.execution_mode,
    c.correlation_id, c.causation_id, c.attempts, c.timeout_ms,
    c.model_provider, c.model_name
  from claimed c;
end;
$$;

create or replace function public.claim_agent_tasks(
  worker_id_value text,
  batch_size_value integer default 10,
  lease_seconds_value integer default 120
)
returns table (
  task_id uuid, tenant_id uuid, agent_version_id uuid, customer_id uuid,
  conversation_id uuid, source_event_id uuid, task_type text,
  execution_mode public.agent_execution_mode, correlation_id uuid,
  causation_id uuid, attempt_number integer, timeout_ms integer,
  model_provider text, model_name text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if nullif(btrim(worker_id_value),'') is null then
    raise exception 'worker_id is required' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select at.id
    from public.agent_tasks at
    where not exists(select 1 from private.private_beta_programs beta where beta.tenant_id=at.tenant_id) and ((
      at.status = 'QUEUED' and at.available_at <= now()
    ) or (
      at.status = 'RUNNING'
      and at.locked_at < now() - make_interval(secs => greatest(30, least(lease_seconds_value,3600)))
    )
    ) and (at.conversation_id is null or not exists (
      select 1 from public.conversations cv where cv.tenant_id=at.tenant_id
        and cv.id=at.conversation_id and cv.automatic_replies_enabled
    ) or (
      private.conversation_reply_source_ready(at.tenant_id,at.id)
      and pg_try_advisory_xact_lock(hashtextextended(at.tenant_id::text||':'||at.conversation_id::text,0))
      and not exists(select 1 from public.agent_tasks busy where busy.tenant_id=at.tenant_id
        and busy.conversation_id=at.conversation_id and busy.id<>at.id and busy.status='RUNNING'
        and busy.locked_at>=now()-make_interval(secs=>greatest(30,least(lease_seconds_value,3600))))
    ))
    order by at.priority desc, at.available_at, at.created_at, at.id
    for update skip locked
    limit greatest(1,least(batch_size_value,50))
  ), claimed as (
    update public.agent_tasks at
    set status = 'RUNNING', attempts = at.attempts + 1,
        locked_at = now(), locked_by = left(worker_id_value,120),
        started_at = coalesce(at.started_at,now()),
        timeout_at = now() + make_interval(secs => greatest(1,av.timeout_ms / 1000))
    from candidates c, public.agent_versions av
    where at.id = c.id and av.tenant_id = at.tenant_id and av.id = at.agent_version_id
    returning at.*, av.timeout_ms, av.model_provider, av.model_name
  ), logged as (
    insert into public.agent_run_attempts (
      tenant_id, task_id, attempt_number, stage, worker_id
    ) select c.tenant_id, c.id, c.attempts, 'claimed', left(worker_id_value,120)
      from claimed c returning id
  )
  select c.id, c.tenant_id, c.agent_version_id, c.customer_id,
    c.conversation_id, c.source_event_id, c.task_type, c.execution_mode,
    c.correlation_id, c.causation_id, c.attempts, c.timeout_ms,
    c.model_provider, c.model_name
  from claimed c;
end;
$$;

create or replace function public.consume_event_for_agent_runtime(target_tenant_id uuid,target_event_id uuid,worker_id_value text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb; e public.domain_events%rowtype; m public.messages%rowtype; v public.agent_versions%rowtype; version_id uuid; t uuid;
begin
 if exists(select 1 from private.private_beta_programs where tenant_id=target_tenant_id) then return jsonb_build_object('routing','private_beta_scoped_worker_only');end if;
 r:=private.phase8_consume_event_for_agent_runtime(target_tenant_id,target_event_id,worker_id_value);
 if r->>'routing'='lead_then_conversation' then
 select * into e from public.domain_events where tenant_id=target_tenant_id and id=target_event_id;
 select * into m from public.messages where tenant_id=target_tenant_id and id::text=e.payload->>'message_id' and direction='inbound';
 if m.content~*'(price|cost|plan|membership|offer|trial|cancel|refund|expensive|trust|include|fiyat|üyelik|teklif|deneme|iade|pahalı|güven|سعر|عرض|تشمل|стоим|подпис|предлож)' then
 version_id:=private.ensure_conversion_agent(target_tenant_id);select * into v from public.agent_versions where tenant_id=target_tenant_id and id=version_id;
 insert into public.agent_tasks(tenant_id,agent_definition_id,agent_version_id,customer_id,conversation_id,source_event_id,task_type,objective,execution_mode,status,priority,idempotency_key,correlation_id,causation_id,max_attempts)
 values(target_tenant_id,v.agent_definition_id,v.id,e.customer_id,m.conversation_id,e.id,'conversion.prepare','Recommend only published eligible commercial versions; propose no independent delivery.','SHADOW','QUEUED',55,'event:'||e.id::text||':conversion:v1',e.correlation_id,e.id,3)
 on conflict(tenant_id,idempotency_key) do nothing returning id into t;
 if t is not null then insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data) values(target_tenant_id,'SYSTEM','conversion.routed','agent_tasks',t::text,jsonb_build_object('event_id',e.id,'delivery','none')); end if;
 end if; end if;
 return r||jsonb_build_object('conversion_task_id',t);
end; $$;

create function private.private_beta_ensure_runtime(t uuid)returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare p private.private_beta_programs;v public.agent_versions;vid uuid;n int;begin
 select * into p from private.private_beta_programs where tenant_id=t for update;
 if p.id is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 perform private.private_beta_guard(t,p.id);
 vid:=private.ensure_shadow_agent(t);select * into strict v from public.agent_versions where tenant_id=t and id=vid;
 if v.model_provider='anthropic'and v.model_name='claude-haiku-5-5'then return v.id;end if;
 perform private.ensure_conversation_quality_config(t);
 select coalesce(max(version),0)+1 into n from public.agent_versions where tenant_id=t and agent_definition_id=v.agent_definition_id;
 update public.agent_versions set superseded_at=clock_timestamp()where tenant_id=t and agent_definition_id=v.agent_definition_id and superseded_at is null;
 insert into public.agent_versions(tenant_id,agent_definition_id,version,prompt_template,output_schema_version,allowed_tools,model_provider,model_name,timeout_ms,max_attempts,retry_policy,prompt_version,director_version,renderer_version,qa_version,context_version,evaluation_set_version)
 values(t,v.agent_definition_id,n,'Polat VIP private beta; exact response QA; no financial or VIP authority.',4,'{}','anthropic','claude-haiku-5-5',10000,1,'{"strategy":"none","maximum_retries":0}',v.prompt_version,v.director_version,v.renderer_version,v.qa_version,3,v.evaluation_set_version)returning id into vid;
 insert into private.escalation_controls(tenant_id,enabled,approval_reference,chat_id,bot_id)values(t,true,'private-beta-owner:'||p.id,null,null)on conflict(tenant_id)do nothing;
 return vid;end;$$;
create function private.private_beta_prepare_program()returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin perform private.private_beta_ensure_runtime(new.tenant_id);return new;end;$$;
create trigger private_beta_native_profile after insert on private.private_beta_programs for each row execute function private.private_beta_prepare_program();

-- Existing Phase12 authority, cases, history and takeover rules remain the only support system.
create or replace function private.escalation_enabled(t uuid)returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from private.escalation_controls e join public.tenants x on x.id=e.tenant_id where e.tenant_id=t and e.enabled and x.status='active'and(
 x.slug like 'phase12-sandbox-%'or(x.slug like 'polat-sandbox-%'and not x.outbound_messaging_enabled and e.chat_id is null and e.bot_id is null and exists(select 1 from private.polat_runtime_profiles p join private.polat_conversation_controls c on c.tenant_id=p.tenant_id and c.conversation_id=p.conversation_id where p.tenant_id=t and p.enabled and c.enabled))
 or(x.slug like 'private-beta-%'and not x.outbound_messaging_enabled and e.chat_id is null and e.bot_id is null and exists(select 1 from private.private_beta_programs p where p.tenant_id=t and p.stage<>'STOPPED'))));$$;

create function public.admin_private_beta_operator_accept_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p private.private_beta_programs;begin
 perform private.private_beta_admin(target_tenant_id);perform private.private_beta_mfa_at();p:=private.private_beta_guard(target_tenant_id,program_id_value);
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager']::public.app_role[])or auth.uid()not in(p.owner_user_id,coalesce((p.configuration->>'primary_operator')::uuid,p.owner_user_id),coalesce((p.configuration->>'backup_operator')::uuid,p.owner_user_id))then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 insert into private.private_beta_observations(tenant_id,program_id,command_id,kind,scenario,outcome,note,actor_id)values(target_tenant_id,p.id,extensions.gen_random_uuid(),'PROGRAM_CONTROL','OPERATOR_ACKNOWLEDGED','NOTE','Authenticated operator accepted the current private-beta support role and generic Polat Support identity.',auth.uid());
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.operator_acknowledged','private_beta_programs',p.id::text,'{"customer_identity":"Polat Support"}');
 return jsonb_build_object('accepted',true);end;$$;
create function private.private_beta_operator(t uuid,p uuid)returns void language plpgsql stable security definer set search_path=pg_catalog as $$declare x private.private_beta_programs;begin
 perform private.private_beta_admin(t);perform private.private_beta_mfa_at();x:=private.private_beta_guard(t,p);
 if not private.has_tenant_role(t,array['super_admin','manager']::public.app_role[])or auth.uid()not in(x.owner_user_id,coalesce((x.configuration->>'primary_operator')::uuid,x.owner_user_id),coalesce((x.configuration->>'backup_operator')::uuid,x.owner_user_id))
 or not exists(select 1 from private.private_beta_observations where program_id=p and actor_id=auth.uid()and kind='PROGRAM_CONTROL'and scenario='OPERATOR_ACKNOWLEDGED')then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;end;$$;
create function private.private_beta_operator_fence()returns trigger language plpgsql security definer set search_path=pg_catalog as $$declare p private.private_beta_programs;cid uuid;begin
 if tg_table_name='conversations'then cid:=new.id;else cid:=new.conversation_id;end if;
 select b.* into p from private.private_beta_programs b join private.private_beta_participants a on a.program_id=b.id and a.tenant_id=b.tenant_id where a.tenant_id=new.tenant_id and a.conversation_id=cid;
 if p.id is null then return new;end if;
 if auth.uid()is not null then perform private.private_beta_operator(new.tenant_id,p.id);end if;
 -- Separate branches are necessary: the two trigger records have different fields.
 if tg_table_name='conversations'then
  if new.runtime_mode<>'AI_ACTIVE'then
   new.automatic_replies_enabled:=false;new.automatic_replies_enabled_at:=null;new.human_takeover:=true;
  end if;
  if new.runtime_mode='HUMAN_TAKEOVER'and old.runtime_mode<>'HUMAN_TAKEOVER'and exists(select 1 from public.messages where tenant_id=new.tenant_id and conversation_id=cid and direction='outbound'and status='sending')then
   if auth.uid()is not null then raise exception 'PRIVATE_BETA_DELIVERY_IN_FLIGHT'using errcode='55000';end if;
   -- Preserve the inbound and OPEN case while the already-started effect is uncertain.
   new.runtime_mode:='PAUSED';new.human_takeover:=true;new.automatic_replies_enabled:=false;new.attention_required:=true;
  end if;
 elsif tg_table_name='escalation_cases'then
  if new.assigned_to is not null and new.assigned_to not in(p.owner_user_id,coalesce((p.configuration->>'primary_operator')::uuid,p.owner_user_id),coalesce((p.configuration->>'backup_operator')::uuid,p.owner_user_id))then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 end if;
 return new;end;$$;
create trigger private_beta_operator_conversation before update of runtime_mode,human_takeover,automatic_replies_enabled on public.conversations for each row execute function private.private_beta_operator_fence();
create trigger private_beta_operator_case before update of status,assigned_to,resolved_by,returned_to_ai_at on public.escalation_cases for each row execute function private.private_beta_operator_fence();

create function private.private_beta_capture_source(source_event public.domain_events)returns void language plpgsql security definer set search_path=pg_catalog as $$
declare a private.private_beta_participants;p private.private_beta_programs;m public.messages;c public.conversations;v public.agent_versions;captured uuid;reason text;begin
 if source_event.event_type<>'message.received'then return;end if;
 select * into a from private.private_beta_participants where tenant_id=source_event.tenant_id and conversation_id::text=source_event.payload->>'conversation_id';
 if a.id is null then return;end if;
 -- Ingestion already owns its conversation. Do not invert the dispatch lock
 -- order (program -> conversation) merely to capture a queued obligation.
 select * into p from private.private_beta_programs where id=a.program_id;
 select * into c from public.conversations where tenant_id=source_event.tenant_id and id=a.conversation_id;
 select * into m from public.messages where tenant_id=source_event.tenant_id and conversation_id=c.id and id::text=source_event.payload->>'message_id'and direction='inbound';
 if m.id is null or m.content~'^/(start|agree|stop|delete|feedback)([[:space:]]|$)'then return;end if;
 select av.* into v from public.agent_versions av join public.agent_definitions ad on ad.tenant_id=av.tenant_id and ad.id=av.agent_definition_id where av.tenant_id=source_event.tenant_id and ad.agent_type='conversation_shadow'and av.model_provider='anthropic'and av.model_name='claude-haiku-5-5'and av.superseded_at is null order by av.version desc limit 1;
 if v.id is null then raise exception 'PRIVATE_BETA_RUNTIME_NOT_PREPARED'using errcode='55000';end if;
 reason:=case when a.status<>'ACTIVE'or not private.private_beta_live_window(p)then 'PARTICIPATION_OR_WINDOW_BLOCKED'when c.runtime_mode<>'AI_ACTIVE'or c.human_takeover then 'HUMAN_OWNS_SOURCE'when not((a.kind='FOUNDER'and p.stage in('FOUNDER','FRIENDS'))or(a.kind='FRIEND'and p.stage='FRIENDS'))then 'STAGE_NOT_ENABLED'else null end;
 insert into public.agent_tasks(tenant_id,agent_definition_id,agent_version_id,customer_id,conversation_id,source_event_id,task_type,objective,execution_mode,status,priority,idempotency_key,correlation_id,causation_id,max_attempts,failure_code,cancellation_reason)
 values(source_event.tenant_id,v.agent_definition_id,v.id,c.customer_id,c.id,source_event.id,'private_beta.reply','Prepare one source-bound Polat private-beta reply; actual response QA; no retries or financial authority.','HUMAN_APPROVAL',case when reason is null then 'QUEUED'::public.agent_runtime_status else 'CANCELLED'::public.agent_runtime_status end,50,'private-beta-source-v1:'||m.id,source_event.correlation_id,source_event.id,1,reason,reason)on conflict(tenant_id,idempotency_key)do nothing returning id into captured;
 if captured is null then return;end if;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(source_event.tenant_id,'SYSTEM','private_beta.inbound_owned','messages',m.id::text,jsonb_build_object('state',coalesce(reason,'AI_RESPONSE_PENDING'),'source_event_id',source_event.id,'financial_authority','NONE'));
 return;end;$$;
create function private.private_beta_queue_source()returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin perform private.private_beta_capture_source(new);return new;end;$$;
create trigger private_beta_native_inbound after insert on public.domain_events for each row execute function private.private_beta_queue_source();

create function public.claim_private_beta_tasks_v1(target_tenant_id uuid,target_conversation_id uuid,worker_id_value text)
returns table(task_id uuid,tenant_id uuid,agent_version_id uuid,customer_id uuid,conversation_id uuid,source_event_id uuid,task_type text,execution_mode public.agent_execution_mode,correlation_id uuid,causation_id uuid,attempt_number integer,timeout_ms integer,model_provider text,model_name text)
language plpgsql security definer set search_path=pg_catalog as $$
declare a private.private_beta_participants;p private.private_beta_programs;item public.agent_tasks;e public.domain_events;worker text;begin
 worker:=nullif(left(worker_id_value,120),'');if worker is null then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 select v.* into a from private.private_beta_participants v where v.tenant_id=target_tenant_id and v.conversation_id=target_conversation_id;if a.id is null then return;end if;
 select * into p from private.private_beta_programs where id=a.program_id for update;
 perform 1 from public.conversations cv where cv.tenant_id=target_tenant_id and cv.id=target_conversation_id for update;
 -- The existing experiment journal permits one unsettled provider dispatch.
 -- Serialize task ownership *before* allocating a paid attempt, rather than
 -- consuming another tester's allowance merely because a different turn is busy.
 if exists(select 1 from public.agent_tasks busy join private.private_beta_participants bp on bp.tenant_id=busy.tenant_id and bp.conversation_id=busy.conversation_id where bp.program_id=p.id and busy.task_type='private_beta.reply'and busy.status='RUNNING'and(busy.conversation_id<>target_conversation_id or busy.locked_at>=clock_timestamp()-interval '120 seconds'))then return;end if;
 -- At most25 obsolete/expired tasks per cycle, then one valid claim. No expired lease is re-dispatched.
 for item in select q.* from public.agent_tasks q where q.tenant_id=target_tenant_id and q.conversation_id=target_conversation_id and q.task_type='private_beta.reply'and(q.status='QUEUED'or(q.status='RUNNING'and q.locked_at<clock_timestamp()-interval '120 seconds'))order by q.created_at,q.id for update skip locked limit 25 loop
  if item.status='RUNNING'then
   update public.agent_tasks set status='DEAD_LETTER',failure_code='PRIVATE_BETA_LEASE_UNKNOWN',failure_category='REVIEW',completed_at=clock_timestamp()where id=item.id;
   update public.conversations cv set attention_required=true where cv.id=target_conversation_id;
   perform private.escalation_open(target_tenant_id,(select(payload->>'message_id')::uuid from public.domain_events ev where ev.tenant_id=target_tenant_id and ev.id=item.source_event_id),'general_review','HIGH','en','quality',item.id);
   continue;
  end if;
  begin
   perform public.private_beta_source_scope_v1(target_tenant_id,target_conversation_id,item.source_event_id);
  exception when sqlstate '42501'or sqlstate '55000'then
   update public.agent_tasks set status='CANCELLED',failure_code='PRIVATE_BETA_SOURCE_REVIEW',cancellation_reason='PRIVATE_BETA_SOURCE_REVIEW',completed_at=clock_timestamp()where id=item.id;
   insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','private_beta.source_held','agent_tasks',item.id::text,'{"reason":"SOURCE_OR_OWNERSHIP_CHANGED","delivery":"NOT_SENT"}');continue;
  end;
  if exists(select 1 from public.agent_tasks busy where busy.tenant_id=target_tenant_id and busy.conversation_id=target_conversation_id and busy.status='RUNNING')then return;end if;
  update public.agent_tasks set status='RUNNING',attempts=attempts+1,locked_at=clock_timestamp(),locked_by=worker,started_at=coalesce(started_at,clock_timestamp()),timeout_at=clock_timestamp()+interval '120 seconds'where id=item.id returning * into item;
  insert into public.agent_run_attempts(tenant_id,task_id,attempt_number,stage,worker_id)values(target_tenant_id,item.id,item.attempts,'claimed',worker);
  return query select item.id,item.tenant_id,item.agent_version_id,item.customer_id,item.conversation_id,item.source_event_id,item.task_type,item.execution_mode,item.correlation_id,item.causation_id,item.attempts,v.timeout_ms,v.model_provider,v.model_name from public.agent_versions v where v.tenant_id=target_tenant_id and v.id=item.agent_version_id;return;
 end loop;end;$$;

create function public.private_beta_hold_source_v1(target_tenant_id uuid,target_conversation_id uuid,target_event_id uuid,reason_value text)returns boolean language plpgsql security definer set search_path=pg_catalog as $$declare mid uuid;begin
 if reason_value not in('MODEL_UNAVAILABLE','QA_HELD','SOURCE_CHANGED','DELIVERY_UNKNOWN')or not exists(select 1 from private.private_beta_participants where tenant_id=target_tenant_id and conversation_id=target_conversation_id)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 select m.id into mid from public.messages m join public.domain_events e on e.tenant_id=m.tenant_id and e.payload->>'message_id'=m.id::text where e.tenant_id=target_tenant_id and e.id=target_event_id and m.conversation_id=target_conversation_id and m.direction='inbound';
 if mid is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 perform private.escalation_open(target_tenant_id,mid,'general_review','HIGH','en','quality',target_event_id);
 update public.conversations set attention_required=true where tenant_id=target_tenant_id and id=target_conversation_id;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','private_beta.human_review_required','messages',mid::text,jsonb_build_object('reason',reason_value,'delivery','NOT_SENT'));
 return true;end;$$;

create function public.private_beta_recovery_targets_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare p private.private_beta_programs;result jsonb;begin
 p:=private.private_beta_guard(target_tenant_id,program_id_value);if not private.private_beta_live_window(p)or p.stage not in('FOUNDER','FRIENDS')then return '[]';end if;
 select coalesce(jsonb_agg(x),'[]')into result from(select q.conversation_id from public.agent_tasks q join private.private_beta_participants a on a.tenant_id=q.tenant_id and a.conversation_id=q.conversation_id where a.program_id=p.id and a.status='ACTIVE'and q.task_type='private_beta.reply'and(q.status='QUEUED'or(q.status='RUNNING'and q.locked_at<clock_timestamp()-interval '120 seconds'))order by q.created_at,q.id limit 1)x;return result;end;$$;

create function private.private_beta_native_registry(t uuid,rid uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare r public.agent_runs;q public.agent_tasks;a private.private_beta_attempt_scope;expected jsonb;facts jsonb;begin
 select * into strict r from public.agent_runs where tenant_id=t and id=rid;select * into strict q from public.agent_tasks where tenant_id=t and id=r.task_id;
 select * into a from private.private_beta_attempt_scope where tenant_id=t and native_run_id=rid and conversation_id=q.conversation_id;
 if a.attempt_id is null or r.context_manifest->>'private_beta_profile'is distinct from 'polat-private-beta-v1'or r.context_manifest->>'private_beta_program_id'is distinct from a.program_id::text
 or r.context_manifest->>'private_beta_participant_id'is distinct from a.participant_id::text or r.context_manifest->>'private_beta_revision'is distinct from a.participant_revision::text or r.context_manifest->>'source_message_id'is distinct from a.source_message_id::text
 or r.model_provider<>'anthropic'or r.model_name<>'claude-haiku-5-5'or r.context_manifest->>'financial_authority'is distinct from 'NONE'or jsonb_array_length(r.context_manifest->'included_message_ids')not between 1 and 25 then raise exception 'EVIDENCE_REGISTRY_NOT_AUTHORITATIVE'using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('handle',case when ids.value=a.source_message_id::text then 'EVIDENCE_CURRENT_MESSAGE'else 'EVIDENCE_MESSAGE_'||ids.ordinality::text end,'messageId',m.id,'direction',m.direction)order by ids.ordinality),'[]')into expected
 from jsonb_array_elements_text(r.context_manifest->'included_message_ids')with ordinality ids(value,ordinality)join public.messages m on m.tenant_id=t and m.conversation_id=q.conversation_id and m.id::text=ids.value and m.created_at<=a.source_boundary and(m.direction='inbound'or(m.direction='outbound'and m.status='sent'));
 if jsonb_array_length(expected)<>jsonb_array_length(r.context_manifest->'included_message_ids')then raise exception 'EVIDENCE_REGISTRY_NOT_AUTHORITATIVE'using errcode='22023';end if;
 facts:=jsonb_build_array(jsonb_build_object('id','polat:uat:identity:v1'),jsonb_build_object('id','polat:uat:identity:denial:v1'))||private.quality_commercial_facts(t,rid);
 expected:=expected||(select jsonb_agg(jsonb_build_object('handle','EVIDENCE_COMMERCIAL_'||f.ordinality::text,'messageId',f.value->>'id','direction','system')order by f.ordinality)from jsonb_array_elements(facts)with ordinality f(value,ordinality));return expected;end;$$;

create function public.private_beta_queue_reply_v1(target_tenant_id uuid,target_proposal_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p public.agent_proposals;t public.agent_tasks;c public.conversations;a private.private_beta_participants;b private.private_beta_programs;q public.conversation_quality_evaluations;s public.messages;mid uuid;begin
 select * into p from public.agent_proposals where tenant_id=target_tenant_id and id=target_proposal_id;select * into t from public.agent_tasks where tenant_id=target_tenant_id and id=p.task_id;
 select * into a from private.private_beta_participants where tenant_id=target_tenant_id and conversation_id=t.conversation_id;if a.id is null then return jsonb_build_object('queued',false);end if;
 select * into b from private.private_beta_programs where id=a.program_id for update;select * into c from public.conversations where tenant_id=target_tenant_id and id=a.conversation_id for update;select * into a from private.private_beta_participants where id=a.id for update;
 select * into p from public.agent_proposals where id=p.id for update;
 if p.sent_message_id is not null then return jsonb_build_object('queued',true,'duplicate',true,'message_id',p.sent_message_id);end if;
 perform public.private_beta_source_scope_v1(target_tenant_id,c.id,t.source_event_id);
 select * into q from public.conversation_quality_evaluations where tenant_id=target_tenant_id and run_id=p.run_id;
 select * into s from public.messages where tenant_id=target_tenant_id and conversation_id=c.id and id=(select(payload->>'message_id')::uuid from public.domain_events where tenant_id=target_tenant_id and id=t.source_event_id);
 if t.task_type<>'private_beta.reply'or p.approval_status<>'pending'or p.customer_facing_blocked or q.id is null or q.qa_action<>'approve'or q.customer_facing_blocked or coalesce((p.original_payload->>'escalation_recommended')::boolean,true)or jsonb_array_length(coalesce(p.original_payload->'proposed_tool_calls','[]'))<>0
 or not exists(select 1 from private.private_beta_attempt_scope x join private.polat_experiment_evidence pe on pe.attempt_id=x.attempt_id and pe.stage='PROVIDER_RESULT'and pe.payload->>'status'='SUCCEEDED'and pe.payload->>'qa'='APPROVED' where x.tenant_id=target_tenant_id and x.native_run_id=p.run_id and x.participant_revision=a.revision and x.source_message_id=s.id and x.dispatch_started_at is not null and not exists(select 1 from private.polat_experiment_evidence bad where bad.attempt_id=x.attempt_id and bad.stage in('RESULT_UNKNOWN','DELAYED_RESULT')))
 then return jsonb_build_object('queued',false);end if;
 insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_chat_id,reply_to_message_id,reply_to_provider_message_id,idempotency_key,actor_type,actor_id,correlation_id,causation_id,occurred_at)
 values(target_tenant_id,c.id,c.customer_id,c.messaging_contact_id,c.provider_connection_id,'outbound','text',p.original_payload->>'proposed_response','pending',a.provider_chat_id,s.id,s.provider_message_id,'private-beta-reply-v1:'||p.id,'SYSTEM','private-beta-ai:'||a.revision,t.correlation_id,t.source_event_id,clock_timestamp())returning id into mid;
 update public.agent_proposals set sent_message_id=mid,approval_status='approved',reviewed_at=clock_timestamp(),review_reason='Private beta: deterministic QA approval, not human/model quality acceptance'where id=p.id;
 update public.agent_tasks set status='SUCCEEDED',completed_at=clock_timestamp()where id=t.id;update public.agent_runs set status='SUCCEEDED'where id=p.run_id;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','private_beta.reply_queued','messages',mid::text,jsonb_build_object('qa_id',q.id,'financial_authority','NONE'));
 return jsonb_build_object('queued',true,'duplicate',false,'message_id',mid);end;$$;

create function public.private_beta_claim_reply_v1(target_tenant_id uuid,target_message_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare m public.messages;c public.conversations;a private.private_beta_participants;p private.private_beta_programs;begin
 select * into m from public.messages where tenant_id=target_tenant_id and id=target_message_id;
 select * into a from private.private_beta_participants where tenant_id=target_tenant_id and conversation_id=m.conversation_id;if a.id is null then return jsonb_build_object('dispatch',false);end if;
 select * into p from private.private_beta_programs where id=a.program_id for update;select * into c from public.conversations where tenant_id=target_tenant_id and id=a.conversation_id for update;select * into a from private.private_beta_participants where id=a.id for update;select * into m from public.messages where id=m.id for update;
 if m.direction<>'outbound'or m.status<>'pending'or a.status<>'ACTIVE'or not private.private_beta_live_window(p)or p.stage not in('FOUNDER','FRIENDS')or m.provider_chat_id<>a.provider_chat_id
 or not exists(select 1 from public.messaging_contacts where tenant_id=target_tenant_id and id=c.messaging_contact_id and contactability in('user_initiated','allowed'))then return jsonb_build_object('dispatch',false);end if;
 if m.actor_type='HUMAN'then
  if c.runtime_mode<>'HUMAN_TAKEOVER'or not c.human_takeover then return jsonb_build_object('dispatch',false);end if;
 elsif m.actor_id is distinct from 'private-beta-notice' then
  if c.runtime_mode<>'AI_ACTIVE'or c.human_takeover or not c.automatic_replies_enabled or m.actor_id is distinct from 'private-beta-ai:'||a.revision::text
  or a.last_inbound_id is distinct from m.reply_to_message_id then return jsonb_build_object('dispatch',false);end if;
 end if;
 update public.messages set status='sending'where id=m.id;
 return jsonb_build_object('dispatch',true,'message_id',m.id,'program_id',p.id,'bot_id',p.bot_control->>'bot_id','chat_id',a.provider_chat_id,'body',m.content,'reply_to_provider_message_id',m.reply_to_provider_message_id);end;$$;

create function public.admin_private_beta_queue_manual_v1(target_tenant_id uuid,target_conversation_id uuid,content_value text,idempotency_key_value text,correlation_id_value uuid,reply_to_message_id_value uuid default null)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a private.private_beta_participants;p private.private_beta_programs;c public.conversations;m public.messages;mid uuid;begin
 select * into a from private.private_beta_participants where tenant_id=target_tenant_id and conversation_id=target_conversation_id;if a.id is null then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 select * into p from private.private_beta_programs where id=a.program_id for update;perform private.private_beta_operator(target_tenant_id,p.id);select * into c from public.conversations where tenant_id=target_tenant_id and id=a.conversation_id for update;select * into a from private.private_beta_participants where id=a.id for update;
 if not private.private_beta_live_window(p)or p.stage not in('FOUNDER','FRIENDS')or a.status<>'ACTIVE'or c.runtime_mode<>'HUMAN_TAKEOVER'or not c.human_takeover then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 if content_value is null or length(btrim(content_value))not between 1 and 3800 or idempotency_key_value is null or length(idempotency_key_value)not between 1 and 200 or content_value~*'(^|[.!?][[:space:]])(I am|I.m|Ben) Polat([.![:space:]]|$)'then raise exception 'PRIVATE_BETA_INVALID'using errcode='22023';end if;
 select * into m from public.messages where tenant_id=target_tenant_id and idempotency_key='private-beta-human:'||idempotency_key_value;
 if m.id is not null then if m.conversation_id<>c.id or m.content is distinct from 'Polat Support: '||btrim(content_value)then raise exception 'PRIVATE_BETA_INVALID'using errcode='23505';end if;return jsonb_build_object('message_id',m.id,'status',m.status,'duplicate',true);end if;
 if reply_to_message_id_value is not null and not exists(select 1 from public.messages where tenant_id=target_tenant_id and conversation_id=c.id and id=reply_to_message_id_value)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_chat_id,reply_to_message_id,idempotency_key,actor_type,actor_id,correlation_id,occurred_at)
 values(target_tenant_id,c.id,c.customer_id,c.messaging_contact_id,c.provider_connection_id,'outbound','text','Polat Support: '||btrim(content_value),'pending',a.provider_chat_id,reply_to_message_id_value,'private-beta-human:'||idempotency_key_value,'HUMAN',auth.uid()::text,correlation_id_value,clock_timestamp())returning id into mid;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(target_tenant_id,'HUMAN',auth.uid(),'private_beta.manual_reply_queued','messages',mid::text,jsonb_build_object('public_actor','Polat Support','body_in_audit',false));
 return jsonb_build_object('message_id',mid,'status','pending','duplicate',false);end;$$;

revoke all on function public.admin_private_beta_operator_accept_v1(uuid,uuid),public.admin_private_beta_queue_manual_v1(uuid,uuid,text,text,uuid,uuid)from public,anon,service_role;
grant execute on function public.admin_private_beta_operator_accept_v1(uuid,uuid),public.admin_private_beta_queue_manual_v1(uuid,uuid,text,text,uuid,uuid)to authenticated;
revoke all on function public.claim_private_beta_tasks_v1(uuid,uuid,text),public.private_beta_hold_source_v1(uuid,uuid,uuid,text),public.private_beta_recovery_targets_v1(uuid,uuid),public.private_beta_queue_reply_v1(uuid,uuid),public.private_beta_claim_reply_v1(uuid,uuid)from public,anon,authenticated;
grant execute on function public.claim_private_beta_tasks_v1(uuid,uuid,text),public.private_beta_hold_source_v1(uuid,uuid,uuid,text),public.private_beta_recovery_targets_v1(uuid,uuid),public.private_beta_queue_reply_v1(uuid,uuid),public.private_beta_claim_reply_v1(uuid,uuid)to service_role;
do $$declare f record;begin for f in select oid::regprocedure sig from pg_proc where pronamespace='private'::regnamespace and proname in('private_beta_ensure_runtime','private_beta_prepare_program','private_beta_operator','private_beta_operator_fence','private_beta_queue_source','private_beta_capture_source','private_beta_native_registry')loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);end loop;end;$$;

create or replace function private.assert_quality_output_refs(target_tenant_id uuid,target_run_id uuid,output_value jsonb)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare r public.agent_runs%rowtype; t public.agent_tasks%rowtype; ref text; source_at timestamptz; commercial_facts jsonb;
begin
  select * into r from public.agent_runs where tenant_id=target_tenant_id and id=target_run_id;
  select * into t from public.agent_tasks where tenant_id=target_tenant_id and id=r.task_id;
  select created_at into source_at from public.messages where tenant_id=target_tenant_id and conversation_id=t.conversation_id
    and id::text=r.context_manifest->>'source_message_id';
  commercial_facts:=private.quality_commercial_facts(target_tenant_id,target_run_id);
  for ref in
    select value from jsonb_array_elements_text(coalesce(output_value#>'{semantic_response,factual_grounding,evidence_refs}','[]'::jsonb))
    union all
    select refs.value from jsonb_array_elements(coalesce(output_value->'claims','[]'::jsonb)) c(value)
      cross join lateral jsonb_array_elements_text(coalesce(c.value->'evidence_refs','[]'::jsonb)) refs(value)
  loop
    if ref in('polat:uat:identity:v1','polat:uat:identity:denial:v1')then
      if not exists(select 1 from jsonb_array_elements(private.private_beta_native_registry(target_tenant_id,target_run_id)) x where x->>'messageId'=ref)then raise exception 'EVIDENCE_REFERENCE_NOT_ALLOWED'using errcode='22023';end if;
      continue;
    end if;
    if not exists(select 1 from public.messages m where m.tenant_id=target_tenant_id and m.conversation_id=t.conversation_id
      and m.id::text=ref and m.created_at<=source_at and (r.context_manifest->'included_message_ids') ? ref)
      and not exists(select 1 from jsonb_array_elements(commercial_facts) f where f->>'id'=ref)
      and not(ref in('polat:identity:v1','polat:identity:denial:v1')and exists(
       select 1 from private.polat_runtime_profiles p join public.agent_versions v on v.tenant_id=p.tenant_id and v.id=p.agent_version_id
       join public.tenants tt on tt.id=p.tenant_id join private.polat_conversation_controls ctrl on ctrl.tenant_id=p.tenant_id and ctrl.conversation_id=p.conversation_id
       where p.tenant_id=target_tenant_id and p.conversation_id=t.conversation_id and p.agent_version_id=r.agent_version_id and p.enabled and ctrl.enabled
       and tt.slug like 'polat-sandbox-%'and tt.status='active'and not tt.outbound_messaging_enabled
       and v.model_provider='mock'and v.model_name='polat-test-runtime-v1'and r.model_provider='mock'and r.model_name='polat-test-runtime-v1'
       and r.context_manifest->>'polat_profile'='polat-test-runtime-v1'))then
      raise exception 'EVIDENCE_REFERENCE_NOT_ALLOWED' using errcode='22023';
    end if;
  end loop;
end;
$$;

create or replace function private.guard_quality_stage_refs()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare r public.agent_runs%rowtype; t public.agent_tasks%rowtype; expected jsonb;
  wire jsonb; resolved jsonb; claims jsonb:='[]'::jsonb; memories jsonb:='[]'::jsonb; item jsonb;
begin
  if coalesce((new.evidence#>>'{versions,outputSchema}')::integer,0)<4 then return new; end if;
  select * into strict r from public.agent_runs where tenant_id=new.tenant_id and id=new.run_id;
  select * into strict t from public.agent_tasks where tenant_id=new.tenant_id and id=r.task_id;
  perform private.assert_quality_output_refs(new.tenant_id,new.run_id,new.evidence->'original_output');
  perform private.assert_quality_output_refs(new.tenant_id,new.run_id,new.evidence->'rendered_output');
  if exists(select 1 from public.agent_versions where tenant_id=new.tenant_id and id=r.agent_version_id
    and model_provider in('openai','anthropic')) and coalesce(new.evidence->'authoritative_evidence_resolution','null'::jsonb)='null'::jsonb then
    raise exception 'EVIDENCE_RESOLUTION_REQUIRED' using errcode='22023';
  end if;
  if new.evidence->'authoritative_evidence_resolution' is not null
     and new.evidence->'authoritative_evidence_resolution'<>'null'::jsonb then
    select coalesce(jsonb_agg(jsonb_build_object(
      'handle',case when ids.value=r.context_manifest->>'source_message_id' then 'EVIDENCE_CURRENT_MESSAGE' else 'EVIDENCE_MESSAGE_'||ids.ordinality::text end,
      'messageId',m.id,'direction',m.direction) order by ids.ordinality),'[]'::jsonb)
    into expected from jsonb_array_elements_text(r.context_manifest->'included_message_ids') with ordinality ids(value,ordinality)
      join public.messages m on m.tenant_id=new.tenant_id and m.conversation_id=t.conversation_id and m.id::text=ids.value
      and m.created_at<=(r.context_manifest->>'context_boundary_timestamp')::timestamptz;
    expected:=expected||(select coalesce(jsonb_agg(jsonb_build_object(
      'handle','EVIDENCE_COMMERCIAL_'||f.ordinality::text,'messageId',f.value->>'id','direction','system') order by f.ordinality),'[]')
      from jsonb_array_elements(private.quality_commercial_facts(new.tenant_id,new.run_id)) with ordinality f(value,ordinality));
    if r.context_manifest->>'polat_offline_codec'='claude-messages-v1' then expected:=private.polat_native_quality_registry(new.tenant_id,new.run_id);end if;
    if r.context_manifest->>'private_beta_codec'='claude-messages-v1'then expected:=private.private_beta_native_registry(new.tenant_id,new.run_id);end if;
    if expected is distinct from r.context_manifest->'evidence_handle_registry'
       or expected is distinct from new.evidence#>'{authoritative_evidence_resolution,registry}'
       or new.evidence#>>'{authoritative_evidence_resolution,resolved}' is distinct from 'true' then
      raise exception 'EVIDENCE_REGISTRY_NOT_AUTHORITATIVE' using errcode='22023';
    end if;
    wire:=new.evidence#>'{authoritative_evidence_resolution,wireOutput}';
    resolved:=jsonb_set(wire,'{semantic_response,factual_grounding,evidence_refs}',
      private.resolve_quality_wire_refs(wire#>'{semantic_response,factual_grounding,evidence_refs}',expected));
    for item in select value from jsonb_array_elements(wire->'claims') loop
      claims:=claims||jsonb_build_array(jsonb_set(item,'{evidence_refs}',private.resolve_quality_wire_refs(item->'evidence_refs',expected)));
    end loop;
    for item in select value from jsonb_array_elements(wire->'memory_proposals') loop
      memories:=memories||jsonb_build_array((item-'provenance_evidence_refs')||jsonb_build_object(
        'provenance_message_ids',private.resolve_quality_wire_refs(item->'provenance_evidence_refs',expected,true)));
    end loop;
    resolved:=jsonb_set(jsonb_set(resolved,'{claims}',claims),'{memory_proposals}',memories);
    if resolved is distinct from new.evidence->'original_output' then
      raise exception 'EVIDENCE_RESOLUTION_MISMATCH' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.assert_quality_output_refs(uuid,uuid,jsonb),private.guard_quality_stage_refs()from public,anon,authenticated,service_role;

create function public.private_beta_transport_config_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare p private.private_beta_programs;begin
 p:=private.private_beta_guard(target_tenant_id,program_id_value);
 if p.bot_control->>'api_environment'is distinct from 'production'or p.bot_control->>'credential_sha256'is null then raise exception 'PRIVATE_BETA_BOT_UNVERIFIED'using errcode='55000';end if;
 return jsonb_build_object('version',1,'program_id',p.id,'tenant_id',p.tenant_id,'bot_id',p.bot_control->>'bot_id','api_environment','production','credential_sha256',p.bot_control->>'credential_sha256','repository_sha',p.configuration->>'repository_sha');end;$$;

create function public.private_beta_queue_notice_v1(target_tenant_id uuid,program_id_value uuid,participant_id_value uuid,target_conversation_id uuid,source_message_id_value uuid,kind_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p private.private_beta_programs;a private.private_beta_participants;c public.conversations;s public.messages;m public.messages;body text;key_value text;mid uuid;begin
 p:=private.private_beta_guard(target_tenant_id,program_id_value);perform 1 from private.private_beta_programs where id=p.id for update;
 select * into c from public.conversations where tenant_id=target_tenant_id and id=target_conversation_id for update;
 select * into a from private.private_beta_participants where tenant_id=target_tenant_id and program_id=p.id and id=participant_id_value for update;
 select * into s from public.messages where tenant_id=target_tenant_id and conversation_id=c.id and id=source_message_id_value and direction='inbound';
 if a.id is null or c.id is null or s.id is null or s.provider_chat_id<>a.provider_chat_id or not exists(select 1 from public.messaging_contacts where tenant_id=target_tenant_id and id=c.messaging_contact_id and provider_user_id=a.provider_user_id and provider_chat_id=a.provider_chat_id)
 or not exists(select 1 from public.messaging_provider_connections where tenant_id=target_tenant_id and id=c.provider_connection_id and provider_account_ref=p.bot_control->>'bot_id')then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 if (p.configuration->>'expires_at')is null or (p.configuration->>'expires_at')::timestamptz<=clock_timestamp()then return jsonb_build_object('queued',false);end if;
 if kind_value='NOTICE'and a.status='PENDING_NOTICE'then
  body:=private.private_beta_notice((p.configuration->>'retention_days')::int);key_value:='private-beta-notice:'||a.id||':'||a.notice_version;
 elsif kind_value='AGREED'and a.status='ACTIVE'and a.consented_at is not null then
  body:='Your private-beta participation has been recorded. AI replies are subject to the approved test window and limits. You can send /stop to leave or /feedback 1 1 1 1 to rate usefulness, naturalness, correctness and satisfaction from 1 to 5.';key_value:='private-beta-agreed:'||a.id||':'||a.notice_version;
 elsif kind_value='STOPPED'and a.status='REVOKED'then
  body:='Your participation has stopped. No further AI replies or marketing will be sent.';key_value:='private-beta-stopped:'||a.id;
 elsif kind_value='DELETE_REQUESTED'and a.status='REVOKED'and a.deletion_requested_at is not null and s.content='/delete'then
  body:='Your deletion request has been recorded and your participation has stopped. Deletion is subject to the applicable privacy, retention and legal-hold review; it has not been represented as completed.';key_value:='private-beta-delete:'||a.id;
 elsif kind_value='FEEDBACK_RECORDED'and a.status='ACTIVE'and s.content~'^/feedback [1-5] [1-5] [1-5] [1-5]$'and exists(select 1 from private.private_beta_observations where program_id=p.id and kind='TESTER_FEEDBACK'and conversation_id=c.id and command_id=s.id)then
  body:='Your beta feedback has been recorded. Thank you.';key_value:='private-beta-feedback:'||s.id;
 else return jsonb_build_object('queued',false);end if;
 select * into m from public.messages where tenant_id=target_tenant_id and idempotency_key=key_value;
 if m.id is not null then return jsonb_build_object('queued',true,'duplicate',true,'message_id',m.id);end if;
 insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_chat_id,reply_to_message_id,reply_to_provider_message_id,idempotency_key,actor_type,actor_id,correlation_id,occurred_at)
 values(target_tenant_id,c.id,c.customer_id,c.messaging_contact_id,c.provider_connection_id,'outbound','text',body,'pending',a.provider_chat_id,s.id,s.provider_message_id,key_value,'SYSTEM','private-beta-notice',extensions.gen_random_uuid(),clock_timestamp())returning id into mid;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','private_beta.notice_queued','messages',mid::text,jsonb_build_object('purpose',kind_value,'notice_version',a.notice_version,'body_in_audit',false));
 return jsonb_build_object('queued',true,'duplicate',false,'message_id',mid);end;$$;

create or replace function public.private_beta_claim_reply_v1(target_tenant_id uuid,target_message_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare m public.messages;c public.conversations;a private.private_beta_participants;p private.private_beta_programs;notice boolean;attempts int;begin
 select * into m from public.messages where tenant_id=target_tenant_id and id=target_message_id;notice:=m.actor_id='private-beta-notice';
 select * into a from private.private_beta_participants where tenant_id=target_tenant_id and(conversation_id=m.conversation_id or(notice and provider_chat_id=m.provider_chat_id));
 if a.id is null then return jsonb_build_object('dispatch',false);end if;
 select * into p from private.private_beta_programs where id=a.program_id for update;select * into c from public.conversations where tenant_id=target_tenant_id and id=m.conversation_id for update;select * into a from private.private_beta_participants where id=a.id for update;select * into m from public.messages where id=m.id for update;
 select count(*)into attempts from(select 1 from public.message_delivery_attempts where tenant_id=target_tenant_id and message_id=m.id limit 3)x;
 if m.direction<>'outbound'or m.status not in('pending','retry_scheduled')or attempts>=3 or(m.retry_after_at is not null and m.retry_after_at>clock_timestamp())or m.provider_chat_id<>a.provider_chat_id
 or p.bot_control->>'api_environment'is distinct from 'production'or p.configuration->>'expires_at'is null or(p.configuration->>'expires_at')::timestamptz<=clock_timestamp()
 then return jsonb_build_object('dispatch',false);end if;
 if notice then
  if (m.idempotency_key like 'private-beta-notice:%'and a.status<>'PENDING_NOTICE')or(m.idempotency_key like 'private-beta-agreed:%'and a.status<>'ACTIVE')or(m.idempotency_key like 'private-beta-feedback:%'and a.status<>'ACTIVE')then return jsonb_build_object('dispatch',false);end if;
  if not(m.idempotency_key in('private-beta-notice:'||a.id||':'||a.notice_version,'private-beta-agreed:'||a.id||':'||a.notice_version,'private-beta-stopped:'||a.id,'private-beta-delete:'||a.id)or m.idempotency_key like 'private-beta-feedback:%')then return jsonb_build_object('dispatch',false);end if;
 else
  if a.status<>'ACTIVE'or not private.private_beta_live_window(p)or p.stage not in('FOUNDER','FRIENDS')or not exists(select 1 from public.messaging_contacts where tenant_id=target_tenant_id and id=c.messaging_contact_id and contactability in('user_initiated','allowed'))then return jsonb_build_object('dispatch',false);end if;
  if m.actor_type='HUMAN'then if c.runtime_mode<>'HUMAN_TAKEOVER'or not c.human_takeover then return jsonb_build_object('dispatch',false);end if;
  elsif c.runtime_mode<>'AI_ACTIVE'or c.human_takeover or not c.automatic_replies_enabled or m.actor_id is distinct from 'private-beta-ai:'||a.revision::text or a.last_inbound_id is distinct from m.reply_to_message_id then return jsonb_build_object('dispatch',false);end if;
 end if;
 if exists(select 1 from public.messages other where other.tenant_id=target_tenant_id and other.conversation_id=c.id and other.id<>m.id and other.direction='outbound'and(other.status='sending'or other.failure_code='TELEGRAM_DELIVERY_UNCERTAIN'))then return jsonb_build_object('dispatch',false);end if;
 update public.messages set status='sending'where id=m.id;
 return jsonb_build_object('dispatch',true,'message_id',m.id,'program_id',p.id,'bot_id',p.bot_control->>'bot_id','chat_id',a.provider_chat_id,'body',m.content,'reply_to_provider_message_id',m.reply_to_provider_message_id);end;$$;

revoke all on function public.private_beta_transport_config_v1(uuid,uuid),public.private_beta_queue_notice_v1(uuid,uuid,uuid,uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.private_beta_transport_config_v1(uuid,uuid),public.private_beta_queue_notice_v1(uuid,uuid,uuid,uuid,uuid,text)to service_role;

-- A fixed participation receipt is a control-plane acknowledgement, not an AI
-- answer. It may remain necessary when a HIGH support case correctly holds AI.
create function private.private_beta_notice_message(m public.messages)returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare a private.private_beta_participants;p private.private_beta_programs;s public.messages;begin
 if m.direction<>'outbound'or m.actor_type<>'SYSTEM'or m.actor_id<>'private-beta-notice'then return false;end if;
 select b.* into a from private.private_beta_participants b join public.messaging_contacts k on k.tenant_id=b.tenant_id and k.provider_user_id=b.provider_user_id and k.provider_chat_id=b.provider_chat_id where b.tenant_id=m.tenant_id and b.provider_chat_id=m.provider_chat_id and k.id=m.messaging_contact_id;
 select * into p from private.private_beta_programs where tenant_id=m.tenant_id and id=a.program_id;
 select * into s from public.messages where tenant_id=m.tenant_id and conversation_id=m.conversation_id and id=m.reply_to_message_id and direction='inbound';
 if a.id is null or p.id is null or s.id is null or not exists(select 1 from public.messaging_provider_connections where tenant_id=m.tenant_id and id=m.provider_connection_id and provider_account_ref=p.bot_control->>'bot_id')then return false;end if;
 return case
 when m.idempotency_key='private-beta-notice:'||a.id||':'||a.notice_version then a.status='PENDING_NOTICE'and m.content=private.private_beta_notice((p.configuration->>'retention_days')::int)
 when m.idempotency_key='private-beta-agreed:'||a.id||':'||a.notice_version then a.status='ACTIVE'and a.consented_at is not null and m.content='Your private-beta participation has been recorded. AI replies are subject to the approved test window and limits. You can send /stop to leave or /feedback 1 1 1 1 to rate usefulness, naturalness, correctness and satisfaction from 1 to 5.'
 when m.idempotency_key='private-beta-stopped:'||a.id then a.status='REVOKED'and m.content='Your participation has stopped. No further AI replies or marketing will be sent.'
 when m.idempotency_key='private-beta-delete:'||a.id then a.status='REVOKED'and a.deletion_requested_at is not null and m.content='Your deletion request has been recorded and your participation has stopped. Deletion is subject to the applicable privacy, retention and legal-hold review; it has not been represented as completed.'
 when m.idempotency_key='private-beta-feedback:'||s.id then a.status='ACTIVE'and exists(select 1 from private.private_beta_observations where program_id=p.id and kind='TESTER_FEEDBACK'and command_id=s.id)and m.content='Your beta feedback has been recorded. Thank you.'
 else false end;end;$$;
create or replace function private.escalation_message_guard()returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare e public.escalation_cases;c public.conversations;begin
 if new.direction<>'outbound'then return new;end if;
 select * into c from public.conversations where tenant_id=new.tenant_id and id=new.conversation_id for update;
 select * into e from public.escalation_cases where tenant_id=new.tenant_id and conversation_id=c.id and status<>'RESOLVED'order by created_at desc limit 1;
 if private.private_beta_notice_message(new)then return new;end if;
 if new.actor_type='HUMAN'then
  if e.id is not null then
   if e.status<>'IN_PROGRESS'or e.assigned_to is distinct from auth.uid()or not private.has_tenant_role(new.tenant_id,array['super_admin','manager']::public.app_role[])then raise exception 'case takeover required before manual reply'using errcode='42501';end if;
   if exists(select 1 from public.messages where id=e.safe_reply_id and status='sending')then raise exception 'safe response in flight'using errcode='55000';end if;
   update public.messages set status='failed',failure_code='HUMAN_REPLY_SUPERSEDES_ACK'where id=e.safe_reply_id and status in('pending','retry_scheduled');
  end if;return new;
 end if;
 if new.actor_id='escalation-safe-reply'then
  if e.id is null or private.escalation_rank(e.severity)<3 or new.content is distinct from private.escalation_safe_text(e.locale)or new.reply_to_message_id is distinct from e.source_message_id or new.idempotency_key is distinct from 'escalation-safe:'||e.id::text then raise exception 'safe response authority denied'using errcode='42501';end if;
 elsif(e.id is not null and private.escalation_rank(e.severity)>=3)or(c.escalation_return_boundary is not null and(new.created_at<c.escalation_return_boundary or new.reply_to_message_id is null or exists(select 1 from public.messages where id=new.reply_to_message_id and created_at<c.escalation_return_boundary)))then raise exception 'escalation blocks automatic reply'using errcode='42501';end if;return new;end;$$;
revoke all on function private.private_beta_notice_message(public.messages),private.escalation_message_guard()from public,anon,authenticated,service_role;

create function public.admin_private_beta_canary_scope_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare p private.private_beta_programs;begin
 perform private.private_beta_admin(target_tenant_id,true);perform private.private_beta_mfa_at();p:=private.private_beta_guard(target_tenant_id,program_id_value);
 if p.owner_user_id is distinct from auth.uid()or p.stage<>'CANARY'or not private.private_beta_live_window(p)then raise exception 'PRIVATE_BETA_UNAVAILABLE'using errcode='42501';end if;
 return jsonb_build_object('program_id',p.id,'tenant_id',p.tenant_id,'stage','CANARY','repository_sha',p.configuration->>'repository_sha');end;$$;
revoke all on function public.admin_private_beta_canary_scope_v1(uuid,uuid)from public,anon,service_role;
grant execute on function public.admin_private_beta_canary_scope_v1(uuid,uuid)to authenticated;

-- A timed-out send is never reclaimed for sending. Only a documented 429
-- (known not accepted) may retry, at most three recorded attempts in total.
create function public.private_beta_recover_delivery_v1(target_tenant_id uuid,program_id_value uuid,target_conversation_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p private.private_beta_programs;a private.private_beta_participants;m public.messages;mid uuid;begin
 p:=private.private_beta_guard(target_tenant_id,program_id_value);perform 1 from private.private_beta_programs where id=p.id for update;
 perform 1 from public.conversations where tenant_id=target_tenant_id and id=target_conversation_id for update;
 select b.* into a from private.private_beta_participants b join public.messaging_contacts k on k.tenant_id=b.tenant_id and k.provider_user_id=b.provider_user_id and k.provider_chat_id=b.provider_chat_id join public.conversations c on c.tenant_id=k.tenant_id and c.messaging_contact_id=k.id where b.tenant_id=target_tenant_id and b.program_id=p.id and c.id=target_conversation_id;
 if a.id is null then return jsonb_build_object('message_id',null);end if;
 for m in select q.* from public.messages q where q.tenant_id=target_tenant_id and q.conversation_id=target_conversation_id and q.direction='outbound'and q.status='sending'and q.updated_at<clock_timestamp()-interval '30 seconds'order by q.created_at,q.id for update skip locked limit 3 loop
  update public.messages set status='failed',failure_code='TELEGRAM_DELIVERY_UNCERTAIN'where id=m.id;
  update public.conversations set attention_required=true,runtime_mode='PAUSED',human_takeover=true,automatic_replies_enabled=false where tenant_id=target_tenant_id and id=target_conversation_id;
  insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','private_beta.delivery_unknown','messages',m.id::text,'{"reason":"EXPIRED_SENDING_LEASE","retry":false}');
 end loop;
 -- Retire a bounded number of obsolete drafts/known-rejected retries without
 -- erasing their history. These rows must not monopolize future recovery cycles.
 for m in select q.* from public.messages q where q.tenant_id=target_tenant_id and q.conversation_id=target_conversation_id and q.direction='outbound'and q.status in('pending','retry_scheduled')order by q.created_at,q.id for update skip locked limit 25 loop
  if (select count(*)from(select 1 from public.message_delivery_attempts z where z.tenant_id=target_tenant_id and z.message_id=m.id limit 3)bounded)>=3
   or(m.actor_id like 'private-beta-ai:%'and(a.status<>'ACTIVE'or a.last_inbound_id is distinct from m.reply_to_message_id or m.actor_id is distinct from 'private-beta-ai:'||a.revision::text))
   or(m.actor_type='HUMAN'and a.status<>'ACTIVE')
   or(m.idempotency_key like 'private-beta-notice:%'and a.status<>'PENDING_NOTICE')
   or(m.idempotency_key like 'private-beta-agreed:%'and a.status<>'ACTIVE')then
   update public.messages set status='blocked',failure_code='PRIVATE_BETA_RECOVERY_REVIEW'where id=m.id;
   update public.conversations set attention_required=true where tenant_id=target_tenant_id and id=target_conversation_id;
   insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','private_beta.delivery_review','messages',m.id::text,'{"reason":"STALE_OR_RETRY_BUDGET","delivered":false}');
  end if;
 end loop;
 select q.id into mid from public.messages q where q.tenant_id=target_tenant_id and q.conversation_id=target_conversation_id and q.direction='outbound'and q.status in('pending','retry_scheduled')and(q.retry_after_at is null or q.retry_after_at<=clock_timestamp())and(q.actor_id='private-beta-notice'or q.actor_id like 'private-beta-ai:%'or q.actor_type='HUMAN')order by q.created_at,q.id limit 1;
 return jsonb_build_object('message_id',mid);end;$$;
create or replace function public.private_beta_recovery_targets_v1(target_tenant_id uuid,program_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare p private.private_beta_programs;result jsonb;begin
 p:=private.private_beta_guard(target_tenant_id,program_id_value);
 -- Recovery can record unknown effects after STOPPED/opt-out; dispatch has its
 -- own current authority check. Include consent notices before conversation bind.
 select coalesce(jsonb_agg(x),'[]')into result from(select c.id conversation_id from public.conversations c join public.messaging_contacts k on k.tenant_id=c.tenant_id and k.id=c.messaging_contact_id join private.private_beta_participants a on a.tenant_id=k.tenant_id and a.provider_chat_id=k.provider_chat_id and a.provider_user_id=k.provider_user_id where c.tenant_id=target_tenant_id and a.program_id=p.id and(
 exists(select 1 from public.agent_tasks q where q.tenant_id=c.tenant_id and q.conversation_id=c.id and q.task_type='private_beta.reply'and(q.status='QUEUED'or(q.status='RUNNING'and q.locked_at<clock_timestamp()-interval '120 seconds')))
 or exists(select 1 from public.messages m where m.tenant_id=c.tenant_id and m.conversation_id=c.id and m.direction='outbound'and(m.status='pending'or(m.status='retry_scheduled'and m.retry_after_at<=clock_timestamp())or(m.status='sending'and m.updated_at<clock_timestamp()-interval '30 seconds'))))order by c.updated_at,c.id limit 1)x;return result;end;$$;
revoke all on function public.private_beta_recover_delivery_v1(uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.private_beta_recover_delivery_v1(uuid,uuid,uuid)to service_role;

-- Idempotent repair after a crash between inbound persistence and first bind.
-- This reuses the very same capture function as the domain-event trigger.
create function public.private_beta_track_source_v1(target_tenant_id uuid,target_conversation_id uuid,source_message_id_value uuid)returns boolean language plpgsql security definer set search_path=pg_catalog as $$declare e public.domain_events;begin
 if not exists(select 1 from private.private_beta_participants where tenant_id=target_tenant_id and conversation_id=target_conversation_id)then return false;end if;
 select ev.* into e from public.domain_events ev join public.messages m on m.tenant_id=ev.tenant_id and m.id::text=ev.payload->>'message_id'where ev.tenant_id=target_tenant_id and ev.event_type='message.received'and m.id=source_message_id_value and m.conversation_id=target_conversation_id and m.direction='inbound'order by ev.recorded_at,ev.id limit 1;
 if e.id is null then return false;end if;perform private.private_beta_capture_source(e);return true;end;$$;
revoke all on function public.private_beta_track_source_v1(uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.private_beta_track_source_v1(uuid,uuid,uuid)to service_role;
