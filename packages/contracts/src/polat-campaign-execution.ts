import { z } from "zod";
import { POLAT_OPENAI_MODEL, POLAT_OPENAI_PROTOCOL } from "./polat-openai-adapter";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const money = z.string().regex(/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,18})?$/u);
const numeric = z.string().regex(/^[1-9][0-9]{0,15}$/u).refine(v => Number.isSafeInteger(Number(v)));

/** Separate campaign authority. A private-beta grant cannot satisfy this binding. */
export const polatCampaignBindingSchema = z.strictObject({
  version: z.literal(3), mode: z.literal("FOUNDER_CAMPAIGN"),
  tenant_id: z.uuid(), campaign_id: z.uuid(), provider: z.literal("openai"),
  model: z.literal(POLAT_OPENAI_MODEL), model_version: z.literal(POLAT_OPENAI_MODEL),
  protocol_version: z.literal(POLAT_OPENAI_PROTOCOL), repository_sha: z.string().regex(/^[a-f0-9]{40}$/u),
  configuration_hash: hash, account_scope_hash: hash, authorization_record_hash: hash,
  manifest_hash: hash, policy_hash: hash, credential_custody_hash: hash,
  maximum_requests: z.number().int().min(1).max(1_000_000), maximum_spend: money,
  maximum_attempt_liability: money, currency: z.literal("USD"),
  maximum_output_tokens: z.number().int().min(1).max(512), timeout_ms: z.literal(10000),
  expires_at: z.iso.datetime({ offset: true }), financial_authority: z.literal("NONE"),
});
export type PolatCampaignBinding = z.infer<typeof polatCampaignBindingSchema>;

export const polatCampaignAccountSchema = z.strictObject({
  version: z.literal(1), origin: z.literal("INDEPENDENT_CAMPAIGN_ACCOUNT_CONTROL"),
  tenant_id: z.uuid(), campaign_id: z.uuid(), binding_hash: hash,
  organization_id: z.string().regex(/^org[-_][A-Za-z0-9_-]{1,120}$/u),
  project_id: z.string().regex(/^proj_[A-Za-z0-9_-]{1,120}$/u), credential_sha256: hash,
  model_access: z.literal(true), effective_limit_kind: z.literal("ENFORCED_CAMPAIGN_HARD_CAP"),
  enforced_maximum_spend: money, independently_observed_spend: money, remaining_allowance: money,
  currency: z.literal("USD"), unknown_outcome_count: z.literal(0),
  data_policy_evidence_hash: hash, billing_evidence_hash: hash, canary_reconciliation_hash: hash,
  pricing: z.strictObject({ maximum_input_tokens: z.literal(1050000), maximum_input_usd_per_million: money,
    maximum_output_usd_per_million: money, all_billable_components_covered: z.literal(true), source_hash: hash }),
  observed_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
});

export const polatCampaignReservationSchema = z.strictObject({
  version: z.literal(1), mode: z.literal("FOUNDER_CAMPAIGN"), tenant_id: z.uuid(), campaign_id: z.uuid(),
  run_id: z.uuid(), native_run_id: z.uuid(), attempt_id: z.uuid(), job_id: z.uuid(),
  binding_hash: hash, request_hash: hash, body_hash: hash, liability: money,
  replay: z.boolean(), dispatch_started: z.boolean(),
});

export const campaignBusinessScopeSchema = z.strictObject({
  version: z.literal(1), mode: z.literal("CAMPAIGN_BUSINESS"), tenant_id: z.uuid(), campaign_id: z.uuid(),
  repository_sha: z.string().regex(/^[a-f0-9]{40}$/u), bot_id: numeric, credential_sha256: hash,
  representative_user_id: numeric, business_connection_id: z.string().min(1).max(160),
  connection_generation: z.string().regex(/^[1-9][0-9]{0,18}$/u),
  observed_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
});
