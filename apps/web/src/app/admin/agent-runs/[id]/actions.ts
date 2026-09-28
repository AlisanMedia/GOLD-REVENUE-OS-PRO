"use server";

import { hasAdminCapability } from "@/lib/admin/permissions";
import { requireAdminCapability } from "@/lib/admin/server";
import { dispatchQueuedTelegramMessage } from "@/lib/messaging/outbound-dispatch";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function reviewProposal(formData: FormData) {
  const { tenantId } = await requireAdminCapability("agents.review");
  const proposalId = String(formData.get("proposal_id") ?? "");
  const runId = String(formData.get("run_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const editedContent = String(formData.get("edited_content") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!proposalId || !runId || !["approve","reject","edit"].includes(decision)) throw new Error("PROPOSAL_REVIEW_INVALID");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("review_agent_proposal", {
    target_tenant_id: tenantId,
    target_proposal_id: proposalId,
    decision_value: decision,
    edited_payload_value: decision === "edit" ? { proposed_response: editedContent } : null,
    reason_value: reason || null,
    correlation_id_value: crypto.randomUUID(),
  });
  if (error) throw new Error("PROPOSAL_REVIEW_FAILED");
  revalidatePath(`/admin/agent-runs/${runId}`);
  revalidatePath("/admin/agents");
}

export async function sendApprovedProposal(formData: FormData) {
  const context = await requireAdminCapability("agents.review");
  if (!hasAdminCapability(context.role, "messaging.send")) throw new Error("APPROVED_PROPOSAL_SEND_DENIED");
  const proposalId = String(formData.get("proposal_id") ?? "");
  const runId = String(formData.get("run_id") ?? "");
  if (!proposalId || !runId) throw new Error("APPROVED_PROPOSAL_SEND_INVALID");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("queue_approved_agent_proposal", {
    target_tenant_id: context.tenantId,
    target_proposal_id: proposalId,
    correlation_id_value: crypto.randomUUID(),
  });
  if (error || !data || typeof data !== "object") throw new Error("APPROVED_PROPOSAL_QUEUE_FAILED");
  const queued = data as Record<string, unknown>;
  const messageId = typeof queued.message_id === "string" ? queued.message_id : null;
  if (!messageId) throw new Error("APPROVED_PROPOSAL_QUEUE_FAILED");
  if (queued.duplicate !== true) {
    await dispatchQueuedTelegramMessage({ tenantId: context.tenantId, messageId });
  }
  revalidatePath(`/admin/agent-runs/${runId}`);
  revalidatePath("/admin/agents");
  revalidatePath("/admin/conversations");
}
