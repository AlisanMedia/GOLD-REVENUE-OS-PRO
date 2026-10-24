-- Read-only fixture telemetry. No new writer, table, index, activation or billing authority.
create function public.admin_polat_model_summary_v1(target_tenant_id uuid,start_value date,end_value date)returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
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
  where i.tenant_id=target_tenant_id and i.provider='mock'and i.model='polat-test-runtime-v1'and r.model_provider='mock'and r.model_name='polat-test-runtime-v1'
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
