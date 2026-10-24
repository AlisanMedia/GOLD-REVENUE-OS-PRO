-- Explicit, repository/fixture-only profile on the accepted tasks/runs/QA runtime.
create table private.polat_runtime_profiles(
 tenant_id uuid not null,conversation_id uuid not null,agent_version_id uuid not null,enabled boolean not null default false,
 primary key(tenant_id,conversation_id),foreign key(tenant_id,conversation_id)references private.polat_conversation_controls(tenant_id,conversation_id),
 foreign key(tenant_id,agent_version_id)references public.agent_versions(tenant_id,id)
);
create table private.polat_runtime_drafts(
 id uuid primary key default extensions.gen_random_uuid(),tenant_id uuid not null,conversation_id uuid not null,message_id uuid not null,
 source_event_id uuid not null,run_id uuid not null,proposal_id uuid not null,operation_id uuid not null default extensions.gen_random_uuid(),generation bigint not null,
 body text not null check(length(body)between 1 and 600),body_hash text not null,source_hash text not null,qa_approved boolean not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),unique(tenant_id,run_id),unique(tenant_id,operation_id),unique(tenant_id,proposal_id),
 foreign key(tenant_id,conversation_id)references private.polat_runtime_profiles(tenant_id,conversation_id),foreign key(tenant_id,message_id)references private.polat_inbound_work(tenant_id,message_id),
 foreign key(tenant_id,run_id)references public.agent_runs(tenant_id,id),foreign key(tenant_id,proposal_id)references public.agent_proposals(tenant_id,id),
 foreign key(tenant_id,source_event_id)references public.domain_events(tenant_id,id)
);
create index polat_runtime_history on private.polat_runtime_drafts(tenant_id,conversation_id,created_at,id);
create table private.polat_runtime_steps(
 sequence bigint generated always as identity primary key,tenant_id uuid not null,draft_id uuid not null,kind text not null,
 occurred_at timestamptz not null default clock_timestamp(),unique(tenant_id,draft_id,kind),
 check(kind in('GENERATED','QA_APPROVED','QA_HELD','QUEUED','SENT_TO_FAKE','FAKE_ACKNOWLEDGED','DELIVERY_UNKNOWN','FAILED_BEFORE_SEND')),
 foreign key(tenant_id,draft_id)references private.polat_runtime_drafts(tenant_id,id)
);
create trigger polat_runtime_draft_immutable before update or delete on private.polat_runtime_drafts for each row execute function private.fse_immutable();
create trigger polat_runtime_step_immutable before update or delete on private.polat_runtime_steps for each row execute function private.fse_immutable();
do $$declare tbl text;begin foreach tbl in array array['polat_runtime_profiles','polat_runtime_drafts','polat_runtime_steps']loop
 execute format('alter table private.%I enable row level security',tbl);execute format('revoke all on private.%I from public,anon,authenticated,service_role',tbl);end loop;end;$$;
create function private.polat_runtime_guard(t uuid,c uuid)returns void language plpgsql set search_path=pg_catalog as $$begin
 perform private.polat_guard(t,c);
 if not exists(select 1 from private.polat_runtime_profiles p join public.agent_versions v on v.tenant_id=p.tenant_id and v.id=p.agent_version_id where p.tenant_id=t and p.conversation_id=c and p.enabled and v.model_provider='mock'and v.model_name='polat-test-runtime-v1')then raise exception 'Polat TEST profile unavailable'using errcode='42501';end if;
end;$$;
-- Owner/test harness only: no Data API or service-role setup authority.
create function private.polat_configure_runtime_fixture(t uuid,c uuid)returns uuid language plpgsql set search_path=pg_catalog as $$declare v public.agent_versions;newid uuid;n integer;begin
 perform private.polat_guard(t,c);perform 1 from public.conversations where tenant_id=t and id=c for no key update;
 select agent_version_id into newid from private.polat_runtime_profiles where tenant_id=t and conversation_id=c and enabled;if newid is not null then return newid;end if;
 newid:=private.ensure_shadow_agent(t);
 select * into strict v from public.agent_versions where tenant_id=t and id=newid;
 select id into newid from public.agent_versions where tenant_id=t and agent_definition_id=v.agent_definition_id and model_name='polat-test-runtime-v1'and superseded_at is null order by version desc limit 1;
 if newid is null then
  select coalesce(max(version),0)+1 into n from public.agent_versions where tenant_id=t and agent_definition_id=v.agent_definition_id;
  update public.agent_versions set superseded_at=clock_timestamp()where tenant_id=t and agent_definition_id=v.agent_definition_id and superseded_at is null;
  insert into public.agent_versions(tenant_id,agent_definition_id,version,prompt_template,output_schema_version,allowed_tools,model_provider,model_name,timeout_ms,max_attempts,prompt_version,director_version,renderer_version,qa_version,context_version,evaluation_set_version)
  values(t,v.agent_definition_id,n,'Polat AI assistant TEST fixture. No live financial, message or access authority.',4,v.allowed_tools,'mock','polat-test-runtime-v1',15000,3,v.prompt_version,v.director_version,v.renderer_version,v.qa_version,3,v.evaluation_set_version)returning id into newid;
 end if;
 insert into private.polat_runtime_profiles values(t,c,newid,true)on conflict(tenant_id,conversation_id)do update set enabled=true,agent_version_id=excluded.agent_version_id;
 update public.tenants set lead_intelligence_enabled=true,lead_intelligence_enabled_at=coalesce(lead_intelligence_enabled_at,(select activation_at from private.polat_conversation_controls where tenant_id=t and conversation_id=c))where id=t;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(t,'SYSTEM','polat.test_profile_enabled','conversations',c::text,jsonb_build_object('profile','polat-test-runtime-v1','financial_authority','NONE','live_operations_authorized',false));return newid;
end;$$;
create function public.polat_test_runtime_context_v1(target_tenant_id uuid,target_conversation_id uuid,target_event_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare w private.polat_inbound_work;cv public.conversations;ctrl private.polat_conversation_controls;history jsonb;mem jsonb;begin
 perform private.polat_runtime_guard(target_tenant_id,target_conversation_id);
 select m.* into strict cv from public.conversations m where m.tenant_id=target_tenant_id and m.id=target_conversation_id;
 select x.* into w from private.polat_inbound_work x join public.domain_events e on e.tenant_id=x.tenant_id and e.payload->>'message_id'=x.message_id::text where e.tenant_id=target_tenant_id and e.id=target_event_id and e.event_type='message.received'and x.conversation_id=target_conversation_id;
 if w.message_id is null then raise exception 'Polat source unavailable'using errcode='42501';end if;
 select * into strict ctrl from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=target_conversation_id;
 with candidates as(
  select m.id,x.sequence source_order,0 phase,x.received_at at,m.content,'inbound' direction,'CUSTOMER' author,'INBOUND_OBSERVED' delivery
  from private.polat_inbound_work x join public.messages m on m.tenant_id=x.tenant_id and m.id=x.message_id
  where x.tenant_id=target_tenant_id and x.conversation_id=target_conversation_id and x.sequence<=w.sequence
  union all
  select d.id,x.sequence,1,e.created_at,d.body,'outbound','AI','FAKE_ACKNOWLEDGED'
  from private.polat_runtime_drafts d join private.polat_inbound_work x on x.tenant_id=d.tenant_id and x.message_id=d.message_id
  join private.polat_response_evidence e on e.tenant_id=d.tenant_id and e.operation_id=d.operation_id and e.stage='FAKE_ACK'
  where d.tenant_id=target_tenant_id and d.conversation_id=target_conversation_id and x.sequence<w.sequence and x.responded_at is not null and d.qa_approved and e.created_at<=w.received_at
 ), page as materialized(select * from candidates order by source_order desc,phase desc,id desc limit 20), budget as(
  select *,sum(length(content))over(order by source_order desc,phase desc,id desc) chars from page
 )select coalesce(jsonb_agg(jsonb_build_object('id',id,'tenant_id',target_tenant_id,'conversation_id',target_conversation_id,'direction',direction,'content',content,'occurred_at',at,'author',author,'delivery',delivery)order by source_order,phase,id),'[]'::jsonb)into history from budget where chars<=16000 and length(content)<=4096;
 select coalesce(jsonb_agg(jsonb_build_object('key','preferred_instrument','value',memory_value#>>'{}','quote',memory_value#>>'{}','source_message_id',source_id)),'[]'::jsonb)into mem from(
  select x.memory_value,x.source_id from public.customer_memory x where x.tenant_id=target_tenant_id and x.customer_id=cv.customer_id and x.memory_key='primary_instrument'and x.source_type='message'and x.superseded_at is null and x.observed_at<=w.received_at and x.memory_value#>>'{}'in('XAUUSD','EURUSD','GBPUSD','BTCUSD')
  and exists(select 1 from jsonb_array_elements(history)h where h->>'id'=x.source_id and h->>'direction'='inbound'and position(x.memory_value#>>'{}'in h->>'content')>0)order by x.observed_at desc,x.id desc limit 1
 )safe;
 return jsonb_build_object('version',1,'mode','SYNTHETIC','profile','polat-test-runtime-v1','generation',ctrl.generation::text,'input',jsonb_build_object('version',1,'mode','SYNTHETIC','tenant_id',target_tenant_id,'conversation_id',target_conversation_id,'customer_id',cv.customer_id,'source_message_id',w.message_id,'boundary',w.received_at,'runtime_mode',cv.runtime_mode,'contactability',case when exists(select 1 from public.messaging_contacts where tenant_id=target_tenant_id and id=cv.messaging_contact_id and contactability in('user_initiated','allowed'))then 'contactable'else 'unknown'end,'verified_customer_language',null,'messages',history,'memory',mem,'knowledge','[]'::jsonb),'subscription_context',(select coalesce(jsonb_agg(s),'[]'::jsonb)from(select id,state,ends_at,mode from public.subscriptions where tenant_id=target_tenant_id and customer_id=cv.customer_id and mode='test'order by created_at desc,id desc limit 3)s),'financial_authority','NONE','live_operations_authorized',false);
end;$$;
create function public.claim_polat_test_events_v1(target_tenant_id uuid,target_conversation_id uuid,worker_id_value text)returns table(outbox_id bigint,tenant_id uuid,event_id uuid,event_type text)language plpgsql security definer set search_path=pg_catalog as $$begin
 perform private.polat_runtime_guard(target_tenant_id,target_conversation_id);if nullif(btrim(worker_id_value),'')is null or length(worker_id_value)>120 then raise exception 'Worker required'using errcode='22023';end if;
 return query with candidates as(select o.id from public.event_outbox o join public.domain_events e on e.tenant_id=o.tenant_id and e.id=o.event_id where o.tenant_id=target_tenant_id and e.payload->>'conversation_id'=target_conversation_id::text and e.event_type='message.received'and o.attempts<o.max_attempts and((o.status='pending'and o.available_at<=now())or(o.status='processing'and o.locked_at<now()-interval '120 seconds'))order by o.available_at,o.id for update of o skip locked limit 25),claimed as(update public.event_outbox o set status='processing',attempts=attempts+1,locked_at=clock_timestamp(),locked_by=worker_id_value from candidates c where o.id=c.id returning o.*)
 select x.id,x.tenant_id,x.event_id,e.event_type from claimed x join public.domain_events e on e.tenant_id=x.tenant_id and e.id=x.event_id;
end;$$;
create function public.claim_polat_test_tasks_v1(target_tenant_id uuid,target_conversation_id uuid,worker_id_value text)returns table(task_id uuid,tenant_id uuid,agent_version_id uuid,customer_id uuid,conversation_id uuid,source_event_id uuid,task_type text,execution_mode public.agent_execution_mode,correlation_id uuid,causation_id uuid,attempt_number integer,timeout_ms integer,model_provider text,model_name text)language plpgsql security definer set search_path=pg_catalog as $$begin
 perform private.polat_runtime_guard(target_tenant_id,target_conversation_id);if nullif(btrim(worker_id_value),'')is null or length(worker_id_value)>120 then raise exception 'Worker required'using errcode='22023';end if;
 return query with candidates as(select a.id from public.agent_tasks a join public.agent_versions v on v.tenant_id=a.tenant_id and v.id=a.agent_version_id
 where a.tenant_id=target_tenant_id and a.conversation_id=target_conversation_id and a.execution_mode='SHADOW'and v.model_provider='mock'and a.task_type in('lead.intelligence','conversion.prepare','conversation.shadow_draft')and a.attempts<a.max_attempts
 and((a.status='QUEUED'and a.available_at<=now())or(a.status='RUNNING'and a.locked_at<now()-interval '120 seconds'))
 and not exists(select 1 from public.agent_tasks busy where busy.tenant_id=a.tenant_id and busy.conversation_id=a.conversation_id and busy.id<>a.id and busy.status='RUNNING'and busy.locked_at>=now()-interval '120 seconds')
 and exists(select 1 from public.conversations cv where cv.tenant_id=a.tenant_id and cv.id=a.conversation_id and cv.runtime_mode='AI_ACTIVE'and not cv.human_takeover)
 and pg_try_advisory_xact_lock(hashtextextended(a.tenant_id::text||':'||a.conversation_id::text,0))
 order by a.priority desc,a.created_at,a.id for update of a skip locked limit 1),claimed as(
 update public.agent_tasks a set status='RUNNING',attempts=attempts+1,locked_at=clock_timestamp(),locked_by=worker_id_value,started_at=coalesce(a.started_at,clock_timestamp()),timeout_at=clock_timestamp()+interval '120 seconds'from candidates x where a.id=x.id returning a.*),logged as(
 insert into public.agent_run_attempts(tenant_id,task_id,attempt_number,stage,worker_id)select x.tenant_id,x.id,x.attempts,'claimed',worker_id_value from claimed x returning id)
 select x.id,x.tenant_id,x.agent_version_id,x.customer_id,x.conversation_id,x.source_event_id,x.task_type,x.execution_mode,x.correlation_id,x.causation_id,x.attempts,v.timeout_ms,v.model_provider,v.model_name from claimed x join public.agent_versions v on v.tenant_id=x.tenant_id and v.id=x.agent_version_id;
end;$$;
create function private.polat_runtime_step(t uuid,d uuid,k text)returns void language plpgsql set search_path=pg_catalog as $$declare c uuid;begin
 insert into private.polat_runtime_steps(tenant_id,draft_id,kind)values(t,d,k)on conflict(tenant_id,draft_id,kind)do nothing;
 if found then select conversation_id into strict c from private.polat_runtime_drafts where tenant_id=t and id=d;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(t,'SYSTEM','polat.test_runtime_step','conversations',c::text,jsonb_build_object('stage',k,'financial_authority','NONE','live_operations_authorized',false));end if;
end;$$;
create function public.polat_test_runtime_queue_v1(target_tenant_id uuid,target_proposal_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p public.agent_proposals;r public.agent_runs;a public.agent_tasks;q public.conversation_quality_evaluations;d private.polat_runtime_drafts;w private.polat_inbound_work;g bigint;begin
 select * into p from public.agent_proposals where tenant_id=target_tenant_id and id=target_proposal_id;
 select * into a from public.agent_tasks where tenant_id=target_tenant_id and id=p.task_id;
 if a.id is null or a.task_type<>'conversation.shadow_draft'or not exists(select 1 from private.polat_runtime_profiles where tenant_id=target_tenant_id and conversation_id=a.conversation_id and agent_version_id=a.agent_version_id)then raise exception 'Polat proposal unavailable'using errcode='42501';end if;
 perform private.polat_runtime_guard(target_tenant_id,a.conversation_id);
 select * into strict r from public.agent_runs where tenant_id=target_tenant_id and id=p.run_id;
 select * into strict q from public.conversation_quality_evaluations where tenant_id=target_tenant_id and run_id=r.id;
 if r.context_manifest->>'polat_profile'is distinct from 'polat-test-runtime-v1'or r.context_manifest->>'polat_generation'!~'^[1-9][0-9]{0,18}$'then raise exception 'Polat context unavailable'using errcode='22023';end if;
 g:=(r.context_manifest->>'polat_generation')::bigint;
 select x.* into strict w from private.polat_inbound_work x join public.domain_events e on e.tenant_id=x.tenant_id and e.payload->>'message_id'=x.message_id::text where e.tenant_id=target_tenant_id and e.id=a.source_event_id;
 select * into d from private.polat_runtime_drafts where tenant_id=target_tenant_id and proposal_id=p.id;
 if d.id is null then
  insert into private.polat_runtime_drafts(tenant_id,conversation_id,message_id,source_event_id,run_id,proposal_id,generation,body,body_hash,source_hash,qa_approved)
  values(target_tenant_id,a.conversation_id,w.message_id,a.source_event_id,r.id,p.id,g,p.original_payload->>'proposed_response',private.fse_hash(p.original_payload->>'proposed_response'),w.source_hash,q.qa_action='approve'and not q.customer_facing_blocked and not p.customer_facing_blocked)returning * into d;
  perform private.polat_runtime_step(target_tenant_id,d.id,'GENERATED');perform private.polat_runtime_step(target_tenant_id,d.id,case when d.qa_approved then 'QA_APPROVED'else 'QA_HELD'end);
 end if;
 if d.qa_approved then perform private.polat_runtime_step(target_tenant_id,d.id,'QUEUED');elsif exists(select 1 from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=a.conversation_id and generation=g)then perform private.polat_hold_fixture(target_tenant_id,w.message_id,g,'QA_HOLD');end if;
 return jsonb_build_object('mode','SYNTHETIC','draft_id',d.id,'qa_approved',d.qa_approved,'operation_id',d.operation_id,'generation',d.generation::text,'tenant_id',d.tenant_id,'conversation_id',d.conversation_id,'message_id',d.message_id,'source_hash',d.source_hash,'body_hash',d.body_hash,'body',d.body,'financial_authority','NONE','live_operations_authorized',false);
end;$$;
create function public.polat_test_runtime_prepare_v1(target_tenant_id uuid,draft_id_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$declare d private.polat_runtime_drafts;begin
 select * into d from private.polat_runtime_drafts where tenant_id=target_tenant_id and id=draft_id_value;if d.id is null or not d.qa_approved then raise exception 'Polat draft unavailable'using errcode='42501';end if;perform private.polat_runtime_guard(target_tenant_id,d.conversation_id);
 return private.polat_prepare_fixture(d.tenant_id,d.message_id,d.operation_id,d.generation,d.source_hash,d.body_hash,'AI');
end;$$;
create function public.polat_test_runtime_can_send_v1(target_tenant_id uuid,draft_id_value uuid)returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$declare d private.polat_runtime_drafts;begin
 select * into d from private.polat_runtime_drafts where tenant_id=target_tenant_id and id=draft_id_value;if d.id is null or not d.qa_approved then return false;end if;perform private.polat_runtime_guard(target_tenant_id,d.conversation_id);return private.polat_can_dispatch_fixture(d.tenant_id,d.operation_id,d.generation);
end;$$;
create function public.polat_test_runtime_receipt_v1(target_tenant_id uuid,draft_id_value uuid,receipt_value text)returns text language plpgsql security definer set search_path=pg_catalog as $$declare d private.polat_runtime_drafts;v jsonb;s text;begin
 select * into d from private.polat_runtime_drafts where tenant_id=target_tenant_id and id=draft_id_value;if d.id is null or not d.qa_approved then raise exception 'Polat draft unavailable'using errcode='42501';end if;perform private.polat_runtime_guard(target_tenant_id,d.conversation_id);v:=private.fse_strict_json(receipt_value);
 if v->>'operation_id'is distinct from d.operation_id::text then raise exception 'Polat receipt unavailable'using errcode='22023';end if;
 s:=private.polat_outcome_fixture(target_tenant_id,d.operation_id,receipt_value);
 if v->>'result'='FAKE_ACK'then perform private.polat_runtime_step(target_tenant_id,d.id,'SENT_TO_FAKE');end if;
 perform private.polat_runtime_step(target_tenant_id,d.id,case when s='AI_RESPONDED'then 'FAKE_ACKNOWLEDGED'when v->>'result'='FAILED_BEFORE_SEND'then 'FAILED_BEFORE_SEND'else 'DELIVERY_UNKNOWN'end);return s;
end;$$;
create function public.polat_test_runtime_hold_v1(target_tenant_id uuid,target_conversation_id uuid,target_event_id uuid,reason_value text)returns text language plpgsql security definer set search_path=pg_catalog as $$declare x jsonb;begin
 x:=public.polat_test_runtime_context_v1(target_tenant_id,target_conversation_id,target_event_id);
 return private.polat_hold_fixture(target_tenant_id,(x#>>'{input,source_message_id}')::uuid,(x->>'generation')::bigint,case when reason_value='QA_HOLD'then 'QA_HOLD'else 'MODEL_UNAVAILABLE'end);
end;$$;
create function public.polat_test_runtime_refresh_v1(target_tenant_id uuid,target_conversation_id uuid)returns integer language plpgsql security definer set search_path=pg_catalog as $$begin
 perform private.polat_runtime_guard(target_tenant_id,target_conversation_id);return private.polat_refresh_fixture(target_tenant_id,25);
end;$$;
-- One bounded recovery candidate from the existing durable proposal queue.
create function public.polat_test_runtime_recovery_v1(target_tenant_id uuid,target_conversation_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$begin
 perform private.polat_runtime_guard(target_tenant_id,target_conversation_id);
 return(select coalesce(jsonb_agg(x),'[]'::jsonb)from(select p.id proposal_id from public.agent_proposals p
 join public.agent_tasks a on a.tenant_id=p.tenant_id and a.id=p.task_id
 join private.polat_runtime_profiles f on f.tenant_id=a.tenant_id and f.conversation_id=a.conversation_id and f.agent_version_id=a.agent_version_id
 join public.conversation_quality_evaluations q on q.tenant_id=p.tenant_id and q.run_id=p.run_id
 left join private.polat_runtime_drafts d on d.tenant_id=p.tenant_id and d.proposal_id=p.id
 where p.tenant_id=target_tenant_id and a.conversation_id=target_conversation_id and a.task_type='conversation.shadow_draft'
 and exists(select 1 from private.polat_conversation_controls ctrl join public.domain_events e on e.tenant_id=ctrl.tenant_id and e.id=a.source_event_id where ctrl.tenant_id=a.tenant_id and ctrl.conversation_id=a.conversation_id and ctrl.last_inbound_id::text=e.payload->>'message_id')and q.qa_action='approve'and not q.customer_facing_blocked
 and not exists(select 1 from private.polat_response_evidence e where e.tenant_id=d.tenant_id and e.operation_id=d.operation_id and e.stage in('FAKE_ACK','FAILED_BEFORE_SEND'))
 order by p.created_at,p.id limit 1)x);
end;$$;
-- The only additional QA references are immutable TEST persona identity, never financial facts.
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
revoke all on function private.assert_quality_output_refs(uuid,uuid,jsonb) from public,anon,authenticated;

-- Keep unknown fixture usage unknown, without changing any legacy/LIVE execution.
create function private.polat_unknown_usage()returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if new.model_provider='mock'and new.model_name='polat-test-runtime-v1'and new.input_tokens is null and new.output_tokens is null and exists(select 1 from private.polat_runtime_profiles where tenant_id=new.tenant_id and agent_version_id=new.agent_version_id and enabled)then new.total_tokens:=null;end if;return new;end;$$;
create trigger polat_unknown_usage before insert or update of model_name,input_tokens,output_tokens,total_tokens on public.agent_runs for each row execute function private.polat_unknown_usage();
do $$declare fn record;begin
 for fn in select oid::regprocedure sig from pg_proc where pronamespace='private'::regnamespace and(proname like 'polat_runtime_%'or proname in('polat_configure_runtime_fixture','polat_unknown_usage'))loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.sig);end loop;
 for fn in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and(proname like 'polat_test_runtime_%'or proname in('claim_polat_test_events_v1','claim_polat_test_tasks_v1'))loop execute format('revoke all on function %s from public,anon,authenticated',fn.sig);execute format('grant execute on function %s to service_role',fn.sig);end loop;
end;$$;
