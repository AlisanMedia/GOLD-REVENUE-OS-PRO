import ManualStateTransition from "@/components/manual-state-transition";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { getCustomer360 } from "@/lib/customer-os/server";
import Link from "next/link";

function formatValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export default async function Customer360Page({ params }: { params: Promise<{ id: string }> }) {
  const data = await getCustomer360((await params).id);
  const safeTransitions: Record<string, Array<{ state: string; triggeringEvent: string }>> = {
    NEW: [{ state: "CONTACT_READY", triggeringEvent: "admin.manual_transition" }], CONTACT_READY: [{ state: "CONTACTED", triggeringEvent: "admin.manual_transition" }], CONTACTED: [{ state: "REPLIED", triggeringEvent: "admin.manual_transition" }],
    OFFER_SENT: [{ state: "NOT_INTERESTED", triggeringEvent: "admin.manual_transition" }], NOT_INTERESTED: [{ state: "SURVEY_OFFERED", triggeringEvent: "admin.manual_transition" }], SURVEY_COMPLETED: [{ state: "TRIAL_ACTIVE", triggeringEvent: "admin.manual_transition" }],
    EXPIRED: [{ state: "CHURNED", triggeringEvent: "admin.manual_transition" }], CHURNED: [{ state: "WINBACK", triggeringEvent: "admin.manual_transition" }],
  };
  return (
    <main className="admin-main">
      <Link className="back-link" href="/admin/customers">← Customers</Link>
      <p className="eyebrow">CUSTOMER 360</p>
      <h1>{data.customer.display_name || "Unnamed customer"}</h1>
      <p className="lede">{data.customer.state} · {data.customer.risk_level} · {data.customer.segment ?? "Unsegmented"}</p>
      <section className="detail-grid">
        <article className="detail-card"><h2>Overview</h2><dl><div><dt>Lifecycle state</dt><dd>{data.customer.state}</dd></div><div><dt>Segment / risk</dt><dd>{data.customer.segment ?? "Unsegmented"} · {data.customer.risk_level}</dd></div><div><dt>Source</dt><dd>{data.customer.source_name ?? data.customer.source_type ?? "Unknown"} · {data.customer.source_record_ref ?? "no source reference"}</dd></div><div><dt>Created</dt><dd>{new Date(data.customer.created_at).toLocaleString("en-GB")}</dd></div></dl></article>
        <article className="detail-card"><h2>Identities</h2>{data.identities.length ? <ul>{data.identities.map((item) => <li key={item.id}><strong>{item.identity_type}{item.is_primary ? " · primary" : ""}</strong><span>{item.identity_value}</span><small>normalized: {item.normalized_value} · source: {item.source_name ?? item.source_type ?? "unknown"} · {item.source_record_ref ?? "no reference"}</small></li>)}</ul> : <p className="muted">No visible identities. The current role may not access identity PII.</p>}</article>
        <article className="detail-card"><h2>Trading profile</h2>{data.profile ? <dl>{Object.entries(data.profile).filter(([key, value]) => !["customer_id","tenant_id","field_metadata","updated_at"].includes(key) && value !== null && value !== undefined && value !== "").map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{formatValue(value)}</dd></div>)}</dl> : <p className="muted">Profile is not populated yet.</p>}</article>
        <article className="detail-card"><h2>Memory</h2>{data.memory.length ? <ul>{data.memory.map((item) => <li key={item.id}><strong>{item.memory_key.replaceAll("_", " ")}</strong><span>{formatValue(item.memory_value)} · confidence {item.confidence}</span><small>{item.source_type} · observed {new Date(item.observed_at).toLocaleString("en-GB")} · {item.superseded_at ? `superseded ${new Date(item.superseded_at).toLocaleString("en-GB")}` : "active"}</small></li>)}</ul> : <p className="muted">No learned memory yet.</p>}</article>
        <article className="detail-card"><h2>State history</h2>{data.state_history.length ? <ul>{data.state_history.map((item) => <li key={item.id}><strong>{item.from_state ?? "—"} → {item.to_state}</strong><span>{item.reason_code ?? "state change"} · {item.actor_type}{item.actor_id ? `:${item.actor_id}` : ""}</span><small>{new Date(item.occurred_at).toLocaleString("en-GB")} · {item.triggering_event} · correlation {item.correlation_id}</small></li>)}</ul> : <p className="muted">No state history yet.</p>}</article>
        <article className="detail-card"><h2>Event timeline</h2>{data.events.length ? <ul>{data.events.map((item) => <li key={item.id}><strong>{item.event_type} · v{item.event_version}</strong><span>{item.authority.toLowerCase()} · {item.producer} · {item.processing_status ?? "not queued"}{item.attempts !== null && item.attempts !== undefined ? ` · ${item.attempts} attempts` : ""}</span><small>correlation {item.correlation_id} · cause {item.causation_id ?? "root"}{item.last_error_code ? ` · ${item.last_error_code}` : ""}</small></li>)}</ul> : <p className="muted">No visible events recorded.</p>}</article>
        <article className="detail-card"><h2>Transition results</h2>{data.transition_attempts.length ? <ul>{data.transition_attempts.map((item) => <li key={item.id}><strong>{item.observed_from_state} → {item.to_state}</strong><span>{item.result}{item.rejection_code ? ` · ${item.rejection_code}` : ""} · {item.reason_code}</span><small>{item.triggering_event} · correlation {item.correlation_id}</small></li>)}</ul> : <p className="muted">No transition attempts recorded.</p>}</article>
        <article className="detail-card"><h2>Audit</h2>{data.audit.length ? <ul>{data.audit.map((item) => <li key={item.id}><strong>{item.action}</strong><span>{item.actor_type} · {item.actor_id ?? "system"}</span><small>{new Date(item.created_at).toLocaleString("en-GB")} · correlation {item.correlation_id ?? "none"}</small></li>)}</ul> : <p className="muted">No visible privileged audit records for this customer.</p>}</article>
        {hasAdminCapability(data.role, "customers.transition") ? <article className="detail-card"><h2>Manual state transition</h2><ManualStateTransition customerId={data.customer.id} currentState={data.customer.state} options={safeTransitions[data.customer.state] ?? []} /></article> : null}
      </section>
    </main>
  );
}
