import { apiError, requireCustomerTenant } from "@/lib/customer-os/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  try {
    const { tenantId } = await requireCustomerTenant(["super_admin", "manager"]);
    const { id: batchId, rowId } = await params;
    const body = await request.json() as { resolution?: string; candidate_customer_id?: string | null };
    const resolution = body.resolution;
    if (resolution !== "exact_match" && resolution !== "new_customer") throw new Error("INVALID_REVIEW_RESOLUTION");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("review_import_row", { target_batch_id: batchId, target_row_id: rowId, resolution_value: resolution, candidate_value: body.candidate_customer_id ?? null });
    if (error) throw new Error("IMPORT_REVIEW_FAILED");
    return Response.json({ status: "reviewed", tenant_id: tenantId, batch_id: batchId, row_id: rowId });
  } catch (error) { return apiError(error); }
}
