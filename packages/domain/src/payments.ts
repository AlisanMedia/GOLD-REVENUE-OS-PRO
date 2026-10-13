import { z } from "zod";

export const PAYMENT_STATES = ["CREATED", "PENDING", "CONFIRMED", "FAILED", "EXPIRED", "REFUNDED", "REVIEW"] as const;
export type PaymentState = typeof PAYMENT_STATES[number];
export const paymentChannelSchema = z.enum(["telegram_stars", "external_crypto"]);
export type PaymentChannel = z.infer<typeof paymentChannelSchema>;
export const paymentSurfaceSchema = z.enum(["telegram_bot", "telegram_mini_app", "independent_web"]);
export type PaymentSurface = z.infer<typeof paymentSurfaceSchema>;
const ref = z.string().regex(/^[A-Za-z0-9:_./-]{1,200}$/u);
export const atomicUnitsSchema = z.string().regex(/^(0|[1-9][0-9]{0,29})$/u);
export const paymentInvoiceSchema = z.object({
  id: z.uuid(), tenant_id: z.uuid(), customer_id: z.uuid(), offer_id: z.uuid(),
  provider_id: ref, provider_reference: ref, channel: paymentChannelSchema,
  surface: paymentSurfaceSchema, mode: z.literal("test"),
  amount_units: atomicUnitsSchema.refine(v => BigInt(v) > 0n), decimals: z.number().int().min(0).max(18),
  asset: ref, network: ref, recipient: ref, payer_reference: ref,
  min_confirmations: z.number().int().min(1).max(10000),
  status: z.enum(PAYMENT_STATES), expires_at: z.iso.datetime(),
}).strict();
export type PaymentInvoice = z.infer<typeof paymentInvoiceSchema>;
export const providerSnapshotSchema = z.object({
  id: z.uuid(), invoice_id: z.uuid(), provider_id: ref, provider_reference: ref,
  mode: z.literal("test"), source: z.literal("simulation"),
  amount_units: atomicUnitsSchema, asset: ref, network: ref, recipient: ref, payer_reference: ref,
  transaction_reference: ref.nullable(), confirmations: z.number().int().min(0).max(10000000),
  provider_status: z.enum(["pending", "settled", "failed", "refunded", "reorg"]),
  observed_at: z.iso.datetime(),
}).strict();
export type ProviderSnapshot = z.infer<typeof providerSnapshotSchema>;
export type PaymentDecision = { state: PaymentState; reason: string };

// Caller-supplied channel hints never authorize a surface. The entry point owns the surface.
export function assertPaymentSurface(channel: PaymentChannel, surface: PaymentSurface): void {
  if (channel === "external_crypto" && surface !== "independent_web") throw new Error("TELEGRAM_STARS_REQUIRED");
  if (channel === "telegram_stars" && surface === "independent_web") throw new Error("STARS_TELEGRAM_SURFACE_REQUIRED");
}

export function decimalToAtomic(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 || !/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,18})?$/u.test(value)) throw new Error("INVALID_PAYMENT_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("PAYMENT_PRECISION_EXCEEDED");
  const units = (BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0")).toString();
  if (BigInt(units) <= 0n) throw new Error("INVALID_PAYMENT_AMOUNT");
  return atomicUnitsSchema.parse(units);
}
export function atomicToDecimal(units: string, decimals: number): string {
  atomicUnitsSchema.parse(units);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("INVALID_PAYMENT_PRECISION");
  const digits = units.padStart(decimals + 1, "0");
  return decimals === 0 ? digits : digits.slice(0, -decimals) + "." + digits.slice(-decimals);
}

export function classifyPaymentEvidence(invoice: PaymentInvoice, evidence: ProviderSnapshot): PaymentDecision {
  paymentInvoiceSchema.parse(invoice); providerSnapshotSchema.parse(evidence);
  assertPaymentSurface(invoice.channel, invoice.surface);
  if (evidence.invoice_id !== invoice.id || evidence.provider_id !== invoice.provider_id || evidence.provider_reference !== invoice.provider_reference) throw new Error("PAYMENT_EVIDENCE_SCOPE_MISMATCH");
  if (evidence.asset !== invoice.asset || evidence.network !== invoice.network || evidence.recipient !== invoice.recipient || evidence.payer_reference !== invoice.payer_reference) return { state: "REVIEW", reason: "PAYMENT_BINDING_MISMATCH" };
  if (evidence.provider_status === "reorg") return { state: "REVIEW", reason: "CHAIN_REORG" };
  if (evidence.provider_status === "refunded") return { state: "REFUNDED", reason: "PROVIDER_REFUND_EVIDENCE" };
  if (evidence.provider_status === "failed") return { state: "FAILED", reason: "PROVIDER_FAILURE" };
  if (Date.parse(evidence.observed_at) > Date.parse(invoice.expires_at)) return evidence.transaction_reference ? { state: "REVIEW", reason: "LATE_PAYMENT" } : { state: "EXPIRED", reason: "INVOICE_EXPIRED" };
  if (evidence.provider_status !== "settled") return { state: "PENDING", reason: "AWAITING_PROVIDER_SETTLEMENT" };
  if (!evidence.transaction_reference) return { state: "REVIEW", reason: "MISSING_TRANSACTION_REFERENCE" };
  if (BigInt(evidence.amount_units) !== BigInt(invoice.amount_units)) return { state: "REVIEW", reason: BigInt(evidence.amount_units) < BigInt(invoice.amount_units) ? "UNDERPAYMENT" : "OVERPAYMENT" };
  if (evidence.confirmations < invoice.min_confirmations) return { state: "PENDING", reason: "AWAITING_CONFIRMATIONS" };
  return { state: "CONFIRMED", reason: "TEST_EVIDENCE_CONFIRMED" };
}

export function nextPaymentState(current: PaymentState, proposed: PaymentState): PaymentState {
  if (current === proposed) return current;
  if (current === "REVIEW") return "REVIEW"; // No automatic override of a held payment.
  if (current === "CONFIRMED") return proposed === "REFUNDED" ? "REFUNDED" : "REVIEW";
  if (["FAILED", "EXPIRED", "REFUNDED"].includes(current)) return "REVIEW";
  return proposed;
}
