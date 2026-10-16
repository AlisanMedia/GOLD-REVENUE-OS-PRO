import { z } from "zod";

export const ESCALATION_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const ESCALATION_CATEGORIES = ["payment_dispute", "missing_access", "refund_request", "fraud_accusation", "legal_threat", "financial_loss", "security_issue", "vip_complaint", "knowledge_conflict", "low_confidence", "human_request", "general_review"] as const;
export type EscalationLocale = "en" | "tr" | "ar" | "ru";
export const escalationSafeResponses: Readonly<Record<EscalationLocale, string>> = {
  en: "I cannot verify this here. This needs human review.",
  tr: "Bu konuyu burada doğrulayamıyorum. İnsan incelemesi gerekiyor.",
  ar: "لا أستطيع التحقق من هذا هنا. يحتاج الأمر إلى مراجعة بشرية.",
  ru: "Я не могу проверить это здесь. Нужна проверка специалистом.",
};
export const escalationNotificationSchema = z.object({
  id: z.uuid(), tenant_id: z.uuid(), case_id: z.uuid(), lease_token: z.uuid(), attempt: z.number().int().min(1).max(5),
  chat_id: z.string().regex(/^-?[1-9][0-9]{0,15}$/u).refine(v => v !== "-1003944824067"),
  bot_id: z.string().regex(/^[1-9][0-9]{0,15}$/u).refine(v => v !== "8673054837"), severity: z.enum(ESCALATION_SEVERITIES),
  category: z.enum(ESCALATION_CATEGORIES), customer_id: z.uuid().nullable(), waiting_seconds: z.number().int().min(0),
});
export type EscalationNotification = z.infer<typeof escalationNotificationSchema>;
export type NotificationReceipt = {
  result: "SENT" | "RETRY" | "FAILED" | "UNCERTAIN";
  provider_status: number; provider_message_id?: string; retry_after?: number;
};
export function managerNotificationText(job: EscalationNotification, appOrigin: string): string {
  const origin = new URL(appOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("APP_ORIGIN_INVALID");
  return `PHASE 12 STAGING TEST\n${job.severity} · ${job.category}\nSummary: Human review required for ${job.category.replaceAll("_", " ")}. No payment or access action performed.\nCase: ${job.case_id}\nCustomer: ${job.customer_id ?? "Unmatched"}\nWaiting: ${job.waiting_seconds}s\n${origin.origin}/admin/attention/${job.case_id}`;
}
