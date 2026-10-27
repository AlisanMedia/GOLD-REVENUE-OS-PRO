import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { privateBetaBusinessRightsSchema } from "@gold-revenue-os/contracts";
import { parsePolatClaudeJson } from "../../../../../packages/domain/src/polat-claude-json";

const numeric = z.string().regex(/^[1-9][0-9]{0,15}$/u).refine(value => Number.isSafeInteger(Number(value)));
export const privateBetaBusinessScopeSchema = z.strictObject({
  version: z.literal(2), mode: z.literal("BUSINESS"), program_id: z.uuid(), tenant_id: z.uuid(), bot_id: numeric,
  api_environment: z.literal("production"), credential_sha256: z.string().regex(/^[a-f0-9]{64}$/u), repository_sha: z.string().regex(/^[a-f0-9]{40}$/u),
  representative_user_id: numeric, business_connection_id: z.string().min(1).max(160), founder_chat_id: numeric,
  business_generation: z.string().regex(/^[1-9][0-9]{0,18}$/u), enabled: z.boolean(), can_reply: z.boolean(), observed_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
});
export type PrivateBetaBusinessScope = z.infer<typeof privateBetaBusinessScopeSchema>;
export type PrivateBetaBusinessSendPermit = Readonly<{ kind: "PRIVATE_BETA_BUSINESS_SEND_PERMIT" }>;
const permits = new WeakMap<object, { binding: string; monotonicDeadline: number }>();
function binding(scope: PrivateBetaBusinessScope) {
  return JSON.stringify([scope.tenant_id, scope.program_id, scope.bot_id, scope.repository_sha, scope.credential_sha256, scope.representative_user_id, scope.business_connection_id, scope.founder_chat_id, scope.business_generation, scope.expires_at]);
}
function unavailable(): never { throw Error("PRIVATE_BETA_BUSINESS_PERMISSION_UNVERIFIED"); }

/**
 * The application calls this only after server-owned sealed bot/tenant/SHA custody.
 * Callback flags, a JSON document or a bearer model key cannot create this permit.
 * No response body, user object or token-bearing URL is reflected into errors/logs.
 */
export async function verifyPrivateBetaBusinessSend(rawScope: unknown, credential: string, network: typeof fetch = fetch, clock = { wall: Date.now, monotonic: () => performance.now() }): Promise<PrivateBetaBusinessSendPermit> {
  const scope = privateBetaBusinessScopeSchema.parse(rawScope), started = clock.monotonic(), at = clock.wall();
  if (!Number.isFinite(at) || !Number.isFinite(started) || !scope.enabled || !scope.can_reply || Date.parse(scope.observed_at) > at || Date.parse(scope.expires_at) <= at
    || !/^[1-9][0-9]{4,18}:[A-Za-z0-9_-]{20,128}$/u.test(credential) || credential.split(":")[0] !== scope.bot_id || createHash("sha256").update(credential, "utf8").digest("hex") !== scope.credential_sha256) unavailable();
  const controller = new AbortController();
  let rejectDeadline: ((reason: Error) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  const timeout = setTimeout(() => { controller.abort(); rejectDeadline?.(Error("PRIVATE_BETA_BUSINESS_PERMISSION_UNVERIFIED")); }, 10000);
  try {
    const response = await Promise.race([network(`https://api.telegram.org/bot${credential}/getBusinessConnection`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ business_connection_id: scope.business_connection_id }),
      cache: "no-store", redirect: "error", signal: controller.signal,
    }), deadline]);
    if (!response.ok || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) { await response.body?.cancel(); unavailable(); }
    const reader = response.body?.getReader(); if (!reader) unavailable();
    const chunks: Uint8Array[] = []; let size = 0, complete = false;
    try {
      for (let reads = 0; reads < 1024; reads++) {
        const value = await Promise.race([reader.read(), deadline]);
        if (value.done) { complete = true; break; }
        size += value.value.byteLength;
        if (size > 16384 || clock.monotonic() - started >= 10000) { await reader.cancel(); unavailable(); }
        chunks.push(value.value);
      }
    } catch { void reader.cancel().catch(() => undefined); unavailable(); }
    finally { reader.releaseLock(); }
    if (!complete || clock.monotonic() - started >= 10000 || Date.parse(scope.expires_at) <= clock.wall()) unavailable();
    const raw = parsePolatClaudeJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)), 16384);
    // Official optional user/rights metadata is projected, never authoritative instructions.
    const proof = z.object({ ok: z.literal(true), result: z.object({ id: z.string(), user: z.object({ id: z.number().int().positive().safe(), is_bot: z.literal(false) }), is_enabled: z.literal(true), rights: privateBetaBusinessRightsSchema }) }).parse(raw);
    if (proof.result.id !== scope.business_connection_id || String(proof.result.user.id) !== scope.representative_user_id) unavailable();
    const permit = Object.freeze({ kind: "PRIVATE_BETA_BUSINESS_SEND_PERMIT" as const });
    permits.set(permit, { binding: binding(scope), monotonicDeadline: clock.monotonic() + 10000 });
    return permit;
  } catch { unavailable(); }
  finally { clearTimeout(timeout); }
}

/** Consume once after the atomic DB claim; a different generation/connection cannot reuse it. */
export function consumePrivateBetaBusinessSendPermit(permit: unknown, rawScope: unknown, claimed: { business_connection_id: string; business_generation: string; chat_id: string }, monotonic = () => performance.now(), wall = Date.now) {
  const scope = privateBetaBusinessScopeSchema.parse(rawScope);
  const proof = permit && typeof permit === "object" ? permits.get(permit) : undefined;
  if (permit && typeof permit === "object") permits.delete(permit);
  if (!proof || !scope.enabled || !scope.can_reply || Date.parse(scope.expires_at) <= wall() || proof.binding !== binding(scope) || !Number.isFinite(monotonic()) || monotonic() >= proof.monotonicDeadline || claimed.business_connection_id !== scope.business_connection_id || claimed.business_generation !== scope.business_generation || claimed.chat_id !== scope.founder_chat_id) unavailable();
}

export function privateBetaBusinessUpdateId(connectionId: string, updateId: string) {
  if (!connectionId || connectionId.length > 160 || !/^[0-9]{1,18}$/u.test(updateId)) throw Error("PRIVATE_BETA_BUSINESS_UPDATE_INVALID");
  return `business:${createHash("sha256").update(connectionId, "utf8").digest("hex")}:${updateId}`;
}
