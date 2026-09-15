import { apiError, requireCustomerTenant } from "@/lib/customer-os/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId } = await requireCustomerTenant(["super_admin", "manager"]);
    const batchId = (await params).id;
    const supabase = await createSupabaseServerClient();
    const [batch, rows, errors] = await Promise.all([
      supabase.from("import_batches").select("id,status,source_type,source_name,file_name,file_sha256,total_rows,exact_match_count,probable_match_count,ambiguous_count,new_customer_count,rejected_count,validation_error_count,planned_mutation_count,created_at,reviewed_at,completed_at").eq("tenant_id", tenantId).eq("id", batchId).maybeSingle(),
      supabase.from("import_rows").select("id,row_number,status,classification,resolution,review_status,candidate_customer_id,source_record_ref,identity_fingerprint,normalized_payload,planned_mutation,validation_error_count,created_at,reviewed_at").eq("tenant_id", tenantId).eq("batch_id", batchId).order("row_number").limit(5000),
      supabase.from("import_errors").select("id,import_row_id,row_number,field_name,error_code,message,created_at").eq("tenant_id", tenantId).eq("batch_id", batchId).order("row_number").limit(5000),
    ]);
    if (batch.error || rows.error || errors.error) throw new Error("IMPORT_READ_FAILED");
    if (!batch.data) throw new Error("IMPORT_NOT_FOUND");
    return Response.json({ batch: batch.data, rows: rows.data ?? [], errors: errors.data ?? [] });
  } catch (error) { return apiError(error); }
}
