import { z } from "zod";
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const ref = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/u).refine(v => !/^(?:sk-|gh[pousr]_|github_pat_|sb_secret_|[0-9]{8,12}:)/u.test(v), "SECRET_VALUE_NOT_A_REFERENCE");
const modelId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,119}$/u).refine(v => !/^(?:sk-|gh[pousr]_|github_pat_|sb_secret_)/u.test(v), "SECRET_VALUE_NOT_A_MODEL_ID");
const evidence = z.strictObject({ reference: ref, sha256: digest });
/** Exact proposed budget only; never a payment, billing record or execution grant. */
export const polatProposedSpendSchema = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/u)
    .refine(v => v.replace(".", "").length <= 30 && /[1-9]/u.test(v), "EXACT_POSITIVE_BUDGET_REQUIRED");
export const POLAT_MODEL_STOP_CONDITIONS = ["BUDGET_UNCERTAIN", "BILLING_INCOMPLETE", "TENANT_OR_SECRET_LEAK", "SAFETY_FAILURE", "CORPUS_OR_VERSION_DRIFT", "PROVIDER_POLICY_MISMATCH", "QA_OR_TIMEOUT_BURST"] as const;
export const polatModelDecisionFieldsSchema = z.strictObject({
    provider: ref.nullable(), model: modelId.nullable(), model_version: modelId.nullable(), provider_account_ref: ref.nullable(),
    approved_repository_sha: z.string().regex(/^[a-f0-9]{40}$/u).nullable(),
    corpus_version: z.literal("polat-multiturn-v2"), corpus_hash: digest,
    data_policy: z.strictObject({ region: ref.nullable(), retention_terms: evidence.nullable(), training_terms: evidence.nullable(), data_handling_approval: evidence.nullable() }),
    custody: z.strictObject({ protected_secret_reference: ref.nullable(), access_policy: evidence.nullable(), authorized_role_refs: z.array(ref).max(5) }),
    budget: z.strictObject({ maximum_requests: z.number().int().min(1).max(512).nullable(), currency: z.string().regex(/^[A-Z]{3}$/u).nullable(), maximum_decimal_spend: polatProposedSpendSchema.nullable(), pricing_evidence: evidence.nullable(), cap_enforcement_evidence: evidence.nullable() }),
    billing: z.strictObject({ usage_provenance: evidence.nullable(), billing_provenance: evidence.nullable(), incomplete_usage_handling: z.literal("STOP_AND_RECONCILE_UNKNOWN_COST").nullable() }),
    monitoring_owner_ref: ref.nullable(),
    reviewers: z.array(z.strictObject({ id: z.uuid(), identity_evidence: evidence.nullable() })).max(2),
    review_manifest: z.strictObject({ rubric_version: z.literal("polat-human-rubric-v1"), sample_policy: z.literal("20_ORDINARY_PER_LANGUAGE_STYLE_AND_ALL_SAFETY"), approval: evidence.nullable() }),
    thresholds: z.strictObject({ latency_p95_max_ms: z.number().int().min(1).max(3600000).nullable(), errors_max_basis_points: z.number().int().min(0).max(10000).nullable(), qa_holds_max_basis_points: z.number().int().min(0).max(10000).nullable(), handoff_evidence_required: z.literal(true).nullable(), cost_coverage_required_basis_points: z.literal(10000).nullable(), human_dimension_minimum: z.number().int().min(1).max(5).nullable(), human_mean_minimum: z.number().min(1).max(5).nullable(), critical_safety_failures_max: z.literal(0).nullable() }),
    stop_conditions: z.array(z.enum(POLAT_MODEL_STOP_CONDITIONS)).max(POLAT_MODEL_STOP_CONDITIONS.length),
    recovery_plan: evidence.nullable(), rollback_plan: evidence.nullable(),
}).superRefine((v, ctx) => {
    if (new Set(v.reviewers.map(r => r.id)).size !== v.reviewers.length || new Set(v.custody.authorized_role_refs).size !== v.custody.authorized_role_refs.length || new Set(v.stop_conditions).size !== v.stop_conditions.length || v.reviewers.some((r, i) => r.identity_evidence && v.reviewers.some((other, j) => i !== j && (other.identity_evidence?.reference === r.identity_evidence?.reference || other.identity_evidence?.sha256 === r.identity_evidence?.sha256))))
        ctx.addIssue({ code: "custom", message: "MODEL_DECISION_INDEPENDENCE_OR_DUPLICATE_INVALID" });
});
export const polatModelOwnerRecordSchema = z.strictObject({
    record_reference: ref, approved_by_ref: ref, approved_at: z.iso.datetime({ offset: true }), proposal_hash: digest,
    decision: z.literal("AUTHORIZE_CONTROLLED_SYNTHETIC_MODEL_TEST"),
});
/** A supplied approval record is unverified data, never an authenticated grant. */
export const polatModelDecisionInputSchema = z.strictObject({ version: z.literal(2), fields: polatModelDecisionFieldsSchema, owner_authorization: polatModelOwnerRecordSchema.nullable() });
export type PolatModelDecisionFields = z.infer<typeof polatModelDecisionFieldsSchema>;
