import "server-only";
import { createSupabaseAdminClient, telegramServerEnv } from "@/lib/messaging/server-env";
import { dispatchQueuedTelegramMessage } from "@/lib/messaging/outbound-dispatch";

// Bounded cron recovery for persisted sends and explicit provider retries (e.g. 429).
export async function drainAutomaticReplies(): Promise<void> {
  const { tenantId } = telegramServerEnv();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("messages").select("id")
    .eq("tenant_id", tenantId).eq("direction", "outbound").eq("actor_id", "quality-approved-reply")
    .in("status", ["pending", "retry_scheduled"])
    .gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .order("created_at", { ascending: true }).limit(3);
  if (error) return;
  for (const message of data ?? []) {
    await dispatchQueuedTelegramMessage({ tenantId, messageId: message.id, automatic: true }).catch(() => undefined);
  }
}
