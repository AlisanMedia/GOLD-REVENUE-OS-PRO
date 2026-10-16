import { T, AdminDate, AdminNumber } from "../../../components/admin-i18n";
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
      <p className="eyebrow"><T k="IMMUTABLE AUDIT"/></p>
      <h1><T k="Privileged activity"/></h1>
      <p className="lede"><T k="Append-only tenant evidence. Managers receive metadata; controlled before/after values are exposed only to super admins."/></p>
      <form className="filter-panel" method="get">
        <label><T k="Actor ID"/><input name="actor" defaultValue={filters.actor} /></label>
        <label><T k="Role"/><select name="role" defaultValue={filters.role ?? ""}><option value=""><T k="All"/></option>{["super_admin", "manager", "support", "analyst", "readonly"].map((role) => <option key={role}>{role}</option>)}</select></label>
        <label><T k="Action"/><input name="action" defaultValue={filters.action} /></label>
        <label><T k="Entity"/><input name="entity" defaultValue={filters.entity} /></label>
        <label><T k="Correlation ID"/><input name="correlation" defaultValue={filters.correlation} /></label>
        <label><T k="From"/><input name="from" type="datetime-local" defaultValue={filters.from} /></label>
        <label><T k="To"/><input name="to" type="datetime-local" defaultValue={filters.to} /></label>
        <button className="secondary-button" type="submit"><T k="Apply filters"/></button>
        <Link className="text-button" href="/admin/audit"><T k="Clear"/></Link>
      </form>
      <section className="table-card table-scroll">
        <table><thead><tr><th><T k="Actor"/></th><th><T k="Action"/></th><th><T k="Entity"/></th><th><T k="Tenant"/></th><th><T k="Correlation"/></th><th><T k="Timestamp"/></th><th><T k="Evidence"/></th></tr></thead>
          <tbody>{data.items.map((item) => <tr key={item.id}>
            <td>{item.actor_id ?? item.actor_type}<small>{item.role ?? item.actor_type}</small></td>
            <td>{item.action}</td><td>{item.entity_type}<small>{item.entity_id ?? "—"}</small></td>
            <td>{item.tenant_id.slice(0, 8)}…</td><td>{item.correlation_id?.slice(0, 8) ?? "—"}</td>
            <td>{<AdminDate value={item.created_at}/>}</td>
            <td>{item.before_data || item.after_data ? <details><summary><T k="Controlled view"/></summary><pre>{JSON.stringify({ before: item.before_data, after: item.after_data }, null, 2)}</pre></details> : <span className="muted"><T k="Restricted"/></span>}</td>
          </tr>)}{data.items.length === 0 ? <tr><td className="empty-state" colSpan={7}><T k="No audit records match these filters."/></td></tr> : null}</tbody>
        </table>
      </section>
      <nav className="pagination"><Link href={hrefFor(Math.max(page - 1, 1))}><T k="Previous"/></Link><span><T k="Page"/> {<AdminNumber value={page}/>} <T k="of"/> {pages} · {data.total} <T k="records"/></span><Link href={hrefFor(Math.min(page + 1, pages))}><T k="Next"/></Link></nav>
    </main>
  );
}
