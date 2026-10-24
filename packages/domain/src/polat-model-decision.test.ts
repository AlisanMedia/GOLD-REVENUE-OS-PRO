import { describe, it, expect } from "vitest";
import { POLAT_MODEL_STOP_CONDITIONS, polatModelDecisionInputSchema, polatProposedSpendSchema } from "@gold-revenue-os/contracts";
import { emptyPolatModelDecisionFields, polatModelAcceptanceManifest, polatModelDecisionHash, parsePolatModelDecisionJson, polatModelComparisonFramework } from "./polat-model-acceptance";
// Every value here is invented TEST validation input, not an actual provider/owner decision.
const evidence = (n = 1) => ({ reference: `fixture-evidence-${n}`, sha256: String(n).repeat(64) });
function completeFixture() {
    const fields = emptyPolatModelDecisionFields();
    Object.assign(fields, { provider: "fixture-not-selected", model: "fictional-test-model", model_version: "fixture-version", provider_account_ref: "fixture-account", approved_repository_sha: "a".repeat(40), monitoring_owner_ref: "fixture-monitor" });
    fields.data_policy = { region: "fixture-region", retention_terms: evidence(), training_terms: evidence(), data_handling_approval: evidence() };
    fields.custody = { protected_secret_reference: "fixture-secret-reference-NO-VALUE", access_policy: evidence(), authorized_role_refs: ["fixture-test-operator"] };
    fields.budget = { maximum_requests: 290, currency: "USD", maximum_decimal_spend: "1.000000000000000001", pricing_evidence: evidence(), cap_enforcement_evidence: evidence() };
    fields.billing = { usage_provenance: evidence(), billing_provenance: evidence(), incomplete_usage_handling: "STOP_AND_RECONCILE_UNKNOWN_COST" };
    fields.reviewers = [1, 2].map(n => ({ id: `71e02000-0000-4000-8000-00000000000${n}`, identity_evidence: evidence(n) }));
    fields.review_manifest.approval = evidence();
    fields.thresholds = { latency_p95_max_ms: 10000, errors_max_basis_points: 100, qa_holds_max_basis_points: 200, handoff_evidence_required: true, cost_coverage_required_basis_points: 10000, human_dimension_minimum: 3, human_mean_minimum: 4, critical_safety_failures_max: 0 };
    fields.stop_conditions = [...POLAT_MODEL_STOP_CONDITIONS];
    fields.recovery_plan = evidence();
    fields.rollback_plan = evidence();
    return { version: 2 as const, fields, owner_authorization: { record_reference: "SIMULATED-NOT-AUTHORIZATION", approved_by_ref: "fixture-owner", approved_at: "2026-10-24T00:00:00Z", proposal_hash: polatModelDecisionHash(fields), decision: "AUTHORIZE_CONTROLLED_SYNTHETIC_MODEL_TEST" as const } };
}
describe("existing disabled real-model manifest, versioned v2 decision pack", () => {
    it("derives v2 cap from the corpus while preserving historical v1 count and hash", () => { const m = polatModelAcceptanceManifest(); expect(m.version).toBe(2); expect(m.corpus_hash).toBe("ec2a008c1575660d9f97f9d17fb4e14956051b2f890557477e82fda611d10d4c"); expect(m.proposed_fixture_invocations).toBe(296); expect(m.proposed_maximum_external_requests).toBe(290); expect(m.historical_v1.proposed_maximum_external_requests).toBe(190); expect(m.historical_v1.corpus_hash).toBe("a932be94ff95369905a1a92552ce61d8395b6c6a2eb0a2e7c30dedb38e78c0c9"); expect(m.fields.budget.maximum_requests).toBeNull(); expect(m.authorized_external_requests).toBe(0); expect(m.decision_readiness).toBe("DECISIONS_INCOMPLETE"); expect(m.missing_fields).toContain("data_policy.region"); expect(m.missing_fields).toContain("owner_authorization"); });
    it("even a structurally complete self-declared approval grants no execution or human/model acceptance", () => { const m = polatModelAcceptanceManifest(completeFixture()); expect(m.missing_fields).toEqual([]); expect(m.decision_readiness).toBe("READY_FOR_INDEPENDENT_OWNER_VERIFICATION"); expect(m.authorization_status).toBe("OWNER_RECORD_PRESENT_NOT_AUTHENTICATED"); expect(m.execution_enabled).toBe(false); expect(m.authorized_external_requests).toBe(0); expect(m.real_model_execution).toBe(false); expect(m.naturalness).toBe("NATURALNESS_NOT_MEASURED"); expect(m.financial_authority).toBe("NONE"); expect(m.commercial_verdict).toBe("NO_GO"); });
    it("every nullable decision, nested evidence and missing set keeps decision readiness incomplete", () => {
        const base = completeFixture();
        const paths: string[][] = [];
        function collect(o: unknown, path: string[]) {
            if (o === null)
                return;
            if (Array.isArray(o)) {
                paths.push(path);
                return;
            }
            if (typeof o === "object") {
                for (const [k, v] of Object.entries(o as Record<string, unknown>))
                    collect(v, [...path, k]);
                return;
            }
            paths.push(path);
        }
        collect(base.fields, []);
        let tested = 0;
        for (const path of paths) {
            if (["corpus_version", "corpus_hash", "rubric_version", "sample_policy"].includes(path.at(-1)!))
                continue;
            const input = structuredClone(base);
            let container = input.fields as unknown as Record<string, unknown>;
            for (const key of path.slice(0, -1))
                container = container[key] as Record<string, unknown>;
            const key = path.at(-1)!, old = container[key];
            container[key] = Array.isArray(old) ? [] : null;
            if (!polatModelDecisionInputSchema.safeParse(input).success) {
                expect(() => polatModelAcceptanceManifest(input)).toThrow();
                tested++;
                continue;
            }
            input.owner_authorization.proposal_hash = polatModelDecisionHash(input.fields);
            const result = polatModelAcceptanceManifest(input);
            expect(result.decision_readiness, path.join(".")).toBe("DECISIONS_INCOMPLETE");
            expect(result.execution_enabled).toBe(false);
            tested++;
        }
        expect(tested).toBeGreaterThan(30);
    });
    it.each(["0", "0.0", "01", "1e2", "-1", "1.", ".1", "1,00", "NaN", " 1", "1.0000000000000000001", "1".repeat(31), 1, 0.01])("rejects nonexact, nonpositive or excessive budget %s", amount => expect(polatProposedSpendSchema.safeParse(amount).success).toBe(false));
    it.each(["0.000000000000000001", "999999999999999999999999999999", "999999999999.999999999999999999"])("retains exact allowed budget %s", amount => { const fields = completeFixture(); fields.fields.budget.maximum_decimal_spend = amount; fields.owner_authorization.proposal_hash = polatModelDecisionHash(fields.fields); expect(polatModelAcceptanceManifest(fields).fields.budget.maximum_decimal_spend).toBe(amount); });
    it.each([190, 289, 291, 512])("rejects silently reusing a different full-corpus request cap %s", maximum => { const input = completeFixture(); input.fields.budget.maximum_requests = maximum; input.owner_authorization.proposal_hash = polatModelDecisionHash(input.fields); expect(() => polatModelAcceptanceManifest(input)).toThrow("REQUEST_PLAN_MISMATCH"); });
    it("rejects stale corpus, changed approval hash, duplicate reviewers and smuggled authority", () => { const wrong = completeFixture(); wrong.fields.corpus_hash = "0".repeat(64); expect(() => polatModelAcceptanceManifest(wrong)).toThrow("CORPUS_DRIFT"); const drift = completeFixture(); drift.fields.model_version = "changed"; expect(() => polatModelAcceptanceManifest(drift)).toThrow("OWNER_RECORD_DRIFT"); const duplicate = completeFixture(); duplicate.fields.reviewers[1]!.id = duplicate.fields.reviewers[0]!.id; expect(polatModelDecisionInputSchema.safeParse(duplicate).success).toBe(false); const identity = completeFixture(); identity.fields.reviewers[1]!.identity_evidence = identity.fields.reviewers[0]!.identity_evidence; expect(polatModelDecisionInputSchema.safeParse(identity).success).toBe(false); expect(() => polatModelAcceptanceManifest({ ...completeFixture(), execution_enabled: true, financial_authority: "LIVE" })).toThrow(); });
    it("strict bounded JSON parser rejects duplicated authority fields and credential values", () => { const raw = JSON.stringify(completeFixture()); expect(() => parsePolatModelDecisionJson(raw.replace('{', '{"version":2,'))).toThrow(); const input = completeFixture(); input.fields.custody.protected_secret_reference = "sk-" + "x".repeat(35); expect(() => polatModelAcceptanceManifest(input)).toThrow(); expect(() => parsePolatModelDecisionJson(" ".repeat(16385))).toThrow(); });
    it("canonical hash is key-order independent and field/value sensitive", () => { const fields = completeFixture().fields, reversed = Object.fromEntries(Object.entries(fields).reverse()) as typeof fields; expect(polatModelDecisionHash(reversed)).toBe(polatModelDecisionHash(fields)); const changed = structuredClone(fields); changed.budget.maximum_decimal_spend = "1.00"; expect(polatModelDecisionHash(changed)).not.toBe(polatModelDecisionHash(fields)); });
    it("comparison framework contains source requirements and no invented performance, cost or conversion values", () => { const f = polatModelComparisonFramework(); expect(f).toHaveLength(9); expect(f.every(m => m.current_value === null && m.measurement_state === "NOT_MEASURED" && !m.real_model_tested && m.financial_authority === "NONE")).toBe(true); expect(f.find(m => m.metric === "EFFECTIVE_COST")!.limit).toContain("missing/zero denominator"); expect(f.find(m => m.metric === "USAGE")!.limit).toContain("no character estimation"); expect(f.find(m => m.metric === "NATURALNESS")!.source).toBe("INDEPENDENT_REVIEW_RECORDS"); });
    it("retains exact opaque model/version identifiers including provider-qualified slash and case", () => { const input = completeFixture(); input.fields.model = "FictionalProvider/Fixture-Model"; input.fields.model_version = "fixture/2026-10@RevisionA"; input.owner_authorization.proposal_hash = polatModelDecisionHash(input.fields); const m = polatModelAcceptanceManifest(input); expect(m.fields.model).toBe("FictionalProvider/Fixture-Model"); expect(m.fields.model_version).toBe("fixture/2026-10@RevisionA"); expect(m.execution_enabled).toBe(false); });
});
