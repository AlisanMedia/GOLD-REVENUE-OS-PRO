import { T, AdminCount, AdminEnum, AdminDate, AdminNumber } from "../../../components/admin-i18n";
import Link from "next/link";
import { getConversationList, getOutboundMessagingEnabled } from "@/lib/messaging/server";
import { getCustomerList, requireAdminCapability } from "@/lib/admin/server";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { OutboundKillSwitch } from "@/components/outbound-kill-switch";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const status = first(raw.status);
  const customerId = first(raw.customer);
  const page = Math.max(Number.parseInt(first(raw.page) ?? "1", 10) || 1, 1);
  const [result, outboundEnabled, admin] = await Promise.all([
    getConversationList({ ...(status ? { status } : {}), ...(customerId ? { customerId } : {}), page, pageSize: 25 }),
    getOutboundMessagingEnabled(),
    requireAdminCapability("messaging.read"),
  ]);
  const customerOptions=await getCustomerList({page:1,pageSize:100});
  const pageCount = Math.max(Math.ceil(result.total / result.page_size), 1);
  const hrefFor = (target: number) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (customerId) params.set("customer", customerId);
    params.set("page", String(target));
    return `/admin/conversations?${params}`;
  };

  return <main className="admin-main">
    <div className="page-heading"><div>
      <p className="eyebrow"><T k="MESSAGING GATEWAY"/></p>
      <h1><T k="Conversations"/></h1>
      <p className="lede"><T k="Tenant-scoped Telegram conversations. Historical usernames alone never grant outbound contactability."/></p>
    </div></div>
    {hasAdminCapability(admin.role, "messaging.kill_switch") ? <OutboundKillSwitch initialEnabled={outboundEnabled} /> : <div className="warning-box"><strong><T k="Outbound:"/> {outboundEnabled ? "enabled" : "disabled"}</strong><p><T k="Only manager or super admin can change the tenant kill switch."/></p></div>}
    <form className="filter-panel" method="get">
      <label><T k="Status"/><select name="status" defaultValue={status ?? ""}><option value=""><T k="All"/></option><option value="open"><T k="open"/></option><option value="closed"><T k="closed"/></option><option value="blocked"><T k="blocked"/></option></select></label>
      <label><T k="Customer"/><select name="customer" defaultValue={customerId??""}><option value=""><T k="All customers"/></option>{customerId&&!customerOptions.items.some(c=>c.id===customerId)&&<option value={customerId}><T k="Customer"/> · {customerId.slice(0,8)}</option>}{customerOptions.items.map(c=><option key={c.id} value={c.id}>{c.display_name??"—"}</option>)}</select></label>
      <button className="secondary-button" type="submit"><T k="Apply filters"/></button>
      <Link className="text-button" href="/admin/conversations"><T k="Clear"/></Link>
    </form>
    <section className="table-card table-scroll">
      <table><thead><tr><th><T k="Customer/contact"/></th><th><T k="Provider"/></th><th><T k="Last message"/></th><th><T k="Direction/status"/></th><th><T k="Contactability"/></th><th><T k="Attention"/></th><th><T k="Updated"/></th></tr></thead>
        <tbody>{result.items.map((item) => <tr key={item.id}>
          <td><Link className="table-link" href={`/admin/conversations/${item.id}`}>{item.customer_name ?? item.username ?? <T k="Unmatched Telegram contact"/>}</Link><small>{item.customer_id ? item.customer_id.slice(0,8) : <AdminEnum value={item.identity_resolution}/>}</small></td>
          <td>{item.provider}</td>
          <td className="bounded-cell">{item.last_message ?? "—"}</td>
          <td><AdminEnum value={item.last_direction??"—"}/><small><AdminEnum value={item.last_status??""}/></small></td>
          <td><span className="state-pill">{<AdminEnum value={item.contactability}/>}</span><small>{item.review_required ? <T k="Manual identity review required"/> : <AdminEnum value={item.identity_resolution}/>}</small></td>
          <td>{item.attention_required ? <T k="Needs attention"/> : item.unread_count > 0 ? <><AdminNumber value={item.unread_count}/> <T k="unread"/></> : "—"}</td>
          <td>{item.last_message_at ? <AdminDate value={item.last_message_at}/> : "—"}</td>
        </tr>)}{result.items.length === 0 && <tr><td colSpan={7} className="empty-state"><T k="No conversations yet."/></td></tr>}</tbody>
      </table>
    </section>
    <nav className="pagination"><Link href={hrefFor(Math.max(1,page-1))} aria-disabled={page<=1}><T k="Previous"/></Link><span><T k="Page"/> {<AdminNumber value={page}/>} <T k="of"/> {<AdminNumber value={pageCount}/>} · <AdminCount value={result.total} kind="conversations"/></span><Link href={hrefFor(Math.min(pageCount,page+1))} aria-disabled={page>=pageCount}><T k="Next"/></Link></nav>
  </main>;
}
