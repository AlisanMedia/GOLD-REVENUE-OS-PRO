import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { assertPaymentSurface, classifyPaymentEvidence, paymentInvoiceSchema, providerSnapshotSchema, type PaymentDecision, type PaymentInvoice, type ProviderSnapshot } from "@gold-revenue-os/domain";

export type Checkout = { mode: "test"; channel: PaymentInvoice["channel"]; providerReference: string; invoicePayload?: { currency: "XTR"; provider_token: ""; payload: string; prices: [{ label: string; amount: number }] }; webPath?: string };
export type VerifiedObservation = { snapshot: ProviderSnapshot; decision: PaymentDecision; eventId: string; rawBodyHash: string };
export interface PaymentProviderAdapter {
  readonly id: string;
  readonly mode: "test" | "live";
  createCheckout(invoice: PaymentInvoice): Promise<Checkout>;
  verifyWebhook(input: { rawBody: string; signature: string; timestamp: string; now: number }, invoice: PaymentInvoice): Promise<VerifiedObservation>;
  reconcile(invoice: PaymentInvoice, snapshotId: string): Promise<VerifiedObservation>;
}
export type SnapshotLookup = (id: string) => Promise<unknown>;
const signalSchema = z.object({ event_id: z.string().regex(/^test:[A-Za-z0-9:_-]{1,160}$/u), invoice_id: z.uuid(), snapshot_id: z.uuid() }).strict();
export function signTestWebhook(rawBody: string, timestamp: string, secret: string): string {
  if (secret.length < 32) throw new Error("TEST_SIGNING_SECRET_INVALID");
  return createHmac("sha256", secret).update(timestamp + "." + rawBody).digest("hex");
}
export function verifyTestWebhookAuthentication(input: { rawBody: string; signature: string; timestamp: string; now: number }, secret: string): void {
  if (Buffer.byteLength(input.rawBody) > 16384 || !/^[0-9]{10}$/u.test(input.timestamp) || Math.abs(input.now / 1000 - Number(input.timestamp)) > 300) throw new Error("PAYMENT_WEBHOOK_EXPIRED");
  const expected = signTestWebhook(input.rawBody, input.timestamp, secret);
  if (!/^[a-f0-9]{64}$/u.test(input.signature) || !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(input.signature, "hex"))) throw new Error("PAYMENT_WEBHOOK_SIGNATURE_INVALID");
}
abstract class TestAdapter implements PaymentProviderAdapter {
  readonly mode = "test" as const;
  abstract readonly id: string;
  constructor(private readonly lookup: SnapshotLookup, private readonly secret: string) {}
  abstract createCheckout(invoice: PaymentInvoice): Promise<Checkout>;
  protected validate(invoice: PaymentInvoice): void {
    paymentInvoiceSchema.parse(invoice);
    assertPaymentSurface(invoice.channel, invoice.surface);
    if (invoice.provider_id !== this.id || !invoice.provider_reference.startsWith("test:")) throw new Error("TEST_PROVIDER_SCOPE_INVALID");
  }
  async verifyWebhook(input: { rawBody: string; signature: string; timestamp: string; now: number }, invoice: PaymentInvoice): Promise<VerifiedObservation> {
    verifyTestWebhookAuthentication(input, this.secret);
    const signal = signalSchema.parse(JSON.parse(input.rawBody));
    if (signal.invoice_id !== invoice.id) throw new Error("PAYMENT_EVIDENCE_SCOPE_MISMATCH");
    const result = await this.reconcile(invoice, signal.snapshot_id);
    return { ...result, eventId: signal.event_id, rawBodyHash: createHash("sha256").update(input.rawBody).digest("hex") };
  }
  async reconcile(invoice: PaymentInvoice, snapshotId: string): Promise<VerifiedObservation> {
    this.validate(invoice);
    const snapshot = providerSnapshotSchema.parse(await this.lookup(z.uuid().parse(snapshotId)));
    if (snapshot.id !== snapshotId || !snapshot.transaction_reference?.startsWith("test:") && snapshot.transaction_reference !== null) throw new Error("TEST_EVIDENCE_NAMESPACE_INVALID");
    return { snapshot, decision: classifyPaymentEvidence(invoice, snapshot), eventId: "test:reconcile:" + snapshot.id, rawBodyHash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") };
  }
}
export class TelegramStarsTestAdapter extends TestAdapter {
  readonly id = "telegram_stars_test";
  async createCheckout(invoice: PaymentInvoice): Promise<Checkout> {
    this.validate(invoice);
    if (invoice.channel !== "telegram_stars" || invoice.asset !== "XTR" || invoice.network !== "TELEGRAM" || invoice.decimals !== 0 || BigInt(invoice.amount_units) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("STARS_INVOICE_INVALID");
    return { mode: "test", channel: invoice.channel, providerReference: invoice.provider_reference, invoicePayload: { currency: "XTR", provider_token: "", payload: invoice.provider_reference, prices: [{ label: "TEST ONLY membership", amount: Number(invoice.amount_units) }] } };
  }
}
export class CryptoCheckoutTestAdapter extends TestAdapter {
  readonly id = "external_crypto_test";
  async createCheckout(invoice: PaymentInvoice): Promise<Checkout> {
    this.validate(invoice);
    if (invoice.channel !== "external_crypto" || invoice.surface !== "independent_web") throw new Error("TELEGRAM_STARS_REQUIRED");
    return { mode: "test", channel: invoice.channel, providerReference: invoice.provider_reference, webPath: "/admin/payments/" + invoice.id };
  }
}
export function testPaymentAdapter(id: string, lookup: SnapshotLookup, secret: string): PaymentProviderAdapter {
  if (id === "telegram_stars_test") return new TelegramStarsTestAdapter(lookup, secret);
  if (id === "external_crypto_test") return new CryptoCheckoutTestAdapter(lookup, secret);
  throw new Error("PAYMENT_PROVIDER_NOT_APPROVED");
}
