import { T, AdminEnum, AdminDate } from "../../../../components/admin-i18n";
import { successList } from "@/lib/customer-success/server";
import { SuccessTaskCards } from "@/components/customer-success-views";
import ManualStateTransition from "@/components/manual-state-transition";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { getCustomer360 } from "@/lib/customer-os/server";
import Link from "next/link";
import { entitlementPage } from "@/lib/entitlements/admin";
import { entitlementSearchSchema } from "@/lib/entitlements/read-model";
import { EntitlementPagination, EntitlementReadError } from "@/components/entitlement-pagination";
import { getConversationList } from "@/lib/messaging/server";

function formatValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export default async function Customer360Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const customerId = (await params).id;
  const data = await getCustomer360(customerId);
  const success = hasAdminCapability(data.role,"success.read") ? await successList({customer:customerId}) : null;
  const canReadEntitlements = hasAdminCapability(data.role,"entitlements.read");
  const entitlementQuery = entitlementSearchSchema.safeParse(await searchParams);
  const entitlementScopeValid = entitlementQuery.success && (!entitlementQuery.data.customer || entitlementQuery.data.customer === customerId);
  const entitlements = canReadEntitlements && entitlementScopeValid ? await entitlementPage("subscriptions",{customer:customerId,size:Number(entitlementQuery.data.size),cursor:entitlementQuery.data.cursor}) : null;
  const conversations = hasAdminCapability(data.role, "messaging.read")
    ? await getConversationList({ customerId, page: 1, pageSize: 20 })
    : null;
  const safeTransitions: Record<string, Array<{ state: string; triggeringEvent: string }>> = {
    NEW: [{ state: "CONTACT_READY", triggeringEvent: "admin.manual_transition" }], CONTACT_READY: [{ state: "CONTACTED", triggeringEvent: "admin.manual_transition" }], CONTACTED: [{ state: "REPLIED", triggeringEvent: "admin.manual_transition" }],
    OFFER_SENT: [{ state: "NOT_INTERESTED", triggeringEvent: "admin.manual_transition" }], NOT_INTERESTED: [{ state: "SURVEY_OFFERED", triggeringEvent: "admin.manual_transition" }], SURVEY_COMPLETED: [{ state: "TRIAL_ACTIVE", triggeringEvent: "admin.manual_transition" }],
    EXPIRED: [{ state: "CHURNED", triggeringEvent: "admin.manual_transition" }], CHURNED: [{ state: "WINBACK", triggeringEvent: "admin.manual_transition" }],
  };
  return (
    <main className="admin-main">
      <Link className="back-link" href="/admin/customers"><T k="← Customers"/></Link>
      <p className="eyebrow"><T k="CUSTOMER 360"/></p>
      <h1>{data.customer.display_name || <T k="Unnamed customer"/>}</h1>
      <p className="lede">{<AdminEnum value={data.customer.state}/>} · {<AdminEnum value={data.customer.risk_level}/>} · {data.customer.segment ?? <T k="Unsegmented"/>}</p>
      {success&&<section className="case-section"><div className="card-heading"><h2><T k="Customer Success"/></h2><Link href={`/admin/customer-success?customer=${customerId}`}><T k="Open customer success"/> →</Link></div><SuccessTaskCards items={success.items.slice(0,3)} managers={success.managers}/></section>}
      {hasAdminCapability(data.role,"surveys.read")&&<p><Link className="table-link" href={`/admin/feedback?customer=${customerId}`}><T k="Survey feedback"/> →</Link></p>}
      <section className="detail-grid">
        {canReadEntitlements && <article className="detail-card"><h2><T k="Payments, subscriptions and VIP"/></h2>
          {!entitlementScopeValid ? <EntitlementReadError error="cursor" href={`/admin/customers/${customerId}`}/> : entitlements?.error ? <EntitlementReadError error={entitlements.error} href={`/admin/customers/${customerId}`}/> : entitlements?.page && <>
            {entitlements.page.items.map(s=><p key={s.id}><Link href={`/admin/subscriptions/${s.id}`}>{s.plan_snapshot.title} · <AdminEnum value={s.mode}/> · <AdminEnum value={s.state}/></Link><br/>
              <T k="Expires"/> <AdminDate value={s.ends_at}/><br/><T k="Payment evidence:"/> <AdminEnum value={s.has_payment ? s.mode==="test" ? "SANDBOX_VERIFIED" : "VERIFIED_RECEIPT" : "NOT_VERIFIED"}/><br/>
              <T k="VIP:"/> {s.access_status ? <AdminEnum value={s.access_status}/> : <T k="Not requested"/>}</p>)}
            {!entitlements.page.items.length&&<p><T k={entitlementQuery.data.cursor ? "No records on this page." : "No verified entitlement."}/></p>}
            <EntitlementPagination path={`/admin/customers/${customerId}`} size={entitlementQuery.data.size} next={entitlements.page.next_cursor} hasMore={entitlements.page.has_more} count={entitlements.page.items.length} continued={Boolean(entitlementQuery.data.cursor)}/>
          </>}
        </article>}
        <article className="detail-card"><h2><T k="Overview"/></h2><dl><div><dt><T k="Lifecycle state"/></dt><dd>{<AdminEnum value={data.customer.state}/>}</dd></div><div><dt><T k="Segment / risk"/></dt><dd>{data.customer.segment ?? <T k="Unsegmented"/>} · {<AdminEnum value={data.customer.risk_level}/>}</dd></div><div><dt><T k="Source"/></dt><dd>{data.customer.source_name ?? data.customer.source_type ?? <T k="Unknown"/>} · {data.customer.source_record_ref ?? <T k="no source reference"/>}</dd></div><div><dt><T k="Created"/></dt><dd>{<AdminDate value={data.customer.created_at}/>}</dd></div></dl></article>
        <details className="detail-card secondary-records"><summary><T k="Identities"/></summary>{data.identities.length ? <ul>{data.identities.map((item) => <li key={item.id}><strong>{item.identity_type}{item.is_primary ? <T k=" · primary"/> : ""}</strong><span>{item.identity_value}</span><small><T k="normalized:"/> {item.normalized_value} <T k="· source:"/> {item.source_name ?? item.source_type ?? "unknown"} · {item.source_record_ref ?? <T k="no reference"/>}</small></li>)}</ul> : <p className="muted"><T k="No visible identities. The current role may not access identity PII."/></p>}</details>
        <details className="detail-card secondary-records"><summary><T k="Trading profile"/></summary>{data.profile ? <dl>{Object.entries(data.profile).filter(([key, value]) => !["customer_id","tenant_id","field_metadata","updated_at"].includes(key) && value !== null && value !== undefined && value !== "").map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{formatValue(value)}</dd></div>)}</dl> : <p className="muted"><T k="Profile is not populated yet."/></p>}</details>
        <details className="detail-card secondary-records"><summary><T k="Memory"/></summary>{data.memory.length ? <ul>{data.memory.map((item) => <li key={item.id}><strong>{item.memory_key.replaceAll("_", " ")}</strong><span>{formatValue(item.memory_value)} <T k="· confidence"/> {item.confidence}</span><small>{item.source_type} <T k="· observed"/> {<AdminDate value={item.observed_at}/>} · {item.superseded_at ? `superseded ${new Date(item.superseded_at).toLocaleString("en-GB")}` : <T k="active"/>}</small></li>)}</ul> : <p className="muted"><T k="No learned memory yet."/></p>}</details>
        <details className="detail-card secondary-records"><summary><T k="State history"/></summary>{data.state_history.length ? <ul>{data.state_history.map((item) => <li key={item.id}><strong>{item.from_state ?? "—"} → {item.to_state}</strong><span>{item.reason_code ?? <T k="state change"/>} · {item.actor_type}{item.actor_id ? `:${item.actor_id}` : ""}</span><small>{<AdminDate value={item.occurred_at}/>} · {item.triggering_event} <T k="· correlation"/> {item.correlation_id}</small></li>)}</ul> : <p className="muted"><T k="No state history yet."/></p>}</details>
        <details className="detail-card secondary-records"><summary><T k="Event timeline"/></summary>{data.events.length ? <ul>{data.events.map((item) => <li key={item.id}><strong>{item.event_type} <T k="· v"/>{item.event_version}</strong><span>{item.authority.toLowerCase()} · {item.producer} · {item.processing_status ?? <T k="not queued"/>}{item.attempts !== null && item.attempts !== undefined ? ` · ${item.attempts} attempts` : ""}</span><small><T k="correlation"/> {item.correlation_id} <T k="· cause"/> {item.causation_id ?? <T k="root"/>}{item.last_error_code ? ` · ${item.last_error_code}` : ""}</small></li>)}</ul> : <p className="muted"><T k="No visible events recorded."/></p>}</details>
        {conversations ? <article className="detail-card"><h2><T k="Conversations"/></h2>{conversations.items.length ? <ul>{conversations.items.map((item) => <li key={item.id}><strong><Link className="table-link" href={`/admin/conversations/${item.id}`}><T k="Telegram ·"/> {<AdminEnum value={item.status}/>}</Link></strong><span>{<AdminEnum value={item.contactability}/>} · {<AdminEnum value={item.identity_resolution}/>}{item.review_required ? <T k=" · review required"/> : ""}</span><small>{item.last_message_at ? <AdminDate value={item.last_message_at}/> : <T k="No messages"/>}</small></li>)}</ul> : <p className="muted"><T k="No messaging conversation linked to this customer."/></p>}</article> : null}
        <details className="detail-card secondary-records"><summary><T k="Transition results"/></summary>{data.transition_attempts.length ? <ul>{data.transition_attempts.map((item) => <li key={item.id}><strong>{item.observed_from_state} → {item.to_state}</strong><span>{item.result}{item.rejection_code ? ` · ${item.rejection_code}` : ""} · {item.reason_code}</span><small>{item.triggering_event} <T k="· correlation"/> {item.correlation_id}</small></li>)}</ul> : <p className="muted"><T k="No transition attempts recorded."/></p>}</details>
        <details className="detail-card secondary-records"><summary><T k="Audit"/></summary>{data.audit.length ? <ul>{data.audit.map((item) => <li key={item.id}><strong>{item.action}</strong><span>{item.actor_type} · {item.actor_id ?? <T k="system"/>}</span><small>{<AdminDate value={item.created_at}/>} <T k="· correlation"/> {item.correlation_id ?? <T k="none"/>}</small></li>)}</ul> : <p className="muted"><T k="No visible privileged audit records for this customer."/></p>}</details>
        {hasAdminCapability(data.role, "customers.transition") ? <details className="detail-card secondary-records"><summary><T k="Manual state transition"/></summary><ManualStateTransition customerId={data.customer.id} currentState={data.customer.state} options={safeTransitions[data.customer.state] ?? []} /></details> : null}
      </section>
    </main>
  );
}
