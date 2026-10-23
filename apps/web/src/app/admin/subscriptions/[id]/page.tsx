import Link from "next/link";
import { notFound } from "next/navigation";
import { T, CustomerPreviewBoundary, AdminDate, AdminEnum, AdminNumber, AdminPlanDuration, AdminDecimal } from "../../../../components/admin-i18n";
import { EntitlementPagination, EntitlementReadError } from "@/components/entitlement-pagination";
import { entitlementPage, subscriptionDetail, entitlementJobHealth } from "@/lib/entitlements/admin";
import { EntitlementJobHealth } from "@/components/entitlement-job-health";
import { entitlementHref, entitlementSearchSchema } from "@/lib/entitlements/read-model";
import { getCustomerDisplayNames } from "@/lib/admin/server";
import PurchaseStatus from "@/components/purchase-status";
import type { CopyKey } from "@/lib/i18n/core";

const operationLabels = { invite: "Invite operation", join: "Join verification", revoke: "Revoke operation", reconcile: "Reconciliation operation" } as const;
const actionLabels: Readonly<Record<string, CopyKey>> = {
  activated: "Subscription activated", renewed: "Subscription renewed", access_scope_review: "Access scope review", access_requested: "Access requested",
  hold: "Manual hold", suspend: "Suspend", cancel: "Cancel", release: "Release hold", reconcile: "Reconcile", revoke: "Revoke access",
  payment_evidence_hold: "Payment evidence hold", expired: "Expired subscription", renewal_due: "Renewal due recorded", job_claimed: "Job claimed", retry: "Retry recorded",
  job_invite: "Invite operation", job_join: "Join verification", job_revoke: "Revoke operation", job_reconcile: "Reconciliation operation",
};
const evidenceLabels = { payments: "Payment periods", access: "Channel Access", jobs: "Access jobs", audit: "History" } as const;

export default async function SubscriptionDetail({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const d = await subscriptionDetail(id);
  if (d.error) return <main className="admin-main"><EntitlementReadError error={d.error} href="/admin/subscriptions"/></main>;
  if (!d.detail) notFound();
  const { subscription: sub, access, plan_terms: terms } = d.detail;
  const names = await getCustomerDisplayNames([sub.customer_id]);
  const path = `/admin/subscriptions/${id}`;
  const query = entitlementSearchSchema.safeParse(await searchParams);
  const q = query.success ? query.data : null;
  // Route identity owns this evidence scope; URL customer input cannot replace it.
  const validScope = q && (!q.customer || q.customer === sub.customer_id);
  const evidence = validScope ? await entitlementPage(q.evidence, { subscription: id, customer: sub.customer_id, size: Number(q.size), cursor: q.cursor }) : null;
  const health = q?.evidence === "jobs" && evidence?.page?.items.length ? await entitlementJobHealth(id, evidence.page.items.map(j=>j.id)) : null;
  const healthByJob = new Map(health?.data?.items.map(j=>[j.job_id,j]));
  return <main className="admin-main">
    <Link className="back-link" href="/admin/subscriptions">← <T k="Subscriptions"/></Link>
    <h1><T k="Subscription journey and audit"/></h1><p><Link href={`/admin/customers/${sub.customer_id}`}>{names[sub.customer_id] ?? <T k="Customer"/>}</Link> · {sub.plan_snapshot.title} · <AdminEnum value={sub.mode}/> · <AdminEnum value={sub.state}/></p>
    <CustomerPreviewBoundary><PurchaseStatus now={Date.parse(d.detail.observed_at)} mode={sub.mode} paymentVerified={sub.has_payment}
      state={sub.state} endsAt={sub.ends_at} graceUntil={sub.grace_until} accessStatus={access?.status} invite={access?.invite_reference} inviteExpires={access?.invite_expires_at}/></CustomerPreviewBoundary>
    <section className="detail-card case-section"><h2><T k="Immutable plan and terms"/></h2><p>{sub.plan_snapshot.title}</p>
      <AdminPlanDuration count={sub.plan_snapshot.duration_count} unit={sub.plan_snapshot.duration_unit}/><p><T k="Expires"/> · <AdminDate value={sub.ends_at}/></p>
      <details><summary><T k="Approved plan terms"/></summary><div lang={terms.locale ?? undefined} style={{ overflowWrap: "anywhere" }}>
        {terms.amount && terms.currency && <p><T k="Plan price — not collected revenue"/>: <AdminDecimal value={terms.amount}/> {terms.currency}</p>}
        <p>{terms.terms ?? <T k="Plan terms are not recorded in this snapshot."/>}</p>
        {terms.inclusions.map((text,index)=><p key={`inclusion-${index}`}>{text}</p>)}
        {terms.restrictions.map((text,index)=><p key={`restriction-${index}`}>{text}</p>)}
        {terms.disclosures.map((text,index)=><p key={`disclosure-${index}`}>{text}</p>)}
        {terms.tax_rule && <p>{terms.tax_rule}</p>}{terms.renewal_rule && <p>{terms.renewal_rule}</p>}{terms.cancellation_rule && <p>{terms.cancellation_rule}</p>}
      </div></details>
      <details><summary><T k="Technical references"/></summary><p>{sub.id}<br/>{sub.plan_version_id}</p><AdminNumber value={sub.revision}/></details>
    </section>
    <h2 id="entitlement-evidence-title"><T k="Subscription evidence"/></h2>
    <nav className="survey-tabs" aria-labelledby="entitlement-evidence-title">{(Object.keys(evidenceLabels) as (keyof typeof evidenceLabels)[]).map(key =>
      <Link key={key} href={entitlementHref(path, { size: q?.size ?? "25", evidence: key })} aria-current={q?.evidence === key ? "page" : undefined}><T k={evidenceLabels[key]}/></Link>)}</nav>
    {!validScope ? <EntitlementReadError error="cursor" href={path}/> : evidence?.error ? <EntitlementReadError error={evidence.error} href={entitlementHref(path, { size: q.size, evidence: q.evidence })}/> : evidence?.page && <>
      {health?.error&&<p className="alert" role="alert"><T k="Review details unavailable. No successful operation is assumed."/></p>}
      <div className="case-list">{evidence.page.items.map(e => <article key={e.id} className="detail-card case-section">
        {"period_start" in e ? <><p><AdminEnum value={e.mode}/> · <AdminDate value={e.period_start}/> → <AdminDate value={e.period_end}/></p>
          {(e.event_id || e.receipt_id || e.test_invoice_id) && <details><summary><T k="Technical references"/></summary><p>{e.event_id}<br/>{e.receipt_id ?? e.test_invoice_id}</p></details>}</> :
          "telegram_user_id" in e ? <><p><AdminEnum value={e.mode}/> · <AdminEnum value={e.status}/></p><p>{e.telegram_user_id ?? <T k="Identity details restricted"/>}</p>
            <p><T k={e.invite_present ? "Invitation recorded" : "No invitation"}/> · <AdminDate value={e.invite_expires_at}/></p><p><T k="Checked:"/> <AdminDate value={e.membership_checked_at}/></p></> :
          "available_at" in e ? <><p><T k={operationLabels[e.operation]}/> · <AdminEnum value={e.status}/></p><p><AdminDate value={e.available_at}/> · <T k="· attempts"/> <AdminNumber value={e.attempts}/></p>
            {healthByJob.has(e.id) ? <EntitlementJobHealth data={healthByJob.get(e.id)!}/> : e.last_error && <p className="muted"><T k={e.last_error === "PROVIDER_FAILURE" ? "Provider failure; retry status is shown above." : "Technical details restricted"}/></p>}</> :
          <><p><AdminDate value={e.created_at}/> · <T k={actionLabels[e.action] ?? "Other recorded action"}/> · <AdminEnum value={e.mode}/></p>
            {e.details.attempt !== undefined && <p><T k="· attempts"/> <AdminNumber value={e.details.attempt}/></p>}</>}
      </article>)}</div>
      {!evidence.page.items.length && <p className="empty-state"><T k="No records on this page."/></p>}
      <EntitlementPagination path={path} size={q.size} evidence={q.evidence} next={evidence.page.next_cursor} hasMore={evidence.page.has_more} count={evidence.page.items.length} continued={Boolean(q.cursor)}/>
    </>}
  </main>;
}
