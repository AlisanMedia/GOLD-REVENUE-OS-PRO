import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { accessJobSchema, AuthorizedTelegramAccessAdapter } from "./adapter";

/** Existing Phase11 jobs/audit and dormant adapter; no general cron registration,
 * fixture authority or automatic retry. Real provider eligibility stays DB-owned. */
export async function runGenuineEntitlementCycle(tenantId: string, transport: typeof fetch = fetch) {
  const tenant = z.uuid().parse(tenantId), db = createSupabaseAdminClient();
  const rpc = async (name: string, args: Record<string, unknown> = {}) => { const r = await db.rpc(name, { target_tenant_id: tenant, ...args }); if (r.error) throw Error("GENUINE_ENTITLEMENT_STORE_UNAVAILABLE"); return r.data as unknown; };
  const control = z.object({ tenant_id: z.literal(tenant), repository_sha: z.string(), environment: z.literal("TELEGRAM_PRODUCTION"), financial_authority: z.literal("VERIFIED_STARS_RECEIPT"),
    bot_user_id: z.string(), credential_sha256: z.string(), channel_id: z.string(), approval_reference: z.string().min(1) }).parse(await rpc("stars_commerce_scope_v1"));
  if (control.repository_sha !== process.env.VERCEL_GIT_COMMIT_SHA) throw Error("GENUINE_ACCESS_RELEASE_DRIFT");
  const token = process.env.POLAT_STARS_MERCHANT_BOT_TOKEN;
  if (!token || token.split(":")[0] !== control.bot_user_id || createHash("sha256").update(token).digest("hex") !== control.credential_sha256) throw Error("GENUINE_ACCESS_CUSTODY_REQUIRED");
  await rpc("entitlement_tick");
  const raw = await rpc("entitlement_claim_job"); if (raw === null) return { processed: false };
  const job = accessJobSchema.parse(raw);
  if (job.tenant_id !== tenant || job.mode !== "live" || job.chat_id !== control.channel_id) throw Error("GENUINE_ACCESS_SCOPE_DENIED");
  const nonce = randomUUID();
  if (await rpc("entitlement_begin_genuine_v1", { target_job_id: job.id, lease_value: job.lease_token, nonce_value: nonce }) !== true) return { processed: false };
  const adapter = new AuthorizedTelegramAccessAdapter({ enabled: true, botToken: token, botUserId: control.bot_user_id, channelId: control.channel_id, userId: job.telegram_user_id, ownerApproval: control.approval_reference }, async (url, init) => {
    // Re-read the private control before EACH external action, not just at lease claim.
    const fresh = z.object({ repository_sha: z.literal(control.repository_sha), credential_sha256: z.literal(control.credential_sha256), channel_id: z.literal(control.channel_id), approval_reference: z.literal(control.approval_reference) }).parse(await rpc("stars_commerce_scope_v1"));
    if (!fresh) throw Error("GENUINE_ACCESS_CONTROL_CHANGED");return transport(url, init);
  });
  let result;
  try { result = await adapter.execute(job); } catch { result = { ok: false }; }
  const complete = await rpc("entitlement_complete_job", { target_job_id: job.id, lease_value: job.lease_token, result_value: { ...result, dispatch_nonce: nonce } });
  return { processed: true, confirmed: result.ok && complete === true, unknown: !result.ok };
}
