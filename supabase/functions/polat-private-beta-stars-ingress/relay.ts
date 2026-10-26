/** Dedicated Telegram TEST payments only. The Admin remains behind existing SSO and auth. */
export type StarsTestRelayConfig = Readonly<{ webhookSecret: string; relaySecret: string; vercelBypass: string }>;
const TARGET = "https://gold-revenue-os-staging.vercel.app/api/webhooks/private-beta-stars";
const encoder = new TextEncoder();
const reply = (status: number, code: string) => Response.json({ ok: status === 200, status: code }, { status, headers: { "cache-control": "no-store" } });
async function hash(text: string) { return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))); }
async function equal(a: string | null, b: string) { if (!a) return false; const x = await hash(a), y = await hash(b); let difference = 0; for (let i = 0; i < x.length; i++) difference |= x[i]! ^ y[i]!; return difference === 0; }
export async function starsTestRelaySignature(raw: string, timestamp: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), digest = [...await hash(raw)].map(v => v.toString(16).padStart(2, "0")).join("");
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify(["POLAT_UAT_STARS_RELAY1", timestamp, digest]))))].map(v => v.toString(16).padStart(2, "0")).join("");
}
export async function handleStarsTestRelay(request: Request, config: StarsTestRelayConfig, network: typeof fetch, now = Date.now()) {
  if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(config.webhookSecret) || !/^[A-Za-z0-9_-]{32,256}$/u.test(config.relaySecret) || config.vercelBypass.length < 20 || !Number.isFinite(now)) return reply(503, "STARS_TEST_INGRESS_NOT_CONFIGURED");
  if (!await equal(request.headers.get("x-telegram-bot-api-secret-token"), config.webhookSecret)) return reply(401, "WEBHOOK_SECRET_INVALID");
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get("content-type") ?? "")) return reply(415, "JSON_REQUIRED");
  let raw: string;
  try {
    const reader = request.body?.getReader(); if (!reader) throw Error(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 16384) throw Error(); chunks.push(part.value); } }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const joined = new Uint8Array(size); let offset = 0; for (const part of chunks) { joined.set(part, offset); offset += part.length; } raw = new TextDecoder("utf-8", { fatal: true }).decode(joined);
  } catch { return reply(413, "STARS_TEST_BODY_INVALID"); }
  const timestamp = String(Math.floor(now / 1000));
  try {
    const response = await network(TARGET, { method: "POST", redirect: "error", signal: AbortSignal.timeout(8000), headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": config.webhookSecret,
      "x-polat-stars-uat-timestamp": timestamp, "x-polat-stars-uat-signature": await starsTestRelaySignature(raw, timestamp, config.relaySecret), "x-vercel-protection-bypass": config.vercelBypass }, body: raw });
    await response.body?.cancel(); return response.ok ? reply(200, "TEST_UPDATE_ACCEPTED") : reply(503, "STARS_TEST_UPSTREAM_UNAVAILABLE");
  } catch { return reply(503, "STARS_TEST_UPSTREAM_UNKNOWN"); }
}
