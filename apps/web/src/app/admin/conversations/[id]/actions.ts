"use server";
import { revalidatePath } from "next/cache";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function setAutomaticReplies(formData: FormData) {
  const { tenantId } = await requireAdminCapability("messaging.send");
  const conversationId = String(formData.get("conversation_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) throw new Error("CONVERSATION_INVALID");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_conversation_automatic_replies", {
    target_tenant_id: tenantId, target_conversation_id: conversationId,
    enabled_value: formData.get("enabled") === "true", correlation_id_value: crypto.randomUUID(),
  });
  if (error) throw new Error("AUTOMATIC_REPLY_SETTING_FAILED");
  revalidatePath(`/admin/conversations/${conversationId}`);
}
