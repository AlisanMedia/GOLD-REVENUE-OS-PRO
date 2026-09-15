import { createHash } from "node:crypto";
import { classifyRows, normalizeImportRow, type ExistingCustomer } from "@gold-revenue-os/domain";
import { apiError, requireCustomerTenant } from "@/lib/customer-os/server";
import { parseSpreadsheet } from "@/lib/customer-os/import-parser";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MANAGEMENT_ROLES = ["super_admin", "manager"] as const;
type IdentityLookup = { customer_id: string; identity_type: string; normalized_value: string; identity_scope: string };

export async function POST(request: Request) {
  try {
    const { tenantId } = await requireCustomerTenant(MANAGEMENT_ROLES);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("IMPORT_FILE_REQUIRED");
    const sourceValue = form.get("source_name");
    const sourceName = (typeof sourceValue === "string" ? sourceValue : "historical_customer_import").trim().slice(0, 160);
    if (!sourceName) throw new Error("IMPORT_SOURCE_REQUIRED");
    const parsed = await parseSpreadsheet(file);
    const normalized = parsed.rows.map((row, index) => normalizeImportRow(index + 2, row, sourceName));
    const supabase = await createSupabaseServerClient();
    const [customersResult, identitiesResult] = await Promise.all([
      supabase.from("customers").select("id,display_name").eq("tenant_id", tenantId).limit(10000),
      supabase.from("customer_identities").select("customer_id,identity_type,normalized_value,identity_scope").eq("tenant_id", tenantId).limit(50000),
    ]);
    if (customersResult.error || identitiesResult.error) throw new Error("DEDUP_INDEX_READ_FAILED");
    const customers = (customersResult.data ?? []) as Array<{ id: string; display_name: string | null }>;
    const identities = (identitiesResult.data ?? []) as IdentityLookup[];
    const existing: ExistingCustomer[] = customers.map((customer) => ({
      ...customer,
      identities: identities.filter((identity) => identity.customer_id === customer.id).map((identity) => ({ identity_type: identity.identity_type as ExistingCustomer["identities"][number]["identity_type"], normalized_value: identity.normalized_value, identity_scope: identity.identity_scope })),
    }));
    const rows = classifyRows(normalized, existing);
    const bodyRows = rows.map((row) => ({
      row_number: row.row_number,
      classification: row.classification,
      candidate_customer_id: row.candidate_customer_id,
      source_record_ref: row.source_record_ref,
      identity_fingerprint: row.identity_fingerprint,
      raw_payload: row.raw_payload,
      normalized_payload: row.normalized_payload,
      planned_mutation: row.planned_mutation,
      validation_error_count: row.errors.length,
      errors: row.errors,
    }));
    const fileSha256 = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
    const rpcResult = await supabase.rpc("create_import_dry_run", {
      target_tenant_id: tenantId,
      source_type_value: file.name.toLocaleLowerCase("en-US").endsWith(".xlsx") ? "xlsx" : "csv",
      source_name_value: sourceName,
      file_name_value: file.name,
      file_sha256_value: fileSha256,
      rows_value: bodyRows,
    }) as unknown as { data: unknown; error: unknown };
    if (rpcResult.error) throw new Error("IMPORT_DRY_RUN_FAILED");
    const report = rpcResult.data as Record<string, unknown>;
    return Response.json({ report, file_sha256: fileSha256 }, { status: 201 });
  } catch (error) { return apiError(error); }
}
