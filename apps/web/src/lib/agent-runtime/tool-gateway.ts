import "server-only";

import { assertToolTenantScope, validateToolRequest, type SafeToolName } from "@gold-revenue-os/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ToolExecutionRequest = {
  tenantId: string;
  taskId: string;
  runId: string;
  name: string;
  version: number;
  arguments: unknown;
  allowedTools: readonly string[];
  capabilities: ReadonlySet<string>;
};

export type ToolExecutionResponse = { tool: SafeToolName; data: unknown };

export async function executeSafeReadTool(request: ToolExecutionRequest): Promise<ToolExecutionResponse> {
  const validated = validateToolRequest({
    name: request.name,
    version: request.version,
    arguments: request.arguments,
    allowedTools: request.allowedTools,
    capabilities: request.capabilities,
  });
  if (validated.name === "message.create_draft") throw new Error("TOOL_REQUIRES_HUMAN_APPROVAL");
  const supabase = createSupabaseAdminClient();
  const customerId = typeof validated.arguments.customer_id === "string" ? validated.arguments.customer_id : null;
  const conversationId = typeof validated.arguments.conversation_id === "string" ? validated.arguments.conversation_id : null;
  const eventId = typeof validated.arguments.event_id === "string" ? validated.arguments.event_id : null;

  if (validated.name === "customer.get_context") {
    const { data, error } = await supabase.from("customers").select("tenant_id,id,state,segment,risk_level,created_at,updated_at")
      .eq("tenant_id", request.tenantId).eq("id", customerId!).maybeSingle();
    if (error || !data) throw new Error("TOOL_CUSTOMER_NOT_FOUND");
    assertToolTenantScope(request.tenantId, data.tenant_id);
    return { tool: validated.name, data };
  }
  if (validated.name === "customer.get_profile") {
    const { data, error } = await supabase.from("customer_profiles").select("*")
      .eq("tenant_id", request.tenantId).eq("customer_id", customerId!).maybeSingle();
    if (error) throw new Error("TOOL_PROFILE_READ_FAILED");
    if (data) assertToolTenantScope(request.tenantId, data.tenant_id);
    return { tool: validated.name, data };
  }
  if (validated.name === "customer.get_memory") {
    const { data, error } = await supabase.from("customer_memory")
      .select("tenant_id,memory_key,memory_value,confidence,observed_at")
      .eq("tenant_id", request.tenantId).eq("customer_id", customerId!)
      .is("superseded_at", null).order("observed_at", { ascending: false }).limit(24);
    if (error) throw new Error("TOOL_MEMORY_READ_FAILED");
    for (const row of data ?? []) assertToolTenantScope(request.tenantId, row.tenant_id);
    return { tool: validated.name, data };
  }
  if (validated.name === "conversation.get_context") {
    const { data, error } = await supabase.from("conversations")
      .select("tenant_id,id,customer_id,status,runtime_mode,last_message_at")
      .eq("tenant_id", request.tenantId).eq("id", conversationId!).maybeSingle();
    if (error || !data) throw new Error("TOOL_CONVERSATION_NOT_FOUND");
    assertToolTenantScope(request.tenantId, data.tenant_id);
    return { tool: validated.name, data };
  }
  if (validated.name === "conversation.get_recent_messages") {
    const limit = typeof validated.arguments.limit === "number" ? validated.arguments.limit : 20;
    const { data, error } = await supabase.from("messages")
      .select("tenant_id,id,direction,content,occurred_at")
      .eq("tenant_id", request.tenantId).eq("conversation_id", conversationId!)
      .order("occurred_at", { ascending: false }).limit(limit);
    if (error) throw new Error("TOOL_MESSAGES_READ_FAILED");
    for (const row of data ?? []) assertToolTenantScope(request.tenantId, row.tenant_id);
    return { tool: validated.name, data };
  }
  const { data, error } = await supabase.from("domain_events")
    .select("tenant_id,id,event_type,event_version,customer_id,authority,correlation_id,causation_id,occurred_at")
    .eq("tenant_id", request.tenantId).eq("id", eventId!).maybeSingle();
  if (error || !data) throw new Error("TOOL_EVENT_NOT_FOUND");
  assertToolTenantScope(request.tenantId, data.tenant_id);
  return { tool: validated.name, data };
}

