# Gold Revenue OS — Master repository engineering checkpoint

Başlangıç protected main: `79efdaf6cf8f401922ed0cb8cbcb866303a372b2`.
Yetki: 25 Ekim 2026 master directive; repository/offline/disposable PostgreSQL17,
normal protected PR/merge. Hosted migration/deployment, genuine model/provider,
financial/VIP/outbound/import/pilot activation yoktur. Genel Phase16C-1 OPEN.

Bu dosya implementation checkpoint'idir. Exact PR head/merge ve publication
sonrası CI/Vercel kanıtları, ayrıca teslim edilen
`GOLD_REVENUE_OS_MASTER_EXECUTION_OWNER_REPORT.md` dosyasına alınır. Burada
henüz oluşmamış CI veya merge PASS ilan edilmez; status-only PR açılmaz.

## Uygulama ve tekrar kullanılacak mevcut altyapı

1. **Native Claude TEST entegrasyonu:** `polat-runtime-model.ts`, server-only
   `test-model.ts`, mevcut worker/context builder. Server-owned tenant/conversation
   için data-only fake frames; bir fixture budget'ı; forged capability, scope
   değişimi ve tekrar reddi. Genel worker'a genuine Claude selection/sender
   kaydedilmez. Actual decoded output, source registry ve Phase7 QA kullanılır;
   fixture ile cevap değiştirme, fallback ve regeneration yoktur.
2. **SQL kanıt denetimi:** native TEST registry, mevcut PostgreSQL source ve
   matching fake ACK geçmişinden yeniden türetilir. Approved catalog facts ve
   sabit persona identity ayrı tutulur. Tenant/profile, outbound-disabled
   sandbox, generation, source/boundary ve actual wire→resolved output eşleşir.
   Mevcut genuine/general Phase7/9 branch'i korunur. QA guard kaldırılmaz.
3. **Provider kontrol kontratı:** mevcut üç bağımsız authority imzası tekrar
   kullanılır. Server-authenticated tenant owner/MFA, kısa session TTL,
   pinned key snapshot, account/model/manifest/SHA/currency/custody/policy ve
   exact-decimal cap karşılaştırması eklenir. Testler yalnız üretilmiş sentetik
   anahtarları kullanır. Genuine release DORMANT; credential veya permit
   provisioning yapılmaz. Geçerli fixture imzası gerçek account kabulü değildir.
4. **Telegram belirsiz sonuç güvenliği:** manual ve automatic text adapter,
   matching positive message ID + exact numeric chat ACK ister. Network,
   partial/malformed/oversized reply, 408/5xx, wrong destination ve redirect
   uncertainty otomatik retry üretmez. Yalnız matching explicit 429 bounded
   retry üretebilir; permission loss blocked olur. Gönderim cevabı en çok
   64KiB, süre 10sn, sabit Telegram host, redirect yasak. Unknown transport
   sonucu SQL'de mevcut `failed` + `TELEGRAM_DELIVERY_UNCERTAIN` olarak saklanır;
   yeni DB status enum'u uydurulmaz. UI/API bunu **UNKNOWN/review** diye sunar.
5. **Bot/Business sınırı:** offline capability contract; bot, representative ve
   Business connection kimlikleri ayrı; permission/freshness/generation,
   24h private-chat penceresi; human observation, bot echo, edit ve deletion
   ayrımı. Genuine Business webhook/sender veya user-session bağlanmaz.
6. **Operatör görünürlüğü:** mevcut Polat Operations içinde deney kanıtları
   sekmesi; default25/max100 keyset, 30dk role/user/tenant/size-fenced cursor,
   lookahead, current-state/refresh açıklaması, truthful empty/error/UNKNOWN
   durumları. Support için reserve/currency SQL seviyesinde null. Raw account,
   grant, dispatch key/body/request hash, secret, prompt veya payer gösterilmez.
7. **Görüşme geçmişi:** mevcut conversation sayfasında 100 kayıt sınırı
   aşılır; yeni read-only RPC, `(occurred_at,id)` keyset + ingestion anchor,
   default25/max100, 30dk scope-fenced cursor ve bounded lookahead. Mevcut
   message index'i kullanılır; eski RPC/helper silinmez. Aynı zaman damgalı
   252 kayıt atlamadan/çoğaltmadan gezilir. Role/tenant/conversation ve invalid
   cursor kontrolü, explicit projection ve actual authenticated kabulü vardır.
8. **Release inventory:** read-only CLI, HEAD'teki sıralı SQL blob'larını SHA256
   ile bağlar, disabled release inventory üretir/yeniden doğrular. Dirty çalışma
   dosyalarını accepted SHA diye etiketlemez. Hash/flag approval değildir.
   Hosted prerequisites null, model requests/send/deployment authority sıfırdır.

Yeni SQL: tek additive migration
`supabase/migrations/20261025230009_master_operational_reads.sql`.
Yeni writer/table/financial mutation grant yoktur. Tek yeni indeks existing
private experiment runs listesi içindir; message index'i tekrar kullanılır.
Phase10 adapters, classifier, receipt writer, Phase11 consumer/state machines,
Phase15 metric definitions, agent cron, hosted secret ve worker configuration
değiştirilmez. Yeni dependency yoktur.

Mevcut CRM, QA, model contracts, consent/opt-out ledger, human ownership,
native task/outbox, TEST invoices/periods, fenced entitlement jobs, financial
evidence store, analytics null policy, human review ve rollback tekrar
uygulanmamıştır. Bunlar yeni birleşik kabulün kaynaklarıdır.

## Tek birleşik kabul matrisi

`PASS_SYNTHETIC`, gerçek provider/customer/financial kabulü değildir.
Tablodaki eski SQL/concurrency setleri mandatory Database CI içinde exact
publication head ve merge için değerlendirilir; eski historical CI yeni PASS
yerine kullanılmaz.

| ID | Gerekli davranış | Actual kaynak / sınır |
|---|---|---|
| E01 | Inbound kalıcı ve replay güvenli | `polat-runtime-db.test.ts`, `polat_inbound.test.sql` |
| E02 | AI/human/paused sahiplik ve tracked inbound | Native two-turn + takeover race; `polat_contact.test.sql` |
| E03 | Server-owned bounded context, tenant/source generation | Native codec registry + `polat_runtime.test.sql` |
| E04 | Actual structured Claude response | `polat-runtime-model.test.ts`, native two-turn |
| E05 | Aynı actual çıktı QA'ya gider | Native unsafe payment/VIP claim held; SQL wire→resolved checks |
| E06 | Safe reply yalnız yetkili fake transport'a ilerler | Existing queue/ticket/generation + native fake ACK |
| E07 | Matching fake ACK history/CRM'e işlenir | Native two-turn; unknown ledger recovery test |
| E08 | Unsafe/UNKNOWN held, no fabricated ACK | Native unsafe and missing fake ledger cases; adapter uncertainty tests |
| E09 | İlgi/payment claim gerçek para değildir | Native genuine receipt/outbound zero + source/commerce/purchase tests |
| E10 | Sadece uygun TEST ödeme kanıtı TEST dönemine izin verir | `phase10_payments.test.sql`, `phase11_entitlements.test.sql`; genuine receipt/event atomicity DEFERRED |
| E11 | Valid entitlement ve doğru binding olmadan erişim yok | Phase11 wrong-user/tenant, join, expiry, revoke ve Phase16D fake recovery |
| E12 | Refund/expiry/opt-out/takeover engelleri | Contact tests/concurrency; native human takeover; existing entitlement matrices |
| E13 | Crash/replay/restart/races duplicate effect yapmaz | Contact 4 real-backend cases; experiment concurrency/restart; existing fenced recovery |
| E14 | Tenant/RBAC/privacy sınırları | Master read tests; native registry; foundation/tenant and Phase14 privacy regressions |
| E15 | Observed fake usage ≠ actual bill; unknown cost null | Native synthetic telemetry; experiment store; Phase15 analytics unavailable/null tests |

Genuine Anthropic response/latency/billing, Telegram delivery, financial receipt/
event atomicity ve hosted restore bu matriste PASS gösterilmez. Bir prosedür
belgesinin tamamlanması C01–C10'u geçirmez.

## Actual yerel kanıt ve başarısızlık geçmişi

- Domain/contracts: **1820 passed, 0 failed**; v1/v2 fixture/golden hash'leri
  korunur. İnsan naturalness rating yoktur.
- Native PostgreSQL→existing orchestrator→Claude fake codec→exact QA→fake
  transport→ACK→history/CRM: **8 passed**. Üretim sırasında bağımsız bağlantıda
  human takeover eski cevabı fence eder; model çıktısı gönderilmez.
- Affected clean PG17: master reads **45**, QA **109**, catalog **67**, Polat
  runtime **28**, model telemetry **40** assertions. All assertions koşu
  sonucunda ayrıca doğrulanır; psql exit0 tek başına pgTAP PASS sayılmaz.
- Existing independent PostgreSQL contact concurrency: **C1–C4 PASS**;
  actual row-lock wait/backend PID, rollback on own backend termination,
  revision winner ve acknowledged human owner. Fixture/audit retained, tenant
  disabled/suspended cleanup.
- Actual TR/EN components: **8** offline Chromium viewport/keyboard checks
  (320/390/768/1440); external network blocked, synthetic-only screenshots.
- Full integration'ın pre-commit koşusunda clean-repository guard sebebiyle
  human-review CLI testi reddedildi; diğer **496 passed**, **40 deferred**
  environmental tests. Guard gevşetilmez; clean commit/CI yeniden doğrular.
- Lint/typecheck/build/audit local doğrulanır. Mevcut advisory policy korunur;
  yeni ignore eklenmez.

Korunan failed attempts: Node-only entry'nin ilk TS resolution uyumsuzluğu;
integer SQL latency contract ile kesirli Claude duration uyumsuzluğu; generic
SQL registry'nin Polat fake-ACK/persona handles'ını doğrulayamaması; telemetry
test helper'ın iki JSON sonucu tek JSON sanması; history fixture'da yanlış
actor enum/eksik idempotency key; stateful native DB'yi clean-fixture varsayan
legacy QA seti için kullanma. Sonuncusu ayrı clean disposable database ile
çözülür; assertion'lar değiştirilmez. Expected takeover-fence SQL denial log'u
başarısız provider kabulü diye yorumlanmaz.

İndeks synthetic planında 252 experiment, bounded26 lookahead ve top-N/index
planı gözlenir. Bu küçük yerel ölçüm production kapasitesi/latency SLA değildir.

## Devam eden gerçek sınırlar

1. `*_fixture` experiment writer genuine custody değildir. Genuine permit
   issuer, trusted roots/account custody ve hosted executor provision edilmez;
   mevcut network boundary DORMANT kalır. Account/cap/retention/region/billing
   kanıtı ve ayrıca authenticated owner release grant olmadan kullanılamaz.
2. Bot vs Telegram Business genuine modu seçilmemiştir. Offline Business
   capability, actual business webhook/sender veya personal-session kabulü
   değildir. Real identity/rights/consent, exact destinations/count/window ve
   controlled activation release ayrı gate'tir.
3. Provider-neutral payment/source/receipt-consumer architecture vardır;
   eligible merchant/provider, genuine source adapter/receipt writer/activation
   deploy edilmemiştir. Synthetic evidence her zaman NONE kalır. C01/C02/C03/
   C05/C06 gerçek kanıtları olmadan genuine implementation/activation seçilmez.
4. Hosting/backup-restore/MFA/cost/operator kabulü yoktur. Onaylı staging
   deployment yerinde korunur; bu program hosted schema uygulamaz/deploy etmez.
5. Full290/5.00USD proposal onaylanmaz. Human review pending, real-model not
   tested, customer conversion unknown, commercial NO_GO.

Tam executable-scope kabul/stop/rollback ve C01–C10 tablosu:
[Master genuine acceptance runbook](infra/runbooks/master-genuine-acceptance.md).
Sonraki owner kararı küçük bağımsız feature listesi yerine exact-scope dış
prerequisite/custody ve kontrollü kabul/activation release olmalıdır.

Deployment suppression: yalnız
`codex/master-operational-readiness=false`; main=false, eski branch entries ve
cron korunur. Önceki unauthorized Preview olayları **HISTORICAL FAIL — RESOLVED
WITH DOCUMENTED DEVIATION** olarak kalır. Bu çalışma geçmişi silmez ve
`previewDeploymentsDisabled` alanının okunmadığı yerde true olduğunu iddia etmez.
