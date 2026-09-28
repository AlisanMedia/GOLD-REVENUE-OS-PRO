import "server-only";

import { createSupabaseAdminClient, telegramServerEnv } from "@/lib/messaging/server-env";
import { sendTelegramText } from "@/lib/messaging/telegram-adapter";

export type OutboundDispatchResult = {
  messageId: string;
  result: "sent" | "retry_scheduled" | "blocked" | "failed";
  providerStatus: number;
};

export async function dispatchQueuedTelegramMessage(input: {
  tenantId: string;
  messageId: string;
}): Promise<OutboundDispatchResult> {
  const env = telegramServerEnv();
  if (env.tenantId !== input.tenantId) throw new Error("TENANT_PROVIDER_NOT_CONFIGURED");
  const admin = createSupabaseAdminClient();
  const { data: message, error: messageError } = await admin
    .from("messages")
    .select("direction,status,content,provider_chat_id,reply_to_provider_message_id")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.messageId)
    .single();
  if (messageError || !message || message.direction !== "outbound") throw new Error("OUTBOUND_MESSAGE_READ_FAILED");
  if (message.status === "sent") return { messageId: input.messageId, result: "sent", providerStatus: 200 };
  const provider = await sendTelegramText({
    botToken: env.botToken,
    chatId: String(message.provider_chat_id),
    text: String(message.content),
    replyToProviderMessageId: message.reply_to_provider_message_id,
  });
  const result = provider.result;
  const mapped = result.kind === "sent"
    ? { result: "sent" as const, providerId: result.providerMessageId, error: null, retryAfter: null }
    : result.kind === "retry"
      ? { result: "retry_scheduled" as const, providerId: null, error: result.errorCode, retryAfter: result.retryAfterSeconds }
      : result.kind === "blocked"
        ? { result: "blocked" as const, providerId: null, error: result.errorCode, retryAfter: null }
        : result.retryable
          ? { result: "retry_scheduled" as const, providerId: null, error: result.errorCode, retryAfter: 30 }
          : { result: "failed" as const, providerId: null, error: result.errorCode, retryAfter: null };
  const { error: resultError } = await admin.rpc("record_outbound_message_result", {
    target_tenant_id: input.tenantId,
    target_message_id: input.messageId,
    result_value: mapped.result,
    provider_message_id_value: mapped.providerId,
    provider_status_value: provider.providerStatus,
    error_code_value: mapped.error,
    retry_after_seconds_value: mapped.retryAfter,
  });
  if (resultError) throw new Error("OUTBOUND_RESULT_PERSIST_FAILED");
  return { messageId: input.messageId, result: mapped.result, providerStatus: provider.providerStatus };
}
