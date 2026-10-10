import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type ProviderModule = typeof import("../../apps/web/src/lib/agent-runtime/providers/openai-responses");
let OpenAIResponsesProvider: ProviderModule["OpenAIResponsesProvider"];

const context = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  customerId: "22222222-2222-4222-8222-222222222222",
  conversationId: "33333333-3333-4333-8333-333333333333",
  lifecycleState: "REPLIED",
  contactability: "user_initiated",
  runtimeMode: "AI_ACTIVE" as const,
  profile: null,
  memory: [],
  recentMessages: [{ id: "44444444-4444-4444-8444-444444444444", direction: "inbound" as const, content: "Selam", occurredAt: "2026-09-28T00:00:00Z" }],
  recentEventTypes: ["message.received"],
};

const director = {
  primary_intent: "greeting", conversation_stage: "greeting" as const,
  response_goal: "Return the greeting briefly and invite the customer's topic.", information_gap: null,
  should_ask_question: true, should_answer_directly: false, should_sell: false,
  should_wait: false, should_escalate: false, desired_response_length: "short" as const,
  desired_style_profile: "casual" as const,
};

const styleProfile = {
  formality: "casual" as const, preferred_message_length: "short" as const,
  emoji_tolerance: "low" as const, jargon_level: "low" as const, language: "tr",
  response_energy: "medium" as const, confidence: 0.7,
  provenance: "bounded_conversation_inference" as const,
};

const versions = {
  prompt: "conversation-quality-prompt-v24", director: "conversation-director-v4",
  renderer: "natural-renderer-v5", qa: "conversation-qa-v29", context: 3,
  outputSchema: 4, evaluationSet: "phase7-balanced-v30",
} as const;

const validOutput = {
  classification: "greeting",
  semantic_response: { response_goal: director.response_goal, key_points: ["Greet briefly"], factual_grounding: { classification: "inferred", evidence_refs: ["EVIDENCE_CURRENT_MESSAGE"], missing_information: [] } },
  proposed_response: "Selam! Nasıl yardımcı olabilirim?",
  confidence: 0.8,
  escalation_recommended: false,
  escalation_category: null,
  memory_proposals: [],
  proposed_tool_calls: [],
  claims: [
    { text: "Selam!", kind: "social", speech_act: "ACKNOWLEDGEMENT", capability: null, grounding: "GENERAL_SAFE_STATEMENT", evidence_refs: [], action_category: null },
    { text: "Nasıl yardımcı olabilirim?", kind: "question", speech_act: "QUESTION", capability: null, grounding: "GENERAL_SAFE_STATEMENT", evidence_refs: [], action_category: null },
  ],
};

function request() {
  return { requestId: "run-1", systemPolicy: "safe", context, timeoutMs: 1000, outputSchemaVersion: 4 as const, director, styleProfile, versions };
}

beforeAll(async () => {
  ({ OpenAIResponsesProvider } = await import("../../apps/web/src/lib/agent-runtime/providers/openai-responses"));
});

describe("OpenAI Responses provider adapter", () => {
  it("uses structured outputs, disables storage and maps usage/request metadata", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.store).toBe(false);
      expect((body.input as Array<{ role: string }>).map((item) => item.role)).toEqual(["developer", "user"]);
      expect(body.text).toMatchObject({ format: { type: "json_schema", strict: true } });
      expect(body.text).toMatchObject({ format: { schema: { properties: { proposed_tool_calls: { maxItems: 0 } } } } });
      expect(JSON.stringify(body.input)).toContain("The current source-anchored turn requires language tr");
      expect(JSON.stringify(body.input)).toContain("never an outbound assistant-message handle");
      const input = body.input as Array<{ role: string; content: Array<{ text: string }> }>;
      const userInput = JSON.parse(input.find((item) => item.role === "user")!.content[0].text) as { source_message: unknown };
      expect(userInput.source_message).toEqual({ evidence_handle: "EVIDENCE_CURRENT_MESSAGE", direction: "inbound", content: "Selam", occurredAt: context.recentMessages[0].occurredAt });
      expect(JSON.stringify(body.input)).not.toContain(context.tenantId);
      expect(JSON.stringify(body.input)).not.toContain(context.recentMessages[0].id);
      expect(JSON.stringify(body.text)).toContain('"enum":["EVIDENCE_CURRENT_MESSAGE"]');
      expect(String(init?.headers && (init.headers as Record<string, string>).authorization)).toContain("test-key");
      return new Response(JSON.stringify({
        id: "resp_1", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(validOutput) }] }],
        usage: { input_tokens: 10, output_tokens: 7, total_tokens: 17 },
      }), { status: 200, headers: { "x-request-id": "req_1" } });
    });
    const provider = new OpenAIResponsesProvider("test-key", "test-model", fetchMock);
    await expect(provider.invoke(request())).resolves.toMatchObject({
      provider: "openai", model: "test-model", providerRequestId: "req_1",
      usage: { inputTokens: 10, outputTokens: 7, totalTokens: 17 },
      output: { proposed_response: validOutput.proposed_response },
    });
  });

  it.each(["conversation.reply", "message.create_draft", "payment.confirm"])("rejects executable proposal %s before completion, without retry", async (name) => {
    const output = { ...validOutput, proposed_tool_calls: [{ name, version: 1, arguments: {} }] };
    const provider = new OpenAIResponsesProvider("test-key", "test-model", async () => new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 }));
    await expect(provider.invoke(request())).rejects.toMatchObject({ kind: "INVALID_OUTPUT", retryable: false, code: "PHASE7_TOOL_PROPOSAL_NOT_ALLOWED" });
  });

  it("maps retryable rate limits and honors Retry-After", async () => {
    const provider = new OpenAIResponsesProvider("test-key", "test-model", async () => new Response(
      JSON.stringify({ error: { code: "rate_limit_exceeded", type: "rate_limit_error" } }),
      { status: 429, headers: { "retry-after": "2" } },
    ));
    await expect(provider.invoke(request())).rejects.toMatchObject({ kind: "RATE_LIMIT", retryable: true, retryAfterMs: 2000 });
  });

  it.each(["invented-uuid", "source_message:44444444-4444-4444-8444-444444444444", context.recentMessages[0].id])("rejects non-registry evidence %s without retrying", async (ref) => {
    const output = { ...validOutput, claims: validOutput.claims.map((claim) => ({ ...claim, evidence_refs: [ref] })) };
    const provider = new OpenAIResponsesProvider("test-key", "test-model", async () => new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 }));
    await expect(provider.invoke(request())).rejects.toMatchObject({ kind: "INVALID_OUTPUT", retryable: false, message: "EVIDENCE_REFERENCE_NOT_ALLOWED" });
  });

  it.each(["EVIDENCE_CURRENT_MESSAGE", "EVIDENCE_MESSAGE_1"])("constrains customer attribution to inbound evidence: %s", async (reference) => {
    const outbound = { ...context.recentMessages[0], id: "55555555-5555-4555-8555-555555555555", direction: "outbound" as const, content: "Previous assistant reply" };
    const mixedContext = { ...context, recentMessages: [outbound, ...context.recentMessages] };
    const output = { ...validOutput, claims: [{ ...validOutput.claims[0], text: "You said hello.", kind: "fact", speech_act: "CUSTOMER_REPORTED_FACT", grounding: "CUSTOMER_REPORTED", evidence_refs: [reference] }] };
    const provider = new OpenAIResponsesProvider("test-key", "test-model", async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const variants = body.text.format.schema.properties.claims.items.anyOf;
      const customer = variants.find((variant: { properties: { grounding: { enum: string[] } } }) => variant.properties.grounding.enum.includes("CUSTOMER_REPORTED"));
      expect(customer.properties.evidence_refs.items.enum).toEqual(["EVIDENCE_CURRENT_MESSAGE"]);
      expect(customer.properties.evidence_refs.minItems).toBe(1);
      expect(variants.every((variant: { required: string[]; additionalProperties: boolean }) => variant.additionalProperties === false && variant.required.includes("evidence_refs"))).toBe(true);
      expect(variants.find((variant: { properties: { grounding: { enum: string[] } } }) => variant.properties.grounding.enum.includes("INFERRED")).properties.evidence_refs.items.enum).toEqual(["EVIDENCE_MESSAGE_1", "EVIDENCE_CURRENT_MESSAGE"]);
      return new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 });
    });
    const invocation = provider.invoke({ ...request(), context: mixedContext });
    if (reference === "EVIDENCE_CURRENT_MESSAGE") expect((await invocation).output.claims[0].evidence_refs).toEqual([context.recentMessages[0].id]);
    else await expect(invocation).rejects.toMatchObject({ kind: "INVALID_OUTPUT", retryable: false, message: "EVIDENCE_REFERENCE_NOT_ALLOWED" });
  });

  it("sends a dedicated final developer instruction only for the bounded QA rewrite", async () => {
    const original = { ...validOutput, semantic_response: { ...validOutput.semantic_response, factual_grounding: { ...validOutput.semantic_response.factual_grounding, evidence_refs: [context.recentMessages[0].id] } }, proposed_response: "Thank you for reaching out. What can I help you with?" };
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.input.map((item: { role: string }) => item.role)).toEqual(["developer", "user", "developer"]);
      const directive = body.input.at(-1).content[0].text;
      expect(directive).toContain("THIS REQUEST IS THE SINGLE QA REWRITE");
      expect(directive).toContain("NATURALNESS_GRAMMAR");
      expect(directive).toContain("NATURALNESS_REDUNDANT_CLARIFICATION");
      expect(directive).toContain("correct subject-verb agreement");
      expect(directive).toContain("QA reason codes: ROBOTIC_LANGUAGE, REPETITION");
      expect(directive).toContain("not a fresh generation");
      expect(directive).toContain("do not copy the old sentence or only change punctuation");
      expect(directive).toContain(JSON.stringify(original.proposed_response));
      expect(directive).not.toContain(context.recentMessages[0].id);
      return new Response(JSON.stringify({ output_text: JSON.stringify(validOutput) }), { status: 200 });
    });
    await new OpenAIResponsesProvider("test-key", "test-model", fetchMock).invoke({ ...request(), rewriteFeedback: { attempt: 1, reasons: ["ROBOTIC_LANGUAGE", "REPETITION"], scores: { robotic_language: 70, context_fit: 90, tone_fit: 90, excessive_length: 0, repetition: 100, sales_pressure: 0, factual_confidence: 100, policy_risk: 0, escalation_need: 0 }, originalOutput: original } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["preference.reply_language", "conversation.explain_known"])("constrains generation capabilities and independently rejects unavailable %s", async (capability) => {
    const provider = new OpenAIResponsesProvider("test-key", "test-model", async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const variants = body.text.format.schema.properties.claims.items.anyOf;
      for (const variant of variants) expect(variant.properties.capability.anyOf[1].enum).toEqual(["conversation.reply", "conversation.prepare_review"]);
      expect(body.text.format.schema.properties.proposed_tool_calls.maxItems).toBe(0);
      return new Response(JSON.stringify({ output_text: JSON.stringify({ ...validOutput, claims: [{ ...validOutput.claims[0], capability }] }) }), { status: 200 });
    });
    await expect(provider.invoke(request())).rejects.toMatchObject({ kind: "INVALID_OUTPUT", retryable: false, message: "CAPABILITY_NOT_AVAILABLE" });
  });

  it("accepts a real reply capability for a language acknowledgement", async () => {
    const provider = new OpenAIResponsesProvider("test-key", "test-model", async () => new Response(JSON.stringify({ output_text: JSON.stringify({ ...validOutput, claims: [{ ...validOutput.claims[0], capability: "conversation.reply" }] }) }), { status: 200 }));
    expect((await provider.invoke(request())).output.claims[0]?.capability).toBe("conversation.reply");
  });

  it("resolves memory handles and retains authoritative wire evidence", async () => {
    const memory = { key: "preferred_language", value: "Turkish", classification: "inferred_preference", confidence: 0.7, provenance_evidence_refs: ["EVIDENCE_CURRENT_MESSAGE"] };
    const provider = new OpenAIResponsesProvider("test-key", "test-model", async () => new Response(JSON.stringify({ output_text: JSON.stringify({ ...validOutput, memory_proposals: [memory] }) }), { status: 200 }));
    const result = await provider.invoke(request());
    expect(result.output.memory_proposals[0]).toMatchObject({ provenance_message_ids: [context.recentMessages[0].id] });
    expect(result.evidenceResolution).toMatchObject({ resolved: true, wireOutput: { memory_proposals: [memory] }, registry: [{ handle: "EVIDENCE_CURRENT_MESSAGE", messageId: context.recentMessages[0].id }] });
  });

  it("does not retry exhausted-credit errors", async () => {
    const provider = new OpenAIResponsesProvider("test-key", "test-model", async () => new Response(
      JSON.stringify({ error: { code: "credit_balance_exhausted" } }), { status: 429 },
    ));
    await expect(provider.invoke(request())).rejects.toMatchObject({ kind: "RATE_LIMIT", retryable: false });
  });

  it("fails safely on invalid structured output", async () => {
    const provider = new OpenAIResponsesProvider("test-key", "test-model", async () => new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
    }), { status: 200 }));
    await expect(provider.invoke(request())).rejects.toMatchObject({ kind: "INVALID_OUTPUT", retryable: true });
  });

  it("never embeds credentials in the request body", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).not.toContain("test-key");
      return new Response(JSON.stringify({ output_text: JSON.stringify(validOutput) }), { status: 200 });
    });
    await new OpenAIResponsesProvider("test-key", "test-model", fetchMock).invoke(request());
  });
});
