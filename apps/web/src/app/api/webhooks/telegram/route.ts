import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  MessagingValidationError,
  parseTelegramPrivateText,
  type TelegramUpdate,
} from "@gold-revenue-os/domain";
import { createSupabaseAdminClient, telegramServerEnv } from "@/lib/messaging/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 256 * 1024;

function safeSecretEqual(received: string | null, expected: string): boolean {
  if (!received) return false;
  const receivedHash = createHash("sha256").update(received).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(receivedHash, expectedHash);
}

export async function POST(request: Request) {
  let env: ReturnType<typeof telegramServerEnv>;
  try {
    env = telegramServerEnv();
  } catch {
    return NextResponse.json({ error: "WEBHOOK_NOT_CONFIGURED" }, { status: 503 });
  }

  if (process.env.NODE_ENV === "production") {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const url = new URL(request.url);
    if (forwardedProto !== "https" && url.protocol !== "https:") {
      return NextResponse.json({ error: "HTTPS_REQUIRED" }, { status: 400 });
    }
  }

  if (!safeSecretEqual(request.headers.get("x-telegram-bot-api-secret-token"), env.webhookSecret)) {
    return NextResponse.json({ error: "WEBHOOK_SECRET_INVALID" }, { status: 401 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: "PAYLOAD_READ_FAILED" }, { status: 400 });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  let envelope;
  try {
    const parsed = JSON.parse(raw) as TelegramUpdate;
    envelope = parseTelegramPrivateText(parsed);
  } catch (error) {
    const code = error instanceof MessagingValidationError ? error.code : "MALFORMED_JSON";
    return NextResponse.json({ error: code }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("ingest_telegram_message", {
    target_tenant_id: env.tenantId,
    provider_update_id_value: envelope.updateId,
    provider_message_id_value: envelope.providerMessageId,
    provider_chat_id_value: envelope.providerChatId,
    provider_user_id_value: envelope.providerUserId,
    username_value: envelope.username,
    first_name_value: envelope.firstName,
    last_name_value: envelope.lastName,
    content_value: envelope.text,
    reply_to_provider_message_id_value: envelope.replyToProviderMessageId,
    occurred_at_value: envelope.occurredAt,
  });
  if (error) {
    return NextResponse.json({ error: "WEBHOOK_PROCESSING_FAILED" }, { status: 500 });
  }
  const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return NextResponse.json({ ok: true, duplicate: result.duplicate === true });
}

export function GET() {
  return NextResponse.json({ status: "telegram-webhook-ready" });
}
