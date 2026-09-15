import { apiError, requireCustomerTenant } from "@/lib/customer-os/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId } = await requireCustomerTenant(["super_admin"]);
    const { id } = await params;
    const body = await request.json() as { confirmation?: string };
    if (body.confirmation !== "IMPORT_APPROVED") throw new Error("EXPLICIT_IMPORT_APPROVAL_REQUIRED");
    const supabase = await createSupabaseServerClient();
    const result = await supabase.rpc("commit_import_batch", { target_batch_id: id, approval_phrase: body.confirmation }) as unknown as { data: unknown; error: unknown };
    if (result.error) throw new Error("IMPORT_COMMIT_FAILED");
    return Response.json({ tenant_id: tenantId, result: result.data });
  } catch (error) { return apiError(error); }
}
