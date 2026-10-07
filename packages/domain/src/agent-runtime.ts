import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CONVERSATION_QUALITY_VERSIONS,
  conversationModelOutputSchema,
  directConversation,
  inferStyleProfile,
  renderNaturalResponse,
  type ConversationDirector,
  type ConversationModelOutput,
  type QaScores,
  type StyleProfile,
} from "./conversation-quality";

export const AGENT_EXECUTION_MODES = ["SHADOW", "HUMAN_APPROVAL", "AUTONOMOUS"] as const;
export type AgentExecutionMode = (typeof AGENT_EXECUTION_MODES)[number];

export const AGENT_RUNTIME_STATUSES = [
  "QUEUED", "RUNNING", "WAITING_FOR_APPROVAL", "SUCCEEDED", "FAILED",
  "CANCELLED", "TIMED_OUT", "DEAD_LETTER",
] as const;
export type AgentRuntimeStatus = (typeof AGENT_RUNTIME_STATUSES)[number];

export const shadowOutputSchema = z.object({
  classification: z.string().trim().min(1).max(80),
  proposed_response: z.string().trim().min(1).max(4096),
  confidence: z.number().min(0).max(1),
  escalation_recommended: z.boolean(),
  proposed_tool_calls: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    version: z.number().int().positive(),
    arguments: z.record(z.string(), z.unknown()),
  }).strict()).max(8),
}).strict();

export type ShadowOutput = z.infer<typeof shadowOutputSchema>;

export type ModelRequest = {
  requestId: string;
  systemPolicy: string;
  context: AgentContext;
  timeoutMs: number;
  outputSchemaVersion: 1 | 2 | 3 | 4;
  director?: ConversationDirector;
  styleProfile?: StyleProfile;
  versions?: typeof CONVERSATION_QUALITY_VERSIONS;
  rewriteFeedback?: { scores: QaScores; reasons: readonly string[]; attempt: number; originalOutput?: ConversationModelOutput };
};

export type ModelUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  billedAmount: number | null;
  billedCurrency: string | null;
};

export type ModelResponse = {
  evidenceResolution?: { wireOutput: unknown; registry: ReadonlyArray<{ handle: string; messageId: string; direction: string }>; resolved: true };
  output: ConversationModelOutput;
  provider: string;
  model: string;
  providerRequestId: string | null;
  latencyMs: number;
  usage: ModelUsage;
};

export type ModelFailureKind = "TIMEOUT" | "RATE_LIMIT" | "INVALID_OUTPUT" | "PROVIDER_ERROR";

export class ModelProviderError extends Error {
  constructor(
    public readonly kind: ModelFailureKind,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(code);
    this.name = "ModelProviderError";
  }
}

export interface ModelProvider {
  readonly provider: string;
  readonly model: string;
  invoke(request: ModelRequest): Promise<ModelResponse>;
}

export type ContextMessage = {
  id: string;
  direction: "inbound" | "outbound";
  content: string;
  occurredAt: string;
};

export type AgentContext = {
  tenantId: string;
  customerId: string | null;
  conversationId: string;
  lifecycleState: string | null;
  contactability: string;
  runtimeMode: "AI_ACTIVE" | "HUMAN_TAKEOVER" | "PAUSED";
  profile: Record<string, unknown> | null;
  memory: ReadonlyArray<{ key: string; value: unknown; confidence: number | null }>;
  recentMessages: ReadonlyArray<ContextMessage>;
  recentEventTypes: readonly string[];
};

export const CONTEXT_LIMITS = Object.freeze({
  messages: 20,
  memoryItems: 24,
  recentEvents: 12,
  messageCharacters: 4096,
  totalMessageCharacters: 16000,
});

const forbiddenSecretKeyPattern = /^(service[_-]?role(?:[_-]?key)?|secret[_-]?key|telegram[_-]?bot[_-]?token|database[_-]?password|authorization|cookie)$/i;

function hasForbiddenSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenSecretKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => forbiddenSecretKeyPattern.test(key) || hasForbiddenSecretKey(child));
}

export function assertSafeContext(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (hasForbiddenSecretKey(value)) {
    throw new ModelProviderError("INVALID_OUTPUT", "MODEL_CONTEXT_SECRET_MARKER", false);
  }
  if (serialized.length > 64000) {
    throw new ModelProviderError("INVALID_OUTPUT", "MODEL_CONTEXT_TOO_LARGE", false);
  }
}

export function requestFingerprint(request: ModelRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({
      requestId: request.requestId,
      outputSchemaVersion: request.outputSchemaVersion,
      context: request.context,
      systemPolicy: request.systemPolicy,
      director: request.director,
      styleProfile: request.styleProfile,
      versions: request.versions,
      rewriteFeedback: request.rewriteFeedback,
    }))
    .digest("hex");
}

export class DeterministicShadowProvider implements ModelProvider {
  readonly provider = "mock";
  readonly model = "deterministic-shadow-v1";

  invoke(request: ModelRequest): Promise<ModelResponse> {
    try {
      assertSafeContext(request.context);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error("MODEL_CONTEXT_INVALID"));
    }
    const startedAt = Date.now();
    const lastInbound = [...request.context.recentMessages]
      .reverse()
      .find((message) => message.direction === "inbound");
    if (!lastInbound) {
      return Promise.reject(new ModelProviderError("INVALID_OUTPUT", "INBOUND_CONTEXT_REQUIRED", false));
    }
    if (lastInbound.content === "__SIMULATE_TIMEOUT__") {
      return Promise.reject(new ModelProviderError("TIMEOUT", "MODEL_TIMEOUT", true));
    }
    if (lastInbound.content === "__SIMULATE_RATE_LIMIT__") {
      return Promise.reject(new ModelProviderError("RATE_LIMIT", "MODEL_RATE_LIMITED", true));
    }
    const style = request.styleProfile ?? inferStyleProfile(request.context.recentMessages);
    const director = request.director ?? directConversation(request.context.recentMessages, style);
    const text = lastInbound.content;
    const isAiQuestion = /\b(ai|yapay zek[aâ]|bot|robot)\b/i.test(text);
    const isPriceQuestion = /\b(fiyat|ücret|price|cost|kaç para|ne kadar)\b/i.test(text);
    const escalationCategory = director.should_escalate
      ? ({ payment_status: "payment_not_reflected", access_problem: "access_missing_after_payment", refund: "refund_request", financial_loss: "financial_loss_complaint", human_request: "user_requests_human" } as const)[director.primary_intent as "payment_status"] ?? "agent_low_confidence"
      : null;
    const rawResponse = director.should_escalate
      ? "Bu konuyu yanlış yönlendirmek istemiyorum. Yetkili bir ekip üyesinin incelemesi gerekiyor."
      : isAiQuestion
        ? "Evet, AI destekli bir asistanım. İsterseniz bir ekip üyesiyle görüşmenizi de sağlayabilirim."
        : isPriceQuestion
          ? "Doğrulanmış güncel fiyat bilgisi şu an bağlamımda yok. Hangi paketle ilgileniyorsunuz?"
          : director.conversation_stage === "greeting"
            ? "Merhaba! Nasıl yardımcı olabilirim?"
            : "Size net yardımcı olabilmem için hangi konuda bilgi istediğinizi paylaşır mısınız?";
    const proposedResponse = renderNaturalResponse(rawResponse, style);
    const output = conversationModelOutputSchema.parse({
      classification: director.primary_intent,
      semantic_response: {
        response_goal: director.response_goal,
        key_points: [proposedResponse],
        factual_grounding: {
          classification: isPriceQuestion ? "unknown" : "inferred",
          evidence_refs: [lastInbound.id],
          missing_information: isPriceQuestion ? ["verified_product_pricing"] : [],
        },
      },
      proposed_response: proposedResponse,
      confidence: isPriceQuestion ? 0.55 : director.should_escalate ? 0.8 : 0.75,
      escalation_recommended: director.should_escalate,
      escalation_category: escalationCategory,
      claims: [{ text: proposedResponse, kind: proposedResponse.endsWith("?") ? "question" : "uncertainty", grounding: "UNKNOWN", evidence_refs: [], action_category: null }],
      memory_proposals: [],
      proposed_tool_calls: [],
    });
    return Promise.resolve({
      output,
      provider: this.provider,
      model: this.model,
      providerRequestId: `mock-${request.requestId}`,
      latencyMs: Math.max(Date.now() - startedAt, 0),
      usage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        billedAmount: null,
        billedCurrency: null,
      },
    });
  }
}

const uuidSchema = z.string().uuid();
const toolDefinitions = {
  "customer.get_context": z.object({ customer_id: uuidSchema }).strict(),
  "customer.get_profile": z.object({ customer_id: uuidSchema }).strict(),
  "customer.get_memory": z.object({ customer_id: uuidSchema }).strict(),
  "conversation.get_context": z.object({ conversation_id: uuidSchema }).strict(),
  "conversation.get_recent_messages": z.object({
    conversation_id: uuidSchema,
    limit: z.number().int().min(1).max(CONTEXT_LIMITS.messages).optional(),
  }).strict(),
  "event.get_context": z.object({ event_id: uuidSchema }).strict(),
  "message.create_draft": z.object({
    conversation_id: uuidSchema,
    content: z.string().trim().min(1).max(4096),
  }).strict(),
} as const;

export type SafeToolName = keyof typeof toolDefinitions;

const toolCapabilities: Readonly<Record<SafeToolName, string>> = {
  "customer.get_context": "customer.read",
  "customer.get_profile": "customer.read",
  "customer.get_memory": "customer.read",
  "conversation.get_context": "conversation.read",
  "conversation.get_recent_messages": "conversation.read",
  "event.get_context": "event.read",
  "message.create_draft": "message.draft",
};

export function validateToolRequest(input: {
  name: string;
  version: number;
  arguments: unknown;
  allowedTools: readonly string[];
  capabilities: ReadonlySet<string>;
}): { name: SafeToolName; arguments: Record<string, unknown> } {
  if (input.version !== 1 || !(input.name in toolDefinitions)) {
    throw new Error("TOOL_NOT_REGISTERED");
  }
  const name = input.name as SafeToolName;
  if (!input.allowedTools.includes(name)) throw new Error("TOOL_NOT_ALLOWED_FOR_AGENT");
  if (!input.capabilities.has(toolCapabilities[name])) throw new Error("TOOL_CAPABILITY_DENIED");
  const parsed = toolDefinitions[name].parse(input.arguments);
  return { name, arguments: parsed as Record<string, unknown> };
}

export function assertToolTenantScope(expectedTenantId: string, resolvedTenantId: string): void {
  if (expectedTenantId !== resolvedTenantId) throw new Error("TOOL_TENANT_SCOPE_DENIED");
}

export function mayExecuteCustomerFacingAction(input: {
  executionMode: AgentExecutionMode;
  approvalStatus: string | null;
  runtimeMode: AgentContext["runtimeMode"];
  outboundMessagingEnabled: boolean;
}): boolean {
  return input.executionMode !== "SHADOW"
    && input.approvalStatus === "approved"
    && input.runtimeMode === "AI_ACTIVE"
    && input.outboundMessagingEnabled;
}
