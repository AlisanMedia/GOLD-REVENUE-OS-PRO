import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getUserContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";

const factorSet = z.array(z.object({ id: z.uuid(), factor_type: z.string(), status: z.enum(["verified", "unverified"]) })).max(10);
const actorSchema = z.object({
  userId: z.uuid(), tenantId: z.uuid(), role: z.string(), sessionUserId: z.uuid(), aal: z.string(),
  methods: z.array(z.unknown()).max(20),
});
type Actor = z.infer<typeof actorSchema>;
type AuditStage = "requested" | "completed" | "blocked" | "unknown";
export type MfaRecoveryDependencies = {
  actor: () => Promise<unknown>;
  factors: () => Promise<unknown>;
  /** Uses the SAME captured user AAL1 token; never an Auth admin/service token. */
  unenroll: (factorId: string) => Promise<"ACKNOWLEDGED" | "REJECTED" | "UNKNOWN">;
  audit: (stage: AuditStage, actor: Actor, factorHash: string, requestId: string) => Promise<void>;
  now?: () => number;
};
type RecoveryResult = { status: 200; data: { recovered: true } } | { status: 401 | 403 | 409 | 503; error: "AUTH_REQUIRED" | "RECOVERY_REAUTH_REQUIRED" | "RECOVERY_BLOCKED" | "RECOVERY_NOT_CONFIRMED" | "UNAVAILABLE" };

/** Owner-initiated UNVERIFIED-only recovery, not a verified-factor reset or an
 * MFA grant. Auth owns the factor mutation; existing append-only audit records
 * the intent BEFORE dispatch and the independently read outcome afterwards. */
export async function recoverUnfinishedMfa(input: { factorId: string; confirmed: boolean }, deps: MfaRecoveryDependencies): Promise<RecoveryResult> {
  if (!z.uuid().safeParse(input.factorId).success || input.confirmed !== true) return { status: 409, error: "RECOVERY_BLOCKED" };
  let actor: Actor | null = null, intentRecorded = false, started = false;
  const requestId = randomUUID(), factorHash = createHash("sha256").update(input.factorId).digest("hex");
  try {
    const raw = await deps.actor(); if (raw === null) return { status: 401, error: "AUTH_REQUIRED" };
    actor = actorSchema.parse(raw);
    if (actor.role !== "super_admin" || actor.userId !== actor.sessionUserId) return { status: 403, error: "RECOVERY_BLOCKED" };
    const now = (deps.now ?? Date.now)();
    const freshPassword = actor.methods.some(raw => {
      const method = z.object({ method: z.literal("password"), timestamp: z.number().int().nonnegative().safe() }).safeParse(raw);
      return method.success && method.data.timestamp * 1000 <= now && now - method.data.timestamp * 1000 <= 300000;
    });
    if (!Number.isFinite(now) || actor.aal !== "aal1" || !freshPassword) return { status: 409, error: "RECOVERY_REAUTH_REQUIRED" };
    const all = factorSet.parse(await deps.factors()), pending = all.filter(f => f.factor_type === "totp" && f.status === "unverified");
    if (all.some(f => f.status === "verified") || pending.length !== 1 || pending[0]!.id !== input.factorId) return { status: 409, error: "RECOVERY_BLOCKED" };
    await deps.audit("requested", actor, factorHash, requestId); intentRecorded = true;
    started = true;
    const outcome = await deps.unenroll(input.factorId);
    if (outcome !== "ACKNOWLEDGED") {
      await deps.audit(outcome === "REJECTED" ? "blocked" : "unknown", actor, factorHash, requestId);
      return { status: 409, error: outcome === "REJECTED" ? "RECOVERY_BLOCKED" : "RECOVERY_NOT_CONFIRMED" };
    }
    const checked = factorSet.parse(await deps.factors());
    if (checked.some(f => f.id === input.factorId || f.status === "verified")) {
      await deps.audit("unknown", actor, factorHash, requestId);
      return { status: 409, error: "RECOVERY_NOT_CONFIRMED" };
    }
    await deps.audit("completed", actor, factorHash, requestId);
    return { status: 200, data: { recovered: true } };
  } catch {
    if (actor && intentRecorded && started) await deps.audit("unknown", actor, factorHash, requestId).catch(() => undefined);
    return { status: started ? 409 : 503, error: started ? "RECOVERY_NOT_CONFIRMED" : "UNAVAILABLE" };
  }
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw Error("ABORTED");
  let aborted: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => { aborted = () => reject(Error("ABORTED")); signal.addEventListener("abort", aborted, { once: true }); });
  try { return await Promise.race([promise, stopped]); } finally { if (aborted) signal.removeEventListener("abort", aborted); }
}

/** Fixed documented Auth DELETE. A captured AAL1 token retains Supabase's
 * verified-factor protection even if another browser tab steps up meanwhile. */
export async function unenrollMfaWithUserSession(input: { supabaseUrl: string; publishableKey: string; accessToken: string; factorId: string }, network: typeof fetch = fetch): Promise<"ACKNOWLEDGED" | "REJECTED" | "UNKNOWN"> {
  if (!z.uuid().safeParse(input.factorId).success) return "REJECTED";
  const url = new URL(`/auth/v1/factors/${input.factorId}`, input.supabaseUrl).href;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await abortable(network(url, { method: "DELETE", headers: { apikey: input.publishableKey, authorization: "Bearer " + input.accessToken, accept: "application/json" }, redirect: "error", cache: "no-store", signal: controller.signal }), controller.signal);
    if (response.redirected || response.url !== url) return "UNKNOWN";
    if (response.status >= 400 && response.status < 500 && response.status !== 408) { void response.body?.cancel().catch(() => undefined); return "REJECTED"; }
    if (response.status !== 200 || !response.body || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) return "UNKNOWN";
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0, ended = false;
    try {
      for (let i = 0; i < 256; i++) { const p = await abortable(reader.read(), controller.signal); if (p.done) { ended = true; break; } bytes += p.value.byteLength; if (bytes > 4096) throw Error("BOUND"); chunks.push(p.value); }
    } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    if (!ended) return "UNKNOWN";
    const frame: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes)));
    return z.strictObject({ id: z.literal(input.factorId) }).safeParse(frame).success ? "ACKNOWLEDGED" : "UNKNOWN";
  } catch { return "UNKNOWN"; }
  finally { clearTimeout(timer); controller.abort(); }
}

export async function recoverOwnUnfinishedMfa(input: { factorId: string; confirmed: boolean }): Promise<RecoveryResult> {
  const context = await getUserContext(), selected = context?.tenants[0];
  if (!context) return { status: 401, error: "AUTH_REQUIRED" };
  if (!selected || selected.role !== "super_admin") return { status: 403, error: "RECOVERY_BLOCKED" };
  const db = await createSupabaseServerClient();
  let userId = "", accessToken = "";
  return recoverUnfinishedMfa(input, {
    actor: async () => {
      const session = await db.auth.getSession(); accessToken = session.data.session?.access_token ?? "";
      if (session.error || !accessToken) throw Error("DENIED");
      const verified = await db.auth.getUser(accessToken), claims = await db.auth.getClaims(accessToken);
      if (verified.error || claims.error || verified.data.user?.id !== context.user.id || claims.data?.claims.sub !== context.user.id) throw Error("DENIED");
      userId = context.user.id;
      return { userId, tenantId: selected.id, role: selected.role, sessionUserId: verified.data.user.id,
        aal: claims.data.claims.aal, methods: claims.data.claims.amr ?? [] };
    },
    factors: async () => {
      const result = await db.auth.getUser(accessToken);
      if (result.error || result.data.user?.id !== userId) throw Error("DENIED");
      return result.data.user.factors ?? [];
    },
    unenroll: factorId => {
      const env = publicEnv();
      return unenrollMfaWithUserSession({ supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, accessToken, factorId });
    },
    audit: async (stage, actor, factorHash, requestId) => {
      const result = await createSupabaseAdminClient().from("audit_logs").insert({ tenant_id: actor.tenantId, actor_type: "HUMAN", actor_id: actor.userId,
        action: "auth.mfa_enrollment_recovery_" + stage, entity_type: "auth_mfa_factor", entity_id: factorHash, request_id: requestId,
        before_data: { scope: "OWN_UNVERIFIED_TOTP_ONLY", authentication: "RECENT_PROVIDER_VERIFIED_PASSWORD_AAL1" }, after_data: { stage } }).select("id").single();
      if (result.error || !result.data?.id) throw Error("AUDIT_UNAVAILABLE");
    },
  });
}
