import Link from "next/link";
import MembershipCheckoutPreview from "@/components/membership-checkout-preview";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { atomicToDecimal, paymentInvoiceSchema } from "@gold-revenue-os/domain";
import { paymentDetail } from "@/lib/payments/admin";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { configuredTestAdapter } from "@/lib/payments/service";
import { reconcilePayment, simulatePayment } from "../actions";
export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const detail = await paymentDetail((await params).id); if (!detail) notFound();
  const { invoice: i, observations, transactions, context } = detail;
  const invoice = paymentInvoiceSchema.parse(Object.fromEntries(Object.entries(i).filter(([k]) => k in paymentInvoiceSchema.shape)));
  const checkout = await configuredTestAdapter(i.provider_id).createCheckout(invoice);
  return <main className="admin-main"><Link href="/admin/payments">Payments</Link><h1>Test payment invoice</h1>
    <p role="status"><strong>TEST ONLY — no funds are collected.</strong> Live integration remains unapproved.</p>
    {(await searchParams).error && <p role="alert">The check failed. Existing payment state is preserved; retry reconciliation after reviewing provider evidence.</p>}
    <MembershipCheckoutPreview title="Selected membership" amountUnits={i.amount_units} decimals={i.decimals} asset={i.asset} network={i.network} state={i.status} reason={observations[0]?.reason} />
    <dl><dt>Invoice</dt><dd>{i.id}</dd><dt>Offer / customer</dt><dd>{i.offer_id} / {i.customer_id}</dd><dt>Channel / surface</dt><dd>{i.channel} / {i.surface}</dd><dt>Provider reference</dt><dd>{i.provider_reference}</dd><dt>Amount</dt><dd>{atomicToDecimal(i.amount_units, i.decimals)} {i.asset} / {i.network}</dd><dt>State</dt><dd>{i.status} (simulation)</dd><dt>Required confirmations</dt><dd>{i.min_confirmations}</dd></dl>
    <section className="panel"><h2>{i.channel === "telegram_stars" ? "Stars invoice preview" : "Independent web checkout preview"}</h2>
      <p>{i.channel === "telegram_stars" ? "XTR invoice contract only. Nothing is sent to Telegram." : "A separate web checkout contract. No real wallet, deposit address or external payment link is generated."}</p>
      <pre>{JSON.stringify(checkout, null, 2)}</pre><h3>Immutable quote snapshot</h3><pre>{JSON.stringify(i.quote_snapshot, null, 2)}</pre>
    </section>
    {hasAdminCapability(context.role, "payments.test") && <section className="panel"><h2>Test provider evidence</h2><form action={simulatePayment}>
      <input type="hidden" name="invoice_id" value={i.id} /><input type="hidden" name="request_id" value={randomUUID()} />
      <label>Scenario <select name="scenario">{["pending", "settled", "insufficient_confirmations", "underpaid", "overpaid", "wrong_asset", "wrong_network", "wrong_recipient", "failed", "refunded", "reorg", "late"].map(s => <option value={s} key={s}>{s.replaceAll("_", " ")}</option>)}</select></label><button type="submit">Simulate and reconcile</button></form>
      <form action={reconcilePayment}><input type="hidden" name="invoice_id" value={i.id} /><button type="submit">Reconcile latest test evidence</button></form>
    </section>}
    <h2>Transactions</h2>{transactions.length === 0 ? <p>No provider transaction evidence.</p> : <ul>{transactions.map(t => <li key={t.transaction_reference}>{t.provider_id} / {t.network}: {t.transaction_reference}</li>)}</ul>}
    <h2>Verification and reconciliation history</h2><div className="table-scroll"><table><thead><tr><th>Event / method</th><th>Result</th><th>Evidence hash</th><th>Recorded</th></tr></thead><tbody>{observations.map(o => <tr key={o.id}><td>{o.event_id}<br />{o.method}</td><td>{o.proposed_state} → {o.resulting_state}<br />{o.reason}<details><summary>Provider evidence</summary><pre>{JSON.stringify(o.evidence, null, 2)}</pre></details></td><td>{o.raw_body_hash}</td><td>{o.created_at}</td></tr>)}</tbody></table></div>
    <p><Link href="/admin/audit">Audit history</Link></p>
  </main>;
}
