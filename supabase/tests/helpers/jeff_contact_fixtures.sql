\ir jeff_inbound_fixtures.sql
create function pg_temp.jeff_contact_setup(n integer,scope_value text default 'REQUESTED_SUPPORT_FIXTURE')returns void language plpgsql as $$begin
 perform pg_temp.jeff_setup(n);perform private.jeff_configure_runtime_fixture(pg_temp.jeff_id(n,'2000'),pg_temp.jeff_conv(n));perform private.jeff_contact_configure_fixture(pg_temp.jeff_id(n,'2000'),pg_temp.jeff_conv(n),scope_value);
end;$$;
create function pg_temp.jeff_contact_event(n integer,k text,p jsonb,m uuid default null,e uuid default null)returns jsonb language plpgsql as $$declare r bigint;g bigint;begin
 select coalesce((select revision from private.jeff_contact_evidence where tenant_id=pg_temp.jeff_id(n,'2000')and conversation_id=pg_temp.jeff_conv(n)order by revision desc limit 1),0)into r;
 select generation into strict g from private.jeff_conversation_controls where tenant_id=pg_temp.jeff_id(n,'2000')and conversation_id=pg_temp.jeff_conv(n);
 return private.jeff_contact_record_fixture(pg_temp.jeff_id(n,'2000'),pg_temp.jeff_conv(n),jsonb_build_object('version',1,'mode','SYNTHETIC','evidence_id',coalesce(e,extensions.gen_random_uuid()),'tenant_id',pg_temp.jeff_id(n,'2000'),'conversation_id',pg_temp.jeff_conv(n),'expected_revision',r::text,'expected_generation',g::text,'source_message_id',m,'kind',k,'payload',p)::text);
end;$$;
create function pg_temp.jeff_contact_source(n integer)returns jsonb language sql as $$select public.jeff_test_contact_for_source_v1(pg_temp.jeff_id(n,'2000'),pg_temp.jeff_conv(n),(select e.id from public.domain_events e join private.jeff_conversation_controls c on c.tenant_id=e.tenant_id and c.last_inbound_id::text=e.payload->>'message_id'where e.tenant_id=pg_temp.jeff_id(n,'2000')and event_type='message.received'limit 1))$$;
create function pg_temp.jeff_contact_page(n integer,size_value integer default 25,cursor_value jsonb default null)returns jsonb language sql as $$select public.admin_jeff_contact_page_v1(pg_temp.jeff_id(n,'2000'),pg_temp.jeff_conv(n),size_value,cursor_value)$$;
