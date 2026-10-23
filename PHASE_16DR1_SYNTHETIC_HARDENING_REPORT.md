# TEST reliability hardening — uygulama kanıtı

23 Ekim 2026. Başlangıç main: `3553cabfe0951dab64f92d1236b2f2fe12df6cf7`.
Owner yalnız tek repository/disposable PostgreSQL17 sentetik paketini, normal
protected PR/merge ve iki mandatory CI kapısını yetkilendirdi. Genel16C-1 açık;
ticari pilot NO-GO. Önceki kabul raporları değiştirilmez.

Bu dosya commit öncesi teknik checkpoint'tir. PR-head/merge SHA ve CI sonuçları
henüz oluşmadan PASS diye yazılmaz. Final indirilebilir owner raporu exact PR,
head/main, Application/Database run ve job kimliklerini, final Vercel read-back'i
ayrıca kaydeder. Birleştirme ancak iki gerçek GitHub Actions15368 check SUCCESS
olduğunda normal protected süreçten yapılabilir.

## 1. Teslim edilen dar davranış

| Risk | Uygulanan TEST sınırı |
| --- | --- |
| Tekrarlayan crash/lease loss | Private persisted job runtime: en fazla7 lifetime claim,2 pre-dispatch reclaim. Üçüncü expired pre-dispatch lease FAILED/REVIEW; otomatik reset yok. |
| Açık provider failure | Ayrı sayaçla5 failure; mevcut20/40/80/160/300s backoff korunur. Crash bu sayaca provider failure diye yazılmaz. |
| Başlamış etkinin bilinmeyen sonucu | Adapter öncesi server-owned begin marker persist edilir. Marker ACK kaybında adapter çağrılmaz. Dispatch sonrası timeout, expired lease, exception veya malformed result kör tekrar yerine FAILED/REVIEW olur. |
| Kayıp completion ACK | Gerçek DB commit DONE ise yeniden claim edilmez; commit olmamış/sonucu belirsiz dispatch yeniden gönderilmez. Eski token completion yapamaz. |
| Büyük eski kuyruk | Cycle başına en fazla32 candidate, candidate başına en fazla3 indexed lane-head probe ve en fazla1 leased job. Sonraki cycle için has_more; işlenmemiş kuyruk başarı değildir. |
| Fairness | Tenant-scoped persisted revoke→reconcile→invite/join round-robin. `(available_at,id)` tie-break; scheduler ve row locks nonblocking. Disabled lane ve inceleme gerektiren admission diğer lane'leri sonsuza dek bloke etmez. |
| Revoke/repair yükümlülüğü | Eski revision işi auditli STALE; gerekli current-revision revoke/reconcile unique anahtarla korunur. Yeni belirsiz etki önceki terminal/DONE mutabakatıyla kapatılmaz; kaynak FAILED/REVIEW olarak görünür kalır. |
| Yetki ayrımı | Yalnız private TEST policy: admission, reconciliation, revocation ayrı simülasyon. Grant üreten repair yine admission ister. Global LIVE kill switch ve gerçek adapter registration değişmez. |

Yeni additive migration iki private RLS tablosu, güvenli internal helpers ve iki
service-role-only TEST RPC ekler: `entitlement_test_claim_cycle_v1` ve
`entitlement_test_begin_effect_v1`. Runtime/browser/AI policy veya budget
tablosuna yazamaz. Public/anon/authenticated yeni writer yetkisi almaz.

Eski `entitlement_claim_job` ve `entitlement_complete_job` imzaları korunur.
Sadece mode=test için ortak hardened helper'a delegasyon vardır. Legacy
single-claim bir STALE sonrasında null dönebilir; yeni service bounded cycle'ı
kullanır. Mevcut Phase11 script/contract compatibility korunur. Legacy doğrudan
TEST completion fake sonuç kabulünü korur; gerçek source/financial yetki değildir.
Legacy-issued lease izlenmediği için expiry'de unknown review olur; iki güvenli
pre-dispatch reclaim yalnız tracked cycle içindir. Yeni service her effect için
begin marker şartını uygular. Migrasyon öncesinden
marker olmadan kalan RUNNING belirsizliği reclaim edilmez.

LIVE fonksiyon gövdeleri yeni TEST hook ve tek local variable çıkarıldığında
orijinal Phase11 metniyle birebir eşleşir. Finans/receipt/event/period, calendar
duration, subscription consumer, gerçek Telegram adapter ve LIVE kontrolü
değişmez. Yeni lane indeksi sorgu planını destekler; gerçek üretim throughput veya
hosted rollout kanıtı değildir. Eski `entitlement_tick` bakım döngüsü değiştirilmez;
32 sınırı job-drain'e aittir, tüm tick'in sabit süre garantisi değildir.

## 2. Yerel sentetik kabul

| Kontrol | Gerçekte gözlenen sonuç |
| --- | --- |
| Fresh PG17 migration replay | PASS; yalnız ayrılmış disposable DB'ler |
| Yeni pgTAP |148/148 PASS: budget,5 provider failures+2 crash, malformed/unknown, legacy replay denial, stale fencing, atomic review/audit rollback,1024 STALE backlog, lane fairness, RBAC ve LIVE-off negative fixture |
| İki gerçek bağlantı |4/4 senaryo PASS: pre-COMMIT process death+atomic rollback; unknown revoke re-claim denial;4096 STALE +1 valid fake revoke; concurrent hold/revision sonrası late-result fencing+deduplicated compensation |
| Etkilenen Phase11 SQL |167/167 PASS |
| Etkilenen önceki16D SQL |67/67 PASS |
| Etkilenen önceki16D concurrency |3/3 PASS; tracked acquisition ve pre-effect marker ile güncellendi; eski real-provider kabulü tekrar edilmedi |
| Worker/transport integration |26/26 PASS; fetch yasak, begin ACK/error ve malformed sonuç sınırı dahil |
| Tüm unit |796 PASS |
| Tüm integration |327 PASS,9 DB-context SKIP; eski v1→DB bridge Database CI'da ayrıca gerekir |
| Lint / strict TypeScript / build |PASS |
| Audit |Mevcut exact GHSA exception ve high severity policy değişmeden PASS |

Karşılaştırma aynı disposable4096 backlog ile `EXPLAIN (ANALYZE,BUFFERS)`:
legacy global head4097 satır ve74 shared hits, execution1.179ms; yeni lane head1
satır ve3 hits, execution0.025ms. Bu tek warm-cache fixture ölçümüdür. Tüm worker
throughput'u, worst-case tarama, production capacity veya SLA garantisi değildir.

Restore fingerprint yeni TEST runtime/policy satırları, ACL/RLS/owner ve ilgili
fonksiyon gövdelerini de kapsar. Mevcut Database CI, değişiklikten etkilenen
logical recovery'yi bu alanlarla tekrar doğrulamalıdır; kaynak dump/lease/source
verisi artifact'e çıkmaz. Genuine provider/receipt/event atomicity, hosted restore
ve actual Telegram acceptance DEFERRED kalır.

## 3. Korunan başarısız denemeler ve düzeltmeler

- Yerel genişletilmiş testte `status` kolon adı iki joined tabloda belirsizdi;
  testte `a.status` ile düzeltildi. Tarihsel failed log korunur.
- İlk gerçek concurrency testi, `INSERT .. ON CONFLICT DO NOTHING` ifadesinin
  başka scheduler updater'ını bekleyebildiğini yakaladı. TEST cycle initialization
  nonblocking advisory guard ve existence check ile düzeltildi; live yol değişmedi.
- İlk4096 test driver'ı busy/no-work dönüşlerini drain ilerlemesi sayarak erken
  bitti. Driver'a bounded1024-cycle cap,2ms contention backoff ve temiz erken çıkış
  eklendi. Her runtime çağrının32 üst sınırı değişmedi. İlk başarısız fixture ve
  ardından başarılı gerçek iki-connection kanıtı birbirinin yerine yazılmadı.
- Otomatik güvenlik incelemesi host loopback DSN'ini belirsiz bularak çalıştırmayı
  durdurdu. Exact container kimliği, port olmaması ve owned DB yeniden doğrulandı;
  script container içinde çalıştırıldı. Hosted veya farklı DB'ye yazılmadı.
- Sandbox'ta full integration, mevcut git check-ignore/stdin testinde bekledi;
  yalnız o test ağacı durduruldu. Aynı suite native pinned runtime'da süre sınırı
  altında PASS oldu. Bu ortam sorunu için kaynak testleri gevşetilmedi.

## 4. Dağıtım ve güvenlik sınırı

İlk push zaten `codex/phase16d-r1-synthetic-hardening=false` içerir. `main=false`,
bütün eski branch entries, framework/build/crons aynıdır. Vercel setting,
environment/secret, alias, Git bağlantısı veya kabul edilmiş staging deployment
değiştirilmez. Preview Branch Tracking'in kapalı olması küresel Preview yasağı
diye sunulmaz; exact branch suppression ve passive deployment read-back gerekir.
Geçmiş16C-1A Preview olayı **HISTORICAL FAIL — RESOLVED WITH DOCUMENTED DEVIATION**
olarak kalır.

Hosted Supabase migration, staging/production deployment, provider/Telegram
mesajı, gerçek para/refund, genuine receipt writer, trusted payment.confirmed,
VIP grant/revoke, customer outbound, import, yeni servis ve pilot yoktur.

## 5. LIVE için kalan bağımsız kapı ve sonraki güvenli sınır

TEST policy gerçek permission değildir. Minimum genuine tasarım: global LIVE
stop her gerçek effect'i reddetmeye devam eder; ileride ayrıca onaylanmış ayrı
admission kapatılabilir. Admission-off/global-authority-on altında yalnız exact
tenant/job/revision/identity/channel'a bağlı, süre/count/spend bounded corrective
revoke/reconcile capability, named operator/owner onayı, gerçek bağımsız provider
kanıtı, append-only audit ve negative acceptance gerekir. Bu paket o capability'yi
ve global stop için bypass oluşturmaz. LIVE-off altında gerçek revoke hâlâ durur.

Önceki [C01–C10 sözleşmesi](docs/phases/PILOT_ENTRY_v0.1.md) değişmedi:
C01 ürün/pazar/rights; C02 kanal/merchant; C03 gerçek financial source+writer;
C04 genuine subscription/access/repair acceptance; C05 terms/tax/refund;
C06 consent/privacy/retention; C07 named staff/coverage; C08 production backup,
MFA/RPO/RTO; C09 gerçek cost/budget/capacity; C10 exact release ve her cohort GO.
Hiçbiri sentetik passing CI nedeniyle otomatik onaylanmaz.

Yeni en küçük öneri, sentetik uncertain-review çözümünün operator sözleşmesi ve
bağımsız fake-observation kanıtıyla yeniden izin verme tasarımıdır. Otomatik
review reset veya ek bütçe yoktur. Live policy/provider/writer/hosted scheduler
ve pilot ayrı owner scope ister. Bu tek paket sonunda genel16C-1 kapanmaz.
