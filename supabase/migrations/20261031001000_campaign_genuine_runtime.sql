-- Genuine campaign wiring. No account/bot authority is provisioned by migration.
-- Existing START is the ONLY owner activation. Independent provider controls are setup,
-- not per-message approvals. Shared experiment journal, native QA, messages and CRM.
create table private.campaign_execution_controls(
 tenant_id uuid not null,campaign_id uuid not null,run_id uuid not null unique,
 binding jsonb not null,binding_hash text not null check(binding_hash~'^[a-f0-9]{64}$'),
 account jsonb not null,transport jsonb not null,scope text not null check(scope in('CONTROLLED_TEST','COMMERCIAL')),
 created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,campaign_id),foreign key(tenant_id,campaign_id)references private.sales_campaigns(tenant_id,id)
);
create table private.campaign_model_attempts(
 tenant_id uuid not null,campaign_id uuid not null,job_id uuid not null,attempt_id uuid primary key,
 native_run_id uuid not null,revision integer not null,dispatch_nonce uuid,started_at timestamptz,deadline timestamptz,
 unique(tenant_id,job_id),unique(tenant_id,native_run_id),
 foreign key(tenant_id,campaign_id)references private.sales_campaigns(tenant_id,id),
 foreign key(tenant_id,job_id)references private.campaign_jobs(tenant_id,job_id),
 foreign key(attempt_id)references private.polat_experiment_attempts(id),
 foreign key(tenant_id,native_run_id)references public.agent_runs(tenant_id,id)
);
alter table private.campaign_jobs add column agent_task_id uuid references public.agent_tasks(id);
create unique index campaign_native_task_once on private.campaign_jobs(agent_task_id)where agent_task_id is not null;
alter table private.campaign_execution_controls enable row level security;
alter table private.campaign_model_attempts enable row level security;
revoke all on private.campaign_execution_controls,private.campaign_model_attempts from public,anon,authenticated,service_role;

create function private.campaign_control_guard()returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_op='DELETE'or to_jsonb(new)-array['account','transport'] is distinct from to_jsonb(old)-array['account','transport']
 then raise exception 'CAMPAIGN_CONTROL_IMMUTABLE'using errcode='42501';end if;return new;end;$$;
create trigger campaign_control_immutable before update or delete on private.campaign_execution_controls for each row execute function private.campaign_control_guard();

-- Bound service-only control read. The writer is private/postgres-only, never an Admin JSON approval.
create function private.campaign_execution_guard(t uuid,p uuid)returns private.campaign_execution_controls language plpgsql stable set search_path=pg_catalog as $$
declare x private.campaign_execution_controls;c private.sales_campaigns;a jsonb;begin
 select * into x from private.campaign_execution_controls where tenant_id=t and campaign_id=p;
 select * into c from private.sales_campaigns where tenant_id=t and id=p;
 a:=x.account;
 if x.campaign_id is null or c.id is null or c.state<>'ACTIVE' or private.campaign_blockers(t,p)<>'[]'::jsonb
 or x.binding->>'configuration_hash' is distinct from private.fse_hash(private.fse_canonical(c.configuration))
 or exists(select 1 from private.polat_experiment_runs where id=x.run_id and stop_reason is not null)
 or (x.binding->>'expires_at')::timestamptz<=clock_timestamp()
 or (a->>'expires_at')::timestamptz<=clock_timestamp()or (a->>'observed_at')::timestamptz>clock_timestamp()
 or (a->>'observed_at')::timestamptz<clock_timestamp()-interval '5 minutes'
 or (x.transport->>'expires_at')::timestamptz<=clock_timestamp()
 or not exists(select 1 from public.tenant_members where tenant_id=t and user_id=c.owner_id and role='super_admin'and status='active')
 or not exists(select 1 from public.audit_logs where tenant_id=t and actor_id=c.owner_id and action='campaign.state_changed'and entity_id=p::text and after_data->>'state'='ACTIVE'and created_at>=c.activated_at-interval '1 second')
 then raise exception 'CAMPAIGN_INDEPENDENT_CONTROL_REQUIRED'using errcode='42501';end if;
 return x;end;$$;

create function public.campaign_execution_control_v1(target_tenant_id uuid,campaign_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare x private.campaign_execution_controls;c private.sales_campaigns;begin
 x:=private.campaign_execution_guard(target_tenant_id,campaign_id_value);
 select * into strict c from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value;
 return jsonb_build_object('binding',x.binding,'account',x.account,'owner',jsonb_build_object('origin','SERVER_AUTHENTICATED_CAMPAIGN_START',
 'tenant_id',c.tenant_id,'campaign_id',c.id,'owner_user_id',c.owner_id,'role','super_admin','aal','aal2','state',c.state,'revision',c.revision,
 'binding_hash',x.binding_hash,'configuration_hash',x.binding->>'configuration_hash','activated_at',c.activated_at));end;$$;

create function private.campaign_control_record(t uuid,p uuid,raw_value text)returns void language plpgsql set search_path=pg_catalog as $$
declare v jsonb;b jsonb;a jsonb;s jsonb;c private.sales_campaigns;x private.campaign_execution_controls;k text;h text;begin
 if current_user<>'postgres' then raise exception 'CAMPAIGN_CONTROL_UNAVAILABLE'using errcode='42501';end if;
 v:=private.fse_strict_json(raw_value);b:=v->'binding';a:=v->'account';s:=v->'transport';
 select * into c from private.sales_campaigns where tenant_id=t and id=p for update;
 if octet_length(raw_value)>32768 or not private.fse_strings(v,array['scope','source_hash'])
 or not private.fse_strings(b,array['mode','tenant_id','campaign_id','provider','model','model_version','protocol_version','repository_sha','configuration_hash','account_scope_hash','authorization_record_hash','manifest_hash','policy_hash','credential_custody_hash','maximum_spend','maximum_attempt_liability','currency','expires_at','financial_authority'])
 or not private.fse_strings(a,array['origin','tenant_id','campaign_id','binding_hash','organization_id','project_id','credential_sha256','effective_limit_kind','enforced_maximum_spend','independently_observed_spend','remaining_allowance','currency','data_policy_evidence_hash','billing_evidence_hash','canary_reconciliation_hash','observed_at','expires_at'])
 or not private.fse_strings(s,array['mode','tenant_id','campaign_id','repository_sha','bot_id','credential_sha256','representative_user_id','business_connection_id','connection_generation','observed_at','expires_at'])
 then raise exception 'CAMPAIGN_CONTROL_INVALID'using errcode='22023';end if;
 if c.id is null or not private.fse_keys(v,array['binding','account','transport','scope','source_hash'])
 or v->>'source_hash'!~'^[a-f0-9]{64}$'or v->>'scope'not in('CONTROLLED_TEST','COMMERCIAL')
 or not private.fse_keys(b,array['version','mode','tenant_id','campaign_id','provider','model','model_version','protocol_version','repository_sha','configuration_hash','account_scope_hash','authorization_record_hash','manifest_hash','policy_hash','credential_custody_hash','maximum_requests','maximum_spend','maximum_attempt_liability','currency','maximum_output_tokens','timeout_ms','expires_at','financial_authority'])
 or b->'version'is distinct from '3'::jsonb or b->>'mode'is distinct from 'FOUNDER_CAMPAIGN'
 or b->>'tenant_id'is distinct from t::text or b->>'campaign_id'is distinct from p::text
 or b->>'provider'is distinct from 'openai'or b->>'model'is distinct from 'gpt-6.1-sol'or b->>'model_version'is distinct from 'gpt-6.1-sol'
 or b->>'protocol_version'is distinct from 'responses-v1'or b->>'repository_sha'!~'^[a-f0-9]{40}$'
 or b->>'financial_authority'is distinct from 'NONE'or b->>'currency'is distinct from 'USD'
 or b->>'configuration_hash'is distinct from private.fse_hash(private.fse_canonical(c.configuration))
 or b->'maximum_requests'is distinct from c.configuration->'maximum_model_calls'
 or (b->>'maximum_spend')::numeric is distinct from (c.configuration->>'budget_amount')::numeric
 or (b->>'maximum_attempt_liability')::numeric is distinct from (c.configuration->>'maximum_liability_per_call')::numeric
 or b->'maximum_output_tokens'is distinct from c.configuration->'maximum_output_tokens'
 or b->>'maximum_output_tokens'!~'^[1-9][0-9]{0,2}$'or (b->>'maximum_output_tokens')::int>512
 or b->'timeout_ms'is distinct from '10000'::jsonb or (b->>'expires_at')::timestamptz is distinct from (c.configuration->>'expires_at')::timestamptz
 or private.polat_experiment_decimal(b->>'maximum_spend')<=0 or private.polat_experiment_decimal(b->>'maximum_attempt_liability')<=0
 then raise exception 'CAMPAIGN_CONTROL_INVALID'using errcode='22023';end if;
 foreach k in array array['account_scope_hash','authorization_record_hash','manifest_hash','policy_hash','credential_custody_hash']loop
  if b->>k is null or b->>k!~'^[a-f0-9]{64}$'then raise exception 'CAMPAIGN_CONTROL_INVALID'using errcode='22023';end if;
 end loop;
 h:=private.fse_hash(private.fse_canonical(b));
 if not private.fse_keys(a,array['version','origin','tenant_id','campaign_id','binding_hash','organization_id','project_id','credential_sha256','model_access','effective_limit_kind','enforced_maximum_spend','independently_observed_spend','remaining_allowance','currency','unknown_outcome_count','data_policy_evidence_hash','billing_evidence_hash','canary_reconciliation_hash','pricing','observed_at','expires_at'])
 or a->'version'is distinct from '1'::jsonb or a->>'origin'is distinct from 'INDEPENDENT_CAMPAIGN_ACCOUNT_CONTROL'
 or a->>'tenant_id'is distinct from t::text or a->>'campaign_id'is distinct from p::text or a->>'binding_hash'is distinct from h
 or a->'model_access'is distinct from 'true'::jsonb or a->>'effective_limit_kind'is distinct from 'ENFORCED_CAMPAIGN_HARD_CAP'
 or a->>'currency'is distinct from 'USD'or a->'unknown_outcome_count'is distinct from '0'::jsonb
 or a->>'organization_id'!~'^org[-_][A-Za-z0-9_-]{1,120}$'or a->>'project_id'!~'^proj_[A-Za-z0-9_-]{1,120}$'
 or b->>'account_scope_hash'is distinct from private.fse_hash(private.fse_canonical(jsonb_build_array('OPENAI_PROJECT1',a->>'organization_id',a->>'project_id')))
 or private.polat_experiment_decimal(a->>'enforced_maximum_spend')<(b->>'maximum_spend')::numeric
 or private.polat_experiment_decimal(a->>'remaining_allowance')<(b->>'maximum_attempt_liability')::numeric
 or private.polat_experiment_decimal(a->>'remaining_allowance')>private.polat_experiment_decimal(a->>'enforced_maximum_spend')-private.polat_experiment_decimal(a->>'independently_observed_spend')
 or(a->>'observed_at')::timestamptz>clock_timestamp()or(a->>'expires_at')::timestamptz<=clock_timestamp()
 or(a->>'expires_at')::timestamptz>(a->>'observed_at')::timestamptz+interval '5 minutes'
 or not private.fse_keys(a->'pricing',array['maximum_input_tokens','maximum_input_usd_per_million','maximum_output_usd_per_million','all_billable_components_covered','source_hash'])
 or a#>'{pricing,maximum_input_tokens}'is distinct from '1050000'::jsonb or a#>'{pricing,all_billable_components_covered}'is distinct from 'true'::jsonb
 or 1050000*private.polat_experiment_decimal(a#>>'{pricing,maximum_input_usd_per_million}')/1000000
 +(b->>'maximum_output_tokens')::int*private.polat_experiment_decimal(a#>>'{pricing,maximum_output_usd_per_million}')/1000000>(b->>'maximum_attempt_liability')::numeric
 then raise exception 'CAMPAIGN_ACCOUNT_CONTROL_INVALID'using errcode='22023';end if;
 foreach k in array array['credential_sha256','data_policy_evidence_hash','billing_evidence_hash','canary_reconciliation_hash']loop
  if a->>k is null or a->>k!~'^[a-f0-9]{64}$'then raise exception 'CAMPAIGN_ACCOUNT_CONTROL_INVALID'using errcode='22023';end if;
 end loop;
 if b->>'credential_custody_hash'is distinct from private.fse_hash(private.fse_canonical(jsonb_build_array('POLAT_CAMPAIGN_CREDENTIAL1',b->>'account_scope_hash',a->>'credential_sha256')))
 or not private.fse_keys(s,array['version','mode','tenant_id','campaign_id','repository_sha','bot_id','credential_sha256','representative_user_id','business_connection_id','connection_generation','observed_at','expires_at'])
 or s->'version'is distinct from '1'::jsonb or s->>'mode'is distinct from 'CAMPAIGN_BUSINESS'
 or s->>'tenant_id'is distinct from t::text or s->>'campaign_id'is distinct from p::text or s->>'repository_sha'is distinct from b->>'repository_sha'
 or s->>'bot_id'!~'^[1-9][0-9]{0,15}$'or s->>'representative_user_id'!~'^[1-9][0-9]{0,15}$'
 or s->>'credential_sha256'!~'^[a-f0-9]{64}$'or char_length(s->>'business_connection_id')not between 1 and 160
 or s->>'connection_generation'!~'^[1-9][0-9]{0,18}$'or(s->>'observed_at')::timestamptz>clock_timestamp()
 or(s->>'expires_at')::timestamptz<=clock_timestamp()
 then raise exception 'CAMPAIGN_BOT_CONTROL_INVALID'using errcode='22023';end if;
 if v->>'scope'='CONTROLLED_TEST'and(c.configuration->>'mode'<>'CONTROLLED_TEST'or(b->>'maximum_requests')::int>350 or(b->>'maximum_spend')::numeric>5)
 or v->>'scope'='COMMERCIAL'and c.configuration->>'mode'<>'COMMERCIAL'
 then raise exception 'CAMPAIGN_SCOPE_MISMATCH'using errcode='42501';end if;
 -- One account cannot be pledged to overlapping campaigns/UAT programs.
 perform pg_advisory_xact_lock(hashtextextended('POLAT_ACCOUNT:'||(b->>'account_scope_hash'),0));
 if exists(select 1 from private.campaign_execution_controls z join private.sales_campaigns other on other.tenant_id=z.tenant_id and other.id=z.campaign_id
 where z.binding->>'account_scope_hash'=b->>'account_scope_hash'and(z.tenant_id<>t or z.campaign_id<>p)and(other.state<>'STOPPED'or exists(select 1 from private.campaign_model_attempts m join private.polat_experiment_attempts aa on aa.id=m.attempt_id where m.campaign_id=z.campaign_id and not exists(select 1 from private.polat_experiment_evidence e where e.attempt_id=aa.id and e.stage='RECONCILIATION'))))
 or exists(select 1 from private.private_beta_programs bp where bp.account_control->>'account_scope_hash'=b->>'account_scope_hash')
 then raise exception 'CAMPAIGN_ACCOUNT_ALREADY_RESERVED'using errcode='55000';end if;
 select * into x from private.campaign_execution_controls where tenant_id=t and campaign_id=p for update;
 if x.campaign_id is not null then
  if x.binding_hash<>h or x.scope<>v->>'scope' or x.transport-array['observed_at','expires_at']is distinct from s-array['observed_at','expires_at']then raise exception 'CAMPAIGN_CONTROL_DRIFT'using errcode='40001';end if;
  update private.campaign_execution_controls set account=a,transport=s where tenant_id=t and campaign_id=p;
 else
  insert into private.campaign_execution_controls(tenant_id,campaign_id,run_id,binding,binding_hash,account,transport,scope)
  values(t,p,extensions.gen_random_uuid(),b,h,a,s,v->>'scope')returning * into x;
  insert into private.polat_experiment_runs(id,tenant_id,account_scope_hash,authorization_record_hash,binding,binding_hash)
  values(x.run_id,t,b->>'account_scope_hash',b->>'authorization_record_hash',b,h);
 end if;
 perform private.campaign_audit(t,p,'independent_control_recorded',jsonb_build_object('source_hash',v->>'source_hash','binding_hash',h,'scope',v->>'scope','financial_authority','NONE'));
end;$$;

create function public.campaign_transport_scope_v1(target_tenant_id uuid,campaign_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare x private.campaign_execution_controls;begin
 select * into x from private.campaign_execution_controls where tenant_id=target_tenant_id and campaign_id=campaign_id_value;
 if x.campaign_id is null then raise exception 'CAMPAIGN_TRANSPORT_UNAVAILABLE'using errcode='42501';end if;return x.transport;end;$$;

create function public.campaign_queue_reply_v1(target_tenant_id uuid,campaign_id_value uuid,target_proposal_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p public.agent_proposals;t public.agent_tasks;c public.conversations;x private.campaign_jobs;q public.conversation_quality_evaluations;s public.messages;mid uuid;begin
 perform 1 from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 select * into p from public.agent_proposals where tenant_id=target_tenant_id and id=target_proposal_id;
 select * into t from public.agent_tasks where tenant_id=target_tenant_id and id=p.task_id;
 select * into x from private.campaign_jobs where tenant_id=target_tenant_id and campaign_id=campaign_id_value and agent_task_id=t.id;
 x:=private.campaign_native_source(target_tenant_id,campaign_id_value,x.job_id);
 select * into c from public.conversations where tenant_id=target_tenant_id and id=x.conversation_id for update;
 select * into p from public.agent_proposals where id=p.id for update;
 if p.sent_message_id is not null then return jsonb_build_object('queued',true,'duplicate',true,'message_id',p.sent_message_id);end if;
 select * into q from public.conversation_quality_evaluations where tenant_id=target_tenant_id and run_id=p.run_id;
 select * into s from public.messages where tenant_id=target_tenant_id and id=x.source_message_id;
 if t.task_type<>'campaign.reply'or p.approval_status<>'pending'or p.customer_facing_blocked or q.id is null or q.qa_action<>'approve'or q.customer_facing_blocked
 or coalesce((p.original_payload->>'escalation_recommended')::boolean,true)or jsonb_array_length(coalesce(p.original_payload->'proposed_tool_calls','[]'))<>0
 or not exists(select 1 from private.campaign_model_attempts a join private.polat_experiment_evidence pe on pe.attempt_id=a.attempt_id and pe.stage='PROVIDER_RESULT'and pe.payload->>'status'='SUCCEEDED'and pe.payload->>'qa'='APPROVED'
 where a.tenant_id=target_tenant_id and a.native_run_id=p.run_id and a.revision=x.campaign_revision and a.job_id=x.job_id and not exists(select 1 from private.polat_experiment_evidence bad where bad.attempt_id=a.attempt_id and bad.stage in('RESULT_UNKNOWN','DELAYED_RESULT')))
 or not exists(select 1 from public.conversation_quality_configs cfg where cfg.tenant_id=target_tenant_id and cfg.superseded_at is null and cfg.prompt_version=q.prompt_version and cfg.qa_version=q.qa_version)
 or char_length(p.original_payload->>'proposed_response')not between 1 and 600
 then return jsonb_build_object('queued',false,'duplicate',false);end if;
 insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_chat_id,reply_to_message_id,reply_to_provider_message_id,idempotency_key,actor_type,actor_id,correlation_id,causation_id,occurred_at)
 values(target_tenant_id,c.id,c.customer_id,c.messaging_contact_id,c.provider_connection_id,'outbound','text',p.original_payload->>'proposed_response','pending',s.provider_chat_id,s.id,s.provider_message_id,'campaign-reply-v1:'||x.job_id::text,'SYSTEM','campaign-ai:'||x.campaign_revision,t.correlation_id,t.source_event_id,clock_timestamp())returning id into mid;
 update private.campaign_jobs set body=p.original_payload->>'proposed_response',body_hash=private.fse_hash(p.original_payload->>'proposed_response')where job_id=x.job_id;
 update public.agent_proposals set sent_message_id=mid,approval_status='approved',reviewed_at=clock_timestamp(),review_reason='Founder campaign START; deterministic QA approval, not human review'where id=p.id;
 update public.agent_tasks set status='SUCCEEDED',completed_at=clock_timestamp()where id=t.id;update public.agent_runs set status='SUCCEEDED'where id=p.run_id;
 perform private.campaign_audit(target_tenant_id,campaign_id_value,'reply_queued',jsonb_build_object('message_id',mid,'qa_id',q.id,'human_per_message_review',false));
 return jsonb_build_object('queued',true,'duplicate',false,'message_id',mid);end;$$;

create function public.campaign_claim_reply_v1(target_tenant_id uuid,campaign_id_value uuid,target_message_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare m public.messages;x private.campaign_jobs;s private.campaign_execution_controls;c public.conversations;begin
 perform 1 from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 if exists(select 1 from public.messages where tenant_id=target_tenant_id and id=target_message_id and actor_type='HUMAN')then return private.campaign_claim_human(target_tenant_id,campaign_id_value,target_message_id);end if;
 select z.* into x from private.campaign_jobs z join public.agent_proposals p on p.tenant_id=z.tenant_id and p.task_id=z.agent_task_id and p.sent_message_id=target_message_id where z.tenant_id=target_tenant_id and z.campaign_id=campaign_id_value;
 begin x:=private.campaign_native_source(target_tenant_id,campaign_id_value,x.job_id);exception when sqlstate '42501'then return jsonb_build_object('dispatch',false);end;
 s:=private.campaign_execution_guard(target_tenant_id,campaign_id_value);
 select * into c from public.conversations where tenant_id=target_tenant_id and id=x.conversation_id for update;
 select * into m from public.messages where tenant_id=target_tenant_id and id=target_message_id for update;
 if m.direction<>'outbound'or m.status not in('pending','retry_scheduled')or(m.retry_after_at is not null and m.retry_after_at>clock_timestamp())or(select count(*)from public.message_delivery_attempts where tenant_id=target_tenant_id and message_id=m.id)>=3 or m.actor_id is distinct from 'campaign-ai:'||x.campaign_revision::text
 or m.reply_to_message_id is distinct from x.source_message_id or private.fse_hash(m.content)is distinct from x.body_hash
 or m.provider_chat_id is distinct from(select provider_chat_id from public.messaging_contacts where tenant_id=target_tenant_id and id=c.messaging_contact_id)
 or m.provider_connection_id is distinct from c.provider_connection_id
 or not exists(select 1 from public.messaging_provider_connections where tenant_id=target_tenant_id and id=c.provider_connection_id and provider_account_ref=s.transport->>'bot_id'and status='active')
 or exists(select 1 from public.messages other where other.tenant_id=target_tenant_id and other.conversation_id=c.id and other.id<>m.id and other.direction='outbound'and(other.status='sending'or other.failure_code='TELEGRAM_DELIVERY_UNCERTAIN'))
 then return jsonb_build_object('dispatch',false);end if;
 update public.messages set status='sending'where id=m.id;
 return jsonb_build_object('dispatch',true,'message_id',m.id,'campaign_id',campaign_id_value,'bot_id',s.transport->>'bot_id','chat_id',m.provider_chat_id,'body',m.content,
 'reply_to_provider_message_id',m.reply_to_provider_message_id,'business_connection_id',s.transport->>'business_connection_id','business_generation',s.transport->>'connection_generation');end;$$;

create function private.campaign_delivery_record()returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare x private.campaign_jobs;c private.sales_campaigns;human_campaign uuid;begin
 if new.direction<>'outbound'or new.status=old.status or new.status not in('sent','failed','blocked','retry_scheduled')then return new;end if;
 if new.actor_type='HUMAN'and new.idempotency_key like 'campaign-human:%'then
  select entity_id::uuid into human_campaign from public.audit_logs where tenant_id=new.tenant_id and action='campaign.manual_reply_queued'and after_data->>'message_id'=new.id::text limit 1;
  if human_campaign is not null then
   if new.failure_code='TELEGRAM_DELIVERY_UNCERTAIN'then
    update private.sales_campaigns set state='PAUSED',revision=revision+1 where tenant_id=new.tenant_id and id=human_campaign and state='ACTIVE';
    update public.conversations set attention_required=true where tenant_id=new.tenant_id and id=new.conversation_id;
   end if;
   perform private.campaign_audit(new.tenant_id,human_campaign,'manual_delivery_outcome',jsonb_build_object('message_id',new.id,'status',new.status,'provider_ack',new.status='sent','customer_read','UNKNOWN'));
  end if;return new;
 end if;
 if new.actor_id not like 'campaign-ai:%'then return new;end if;
 select z.* into x from private.campaign_jobs z join public.agent_proposals p on p.tenant_id=z.tenant_id and p.task_id=z.agent_task_id and p.sent_message_id=new.id where z.tenant_id=new.tenant_id;
 if x.job_id is null then return new;end if;
 if new.status='retry_scheduled'and new.failure_code='TELEGRAM_RATE_LIMITED'then
  perform private.campaign_audit(new.tenant_id,x.campaign_id,'telegram_rate_limited',jsonb_build_object('message_id',new.id,'acknowledged',false,'retry_after',new.retry_after_at));return new;
 end if;
 select * into c from private.sales_campaigns where tenant_id=new.tenant_id and id=x.campaign_id;
 update public.scheduled_jobs set status=case when new.status='sent'then 'completed'else 'dead_letter'end,completed_at=case when new.status='sent'then clock_timestamp()end,
 dead_lettered_at=case when new.status<>'sent'then clock_timestamp()end,last_error_code=case when new.status='sent'and(c.state<>'ACTIVE'or c.revision<>x.campaign_revision)then 'ACK_AFTER_FENCE'when new.status<>'sent'then coalesce(new.failure_code,'CAMPAIGN_NOT_SENT')end where id=x.job_id;
 update private.campaign_jobs set outcome=jsonb_build_object('origin','TELEGRAM_API','message_id',new.id,'provider_message_id',new.provider_message_id,'status',new.status,'subscriber_read','UNKNOWN')where job_id=x.job_id and outcome is null;
 if new.failure_code='TELEGRAM_DELIVERY_UNCERTAIN'then
  update private.sales_campaigns set state='PAUSED',revision=revision+1 where tenant_id=new.tenant_id and id=x.campaign_id and state='ACTIVE';
  update public.conversations set attention_required=true where tenant_id=new.tenant_id and id=new.conversation_id;
 end if;
 perform private.campaign_audit(new.tenant_id,x.campaign_id,'telegram_outcome',jsonb_build_object('message_id',new.id,'status',new.status,'provider_ack',new.status='sent','customer_read','UNKNOWN','generation_changed',c.revision<>x.campaign_revision));return new;end;$$;
create trigger campaign_delivery_evidence after update of status on public.messages for each row execute function private.campaign_delivery_record();

create function public.campaign_reply_target_v1(target_tenant_id uuid,campaign_id_value uuid,target_message_id uuid)returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('chat_id',m.provider_chat_id)from public.messages m join public.conversations cv on cv.tenant_id=m.tenant_id and cv.id=m.conversation_id
 join private.campaign_audience a on a.tenant_id=cv.tenant_id and a.customer_id=cv.customer_id
 where m.tenant_id=target_tenant_id and m.id=target_message_id and a.campaign_id=campaign_id_value and m.direction='outbound'and m.status in('pending','retry_scheduled')
 and(m.idempotency_key like 'campaign-human:%'or m.actor_id like 'campaign-ai:%');$$;

create function public.campaign_transport_hold_v1(target_tenant_id uuid,campaign_id_value uuid,reason_value text)returns void language plpgsql security definer set search_path=pg_catalog as $$begin
 if reason_value not in('PERMISSION_READ_UNVERIFIED','CONNECTION_DISABLED','CALLBACK_CONFLICT')then raise exception 'CAMPAIGN_HOLD_INVALID'using errcode='22023';end if;
 update private.sales_campaigns set state='PAUSED',revision=revision+1 where tenant_id=target_tenant_id and id=campaign_id_value and state='ACTIVE';
 perform private.campaign_audit(target_tenant_id,campaign_id_value,'transport_held',jsonb_build_object('reason',reason_value,'automatic_resume',false));end;$$;

create function public.campaign_recovery_targets_v1(tenant_id_value uuid default null,conversation_id_value uuid default null)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$declare result jsonb;begin
 if (tenant_id_value is null)is distinct from(conversation_id_value is null)then raise exception 'CAMPAIGN_SCOPE_INVALID'using errcode='22023';end if;
 select coalesce(jsonb_agg(z),'[]')into result from(
 select c.tenant_id,cv.id conversation_id,c.id campaign_id from private.sales_campaigns c
 join private.campaign_execution_controls control on control.tenant_id=c.tenant_id and control.campaign_id=c.id
 join private.campaign_audience a on a.tenant_id=c.tenant_id and a.campaign_id=c.id
 join public.conversations cv on cv.tenant_id=a.tenant_id and cv.customer_id=a.customer_id
 where c.state='ACTIVE'and(control.account->>'expires_at')::timestamptz>clock_timestamp()
 and(tenant_id_value is null or cv.tenant_id=tenant_id_value and cv.id=conversation_id_value)
 order by(select max(q.locked_at)from private.campaign_jobs x join public.scheduled_jobs q on q.id=x.job_id where x.tenant_id=c.tenant_id and x.campaign_id=c.id and x.conversation_id=cv.id)nulls first,cv.id,c.id limit 3)z;return result;end;$$;

create function public.campaign_recover_delivery_v1(target_tenant_id uuid,campaign_id_value uuid,target_conversation_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare mid uuid;m public.messages;begin
 perform 1 from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 for m in select msg.* from public.messages msg join public.agent_proposals p on p.tenant_id=msg.tenant_id and p.sent_message_id=msg.id join private.campaign_jobs x on x.tenant_id=p.tenant_id and x.agent_task_id=p.task_id
 where msg.tenant_id=target_tenant_id and msg.conversation_id=target_conversation_id and x.campaign_id=campaign_id_value and msg.status='sending'and msg.updated_at<clock_timestamp()-interval '30 seconds'for update of msg loop
  perform public.record_outbound_message_result(target_tenant_id,m.id,'failed',null,0,'TELEGRAM_DELIVERY_UNCERTAIN',null);
 end loop;
 -- Only an explicit 429 is known not sent. Refresh that delivery lease, never a model attempt.
 update public.scheduled_jobs job set locked_at=clock_timestamp()from private.campaign_jobs x join public.agent_proposals p on p.tenant_id=x.tenant_id and p.task_id=x.agent_task_id
 join public.messages msg on msg.tenant_id=p.tenant_id and msg.id=p.sent_message_id
 where job.id=x.job_id and x.tenant_id=target_tenant_id and x.campaign_id=campaign_id_value and x.conversation_id=target_conversation_id
 and msg.status='retry_scheduled'and msg.failure_code='TELEGRAM_RATE_LIMITED'and msg.retry_after_at<=clock_timestamp();
 update public.messages msg set status='blocked',failure_code='CAMPAIGN_RETRY_FENCED'from private.campaign_jobs x join public.agent_proposals p on p.tenant_id=x.tenant_id and p.task_id=x.agent_task_id
 join private.sales_campaigns c on c.tenant_id=x.tenant_id and c.id=x.campaign_id
 where msg.tenant_id=target_tenant_id and msg.id=p.sent_message_id and x.campaign_id=campaign_id_value and x.conversation_id=target_conversation_id and msg.status='retry_scheduled'
 and((select count(*)from public.message_delivery_attempts where tenant_id=target_tenant_id and message_id=msg.id)>=3 or c.state<>'ACTIVE'or c.revision<>x.campaign_revision or private.campaign_contact_reason(target_tenant_id,c.id,x.customer_id,x.job_id)is not null);
 select msg.id into mid from public.messages msg join public.agent_proposals p on p.tenant_id=msg.tenant_id and p.sent_message_id=msg.id join private.campaign_jobs x on x.tenant_id=p.tenant_id and x.agent_task_id=p.task_id
 where msg.tenant_id=target_tenant_id and msg.conversation_id=target_conversation_id and x.campaign_id=campaign_id_value and(msg.status='pending'or msg.status='retry_scheduled'and msg.failure_code='TELEGRAM_RATE_LIMITED'and msg.retry_after_at<=clock_timestamp())order by msg.created_at,msg.id limit 1;
 return jsonb_build_object('message_id',mid);end;$$;

-- Authenticated ingress reuses the native idempotency table and append-only audit.
-- Unknown usernames, bot echoes and positive callbacks cannot create permissions.
create function public.campaign_ingest_business_v1(target_tenant_id uuid,campaign_id_value uuid,event_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare control private.campaign_execution_controls;v jsonb;cid uuid;cv public.conversations;pc uuid;key_value text;old jsonb;result_value jsonb;kind text;begin
 select * into control from private.campaign_execution_controls where tenant_id=target_tenant_id and campaign_id=campaign_id_value;
 perform 1 from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 v:=private.fse_strict_json(event_value);kind:=v->>'kind';
 if control.campaign_id is null or octet_length(event_value)>20000
 or not private.fse_keys(v,array['kind','update_id','connection_id','source_hash','occurred_at','user_id','chat_id','message_id','text','reply_to_id'])
 or kind not in('INBOUND','HUMAN_REPLY','EDIT','DELETE','CONNECTION_DISABLED','CONNECTION_OBSERVED','BOT_ECHO')
 or v->>'connection_id'is distinct from control.transport->>'business_connection_id'
 or v->>'update_id'!~'^[0-9]{1,18}$'or v->>'source_hash'!~'^[a-f0-9]{64}$'
 or(v->>'occurred_at')::timestamptz>clock_timestamp()+interval '5 minutes'
 then raise exception 'CAMPAIGN_INGRESS_DENIED'using errcode='42501';end if;
 select id into pc from public.messaging_provider_connections where tenant_id=target_tenant_id and provider_account_ref=control.transport->>'bot_id'and status='active';
 if pc is null then raise exception 'CAMPAIGN_BOT_BINDING_UNAVAILABLE'using errcode='42501';end if;
 key_value:=private.fse_hash(private.fse_canonical(jsonb_build_array('CAMPAIGN_BUSINESS1',v->>'connection_id',v->>'update_id',v->>'message_id')));
 select after_data into old from public.audit_logs where tenant_id=target_tenant_id and action='campaign.business_event'and entity_id=key_value limit 1;
 if old is not null then
  if old->>'source_hash'is distinct from v->>'source_hash'then perform public.campaign_transport_hold_v1(target_tenant_id,campaign_id_value,'CALLBACK_CONFLICT');return jsonb_build_object('accepted',false,'duplicate',true);end if;
  return coalesce(old->'result','{}')||jsonb_build_object('duplicate',true);
 end if;
 if kind in('CONNECTION_DISABLED','CONNECTION_OBSERVED')then
  if v->>'user_id'is distinct from control.transport->>'representative_user_id'then raise exception 'CAMPAIGN_REPRESENTATIVE_MISMATCH'using errcode='42501';end if;
  if kind='CONNECTION_DISABLED'then perform public.campaign_transport_hold_v1(target_tenant_id,campaign_id_value,'CONNECTION_DISABLED');end if;
  result_value:=jsonb_build_object('accepted',false,'duplicate',false);
 elsif kind='BOT_ECHO'then result_value:=jsonb_build_object('accepted',false,'duplicate',false);
 else
  if v->>'chat_id'!~'^[1-9][0-9]{0,15}$'or v->>'message_id'!~'^[1-9][0-9]{0,15}$'then raise exception 'CAMPAIGN_CHAT_INVALID'using errcode='22023';end if;
  select a.customer_id into cid from private.campaign_audience a join public.customer_identities i on i.tenant_id=a.tenant_id and i.customer_id=a.customer_id
  where a.tenant_id=target_tenant_id and a.campaign_id=campaign_id_value and i.identity_type='telegram_user_id'and i.normalized_value=v->>'chat_id';
  if cid is null then return jsonb_build_object('accepted',false,'duplicate',false);end if;
  select * into cv from public.conversations where tenant_id=target_tenant_id and customer_id=cid and provider_connection_id=pc and provider_conversation_id=v->>'chat_id'for update;
  if kind='INBOUND'then
   if v->>'user_id'is distinct from v->>'chat_id'or char_length(v->>'text')not between 1 and 4096 then raise exception 'CAMPAIGN_INBOUND_INVALID'using errcode='22023';end if;
   result_value:=public.ingest_telegram_message(target_tenant_id,'business:'||private.fse_hash(v->>'connection_id')||':'||(v->>'update_id'),v->>'message_id',v->>'chat_id',v->>'user_id',null,null,null,v->>'text',v->>'reply_to_id',(v->>'occurred_at')::timestamptz);
   -- Provider receipt time cannot renew a reply window for an old/replayed message.
   update public.messaging_contacts set last_inbound_at=(select max(m.occurred_at)from public.messages m where m.tenant_id=target_tenant_id and m.messaging_contact_id=public.messaging_contacts.id and m.direction='inbound')where tenant_id=target_tenant_id and provider_connection_id=pc and provider_chat_id=v->>'chat_id';
   result_value:=result_value||jsonb_build_object('accepted',true);
  else
   if kind='HUMAN_REPLY'and v->>'user_id'is distinct from control.transport->>'representative_user_id'then raise exception 'CAMPAIGN_REPRESENTATIVE_MISMATCH'using errcode='42501';end if;
   if cv.id is not null then
    update public.conversations set human_takeover=true,runtime_mode='HUMAN_TAKEOVER',automatic_replies_enabled=false,attention_required=true where tenant_id=target_tenant_id and id=cv.id;
    update public.messages set status='blocked',failure_code='CAMPAIGN_BUSINESS_SOURCE_OR_OWNERSHIP_CHANGED'where tenant_id=target_tenant_id and conversation_id=cv.id and actor_id like 'campaign-ai:%'and status='pending';
    update public.agent_tasks set status='CANCELLED',cancellation_reason='CAMPAIGN_BUSINESS_SOURCE_OR_OWNERSHIP_CHANGED',completed_at=clock_timestamp()where tenant_id=target_tenant_id and conversation_id=cv.id and task_type='campaign.reply'and status='QUEUED';
   end if;
   result_value:=jsonb_build_object('accepted',false,'duplicate',false);
  end if;
 end if;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(target_tenant_id,'SYSTEM','campaign.business_event','campaign_business_transport',key_value,
 jsonb_build_object('campaign_id',campaign_id_value,'kind',kind,'source_hash',v->>'source_hash','body_in_audit',false,'result',result_value));
 return result_value;end;$$;

create function public.campaign_hold_source_v1(target_tenant_id uuid,campaign_id_value uuid,target_conversation_id uuid,target_event_id uuid,reason_value text)returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare x private.campaign_jobs;begin
 if reason_value not in('MODEL_UNAVAILABLE','QA_HELD','DELIVERY_UNKNOWN','SOURCE_CHANGED')then raise exception 'CAMPAIGN_HOLD_INVALID'using errcode='22023';end if;
 select z.* into x from private.campaign_jobs z join public.agent_tasks q on q.id=z.agent_task_id where z.tenant_id=target_tenant_id and z.campaign_id=campaign_id_value and z.conversation_id=target_conversation_id and q.source_event_id=target_event_id order by q.created_at desc limit 1;
 if x.job_id is null then return false;end if;
 update public.scheduled_jobs set status='dead_letter',dead_lettered_at=clock_timestamp(),last_error_code=reason_value where id=x.job_id and status='processing';
 update public.conversations set attention_required=true where tenant_id=target_tenant_id and id=x.conversation_id;
 perform private.escalation_open(target_tenant_id,x.source_message_id,'general_review','HIGH','en','quality',target_event_id);
 perform private.campaign_audit(target_tenant_id,campaign_id_value,'review_obligation',jsonb_build_object('job_id',x.job_id,'reason',reason_value,'force_send',false));return true;end;$$;

create function private.campaign_native_source(t uuid,p uuid,j uuid)returns private.campaign_jobs language plpgsql stable set search_path=pg_catalog as $$
declare x private.campaign_jobs;c private.sales_campaigns;cv public.conversations;q public.scheduled_jobs;begin
 perform private.campaign_execution_guard(t,p);
 select * into x from private.campaign_jobs where tenant_id=t and campaign_id=p and job_id=j;
 select * into c from private.sales_campaigns where tenant_id=t and id=p;
 select * into cv from public.conversations where tenant_id=t and id=x.conversation_id;
 select * into q from public.scheduled_jobs where id=j;
 if x.job_id is null or x.campaign_revision<>c.revision or q.status<>'processing'or q.locked_at<clock_timestamp()-interval '120 seconds'
 or private.campaign_contact_reason(t,p,x.customer_id,j)is not null or not cv.automatic_replies_enabled
 or not exists(select 1 from public.messages where tenant_id=t and conversation_id=cv.id and id=x.source_message_id and direction='inbound'and private.fse_hash(content)=x.source_hash)
 or x.source_message_id is distinct from(select id from public.messages where tenant_id=t and conversation_id=cv.id and direction='inbound'order by created_at desc,id desc limit 1)
 or cv.escalation_return_boundary is not null and exists(select 1 from public.messages where id=x.source_message_id and created_at<cv.escalation_return_boundary)
 then raise exception 'CAMPAIGN_SOURCE_OR_OWNERSHIP_CHANGED'using errcode='42501';end if;
 return x;end;$$;

create function public.campaign_source_scope_v1(target_tenant_id uuid,target_conversation_id uuid,target_event_id uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare x private.campaign_jobs;m public.messages;c private.sales_campaigns;begin
 select z.* into x from private.campaign_jobs z join public.agent_tasks a on a.id=z.agent_task_id
 where z.tenant_id=target_tenant_id and z.conversation_id=target_conversation_id and a.source_event_id=target_event_id and a.status='RUNNING';
 x:=private.campaign_native_source(target_tenant_id,x.campaign_id,x.job_id);
 select * into strict m from public.messages where tenant_id=target_tenant_id and id=x.source_message_id;
 select * into strict c from private.sales_campaigns where tenant_id=target_tenant_id and id=x.campaign_id;
 return jsonb_build_object('tenant_id',x.tenant_id,'campaign_id',x.campaign_id,'job_id',x.job_id,'conversation_id',x.conversation_id,'source_message_id',m.id,
 'revision',x.campaign_revision,'boundary',m.created_at,'plan_version_id',c.configuration->>'plan_version_id','follow_up',exists(select 1 from private.campaign_jobs prior join public.scheduled_jobs q on q.id=prior.job_id where prior.tenant_id=x.tenant_id and prior.campaign_id=x.campaign_id and prior.source_message_id=x.source_message_id and prior.job_id<>x.job_id and q.status='completed'));
end;$$;

create function public.campaign_reserve_model_v1(target_tenant_id uuid,campaign_id_value uuid,job_id_value uuid,native_run_id_value uuid,request_hash_value text,body_hash_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.sales_campaigns;control private.campaign_execution_controls;x private.campaign_jobs;r private.polat_experiment_runs;a private.polat_experiment_attempts;s private.campaign_model_attempts;liability numeric;replayed boolean:=false;begin
 select * into c from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 control:=private.campaign_execution_guard(target_tenant_id,c.id);x:=private.campaign_native_source(target_tenant_id,c.id,job_id_value);
 if request_hash_value is null or request_hash_value!~'^[a-f0-9]{64}$'or body_hash_value is null or body_hash_value!~'^[a-f0-9]{64}$'
 or not exists(select 1 from public.agent_runs nr join public.agent_tasks nt on nt.tenant_id=nr.tenant_id and nt.id=nr.task_id
 where nr.tenant_id=target_tenant_id and nr.id=native_run_id_value and nt.id=x.agent_task_id and nt.status='RUNNING'
 and nr.context_manifest->>'campaign_id'=c.id::text and nr.context_manifest->>'campaign_job_id'=x.job_id::text and nr.context_manifest->>'campaign_profile'='polat-campaign-v1'
 and nr.model_provider='openai'and nr.model_name='gpt-6.1-sol')then raise exception 'CAMPAIGN_NATIVE_RUN_REQUIRED'using errcode='42501';end if;
 select * into r from private.polat_experiment_runs where id=control.run_id for update;
 select * into s from private.campaign_model_attempts where tenant_id=target_tenant_id and job_id=job_id_value;
 if s.attempt_id is not null then
  replayed:=true;select * into a from private.polat_experiment_attempts where id=s.attempt_id;
  if s.native_run_id<>native_run_id_value or a.request_hash<>request_hash_value or a.body_hash<>body_hash_value then raise exception 'CAMPAIGN_MODEL_DRIFT'using errcode='40001';end if;
 else
  if r.stop_reason is not null or r.request_count>=(r.binding->>'maximum_requests')::int then raise exception 'CAMPAIGN_MODEL_STOPPED'using errcode='55000';end if;
  -- A reserved or begun unresolved attempt is never reclaimed after restart.
  if exists(select 1 from private.polat_experiment_attempts aa where aa.run_id=r.id and not exists(select 1 from private.polat_experiment_evidence ee where ee.attempt_id=aa.id and ee.stage='PROVIDER_RESULT'and(ee.payload->>'status'='FAILED'or ee.payload->>'status'='SUCCEEDED'and ee.payload->>'input_tokens'is not null and ee.payload->>'output_tokens'is not null)))then raise exception 'CAMPAIGN_BILLING_UNRECONCILED'using errcode='55000';end if;
  liability:=(r.binding->>'maximum_attempt_liability')::numeric;
  if r.reserved_liability+liability>(r.binding->>'maximum_spend')::numeric then raise exception 'CAMPAIGN_MODEL_BUDGET'using errcode='54000';end if;
  insert into private.polat_experiment_attempts(id,tenant_id,run_id,ordinal,target_hash,request_hash,body_hash,liability)
  values(extensions.gen_random_uuid(),target_tenant_id,r.id,r.request_count+1,private.fse_hash(job_id_value::text),request_hash_value,body_hash_value,liability)returning * into a;
  insert into private.campaign_model_attempts(tenant_id,campaign_id,job_id,attempt_id,native_run_id,revision)values(target_tenant_id,c.id,job_id_value,a.id,native_run_id_value,c.revision)returning * into s;
  update private.polat_experiment_runs set request_count=request_count+1,reserved_liability=reserved_liability+liability where id=r.id;
 end if;
 return jsonb_build_object('version',1,'mode','FOUNDER_CAMPAIGN','tenant_id',target_tenant_id,'campaign_id',c.id,'job_id',x.job_id,'run_id',r.id,'native_run_id',s.native_run_id,
 'attempt_id',s.attempt_id,'binding_hash',r.binding_hash,'request_hash',a.request_hash,'body_hash',a.body_hash,'liability',trim_scale(a.liability)::text,
 'replay',replayed,'dispatch_started',s.started_at is not null);
end;$$;

create function public.campaign_begin_model_v1(target_tenant_id uuid,campaign_id_value uuid,attempt_id_value uuid,dispatch_nonce_value uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s private.campaign_model_attempts;r private.polat_experiment_runs;a private.polat_experiment_attempts;x private.campaign_jobs;begin
 perform 1 from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 select * into s from private.campaign_model_attempts where tenant_id=target_tenant_id and campaign_id=campaign_id_value and attempt_id=attempt_id_value for update;
 if s.attempt_id is null or dispatch_nonce_value is null then raise exception 'CAMPAIGN_ATTEMPT_UNAVAILABLE'using errcode='42501';end if;
 if s.started_at is not null then return jsonb_build_object('dispatch',false);end if;
 x:=private.campaign_native_source(target_tenant_id,campaign_id_value,s.job_id);
 select * into strict a from private.polat_experiment_attempts where id=s.attempt_id;
 select * into strict r from private.polat_experiment_runs where id=a.run_id for update;
 if r.stop_reason is not null then raise exception 'CAMPAIGN_MODEL_STOPPED'using errcode='55000';end if;
 update private.campaign_model_attempts set dispatch_nonce=dispatch_nonce_value,started_at=clock_timestamp(),deadline=least(clock_timestamp()+interval '10 seconds',(r.binding->>'expires_at')::timestamptz)where attempt_id=s.attempt_id returning * into s;
 perform private.polat_experiment_append(r,a,extensions.gen_random_uuid(),'DISPATCH_STARTED',jsonb_build_object('status','STARTED','request_hash',a.request_hash,'body_hash',a.body_hash,'retry','NONE'),private.fse_hash(dispatch_nonce_value::text),s.deadline);
 return jsonb_build_object('dispatch',true);end;$$;

create function public.campaign_committed_attempt_v1(target_tenant_id uuid,campaign_id_value uuid,attempt_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare s private.campaign_model_attempts;r private.polat_experiment_runs;a private.polat_experiment_attempts;x private.campaign_jobs;begin
 select * into s from private.campaign_model_attempts where tenant_id=target_tenant_id and campaign_id=campaign_id_value and attempt_id=attempt_id_value;
 x:=private.campaign_native_source(target_tenant_id,campaign_id_value,s.job_id);
 select * into strict a from private.polat_experiment_attempts where id=s.attempt_id;select * into strict r from private.polat_experiment_runs where id=a.run_id;
 if s.started_at is null or s.deadline<=clock_timestamp()or r.stop_reason is not null then raise exception 'CAMPAIGN_COMMITTED_ATTEMPT_UNAVAILABLE'using errcode='42501';end if;
 return jsonb_build_object('mode','FOUNDER_CAMPAIGN','tenant_id',target_tenant_id,'campaign_id',campaign_id_value,'run_id',r.id,'native_run_id',s.native_run_id,
 'attempt_id',s.attempt_id,'job_id',s.job_id,'conversation_id',x.conversation_id,'source_message_id',x.source_message_id,'revision',s.revision,
 'binding_hash',r.binding_hash,'request_hash',a.request_hash,'body_hash',a.body_hash,'dispatch_nonce',s.dispatch_nonce,'ordinal',a.ordinal,'reserved_liability',trim_scale(r.reserved_liability)::text,'issued_at',s.started_at,'expires_at',s.deadline);end;$$;

-- Outcome evidence remains recordable after STOP, timeout, permission loss or takeover.
create function public.campaign_record_model_v1(target_tenant_id uuid,campaign_id_value uuid,attempt_id_value uuid,dispatch_nonce_value uuid,raw_outcome_value text)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s private.campaign_model_attempts;r private.polat_experiment_runs;a private.polat_experiment_attempts;p jsonb;old private.polat_experiment_evidence;k text;kind text;begin
 perform 1 from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 select * into s from private.campaign_model_attempts where tenant_id=target_tenant_id and campaign_id=campaign_id_value and attempt_id=attempt_id_value for update;
 if s.attempt_id is null or s.dispatch_nonce is distinct from dispatch_nonce_value or s.started_at is null then raise exception 'CAMPAIGN_OWNED_ATTEMPT_REQUIRED'using errcode='42501';end if;
 p:=private.fse_strict_json(raw_outcome_value);
 if octet_length(raw_outcome_value)>8192 or not private.fse_keys(p,array['version','stage','status','response_hash','response_identity_hash','elapsed_ms','input_tokens','output_tokens','qa','actual_billed_amount','actual_billed_currency','financial_authority','error_code','provider_usage_hash'])
 or not private.fse_strings(p,array['stage','status','qa','financial_authority'],array['response_hash','response_identity_hash','elapsed_ms','error_code','provider_usage_hash'])
 or p->'version'is distinct from '1'::jsonb or p->>'stage'not in('PROVIDER_RESULT','RESULT_UNKNOWN')or p->>'status'not in('SUCCEEDED','FAILED','UNKNOWN')or p->>'qa'not in('APPROVED','HELD','NOT_EVALUATED')
 or p->>'financial_authority'is distinct from 'NONE'or p->'actual_billed_amount'is distinct from 'null'::jsonb or p->'actual_billed_currency'is distinct from 'null'::jsonb
 then raise exception 'CAMPAIGN_OUTCOME_INVALID'using errcode='22023';end if;
 foreach k in array array['response_hash','response_identity_hash','provider_usage_hash']loop
  if p->>k is not null and p->>k!~'^[a-f0-9]{64}$'then raise exception 'CAMPAIGN_OUTCOME_INVALID'using errcode='22023';end if;
 end loop;
 foreach k in array array['input_tokens','output_tokens']loop
  if p->k is distinct from 'null'::jsonb and(jsonb_typeof(p->k)<>'number'or p->>k!~'^(0|[1-9][0-9]{0,8})$')then raise exception 'CAMPAIGN_OUTCOME_INVALID'using errcode='22023';end if;
 end loop;
 if p->>'elapsed_ms'is not null and p->>'elapsed_ms'!~'^(0|[1-9][0-9]{0,7})(\.[0-9]{1,8})?$'or p->>'error_code'is not null and p->>'error_code'!~'^[A-Z0-9_]{1,120}$'
 or(p->>'status'='SUCCEEDED'and(p->>'response_hash'is null or p->>'response_identity_hash'is null or p->>'input_tokens'is null or p->>'output_tokens'is null)and p->>'error_code'is distinct from 'CAMPAIGN_USAGE_UNAVAILABLE')
 then raise exception 'CAMPAIGN_OUTCOME_INVALID'using errcode='22023';end if;
 select * into strict a from private.polat_experiment_attempts where id=s.attempt_id;select * into strict r from private.polat_experiment_runs where id=a.run_id for update;
 select * into old from private.polat_experiment_evidence where attempt_id=a.id and stage in('PROVIDER_RESULT','RESULT_UNKNOWN')order by sequence limit 1;
 if exists(select 1 from private.polat_experiment_evidence where attempt_id=a.id and stage in('PROVIDER_RESULT','RESULT_UNKNOWN','DELAYED_RESULT')and payload=p)then return jsonb_build_object('recorded',true);end if;
 if old.id is not null and old.stage='PROVIDER_RESULT'then raise exception 'CAMPAIGN_RESULT_CONFLICT'using errcode='40001';end if;
 kind:=case when old.id is not null or s.deadline<clock_timestamp()then 'DELAYED_RESULT'else p->>'stage'end;
 perform private.polat_experiment_append(r,a,extensions.gen_random_uuid(),kind,p,private.fse_hash(dispatch_nonce_value::text),s.deadline);
 if kind in('RESULT_UNKNOWN','DELAYED_RESULT')or p->>'error_code'='CAMPAIGN_USAGE_UNAVAILABLE'then
  update private.polat_experiment_runs set stop_reason=coalesce(stop_reason,'PROVIDER_OR_UNKNOWN_HOLD')where id=r.id;
 end if;
 if kind in('RESULT_UNKNOWN','DELAYED_RESULT')or p->>'status'<>'SUCCEEDED'or p->>'error_code'='CAMPAIGN_USAGE_UNAVAILABLE'then
  update private.sales_campaigns set state='PAUSED',revision=revision+1 where tenant_id=target_tenant_id and id=campaign_id_value and state='ACTIVE';
 end if;
 -- A complete QA rejection is a visible human case for that source, not another
 -- paid generation or a fabricated delivery. Other eligible sources retain their quota.
 return jsonb_build_object('recorded',true);end;$$;

create function private.campaign_reconcile_model(t uuid,p uuid,attempt_value uuid,raw_value text)returns void language plpgsql set search_path=pg_catalog as $$
declare s private.campaign_model_attempts;r private.polat_experiment_runs;a private.polat_experiment_attempts;v jsonb;old jsonb;amount numeric;begin
 if current_user<>'postgres'then raise exception 'CAMPAIGN_BILLING_UNAVAILABLE'using errcode='42501';end if;
 perform 1 from private.sales_campaigns where tenant_id=t and id=p for update;
 select * into s from private.campaign_model_attempts where tenant_id=t and campaign_id=p and attempt_id=attempt_value;
 if s.attempt_id is null or s.started_at is null then raise exception 'CAMPAIGN_BILLING_UNAVAILABLE'using errcode='42501';end if;
 select * into strict a from private.polat_experiment_attempts where id=attempt_value;select * into strict r from private.polat_experiment_runs where id=a.run_id for update;
 v:=private.fse_strict_json(raw_value);
 if not private.fse_keys(v,array['origin','coverage','account_scope_hash','request_hash','actual_billed_amount','currency','source_hash','observed_at'])
 or v->>'origin'is distinct from 'INDEPENDENT_PROVIDER_BILLING'or v->>'coverage'is distinct from 'COMPLETE_REQUEST_CHARGE'or v->>'account_scope_hash'is distinct from r.account_scope_hash
 or v->>'request_hash'is distinct from a.request_hash or v->>'currency'is distinct from 'USD'or v->>'source_hash'!~'^[a-f0-9]{64}$'
 or(v->>'observed_at')::timestamptz>clock_timestamp()then raise exception 'CAMPAIGN_BILLING_INVALID'using errcode='22023';end if;
 amount:=private.polat_experiment_decimal(v->>'actual_billed_amount');
 select payload into old from private.polat_experiment_evidence where attempt_id=a.id and stage='RECONCILIATION'limit 1;
 if old is not null then if old->'source'is distinct from v then raise exception 'CAMPAIGN_BILLING_CONFLICT'using errcode='40001';end if;return;end if;
 perform private.polat_experiment_append(r,a,extensions.gen_random_uuid(),'RECONCILIATION',jsonb_build_object('status','ACTUAL_RECONCILED','origin','INDEPENDENT_PROVIDER_BILLING','actual_billed_amount',trim_scale(amount)::text,'currency','USD','source',v,'financial_authority','NONE'));
 if amount>a.liability then
  update private.polat_experiment_runs set stop_reason=coalesce(stop_reason,'BILLING_LIABILITY_BREACH')where id=r.id;
  update private.sales_campaigns set state='STOPPED',revision=revision+1 where tenant_id=t and id=p and state<>'STOPPED';
 end if;end;$$;

do $$declare r record;begin
 for r in select oid::regprocedure signature from pg_proc where pronamespace='private'::regnamespace and proname in('campaign_control_guard','campaign_execution_guard','campaign_control_record','campaign_native_source','campaign_reconcile_model')loop execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);end loop;
 for r in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in('campaign_execution_control_v1','campaign_source_scope_v1','campaign_reserve_model_v1','campaign_begin_model_v1','campaign_committed_attempt_v1','campaign_record_model_v1')loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;
end;$$;

-- Versioned extensions retain OFFLINE_SYNTHETIC and PRIVATE_BETA_UAT limits.
alter table private.polat_experiment_runs drop constraint polat_experiment_versioned_authority;
alter table private.polat_experiment_runs add constraint polat_experiment_versioned_authority check(
 (binding->>'mode'='OFFLINE_SYNTHETIC'and binding->>'financial_authority'='NONE'and binding->'execution_enabled'='false'::jsonb and binding->'authorized_external_requests'='0'::jsonb)
 or(binding->>'mode'='PRIVATE_BETA_UAT'and binding->>'financial_authority'='NONE'and binding->'commercial_sales'='false'::jsonb
 and((binding->'version'='1'::jsonb and binding->>'provider'='anthropic'and binding->>'model'='claude-haiku-5-5'and binding->>'model_version'='claude-haiku-5-5'and binding->>'protocol_version'='2023-06-01')
 or(binding->'version'='2'::jsonb and binding->>'provider'='openai'and binding->>'model'='gpt-6.1-sol'and binding->>'model_version'='gpt-6.1-sol'and binding->>'protocol_version'='responses-v1'))
 and binding->>'currency'='USD'and(binding->>'maximum_spend')::numeric<=5)
 or(binding->>'mode'='FOUNDER_CAMPAIGN'and binding->'version'='3'::jsonb and binding->>'provider'='openai'and binding->>'model'='gpt-6.1-sol'and binding->>'financial_authority'='NONE'and binding->>'currency'='USD'));
alter table private.polat_experiment_runs drop constraint polat_experiment_versioned_limits;
alter table private.polat_experiment_runs add constraint polat_experiment_versioned_limits check(
 request_count between 0 and case when binding->>'mode'='FOUNDER_CAMPAIGN'then 1000000 when binding->>'mode'='PRIVATE_BETA_UAT'then 350 else 290 end
 and request_count<=(binding->>'maximum_requests')::int and reserved_liability>=0 and reserved_liability<=(case when binding->>'mode'='PRIVATE_BETA_UAT'then (binding->>'maximum_attempt_liability')::numeric*(binding->>'maximum_requests')::numeric else (binding->>'maximum_spend')::numeric end)
 and event_sequence between 0 and case when binding->>'mode'='FOUNDER_CAMPAIGN'then 4000001 when binding->>'mode'='PRIVATE_BETA_UAT'then 2048 else 1024 end);
alter table private.polat_experiment_attempts drop constraint polat_experiment_attempt_versioned_bound;
alter table private.polat_experiment_attempts add constraint polat_experiment_attempt_versioned_bound check(ordinal between 1 and 1000000 and liability>0 and target_hash~'^[a-f0-9]{64}$'and request_hash~'^[a-f0-9]{64}$'and body_hash~'^[a-f0-9]{64}$');
alter table private.polat_experiment_evidence drop constraint polat_experiment_evidence_versioned_bound;
alter table private.polat_experiment_evidence add constraint polat_experiment_evidence_versioned_bound check(sequence between 1 and 4000001 and octet_length(payload::text)<=8192 and command_hash~'^[a-f0-9]{64}$'and evidence_hash~'^[a-f0-9]{64}$');
create or replace function private.private_beta_journal_bound()returns trigger language plpgsql set search_path=pg_catalog as $$declare b jsonb;begin
 select binding into strict b from private.polat_experiment_runs where id=new.run_id;
 if tg_table_name='polat_experiment_attempts'then if new.ordinal>(case when b->>'mode'='FOUNDER_CAMPAIGN'then least(1000000,(b->>'maximum_requests')::int) when b->>'mode'='PRIVATE_BETA_UAT'then 350 else 290 end)then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;
 else if new.sequence>(case when b->>'mode'='FOUNDER_CAMPAIGN'then 4000001 when b->>'mode'='PRIVATE_BETA_UAT'then 2048 else 1024 end)then raise exception 'POLAT_EXPERIMENT_INVALID'using errcode='22023';end if;end if;return new;end;$$;
create or replace function private.polat_experiment_append(x private.polat_experiment_runs,a private.polat_experiment_attempts,event_id uuid,kind text,p jsonb,key_hash text default null,deadline_value timestamptz default null)returns text language plpgsql set search_path=pg_catalog set timezone='UTC' as $$
declare prev text;h text;n integer;begin
 if x.event_sequence>=(case when x.binding->>'mode'='FOUNDER_CAMPAIGN'then 4000001 else 1024 end)then raise exception 'POLAT_EXPERIMENT_HISTORY_LIMIT'using errcode='54000';end if;
 n:=x.event_sequence+1;select evidence_hash into prev from private.polat_experiment_evidence where run_id=x.id order by sequence desc limit 1;
 h:=private.fse_hash(private.fse_canonical(jsonb_build_array('POLAT_EXPERIMENT_EVIDENCE1',x.binding_hash,a.id,n,kind,p,prev,key_hash,deadline_value)));
 insert into private.polat_experiment_evidence(id,tenant_id,run_id,attempt_id,sequence,stage,payload,command_hash,previous_hash,evidence_hash,dispatch_key_hash,deadline,account_scope_hash,response_identity_hash)
 values(event_id,x.tenant_id,x.id,a.id,n,kind,p,private.fse_hash(private.fse_canonical(p)),prev,h,key_hash,deadline_value,x.account_scope_hash,p->>'response_identity_hash');
 update private.polat_experiment_runs set event_sequence=n where id=x.id;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(x.tenant_id,'SYSTEM','polat.experiment_evidence','polat_experiment_attempts',a.id::text,jsonb_build_object('run_id',x.id,'stage',kind,'sequence',n,'evidence_hash',h,'financial_authority','NONE'));
 return h;
end;$$;
create or replace function private.campaign_configuration(raw_value text) returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare v jsonb; k text;begin
 v:=private.fse_strict_json(raw_value);
 if not private.fse_keys(v,array['version','name','mode','batch_id','plan_version_id','markets','default_language','starts_at','expires_at','maximum_messages','maximum_per_customer','maximum_per_day','minimum_interval_seconds','follow_up_after_seconds','maximum_model_calls','budget_currency','budget_amount','maximum_liability_per_call','maximum_output_tokens','timezone','window_start','window_end'])
 or not private.fse_strings(v,array['name','mode','batch_id','plan_version_id','default_language','starts_at','expires_at','budget_currency','budget_amount','maximum_liability_per_call','timezone'])
 or v->'version'<>'1'::jsonb or v->>'mode' not in('SYNTHETIC','CONTROLLED_TEST','COMMERCIAL') or char_length(btrim(v->>'name')) not between 1 and 120
 or v->>'default_language'<>'en' or v->>'budget_currency'<>'USD'
 or v->>'budget_amount'!~'^(0|[1-9][0-9]{0,8})\.[0-9]{6}$' or (v->>'budget_amount')::numeric<=0
 or v->>'maximum_liability_per_call'!~'^(0|[1-9][0-9]{0,8})\.[0-9]{6}$' or (v->>'maximum_liability_per_call')::numeric<=0
 or (v->>'maximum_liability_per_call')::numeric>(v->>'budget_amount')::numeric
 or jsonb_typeof(v->'markets') is distinct from 'array' or jsonb_array_length(v->'markets') not between 1 and 100
 or exists(select 1 from jsonb_array_elements(v->'markets') x where jsonb_typeof(x)<>'string' or x#>>'{}'!~'^[A-Z]{2}$' or x#>>'{}'='TR')
 or (select count(*)<>count(distinct x) from jsonb_array_elements(v->'markets') x)
 then raise exception 'CAMPAIGN_INVALID' using errcode='22023';end if;
 foreach k in array array['maximum_messages','maximum_per_customer','maximum_per_day','minimum_interval_seconds','follow_up_after_seconds','maximum_model_calls','maximum_output_tokens','window_start','window_end'] loop
  if jsonb_typeof(v->k)<>'number' or v->>k!~'^[0-9]{1,7}$' then raise exception 'CAMPAIGN_INVALID' using errcode='22023';end if;
 end loop;
 if (v->>'maximum_messages')::int not between 1 and 1000000 or (v->>'maximum_model_calls')::int not between 1 and 1000000
 or (v->>'maximum_per_customer')::int not between 1 and 100 or (v->>'maximum_per_day')::int not between 1 and 50
 or (v->>'minimum_interval_seconds')::int not between 60 and 2592000 or (v->>'follow_up_after_seconds')::int not between 60 and 2592000
 or (v->>'maximum_output_tokens')::int not between 1 and 4096 or (v->>'window_start')::int not between 0 and 23 or (v->>'window_end')::int not between 0 and 23
 or v->>'window_start'=v->>'window_end' or not exists(select 1 from pg_timezone_names where name=v->>'timezone')
 or (v->>'expires_at')::timestamptz<=(v->>'starts_at')::timestamptz
 then raise exception 'CAMPAIGN_INVALID' using errcode='22023';end if;
 perform (v->>'batch_id')::uuid,(v->>'plan_version_id')::uuid;
 return v;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 raise exception 'CAMPAIGN_INVALID' using errcode='22023';end;$$;
create or replace function private.campaign_blockers(t uuid,p uuid) returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare c private.sales_campaigns; d private.campaign_permissions; v public.commercial_versions; i public.commercial_items; b jsonb:='[]';begin
 select * into c from private.sales_campaigns where tenant_id=t and id=p;
 if c.id is null then return '["CAMPAIGN_UNAVAILABLE"]'::jsonb;end if;
 select * into d from private.campaign_permissions where tenant_id=t and batch_id=(c.configuration->>'batch_id')::uuid;
 if d.batch_id is null or not (d.declaration->'markets') @> (c.configuration->'markets') then b:=b||'"PERMISSION_SCOPE_MISSING"'::jsonb;end if;
 if not exists(select 1 from public.import_batches ib where ib.tenant_id=t and ib.id=(c.configuration->>'batch_id')::uuid and ib.status in('completed','review_required')and ib.completed_at is not null
 and exists(select 1 from public.import_rows ir where ir.tenant_id=t and ir.batch_id=ib.id and ir.status='imported'))then b:=b||'"IMPORT_NOT_COMPLETED"'::jsonb;end if;
 select * into v from public.commercial_versions where tenant_id=t and id=(c.configuration->>'plan_version_id')::uuid;
 select * into i from public.commercial_items where tenant_id=t and id=v.item_id;
 if v.id is null or i.kind<>'plan' or v.status<>'published' or i.archived_at is not null or v.effective_from>clock_timestamp()
 or coalesce(v.expires_at,'infinity')<=clock_timestamp() or coalesce(v.superseded_at,'infinity')<=clock_timestamp()
 or not private.valid_commercial_payload('plan',v.payload)
 or (c.configuration->>'mode'='COMMERCIAL' and i.test_only)
 then b:=b||'"PUBLISHED_PLAN_MISSING"'::jsonb;end if;
 if (c.configuration->>'expires_at')::timestamptz<=clock_timestamp() then b:=b||'"CAMPAIGN_WINDOW_EXPIRED"'::jsonb;end if;
 if not exists(select 1 from public.tenants where id=t and status='active')then b:=b||'"TENANT_DISABLED"'::jsonb;end if;
 if not exists(select 1 from public.tenant_members where tenant_id=t and user_id=c.owner_id and role='super_admin'and status='active')then b:=b||'"CAMPAIGN_OWNER_REVOKED"'::jsonb;end if;
 if c.configuration->>'mode'='SYNTHETIC' and not exists(select 1 from public.tenants where id=t and slug like 'polat-sandbox-%' and not outbound_messaging_enabled)then b:=b||'"ISOLATED_FIXTURE_REQUIRED"'::jsonb;end if;
 if c.configuration->>'mode'='CONTROLLED_TEST'and not exists(select 1 from public.tenants where id=t and status='active'and(slug like 'private-beta-%'or slug like 'campaign-uat-%')and not outbound_messaging_enabled)then b:=b||'"ISOLATED_CONTROLLED_TEST_REQUIRED"'::jsonb;end if;
 return b;
end;$$;
create function private.campaign_claim_genuine(target_tenant_id uuid,campaign_id_value uuid,worker_id_value text,target_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.sales_campaigns;x private.campaign_jobs;j public.scheduled_jobs;token uuid;hour_value int;begin
 perform private.campaign_execution_guard(target_tenant_id,campaign_id_value);
 if worker_id_value is null or worker_id_value!~'^[A-Za-z0-9_-]{1,80}$'then raise exception 'CAMPAIGN_INVALID' using errcode='22023';end if;
 select * into c from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 -- Unknown completion survives restart; no lease reclaim or free request-budget reset.
 update public.scheduled_jobs q set status='dead_letter',last_error_code='DELIVERY_UNKNOWN',dead_lettered_at=clock_timestamp()
 from private.campaign_jobs z where z.tenant_id=target_tenant_id and z.campaign_id=c.id and z.job_id=q.id and q.status='processing'and q.locked_at<clock_timestamp()-interval '120 seconds'and not exists(select 1 from public.agent_proposals p join public.messages m on m.tenant_id=p.tenant_id and m.id=p.sent_message_id where p.tenant_id=z.tenant_id and p.task_id=z.agent_task_id and m.status='retry_scheduled'and m.failure_code='TELEGRAM_RATE_LIMITED');
 if found then
  update public.agent_tasks task set status='DEAD_LETTER',failure_category='CAMPAIGN_LEASE_UNKNOWN',failure_code='DELIVERY_UNKNOWN',completed_at=clock_timestamp()
  from private.campaign_jobs z join public.scheduled_jobs q on q.id=z.job_id where z.tenant_id=target_tenant_id and z.campaign_id=c.id and task.id=z.agent_task_id and task.status='RUNNING'and q.status='dead_letter'and q.last_error_code='DELIVERY_UNKNOWN';
  update public.conversations cv set attention_required=true from private.campaign_jobs z join public.scheduled_jobs q on q.id=z.job_id where z.tenant_id=target_tenant_id and z.campaign_id=c.id and cv.id=z.conversation_id and q.status='dead_letter'and q.last_error_code='DELIVERY_UNKNOWN';
  update private.sales_campaigns set state='PAUSED',revision=revision+1 where tenant_id=target_tenant_id and id=c.id;
  perform private.campaign_audit(target_tenant_id,c.id,'lease_unknown',jsonb_build_object('automatic_retry',false));
  return jsonb_build_object('state','DELIVERY_UNKNOWN');
 end if;
 if c.state<>'ACTIVE' or private.campaign_blockers(target_tenant_id,c.id)<>'[]'::jsonb or(c.configuration->>'starts_at')::timestamptz>clock_timestamp()then return jsonb_build_object('state','HELD');end if;
 if c.attempts>=(c.configuration->>'maximum_model_calls')::int or c.attempts>=(c.configuration->>'maximum_messages')::int
 or c.reserved_liability+(c.configuration->>'maximum_liability_per_call')::numeric>(c.configuration->>'budget_amount')::numeric then
  update private.sales_campaigns set state='PAUSED',revision=revision+1 where tenant_id=target_tenant_id and id=c.id;
  perform private.campaign_audit(target_tenant_id,c.id,'budget_exhausted',jsonb_build_object('actual_cost','UNKNOWN'));
  return jsonb_build_object('state','BUDGET_EXHAUSTED');
 end if;
 hour_value:=extract(hour from clock_timestamp()at time zone(c.configuration->>'timezone'));
 if not(case when(c.configuration->>'window_start')::int<(c.configuration->>'window_end')::int then hour_value>=(c.configuration->>'window_start')::int and hour_value<(c.configuration->>'window_end')::int
 else hour_value>=(c.configuration->>'window_start')::int or hour_value<(c.configuration->>'window_end')::int end)then return jsonb_build_object('state','CONTACT_WINDOW');end if;
 -- At most 100 stale/unsafe intents drained per cycle; valid later work is retained.
 for x in select z.* from private.campaign_jobs z join public.scheduled_jobs q on q.id=z.job_id
 where z.tenant_id=target_tenant_id and z.campaign_id=c.id and z.conversation_id=target_conversation_id and q.status='scheduled'and q.scheduled_at<=clock_timestamp()
 order by q.scheduled_at,q.id limit 100 for update of q skip locked loop
  select * into j from public.scheduled_jobs where id=x.job_id;
  if x.campaign_revision<>c.revision or private.campaign_contact_reason(target_tenant_id,c.id,x.customer_id)is not null or x.source_message_id is distinct from(select m.id from public.messages m where m.tenant_id=target_tenant_id and m.conversation_id=x.conversation_id and m.direction='inbound'order by m.created_at desc,m.id desc limit 1)then
   update public.scheduled_jobs set status='cancelled',last_error_code='CAMPAIGN_CONTACT_OR_GENERATION_CHANGED'where id=j.id;
   perform private.campaign_audit(target_tenant_id,c.id,'intent_held',jsonb_build_object('job_id',j.id));continue;
  end if;
  if exists(select 1 from private.campaign_jobs z join public.scheduled_jobs q on q.id=z.job_id where z.tenant_id=target_tenant_id and z.campaign_id=c.id and z.customer_id=x.customer_id
   and q.id<>j.id and(q.status='processing' or q.attempts>0 and z.source_message_id=x.source_message_id and q.locked_at>clock_timestamp()-make_interval(secs=>(c.configuration->>'minimum_interval_seconds')::int)))then continue;end if;
  if(select count(*)from private.campaign_jobs z join public.scheduled_jobs q on q.id=z.job_id where z.tenant_id=target_tenant_id and z.customer_id=x.customer_id and q.attempts>0 and q.locked_at>clock_timestamp()-interval '24 hours')>=(c.configuration->>'maximum_per_day')::int then continue;end if;
  token:=extensions.gen_random_uuid();
  update public.scheduled_jobs set status='processing',attempts=attempts+1,locked_by=worker_id_value,locked_at=clock_timestamp(),payload=payload||jsonb_build_object('stage','RESERVED')where id=j.id;
  update private.campaign_jobs set lease_token=token,native_generation=(select generation from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=x.conversation_id)where tenant_id=target_tenant_id and job_id=j.id;
  update private.sales_campaigns set attempts=attempts+1,reserved_liability=reserved_liability+(configuration->>'maximum_liability_per_call')::numeric where tenant_id=target_tenant_id and id=c.id;
  perform private.campaign_audit(target_tenant_id,c.id,'attempt_reserved',jsonb_build_object('job_id',j.id,'actual_cost','UNKNOWN','scope','GENUINE_ACCOUNTABLE'));
  return jsonb_build_object('state','RESERVED','job_id',j.id,'lease_token',token,'conversation_id',x.conversation_id,'source_message_id',x.source_message_id,'source_hash',x.source_hash,'generation',c.revision::text);
 end loop;
 return jsonb_build_object('state','EMPTY');
end;$$;
revoke all on function private.campaign_claim_genuine(uuid,uuid,text,uuid)from public,anon,authenticated,service_role;

create function private.campaign_ensure_runtime(t uuid)returns uuid language plpgsql set search_path=pg_catalog as $$
declare v public.agent_versions;vid uuid;n int;begin
 vid:=private.ensure_shadow_agent(t);select * into strict v from public.agent_versions where tenant_id=t and id=vid;
 if v.model_provider='openai'and v.model_name='gpt-6.1-sol'and v.max_attempts=1 and v.timeout_ms=10000 then return v.id;end if;
 perform private.ensure_conversation_quality_config(t);
 select coalesce(max(version),0)+1 into n from public.agent_versions where tenant_id=t and agent_definition_id=v.agent_definition_id;
 update public.agent_versions set superseded_at=clock_timestamp()where tenant_id=t and agent_definition_id=v.agent_definition_id and superseded_at is null;
 insert into public.agent_versions(tenant_id,agent_definition_id,version,prompt_template,output_schema_version,allowed_tools,model_provider,model_name,timeout_ms,max_attempts,retry_policy,prompt_version,director_version,renderer_version,qa_version,context_version,evaluation_set_version)
 values(t,v.agent_definition_id,n,'Polat campaign v1; exact source-bound output QA; no retries, no financial authority.',4,'{}','openai','gpt-6.1-sol',10000,1,'{"strategy":"none","maximum_retries":0}',v.prompt_version,v.director_version,v.renderer_version,v.qa_version,3,v.evaluation_set_version)returning id into vid;
 return vid;end;$$;

create function public.claim_campaign_tasks_v1(target_tenant_id uuid,target_conversation_id uuid,worker_id_value text)
returns table(task_id uuid,tenant_id uuid,agent_version_id uuid,customer_id uuid,conversation_id uuid,source_event_id uuid,task_type text,execution_mode public.agent_execution_mode,correlation_id uuid,causation_id uuid,attempt_number integer,timeout_ms integer,model_provider text,model_name text)
language plpgsql security definer set search_path=pg_catalog as $$
declare c private.sales_campaigns;x private.campaign_jobs;reservation jsonb;vid uuid;v public.agent_versions;item public.agent_tasks;e public.domain_events;begin
 select z.* into c from private.sales_campaigns z join private.campaign_audience a on a.tenant_id=z.tenant_id and a.campaign_id=z.id join public.conversations cv on cv.tenant_id=a.tenant_id and cv.customer_id=a.customer_id
 where z.tenant_id=target_tenant_id and cv.id=target_conversation_id and z.state='ACTIVE'for update of z;
 if c.id is null then return;end if;
 perform private.campaign_execution_guard(target_tenant_id,c.id);
 -- Native worker claims a source only once; no stale or failed model attempt is retried.
 if exists(select 1 from public.agent_tasks a where a.tenant_id=target_tenant_id and a.conversation_id=target_conversation_id and a.status='RUNNING'and a.locked_at>=clock_timestamp()-interval '120 seconds')then return;end if;
 perform public.campaign_schedule_v1(target_tenant_id,c.id,25);
 reservation:=private.campaign_claim_genuine(target_tenant_id,c.id,worker_id_value,target_conversation_id);
 if reservation->>'state'<>'RESERVED'then return;end if;
 select * into strict x from private.campaign_jobs where job_id=(reservation->>'job_id')::uuid;
 select ev.* into e from public.domain_events ev where ev.tenant_id=target_tenant_id and ev.event_type='message.received'and ev.payload->>'message_id'=x.source_message_id::text order by ev.recorded_at,ev.id limit 1;
 if e.id is null then raise exception 'CAMPAIGN_SOURCE_EVENT_REQUIRED'using errcode='42501';end if;
 vid:=private.campaign_ensure_runtime(target_tenant_id);select av.* into strict v from public.agent_versions av where av.id=vid;
 -- Cancel unrelated legacy drafts for exactly this campaign source before the scoped provider can run.
 update public.agent_tasks a set status='CANCELLED',cancellation_reason='CAMPAIGN_SCOPED_RUNTIME',completed_at=clock_timestamp()
 where a.tenant_id=target_tenant_id and a.conversation_id=target_conversation_id and a.source_event_id=e.id and a.status='QUEUED'and a.task_type in('conversation.shadow_draft','conversation.reply');
 insert into public.agent_tasks(tenant_id,agent_definition_id,agent_version_id,customer_id,conversation_id,source_event_id,task_type,objective,execution_mode,status,priority,idempotency_key,correlation_id,causation_id,max_attempts,attempts,locked_by,locked_at,started_at,timeout_at)
 values(target_tenant_id,v.agent_definition_id,v.id,x.customer_id,x.conversation_id,e.id,'campaign.reply','One source-bound Polat campaign reply. No regeneration or retry.','HUMAN_APPROVAL','RUNNING',50,
 'campaign-native-v1:'||x.job_id::text,e.correlation_id,e.id,1,1,worker_id_value,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '120 seconds')returning * into item;
 update private.campaign_jobs set agent_task_id=item.id where job_id=x.job_id;
 insert into public.agent_run_attempts(tenant_id,task_id,attempt_number,stage,worker_id)values(target_tenant_id,item.id,1,'claimed',worker_id_value);
 return query select item.id,item.tenant_id,item.agent_version_id,item.customer_id,item.conversation_id,item.source_event_id,item.task_type,item.execution_mode,item.correlation_id,item.causation_id,item.attempts,v.timeout_ms,v.model_provider,v.model_name;
end;$$;

create function private.campaign_native_registry(t uuid,rid uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare r public.agent_runs;q public.agent_tasks;a private.campaign_model_attempts;x private.campaign_jobs;expected jsonb;facts jsonb;begin
 select * into strict r from public.agent_runs where tenant_id=t and id=rid;select * into strict q from public.agent_tasks where tenant_id=t and id=r.task_id;
 select * into a from private.campaign_model_attempts where tenant_id=t and native_run_id=rid;
 select * into x from private.campaign_jobs where tenant_id=t and job_id=a.job_id;
 if a.attempt_id is null or q.id is distinct from x.agent_task_id or r.context_manifest->>'campaign_profile'is distinct from 'polat-campaign-v1'
 or r.context_manifest->>'campaign_id'is distinct from a.campaign_id::text or r.context_manifest->>'campaign_job_id'is distinct from a.job_id::text
 or r.context_manifest->>'campaign_revision'is distinct from a.revision::text or r.context_manifest->>'source_message_id'is distinct from x.source_message_id::text
 or r.model_provider<>'openai'or r.model_name<>'gpt-6.1-sol'or jsonb_array_length(r.context_manifest->'included_message_ids')not between 1 and 25
 then raise exception 'EVIDENCE_REGISTRY_NOT_AUTHORITATIVE'using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('handle',case when ids.value=x.source_message_id::text then 'EVIDENCE_CURRENT_MESSAGE'else 'EVIDENCE_MESSAGE_'||ids.ordinality::text end,'messageId',m.id,'direction',m.direction)order by ids.ordinality),'[]')into expected
 from jsonb_array_elements_text(r.context_manifest->'included_message_ids')with ordinality ids(value,ordinality)join public.messages m on m.tenant_id=t and m.conversation_id=q.conversation_id and m.id::text=ids.value and m.created_at<=(r.context_manifest->>'context_boundary_timestamp')::timestamptz and(m.direction='inbound'or(m.direction='outbound'and m.status='sent'));
 if jsonb_array_length(expected)<>jsonb_array_length(r.context_manifest->'included_message_ids')then raise exception 'EVIDENCE_REGISTRY_NOT_AUTHORITATIVE'using errcode='22023';end if;
 facts:=jsonb_build_array(jsonb_build_object('id','polat:campaign:identity:v1'),jsonb_build_object('id','polat:campaign:identity:denial:v1'))||private.quality_commercial_facts(t,rid)||private.campaign_receipt_facts(t,rid);
 expected:=expected||(select jsonb_agg(jsonb_build_object('handle','EVIDENCE_COMMERCIAL_'||f.ordinality::text,'messageId',f.value->>'id','direction','system')order by f.ordinality)from jsonb_array_elements(facts)with ordinality f(value,ordinality));return expected;
end;$$;
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
    if r.context_manifest->>'campaign_profile'='polat-campaign-v1'then
      if not exists(select 1 from jsonb_array_elements(private.campaign_native_registry(target_tenant_id,target_run_id)) x where x->>'messageId'=ref)then raise exception 'EVIDENCE_REFERENCE_NOT_ALLOWED'using errcode='22023';end if;continue;
    end if;
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
    if r.context_manifest->>'private_beta_codec'in('claude-messages-v1','openai-responses-v1')then expected:=private.private_beta_native_registry(new.tenant_id,new.run_id);end if;
    if r.context_manifest->>'campaign_profile'='polat-campaign-v1'then expected:=private.campaign_native_registry(new.tenant_id,new.run_id);end if;
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

-- Presence and provider acceptance are different facts; absent controls stay blocked.
create or replace function public.campaign_runtime_scope_v1(target_tenant_id uuid,target_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare cid uuid;found_bound boolean;ready boolean:=false;begin
 select exists(select 1 from private.campaign_audience a join public.conversations c on c.tenant_id=a.tenant_id and c.customer_id=a.customer_id where a.tenant_id=target_tenant_id and c.id=target_conversation_id)into found_bound;
 select p.id into cid from private.campaign_audience a join public.conversations c on c.tenant_id=a.tenant_id and c.customer_id=a.customer_id join private.sales_campaigns p on p.tenant_id=a.tenant_id and p.id=a.campaign_id where a.tenant_id=target_tenant_id and c.id=target_conversation_id and p.state='ACTIVE';
 if cid is not null then begin perform private.campaign_execution_guard(target_tenant_id,cid);ready:=true;exception when sqlstate '42501'then ready:=false;end;end if;
 return jsonb_build_object('bound',found_bound,'campaign_id',cid,'genuine_executor_accepted',ready,'reason',case when ready then 'INDEPENDENT_RUNTIME_BOUND'else 'COMMERCIAL_PROVIDER_ACCOUNT_AND_TRANSPORT_ACCEPTANCE_REQUIRED'end);end;$$;

-- Every newly added internal function is private; only fixed RPCs reach the runtime.
do $$declare r record;begin
 for r in select oid::regprocedure signature from pg_proc where pronamespace='private'::regnamespace and proname like 'campaign_%'loop execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);end loop;
 for r in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'campaign_%'or proname='claim_campaign_tasks_v1')loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);execute format('grant execute on function %s to service_role',r.signature);end loop;
end;$$;

create or replace function private.campaign_job_guard()returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if old.agent_task_id is not null and new.agent_task_id is distinct from old.agent_task_id then raise exception 'CAMPAIGN_NATIVE_TASK_IMMUTABLE'using errcode='42501';end if;
 if new.agent_task_id is not null and not exists(select 1 from public.agent_tasks q where q.id=new.agent_task_id and q.tenant_id=new.tenant_id and q.customer_id=new.customer_id and q.conversation_id=new.conversation_id and q.task_type='campaign.reply'and q.idempotency_key='campaign-native-v1:'||new.job_id::text)then raise exception 'CAMPAIGN_NATIVE_TASK_MISMATCH'using errcode='42501';end if;
 if tg_op='DELETE'or to_jsonb(new)-array['lease_token','body_hash','body','native_generation','outcome','agent_task_id']is distinct from to_jsonb(old)-array['lease_token','body_hash','body','native_generation','outcome','agent_task_id']
 or old.lease_token is not null and new.lease_token is distinct from old.lease_token
 or old.body_hash is not null and new.body_hash is distinct from old.body_hash
 or old.body is not null and new.body is distinct from old.body
 or old.native_generation is not null and new.native_generation is distinct from old.native_generation
 or old.outcome is not null and new.outcome is distinct from old.outcome
 then raise exception 'CAMPAIGN_EVIDENCE_IMMUTABLE'using errcode='42501';end if;return new;
end;$$;

create function public.campaign_followup_history_v1(target_tenant_id uuid,job_id_value uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
declare x private.campaign_jobs;result jsonb;begin
 select * into x from private.campaign_jobs where tenant_id=target_tenant_id and job_id=job_id_value;
 x:=private.campaign_native_source(target_tenant_id,x.campaign_id,x.job_id);
 select coalesce(jsonb_agg(row_value order by row_value.acknowledged_at,row_value.id),'[]')into result from(
 select m.id,m.content,m.updated_at acknowledged_at from public.messages m join public.agent_proposals p on p.tenant_id=m.tenant_id and p.sent_message_id=m.id
 join private.campaign_jobs prior on prior.tenant_id=p.tenant_id and prior.agent_task_id=p.task_id
 join public.scheduled_jobs job on job.id=x.job_id
 where prior.tenant_id=x.tenant_id and prior.campaign_id=x.campaign_id and prior.source_message_id=x.source_message_id and prior.job_id<>x.job_id
 and m.conversation_id=x.conversation_id and m.direction='outbound'and m.status='sent'and m.provider_message_id is not null and m.updated_at<job.locked_at
 order by m.updated_at desc,m.id desc limit 3)row_value;return result;end;$$;

create function private.campaign_receipt_facts(t uuid,rid uuid)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare r public.agent_runs;q public.agent_tasks;receipt jsonb;facts jsonb:='[]';expected_ids jsonb;begin
 select * into strict r from public.agent_runs where tenant_id=t and id=rid;select * into strict q from public.agent_tasks where tenant_id=t and id=r.task_id;
 for receipt in select value from jsonb_array_elements(public.entitlement_conversation_receipts(t,q.conversation_id,(r.context_manifest->>'context_boundary_timestamp')::timestamptz))limit 3 loop
  facts:=facts||jsonb_build_array(jsonb_build_object('id',receipt->>'id'||':payment'),jsonb_build_object('id',receipt->>'id'||':subscription'));
  if receipt->>'membership'='MEMBER'and receipt->>'membership_checked_at'is not null and(receipt->>'membership_checked_at')::timestamptz<=(r.context_manifest->>'context_boundary_timestamp')::timestamptz then facts:=facts||jsonb_build_array(jsonb_build_object('id',receipt->>'id'||':access'));end if;
 end loop;
 select coalesce(jsonb_agg(x->'id'),'[]')into expected_ids from jsonb_array_elements(facts)x;
 if expected_ids is distinct from coalesce(r.context_manifest->'campaign_receipt_fact_ids','[]')then raise exception 'CAMPAIGN_RECEIPT_REGISTRY_MISMATCH'using errcode='22023';end if;
 return facts;end;$$;
revoke all on function private.campaign_receipt_facts(uuid,uuid)from public,anon,authenticated,service_role;
revoke all on function public.campaign_followup_history_v1(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.campaign_followup_history_v1(uuid,uuid)to service_role;

create function public.admin_campaign_queue_manual_v1(target_tenant_id uuid,campaign_id_value uuid,target_conversation_id uuid,content_value text,idempotency_key_value text,correlation_id_value uuid,reply_to_message_id_value uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.conversations;contact public.messaging_contacts;control private.campaign_execution_controls;m public.messages;mid uuid;case_value public.escalation_cases;begin
 perform private.campaign_admin(target_tenant_id,false,true);
 perform 1 from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 control:=private.campaign_execution_guard(target_tenant_id,campaign_id_value);
 select * into c from public.conversations where tenant_id=target_tenant_id and id=target_conversation_id for update;
 select * into contact from public.messaging_contacts where tenant_id=target_tenant_id and id=c.messaging_contact_id;
 select * into case_value from public.escalation_cases where tenant_id=target_tenant_id and conversation_id=c.id and status<>'RESOLVED'order by created_at desc limit 1;
 if c.id is null or c.runtime_mode<>'HUMAN_TAKEOVER'or not c.human_takeover or c.status<>'open'
 or not exists(select 1 from private.campaign_audience where tenant_id=target_tenant_id and campaign_id=campaign_id_value and customer_id=c.customer_id)
 or contact.contactability not in('user_initiated','allowed')or contact.provider_user_id is distinct from contact.provider_chat_id
 or contact.last_inbound_at<clock_timestamp()-interval '24 hours' or contact.last_inbound_at is null
 or exists(select 1 from private.campaign_suppressions where tenant_id=target_tenant_id and customer_id=c.customer_id)
 or(case_value.id is not null and(case_value.status<>'IN_PROGRESS'or case_value.assigned_to is distinct from auth.uid()))
 then raise exception 'CAMPAIGN_HUMAN_OWNERSHIP_REQUIRED'using errcode='42501';end if;
 if content_value is null or char_length(btrim(content_value))not between 1 and 3800 or idempotency_key_value is null or char_length(idempotency_key_value)not between 1 and 200
 or content_value~*'(^|[.!?][[:space:]])(I am|I.m|Ben) Polat([.![:space:]]|$)'then raise exception 'CAMPAIGN_MANUAL_INVALID'using errcode='22023';end if;
 select * into m from public.messages where tenant_id=target_tenant_id and idempotency_key='campaign-human:'||idempotency_key_value;
 if m.id is not null then
  if m.conversation_id<>c.id or m.actor_id is distinct from auth.uid()::text or m.content is distinct from 'Polat Support: '||btrim(content_value)then raise exception 'CAMPAIGN_MANUAL_CONFLICT'using errcode='23505';end if;
  return jsonb_build_object('message_id',m.id,'status',m.status,'duplicate',true);
 end if;
 if reply_to_message_id_value is not null and not exists(select 1 from public.messages where tenant_id=target_tenant_id and conversation_id=c.id and id=reply_to_message_id_value)then raise exception 'CAMPAIGN_REPLY_SCOPE_DENIED'using errcode='42501';end if;
 insert into public.messages(tenant_id,conversation_id,customer_id,messaging_contact_id,provider_connection_id,direction,message_type,content,status,provider_chat_id,reply_to_message_id,idempotency_key,actor_type,actor_id,correlation_id,occurred_at)
 values(target_tenant_id,c.id,c.customer_id,c.messaging_contact_id,c.provider_connection_id,'outbound','text','Polat Support: '||btrim(content_value),'pending',contact.provider_chat_id,reply_to_message_id_value,'campaign-human:'||idempotency_key_value,'HUMAN',auth.uid()::text,correlation_id_value,clock_timestamp())returning id into mid;
 perform private.campaign_audit(target_tenant_id,campaign_id_value,'manual_reply_queued',jsonb_build_object('message_id',mid,'public_actor','Polat Support','body_in_audit',false));
 return jsonb_build_object('message_id',mid,'status','pending','duplicate',false);end;$$;
revoke all on function public.admin_campaign_queue_manual_v1(uuid,uuid,uuid,text,text,uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.admin_campaign_queue_manual_v1(uuid,uuid,uuid,text,text,uuid,uuid)to authenticated;

create function private.campaign_claim_human(t uuid,p uuid,mid uuid)returns jsonb language plpgsql set search_path=pg_catalog as $$
declare control private.campaign_execution_controls;m public.messages;c public.conversations;contact public.messaging_contacts;e public.escalation_cases;begin
 control:=private.campaign_execution_guard(t,p);
 select * into m from public.messages where tenant_id=t and id=mid;
 select * into c from public.conversations where tenant_id=t and id=m.conversation_id for update;
 select * into m from public.messages where tenant_id=t and id=mid for update;
 select * into contact from public.messaging_contacts where tenant_id=t and id=c.messaging_contact_id;
 select * into e from public.escalation_cases where tenant_id=t and conversation_id=c.id and status<>'RESOLVED'order by created_at desc limit 1;
 if m.actor_type<>'HUMAN'or m.idempotency_key not like 'campaign-human:%'or m.direction<>'outbound'or m.status<>'pending'
 or c.runtime_mode<>'HUMAN_TAKEOVER'or not c.human_takeover or c.status<>'open'
 or m.created_at<clock_timestamp()-interval '60 seconds'or m.created_at<coalesce(c.escalation_return_boundary,'-infinity')
 or m.created_at<coalesce((select max(created_at)from public.audit_logs where tenant_id=t and entity_id=c.id::text and action='conversation.runtime_mode_changed'),'-infinity')
 or not exists(select 1 from private.campaign_audience where tenant_id=t and campaign_id=p and customer_id=c.customer_id)
 or not exists(select 1 from public.tenant_members where tenant_id=t and user_id::text=m.actor_id and status='active'and role in('super_admin','manager'))
 or contact.contactability not in('user_initiated','allowed')or contact.provider_user_id is distinct from contact.provider_chat_id
 or m.provider_chat_id is distinct from contact.provider_chat_id or contact.last_inbound_at is null or contact.last_inbound_at<clock_timestamp()-interval '24 hours'
 or exists(select 1 from private.campaign_suppressions where tenant_id=t and customer_id=c.customer_id)
 or(e.id is not null and(e.status<>'IN_PROGRESS'or e.assigned_to::text is distinct from m.actor_id))
 or exists(select 1 from public.messages other where other.tenant_id=t and other.conversation_id=c.id and other.id<>m.id and other.direction='outbound'and(other.status='sending'or other.failure_code='TELEGRAM_DELIVERY_UNCERTAIN'))
 then return jsonb_build_object('dispatch',false);end if;
 update public.messages set status='sending'where id=m.id;
 return jsonb_build_object('dispatch',true,'message_id',m.id,'campaign_id',p,'bot_id',control.transport->>'bot_id','chat_id',m.provider_chat_id,'body',m.content,
 'reply_to_provider_message_id',m.reply_to_provider_message_id,'business_connection_id',control.transport->>'business_connection_id','business_generation',control.transport->>'connection_generation');end;$$;
revoke all on function private.campaign_claim_human(uuid,uuid,uuid)from public,anon,authenticated,service_role;

-- Extend the existing founder read-model; no new dashboard or credential projection.
alter function public.admin_campaign_workspace_v1(uuid,uuid)rename to campaign_workspace_before_genuine;
alter function public.campaign_workspace_before_genuine(uuid,uuid)set schema private;
create function public.admin_campaign_workspace_v1(target_tenant_id uuid,after_value uuid default null)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;item jsonb;items jsonb:='[]';runtime jsonb;control private.campaign_execution_controls;ready boolean;begin
 result:=private.campaign_workspace_before_genuine(target_tenant_id,after_value);
 for item in select value from jsonb_array_elements(result->'items')loop
  select * into control from private.campaign_execution_controls where tenant_id=target_tenant_id and campaign_id=(item->>'id')::uuid;
  ready:=false;if control.campaign_id is not null then begin perform private.campaign_execution_guard(target_tenant_id,control.campaign_id);ready:=true;exception when sqlstate '42501'then ready:=false;end;end if;
  select jsonb_build_object('state',case when control.campaign_id is null then 'INDEPENDENT_CONTROL_REQUIRED'when ready then 'READY_TO_DISPATCH'else 'HELD'end,
   'provider','openai','model','gpt-6.1-sol','model_calls',count(*),'input_tokens',case when count(*)>0 and count(*)=count(e.payload->>'input_tokens')then sum((e.payload->>'input_tokens')::bigint)end,
   'output_tokens',case when count(*)>0 and count(*)=count(e.payload->>'output_tokens')then sum((e.payload->>'output_tokens')::bigint)end,
   'unknown_billing',count(*)filter(where bill.payload is null),'actual_billed_usd',case when count(*)>0 and count(*)=count(bill.payload)then trim_scale(sum((bill.payload->>'actual_billed_amount')::numeric))::text end,
   'delivery_basis','TELEGRAM_API_ACK_NOT_CUSTOMER_READ')into runtime
  from private.campaign_model_attempts a
  left join private.polat_experiment_evidence e on e.attempt_id=a.attempt_id and e.stage in('PROVIDER_RESULT','RESULT_UNKNOWN')
  left join private.polat_experiment_evidence bill on bill.attempt_id=a.attempt_id and bill.stage='RECONCILIATION'and bill.payload->>'status'='ACTUAL_RECONCILED'
  where a.tenant_id=target_tenant_id and a.campaign_id=(item->>'id')::uuid;
  items:=items||jsonb_build_array(item||jsonb_build_object('runtime',runtime,'live_dispatch_enabled',ready and item->>'mode'='COMMERCIAL'));
 end loop;
 return jsonb_set(result,'{items}',items);end;$$;
revoke all on function private.campaign_workspace_before_genuine(uuid,uuid)from public,anon,authenticated,service_role;
revoke all on function public.admin_campaign_workspace_v1(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.admin_campaign_workspace_v1(uuid,uuid)to authenticated;

create or replace function private.campaign_contact_reason(t uuid,p uuid,cid uuid,exclude_job uuid default null) returns text language plpgsql stable set search_path=pg_catalog as $$
declare a private.campaign_audience; c private.sales_campaigns; cv public.conversations; mc public.messaging_contacts; d private.campaign_permissions;begin
 select * into c from private.sales_campaigns where tenant_id=t and id=p;
 select * into a from private.campaign_audience where tenant_id=t and campaign_id=p and customer_id=cid;
 if c.id is null or a.customer_id is null then return 'AUDIENCE_UNAVAILABLE';end if;
 select * into d from private.campaign_permissions where tenant_id=t and batch_id=(c.configuration->>'batch_id')::uuid;
 if d.batch_id is null then return 'PERMISSION_SCOPE_MISSING';end if;
 if exists(select 1 from private.campaign_jobs x join public.scheduled_jobs j on j.id=x.job_id where x.tenant_id=t and x.customer_id=cid and x.job_id is distinct from exclude_job
 and(j.status='processing'or j.status='dead_letter'and j.last_error_code='DELIVERY_UNKNOWN'))then return 'DELIVERY_REVIEW_REQUIRED';end if;
 if a.market is null or not(c.configuration->'markets')?a.market then return 'MARKET_UNKNOWN_OR_EXCLUDED';end if;
 if exists(select 1 from private.campaign_suppressions where tenant_id=t and customer_id=cid)
 or exists(select 1 from public.customer_success_contact_policies where tenant_id=t and customer_id=cid and (opted_out or consent='DENIED'))
 or exists(select 1 from private.polat_contact_evidence e join public.conversations x on x.tenant_id=e.tenant_id and x.id=e.conversation_id where e.tenant_id=t and x.customer_id=cid and e.kind in('OPT_OUT_RECORDED','CONTACT_SUPPRESSED','MARKETING_REVOKED'))
 then return 'CONTACT_SUPPRESSED';end if;
 select * into cv from public.conversations where tenant_id=t and customer_id=cid and status='open' order by last_message_at desc nulls last,id limit 1;
 select * into mc from public.messaging_contacts where tenant_id=t and id=cv.messaging_contact_id and customer_id=cid;
 if cv.id is null or mc.id is null or mc.contactability not in('user_initiated','allowed') or mc.provider_user_id!~'^[1-9][0-9]{0,18}$'
 or mc.provider_chat_id is distinct from mc.provider_user_id
 or not exists(select 1 from public.customer_identities ci where ci.tenant_id=t and ci.customer_id=cid and ci.identity_type='telegram_user_id' and ci.normalized_value=mc.provider_user_id)
 or not exists(select 1 from public.messaging_provider_connections where tenant_id=t and id=cv.provider_connection_id and status='active')
 then return 'PLATFORM_ROUTE_UNAVAILABLE';end if;
 -- BOT cannot initiate contact. Business routes still require an active, observed platform reply window.
 if mc.last_inbound_at is null or (d.declaration->>'channel'='TELEGRAM_BUSINESS' and mc.last_inbound_at<clock_timestamp()-interval '24 hours')
 then return 'PLATFORM_ROUTE_UNAVAILABLE';end if;
 if cv.human_takeover or cv.runtime_mode<>'AI_ACTIVE' or exists(select 1 from public.customers where tenant_id=t and id=cid and automation_paused)
 or exists(select 1 from public.escalation_cases where tenant_id=t and customer_id=cid and status<>'RESOLVED')then return 'HUMAN_OWNERSHIP';end if;
 if exists(select 1 from private.campaign_execution_controls where tenant_id=t and campaign_id=p)and not exists(select 1 from public.messages where tenant_id=t and conversation_id=cv.id and direction='inbound'and created_at>=greatest(c.activated_at,cv.automatic_replies_enabled_at))then return 'SOURCE_BEFORE_RESUME';end if;
 return null;
end;$$;

-- Order the campaign/conversation locks BEFORE the native result writer locks the
-- message. ACK/UNKNOWN recording after STOP must not invert the dispatch order.
alter function public.record_outbound_message_result(uuid,uuid,text,text,integer,text,integer)rename to campaign_native_outbound_result;
alter function public.campaign_native_outbound_result(uuid,uuid,text,text,integer,text,integer)set schema private;
create function public.record_outbound_message_result(target_tenant_id uuid,target_message_id uuid,result_value text,provider_message_id_value text,provider_status_value integer,error_code_value text,retry_after_seconds_value integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare cid uuid;cv uuid;begin
 select x.campaign_id,m.conversation_id into cid,cv from public.messages m join public.agent_proposals p on p.tenant_id=m.tenant_id and p.sent_message_id=m.id join private.campaign_jobs x on x.tenant_id=p.tenant_id and x.agent_task_id=p.task_id where m.tenant_id=target_tenant_id and m.id=target_message_id;
 if cid is null then
  select (a.entity_id)::uuid,m.conversation_id into cid,cv from public.messages m join public.audit_logs a on a.tenant_id=m.tenant_id and a.action='campaign.manual_reply_queued'and a.after_data->>'message_id'=m.id::text where m.tenant_id=target_tenant_id and m.id=target_message_id and m.idempotency_key like 'campaign-human:%'limit 1;
 end if;
 if cid is not null then
  perform 1 from private.sales_campaigns where tenant_id=target_tenant_id and id=cid for update;
  perform 1 from public.conversations where tenant_id=target_tenant_id and id=cv for update;
 end if;
 return private.campaign_native_outbound_result(target_tenant_id,target_message_id,result_value,provider_message_id_value,provider_status_value,error_code_value,retry_after_seconds_value);
end;$$;
revoke all on function private.campaign_native_outbound_result(uuid,uuid,text,text,integer,text,integer)from public,anon,authenticated,service_role;
revoke all on function public.record_outbound_message_result(uuid,uuid,text,text,integer,text,integer)from public,anon,authenticated,service_role;
grant execute on function public.record_outbound_message_result(uuid,uuid,text,text,integer,text,integer)to service_role;

create or replace function public.campaign_schedule_v1(target_tenant_id uuid,campaign_id_value uuid,limit_value integer default 25)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.sales_campaigns;a private.campaign_audience;cv public.conversations;m public.messages;jid uuid;n integer:=0;scanned integer:=0;begin
 if limit_value is null or limit_value not between 1 and 100 then raise exception 'CAMPAIGN_INVALID' using errcode='22023';end if;
 select * into c from private.sales_campaigns where tenant_id=target_tenant_id and id=campaign_id_value for update;
 if c.id is null then raise exception 'CAMPAIGN_UNAVAILABLE' using errcode='42501';end if;
 if c.state<>'ACTIVE' or private.campaign_blockers(target_tenant_id,c.id)<>'[]'::jsonb or (c.configuration->>'starts_at')::timestamptz>clock_timestamp()
 then return jsonb_build_object('scheduled',0,'state',c.state);end if;
 for a in select * from private.campaign_audience aa where aa.tenant_id=target_tenant_id and aa.campaign_id=c.id
 and not exists(select 1 from private.campaign_jobs x join public.scheduled_jobs j on j.id=x.job_id where x.tenant_id=aa.tenant_id and x.campaign_id=aa.campaign_id and x.customer_id=aa.customer_id
 and(j.status in('scheduled','processing')or j.status='dead_letter'and(not exists(select 1 from private.campaign_execution_controls where tenant_id=c.tenant_id and campaign_id=c.id)or j.last_error_code='DELIVERY_UNKNOWN'or x.source_message_id=(select source_msg.id from public.messages source_msg where source_msg.tenant_id=aa.tenant_id and source_msg.customer_id=aa.customer_id and source_msg.direction='inbound'order by source_msg.created_at desc,source_msg.id desc limit 1))or j.completed_at>clock_timestamp()-make_interval(secs=>(c.configuration->>'follow_up_after_seconds')::integer)and(not exists(select 1 from private.campaign_execution_controls where tenant_id=c.tenant_id and campaign_id=c.id)or x.source_message_id=(select source_msg.id from public.messages source_msg where source_msg.tenant_id=aa.tenant_id and source_msg.customer_id=aa.customer_id and source_msg.direction='inbound'order by source_msg.created_at desc,source_msg.id desc limit 1))))
 and(select count(*)from private.campaign_jobs x join public.scheduled_jobs j on j.id=x.job_id where x.tenant_id=aa.tenant_id and x.campaign_id=aa.campaign_id and x.customer_id=aa.customer_id and j.attempts>0)<(c.configuration->>'maximum_per_customer')::int
 and private.campaign_contact_reason(target_tenant_id,c.id,aa.customer_id)is null
 order by aa.customer_id limit limit_value loop
  scanned:=scanned+1;if private.campaign_contact_reason(target_tenant_id,c.id,a.customer_id)is not null then continue;end if;
  select * into cv from public.conversations where tenant_id=target_tenant_id and customer_id=a.customer_id and status='open'order by last_message_at desc nulls last,id limit 1;
  select * into m from public.messages where tenant_id=target_tenant_id and conversation_id=cv.id and direction='inbound'
  and(c.configuration->>'mode'<>'SYNTHETIC'or id=(select last_inbound_id from private.polat_conversation_controls where tenant_id=target_tenant_id and conversation_id=cv.id))
  order by created_at desc,id desc limit 1;
  if m.id is null then continue;end if;
  jid:=extensions.gen_random_uuid();
  insert into public.scheduled_jobs(id,tenant_id,customer_id,job_type,payload,idempotency_key,correlation_id,scheduled_at,max_attempts)
  values(jid,target_tenant_id,a.customer_id,'campaign.sales_reply',jsonb_build_object('campaign_id',c.id,'revision',c.revision,'scope',c.configuration->>'mode'),
  'campaign:'||c.id::text||':'||a.customer_id::text||':'||c.revision::text||':'||(select count(*)from private.campaign_jobs where tenant_id=target_tenant_id and campaign_id=c.id and customer_id=a.customer_id)::text,
  extensions.gen_random_uuid(),clock_timestamp(),1);
  insert into private.campaign_jobs(tenant_id,job_id,campaign_id,customer_id,conversation_id,source_message_id,campaign_revision,source_hash)
  values(target_tenant_id,jid,c.id,a.customer_id,cv.id,m.id,c.revision,private.fse_hash(m.content));n:=n+1;
 end loop;
 perform private.campaign_audit(target_tenant_id,c.id,'scheduled',jsonb_build_object('scheduled',n,'scanned',scanned,'human_per_message_review',false));
 return jsonb_build_object('scheduled',n,'scanned',scanned,'state',c.state);
end;$$;
