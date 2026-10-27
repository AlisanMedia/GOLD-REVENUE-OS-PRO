import { describe, it, expect } from "vitest";
import { telegramDeliveryEvidence } from "./telegram-delivery-evidence";
describe("exact Telegram ACK correlation and no blind retry", () => {
  const good = { ok: true, result: { message_id: 19, chat: { id: 8327046095 } } };
  it("requires the actual numeric destination and positive provider message identity", () => {
    expect(telegramDeliveryEvidence(200, good, "8327046095")).toEqual({ kind: "sent", providerMessageId: "19", providerChatId: "8327046095" });
    for (const result of [{ message_id: 19 }, { message_id: 0, chat: { id: 8327046095 } }, { message_id: 19, chat: { id: 7 } }, { message_id: "19", chat: { id: 8327046095 } }])
      expect(telegramDeliveryEvidence(200, { ok: true, result }, "8327046095")).toMatchObject({ errorCode: "TELEGRAM_DELIVERY_UNCERTAIN", retryable: false });
  });
  it.each([0, 408, 500, 502, 503, 599, NaN, 200, 302])("status %s alone never proves rejection or permits a retry", status => {
    expect(telegramDeliveryEvidence(status, {}, "8327046095")).toMatchObject({ kind: "failed", errorCode: "TELEGRAM_DELIVERY_UNCERTAIN", retryable: false });
  });
  it("only matching explicit rate-limit rejection creates a bounded retry", () => {
    expect(telegramDeliveryEvidence(429, { ok: false, error_code: 429, parameters: { retry_after: 12 } }, "7")).toMatchObject({ kind: "retry", retryAfterSeconds: 12 });
    expect(telegramDeliveryEvidence(429, { ok: false, error_code: 429, parameters: { retry_after: 999999 } }, "7")).toMatchObject({ kind: "retry", retryAfterSeconds: 3600 });
    for (const seconds of ["12", -1, 0, NaN, Infinity]) expect(telegramDeliveryEvidence(429, { ok: false, error_code: 429, parameters: { retry_after: seconds } }, "7")).toMatchObject({ retryable: false });
  });
  it("explicit permission loss is blocked; inconsistent errors stay unknown", () => {
    expect(telegramDeliveryEvidence(403, { ok: false, error_code: 403 }, "7")).toMatchObject({ kind: "blocked" });
    expect(telegramDeliveryEvidence(403, { ok: true, error_code: 403 }, "7")).toMatchObject({ retryable: false });
    expect(telegramDeliveryEvidence(400, { ok: false, error_code: 400, description: "PRIVATE_PROVIDER_TEXT" }, "7")).toEqual({ kind: "failed", errorCode: "TELEGRAM_REJECTED", retryable: false });
  });
});

describe("BUSINESS acknowledgement correlation", () => {
  const result = { message_id: 19, chat: { id: 8327046095, type: "private" }, business_connection_id: "OPAQUE_BUSINESS_FIXTURE" };
  it("only the exact business connection and chat establish provider acknowledgement", () => {
    expect(telegramDeliveryEvidence(200, { ok: true, result }, "8327046095", "OPAQUE_BUSINESS_FIXTURE")).toMatchObject({ kind: "sent", providerMessageId: "19" });
    for (const changed of [{ ...result, business_connection_id: "FOREIGN" }, { ...result, business_connection_id: undefined }, { ...result, chat: { id: 7 } }]) expect(telegramDeliveryEvidence(200, { ok: true, result: changed }, "8327046095", "OPAQUE_BUSINESS_FIXTURE")).toMatchObject({ errorCode: "TELEGRAM_DELIVERY_UNCERTAIN", retryable: false });
  });
});
