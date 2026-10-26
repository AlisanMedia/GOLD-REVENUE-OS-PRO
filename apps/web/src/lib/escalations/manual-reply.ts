export function messageDeliveryLabel(status: string, failureCode?: string | null): string {
  if (failureCode === "TELEGRAM_DELIVERY_UNCERTAIN") return "Teslimat sonucu belirsiz · inceleme gerekli";
  switch (status) {
    case "received": return "Gelen mesaj";
    case "sent": return "Telegram API onayı alındı";
    case "pending": return "Gönderim sırada";
    case "sending": return "Gönderim deneniyor";
    case "retry_scheduled": return "Yeniden deneme bekliyor";
    case "failed": return "Teslim edilemedi";
    case "blocked": return "Gönderim engellendi";
    default: return "Teslim durumu bilinmiyor";
  }
}
export function manualReplyResult(ok: boolean, result: { status?: string; error?: string }): string {
  if (ok && result.status === "sent") return "Telegram API onayı alındı. Müşterinin okuduğu doğrulanmadı.";
  if (ok && ["pending", "queued", "sending", "retry_scheduled"].includes(result.status ?? "")) return "Mesaj sıraya alındı. Teslim henüz doğrulanmadı; görüşmedeki teslim durumunu takip edin.";
  const errors: Record<string, string> = {
    AUTH_REQUIRED: "Oturumunuzu yenileyip yeniden giriş yapın.",
    MESSAGING_SEND_DENIED: "Bu görüşmeye mesaj gönderme yetkiniz yok.",
    OUTBOUND_NOT_ALLOWED: "Mesaj gönderimi kapalı veya müşteriye ulaşma izni uygun değil.",
    TELEGRAM_NOT_CONFIGURED: "Bu ortamda Telegram mesaj gönderimi yapılandırılmadı.",
    TENANT_PROVIDER_NOT_CONFIGURED: "Bu marka için Telegram gönderimi etkin değil.",
    INVALID_MESSAGE_REQUEST: "Mesajı kontrol edin. Metin boş olamaz ve en fazla 4096 karakter olabilir.",
    OUTBOUND_QUEUE_FAILED: "Mesaj sıraya alınamadı. Vaka sahipliğini ve görüşme durumunu kontrol edin.",
    OUTBOUND_RESULT_PERSIST_FAILED: "Gönderim sonucu kaydedilemedi. Çift mesajı önlemek için görüşmedeki teslim kaydını kontrol edin.",
    DELIVERY_UNKNOWN_REVIEW_REQUIRED: "Teslimat sonucu belirsiz. Otomatik yeniden deneme yapılmaz; yeni mesajdan önce bağımsız teslim kanıtını inceleyin.",
  };
  return Object.hasOwn(errors, result.error ?? "") ? errors[result.error!]! : "Mesaj teslimi doğrulanamadı. Yeni bir mesaj göndermeden önce görüşme kaydını kontrol edin.";
}
