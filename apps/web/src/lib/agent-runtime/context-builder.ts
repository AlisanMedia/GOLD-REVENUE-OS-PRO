import "server-only";

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

  const [messagesResult, profileResult, memoryResult, eventsResult, customerResult] = await Promise.all([
    supabase.from("messages")
      .select("id,direction,content,occurred_at")
      .eq("tenant_id", task.tenant_id)
      .eq("conversation_id", task.conversation_id)
      .order("occurred_at", { ascending: false })
      .limit(CONTEXT_LIMITS.messages),
    task.customer_id ? supabase.from("customer_profiles")
      .select("experience_level,primary_instrument,trading_style,risk_preference,preferred_signal_frequency,communication_style,price_sensitivity,trust_level,pain_points,objections,next_best_action")
      .eq("tenant_id", task.tenant_id).eq("customer_id", task.customer_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    task.customer_id ? supabase.from("customer_memory")
      .select("memory_key,memory_value,confidence")
      .eq("tenant_id", task.tenant_id).eq("customer_id", task.customer_id)
      .is("superseded_at", null).order("observed_at", { ascending: false })
      .limit(CONTEXT_LIMITS.memoryItems) : Promise.resolve({ data: [], error: null }),
    supabase.from("domain_events")
      .select("event_type")
      .eq("tenant_id", task.tenant_id)
      .eq("aggregate_id", task.conversation_id)
      .order("recorded_at", { ascending: false })
      .limit(CONTEXT_LIMITS.recentEvents),
    task.customer_id ? supabase.from("customers")
      .select("state")
      .eq("tenant_id", task.tenant_id).eq("id", task.customer_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);

  if (messagesResult.error || profileResult.error || memoryResult.error || eventsResult.error || customerResult.error) {
    throw new Error("CONTEXT_QUERY_FAILED");
  }

  let remainingCharacters = CONTEXT_LIMITS.totalMessageCharacters;
  const messages = ([...(messagesResult.data ?? [])] as Array<Record<string, unknown>>)
    .reverse()
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
    });

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
    recentEventTypes: (eventsResult.data ?? []).map((row: { event_type: string }) => row.event_type),
  };
  assertSafeContext(context);
  return {
    context,
    manifest: {
      context_version: 1,
      customer_included: task.customer_id !== null,
      profile_included: profileResult.data !== null,
      memory_count: memory.length,
      message_count: messages.length,
      event_count: context.recentEventTypes.length,
      message_character_count: messages.reduce((total, message) => total + message.content.length, 0),
      limits: CONTEXT_LIMITS,
      secrets_included: false,
    },
  };
}

