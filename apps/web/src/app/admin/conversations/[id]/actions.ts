"use server";
import { revalidatePath } from "next/cache";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { escalationControlError, type EscalationControlState } from "@/lib/escalations/presentation";
import { z } from "zod";

export async function setAutomaticReplies(_previous: EscalationControlState, formData: FormData): Promise<EscalationControlState> {
  const { tenantId } = await requireAdminCapability("messaging.send");
  const conversationId = String(formData.get("conversation_id") ?? "");
  if (!z.uuid().safeParse(conversationId).success || !["true", "false"].includes(String(formData.get("enabled")))) return { kind: "error", message: "Görüşme bilgisi geçersiz. Sayfayı yenileyin." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_conversation_automatic_replies", {
    target_tenant_id: tenantId, target_conversation_id: conversationId,
    enabled_value: formData.get("enabled") === "true", correlation_id_value: crypto.randomUUID(),
  });
  if (error) return { kind: "error", message: escalationControlError(error.code) };
  revalidatePath(`/admin/conversations/${conversationId}`);
  return { kind: "success", message: formData.get("enabled") === "true" ? "Otomatik yanıtlar yalnızca yeni mesajlar için açıldı." : "Otomatik yanıtlar kapatıldı. Görüşme insan kontrolünde." };
}
