import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLeadIntelligence, conversationModelOutputSchema, directConversation, inferStyleProfile, type ModelRequest } from "../../packages/domain/src/index";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), context: vi.fn(), dispatch: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/messaging/outbound-dispatch", () => ({ dispatchQueuedTelegramMessage: mocks.dispatch }));
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
  it("runs Conversion as an internal task with no provider, tool, proposal or send",async()=>{
    const previous=mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==="claim_agent_tasks"?{error:null,data:[{task_id:"conversion-fixture",tenant_id:tenant,conversation_id:conversation,customer_id:null,source_event_id:"event-fixture",task_type:"conversion.prepare",execution_mode:"SHADOW"}]}:previous(name,args));
    const {runDeterministicWorker}=await import("../../apps/web/src/lib/agent-runtime/worker");
    const result=await runDeterministicWorker();
    expect(result.conversionTasksCompleted).toBe(1);expect(mocks.invoke).not.toHaveBeenCalled();expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.find(([n])=>n==="complete_conversion_task")![1].result_value.follow_up.delivery).toBe("none");
  });
  it("uses the single rewrite budget for an unsupported optional inference and rechecks QA",async()=>{
    mocks.invoke.mockResolvedValueOnce({...response("Late alerts can make that harder."),output:conversationModelOutputSchema.parse({...response("Late alerts can make that harder.").output,claims:[{text:"Late alerts can make that harder.",kind:"fact",grounding:"INFERRED",evidence_refs:[messageId],action_category:null}]})}).mockResolvedValueOnce(response("Hi!"));
    const {runDeterministicWorker}=await import("../../apps/web/src/lib/agent-runtime/worker");await runDeterministicWorker();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls.filter(([n])=>n==="record_quality_stage_evidence")).toHaveLength(2);
    expect(mocks.rpc.mock.calls.find(([n])=>n==="complete_quality_agent_run")![1]).toMatchObject({rewrite_count_value:1,qa_action_value:"approve"});
  });
  it("coordinates one invited qualification question through the existing Conversation/QA path",async()=>{
    const source=[{...messages[0]!,content:"Ask me one question."}];
    mocks.context.mockResolvedValue({context:{tenantId:tenant,customerId:null,conversationId:conversation,lifecycleState:null,contactability:"user_initiated",runtimeMode:"AI_ACTIVE",profile:null,memory:[],recentMessages:source,recentEventTypes:[]},manifest:{context_version:3,context_boundary_timestamp:source[0]!.occurredAt}});
    const lead=buildLeadIntelligence({messages:source,customerId:null,conversationId:conversation,sourceId:"event",observedAt:source[0]!.occurredAt,runtimeMode:"AI_ACTIVE",lifecycleState:null,contactability:"user_initiated",outboundEnabled:true});
    const previous=mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
      if(name==="claim_agent_tasks"){const result=await previous(name,args);return {...result,data:result.data.map((t:Record<string,unknown>)=>({...t,task_type:"conversation.shadow_draft"}))};}
      if(name==="phase8_qualification_for_source")return{error:null,data:lead};
      return previous(name,args);
    });
    mocks.invoke.mockResolvedValue(response(lead.next_action.question!));
    const {runDeterministicWorker}=await import("../../apps/web/src/lib/agent-runtime/worker");
    await runDeterministicWorker();
    const request=mocks.invoke.mock.calls[0]![0] as ModelRequest;
    expect(request.director?.response_goal).toBe(lead.next_action.question);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls.some(([n])=>n==="complete_quality_agent_run")).toBe(true);
    expect(mocks.rpc.mock.calls.some(([n])=>n==="complete_shadow_agent_run")).toBe(false);
  });
  it("completes a separate deterministic Lead task without a provider call or customer reply",async()=>{
    const previous=mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
      if(name==="claim_agent_tasks") return {error:null,data:[{task_id:"lead-task",tenant_id:tenant,conversation_id:conversation,customer_id:null,source_event_id:"event-fixture",task_type:"lead.intelligence",execution_mode:"SHADOW"}]};
      if(name==="phase8_task_context") return {error:null,data:{source_id:"event-fixture",observed_at:messages[0]!.occurredAt,customer_state:null,runtime_mode:"AI_ACTIVE",outbound_enabled:true,contactability:"user_initiated",prior:null}};
      return previous(name,args);
    });
    const {runDeterministicWorker}=await import("../../apps/web/src/lib/agent-runtime/worker");
    const r=await runDeterministicWorker();
    expect(r.leadTasksCompleted).toBe(1);expect(r.tasksWaitingApproval).toBe(0);
    expect(mocks.invoke).not.toHaveBeenCalled();expect(mocks.dispatch).not.toHaveBeenCalled();
    const call=mocks.rpc.mock.calls.find(([n])=>n==="complete_lead_intelligence")![1];
    expect(call.result_value.identity).toBe("unmatched");
    expect(call.result_value.next_action.delivery).toBe("proposal_only");
    expect(mocks.rpc.mock.calls.some(([n])=>n==="queue_quality_approved_reply")).toBe(false);
  });
  it("uses scoped claims on the immediate webhook path and sends only a DB-authorized QA reply", async () => {
    const previous = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_conversation_reply_tasks") return previous("claim_agent_tasks", args);
      if (name === "complete_quality_agent_run") return { error: null, data: { proposal_id: "proposal-fixture" } };
      if (name === "queue_quality_approved_reply") return { error: null, data: { queued: true, message_id: "message-fixture" } };
      return previous(name, args);
    });
    mocks.invoke.mockResolvedValue(response("Hi! What would you like to know?"));
    const { runDeterministicWorker } = await import("../../apps/web/src/lib/agent-runtime/worker");
    await runDeterministicWorker({ conversation: { tenantId: tenant, conversationId: conversation } });
    expect(mocks.rpc.mock.calls.find(([name]) => name === "claim_conversation_reply_tasks")![1]).toMatchObject({ target_tenant_id: tenant, target_conversation_id: conversation });
    expect(mocks.dispatch).toHaveBeenCalledWith({ tenantId: tenant, messageId: "message-fixture", automatic: true });
  });
  it("does not request automatic delivery for a QA-blocked draft", async () => {
    mocks.invoke.mockResolvedValue(response("I understand. I understand."));
    const { runDeterministicWorker } = await import("../../apps/web/src/lib/agent-runtime/worker");
    await runDeterministicWorker();
    expect(mocks.rpc.mock.calls.some(([name]) => name === "queue_quality_approved_reply")).toBe(false);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("persists the live denial without receipt failures and never sends the genuine dispute", async () => {
    const source = [{ ...messages[0]!, content: "I paid for the membership, but I still do not have access. What should I do?" }];
    mocks.context.mockResolvedValue({ context: { tenantId: tenant, customerId: null, conversationId: conversation, lifecycleState: null, contactability: "user_initiated", runtimeMode: "AI_ACTIVE", profile: null, memory: [], recentMessages: source, recentEventTypes: [] }, manifest: { context_version: 3, context_boundary_timestamp: messages[0]!.occurredAt } });
    const generated = response("I’m sorry you’re having this issue. I haven’t verified your payment or access, so this needs human review.");
    generated.output.claims = generated.output.claims.map(c => ({ ...c, kind: "uncertainty", speech_act: "KNOWLEDGE_LIMITATION", grounding: "UNKNOWN" }));
    mocks.invoke.mockResolvedValue(generated);
    const { runDeterministicWorker } = await import("../../apps/web/src/lib/agent-runtime/worker");
    await runDeterministicWorker();
    const completion = mocks.rpc.mock.calls.find(([name]) => name === "complete_quality_agent_run")![1];
    expect(completion.qa_action_value).toBe("block");
    expect(completion.qa_reasons_value).toContain("ESCALATION_REQUIRED");
    expect(completion.qa_reasons_value).not.toContain("ACTION_RECEIPT_REQUIRED");
    const stage = mocks.rpc.mock.calls.find(([name]) => name === "record_quality_stage_evidence")![1];
    expect(stage.evidence_value.evaluation.grounding.action_receipt_failures).toEqual([]);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "queue_quality_approved_reply")).toBe(false);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

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
