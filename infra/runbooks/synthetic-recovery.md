# Sentetik erişim ve çevrimdışı kurtarma

Bu runbook 23 Ekim 2026 continuous owner yetkisiyle yalnız repository/CI ve
disposable PostgreSQL17 içindir. Hosted DB, staging/production deployment,
gerçek provider, Telegram, genuine receipt/event ve pilot yetkisi vermez.
Ticari/operasyonel kararlar [pilot sözleşmesinde](../../docs/phases/PILOT_ENTRY_v0.1.md)
ayrı gate olarak kalır. Eski [rollback ilkeleri](rollback.md) geçerlidir.

## Çalıştırma ve kanıt

Mandatory Database CI, migration replay ve mevcut regresyonlardan sonra sırasıyla:

1. `phase16d_fulfillment_recovery.test.sql`: TEST invoice/period ve fake access;
   her şeyi transaction sonunda rollback eder. Explicit provider failure beş
   attempt sonunda FAILED; backoff20/40/80/160/300 saniyedir. Gerçekte beklemek
   yerine yalnız fixture available_at/lease_until değiştirilir.
2. `phase16d_concurrency.sh`: fresh, outbound-disabled `phase11-sandbox-16de-*`
   fixture kurar. İki gerçek backend, SKIP LOCKED, own pre-COMMIT backend death,
   response-loss lease ve revision/compensating revoke senaryolarını sınar.
3. `phase16e_offline_recovery.sh`: exact local Docker PostgreSQL17 üzerinde
   `public/private/auth/extensions` logical snapshot'ını kendi oluşturduğu ikinci
   geçici DB'ye restore eder. Kaynak DB asla drop/reset edilmez. Tam Storage,
   diğer Supabase managed schemas, secrets, global roles, WAL/PITR ve gerçek
   production recovery kanıtı değildir. Aynı cluster'daki mevcut roller kullanılır.
   Supabase'in korumalı Auth sahiplerini korumak için yalnız yeni disposable
   restore kopyasında mevcut local supabase_admin engine administrator seçilir;
   plainPG17'de mevcut postgres kullanılır. Rol/grant oluşturulmaz, owner/ACL
   dump'tan çıkarılmaz; mevcut yetkili restore login yoksa test durur.
4. Fingerprint;10 FSE tablo, audit, periods/jobs/access ve FSE function/ACL/RLS
   metadata'sını karşılaştırır. Restore kopyasında gerçek SQLSTATE42501 denial ve
   append-only testleri çalışır. Kaynak ve kopya değişmemiş olmalıdır.
5. Gerçek authenticated manager role ile public bounded read RPC'sine1/4/8 DB
   connection profili uygulanır. Her client25 read-only transaction çalıştırır;
   p50/p95/max ölçülür. DB client sayısı müşteri sayısı değildir. API/TLS/provider
   gecikmesi, region/network ve üretim maliyetini kapsamaz.

Script yalnız loopback DSN ve exact `supabase_db_gold-revenue-os` test container'ını
kabul eder. Cloud geliştirmede ayrılmış `gold16c1b-pg17` alternatifi vardır. Başka
container, hosted adres, PG sürümü, genuine receipt/LIVE subscription/access veya
TRUSTED payment.confirmed görülürse fail closed. Fixture satır/boyut budget'ları
tatbikatı sınırlar. Dump, raw source, customer/payer bilgisi, lease ve DSN artifact'e
yazılmaz. Temp files private, dump ve restore DB cleanup edilir. Read-load source
fingerprint eşitliği doğrulandıktan sonra yalnız owned FSE admission/writes ve
16D/E synthetic tenant'ları disabled/suspended yapılır; history/audit silinmez. CI container da
sonunda kaldırılır. Yalnız sanitizer sonuçları `database-test-evidence` artifact'idir.

## Olayı inceleme ve güvenli karar

| Gözlem | Anlamı / sonraki adım |
| --- | --- |
| PENDING + available_at future | Persisted retry bekliyor; başarılı teslim diye sunulmaz. Hızlandırmak için hosted timestamp/state değiştirilmez. |
| RUNNING + geçerli lease | Başka worker sorumlu olabilir. Aynı dış işlemi kör tekrar etmek yok. |
| Expired RUNNING lease | Testte token değişerek reclaim edilir; eski completion reddedilir. Gerçek provider effect bağımsız mutabakat gerektirir. |
| FAILED | Explicit provider failure bütçesi doldu. Owner/manager review; kayıt veya audit silinmez. |
| STALE | Eski revision/grant artık geçerli değil. Mevcut abonelik ve yeni revoke/repair işi incelenir. Tek claim STALE tüketince null dönebilir; yeni cycle gerekir. |
| REVIEW / belirsiz completion | Provider yan etkisi ile DB kararı ayrı değerlendirilir. DB'de MEMBER/PAID uydurulmaz. |
| Backup/fingerprint/ACL uyuşmazlığı | NO-GO; restore sonucu güvenilir değildir. Başarısız evidence saklanır, kaynak geçmiş değiştirilmez. |
| Eksik finans/cost/merchant kanıtı | UNAVAILABLE/UNRESOLVED; sıfır veya100% marj değildir. |

Offline gözlemde pending/running/failed/stale sayısı, expired lease sayısı,
oldest queued age, version/revision uyuşmazlığı ve reconciliation backlog izlenir.
Bunlar yeni alarm servisi veya canlı schedule değildir. Named primary/backup,
ack/response/queue-age/p95 hedefleri, retry/spend cap ve escalation destinations
owner kararıdır; bu belgede uydurulmaz. Phase12 operator vaka/takeover akışı
yeniden kullanılmalı; Türkçe operator dili müşteri English default'unu değiştirmez.

## Gerçek işletim öncesi açık sınırlar

- Global live-off mevcut revoke yolunu da durdurur; yeni admission ve güvenli
  revoke/repair authority ayrımı genuine activation tasarımında ayrıca çözülmeli.
- Explicit failure5 kez sınırlandırılmıştır; tekrar tekrar lease kaybeden/crash
  eden jobs için SQL claim'de ömür boyu toplam attempt ceiling yoktur. Bu testin
  bounded senaryoları böyle bir ceiling'i kanıtlamaz. Gerçek sağlayıcı maliyet ve
  retry policy ayrı gate'tir; mevcut accepted migration değiştirilmedi.
- Grant sonrası lease/hold yarışı gerçek provider'da geri alınamaz sayılmaz;
  bu paket fake side effect + queued compensation kanıtıdır. Actual provider
  idempotency, permission/rate-limit ve reconcile kabulü ayrıca yetkilendirilmeli.
- Restore mevcut15/16C şemasına logical recovery'yi sınar. Point-in-time loss
  budget, hedef RPO/RTO, başka cluster/region/global roles/Storage recovery,
  MFA/secrets ve üretim tarife/backup erişimi henüz kabul edilmiş değildir.
- Persistent schema rollback'de audit/receipt/period silinmez. Uyumlu önceki app
  release ve reviewed forward migration ayrı exact-SHA release yetkisi gerektirir.
  Burada rollback/promote/deploy çalıştırılmaz.

Önce yetkili synthetic gate, sonra bağımsız ticari/merchant/source kararları,
ardından separately authorized genuine integration ve recovery kabulü. Her
10→25→50→100 artışı ayrı owner GO ister; bu dosya cohort başlatmaz.
