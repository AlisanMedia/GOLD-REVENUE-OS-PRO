# PILOT-ENTRY-v0.1 — DRAFT / NO-GO

Bu sözleşme16A hazırlık teslimidir;16B–16F uygulama veya ticari pilot yetkisi değildir. Daha önce onaylanmış ürün/survey kararları yeniden sorulmaz. Aşağıdaki canlı işletim girdileri kanıtlarıyla tamamlanmadıkça giriş gate’i kapalıdır. Boşluklar varsayımla doldurulmaz.

## 1. Karar ve kanıt kayıtları

| ID | Gerekli girdiler / sahibi | Kabul kanıtı / durum |
| --- | --- | --- |
| C01 Ürün/pazar | Owner/legal: tek gerçek ticari ürün, approved plan/version, marka, ülke/audience; supplier/resale/territory hakkı | Versiyonlu onay + referanslı sözleşme; service_rights metni lisans sayılmaz. **PENDING** |
| C02 Kanal/merchant | Owner/merchant: tek satış yüzeyi/provider ve merchant eligibility | Telegram-native dijital satış Stars; external crypto yalnız ayrı onaylı independent web. Bot mesajından harici crypto’ya yönlendirme yok. Provider seçilmiş sayılmaz. **PENDING** |
| C03 Gerçek finansal otorite | Merchant/engineering: invoice bağlama, exact received amount/asset/network/decimals/payer/charge/transfer/finality | Authenticated callback + bağımsız verification; immutable receipt+TRUSTED event; replay/duplicate/idempotency; screenshot/precheckout/customer sözü yetmez. **NOT IMPLEMENTED / UNAUTHORIZED HERE** |
| C04 Abonelik/erişim | Owner: duration/grace/cancel/repurchase/overlap/refund etkisi; engineering: trusted period ve numeric Telegram binding | Takvim ay/yıl ve fixed-day korunur. Test→live yok. Join-event, expiry/revoke/reconcile ve provider sonrası stale/hold compensation kabulü gerekir. **PENDING / LATER SCOPE** |
| C05 Tüketici şartları | Owner/legal: fiyat/vergi/discount/renewal/cancel/refund/support ve financial marketing şartları | Onaylı sunulabilir terms; doğrulanmamış performans/garanti iddiası yok. **PENDING** |
| C06 Consent/privacy | Owner/privacy: exact cohort, lawful contact scope, opt-out, contact windows, retention/deletion/legal hold, jurisdictions | Customer kaydı/Telegram username/prior chat/import consent sayılmaz. Survey anonim k≥5/small-cell ve kimlik ayrımı korunur. Tarihsel import kilitli. **PENDING** |
| C07 İnsan operasyonu | Owner: primary/backup on-call, coverage, ack/response SLA, escalation ve uncertain receipt sorumlusu | Operatör takeover→manual EN reply→resolve→safe return akışını ve delivery durumlarını açıklar; manager alarmı için ayrı gerçek gönderim izni. **PENDING** |
| C08 İzolasyon/recovery | Owner/infra: ayrı production app/DB/bot/merchant/secrets, MFA, backup/restore RPO/RTO ve uyumlu rollback | Plan/tarife onayı + ölçülen restore/replay ve receipts/period/membership mutabakatı. Staging target adıproduction olması commercial prod değildir. **NOT AUTHORIZED** |
| C09 Bütçe/kapasite | Owner: sayısal günlük/aylık/per-customer caps; engineering: traffic/burst/query profili | Gerçek provider/altyapı/supplier/support ücret kanıtı; missing cost0 değil. Queue age, p95, failure, rate limit ve retention ölçümü.100 müşteri throughput garantisi değildir. **PENDING** |
| C10 Release/cohort go | Owner: exact release SHA, iki CI, dar acceptance ve her kohort artışı için imza | Governance gerçek ayarlarda enforced olmalı. Gerçek provider transaction/message penceresi ayrıca hedef+tutar/count ile yetkili olmalı. **NO-GO** |

## 2. Finansal doğruluk ve minimum uçtan uca zincir

Genuine provider kaynağı→doğrulanmış gerçek tutarlı receipt→approved offer/plan snapshot→immutable paid period→current numeric identity/channel authority→observed membership→auditable customer state. Her adım aynı tenant ve kaynak anahtarıyla bağlıdır. İki kez gelen olay bir kez uygulanır. Para birimleri/ağlar birleştirilmez; FX politikası onaylanmadıysa dönüşüm yok. PostgreSQL numeric/atomic amount semantiği korunur.

Test faturası, teklif fiyatı, subscription state veya erişim bayrağı tahsilat değildir. Gerçek refunds için actual refund evidence; MRR/ARR için onaylı recurring policy; margin/CAC/LTV/ROI için yeterli cost/attribution gerekir. Bu kaynaklar gelmeden Phase15 unavailable davranışı ve41 metric dictionary değiştirilmez. Bu16A’da financial writer/ledger/adapter eklenmedi.

## 3. Güvenlik ve veri bütünlüğü kabulü

- Wrong tenant/RBAC, client identity authority, screenshot/payment claim, wrong amount/payer/network ve duplicate receipt/period reddi.
- Lease/revision source fencing, concurrent processing, stale completion, retry/backoff,429 ve provider outage; bilinmeyen sonuçta success iddiası veya kör tekrar yok.
- Human takeover/opt-out/consent/window/frequency/outbound kill switch korunur; AI ödeme/entitlement yetkisi kazanmaz.
- English customer default, TR/EN operator locale independence; received/generated/queued/sent/uncertain ayrımı operatör tarafından anlaşılır.
- Anonymous survey identity mapping/log/export yok; k≥5 ve küçük hücre suppression devam eder. Anonim cevap named customer’a bağlanmaz.
- Şema rollback’i için audit/receipt/period silme veya persistent DB reset yok; reviewed forward correction gerekir.

## 4. Incident, stop ve rollback

| Olay | Gate / güvenli davranış |
| --- | --- |
| Yetkisiz tenant/data/financial/access işlemi veya secret/PII sızıntısı | Tolerans0; yeni satış/grant/outbound ve scale durur; owner/on-call incident sahibi olur, audit korunur |
| Receipt/period/VIP veya delivery sonucu tutarsız/belirsiz | Scale yok; kaynak üzerinden reconciliation ve yetkili human action. Customer’a hayalî refund/paid/access/manager-contact beyanı yok |
| Grant kill switch | Yeni grant durdurma mevcut üyeyi geri almaz. Mevcut live_enabled kontrolü revoke claim’ini de durdurabileceği için ayrıca auditli corrective revoke/reconcile yolu tasarlanıp kabul edilmeden canlı açılmaz |
| Worker/provider/queue gecikmesi | Owner-onaylı sayısal queue/expiry/latency hedefi tanımsız veya aşılıyorsa admission/scale durur; kritik düzeltme yolu korunur |
| Bütçe/cap | Günlük/aylık/per-customer sayı onaysızsa pilot no-go; cap aşımı yeni kabul/isteğe bağlı model işini durdurur, kaynak/audit silinmez |
| Web/DB restore | Son uyumlu web sürümü, onaylı RPO/RTO restore drill ve provider event replay; sonrasında100% receipt/period/membership reconciliation. Şu an uygulanmadı |

RPO/RTO, latency/expiry lag, on-call acknowledgment, spend cap ve observation window için rastgele canlı değer seçilmedi. Owner tarafından sayısal hale getirilip ölçümle kanıtlanmaları zorunludur. Bu sözleşmenin varlığı monitoring/restore’ın uygulanmış olduğunu göstermez.

## 5. Bağımlılık sıralı 10→25→50→100 kapıları

| Kapı | Tam önkoşul ve kabul | Go/no-go / risk ve geri dönüş / değer |
| --- | --- | --- |
| 0→10 | C01–C10 tamam; governance enforced; rights/merchant/cohort/consent; ayrı onaylı production/recovery; tek ürün-plan-kanal; gerçek receipt→period→membership100% reconcile; exact SHA iki CI ve yeni dar acceptance | Owner açık10-user go gerekir. Yetkisiz işlem0, açık kritik reconciliation0; budget/on-call tanımlı. Aksi halde0. Yeni admission/grant durur; mevcut hakkı düzeltme yolu ayrı yetkili. Değer: ilk gerçek teslim/tahsilat kanıtı |
| 10→25 | İlk10 için owner-onaylı temiz gözlem penceresi, destek/reconciliation kapanmış; due-renewal/expiry yolu gerçek ya da ayrı izinli kontrolle kanıtlı; hedef25 profili ve burst ölçümü | Owner25-user go; önceki altyapı/cap/rights sınırları aynı. Açık UNCERTAIN0 ve finansal/delivery mutabakatı100%; değilse10’da kal. Değer: tekrarlanabilir onboarding/destek |
| 25→50 | Bounded admin/audit read, stale draining/fairness, outage/crash/permission-loss sonrası recovery; hedef50 yükü, rate-limit ve p95/queue hedefleri | Owner50-user go; staff/DB/runtime/provider/budget sınırları kanıtlı. P0 veya coverage yoksa25 sınırı. Yeni provider/pazar/plan bu artışa gizlenmez. Değer: operasyon birim yükünü ölçme |
| 50→100 | Yeterince olgun gerçek billing/renewal kohortu; hedef100 burst/query profili; restore+replay ve reconciliation hedefleri; kaynaklı maliyet kapsamı ve açıklanan eksikler | Owner100-user go;0 unauthorized action,100% receipt/delivery reconcile. Eksik ekonomi varsa profit unavailable ve bütçe owner tarafından ayrıca kabul edilir; hedefler başarısızsa50’de kal. Değer: yeni marka öncesi kapasite/ekonomi kanıtı |

Tüm kapılarda per-customer consent, privacy/retention, recovery, provider permissions ve aynı ürün/merchant sınırları devam eder. Bir kapı sonrakini otomatik açmaz. Bu sözleşme, Phase16B–16F’nin uygulanmasına veya gerçek kohort alımına izin vermez.

Temel kaynaklar: [B01–B04](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/blob/72e4f8642dac8b8cd76b742cd222a2c4e4b7d1bf/docs/NEXT_EXECUTION_BACKLOG.md#L20), [B06–B10](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/blob/72e4f8642dac8b8cd76b742cd222a2c4e4b7d1bf/docs/NEXT_EXECUTION_BACKLOG.md#L32), [B14](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/blob/72e4f8642dac8b8cd76b742cd222a2c4e4b7d1bf/docs/NEXT_EXECUTION_BACKLOG.md#L45), [ADR006](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/blob/72e4f8642dac8b8cd76b742cd222a2c4e4b7d1bf/docs/adr/ADR_006_PHASE10_MULTI_CHANNEL_PAYMENTS.md#L5), [entitlement claim/completion](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/blob/72e4f8642dac8b8cd76b742cd222a2c4e4b7d1bf/supabase/migrations/20261013222720_phase11_subscription_access.sql#L166), [rollback](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/blob/72e4f8642dac8b8cd76b742cd222a2c4e4b7d1bf/infra/runbooks/rollback.md#L1), [manual pilot dependencies](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/blob/72e4f8642dac8b8cd76b742cd222a2c4e4b7d1bf/MANUAL_ACTIONS_ROADMAP.md#L44), [Phase16 roadmap](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/blob/72e4f8642dac8b8cd76b742cd222a2c4e4b7d1bf/docs/source-of-truth/v1.0.0/IMPLEMENTATION_ROADMAP.md#L60).
