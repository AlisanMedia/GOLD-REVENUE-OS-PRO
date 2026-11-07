import { describe, it, expect } from "vitest";
import { jeffModelAcceptanceManifestV1 } from "./jeff-model-acceptance";
import { jeffModelSummarySchema } from "@gold-revenue-os/contracts";
describe("real-model readiness is a disabled proposal, not execution authority", () => {
    it("retains current Jeff synthetic corpus and zero external authorization", () => { const m = jeffModelAcceptanceManifestV1(); expect(m.corpus_hash).toBe("d78ff2fb3149191b82a63679ef483c0266514b21ebd2ec1e23012f2ab3ea11f6"); expect(m.authorized_external_requests).toBe(0); expect(m.execution_enabled).toBe(false); expect(m.proposed_maximum_external_requests).toBe(190); expect(m.automatic_retries).toBe(0); expect(m.spending_limit).toBeNull(); expect(m.provider).toBeNull(); expect(m.model).toBeNull(); expect(m.proposed_quality_gate.status).toBe("PROPOSED_NOT_APPROVED"); expect(m.financial_authority).toBe("NONE"); expect(m.commercial_verdict).toBe("NO_GO"); });
    it.each(["raw_callback", "provider_secret", "tenant", "input_prompt"])("strict summary cannot smuggle %s", key => expect(jeffModelSummarySchema.safeParse({ [key]: "PRIVATE" }).success).toBe(false));
});
