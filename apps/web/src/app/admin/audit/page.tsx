import { getAuditList } from "@/lib/admin/server";
import Link from "next/link";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const filters = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, first(value)]));
  const page = Math.max(Number.parseInt(filters.page ?? "1", 10) || 1, 1);
  const data = await getAuditList({ ...filters, page, pageSize: 50 });
  const pages = Math.max(Math.ceil(data.total / data.page_size), 1);
  const hrefFor = (target: number) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, value!]));
    params.set("page", String(target));
    return `/admin/audit?${params}`;
  };

  return (
    <main className="admin-main">
      <p className="eyebrow">IMMUTABLE AUDIT</p>
      <h1>Privileged activity</h1>
      <p className="lede">Append-only tenant evidence. Managers receive metadata; controlled before/after values are exposed only to super admins.</p>
      <form className="filter-panel" method="get">
        <label>Actor ID<input name="actor" defaultValue={filters.actor} /></label>
        <label>Role<select name="role" defaultValue={filters.role ?? ""}><option value="">All</option>{["super_admin", "manager", "support", "analyst", "readonly"].map((role) => <option key={role}>{role}</option>)}</select></label>
        <label>Action<input name="action" defaultValue={filters.action} /></label>
        <label>Entity<input name="entity" defaultValue={filters.entity} /></label>
        <label>Correlation ID<input name="correlation" defaultValue={filters.correlation} /></label>
        <label>From<input name="from" type="datetime-local" defaultValue={filters.from} /></label>
        <label>To<input name="to" type="datetime-local" defaultValue={filters.to} /></label>
        <button className="secondary-button" type="submit">Apply filters</button>
        <Link className="text-button" href="/admin/audit">Clear</Link>
      </form>
      <section className="table-card table-scroll">
        <table><thead><tr><th>Actor</th><th>Action</th><th>Entity</th><th>Tenant</th><th>Correlation</th><th>Timestamp</th><th>Evidence</th></tr></thead>
          <tbody>{data.items.map((item) => <tr key={item.id}>
            <td>{item.actor_id ?? item.actor_type}<small>{item.role ?? item.actor_type}</small></td>
            <td>{item.action}</td><td>{item.entity_type}<small>{item.entity_id ?? "—"}</small></td>
            <td>{item.tenant_id.slice(0, 8)}…</td><td>{item.correlation_id?.slice(0, 8) ?? "—"}</td>
            <td>{new Date(item.created_at).toLocaleString("en-GB")}</td>
            <td>{item.before_data || item.after_data ? <details><summary>Controlled view</summary><pre>{JSON.stringify({ before: item.before_data, after: item.after_data }, null, 2)}</pre></details> : <span className="muted">Restricted</span>}</td>
          </tr>)}{data.items.length === 0 ? <tr><td className="empty-state" colSpan={7}>No audit records match these filters.</td></tr> : null}</tbody>
        </table>
      </section>
      <nav className="pagination"><Link href={hrefFor(Math.max(page - 1, 1))}>Previous</Link><span>Page {page} of {pages} · {data.total} records</span><Link href={hrefFor(Math.min(page + 1, pages))}>Next</Link></nav>
    </main>
  );
}
