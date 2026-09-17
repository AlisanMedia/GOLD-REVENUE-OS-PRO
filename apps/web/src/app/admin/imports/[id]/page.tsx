import ImportRowReview from "@/components/import-row-review";
import { requireCustomerTenant } from "@/lib/customer-os/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";

type ImportRowItem = { id: string; row_number: number; status: string; classification: string; candidate_customer_id: string | null; normalized_payload: unknown; review_status: string };
type ImportErrorItem = { id: string; row_number: number; field_name: string | null; error_code: string; message: string };
type ImportBatchItem = { id: string; status: string; source_name: string; file_name: string | null; total_rows: number; exact_match_count: number; probable_match_count: number; ambiguous_count: number; new_customer_count: number; rejected_count: number; validation_error_count: number; planned_mutation_count: number };

export default async function ImportDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenantId } = await requireCustomerTenant(["super_admin", "manager"]);
  const batchId = (await params).id;
  const raw = await searchParams;
  const classificationValue = Array.isArray(raw.classification) ? raw.classification[0] : raw.classification;
  const page = Math.max(Number.parseInt((Array.isArray(raw.page) ? raw.page[0] : raw.page) ?? "1", 10) || 1, 1);
  const from = (page - 1) * 100;
  const supabase = await createSupabaseServerClient();
  let rowsQuery = supabase.from("import_rows").select("id,row_number,status,classification,candidate_customer_id,normalized_payload,review_status", { count: "exact" }).eq("tenant_id", tenantId).eq("batch_id", batchId).order("row_number").range(from, from + 99);
  if (classificationValue) rowsQuery = rowsQuery.eq("classification", classificationValue);
  const [batchResult, rowsResult, errorsResult] = await Promise.all([
    supabase.from("import_batches").select("id,status,source_name,file_name,total_rows,exact_match_count,probable_match_count,ambiguous_count,new_customer_count,rejected_count,validation_error_count,planned_mutation_count,created_at").eq("tenant_id", tenantId).eq("id", batchId).maybeSingle(),
    rowsQuery,
    supabase.from("import_errors").select("id,row_number,field_name,error_code,message").eq("tenant_id", tenantId).eq("batch_id", batchId).order("row_number").limit(100),
  ]);
  if (batchResult.error || rowsResult.error || errorsResult.error || !batchResult.data) throw new Error("Unable to load import");
  const batch = batchResult.data as ImportBatchItem;
  const importRows = (rowsResult.data ?? []) as ImportRowItem[];
  const importErrors = (errorsResult.data ?? []) as ImportErrorItem[];
  const pages = Math.max(Math.ceil((rowsResult.count ?? 0) / 100), 1);

  return (
    <main className="admin-main">
      <Link className="back-link" href="/admin/imports">← Import batches</Link>
      <p className="eyebrow">RECONCILIATION REPORT</p>
      <h1>{batch.source_name}</h1>
      <p className="lede">{batch.file_name ?? "Uploaded file"} · status: {batch.status}</p>
      <section className="metric-grid">
        {[["Total", batch.total_rows], ["Exact", batch.exact_match_count], ["Probable", batch.probable_match_count], ["Ambiguous", batch.ambiguous_count], ["New", batch.new_customer_count], ["Rejected", batch.rejected_count], ["Errors", batch.validation_error_count], ["Planned", batch.planned_mutation_count]].map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </section>
      <form className="inline-filter" method="get">
        <label>Classification<select name="classification" defaultValue={classificationValue ?? ""}><option value="">All</option>{["exact_match", "probable_match", "ambiguous", "new_customer"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <button className="secondary-button" type="submit">Filter</button>
      </form>
      <section className="detail-card">
        <h2>Deduplication review</h2>
        {importRows.map((row) => <ImportRowReview key={row.id} batchId={batchId} rowId={row.id} classification={row.classification} candidateId={row.candidate_customer_id} normalized={row.normalized_payload} reviewStatus={row.review_status} />)}
        {importRows.length === 0 ? <p className="muted">No rows match this filter.</p> : null}
      </section>
      <nav className="pagination">
        <Link href={`?classification=${classificationValue ?? ""}&page=${Math.max(page - 1, 1)}`}>Previous</Link>
        <span>Page {page} of {pages}</span>
        <Link href={`?classification=${classificationValue ?? ""}&page=${Math.min(page + 1, pages)}`}>Next</Link>
      </nav>
      <section className="detail-card">
        <h2>Validation errors · first 100</h2>
        {importErrors.length ? <ul>{importErrors.map((error) => <li key={error.id}><strong>Row {error.row_number} · {error.field_name ?? "row"}</strong><span>{error.error_code}: {error.message}</span></li>)}</ul> : <p className="muted">No validation errors.</p>}
      </section>
      <p className="warning-box">No real import can be executed from this screen. The API and database execution permission are locked.</p>
    </main>
  );
}
