import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { parseFinancialJson, parseTelegramPrivateText, type TelegramUpdate } from "@gold-revenue-os/domain";
import { z } from "zod";

export const privateBetaWebhookConfiguration = z.strictObject({
  tenantId: z.uuid(), programId: z.uuid(), releaseSha: z.string().regex(/^[a-f0-9]{40}$/u),
  webhookSecret: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/u), relaySecret: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/u),
});
export type PrivateBetaWebhookConfiguration = z.infer<typeof privateBetaWebhookConfiguration>;
export function privateBetaSecretMatches(actual: string | null, expected: string) {
  return actual !== null && timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest());
}

/** Authentication precedes parsing, participant lookup, credential access or paid work. */
export async function authenticatePrivateBetaUpdate(request: Request, rawConfig: unknown, now = Date.now()) {
  const config = privateBetaWebhookConfiguration.parse(rawConfig);
  if (!privateBetaSecretMatches(request.headers.get("x-telegram-bot-api-secret-token"), config.webhookSecret)) throw Error("PRIVATE_BETA_WEBHOOK_DENIED");
  const timestamp = request.headers.get("x-polat-uat-timestamp") ?? "";
  if (!/^[0-9]{10,12}$/u.test(timestamp) || !Number.isSafeInteger(now) || Math.abs(now - Number(timestamp) * 1000) > 300_000) throw Error("PRIVATE_BETA_WEBHOOK_DENIED");
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get("content-type") ?? "")) throw Error("PRIVATE_BETA_WEBHOOK_INVALID");
  const length = request.headers.get("content-length");
  if (length && (!/^\d{1,8}$/u.test(length) || Number(length) > 16384)) throw Error("PRIVATE_BETA_WEBHOOK_INVALID");
  const reader = request.body?.getReader(); if (!reader) throw Error("PRIVATE_BETA_WEBHOOK_INVALID");
  const chunks: Uint8Array[] = []; let bytes = 0; const deadline = performance.now() + 5000;
  try {
    let ended = false;
    for (let index = 0; index < 1024; index++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([reader.read(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error("PRIVATE_BETA_WEBHOOK_INVALID")), Math.max(1, deadline - performance.now())); })]).finally(() => clearTimeout(timer));
      if (next.done) { ended = true; break; }
      bytes += next.value.byteLength; if (bytes > 16384 || performance.now() > deadline) throw Error("PRIVATE_BETA_WEBHOOK_INVALID"); chunks.push(next.value);
    }
    if (!ended) throw Error("PRIVATE_BETA_WEBHOOK_INVALID");
  } catch { void reader.cancel().catch(() => undefined); throw Error("PRIVATE_BETA_WEBHOOK_INVALID"); }
  finally { reader.releaseLock(); }
  const joined = Buffer.concat(chunks, bytes);
  const expected = createHmac("sha256", config.relaySecret).update(JSON.stringify(["POLAT_UAT_RELAY1", timestamp, createHash("sha256").update(joined).digest("hex")])).digest("hex");
  if (!privateBetaSecretMatches(request.headers.get("x-polat-uat-signature"), expected)) throw Error("PRIVATE_BETA_WEBHOOK_DENIED");
  const raw = parseFinancialJson(joined) as TelegramUpdate;
  const envelope = parseTelegramPrivateText(raw);
  const sender = z.object({ message: z.object({ from: z.object({ is_bot: z.literal(false) }) }) }).parse(raw);
  if (sender.message.from.is_bot || envelope.providerUserId !== envelope.providerChatId || !/^[1-9][0-9]{0,15}$/u.test(envelope.providerUserId)) throw Error("PRIVATE_BETA_WEBHOOK_INVALID");
  return { config, envelope };
}
