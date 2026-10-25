import "server-only";

import { telegramDeliveryEvidence, type TelegramSendResult } from "@gold-revenue-os/domain";

export async function sendTelegramText(input: {
  botToken: string;
  chatId: string;
  text: string;
  replyToProviderMessageId?: string | null;
}): Promise<{ result: TelegramSendResult; providerStatus: number }> {
  if (!/^-?[1-9][0-9]{0,15}$/u.test(input.chatId) || !Number.isSafeInteger(Number(input.chatId)) || !input.text.trim() || input.text.length > 4096 || !input.botToken || input.botToken.length > 256)
    return { result: { kind: "failed", errorCode: "TELEGRAM_REQUEST_INVALID", retryable: false }, providerStatus: 0 };
  const body: Record<string, unknown> = {
    chat_id: input.chatId,
    text: input.text,
    disable_web_page_preview: true,
  };
  if (input.replyToProviderMessageId) {
    body.reply_parameters = { message_id: Number(input.replyToProviderMessageId), allow_sending_without_reply: true };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    let payload: unknown = null;
    try {
      const reader = response.body?.getReader();
      if (!reader) throw Error("TELEGRAM_RESPONSE_MISSING");
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 65536) { await reader.cancel(); throw Error("TELEGRAM_RESPONSE_BOUND"); } chunks.push(part.value); }
      } finally { reader.releaseLock(); }
      const joined = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as unknown;
    } catch {
      payload = null;
    }
    return { result: telegramDeliveryEvidence(response.status, payload, input.chatId), providerStatus: response.status };
  } catch {
    return {
      result: { kind: "failed", errorCode: "TELEGRAM_DELIVERY_UNCERTAIN", retryable: false },
      providerStatus: 0,
    };
  }
}
