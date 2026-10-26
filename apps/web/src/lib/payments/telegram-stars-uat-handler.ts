import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTelegramStarsUatFromDatabase } from "./telegram-stars-uat-store";
import { parseTelegramStarsTestJson, telegramStarsUatInvoiceSchema } from "../../../../../packages/domain/src/telegram-stars-uat";

type Connection = Awaited<ReturnType<typeof createTelegramStarsUatFromDatabase>>;
type Config = { tenantId: string; programId: string; webhookSecret: string; relaySecret: string };
type Dependencies = {
  config: Config; now?: () => number;
  connect: (requestKey: string) => Promise<Connection>;
  invoice: (id: string, payer: string) => Promise<unknown>;
  claim: (updateId: string, hash: string, nonce: string) => Promise<unknown>;
  complete: (ingressId: string, nonce: string, state: "COMPLETE" | "REVIEW", reason: string) => Promise<unknown>;
};
const reply = (status: number, code: string) => Response.json({ ok: status === 200, status: code }, { status, headers: { "cache-control": "no-store" } });
const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
export const starsUatRelaySignature = (raw: string, timestamp: string, secret: string) => createHmac("sha256", secret).update(JSON.stringify(["POLAT_UAT_STARS_RELAY1", timestamp, createHash("sha256").update(raw, "utf8").digest("hex")])).digest("hex");

/** Separate authenticated TEST route. No invoice creation, ordinary messaging, model dispatch or genuine payment authority. */
export async function processTelegramStarsUatWebhook(request: Request, deps: Dependencies): Promise<Response> {
  const now = deps.now ?? Date.now, c = deps.config;
  if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
  if (!z.uuid().safeParse(c.tenantId).success || !z.uuid().safeParse(c.programId).success || !/^[A-Za-z0-9_-]{32,256}$/u.test(c.webhookSecret) || !/^[A-Za-z0-9_-]{32,256}$/u.test(c.relaySecret)) return reply(503, "STARS_TEST_NOT_CONFIGURED");
  const secret = request.headers.get("x-telegram-bot-api-secret-token"), timestamp = request.headers.get("x-polat-stars-uat-timestamp"), signature = request.headers.get("x-polat-stars-uat-signature");
  if (!secret || !timingSafeEqual(digest(secret), digest(c.webhookSecret)) || !timestamp || !/^[0-9]{10}$/u.test(timestamp) || !signature || !/^[a-f0-9]{64}$/u.test(signature)
    || !Number.isFinite(now()) || Math.abs(now() - Number(timestamp) * 1000) > 300000) return reply(401, "STARS_TEST_AUTHENTICATION_REQUIRED");
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get("content-type") ?? "")) return reply(415, "JSON_REQUIRED");
  let raw: string;
  try {
    const reader = request.body?.getReader(); if (!reader) throw Error(); const chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 16384) throw Error(); chunks.push(part.value); } }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch { return reply(413, "STARS_TEST_BODY_INVALID_OR_OVERSIZED"); }
  if (!timingSafeEqual(digest(signature), digest(starsUatRelaySignature(raw, timestamp, c.relaySecret)))) return reply(401, "STARS_TEST_RELAY_SIGNATURE_INVALID");
  let updateId: string, invoiceId: string | null = null, payer: string | null = null, kind: "PRE_CHECKOUT" | "PAYMENT" | "REFUND" | "JOIN";
  try {
    const v = z.object({ update_id: z.number().int().nonnegative().safe(), pre_checkout_query: z.unknown().optional(), message: z.object({ from: z.object({ id: z.number().int().positive().safe() }).optional(), successful_payment: z.unknown().optional(), refunded_payment: z.unknown().optional() }).optional(), chat_join_request: z.unknown().optional() }).parse(parseTelegramStarsTestJson(raw));
    updateId = String(v.update_id);
    const count = Number(v.pre_checkout_query !== undefined) + Number(v.message?.successful_payment !== undefined) + Number(v.message?.refunded_payment !== undefined) + Number(v.chat_join_request !== undefined);
    if (count === 0) return reply(200, "IGNORED_NO_TEST_PAYMENT_ACTION"); if (count !== 1) throw Error();
    if (v.chat_join_request !== undefined) kind = "JOIN";
    else {
      kind = v.pre_checkout_query !== undefined ? "PRE_CHECKOUT" : v.message?.successful_payment !== undefined ? "PAYMENT" : "REFUND";
      const p = z.object({ invoice_payload: z.string().regex(/^uat-stars:[a-f0-9-]{36}$/u), from: z.object({ id: z.number().int().positive().safe() }).optional() }).parse(v.pre_checkout_query ?? v.message?.successful_payment ?? v.message?.refunded_payment);
      invoiceId = z.uuid().parse(p.invoice_payload.slice("uat-stars:".length)); payer = String(p.from?.id ?? v.message?.from?.id ?? ""); if (!/^[1-9][0-9]{0,15}$/u.test(payer)) throw Error();
    }
  } catch { return reply(400, "STARS_TEST_UPDATE_INVALID"); }
  const nonce = randomUUID(); let ingressId: string | null = null;
  try {
    const claim = z.strictObject({ dispatch: z.boolean(), state: z.enum(["PENDING", "COMPLETE", "REVIEW"]), ingress_id: z.uuid() }).parse(await deps.claim(updateId, createHash("sha256").update(raw, "utf8").digest("hex"), nonce));
    if (!claim.dispatch) return reply(200, claim.state === "COMPLETE" ? "DUPLICATE_ALREADY_PROCESSED" : "DUPLICATE_REVIEW_REQUIRED"); ingressId = claim.ingress_id;
    const connection = await deps.connect("ingress:" + updateId);
    if (connection.state !== "CONNECTED_TO_DEDICATED_TEST") throw Error();
    if (kind === "JOIN") {
      const queued = await connection.receiveTestJoinRequest(raw, secret); if (queued.state !== "ACKNOWLEDGED") throw Error();
      const access = await connection.processNextTestAccess("join:" + updateId); if (access.state !== "ACKNOWLEDGED") throw Error();
    } else {
      const invoice = telegramStarsUatInvoiceSchema.parse(await deps.invoice(invoiceId!, payer!));
      if (invoice.tenant_id !== c.tenantId || invoice.program_id !== c.programId || invoice.invoice_id !== invoiceId || invoice.payer_user_id !== payer) throw Error();
      const event = connection.authenticateWebhook(raw, secret, invoice);
      if (kind === "PRE_CHECKOUT") { if ((await connection.answerPreCheckout(invoice, event, "precheckout:" + updateId)).state !== "ACKNOWLEDGED") throw Error(); }
      else {
        const ledger = await connection.readLedger(0, 25, "ledger:" + updateId); if (ledger.state !== "ACKNOWLEDGED") throw Error();
        const result = await connection.recordTestEvidence(invoice, event, ledger.value); if (result.state !== "ACKNOWLEDGED") throw Error();
        if (kind === "PAYMENT") await connection.prepareTestAccess(invoice.invoice_id);
        const access = await connection.processNextTestAccess("access:" + updateId); if (access.state !== "ACKNOWLEDGED") throw Error();
      }
    }
    z.object({ recorded: z.literal(true) }).parse(await deps.complete(ingressId, nonce, "COMPLETE", "PROCESSED"));
    return reply(200, "TEST_UPDATE_PROCESSED");
  } catch {
    if (ingressId) { try { await deps.complete(ingressId, nonce, "REVIEW", "OPERATOR_REVIEW_REQUIRED"); } catch { /* Durable pending ownership remains. No provider replay. */ } }
    return reply(200, ingressId ? "TEST_UPDATE_REVIEW_REQUIRED" : "TEST_UPDATE_BLOCKED");
  }
}

export async function handleTelegramStarsUatWebhook(request: Request): Promise<Response> {
  const tenantId = process.env.POLAT_UAT_TENANT_ID ?? "", programId = process.env.POLAT_UAT_PROGRAM_ID ?? "";
  const config = { tenantId, programId, webhookSecret: process.env.POLAT_UAT_STARS_TEST_WEBHOOK_SECRET ?? "", relaySecret: process.env.POLAT_UAT_STARS_RELAY_SECRET ?? "" };
  const rpc = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const r = await createSupabaseAdminClient().rpc(name, { target_tenant_id: tenantId, program_id_value: programId, ...args });
    if (r.error) throw Error("STARS_TEST_STORE_UNAVAILABLE"); return r.data as unknown;
  };
  return processTelegramStarsUatWebhook(request, { config,
    connect: connectionRequestKey => createTelegramStarsUatFromDatabase({ tenantId, programId, connectionRequestKey }),
    invoice: (id, payer) => rpc("private_beta_stars_invoice_read_v1", { target_invoice_id: id, payer_user_id_value: payer }),
    claim: (updateId, hash, nonce) => rpc("private_beta_stars_ingress_claim_v1", { update_id_value: updateId, raw_hash_value: hash, nonce_value: nonce }),
    complete: (id, nonce, state, reason) => rpc("private_beta_stars_ingress_complete_v1", { ingress_id_value: id, nonce_value: nonce, state_value: state, reason_value: reason }),
  });
}
