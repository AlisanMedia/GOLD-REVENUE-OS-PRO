import { z } from "zod";

export const ESCALATION_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const ESCALATION_CATEGORIES = ["payment_dispute", "missing_access", "refund_request", "fraud_accusation", "legal_threat", "financial_loss", "security_issue", "vip_complaint", "knowledge_conflict", "low_confidence", "human_request", "general_review"] as const;
export type EscalationLocale = "en" | "tr" | "ar" | "ru";
// Presentation only. Database codes and commercial authority stay unchanged.
export const escalationSeverityLabels = { LOW: "Düşük", MEDIUM: "Orta", HIGH: "Yüksek", CRITICAL: "Kritik" } as const;
export const escalationCategoryLabels = {
  payment_dispute: "Ödeme itirazı", missing_access: "VIP erişim sorunu", refund_request: "İade talebi",
  fraud_accusation: "Dolandırıcılık şikâyeti", legal_threat: "Hukuki şikâyet", financial_loss: "Finansal kayıp şikâyeti",
  security_issue: "Güvenlik sorunu", vip_complaint: "VIP hizmet şikâyeti", knowledge_conflict: "Bilgi tutarsızlığı",
  low_confidence: "Yanıtın doğruluğu belirsiz", human_request: "Yöneticiyle görüşme talebi", general_review: "İnsan incelemesi",
} as const;
export const escalationCategorySummaries = {
  payment_dispute: "Müşteri ödeme konusunda itiraz iletiyor. Ödeme kaydını inceleyin.",
  missing_access: "Müşteri VIP erişimine ulaşamadığını bildiriyor. Erişim kaydını inceleyin.",
  refund_request: "Müşteri iade talep ediyor. Talebi ve geçerli iade koşullarını inceleyin.",
  fraud_accusation: "Müşteri dolandırıcılık şüphesi bildiriyor. Durumu dikkatle inceleyin.",
  legal_threat: "Müşteri hukuki bir şikâyet iletiyor. Yetkili insan değerlendirmesi gerekiyor.",
  financial_loss: "Müşteri finansal kayıp yaşadığını bildiriyor. İddia ve ilgili kayıtlar incelenmeli.",
  security_issue: "Bir güvenlik sorunu bildirildi. Kaynağı ve olası etkisini inceleyin.",
  vip_complaint: "Müşteri VIP hizmetiyle ilgili şikâyet iletiyor. İlgili görüşmeyi inceleyin.",
  knowledge_conflict: "Bilgi kaynakları arasında tutarsızlık saptandı. Yanıt vermeden önce doğrulayın.",
  low_confidence: "Yanıtın doğruluğu yeterince desteklenmiyor. Kaynakları inceleyin.",
  human_request: "Müşteri bir yöneticiyle görüşmek istiyor. Görüşmeyi üstlenebilirsiniz.",
  general_review: "Bu görüşme insan değerlendirmesi gerektiriyor. Vaka kanıtlarını inceleyin.",
} as const;
export function escalationDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  if (value < 60) return "1 dakikadan az";
  if (value < 3600) return `${Math.floor(value / 60)} dakika`;
  if (value < 86400) return `${Math.floor(value / 3600)} saat${value % 3600 >= 60 ? ` ${Math.floor(value % 3600 / 60)} dakika` : ""}`;
  return `${Math.floor(value / 86400)} gün${value % 86400 >= 3600 ? ` ${Math.floor(value % 86400 / 3600)} saat` : ""}`;
}
export function escalationReference(id: string): string { return `GR-${z.uuid().parse(id).slice(0, 8).toUpperCase()}`; }
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
export function managerNotificationText(input: EscalationNotification, appOrigin: string): string {
  const job = escalationNotificationSchema.parse(input);
  const origin = new URL(appOrigin);
  if (appOrigin.length > 300) throw new Error("APP_ORIGIN_INVALID");
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("APP_ORIGIN_INVALID");
  // This adapter is authorized only for Phase 12 sandbox tenants. Never imply a live activation.
  // Plain text deliberately avoids Telegram HTML/Markdown parsing and dynamic markup.
  return `GOLD REVENUE OS\nSTAGING · TEST BİLDİRİMİ\nYönetici incelemesi gerekiyor\n\nÖncelik: ${escalationSeverityLabels[job.severity]}\nKonu: ${escalationCategoryLabels[job.category]}\n\n${escalationCategorySummaries[job.category]}\n\nBekleme süresi: ${escalationDuration(job.waiting_seconds)}\nVaka: ${escalationReference(job.case_id)}\n\nVaka panelini aç:\n${origin.origin}/admin/attention/${job.case_id}`;
}
