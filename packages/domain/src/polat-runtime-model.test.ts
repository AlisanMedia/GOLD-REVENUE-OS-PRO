import { describe, expect, it } from "vitest";
import { createPolatOfflineRuntimeModel, polatOfflineRuntimeProvider, polatOfflineRuntimeEvidence } from "./polat-runtime-model";
import { polatClaudeCompleteEnvelope } from "../../../tests/helpers/polat-bridge-fixtures";
import { preparePolatConversation } from "./polat-conversation";
import { polatFixture } from "./polat-conversation.fixtures";
function fixture() {
  const request = preparePolatConversation(polatFixture("Hi", "en")).request;
  const config = { version: 1, mode: "OFFLINE_SYNTHETIC", tenant_id: request.context.tenantId, conversation_id: request.context.conversationId, frames: [{ adapter_version: "polat-claude-messages-v1", model: "claude-haiku-5-5", maximum_output_tokens: 512, timeout_ms: 100, frame: { kind: "HTTP", status: 200, body: JSON.stringify(polatClaudeCompleteEnvelope()) } }] };
  return { request, config };
}
describe("module-owned offline runtime model capability", () => {
  it("passes the actual decoded response and keeps fake usage distinct from billing", async () => {
    const s=fixture(),cap=createPolatOfflineRuntimeModel(s.config),p=polatOfflineRuntimeProvider(cap,s.config.tenant_id,s.config.conversation_id),r=await p.invoke(s.request);
    expect(r.providerRequestId).toBe("msg_bridge_fixture_001");expect(r.output.proposed_response).toContain("Polat's AI assistant");expect(r.usage.billedAmount).toBeNull();expect(polatOfflineRuntimeEvidence(cap)).toMatchObject({calls:1,consumed:1,external_requests:0});await expect(p.invoke(s.request)).rejects.toThrow("BUDGET_DENIED");
  });
  it("JSON, arbitrary providers and foreign scopes cannot acquire a capability", () => {
    const s=fixture(),cap=createPolatOfflineRuntimeModel(s.config);expect(()=>polatOfflineRuntimeProvider({kind:"POLAT_OFFLINE_RUNTIME_MODEL"},s.config.tenant_id,s.config.conversation_id)).toThrow("CAPABILITY_DENIED");expect(()=>polatOfflineRuntimeProvider(cap,"91cc1000-0000-4000-8000-000000000002",s.config.conversation_id)).toThrow();expect(()=>createPolatOfflineRuntimeModel({...s.config,mode:"LIVE"})).toThrow();
  });
  it("a failed or concurrent attempt consumes its bounded fixture and cannot regenerate", async () => {
    const s=fixture();s.config.frames[0]!.frame.status=500;const cap=createPolatOfflineRuntimeModel(s.config),p=polatOfflineRuntimeProvider(cap,s.config.tenant_id,s.config.conversation_id),r=await Promise.allSettled([p.invoke(s.request),p.invoke(s.request)]);expect(r.every(x=>x.status==="rejected")).toBe(true);expect(polatOfflineRuntimeEvidence(cap)).toMatchObject({calls:1,consumed:1});
  });
});
