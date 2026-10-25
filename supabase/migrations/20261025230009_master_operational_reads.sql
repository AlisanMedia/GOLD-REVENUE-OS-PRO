-- Read-only operator projection of the existing experiment store. No new writer or live authority.
create index polat_experiment_runs_admin_page on private.polat_experiment_runs(tenant_id,created_at desc,id desc);
create function public.admin_polat_experiment_page_v1(target_tenant_id uuid,page_size_value integer default 25,cursor_value jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' set plan_cache_mode=force_custom_plan as $$
declare role_value public.app_role;anchor_time timestamptz:=statement_timestamp();anchor_id uuid:='ffffffff-ffff-ffff-ffff-ffffffffffff';before_time timestamptz;before_id uuid;expiry timestamptz:=statement_timestamp()+interval '30 minutes';items jsonb;more boolean;tail jsonb;can_bill boolean;begin
 if auth.uid()is null or not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[])then raise exception 'POLAT_EXPERIMENT_UNAVAILABLE'using errcode='42501';end if;
 select role into role_value from public.tenant_members where tenant_id=target_tenant_id and user_id=auth.uid()and status='active';
 if page_size_value is null or page_size_value not between 1 and 100 then raise exception 'POLAT_EXPERIMENT_CURSOR_INVALID'using errcode='22023';end if;
 can_bill:=role_value in('super_admin','manager','analyst');
 if cursor_value is not null then
  begin
   if not private.fse_keys(cursor_value,array['v','tenant','user','role','size','anchor_time','anchor_id','before_time','before_id','expires'])
   or cursor_value->'v'is distinct from '1'::jsonb or cursor_value->>'tenant'is distinct from target_tenant_id::text or cursor_value->>'user'is distinct from auth.uid()::text
   or cursor_value->>'role'is distinct from role_value::text or cursor_value->'size'is distinct from to_jsonb(page_size_value)
   then raise exception 'invalid';end if;
   anchor_time:=(cursor_value->>'anchor_time')::timestamptz;anchor_id:=(cursor_value->>'anchor_id')::uuid;before_time:=(cursor_value->>'before_time')::timestamptz;before_id:=(cursor_value->>'before_id')::uuid;expiry:=(cursor_value->>'expires')::timestamptz;
   if anchor_time is null or anchor_id is null or before_time is null or before_id is null or expiry is null or expiry<=statement_timestamp()or expiry>statement_timestamp()+interval '30 minutes'
   or anchor_time>statement_timestamp()or(before_time,before_id)>(anchor_time,anchor_id)
   or not exists(select 1 from private.polat_experiment_runs where tenant_id=target_tenant_id and id=before_id and created_at=before_time)then raise exception 'invalid';end if;
  exception when others then raise exception 'POLAT_EXPERIMENT_CURSOR_INVALID'using errcode='22023';end;
 end if;
 with source as materialized(
  select id,created_at,request_count,event_sequence,stop_reason,binding,reserved_liability from private.polat_experiment_runs
  where tenant_id=target_tenant_id and(created_at,id)<=(anchor_time,anchor_id)and(before_time is null or(created_at,id)<(before_time,before_id))
  order by created_at desc,id desc limit page_size_value+1
 ),bounded as materialized(select * from source order by created_at desc,id desc limit page_size_value)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'mode','OFFLINE_SYNTHETIC','provider','anthropic','model',binding->>'model',
 'repository_sha',binding->>'repository_sha','corpus_version',binding->>'corpus_version','request_count',request_count,'maximum_requests',(binding->>'maximum_requests')::int,
 'evidence_count',event_sequence,'stop_reason',stop_reason,'reserved_liability',case when can_bill then reserved_liability::text end,'currency',case when can_bill then binding->>'currency'end,
 'actual_billed_amount',null,'financial_authority','NONE','execution_enabled',false)order by created_at desc,id desc),'[]'::jsonb),
 (select count(*)>page_size_value from source)into items,more from bounded;
 tail:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('version',1,'observed_at',statement_timestamp(),'items',items,'has_more',more,'page_size',page_size_value,'billing_readable',can_bill,
 'next_cursor',case when more then jsonb_build_object('v',1,'tenant',target_tenant_id,'user',auth.uid(),'role',role_value,'size',page_size_value,'anchor_time',anchor_time,'anchor_id',anchor_id,'before_time',tail->'created_at','before_id',tail->'id','expires',expiry)end,
 'financial_authority','NONE','authorized_external_requests',0,'execution_enabled',false);
end;$$;
revoke all on function public.admin_polat_experiment_page_v1(uuid,integer,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.admin_polat_experiment_page_v1(uuid,integer,jsonb)to authenticated;

-- Include only the explicitly isolated Claude fake-frame runtime in existing SYNTHETIC telemetry.
-- Read-only fixture telemetry. No new writer, table, index, activation or billing authority.
create or replace function public.admin_polat_model_summary_v1(target_tenant_id uuid,start_value date,end_value date)returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
declare result jsonb;can_bill boolean;begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[])then raise exception 'Polat model read unavailable'using errcode='42501';end if;
 if start_value is null or end_value is null or end_value<=start_value or end_value-start_value>90 then raise exception 'Polat period invalid'using errcode='22023';end if;
 can_bill:=private.has_tenant_role(target_tenant_id,array['super_admin','manager','analyst']::public.app_role[]);
 with source as materialized(
  select i.id,i.created_at,i.run_id,i.status,i.latency_ms,i.input_tokens,i.output_tokens,i.billed_amount,i.billed_currency,
   case when v.prompt_version~'^[a-zA-Z0-9_.:-]{1,80}$'then v.prompt_version else 'UNKNOWN'end prompt,
   case when r.context_manifest->>'polat_fixture_policy'~'^[a-zA-Z0-9_.:-]{1,80}$'then r.context_manifest->>'polat_fixture_policy'else 'UNKNOWN'end persona
  from public.model_invocations i join public.agent_runs r on r.tenant_id=i.tenant_id and r.id=i.run_id
  join public.agent_tasks task on task.tenant_id=r.tenant_id and task.id=r.task_id
  join private.polat_runtime_profiles p on p.tenant_id=r.tenant_id and p.conversation_id=task.conversation_id
  join public.agent_versions v on v.tenant_id=r.tenant_id and v.id=r.agent_version_id
  join public.tenants t on t.id=i.tenant_id
  where i.tenant_id=target_tenant_id and ((i.provider='mock'and i.model='polat-test-runtime-v1'and r.model_provider='mock'and r.model_name='polat-test-runtime-v1')or(i.provider='anthropic'and i.model='claude-haiku-5-5'and r.model_provider='anthropic'and r.model_name='claude-haiku-5-5'and r.context_manifest->>'polat_fixture_policy'='polat-ai-fixture-v2'))
   and t.slug like 'polat-sandbox-%'and not t.outbound_messaging_enabled
   and i.created_at>=start_value::timestamp at time zone 'UTC'and i.created_at<end_value::timestamp at time zone 'UTC'
  order by i.created_at desc,i.id desc limit 1001
 ), bounded as materialized(select * from source order by created_at desc,id desc limit 1000),stats as(
  select count(*)n,count(*)filter(where status='SUCCEEDED')ok,count(*)filter(where status='TIMED_OUT')timeouts,count(*)filter(where status='RATE_LIMITED')rate_limited,count(*)filter(where status='INVALID_OUTPUT')invalid_output,
   count(latency_ms)latency_sample,percentile_disc(.5)within group(order by latency_ms)filter(where latency_ms is not null)p50,percentile_disc(.95)within group(order by latency_ms)filter(where latency_ms is not null)p95,
   count(input_tokens)input_known,count(output_tokens)output_known,sum(input_tokens::numeric)::text input,sum(output_tokens::numeric)::text output,
   count(*)filter(where billed_amount>=0 and billed_currency~'^[A-Z]{3,6}$')bill_known from bounded
 ),runs as materialized(select distinct run_id from bounded),quality as(
  select count(*)filter(where exists(select 1 from public.conversation_quality_evaluations q where q.tenant_id=target_tenant_id and q.run_id=r.run_id and q.customer_facing_blocked))held,
   count(*)filter(where exists(select 1 from public.conversation_quality_evaluations q where q.tenant_id=target_tenant_id and q.run_id=r.run_id and q.escalation_category is not null))escalated from runs r
 ),versions as materialized(select prompt,persona,count(*)n from bounded group by prompt,persona order by prompt,persona limit 11),bounds as(select (select count(*)from source)<=1000 complete)
 select jsonb_build_object('version',1,'mode','SYNTHETIC','financial_authority','NONE','live_operations_authorized',false,'observed_at',statement_timestamp(),'start',start_value,'end',end_value,'sample_limit',1000,'complete',complete,
  'count',n,'success',ok,'errors',n-ok,'timeouts',timeouts,'rate_limited',rate_limited,'invalid_output',invalid_output,'qa_held_runs',held,'escalated_runs',escalated,
  'latency',jsonb_build_object('sample',latency_sample,'p50_ms',case when complete then p50::text end,'p95_ms',case when complete then p95::text end),
  'tokens',jsonb_build_object('input',case when complete and n>0 and input_known=n then input end,'output',case when complete and n>0 and output_known=n then output end,'input_known',input_known,'output_known',output_known),
  'billing',jsonb_build_object('known',case when can_bill then bill_known else 0 end,'readable',can_bill,'coverage',case when can_bill and complete and n>0 then(bill_known::numeric/n)::text end,'amount',null,'status',case when can_bill then 'UNKNOWN'else 'ROLE_RESTRICTED'end),
  'time_to_first_response_ms',null,'versions',(select coalesce(jsonb_agg(jsonb_build_object('prompt',prompt,'persona',persona,'count',n)order by prompt,persona),'[]')from(select * from versions limit 10)v),'versions_complete',(select count(*)from versions)<=10,
  'basis','MODEL_INVOCATIONS_ONLY','consistency','STATEMENT_SNAPSHOT')into result from stats cross join quality cross join bounds;
 return result;
end;$$;
revoke all on function public.admin_polat_model_summary_v1(uuid,date,date)from public,anon,service_role;
grant execute on function public.admin_polat_model_summary_v1(uuid,date,date)to authenticated;

-- Reconstruct TEST codec handles from database-owned source/ACK history and approved catalog facts.
create function private.polat_native_quality_registry(tid uuid,rid uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare r public.agent_runs;task public.agent_tasks;ctx jsonb;expected jsonb;facts jsonb;begin
 select * into strict r from public.agent_runs where tenant_id=tid and id=rid;
 select * into strict task from public.agent_tasks where tenant_id=tid and id=r.task_id;
 if r.context_manifest->>'polat_offline_codec'is distinct from 'claude-messages-v1'or r.context_manifest->>'polat_profile'is distinct from 'polat-test-runtime-v1'
 or r.context_manifest->>'financial_authority'is distinct from 'NONE'or r.context_manifest->'live_operations_authorized'is distinct from 'false'::jsonb
 or not exists(select 1 from private.polat_runtime_profiles p join public.agent_versions v on v.tenant_id=p.tenant_id and v.id=p.agent_version_id where p.tenant_id=tid and p.conversation_id=task.conversation_id and p.enabled and p.agent_version_id=r.agent_version_id and v.model_provider='mock'and v.model_name='polat-test-runtime-v1')
 then raise exception 'EVIDENCE_REGISTRY_NOT_AUTHORITATIVE'using errcode='22023';end if;
 ctx:=public.polat_test_runtime_context_v1(tid,task.conversation_id,task.source_event_id);
 if ctx->>'generation'is distinct from r.context_manifest->>'polat_generation'or(ctx#>>'{input,boundary}')::timestamptz is distinct from(r.context_manifest->>'polat_observed_boundary')::timestamptz
 or ctx#>>'{input,source_message_id}'is distinct from r.context_manifest->>'source_message_id'or jsonb_array_length(ctx#>'{input,messages}')>20 or jsonb_array_length(ctx#>'{input,knowledge}')<>0
 then raise exception 'EVIDENCE_REGISTRY_NOT_AUTHORITATIVE'using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('handle',case when m.value->>'id'=ctx#>>'{input,source_message_id}'then 'EVIDENCE_CURRENT_MESSAGE'else 'EVIDENCE_MESSAGE_'||m.ordinality::text end,'messageId',m.value->>'id','direction',m.value->>'direction')order by m.ordinality),'[]')into expected from jsonb_array_elements(ctx#>'{input,messages}')with ordinality m(value,ordinality);
 facts:=jsonb_build_array(jsonb_build_object('id','polat:identity:v1'),jsonb_build_object('id','polat:identity:denial:v1'))||private.quality_commercial_facts(tid,rid);
 if jsonb_array_length(facts)>64 then raise exception 'EVIDENCE_REGISTRY_NOT_AUTHORITATIVE'using errcode='22023';end if;
 expected:=expected||(select jsonb_agg(jsonb_build_object('handle','EVIDENCE_COMMERCIAL_'||f.ordinality::text,'messageId',f.value->>'id','direction','system')order by f.ordinality)from jsonb_array_elements(facts)with ordinality f(value,ordinality));
 return expected;
end;$$;
revoke all on function private.polat_native_quality_registry(uuid,uuid)from public,anon,authenticated,service_role;
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
    and model_provider='openai') and coalesce(new.evidence->'authoritative_evidence_resolution','null'::jsonb)='null'::jsonb then
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
revoke all on function private.guard_quality_stage_refs() from public,anon,authenticated;

-- Existing message index already covers tenant/conversation/occurred_at/id. No new message index or mutation.
create function public.admin_conversation_message_page_v1(target_tenant_id uuid,target_conversation_id uuid,page_size_value integer default 25,cursor_value jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' set plan_cache_mode=force_custom_plan as $$
declare role_value public.app_role;scope_value text;anchor_time timestamptz:=statement_timestamp();before_time timestamptz;before_id uuid;expiry timestamptz:=statement_timestamp()+interval '30 minutes';items jsonb;more boolean;tail jsonb;begin
 if auth.uid()is null or not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support']::public.app_role[])
 or not exists(select 1 from public.conversations where tenant_id=target_tenant_id and id=target_conversation_id)then raise exception 'MESSAGE_HISTORY_UNAVAILABLE'using errcode='42501';end if;
 select role into role_value from public.tenant_members where tenant_id=target_tenant_id and user_id=auth.uid()and status='active';
 if page_size_value is null or page_size_value not between 1 and 100 then raise exception 'MESSAGE_CURSOR_INVALID'using errcode='22023';end if;
 scope_value:=private.fse_hash(private.fse_canonical(jsonb_build_array('MESSAGE_PAGE1',target_tenant_id,target_conversation_id,auth.uid(),role_value,page_size_value)));
 if cursor_value is not null then begin
  if not private.fse_keys(cursor_value,array['v','scope','anchor','before_time','before_id','expires'])or cursor_value->'v'is distinct from '1'::jsonb or cursor_value->>'scope'is distinct from scope_value then raise exception 'invalid';end if;
  anchor_time:=(cursor_value->>'anchor')::timestamptz;before_time:=(cursor_value->>'before_time')::timestamptz;before_id:=(cursor_value->>'before_id')::uuid;expiry:=(cursor_value->>'expires')::timestamptz;
  if anchor_time is null or before_time is null or before_id is null or expiry is null or anchor_time>statement_timestamp()or expiry<=statement_timestamp()or expiry>statement_timestamp()+interval '30 minutes'
  or not exists(select 1 from public.messages where tenant_id=target_tenant_id and conversation_id=target_conversation_id and id=before_id and occurred_at=before_time and created_at<=anchor_time)then raise exception 'invalid';end if;
 exception when others then raise exception 'MESSAGE_CURSOR_INVALID'using errcode='22023';end;end if;
 with source as materialized(
  select id,direction,content,status,failure_code,occurred_at,created_at from public.messages
  where tenant_id=target_tenant_id and conversation_id=target_conversation_id and created_at<=anchor_time and(before_time is null or(occurred_at,id)<(before_time,before_id))
  order by occurred_at desc,id desc limit page_size_value+1
 ),bounded as materialized(select * from source order by occurred_at desc,id desc limit page_size_value)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'direction',direction,'content',content,'status',status,'failure_code',case when failure_code~'^TELEGRAM_[A-Z_]{1,80}$'then failure_code end,'occurred_at',occurred_at,'created_at',created_at)order by occurred_at,id),'[]'),(select count(*)>page_size_value from source)into items,more from bounded;
 tail:=items->0;
 return jsonb_build_object('version',1,'items',items,'has_more',more,'page_size',page_size_value,'next_cursor',case when more then jsonb_build_object('v',1,'scope',scope_value,'anchor',anchor_time,'before_time',tail->'occurred_at','before_id',tail->'id','expires',expiry)end);
end;$$;
revoke all on function public.admin_conversation_message_page_v1(uuid,uuid,integer,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.admin_conversation_message_page_v1(uuid,uuid,integer,jsonb)to authenticated;

-- Action receipts, memory provenance and all QA thresholds remain unchanged.
