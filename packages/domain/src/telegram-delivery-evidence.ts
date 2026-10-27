import { mapTelegramSendResponse, type TelegramSendResult } from "./messaging";

/** Transport acknowledgement is not proof of reading; an unknown effect is never retried blindly. */
export function telegramDeliveryEvidence(status: number, raw: unknown, expectedChatId: string, expectedBusinessConnectionId?: string): TelegramSendResult {
  const unknown = (): TelegramSendResult => ({ kind: "failed", errorCode: "TELEGRAM_DELIVERY_UNCERTAIN", retryable: false });
  if (!Number.isInteger(status) || status < 100 || status > 599 || status >= 500 || status === 408) return unknown();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unknown();
  const body = raw as Record<string, unknown>;
  if (status === 429 && body.ok === false && body.error_code === 429) {
    const p = body.parameters;
    const seconds = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>).retry_after : undefined;
    if (seconds !== undefined && (!Number.isSafeInteger(seconds) || (seconds as number) <= 0)) return unknown();
    return { kind: "retry", errorCode: "TELEGRAM_RATE_LIMITED", retryAfterSeconds: Math.min(3600, typeof seconds === "number" ? seconds : 30) };
  }
  if (status >= 200 && status < 300) {
    const result = body.result;
    if (body.ok !== true || !result || typeof result !== "object" || Array.isArray(result)) return unknown();
    const r = result as Record<string, unknown>, chat = r.chat;
    if (!Number.isSafeInteger(r.message_id) || (r.message_id as number) <= 0 || !chat || typeof chat !== "object" || Array.isArray(chat)) return unknown();
    if (expectedBusinessConnectionId !== undefined && (expectedBusinessConnectionId.length < 1 || expectedBusinessConnectionId.length > 160 || r.business_connection_id !== expectedBusinessConnectionId)) return unknown();
    const id = (chat as Record<string, unknown>).id;
    if (!Number.isSafeInteger(id) || String(id) !== expectedChatId) return unknown();
    return { kind: "sent", providerMessageId: String(r.message_id), providerChatId: String(id) };
  }
  // Only an explicit matching rejection proves no successful send. Loose/malformed errors stay unknown.
  if (body.ok !== false || body.error_code !== status || status < 400) return unknown();
  return mapTelegramSendResponse(status, { ok: false, error_code: status });
}
