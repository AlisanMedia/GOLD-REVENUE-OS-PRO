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
  prompt: "conversation-quality-prompt-v2", director: "conversation-director-v1",
  renderer: "natural-renderer-v2", qa: "conversation-qa-v1", context: 2,
  outputSchema: 2, evaluationSet: "phase7-core-v2",
} as const;

const validOutput = {
  classification: "greeting",
  semantic_response: { response_goal: director.response_goal, key_points: ["Greet briefly"], factual_grounding: { classification: "inferred", evidence_refs: [context.recentMessages[0].id], missing_information: [] } },
  proposed_response: "Selam! Nasıl yardımcı olabilirim?",
  confidence: 0.8,
  escalation_recommended: false,
  escalation_category: null,
  memory_proposals: [],
  proposed_tool_calls: [],
};

function request() {
  return { requestId: "run-1", systemPolicy: "safe", context, timeoutMs: 1000, outputSchemaVersion: 2 as const, director, styleProfile, versions };
}

beforeAll(async () => {
  ({ OpenAIResponsesProvider } = await import("../../apps/web/src/lib/agent-runtime/providers/openai-responses"));
});

describe("OpenAI Responses provider adapter", () => {
  it("uses structured outputs, disables storage and maps usage/request metadata", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.store).toBe(false);
      expect(body.text).toMatchObject({ format: { type: "json_schema", strict: true } });
      expect(JSON.stringify(body.input)).toContain("style_profile.language");
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

  it("maps retryable rate limits and honors Retry-After", async () => {
    const provider = new OpenAIResponsesProvider("test-key", "test-model", async () => new Response(
      JSON.stringify({ error: { code: "rate_limit_exceeded", type: "rate_limit_error" } }),
      { status: 429, headers: { "retry-after": "2" } },
    ));
    await expect(provider.invoke(request())).rejects.toMatchObject({ kind: "RATE_LIMIT", retryable: true, retryAfterMs: 2000 });
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
