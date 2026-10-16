import "server-only";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type EscalationCase = {
  id: string; conversation_id: string; customer_id: string | null; category: string; severity: string; status: string;
  source_message_id: string; assigned_to: string | null; revision: number; created_at: string; waiting_seconds: number;
  acknowledged_at: string | null; first_response_at: string | null; resolved_at: string | null;
  resolution_note: string | null; returned_to_ai_at: string | null;
  notification: { status: string; attempts: number; provider_message_id: string | null; last_error: string | null; sent_at: string | null } | null;
};
export type EscalationReadModel = { cases: EscalationCase[]; evidence: { id: string; message_id: string; category: string; source_kind: string; source_id: string; created_at: string }[];
  history: { id: number; action: string; actor_id: string | null; details: Record<string, unknown>; created_at: string }[]; managers: { id: string; role: string }[] };
export async function escalationList(caseId?: string, conversationId?: string) {
  const context = await requireAdminCapability("escalations.read");
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("admin_escalation_list", { target_tenant_id: context.tenantId, target_case_id: caseId ?? null, target_conversation_id: conversationId ?? null });
  if (error) throw new Error("ESCALATION_READ_FAILED");
  return { context, ...data as EscalationReadModel };
}
