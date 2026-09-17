import "server-only";

import { requireAdminCapability, type PagedResult } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ConversationListItem = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  status: string;
  unread_count: number;
  attention_required: boolean;
  last_message_at: string | null;
  provider: "telegram";
  username: string | null;
  contactability: string;
  identity_resolution: string;
  review_required: boolean;
  last_direction: string | null;
  last_status: string | null;
  last_message: string | null;
};

export type MessageItem = {
  id: string;
  customer_id: string | null;
  direction: "inbound" | "outbound";
  message_type: string;
  content: string;
  status: string;
  provider_message_id: string | null;
  reply_to_message_id: string | null;
  failure_code: string | null;
  provider_acknowledged_at: string | null;
  occurred_at: string;
  sent_at: string | null;
  created_at: string;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MESSAGING_READ_MODEL_INVALID");
  return value as Record<string, unknown>;
}

export async function getConversationList(input: {
  status?: string;
  customerId?: string;
  page: number;
  pageSize: number;
}): Promise<PagedResult<ConversationListItem>> {
  const { tenantId } = await requireAdminCapability("messaging.read");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_conversation_list", {
    target_tenant_id: tenantId,
    status_value: input.status || null,
    customer_value: input.customerId || null,
    page_value: input.page,
    page_size_value: input.pageSize,
  });
  if (error) throw new Error("CONVERSATION_LIST_FAILED");
  const result = record(data);
  return {
    items: Array.isArray(result.items) ? result.items as ConversationListItem[] : [],
    total: Number(result.total ?? 0),
    page: Number(result.page ?? 1),
    page_size: Number(result.page_size ?? input.pageSize),
  };
}

export async function getConversationMessages(conversationId: string): Promise<MessageItem[]> {
  const { tenantId } = await requireAdminCapability("messaging.read");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_conversation_messages", {
    target_tenant_id: tenantId,
    target_conversation_id: conversationId,
    before_value: null,
    limit_value: 100,
  });
  if (error) throw new Error("CONVERSATION_MESSAGES_FAILED");
  return Array.isArray(data) ? data as MessageItem[] : [];
}
