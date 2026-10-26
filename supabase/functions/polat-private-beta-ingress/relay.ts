/** Narrow Telegram relay: the Admin remains behind SSO and application authentication. */
export type PrivateBetaRelayConfig = Readonly<{ webhookSecret: string; relaySecret: string; vercelBypass: string }>;
const TARGET = "https://gold-revenue-os-staging.vercel.app/api/webhooks/private-beta/telegram";
const MAX_BYTES = 65536;
const encoder = new TextEncoder();
const reply = (status: number, error?: string) => Response.json(error ? { ok: false, error } : { ok: true }, { status, headers: { "cache-control": "no-store" } });
async function digest(text: string) { return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))); }
async function same(a: string | null, b: string) {
  if (!a) return false;
  const x = await digest(a), y = await digest(b); let different = 0;
  for (let i = 0; i < x.length; i++) different |= x[i]! ^ y[i]!;
  return different === 0;
}
export async function privateBetaRelaySignature(body: string, timestamp: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hash = [...await digest(body)].map(v => v.toString(16).padStart(2, "0")).join("");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify(["POLAT_UAT_RELAY1", timestamp, hash])));
  return [...new Uint8Array(signature)].map(v => v.toString(16).padStart(2, "0")).join("");
}
export async function handlePrivateBetaRelay(request: Request, config: PrivateBetaRelayConfig, network: typeof fetch, now = Date.now()) {
  if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(config.webhookSecret) || !/^[A-Za-z0-9_-]{32,256}$/u.test(config.relaySecret) || config.vercelBypass.length < 20 || !Number.isFinite(now)) return reply(503, "UAT_INGRESS_NOT_CONFIGURED");
  if (!await same(request.headers.get("x-telegram-bot-api-secret-token"), config.webhookSecret)) return reply(401, "WEBHOOK_SECRET_INVALID");
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get("content-type") ?? "")) return reply(415, "JSON_REQUIRED");
  const length = request.headers.get("content-length");
  if (length && (!/^\d{1,8}$/u.test(length) || Number(length) > MAX_BYTES)) return reply(413, "PAYLOAD_TOO_LARGE");
  let body: string;
  try {
    const reader = request.body?.getReader(); if (!reader) return reply(400, "BODY_REQUIRED");
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > MAX_BYTES) { await reader.cancel(); return reply(413, "PAYLOAD_TOO_LARGE"); } chunks.push(value); }
    const joined = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    body = new TextDecoder("utf-8", { fatal: true }).decode(joined);
  } catch { return reply(400, "BODY_INVALID"); }
  const timestamp = String(Math.floor(now / 1000));
  try {
    const response = await network(TARGET, { method: "POST", redirect: "error", signal: AbortSignal.timeout(8000), headers: {
      "content-type": "application/json", "x-telegram-bot-api-secret-token": config.webhookSecret,
      "x-polat-uat-timestamp": timestamp, "x-polat-uat-signature": await privateBetaRelaySignature(body, timestamp, config.relaySecret),
      "x-vercel-protection-bypass": config.vercelBypass,
    }, body });
    // Do not reflect upstream bodies, cookies, staff identity, provider details or secret-bearing URLs.
    await response.body?.cancel();
    return response.ok ? reply(200) : reply(503, "UAT_UPSTREAM_UNAVAILABLE");
  } catch { return reply(503, "UAT_UPSTREAM_UNKNOWN"); }
}
