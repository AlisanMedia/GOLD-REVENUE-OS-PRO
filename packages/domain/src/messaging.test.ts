import { describe, expect, it } from "vitest";
import {
  isOutboundAllowed,
  mapTelegramSendResponse,
  MessagingValidationError,
  normalizeTelegramUsername,
  parseTelegramPrivateText,
} from "./messaging";

const update = {
  update_id: 9001,
  message: {
    message_id: 41,
    date: 1_800_000_000,
    text: "/start campaign",
    chat: { id: 777, type: "private" },
    from: { id: 777, username: "@Gold_User", first_name: "Ali", last_name: "Test" },
    reply_to_message: { message_id: 40 },
  },
};

describe("Telegram normalization", () => {
  it("normalizes a private text update without retaining raw payload", () => {
    expect(parseTelegramPrivateText(update)).toEqual({
      provider: "telegram",
      updateId: "9001",
      providerMessageId: "41",
      providerChatId: "777",
      providerUserId: "777",
      username: "gold_user",
      firstName: "Ali",
      lastName: "Test",
      text: "/start campaign",
      replyToProviderMessageId: "40",
      occurredAt: new Date(1_800_000_000_000).toISOString(),
      command: "start",
    });
  });

  it("rejects malformed, non-private and non-text updates", () => {
    for (const candidate of [
      {},
      { ...update, update_id: undefined },
      { ...update, message: { ...update.message, chat: { id: 1, type: "group" } } },
      { ...update, message: { ...update.message, text: undefined } },
    ]) {
      expect(() => parseTelegramPrivateText(candidate)).toThrow(MessagingValidationError);
    }
  });

  it("normalizes usernames conservatively", () => {
    expect(normalizeTelegramUsername("@Gold_User")).toBe("gold_user");
    expect(normalizeTelegramUsername("bad-name")).toBeNull();
    expect(normalizeTelegramUsername("")).toBeNull();
  });
});

describe("Telegram outbound result mapping", () => {
  it("maps only provider acknowledgement to sent", () => {
    expect(mapTelegramSendResponse(200, { ok: true, result: { message_id: 99, chat: { id: 777 } } }))
      .toEqual({ kind: "sent", providerMessageId: "99", providerChatId: "777" });
    expect(mapTelegramSendResponse(200, { ok: false })).not.toMatchObject({ kind: "sent" });
  });

  it("honors Telegram retry_after and blocked results", () => {
    expect(mapTelegramSendResponse(429, { error_code: 429, parameters: { retry_after: 17 } }))
      .toEqual({ kind: "retry", retryAfterSeconds: 17, errorCode: "TELEGRAM_RATE_LIMITED" });
    expect(mapTelegramSendResponse(403, { description: "Forbidden: bot was blocked by the user" }))
      .toEqual({ kind: "blocked", errorCode: "TELEGRAM_CHAT_UNREACHABLE" });
  });
});

describe("contactability policy", () => {
  it("requires kill switch, reachable chat and user initiation/allowance", () => {
    expect(isOutboundAllowed(true, "user_initiated", "777")).toBe(true);
    expect(isOutboundAllowed(true, "allowed", "777")).toBe(true);
    expect(isOutboundAllowed(false, "allowed", "777")).toBe(false);
    expect(isOutboundAllowed(true, "unknown", "777")).toBe(false);
    expect(isOutboundAllowed(true, "blocked", "777")).toBe(false);
    expect(isOutboundAllowed(true, "allowed", null)).toBe(false);
  });
});
