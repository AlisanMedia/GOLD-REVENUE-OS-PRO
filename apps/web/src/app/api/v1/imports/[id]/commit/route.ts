import { apiError, requireCustomerTenant } from "@/lib/customer-os/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId } = await requireCustomerTenant(["super_admin"]);
    const { id } = await params;
    return Response.json({ error: { code: "IMPORT_EXECUTION_LOCKED", message: "Historical import remains locked pending final reconciliation and explicit approval", tenant_id: tenantId, batch_id: id } }, { status: 423 });
  } catch (error) { return apiError(error); }
}
