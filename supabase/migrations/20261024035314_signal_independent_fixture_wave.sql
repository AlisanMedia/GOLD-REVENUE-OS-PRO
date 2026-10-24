-- Optional synthetic-only independence policy. Default preserves accepted FIFO.
alter table private.signal_destinations add column fixture_independent_width integer not null default 1 check(fixture_independent_width in(1,2));
create function private.signal_wave_configure_fixture_v1(t uuid,d uuid,width_value integer)returns void language plpgsql set search_path=pg_catalog as $$
begin
 perform private.signal_fixture_guard(t);perform 1 from private.signal_controls where tenant_id=t for update;
 if width_value is null or width_value not in(1,2) or not exists(select 1 from private.signal_destinations where tenant_id=t and id=d)then raise exception 'SIGNAL_WAVE_POLICY_INVALID' using errcode='22023';end if;
 if exists(select 1 from private.signal_deliveries where tenant_id=t and destination_id=d and status in('PENDING','RETRY','RUNNING','UNKNOWN')limit 1)then raise exception 'SIGNAL_WAVE_PENDING_OBLIGATION' using errcode='42501';end if;
 update private.signal_destinations set fixture_independent_width=width_value,revision=revision+1 where tenant_id=t and id=d;
 insert into public.audit_logs(tenant_id,actor_type,action,entity_type,entity_id,after_data)values(t,'SYSTEM','signal.synthetic_independence_policy','signal_destination',d,jsonb_build_object('width',width_value,'mode','SYNTHETIC','financial_authority','NONE'));
end;$$;
create function private.signal_wave_prepare_fixture_v1(t uuid,d uuid)returns jsonb language plpgsql set search_path=pg_catalog as $$
declare j private.signal_deliveries;e private.signal_events;r jsonb;items_value jsonb:='[]';ids uuid[]:='{}';n integer:=0;keys_value text[]:='{}';key_value text;
begin
 perform private.signal_fixture_guard(t);
 if not pg_try_advisory_xact_lock(hashtextextended('SIGNAL_FIXTURE1:'||t::text,0))then return jsonb_build_object('version',1,'mode','SYNTHETIC','tenant_id',t,'destination_id',d,'financial_authority','NONE','live_operations_authorized',false,'state','BUSY','items','[]'::jsonb);end if;
 perform 1 from private.signal_controls where tenant_id=t and enabled for update;
 if not found then return jsonb_build_object('version',1,'mode','SYNTHETIC','tenant_id',t,'destination_id',d,'financial_authority','NONE','live_operations_authorized',false,'state','PAUSED','items','[]'::jsonb);end if;
 perform 1 from private.signal_destinations where tenant_id=t and id=d and not paused and fixture_independent_width=2 for update;
 if not found then return jsonb_build_object('version',1,'mode','SYNTHETIC','tenant_id',t,'destination_id',d,'financial_authority','NONE','live_operations_authorized',false,'state','ORDERED_REQUIRED','items','[]'::jsonb);end if;
 -- Begun/unknown work is never re-emitted, including an unknown prepare COMMIT.
 if exists(select 1 from private.signal_deliveries where tenant_id=t and destination_id=d and status in('RUNNING','UNKNOWN')limit 1)then return jsonb_build_object('version',1,'mode','SYNTHETIC','tenant_id',t,'destination_id',d,'financial_authority','NONE','live_operations_authorized',false,'state','RECOVERY_REQUIRED','items','[]'::jsonb);end if;
 for j in select * from private.signal_deliveries where tenant_id=t and destination_id=d and status in('PENDING','RETRY')order by sequence limit 2 for update loop
  select * into e from private.signal_events where tenant_id=t and id=j.event_id;
  key_value:=private.fse_canonical(jsonb_build_array(e.source_id,e.message_key));
  if j.status<>'PENDING' or j.available_at>clock_timestamp() or j.claims>=7 or e.kind<>'MESSAGE' or e.original#>>'{interpretation,action}' is distinct from 'OPEN' or e.original->>'reply_to' is not null
   or key_value=any(keys_value) or exists(select 1 from private.signal_message_bindings where tenant_id=t and source_id=e.source_id and message_key=e.message_key and destination_id=d)
   or private.signal_fixture_gate(j)is not null then return jsonb_build_object('version',1,'mode','SYNTHETIC','tenant_id',t,'destination_id',d,'financial_authority','NONE','live_operations_authorized',false,'state','ORDERED_REQUIRED','items','[]'::jsonb);end if;
  ids:=array_append(ids,j.id);keys_value:=array_append(keys_value,key_value);n:=n+1;
 end loop;
 if n=0 then return jsonb_build_object('version',1,'mode','SYNTHETIC','tenant_id',t,'destination_id',d,'financial_authority','NONE','live_operations_authorized',false,'state','NO_WORK','items','[]'::jsonb);end if;
 -- All validation precedes all effects. Prepare/lease/audit for the <=2 items is
 -- one transaction; no transport may start until the caller observes COMMIT.
 foreach key_value in array ids::text[] loop
  update private.signal_deliveries set status='RUNNING',claims=claims+1,dispatch_started=false,lease_token=extensions.gen_random_uuid(),lease_until=clock_timestamp()+interval '30 seconds',last_code='CLAIMED',last_result_hash=null where id=key_value::uuid and tenant_id=t returning * into j;
  perform private.signal_fixture_history(j,'CLAIMED');
  r:=private.signal_begin_fixture_v1(t,j.id,j.lease_token);
  if r->>'state'<>'PREPARED' or r#>>'{payload,operation}'<>'SEND' then raise exception 'SIGNAL_WAVE_FENCED' using errcode='40001';end if;
  items_value:=items_value||jsonb_build_array(jsonb_build_object('delivery_id',j.id,'lease_token',j.lease_token,'payload',r->'payload'));
 end loop;
 update private.signal_destinations set last_scheduled_at=clock_timestamp()where tenant_id=t and id=d;
 return jsonb_build_object('version',1,'mode','SYNTHETIC','tenant_id',t,'destination_id',d,'financial_authority','NONE','live_operations_authorized',false,'state','PREPARED','items',items_value);
end;$$;
revoke all on function private.signal_wave_configure_fixture_v1(uuid,uuid,integer),private.signal_wave_prepare_fixture_v1(uuid,uuid)from public,anon,authenticated,service_role;
