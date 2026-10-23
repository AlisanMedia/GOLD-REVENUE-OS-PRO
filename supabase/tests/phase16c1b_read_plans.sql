-- Read-only EXPLAIN/ANALYZE on disposable fixtures. No hosted load claims.
\set ON_ERROR_STOP on
-- 321 distinct operations / 1,005 immutable assessments. Every movement is an
-- explicitly fabricated SYNTHETIC/NONE fixture; no other writer is called.
do $b$begin
 for n in 1..1005 loop
  perform private.phase16c1b_apply(private.phase16c1b_command('measure-'||((n-1)%321+1),1,'1000','PAYMENT',null,false,'unallocated'));
 end loop;
end;$b$;
analyze private.fse_assessments;
analyze private.fse_operation_claims;
analyze private.fse_observations;
analyze private.fse_history_entries;
begin;
set local statement_timeout='10s';
explain(analyze,buffers,format json)
select id,recorded_at from private.fse_assessments where namespace_id=private.phase16c1b_id('namespace') and tenant_id=private.phase16c1b_id('tenant:1') order by recorded_at desc,id desc limit 101;
explain(analyze,buffers,format json)
select claim_id,recorded_at from private.fse_operation_claims where namespace_id=private.phase16c1b_id('namespace') and tenant_id=private.phase16c1b_id('tenant:1') order by recorded_at desc,claim_id desc limit 26;
explain(analyze,buffers,format json)
select id,recorded_at from private.fse_assessments where namespace_id=private.phase16c1b_id('namespace') and tenant_id=private.phase16c1b_id('tenant:1')
 and (recorded_at,id)<(select recorded_at,id from private.fse_assessments where namespace_id=private.phase16c1b_id('namespace') and tenant_id=private.phase16c1b_id('tenant:1') order by recorded_at desc,id desc offset 500 limit 1)
 order by recorded_at desc,id desc limit 26;
explain(analyze,buffers,format json)
select private.fse_history_context(private.phase16c1b_id('namespace'),private.phase16c1b_id('tenant:1'),'{"operation_key":null,"physical_key":null,"delivery_key":null,"invoice_id":null,"original_operation_key":null,"kind":"PAYMENT"}');
explain(analyze,buffers,format json)
select * from private.fse_read_rows(private.phase16c1b_id('namespace'),private.phase16c1b_id('tenant:1'),'assessments',null,null,'manager',limit_value=>26);
select jsonb_build_object('postgres_version',current_setting('server_version'),'claim_rows',(select count(*) from private.fse_operation_claims),
 'assessment_rows',(select count(*) from private.fse_assessments),'observation_rows',(select count(*) from private.fse_observations),
 'base_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname like 'fse_%' and c.relkind='r'),
 'storage_bytes',(select sum(pg_total_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname like 'fse_%' and c.relkind='r')) as synthetic_measurement;
rollback;
