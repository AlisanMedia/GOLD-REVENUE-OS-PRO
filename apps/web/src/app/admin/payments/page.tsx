import { T, AdminEnum, AdminDate, AdminDecimal } from "../../../components/admin-i18n";
import { getAdminI18n } from "@/lib/i18n/server";
import { getCustomerDisplayNames } from "@/lib/admin/server";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { atomicToDecimal } from "@gold-revenue-os/domain";
import { paymentList } from "@/lib/payments/admin";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { createTestInvoice } from "./actions";
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
 const { t } = await getAdminI18n();
  const { context, invoices } = await paymentList();
  const names=await getCustomerDisplayNames(invoices.map(i=>i.customer_id));
  return <main className="admin-main">
    <h1><T k="Payments"/></h1><p><T k="Stars and external crypto in one verification ledger."/></p>
    <p role="status"><strong><T k="Provider evidence required; an invoice is not payment."/></strong> <T k="Simulated confirmations do not create subscriptions or grant VIP access."/></p>
    {(await searchParams).error && <p role="alert"><T k="Invoice rejected. Use an approved, unexpired offer linked to a customer and a valid simulation amount."/></p>}
    {hasAdminCapability(context.role, "payments.test") && <details className="detail-card case-section"><summary><T k="Create a test invoice"/></summary>
      <p><T k="Enter explicit fixture settlement amounts. This does not establish a real exchange rate or payment request."/></p>
      <form action={createTestInvoice}>
        <input type="hidden" name="request_id" value={randomUUID()} />
        <label><T k="Approved offer ID"/> <input name="offer_id" required /></label>
        <label><T k="Channel"/> <select name="channel"><option value="telegram_stars"><T k="Telegram Stars — bot/Mini App simulation"/></option><option value="external_crypto"><T k="Crypto — independent web simulation"/></option></select></label>
        <label><T k="Crypto asset"/> <select name="asset"><option value="USDT"><T k="USDT / TRON test fixture"/></option><option value="USDC"><T k="USDC / ETHEREUM test fixture"/></option></select></label>
        <label><T k="Simulation amount"/> <input name="amount" required inputMode="decimal" placeholder={t("100")} /></label>
        <button type="submit"><T k="Create test invoice"/></button>
      </form>
    </details>}
    <div className="table-scroll"><table><thead><tr><th><T k="Invoice / offer"/></th><th><T k="Channel / provider"/></th><th><T k="Exact settlement amount"/></th><th><T k="State"/></th><th><T k="Reconciliation"/></th></tr></thead>
      <tbody>{invoices.map(i => <tr key={i.id}><td><Link href={"/admin/payments/" + i.id}>{names[i.customer_id]??<T k="Customer"/>}</Link><small>GR-P-{i.id.slice(0,8).toUpperCase()}</small><details><summary><T k="Technical evidence"/></summary>{i.id}<br /><T k="Offer:"/> {i.offer_id}</details></td><td><AdminEnum value={i.channel}/><br />{i.provider_id}<br />{i.mode === "live" ? <T k="(provider-verified scope)"/> : <T k="TEST ONLY"/>}</td><td><AdminDecimal value={atomicToDecimal(i.amount_units, i.decimals)}/> {i.asset}<br />{i.network}</td><td>{<AdminEnum value={i.status}/>}<br /><T k="Expires:"/> <AdminDate value={i.expires_at}/></td><td>{i.reconciliation_count} <T k="checks"/><br /><AdminDate value={i.last_evidence_at}/></td></tr>)}</tbody>
    </table>{invoices.length === 0 && <p><T k="No payment invoices."/></p>}</div>
  </main>;
}
