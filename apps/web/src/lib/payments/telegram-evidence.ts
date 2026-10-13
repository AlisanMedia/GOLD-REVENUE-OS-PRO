import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Verification contract only: this is not mounted on a live route and sends no invoices.
// The caller supplies the merchant bot's server configuration, never browser booleans.
const successfulPaymentSchema = z.object({
  currency: z.literal("XTR"), total_amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  invoice_payload: z.string().min(1).max(128), telegram_payment_charge_id: z.string().min(1).max(200),
  provider_payment_charge_id: z.string(), is_recurring: z.boolean().optional(), is_first_recurring: z.boolean().optional(),
}).passthrough();
const updateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z.object({ from: z.object({ id: z.number().int().positive() }).passthrough(), successful_payment: successfulPaymentSchema }).passthrough(),
}).passthrough();
export function verifyTelegramStarsEvidence(input: { rawBody: string; secretHeader: string | null }, expected: { webhookSecret: string; payerUserId: string; invoicePayload: string; amountUnits: string }): { updateId: string; chargeId: string; source: "telegram_successful_payment" } {
  if (expected.webhookSecret.length < 32 || !input.secretHeader || Buffer.byteLength(input.rawBody) > 16384) throw new Error("TELEGRAM_PAYMENT_AUTH_INVALID");
  const digest = (v: string) => createHash("sha256").update(v).digest();
  if (!timingSafeEqual(digest(input.secretHeader), digest(expected.webhookSecret))) throw new Error("TELEGRAM_PAYMENT_AUTH_INVALID");
  const update = updateSchema.parse(JSON.parse(input.rawBody)), payment = update.message.successful_payment;
  if (payment.invoice_payload !== expected.invoicePayload || String(update.message.from.id) !== expected.payerUserId || BigInt(payment.total_amount) !== BigInt(expected.amountUnits) || payment.is_recurring || payment.is_first_recurring) throw new Error("TELEGRAM_PAYMENT_BINDING_INVALID");
  if (payment.telegram_payment_charge_id.startsWith("test:")) throw new Error("SIMULATION_IS_NOT_TELEGRAM_EVIDENCE");
  return { updateId: String(update.update_id), chargeId: payment.telegram_payment_charge_id, source: "telegram_successful_payment" };
}

// A future approved live crypto adapter must implement these independent reads.
// No concrete merchant, asset/network approval or credential is assumed by Phase 10.
export interface AuthorizedCryptoProvider {
  readonly providerId: string;
  readonly merchantApprovalReference: string;
  verifyRawWebhook(rawBody: Uint8Array, headers: Headers): Promise<{ eventId: string; providerReference: string }>;
  readInvoice(providerReference: string): Promise<{ merchantId: string; amountUnits: string; asset: string; network: string; recipient: string; transactionReference: string | null; status: string }>;
  readTransaction(transactionReference: string, network: string): Promise<{ canonical: boolean; confirmations: number; amountUnits: string; assetContract: string; recipient: string; transferIndex: string }>;
}
