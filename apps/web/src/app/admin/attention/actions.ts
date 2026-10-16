"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function controlEscalation(form: FormData) {
  const { tenantId } = await requireAdminCapability("escalations.manage");
  const input = z.object({ id: z.uuid(), revision: z.coerce.number().int().positive(), action: z.enum(["assign", "acknowledge", "takeover", "resolve", "return"]), assignee: z.uuid().nullable(), note: z.string().max(1000).nullable() }).parse({
    id: form.get("case_id"), revision: form.get("revision"), action: form.get("action"), assignee: form.get("assignee") || null, note: form.get("note") || null,
  });
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("admin_escalation_action", { target_tenant_id: tenantId, target_case_id: input.id, expected_revision: input.revision, action_value: input.action, assignee_value: input.assignee, note_value: input.note });
  if (error) throw new Error(error.code === "PT409" ? "CASE_CHANGED_REFRESH_REQUIRED" : "ESCALATION_CONTROL_DENIED");
  revalidatePath("/admin/attention"); revalidatePath(`/admin/attention/${input.id}`); revalidatePath("/admin/conversations", "layout");
}
