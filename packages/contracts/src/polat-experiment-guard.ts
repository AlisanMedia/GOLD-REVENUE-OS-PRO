import { z } from "zod";
import { polatProposedSpendSchema } from "./polat-model-acceptance";
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const decimal = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/u).refine(s => s.replace('.', '').length <= 30);
export const polatSyntheticCostSchema = z.strictObject({ amount: decimal, currency: z.string().regex(/^[A-Z]{3}$/u), basis: z.literal("SIMULATED_RECONCILED_BILLING"), evidence_hash: hash });
export const polatGuardPolicySchema = z.strictObject({
    version: z.literal(1), mode: z.literal("OFFLINE_SYNTHETIC"), repository_sha: z.string().regex(/^[a-f0-9]{40}$/u), manifest_hash: hash,
    corpus_version: z.literal("polat-multiturn-v2"), corpus_hash: hash, provider: z.literal("mock"), model: z.literal("polat-fixture-v1"), model_version: z.string().min(1).max(80),
    account_state: z.enum(["SIMULATED_ENFORCED", "UNKNOWN", "UNAVAILABLE"]), account_cap_evidence_hash: hash.nullable(), account_cap_amount: polatProposedSpendSchema.nullable(), policy_evidence_hash: hash,
    valid_until: z.iso.datetime({ offset: true }), simulation_request_limit: z.number().int().min(1).max(290), timeout_ms: z.number().int().min(1).max(1000),
    maximum_attempt_liability: polatProposedSpendSchema, currency: z.string().regex(/^[A-Z]{3}$/u),
    financial_authority: z.literal("NONE"), live_operations_authorized: z.literal(false), authorized_external_requests: z.literal(0), execution_enabled: z.literal(false),
});
export type PolatGuardPolicy = z.infer<typeof polatGuardPolicySchema>;
export const polatOfflineTransportScriptSchema = z.strictObject({
    output_mutation: z.enum(["NONE", "UNSUPPORTED_PAYMENT_CLAIM"]).default("NONE"), status: z.enum(["SUCCESS", "TIMEOUT", "RATE_LIMITED", "INVALID_OUTPUT", "PROVIDER_ERROR", "UNKNOWN"]), delay_ms: z.number().int().min(0).max(1000).default(0), ignore_abort: z.boolean().default(false),
    usage: z.strictObject({ input_tokens: z.number().int().min(0).max(2147483647).nullable(), output_tokens: z.number().int().min(0).max(2147483647).nullable(), total_tokens: z.number().int().min(0).max(2147483647).nullable() }).default({ input_tokens: null, output_tokens: null, total_tokens: null }),
    pricing_estimate: z.strictObject({ amount: decimal, currency: z.string().regex(/^[A-Z]{3}$/u), basis: z.literal("SIMULATED_PRICING_ESTIMATE") }).nullable().default(null),
    billed_cost: polatSyntheticCostSchema.nullable().default(null), reported_model: z.string().max(100).nullable().default(null),
}).superRefine((s, c) => {
    if (s.usage.total_tokens !== null && s.usage.input_tokens !== null && s.usage.output_tokens !== null && s.usage.total_tokens !== s.usage.input_tokens + s.usage.output_tokens)
        c.addIssue({ code: "custom", message: "USAGE_TOTAL_MISMATCH" });
});
export type PolatOfflineScript = z.infer<typeof polatOfflineTransportScriptSchema>;
export const POLAT_GUARD_STOP_REASONS = ["REQUEST_LIMIT_REACHED", "BUDGET_EXHAUSTED", "BILLING_UNKNOWN", "COST_BOUND_BREACH", "CURRENCY_MISMATCH", "RESULT_UNKNOWN", "POLICY_DRIFT", "POLICY_UNAVAILABLE", "OWNER_CANCELLED", "MODEL_MISMATCH", "CLOCK_INVALID", "UNSETTLED_ATTEMPT", "QA_REVIEW_REQUIRED", "ERROR_THRESHOLD_REACHED", "QA_THRESHOLD_REACHED"] as const;
const stop = z.enum(POLAT_GUARD_STOP_REASONS);
const base = { version: z.literal(1), mode: z.literal("OFFLINE_SYNTHETIC"), sequence: z.number().int().min(1).max(1024), previous_hash: hash.nullable(), record_hash: hash };
export const polatGuardJournalRecordSchema = z.discriminatedUnion("kind", [
    z.strictObject({ ...base, kind: z.literal("HEADER"), manifest_hash: hash, binding_hash: hash, corpus_hash: hash, repository_sha: z.string().regex(/^[a-f0-9]{40}$/u), maximum_requests: z.number().int().min(1).max(290), maximum_spend: polatProposedSpendSchema, currency: z.string().regex(/^[A-Z]{3}$/u) }),
    z.strictObject({ ...base, kind: z.literal("RESERVED"), attempt_id: z.uuid(), target_hash: hash, request_hash: hash, liability: polatProposedSpendSchema }),
    z.strictObject({ ...base, kind: z.literal("RESULT"), attempt_id: z.uuid(), status: z.enum(["SUCCEEDED", "TIMED_OUT", "RATE_LIMITED", "INVALID_OUTPUT", "PROVIDER_ERROR", "UNKNOWN"]), elapsed_ms: z.string().max(40).refine(s => s.length > 0 && Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 3600000).nullable(), observation_hash: hash.nullable(), output_hash: hash.nullable(), pricing_estimate: polatOfflineTransportScriptSchema.shape.pricing_estimate, billed_cost: polatSyntheticCostSchema.nullable(), stop_reason: stop.nullable(), qa: z.enum(["APPROVED", "HELD", "NOT_EVALUATED"]), retry: z.literal("NONE") }),
    z.strictObject({ ...base, kind: z.literal("STOP"), reason: stop }),
]);
export type PolatGuardJournalRecord = z.infer<typeof polatGuardJournalRecordSchema>;
