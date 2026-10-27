-- Disposable SQL fixtures only. These JSON observations do not attest genuine
-- Telegram permissions, external messages, model results or financial authority.
create temp table business_cases(n integer primary key,run_id uuid,pending_message_id uuid);
create function pg_temp.business_service()returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claim.role','service_role',true);
end;$$;
create function pg_temp.business_config(n integer)returns jsonb language sql as $$
 select jsonb_build_object('representative_user_id',(9000000+n)::text,'founder_chat_id',(5000000+n)::text,'business_connection_id','fixture-business-'||n)
$$;
create function pg_temp.business_setup(n integer)returns void language plpgsql as $$begin
 perform pg_temp.beta_setup(n);perform pg_temp.beta_bot(n);
 perform public.admin_private_beta_business_configure_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),pg_temp.business_config(n)::text,1);
 insert into business_cases(n)values(n);
end;$$;
create function pg_temp.business_proof(n integer,enabled_value boolean default true,reply_value boolean default true)returns jsonb language plpgsql as $$declare b private.private_beta_business_controls;p private.private_beta_programs;begin
 select * into strict b from private.private_beta_business_controls where program_id=pg_temp.beta_id(n,'3000');
 select * into strict p from private.private_beta_programs where id=b.program_id;
 return jsonb_build_object('version',1,'origin','INDEPENDENT_TELEGRAM_BUSINESS_READ','bot_id',b.bot_id,'credential_sha256',b.credential_sha256,'repository_sha',p.configuration->>'repository_sha',
 'business_connection_id',b.business_connection_id,'representative_user_id',b.representative_user_id,'expected_generation',b.generation::text,'enabled',enabled_value,'can_reply',reply_value,
 'source_hash',private.fse_hash('sql-fixture-seal-'||n||':'||b.generation),'observed_at',clock_timestamp(),'expires_at',p.configuration->>'expires_at');end;$$;
create function pg_temp.business_seal(n integer)returns void language plpgsql as $$begin
 perform private.private_beta_business_control_record(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),pg_temp.business_proof(n)::text);
end;$$;
create function pg_temp.business_event_value(n integer,kind_value text,u integer,msg integer default null,text_value text default null)returns jsonb language plpgsql as $$declare b private.private_beta_business_controls;p private.private_beta_programs;v jsonb;begin
 select * into strict b from private.private_beta_business_controls where program_id=pg_temp.beta_id(n,'3000');select * into strict p from private.private_beta_programs where id=b.program_id;
 v:=jsonb_build_object('version',1,'kind',kind_value,'update_id',u::text,'business_connection_id',b.business_connection_id,
 'provider_user_id',case when kind_value in('INBOUND','EDIT')then b.founder_chat_id when kind_value='DELETE'then null else b.representative_user_id end,
 'provider_chat_id',case when kind_value in('CONNECTION_DISABLED','CONNECTION_OBSERVED')then null else b.founder_chat_id end,'provider_message_id',msg::text,
 'occurred_at',(p.configuration->>'starts_at')::timestamptz+interval '30 seconds','content',text_value);
 return v||jsonb_build_object('source_hash',private.fse_hash(private.fse_canonical(v)));end;$$;
create function pg_temp.business_event(n integer,kind_value text,u integer,msg integer default null,text_value text default null)returns jsonb language sql as $$
 select public.private_beta_business_event_v1(pg_temp.beta_id(n,'2000'),pg_temp.beta_id(n,'3000'),pg_temp.business_event_value(n,kind_value,u,msg,text_value)::text)
$$;
create function pg_temp.business_ingest(n integer,u integer,msg integer,text_value text)returns jsonb language plpgsql as $$declare b private.private_beta_business_controls;e jsonb;r jsonb;begin
 perform pg_temp.business_service();select * into strict b from private.private_beta_business_controls where program_id=pg_temp.beta_id(n,'3000');
 e:=pg_temp.business_event_value(n,'INBOUND',u,msg);r:=public.private_beta_business_event_v1(b.tenant_id,b.program_id,e::text);
 if r->>'action'<>'INBOUND'then raise exception 'BUSINESS_FIXTURE_SOURCE_HELD';end if;
 r:=public.ingest_telegram_message(b.tenant_id,'business:'||private.fse_hash(b.business_connection_id)||':'||u,msg::text,b.founder_chat_id,b.founder_chat_id,null,null,null,text_value,null,(e->>'occurred_at')::timestamptz);
 update private_beta_cases set ingest=r where private_beta_cases.n=$1;return r;end;$$;
create function pg_temp.business_founder(n integer)returns void language plpgsql as $$declare p private.private_beta_programs;r jsonb;begin
 perform pg_temp.beta_account(n);perform pg_temp.beta_auth(n);
 select * into strict p from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');
 perform public.admin_private_beta_transition_v1(p.tenant_id,p.id,'CANARY',p.generation);
 r:=public.private_beta_reserve_v1(p.tenant_id,p.id,pg_temp.beta_id(n,'4000'),repeat('a',64),repeat('b',64),null,'0.50128',pg_temp.beta_id(n,'4001'));
 perform public.private_beta_begin_v1(p.tenant_id,p.id,(r->>'attempt_id')::uuid,pg_temp.beta_id(n,'5000'));
 perform public.private_beta_record_v1(p.tenant_id,p.id,(r->>'attempt_id')::uuid,pg_temp.beta_id(n,'5000'),pg_temp.beta_outcome()::text);
 perform private.private_beta_reconcile_attempt(p.tenant_id,p.id,(r->>'attempt_id')::uuid,jsonb_build_object('version',1,'origin','INDEPENDENT_PROVIDER_BILLING','coverage','COMPLETE_REQUEST_CHARGE','account_scope_hash',p.account_control->>'account_scope_hash','request_hash',repeat('a',64),'actual_billed_amount','0.000025','currency','USD','source_hash',repeat('f',64),'observed_at',clock_timestamp())::text);
 perform pg_temp.beta_account(n,repeat('f',64));perform pg_temp.beta_auth(n);
 select * into strict p from private.private_beta_programs where id=p.id;perform public.admin_private_beta_transition_v1(p.tenant_id,p.id,'FOUNDER',p.generation);
 perform public.admin_private_beta_operator_accept_v1(p.tenant_id,p.id);
end;$$;
create function pg_temp.business_enroll(n integer)returns void language plpgsql as $$declare p private.private_beta_programs;b private.private_beta_business_controls;a private.private_beta_participants;i jsonb;r jsonb;notice jsonb;begin
 perform pg_temp.business_founder(n);perform pg_temp.beta_auth(n);
 select * into strict p from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');select * into strict b from private.private_beta_business_controls where program_id=p.id;
 i:=public.admin_private_beta_invite_v1(p.tenant_id,p.id,'FOUNDER',pg_temp.beta_id(n,'6000'));perform pg_temp.business_service();
 perform public.private_beta_invite_accept_v1(p.tenant_id,b.bot_id,b.founder_chat_id,b.founder_chat_id,'/start '||(i->>'code'));
 r:=pg_temp.business_ingest(n,1,1,'/start [invitation redacted]');select * into strict a from private.private_beta_participants where program_id=p.id;
 notice:=public.private_beta_queue_notice_v1(p.tenant_id,p.id,a.id,(r->>'conversation_id')::uuid,(r->>'message_id')::uuid,'NOTICE');
 update public.messages set status='sent',provider_message_id='2',provider_acknowledged_at=clock_timestamp()where id=(notice->>'message_id')::uuid;
 perform public.private_beta_invite_accept_v1(p.tenant_id,b.bot_id,b.founder_chat_id,b.founder_chat_id,'/agree');
 perform pg_temp.business_ingest(n,2,3,'/agree');perform public.private_beta_bind_conversation_v1(p.tenant_id,a.id,(r->>'conversation_id')::uuid);
 r:=pg_temp.business_ingest(n,3,4,'Hi, a fictional free beta question.');
 update private_beta_cases set invite=i,ingest=r where private_beta_cases.n=$1;
end;$$;
create function pg_temp.business_prepare_run(n integer)returns uuid language plpgsql as $$declare t uuid:=pg_temp.beta_id(n,'2000');p uuid:=pg_temp.beta_id(n,'3000');a private.private_beta_participants;c public.conversations;task uuid;rid uuid;begin
 perform pg_temp.business_service();select * into strict a from private.private_beta_participants where program_id=p;select * into strict c from public.conversations where id=a.conversation_id;
 select task_id into task from public.claim_private_beta_tasks_v1(t,c.id,'business-fixture-worker');
 if task is null then raise exception 'BUSINESS_FIXTURE_TASK_REQUIRED';end if;
 rid:=public.begin_agent_run(t,task,'business-fixture-worker',jsonb_build_object('polat_profile','polat-private-beta-v1','private_beta_program_id',p,'private_beta_participant_id',a.id,'private_beta_revision',a.revision::text));
 update business_cases set run_id=rid where business_cases.n=$1;return rid;end;$$;
