import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { starsCommerceIntentSchema, prepareStarsCommerceCheckout, starsCommerceInvoiceId, parseStarsCommerceUpdate,
  parseStarsCommerceLedger, corroborateStarsCommerce, type StarsCommerceEvent, type StarsCommerceIntent } from "../../../../../packages/domain/src/telegram-stars-commerce";
import { financialSha256, canonicalFinancialJson, parseFinancialJson } from "../../../../../packages/domain/src/financial-source-canonical";

const numeric = z.string().regex(/^[1-9][0-9]{0,15}$/u), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const bindingSchema = z.strictObject({ version: z.literal(1), environment: z.literal("TELEGRAM_PRODUCTION"), tenant_id: z.uuid(),
  financial_authority: z.literal("VERIFIED_STARS_RECEIPT"), approval_reference: z.string().min(1).max(200), repository_sha: z.string().regex(/^[a-f0-9]{40}$/u),
  bot_user_id: numeric, credential_sha256: hash, webhook_secret_sha256: hash, owner_user_id: z.uuid(), eligibility_evidence_hash: hash,
  owner_authorization_hash: hash, channel_id: z.string().regex(/^-100[0-9]{1,13}$/u), expires_at: z.iso.datetime({ offset: true }),allowed_markets:z.array(z.string().regex(/^[A-Z]{2}$/u).refine(v=>v!=="TR")).min(1).max(250) });
const methodSchema = z.enum(["getMe", "createInvoiceLink", "answerPreCheckoutQuery", "getStarTransactions", "refundStarPayment"]);
/** Existing invoice/observation/receipt store only. No SDK/retry, arbitrary host,
 * fixture grant, credential fallback or global worker auto-selection. Absent
 * existing financial controls fail before credentials or any network access. */
export async function createStarsCommerce(input: { tenantId: string }, transport: typeof fetch = fetch) {
  const tenant = z.uuid().parse(input.tenantId), db = createSupabaseAdminClient();
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await db.rpc(name, { target_tenant_id: tenant, ...args });
    if (r.error) throw Error("STARS_COMMERCE_STORE_UNAVAILABLE"); return r.data as unknown;
  };
  const initial = bindingSchema.parse(await rpc("stars_commerce_scope_v1"));
  const bindingHash = financialSha256(canonicalFinancialJson(initial));
  async function authority() {
    const current = bindingSchema.parse(await rpc("stars_commerce_scope_v1"));
    if (current.tenant_id !== tenant || current.repository_sha !== process.env.VERCEL_GIT_COMMIT_SHA || Date.parse(current.expires_at) <= Date.now()
      || financialSha256(canonicalFinancialJson(current)) !== bindingHash) throw Error("STARS_COMMERCE_CONTROL_DRIFT");
    return current;
  }
  await authority();
  const token = process.env.POLAT_STARS_MERCHANT_BOT_TOKEN, secret = process.env.POLAT_STARS_MERCHANT_WEBHOOK_SECRET;
  const sha = (v: string) => createHash("sha256").update(v).digest("hex");
  if (!token || !/^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{20,200}$/u.test(token) || token.split(":")[0] !== initial.bot_user_id || sha(token) !== initial.credential_sha256
    || !secret || secret.length < 32 || sha(secret) !== initial.webhook_secret_sha256) throw Error("STARS_COMMERCE_CUSTODY_REQUIRED");
  async function intent(id: string) {
    const i = starsCommerceIntentSchema.parse(await rpc("stars_commerce_intent_v1", { target_invoice_id: z.uuid().parse(id) }));
    if (i.tenant_id !== tenant || i.bot_user_id !== initial.bot_user_id) throw Error("STARS_COMMERCE_INTENT_SCOPE_DENIED"); return i;
  }
  async function request<T>(i: StarsCommerceIntent, methodInput: z.infer<typeof methodSchema>, body: Record<string, unknown>, key: string, validate: (raw: string) => T) {
    const method = methodSchema.parse(methodInput); await authority();
    const nonce = randomUUID(), requestHash = financialSha256(canonicalFinancialJson({ method, body, binding_hash: bindingHash }));
    const reserved = z.strictObject({ dispatch: z.boolean(), attempt_id: z.uuid() }).parse(await rpc("stars_commerce_reserve_v1", {
      target_invoice_id: i.invoice_id, operation_value: method, request_key_value: key, request_hash_value: requestHash, nonce_value: nonce,
    }));
    if (!reserved.dispatch) throw Error("STARS_COMMERCE_NO_REPLAY_DISPATCH");
    const observation: {state:"ACKNOWLEDGED"|"REJECTED"|"UNKNOWN";responseHash:string|null;result:T|null}={state:"UNKNOWN",responseHash:null,result:null};
    const controller = new AbortController();
    let rejectDeadline: (() => void) | undefined;
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = () => { controller.abort(); reject(Error("deadline")); }; });
    const timer = setTimeout(() => rejectDeadline?.(), 10000);
    try {
      const execute = async () => {
      await authority();
      const response = await transport(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error", cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || response.redirected || !response.body) throw Error("invalid");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 65536) throw Error("bound"); chunks.push(part.value); } }
      finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      if(controller.signal.aborted)throw Error("cancelled");
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); observation.responseHash = financialSha256(raw,65536);
      if (response.status === 200) { observation.result = validate(raw); observation.state = "ACKNOWLEDGED"; }
      else if (response.status >= 400 && response.status < 500 && response.status !== 408) { const v = z.object({ ok: z.literal(false), error_code: z.literal(response.status) }).parse(JSON.parse(raw)); if (v) observation.state = "REJECTED"; }
      };
      await Promise.race([execute(), deadline]);
    } catch { observation.state = "UNKNOWN"; }
    finally { clearTimeout(timer); controller.abort(); }
    const committed = await rpc("stars_commerce_result_v1", { target_invoice_id: i.invoice_id, attempt_id_value: reserved.attempt_id, nonce_value: nonce,
      state_value: observation.state, response_hash_value: observation.responseHash, evidence_value: JSON.stringify(observation.result ?? {}) });
    if (committed !== true || observation.state !== "ACKNOWLEDGED" || observation.result === null) throw Error(observation.state === "REJECTED" ? "STARS_COMMERCE_PROVIDER_REJECTED_NO_RETRY" : "STARS_COMMERCE_RESULT_UNKNOWN_RECONCILE_REQUIRED");
    return { value: observation.result, attempt_id: reserved.attempt_id };
  }
  async function getMe(i: StarsCommerceIntent, key: string) {
    await request(i, "getMe", {}, key, raw => { const v = z.object({ ok: z.literal(true), result: z.object({ id: z.number().int().positive().safe(), is_bot: z.literal(true) }) }).parse(JSON.parse(raw));
      if (String(v.result.id) !== initial.bot_user_id) throw Error("mismatch"); return { bot_user_id: String(v.result.id) }; });
  }
  async function reconcile(i: StarsCommerceIntent, event: StarsCommerceEvent, key: string) {
    const ledger = await request(i, "getStarTransactions", { offset: 0, limit: 100 }, key, raw => parseStarsCommerceLedger(raw, new Date().toISOString()));
    const check = corroborateStarsCommerce(i, event, ledger.value, Date.now());
    if (check.state !== "CORROBORATED") return check;
    return rpc("stars_commerce_admit_v1", { target_invoice_id: i.invoice_id, update_id_value: event.update_id, ledger_attempt_id_value: ledger.attempt_id });
  }
  return {
    async preparePurchase(offerId: string, key: string) {
      const i = starsCommerceIntentSchema.parse(await rpc("stars_commerce_prepare_v1", { target_offer_id: z.uuid().parse(offerId), request_key_value: key }));
      if (i.tenant_id !== tenant || i.bot_user_id !== initial.bot_user_id) throw Error("STARS_COMMERCE_INTENT_SCOPE_DENIED");
      await getMe(i, key + ":identity");
      const link = await request(i, "createInvoiceLink", prepareStarsCommerceCheckout(i, Date.now()), key + ":checkout", raw => {
        const r = z.object({ ok: z.literal(true), result: z.string().regex(/^https:\/\/t\.me\/\$[A-Za-z0-9_-]{1,200}$/u) }).parse(JSON.parse(raw)); return { checkout_url: r.result };
      });
      return { invoice_id: i.invoice_id, checkout_url: link.value.checkout_url, status: "PAYMENT_PENDING" as const, subscription_activated: false };
    },
    async acceptWebhook(raw: string, header: string | null, key: string) {
      // Authentication precedes invoice lookup and any provider request.
      if (!header || !timingSafeEqual(Buffer.from(sha(header), "hex"), Buffer.from(initial.webhook_secret_sha256, "hex"))) throw Error("STARS_COMMERCE_WEBHOOK_DENIED");
      const i = await intent(starsCommerceInvoiceId(raw));
      const stored=await rpc("stars_commerce_callback_by_hash_v1",{target_invoice_id:i.invoice_id,raw_hash_value:financialSha256(raw)});
      const event:StarsCommerceEvent=stored===null?parseStarsCommerceUpdate(raw,i,Date.now()):z.object({kind:z.enum(["PRE_CHECKOUT","PAYMENT","REFUND"]),update_id:z.string(),charge_id:z.string().nullable(),query_id:z.string().nullable(),source_time:z.string().nullable(),raw_hash:hash}).strict().parse(stored);
      if(stored===null)await rpc("stars_commerce_callback_v1", { target_invoice_id: i.invoice_id, event_value: JSON.stringify(event) });
      if (event.kind === "PRE_CHECKOUT" && stored!==null)return {state:"PENDING",reason:"PRECHECKOUT_ALREADY_TRACKED_NOT_PAYMENT"};
      if (event.kind === "PRE_CHECKOUT") {
        await request(i, "answerPreCheckoutQuery", { pre_checkout_query_id: event.query_id, ok: true }, key, raw => z.object({ ok: z.literal(true), result: z.literal(true) }).parse(JSON.parse(raw)));
        return { state: "PENDING", reason: "PRECHECKOUT_IS_NOT_PAYMENT" };
      }
      await getMe(i,key+":identity");
      return reconcile(i, event, key);
    },
    async acceptJoinWebhook(raw:string,header:string|null){
      if(!header||!timingSafeEqual(Buffer.from(sha(header),"hex"),Buffer.from(initial.webhook_secret_sha256,"hex")))throw Error("STARS_COMMERCE_WEBHOOK_DENIED");
      if(Buffer.byteLength(raw)>16384)throw Error("STARS_COMMERCE_BODY_BOUND");
      const event=z.object({update_id:z.number().int().nonnegative().safe(),chat_join_request:z.object({from:z.object({id:z.number().int().positive().safe(),is_bot:z.literal(false)}),chat:z.object({id:z.number().int().safe(),type:z.literal("channel")}),date:z.number().int().positive().safe(),invite_link:z.object({invite_link:z.string().regex(/^https:\/\/t\.me\/\+[A-Za-z0-9_-]{1,200}$/u)})})}).parse(parseFinancialJson(raw));
      await authority();
      const accepted=await rpc("stars_commerce_join_v1",{user_id_value:String(event.chat_join_request.from.id),channel_id_value:String(event.chat_join_request.chat.id),invite_value:event.chat_join_request.invite_link.invite_link,source_hash_value:financialSha256(raw),occurred_at_value:new Date(event.chat_join_request.date*1000).toISOString()});
      return {state:accepted===true?"JOIN_REQUEST_RECORDED":"JOIN_HELD",membership_confirmed:false};
    },
    async reconcileInvoice(invoiceId: string, key: string) {
      const i = await intent(invoiceId);
      const rows = z.array(z.strictObject({ provider_evidence: z.object({ kind: z.enum(["PAYMENT", "REFUND"]), update_id: z.string(), charge_id: z.string(), query_id: z.null(), source_time: z.string(), raw_hash: hash }).strict() })).max(25).parse(await rpc("stars_commerce_pending_v1", { target_invoice_id: i.invoice_id }));
      await getMe(i,key+":identity");
      const outcomes: unknown[] = [];
      for (const row of rows) outcomes.push(await reconcile(i, row.provider_evidence, key + ":" + row.provider_evidence.update_id));
      return outcomes;
    },
    // Refund initiation remains an authenticated support action. A provider ACK is
    // only a request acknowledgement; callback+independent ledger must confirm it.
    async requestRefund(invoiceId: string, chargeId: string, key: string) {
      const i = await intent(invoiceId);
      const pending = await rpc("stars_commerce_original_charge_v1", { target_invoice_id: i.invoice_id });
      if (z.string().parse(pending) !== chargeId) throw Error("STARS_COMMERCE_ORIGINAL_RECEIPT_REQUIRED");
      await request(i, "refundStarPayment", { user_id: Number(i.payer_user_id), telegram_payment_charge_id: chargeId }, key, raw => z.object({ ok: z.literal(true), result: z.literal(true) }).parse(JSON.parse(raw)));
      return { state: "REFUND_REQUEST_ACKNOWLEDGED", refund_confirmed: false };
    },
  };
}

/** Existing authenticated cron may select the one protected merchant tenant.
 * This marker grants no financial authority. Recovery is independent provider
 * READING, never a second checkout/refund or an uncertain-message resend. */
export async function runStarsCommerceMaintenance(transport: typeof fetch = fetch) {
  const tenant = z.uuid().safeParse(process.env.POLAT_STARS_MERCHANT_TENANT_ID);
  if (!tenant.success) return { state: "NOT_CONFIGURED" as const };
  const commerce = await createStarsCommerce({ tenantId: tenant.data },transport);
  const db = createSupabaseAdminClient();
  const r = await db.rpc("stars_commerce_recovery_targets_v1",{target_tenant_id:tenant.data});
  if(r.error)throw Error("STARS_COMMERCE_RECOVERY_UNAVAILABLE");
  const ids=z.array(z.uuid()).max(3).parse(r.data);
  let held=0;
  for(const invoice of ids)try{await commerce.reconcileInvoice(invoice,"reconcile:"+randomUUID());}catch{held++;}
  const {runGenuineEntitlementCycle}=await import("../entitlements/genuine-service");
  const access=await runGenuineEntitlementCycle(tenant.data,transport);
  return {state:"OBSERVED"as const,invoices:ids.length,held,access};
}
