import { NextResponse } from "next/server";
import { z } from "zod";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { getUserContext } from "@/lib/auth/context";
import { createSupabaseAdminClient, telegramServerEnv } from "@/lib/messaging/server-env";
import { sendTelegramText } from "@/lib/messaging/telegram-adapter";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  content: z.string().trim().min(1).max(4096),
  reply_to_message_id: z.uuid().nullable().optional(),
  correlation_id: z.uuid(),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const userContext = await getUserContext();
  if (!userContext) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const tenant = userContext.tenants[0];
  if (!tenant || !hasAdminCapability(tenant.role, "messaging.send")) {
    return NextResponse.json({ error: "MESSAGING_SEND_DENIED" }, { status: 403 });
  }

  let env: ReturnType<typeof telegramServerEnv>;
  try {
    env = telegramServerEnv();
  } catch {
    return NextResponse.json({ error: "TELEGRAM_NOT_CONFIGURED" }, { status: 503 });
  }
  if (tenant.id !== env.tenantId) {
    return NextResponse.json({ error: "TENANT_PROVIDER_NOT_CONFIGURED" }, { status: 403 });
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 240) {
    return NextResponse.json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
  }

  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "INVALID_MESSAGE_REQUEST" }, { status: 400 });
  }

  const { id: conversationId } = await context.params;
  if (!z.uuid().safeParse(conversationId).success) {
    return NextResponse.json({ error: "CONVERSATION_ID_INVALID" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: queuedData, error: queueError } = await supabase.rpc("queue_outbound_message", {
    target_tenant_id: tenant.id,
    target_conversation_id: conversationId,
    content_value: input.content,
    idempotency_key_value: idempotencyKey,
    correlation_id_value: input.correlation_id,
    reply_to_message_id_value: input.reply_to_message_id ?? null,
  });
  if (queueError) {
    const disabled = /outbound messaging disabled|contact is not reachable/i.test(queueError.message);
    return NextResponse.json({ error: disabled ? "OUTBOUND_NOT_ALLOWED" : "OUTBOUND_QUEUE_FAILED" }, { status: disabled ? 423 : 400 });
  }
  const queued = queuedData && typeof queuedData === "object" ? queuedData as Record<string, unknown> : {};
  const messageId = typeof queued.message_id === "string" ? queued.message_id : null;
  if (!messageId) return NextResponse.json({ error: "OUTBOUND_QUEUE_FAILED" }, { status: 500 });
  if (queued.duplicate === true) {
    return NextResponse.json({ message_id: messageId, status: queued.status, duplicate: true });
  }

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .select("provider_chat_id,reply_to_provider_message_id")
    .eq("tenant_id", tenant.id)
    .eq("id", messageId)
    .single();
  if (messageError || !message) {
    return NextResponse.json({ error: "OUTBOUND_MESSAGE_READ_FAILED", message_id: messageId }, { status: 500 });
  }

  const provider = await sendTelegramText({
    botToken: env.botToken,
    chatId: String(message.provider_chat_id),
    text: input.content,
    replyToProviderMessageId: message.reply_to_provider_message_id,
  });
  const admin = createSupabaseAdminClient();
  const result = provider.result;
  const dbResult = result.kind === "sent"
    ? { result: "sent", providerId: result.providerMessageId, error: null, retryAfter: null }
    : result.kind === "retry"
      ? { result: "retry_scheduled", providerId: null, error: result.errorCode, retryAfter: result.retryAfterSeconds }
      : result.kind === "blocked"
        ? { result: "blocked", providerId: null, error: result.errorCode, retryAfter: null }
        : result.retryable
          ? { result: "retry_scheduled", providerId: null, error: result.errorCode, retryAfter: 30 }
          : { result: "failed", providerId: null, error: result.errorCode, retryAfter: null };

  const { error: resultError } = await admin.rpc("record_outbound_message_result", {
    target_tenant_id: tenant.id,
    target_message_id: messageId,
    result_value: dbResult.result,
    provider_message_id_value: dbResult.providerId,
    provider_status_value: provider.providerStatus,
    error_code_value: dbResult.error,
    retry_after_seconds_value: dbResult.retryAfter,
  });
  if (resultError) {
    return NextResponse.json({ error: "OUTBOUND_RESULT_PERSIST_FAILED", message_id: messageId }, { status: 500 });
  }

  const httpStatus = dbResult.result === "sent" ? 201 : dbResult.result === "retry_scheduled" ? 202 : 422;
  return NextResponse.json({ message_id: messageId, status: dbResult.result, duplicate: false }, { status: httpStatus });
}
