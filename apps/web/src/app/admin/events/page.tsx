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
      <div className="page-heading"><div><p className="eyebrow">EVENT OPERATIONS</p><h1>Durable delivery history</h1><p className="lede">Append-only envelopes and processing state. Payloads are intentionally excluded from this operational list.</p></div></div>
      <form className="filter-panel" method="get"><label>Event type<input name="type" defaultValue={filters.type} /></label><label>Status<select name="status" defaultValue={filters.status ?? ""}><option value="">All</option>{["pending","processing","completed","dead_letter","not_queued"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Authority<select name="authority" defaultValue={filters.authority ?? ""}><option value="">All</option><option>TRUSTED</option><option>UNTRUSTED</option></select></label><label>Customer ID<input name="customer" defaultValue={filters.customer} /></label><label>Correlation ID<input name="correlation" defaultValue={filters.correlation} /></label><label>From<input name="from" type="datetime-local" defaultValue={filters.from} /></label><label>To<input name="to" type="datetime-local" defaultValue={filters.to} /></label><button className="secondary-button" type="submit">Apply filters</button><Link className="text-button" href="/admin/events">Clear</Link></form>
      <section className="table-card table-scroll">
        <table><thead><tr><th>Event</th><th>Customer</th><th>Processing</th><th>Correlation chain</th><th>Recorded</th></tr></thead>
          <tbody>{data.items.map((event) => <tr key={event.id}>
            <td><strong>{event.event_type}</strong><small>v{event.event_version} · {event.authority.toLowerCase()} · {event.producer}</small></td>
            <td>{event.customer_id ? <Link className="table-link" href={`/admin/customers/${event.customer_id}`}>{event.customer_id.slice(0, 8)}…</Link> : "—"}</td>
            <td><span className="state-pill">{event.status ?? "not queued"}</span><small>{event.attempts !== null ? `${event.attempts}/${event.max_attempts} attempts` : ""}{event.last_error_code ? ` · ${event.last_error_code}` : ""}</small></td>
            <td><code>{event.correlation_id.slice(0, 8)}…</code><small>cause {event.causation_id?.slice(0, 8) ?? "root"}</small></td>
            <td>{new Date(event.recorded_at).toLocaleString("en-GB")}</td>
          </tr>)}{data.items.length === 0 ? <tr><td colSpan={5} className="empty-state">No events match these filters.</td></tr> : null}</tbody>
        </table>
      </section>
      <nav className="pagination"><Link href={hrefFor(Math.max(page - 1, 1))} aria-disabled={page <= 1}>Previous</Link><span>Page {page} of {pageCount} · {data.total} events</span><Link href={hrefFor(Math.min(page + 1, pageCount))} aria-disabled={page >= pageCount}>Next</Link></nav>
    </main>
  );
}
