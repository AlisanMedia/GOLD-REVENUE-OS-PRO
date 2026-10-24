-- A complete bounded page is not proof of a complete source recovery.
alter table private.signal_source_runtime add column recovery_target integer check(recovery_target>=0);
alter table private.signal_source_recovery_log add column verified_head integer check(verified_head>=0),add column history_version integer check(history_version=2),add column checkpoint_sequence integer check(checkpoint_sequence>=0);
create or replace function private.signal_source_result_v1(t uuid,s uuid,n integer default 0,replayed boolean default false) returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('version',1,'mode','SYNTHETIC','state',r.state,'generation',r.generation,'epoch',r.epoch,'last_sequence',r.last_sequence,'recovery_target',r.recovery_target,'processed',n,'replay',replayed,
 'can_dispatch',coalesce(r.state='CONNECTED' and not r.recovery_required and r.last_activity_at>=statement_timestamp()-interval '60 seconds' and exists(select 1 from private.signal_controls c join private.signal_sources a on a.tenant_id=c.tenant_id and a.id=s join private.signal_providers p on p.tenant_id=a.tenant_id and p.id=a.provider_id where c.tenant_id=t and c.enabled and not a.paused and not p.paused and p.authorization_status='SYNTHETIC_APPROVED'),false),'financial_authority','NONE','live_operations_authorized',false)
 from private.signal_source_runtime r where r.tenant_id=t and r.source_id=s
$$;
create or replace function private.signal_source_command_fixture_v1(t uuid,s uuid,expected_generation integer,cmd uuid,raw_command text) returns jsonb language plpgsql set search_path=pg_catalog as $$
declare r private.signal_source_runtime;cap jsonb;v jsonb;h text;a text;entry_value jsonb;n integer:=0;i integer;from_value integer;to_value integer;head_value integer;prior_state text;prior_authority bigint;o private.signal_source_observations;old_hash text;event_value jsonb;reason text;clock_value timestamptz;
begin
 perform private.signal_fixture_guard(t);perform 1 from private.signal_controls where tenant_id=t for update;
 select * into r from private.signal_source_runtime where tenant_id=t and source_id=s for update;
 if not found then raise exception 'source scope unavailable' using errcode='42501';end if;
 if cmd is null or raw_command is null or octet_length(raw_command)>65536 then raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;v:=private.fse_strict_json(raw_command);h:=private.fse_hash(private.fse_canonical(v));
 select command_hash into old_hash from private.signal_source_recovery_log where tenant_id=t and source_id=s and command_id=cmd;
 if found then if h<>old_hash then raise exception 'SOURCE_COMMAND_CONFLICT' using errcode='22023';end if;return private.signal_source_result_v1(t,s,0,true);end if;
 if expected_generation is distinct from r.generation then raise exception 'SOURCE_CHECKPOINT_FENCED' using errcode='40001';end if;
 if v->>'epoch' is distinct from r.epoch::text then raise exception 'SOURCE_CHECKPOINT_FENCED' using errcode='40001';end if;
 a:=v->>'action';prior_state:=r.state;prior_authority:=r.authority_revision;select declaration into cap from private.signal_source_capabilities where id=r.capability_id and tenant_id=t and source_id=s;
 if a in('DISCONNECT','RECONNECT') then
  if not private.fse_keys(v,array['action','epoch','at']) then raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;
  clock_value:=(v->>'at')::timestamptz;if clock_value is null or not isfinite(clock_value)or clock_value>clock_timestamp()+interval '5 seconds' then raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;
  if a='DISCONNECT' then if r.state not in('SOURCE_RESTRICTED','UNRECOVERABLE','CONFLICT','BLOCKED','LIMITED')then r.state:='DISCONNECTED';end if;r.disconnected_at:=clock_value;r.recovery_required:=r.last_sequence>0 or r.recovery_required;
  elsif r.state in('SOURCE_RESTRICTED','UNRECOVERABLE','CONFLICT','BLOCKED','LIMITED') then r.state:=prior_state;
  elsif cap->>'sequence'<>'MONOTONIC_INT' then r.state:='LIMITED';
  elsif r.disconnected_at<clock_timestamp()-interval '15 minutes' or (r.last_sequence>0 and cap->>'recovery'<>'INDEPENDENT_FAKE_HISTORY') then r.state:='UNRECOVERABLE';
  else r.state:=case when r.last_sequence=0 and not exists(select 1 from private.signal_source_observations where tenant_id=t and source_id=s and epoch=r.epoch)then 'CONNECTED' else 'RECOVERING' end;end if;
 elsif a='OBSERVE' then
  if not private.fse_keys(v,array['action','epoch','sequence','event']) then raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;
  if jsonb_typeof(v->'sequence')<>'number' or (v->>'sequence') !~ '^[1-9][0-9]{0,9}$' or (v->>'sequence')::numeric>2147483647 then raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;
  begin perform private.signal_source_packet_fixture_v1(t,s,r.epoch,(v->>'sequence')::integer,v->'event');exception when unique_violation then r.state:='CONFLICT';end;
  r.last_activity_at:=clock_timestamp();
  if v#>>'{event,kind}'='RESTRICTED' then r.state:='SOURCE_RESTRICTED';
  elsif cap->>'sequence'<>'MONOTONIC_INT' then r.state:='LIMITED';
  elsif r.state in('CONNECTED','GAP_DETECTED','RECOVERING') then
   if r.recovery_required then r.state:='RECOVERING';elsif (v->>'sequence')::integer>r.last_sequence+1 then r.state:='GAP_DETECTED';end if;
  end if;
 elsif a='RECOVER' then
  if not private.fse_keys(v,array['action','epoch','page'])then raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;
  event_value:=v->'page';
  if r.state in('SOURCE_RESTRICTED','CONFLICT','UNRECOVERABLE','LIMITED')then reason:='SOURCE_NOT_RECOVERABLE';
  elsif cap->>'recovery'<>'INDEPENDENT_FAKE_HISTORY' or cap->>'sequence'<>'MONOTONIC_INT' then reason:='SOURCE_CAPABILITY_UNKNOWN';
  elsif r.disconnected_at<clock_timestamp()-interval '15 minutes' then reason:='RECOVERY_WINDOW_EXPIRED';
  elsif not private.fse_keys(event_value,array['version','mode','origin','tenant_id','source_id','epoch','from','to','head','complete','entries'])or event_value->'version' is distinct from '2'::jsonb or event_value->>'mode' is distinct from 'SYNTHETIC'
   or event_value->>'origin' is distinct from 'INDEPENDENT_FAKE_HISTORY' or event_value->>'tenant_id' is distinct from t::text or event_value->>'source_id' is distinct from s::text or event_value->>'epoch' is distinct from r.epoch::text or event_value->'complete' is distinct from 'true'::jsonb then reason:='RECOVERY_INCOMPLETE';
  else
   begin
    if jsonb_typeof(event_value->'from') is distinct from 'number' or jsonb_typeof(event_value->'to') is distinct from 'number'
     or jsonb_typeof(event_value->'head') is distinct from 'number' or (event_value->>'from') !~ '^[1-9][0-9]{0,9}$' or (event_value->>'to') !~ '^(0|[1-9][0-9]{0,9})$' or (event_value->>'head') !~ '^(0|[1-9][0-9]{0,9})$' then raise exception 'invalid range';end if;
    from_value:=(event_value->>'from')::integer;to_value:=(event_value->>'to')::integer;head_value:=(event_value->>'head')::integer;
    if from_value<>r.last_sequence+1 or to_value<from_value-1 or to_value>head_value or head_value<r.last_sequence or head_value<coalesce(r.recovery_target,0) or(to_value=from_value-1 and head_value<>to_value) or to_value-from_value>=64 or jsonb_typeof(event_value->'entries')<>'array' or jsonb_array_length(event_value->'entries')<>to_value-from_value+1 then raise exception 'invalid range';end if;
    for i in from_value..to_value loop
     select value into entry_value from jsonb_array_elements(event_value->'entries') where value->>'sequence'=i::text;
     if not found or (select count(*) from jsonb_array_elements(event_value->'entries') where value->>'sequence'=i::text)<>1 or not private.fse_keys(entry_value,array['sequence','event']) or jsonb_typeof(entry_value->'sequence') is distinct from 'number' then raise exception 'missing range entry';end if;
     perform private.signal_source_packet_fixture_v1(t,s,r.epoch,i,entry_value->'event');
    end loop;
   exception when others then reason:='RECOVERY_CONFLICT_OR_INVALID';end;
  end if;
  if reason is null then r.recovery_target:=head_value;r.recovery_required:=true;r.state:='RECOVERING';r.last_activity_at:=clock_timestamp();else r.recovery_attempts:=least(3,r.recovery_attempts+1);r.state:=case when r.recovery_attempts>=3 or reason in('SOURCE_NOT_RECOVERABLE','RECOVERY_WINDOW_EXPIRED')then 'UNRECOVERABLE' else 'RECOVERING' end;end if;
 else raise exception 'SOURCE_COMMAND_INVALID' using errcode='22023';end if;
 -- No gap skipping: promote only consecutive observed events, at most64 per call.
 if reason is null and a in('OBSERVE','RECOVER') and (not r.recovery_required or a='RECOVER') and r.state in('CONNECTED','GAP_DETECTED','RECOVERING')then
  begin
   while n<64 loop
    select * into o from private.signal_source_observations where tenant_id=t and source_id=s and epoch=r.epoch and sequence=r.last_sequence+1;
    exit when not found;
    if o.original->>'kind' in('RESTRICTED','UNAVAILABLE') then r.state:=case when o.original->>'kind'='RESTRICTED'then 'SOURCE_RESTRICTED' else 'BLOCKED'end;exit;end if;
    if not (cap->'events' ? (o.original->>'kind')) then r.state:='BLOCKED';exit;end if;
    r.last_sequence:=o.sequence;n:=n+1;
   end loop;
   if r.state not in('SOURCE_RESTRICTED','BLOCKED')then
    r.state:=case when r.recovery_target is not null and r.last_sequence<r.recovery_target then 'RECOVERING' when exists(select 1 from private.signal_source_observations where tenant_id=t and source_id=s and epoch=r.epoch and sequence>r.last_sequence)then 'GAP_DETECTED' else 'CONNECTED'end;
   end if;
   r.authority_revision:=prior_authority+case when r.state<>prior_state then 1 else 0 end;
   update private.signal_source_runtime set state=r.state,authority_revision=r.authority_revision,last_activity_at=r.last_activity_at where tenant_id=t and source_id=s;
   if n>0 then
    for o in select x.* from private.signal_source_observations x where x.tenant_id=t and x.source_id=s and x.epoch=r.epoch and x.sequence>r.last_sequence-n and x.sequence<=r.last_sequence order by x.sequence limit 64 loop
     perform private.signal_record_fixture_v1(o.original::text);
    end loop;
   end if;
  exception when others then n:=0;r.state:='BLOCKED';r.last_sequence:=(select last_sequence from private.signal_source_runtime where tenant_id=t and source_id=s);reason:='SOURCE_PACKET_INVALID';end;
 end if;
 r.authority_revision:=prior_authority+case when r.state<>prior_state then 1 else 0 end;
 if a='RECOVER' and reason is null and r.state='CONNECTED' and r.last_sequence>=r.recovery_target then r.recovery_required:=false;r.disconnected_at:=null;end if;
 update private.signal_source_runtime set generation=generation+1,recovery_target=r.recovery_target,recovery_required=r.recovery_required,state=r.state,authority_revision=r.authority_revision,last_sequence=r.last_sequence,last_activity_at=r.last_activity_at,disconnected_at=r.disconnected_at,recovery_attempts=case when r.state='CONNECTED'then 0 else r.recovery_attempts end where tenant_id=t and source_id=s returning generation into r.generation;
 insert into private.signal_source_recovery_log(tenant_id,source_id,command_id,command_hash,action,outcome,generation,processed,verified_head,history_version,checkpoint_sequence)values(t,s,cmd,h,a,coalesce(reason,r.state),r.generation,n,case when a='RECOVER'and reason is null then head_value else null end,case when a='RECOVER'and reason is null then 2 else null end,r.last_sequence);
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(t,'SYSTEM','signal.synthetic_source_transition','signal_source',s,jsonb_build_object('state',r.state,'generation',r.generation,'financial_authority','NONE'));
 return private.signal_source_result_v1(t,s,n);
end;$$;


-- Fixture-only append-only operational review; never a sender/status override.
create table private.signal_reviews(
 id uuid primary key default extensions.gen_random_uuid(),sequence bigint generated always as identity unique,
 tenant_id uuid not null,source_id uuid not null,delivery_id uuid,
 command_id uuid not null,command_hash text not null,context_hash text not null,
 reviewer_id uuid not null references auth.users(id),reviewer_role text not null check(reviewer_role in('super_admin','manager')),
 issue text not null check(issue in('UNKNOWN_DELIVERY','STALE_REVISION','MISSING_EVENT','SOURCE_RESTRICTED','INCOMPLETE_RECOVERY','AMBIGUOUS_INTERPRETATION','LEASE_EXPIRED','ACK_CONFLICT')),
 decision text not null check(decision in('OPEN','BLOCKED','RESOLVED_WITH_EVIDENCE')),
 reason text not null check(reason in('EVIDENCE_MISSING','WAITING_PROVIDER','ALTERNATIVE_SOURCE_REQUIRED','SOURCE_CONTINUITY_CONFIRMED','MATCHING_FAKE_ACK','INTERPRETATION_UNCERTAIN','STALE_SOURCE','LEASE_UNKNOWN','ACK_INCONSISTENT')),
 evidence jsonb not null check(jsonb_typeof(evidence)='array' and jsonb_array_length(evidence)<=8),created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,command_id),foreign key(source_id,tenant_id)references private.signal_sources(id,tenant_id),foreign key(delivery_id,tenant_id)references private.signal_deliveries(id,tenant_id)
);
create index signal_review_tenant_page on private.signal_reviews(tenant_id,sequence desc);
create index signal_review_source_page on private.signal_reviews(tenant_id,source_id,sequence desc);
create index signal_review_delivery_page on private.signal_reviews(tenant_id,delivery_id,sequence desc)where delivery_id is not null;
alter table private.signal_reviews enable row level security;
create trigger signal_reviews_immutable before update or delete on private.signal_reviews for each row execute function private.fse_immutable();
revoke all on table private.signal_reviews from public,anon,authenticated,service_role;
revoke all on sequence private.signal_reviews_sequence_seq from public,anon,authenticated,service_role;
create function private.signal_review_context_v1(t uuid,s uuid,d uuid)returns text language sql stable set search_path=pg_catalog as $$
 select private.fse_hash(private.fse_canonical(jsonb_build_array('SIGNAL_REVIEW1',t,s,d,
  (select generation from private.signal_source_runtime where tenant_id=t and source_id=s),
  (select jsonb_build_array(x.status,x.claims,x.last_result_hash,h.revision)from private.signal_deliveries x join private.signal_events e on e.tenant_id=x.tenant_id and e.id=x.event_id join private.signal_heads h on h.tenant_id=e.tenant_id and h.source_id=e.source_id and h.message_key=e.message_key where x.tenant_id=t and x.id=d and e.source_id=s),
  (select sequence from private.signal_reviews where tenant_id=t and source_id=s and delivery_id is not distinct from d order by sequence desc limit 1))))
$$;
create function private.signal_review_record_fixture_v1(t uuid,cmd uuid,raw_command text)returns jsonb language plpgsql set search_path=pg_catalog as $$
declare v jsonb;r private.signal_reviews;s uuid;d uuid;h text;ctx text;role_value text;ev jsonb;proof boolean:=false;runtime private.signal_source_runtime;job private.signal_deliveries;
begin
 perform private.signal_fixture_guard(t);
 if auth.uid() is null or not private.has_tenant_role(t,array['super_admin','manager']::public.app_role[])then raise exception 'signal review denied' using errcode='42501';end if;
 select role::text into role_value from public.tenant_members where tenant_id=t and user_id=auth.uid() and status='active';
 perform 1 from private.signal_controls where tenant_id=t for update;
 select role::text into role_value from public.tenant_members where tenant_id=t and user_id=auth.uid()and status='active'for share;
 if role_value is null or role_value not in('super_admin','manager')then raise exception 'signal review denied'using errcode='42501';end if;
 if cmd is null or raw_command is null or octet_length(raw_command)>4096 then raise exception 'SIGNAL_REVIEW_INVALID' using errcode='22023';end if;
 v:=private.fse_strict_json(raw_command);h:=private.fse_hash(private.fse_canonical(v));
 select * into r from private.signal_reviews where tenant_id=t and command_id=cmd;
 if found then if r.command_hash<>h or r.reviewer_id<>auth.uid()then raise exception 'SIGNAL_REVIEW_CONFLICT' using errcode='22023';end if;return jsonb_build_object('id',r.id,'decision',r.decision,'replay',true,'financial_authority','NONE','live_operations_authorized',false);end if;
 if not private.fse_keys(v,array['version','mode','source_id','delivery_id','issue','decision','reason','expected_context_hash','evidence'])or v->'version' is distinct from '1'::jsonb or v->>'mode' is distinct from 'SYNTHETIC'
  or coalesce(v->>'issue','')not in('UNKNOWN_DELIVERY','STALE_REVISION','MISSING_EVENT','SOURCE_RESTRICTED','INCOMPLETE_RECOVERY','AMBIGUOUS_INTERPRETATION','LEASE_EXPIRED','ACK_CONFLICT')
  or coalesce(v->>'decision','')not in('OPEN','BLOCKED','RESOLVED_WITH_EVIDENCE')or coalesce(v->>'reason','')not in('EVIDENCE_MISSING','WAITING_PROVIDER','ALTERNATIVE_SOURCE_REQUIRED','SOURCE_CONTINUITY_CONFIRMED','MATCHING_FAKE_ACK','INTERPRETATION_UNCERTAIN','STALE_SOURCE','LEASE_UNKNOWN','ACK_INCONSISTENT')
  or jsonb_typeof(v->'evidence')is distinct from 'array' or jsonb_array_length(v->'evidence')>8 then raise exception 'SIGNAL_REVIEW_INVALID' using errcode='22023';end if;
 if(select count(distinct value)from jsonb_array_elements(v->'evidence'))<>jsonb_array_length(v->'evidence')then raise exception 'SIGNAL_REVIEW_INVALID'using errcode='22023';end if;
 s:=(v->>'source_id')::uuid;d:=(v->>'delivery_id')::uuid;
 if not exists(select 1 from private.signal_sources where tenant_id=t and id=s)or(d is not null and not exists(select 1 from private.signal_deliveries x join private.signal_events e on e.id=x.event_id and e.tenant_id=x.tenant_id where x.tenant_id=t and x.id=d and e.source_id=s))then raise exception 'signal review denied' using errcode='42501';end if;
 select * into runtime from private.signal_source_runtime where tenant_id=t and source_id=s for update;
 if d is not null then select * into job from private.signal_deliveries where tenant_id=t and id=d for update;end if;
 -- Issue labels are grounded in persisted fixture state/history, never a
 -- manager assertion of a provider action. ACK_CONFLICT denotes an uncertainty
 -- review; it is not proof that an external provider supplied conflicting data.
 if not coalesce(case v->>'issue'
  when 'UNKNOWN_DELIVERY'then d is not null and(job.status='UNKNOWN'or exists(select 1 from private.signal_delivery_history where tenant_id=t and delivery_id=d and code='UNKNOWN_EFFECT'limit 1))
  when 'ACK_CONFLICT'then d is not null and(job.status in('UNKNOWN','STALE_ACK')or exists(select 1 from private.signal_delivery_history where tenant_id=t and delivery_id=d and code='UNKNOWN_EFFECT'limit 1))
  when 'LEASE_EXPIRED'then d is not null and((job.status='RUNNING'and job.lease_until<=clock_timestamp())or exists(select 1 from private.signal_delivery_history where tenant_id=t and delivery_id=d and code in('UNKNOWN_EFFECT','LEASE_BUDGET')limit 1))
  when 'STALE_REVISION'then d is not null and(job.status in('STALE','STALE_ACK')or exists(select 1 from private.signal_events e join private.signal_heads h on h.tenant_id=e.tenant_id and h.source_id=e.source_id and h.message_key=e.message_key where e.tenant_id=t and e.id=job.event_id and h.event_id<>e.id))
  when 'MISSING_EVENT'then runtime.state='GAP_DETECTED'or exists(select 1 from private.signal_source_recovery_log where tenant_id=t and source_id=s and outcome='GAP_DETECTED'limit 1)
  when 'INCOMPLETE_RECOVERY'then runtime.recovery_required or runtime.state in('RECOVERING','UNRECOVERABLE','LIMITED','BLOCKED')or exists(select 1 from private.signal_source_recovery_log where tenant_id=t and source_id=s and action='RECOVER'limit 1)
  when 'SOURCE_RESTRICTED'then runtime.state='SOURCE_RESTRICTED'or exists(select 1 from private.signal_events where tenant_id=t and source_id=s and kind='RESTRICTED'limit 1)
  when 'AMBIGUOUS_INTERPRETATION'then exists(select 1 from private.signal_events where tenant_id=t and source_id=s and(d is null or id=job.event_id)and parse_state='UNCERTAIN'limit 1)or job.last_code='REFERENCE_UNRESOLVED'
  else false end,false)then raise exception 'SIGNAL_REVIEW_SOURCE_UNSUPPORTED'using errcode='42501';end if;
 ctx:=private.signal_review_context_v1(t,s,d);
 if v->>'expected_context_hash'is distinct from ctx then raise exception 'SIGNAL_REVIEW_FENCED' using errcode='40001';end if;
 for ev in select value from jsonb_array_elements(v->'evidence')loop
  if not private.fse_keys(ev,array['kind','id'])then raise exception 'SIGNAL_REVIEW_INVALID' using errcode='22023';end if;
  if ev->>'kind'='SOURCE_RECOVERY'then
   if not exists(select 1 from private.signal_source_recovery_log where id=(ev->>'id')::uuid and tenant_id=t and source_id=s)then raise exception 'signal review denied' using errcode='42501';end if;
   if d is null and v->>'reason'='SOURCE_CONTINUITY_CONFIRMED' and v->>'issue'in('MISSING_EVENT','INCOMPLETE_RECOVERY')and runtime.state='CONNECTED'and not runtime.recovery_required and runtime.recovery_target is not null and runtime.last_sequence>=runtime.recovery_target and runtime.last_activity_at>=statement_timestamp()-interval '60 seconds'
    and exists(select 1 from private.signal_source_recovery_log where id=(ev->>'id')::uuid and tenant_id=t and source_id=s and action='RECOVER'and outcome='CONNECTED'and history_version=2 and verified_head=runtime.recovery_target and checkpoint_sequence>=verified_head)then proof:=true;end if;
  elsif ev->>'kind'='DELIVERY_HISTORY'then
   if d is null or not exists(select 1 from private.signal_delivery_history where id=(ev->>'id')::uuid and tenant_id=t and delivery_id=d)then raise exception 'signal review denied' using errcode='42501';end if;
   if v->>'reason'='MATCHING_FAKE_ACK' and v->>'issue'in('UNKNOWN_DELIVERY','ACK_CONFLICT','LEASE_EXPIRED')and job.status='FAKE_CONFIRMED'and exists(select 1 from private.signal_delivery_history where id=(ev->>'id')::uuid and tenant_id=t and delivery_id=d and claim=job.claims and code in('FAKE_ACK','RECONCILED_FAKE_ACK'))then proof:=true;end if;
  else raise exception 'SIGNAL_REVIEW_INVALID' using errcode='22023';end if;
 end loop;
 if v->>'decision'='RESOLVED_WITH_EVIDENCE' and not proof then raise exception 'SIGNAL_REVIEW_EVIDENCE_INSUFFICIENT' using errcode='42501';end if;
 insert into private.signal_reviews(tenant_id,source_id,delivery_id,command_id,command_hash,context_hash,reviewer_id,reviewer_role,issue,decision,reason,evidence)
 values(t,s,d,cmd,h,ctx,auth.uid(),role_value,v->>'issue',v->>'decision',v->>'reason',v->'evidence')returning * into r;
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(t,'HUMAN',auth.uid(),'signal.synthetic_review_recorded','signal_review',r.id,jsonb_build_object('decision',r.decision,'issue',r.issue,'financial_authority','NONE'));
 return jsonb_build_object('id',r.id,'decision',r.decision,'replay',false,'financial_authority','NONE','live_operations_authorized',false);
end;$$;
revoke all on function private.signal_review_context_v1(uuid,uuid,uuid),private.signal_review_record_fixture_v1(uuid,uuid,text)from public,anon,authenticated,service_role;
create function private.signal_review_admin_rows_v1(t uuid,p uuid,s uuid,d uuid,j uuid,ak text,hk text,keys_value text[],lim integer)
returns table(key_value text,row_value jsonb)language sql stable set search_path=pg_catalog as $$
 select x.sequence::text,private.signal_admin_base_v1()||jsonb_build_object('id',x.id,'kind','REVIEW','label','REV-'||x.sequence,'reference','REV-'||x.sequence,
 'provider_id',v.id,'provider_label',v.label,'source_id',a.id,'source_label',a.label,'destination_id',b.id,'destination_label',b.label,'delivery_id',z.id,
 'state',x.decision,'recorded_at',x.created_at,'review',jsonb_build_object('issue',x.issue,'reason',x.reason,'reviewer_role',x.reviewer_role))
 from private.signal_reviews x join private.signal_sources a on a.tenant_id=x.tenant_id and a.id=x.source_id join private.signal_providers v on v.tenant_id=a.tenant_id and v.id=a.provider_id
 left join private.signal_deliveries z on z.tenant_id=x.tenant_id and z.id=x.delivery_id left join private.signal_destinations b on b.tenant_id=z.tenant_id and b.id=z.destination_id
 where x.tenant_id=t and(p is null or v.id=p)and(s is null or a.id=s)and(d is null or b.id=d)and(j is null or z.id=j)
 and(ak is null or x.sequence<ak::bigint)and(hk is null or x.sequence<=hk::bigint)and(keys_value is null or x.sequence=any(keys_value::bigint[]))
 order by x.sequence desc limit least(greatest(lim,1),101)
$$;
create function public.admin_signal_review_page_v1(target_tenant_id uuid,provider_value uuid default null,source_value uuid default null,destination_value uuid default null,delivery_value uuid default null,page_size_value integer default 25,cursor_value jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog set plan_cache_mode=force_custom_plan as $$
declare role_value text;scope_value text;started timestamptz:=statement_timestamp();ak text;hk text;rows_value jsonb;items_value jsonb;more boolean;next_value jsonb;n integer;count_keys integer;
begin
 if auth.uid()is null or not private.has_tenant_role(target_tenant_id,array['super_admin','manager','support','analyst']::public.app_role[])then raise exception 'signal read denied'using errcode='42501';end if;
 select m.role::text into role_value from public.tenant_members m where m.tenant_id=target_tenant_id and m.user_id=auth.uid()and m.status='active';
 if page_size_value is null or page_size_value not between 1 and 100
  or(provider_value is not null and not exists(select 1 from private.signal_providers where tenant_id=target_tenant_id and id=provider_value))
  or(source_value is not null and not exists(select 1 from private.signal_sources where tenant_id=target_tenant_id and id=source_value and(provider_value is null or provider_id=provider_value)))
  or(destination_value is not null and not exists(select 1 from private.signal_destinations where tenant_id=target_tenant_id and id=destination_value))
  or(delivery_value is not null and not exists(select 1 from private.signal_deliveries where tenant_id=target_tenant_id and id=delivery_value))then raise exception 'signal read invalid; refresh'using errcode='22023';end if;
 scope_value:=private.fse_hash(private.fse_canonical(jsonb_build_array('SIGNAL_REVIEW_ADMIN1',target_tenant_id,auth.uid(),role_value,provider_value,source_value,destination_value,delivery_value,page_size_value)));
 if cursor_value is not null then begin
  if not private.fse_keys(cursor_value,array['version','scope','started_at','after','anchor'])or cursor_value->'version'is distinct from '1'::jsonb or cursor_value->>'scope'is distinct from scope_value or octet_length(cursor_value::text)>1024 then raise exception 'invalid';end if;
  started:=(cursor_value->>'started_at')::timestamptz;ak:=cursor_value->>'after';hk:=cursor_value->>'anchor';
  if started is null or not isfinite(started)or started>statement_timestamp()+interval '1 second'or started<statement_timestamp()-interval '30 minutes'or ak is null or hk is null
   or ak!~'^[1-9][0-9]{0,18}$'or hk!~'^[1-9][0-9]{0,18}$'or ak::bigint>hk::bigint then raise exception 'invalid';end if;
  select count(*)into count_keys from private.signal_review_admin_rows_v1(target_tenant_id,provider_value,source_value,destination_value,delivery_value,null,null,array[ak,hk],3);
  if count_keys<>(case when ak=hk then 1 else 2 end)then raise exception 'invalid';end if;
 exception when others then raise exception 'signal read invalid; refresh'using errcode='22023';end;end if;
 select coalesce(jsonb_agg(jsonb_build_object('key',q.key_value,'value',q.row_value)order by q.ord),'[]'::jsonb)into rows_value
 from private.signal_review_admin_rows_v1(target_tenant_id,provider_value,source_value,destination_value,delivery_value,ak,hk,null,page_size_value+1)with ordinality q(key_value,row_value,ord);
 n:=jsonb_array_length(rows_value);more:=n>page_size_value;
 select coalesce(jsonb_agg(value->'value'order by ord),'[]'::jsonb)into items_value from jsonb_array_elements(rows_value)with ordinality z(value,ord)where ord<=page_size_value;
 hk:=coalesce(hk,rows_value->0->>'key');
 if more then next_value:=jsonb_build_object('version',1,'scope',scope_value,'started_at',started,'after',rows_value->(page_size_value-1)->>'key','anchor',hk);end if;
 return jsonb_build_object('version',1,'mode','SYNTHETIC','financial_authority','NONE','live_authority','NONE','collection','reviews','page_size',page_size_value,'items',items_value,'has_more',more,'next_cursor',next_value,'consistency','LIVE_KEYSET_REFRESH_FOR_CHANGES');
end;$$;
revoke all on function private.signal_review_admin_rows_v1(uuid,uuid,uuid,uuid,uuid,text,text,text[],integer)from public,anon,authenticated,service_role;
revoke all on function public.admin_signal_review_page_v1(uuid,uuid,uuid,uuid,uuid,integer,jsonb)from public,anon,service_role;
grant execute on function public.admin_signal_review_page_v1(uuid,uuid,uuid,uuid,uuid,integer,jsonb)to authenticated;

-- Versioned facade: accepted v1 projections remain byte-compatible for older
-- strict clients and safe rollback. Pagination/auth are delegated unchanged.
create function public.admin_signal_page_v2(target_tenant_id uuid,collection_value text default 'deliveries',provider_value uuid default null,source_value uuid default null,destination_value uuid default null,delivery_value uuid default null,status_value text default null,page_size_value integer default 25,cursor_value jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog set plan_cache_mode=force_custom_plan as $$
declare result_value jsonb;items_value jsonb;
begin
 result_value:=public.admin_signal_page_v1(target_tenant_id,collection_value,provider_value,source_value,destination_value,delivery_value,status_value,page_size_value,cursor_value);
 if collection_value not in('sources','deliveries')then return result_value;end if;
 select coalesce(jsonb_agg(x.row_value order by x.ord),'[]'::jsonb)into items_value from(
  select q.value||case when collection_value='sources'and r.source_id is not null then
   jsonb_build_object('source_health',jsonb_build_object('state',r.state,'generation',r.generation,'last_sequence',r.last_sequence,'recovery_target',r.recovery_target,'recovery_required',r.recovery_required,'recovery_attempts',r.recovery_attempts,
    'last_activity_at',r.last_activity_at,'disconnected_at',r.disconnected_at,'fresh',coalesce(r.last_activity_at>=statement_timestamp()-interval '60 seconds',false),'sequence_capability',caps.declaration->>'sequence','recovery_capability',caps.declaration->>'recovery','mode','SYNTHETIC'))
   when collection_value='deliveries'then jsonb_build_object('lease_expired',coalesce(job.status='RUNNING'and job.lease_until<=statement_timestamp(),false))else '{}'::jsonb end row_value,q.ord
  from jsonb_array_elements(result_value->'items')with ordinality q(value,ord)
  left join private.signal_source_runtime r on collection_value='sources'and r.tenant_id=target_tenant_id and r.source_id=(q.value->>'id')::uuid
  left join private.signal_source_capabilities caps on caps.tenant_id=r.tenant_id and caps.id=r.capability_id
  left join private.signal_deliveries job on collection_value='deliveries'and job.tenant_id=target_tenant_id and job.id=(q.value->>'id')::uuid
  order by q.ord limit 100
 )x;
 return jsonb_set(result_value,'{items}',items_value);
end;$$;
revoke all on function public.admin_signal_page_v2(uuid,text,uuid,uuid,uuid,uuid,text,integer,jsonb)from public,anon,service_role;
grant execute on function public.admin_signal_page_v2(uuid,text,uuid,uuid,uuid,uuid,text,integer,jsonb)to authenticated;
