import "server-only";

import { mapTelegramSendResponse, type TelegramSendResult } from "@gold-revenue-os/domain";

type TelegramApiResponse = {
  ok?: boolean;
  result?: { message_id?: number; chat?: { id?: number } };
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

export async function sendTelegramText(input: {
  botToken: string;
  chatId: string;
  text: string;
  replyToProviderMessageId?: string | null;
}): Promise<{ result: TelegramSendResult; providerStatus: number }> {
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
      signal: AbortSignal.timeout(10_000),
    });
    let payload: TelegramApiResponse = {};
    try {
      payload = await response.json() as TelegramApiResponse;
    } catch {
      payload = {};
    }
    return { result: mapTelegramSendResponse(response.status, payload), providerStatus: response.status };
  } catch {
    return {
      result: { kind: "failed", errorCode: "TELEGRAM_NETWORK_FAILURE", retryable: true },
      providerStatus: 0,
    };
  }
}
