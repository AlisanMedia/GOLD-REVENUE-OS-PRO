create function pg_temp.signal_case_id(n integer,kind text) returns uuid language sql immutable as $$select ('51b0'||kind||'-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.signal_case_setup(n integer) returns void language plpgsql as $$begin
 insert into public.tenants(id,name,slug) values(pg_temp.signal_case_id(n,'2000'),'Signal fixture '||n,'signal-sandbox-dispatch-'||n);
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
