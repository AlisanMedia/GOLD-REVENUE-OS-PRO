import { getEventDiagnostics } from "@/lib/customer-os/server";
import Link from "next/link";

export default async function EventDiagnosticsPage() {
  const data = await getEventDiagnostics();
  const outboxByEvent = new Map(data.outbox.map((row) => [row.event_id, row]));
  const failed = data.outbox.filter((row) => row.status === "dead_letter" || row.last_error_code);
  return (
    <main className="admin-main">
      <div className="page-heading"><div><p className="eyebrow">EVENT ENGINE</p><h1>Delivery diagnostics</h1><p className="lede">Durable event envelopes, retry state, dead letters and correlation chains.</p></div></div>
      <section className="metric-grid" aria-label="Event status">
        <article className="metric"><span>Visible events</span><strong>{data.events.length}</strong></article>
        <article className="metric"><span>Pending</span><strong>{data.outbox.filter((row) => row.status === "pending").length}</strong></article>
        <article className="metric"><span>Completed</span><strong>{data.outbox.filter((row) => row.status === "completed").length}</strong></article>
        <article className="metric"><span>Failed / dead-letter</span><strong>{failed.length}</strong></article>
      </section>
      <section className="table-card table-scroll">
        <table><thead><tr><th>Event</th><th>Customer</th><th>Processing</th><th>Correlation chain</th><th>Recorded</th></tr></thead>
          <tbody>{data.events.map((event) => { const outbox = outboxByEvent.get(event.id); return <tr key={event.id}>
            <td><strong>{event.event_type}</strong><small>v{event.event_version} · {event.authority.toLowerCase()} · {event.producer}</small></td>
            <td>{event.customer_id ? <Link className="table-link" href={`/admin/customers/${event.customer_id}`}>{event.customer_id.slice(0, 8)}…</Link> : "—"}</td>
            <td><span className="state-pill">{outbox?.status ?? "not queued"}</span><small>{outbox ? `${outbox.attempts}/${outbox.max_attempts} attempts` : ""}{outbox?.last_error_code ? ` · ${outbox.last_error_code}` : ""}</small></td>
            <td><code>{event.correlation_id.slice(0, 8)}…</code><small>cause {event.causation_id?.slice(0, 8) ?? "root"}</small></td>
            <td>{new Date(event.recorded_at).toLocaleString("en-GB")}</td>
          </tr>; })}</tbody>
        </table>
      </section>
    </main>
  );
}
