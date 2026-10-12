-- Re-derive commercial facts from tenant/source-bounded published records.
-- The manifest and model handles are references, never independent authority.
create function private.quality_commercial_facts(target_tenant_id uuid,target_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare r public.agent_runs%rowtype; t public.agent_tasks%rowtype; ctx jsonb; d jsonb; p jsonb; v jsonb;
 locale_value text; period text; statements jsonb; statement text; fragment text; fact_index int;
 result jsonb:='[]'; chars int:=0; units int;
begin
 select * into strict r from public.agent_runs where tenant_id=target_tenant_id and id=target_run_id;
 if jsonb_array_length(coalesce(r.context_manifest->'commercial_versions','[]'))=0 then return result; end if;
 select * into strict t from public.agent_tasks where tenant_id=target_tenant_id and id=r.task_id;
 if r.context_manifest->>'source_event_id' is distinct from t.source_event_id::text or not exists(
  select 1 from public.messages m join public.domain_events e on e.tenant_id=m.tenant_id and e.payload->>'message_id'=m.id::text
  where e.tenant_id=target_tenant_id and e.id=t.source_event_id and m.conversation_id=t.conversation_id
  and m.id::text=r.context_manifest->>'source_message_id' and m.created_at=(r.context_manifest->>'context_boundary_timestamp')::timestamptz
 ) then raise exception 'EVIDENCE_COMMERCIAL_SCOPE_DENIED' using errcode='22023';end if;
 locale_value:=r.context_manifest->>'commercial_locale';
 if locale_value is null or locale_value not in ('en','tr','ar','ru') then raise exception 'EVIDENCE_COMMERCIAL_LOCALE_INVALID' using errcode='22023';end if;
 ctx:=private.commercial_for_source(target_tenant_id,t.source_event_id);
 for v in select value from jsonb_array_elements(r.context_manifest->'commercial_versions') loop
  if not exists(select 1 from jsonb_array_elements(ctx->'documents') x where
   jsonb_build_object('item_id',x->'item_id','version_id',x->'version_id','version',x->'version','kind',x->'kind')=v)
  then raise exception 'EVIDENCE_COMMERCIAL_VERSION_NOT_ALLOWED' using errcode='22023';end if;
 end loop;
 for d in select value from jsonb_array_elements(ctx->'documents') x where exists(
  select 1 from jsonb_array_elements(r.context_manifest->'commercial_versions') v where v->>'version_id'=x->>'version_id') loop
  p:=d->'payload';statements:='[]';fact_index:=0;
  if d->>'kind'='plan' then
   period:=case p->>'duration_unit'
    when 'calendar_month' then case locale_value when 'en' then 'calendar month' when 'tr' then 'takvim ayı' when 'ar' then 'شهر تقويمي' else 'календарный месяц' end
    when 'calendar_year' then case locale_value when 'en' then 'calendar year' when 'tr' then 'takvim yılı' when 'ar' then 'سنة تقويمية' else 'календарный год' end
    else case locale_value when 'en' then 'day' when 'tr' then 'gün' when 'ar' then 'يوم' else 'день' end end;
   statement:=case locale_value
    when 'en' then format('%s costs %s %s for %s %s.',p->>'title',p->>'amount',p->>'currency',p->>'duration_count',period)
    when 'tr' then format('%s fiyatı %s %s için %s %s.',p->>'title',p->>'duration_count',period,p->>'amount',p->>'currency')
    when 'ar' then format('سعر %s هو %s %s لمدة %s %s.',p->>'title',p->>'amount',p->>'currency',p->>'duration_count',period)
    else format('Стоимость %s: %s %s за %s %s.',p->>'title',p->>'amount',p->>'currency',p->>'duration_count',period) end;
   statements:=jsonb_build_array(statement);
   for statement in select value from jsonb_array_elements_text(p->'inclusions') loop
    statements:=statements||jsonb_build_array(case locale_value when 'en' then format('%s includes %s.',p->>'title',statement)
     when 'tr' then format('%s şunları içerir: %s.',p->>'title',statement) when 'ar' then format('تشمل %s: %s.',p->>'title',statement)
     else format('%s включает: %s.',p->>'title',statement) end);
   end loop;
   statements:=statements||jsonb_build_array(p->>'terms')||(p->'restrictions')||(p->'disclosures');
   foreach statement in array array[p->>'tax_rule',p->>'renewal_rule',p->>'cancellation_rule'] loop
    if statement is not null and statement<>'' then statements:=statements||jsonb_build_array(statement);end if;
   end loop;
  else statements:=jsonb_build_array(case when d->>'kind'='knowledge' then p->>'content' else p->>'description' end);end if;
  for statement in select value from jsonb_array_elements_text(statements) loop
   for fragment in select regexp_replace(value,'^[[:space:]]+|[[:space:]]+$','','g') from regexp_split_to_table(statement,'(?<=[.!?؟。！])[[:space:]]+') value loop
    if fragment='' then continue;end if;fact_index:=fact_index+1;
    -- Match JavaScript's UTF-16 character budget, including astral characters.
    select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0) into units from regexp_split_to_table(fragment,'') c;
    chars:=chars+units;
    if chars<=8000 and jsonb_array_length(result)<40 then result:=result||jsonb_build_array(jsonb_build_object('id',d->>'version_id'||':fact:'||fact_index::text,'statement',fragment));end if;
   end loop;
  end loop;
 end loop;
 if coalesce(r.context_manifest->'commercial_fact_ids','[]') is distinct from
  (select coalesce(jsonb_agg(x->'id'),'[]') from jsonb_array_elements(result) x)
 then raise exception 'EVIDENCE_COMMERCIAL_FACTS_MISMATCH' using errcode='22023';end if;
 return result;
end;$$;
revoke all on function private.quality_commercial_facts(uuid,uuid) from public,anon,authenticated;

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
      and not exists(select 1 from jsonb_array_elements(commercial_facts) f where f->>'id'=ref) then
      raise exception 'EVIDENCE_REFERENCE_NOT_ALLOWED' using errcode='22023';
    end if;
  end loop;
end;
$$;
revoke all on function private.assert_quality_output_refs(uuid,uuid,jsonb) from public,anon,authenticated;

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

-- Action receipts, memory provenance and all QA thresholds remain unchanged.
