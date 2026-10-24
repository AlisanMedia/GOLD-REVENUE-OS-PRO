create function pg_temp.signal_case_id(n integer,kind text) returns uuid language sql immutable as $$select ('51a5'||kind||'-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.signal_case_setup(n integer) returns void language plpgsql as $$begin
 insert into public.tenants(id,name,slug) values(pg_temp.signal_case_id(n,'2000'),'Signal fixture '||n,'signal-sandbox-review-'||n);
 perform private.signal_fixture_configure_v1(pg_temp.signal_case_id(n,'2000'),pg_temp.signal_case_id(n,'4000'),pg_temp.signal_case_id(n,'3000'),pg_temp.signal_case_id(n,'5000'),pg_temp.signal_case_id(n,'6000'),'Signal fixture '||n,'fixture:source-'||n,'fixture:destination-'||n,true);
end;$$;
create function pg_temp.signal_dispatch_input(n integer,k text default 'one',rev integer default 1,kind_value text default 'MESSAGE') returns text language sql as $$
select jsonb_build_object('version',1,'mode','SYNTHETIC','tenant_id',pg_temp.signal_case_id(n,'2000'),'source_id',pg_temp.signal_case_id(n,'3000'),'message_key',k,'revision',rev,'kind',kind_value,'observed_at',now()-interval '1 second','published_at',null,'reply_to',null,
 'original_text',case when kind_value in ('DELETE','RESTRICTED','UNAVAILABLE') then null else 'BUY XAUUSD LIMIT 2700.010 SL 2690.000 TP 2720.10' end,'attachments','[]'::jsonb,
 'interpretation',case when kind_value in ('DELETE','RESTRICTED','UNAVAILABLE') then 'null'::jsonb else '{"action":"OPEN","direction":"BUY","symbol":"XAUUSD","order_type":"LIMIT","entry":["2700.010"],"stop_loss":"2690.000","take_profits":["2720.10"]}'::jsonb end)::text;
$$;
create function pg_temp.signal_ack(p jsonb) returns text language sql as $$select jsonb_build_object('outcome','ACK','mode','SYNTHETIC','tenant_id',p->>'tenant_id','operation_key',p->>'operation_key','destination_ref',p->>'destination_ref','message_ref',case when p->>'operation'='SEND' then 'fake-message:'||(p->>'operation_key') else p->>'message_ref' end,'fact_hash',p->>'fact_hash','acknowledged_at',clock_timestamp())::text$$;
create function pg_temp.signal_work(n integer,outcome_value text default 'ACK',retry_value integer default null) returns jsonb language plpgsql as $$
declare l jsonb;p jsonb;t uuid:=pg_temp.signal_case_id(n,'2000');r text;begin
 l:=private.signal_claim_fixture_v1(t);if l->>'state'<>'LEASED' then return l;end if;
 p:=private.signal_begin_fixture_v1(t,(l->>'delivery_id')::uuid,(l->>'lease_token')::uuid);
 if p->>'state'<>'PREPARED' then return p;end if;
 r:=case when outcome_value='ACK' then pg_temp.signal_ack(p->'payload') else jsonb_build_object('outcome',outcome_value,'retry_after_ms',retry_value)::text end;
 return private.signal_finish_fixture_v1(t,(l->>'delivery_id')::uuid,(l->>'lease_token')::uuid,r);
end;$$;

create function pg_temp.source_caps(seq text default 'MONOTONIC_INT',rec text default 'INDEPENDENT_FAKE_HISTORY')returns text language sql as $$select jsonb_build_object('version',1,'mode','SYNTHETIC','adapter','FAKE','identity_reference','fixture:member','member_role','MEMBER','authorization','SYNTHETIC_ONLY','protected_policy','SOURCE_RESTRICTED','events',jsonb_build_array('MESSAGE','EDIT','DELETE'),'sequence',seq,'recovery',rec)::text$$;
create function pg_temp.source_setup(n integer,caps text default null)returns void language plpgsql as $$begin perform pg_temp.signal_case_setup(n);perform private.signal_source_configure_fixture_v1(pg_temp.signal_case_id(n,'2000'),pg_temp.signal_case_id(n,'3000'),coalesce(caps,pg_temp.source_caps()));end;$$;
create function pg_temp.source_command(n integer,a text,extra jsonb default '{}',cmd uuid default null,g integer default null)returns jsonb language plpgsql as $$declare r private.signal_source_runtime;begin select * into r from private.signal_source_runtime where tenant_id=pg_temp.signal_case_id(n,'2000');return private.signal_source_command_fixture_v1(r.tenant_id,r.source_id,coalesce(g,r.generation),coalesce(cmd,extensions.gen_random_uuid()),(jsonb_build_object('action',a,'epoch',r.epoch)||extra)::text);end;$$;
create function pg_temp.source_observe(n integer,q integer,k text default 'one',rev integer default 1,kind_value text default 'MESSAGE')returns jsonb language sql as $$select pg_temp.source_command(n,'OBSERVE',jsonb_build_object('sequence',q,'event',pg_temp.signal_dispatch_input(n,k,rev,kind_value)::jsonb))$$;
create function pg_temp.source_page(n integer,a integer,b integer,entries_value jsonb,complete_value boolean default true)returns jsonb language sql as $$select jsonb_build_object('version',2,'mode','SYNTHETIC','origin','INDEPENDENT_FAKE_HISTORY','tenant_id',tenant_id,'source_id',source_id,'epoch',epoch,'from',a,'to',b,'head',greatest(b,coalesce((select max(o.sequence)from private.signal_source_observations o where o.tenant_id=signal_source_runtime.tenant_id and o.source_id=signal_source_runtime.source_id),b)),'complete',complete_value,'entries',entries_value)from private.signal_source_runtime where tenant_id=pg_temp.signal_case_id(n,'2000')$$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at)
select ('51a51000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','review-fixture-'||n||'@example.test','not-used',now()from generate_series(1,5)n;
select pg_temp.source_setup(n)from generate_series(1,5)n;
insert into public.tenant_members(tenant_id,user_id,role)select pg_temp.signal_case_id(k,'2000'),('51a51000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,(array['manager','support','analyst','readonly','super_admin']::public.app_role[])[n]from generate_series(1,5)k cross join generate_series(1,5)n;
create function pg_temp.review_input(n integer,issue_value text,decision_value text,reason_value text,d uuid default null,refs jsonb default '[]')returns text language sql as $$select jsonb_build_object('version',1,'mode','SYNTHETIC','source_id',pg_temp.signal_case_id(n,'3000'),'delivery_id',d,'issue',issue_value,'decision',decision_value,'reason',reason_value,'expected_context_hash',private.signal_review_context_v1(pg_temp.signal_case_id(n,'2000'),pg_temp.signal_case_id(n,'3000'),d),'evidence',refs)::text$$;
