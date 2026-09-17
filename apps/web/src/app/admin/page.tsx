import { hasAdminCapability } from "@/lib/admin/permissions";
import { getAttentionItems, getDashboardMetrics, requireAdminCapability } from "@/lib/admin/server";
import Link from "next/link";

export default async function AdminDashboardPage() {
  const context = await requireAdminCapability("dashboard.read");
  const [metrics, attention] = await Promise.all([getDashboardMetrics(), hasAdminCapability(context.role, "attention.read") ? getAttentionItems() : Promise.resolve([])]);
  const states = Object.entries(metrics.customers_by_state).sort((a, b) => b[1] - a[1]);
  return <main className="admin-main">
    <div className="page-heading"><div><p className="eyebrow">ADMIN CONTROL PLANE</p><h1>Operational truth, one surface.</h1><p className="lede">Live tenant data from Customer OS, event processing, imports and audit. No simulated revenue or agent metrics.</p></div></div>
    <section className="metric-grid dashboard-metrics" aria-label="Operational metrics">
      <article className="metric"><span>Total customers</span><strong>{metrics.total_customers}</strong></article><article className="metric"><span>Open import review</span><strong>{metrics.open_import_reviews}</strong></article>
      <article className="metric"><span>Probable / ambiguous</span><strong>{metrics.probable_identities + metrics.ambiguous_identities}</strong><small>{metrics.probable_identities} probable · {metrics.ambiguous_identities} ambiguous</small></article>
      <article className="metric"><span>Failed / dead-letter</span><strong>{metrics.failed_events}</strong></article><article className="metric"><span>Recent events · 24h</span><strong>{metrics.recent_events}</strong></article>
      <article className="metric"><span>Scheduled backlog</span><strong>{metrics.scheduled_backlog}</strong></article><article className="metric"><span>Privileged audit · 24h</span><strong>{metrics.recent_audit}</strong></article>
      <article className="metric metric-muted"><span>Revenue analytics</span><strong>Not available yet</strong><small>Payment and subscription domains are not implemented.</small></article>
    </section>
    <section className="dashboard-columns">
      <article className="detail-card"><div className="card-heading"><h2>Customers by lifecycle state</h2><Link href="/admin/customers">View customers</Link></div>{states.length ? <ul>{states.map(([state, count]) => <li key={state}><strong>{state}</strong><span>{count}</span></li>)}</ul> : <p className="muted">No customer state data yet.</p>}</article>
      <article className="detail-card"><div className="card-heading"><h2>Recent customers</h2><Link href="/admin/customers">Open Customer OS</Link></div>{metrics.recent_customers.length ? <ul>{metrics.recent_customers.map((customer) => <li key={customer.id}><Link className="table-link" href={`/admin/customers/${customer.id}`}>{customer.display_name || "Unnamed customer"}</Link><span>{customer.state} · {new Date(customer.created_at).toLocaleString("en-GB")}</span></li>)}</ul> : <p className="muted">No customers yet.</p>}</article>
    </section>
    {hasAdminCapability(context.role, "attention.read") ? <section className="detail-card full-width-card"><div className="card-heading"><h2>Needs attention</h2><Link href="/admin/attention">Open queue</Link></div>{attention.length ? <ul>{attention.slice(0, 6).map((item) => <li key={`${item.category}:${item.entity_id}`}><strong>{item.category.replaceAll("_", " ")}</strong><span>{item.summary || "Action required"} · {item.severity}</span></li>)}</ul> : <p className="muted">No actionable failures or unresolved reviews.</p>}</section> : null}
  </main>;
}
