-- PostgreSQL fixtures only. These are not genuine account, spending or billing proofs.
\ir private_beta_uat_fixtures.sql
create function pg_temp.beta_openai_envelope(n integer)returns jsonb language plpgsql as $$
declare x private.private_beta_programs;at_value timestamptz:=clock_timestamp();payload jsonb;pricing jsonb;begin
 select * into strict x from private.private_beta_programs where id=pg_temp.beta_id(n,'3000');
 payload:=jsonb_build_object('version',2,'origin','INDEPENDENT_ACCOUNT_CONTROL','program_id',x.id,'tenant_id',x.tenant_id,
 'organization_id','org-fixture-'||n,'project_id','proj_fixture_'||n,'account_scope_hash',private.fse_hash(private.fse_canonical(jsonb_build_array('OPENAI_PROJECT1','org-fixture-'||n,'proj_fixture_'||n))),
 'credential_sha256',repeat('1',64),'repository_sha',x.configuration->>'repository_sha','manifest_hash',x.manifest_hash,'authorization_record_hash',x.authorization_record_hash,
 'provider','openai','model','gpt-6.1-sol','model_access',true,'policy_hash',repeat('b',64),'credential_custody_hash',repeat('c',64),'region_evidence_hash',repeat('d',64),'retention_evidence_hash',repeat('e',64),'training_evidence_hash',repeat('f',64),
 'effective_limit_kind','ENFORCED_EXPERIMENT_HARD_CAP','currency','USD','enforced_maximum_spend','5.00','independently_observed_spend','0','remaining_allowance','5.00','billing_state','RECONCILED','billing_evidence_hash',repeat('b',64),
 'canary_reconciliation_hash',null,'unknown_outcome_count',0,'request_bound',null,'observed_at',at_value,'expires_at',at_value+interval '4 minutes');
 pricing:=jsonb_build_object('version',2,'origin','INDEPENDENT_OFFICIAL_PRICING_READ','model','gpt-6.1-sol','currency','USD','source_url','https://developers.openai.com/api/docs/pricing','source_hash',repeat('a',64),
 'maximum_input_tokens',1050000,'maximum_input_usd_per_million','4.00','maximum_output_usd_per_million','15.00','observed_at',at_value,'expires_at',at_value+interval '1 day','all_billable_components_covered',true);
 return jsonb_build_object('payload',payload,'pricing',pricing);end;$$;
