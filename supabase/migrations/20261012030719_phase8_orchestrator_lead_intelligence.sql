-- Phase 8: reuse durable tasks/runs and Customer OS; no financial/state/delivery authority.
alter table public.tenants add column lead_intelligence_enabled boolean not null default false,
  add column lead_intelligence_enabled_at timestamptz;
create or replace function private.phase7_consume_event_for_agent_runtime(
  target_tenant_id uuid,
  target_event_id uuid,
  worker_id_value text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  event_value public.domain_events%rowtype;
  version_value public.agent_versions%rowtype;
  version_id_value uuid;
  task_id_value uuid;
  conversation_id_value uuid;
  idempotency_value text;
begin
  select * into event_value from public.domain_events
  where tenant_id = target_tenant_id and id = target_event_id;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;

  if event_value.event_type <> 'message.received' then
    return jsonb_build_object('action','observed','event_type',event_value.event_type);
  end if;

  conversation_id_value := nullif(event_value.payload->>'conversation_id','')::uuid;
  if not exists (
    select 1 from public.conversations c
    where c.tenant_id = target_tenant_id and c.id = conversation_id_value
  ) then raise exception 'conversation scope mismatch' using errcode = '42501'; end if;

  -- Run the upsert in its own statement. A row inserted by a function invoked
  -- inside a SELECT predicate is not visible to that SELECT's statement
  -- snapshot, which would leave the composite record null on first use.
  version_id_value := private.ensure_shadow_agent(target_tenant_id);
  select * into strict version_value from public.agent_versions
  where tenant_id = target_tenant_id and id = version_id_value;

  idempotency_value := 'event:' || target_event_id::text || ':conversation-shadow:v1';
  insert into public.agent_tasks (
    tenant_id, agent_definition_id, agent_version_id, customer_id,
    conversation_id, source_event_id, task_type, objective, execution_mode,
    status, idempotency_key, correlation_id, causation_id, max_attempts
  ) values (
    target_tenant_id, version_value.agent_definition_id, version_value.id,
    event_value.customer_id, conversation_id_value, event_value.id,
    'conversation.shadow_draft', 'Produce a bounded, non-sending response proposal.',
    'SHADOW', 'QUEUED', idempotency_value, event_value.correlation_id,
    event_value.id, version_value.max_attempts
  ) on conflict (tenant_id, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id into task_id_value;

  perform private.append_domain_event(
    target_tenant_id, event_value.customer_id, 'agent.task_created', 1,
    jsonb_build_object('task_id',task_id_value,'agent','conversation_shadow'),
    'SYSTEM', left(worker_id_value,120), 'agent.runtime.worker', 'UNTRUSTED',
    event_value.correlation_id, event_value.id,
    'agent:task-created:' || task_id_value::text, now()
  );

  return jsonb_build_object('action','task_created','task_id',task_id_value);
end;
$$;


revoke all on function private.phase7_consume_event_for_agent_runtime(uuid,uuid,text) from public,anon,authenticated;

create function public.configure_phase8_orchestration(target_tenant_id uuid,enabled_value boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare old_value boolean;
begin
  select lead_intelligence_enabled into old_value from public.tenants where id=target_tenant_id and status='active' for update;
  if not found then raise exception 'active tenant required' using errcode='42501'; end if;
  update public.tenants set lead_intelligence_enabled=enabled_value,
    lead_intelligence_enabled_at=case when enabled_value then coalesce(lead_intelligence_enabled_at,now()) else null end
  where id=target_tenant_id;
  insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,before_data,after_data)
  values(target_tenant_id,'SYSTEM','orchestrator.configuration_changed','tenants',target_tenant_id::text,
    jsonb_build_object('enabled',old_value),jsonb_build_object('enabled',enabled_value));
  return enabled_value;
end; $$;
revoke all on function public.configure_phase8_orchestration(uuid,boolean) from public,anon,authenticated;
grant execute on function public.configure_phase8_orchestration(uuid,boolean) to service_role;

create function private.ensure_lead_agent(target_tenant_id uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare d uuid; v uuid;
begin
  insert into public.agent_definitions(tenant_id,agent_type,name,default_execution_mode)
  values(target_tenant_id,'lead_intelligence','Lead Intelligence','SHADOW')
  on conflict(tenant_id,agent_type) do update set agent_type=excluded.agent_type returning id into d;
  select id into v from public.agent_versions where tenant_id=target_tenant_id and agent_definition_id=d and superseded_at is null;
  if v is null then
    insert into public.agent_versions(tenant_id,agent_definition_id,version,prompt_template,allowed_tools,model_provider,model_name,timeout_ms,max_attempts)
    values(target_tenant_id,d,1,'Deterministic evidence extraction only. No model invocation, messaging, identity merge, lifecycle or financial actions.','{}','deterministic','lead-intelligence-v1',5000,3) returning id into v;
  end if;
  return v;
end; $$;
revoke all on function private.ensure_lead_agent(uuid) from public,anon,authenticated;

create or replace function public.consume_event_for_agent_runtime(target_tenant_id uuid,target_event_id uuid,worker_id_value text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare e public.domain_events%rowtype; c public.conversations%rowtype; m public.messages%rowtype;
  av public.agent_versions%rowtype; enabled boolean; enabled_at timestamptz; result_value jsonb;
  task_value uuid; existing_task uuid; reason_value text; source_at timestamptz;
begin
  select lead_intelligence_enabled,lead_intelligence_enabled_at into enabled,enabled_at
    from public.tenants where id=target_tenant_id and status='active' for update;
  if not found then raise exception 'tenant scope denied' using errcode='42501'; end if;
  select * into e from public.domain_events where tenant_id=target_tenant_id and id=target_event_id;
  if not found then raise exception 'event scope denied' using errcode='42501'; end if;
  if not enabled then return private.phase7_consume_event_for_agent_runtime(target_tenant_id,target_event_id,worker_id_value); end if;
  reason_value := 'unsupported_event'; source_at:=e.recorded_at;
  if e.event_type='message.received' then
    select * into c from public.conversations where tenant_id=target_tenant_id and id::text=e.payload->>'conversation_id';
    select * into m from public.messages where tenant_id=target_tenant_id and conversation_id=c.id and id::text=e.payload->>'message_id' and direction='inbound';
    if c.id is null or m.id is null or c.customer_id is distinct from e.customer_id or m.customer_id is distinct from e.customer_id then
      raise exception 'source scope denied' using errcode='42501'; end if;
    source_at:=m.created_at;
    reason_value:=case when c.status<>'open' or c.human_takeover or c.runtime_mode<>'AI_ACTIVE' then 'human_control'
      when m.created_at<enabled_at or m.created_at<now()-interval '5 minutes' then 'stale_source'
      else 'lead_then_conversation' end;
    -- A stale event never creates a new reply. Existing Phase 7 evidence is untouched.
    if reason_value<>'stale_source' then result_value:=private.phase7_consume_event_for_agent_runtime(target_tenant_id,target_event_id,worker_id_value); end if;
  elsif e.event_type in ('customer.created','customer.state_changed') then
    if e.authority<>'TRUSTED' or not exists(select 1 from public.customers where tenant_id=target_tenant_id and id=e.customer_id) then
      reason_value:='unauthorized_customer_event';
    else reason_value:=case when e.recorded_at<enabled_at or e.recorded_at<now()-interval '5 minutes' then 'stale_source' else 'customer_profile_review' end; end if;
  end if;
  if reason_value in ('lead_then_conversation','customer_profile_review') then
    task_value:=private.ensure_lead_agent(target_tenant_id);
    select * into av from public.agent_versions where id=task_value and tenant_id=target_tenant_id;
    task_value:=null;
    insert into public.agent_tasks(tenant_id,agent_definition_id,agent_version_id,customer_id,conversation_id,source_event_id,task_type,objective,execution_mode,status,priority,idempotency_key,correlation_id,causation_id,max_attempts)
    values(target_tenant_id,av.agent_definition_id,av.id,e.customer_id,c.id,e.id,'lead.intelligence','Extract supported qualification and propose an internal next action.','SHADOW','QUEUED',60,'event:'||e.id::text||':lead-intelligence:v1',e.correlation_id,e.id,3)
    on conflict(tenant_id,idempotency_key) do nothing returning id into task_value;
    select id into existing_task from public.agent_tasks where tenant_id=target_tenant_id and idempotency_key='event:'||e.id::text||':lead-intelligence:v1';
  end if;
  if not exists(select 1 from public.audit_logs where tenant_id=target_tenant_id and action='orchestrator.routed' and entity_id=e.id::text) then
    insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)
    values(target_tenant_id,'SYSTEM','orchestrator.routed','domain_events',e.id::text,jsonb_build_object('reason',reason_value,'lead_task_id',existing_task,'conversation_task_id',result_value->>'task_id','source_at',source_at,'delivery','none'));
  end if;
  return coalesce(result_value,'{}'::jsonb)||jsonb_build_object('routing',reason_value,'lead_task_id',existing_task);
end; $$;
revoke all on function public.consume_event_for_agent_runtime(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.consume_event_for_agent_runtime(uuid,uuid,text) to service_role;

create function public.phase8_task_context(target_tenant_id uuid,target_task_id uuid,worker_id_value text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare t public.agent_tasks%rowtype; e public.domain_events%rowtype; c public.conversations%rowtype; source_at timestamptz; prior_value jsonb; customer_state text;
begin
  select * into t from public.agent_tasks where tenant_id=target_tenant_id and id=target_task_id and status='RUNNING' and locked_by=left(worker_id_value,120) and task_type='lead.intelligence';
  if not found then raise exception 'lead task lease denied' using errcode='42501'; end if;
  select * into e from public.domain_events where tenant_id=target_tenant_id and id=t.source_event_id;
  if t.conversation_id is not null then
    select * into c from public.conversations where tenant_id=target_tenant_id and id=t.conversation_id;
    if c.customer_id is distinct from t.customer_id then raise exception 'identity changed' using errcode='42501'; end if;
    select created_at into source_at from public.messages where tenant_id=target_tenant_id and id::text=e.payload->>'message_id' and conversation_id=c.id;
  else source_at:=e.recorded_at; end if;
  select state::text into customer_state from public.customers where tenant_id=target_tenant_id and id=t.customer_id;
  select r.structured_output into prior_value from public.agent_runs r join public.agent_tasks p on p.tenant_id=r.tenant_id and p.id=r.task_id
    where r.tenant_id=target_tenant_id and p.task_type='lead.intelligence' and r.status='SUCCEEDED' and p.id<>t.id
      and p.conversation_id is not distinct from t.conversation_id and p.customer_id is not distinct from t.customer_id
      and (r.context_manifest->>'context_boundary_timestamp')::timestamptz<source_at order by r.completed_at desc limit 1;
  return jsonb_build_object('source_id',e.id,'observed_at',source_at,'customer_state',customer_state,'runtime_mode',coalesce(c.runtime_mode::text,'PAUSED'),'outbound_enabled',(select outbound_messaging_enabled from public.tenants where id=target_tenant_id),'contactability',coalesce((select contactability::text from public.messaging_contacts where tenant_id=target_tenant_id and id=c.messaging_contact_id),'unknown'),'prior',prior_value);
end; $$;
revoke all on function public.phase8_task_context(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.phase8_task_context(uuid,uuid,text) to service_role;

create function public.complete_lead_intelligence(target_tenant_id uuid,target_run_id uuid,worker_id_value text,result_value jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r public.agent_runs%rowtype; t public.agent_tasks%rowtype; f jsonb; src jsonb; boundary timestamptz; metadata_value jsonb; key_value text; persist_profile boolean;
begin
  select * into r from public.agent_runs where tenant_id=target_tenant_id and id=target_run_id and status='RUNNING' and worker_id=left(worker_id_value,120) for update;
  select * into t from public.agent_tasks where tenant_id=target_tenant_id and id=r.task_id and task_type='lead.intelligence' and status='RUNNING' and locked_by=left(worker_id_value,120) for update;
  if r.id is null or t.id is null then raise exception 'lead lease denied' using errcode='42501'; end if;
  boundary:=(r.context_manifest->>'context_boundary_timestamp')::timestamptz;
  if boundary is null or boundary>now() then raise exception 'invalid source boundary' using errcode='22023'; end if;
  if not result_value ?& array['version','identity','fields','completeness','missing_fields','next_action'] or result_value->>'version'<>'lead-intelligence-v1' or jsonb_typeof(result_value->'fields')<>'array' or jsonb_array_length(result_value->'fields')<>13
    or jsonb_typeof(result_value->'next_action')<>'object' or not (result_value->'next_action') ?& array['action','reason','field','question','delivery'] or result_value->'next_action'->>'action' not in ('ASK_ONE_QUESTION','ANSWER_EXISTING_QUESTION','CONTINUE_CONVERSATION','HUMAN_REVIEW','PREPARE_LATER_STAGE','WAIT') or result_value->'next_action'->>'delivery'<>'proposal_only' or result_value->>'identity'<>case when t.customer_id is null then 'unmatched' else 'matched' end then
    raise exception 'invalid lead result' using errcode='22023'; end if;
  if jsonb_typeof(result_value->'completeness')<>'number' or jsonb_typeof(result_value->'missing_fields')<>'array' then raise exception 'invalid qualification score' using errcode='22023'; end if;
  if abs((result_value->>'completeness')::numeric - (select count(*)::numeric/13 from jsonb_array_elements(result_value->'fields') x where x->>'classification' in ('explicit','verified_system')))>0.00001 then raise exception 'qualification score unsupported' using errcode='22023'; end if;
  if (select count(distinct x->>'key') from jsonb_array_elements(result_value->'fields') x)<>13 then raise exception 'duplicate lead fields' using errcode='22023'; end if;
  for f in select * from jsonb_array_elements(result_value->'fields') loop
    key_value:=f->>'key'; src:=f->'source';
    if not f ?& array['key','value','classification','confidence','source'] or jsonb_typeof(f->'confidence')<>'number' or key_value not in ('experience_level','primary_instrument','actively_trades','previous_service_experience','goals','requirements','pain_points','objections','communication_style','preferred_language','preferred_signal_frequency','price_sensitivity','lead_source')
      or f->>'classification' not in ('explicit','verified_system','inferred','unknown') or (f->>'confidence')::numeric not between 0 and 1 then raise exception 'invalid lead field' using errcode='22023'; end if;
    if f->>'classification'='unknown' then
      if f->>'value' is not null or src<>'null'::jsonb or (f->>'confidence')::numeric<>0 then raise exception 'unknown attribute invented' using errcode='22023'; end if;
    elsif f->>'classification'='verified_system' then
      if jsonb_typeof(f->'value')<>'string' or jsonb_typeof(src)<>'object' then raise exception 'invalid verified field' using errcode='22023'; end if;
      if not src ?& array['type','id','quote','observed_at'] or key_value<>'lead_source' or src->>'type' is distinct from 'system' or src->>'id' is distinct from t.source_event_id::text or (src->>'observed_at')::timestamptz is distinct from boundary or f->>'value'<>case when t.conversation_id is null then 'customer_os' else 'telegram' end then raise exception 'system attribute forged' using errcode='42501'; end if;
    else
      if jsonb_typeof(f->'value')<>'string' or jsonb_typeof(src)<>'object' or not src ?& array['type','id','quote','observed_at'] then raise exception 'invalid field source' using errcode='22023'; end if;
      if src->>'type'<>'message' or coalesce(length(src->>'quote'),0)=0 or not exists(select 1 from public.messages m where m.tenant_id=target_tenant_id and m.conversation_id=t.conversation_id and m.customer_id is not distinct from t.customer_id and m.id::text=src->>'id' and m.direction='inbound' and m.created_at<=boundary and m.occurred_at=(src->>'observed_at')::timestamptz and position(src->>'quote' in normalize(m.content,NFKC))>0) then raise exception 'lead provenance denied' using errcode='42501'; end if;
    end if;
  end loop;
  -- Recheck human control after extraction; an internal result cannot authorize a send.
  if t.conversation_id is not null and exists(select 1 from public.conversations c where c.tenant_id=target_tenant_id and c.id=t.conversation_id and (c.customer_id is distinct from t.customer_id or c.human_takeover or c.runtime_mode<>'AI_ACTIVE' or c.status<>'open')) then
    result_value:=jsonb_set(result_value,'{next_action}',jsonb_build_object('action','WAIT','reason','Human control changed during task','field',null,'question',null,'delivery','proposal_only'));
  end if;
  persist_profile:=t.customer_id is not null and boundary>=now()-interval '5 minutes';
  if not persist_profile and boundary<now()-interval '5 minutes' then
    result_value:=jsonb_set(result_value,'{next_action}',jsonb_build_object('action','WAIT','reason','Stale source; no current profile mutation','field',null,'question',null,'delivery','proposal_only'));
  end if;
  if persist_profile then
    insert into public.customer_profiles(tenant_id,customer_id) values(target_tenant_id,t.customer_id) on conflict(customer_id) do nothing;
    select field_metadata into metadata_value from public.customer_profiles where tenant_id=target_tenant_id and customer_id=t.customer_id for update;
    if exists(select 1 from jsonb_array_elements(coalesce(metadata_value->'phase8_qualification'->'fields','[]'::jsonb)) old_field where old_field->>'key'='lead_source' and (old_field->'source'->>'observed_at')::timestamptz>boundary) then
      persist_profile:=false;
      result_value:=jsonb_set(result_value,'{next_action}',jsonb_build_object('action','WAIT','reason','A newer customer profile already exists','field',null,'question',null,'delivery','proposal_only'));
    end if;
    if persist_profile then
    update public.customer_profiles set field_metadata=metadata_value||jsonb_build_object('phase8_qualification',result_value),next_best_action=result_value->'next_action'->>'action',updated_at=now() where tenant_id=target_tenant_id and customer_id=t.customer_id;
    for f in select * from jsonb_array_elements(result_value->'fields') loop
      key_value:=f->>'key';
      if f->>'classification'='explicit' and key_value in ('experience_level','primary_instrument','previous_service_experience','pain_points','objections','communication_style','preferred_signal_frequency','price_sensitivity') then
        -- Keep historical memories append-only except for their established supersession marker.
        if not exists(select 1 from public.customer_memory where tenant_id=target_tenant_id and customer_id=t.customer_id and memory_key=key_value and source_id=f->'source'->>'id' and memory_value=f->'value') then
          update public.customer_memory set superseded_at=now() where tenant_id=target_tenant_id and customer_id=t.customer_id and memory_key=key_value and superseded_at is null;
          insert into public.customer_memory(tenant_id,customer_id,memory_key,memory_value,source_type,source_id,confidence,observed_at)
          values(target_tenant_id,t.customer_id,key_value,f->'value','conversation_explicit',f->'source'->>'id',(f->>'confidence')::numeric,(f->'source'->>'observed_at')::timestamptz);
        end if;
      end if;
    end loop;
    end if;
  end if;
  update public.agent_runs set structured_output=result_value,status='SUCCEEDED',completed_at=now(),latency_ms=greatest(0,(extract(epoch from clock_timestamp()-r.started_at)*1000)::integer),input_tokens=0,output_tokens=0,total_tokens=0 where tenant_id=target_tenant_id and id=r.id;
  update public.agent_tasks set status='SUCCEEDED',completed_at=now(),locked_by=null,locked_at=null where tenant_id=target_tenant_id and id=t.id;
  insert into public.agent_run_attempts(tenant_id,task_id,run_id,attempt_number,stage,worker_id) values(target_tenant_id,t.id,r.id,r.attempt_number,'completed',left(worker_id_value,120));
  insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data) values(target_tenant_id,'SYSTEM','lead.intelligence_completed','agent_runs',r.id::text,jsonb_build_object('identity',result_value->>'identity','next_action',result_value->'next_action'->>'action','customer_profile_updated',persist_profile,'message_sent',false));
  return true;
end; $$;
revoke all on function public.complete_lead_intelligence(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_lead_intelligence(uuid,uuid,text,jsonb) to service_role;

create function public.phase8_qualification_for_source(target_tenant_id uuid,target_event_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select r.structured_output from public.agent_runs r join public.agent_tasks t on t.tenant_id=r.tenant_id and t.id=r.task_id
  where r.tenant_id=target_tenant_id and t.source_event_id=target_event_id and t.task_type='lead.intelligence' and r.status='SUCCEEDED' order by r.completed_at desc limit 1;
$$;
revoke all on function public.phase8_qualification_for_source(uuid,uuid) from public,anon,authenticated;
grant execute on function public.phase8_qualification_for_source(uuid,uuid) to service_role;

create function public.admin_lead_intelligence(target_tenant_id uuid,target_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  if not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[]) then raise exception 'lead read denied' using errcode='42501'; end if;
  if not exists(select 1 from public.conversations where tenant_id=target_tenant_id and id=target_conversation_id) then raise exception 'conversation scope denied' using errcode='42501'; end if;
  return (select jsonb_build_object('run_id',r.id,'task_id',t.id,'status',t.status,'failure_code',t.failure_code,'result',r.structured_output,'created_at',t.created_at) from public.agent_tasks t left join public.agent_runs r on r.tenant_id=t.tenant_id and r.task_id=t.id where t.tenant_id=target_tenant_id and t.conversation_id=target_conversation_id and t.task_type='lead.intelligence' order by t.created_at desc,r.attempt_number desc limit 1);
end; $$;
revoke all on function public.admin_lead_intelligence(uuid,uuid) from public,anon;
grant execute on function public.admin_lead_intelligence(uuid,uuid) to authenticated;

create or replace function public.admin_agent_tasks(
  target_tenant_id uuid,
  status_value text default null,
  page_value integer default 1,
  page_size_value integer default 50
)
returns jsonb
language plpgsql stable security definer set search_path=pg_catalog
as $$
declare result_value jsonb;
begin
  if not private.has_tenant_role(target_tenant_id,
    array['super_admin','manager','support','analyst']::public.app_role[]) then
    raise exception 'agent tasks read denied' using errcode='42501'; end if;
  with filtered as (
    select at.id,at.customer_id,at.conversation_id,at.task_type,at.execution_mode,
      at.status,at.attempts,at.max_attempts,at.failure_category,at.failure_code,
      at.correlation_id,at.created_at,at.started_at,at.completed_at,
      ad.name agent_name,av.version,av.model_provider,av.model_name,
      ap.id proposal_id,coalesce(ap.run_id,lr.id) run_id,ap.approval_status
    from public.agent_tasks at
    join public.agent_definitions ad on ad.tenant_id=at.tenant_id and ad.id=at.agent_definition_id
    join public.agent_versions av on av.tenant_id=at.tenant_id and av.id=at.agent_version_id
    left join lateral (
      select id,run_id,approval_status from public.agent_proposals p
      where p.tenant_id=at.tenant_id and p.task_id=at.id order by p.created_at desc limit 1
    ) ap on true
    where at.tenant_id=target_tenant_id
      and (status_value is null or at.status::text=status_value)
  ), counted as (select count(*)::integer total from filtered), paged as (
    select * from filtered order by created_at desc,id desc
    limit greatest(1,least(page_size_value,100))
    offset (greatest(page_value,1)-1)*greatest(1,least(page_size_value,100))
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb),
    'total',(select total from counted),'page',greatest(page_value,1),
    'page_size',greatest(1,least(page_size_value,100))) into result_value;
  return result_value;
end;
$$;

