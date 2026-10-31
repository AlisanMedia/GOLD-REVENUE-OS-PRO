import { T, CustomerPreviewBoundary, AdminEnum, AdminDate, AdminDecimal } from "../../../../components/admin-i18n";
import { getAdminI18n } from "@/lib/i18n/server";
import Link from "next/link";
import MembershipCheckoutPreview from "@/components/membership-checkout-preview";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { atomicToDecimal, paymentInvoiceSchema } from "@gold-revenue-os/domain";
import { paymentDetail, type StarsAdminEvidence } from "@/lib/payments/admin";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { configuredTestAdapter } from "@/lib/payments/service";
import { reconcilePayment, simulatePayment } from "../actions";

function DedicatedStarsEvidence({ evidence }: { evidence: StarsAdminEvidence | null | undefined }) {
 if (!evidence) return <p className="warning-box" role="status"><T k="Dedicated TEST evidence is unavailable. No empty result or successful payment is assumed."/></p>;
 const operations = { invite: "Invite operation", join: "Join verification", revoke: "Revoke operation", reconcile: "Reconciliation operation" } as const;
 return <><h3><T k="Observed dedicated TEST receipts"/></h3>{!evidence.receipts.length ? <p><T k="No dedicated TEST payment or refund receipt is recorded for this invoice."/></p> : <div className="table-scroll"><table><thead><tr><th><T k="Source"/></th><th><T k="Amount"/></th><th><T k="Recorded"/></th><th><T k="Source / time"/></th></tr></thead><tbody>{evidence.receipts.map(receipt => <tr key={receipt.id}><td>{receipt.kind === "PAYMENT" ? <T k="TEST payment receipt"/> : <T k="TEST refund receipt"/>}{(receipt.source_hash || receipt.ledger_hash) && <details><summary><T k="Technical references"/></summary><code>{receipt.source_hash ?? "—"}</code><br/><code>{receipt.ledger_hash ?? "—"}</code></details>}</td><td><AdminDecimal value={receipt.amount_units}/> XTR</td><td><AdminDate value={receipt.recorded_at}/></td><td><AdminDate value={receipt.source_time}/></td></tr>)}</tbody></table></div>}
 <h3><T k="TEST subscription evidence"/></h3>{evidence.subscription ? <p><Link href={`/admin/subscriptions/${evidence.subscription.id}`}><T k="Subscription evidence"/></Link> · <AdminEnum value={evidence.subscription.state}/> · TEST</p> : <p><T k="No TEST subscription is linked. An invoice alone does not activate access."/></p>}
 <h3><T k="TEST access jobs"/></h3>{evidence.jobs.length ? <ul>{evidence.jobs.map((job, index) => <li key={`${job.operation}:${index}`}><T k={operations[job.operation]}/> · <AdminEnum value={job.status}/></li>)}</ul> : <p><T k="No TEST access job is linked to this invoice."/></p>}
 {(evidence.has_more_receipts || evidence.has_more_jobs) && <p className="warning-box"><T k="This view shows up to 25 receipts and 25 access jobs independently. More history exists; the result is incomplete."/></p>}</>;
}
export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
 const { t } = await getAdminI18n();
  const detail = await paymentDetail((await params).id); if (!detail) notFound();
  const { invoice: i, observations, transactions, context, starsEvidence } = detail;
  const genuine = i.mode === "live";
  const invoice = genuine ? null : paymentInvoiceSchema.parse(Object.fromEntries(Object.entries(i).filter(([k]) => k in paymentInvoiceSchema.shape)));
  const dedicatedStarsTest = i.quote_snapshot.origin === "TELEGRAM_DEDICATED_TEST";
  const checkout = dedicatedStarsTest || genuine || !invoice ? null : await configuredTestAdapter(i.provider_id).createCheckout(invoice);
  return <main className="admin-main"><Link href="/admin/payments"><T k="Payments"/></Link><h1>{genuine ? <T k="Verified-provider payment invoice"/> : dedicatedStarsTest ? <T k="Telegram dedicated TEST invoice"/> : <T k="Test payment invoice"/>}</h1>
    <p role="status"><strong>{genuine ? <T k="Provider evidence required; an invoice is not payment."/> : <T k="TEST ONLY — no funds are collected."/>}</strong> {genuine ? <T k="Stars amounts are XTR; USD revenue and merchant payout are separate evidence."/> : dedicatedStarsTest ? <T k="Dedicated TEST provider evidence is separate from simulation and genuine money."/> : <T k="Live integration remains unapproved."/>}</p>
    {(await searchParams).error && <p role="alert"><T k="The check failed. Existing payment state is preserved; retry reconciliation after reviewing provider evidence."/></p>}
    {!dedicatedStarsTest && !genuine && <CustomerPreviewBoundary><MembershipCheckoutPreview title={t("Selected membership")} amountUnits={i.amount_units} decimals={i.decimals} asset={i.asset} network={i.network} state={i.status} reason={observations[0]?.reason} /></CustomerPreviewBoundary>}
    <dl><dt><T k="Invoice"/></dt><dd>{i.id}</dd><dt><T k="Offer / customer"/></dt><dd>{i.offer_id} / {i.customer_id}</dd><dt><T k="Channel / surface"/></dt><dd>{i.channel} / {i.surface}</dd><dt><T k="Provider reference"/></dt><dd>{i.provider_reference}</dd><dt><T k="Amount"/></dt><dd>{atomicToDecimal(i.amount_units, i.decimals)} {i.asset} / {i.network}</dd><dt><T k="State"/></dt><dd>{<AdminEnum value={i.status}/>} {genuine ? <T k="(provider-verified scope)"/> : dedicatedStarsTest ? <T k="(Telegram dedicated TEST)"/> : <T k="(simulation)"/>}</dd><dt><T k="Required confirmations"/></dt><dd>{i.min_confirmations}</dd></dl>
    {dedicatedStarsTest ? <section className="panel"><h2><T k="Telegram Stars dedicated TEST evidence"/></h2><p><T k="A TEST invoice acknowledgement is not a completed payment. Pre-checkout approval alone does not grant access."/></p><p><T k="Actual TEST payment and refund evidence is recorded separately from the historical simulation adapter. No genuine paid access or commercial revenue is inferred."/></p><DedicatedStarsEvidence evidence={starsEvidence}/></section> : !genuine && <section className="panel"><h2>{i.channel === "telegram_stars" ? <T k="Stars invoice preview"/> : <T k="Independent web checkout preview"/>}</h2>
      <p>{i.channel === "telegram_stars" ? <T k="XTR invoice contract only. Nothing is sent to Telegram."/> : <T k="A separate web checkout contract. No real wallet, deposit address or external payment link is generated."/>}</p>
      <pre>{JSON.stringify(checkout, null, 2)}</pre><h3><T k="Immutable quote snapshot"/></h3><pre>{JSON.stringify(i.quote_snapshot, null, 2)}</pre>
    </section>}
    {!dedicatedStarsTest && !genuine && hasAdminCapability(context.role, "payments.test") && <section className="panel"><h2><T k="Test provider evidence"/></h2><form action={simulatePayment}>
      <input type="hidden" name="invoice_id" value={i.id} /><input type="hidden" name="request_id" value={randomUUID()} />
      <label><T k="Scenario"/> <select name="scenario">{["pending", "settled", "insufficient_confirmations", "underpaid", "overpaid", "wrong_asset", "wrong_network", "wrong_recipient", "failed", "refunded", "reorg", "late"].map(s => <option value={s} key={s}>{s.replaceAll("_", " ")}</option>)}</select></label><button type="submit"><T k="Simulate and reconcile"/></button></form>
      <form action={reconcilePayment}><input type="hidden" name="invoice_id" value={i.id} /><button type="submit"><T k="Reconcile latest test evidence"/></button></form>
    </section>}
    {!dedicatedStarsTest && <><h2><T k="Transactions"/></h2>{transactions.length === 0 ? <p><T k="No provider transaction evidence."/></p> : <ul>{transactions.map(t => <li key={t.transaction_reference}>{t.provider_id} / {t.network}: {t.transaction_reference}</li>)}</ul>}
    <h2><T k="Verification and reconciliation history"/></h2><div className="table-scroll"><table><thead><tr><th><T k="Event / method"/></th><th><T k="Result"/></th><th><T k="Evidence hash"/></th><th><T k="Recorded"/></th></tr></thead><tbody>{observations.map(o => <tr key={o.id}><td>{o.event_id}<br />{o.method}</td><td>{o.proposed_state} → {o.resulting_state}<br />{o.reason}<details><summary><T k="Provider evidence"/></summary><pre>{JSON.stringify(o.evidence, null, 2)}</pre></details></td><td>{o.raw_body_hash}</td><td>{<AdminDate value={o.created_at}/>}</td></tr>)}</tbody></table></div></>}
    <p><Link href="/admin/audit"><T k="Audit history"/></Link></p>
  </main>;
}
