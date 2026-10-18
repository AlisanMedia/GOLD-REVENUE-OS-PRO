import { z } from "zod";

// Data contracts only. A valid object, status or hash never grants financial authority.
export const financialUnitsSchema = z.string().regex(/^(0|[1-9][0-9]{0,29})$/u);
export const financialHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const financialReferenceSchema = z.string().min(1).max(200).refine(validOpaqueReference);
function validOpaqueReference(value: string): boolean {
  // Reject unpaired UTF-16 surrogates without changing opaque Unicode identities.
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c === 127) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
const ref = financialReferenceSchema;
const hash = financialHashSchema;
const time = z.iso.datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)) && !/\.\d{4}/u.test(value), "Valid millisecond instant required");
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const financialAssetSchema = z.strictObject({
  kind: z.enum(["FIAT", "IN_APP", "NATIVE", "TOKEN"]), code: ref,
  network: ref.nullable(), contract: ref.nullable(), decimals: z.number().int().min(0).max(18),
}).superRefine((asset, ctx) => {
  if (asset.kind === "TOKEN" && (!asset.network || !asset.contract)) ctx.addIssue({ code: "custom", message: "Token identity incomplete" });
  if (["NATIVE", "IN_APP"].includes(asset.kind) && !asset.network) ctx.addIssue({ code: "custom", message: "Network required" });
  if (asset.kind !== "TOKEN" && asset.contract !== null) ctx.addIssue({ code: "custom", message: "Unexpected asset contract" });
  if (asset.kind === "FIAT" && asset.network !== null) ctx.addIssue({ code: "custom", message: "Fiat network not applicable" });
});
export type FinancialAsset = z.infer<typeof financialAssetSchema>;
export const financialAccountSchema = z.strictObject({ provider_id: ref, merchant_account_id: ref });
export const financialScopeSchema = z.strictObject({
  tenant_id: z.uuid(), merchant_binding_id: z.uuid(), merchant_revision: revision,
});
export const financialInvoiceBindingSchema = z.strictObject({
  invoice_id: z.uuid(), provider_invoice_id: ref.nullable(), customer_id: z.uuid(), offer_id: z.uuid(),
  product_version_id: z.uuid(), plan_version_id: z.uuid(), offer_snapshot_hash: hash,
});
export const financialOperationSchema = z.strictObject({
  kind: z.enum(["PAYMENT", "REFUND", "REFUND_REQUEST", "DISPUTE"]),
  direction: z.enum(["IN", "OUT", "NONE"]), transaction_id: ref, transfer_index: ref.nullable(),
  original_operation_key: hash.nullable(),
  physical_transfer: z.strictObject({
    ledger_id: ref, transaction_id: ref, transfer_index: ref, recipient: ref,
  }).nullable(),
}).superRefine((operation, ctx) => {
  const expected = operation.kind === "PAYMENT" ? "IN" : operation.kind === "REFUND" ? "OUT" : "NONE";
  if (operation.direction !== expected) ctx.addIssue({ code: "custom", message: "Operation direction mismatch" });
  if (operation.kind === "PAYMENT" && operation.original_operation_key !== null) ctx.addIssue({ code: "custom", message: "Payment cannot reference an original operation" });
});
export const financialMoneySchema = z.strictObject({ units: financialUnitsSchema, asset: financialAssetSchema });
export const financialFactsSchema = z.strictObject({
  account: financialAccountSchema,
  provider_invoice_id: ref.nullable(), operation: financialOperationSchema,
  received_units: financialUnitsSchema.nullable(), refunded_units: financialUnitsSchema.nullable(),
  amount_basis: z.enum(["GROSS_CREDIT", "NET_SETTLEMENT", "GROSS_DEBIT", "BUYER_DEBIT", "UNKNOWN"]),
  asset: financialAssetSchema, payer_reference: ref.nullable(), recipient_reference: ref.nullable(),
  occurred_at: time.nullable(), canonical: z.boolean().nullable(),
  confirmations: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  settlement_status: z.enum(["SETTLED", "PENDING", "FAILED", "REVERSED", "UNKNOWN"]),
  fee: financialMoneySchema.nullable(), payout: financialMoneySchema.nullable(),
}).superRefine((facts, ctx) => {
  if (facts.operation.kind === "PAYMENT" && facts.refunded_units !== null) ctx.addIssue({ code: "custom", message: "Unexpected refund amount" });
  if (facts.operation.kind === "REFUND" && facts.received_units !== null) ctx.addIssue({ code: "custom", message: "Unexpected received amount" });
  if (["REFUND_REQUEST", "DISPUTE"].includes(facts.operation.kind) && (facts.received_units !== null || facts.refunded_units !== null)) ctx.addIssue({ code: "custom", message: "Request is not a financial movement" });
});
export type FinancialFacts = z.infer<typeof financialFactsSchema>;
export const financialCallbackSchema = z.strictObject({
  delivery_id: ref, event_id: ref, raw_hash: hash, source_id: ref,
  acquisition: z.enum(["CALLBACK", "SCREENSHOT", "CLIENT", "PRECHECKOUT"]),
  authentication: z.enum(["AUTHENTICATED", "INVALID", "UNKNOWN"]),
  authentication_method: z.enum(["SYNTHETIC", "SECRET_HEADER", "HMAC", "SIGNATURE", "UNKNOWN"]),
  key_reference: ref.nullable(), source_time: time.nullable(), received_at: time,
  facts: financialFactsSchema,
});
export const financialReadSchema = z.strictObject({
  acquisition: z.enum(["PROVIDER_LEDGER", "CALLBACK_CACHE", "CLIENT"]),
  status: z.enum(["OK", "TIMEOUT", "RATE_LIMITED", "UNAVAILABLE"]),
  source_id: ref, source_record_id: ref, response_hash: hash,
  authenticated_account: financialAccountSchema.nullable(), decoder_version: ref,
  read_at: time, complete: z.boolean(), source_revision: revision.nullable(),
  facts: financialFactsSchema.nullable(),
});
export const financialSourceContractSchema = z.strictObject({
  contract_version: z.literal(1), evidence_origin: z.enum(["SYNTHETIC", "PROVIDER", "UNKNOWN"]),
  provider_environment: z.enum(["FIXTURE", "SANDBOX", "LIVE", "UNKNOWN"]),
  account: financialAccountSchema, scope: financialScopeSchema,
  invoice_binding: financialInvoiceBindingSchema.nullable(),
  callback: financialCallbackSchema.nullable(), independent_read: financialReadSchema.nullable(),
});
export type FinancialSourceContract = z.infer<typeof financialSourceContractSchema>;

// The caller must establish real server authority separately. This package has no
// authentication, persistence, provider or entitlement adapter; all results are NONE.
export const financialAssessmentContextSchema = z.strictObject({
  now: time, expected_account: financialAccountSchema, expected_scope: financialScopeSchema,
  expected_invoice: financialInvoiceBindingSchema.nullable(),
  merchant_status: z.enum(["ACTIVE", "MISSING", "REVOKED"]), merchant_approval_reference: ref.nullable(),
  expected_asset: financialAssetSchema, expected_units: financialUnitsSchema.nullable(),
  expected_basis: z.enum(["GROSS_CREDIT", "NET_SETTLEMENT", "GROSS_DEBIT"]),
  expected_payer: ref.nullable(), expected_recipient: ref.nullable(), invoice_expires_at: time.nullable(),
  policy: z.strictObject({
    version: ref, hash, source_revision: revision,
    callback_max_age_seconds: z.number().int().positive().max(86400).nullable(),
    read_max_age_seconds: z.number().int().positive().max(86400).nullable(),
    clock_skew_seconds: z.number().int().min(0).max(3600).nullable(),
    min_confirmations: z.number().int().positive().max(10000000).nullable(),
    require_canonical: z.boolean().nullable(),
    physical_transfer_required: z.boolean().nullable(),
    distinct_refund_identity_supported: z.boolean().nullable(),
  }).nullable(),
  history_complete: z.boolean(),
});
export type FinancialAssessmentContext = z.infer<typeof financialAssessmentContextSchema>;
export const FINANCIAL_SOURCE_STATES = ["PENDING", "REVIEW", "REJECTED", "SOURCE_VERIFIED"] as const;
export const FINANCIAL_REASONS = [
  "SOURCE_READY", "SCHEMA_INVALID", "CONTEXT_INVALID", "ORIGIN_UNVERIFIABLE", "SYNTHETIC_LIVE_MISMATCH",
  "AUTHORITY_UNAVAILABLE", "AUTHENTICATION_FAILED", "UNTRUSTED_SOURCE", "CALLBACK_MISSING", "REPLAY_WINDOW",
  "SOURCE_UNAVAILABLE", "SOURCE_INCOMPLETE", "SOURCE_CONFLICT", "INDEPENDENCE_MISSING", "AMOUNT_MISSING",
  "NO_ACTUAL_MOVEMENT", "ASSET_MISMATCH", "PAYER_MISMATCH", "SCOPE_MISMATCH", "MERCHANT_UNAUTHORIZED",
  "UNALLOCATED", "LATE_PAYMENT", "AMOUNT_MISMATCH", "SPLIT_UNAPPROVED", "INSUFFICIENT_FINALITY",
  "POLICY_INCOMPLETE", "SOURCE_TIME_MISSING", "SOURCE_TIME_INVALID", "SOURCE_STALE", "SOURCE_REVERSED",
  "DELIVERY_CONFLICT", "OPERATION_CONFLICT", "PHYSICAL_REUSE", "SECOND_PAYMENT", "REFUND_ORIGINAL_MISSING",
  "REFUND_TOTAL_EXCEEDED", "REFUND_PENDING", "REFUND_EFFECT_REVIEW", "HISTORY_INCOMPLETE", "HISTORY_INVALID",
] as const;
export type FinancialReason = typeof FINANCIAL_REASONS[number];
export const financialHistoryRecordSchema = z.strictObject({
  operation_key: hash, operation_tuple: z.string().max(4096), physical_key: hash.nullable(), physical_tuple: z.string().max(4096).nullable(),
  delivery_key: hash.nullable(), raw_hash: hash.nullable(), fact_hash: hash, fact_tuple: z.string().max(16384),
  tenant_key: hash, account_key: hash, invoice_key: hash.nullable(), asset_key: hash,
  kind: z.enum(["PAYMENT", "REFUND", "REFUND_REQUEST", "DISPUTE"]),
  original_operation_key: hash.nullable(), units: financialUnitsSchema.nullable(),
  source_state: z.enum(FINANCIAL_SOURCE_STATES),
});
export type FinancialHistoryRecord = z.infer<typeof financialHistoryRecordSchema>;
export type FinancialAssessment = Readonly<{
  contract_version: 1; source_state: typeof FINANCIAL_SOURCE_STATES[number];
  fulfillment_eligibility: "ELIGIBLE" | "PENDING" | "REVIEW" | "INELIGIBLE";
  financial_authority: "NONE"; classification: "SANDBOX" | "UNAVAILABLE";
  completeness: "COMPLETE_CORROBORATED" | "INCOMPLETE" | "CONFLICTED" | "UNVERIFIABLE";
  reasons: readonly FinancialReason[]; received_units: string | null; refunded_units: string | null;
  fee: z.infer<typeof financialMoneySchema> | null; payout: z.infer<typeof financialMoneySchema> | null;
  replay: boolean; assessment_hash: string | null;
  // Private evaluation history, never a browser/log/model payload or durable claim.
  history_record: FinancialHistoryRecord | null;
}>;
export const financialAssessmentSchema = z.strictObject({
  contract_version: z.literal(1), source_state: z.enum(FINANCIAL_SOURCE_STATES),
  fulfillment_eligibility: z.enum(["ELIGIBLE", "PENDING", "REVIEW", "INELIGIBLE"]),
  financial_authority: z.literal("NONE"), classification: z.enum(["SANDBOX", "UNAVAILABLE"]),
  completeness: z.enum(["COMPLETE_CORROBORATED", "INCOMPLETE", "CONFLICTED", "UNVERIFIABLE"]),
  reasons: z.array(z.enum(FINANCIAL_REASONS)).min(1).max(8),
  received_units: financialUnitsSchema.nullable(), refunded_units: financialUnitsSchema.nullable(),
  fee: financialMoneySchema.nullable(), payout: financialMoneySchema.nullable(),
  replay: z.boolean(), assessment_hash: hash.nullable(), history_record: financialHistoryRecordSchema.nullable(),
});
