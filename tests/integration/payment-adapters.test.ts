import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type PaymentInvoice, type ProviderSnapshot } from "@gold-revenue-os/domain";
import { signTestWebhook, testPaymentAdapter } from "../../apps/web/src/lib/payments/adapters";
import { verifyTelegramStarsEvidence } from "../../apps/web/src/lib/payments/telegram-evidence";
const secret = "test-only-signing-secret-32-bytes-minimum";
const now = Date.parse("2026-10-13T12:00:00Z");
function fixture(channel: "telegram_stars" | "external_crypto") {
  const stars = channel === "telegram_stars";
  const invoice: PaymentInvoice = { id: "d2000000-0000-4000-8000-000000000001", tenant_id: "d2000000-0000-4000-8000-000000000002", customer_id: "d2000000-0000-4000-8000-000000000003", offer_id: "d2000000-0000-4000-8000-000000000004", provider_id: stars ? "telegram_stars_test" : "external_crypto_test", provider_reference: "test:invoice", channel, surface: stars ? "telegram_bot" : "independent_web", mode: "test", amount_units: stars ? "100" : "79000000", decimals: stars ? 0 : 6, asset: stars ? "XTR" : "USDC", network: stars ? "TELEGRAM" : "ETHEREUM", recipient: "test:merchant", payer_reference: "test:customer", min_confirmations: stars ? 1 : 12, status: "CREATED", expires_at: "2026-10-13T13:00:00Z" };
  const snapshot: ProviderSnapshot = { id: "d2000000-0000-4000-8000-000000000005", invoice_id: invoice.id, provider_id: invoice.provider_id, provider_reference: invoice.provider_reference, mode: "test", source: "simulation", amount_units: invoice.amount_units, asset: invoice.asset, network: invoice.network, recipient: invoice.recipient, payer_reference: invoice.payer_reference, transaction_reference: "test:transaction", confirmations: invoice.min_confirmations, provider_status: "settled", observed_at: "2026-10-13T12:00:00Z" };
  return { invoice, snapshot };
}
function signal(invoice: PaymentInvoice, snapshot: ProviderSnapshot) {
  const rawBody = JSON.stringify({ event_id: "test:event:1", invoice_id: invoice.id, snapshot_id: snapshot.id });
  const timestamp = String(now / 1000);
  return { rawBody, timestamp, signature: signTestWebhook(rawBody, timestamp, secret), now };
}
describe.each(["telegram_stars", "external_crypto"] as const)("%s test adapter end-to-end interface", channel => {
  it("creates a safe preview and verifies an independent lookup through both webhook and reconciliation", async () => {
    const { invoice, snapshot } = fixture(channel), adapter = testPaymentAdapter(invoice.provider_id, async () => snapshot, secret);
    const checkout = await adapter.createCheckout(invoice);
    expect(checkout.mode).toBe("test");
    if (channel === "telegram_stars") expect(checkout.invoicePayload).toMatchObject({ currency: "XTR", provider_token: "", prices: [{ amount: 100 }] });
    else expect(checkout.webPath).toBe("/admin/payments/" + invoice.id);
    const hook = await adapter.verifyWebhook(signal(invoice, snapshot), invoice), recon = await adapter.reconcile(invoice, snapshot.id);
    expect(hook.decision).toEqual(recon.decision); expect(hook.decision.state).toBe("CONFIRMED");
    expect(hook.rawBodyHash).toBe(createHash("sha256").update(signal(invoice, snapshot).rawBody).digest("hex"));
    expect(hook.snapshot.source).toBe("simulation");
  });
  it("rejects forged, stale and changed raw webhook content", async () => {
    const { invoice, snapshot } = fixture(channel), adapter = testPaymentAdapter(invoice.provider_id, async () => snapshot, secret), input = signal(invoice, snapshot);
    await expect(adapter.verifyWebhook({ ...input, signature: "f".repeat(64) }, invoice)).rejects.toThrow("SIGNATURE_INVALID");
    await expect(adapter.verifyWebhook({ ...input, rawBody: input.rawBody + " " }, invoice)).rejects.toThrow("SIGNATURE_INVALID");
    await expect(adapter.verifyWebhook({ ...input, now: now + 301000 }, invoice)).rejects.toThrow("WEBHOOK_EXPIRED");
  });
  it("does not trust amounts or provider status appended to the callback", async () => {
    const { invoice, snapshot } = fixture(channel), adapter = testPaymentAdapter(invoice.provider_id, async () => ({ ...snapshot, confirmations: 0 }), secret);
    expect((await adapter.verifyWebhook(signal(invoice, snapshot), invoice)).decision.state).toBe("PENDING");
    const rawBody = JSON.stringify({ event_id: "test:event:1", invoice_id: invoice.id, snapshot_id: snapshot.id, amount_units: invoice.amount_units, provider_status: "settled" }), timestamp = String(now / 1000);
    await expect(adapter.verifyWebhook({ rawBody, timestamp, signature: signTestWebhook(rawBody, timestamp, secret), now }, invoice)).rejects.toThrow();
  });
  it("refuses another invoice's lookup and preserves provider-unavailable failure", async () => {
    const { invoice, snapshot } = fixture(channel);
    await expect(testPaymentAdapter(invoice.provider_id, async () => ({ ...snapshot, invoice_id: invoice.offer_id }), secret).reconcile(invoice, snapshot.id)).rejects.toThrow("SCOPE_MISMATCH");
    await expect(testPaymentAdapter(invoice.provider_id, async () => { throw new Error("PROVIDER_OFFLINE"); }, secret).reconcile(invoice, snapshot.id)).rejects.toThrow("PROVIDER_OFFLINE");
  });
});
describe("genuine Stars evidence contract (live route remains unmounted)", () => {
  const expected = { webhookSecret: secret, payerUserId: "123456", invoicePayload: "invoice:real-contract-example", amountUnits: "100" };
  const successful = { update_id: 123, message: { from: { id: 123456 }, successful_payment: { currency: "XTR", total_amount: 100, invoice_payload: expected.invoicePayload, telegram_payment_charge_id: "telegram-charge-example", provider_payment_charge_id: "" } } };
  const verify = (data: unknown, header: string | null = secret) => verifyTelegramStarsEvidence({ rawBody: JSON.stringify(data), secretHeader: header }, expected);
  it("accepts only secret-authenticated successful_payment proof", () => { expect(verify(successful)).toEqual({ updateId: "123", chargeId: "telegram-charge-example", source: "telegram_successful_payment" }); expect(() => verify(successful, "forged")).toThrow("AUTH_INVALID"); });
  it("rejects precheckout, client callbacks, screenshots and payer/amount mismatches", () => {
    for (const fake of [{ pre_checkout_query: { currency: "XTR", total_amount: 100 } }, { invoiceClosed: "paid" }, { screenshot: "paid" }, { ...successful, message: { ...successful.message, from: { id: 999 } } }, { ...successful, message: { ...successful.message, successful_payment: { ...successful.message.successful_payment, total_amount: 101 } } }]) expect(() => verify(fake)).toThrow();
  });
  it("rejects simulation references and subscription payments", () => {
    for (const extra of [{ telegram_payment_charge_id: "test:charge" }, { is_recurring: true }, { currency: "USD" }]) expect(() => verify({ ...successful, message: { ...successful.message, successful_payment: { ...successful.message.successful_payment, ...extra } } })).toThrow();
  });
  it("cannot construct a live provider from the test registry", () => expect(() => testPaymentAdapter("coinbase", async () => null, secret)).toThrow("NOT_APPROVED"));
});
