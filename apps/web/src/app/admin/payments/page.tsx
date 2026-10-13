import Link from "next/link";
import { randomUUID } from "node:crypto";
import { atomicToDecimal } from "@gold-revenue-os/domain";
import { paymentList } from "@/lib/payments/admin";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { createTestInvoice } from "./actions";
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { context, invoices } = await paymentList();
  return <main className="admin-main">
    <h1>Payments</h1><p>Stars and external crypto in one verification ledger.</p>
    <p role="status"><strong>TEST ONLY — live payments are disabled.</strong> Simulated confirmations do not create subscriptions or grant VIP access.</p>
    {(await searchParams).error && <p role="alert">Invoice rejected. Use an approved, unexpired offer linked to a customer and a valid simulation amount.</p>}
    {hasAdminCapability(context.role, "payments.test") && <section className="panel"><h2>Create a test invoice</h2>
      <p>Enter explicit fixture settlement amounts. This does not establish a real exchange rate or payment request.</p>
      <form action={createTestInvoice}>
        <input type="hidden" name="request_id" value={randomUUID()} />
        <label>Approved offer ID <input name="offer_id" required /></label>
        <label>Channel <select name="channel"><option value="telegram_stars">Telegram Stars — bot/Mini App simulation</option><option value="external_crypto">Crypto — independent web simulation</option></select></label>
        <label>Crypto asset <select name="asset"><option value="USDT">USDT / TRON test fixture</option><option value="USDC">USDC / ETHEREUM test fixture</option></select></label>
        <label>Simulation amount <input name="amount" required inputMode="decimal" placeholder="100" /></label>
        <button type="submit">Create test invoice</button>
      </form>
    </section>}
    <div className="table-scroll"><table><thead><tr><th>Invoice / offer</th><th>Channel / provider</th><th>Exact settlement amount</th><th>State</th><th>Reconciliation</th></tr></thead>
      <tbody>{invoices.map(i => <tr key={i.id}><td><Link href={"/admin/payments/" + i.id}>{i.id}</Link><br />Offer: {i.offer_id}</td><td>{i.channel}<br />{i.provider_id}<br />TEST ONLY</td><td>{atomicToDecimal(i.amount_units, i.decimals)} {i.asset}<br />{i.network}</td><td>{i.status}<br />Expires: {i.expires_at}</td><td>{i.reconciliation_count} checks<br />{i.last_evidence_at ?? "No evidence"}</td></tr>)}</tbody>
    </table>{invoices.length === 0 && <p>No payment invoices.</p>}</div>
  </main>;
}
