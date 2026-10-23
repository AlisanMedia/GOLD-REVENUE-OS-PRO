import { z } from "zod";
import {
  financialAssessmentSchema, financialAssetSchema, financialHashSchema,
  financialReferenceSchema, financialUnitsSchema, financialMoneySchema, FINANCIAL_REASONS, FINANCIAL_SOURCE_STATES,
} from "./financial-source";

// Storage contracts are deliberately separate from genuine receipt authority.
const counter = z.string().regex(/^(0|[1-9][0-9]{0,18})$/u);
const time = z.iso.datetime({ offset: true });
export const FINANCIAL_EVIDENCE_COLLECTIONS = ["observations", "assessments", "claims", "allocations", "refunds", "history"] as const;
export const financialEvidenceFenceSchema = z.strictObject({
  namespace_revision: counter, scope_revision: counter, generation: counter,
  binding_revision: counter, policy_hash: financialHashSchema, history_hash: financialHashSchema,
  prepared_at: time,
});
export const financialEvidenceSelectorsSchema = z.strictObject({
  operation_key: financialHashSchema.nullable(), physical_key: financialHashSchema.nullable(),
  delivery_key: financialHashSchema.nullable(), invoice_id: z.uuid().nullable(),
  original_operation_key: financialHashSchema.nullable(),
  kind: z.enum(["PAYMENT", "REFUND", "REFUND_REQUEST", "DISPUTE"]).nullable(),
});
export const financialEvidenceOperationSchema = z.strictObject({
  operation_key: financialHashSchema, operation_tuple: z.string().max(4096),
  provider_id: financialReferenceSchema, environment: z.enum(["FIXTURE", "SANDBOX"]),
  merchant_account_id: financialReferenceSchema,
  kind: z.enum(["PAYMENT", "REFUND", "REFUND_REQUEST", "DISPUTE"]),
  direction: z.enum(["IN", "OUT", "NONE"]), transaction_id: financialReferenceSchema,
  transfer_index: financialReferenceSchema.nullable(), asset: financialAssetSchema,
  original_operation_key: financialHashSchema.nullable(),
  physical_key: financialHashSchema.nullable(), physical_tuple: z.string().max(4096).nullable(),
});
export const financialEvidenceObservationSchema = z.strictObject({
  kind: z.enum(["CALLBACK", "INDEPENDENT_READ"]), acquisition_key: financialHashSchema,
  acquisition: z.enum(["CALLBACK", "PROVIDER_LEDGER", "CALLBACK_CACHE", "SCREENSHOT", "CLIENT", "PRECHECKOUT"]),
  source_id: financialReferenceSchema, source_record_id: financialReferenceSchema,
  delivery_id: financialReferenceSchema.nullable(), event_id: financialReferenceSchema.nullable(),
  read_acquisition_id: z.uuid().nullable(),
  authentication: z.enum(["AUTHENTICATED", "INVALID", "UNKNOWN"]),
  authentication_method: z.enum(["SYNTHETIC", "UNKNOWN"]),
  raw_hash: financialHashSchema, fact_hash: financialHashSchema.nullable(),
  source_time: time.nullable(), observed_at: time, source_revision: counter.nullable(),
  decoder_version: financialReferenceSchema,
  status: z.enum(["OK", "TIMEOUT", "RATE_LIMITED", "UNAVAILABLE", "INVALID", "UNKNOWN"]),
  complete: z.boolean(), received_units: financialUnitsSchema.nullable(),
  refunded_units: financialUnitsSchema.nullable(), asset: financialAssetSchema.nullable(),
  amount_basis: z.enum(["GROSS_CREDIT", "NET_SETTLEMENT", "GROSS_DEBIT", "BUYER_DEBIT", "UNKNOWN"]).nullable(),
  settlement_status: z.enum(["SETTLED", "PENDING", "FAILED", "REVERSED", "UNKNOWN"]).nullable(),
  confirmations: counter.nullable(), canonical: z.boolean().nullable(),
  fee: financialMoneySchema.nullable(), payout: financialMoneySchema.nullable(),
  payer_digest: financialHashSchema.nullable(), recipient_digest: financialHashSchema.nullable(),
});
export const financialEvidenceCommandSchema = z.strictObject({
  version: z.literal(1), evidence_origin: z.literal("SYNTHETIC"), financial_authority: z.literal("NONE"),
  namespace_id: z.uuid(), tenant_id: z.uuid(), binding_version_id: z.uuid(), command_id: z.uuid(),
  evaluation_series_id: z.uuid(), previous_assessment_id: z.uuid().nullable(),
  evaluation_clock: time, fence: financialEvidenceFenceSchema,
  selectors: financialEvidenceSelectorsSchema,
  source_envelope_hash: financialHashSchema, context_hash: financialHashSchema,
  operation: financialEvidenceOperationSchema.nullable(),
  observations: z.array(financialEvidenceObservationSchema).max(2),
  assessment: financialAssessmentSchema,
  effect_kind: z.enum(["NONE", "CLAIM_ONLY", "ALLOCATION_CANDIDATE", "REFUND_CORRELATION"]),
});
export type FinancialEvidenceCommand = z.infer<typeof financialEvidenceCommandSchema>;
export type FinancialEvidenceFence = z.infer<typeof financialEvidenceFenceSchema>;
export type FinancialEvidenceSelectors = z.infer<typeof financialEvidenceSelectorsSchema>;

// DB timestamps retain microseconds; never round-trip these through JS Date.
export const financialEvidenceCursorSchema = z.strictObject({
  version: z.literal(1), scope_hash: financialHashSchema, generation: counter,
  started_at: time, anchor_time: time, anchor_id: z.uuid(), after_time: time, after_id: z.uuid(),
});
export const financialEvidenceReadRequestSchema = z.strictObject({
  namespace_id: z.uuid(), tenant_id: z.uuid(),
  collection: z.enum(FINANCIAL_EVIDENCE_COLLECTIONS),
  customer_id: z.uuid().nullable().default(null), invoice_id: z.uuid().nullable().default(null),
  page_size: z.number().int().min(1).max(100).default(25),
  cursor: financialEvidenceCursorSchema.nullable().default(null),
});
export const financialEvidenceRecordedSchema = z.strictObject({
  version: z.literal(1), command_id: z.uuid(), assessment_id: z.uuid(),
  assessment_revision: counter, claim_id: z.uuid().nullable(),
  storage_outcome: z.enum(["RECORDED", "NO_NEW_EFFECT", "PENDING", "REVIEW_REQUIRED"]),
  financial_authority: z.literal("NONE"), historical: z.boolean(),
});

const readBase = { id: z.uuid(), recorded_at: time, financial_authority: z.literal("NONE"), classification: z.literal("SANDBOX") };
export const financialEvidenceReadItemSchema = z.union([
  z.strictObject({ ...readBase, kind: z.enum(["CALLBACK", "INDEPENDENT_READ"]), status: z.enum(["OK", "TIMEOUT", "RATE_LIMITED", "UNAVAILABLE", "INVALID", "UNKNOWN"]), complete: z.boolean(), received_units: financialUnitsSchema.nullable(), refunded_units: financialUnitsSchema.nullable(), asset: financialAssetSchema.nullable() }),
  z.strictObject({ ...readBase, source_state: z.enum(FINANCIAL_SOURCE_STATES), fulfillment_eligibility: z.enum(["ELIGIBLE", "PENDING", "REVIEW", "INELIGIBLE"]), storage_outcome: z.enum(["RECORDED", "NO_NEW_EFFECT", "PENDING", "REVIEW_REQUIRED"]), effect_kind: z.enum(["NONE", "CLAIM_ONLY", "ALLOCATION_CANDIDATE", "REFUND_CORRELATION"]), assessment_revision: counter, completeness: z.enum(["COMPLETE_CORROBORATED", "INCOMPLETE", "CONFLICTED", "UNVERIFIABLE"]), received_units: financialUnitsSchema.nullable(), refunded_units: financialUnitsSchema.nullable(), reasons: z.array(z.enum([...FINANCIAL_REASONS, "REVIEW_REQUIRED"])).min(1).max(8) }),
  z.strictObject({ ...readBase, kind: z.enum(["PAYMENT", "REFUND"]), units: financialUnitsSchema.nullable(), asset: financialAssetSchema }),
  z.strictObject({ ...readBase, source_state: z.enum(FINANCIAL_SOURCE_STATES) }),
]);
export const financialEvidencePageSchema = z.strictObject({
  version: z.literal(1), collection: z.enum(FINANCIAL_EVIDENCE_COLLECTIONS),
  items: z.array(financialEvidenceReadItemSchema).max(100), has_more: z.boolean(),
  next_cursor: financialEvidenceCursorSchema.nullable(), page_size: z.number().int().min(1).max(100),
  consistency: z.literal("GENERATION_FENCED_KEYSET"), financial_authority: z.literal("NONE"),
}).superRefine((page, ctx) => {
  if (page.items.length > page.page_size || page.has_more !== (page.next_cursor !== null)) ctx.addIssue({ code: "custom", message: "Incomplete page metadata" });
});
