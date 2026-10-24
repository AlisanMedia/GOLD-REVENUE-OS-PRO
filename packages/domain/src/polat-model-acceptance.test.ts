import{describe,it,expect}from "vitest";
import{polatModelAcceptanceManifest}from "./polat-model-acceptance";
import{polatModelSummarySchema}from "@gold-revenue-os/contracts";
describe("real-model readiness is a disabled proposal, not execution authority",()=>{
 it("retains exact approved synthetic corpus and zero external authorization",()=>{const m=polatModelAcceptanceManifest();expect(m.corpus_hash).toBe("a932be94ff95369905a1a92552ce61d8395b6c6a2eb0a2e7c30dedb38e78c0c9");expect(m.authorized_external_requests).toBe(0);expect(m.execution_enabled).toBe(false);expect(m.proposed_maximum_external_requests).toBe(190);expect(m.automatic_retries).toBe(0);expect(m.spending_limit).toBeNull();expect(m.provider).toBeNull();expect(m.model).toBeNull();expect(m.proposed_quality_gate.status).toBe("PROPOSED_NOT_APPROVED");expect(m.financial_authority).toBe("NONE");expect(m.commercial_verdict).toBe("NO_GO");});
 it.each(["raw_callback","provider_secret","tenant","input_prompt"])("strict summary cannot smuggle %s",key=>expect(polatModelSummarySchema.safeParse({[key]:"PRIVATE"}).success).toBe(false));
});
