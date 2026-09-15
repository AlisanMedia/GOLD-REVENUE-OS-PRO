import { apiError, requireCustomerTenant } from "@/lib/customer-os/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const { tenantId } = await requireCustomerTenant(["super_admin", "manager"]);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("import_batches").select("id,status,source_type,source_name,file_name,total_rows,exact_match_count,probable_match_count,ambiguous_count,new_customer_count,rejected_count,validation_error_count,planned_mutation_count,created_at,reviewed_at,completed_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error("IMPORT_READ_FAILED");
    return Response.json({ imports: data ?? [] });
  } catch (error) { return apiError(error); }
}
