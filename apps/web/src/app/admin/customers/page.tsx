import { T, AdminEnum, AdminDate, AdminNumber } from "../../../components/admin-i18n";
import { getAdminI18n } from "@/lib/i18n/server";
import { getCustomerList } from "@/lib/admin/server";
import { CustomerRecordCards } from "@/components/customer-record-cards";
import { enumLabel } from "@/lib/i18n/labels";
import { customerStates } from "@gold-revenue-os/contracts";
import Link from "next/link";

type Search = { q?: string; state?: string; segment?: string; risk?: string; source?: string; manager?: string; from?: string; to?: string; page?: string };
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const pageNumber = (value: string | undefined) => Math.max(Number.parseInt(value ?? "1", 10) || 1, 1);

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 const { t, locale } = await getAdminI18n();
  const raw = await searchParams;
  const query: Search = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, one(value)]));
  const page = pageNumber(query.page);
  const result = await getCustomerList({
    ...(query.q ? { search: query.q } : {}),
    ...(query.state ? { state: query.state } : {}),
    ...(query.segment ? { segment: query.segment } : {}),
    ...(query.risk ? { risk: query.risk } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.manager ? { manager: query.manager } : {}),
    ...(query.from ? { createdFrom: query.from } : {}),
    ...(query.to ? { createdTo: query.to } : {}),
    page,
    pageSize: 25,
  });
  const pageCount = Math.max(Math.ceil(result.total / result.page_size), 1);
  const hrefFor = (target: number) => { const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value).map(([key, value]) => [key, value!])); params.set("page", String(target)); return `/admin/customers?${params}`; };
  return (
    <main className="admin-main">
      <p className="eyebrow"><T k="CUSTOMER OS"/></p>
      <div className="page-heading"><div><h1><T k="Customers"/></h1><p className="lede"><T k="Server-filtered, tenant-scoped customer records."/> {<AdminNumber value={result.total}/>} {t(result.total===1?"matching record.":"matching records.")}</p></div></div>
      <form className="filter-panel" method="get"><label><T k="Search"/><input name="q" defaultValue={query.q} placeholder={t("Name, email, Telegram, external ID")} /></label><label><T k="State"/><select name="state" defaultValue={query.state ?? ""}><option value=""><T k="All states"/></option>{customerStates.map((state) => <option key={state} value={state}>{enumLabel(state,locale)}</option>)}</select></label><label><T k="Segment"/><input name="segment" defaultValue={query.segment} /></label><label><T k="Risk"/><input name="risk" defaultValue={query.risk} /></label><label><T k="Source"/><input name="source" defaultValue={query.source} /></label><label><T k="Manager ID"/><input name="manager" defaultValue={query.manager} /></label><label><T k="Created from"/><input name="from" type="date" defaultValue={query.from} /></label><label><T k="Created to"/><input name="to" type="date" defaultValue={query.to} /></label><button className="secondary-button" type="submit"><T k="Apply filters"/></button><Link className="text-button" href="/admin/customers"><T k="Clear"/></Link></form>
      <CustomerRecordCards items={result.items}/>
      <section className="table-card customers-desktop-table" aria-label={t("Customer list")}>
        <div className="table-scroll"><table><thead><tr><th><T k="Customer"/></th><th><T k="Primary identity"/></th><th><T k="State"/></th><th><T k="Segment"/></th><th><T k="Risk"/></th><th><T k="Source"/></th><th><T k="Next best action"/></th><th><T k="Updated"/></th></tr></thead><tbody>
          {result.items.map((customer) => <tr key={customer.id}><td><Link className="table-link" href={`/admin/customers/${customer.id}`}>{customer.display_name || <T k="Unnamed customer"/>}</Link><small>{customer.external_ref ?? customer.id.slice(0, 8)}</small></td><td>{customer.primary_identity_value ?? <T k="Restricted / unavailable"/>}<small>{customer.primary_identity_type ?? ""}</small></td><td><span className="state-pill">{<AdminEnum value={customer.state}/>}</span></td><td>{customer.segment ?? "—"}</td><td>{<AdminEnum value={customer.risk_level}/>}</td><td>{customer.source_name ?? customer.source_type ?? "—"}</td><td className="bounded-cell">{customer.next_best_action ?? "—"}</td><td>{<AdminDate value={customer.updated_at}/>}</td></tr>)}
          {result.items.length === 0 && <tr><td colSpan={8} className="empty-state"><T k="No customer records match these filters."/></td></tr>}
        </tbody></table></div>
      </section>
      <nav className="pagination" aria-label={t("Customer pages")}><Link aria-disabled={page <= 1} href={hrefFor(Math.max(page - 1, 1))}><T k="Previous"/></Link><span><T k="Page"/> {<AdminNumber value={page}/>} <T k="of"/> {<AdminNumber value={pageCount}/>}</span><Link aria-disabled={page >= pageCount} href={hrefFor(Math.min(page + 1, pageCount))}><T k="Next"/></Link></nav>
    </main>
  );
}
