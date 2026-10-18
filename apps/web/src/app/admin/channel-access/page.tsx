import Link from "next/link";
import { T, AdminEnum, AdminDate } from "../../../components/admin-i18n";
import { EntitlementPagination, EntitlementReadError } from "@/components/entitlement-pagination";
import { entitlementPage, requireEntitlementRead } from "@/lib/entitlements/admin";
import { entitlementHref, entitlementSearchSchema } from "@/lib/entitlements/read-model";
import { getCustomerDisplayNames } from "@/lib/admin/server";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { testAccessCycle } from "../subscriptions/actions";

export default async function ChannelAccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireEntitlementRead();
  const query = entitlementSearchSchema.safeParse(await searchParams);
  if (!query.success) return <main className="admin-main"><h1><T k="Channel Access"/></h1><EntitlementReadError error="cursor" href="/admin/channel-access"/></main>;
  const q = query.data;
  const d = await entitlementPage("access", { customer: q.customer, size: Number(q.size), cursor: q.cursor });
  const first = entitlementHref("/admin/channel-access", { size: q.size, customer: q.customer });
  const names = d.page ? await getCustomerDisplayNames(d.page.items.map(a => a.customer_id)) : {};
  return <main className="admin-main"><h1 id="channel-access-title"><T k="Channel Access"/></h1><p><T k="Live Telegram access is disabled. Test invitations cannot join a real channel."/></p>
    {q.customer && <p><T k="Customer filter"/> · <Link href={`/admin/customers/${q.customer}`}>{names[q.customer] ?? <T k="Customer"/>}</Link> · <Link href="/admin/channel-access"><T k="Clear customer filter"/></Link></p>}
    {hasAdminCapability(context.role, "entitlements.manage") && <form action={testAccessCycle}><button><T k="Run one test access job"/></button></form>}
    {d.error ? <EntitlementReadError error={d.error} href={first}/> : d.page && <>
      <div className="table-scroll" role="region" aria-labelledby="channel-access-title" tabIndex={0}><table><thead><tr><th><T k="Customer / plan"/></th><th><T k="Verified binding / channel"/></th><th><T k="Access / invite"/></th><th><T k="Reconciliation / retries"/></th></tr></thead>
        <tbody>{d.page.items.map(a => <tr key={a.id}>
          <td><Link href={`/admin/customers/${a.customer_id}`}>{names[a.customer_id] ?? <T k="Customer"/>}</Link><br/><AdminEnum value={a.mode}/></td>
          <td>{a.telegram_user_id ?? <T k="Identity details restricted"/>}<br/>{a.chat_id}</td>
          <td><AdminEnum value={a.status}/><br/><T k={a.invite_present ? "Invitation recorded" : "No invitation"}/><br/><AdminDate value={a.invite_expires_at}/></td>
          <td><T k="Checked:"/> <AdminDate value={a.membership_checked_at}/><br/><Link href={`/admin/subscriptions/${a.subscription_id}?evidence=jobs`}><T k="View access jobs"/></Link></td>
        </tr>)}</tbody></table>{!d.page.items.length && <p className="empty-state"><T k={q.cursor ? "No records on this page." : "No channel access records."}/></p>}</div>
      <EntitlementPagination path="/admin/channel-access" size={q.size} customer={q.customer} next={d.page.next_cursor} hasMore={d.page.has_more} count={d.page.items.length} continued={Boolean(q.cursor)}/>
    </>}
  </main>;
}
