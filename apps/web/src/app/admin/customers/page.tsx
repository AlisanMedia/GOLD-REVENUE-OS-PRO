import { getCustomerList } from "@/lib/admin/server";
import { customerStates } from "@gold-revenue-os/contracts";
import Link from "next/link";

type Search = { q?: string; state?: string; segment?: string; risk?: string; source?: string; manager?: string; from?: string; to?: string; page?: string };
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const pageNumber = (value: string | undefined) => Math.max(Number.parseInt(value ?? "1", 10) || 1, 1);

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const query: Search = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, one(value)]));
  const page = pageNumber(query.page);
  const result = await getCustomerList({
    ...(query.q ? { search: query.q } : {}),
    ...(query.state ? { state: query.state } : {}),
    ...(query.segment ? { segment: query.segment } : {}),
    ...(query.risk ? { risk: query.risk } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.manager ? { manager: query.manager } : {}),
    ...(query.from ? { createdFrom: query.from } : {}),
    ...(query.to ? { createdTo: query.to } : {}),
    page,
    pageSize: 25,
  });
  const pageCount = Math.max(Math.ceil(result.total / result.page_size), 1);
  const hrefFor = (target: number) => { const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value).map(([key, value]) => [key, value!])); params.set("page", String(target)); return `/admin/customers?${params}`; };
  return (
    <main className="admin-main">
      <p className="eyebrow">CUSTOMER OS</p>
      <div className="page-heading"><div><h1>Customers</h1><p className="lede">Server-filtered, tenant-scoped customer records. {result.total} matching records.</p></div></div>
      <form className="filter-panel" method="get"><label>Search<input name="q" defaultValue={query.q} placeholder="Name, email, Telegram, external ID" /></label><label>State<select name="state" defaultValue={query.state ?? ""}><option value="">All states</option>{customerStates.map((state) => <option key={state}>{state}</option>)}</select></label><label>Segment<input name="segment" defaultValue={query.segment} /></label><label>Risk<input name="risk" defaultValue={query.risk} /></label><label>Source<input name="source" defaultValue={query.source} /></label><label>Manager ID<input name="manager" defaultValue={query.manager} /></label><label>Created from<input name="from" type="date" defaultValue={query.from} /></label><label>Created to<input name="to" type="date" defaultValue={query.to} /></label><button className="secondary-button" type="submit">Apply filters</button><Link className="text-button" href="/admin/customers">Clear</Link></form>
      <section className="table-card" aria-label="Customer list">
        <div className="table-scroll"><table><thead><tr><th>Customer</th><th>Primary identity</th><th>State</th><th>Segment</th><th>Risk</th><th>Source</th><th>Next best action</th><th>Updated</th></tr></thead><tbody>
          {result.items.map((customer) => <tr key={customer.id}><td><Link className="table-link" href={`/admin/customers/${customer.id}`}>{customer.display_name || "Unnamed customer"}</Link><small>{customer.external_ref ?? customer.id.slice(0, 8)}</small></td><td>{customer.primary_identity_value ?? "Restricted / unavailable"}<small>{customer.primary_identity_type ?? ""}</small></td><td><span className="state-pill">{customer.state}</span></td><td>{customer.segment ?? "—"}</td><td>{customer.risk_level}</td><td>{customer.source_name ?? customer.source_type ?? "—"}</td><td className="bounded-cell">{customer.next_best_action ?? "—"}</td><td>{new Date(customer.updated_at).toLocaleDateString("en-GB")}</td></tr>)}
          {result.items.length === 0 && <tr><td colSpan={8} className="empty-state">No customer records match these filters.</td></tr>}
        </tbody></table></div>
      </section>
      <nav className="pagination" aria-label="Customer pages"><Link aria-disabled={page <= 1} href={hrefFor(Math.max(page - 1, 1))}>Previous</Link><span>Page {page} of {pageCount}</span><Link aria-disabled={page >= pageCount} href={hrefFor(Math.min(page + 1, pageCount))}>Next</Link></nav>
    </main>
  );
}
