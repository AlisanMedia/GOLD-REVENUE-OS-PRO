import { escalationCategoryLabels, escalationCategorySummaries, escalationSeverityLabels } from "@gold-revenue-os/domain";
import type { EscalationCase } from "./admin";

const label = (labels: Readonly<Record<string, string>>, key: string, fallback: string): string => Object.hasOwn(labels, key) ? labels[key]! : fallback;

export function categoryLabel(value: string): string {
  return label(escalationCategoryLabels, value, "İnsan incelemesi");
}
export function categorySummary(value: string): string {
  return label(escalationCategorySummaries, value, "Bu vaka insan değerlendirmesi gerektiriyor.");
}
export function severityLabel(value: string): string {
  return label(escalationSeverityLabels, value.toUpperCase(), "Öncelik belirtilmedi");
}
export function caseStage(c: Pick<EscalationCase, "status" | "assigned_to" | "returned_to_ai_at">): string {
  if (c.returned_to_ai_at && c.status === "RESOLVED") return "Yapay Zekâya Devredildi";
  if (c.status === "RESOLVED") return "Çözüldü";
  if (c.status === "IN_PROGRESS") return "Görüşme Devralındı";
  if (c.assigned_to) return "Yönetici Atandı";
  return "İnceleme Bekliyor";
}
export function notificationLabel(status?: string): string {
  return label({ BLOCKED: "Hedef bekleniyor", PENDING: "Bildirim sırada", RUNNING: "Gönderim deneniyor", SENT: "Telegram teslimi doğrulandı",
    FAILED: "Bildirim gönderilemedi", UNCERTAIN: "Teslim sonucu belirsiz", CANCELLED: "Bildirim iptal edildi" }, status ?? "", "Bildirim gerekmiyor");
}
export function notificationHelp(status?: string): string {
  if (status === "SENT") return "Telegram gönderimi kabul etti. Yöneticinin okuduğu doğrulanmadı.";
  if (status === "UNCERTAIN") return "Tekrar gönderilmedi. Olası çift bildirimi önlemek için teslim kaydını inceleyin.";
  if (status === "BLOCKED") return "Onaylı bildirim hedefi tanımlı değil. Vaka inceleme için görünür kalır.";
  if (status === "FAILED") return "Başarılı bir teslim kaydı yok. Vaka üzerinden çalışmaya devam edebilirsiniz.";
  return "Başarılı teslim kaydı oluşana kadar yöneticiye haber verildiği varsayılmaz.";
}
export function operatorDate(value?: string | null): string {
  if (!value) return "Henüz yok";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Tarih bilinmiyor" : `${new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}
export function managerLabel(id: string | null, currentUserId: string): string {
  if (!id) return "Henüz atanmadı";
  return id === currentUserId ? "Siz" : `Yönetici · ${id.slice(0, 6).toUpperCase()}`;
}
export type EscalationAction = "takeover" | "assign" | "resolve" | "return";
export function availableEscalationActions(c: Pick<EscalationCase, "status" | "assigned_to" | "returned_to_ai_at">, userId: string, canManage: boolean): EscalationAction[] {
  if (!canManage) return [];
  if (c.status === "RESOLVED") return c.returned_to_ai_at ? [] : ["return"];
  if (!["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"].includes(c.status)) return [];
  return c.status === "IN_PROGRESS" && c.assigned_to === userId ? ["resolve", "assign"] : ["takeover", "assign"];
}
export function nextCaseAction(c: Pick<EscalationCase, "status" | "assigned_to" | "returned_to_ai_at">, userId: string, canManage: boolean): string {
  if (c.returned_to_ai_at && c.status === "RESOLVED") return "İşlem tamamlandı. Önceki taslaklar yeniden gönderilmez.";
  if (!canManage) return "Vaka ve kanıtları inceleyebilirsiniz. İşlemler yetkili yöneticilere açıktır.";
  if (c.status === "RESOLVED") return "Uygunsa yalnızca yeni mesajlar için yapay zekâyı yeniden açın.";
  if (c.status === "IN_PROGRESS" && c.assigned_to === userId) return "Müşteriye yanıt verin; inceleme bitince çözüm notuyla vakayı kapatın.";
  return "Vakayı üstlenin veya uygun yöneticiye atayın.";
}
export function conversationAutomationLabel(conversation?: { runtime_mode: string; automatic_replies_enabled: boolean } | null): string {
  if (!conversation) return "Görüşme durumu doğrulanamadı";
  if (conversation.runtime_mode === "HUMAN_TAKEOVER" && !conversation.automatic_replies_enabled) return "Yapay zekâ yanıtları duraklatıldı";
  if (conversation.runtime_mode === "AI_ACTIVE" && conversation.automatic_replies_enabled) return "Yeni mesajlarda yapay zekâ açık";
  return "Otomatik müşteri yanıtları kapalı";
}
export function historyLabel(action: string): string {
  return label({ created: "Vaka açıldı", evidence_added: "Kaynak kanıtı eklendi", priority_raised: "Öncelik yükseltildi", assign: "Yönetici atandı",
    acknowledge: "Vaka alındı", takeover: "Görüşme devralındı", resolve: "Vaka çözüldü", return: "Yapay zekâya devredildi",
    notification_sent: "Telegram teslimi kaydedildi", notification_failed: "Bildirim başarısız", notification_uncertain: "Bildirim teslimi belirsiz",
    notification_retry: "Bildirim yeniden denemeye alındı", safe_response_queued: "Güvenli müşteri yanıtı sıraya alındı", manual_response_delivered: "Manuel yanıt teslim edildi" }, action, "Vaka kaydı güncellendi");
}
export type EscalationControlState = { kind: "success" | "error" | "idle"; message: string };
export function escalationControlError(code?: string): string {
  if (code === "PT409") return "Vaka başka bir işlemle güncellendi. Sayfayı yenileyip son durumu kontrol edin.";
  if (code === "42501") return "Bu işlem için yetkiniz veya vaka sahipliğiniz uygun değil. Son durumu kontrol edin.";
  if (code === "55000") return "Vaka bu işleme henüz hazır değil. Açık vakaları ve devam eden mesaj gönderimlerini kontrol edin.";
  return "İşlem tamamlanamadı. Vaka durumunu kontrol edip yeniden deneyin.";
}
