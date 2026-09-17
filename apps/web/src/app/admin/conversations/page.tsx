import Link from "next/link";
import { getConversationList, getOutboundMessagingEnabled } from "@/lib/messaging/server";
import { requireAdminCapability } from "@/lib/admin/server";
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
      <p className="eyebrow">MESSAGING GATEWAY</p>
      <h1>Conversations</h1>
      <p className="lede">Tenant-scoped Telegram conversations. Historical usernames alone never grant outbound contactability.</p>
    </div></div>
    {hasAdminCapability(admin.role, "messaging.kill_switch") ? <OutboundKillSwitch initialEnabled={outboundEnabled} /> : <div className="warning-box"><strong>Outbound: {outboundEnabled ? "enabled" : "disabled"}</strong><p>Only manager or super admin can change the tenant kill switch.</p></div>}
    <form className="filter-panel" method="get">
      <label>Status<select name="status" defaultValue={status ?? ""}><option value="">All</option><option>open</option><option>closed</option><option>blocked</option></select></label>
      <label>Customer ID<input name="customer" defaultValue={customerId} /></label>
      <button className="secondary-button" type="submit">Apply filters</button>
      <Link className="text-button" href="/admin/conversations">Clear</Link>
    </form>
    <section className="table-card table-scroll">
      <table><thead><tr><th>Customer/contact</th><th>Provider</th><th>Last message</th><th>Direction/status</th><th>Contactability</th><th>Attention</th><th>Updated</th></tr></thead>
        <tbody>{result.items.map((item) => <tr key={item.id}>
          <td><Link className="table-link" href={`/admin/conversations/${item.id}`}>{item.customer_name ?? item.username ?? "Unmatched Telegram contact"}</Link><small>{item.customer_id ? item.customer_id.slice(0,8) : item.identity_resolution}</small></td>
          <td>{item.provider}</td>
          <td className="bounded-cell">{item.last_message ?? "—"}</td>
          <td>{item.last_direction ?? "—"}<small>{item.last_status ?? ""}</small></td>
          <td><span className="state-pill">{item.contactability}</span><small>{item.review_required ? "Manual identity review required" : item.identity_resolution}</small></td>
          <td>{item.attention_required ? "Needs attention" : item.unread_count > 0 ? `${item.unread_count} unread` : "—"}</td>
          <td>{item.last_message_at ? new Date(item.last_message_at).toLocaleString("en-GB") : "—"}</td>
        </tr>)}{result.items.length === 0 && <tr><td colSpan={7} className="empty-state">No conversations yet.</td></tr>}</tbody>
      </table>
    </section>
    <nav className="pagination"><Link href={hrefFor(Math.max(1,page-1))} aria-disabled={page<=1}>Previous</Link><span>Page {page} of {pageCount} · {result.total} conversations</span><Link href={hrefFor(Math.min(pageCount,page+1))} aria-disabled={page>=pageCount}>Next</Link></nav>
  </main>;
}
