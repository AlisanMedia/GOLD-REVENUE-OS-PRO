import type {MetricId} from "@gold-revenue-os/domain";
export const metricLabels = {
 "collected": [
  "Doğrulanmış tahsilat",
  "Verified collected revenue"
 ],
 "mrr": [
  "Aylık yinelenen gelir",
  "MRR"
 ],
 "arr": [
  "Yıllık yinelenen gelir",
  "ARR"
 ],
 "active_subscriptions": [
  "Kanıtlı aktif abonelik",
  "Evidenced active subscriptions"
 ],
 "renewal_events": [
  "Yenileme dönemleri",
  "Renewal periods"
 ],
 "renewal_rate": [
  "Gözlenen yenileme oranı",
  "Observed renewal rate"
 ],
 "expired": [
  "Süresi dolmuş abonelik",
  "Expired subscriptions"
 ],
 "cancelled": [
  "İptal edilmiş abonelik",
  "Cancelled subscriptions"
 ],
 "customer_churn": [
  "Dönem kapsamı kaybı",
  "Customer period-coverage lapse"
 ],
 "revenue_churn": [
  "Gelir kaybı",
  "Revenue churn"
 ],
 "nrr": [
  "Net gelir tutma",
  "Net revenue retention"
 ],
 "grr": [
  "Brüt gelir tutma",
  "Gross revenue retention"
 ],
 "refunds": [
  "Doğrulanmış iadeler",
  "Verified refunds"
 ],
 "margin": [
  "Katkı marjı",
  "Contribution margin"
 ],
 "cac": [
  "Müşteri edinme maliyeti",
  "CAC"
 ],
 "ltv": [
  "Müşteri yaşam boyu değeri",
  "LTV"
 ],
 "roi": [
  "Yatırım getirisi",
  "ROI"
 ],
 "invocations": [
  "Model çağrıları",
  "Model invocations"
 ],
 "input_tokens": [
  "Girdi tokenları",
  "Input tokens"
 ],
 "output_tokens": [
  "Çıktı tokenları",
  "Output tokens"
 ],
 "model_success": [
  "Model başarı oranı",
  "Model success rate"
 ],
 "model_errors": [
  "Model hata oranı",
  "Model error rate"
 ],
 "median_latency": [
  "Ortanca gecikme",
  "Median latency"
 ],
 "p95_latency": [
  "p95 gecikme",
  "p95 latency"
 ],
 "billing_coverage": [
  "Kayıtlı faturalama kapsamı",
  "Recorded billing coverage"
 ],
 "ai_cost": [
  "Kayıtlı AI faturalama",
  "Recorded AI billing"
 ],
 "cost_per_operation": [
  "Başarılı işlem başına kayıtlı tutar",
  "Recorded amount per successful operation"
 ],
 "inbound": [
  "Gelen mesajlar",
  "Inbound messages"
 ],
 "outbound": [
  "Sağlayıcı onaylı giden mesajlar",
  "Provider-acknowledged outbound"
 ],
 "human_handled": [
  "İnsan tarafından gönderilen",
  "Human-sent messages"
 ],
 "ai_handled": [
  "Otomatik gönderilen",
  "System-sent messages"
 ],
 "agent_runs": [
  "Agent çalışmaları",
  "Agent runs"
 ],
 "escalation_rate": [
  "İncelemeye alınan görüşme oranı",
  "Escalated conversation share"
 ],
 "critical_cases": [
  "Açık kritik vakalar",
  "Open critical cases"
 ],
 "first_human_response": [
  "İlk doğrulanmış insan yanıtı",
  "First verified human response"
 ],
 "resolution_time": [
  "Ortanca vaka çözüm süresi",
  "Median case resolution time"
 ],
 "queue_age": [
  "En uzun açık vaka beklemesi",
  "Oldest open case wait"
 ],
 "failed_deliveries": [
  "Başarısız / yeniden denenen mesajlar",
  "Failed / retrying outbound"
 ],
 "success_tasks": [
  "Müşteri başarısı görevleri",
  "Customer Success tasks"
 ],
 "survey_topics": [
  "Gizlilik korumalı geri bildirim",
  "Privacy-safe feedback"
 ],
 "funnel": [
  "Kanıta dayalı satış hunisi",
  "Evidence-based sales funnel"
 ]
} as const satisfies Record<MetricId,readonly [string,string]>;
