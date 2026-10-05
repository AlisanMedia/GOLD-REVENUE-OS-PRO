import "server-only";
import { createHash } from "node:crypto";

import {
  CONTEXT_LIMITS,
  assertSafeContext,
  type AgentContext,
  type ContextMessage,
} from "@gold-revenue-os/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type TaskEnvelope = {
  tenant_id: string;
  customer_id: string | null;
  conversation_id: string;
  source_event_id: string;
};

type ConversationRow = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  runtime_mode: AgentContext["runtimeMode"];
  messaging_contacts: { contactability: string } | null;
};

export type ContextBuildResult = {
  context: AgentContext;
  manifest: Record<string, unknown>;
};

export async function buildAgentContext(task: TaskEnvelope): Promise<ContextBuildResult> {
  const supabase = createSupabaseAdminClient();
  const { data: conversationData, error: conversationError } = await supabase
    .from("conversations")
    .select("id,tenant_id,customer_id,runtime_mode,messaging_contacts(contactability)")
    .eq("tenant_id", task.tenant_id)
    .eq("id", task.conversation_id)
    .maybeSingle();
  if (conversationError || !conversationData) throw new Error("CONTEXT_CONVERSATION_NOT_FOUND");
  const conversation = conversationData as unknown as ConversationRow;
  if (conversation.tenant_id !== task.tenant_id || conversation.customer_id !== task.customer_id) {
    throw new Error("CONTEXT_TENANT_SCOPE_DENIED");
  }

  const { data: sourceEvent, error: sourceEventError } = await supabase
    .from("domain_events")
    .select("id,event_type,payload")
    .eq("tenant_id", task.tenant_id)
    .eq("id", task.source_event_id)
    .maybeSingle();
  const payload = sourceEvent?.payload as Record<string, unknown> | undefined;
  const sourceMessageId = typeof payload?.message_id === "string" ? payload.message_id : "";
  const sourceConversationId = typeof payload?.conversation_id === "string" ? payload.conversation_id : "";
  if (sourceEventError || !sourceEvent || sourceEvent.event_type !== "message.received"
    || sourceConversationId !== task.conversation_id
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceMessageId)) {
    throw new Error("CONTEXT_SOURCE_EVENT_INVALID");
  }
  const { data: sourceMessage, error: sourceMessageError } = await supabase
    .from("messages")
    .select("id,created_at")
    .eq("tenant_id", task.tenant_id)
    .eq("conversation_id", task.conversation_id)
    .eq("id", sourceMessageId)
    .maybeSingle();
  if (sourceMessageError || !sourceMessage) throw new Error("CONTEXT_SOURCE_MESSAGE_NOT_FOUND");

  const [messagesResult, profileResult, memoryResult, eventsResult, customerResult] = await Promise.all([
    supabase.from("messages")
      .select("id,direction,content,occurred_at,created_at")
      .eq("tenant_id", task.tenant_id)
      .eq("conversation_id", task.conversation_id)
      .lte("created_at", sourceMessage.created_at)
      .order("created_at", { ascending: false })
      .limit(CONTEXT_LIMITS.messages),
    task.customer_id ? supabase.from("customer_profiles")
      .select("updated_at,experience_level,primary_instrument,trading_style,risk_preference,preferred_signal_frequency,communication_style,price_sensitivity,trust_level,pain_points,objections,next_best_action")
      .eq("tenant_id", task.tenant_id).eq("customer_id", task.customer_id)
      .lte("updated_at", sourceMessage.created_at).maybeSingle() : Promise.resolve({ data: null, error: null }),
    task.customer_id ? supabase.from("customer_memory")
      .select("id,observed_at,memory_key,memory_value,confidence")
      .eq("tenant_id", task.tenant_id).eq("customer_id", task.customer_id)
      .is("superseded_at", null).lte("observed_at", sourceMessage.created_at).order("observed_at", { ascending: false })
      .limit(CONTEXT_LIMITS.memoryItems) : Promise.resolve({ data: [], error: null }),
    supabase.from("domain_events")
      .select("id,event_type,recorded_at")
      .eq("tenant_id", task.tenant_id)
      .eq("aggregate_id", task.conversation_id)
      .lte("recorded_at", sourceMessage.created_at)
      .order("recorded_at", { ascending: false })
      .limit(CONTEXT_LIMITS.recentEvents),
    task.customer_id ? supabase.from("customers")
      .select("state")
      .eq("tenant_id", task.tenant_id).eq("id", task.customer_id)
      .lte("updated_at", sourceMessage.created_at).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);

  if (messagesResult.error || profileResult.error || memoryResult.error || eventsResult.error || customerResult.error) {
    throw new Error("CONTEXT_QUERY_FAILED");
  }
  if ((messagesResult.data ?? []).some((row: { id: string; created_at: string }) => row.id !== sourceMessageId && row.created_at === sourceMessage.created_at)) {
    throw new Error("CONTEXT_TIMESTAMP_AMBIGUOUS");
  }

  let remainingCharacters = CONTEXT_LIMITS.totalMessageCharacters;
  const messages = ([...(messagesResult.data ?? [])] as Array<Record<string, unknown>>)
    .flatMap((row): ContextMessage[] => {
      const raw = typeof row.content === "string" ? row.content : "";
      const content = raw.slice(0, Math.min(CONTEXT_LIMITS.messageCharacters, remainingCharacters));
      remainingCharacters -= content.length;
      if (!content) return [];
      return [{
        id: String(row.id),
        direction: row.direction === "outbound" ? "outbound" : "inbound",
        content,
        occurredAt: String(row.occurred_at),
      }];
    }).reverse();
  // Budget newest-first so long history cannot evict the triggering message.
  // Fail closed on timestamp ties or an omitted anchor rather than answering
  // a different inbound message.
  if (messages.at(-1)?.id !== sourceMessageId) {
    throw new Error("CONTEXT_SOURCE_MESSAGE_NOT_LAST");
  }

  const memory = (memoryResult.data ?? []).map((row: Record<string, unknown>) => ({
    key: String(row.memory_key),
    value: row.memory_value,
    confidence: typeof row.confidence === "number" ? row.confidence : row.confidence === null ? null : Number(row.confidence),
  }));
  const context: AgentContext = {
    tenantId: task.tenant_id,
    customerId: task.customer_id,
    conversationId: task.conversation_id,
    lifecycleState: customerResult.data && typeof customerResult.data.state === "string" ? customerResult.data.state : null,
    contactability: conversation.messaging_contacts?.contactability ?? "unknown",
    runtimeMode: conversation.runtime_mode,
    profile: profileResult.data as Record<string, unknown> | null,
    memory,
    recentMessages: messages,
    recentEventTypes: [sourceEvent.event_type, ...(eventsResult.data ?? []).filter((row: { id: string }) => row.id !== sourceEvent.id).map((row: { event_type: string }) => row.event_type)],
  };
  assertSafeContext(context);
  return {
    context,
    manifest: {
      context_version: 3,
      manifest_version: 2,
      retrieval_version: "source-bounded-v2",
      context_boundary_timestamp: sourceMessage.created_at,
      included_message_ids: messages.map((message) => message.id),
      included_event_ids: [sourceEvent.id, ...(eventsResult.data ?? []).filter((row: { id: string }) => row.id !== sourceEvent.id).map((row: { id: string }) => row.id)],
      included_memory_versions: (memoryResult.data ?? []).map((row: { id: string; observed_at: string }) => ({ id: row.id, observed_at: row.observed_at })),
      profile_version_timestamp: profileResult.data?.updated_at ?? null,
      message_fingerprints: messages.map((message) => ({ id: message.id,
        content_sha256: createHash("sha256").update(message.content).digest("hex"),
        included_characters: message.content.length,
        created_at: (messagesResult.data ?? []).find((row: { id: string }) => row.id === message.id)?.created_at,
      })),
      context_fingerprint: createHash("sha256").update(JSON.stringify(context)).digest("hex"),
      mutable_state_retrieval: "exclude_versions_updated_after_source_boundary",
      backend_action_receipts: [],
      source_event_id: task.source_event_id,
      source_message_id: sourceMessageId,
      source_message_created_at: sourceMessage.created_at,
      customer_included: task.customer_id !== null,
      profile_included: profileResult.data !== null,
      memory_count: memory.length,
      message_count: messages.length,
      event_count: context.recentEventTypes.length,
      message_character_count: messages.reduce((total, message) => total + message.content.length, 0),
      limits: CONTEXT_LIMITS,
      knowledge_sources: [
        "customer.core", "customer.profile", "customer.memory",
        "conversation.recent_messages", "conversation.contactability", "event.recent_types",
      ],
      unavailable_sources: [
        ...(profileResult.data === null ? ["customer.profile"] : []),
        ...(memory.length === 0 ? ["customer.memory"] : []),
        "product.catalog", "pricing.source_of_truth", "payment.status", "subscription.status", "knowledge_base",
      ],
      secrets_included: false,
    },
  };
}
