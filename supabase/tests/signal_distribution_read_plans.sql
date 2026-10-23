-- Actual synthetic read plans; never a production throughput/capacity claim.
begin read only;
set local statement_timeout='10s';
explain(analyze,buffers) select id from private.signal_deliveries
where tenant_id='51b02000-0000-4000-8000-000000000104' and destination_id='51b05000-0000-4000-8000-000000000104'
 and status in ('PENDING','RETRY','RUNNING','UNKNOWN') order by sequence limit 1;
-- Operator detail supplies a delivery ID; do not add an unbounded tenant feed.
select id as selected_delivery from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000104' order by sequence limit 1 \gset
explain(analyze,buffers) select sequence,code from private.signal_delivery_history
where tenant_id='51b02000-0000-4000-8000-000000000104' and delivery_id=:'selected_delivery'::uuid order by sequence desc limit 25;
select jsonb_build_object('classification','SYNTHETIC','deep_fixture_jobs',(select count(*) from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000104'),
 'maximum_private_claim_bytes',(select max(octet_length(jsonb_build_object('state','LEASED','mode','SYNTHETIC','tenant_id',tenant_id,'delivery_id',id,'lease_token',lease_token,'claim',claims,'drained',32,'has_more',true)::text)) from private.signal_deliveries where tenant_id='51b02000-0000-4000-8000-000000000104'),
 'source_body_in_claim',false,'production_capacity','UNVERIFIED');
commit;
