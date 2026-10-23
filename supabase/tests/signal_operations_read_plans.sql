-- Same 4,098-job disposable fixture as Package B. No production load claim.
begin read only;
set local statement_timeout='10s';
explain(analyze,buffers) select id,sequence,status from private.signal_deliveries
 where tenant_id='51b02000-0000-4000-8000-000000000104' order by sequence desc limit 26;
explain(analyze,buffers) select 1 from private.signal_deliveries
 where tenant_id='51b02000-0000-4000-8000-000000000104' and status='UNKNOWN' order by sequence desc limit 10001;
select sequence as page_boundary from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000104' order by sequence desc offset 3000 limit 1 \gset
explain(analyze,buffers) select id,sequence,status from private.signal_deliveries
 where tenant_id='51b02000-0000-4000-8000-000000000104' and sequence<:'page_boundary'::bigint order by sequence desc limit 26;
explain(analyze,buffers) select id,sequence,status from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000201' order by sequence desc limit 26;
commit;
