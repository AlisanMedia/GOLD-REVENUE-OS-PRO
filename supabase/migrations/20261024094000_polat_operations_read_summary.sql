-- Read-only synthetic coverage summary; no writer or financial authority.
create index polat_work_period on private.polat_inbound_work(tenant_id,received_at desc,sequence desc);
create function public.admin_polat_response_summary_v1(target_tenant_id uuid,start_value date,end_value date)returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
declare result jsonb;begin
 if not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[])then raise exception 'Polat read unavailable'using errcode='42501';end if;
 if start_value is null or end_value is null or end_value<=start_value or end_value-start_value>90 then raise exception 'Polat period invalid'using errcode='22023';end if;
 with work_source as materialized(
  select w.* from private.polat_inbound_work w where w.tenant_id=target_tenant_id and w.received_at>=start_value::timestamp at time zone 'UTC'and w.received_at<end_value::timestamp at time zone 'UTC'order by w.received_at desc,w.sequence desc limit 1001
 ), bounded as materialized(select * from work_source order by received_at desc,sequence desc limit 1000), context_keys as materialized(select distinct tenant_id,conversation_id from bounded), contexts as materialized(
  select k.tenant_id,k.conversation_id,ctrl.last_inbound_id,ctrl.return_boundary,cv.runtime_mode,cv.human_takeover,member.user_id owner_id
  from context_keys k join private.polat_conversation_controls ctrl on ctrl.tenant_id=k.tenant_id and ctrl.conversation_id=k.conversation_id
  join public.conversations cv on cv.tenant_id=k.tenant_id and cv.id=k.conversation_id
  left join public.tenant_members member on member.tenant_id=k.tenant_id and member.user_id=ctrl.human_owner and member.status='active'and member.role in('super_admin','manager','support')
 ), control_source as materialized(select conversation_id,activation_at from private.polat_conversation_controls where tenant_id=target_tenant_id order by conversation_id limit 1001), controls as materialized(select * from control_source order by conversation_id limit 1000), projected as materialized(
  select w.*,case when w.state in('AI_RESPONDED','CLOSED_WITH_EVIDENCE','DELIVERY_UNKNOWN')then w.state
   when ctx.runtime_mode='PAUSED'then 'BLOCKED_WITH_REASON'
   when ctx.runtime_mode='HUMAN_TAKEOVER'or ctx.human_takeover then case when ctx.owner_id is not null then 'HUMAN_OWNED'else 'HUMAN_HANDOFF_PENDING'end
   when ctx.last_inbound_id is distinct from w.message_id or(ctx.return_boundary is not null and w.received_at<ctx.return_boundary)then 'HUMAN_HANDOFF_PENDING'else w.state end current_state,
   exists(select 1 from private.polat_response_evidence e where e.tenant_id=w.tenant_id and e.message_id=w.message_id and e.stage='FAKE_ACK'and e.actor='AI') ai_ack
  from bounded w join contexts ctx on ctx.tenant_id=w.tenant_id and ctx.conversation_id=w.conversation_id
 ), message_source as materialized(
  select m.id,exists(select 1 from private.polat_inbound_work w where w.tenant_id=m.tenant_id and w.message_id=m.id)tracked
  from public.messages m join controls c on c.conversation_id=m.conversation_id
  where m.tenant_id=target_tenant_id and m.direction='inbound'and m.created_at>=c.activation_at and m.created_at>=start_value::timestamp at time zone 'UTC'and m.created_at<end_value::timestamp at time zone 'UTC'
  order by m.created_at desc,m.id desc limit 1001
 ), messages as materialized(select * from message_source limit 1000), stats as(
  select count(*)captured,count(*)filter(where eligible_at_receipt)eligible,
  count(*)filter(where current_state='AI_RESPONSE_PENDING')ai_pending,
  count(*)filter(where current_state='AI_RESPONDED')ai_responded,
  count(*)filter(where responded_at is not null and ai_ack)ai_acked,
  count(*)filter(where current_state='HUMAN_HANDOFF_PENDING')human_pending,
  count(*)filter(where current_state='HUMAN_OWNED')human_owned,
  count(*)filter(where current_state='DELIVERY_UNKNOWN')unknown,
  count(*)filter(where current_state='BLOCKED_WITH_REASON')blocked,
  count(*)filter(where current_state='CLOSED_WITH_EVIDENCE')closed,
  count(*)filter(where responded_at is null and current_state not in('BLOCKED_WITH_REASON','CLOSED_WITH_EVIDENCE')and received_at<statement_timestamp()-interval '30 seconds')overdue,
  count(*)filter(where responded_at>=received_at)latency_sample,
  percentile_disc(0.5)within group(order by extract(epoch from(responded_at-received_at))*1000)filter(where responded_at>=received_at)p50_ms,
  percentile_disc(0.95)within group(order by extract(epoch from(responded_at-received_at))*1000)filter(where responded_at>=received_at)p95_ms,
  max(extract(epoch from(statement_timestamp()-received_at)))filter(where responded_at is null and current_state not in('CLOSED_WITH_EVIDENCE','BLOCKED_WITH_REASON')and received_at<=statement_timestamp())oldest_unanswered_seconds
  from projected
 ), bounds as(select (select count(*)from work_source)<=1000 and(select count(*)from message_source)<=1000 and(select count(*)from control_source)<=1000 complete)
 select jsonb_build_object('version',1,'mode','SYNTHETIC','financial_authority','NONE','live_operations_authorized',false,'observed_at',statement_timestamp(),'start',start_value,'end',end_value,'complete',complete,'sample_limit',1000,
  'source_messages',(select count(*)from messages),'coverage_gap',(select count(*)from messages where not tracked),
  'counts',jsonb_build_object('captured',captured,'eligible',eligible,'ai_pending',ai_pending,'ai_responded',ai_responded,'ai_acked',ai_acked,'human_pending',human_pending,'human_owned',human_owned,'unknown',unknown,'blocked',blocked,'closed',closed,'overdue',overdue),
  'latency',jsonb_build_object('sample',latency_sample,'p50_ms',case when complete then p50_ms::text end,'p95_ms',case when complete then p95_ms::text end,'oldest_unanswered_seconds',case when complete then oldest_unanswered_seconds::text end),
  'ai_ack_rate',case when complete and eligible>0 then (ai_acked::numeric/eligible)::text end,
  'human_ownership_rate',case when complete and human_pending+human_owned>0 then(human_owned::numeric/(human_pending+human_owned))::text end,
  'consistency','STATEMENT_SNAPSHOT','receipt_basis','FAKE_ACK_ONLY')into result from stats cross join bounds;
 return result;
end;$$;
revoke all on function public.admin_polat_response_summary_v1(uuid,date,date)from public,anon,service_role;
grant execute on function public.admin_polat_response_summary_v1(uuid,date,date)to authenticated;
