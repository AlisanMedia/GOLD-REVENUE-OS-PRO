import "server-only";
import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { createStarsCommerce } from "./telegram-stars-commerce";
import { runGenuineEntitlementCycle } from "../entitlements/genuine-service";

/** Fixed existing merchant route. Tenant/credential/control are server-owned;
 * an environment selector cannot activate the private financial authority. */
export async function handleStarsCommerceWebhook(request: Request) {
  const respond = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  const tenant = z.uuid().safeParse(process.env.POLAT_STARS_MERCHANT_TENANT_ID), secret = process.env.POLAT_STARS_MERCHANT_WEBHOOK_SECRET;
  const relay=process.env.POLAT_STARS_MERCHANT_RELAY_SECRET,release=process.env.VERCEL_GIT_COMMIT_SHA;
  if (!tenant.success || !secret || secret.length < 32 || !relay || relay.length<32 || !/^[a-f0-9]{40}$/u.test(release??"")) return respond(503, { error: "LIVE_PAYMENTS_NOT_ACTIVATED" });
  const header = request.headers.get("x-telegram-bot-api-secret-token"), sha = (v: string) => createHash("sha256").update(v).digest();
  if (!header || !timingSafeEqual(sha(header), sha(secret))) return respond(401, { error: "STARS_WEBHOOK_AUTH_REQUIRED" });
  if (process.env.NODE_ENV === "production" && new URL(request.url).protocol !== "https:") return respond(400, { error: "HTTPS_REQUIRED" });
  const reader = request.body?.getReader(); if (!reader) return respond(400, { error: "BODY_REQUIRED" });
  let raw: string;
  try {
    let size = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const p = await reader.read(); if (p.done) break; size += p.value.length; if (size > 16384) throw Error("bound"); chunks.push(p.value); } }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch { return respond(400, { error: "STARS_BODY_INVALID" }); }
  const timestamp=request.headers.get("x-polat-uat-timestamp")??"",signature=request.headers.get("x-polat-uat-signature")??"";
  if(!/^[0-9]{10}$/u.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>60)return respond(401,{error:"STARS_RELAY_AUTH_REQUIRED"});
  const expected=createHmac("sha256",relay).update(JSON.stringify(["POLAT_STARS_MERCHANT_RELAY1",tenant.data,release,timestamp,sha(raw).toString("hex")])).digest("hex");
  if(!/^[a-f0-9]{64}$/u.test(signature)||!timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(expected,"hex")))return respond(401,{error:"STARS_RELAY_AUTH_REQUIRED"});
  try {
    const frame = JSON.parse(raw) as Record<string,unknown>;
    const accessText=z.object({message:z.object({text:z.string()})}).safeParse(frame);
    if(accessText.success&&!(["/vip","/access"].includes(accessText.data.message.text)))return respond(200,{ok:true,state:"IGNORED",customer_read:"UNKNOWN"});
    const commerce = await createStarsCommerce({ tenantId: tenant.data });
    const outcome = accessText.success ? await commerce.acceptAccessRequest(raw,header) : "chat_join_request" in frame ? await commerce.acceptJoinWebhook(raw,header) : await commerce.acceptWebhook(raw, header, "webhook:" + randomUUID());
    const state = z.object({ state: z.string() }).parse(outcome).state;
    // Receipt completion is independent of a failed/unknown membership action.
    if (["CONFIRMED", "REFUNDED", "JOIN_REQUEST_RECORDED"].includes(state)) await runGenuineEntitlementCycle(tenant.data).catch(() => undefined);
    return respond(200, { ok: true, state, customer_read: "UNKNOWN" });
  } catch { return respond(503, { error: "STARS_PROCESSING_HELD", payment_success_assumed: false }); }
}
