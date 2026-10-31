import { z } from "zod";
import { parseFinancialJson, financialSha256 } from "./financial-source-canonical";

const numeric = z.string().regex(/^[1-9][0-9]{0,15}$/u).refine(v => Number.isSafeInteger(Number(v)));
const units = numeric;
export const starsCommerceIntentSchema = z.strictObject({
  version: z.literal(1), environment: z.literal("TELEGRAM_PRODUCTION"), tenant_id: z.uuid(), invoice_id: z.uuid(), offer_id: z.uuid(),
  customer_id: z.uuid(), bot_user_id: numeric, payer_user_id: numeric, amount_units: units, currency: z.literal("XTR"),
  title: z.string().min(1).max(32), description: z.string().min(1).max(255), expires_at: z.iso.datetime({ offset: true }),
});
export type StarsCommerceIntent = z.infer<typeof starsCommerceIntentSchema>;
export function starsCommercePayload(invoiceId: string) { return "stars-live:" + z.uuid().parse(invoiceId); }
// No Business connection parameter: the configured MERCHANT BOT is the Stars
// recipient. A link can later be sent through the independently authorized Business route.
export function prepareStarsCommerceCheckout(raw: unknown, now: number) {
  const i = starsCommerceIntentSchema.parse(raw);
  if (!Number.isFinite(now) || Date.parse(i.expires_at) <= now) throw Error("STARS_COMMERCE_INTENT_EXPIRED");
  return { title: i.title, description: i.description, payload: starsCommercePayload(i.invoice_id), currency: "XTR" as const,
    provider_token: "", prices: [{ label: i.title, amount: Number(i.amount_units) }] };
}
function json(raw: string) {
  if (Buffer.byteLength(raw) > 65536) throw Error("STARS_COMMERCE_BODY_BOUND");
  const value = parseFinancialJson(raw,65536), outside = raw.replace(/"(?:[^"\\]|\\[\s\S])*"/gu, '""');
  if ((outside.match(/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/gu) ?? []).some(v => !/^-?(?:0|[1-9][0-9]*)$/u.test(v))) throw Error("STARS_COMMERCE_INTEGER_REQUIRED");
  return value;
}
const user = z.object({ id: z.number().int().positive().safe(), is_bot: z.literal(false) });
const payment = z.object({ currency: z.literal("XTR"), total_amount: z.number().int().positive().safe(), invoice_payload: z.string(), telegram_payment_charge_id: z.string().min(1).max(200),
  provider_payment_charge_id: z.string().max(200).optional(), is_recurring: z.literal(false).optional(), is_first_recurring: z.literal(false).optional(), subscription_expiration_date: z.never().optional() });
const update = z.object({ update_id: z.number().int().nonnegative().safe(),
  pre_checkout_query: z.object({ id: z.string().min(1).max(200), from: user, currency: z.literal("XTR"), total_amount: z.number().int().positive().safe(), invoice_payload: z.string() }).optional(),
  message: z.object({ from: user, chat: z.object({ id: z.number().int().positive().safe(), type: z.literal("private") }), date: z.number().int().positive().safe(), successful_payment: payment.optional(), refunded_payment: payment.optional() }).optional(),
}).refine(v => Number(!!v.pre_checkout_query) + Number(!!v.message?.successful_payment) + Number(!!v.message?.refunded_payment) === 1);
export type StarsCommerceEvent = { kind: "PRE_CHECKOUT" | "PAYMENT" | "REFUND"; update_id: string; charge_id: string | null; query_id: string | null; source_time: string | null; raw_hash: string };
export function parseStarsCommerceUpdate(raw: string, expected: StarsCommerceIntent, now: number): StarsCommerceEvent {
  const i = starsCommerceIntentSchema.parse(expected), v = update.parse(json(raw)), p = v.pre_checkout_query ?? v.message?.successful_payment ?? v.message?.refunded_payment;
  if (!p || p.invoice_payload !== starsCommercePayload(i.invoice_id) || String(p.total_amount) !== i.amount_units || String((v.pre_checkout_query?.from ?? v.message?.from)?.id) !== i.payer_user_id
    || v.message && String(v.message.chat.id) !== i.payer_user_id) throw Error("STARS_COMMERCE_PAYMENT_BINDING_INVALID");
  const kind = v.pre_checkout_query ? "PRE_CHECKOUT" : v.message?.successful_payment ? "PAYMENT" : "REFUND";
  const time = v.message ? v.message.date * 1000 : null;
  if (!Number.isFinite(now) || time !== null && (time > now + 60000 || now - time > 300000) || kind !== "REFUND" && (time ?? now) >= Date.parse(i.expires_at)) throw Error("STARS_COMMERCE_STALE_OR_EXPIRED");
  const charge = "telegram_payment_charge_id" in p ? p.telegram_payment_charge_id : null;
  if (charge?.startsWith("test:")) throw Error("STARS_COMMERCE_TEST_EVIDENCE_DENIED");
  return { kind, update_id: String(v.update_id), charge_id: charge, query_id: v.pre_checkout_query?.id ?? null, source_time: time === null ? null : new Date(time).toISOString(), raw_hash: financialSha256(raw,65536) };
}
export function starsCommerceInvoiceId(raw: string): string {
  const v = update.parse(json(raw)), payload = v.pre_checkout_query?.invoice_payload ?? v.message?.successful_payment?.invoice_payload ?? v.message?.refunded_payment?.invoice_payload;
  if (!payload?.startsWith("stars-live:")) throw Error("STARS_COMMERCE_PAYLOAD_INVALID");
  return z.uuid().parse(payload.slice(11));
}
export type StarsCommerceLedger = { raw_hash: string; read_at: string; page_complete: boolean; history_exhausted: boolean; entries: { charge_id: string; kind: "PAYMENT" | "REFUND"; payer_user_id: string; amount_units: string; invoice_payload: string | null; source_time: string }[] };
export function parseStarsCommerceLedger(raw: string, readAt: string): StarsCommerceLedger {
  const actor=z.object({id:z.number().int().positive().safe(),is_bot:z.boolean()});
  const partner=z.discriminatedUnion("type",[
    z.object({type:z.literal("user"),user:actor,transaction_type:z.enum(["invoice_payment","paid_media_payment","gift_purchase","premium_purchase","business_account_transfer"]),invoice_payload:z.string().max(128).optional()}),
    z.object({type:z.enum(["chat","affiliate_program","fragment","telegram_ads","telegram_api","other"])})
  ]);
  const transaction = z.object({ id:z.string().min(1).max(200),amount:z.number().int().safe(),nanostar_amount:z.number().int().min(0).max(999999999).optional(),date:z.number().int().positive().safe(),source:partner.optional(),receiver:partner.optional() }).refine(v=>Number(!!v.source)+Number(!!v.receiver)===1);
  const v=z.object({ok:z.literal(true),result:z.object({transactions:z.array(transaction).max(100)})}).parse(json(raw));
  z.iso.datetime({offset:true}).parse(readAt);
  const entries:StarsCommerceLedger["entries"]=[];
  for(const t of v.result.transactions){
    const p=t.source??t.receiver!;
    // Project documented unrelated activity, never count it as an invoice payment.
    // Unknown partner/types still hold; no unrestricted passthrough authority.
    if(p.type!=="user"||p.transaction_type!=="invoice_payment")continue;
    if(p.user.is_bot||t.amount<=0||(t.nanostar_amount??0)!==0)throw Error("STARS_COMMERCE_INVOICE_UNITS_INVALID");
    entries.push({charge_id:t.id,kind:t.source?"PAYMENT":"REFUND",payer_user_id:String(p.user.id),amount_units:String(t.amount),invoice_payload:p.invoice_payload??null,source_time:new Date(t.date*1000).toISOString()});
  }
  return {raw_hash:financialSha256(raw,65536),read_at:readAt,page_complete:true,history_exhausted:v.result.transactions.length<100,entries};
}
export function corroborateStarsCommerce(i: StarsCommerceIntent, event: StarsCommerceEvent, ledger: StarsCommerceLedger, now: number) {
  starsCommerceIntentSchema.parse(i);
  if (event.kind === "PRE_CHECKOUT") return { state: "PENDING" as const, reason: "PRECHECKOUT_IS_NOT_PAYMENT" };
  if (!ledger.page_complete || Date.parse(ledger.read_at) > now + 60000 || now - Date.parse(ledger.read_at) > 300000 || event.raw_hash === ledger.raw_hash) return { state: "PENDING" as const, reason: "INDEPENDENT_DECODED_LEDGER_PAGE_REQUIRED" };
  const matching = ledger.entries.filter(e => e.charge_id === event.charge_id && e.kind === event.kind);
  if (matching.length !== 1) return { state: "PENDING" as const, reason: "UNIQUE_CHARGE_NOT_OBSERVED" };
  const fact = matching[0]!;
  if (fact.payer_user_id !== i.payer_user_id || fact.amount_units !== i.amount_units || fact.invoice_payload !== starsCommercePayload(i.invoice_id) || fact.source_time !== event.source_time) return { state: "REVIEW" as const, reason: "LEDGER_PAYMENT_MISMATCH" };
  if (event.kind === "PAYMENT" && ledger.entries.some(e => e.charge_id === event.charge_id && e.kind === "REFUND")) return { state: "REVIEW" as const, reason: "PAYMENT_ALREADY_REFUNDED" };
  return { state: "CORROBORATED" as const, reason: "AUTHENTICATION_AND_RECEIPT_AUTHORITY_STILL_REQUIRED" };
}
