import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { parseTelegramPrivateText, type TelegramUpdate } from "@gold-revenue-os/domain";
import { z } from "zod";
import { parsePolatClaudeJson } from "../../../../../packages/domain/src/polat-claude-json";

export const privateBetaWebhookConfiguration = z.strictObject({
  tenantId: z.uuid(), programId: z.uuid(), releaseSha: z.string().regex(/^[a-f0-9]{40}$/u),
  webhookSecret: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/u), relaySecret: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/u),
});
export type PrivateBetaWebhookConfiguration = z.infer<typeof privateBetaWebhookConfiguration>;
export function privateBetaSecretMatches(actual: string | null, expected: string) {
  return actual !== null && timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest());
}

/** Authentication precedes parsing, participant lookup, credential access or paid work. */
async function authenticatePrivateBetaBody(request: Request, rawConfig: unknown, now: number, mode: "PRIVATE_BETA" | "FOUNDER_CAMPAIGN") {
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
  const digest = createHash("sha256").update(joined).digest("hex");
  const relayBinding = mode === "PRIVATE_BETA" ? ["POLAT_UAT_RELAY1", timestamp, digest] : ["POLAT_CAMPAIGN_RELAY1", config.tenantId, config.programId, config.releaseSha, timestamp, digest];
  const expected = createHmac("sha256", config.relaySecret).update(JSON.stringify(relayBinding)).digest("hex");
  if (!privateBetaSecretMatches(request.headers.get("x-polat-uat-signature"), expected)) throw Error("PRIVATE_BETA_WEBHOOK_DENIED");
  // Reuse the strict nonfinancial metadata parser: Telegram locations may have
  // decimal coordinates. These values never become financial or model facts.
  const raw = parsePolatClaudeJson(new TextDecoder("utf-8", { fatal: true }).decode(joined), 16384);
  return { config, raw, sourceHash: createHash("sha256").update(joined).digest("hex") };
}

const numeric = z.number().int().positive().safe();
const connectionId = z.string().min(1).max(160);
export type PrivateBetaBusinessUpdate = {
  kind: "MESSAGE" | "EDIT" | "DELETE" | "CONNECTION";
  updateId: string; connectionId: string; sourceHash: string; occurredAt: string;
  providerUserId: string | null; providerChatId: string | null; providerMessageIds: string[];
  envelope: ReturnType<typeof parseTelegramPrivateText> | null; unsupported: boolean; botEcho: boolean;
  restrictionObserved: boolean;
};

function privateBetaText(message: Record<string, unknown>, sourceHash: string) {
  const parsed = z.object({ text: z.string().optional(), caption: z.string().max(4096).optional() }).parse(message);
  const unsupported = parsed.text === undefined;
  const kind = ["photo", "voice", "audio", "video", "document", "sticker", "animation", "video_note", "location", "contact"].find(key => key in message) ?? "non_text";
  const caption = parsed.caption?.replace(/\/start\s+[a-f0-9]{48}/gu, "/start [invitation redacted]");
  return { unsupported, message: unsupported ? { ...message, text: `/unsupported ${kind}\n[Text-only beta: attachment content was not fetched or interpreted; source SHA256 ${sourceHash}]${caption ? "\nOriginal caption: " + caption.slice(0,3000) : ""}` } : message };
}

/** The relay authenticates transport only. A BUSINESS callback never creates account authority. */
async function authenticateScopedTelegramIngress(request: Request, rawConfig: unknown, now: number, mode: "PRIVATE_BETA" | "FOUNDER_CAMPAIGN") {
  const { config, raw, sourceHash } = await authenticatePrivateBetaBody(request, rawConfig, now, mode);
  const root = z.object({ update_id: z.number().int().safe() }).passthrough().parse(raw);
  const classes = ["message", "business_connection", "business_message", "edited_business_message", "deleted_business_messages"].filter(key => key in root);
  if (classes.length !== 1) throw Error("PRIVATE_BETA_WEBHOOK_INVALID");
  const selected = classes[0];
  if (selected === "message") {
    const sender = z.object({ from: z.object({ is_bot: z.literal(false) }).passthrough() }).passthrough().parse(root.message);
    if ("business_connection_id" in sender || "sender_business_bot" in sender) throw Error("PRIVATE_BETA_WEBHOOK_INVALID");
    const text = privateBetaText(sender, sourceHash);
    const envelope = parseTelegramPrivateText({ update_id: root.update_id, message: text.message } as TelegramUpdate);
    if (envelope.providerUserId !== envelope.providerChatId || !/^[1-9][0-9]{0,15}$/u.test(envelope.providerUserId)) throw Error("PRIVATE_BETA_WEBHOOK_INVALID");
    return { kind: "BOT" as const, config, envelope, unsupported: text.unsupported };
  }
  let event: PrivateBetaBusinessUpdate;
  if (selected === "business_connection") {
    const value = z.object({ id: connectionId, user: z.object({ id: numeric, is_bot: z.literal(false) }), is_enabled: z.boolean(), rights: z.object({ can_reply: z.boolean().optional() }).optional() }).parse(root.business_connection);
    event = { kind: "CONNECTION", updateId: String(root.update_id), connectionId: value.id, sourceHash, occurredAt: new Date(now).toISOString(), providerUserId: String(value.user.id), providerChatId: null, providerMessageIds: [], envelope: null, unsupported: false, botEcho: false, restrictionObserved: !value.is_enabled || value.rights?.can_reply === false };
  } else if (selected === "deleted_business_messages") {
    const value = z.object({ business_connection_id: connectionId, chat: z.object({ id: numeric, type: z.literal("private") }), message_ids: z.array(numeric).min(1).max(100) }).parse(root.deleted_business_messages);
    if (new Set(value.message_ids).size !== value.message_ids.length) throw Error("PRIVATE_BETA_WEBHOOK_INVALID");
    event = { kind: "DELETE", updateId: String(root.update_id), connectionId: value.business_connection_id, sourceHash, occurredAt: new Date(now).toISOString(), providerUserId: null, providerChatId: String(value.chat.id), providerMessageIds: value.message_ids.map(String), envelope: null, unsupported: false, botEcho: false, restrictionObserved: true };
  } else {
    const message = z.object({ business_connection_id: connectionId, from: z.object({ id: numeric, is_bot: z.boolean() }), sender_business_bot: z.object({ id: numeric }).optional() }).passthrough().parse(root[selected!]);
    const text = privateBetaText(message, sourceHash);
    const envelope = parseTelegramPrivateText({ update_id: root.update_id, message: text.message } as TelegramUpdate);
    if (!/^[1-9][0-9]{0,15}$/u.test(envelope.providerChatId)) throw Error("PRIVATE_BETA_WEBHOOK_INVALID");
    event = { kind: selected === "edited_business_message" ? "EDIT" : "MESSAGE", updateId: String(root.update_id), connectionId: message.business_connection_id, sourceHash, occurredAt: envelope.occurredAt, providerUserId: envelope.providerUserId, providerChatId: envelope.providerChatId, providerMessageIds: [envelope.providerMessageId], envelope, unsupported: text.unsupported, botEcho: message.from.is_bot || message.sender_business_bot !== undefined, restrictionObserved: selected === "edited_business_message" };
  }
  return { kind: "BUSINESS" as const, config, event };
}

/** Backward-compatible BOT-only parser; accepting Business is always an explicit consumer choice. */
export async function authenticatePrivateBetaUpdate(request: Request, rawConfig: unknown, now = Date.now()) {
  const verified = await authenticatePrivateBetaIngress(request, rawConfig, now);
  if (verified.kind !== "BOT") throw Error("PRIVATE_BETA_WEBHOOK_INVALID");
  return { config: verified.config, envelope: verified.envelope, unsupported: verified.unsupported };
}

/** Historical UAT and campaign relay capabilities have different signature domains. */
export function authenticatePrivateBetaIngress(request: Request, rawConfig: unknown, now = Date.now()) { return authenticateScopedTelegramIngress(request, rawConfig, now, "PRIVATE_BETA"); }
export function authenticateCampaignIngress(request: Request, rawConfig: unknown, now = Date.now()) { return authenticateScopedTelegramIngress(request, rawConfig, now, "FOUNDER_CAMPAIGN"); }
