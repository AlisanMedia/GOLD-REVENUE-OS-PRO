import { getCustomer360, requireCustomerTenant } from "@/lib/customer-os/server";

function formatValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export default async function Customer360Page({ params }: { params: Promise<{ id: string }> }) {
  await requireCustomerTenant();
  const data = await getCustomer360((await params).id);
  return (
    <main className="admin-main">
      <a className="back-link" href="/admin/customers">← Customers</a>
      <p className="eyebrow">CUSTOMER 360</p>
      <h1>{data.customer.display_name || "Unnamed customer"}</h1>
      <p className="lede">{data.customer.state} · {data.customer.risk_level} · {data.customer.segment ?? "Unsegmented"}</p>
      <section className="detail-grid">
        <article className="detail-card"><h2>Identities</h2>{data.identities.length ? <ul>{data.identities.map((item) => <li key={item.id}><strong>{item.identity_type}</strong><span>{item.identity_value}</span></li>)}</ul> : <p className="muted">No identities recorded.</p>}</article>
        <article className="detail-card"><h2>Profile</h2>{data.profile ? <dl>{Object.entries(data.profile).filter(([key, value]) => key !== "customer_id" && key !== "tenant_id" && key !== "field_metadata" && value !== null && value !== undefined && value !== "").map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{formatValue(value)}</dd></div>)}</dl> : <p className="muted">Profile is not populated yet.</p>}</article>
        <article className="detail-card"><h2>Active memory</h2>{data.memory.length ? <ul>{data.memory.map((item) => <li key={item.id}><strong>{item.memory_key.replaceAll("_", " ")}</strong><span>{formatValue(item.memory_value)} · confidence {item.confidence}</span></li>)}</ul> : <p className="muted">No learned memory yet.</p>}</article>
        <article className="detail-card"><h2>State history</h2>{data.state_history.length ? <ul>{data.state_history.map((item) => <li key={item.id}><strong>{item.from_state ?? "—"} → {item.to_state}</strong><span>{item.reason_code ?? "state change"}</span></li>)}</ul> : <p className="muted">No state history yet.</p>}</article>
      </section>
    </main>
  );
}
