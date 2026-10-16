import "server-only";
import { escalationNotificationSchema } from "@gold-revenue-os/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchQueuedTelegramMessage } from "@/lib/messaging/outbound-dispatch";
import { ManagerTelegramNotifier } from "./notification-adapter";

export async function drainEscalations(scope?: { tenantId: string; conversationId: string }): Promise<void> {
  const db = createSupabaseAdminClient();
  let query = db.from("escalation_cases").select("id,tenant_id,safe_reply_id,conversation_id").eq("status", "OPEN").in("severity", ["HIGH", "CRITICAL"]).order("created_at").limit(3);
  if (scope) query = query.eq("tenant_id", scope.tenantId).eq("conversation_id", scope.conversationId);
  const { data, error } = await query;
  if (error) throw new Error("ESCALATION_QUEUE_UNAVAILABLE");
  for (const c of data ?? []) {
    // Only the configured customer gateway can dispatch an acknowledgment; other tenants stay held.
    if (c.tenant_id !== process.env.TELEGRAM_STAGING_TENANT_ID) continue;
    const queued = c.safe_reply_id ? { data: c.safe_reply_id, error: null } : await db.rpc("escalation_queue_safe_response", { target_tenant_id: c.tenant_id, target_case_id: c.id });
    if (!queued.error && typeof queued.data === "string") await dispatchQueuedTelegramMessage({ tenantId: c.tenant_id, messageId: queued.data, escalation: true }).catch(() => undefined);
  }
  const tenantId = process.env.ESCALATION_NOTIFICATION_TENANT_ID;
  const chatId = process.env.ESCALATION_TELEGRAM_CHAT_ID;
  const botId = process.env.ESCALATION_TELEGRAM_BOT_ID;
  const botToken = process.env.ESCALATION_TELEGRAM_BOT_TOKEN;
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL;
  if (!tenantId || !chatId || !botId || !botToken || !appOrigin || scope && scope.tenantId !== tenantId) return;
  const { data: raw, error: claimError } = await db.rpc("escalation_claim_notification", { target_tenant_id: tenantId });
  if (claimError) throw new Error("NOTIFICATION_CLAIM_FAILED");
  if (!raw) return;
  const job = escalationNotificationSchema.parse(raw);
  let receipt;
  try { receipt = await new ManagerTelegramNotifier({ tenantId, chatId, botId, botToken, appOrigin }).send(job); }
  catch { receipt = { result: "FAILED" as const, provider_status: 0 }; }
  const complete = await db.rpc("escalation_complete_notification", { target_tenant_id: tenantId, target_job_id: job.id, lease_value: job.lease_token, result_value: receipt });
  if (complete.error) throw new Error("NOTIFICATION_RECEIPT_REJECTED");
}
