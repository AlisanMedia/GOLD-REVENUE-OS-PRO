import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationModelOutputSchema, directConversation, inferStyleProfile, type ModelRequest } from "../../packages/domain/src/index";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), context: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/agent-runtime/context-builder", () => ({ buildAgentContext: mocks.context }));
vi.mock("@/lib/agent-runtime/providers/openai-responses", () => ({ openAIProviderFromEnvironment: () => ({ provider: "openai", model: "gpt-5.4-mini", invoke: mocks.invoke }) }));

const tenant = "11111111-1111-4111-8111-111111111111";
const conversation = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";
const messages = [{ id: messageId, direction: "inbound" as const, content: "Hi", occurredAt: "2026-10-05T10:00:00Z" }];
const director = directConversation(messages, inferStyleProfile(messages));
function response(text: string, memory = false) {
  return { provider: "openai", model: "gpt-5.4-mini", providerRequestId: "unit-fixture-not-live", latencyMs: 100,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, billedAmount: null, billedCurrency: null },
    output: conversationModelOutputSchema.parse({ classification: director.primary_intent,
      semantic_response: { response_goal: director.response_goal, key_points: [text], factual_grounding: { classification: "unknown", evidence_refs: [], missing_information: [] } },
      proposed_response: text, confidence: 0.98, escalation_recommended: false, escalation_category: null, proposed_tool_calls: [],
      memory_proposals: memory ? [{ key: "language", value: "English", classification: "explicit_customer_fact", confidence: 0.9, provenance_message_ids: ["99999999-9999-4999-8999-999999999999"] }] : [],
      claims: text.split(/(?<=[.!?])\s+/u).map((part) => ({ text: part, kind: part.endsWith("?") ? "question" : "social", grounding: "GENERAL_SAFE_STATEMENT", evidence_refs: [], action_category: null })),
    }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ context: { tenantId: tenant, customerId: null, conversationId: conversation, lifecycleState: null, contactability: "user_initiated", runtimeMode: "HUMAN_TAKEOVER", profile: null, memory: [], recentMessages: messages, recentEventTypes: [] }, manifest: { context_version: 3, context_boundary_timestamp: messages[0]!.occurredAt } });
  mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "claim_event_outbox" ? [] : name === "begin_agent_run" ? "run-fixture" : name === "claim_agent_tasks" ? [{ task_id: "task-fixture", tenant_id: tenant, conversation_id: conversation, customer_id: null, source_event_id: "event-fixture", execution_mode: "SHADOW", timeout_ms: 30000, model_provider: "openai", model_name: "gpt-5.4-mini" }] : true }));
});
describe("Corrective worker integration (mocked provider, not live evidence)", () => {
  it("stores both stages and corrects repetition with exactly one rewrite", async () => {
    mocks.invoke.mockResolvedValueOnce(response("I understand. I understand.")).mockResolvedValueOnce(response("Hi! What would you like to know?"));
    const { runDeterministicWorker } = await import("../../apps/web/src/lib/agent-runtime/worker");
    const result = await runDeterministicWorker({ workerId: "unit-worker", deploymentRef: "unit-sha" });
    expect(result.tasksWaitingApproval).toBe(1); expect(mocks.invoke).toHaveBeenCalledTimes(2);
    const rewrite = mocks.invoke.mock.calls[1]![0] as ModelRequest;
    expect(rewrite.rewriteFeedback?.attempt).toBe(1);
    expect(rewrite.rewriteFeedback?.originalOutput?.proposed_response).toBe("I understand. I understand.");
    const stages = mocks.rpc.mock.calls.filter(([name]) => name === "record_quality_stage_evidence");
    expect(stages.map(([, args]) => args.sequence_value)).toEqual([1, 2]);
    expect(stages[0]![1].evidence_value.original_output.proposed_response).toBe("I understand. I understand.");
    expect(stages[1]![1].evidence_value.evaluation.action).toBe("approve");
    const completion = mocks.rpc.mock.calls.find(([name]) => name === "complete_quality_agent_run")![1];
    expect(completion.rewrite_count_value).toBe(1); expect(completion.customer_facing_blocked_value).toBe(false);
    expect(completion.input_tokens_value).toBe(20); expect(completion.output_tokens_value).toBe(10);
  });
  it("blocks a failed rewrite without a third provider call", async () => {
    mocks.invoke.mockResolvedValue(response("I understand. I understand."));
    const { runDeterministicWorker } = await import("../../apps/web/src/lib/agent-runtime/worker");
    await runDeterministicWorker({ workerId: "unit-worker" });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    const completion = mocks.rpc.mock.calls.find(([name]) => name === "complete_quality_agent_run")![1];
    expect(completion.customer_facing_blocked_value).toBe(true);
    expect(completion.qa_reasons_value).toContain("REWRITE_BUDGET_EXHAUSTED");
  });
  it("rejects the entire invalid memory proposal while preserving original evidence", async () => {
    mocks.invoke.mockResolvedValue(response("Hi! What would you like to know?", true));
    const { runDeterministicWorker } = await import("../../apps/web/src/lib/agent-runtime/worker");
    await runDeterministicWorker({ workerId: "unit-worker" });
    const stage = mocks.rpc.mock.calls.find(([name]) => name === "record_quality_stage_evidence")![1];
    expect(stage.evidence_value.original_output.memory_proposals).toHaveLength(1);
    expect(stage.evidence_value.memory_validation.rejected).toHaveLength(1);
    const completion = mocks.rpc.mock.calls.find(([name]) => name === "complete_quality_agent_run")![1];
    expect(completion.structured_output_value.memory_proposals).toEqual([]);
  });
});
