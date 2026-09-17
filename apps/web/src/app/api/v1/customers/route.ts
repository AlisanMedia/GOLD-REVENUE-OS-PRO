import { apiError, requireCustomerTenant } from "@/lib/customer-os/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    const { tenantId } = await requireCustomerTenant();
    const url = new URL(request.url);
    const page = Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1);
    const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get("page_size") ?? "25", 10) || 25, 1), 100);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("admin_customer_list", {
      target_tenant_id: tenantId, search_value: url.searchParams.get("search"), state_value: url.searchParams.get("state"),
      segment_value: url.searchParams.get("segment"), risk_value: url.searchParams.get("risk"), source_value: url.searchParams.get("source"),
      manager_value: url.searchParams.get("manager"), created_from_value: url.searchParams.get("created_from"), created_to_value: url.searchParams.get("created_to"),
      page_value: page, page_size_value: pageSize,
    });
    if (error) throw new Error("CUSTOMER_READ_FAILED");
    return Response.json(data);
  } catch (error) { return apiError(error); }
}
