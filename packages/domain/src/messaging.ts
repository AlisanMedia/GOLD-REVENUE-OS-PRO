export const MESSAGING_PROVIDERS = ["telegram"] as const;
export type MessagingProvider = (typeof MESSAGING_PROVIDERS)[number];

export const CONTACTABILITY_STATES = ["unknown", "user_initiated", "allowed", "blocked", "revoked"] as const;
export type Contactability = (typeof CONTACTABILITY_STATES)[number];

export type NormalizedInboundMessage = {
  provider: "telegram";
  updateId: string;
  providerMessageId: string;
  providerChatId: string;
  providerUserId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  text: string;
  replyToProviderMessageId: string | null;
  occurredAt: string;
  command: "start" | null;
};

type TelegramUser = { id?: number; username?: string; first_name?: string; last_name?: string };
type TelegramChat = { id?: number; type?: string };
type TelegramMessage = {
  message_id?: number;
  date?: number;
  text?: string;
  from?: TelegramUser;
  chat?: TelegramChat;
  reply_to_message?: { message_id?: number };
};
export type TelegramUpdate = { update_id?: number; message?: TelegramMessage };

export class MessagingValidationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "MessagingValidationError";
  }
}

export function normalizeTelegramUsername(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/^@+/, "").toLowerCase() ?? "";
  return normalized.length > 0 && normalized.length <= 32 && /^[a-z0-9_]+$/.test(normalized)
    ? normalized
    : null;
}

export function parseTelegramPrivateText(update: TelegramUpdate): NormalizedInboundMessage {
  const message = update.message;
  if (!Number.isSafeInteger(update.update_id)) throw new MessagingValidationError("TELEGRAM_UPDATE_ID_INVALID");
  if (!message || !Number.isSafeInteger(message.message_id)) throw new MessagingValidationError("TELEGRAM_MESSAGE_MISSING");
  if (message.chat?.type !== "private") throw new MessagingValidationError("TELEGRAM_PRIVATE_CHAT_REQUIRED");
  if (!Number.isSafeInteger(message.chat.id) || !Number.isSafeInteger(message.from?.id)) {
    throw new MessagingValidationError("TELEGRAM_IDENTITY_INVALID");
  }
  const text = message.text?.trim();
  if (!text || text.length > 4096) throw new MessagingValidationError("TELEGRAM_TEXT_INVALID");
  const timestamp = Number.isSafeInteger(message.date) ? Number(message.date) : 0;
  if (timestamp <= 0) throw new MessagingValidationError("TELEGRAM_TIMESTAMP_INVALID");
  const firstName = message.from?.first_name?.trim().slice(0, 120) || null;
  const lastName = message.from?.last_name?.trim().slice(0, 120) || null;
  return {
    provider: "telegram",
    updateId: String(update.update_id),
    providerMessageId: String(message.message_id),
    providerChatId: String(message.chat.id),
    providerUserId: String(message.from!.id),
    username: normalizeTelegramUsername(message.from?.username),
    firstName,
    lastName,
    text,
    replyToProviderMessageId: Number.isSafeInteger(message.reply_to_message?.message_id)
      ? String(message.reply_to_message!.message_id)
      : null,
    occurredAt: new Date(timestamp * 1000).toISOString(),
    command: /^\/start(?:@\w+)?(?:\s|$)/i.test(text) ? "start" : null,
  };
}

export type TelegramSendResult =
  | { kind: "sent"; providerMessageId: string; providerChatId: string }
  | { kind: "retry"; retryAfterSeconds: number; errorCode: string }
  | { kind: "blocked"; errorCode: string }
  | { kind: "failed"; errorCode: string; retryable: boolean };

type TelegramApiResponse = {
  ok?: boolean;
  result?: { message_id?: number; chat?: { id?: number } };
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

export function mapTelegramSendResponse(status: number, body: TelegramApiResponse): TelegramSendResult {
  if (status >= 200 && status < 300 && body.ok === true && Number.isSafeInteger(body.result?.message_id)) {
    return {
      kind: "sent",
      providerMessageId: String(body.result!.message_id),
      providerChatId: String(body.result?.chat?.id ?? ""),
    };
  }
  if (status === 429 || body.error_code === 429) {
    return {
      kind: "retry",
      retryAfterSeconds: Math.max(1, Math.min(3600, Number(body.parameters?.retry_after ?? 30))),
      errorCode: "TELEGRAM_RATE_LIMITED",
    };
  }
  const description = body.description?.toLowerCase() ?? "";
  if (status === 403 || body.error_code === 403 || /blocked|deactivated|chat not found/.test(description)) {
    return { kind: "blocked", errorCode: "TELEGRAM_CHAT_UNREACHABLE" };
  }
  const retryable = status >= 500 || status === 408;
  return { kind: "failed", errorCode: retryable ? "TELEGRAM_TRANSIENT_FAILURE" : "TELEGRAM_REJECTED", retryable };
}

export function isOutboundAllowed(enabled: boolean, contactability: Contactability, providerChatId: string | null): boolean {
  return enabled && Boolean(providerChatId) && (contactability === "user_initiated" || contactability === "allowed");
}
