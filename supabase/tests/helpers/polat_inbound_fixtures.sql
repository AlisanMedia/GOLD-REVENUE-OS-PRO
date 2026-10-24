insert into auth.users(id,email)values
 ('61b01000-0000-4000-8000-000000000001','polat-manager@example.test'),
 ('61b01000-0000-4000-8000-000000000002','polat-support@example.test'),
 ('61b01000-0000-4000-8000-000000000003','polat-analyst@example.test'),
 ('61b01000-0000-4000-8000-000000000004','polat-readonly@example.test')on conflict(id)do nothing;
create function pg_temp.polat_id(n integer,kind text)returns uuid language sql immutable as $$select ('61b0'||kind||'-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.polat_conv(n integer)returns uuid language sql stable as $$select id from public.conversations where tenant_id=pg_temp.polat_id(n,'2000')order by id limit 1$$;
create function pg_temp.polat_message(n integer,k text default '1')returns uuid language sql stable as $$select id from public.messages where tenant_id=pg_temp.polat_id(n,'2000')and provider_message_id=k and direction='inbound'$$;
create function pg_temp.polat_gen(n integer)returns bigint language sql stable as $$select generation from private.polat_conversation_controls where tenant_id=pg_temp.polat_id(n,'2000')and conversation_id=pg_temp.polat_conv(n)$$;
create function pg_temp.polat_send(n integer,k text)returns void language plpgsql as $$begin
 perform public.ingest_telegram_message(pg_temp.polat_id(n,'2000'),'fixture-update-'||n||'-'||k,k,'710000'||n,'710000'||n,null,'Synthetic',null,'Hello',null,clock_timestamp());
end;$$;
create function pg_temp.polat_setup(n integer)returns void language plpgsql as $$declare c uuid;begin
 insert into public.tenants(id,name,slug)values(pg_temp.polat_id(n,'2000'),'Polat synthetic fixture','polat-sandbox-test-'||n);
 insert into public.tenant_members(tenant_id,user_id,role)values
 (pg_temp.polat_id(n,'2000'),'61b01000-0000-4000-8000-000000000001','manager'),
 (pg_temp.polat_id(n,'2000'),'61b01000-0000-4000-8000-000000000002','support'),
 (pg_temp.polat_id(n,'2000'),'61b01000-0000-4000-8000-000000000003','analyst'),
 (pg_temp.polat_id(n,'2000'),'61b01000-0000-4000-8000-000000000004','readonly');
 perform pg_temp.polat_send(n,'1');c:=pg_temp.polat_conv(n);
 perform set_config('request.jwt.claim.sub','61b01000-0000-4000-8000-000000000001',true);
 perform public.set_conversation_runtime_mode(pg_temp.polat_id(n,'2000'),c,'AI_ACTIVE','Synthetic only',extensions.gen_random_uuid());
 perform private.polat_configure_fixture(pg_temp.polat_id(n,'2000'),c);
end;$$;
create function pg_temp.polat_prepare(n integer,k text default '1',op uuid default null,actor_value text default 'AI')returns jsonb language sql as $$select private.polat_prepare_fixture(pg_temp.polat_id(n,'2000'),pg_temp.polat_message(n,k),coalesce(op,pg_temp.polat_id(n,'9000')),pg_temp.polat_gen(n),(select source_hash from private.polat_inbound_work where tenant_id=pg_temp.polat_id(n,'2000')and message_id=pg_temp.polat_message(n,k)),private.fse_hash('Synthetic safe reply'),actor_value)$$;
create function pg_temp.polat_state(n integer,k text default '1')returns text language sql stable as $$select state from private.polat_inbound_work where tenant_id=pg_temp.polat_id(n,'2000')and message_id=pg_temp.polat_message(n,k)$$;

create function pg_temp.polat_receipt(n integer,op uuid,result_value text)returns jsonb language sql stable as $$select jsonb_build_object('version',1,'mode','SYNTHETIC','origin','FAKE','tenant_id',tenant_id,'conversation_id',conversation_id,'message_id',message_id,'operation_id',operation_id,'body_hash',body_hash,'result',result_value,'reference',case when result_value='FAKE_ACK'then 'polat-fake:'||operation_id::text end)from private.polat_response_evidence where tenant_id=pg_temp.polat_id(n,'2000')and operation_id=op and stage='PREPARED'$$;
create function pg_temp.polat_outcome(n integer,op uuid,result_value text)returns text language sql as $$select private.polat_outcome_fixture(pg_temp.polat_id(n,'2000'),op,pg_temp.polat_receipt(n,op,result_value)::text)$$;
