import { requireCustomerTenant } from "@/lib/customer-os/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ImportListItem = { id: string; status: string; source_type: string; source_name: string; file_name: string | null; total_rows: number; exact_match_count: number; probable_match_count: number; ambiguous_count: number; new_customer_count: number; rejected_count: number; created_at: string };

export default async function ImportsPage() {
  const { tenantId } = await requireCustomerTenant(["super_admin", "manager"]);
  const supabase = await createSupabaseServerClient();
  const { data: imports, error } = await supabase.from("import_batches").select("id,status,source_type,source_name,file_name,total_rows,exact_match_count,probable_match_count,ambiguous_count,new_customer_count,rejected_count,validation_error_count,planned_mutation_count,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error("Unable to load imports");
  const importRows = (imports ?? []) as ImportListItem[];
  return <main className="admin-main"><div className="page-heading"><div><p className="eyebrow">IMPORT CONTROL</p><h1>Import batches</h1><p className="lede">Every file is parsed in memory, dry-run classified and held for review.</p></div><a className="primary-button" href="/admin/imports/new">New dry run</a></div><section className="table-card"><div className="table-scroll"><table><thead><tr><th>Source</th><th>Status</th><th>Rows</th><th>Matches</th><th>Review</th><th>Created</th></tr></thead><tbody>{importRows.map((item) => <tr key={item.id}><td><a className="table-link" href={`/admin/imports/${item.id}`}>{item.source_name}</a><small>{item.file_name ?? item.source_type}</small></td><td><span className="state-pill">{item.status}</span></td><td>{item.total_rows}</td><td>{item.exact_match_count} exact · {item.probable_match_count} probable</td><td>{item.ambiguous_count} ambiguous · {item.rejected_count} rejected</td><td>{new Date(item.created_at).toLocaleDateString("en-GB")}</td></tr>)}{importRows.length === 0 && <tr><td colSpan={6} className="empty-state">No dry-run imports yet.</td></tr>}</tbody></table></div></section></main>;
}
