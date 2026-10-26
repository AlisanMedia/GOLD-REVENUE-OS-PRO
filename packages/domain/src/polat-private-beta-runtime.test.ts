import { describe, expect, it } from "vitest";
import { preparePolatPrivateBetaRuntime } from "./polat-private-beta-runtime";
import { preparePolatConversation, renderPolatFixture } from "./polat-conversation";
import { polatFixture } from "./polat-conversation.fixtures";

const run = "11a00000-0000-4000-8000-000000000001";
function setup(text = "Hi", language: "en" | "tr" = "en") {
  const f = polatFixture(text, language), p = preparePolatConversation(f);
  const scope = { program_id: run, participant_id: "11a00000-0000-4000-8000-000000000002", tenant_id: f.tenant_id, conversation_id: f.conversation_id, source_message_id: f.source_message_id, revision: 1, boundary: f.boundary };
  return { f, p, scope, context: { ...p.request.context } };
}
describe("native Polat private-beta profile and shared Phase7 policy", () => {
  it("uses existing contextual request/QA contracts without a fixture provider or authority", () => {
    const x = setup(), uat = preparePolatPrivateBetaRuntime(x.context, run, x.scope);
    expect(uat.request.timeoutMs).toBe(10000); expect(uat.request.outputSchemaVersion).toBe(4);
    expect(uat.request.systemPolicy).toContain("free invited-user beta");
    expect(uat.request.systemPolicy).not.toContain("SYNTHETIC fixture request");
    expect(uat.request.rewriteFeedback).toBeUndefined(); expect(uat.financial_authority).toBe("NONE");
    const output = renderPolatFixture(x.p);
    output.claims = output.claims.map(c => ({ ...c, evidence_refs: c.evidence_refs.map(id => id.replace("polat:identity:", "polat:uat:identity:")) }));
    output.semantic_response.factual_grounding.evidence_refs = output.semantic_response.factual_grounding.evidence_refs.map(id => id.replace("polat:identity:", "polat:uat:identity:"));
    expect(uat.assess(output).action).toBe("SAFE_PREVIEW");
  });
  it("assesses the provided unsafe output, never a replacement safe answer", () => {
    const x = setup(), uat = preparePolatPrivateBetaRuntime(x.context, run, x.scope), output = renderPolatFixture(x.p);
    output.proposed_response = "I'm Polat. Your payment is verified and VIP is active.";
    const result = uat.assess(output);
    expect(result.action).toBe("HOLD"); expect(result.reasons).toContain("POLAT_IMPERSONATION_OR_FAMILIARITY");
    expect(output.proposed_response).toContain("payment is verified");
  });
  it.each(["HUMAN_TAKEOVER", "PAUSED"] as const)("denies %s ownership before model preparation", mode => {
    const x = setup(); expect(() => preparePolatPrivateBetaRuntime({ ...x.context, runtimeMode: mode }, run, x.scope)).toThrow("POLAT_UAT_CONTEXT_DENIED");
  });
  it("rejects foreign tenant/conversation/source and unexpected authority keys", () => {
    const x = setup();
    for (const change of [{ tenant_id: run }, { conversation_id: run }, { source_message_id: run }, { verified: true }]) expect(() => preparePolatPrivateBetaRuntime(x.context, run, { ...x.scope, ...change })).toThrow();
  });
  it("removes completed financial/access evidence from a free private beta", () => {
    const x = setup();
    x.context.commercialEvidence = [{ id: "private-receipt", tenantId: x.f.tenant_id, conversationId: x.f.conversation_id, occurredAt: x.f.boundary, status: "completed", category: "payment_confirmed", statement: "Your payment is verified." }];
    const uat = preparePolatPrivateBetaRuntime(x.context, run, x.scope);
    expect(uat.evidence.every(e => e.category === "fact")).toBe(true); expect(JSON.stringify(uat.request)).not.toContain("private-receipt");
  });
  it("honors Turkish customer language and does not read an Admin locale", () => {
    const x = setup("Selam", "tr"), uat = preparePolatPrivateBetaRuntime(x.context, run, x.scope);
    expect(uat.request.styleProfile?.language).toBe("tr"); expect(uat.evidence[0]?.statement).toBe("Ben Polat’ın yapay zekâ asistanıyım.");
  });
  it("preserves bounded prior conversation context without invented familiarity", () => {
    const x = setup("Thanks");
    x.context.recentMessages = [{ id: run, direction: "outbound", content: "Hi! I'm Polat's AI assistant.", occurredAt: "2026-10-23T23:59:00Z" }, ...x.context.recentMessages];
    const uat = preparePolatPrivateBetaRuntime(x.context, run, x.scope);
    expect(uat.disclosureRequired).toBe(false); expect(uat.request.context.recentMessages).toHaveLength(2);
    expect(uat.request.systemPolicy).toContain("Never claim personal familiarity");
  });
});
