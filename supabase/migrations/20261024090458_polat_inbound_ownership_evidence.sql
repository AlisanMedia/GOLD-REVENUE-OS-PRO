-- Fixture-only coverage and response evidence. Existing queues and LIVE gates unchanged.
create table private.polat_conversation_controls(
 tenant_id uuid not null,conversation_id uuid not null,enabled boolean not null default false,generation bigint not null default 1,
 activation_at timestamptz not null default clock_timestamp(),return_boundary timestamptz,last_inbound_id uuid,human_owner uuid,
 primary key(tenant_id,conversation_id),foreign key(tenant_id,conversation_id)references public.conversations(tenant_id,id),
 foreign key(tenant_id,human_owner)references public.tenant_members(tenant_id,user_id)
);
create table private.polat_inbound_work(
 sequence bigint generated always as identity primary key,tenant_id uuid not null,conversation_id uuid not null,message_id uuid not null,
 source_hash text not null,received_at timestamptz not null default clock_timestamp(),eligible_at_receipt boolean not null,state text not null,
 reason text not null,attempts integer not null default 0 check(attempts between 0 and 3),available_at timestamptz not null default clock_timestamp(),
 review_at timestamptz not null default clock_timestamp(),responded_at timestamptz,resolution_case_id uuid,revision bigint not null default 1,
 unique(tenant_id,message_id),foreign key(tenant_id,conversation_id)references private.polat_conversation_controls(tenant_id,conversation_id),
 foreign key(tenant_id,message_id)references public.messages(tenant_id,id),
 foreign key(tenant_id,resolution_case_id)references public.escalation_cases(tenant_id,id),
 check(state in('AI_RESPONSE_PENDING','AI_RESPONDED','HUMAN_HANDOFF_PENDING','HUMAN_OWNED','BLOCKED_WITH_REASON','DELIVERY_UNKNOWN','CLOSED_WITH_EVIDENCE'))
);
create index polat_work_page on private.polat_inbound_work(tenant_id,sequence desc);
create index polat_work_conversation on private.polat_inbound_work(tenant_id,conversation_id,sequence desc);
create index polat_work_due on private.polat_inbound_work(tenant_id,review_at,conversation_id,sequence)where state in('AI_RESPONSE_PENDING','HUMAN_HANDOFF_PENDING','HUMAN_OWNED','DELIVERY_UNKNOWN');
create table private.polat_response_evidence(
 sequence bigint generated always as identity primary key,tenant_id uuid not null,conversation_id uuid not null,message_id uuid not null,
 operation_id uuid not null,stage text not null check(stage in('PREPARED','FAKE_ACK','FAILED_BEFORE_SEND','UNKNOWN')),
 actor text not null check(actor in('AI','HUMAN')),generation bigint not null,body_hash text not null check(body_hash~'^[0-9a-f]{64}$'),
 fake_reference text,receipt_hash text,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,operation_id,stage),
 foreign key(tenant_id,message_id)references private.polat_inbound_work(tenant_id,message_id),
 check(fake_reference is null or fake_reference~'^polat-fake:[0-9a-f-]{36}$')
);
create unique index polat_one_outcome on private.polat_response_evidence(tenant_id,operation_id)where stage in('FAKE_ACK','FAILED_BEFORE_SEND');
create index polat_response_source on private.polat_response_evidence(tenant_id,message_id,sequence desc);
create table private.polat_work_history(
 sequence bigint generated always as identity primary key,tenant_id uuid not null,conversation_id uuid not null,message_id uuid,
 state text not null,reason text not null,generation bigint not null,actor_id uuid,case_id uuid,created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,conversation_id)references private.polat_conversation_controls(tenant_id,conversation_id),
 foreign key(tenant_id,message_id)references private.polat_inbound_work(tenant_id,message_id),foreign key(tenant_id,case_id)references public.escalation_cases(tenant_id,id)
);
create index polat_history_page on private.polat_work_history(tenant_id,sequence desc);
create trigger polat_response_immutable before update or delete on private.polat_response_evidence for each row execute function private.fse_immutable();
create trigger polat_history_immutable before update or delete on private.polat_work_history for each row execute function private.fse_immutable();
create function private.polat_guard(t uuid,c uuid)returns void language plpgsql set search_path=pg_catalog as $$begin
 if not exists(select 1 from private.polat_conversation_controls x join public.tenants n on n.id=x.tenant_id where x.tenant_id=t and x.conversation_id=c and x.enabled and n.status='active'and n.slug like 'polat-sandbox-%'and not n.outbound_messaging_enabled)then raise exception 'Polat fixture scope unavailable'using errcode='42501';end if;
end;$$;
create function private.polat_log(t uuid,c uuid,m uuid,s text,r text)returns void language plpgsql set search_path=pg_catalog as $$
declare g bigint;begin
 select generation into strict g from private.polat_conversation_controls where tenant_id=t and conversation_id=c;
 insert into private.polat_work_history(tenant_id,conversation_id,message_id,state,reason,generation,actor_id,case_id)values(t,c,m,s,r,g,auth.uid(),(select resolution_case_id from private.polat_inbound_work where tenant_id=t and message_id=m));
 insert into public.audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,after_data)values(t,case when auth.uid()is null then 'SYSTEM'::public.audit_actor_type else 'HUMAN'::public.audit_actor_type end,auth.uid(),'polat.synthetic_work','conversations',c::text,jsonb_build_object('state',s,'reason',r,'generation',g,'financial_authority','NONE'));
end;$$;
create function private.polat_set_work(t uuid,m uuid,s text,r text)returns void language plpgsql set search_path=pg_catalog as $$
declare w private.polat_inbound_work;begin
 select * into strict w from private.polat_inbound_work where tenant_id=t and message_id=m for update;
 if w.state is distinct from s or w.reason is distinct from r then
  update private.polat_inbound_work set state=s,reason=r,revision=revision+1 where tenant_id=t and message_id=m;
  perform private.polat_log(t,w.conversation_id,m,s,r);
 end if;
end;$$;
create function private.polat_capture_fixture(t uuid,m uuid)returns void language plpgsql set search_path=pg_catalog as $$
declare msg public.messages;cv public.conversations;ctrl private.polat_conversation_controls;s text;r text;begin
 select * into msg from public.messages where tenant_id=t and id=m and direction='inbound';if msg.id is null then raise exception 'Polat source unavailable'using errcode='42501';end if;
 select * into strict cv from public.conversations where tenant_id=t and id=msg.conversation_id for no key update;
 select * into ctrl from private.polat_conversation_controls where tenant_id=t and conversation_id=cv.id for update;if ctrl.conversation_id is null then return;end if;
 if exists(select 1 from private.polat_inbound_work where tenant_id=t and message_id=m)then return;end if;
 update private.polat_conversation_controls set generation=generation+1,last_inbound_id=m where tenant_id=t and conversation_id=cv.id;
 s:='AI_RESPONSE_PENDING';r:='AWAITING_AI';
 if not ctrl.enabled or not exists(select 1 from public.tenants where id=t and status='active'and slug like 'polat-sandbox-%'and not outbound_messaging_enabled)then s:='BLOCKED_WITH_REASON';r:='FIXTURE_DISABLED';
 elsif msg.message_type='unsupported' then s:='HUMAN_HANDOFF_PENDING';r:='UNSUPPORTED_MESSAGE';
 elsif not exists(select 1 from public.messaging_contacts where tenant_id=t and id=msg.messaging_contact_id and contactability in('user_initiated','allowed'))then s:='BLOCKED_WITH_REASON';r:='CONTACT_RESTRICTED';
 elsif cv.runtime_mode='PAUSED'then s:='BLOCKED_WITH_REASON';r:='PAUSED';
 elsif cv.runtime_mode='HUMAN_TAKEOVER'or cv.human_takeover then s:=case when ctrl.human_owner is null then 'HUMAN_HANDOFF_PENDING'else 'HUMAN_OWNED'end;r:='HUMAN_CONTROL';end if;
 insert into private.polat_inbound_work(tenant_id,conversation_id,message_id,source_hash,eligible_at_receipt,state,reason)values(t,cv.id,m,private.fse_hash(msg.content),msg.message_type in('text','command')and exists(select 1 from public.messaging_contacts where tenant_id=t and id=msg.messaging_contact_id and contactability in('user_initiated','allowed')),s,r);
 perform private.polat_log(t,cv.id,m,s,r);
end;$$;
create function private.polat_capture_trigger()returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if new.direction='inbound'and exists(select 1 from private.polat_conversation_controls where tenant_id=new.tenant_id and conversation_id=new.conversation_id)then perform private.polat_capture_fixture(new.tenant_id,new.id);end if;return new;
end;$$;
create trigger polat_inbound_coverage after insert on public.messages for each row execute function private.polat_capture_trigger();
create function private.polat_ownership_trigger()returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if (new.runtime_mode,new.human_takeover)is distinct from(old.runtime_mode,old.human_takeover)and exists(select 1 from private.polat_conversation_controls where tenant_id=new.tenant_id and conversation_id=new.id)then
  update private.polat_conversation_controls set generation=generation+1,human_owner=null,return_boundary=case when new.runtime_mode='AI_ACTIVE'then clock_timestamp()else return_boundary end where tenant_id=new.tenant_id and conversation_id=new.id;
  perform private.polat_log(new.tenant_id,new.id,null,case when new.runtime_mode='HUMAN_TAKEOVER'then 'HUMAN_HANDOFF_PENDING'when new.runtime_mode='PAUSED'then 'BLOCKED_WITH_REASON'else 'AI_RESPONSE_PENDING'end,'OWNERSHIP_CHANGED');
 end if;return new;
end;$$;
create trigger polat_ownership_fence after update of runtime_mode,human_takeover on public.conversations for each row execute function private.polat_ownership_trigger();
create function private.polat_configure_fixture(t uuid,c uuid)returns void language plpgsql set search_path=pg_catalog as $$declare m uuid;begin
 if not exists(select 1 from public.tenants n join public.conversations v on v.tenant_id=n.id where n.id=t and v.id=c and n.status='active'and n.slug like 'polat-sandbox-%'and not n.outbound_messaging_enabled)then raise exception 'Polat fixture scope unavailable'using errcode='42501';end if;
 perform 1 from public.conversations where tenant_id=t and id=c for no key update;
 if exists(select 1 from private.polat_conversation_controls where tenant_id=t and conversation_id=c)then return;end if;
 insert into private.polat_conversation_controls(tenant_id,conversation_id,enabled)values(t,c,true)on conflict(tenant_id,conversation_id)do nothing;
 select id into m from public.messages where tenant_id=t and conversation_id=c and direction='inbound'order by created_at desc,id desc limit 1;
 if m is not null then update private.polat_conversation_controls set activation_at=(select created_at from public.messages where tenant_id=t and id=m)where tenant_id=t and conversation_id=c;perform private.polat_capture_fixture(t,m);end if;
end;$$;
create function private.polat_claim_human_fixture(t uuid,c uuid,g bigint)returns bigint language plpgsql set search_path=pg_catalog as $$declare result bigint;begin
 perform private.polat_guard(t,c);
 if not private.has_tenant_role(t,array['super_admin','manager','support']::public.app_role[])then raise exception 'Polat operator unavailable'using errcode='42501';end if;
 perform 1 from public.conversations where tenant_id=t and id=c for no key update;
 if not exists(select 1 from private.polat_conversation_controls where tenant_id=t and conversation_id=c and generation=g)then raise exception 'Polat ownership changed'using errcode='40001';end if;
 perform public.set_conversation_runtime_mode(t,c,'HUMAN_TAKEOVER','SYNTHETIC Polat takeover',extensions.gen_random_uuid());
 update private.polat_conversation_controls set human_owner=auth.uid(),generation=generation+1 where tenant_id=t and conversation_id=c returning generation into result;
 perform private.polat_log(t,c,null,'HUMAN_OWNED','HUMAN_ACKNOWLEDGED');return result;
end;$$;
create function private.polat_prepare_fixture(t uuid,m uuid,op uuid,g bigint,source_hash_value text,body_hash_value text,actor_value text default 'AI')returns jsonb language plpgsql set search_path=pg_catalog as $$
declare w private.polat_inbound_work;cv public.conversations;ctrl private.polat_conversation_controls;existing private.polat_response_evidence;begin
 select * into w from private.polat_inbound_work where tenant_id=t and message_id=m;if w.message_id is null then raise exception 'Polat source unavailable'using errcode='42501';end if;
 perform private.polat_guard(t,w.conversation_id);select * into strict cv from public.conversations where tenant_id=t and id=w.conversation_id for no key update;
 select * into strict ctrl from private.polat_conversation_controls where tenant_id=t and conversation_id=cv.id for update;
 select * into strict w from private.polat_inbound_work where tenant_id=t and message_id=m for update;
 if source_hash_value is distinct from w.source_hash then raise exception 'Polat source changed'using errcode='40001';end if;
 if g is distinct from ctrl.generation then raise exception 'Polat ownership changed'using errcode='40001';end if;
 if body_hash_value is null or body_hash_value!~'^[0-9a-f]{64}$'or actor_value not in('AI','HUMAN')or op is null then raise exception 'Polat command invalid'using errcode='22023';end if;
 select * into existing from private.polat_response_evidence where tenant_id=t and operation_id=op and stage='PREPARED';
 if existing.sequence is not null then
  if (existing.message_id,existing.generation,existing.body_hash,existing.actor)is distinct from(m,g,body_hash_value,actor_value)then raise exception 'Polat operation conflict'using errcode='22023';end if;
  if exists(select 1 from private.polat_response_evidence where tenant_id=t and operation_id=op and stage in('FAKE_ACK','FAILED_BEFORE_SEND'))then return jsonb_build_object('state',w.state,'replay',true,'financial_authority','NONE');end if;
  perform private.polat_set_work(t,m,'DELIVERY_UNKNOWN','PREPARE_REPLAY_UNCERTAIN');return jsonb_build_object('state','DELIVERY_UNKNOWN','replay',true,'financial_authority','NONE');
 end if;
 if ctrl.last_inbound_id is distinct from m or (ctrl.return_boundary is not null and w.received_at<ctrl.return_boundary)or w.source_hash is distinct from(select private.fse_hash(content)from public.messages where tenant_id=t and id=m)then
  perform private.polat_set_work(t,m,'HUMAN_HANDOFF_PENDING','STALE_SOURCE');return jsonb_build_object('state','HUMAN_HANDOFF_PENDING','financial_authority','NONE');end if;
 if not exists(select 1 from public.messaging_contacts where tenant_id=t and id=cv.messaging_contact_id and contactability in('user_initiated','allowed'))or cv.status<>'open'or cv.runtime_mode='PAUSED'then
  perform private.polat_set_work(t,m,'BLOCKED_WITH_REASON','CONTACT_OR_OWNER_BLOCK');return jsonb_build_object('state','BLOCKED_WITH_REASON','financial_authority','NONE');end if;
 if actor_value='AI'and(cv.runtime_mode<>'AI_ACTIVE'or cv.human_takeover or exists(select 1 from public.escalation_cases where tenant_id=t and conversation_id=cv.id and status<>'RESOLVED'))then
  perform private.polat_set_work(t,m,'HUMAN_HANDOFF_PENDING','HUMAN_CONTROL');return jsonb_build_object('state','HUMAN_HANDOFF_PENDING','financial_authority','NONE');end if;
 if actor_value='HUMAN'and(cv.runtime_mode<>'HUMAN_TAKEOVER'or ctrl.human_owner is distinct from auth.uid()or not private.has_tenant_role(t,array['super_admin','manager','support']::public.app_role[]))then raise exception 'Polat operator unavailable'using errcode='42501';end if;
 if exists(select 1 from private.polat_response_evidence e where e.tenant_id=t and e.conversation_id=cv.id and e.stage='PREPARED'and not exists(select 1 from private.polat_response_evidence z where z.tenant_id=t and z.operation_id=e.operation_id and z.stage in('FAKE_ACK','FAILED_BEFORE_SEND')))then
  perform private.polat_set_work(t,m,'DELIVERY_UNKNOWN','UNRESOLVED_EFFECT');return jsonb_build_object('state','DELIVERY_UNKNOWN','financial_authority','NONE');end if;
 if actor_value='AI'and w.state='HUMAN_HANDOFF_PENDING'then return jsonb_build_object('state',w.state,'financial_authority','NONE');end if;
 if w.responded_at is not null or w.state in('CLOSED_WITH_EVIDENCE','DELIVERY_UNKNOWN')then return jsonb_build_object('state',w.state,'financial_authority','NONE');end if;
 if w.attempts>=3 then perform private.polat_set_work(t,m,'HUMAN_HANDOFF_PENDING','RETRY_BUDGET_EXHAUSTED');return jsonb_build_object('state','HUMAN_HANDOFF_PENDING','financial_authority','NONE');end if;
 if w.available_at>clock_timestamp()then return jsonb_build_object('state','AI_RESPONSE_PENDING','financial_authority','NONE');end if;
 insert into private.polat_response_evidence(tenant_id,conversation_id,message_id,operation_id,stage,actor,generation,body_hash)values(t,cv.id,m,op,'PREPARED',actor_value,g,body_hash_value);
 update private.polat_inbound_work set attempts=attempts+1 where tenant_id=t and message_id=m;
 perform private.polat_set_work(t,m,case when actor_value='AI'then 'AI_RESPONSE_PENDING'else 'HUMAN_OWNED'end,'FAKE_PREPARED');
 return jsonb_build_object('state','PREPARED','mode','SYNTHETIC','operation_id',op,'generation',g::text,'financial_authority','NONE','live_operations_authorized',false);
end;$$;
create function private.polat_outcome_fixture(t uuid,op uuid,raw_receipt text)returns text language plpgsql set search_path=pg_catalog as $$
declare e private.polat_response_evidence;old private.polat_response_evidence;cv public.conversations;ctrl private.polat_conversation_controls;w private.polat_inbound_work;s text;r text;v jsonb;result_value text;receipt_hash_value text;begin
 select * into e from private.polat_response_evidence where tenant_id=t and operation_id=op and stage='PREPARED';if e.sequence is null then raise exception 'Polat operation unavailable'using errcode='42501';end if;
 perform private.polat_guard(t,e.conversation_id);select * into strict cv from public.conversations where tenant_id=t and id=e.conversation_id for no key update;
 select * into strict ctrl from private.polat_conversation_controls where tenant_id=t and conversation_id=cv.id for update;
 select * into strict w from private.polat_inbound_work where tenant_id=t and message_id=e.message_id for update;
 v:=private.fse_strict_json(raw_receipt);
 if not private.fse_keys(v,array['version','mode','origin','tenant_id','conversation_id','message_id','operation_id','body_hash','result','reference'])or v->'version'is distinct from '1'::jsonb or v->>'mode'is distinct from 'SYNTHETIC'or v->>'origin'is distinct from 'FAKE'or v->>'tenant_id'is distinct from t::text or v->>'conversation_id'is distinct from cv.id::text or v->>'message_id'is distinct from e.message_id::text or v->>'operation_id'is distinct from op::text or v->>'body_hash'is distinct from e.body_hash or(v->>'result')is null or v->>'result'not in('FAKE_ACK','FAILED_BEFORE_SEND','UNKNOWN')then raise exception 'Polat outcome invalid'using errcode='22023';end if;
 result_value:=v->>'result';receipt_hash_value:=private.fse_hash(private.fse_canonical(v));
 if(result_value='FAKE_ACK'and v->>'reference'is distinct from 'polat-fake:'||op::text)or(result_value<>'FAKE_ACK'and v->'reference'is distinct from 'null'::jsonb)then raise exception 'Polat reference invalid'using errcode='22023';end if;
 if exists(select 1 from private.polat_response_evidence where tenant_id=t and operation_id=op and stage=result_value)then if not exists(select 1 from private.polat_response_evidence where tenant_id=t and operation_id=op and stage=result_value and receipt_hash=receipt_hash_value)then raise exception 'Polat receipt conflict'using errcode='22023';end if;return w.state;end if;
 if result_value='FAILED_BEFORE_SEND'and exists(select 1 from private.polat_response_evidence where tenant_id=t and operation_id=op and stage='UNKNOWN')then raise exception 'Unknown effect needs independent positive evidence'using errcode='22023';end if;
 select * into old from private.polat_response_evidence where tenant_id=t and operation_id=op and stage in('FAKE_ACK','FAILED_BEFORE_SEND');
 if old.sequence is not null then if old.stage<>result_value then raise exception 'Polat outcome conflict'using errcode='22023';end if;return w.state;end if;
 insert into private.polat_response_evidence(tenant_id,conversation_id,message_id,operation_id,stage,actor,generation,body_hash,fake_reference,receipt_hash)values(t,cv.id,e.message_id,op,result_value,e.actor,e.generation,e.body_hash,case when result_value='FAKE_ACK'then 'polat-fake:'||op::text end,receipt_hash_value);
 s:='DELIVERY_UNKNOWN';r:='EFFECT_UNKNOWN';
 if result_value='FAILED_BEFORE_SEND'and ctrl.generation<>e.generation then s:='HUMAN_HANDOFF_PENDING';r:='OWNERSHIP_CHANGED';
 elsif result_value='FAILED_BEFORE_SEND'then s:=case when w.attempts>=3 then 'HUMAN_HANDOFF_PENDING'else 'AI_RESPONSE_PENDING'end;r:=case when w.attempts>=3 then 'RETRY_BUDGET_EXHAUSTED'else 'RETRY_BOUNDED'end;update private.polat_inbound_work set available_at=clock_timestamp()+make_interval(secs=>least(8,power(2,attempts)::int))where tenant_id=t and message_id=e.message_id;
 elsif result_value='FAKE_ACK'and ctrl.generation=e.generation and ctrl.last_inbound_id=e.message_id and w.source_hash=(select private.fse_hash(content)from public.messages where tenant_id=t and id=e.message_id)and exists(select 1 from public.messaging_contacts where tenant_id=t and id=cv.messaging_contact_id and contactability in('user_initiated','allowed'))and cv.status='open'and ((e.actor='AI'and cv.runtime_mode='AI_ACTIVE'and not cv.human_takeover)or(e.actor='HUMAN'and cv.runtime_mode='HUMAN_TAKEOVER'and ctrl.human_owner is not null))then
  s:=case when e.actor='AI'then 'AI_RESPONDED'else 'HUMAN_OWNED'end;r:='FAKE_ACK_RECORDED';update private.polat_inbound_work set responded_at=clock_timestamp()where tenant_id=t and message_id=e.message_id;
 elsif result_value='FAKE_ACK'then r:='STALE_ACK_REQUIRES_REVIEW';end if;
 perform private.polat_set_work(t,e.message_id,s,r);return s;
end;$$;
create function private.polat_refresh_fixture(t uuid,page_limit integer default 25)returns integer language plpgsql set search_path=pg_catalog as $$
declare candidate record;w private.polat_inbound_work;cv public.conversations;ctrl private.polat_conversation_controls;task public.agent_tasks;s text;r text;n int:=0;begin
 if page_limit is null or page_limit<1 or page_limit>100 then raise exception 'Polat page size invalid'using errcode='22023';end if;
 for candidate in select conversation_id,message_id from private.polat_inbound_work where tenant_id=t and review_at<=clock_timestamp()and state not in('AI_RESPONDED','CLOSED_WITH_EVIDENCE','BLOCKED_WITH_REASON')order by review_at,conversation_id,sequence limit page_limit loop
  select * into cv from public.conversations where tenant_id=t and id=candidate.conversation_id for no key update skip locked;if cv.id is null then continue;end if;
  perform private.polat_guard(t,cv.id);select * into strict ctrl from private.polat_conversation_controls where tenant_id=t and conversation_id=cv.id for update;
  select * into w from private.polat_inbound_work where tenant_id=t and message_id=candidate.message_id for update skip locked;if w.message_id is null then continue;end if;
  s:=w.state;r:=w.reason;
  if exists(select 1 from private.polat_response_evidence e where e.tenant_id=t and e.message_id=w.message_id and e.stage='PREPARED'and e.created_at<clock_timestamp()-interval '30 seconds'and not exists(select 1 from private.polat_response_evidence o where o.tenant_id=t and o.operation_id=e.operation_id and o.stage in('FAKE_ACK','FAILED_BEFORE_SEND')))then s:='DELIVERY_UNKNOWN';r:='PREPARE_ACK_TIMEOUT';
  elsif s<>'DELIVERY_UNKNOWN'then
   if cv.runtime_mode='PAUSED'then s:='BLOCKED_WITH_REASON';r:='PAUSED';
   elsif cv.runtime_mode='HUMAN_TAKEOVER'or cv.human_takeover then s:=case when ctrl.human_owner is null then 'HUMAN_HANDOFF_PENDING'else 'HUMAN_OWNED'end;r:='HUMAN_CONTROL';
   elsif ctrl.last_inbound_id is distinct from w.message_id or(ctrl.return_boundary is not null and w.received_at<ctrl.return_boundary)then s:='HUMAN_HANDOFF_PENDING';r:='STALE_SOURCE';
   else
    select a.* into task from public.agent_tasks a join public.domain_events d on d.id=a.source_event_id and d.tenant_id=a.tenant_id where a.tenant_id=t and a.conversation_id=cv.id and a.task_type like 'conversation.%'and d.payload->>'message_id'=w.message_id::text order by a.created_at desc,a.id desc limit 1;
    if task.status in('DEAD_LETTER','CANCELLED','FAILED','TIMED_OUT')or task.attempts>=task.max_attempts or w.received_at<clock_timestamp()-interval '5 minutes'then s:='HUMAN_HANDOFF_PENDING';r:='AI_TIMEOUT_OR_REVIEW';end if;
   end if;
  end if;
  perform private.polat_set_work(t,w.message_id,s,r);update private.polat_inbound_work set review_at=clock_timestamp()+interval '30 seconds'where tenant_id=t and message_id=w.message_id;n:=n+1;
 end loop;return n;
end;$$;
create function private.polat_close_fixture(t uuid,m uuid,case_value uuid)returns void language plpgsql set search_path=pg_catalog as $$
declare w private.polat_inbound_work;begin
 select *into w from private.polat_inbound_work where tenant_id=t and message_id=m;if w.message_id is null then raise exception 'Polat source unavailable'using errcode='42501';end if;
 perform private.polat_guard(t,w.conversation_id);perform 1 from public.conversations where tenant_id=t and id=w.conversation_id for no key update;
 if not private.has_tenant_role(t,array['super_admin','manager','support']::public.app_role[])or not exists(select 1 from public.escalation_cases e where e.tenant_id=t and e.id=case_value and e.conversation_id=w.conversation_id and e.status='RESOLVED'and e.resolved_at>=w.received_at and(e.source_message_id=m or exists(select 1 from public.escalation_evidence z where z.tenant_id=t and z.case_id=e.id and z.message_id=m)))then raise exception 'Polat resolution evidence unavailable'using errcode='42501';end if;
 if exists(select 1 from private.polat_response_evidence e where e.tenant_id=t and e.message_id=m and e.stage='PREPARED'and not exists(select 1 from private.polat_response_evidence z where z.tenant_id=t and z.operation_id=e.operation_id and z.stage in('FAKE_ACK','FAILED_BEFORE_SEND')))then raise exception 'Polat unresolved effect'using errcode='42501';end if;
 if w.state='CLOSED_WITH_EVIDENCE'then return;end if;
 update private.polat_inbound_work set resolution_case_id=case_value where tenant_id=t and message_id=m;
 perform private.polat_set_work(t,m,'CLOSED_WITH_EVIDENCE','RESOLVED_CASE');
end;$$;
create function private.polat_hold_fixture(t uuid,m uuid,g bigint,reason_value text)returns text language plpgsql set search_path=pg_catalog as $$
declare w private.polat_inbound_work;cv public.conversations;ctrl private.polat_conversation_controls;s text;begin
 select *into w from private.polat_inbound_work where tenant_id=t and message_id=m;if w.message_id is null then raise exception 'Polat source unavailable'using errcode='42501';end if;
 perform private.polat_guard(t,w.conversation_id);select *into strict cv from public.conversations where tenant_id=t and id=w.conversation_id for no key update;
 select *into strict ctrl from private.polat_conversation_controls where tenant_id=t and conversation_id=cv.id for update;
 if ctrl.generation is distinct from g then raise exception 'Polat ownership changed'using errcode='40001';end if;
 if reason_value not in('QA_HOLD','MODEL_UNAVAILABLE')or reason_value is null then raise exception 'Polat hold invalid'using errcode='22023';end if;
 if w.state in('DELIVERY_UNKNOWN','AI_RESPONDED','CLOSED_WITH_EVIDENCE')or w.responded_at is not null then return w.state;end if;
 s:=case when cv.runtime_mode='PAUSED'or not exists(select 1 from public.messaging_contacts where tenant_id=t and id=cv.messaging_contact_id and contactability in('user_initiated','allowed'))then 'BLOCKED_WITH_REASON'when cv.runtime_mode='HUMAN_TAKEOVER'and ctrl.human_owner is not null then 'HUMAN_OWNED'else 'HUMAN_HANDOFF_PENDING'end;
 perform private.polat_set_work(t,m,s,reason_value);return s;
end;$$;
create function private.polat_can_dispatch_fixture(t uuid,op uuid,g bigint)returns boolean language sql stable set search_path=pg_catalog as $$
 select exists(select 1 from private.polat_response_evidence e join private.polat_inbound_work w on w.tenant_id=e.tenant_id and w.message_id=e.message_id join private.polat_conversation_controls k on k.tenant_id=e.tenant_id and k.conversation_id=e.conversation_id join public.conversations c on c.tenant_id=e.tenant_id and c.id=e.conversation_id join public.tenants n on n.id=e.tenant_id join public.messaging_contacts x on x.tenant_id=c.tenant_id and x.id=c.messaging_contact_id
 where e.tenant_id=t and e.operation_id=op and e.stage='PREPARED'and k.enabled and k.generation=g and e.generation=g and k.last_inbound_id=e.message_id and n.status='active'and n.slug like 'polat-sandbox-%'and not n.outbound_messaging_enabled and c.status='open'and x.contactability in('user_initiated','allowed')and w.source_hash=(select private.fse_hash(content)from public.messages where tenant_id=t and id=e.message_id)and not exists(select 1 from private.polat_response_evidence z where z.tenant_id=t and z.operation_id=op and z.stage<>'PREPARED')and ((e.actor='AI'and c.runtime_mode='AI_ACTIVE'and not c.human_takeover and w.state='AI_RESPONSE_PENDING')or(e.actor='HUMAN'and c.runtime_mode='HUMAN_TAKEOVER'and k.human_owner=auth.uid()and w.state='HUMAN_OWNED')));
$$;
do $$declare tbl text;fn record;begin
 foreach tbl in array array['polat_conversation_controls','polat_inbound_work','polat_response_evidence','polat_work_history']loop
 execute format('alter table private.%I enable row level security',tbl);execute format('revoke all on private.%I from public,anon,authenticated,service_role',tbl);
 end loop;
 for fn in select oid::regprocedure sig from pg_proc where pronamespace='private'::regnamespace and proname like 'polat_%'loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.sig);end loop;
end;$$;

create function private.polat_work_projection(w private.polat_inbound_work)returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare cv public.conversations;ctrl private.polat_conversation_controls;s text:=w.state;r text:=w.reason;assigned boolean;begin
 select * into strict cv from public.conversations where tenant_id=w.tenant_id and id=w.conversation_id;
 select * into strict ctrl from private.polat_conversation_controls where tenant_id=w.tenant_id and conversation_id=w.conversation_id;
 assigned:=ctrl.human_owner is not null and exists(select 1 from public.tenant_members where tenant_id=w.tenant_id and user_id=ctrl.human_owner and status='active'and role in('super_admin','manager','support'));
 if s not in('AI_RESPONDED','CLOSED_WITH_EVIDENCE','DELIVERY_UNKNOWN')then
  if cv.runtime_mode='PAUSED'then s:='BLOCKED_WITH_REASON';r:='PAUSED';
  elsif cv.runtime_mode='HUMAN_TAKEOVER'or cv.human_takeover then s:=case when assigned then 'HUMAN_OWNED'else 'HUMAN_HANDOFF_PENDING'end;r:='HUMAN_CONTROL';
  elsif ctrl.last_inbound_id is distinct from w.message_id or(ctrl.return_boundary is not null and w.received_at<ctrl.return_boundary)then s:='HUMAN_HANDOFF_PENDING';r:='STALE_SOURCE';end if;
 end if;
 return jsonb_build_object('message_id',w.message_id,'conversation_id',w.conversation_id,'case_id',w.resolution_case_id,'state',s,'reason',r,'owner_mode',case when cv.runtime_mode='HUMAN_TAKEOVER'then 'HUMAN_ACTIVE'else cv.runtime_mode::text end,
  'human_assigned',assigned,'eligible_at_receipt',w.eligible_at_receipt,'received_at',w.received_at,'sandbox_ack_at',w.responded_at,'revision',w.revision::text,'overdue',w.responded_at is null and s not in('BLOCKED_WITH_REASON','CLOSED_WITH_EVIDENCE')and w.received_at<statement_timestamp()-interval '30 seconds','delivery',case when w.responded_at is not null then 'FAKE_ACKNOWLEDGED'when s='DELIVERY_UNKNOWN'then 'UNKNOWN'else 'NOT_CONFIRMED'end,
  'mode','SYNTHETIC','financial_authority','NONE','live_operations_authorized',false);
end;$$;
revoke all on function private.polat_work_projection(private.polat_inbound_work)from public,anon,authenticated,service_role;
create function public.admin_polat_inbound_page_v1(target_tenant_id uuid,conversation_value uuid default null,state_value text default null,page_size_value integer default 25,cursor_value jsonb default null)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare role_value public.app_role;gen bigint;anchor_value bigint;before_value bigint;exp timestamptz;rows_value jsonb;matched jsonb;more boolean;incomplete boolean;next_value jsonb;next_seq bigint;begin
 select role into role_value from public.tenant_members where tenant_id=target_tenant_id and user_id=auth.uid()and status='active';
 if role_value is null or role_value not in('super_admin','manager','support','analyst')then raise exception 'Polat read unavailable'using errcode='42501';end if;
 if page_size_value is null or page_size_value<1 or page_size_value>100 or(state_value is not null and state_value not in('AI_RESPONSE_PENDING','AI_RESPONDED','HUMAN_HANDOFF_PENDING','HUMAN_OWNED','BLOCKED_WITH_REASON','DELIVERY_UNKNOWN','CLOSED_WITH_EVIDENCE'))or(conversation_value is not null and not exists(select 1 from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=conversation_value))then raise exception 'Polat page invalid'using errcode='22023';end if;
 select coalesce((select sequence from private.polat_work_history where tenant_id=target_tenant_id order by sequence desc limit 1),0)into gen;
 select coalesce((select sequence from private.polat_inbound_work where tenant_id=target_tenant_id and(conversation_value is null or conversation_id=conversation_value)order by sequence desc limit 1),0)into anchor_value;
 exp:=statement_timestamp()+interval '30 minutes';before_value:=null;
 if cursor_value is not null then
  if not private.fse_keys(cursor_value,array['v','tenant','user','role','conversation','state','size','generation','anchor','before','expires'])or not private.fse_strings(cursor_value,array['tenant','user','role','generation','anchor','before','expires'],array['conversation','state'])or jsonb_typeof(cursor_value->'v')is distinct from 'number'or jsonb_typeof(cursor_value->'size')is distinct from 'number' or cursor_value->>'v'<>'1'or cursor_value->>'tenant'<>target_tenant_id::text or cursor_value->>'user'<>auth.uid()::text or cursor_value->>'role'<>role_value::text or cursor_value->'conversation'is distinct from coalesce(to_jsonb(conversation_value),'null'::jsonb)or cursor_value->'state'is distinct from coalesce(to_jsonb(state_value),'null'::jsonb)or cursor_value->>'size'<>page_size_value::text or cursor_value->>'generation'<>gen::text or cursor_value->>'anchor'!~'^[0-9]{1,19}$'or cursor_value->>'before'!~'^[1-9][0-9]{0,18}$'then raise exception 'Polat page changed'using errcode='22023';end if;
  anchor_value:=(cursor_value->>'anchor')::bigint;before_value:=(cursor_value->>'before')::bigint;exp:=(cursor_value->>'expires')::timestamptz;
  if exp<=statement_timestamp()or exp>statement_timestamp()+interval '30 minutes'or before_value>anchor_value or not exists(select 1 from private.polat_inbound_work where tenant_id=target_tenant_id and sequence=before_value and(conversation_value is null or conversation_id=conversation_value))then raise exception 'Polat page invalid'using errcode='22023';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('sequence',q.sequence::text,'row',private.polat_work_projection(q))order by q.sequence desc),'[]'::jsonb)into rows_value from(select w.* from private.polat_inbound_work w where tenant_id=target_tenant_id and sequence<=anchor_value and(before_value is null or sequence<before_value)and(conversation_value is null or conversation_id=conversation_value)order by sequence desc limit 501)q;
 select coalesce(jsonb_agg(x.value order by x.ordinality),'[]'::jsonb)into matched from jsonb_array_elements(rows_value)with ordinality x where x.ordinality<=500 and(state_value is null or x.value->'row'->>'state'=state_value);
 more:=jsonb_array_length(matched)>page_size_value or jsonb_array_length(rows_value)>500;
 incomplete:=jsonb_array_length(rows_value)>500 and jsonb_array_length(matched)<=page_size_value;
 if more then
  next_seq:=case when jsonb_array_length(matched)>page_size_value then(matched->(page_size_value-1)->>'sequence')::bigint else(rows_value->499->>'sequence')::bigint end;
  next_value:=jsonb_build_object('v',1,'tenant',target_tenant_id,'user',auth.uid(),'role',role_value,'conversation',conversation_value,'state',state_value,'size',page_size_value,'generation',gen::text,'anchor',anchor_value::text,'before',next_seq::text,'expires',exp);
 end if;
 if coalesce((select sequence from private.polat_work_history where tenant_id=target_tenant_id order by sequence desc limit 1),0)<>gen then raise exception 'Polat page changed'using errcode='22023';end if;
 return jsonb_build_object('version',1,'mode','SYNTHETIC','items',(select coalesce(jsonb_agg(value->'row'order by ordinality),'[]'::jsonb)from jsonb_array_elements(matched)with ordinality where ordinality<=page_size_value),'page_size',page_size_value,'has_more',more,'scan_incomplete',incomplete,'next_cursor',next_value,'financial_authority','NONE','live_operations_authorized',false);
exception when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'Polat page invalid'using errcode='22023';
end;$$;
revoke all on function public.admin_polat_inbound_page_v1(uuid,uuid,text,integer,jsonb)from public,anon,service_role;
grant execute on function public.admin_polat_inbound_page_v1(uuid,uuid,text,integer,jsonb)to authenticated;
