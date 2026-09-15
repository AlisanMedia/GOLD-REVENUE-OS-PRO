import { apiError, requireCustomerTenant, type CustomerRow } from "@/lib/customer-os/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    const { tenantId } = await requireCustomerTenant();
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.trim();
    const state = url.searchParams.get("state")?.trim();
    const supabase = await createSupabaseServerClient();
    let query = supabase.from("customers").select("id,tenant_id,external_ref,display_name,state,segment,risk_level,assigned_manager_id,automation_paused,source_type,source_name,source_record_ref,created_at,updated_at").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(200);
    if (search) query = query.or(`display_name.ilike.%${search}%,external_ref.ilike.%${search}%`);
    if (state) query = query.eq("state", state);
    const { data, error } = await query;
    if (error) throw new Error("CUSTOMER_READ_FAILED");
    return Response.json({ customers: (data ?? []) as CustomerRow[] });
  } catch (error) { return apiError(error); }
}
