\set ON_ERROR_STOP on
begin;
\ir helpers/signal_wave_fixtures.sql
select pg_temp.signal_case_setup(901);
select private.signal_wave_configure_fixture_v1(pg_temp.signal_case_id(901,'2000'),pg_temp.signal_case_id(901,'5000'),2);
do $$begin for k in 1..1001 loop perform private.signal_record_fixture_v1(pg_temp.signal_dispatch_input(901,'plan-'||k));end loop;end;$$;
analyze private.signal_deliveries;
explain(analyze,buffers,costs off)
 select id from private.signal_deliveries
 where tenant_id='51f02000-0000-4000-8000-000000000901' and destination_id='51f05000-0000-4000-8000-000000000901' and status in('PENDING','RETRY')
 order by sequence limit 2 for update;
create temp table wave_plan_result as select private.signal_wave_prepare_fixture_v1('51f02000-0000-4000-8000-000000000901','51f05000-0000-4000-8000-000000000901')v;
select jsonb_build_object('scenario','1001_queued_independent_fixture_messages','prepared',jsonb_array_length(v->'items'),'response_bytes',octet_length(v::text),'authority','NONE')from wave_plan_result;
rollback;
