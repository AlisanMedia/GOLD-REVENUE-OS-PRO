import { requireCustomerTenant } from "@/lib/customer-os/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type CustomerListItem = { id: string; display_name: string | null; external_ref: string | null; state: string; segment: string | null; risk_level: string; updated_at: string };

export default async function CustomersPage() {
  const { tenantId } = await requireCustomerTenant();
  const supabase = await createSupabaseServerClient();
  const { data: customers, error } = await supabase.from("customers").select("id,display_name,external_ref,state,segment,risk_level,updated_at").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(200);
  if (error) throw new Error("Unable to load customers");
  const customerRows = (customers ?? []) as CustomerListItem[];
  return (
    <main className="admin-main">
      <p className="eyebrow">CUSTOMER OS</p>
      <div className="page-heading"><div><h1>Customers</h1><p className="lede">Tenant-scoped customer records and lifecycle state.</p></div><a className="primary-button" href="/admin/imports/new">Dry-run import</a></div>
      <section className="table-card" aria-label="Customer list">
        <div className="table-scroll"><table><thead><tr><th>Customer</th><th>State</th><th>Segment</th><th>Risk</th><th>Updated</th></tr></thead><tbody>
          {customerRows.map((customer) => <tr key={customer.id}><td><a className="table-link" href={`/admin/customers/${customer.id}`}>{customer.display_name || "Unnamed customer"}</a><small>{customer.external_ref ?? customer.id.slice(0, 8)}</small></td><td><span className="state-pill">{customer.state}</span></td><td>{customer.segment ?? "—"}</td><td>{customer.risk_level}</td><td>{new Date(customer.updated_at).toLocaleDateString("en-GB")}</td></tr>)}
          {customerRows.length === 0 && <tr><td colSpan={5} className="empty-state">No customer records yet. Start with a dry-run import.</td></tr>}
        </tbody></table></div>
      </section>
    </main>
  );
}
