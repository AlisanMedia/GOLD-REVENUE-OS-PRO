import { getAttentionItems } from "@/lib/admin/server";
import Link from "next/link";

export default async function NeedsAttentionPage() {
  const items = await getAttentionItems();
  return <main className="admin-main"><p className="eyebrow">OPERATIONS QUEUE</p><h1>Needs attention</h1><p className="lede">Only actionable evidence already present in the system. No synthetic escalations are generated.</p><section className="table-card table-scroll"><table><thead><tr><th>Severity</th><th>Category</th><th>Issue</th><th>Customer</th><th>Observed</th></tr></thead><tbody>{items.map((item) => <tr key={`${item.category}:${item.entity_id}`}><td><span className={`severity severity-${item.severity}`}>{item.severity}</span></td><td>{item.category.replaceAll("_", " ")}</td><td className="bounded-cell">{item.summary ?? "Action required"}<small>{item.entity_id}</small></td><td>{item.customer_id ? <Link className="table-link" href={`/admin/customers/${item.customer_id}`}>Open customer</Link> : "—"}</td><td>{new Date(item.created_at).toLocaleString("en-GB")}</td></tr>)}{items.length === 0 ? <tr><td className="empty-state" colSpan={5}>No unresolved operational items.</td></tr> : null}</tbody></table></section></main>;
}
