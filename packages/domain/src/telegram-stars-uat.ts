import { z } from "zod";
import { canonicalFinancialJson, financialSha256, financialTupleHash, parseFinancialJson } from "./financial-source-canonical";

/** Telegram's dedicated test network is a real provider test, never a simulation or LIVE receipt. */
export const STARS_UAT_ENVIRONMENT = "TELEGRAM_DEDICATED_TEST" as const;
const id = z.string().regex(/^[1-9][0-9]{0,15}$/u).refine(v => Number.isSafeInteger(Number(v)));
const units = z.string().regex(/^[1-9][0-9]{0,15}$/u).refine(v => BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER));
const time = z.iso.datetime({ offset: true });
export const telegramStarsUatInvoiceSchema = z.strictObject({
  version: z.literal(1), environment: z.literal(STARS_UAT_ENVIRONMENT), program_id: z.uuid(), tenant_id: z.uuid(), invoice_id: z.uuid(),
  bot_user_id: id, payer_user_id: id, product_code: z.literal("POLAT_VIP_30D_DRAFT"), duration_days: z.literal(30),
  currency: z.literal("XTR"), amount_units: units, issued_at: time, expires_at: time,
}).refine(v => Date.parse(v.expires_at) > Date.parse(v.issued_at));
export type TelegramStarsUatInvoice = z.infer<typeof telegramStarsUatInvoiceSchema>;
const user = z.object({ id: z.number().int().positive().safe(), is_bot: z.literal(false) });
const payment = z.object({ currency: z.literal("XTR"), total_amount: z.number().int().positive().safe(), invoice_payload: z.string().min(1).max(128),
  telegram_payment_charge_id: z.string().min(1).max(200), provider_payment_charge_id: z.string().max(200).optional(),
  is_recurring: z.literal(false).optional(), is_first_recurring: z.literal(false).optional(), subscription_expiration_date: z.never().optional() });
const update = z.object({ update_id: z.number().int().nonnegative().safe(),
  pre_checkout_query: z.object({ id: z.string().min(1).max(200), from: user, currency: z.literal("XTR"), total_amount: z.number().int().positive().safe(), invoice_payload: z.string().min(1).max(128) }).optional(),
  message: z.object({ from: user, chat: z.object({ id: z.number().int().positive().safe(), type: z.literal("private") }), date: z.number().int().positive().safe(),
    successful_payment: payment.optional(), refunded_payment: payment.optional() }).optional(),
}).refine(v => Number(!!v.pre_checkout_query) + Number(!!v.message?.successful_payment) + Number(!!v.message?.refunded_payment) === 1);

/** Reuse the accepted duplicate-key/UTF-8 parser, then require the Bot API's documented integer notation. No global financial-parser behavior changes. */
export function parseTelegramStarsTestJson(raw: string): unknown {
  const value = parseFinancialJson(raw);
  const outsideStrings = raw.replace(/"(?:[^"\\]|\\[\s\S])*"/gu, '""');
  const numbers = outsideStrings.match(/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/gu) ?? [];
  if (numbers.some(n => !/^-?(?:0|[1-9][0-9]*)$/u.test(n))) throw Error("STARS_TEST_INTEGER_NOTATION_INVALID");
  return value;
}

export function starsUatInvoicePayload(invoiceId: string): string { return "uat-stars:" + z.uuid().parse(invoiceId); }
export function prepareTelegramStarsUatInvoice(raw: unknown, now: number) {
  const i = telegramStarsUatInvoiceSchema.parse(raw);
  if (!Number.isFinite(now) || Date.parse(i.issued_at) > now || Date.parse(i.expires_at) <= now) throw Error("STARS_TEST_INVOICE_EXPIRED");
  return Object.freeze({ chat_id: i.payer_user_id, title: "Polat VIP — TEST ONLY", description: "Dedicated Telegram test-environment membership fixture. No real money or signal service.",
    currency: "XTR" as const, provider_token: "" as const, payload: starsUatInvoicePayload(i.invoice_id),
    prices: [{ label: "TEST ONLY — 30 days", amount: Number(i.amount_units) }], start_parameter: "uatstars_" + i.invoice_id.replaceAll("-", ""), protect_content: true });
}

export type StarsUatUpdate = Readonly<{ version: 1; origin: typeof STARS_UAT_ENVIRONMENT; kind: "PRE_CHECKOUT" | "PAYMENT" | "REFUND"; update_id: string;
  invoice_id: string; program_id: string; tenant_id: string; bot_user_id: string; amount_units: string; currency: "XTR"; charge_id: string | null;
  query_id: string | null; source_time: string | null; raw_hash: string; late: boolean }>;
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const normalizedUpdate = z.strictObject({ version: z.literal(1), origin: z.literal(STARS_UAT_ENVIRONMENT), kind: z.enum(["PRE_CHECKOUT", "PAYMENT", "REFUND"]),
  update_id: z.string().regex(/^(0|[1-9][0-9]{0,15})$/u), invoice_id: z.uuid(), program_id: z.uuid(), tenant_id: z.uuid(), bot_user_id: id, amount_units: units,
  currency: z.literal("XTR"), charge_id: z.string().min(1).max(200).nullable(), query_id: z.string().min(1).max(200).nullable(), source_time: time.nullable(), raw_hash: hash, late: z.boolean() });

/** Structural/binding validation only. The server must independently verify webhook secret and test-bot custody. */
export function parseTelegramStarsUatUpdate(raw: string, expected: unknown, now: number): StarsUatUpdate {
  try {
    const i = telegramStarsUatInvoiceSchema.parse(expected), v = update.parse(parseTelegramStarsTestJson(raw));
    if (!Number.isFinite(now) || Date.parse(i.issued_at) > now) throw Error();
    const p = v.pre_checkout_query ?? v.message?.successful_payment ?? v.message?.refunded_payment;
    if (!p || p.invoice_payload !== starsUatInvoicePayload(i.invoice_id) || String(p.total_amount) !== i.amount_units) throw Error();
    const from = v.pre_checkout_query?.from ?? v.message?.from;
    if (String(from?.id) !== i.payer_user_id || v.message && String(v.message.chat.id) !== i.payer_user_id) throw Error();
    const kind = v.pre_checkout_query ? "PRE_CHECKOUT" : v.message?.successful_payment ? "PAYMENT" : "REFUND";
    const timestamp = v.message ? v.message.date * 1000 : null;
    if (timestamp !== null && (timestamp > now + 60000 || now - timestamp > 300000 || timestamp < Date.parse(i.issued_at) - 60000)) throw Error();
    const late = kind !== "REFUND" && (timestamp ?? now) >= Date.parse(i.expires_at);
    if (kind === "PRE_CHECKOUT" && late) throw Error();
    return Object.freeze({ version: 1, origin: STARS_UAT_ENVIRONMENT, kind, update_id: String(v.update_id), invoice_id: i.invoice_id, program_id: i.program_id,
      tenant_id: i.tenant_id, bot_user_id: i.bot_user_id, amount_units: i.amount_units, currency: "XTR", charge_id: "telegram_payment_charge_id" in p ? p.telegram_payment_charge_id : null,
      query_id: v.pre_checkout_query?.id ?? null, source_time: timestamp === null ? null : new Date(timestamp).toISOString(), raw_hash: financialSha256(raw), late });
  } catch { throw Error("STARS_TEST_UPDATE_INVALID"); }
}

const partner = z.object({ type: z.literal("user"), user, transaction_type: z.literal("invoice_payment"), invoice_payload: z.string().max(128).optional() });
const transaction = z.object({ id: z.string().min(1).max(200), amount: z.number().int().positive().safe(), nanostar_amount: z.literal(0).optional(), date: z.number().int().positive().safe(),
  source: partner.optional(), receiver: partner.optional() }).refine(v => Number(!!v.source) + Number(!!v.receiver) === 1);
export type StarsUatLedgerRead = Readonly<{ version: 1; origin: typeof STARS_UAT_ENVIRONMENT; bot_user_id: string; read_at: string; raw_hash: string;
  complete: boolean; transactions: readonly { charge_id: string; kind: "PAYMENT" | "REFUND"; payer_user_id: string; amount_units: string; source_time: string; invoice_payload: string | null }[] }>;
const normalizedLedger = z.strictObject({ version: z.literal(1), origin: z.literal(STARS_UAT_ENVIRONMENT), bot_user_id: id, read_at: time, raw_hash: hash, complete: z.boolean(),
  transactions: z.array(z.strictObject({ charge_id: z.string().min(1).max(200), kind: z.enum(["PAYMENT", "REFUND"]), payer_user_id: id, amount_units: units, source_time: time, invoice_payload: z.string().max(128).nullable() })).max(25) });
/** Bounded financial parser rejects duplicate keys, unsafe numeric precision and malformed metadata before JSONB/persistence. */
export function parseTelegramStarsUatLedger(raw: string, botUserId: string, offset: number, limit: number, readAt: string): StarsUatLedgerRead {
  try {
    id.parse(botUserId); time.parse(readAt);
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 25) throw Error();
    const v = z.object({ ok: z.literal(true), result: z.object({ transactions: z.array(transaction).max(25) }) }).parse(parseTelegramStarsTestJson(raw));
    if (v.result.transactions.length > limit) throw Error();
    return Object.freeze({ version: 1, origin: STARS_UAT_ENVIRONMENT, bot_user_id: botUserId, read_at: readAt, raw_hash: financialSha256(raw),
      complete: offset === 0 && v.result.transactions.length < limit,
      transactions: Object.freeze(v.result.transactions.map(t => { const p = t.source ?? t.receiver!; return Object.freeze({ charge_id: t.id, kind: t.source ? "PAYMENT" as const : "REFUND" as const,
        payer_user_id: String(p.user.id), amount_units: String(t.amount), source_time: new Date(t.date * 1000).toISOString(), invoice_payload: p.invoice_payload ?? null }); })) });
  } catch { throw Error("STARS_TEST_LEDGER_INVALID"); }
}

export type StarsUatHistory = Readonly<{ tenant_id: string; invoice_id: string; operation_key: string; delivery_key: string; raw_hash: string; fact_hash: string; kind: "PAYMENT" | "REFUND"; amount_units: string }>;
const normalizedHistory = z.strictObject({ tenant_id: z.uuid(), invoice_id: z.uuid(), operation_key: hash, delivery_key: hash, raw_hash: hash, fact_hash: hash, kind: z.enum(["PAYMENT", "REFUND"]), amount_units: units });
export type StarsUatAssessment = Readonly<{ version: 1; origin: typeof STARS_UAT_ENVIRONMENT; state: "PENDING" | "REVIEW" | "REJECTED" | "CORROBORATED_TEST_FACTS";
  reason: string; financial_authority: "NONE"; genuine_receipt_authorized: false; replay: boolean; operation_key: string | null; delivery_key: string | null;
  fact_hash: string | null; amount_units: string | null; history_entry: StarsUatHistory | null }>;
/** Correlation is NOT authentication, receipt authority or a subscription grant. Only a separately guarded TEST recorder may consume it. */
export function assessTelegramStarsUatEvidence(expected: unknown, inputEvent: StarsUatUpdate, inputLedger: StarsUatLedgerRead | null, inputHistory: readonly StarsUatHistory[], now: number): StarsUatAssessment {
  const answer = (state: StarsUatAssessment["state"], reason: string, rest: Partial<StarsUatAssessment> = {}): StarsUatAssessment => Object.freeze({ version: 1, origin: STARS_UAT_ENVIRONMENT,
    state, reason, financial_authority: "NONE", genuine_receipt_authorized: false, replay: false, operation_key: null, delivery_key: null, fact_hash: null, amount_units: null, history_entry: null, ...rest });
  try {
    canonicalFinancialJson({ expected, inputEvent, inputLedger, inputHistory });
    const i = telegramStarsUatInvoiceSchema.parse(expected), event = normalizedUpdate.parse(inputEvent), ledger = inputLedger === null ? null : normalizedLedger.parse(inputLedger), history = z.array(normalizedHistory).max(100).parse(inputHistory);
    if (!Number.isFinite(now)) return answer("REJECTED", "HISTORY_OR_TIME_INVALID");
    if (event.origin !== STARS_UAT_ENVIRONMENT || event.tenant_id !== i.tenant_id || event.invoice_id !== i.invoice_id || event.program_id !== i.program_id || event.bot_user_id !== i.bot_user_id || event.amount_units !== i.amount_units || event.currency !== "XTR") return answer("REJECTED", "SCOPE_MISMATCH");
    if (event.kind === "PRE_CHECKOUT") return answer("PENDING", "PRE_CHECKOUT_IS_NOT_PAYMENT");
    if (!event.charge_id || !event.source_time || !ledger || ledger.origin !== STARS_UAT_ENVIRONMENT || ledger.bot_user_id !== i.bot_user_id || ledger.raw_hash === event.raw_hash) return answer("PENDING", "INDEPENDENT_TEST_LEDGER_REQUIRED");
    if (!ledger.complete || Date.parse(ledger.read_at) > now + 60000 || now - Date.parse(ledger.read_at) > 300000 || Date.parse(event.source_time) > now + 60000 || now - Date.parse(event.source_time) > 300000) return answer("PENDING", "LEDGER_INCOMPLETE_OR_STALE");
    const matches = ledger.transactions.filter(t => t.charge_id === event.charge_id && t.kind === event.kind);
    if (matches.length === 0) return answer("PENDING", "CHARGE_NOT_OBSERVED");
    if (matches.length !== 1) return answer("REVIEW", "LEDGER_DUPLICATE_OR_CONFLICT");
    const t = matches[0]!;
    if (t.payer_user_id !== i.payer_user_id || t.amount_units !== i.amount_units || t.invoice_payload !== null && t.invoice_payload !== starsUatInvoicePayload(i.invoice_id)
      || Math.abs(Date.parse(t.source_time) - Date.parse(event.source_time)) > 300000 || Date.parse(t.source_time) > now + 60000) return answer("REVIEW", "LEDGER_BINDING_CONFLICT");
    const operation = financialTupleHash("telegram-stars-test-operation", [STARS_UAT_ENVIRONMENT, i.bot_user_id, event.kind, event.charge_id]);
    const delivery = financialTupleHash("telegram-stars-test-delivery", [STARS_UAT_ENVIRONMENT, i.bot_user_id, event.update_id]);
    const fact = financialSha256(canonicalFinancialJson({ version: 1, bot: i.bot_user_id, kind: event.kind, charge: event.charge_id, invoice: starsUatInvoicePayload(i.invoice_id), payer: i.payer_user_id, units: i.amount_units, currency: "XTR" }));
    if (history.some(h => h.delivery_key === delivery && (h.raw_hash !== event.raw_hash || h.operation_key !== operation || h.fact_hash !== fact))) return answer("REVIEW", "DELIVERY_CONFLICT");
    if (history.some(h => h.operation_key === operation && (h.tenant_id !== i.tenant_id || h.invoice_id !== i.invoice_id || h.fact_hash !== fact))) return answer("REJECTED", "GLOBAL_OPERATION_REUSE");
    const replay = history.some(h => h.operation_key === operation);
    if (event.kind === "PAYMENT" && history.some(h => h.tenant_id === i.tenant_id && h.invoice_id === i.invoice_id && h.kind === "PAYMENT" && h.operation_key !== operation)) return answer("REVIEW", "SECOND_PAYMENT_FOR_INVOICE");
    if (event.kind === "REFUND") {
      const original = financialTupleHash("telegram-stars-test-operation", [STARS_UAT_ENVIRONMENT, i.bot_user_id, "PAYMENT", event.charge_id]);
      if (!history.some(h => h.operation_key === original && h.tenant_id === i.tenant_id && h.invoice_id === i.invoice_id && h.kind === "PAYMENT" && h.amount_units === i.amount_units)) return answer("PENDING", "REFUND_ORIGINAL_PAYMENT_REQUIRED");
    }
    if (event.late) return answer("REVIEW", "PAYMENT_AFTER_INVOICE_EXPIRY");
    const entry = Object.freeze({ tenant_id: i.tenant_id, invoice_id: i.invoice_id, operation_key: operation, delivery_key: delivery, raw_hash: event.raw_hash, fact_hash: fact, kind: event.kind, amount_units: i.amount_units });
    return answer("CORROBORATED_TEST_FACTS", replay ? "TEST_OPERATION_REPLAY" : event.kind === "REFUND" ? "TEST_REFUND_CORROBORATED" : "TEST_PAYMENT_CORROBORATED", { replay, operation_key: operation, delivery_key: delivery, fact_hash: fact, amount_units: i.amount_units, history_entry: entry });
  } catch { return answer("REJECTED", "TEST_EVIDENCE_INVALID"); }
}
