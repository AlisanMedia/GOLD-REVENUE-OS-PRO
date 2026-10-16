import "server-only";
import { escalationNotificationSchema, managerNotificationText, type EscalationNotification, type NotificationReceipt } from "@gold-revenue-os/domain";
import { z } from "zod";

type Binding = { tenantId: string; chatId: string; botId: string; botToken: string; appOrigin: string };
export class ManagerTelegramNotifier {
  constructor(private readonly binding: Binding, private readonly transport: typeof fetch = fetch) {}

  async send(input: EscalationNotification): Promise<NotificationReceipt> {
    const job = escalationNotificationSchema.parse(input);
    if (job.tenant_id !== this.binding.tenantId || job.chat_id !== this.binding.chatId || job.bot_id !== this.binding.botId || !this.binding.botToken) throw new Error("NOTIFICATION_SCOPE_DENIED");
    // No customer text/credentials are included in the payload or errors.
    const text = managerNotificationText(job, this.binding.appOrigin);
    const call = async (method: string, body: Record<string, unknown>) => this.transport(`https://api.telegram.org/bot${this.binding.botToken}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000), cache: "no-store",
    });
    // Preflight is read-only. A failure here has not sent a message.
    try {
      const me = await call("getMe", {});
      const identity = z.object({ ok: z.literal(true), result: z.object({ id: z.number().int(), is_bot: z.literal(true) }) }).parse(await me.json());
      if (!me.ok || String(identity.result.id) !== job.bot_id) return { result: "FAILED", provider_status: me.status };
      const chat = await call("getChat", { chat_id: job.chat_id });
      const destination = z.object({ ok: z.literal(true), result: z.object({ id: z.number().int(), type: z.enum(["private", "supergroup", "group"]), username: z.string().optional() }) }).parse(await chat.json());
      if (!chat.ok || String(destination.result.id) !== job.chat_id || (destination.result.type !== "private" && destination.result.username)) return { result: "FAILED", provider_status: chat.status };
    } catch { return { result: "FAILED", provider_status: 0 }; }
    try {
      const response = await call("sendMessage", { chat_id: job.chat_id, text, protect_content: true, link_preview_options: { is_disabled: true } });
      const data: unknown = await response.json();
      if (response.status === 429) {
        const retry = z.object({ ok: z.literal(false), parameters: z.object({ retry_after: z.number().int().min(1) }) }).safeParse(data);
        return retry.success ? { result: "RETRY", provider_status: 429, retry_after: Math.min(300, retry.data.parameters.retry_after) } : { result: "FAILED", provider_status: 429 };
      }
      const receipt = z.object({ ok: z.literal(true), result: z.object({ message_id: z.number().int().positive(), chat: z.object({ id: z.number().int() }) }) }).safeParse(data);
      if (response.ok && receipt.success && String(receipt.data.result.chat.id) === job.chat_id) return { result: "SENT", provider_status: 200, provider_message_id: String(receipt.data.result.message_id) };
      // Ambiguous success/5xx cannot be retried safely: Telegram has no send idempotency key.
      return { result: response.status >= 500 || response.ok ? "UNCERTAIN" : "FAILED", provider_status: response.status };
    } catch { return { result: "UNCERTAIN", provider_status: 0 }; }
  }
}
