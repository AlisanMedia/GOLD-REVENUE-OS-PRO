# Gold Revenue OS — kontrollü gerçek kabul prosedürü

25 Ekim 2026 master yetkisi yalnız repository/disposable/CI kapsamındadır. Bu
prosedürün bulunması model, Telegram, hosted migration, deployment veya pilot
izni değildir. `financial_authority=NONE`, `live_operations=false`, pilot `NO_GO`.
Mevcut [pilot sözleşmesi](../../docs/phases/PILOT_ENTRY_v0.1.md),
[ADR-006](../../docs/adr/ADR_006_PHASE10_MULTI_CHANNEL_PAYMENTS.md),
[ADR-007](../../docs/adr/ADR_007_PHASE11_FENCED_ENTITLEMENTS.md),
[recovery runbook](synthetic-recovery.md) ve [rollback ilkeleri](rollback.md)
geçerlidir. Yeni bir approval sistemi veya finansal ledger oluşturulmaz.

## 1. Exact-SHA paket ve yetki ayrımı

Temiz, korunmuş main checkout'unda, Node24/pinned pnpm ile:

```sh
node --experimental-transform-types --import ./scripts/polat-typescript-resolver.mjs \
  ./scripts/master-release-manifest.mjs > /tmp/gold-release-inventory.json
node --experimental-transform-types --import ./scripts/polat-typescript-resolver.mjs \
  ./scripts/master-release-manifest.mjs --check /tmp/gold-release-inventory.json
```

Araç yalnız Git HEAD blob'larından sıralı SQL dosya/hash envanteri çıkarır;
çalışma kopyasındaki değiştirilmiş SQL'i kabul edilmiş SHA diye etiketleyemez.
Dosya duplicate-key kontrolüyle sınırlı okunur. `--approve`, `--execute`,
`--deploy` veya credential parametresi yoktur. `PASS` yalnız artifact
tutarlılığıdır; hosted kabul `NOT_TESTED`, yürütme yetkisi `NONE` kalır.

Release sahibi şu kanıtları ayrıca doğrular:

1. Exact commit için GitHub Actions app15368 kaynaklı **Application** ve
   **Database**, ayrı ayrı completed/success. Ruleset25348710 active, strict,
   PR required, bypass boş, force-push/deletion yasak.
2. PR dosya listesi ve migration hash'leri. Önce disposable PG17 replay,
   pgTAP, native runtime ve concurrency; başarısız geçmiş korunur.
3. Mevcut staging'in değişmeden kaldığına ilişkin deployment/alias/SSO read-back.
4. Migration uygulama, hosting publication ve provider kabul izinleri ayrı
   kayıtlardır. Tek bir JSON, hash, CLI flag veya yönetici checkbox'ı yeterli değildir.

## 2. Hosted staging — henüz yetkisiz

Korunacak mevcut hedef: team `team_fOlNA2ASqhGzUplTDUFGCEDM`, project
`prj_iax5OhGUbLL3s6BemMLqQAHFDAHl`, kabul edilen deployment
`dpl_CawCdTno5JkGjB6b6w1ey1qrCDGw`, SHA
`fe823267365d7f0c554737081a7ff667cc730ae1`. Technical target `production`,
izole **staging** anlamındadır; ticari üretim değildir. İki mevcut staging
domain'i, SSO, cron ve Supabase bağlantısı değiştirilemez.

Yeni hosted kabul ancak owner şu alanları onaylarsa çalıştırılabilir:

- Exact SHA, hedef proje ve Supabase ref; migration dosya/hash listesi;
  hesaplanmış kaynak satır/şema baseline'ı; migration ve deployment ayrı izinleri.
- Secret custody ve MFA/least privilege; gerçek secret değeri rapora/CLI'ye
  taşınmaz. Envanterde yalnız isim/korumalı referans ve sorumlu rol bulunur.
- Onaylı backup/restore kanıtı, saklama, legal hold sınırı ve **owner tarafından
  belirlenen** RPO/RTO. Disposable logical restore hosted PITR kanıtı değildir.
- Asıl ve yedek operatör; izleme penceresi; kabul edilen gecikme, hata, kapasite
  ve maliyet limitleri. Bilinmeyen süre/bütçeler doldurulmaz.

Uygulanabilir sıra: korumalı backup → izole restore ve fingerprint/RLS kontrolü
→ exact migration replay → aynı SHA Application/Database read-back → tenant
outbound, model, finance, entitlement ve import kapıları kapalıyken publication
→ authenticated TR/EN rol/HTTP smoke → yalnız sentetik fixture E2E → güvenlik
read-back → fixture disable/cleanup (audit korunur).

Mevcut `.github/workflows/staging.yml` **yalnız ayrıca yetkilendirilmiş release**
için kullanılabilir. `validated_commit_sha` exact SHA'dır. Provider yan etkisi
doğuran `run_telegram_live`, `configure_openai_shadow`, `verify_openai_evidence`,
`retry_resolved_openai_quota_tasks` kapalı kalır; model testi bu eski OpenAI
anahtarlarını kullanmaz. Cron/worker ve her sandbox activation flag'i ayrıca
incelenir. Workflow dispatch bu master programda **çalıştırılmaz**.

Rollback tetikleri: tenant/rol ihlali; tanımsız model isteği; bilinmeyen veya
çift dış etki; gerçek finans kaydı iddiası; opt-out/takeover ihlali; kaybolan
audit; owner limiti aşımı. Önce admission/dispatch durur, kayıtlar korunur;
eski bilinen uygulama sürümüne dönüş ve reviewed forward SQL correction
uygulanır. Receipt, audit, dönem ve unresolved revoke/repair kayıtları silinmez.
ACK kaybı yeniden gönderim izni değildir.

## 3. Anthropic: tek canary, sonra ayrı tam değerlendirme

Mevcut [canary v1](../../docs/phases/POLAT_CLAUDE_CANARY_v1.md) bir sentetik
EN/DIRECT turn'dür. Corpus, plan hash ve target hash aynen bu plandan alınır.
Bu, v2 corpus'un 290 isteği veya önerilen 5.00 USD için izin değildir.

İlk gerçek istek öncesi zorunlu kayıt:

1. Exact accepted SHA; `claude-haiku-5-5`; Messages protocol pin'i; canary
   plan/corpus/manifest hash; **bir** istek; owner'ın onayladığı output/timeout,
   exact decimal maksimum sorumluluk, currency, zaman penceresi ve stop koşulları.
2. Sağlayıcı hesabının kullanılabilirliği/merchant dışı model billing hesabı,
   region, retention/training şartları ve synthetic-data handling kabulü;
   gerçek enforced experiment/account cap ve bağımsız billing erişim kanıtı.
   Workspace aylık cap'i transactional deney budget'ı sayılmaz.
3. MFA ile doğrulanmış tenant owner; bağımsız owner/account-control/committed
   reservation imzaları, ayrı güven kökleri, kısa TTL ve tam request/body bağı.
4. Hosted durable custody ve gerçek executor provisioning/release ayrıca
   incelenir. Mevcut `*_fixture` PostgreSQL yazarları **genuine backend olarak
   yeniden adlandırılamaz**. Şu anki release DORMANT; permit issuer/credential
   binding kurulmamıştır. Bu bilinçli kapalı alan gerçek canary kabulü değildir.
5. Korunan credential referansı, yalnız server erişimi ve tek-scope kısa ömürlü
   kullanım. Bu program hiçbir gerçek credential yüklemez/okumaz.

Kabul: durable reservation COMMIT → ayrı dispatch START COMMIT → tek sabit-host
HTTPS çağrısı → actual native output → Phase7 QA → usage/UNKNOWN cost evidence
COMMIT → bağımsız provider billing reconciliation. Timeout/partial/5xx/ACK
kaybında tekrar yok. Gecikmiş sonuç append-only'dir. Bütçe, source/model/SHA,
policy veya billing belirsizliğinde durulur. API shape/protocol uyumu gerçek
canary ile doğrulanmadan tam corpus başlamaz. QA red olursa alternatif güvenli
fixture cevap başarılı model sonucu diye sunulmaz.

Tam v2 deneyi; ayrıca exact corpus hash, 290 dahil failed attempt budget'ı,
harcama/currency, named monitoring owner ve iki bağımsız human reviewer ister.
İnsan incelemesi yapılmadan naturalness `NOT_MEASURED` kalır.

## 4. Telegram: bot ile Business kimliğini karıştırmayın

Resmi kaynaklar, 25 Ekim 2026 okunmuştur:
[Bot API / Business](https://core.telegram.org/bots/api#businessconnection),
[BusinessBotRights](https://core.telegram.org/bots/api#businessbotrights),
[sendMessage](https://core.telegram.org/bots/api#sendmessage).

Normal bot hesabı Polat'ın kişisel hesabı değildir. Username ve geçmiş numeric
ID sahiplik veya bugünkü Business/channel yetkisi değildir. Normal üye session'ı
da bot API ile kaynak kanal okuma hakkı sağlamaz. Business kullanımında
server-verified connection ID, bağlı gerçek kullanıcı/bot kimlikleri,
`is_enabled`, `can_reply` ve son 24 saatte inbound bulunan private-chat penceresi
gerekir. Session login, MTProto ve protected-content bypass bu programda yoktur.

Mevcut HTTP webhook normal private bot mesajlarını kalıcı ingest eder. Yeni
Business capability sözleşmesi **offline normalization** içindir; gerçek
Business webhook/sender kaydı yapılmaz. Seçilecek BOT veya BUSINESS modu,
genuine identity/connection custody ve bunu native kalıcı gateway'e bağlayan
kontrollü activation release ayrıca incelenmelidir. Business edit/delete veya
insan yanıtı doğrudan AI komutu sayılmaz; ownership/revision kaydı önce commit
edilir. Bot echo'su insan devralması sayılmaz. Silinmiş kaynak, teslimin geri
alındığı anlamına gelmez.

Genuine kabul izni: exact SHA; doğrulanmış bot/business kimlikleri; tam
allowlisted private test chat/destination ID'leri; tenant; mesaj sayısı ve
zaman penceresi; asıl/yedek operator; consent ve opt-out kapsamı; backup/stop
koşulları. Eski staging kanalını yeni live hedef olarak seçmeyin.

Önce read-only identity/permissions → tek inbound ve duplicate replay →
insan sahipliği → yalnız izin verilen sayıda QA-approved test yanıtı → tam
chat ID/message ID ACK eşleşmesi → takeover/opt-out ve pause kanıtı →
permission-loss/429/UNKNOWN incelemesi → mevcut durumun read-back'i. Gerçek
Telegram ACK yalnız provider kabulüdür; müşterinin gördüğü/okuduğu kanıtı değildir.
İzin bu programda verilmediği için hiçbir adım gerçek hesapta çalıştırılmaz.

## 5. Ödeme ve VIP: kanal, merchant ve receipt yetkisi

[Telegram Stars resmi politikası](https://core.telegram.org/bots/payments-stars)
dijital ürün/hizmetin bot/Mini App içinden satışında Stars ister. Bağımsız web
checkout ayrı bir satış yüzeyidir; Telegram dijital satışını crypto linkine
yönlendirmek alternatif izin sayılmaz. Coin/network/wallet/merchant/jurisdiction
seçilmemiştir. Platform politikası hukuk/vergi onayı değildir.

C01/C02/C03/C05/C06 kanıtları ve owner grant olmadan genuine writer, provider
adapter activation veya trusted `payment.confirmed` route açılmaz. Mevcut
provider-neutral FinancialSourceContract; actual received atomic units, tam
asset/network/precision, payer/recipient, merchant/invoice/product snapshot,
callback authentication + independent read, finality, global operation/physical
identity, refund/reorg ve complete history ister. Hash/screenshot/customer
beyanı/manager onayı gerçek receipt yetkisi değildir.

Genuine provider acceptance; önce kesin provider/merchant/country/asset policy,
exact payment/refund sayısı ve üst tutar izni ister. Sonra yanlış tenant/payer/
tutar/network, replay, duplicate operation, late payment, refund-before-payment,
partial refunds, outage ve crash-recovery kanıtları alınır. Genuine immutable
receipt ve event v1 birlikte atomic commit olmadan production consumer açılmaz.
`private.verified_payment_receipts`, `provider_reference` uniqueness, legacy
`tx_hash` ve Phase11 consumer değişmez. Synthetic FSE `NONE` ve
`payment.test_observed` genuine event değildir.

VIP kabulü ayrıca tam kullanıcı/channel/bot ID allowlist'i, join-request
eşleşmesi, haklar, bağımsız membership observation, renewal/expiry/refund
sonuçları ve revoke/reconciliation güvenliği ister. Admission kapalıyken
genuine revoke/repair için ayrı yetki gerekir; global LIVE switch gevşetilmez.

## 6. İlk on müşteri ve C01–C10

| Kapı | Mevcut kanıt / eksik | Sorumlu | Durum / kabul |
|---|---|---|---|
| C01 | Owner ticari ilişki bildirdi; redistribution/sublicense/territory sözleşmesi doğrulanmadı | Owner + supplier + yetkili hukuk | BLOCKED: tek ürün, supplier ve pazar hakları |
| C02 | Stars/independent-web ayrımı kodlu; gerçek merchant/rail uygunluğu yok | Owner + merchant/provider | BLOCKED: exact channel/merchant eligibility |
| C03 | Source contract/FSE ve TEST observation/period kanıtları; genuine receipt writer/activation yok | Finans sorumlusu (atanmamış) + engineering | BLOCKED: gerçek callback/read/receipt/event atomicity |
| C04 | TEST lifecycle ve tarihsel sınırlı Phase11 Telegram kabulü; yeni production hedef yok | Owner + access operator (atanmamış) | BLOCKED: exact yeni binding ve revoke/recovery kabulü |
| C05 | Approved fixture facts var; gerçek fiyat/vergi/refund/terms/jurisdiction kararı yok | Owner + hukuk/vergi | BLOCKED: yayınlanabilir tek ürün koşulları |
| C06 | Synthetic consent/opt-out/takeover kontrolü var; gerçek cohort/consent/retention kanıtı yok | Owner + privacy sorumlusu | BLOCKED: on uygun, izinli müşteri; imports kapalı |
| C07 | Queue/handoff/review görünürlüğü ve runbook var; named primary/backup ve coverage yok | Owner | BLOCKED: vardiya ve gerçek incident rehearsal |
| C08 | SSO ve izole mevcut staging var; yeni release/hosted restore/RPO/RTO kabulü yok | Owner + infra sorumlusu | BLOCKED: MFA/custody/backup-restore kabulü |
| C09 | Sentetik latency/load ve bounded queries var; actual provider/supplier/infra/staff maliyeti yok | Owner + finans + engineering | NOT_TESTED: kaynaklı maliyet, caps ve gerçek kapasite |
| C10 | Repository CI ticari GO değildir | Owner | BLOCKED: tüm kapılar + ayrı exact release/cohort GO |

Bu tablo status belgesiyle gate PASS yapmaz. Önce ayrı model, Telegram ve
payment/hosting kabul kayıtları; ardından on consenting eligible müşteri için
ayrı owner GO. 25/50/100'e her geçiş; gerçek support yükü, delivery accuracy,
reconciliation, provider limitleri, incident/restore ve kaynaklı economics
kanıtı ile ayrıca onaylanır. Hazırlık yüzdesi, tahmini ROI veya garantili satış
sonucu üretilmez.
