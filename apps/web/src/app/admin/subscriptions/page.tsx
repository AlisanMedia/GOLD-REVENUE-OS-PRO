import { T, AdminEnum, AdminDate } from "../../../components/admin-i18n";
import { EntitlementPagination, EntitlementReadError } from "@/components/entitlement-pagination";
import { getCustomerDisplayNames } from "@/lib/admin/server";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { entitlementPage, requireEntitlementRead } from "@/lib/entitlements/admin";
import { entitlementHref, entitlementSearchSchema } from "@/lib/entitlements/read-model";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { subscriptionControl, testSubscription, requestAccess } from "./actions";

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireEntitlementRead();
  const query = entitlementSearchSchema.safeParse(await searchParams);
  if (!query.success) return <main className="admin-main"><h1><T k="Subscriptions"/></h1><EntitlementReadError error="cursor" href="/admin/subscriptions"/></main>;
  const q = query.data;
  const d = await entitlementPage("subscriptions", { customer: q.customer, size: Number(q.size), cursor: q.cursor });
  const manage = hasAdminCapability(context.role, "entitlements.manage");
  const first = entitlementHref("/admin/subscriptions", { size: q.size, customer: q.customer });
  const names = d.page ? await getCustomerDisplayNames(d.page.items.map(s => s.customer_id)) : {};
  return <main className="admin-main"><h1 id="subscriptions-title"><T k="Subscriptions"/></h1>
    <p><T k="Live entitlement activation is disabled. TEST records are isolated simulations."/></p>
    {q.customer && <p><T k="Customer filter"/> · <Link href={`/admin/customers/${q.customer}`}>{names[q.customer] ?? <T k="Customer"/>}</Link> · <Link href="/admin/subscriptions"><T k="Clear customer filter"/></Link></p>}
    {q.error && <p role="alert"><T k="Action denied. Check the entitlement, evidence and permissions."/></p>}
    {manage && <details className="detail-card case-section"><summary><T k="TEST ONLY acceptance"/></summary><p><T k="Only a confirmed test invoice in an isolated Phase 11 sandbox tenant can create a test subscription."/></p>
      <form action={testSubscription}><label><T k="Test invoice ID"/> <input name="invoice_id" required/></label><button><T k="Create test subscription"/></button></form></details>}
    {d.error ? <EntitlementReadError error={d.error} href={first}/> : d.page && <>
      <div className="table-scroll" role="region" aria-labelledby="subscriptions-title" tabIndex={0}><table><thead><tr><th><T k="Customer / plan"/></th><th><T k="State"/></th><th><T k="Period / renewal"/></th><th><T k="Payment evidence"/></th><th><T k="Controls"/></th></tr></thead>
        <tbody>{d.page.items.map(s => <tr key={s.id}>
          <td><Link href={`/admin/customers/${s.customer_id}`}>{names[s.customer_id] ?? <T k="Customer"/>}</Link><br/>{s.plan_snapshot.title ?? <T k="Subscriptions"/>}<br/><AdminEnum value={s.mode}/></td>
          <td><AdminEnum value={s.state}/></td>
          <td><AdminDate value={s.starts_at}/><br/><AdminDate value={s.ends_at}/><br/><T k="Renewal due:"/> <AdminDate value={s.renewal_due_at}/></td>
          <td><AdminEnum value={s.has_payment ? s.mode === "test" ? "SANDBOX_VERIFIED" : "VERIFIED_RECEIPT" : "NOT_VERIFIED"}/><br/>
            <Link href={`/admin/subscriptions/${s.id}?evidence=payments`}><T k="View payment periods"/></Link></td>
          <td><Link href={`/admin/subscriptions/${s.id}`}><T k="Journey and history"/></Link>{manage && <details><summary><T k="Controls"/></summary>
            <form action={subscriptionControl}><input type="hidden" name="subscription_id" value={s.id}/><input type="hidden" name="request_id" value={randomUUID()}/>
              <label><T k="Control"/> <select name="action"><option value="hold"><T k="Manual hold"/></option><option value="suspend"><T k="Suspend"/></option><option value="cancel"><T k="Cancel"/></option><option value="release"><T k="Release hold"/></option><option value="reconcile"><T k="Reconcile"/></option><option value="revoke"><T k="Revoke access"/></option></select></label><button><T k="Apply control"/></button></form>
            <form action={requestAccess}><input type="hidden" name="subscription_id" value={s.id}/><button><T k="Request authorized access"/></button></form></details>}</td>
        </tr>)}</tbody></table>{!d.page.items.length && <p className="empty-state"><T k={q.cursor ? "No records on this page." : "No subscriptions."}/></p>}</div>
      <EntitlementPagination path="/admin/subscriptions" size={q.size} customer={q.customer} next={d.page.next_cursor} hasMore={d.page.has_more} count={d.page.items.length} continued={Boolean(q.cursor)}/>
    </>}
  </main>;
}
