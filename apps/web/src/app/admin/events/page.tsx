import { T, AdminDate, AdminNumber } from "../../../components/admin-i18n";
import { getEventList } from "@/lib/admin/server";
import Link from "next/link";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
export default async function EventDiagnosticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams; const filters = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, first(value)])); const page = Math.max(Number.parseInt(filters.page ?? "1", 10) || 1, 1);
  const data = await getEventList({ ...filters, page, pageSize: 50 });
  const pageCount = Math.max(Math.ceil(data.total / data.page_size), 1);
  const hrefFor = (target: number) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, value!]));
    params.set("page", String(target));
    return `/admin/events?${params}`;
  };
  return (
    <main className="admin-main">
      <div className="page-heading"><div><p className="eyebrow"><T k="EVENT OPERATIONS"/></p><h1><T k="Durable delivery history"/></h1><p className="lede"><T k="Append-only envelopes and processing state. Payloads are intentionally excluded from this operational list."/></p></div></div>
      <form className="filter-panel" method="get"><label><T k="Event type"/><input name="type" defaultValue={filters.type} /></label><label><T k="Status"/><select name="status" defaultValue={filters.status ?? ""}><option value=""><T k="All"/></option>{["pending","processing","completed","dead_letter","not_queued"].map((value) => <option key={value}>{value}</option>)}</select></label><label><T k="Authority"/><select name="authority" defaultValue={filters.authority ?? ""}><option value=""><T k="All"/></option><option value="TRUSTED"><T k="TRUSTED"/></option><option value="UNTRUSTED"><T k="UNTRUSTED"/></option></select></label><label><T k="Customer ID"/><input name="customer" defaultValue={filters.customer} /></label><label><T k="Correlation ID"/><input name="correlation" defaultValue={filters.correlation} /></label><label><T k="From"/><input name="from" type="datetime-local" defaultValue={filters.from} /></label><label><T k="To"/><input name="to" type="datetime-local" defaultValue={filters.to} /></label><button className="secondary-button" type="submit"><T k="Apply filters"/></button><Link className="text-button" href="/admin/events"><T k="Clear"/></Link></form>
      <section className="table-card table-scroll">
        <table><thead><tr><th><T k="Event"/></th><th><T k="Customer"/></th><th><T k="Processing"/></th><th><T k="Correlation chain"/></th><th><T k="Recorded"/></th></tr></thead>
          <tbody>{data.items.map((event) => <tr key={event.id}>
            <td><strong>{event.event_type}</strong><small><T k="v"/>{event.event_version} · {event.authority.toLowerCase()} · {event.producer}</small></td>
            <td>{event.customer_id ? <Link className="table-link" href={`/admin/customers/${event.customer_id}`}>{event.customer_id.slice(0, 8)}…</Link> : "—"}</td>
            <td><span className="state-pill">{event.status ?? <T k="not queued"/>}</span><small>{event.attempts !== null ? `${event.attempts}/${event.max_attempts} attempts` : ""}{event.last_error_code ? ` · ${event.last_error_code}` : ""}</small></td>
            <td><code>{event.correlation_id.slice(0, 8)}…</code><small><T k="cause"/> {event.causation_id?.slice(0, 8) ?? <T k="root"/>}</small></td>
            <td>{<AdminDate value={event.recorded_at}/>}</td>
          </tr>)}{data.items.length === 0 ? <tr><td colSpan={5} className="empty-state"><T k="No events match these filters."/></td></tr> : null}</tbody>
        </table>
      </section>
      <nav className="pagination"><Link href={hrefFor(Math.max(page - 1, 1))} aria-disabled={page <= 1}><T k="Previous"/></Link><span><T k="Page"/> {<AdminNumber value={page}/>} <T k="of"/> {<AdminNumber value={pageCount}/>} · {data.total} <T k="events"/></span><Link href={hrefFor(Math.min(page + 1, pageCount))} aria-disabled={page >= pageCount}><T k="Next"/></Link></nav>
    </main>
  );
}
