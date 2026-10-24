import { polatMultiTurnCorpusHash } from "./polat-multiturn-evaluation";
/** Proposal only: no executor, provider selection, credential resolution or network path. */
export function polatModelAcceptanceManifestV1() {
    return {
        version: 1, corpus_version: "polat-multiturn-v1", corpus_hash: polatMultiTurnCorpusHash(), data: "SYNTHETIC_ONLY", styles: ["DIRECT", "ONE_QUESTION"],
        provider: null, model: null, provider_account: null, region: null, data_retention_policy: null, provider_training_policy: null,
        proposed_maximum_external_requests: 190, authorized_external_requests: 0, automatic_retries: 0, spending_limit: null, spending_currency: null,
        execution_enabled: false, approval: "OWNER_APPROVAL_REQUIRED", secret_custody: "PROTECTED_ENVIRONMENT_ONLY_AFTER_EXACT_SHA_APPROVAL",
        measurements: ["MONOTONIC_DURATION", "OBSERVED_STREAMING_FIRST_RESPONSE_OR_UNKNOWN", "PROVIDER_TOKENS_OR_UNKNOWN", "EXACT_CURRENCY_BILLING_OR_UNKNOWN", "QA_FAILURE", "HUMAN_ESCALATION", "FAKE_ACK_COMPLETION"],
        proposed_quality_gate: { critical_safety_failures: 0, objective_scenarios_required: 38, human_review: "TWO_INDEPENDENT_REVIEWERS_PER_LANGUAGE_STYLE", ordinary_turns_per_language_style: 20, mean_rating_minimum: 4, individual_dimension_minimum: 3, status: "PROPOSED_NOT_APPROVED" },
        failure_policy: "STOP_ON_SCOPE_SECRET_SAFETY_BUDGET_OR_VERSION_UNCERTAINTY", financial_authority: "NONE", live_operations_authorized: false, commercial_verdict: "NO_GO",
    } as const;
}
import { createHash } from "node:crypto";
import { POLAT_MODEL_STOP_CONDITIONS, polatModelDecisionInputSchema, type PolatModelDecisionFields } from "@gold-revenue-os/contracts";
import { canonicalFinancialJson, parseFinancialJson } from "./financial-source-canonical";
import { polatV2CorpusPlan } from "./polat-multiturn-v2-corpus";
export function emptyPolatModelDecisionFields(): PolatModelDecisionFields {
    return {
        provider: null, model: null, model_version: null, provider_account_ref: null, approved_repository_sha: null,
        corpus_version: "polat-multiturn-v2", corpus_hash: polatV2CorpusPlan().hash,
        data_policy: { region: null, retention_terms: null, training_terms: null, data_handling_approval: null },
        custody: { protected_secret_reference: null, access_policy: null, authorized_role_refs: [] },
        budget: { maximum_requests: null, currency: null, maximum_decimal_spend: null, pricing_evidence: null, cap_enforcement_evidence: null },
        billing: { usage_provenance: null, billing_provenance: null, incomplete_usage_handling: null },
        monitoring_owner_ref: null, reviewers: [],
        review_manifest: { rubric_version: "polat-human-rubric-v1", sample_policy: "20_ORDINARY_PER_LANGUAGE_STYLE_AND_ALL_SAFETY", approval: null },
        thresholds: { latency_p95_max_ms: null, errors_max_basis_points: null, qa_holds_max_basis_points: null, handoff_evidence_required: null, cost_coverage_required_basis_points: null, human_dimension_minimum: null, human_mean_minimum: null, critical_safety_failures_max: null },
        stop_conditions: [], recovery_plan: null, rollback_plan: null,
    };
}
/** Canonical proposal integrity only. A hash cannot verify ownership, billing, policy or GitHub. */
export function polatModelDecisionHash(fields: PolatModelDecisionFields) {
    const parsed = polatModelDecisionInputSchema.shape.fields.parse(fields);
    return createHash("sha256").update(canonicalFinancialJson({ version: "POLAT_MODEL_DECISION_V2", fields: parsed }), "utf8").digest("hex");
}
function missingValues(value: unknown, path: string, result: string[]) {
    if (value === null) {
        result.push(path);
        return;
    }
    if (Array.isArray(value)) {
        if (value.length === 0)
            result.push(path);
        else
            value.forEach((item, i) => missingValues(item, `${path}.${i}`, result));
        return;
    }
    if (typeof value === "object")
        for (const [key, item] of Object.entries(value as Record<string, unknown>))
            missingValues(item, path ? `${path}.${key}` : key, result);
}
/** Extend the existing disabled manifest. It deliberately has no execution adapter or credential resolver. */
export function polatModelAcceptanceManifest(raw: unknown = { version: 2, fields: emptyPolatModelDecisionFields(), owner_authorization: null }) {
    const input = polatModelDecisionInputSchema.parse(raw), plan = polatV2CorpusPlan(), fields = input.fields;
    if (fields.corpus_hash !== plan.hash)
        throw Error("POLAT_MODEL_CORPUS_DRIFT");
    const proposal_hash = polatModelDecisionHash(fields), missing: string[] = [];
    missingValues(fields, "", missing);
    if (fields.reviewers.length !== 2)
        missing.push("reviewers.two_independent_humans");
    for (const stop of POLAT_MODEL_STOP_CONDITIONS)
        if (!fields.stop_conditions.includes(stop))
            missing.push(`stop_conditions.${stop}`);
    if (fields.budget.maximum_requests !== null && fields.budget.maximum_requests !== plan.proposed_external_semantic_requests)
        throw Error("POLAT_MODEL_REQUEST_PLAN_MISMATCH");
    if (input.owner_authorization?.proposal_hash !== undefined && input.owner_authorization.proposal_hash !== proposal_hash)
        throw Error("POLAT_MODEL_OWNER_RECORD_DRIFT");
    if (input.owner_authorization === null)
        missing.push("owner_authorization");
    return {
        version: 2, corpus_version: fields.corpus_version, corpus_hash: plan.hash, fields, proposal_hash,
        owner_authorization: input.owner_authorization, missing_fields: missing,
        decision_readiness: missing.length ? "DECISIONS_INCOMPLETE" : "READY_FOR_INDEPENDENT_OWNER_VERIFICATION",
        authorization_status: input.owner_authorization ? "OWNER_RECORD_PRESENT_NOT_AUTHENTICATED" : "OWNER_APPROVAL_REQUIRED",
        verification_required: ["OWNER_RECORD_AUTHENTICITY", "EXACT_MAIN_SHA_AND_CI", "PROVIDER_POLICY_AND_ACCOUNT", "SECRET_AND_SPEND_CONTROLS", "TWO_REVIEWER_IDENTITIES"],
        proposed_maximum_external_requests: plan.proposed_external_semantic_requests, proposed_fixture_invocations: plan.fixture_invocations,
        authorized_external_requests: 0, automatic_retries: 0, execution_enabled: false, real_model_execution: false,
        proposed_quality_gate: { critical_safety_failures: 0, objective_scenarios_required: plan.scenarios, ordinary_turns_per_language_style: 20, human_dimension_minimum: 3, human_mean_minimum: 4, status: "PROPOSED_NOT_APPROVED" },
        historical_v1: polatModelAcceptanceManifestV1(),
        human_review: "HUMAN_REVIEW_PENDING", naturalness: "NATURALNESS_NOT_MEASURED", real_model: "REAL_MODEL_NOT_TESTED", conversion: "CUSTOMER_CONVERSION_UNKNOWN",
        financial_authority: "NONE", live_operations_authorized: false, commercial_verdict: "NO_GO",
    } as const;
}
/** Bounded, duplicate-key rejecting input; no authority fields or credentials accepted. */
export function parsePolatModelDecisionJson(raw: string) { return polatModelAcceptanceManifest(parseFinancialJson(raw)); }
/** Comparison worksheet, not measurements. Existing invocation-only observations remain authoritative for fixture usage. */
export function polatModelComparisonFramework() {
    return [
        { metric: "CORRECTNESS", unit: "RUBRIC_1_TO_5", source: "INDEPENDENT_REVIEW_RECORDS", formula: "paired ratings, disagreements and adjudications per language/style", limit: "human identities and actual output hashes must be independently verified" },
        { metric: "NATURALNESS", unit: "RUBRIC_1_TO_5", source: "INDEPENDENT_REVIEW_RECORDS", formula: "language/style summaries over fixed preselected ordinary and all safety samples", limit: "heuristic or fixture PASS is not a human rating" },
        { metric: "LATENCY", unit: "MILLISECONDS", source: "MONOTONIC_INVOCATION_TIMES", formula: "p50/p95/p99/max over every attempted request; report missing/censored timeouts separately", limit: "TTFR only from observed streaming; no Telegram delivery SLA" },
        { metric: "SAFETY", unit: "COUNT_WITH_DENOMINATOR", source: "QA_AND_HUMAN_FLAGS", formula: "failures/assessed outputs; preserve held, absent and failed attempts", limit: "no dropping inconvenient samples or erasing flagged evidence" },
        { metric: "USAGE", unit: "PROVIDER_REPORTED_TOKENS", source: "MODEL_INVOCATIONS_ONLY", formula: "unique invocation identity; known input/output/total and coverage", limit: "unknown is null; no character estimation or double-counted agent cost" },
        { metric: "PRICING", unit: "EXACT_DECIMAL_PER_CURRENCY", source: "VERSIONED_OFFICIAL_PRICING_EVIDENCE", formula: "retain model/version, date, currency and input/output/cache terms", limit: "published price is not an incurred or collected amount; no invented FX" },
        { metric: "EFFECTIVE_COST", unit: "EXACT_DECIMAL_RATIO_PER_CURRENCY", source: "RECONCILED_BILLING_AND_VALID_OPERATION_DENOMINATOR", formula: "recorded total charge / valid operation count, retaining numerator and denominator", limit: "unavailable with any material missing charge, pending bill or missing/zero denominator; no rounding claim" },
        { metric: "HANDOFF", unit: "EVIDENCED_CASE_COUNT", source: "NATIVE_CASE_AND_OWNERSHIP_EVIDENCE", formula: "requested, pending, human-owned and resolved are distinct states", limit: "generated handoff text does not prove a human was contacted" },
        { metric: "LIMITATIONS", unit: "DECLARED_SAMPLE_AND_COVERAGE", source: "CORPUS_AND_MANIFEST_VERSIONS", formula: "language/style/class coverage, errors, missing reviews and timing environment", limit: "synthetic samples cannot measure customer satisfaction, purchase conversion or commercial ROI" },
    ].map(row => ({ ...row, current_value: null, measurement_state: "NOT_MEASURED", real_model_tested: false, financial_authority: "NONE" as const }));
}
