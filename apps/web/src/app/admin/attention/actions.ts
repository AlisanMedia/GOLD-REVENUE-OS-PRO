"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { escalationControlError, type EscalationControlState } from "@/lib/escalations/presentation";

export async function controlEscalation(_previous: EscalationControlState, form: FormData): Promise<EscalationControlState> {
  const { tenantId } = await requireAdminCapability("escalations.manage");
  const parsed = z.object({ id: z.uuid(), revision: z.coerce.number().int().positive(), action: z.enum(["assign", "acknowledge", "takeover", "resolve", "return"]), assignee: z.uuid().nullable(), note: z.string().max(1000).nullable() }).safeParse({
    id: form.get("case_id"), revision: form.get("revision"), action: form.get("action"), assignee: form.get("assignee") || null, note: form.get("note") || null,
  });
  if (!parsed.success) return { kind: "error", message: "Vaka bilgileri geçersiz. Sayfayı yenileyip yeniden deneyin." };
  const input = parsed.data;
  if (input.action === "resolve" && !input.note?.trim()) return { kind: "error", message: "Vakayı çözmek için kısa bir çözüm notu yazın." };
  if (input.action === "assign" && !input.assignee) return { kind: "error", message: "Atanacak yöneticiyi seçin." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("admin_escalation_action", { target_tenant_id: tenantId, target_case_id: input.id, expected_revision: input.revision, action_value: input.action, assignee_value: input.assignee, note_value: input.note });
  if (error) return { kind: "error", message: escalationControlError(error.code) };
  revalidatePath("/admin/attention"); revalidatePath(`/admin/attention/${input.id}`); revalidatePath("/admin/conversations", "layout");
  return { kind: "success", message: ({ assign: "Yönetici ataması kaydedildi.", acknowledge: "Vaka alındı.", takeover: "Görüşme devralındı. Müşteriye manuel yanıt verebilirsiniz.", resolve: "Vaka çözüldü olarak kaydedildi. Yapay zekâya dönüş ayrı bir işlemdir.", return: "Yapay zekâ yalnızca yeni mesajlar için açıldı. Eski taslaklar gönderilmez." })[input.action] };
}
