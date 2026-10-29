import { apiError, requireCustomerTenant } from "@/lib/customer-os/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId } = await requireCustomerTenant(["super_admin"]);
    const id = z.uuid().parse((await params).id);
    const db = await createSupabaseServerClient();
    const result = await db.rpc("admin_campaign_commit_batch_v1", { target_tenant_id: tenantId, batch_id_value: id });
    if (result.error) return Response.json({ error: { code: result.error.code === "42501" ? "IMPORT_EXECUTION_LOCKED" : "IMPORT_RECONCILIATION_REQUIRED" } }, { status: result.error.code === "42501" ? 403 : 409 });
    return Response.json({ report: result.data });
  } catch (error) { return apiError(error); }
}
