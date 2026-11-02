# Private beta: exact-SHA isolated staging release

26 Ekim 2026 founder UAT yetkisi, ticari üretim veya ücretli müşteri GO kararı değildir.
Bu dosya bir sonucu onaylamaz. Actual run/deployment/migration kimlikleri raporda
ayrı gösterilir. Başarılı mock test, hosted backup veya gerçek Admin girişi değildir.

## Kurucuya özel hızlı konuşma testi — yeni owner kapsamı

Kurucunun harcama belgesi şartını kişisel deneme için kaldıran son talimatı,
**yalnız OWNER_ONLY** OpenAI testine uygulanır.18USD bakiye doğrulanmış sayılmaz;
yeni bir bütçe veya yeniden350 çağrı hakkı oluşturulmaz. Aynı programın mevcut
journal/attempt kayıtları kullanılır. Ticari/friends hesap otoritesi değişmez.

`release_with_business_setup`, mevcut korumalı backup/restore/migration/yayın
kontrollerinden sonra gerçek model/anahtar ve güncel resmî fiyat metadata'sını
özel DB'ye kaydeder. Model, key/project header'ları ve SHA gerçekten gözlenir;
provider hard cap, veri yerleşimi veya gerçek fatura uydurulmaz. Public data-policy
kaynak hash'i, kuruluşa özel data-control kabulü anlamına gelmez.

Kurucu, güncel MFA ile mevcut Admin'de **Start One Genuine Canary Request**'e
basar. Aynı gerçek owner RPC'si gözlemi son yayına bağlar, mevcut30 günlük retention'ı
korur ve en fazla24 saatlik test penceresini açar. Tek Hi/English/DIRECT isteği,
512 output/10s ve mevcut QA kullanılır. Tekrar, fallback veya regeneration yoktur.
Başarılı yanıt+pozitif usage+QA yalnız **OWNER_TEST_READY** oluşturur;
`canary_reconciliation_hash` veya bağımsız fatura kaydı yazılmaz.

Yerel5USD bütçesi önce tam context için4.628448USD muhafazakâr rezerv alır.
Fiyatlar, resmî4/15 uzun-context oranlarına10% olası bölgesel primi dahil eder.
Yalnız gerçekten başarılı/QA-approved, kimliği ve usage'si kayıtlı yanıttan sonra
bu kişisel modda usage × muhafazakâr oran ile **tahmini yerel bütçe hesabı** yapılır.
Bu tutar actual bill değildir. Başarısız/HELD/UNKNOWN veya eksik/taşan usage tüm
rezervi tutar ve durur. Eski bağımsız hesap/billing akışı değiştirilmez.

Aynı onaylı job kurucunun gerçek canary işlemini sınırlı süre bekler; sonra gerçek
getMe ve getUpdates ile aday sayısal Business bağlantılarını özel Admin'e getirir.
Kurucu, **Configure One Test Chat** ekranında yalnız kendi sohbetini bağlar.
Job gerçek getBusinessConnection ile izinleri doğrulamadan webhook kurmaz.
Mevcut Automation Bypass yalnız relay'in özel secret custody'sinde kullanılır;
Admin SSO/global JWT/CI kapatılmaz. Bir başka webhook üzerine yazılmaz, mesaj
veya paid inference workflow tarafından otomatik başlatılmaz.

Kurucu daha sonra **Open Founder Conversation Test** ile tek kişisel sohbeti açar;
bu modda ikinci operatör veya arkadaş daveti gerekmez. Mevcut tek kullanımlık
FOUNDER daveti ve gerçek Telegram `/agree`/notice yolu korunur. Yanıt ancak
numeric Business kimliği, participant/source, native QA ve delivery gate'leriyle
çıkar. START her mesajda tekrarlanmaz. **Stop Test**, aynı durable STOP'u kullanır.

Job bekleme süresinde kullanıcı işlemi tamamlanmazsa artifact
`OWNER_ACTION_REQUIRED` der; bu Telegram/model acceptance PASS değildir.
`founder_business_setup`, aynı deployed SHA üzerinde yalnız bağlantıyı sürdürür;
deployment/migration yapmaz. `founder_model_setup` yalnız korumalı metadata
collector'ını çalıştırır. Yeni inference denemesi veya başarısız canary reset'i yoktur.

## Tek korumalı Stage B işlemi

`Private Beta UAT Release` workflow'u yalnız `main` üzerinde manuel başlatılır.
Varsayılan `operation=release_disabled`; ayrı `account_preflight` modu yalnız
read-only hesap/model/usage gözlemi üretir, gerçek inference veya grant yazmaz:

- `validated_commit_sha`: o anda protected main olan, iki mandatory CI job'u
  exact SHA için GitHub Actions15368 üzerinden SUCCESS olan40 karakter SHA.
- `backup_retention_days`: founder'ın belirlediği şifreli recovery artifact saklama
  süresi1–30 gün. Bu alan gerçek sohbet/veri saklama politikasının yerine geçmez.

Mevcut `staging` GitHub environment'ının reviewer'ı AlisanMedia; exact main
branch policy ve admin bypass yasağı yeniden okunur. Read-back erişimi403/eksikse
job hosted işlemden önce durur; ayar veya zorunlu CI düşürülmez. Workflow onayı
founder tarafından güvenli GitHub arayüzünden verilir; Codex bunu bypass etmez.

### GitHub governance read-back kimliği —28 Ekim2026

GitHub'ın [Get a repository ruleset](https://docs.github.com/en/rest/repos/rules?apiVersion=2022-11-28#get-a-repository-ruleset)
belgesi, `bypass_actors` alanının yalnız ruleset üzerinde write erişimi olan
kimliğe döndüğünü belirtir. Normal Actions token'ının read yetkisi bu alanın
görünürlüğünü kanıtlamaz. Alanın olmaması boş bypass listesi sayılmaz.
Run40781664388 doğru `14` girdisinden sonra `MAIN_RULESET_REQUIRED` ile durmuştur;
o run'ın ham API gövdesi kaydedilmediği için eksik alanın doğrudan gözlendiği
iddia edilmez. Sonraki run'lar görünmeyen listeyi
`MAIN_RULESET_BYPASS_VISIBILITY_REQUIRED`, gerçek bypass aktörünü
`MAIN_RULESET_BYPASS_FORBIDDEN` olarak ayırır.

Kurucu, GitHub güvenli arayüzünde yalnız bu repository için kısa ömürlü bir
fine-grained token oluşturup **staging environment secret** olarak
`STAGING_GITHUB_GOVERNANCE_TOKEN` adıyla kaydeder. Gereken yetkiler:
`Administration: Read` ve
`Actions: Read` ([environment](https://docs.github.com/en/rest/deployments/environments?apiVersion=2022-11-28#get-an-environment)
ve [branch-policy](https://docs.github.com/en/rest/deployments/branch-policies?apiVersion=2022-11-28#list-deployment-branch-policies)
okumaları); zorunlu Metadata read otomatik gelir. Contents/Workflows write,
başka repository veya organizasyon kapsamı eklenmez. Gerçek API read-back'i
başarılı olmadan bu kimlik doğrulanmış sayılmaz.

Token, ruleset'i incelemeye yetkili gerçek repository sahibi/yöneticisinin
kimliğiyle sınırlandırılır. Resmî belgedeki ruleset write-access koşulu ile token'ın
API izin kapsamı aynı şey varsayılmaz: read-only credential'ın bypass listesini
gerçekten gösterebildiği henüz UAT'ta doğrulanmamıştır. Liste gizli kalırsa release
BLOCKED kalır; `Administration: Read and write` gibi daha güçlü bir credential'a
otomatik geçilmez. Böyle bir hesap/yetki artışı gerekirse exact ihtiyaç ve risk
ayrı kurucu kararıdır. Boş liste kanıtı olmadan mevcut gate gevşetilmez.
Token oluşturma/saklama ve süresini belirleme kurucunun güvenli hesap işlemidir;
değeri chate, loga, artifact'e veya runtime'a verilmez. Codex mevcut kimliği
okumaz, token üretmez veya repository/environment korumalarını değiştirmez.

Workflow secret'ı yalnız mevcut altı gate step'inin env alanına alır. Script
bu kimliği sabit repository'deki ruleset ve iki staging environment endpoint'ine
GET için gönderir. Main/SHA/CI okumaları normal read-only `github.token` ile
yapılır. Checkout, install, build, backup, deploy ve uygulama runtime'ı yeni
token'ı almaz. Workflow'un `contents/checks/actions: read` izinleri korunur;
provider credential'ı bu izinlere veya diğer step'lere aktarılmaz.
Eksik secret HTTP'den önce `GITHUB_GOVERNANCE_TOKEN_REQUIRED` ile durur;
403/timeout/redirect/bozuk veya aşırı büyük cevapta retry ya da token fallback
olmaz. Bilinmeyen koruma bilgisiyle release devam etmez.

Secret hazırlandıktan sonra kurucu yeni bir `Run workflow` açar, yeni exact
protected main SHA'yı ve canonical integer `14` gibi onaylı retention girdisini
kullanır; mevcut staging reviewer onayını verir. Eski failed run'ın yeniden
çalıştırılması eski SHA/girdileri korur. Bu kod değişikliği workflow dispatch,
deployment, hosted migration veya genuine provider testi başlatmaz.

Hedefler kodda sabittir:

- Vercel team `team_fOlNA2ASqhGzUplTDUFGCEDM` /
  project `prj_iax5OhGUbLL3s6BemMLqQAHFDAHl`.
- Supabase ref `xqvwkghpmezcpgugetqc`.
- Domain'ler `gold-revenue-os-staging.vercel.app` ve
  `gold-revenue-os-staging-gold-revenue-os-staging.vercel.app`.

`production` teknik Vercel target'ıdır; bu izole STAGING projesidir. Yeni ücretli
takım/altyapı oluşturulmaz. GitHub bağlantısı, SSO ve eski deployment saklanır.

## Korunan yapılandırma

GitHub Settings → Environments → staging içinde mevcut release secret'ları:
`SUPABASE_ACCESS_TOKEN`, `STAGING_SUPABASE_DB_PASSWORD`,
`STAGING_SUPABASE_PROJECT_ID`, `STAGING_SUPABASE_URL`,
`STAGING_SUPABASE_PUBLISHABLE_KEY`, `STAGING_SUPABASE_SECRET_KEY`, `VERCEL_TOKEN`.

Genuine release için recovery alanları: `STAGING_BACKUP_PASSPHRASE` (en az32 karakter bağımsız
yüksek entropili secret; parola yöneticisinde ayrı saklanır) ve
`STAGING_SUPABASE_SSL_ROOT_CERT` (Supabase Dashboard Database SSL bağlantı
ayarlarından indirilen gerçek kaynak CA sertifikası; TLS verify-full).

UAT runtime'a yalnız varsa eklenen secret adları:
`OPENAI_API_KEY` (yeni OpenAI programı) veya `POLAT_UAT_ANTHROPIC_API_KEY` (eski Claude programı), `POLAT_UAT_TELEGRAM_BOT_TOKEN`,
`POLAT_UAT_TELEGRAM_WEBHOOK_SECRET`, `POLAT_UAT_RELAY_SECRET`.
Varsa ayrı Stars TEST credential'ları `POLAT_UAT_STARS_TEST_BOT_TOKEN`,
`POLAT_UAT_STARS_TEST_WEBHOOK_SECRET`, `POLAT_UAT_STARS_RELAY_SECRET` yalnız aynı
runtime step'inde optional aktarılır; build'e veya normal sohbet botuna verilmez.
Bu custody, TEST program/price/bot/channel control veya provider action yetkisi
oluşturmaz. Stage G bu workflow ile otomatik başlatılmaz.
Değerler log/rapor/browser/artifact'e yazılmaz. Anthropic ADMIN anahtarı yalnız
ayrı korunan account-control sürecinde kullanılır; genel uygulamaya veya build'e
yüklenmez. Environment variable'ları `POLAT_UAT_TENANT_ID` ve `POLAT_UAT_PROGRAM_ID` yalnız
MFA ile oluşturulmuş gerçek program/tenant UUID'leridir; tek başına yetki değildir.
`POLAT_UAT_RELEASE_SHA` korumalı job'ın exact SHA'sından otomatik bağlanır. Bu alan
yeni private-beta deployment'ında eski genel webhook/cron/provider dispatch
yollarını yalnız kısıtlar; DB kill switch'lerini gevşetmez veya eski deployment
yetkilerini değiştirmez. Mevcut `OPENAI_API_KEY` yalnız build sonrası dar runtime
allowlist ile aktarılabilir; genel `OPENAI_MODEL` değiştirilmez veya UAT yetkisi
sayılmaz. Seçili programın model/account/custody kanıtı hâlâ zorunludur. Secret adının mevcut olması genuine account kontrolü veya dispatch
yetkisi değildir. Eksik alanlar ilgili stage'i BLOCKED bırakır.

## Backup → migration → publication

29 Ekim2026 SSO response-contract düzeltmesi: resmî
[Vercel OpenAPI GET project](https://openapi.vercel.sh/) şemasında `ssoProtection`
nullable object, `deploymentType` zorunlu alandır; `enabled` alanı tanımlı değildir.
[Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
belgesinde `ssoProtection: null` korumayı kapatır. Validasyon nullable/eksik/bozuk
korumayı reddeder ve mevcut `all_except_custom_domains` kapsamını aynen zorunlu
tutar. `preview`, `all` veya `prod_deployment_urls_and_all_previews` başka kapsama
otomatik eşlenmez. Legacy `enabled` alanı gelirse yalnız true kabul edilir;
`enabled` eksikken sağlayıcıya ait olmayan bir true alanı üretilmez.

Run40840081621 doğru retention ve yeni GitHub governance kimliğiyle ilk gate'i
geçmiş, `EXISTING_SSO_REQUIRED` ile baseline Vercel okumasında durmuştur.
Runner'ın ham proje yanıtı korunmadığından tam hata alanı doğrudan gözlenmiş
sayılmaz; kodun resmî yanıtta olmayan `enabled` koşulu kesin bir uyumluluk
kusurudur. Anthropic/OpenAI account job'ları operation seçimi nedeniyle SKIPPED
olmuştur; model değişimi bu adımın girdisi değildir. Bu düzeltme proje SSO/Git
ayarını, model seçimini veya token'ları değiştirmez; hosted backup/migration veya
release dispatch başlatmaz.

1. Exact current main, strict ruleset25348710, independent Application/Database
   ve staging reviewer/main/bypass ayarlarının official API read-back'i alınır.
2. Committed Git blob'larından bütün migration path/SHA256 envanteri çıkarılır.
   Yeni environment dosyası bu commit'in parçası veya authority sayılmaz.
3. Aktif CANARY/FOUNDER/FRIENDS UAT penceresi varsa release bloklanır; mevcut
   program/grant otomatik STOPPED yapılmaz veya sıfırlanmaz. Disposable local PostgreSQL17 başlatılır. Linked hedef host/user/ref doğrulanır.
   Hosted source'a **yalnız read-only** `pg_dump`/fingerprint işlemleri yapılır.
4. Read-only REPEATABLE READ transaction bir snapshot export eder; kaynak satır
   fingerprint'i ve `pg_dump --snapshot` **aynı** MVCC görünümünü import eder.
   Exporter bağlantısı dump bitene kadar açık kalır; bağlantı kaybı/expired snapshot
   fail-closed durdurur (15s başlangıç, 180s idle transaction sınırı). Var olan cron
   durdurulmaz; normal heartbeat/task yazıları iki farklı anın verisini yanlışlıkla
   aynı yedek saydırmaz. Bağımsız disposable DB restore; source
   database/public-schema owner korunur. Initdb public schema creation TOC girdisi
   dışında hiçbir dump kaydı atlanmaz; bütün ACL girdileri replay edilir. Owner,
   ACL, RLS/constraint/policy/function ve satır hash/count fingerprint'leri kıyaslanır.
   Restore satırları tam olarak exported snapshot ile eşleşmelidir. Taze dump-sonrası
   okuma aktif UAT programı, tablo/sequence envanteri, function, owner, ACL ve
   RLS/constraint/policy drift'ini ayrıca reddeder. Sonraki normal satır yazıları
   geri alınmaz ve snapshot'ın parçasıymış gibi gösterilmez.
   Sequence sayaçları MVCC değildir: değer ve `is_called`, archive'ın bounded
   SEQUENCE SET kayıtlarından bağımsız çıkarılıp restore ile **birebir** doğrulanır;
   daha sonraki live sayaç ya da JS Number yuvarlaması referans kabul edilmez.
   Önce→archive→sonra ilerleyişi exact integer increment yönünde doğrulanır;
   sayaç geri sarma/reset ve kanıtlanamayan cyclic ilerleme fail-closed durur.
   Eksik/çift/bilinmeyen kayıt, beklenmeyen SQL veya herhangi bir restore bozulması
   release'i durdurur. Tüm dump ACL kayıtları hâlâ replay edilir.
5. Dump AES256-GCM ile şifrelenir ve doğru parola ile byte-for-byte roundtrip
   kontrol edilir. Encryption hash'leri ve şifreli recovery artifact migration'dan
   **önce** korunur. Storage objeleri, Vault ve dış provider state'i bu logical
   backup'ın kapsamı değildir; bunlar tam production disaster recovery PASS sayılmaz.
6. Exact SHA/migration hash'leri tekrar doğrulanır; yalnız eksik reviewed SQL
   migration'lar `--skip-vault` ile uygulanır. Seed, role import veya history repair
   çalışmaz. Başarısız/yarım migration'da canlı trafik veya publication açılmaz.
7. Vercel config pull sonrası build ortamı yalnız public3 alanla yeniden yazılır.
   Model, bot, admin, backup ve database secret'ları build/install'e taşınmaz.
8. Runtime secret'ları dar allowlist ile yalnız aynı projenin teknik production
   target'ına bağlanır. `--prebuilt --prod --skip-domain` ile exact build stage edilir.
   READY, hedef project, kaynak SHA ve değişmemiş SSO/Git tekrar okunur.
9. `vercel curl` ile Vercel auth kullanılarak live/ready/login smoke ve `/admin`
   için anonymous application-auth redirect doğrulanır. **Gerçek founder/Polat
   MFA ile Admin giriş testi ayrıca yapılır; bu smoke onu tamamlamaz.**
10. Yalnız başarılı smoke sonrası aynı staged build promote edilir. İki canonical
    alias ve exact SHA yeniden okunur; eski deployment silinmez.

Workflow kendi başına webhook kaydı, bot/model çağrısı, invoice, UAT participant,
ticari subscription/VIP veya genel outbound açmaz. Gerçek mesaj sayısı ve model
kabulü sonradan gözlenir; bu release artifact'inde0 olması UAT tamamlandı demek değildir.

## HTTPS ingress ve Stage C–G ayrımı

Mevcut Admin SSO kapatılmaz. Ayrı `polat-private-beta-ingress` Supabase Edge
function'ı yalnız Telegram webhook secret'ı doğrular ve sabit staging API yoluna
ayrı HMAC ile iletir. Tek function `--no-verify-jwt` olabilir; diğer function'lar
ve Admin için JWT/SSO ayarları değiştirilmez.

Ingress ancak exact bot ID `getMe`, program/tenant/grant, signed relay custody,
Vercel automation bypass credential custody ve destination/notice/window doğrulanınca
yayımlanır. `POLAT_UAT_VERCEL_BYPASS` yalnız Edge secret'tır; normal API request'e
geri döndürülmez, genel uygulamaya yazılmaz. Vercel bypass yalnız hosting katmanını
aşar; uygulama webhook MAC ve membership/allowlist kontrolleri yine zorunludur.

Bounded canary1, founder20 ve10 arkadaş×30 model reply / global350 / USD5;
bu limitler harcama hedefi veya her tester'a garanti kota değildir. Bilinmeyen
provider/account/charge ve QA/handoff incelemesi paid stage'i kapalı tutabilir.
Tam v2 290-request deneyi bu release'in parçası değildir.

Telegram Stars TEST ayrı Telegram TEST hesap/bot/API ortamında yürütülür;
normal botta provider_token/flag değiştirmek gerçek Stars'ı sahte ödeme yapmaz.
Gerçek ticaret/VIP ve paying-customer pilot hâlâ NO_GO'dur.

## Yerel/CI doğrulama

`bash supabase/tests/private_beta_release_recovery.sh` yalnız pinned yerel
`supabase_db_gold-revenue-os` PostgreSQL17 konteynerini kabul eder. Gerçek
pg_dump/pg_restore ile kaynak fingerprint eşitliğini ve restore kopyasına bilerek
eklenen bir iznin tespitini doğrular. Kaynak DB/audit değişmez; owned restore DB
silinir. Bu testin PASS sonucu hosted TLS/backup/restore PASS değildir.

`bash supabase/tests/private_beta_recovery_snapshot.sh` ek olarak exporter,
bağımsız writer ve dump/reader bağlantılarıyla dump öncesi/sonrası iki committed
sentetik yazıyı sınar. Snapshot satırları1, güncel kaynak satırları3 iken restore
yalnız doğru snapshot'ı içerir; sequence durumu archive ile eşleşir. Expired
snapshot, ACL/RLS/satır/sequence bozulması ve taze source catalog drift'i reddedilir.
Bu disposable test hosted bir release'i veya mevcut worker'ın dış etkilerini başlatmaz.

29 Ekim run40847435622 `fingerprint_compare` aşamasında durmuştur. Salt-okunur
hosted sorgusu başarısız backup penceresi içinde09:12:13.309472Z'de mevcut worker
heartbeat yazısını doğrular. Eski kod bağımsız source-before/dump/source-after
görünümlerinin tümünü eşit saymayı gerektiriyordu; concurrent DML regresyonu bu
yanlış koşulu gerçek PG17 bağlantılarıyla yeniden üretir. Eski şifreli raw diagnostic
çözülmemiştir; o artifact'in bütün bileşen farklarının incelendiği iddia edilmez.
ICU/libc ve17.6→17.11 sentetik kontrolleri tek başına hatayı üretmemiştir.
`private-beta-backup-comparison.json` yalnız sabit reason code/boolean taşır;
raw satır/definition/counter değeri/log veya kimlik içermez. Yeni genuine hosted
backup kabulü ancak owner'ın yeni exact-SHA release çalışmasında doğrulanabilir.

## Stop / rollback / failure custody

- Gate/backup/restore/migration uyuşmazlığında sonraki stage başlamaz.
- Staged smoke fail olursa canonical domain taşınmaz; failed READY/ERROR kaydı
  gerçek sonuç olarak korunur. Build'i başarılı diye yeniden etiketlemeyin.
- Promote sonrası auth/tenant/QA/unknown-charge/delivery ihlali olursa UAT grant'ı
  STOPPED yapılır, yeni admission/dispatch durur; begun/UNKNOWN etki tekrar gönderilmez.
- Önceki deployment ID `private-beta-vercel-before.json` içindedir. Aynı staging
  projesinde `vercel promote <önceki deployment> --scope gold-revenue-os-staging`
  ile kod geri alınabilir. SQL/audit/receipts/obligations drop edilmez; reviewed
  additive forward fix veya ayrı onaylı hosted restore gerekir.
- Backup failure'ın redacted stage metadata'sı ve varsa şifreli raw diagnostic
  artifact korunur. Dump/secret/env dosyalarını plaintext artifact'e eklemeyin.
- `private-beta-staging.dump.enc` ve owner'ın ayrı custody parolası birlikte
  gereklidir. Byte-for-byte doğrulama ve gerçek restore sonucu olmadan backup PASS
  ilan edilmez. RPO/RTO ticari SLA olarak uydurulmaz; gerçek süre ölçülerek raporlanır.

## Ayrı read-only hesap preflight işlemi

### Founder canary entry from an existing DRAFT

The existing Admin **Start One Genuine Canary Request** control is shown for
`DRAFT` and `CANARY` with no prior canary. The owner's same-origin POST may carry
`expected_generation` for a draft. This is revision metadata, not approval or
account evidence. The server reads the user's existing tenant-scoped workspace,
requires the matching unused draft/release and independently observed account,
then calls the existing `admin_private_beta_transition_v1` with the real user
session. SQL still checks founder identity, fresh MFA, actual window, retention,
sealed account and generation under its row lock. A separate subsequent scope
read must confirm CANARY before the existing provider and durable reservation
can dispatch the fixed single Hi request. An uncertain transition is not retried.

The synthetic Hi canary does not require the staffing fields needed for customer
conversations. Existing SQL staffing/role/permission and billing-reconciliation
requirements for FOUNDER/FRIENDS are unchanged. Missing account/window evidence
keeps the button blocked. Rendering a control, selecting OpenAI or creating a
draft never calls a model. There is no automatic advance after the canary.

An exact `PRIVATE_BETA_FRESH_AUTH_REQUIRED` SQL denial now shows the existing
MFA reauthentication instruction instead of a generic authorization error.
Other permission denials remain denied, and raw diagnostics are not reflected.

The explicit `release_with_business_setup` operation accepts an existing
`program_id`, validated as a UUID in the first gate before hosted work.
After exact publication/protection/alias checks, the same reviewed job invokes the
existing scoped OpenAI model preflight, then genuine `verify_bot` and
`discover_business` implementations, in order. The existing organization/project
inputs are required and validated in the first gate; provider keys stay confined
to their individual steps. The model read uses those exact project headers and
does not write account/spending authority or invoke inference.
It preserves both sanitized identity and candidate-summary artifacts. The draft
must already have been bound to this exact release through the founder's real
MFA session; the job does not rewrite owner configuration or manufacture MFA.
This reuses the protected release review instead of three separate reviews for
publication, bot binding and private candidate discovery. Standalone modes remain.
The default `release_disabled` operation preserves the accepted release behavior,
including when a caller supplies a program ID; it never discovers updates.

Discovery uses a maximum of10 pending business updates, no offset/ack/drop, and
may change Telegram's update subscriptions. It is not called read-only. It is
restricted to the existing new draft without participants; customer message text
and profile names are not retained. A preexisting webhook conflict blocks it;
neither deletion nor replacement is attempted. NO_CANDIDATE is not a verified
connection. No webhook registration, outgoing message, model call or invoice is
performed by these optional release steps.

`operation=account_preflight` için aynı exact SHA ve staging reviewer kapısı
geçerlidir. `program_id` gerçek MFA-created program UUID'si;
`anthropic_workspace_id`, `anthropic_spend_limit_id`, `anthropic_api_key_id`
gerçek provider object ID'leridir, secret veya doğrulama booleans değildir.

`POLAT_UAT_ANTHROPIC_ADMIN_KEY` yalnız korunan account-control step'ine verilir.
Script exact Supabase projesinden program/tenant/window/SHA'yı SELECT ile okur,
resmî Anthropic workspace/spend-limit/key/model/cost GET uçlarını çağırır; otomatik
retry yoktur. Secret değeri Vercel'e, uygulamaya veya artifact'e kopyalanmaz.

Sonuç `OBSERVED` olsa bile aylık workspace cap transaction-level per-experiment
finansal yetki değildir. Aggregate cost actual per-attempt bill diye sunulmaz.
Data policy/region/retention/training/custody, bütün billable bileşenlerin fiyat
sınırı, genuine owner grant, committed reserve ve gerçek canary billing
reconciliation kanıtı eksikse genuine execution **BLOCKED** kalır. Bu preflight
hiçbir `verified=true` input'u kabul etmez veya DB authority yazmaz.

Early Access spend-limit API403, eksik model/workspace header, eksik kullanım
pagination veya source doğrulanamazsa actual preflight FAIL/BLOCKED kaydı korunur.
Bir public pricing sayfası özel hesap region/tier/surcharge koşullarının yerine
geçmez. Bu gözlem JSON'unu elle değiştirip release/grant diye kullanmayın.

## Ayrı korumalı gerçek bot identity işlemi

`operation=verify_bot`, aynı exact protected main CI/ruleset ve `staging` reviewer
kapısı altında yalnız mevcut `program_id` UUID'sini alır. Secret'lar yalnız son
step'tedir: `SUPABASE_ACCESS_TOKEN` ve yeni `POLAT_UAT_TELEGRAM_BOT_TOKEN`.
Anthropic/backup/Vercel credential'ları bu işe verilmez.

`scripts/private-beta-release-bot.mjs`, exact Supabase projesinden `postgres`
authority, tenant/program/SHA/manifest/generation değerlerini okur. Sabit normal
Telegram API `getMe` çağrısında bot niteliği, güvenli integer ID ve token prefix
eşleşmesi gerekir. Redirect/retry yoktur; timeout10s ve response16KiB'dır;
duplicate JSON key reddedilir. Provider username'i izin/rıza kanıtı değildir.

Official raw response ve credential hash'i sunucuda türetilir; ham token/username
log veya artifact'e girmez. Bot'a ait transaction advisory lock, current program
row lock ve manifest/revision/SHA fencing sonrası postgres-only
`private.private_beta_bot_control_record` çağrılır. Başka tenant'ın mevcut botu
yeniden bağlanamaz. Ayrı sonraki DB SELECT, gerçek persisted bot/source/custody
eşleşmesini doğrular. Başarılı POST tek başına PASS değildir.

Bu işlem webhook oluşturmaz, mesaj göndermez, davet/model/Stars veya ticari yetki
vermez. Gate, bot, revision veya read-back eksikse sanitized BLOCKED artifact
üretilir. Management API'nin deneysel endpoint'i değişir veya postgres authority
sağlanmazsa bu yol kapalı kalır; service-role grant eklenmez.

Gelecek webhook kurulumu için `privateBetaBotWebhookRequest(secret)` yalnız sabit
Edge URL'si, `allowed_updates=[message]` (BOT) veya yalnız reviewed BUSINESS event listesi, tek connection ve
`drop_pending_updates=false` payload'unu hazırlar; bir execution grant veya
çalıştırılabilir activation entrypoint değildir. Gerçek kurulum sırası:

1. Yukarıdaki bot read-back, gerçek program/window/notice, operator/MFA ve deployed
   SHA doğrulanır. `getWebhookInfo` mevcut farklı hedef gösterirse otomatik üzerine
   yazılmaz; eski meşru bot/staging bağımlılığı araştırılır.
2. Kriptografik rastgele `POLAT_UAT_TELEGRAM_WEBHOOK_SECRET` ve ayrı
   `POLAT_UAT_RELAY_SECRET` protected custody'de üretilir; Vercel runtime ve yalnız
   ilgili Supabase Edge function'a bağlanır. `POLAT_UAT_VERCEL_BYPASS` yalnız
   Edge'de ve exact staging proje yetkisindedir; Admin SSO değişmez.
3. Yalnız reviewed `polat-private-beta-ingress` function'ı yayımlanır; function'a
   özgü JWT muafiyeti genel Admin auth'u değiştirmez. HMAC, timestamp/body hash,
   bot/tenant/participant allowlist kontrolleri korunur.
4. Aynı normal botun tek `setWebhook` çağrısına fixed payload verilir; sonucu
   belirsizse kör retry yoktur. Bağımsız `getWebhookInfo` exact Edge URL ve
   subscription ayarlarını doğrular. Gerçek opt-in inbound görülmeden delivery
   kabulü PASS değildir. Bu release veya bot-verification job'u bu adımları
   otomatik çalıştırmaz.

Referanslar: [Telegram getMe](https://core.telegram.org/bots/api#getme),
[setWebhook](https://core.telegram.org/bots/api#setwebhook),
[getWebhookInfo](https://core.telegram.org/bots/api#getwebhookinfo) ve
[Supabase Management SQL](https://supabase.com/docs/reference/api/v1-run-a-query).
API sözleşmesi, account/secret/custody doğrulamasının yerine geçmez.


## 27 Ekim 2026 — OpenAI ve Polat BUSINESS ilk test bağlantısı

Yeni owner kararı OpenAI kullanılmasıdır. Önerilen/seçilebilir exact model
`gpt-6.1-sol`; ücretli hesap/model erişimi yalnız gerçek account preflight ile
kanıtlanabilir. Genel `OPENAI_MODEL` secret'ı eski kullanım için korunur.
Admin → Polat İşlemleri → Özel Beta → DRAFT programında güncel MFA ile OpenAI
seçilir. Bu seçim eski Claude manifest/notice/planını yeniden kullanmaz; notice
`polat-private-beta-notice-openai-v1`, provider/account/canary hash'leri sürümlenir.
İlk canary Hi/en/DIRECT/1/512 token/10 saniye; tam v2 290-request ayrı kalır.
18 USD bakiye yalnız owner beyanıdır; verified spend cap veya harcama yetkisi değildir.
Bu UAT'ın toplam üst sınırı yine5.00 USD, otomatik retry/fallback/regeneration0'dır.

`operation=openai_account_preflight` exact main ve staging reviewer kapısıyla
`openai_organization_id` ve `openai_project_id` metadata alanlarını, mevcut
`OPENAI_API_KEY` custody'sini kullanır. Sabit OpenAI model GET + sabit Supabase
program SELECT dışında hiçbir inference veya authority yazımı yapmaz. `OBSERVED`
model metadata gözlemidir; efektif per-experiment monetary cap, veri politikası,
region/retention/training, tam pricing ve bağımsız billing kanıtı değildir.
Eksik proof genuine inference'ı BLOCKED tutar. Normal project budget alert'i
transactional hard cap diye kabul edilmez.

27 Ekim official Standard kısa bağlam fiyatı input2/output10 USD/1M token'dır.
Ancak model >272K input için bütün istekte input2× / output1.5× belirtir.
1050000 tam bağlam / max512 output için koruyucu reservation input4/output15
ile4.20768 USD'dir; actual charge değildir. İlk isteğin gerçek billing'i
bağımsız uzlaştırılmadan reservation serbest bırakılmaz. Account surcharge,
caching, tier veya kullanım belirsizliği hâlâ fail-closed'dur. Bu konservatif sınır
350 request veya20/30 reply kotasının kullanılabileceğine dair garanti vermez.
Fiyat kaynağı: https://developers.openai.com/api/docs/models/gpt-6.1-sol ve
https://developers.openai.com/api/docs/pricing (kontrol:2026-10-27).

### Polat hesabında yalnız kurucunun seçili özel sohbeti

Normal bot ve BUSINESS modları ayrıdır. Telegram BotFather → Bot Settings →
Secretary Mode açık; Polat Telegram Business → Chatbots → Only selected chats
altında yalnız kurucunun özel sohbeti. Bot permissions: yalnız reply; para/Stars,
gift, story, profile, delete/read-mark ve diğer ek haklar kapalı. Normal kanal
üyeliği sinyal okuma/yeniden dağıtım yetkisi değildir; bu bağlantı kanal erişimi açmaz.
Gerçek token, kod, secret veya session string chat/rapor/CI artifact'e yazılmaz.

1. Yeni dedicated bot için `operation=verify_bot` ile exact numeric getMe,
   credential hash ve current program/tenant/SHA/gen bağımsız okunur.
2. DRAFT programında, webhook henüz kurulu değilken, kurucu kendi hesabından
   seçili Polat sohbetine gönüllü test mesajı gönderir. `discover_business` en fazla10
   update okur; offset/ACK/drop yapmaz. getUpdates allowed_updates filtresinin
   Telegram'da kalıcı etkisi olabileceği için eski/üretim botunda kullanılmaz.
   Webhook409 varsa otomatik silme/yeniden kurma yapılmaz, sonuç BLOCKED'dır.
3. Depo public olduğu için numeric founder/representative/connection adayları
   normal Actions artifact'ine çıkarılmaz. Minimal candidate kanıtı private DB'de,
   fresh-MFA owner-only Admin'de, en fazla5 dakika geçerlidir. Artifact yalnız
   hash/count/time/scope içerir. Süre sonu fiziksel silme iddiası değildir;
   private-beta retention/deletion politikası ayrıca uygulanır.
4. Admin'de tek aday/tek kurucu varsa yalnız öneri olarak form doldurulur. Owner
   güncel MFA ile exact bağlantı ve tek founder chat'ı kaydeder. Aday gözlemi
   bağımsız getBusinessConnection izni veya consent değildir.
5. `verify_business` actual enabled connection, exact bot/key/user ve yalnız
   can_reply haklarını okur; korunmuş writer+read-back doğrulanır. Callback
   pozitif permission authority değildir. Her gerçek send öncesinde yeniden sabit
   getBusinessConnection okunur; permission drift gönderimi durdurur.
6. Exact deployed SHA/notice/window/canary-accounting/operator şartlarından sonra
   founder invitation oluşturulur. `/start <one-time-code>` Polat ile seçili
   özel sohbetten gönderilir; notice kabul edilmeden model çağrısı yoktur.
   İlk BUSINESS yolu yalnız founder'dır;10-friend BOT akışı genişletilmez.
7. Provider-observed insan yanıtı eski AI draft'larını bloke eder; belirsiz send
   success veya delivered sayılmaz. Yeniden doğrulama yalnız yeni evidence nesli
   açar; blind resend, unknown ACK veya otomatik AI resume üretmez.

Tüm external operations için gerçek protected environment approval ve confirmed
prerequisites gerekir. Bu runbook, gerçekleşmemiş deployment/canary/discovery veya
Telegram konuşması için PASS beyanı değildir. GitHub secret isimlerinin varlığı
runtime custody veya model/account kabulünün yerine geçmez.

## Independent OpenAI project hard-limit read —2 November2026

`operation=openai_controls_preflight` uses the existing protected main/reviewer
workflow and the exact organization/project input IDs. `OPENAI_UAT_ADMIN_KEY`
is confined to that read-only step; it is never copied to Vercel, the application,
build, bot jobs, artifacts or model context. Configure a provider credential with
only the required project/limit read permissions through protected staging
secrets. Do not send its value in chat. A normal inference key is not substituted
for the Admin credential and a missing key causes zero HTTP calls.

The reader performs only two fixed GETs: `/v1/organization/projects/{id}` and
`/v1/organization/projects/{id}/spend_limit`. It requires the exact active project,
USD/month, positive safe integer CENTS no greater than500, and enforcement status
`enforcing`. Unknown status/currency/unit/identity, redirect, duplicate JSON,
malformed/oversized/stalled response or HTTP denial holds without retry. Observed
monthly cap is represented with exact decimal arithmetic. A returned monthly cap
is not a transactional per-experiment guarantee; enforcement may lag. Current
usage, independent billing, data policy and effective experiment authority stay
UNKNOWN/UNVERIFIED. No DB authority is written and no inference is enabled.

Official sources checked2 November2026 Europe/Istanbul:
https://developers.openai.com/api/docs/guides/spend-limits
https://github.com/openai/openai-node/blob/master/src/resources/admin/organization/projects/spend-limit.ts
The official SDK marks this endpoint `adminAPIKeyAuth`; `threshold_amount` is in
cents and enforcement is `inactive` or `enforcing`. No SDK dependency is added.
An owner statement about the limit is configuration input, not this independent
provider read. No Admin credential is created, exposed or claimed to exist by code.

## Founder ingress metadata read failure —2 November2026

Release41359614790 completed its backup/independent restore, reviewed migration
and build, then stopped before ingress mutations with `INGRESS_READ_UNAVAILABLE`.
The old observation did not distinguish transport from JSON parsing; it does not
establish which raw upstream field caused the failure. Vercel metadata now uses
its own bounded JSON reader, accepting finite exponent-form resource metadata
and larger nested objects while retaining duplicate/prototype-key rejection,
safe integers,1MiB bytes,32768 nodes,32 levels and the existing10-second deadline.
Model, account, Telegram and financial JSON rules are unchanged. Failed reads
record only a static `request_stage`, optional numeric `request_http_status` and
sanitized reason; no URL, body, credential key or upstream error text is retained.
Offline regression reproduces the old reader rejecting valid Vercel metadata;
this is not genuine provider acceptance. Inspect the next protected run's actual
observation before classifying its result. The already applied migration is not
reapplied; deployment, canary and webhook remain independently verified stages.

## Supabase query HTTP201 contract —2 November2026

The actual41418228073 observation stopped before ingress mutations with
`INGRESS_RESPONSE_INVALID stage=SUPABASE_PROGRAM http_status=201`. The fixed
Vercel reads had passed; this is a separate Management API status mismatch.
Supabase documents201 for
[POST database/query](https://supabase.com/docs/reference/api/v1-run-a-query).
The ingress, founder model collector, setup observer and existing OpenAI
preflight accept200/201 only for that exact fixed project query endpoint and
POST method. Other provider/documentation GET statuses remain unchanged.
Every query still requires bounded valid JSON, exact role/tenant/program/SHA,
and independent exact readback after a write. An empty201,202 pending result,
redirect, denial, malformed/duplicate JSON or mismatched state holds without
retry. The separate documented bodyless secret-write201 ACK is unchanged.
No migration, MFA, payment or provider-spend authority is changed by this fix.

## Canary failure diagnosis without dispatch or reserve reset

An exact authenticated SQL `42501/PRIVATE_BETA_FRESH_AUTH_REQUIRED` before
provider creation returns `403/CANARY_MFA_REQUIRED`. The existing owner form
recognizes only that bounded same-origin canary JSON response, shows the current
TR/EN reauthentication message and links to the existing MFA section. It does
not enroll a factor, verify MFA, resubmit a form or classify a provider error as
safe to retry. Other denials and uncertain outcomes retain the review state.

`OPENAI_UAT_RESPONSE_CORRELATION_INVALID` in older evidence did not retain which
header check rejected a200 response. New errors append only `CLIENT_ID`,
`ORGANIZATION`, `PROJECT` or `CONTENT_TYPE` in the existing immutable error_code.
The rejection criteria, optional-header behavior, UNKNOWN disposition, full
reservation, QA hold and no-retry rules are unchanged. Raw header values,
credentials and response contents are not added to logs or customer text.
The historical generic error cannot retrospectively establish the failed field,
provider response identity, usage, QA result or billed cost. Missing dashboard
logs do not establish a zero charge. No missing field is guessed or waived.

For provider lookup, the existing outgoing `X-Client-Request-Id` is the durable
attempt UUID recorded privately. OpenAI documents that support can use it when
the server-generated `x-request-id` was unavailable:
https://developers.openai.com/api/reference/overview#debugging-requests
Use the original request's recorded identity/time; never send a second inference
as a lookup. A provider result or bill must be genuinely observed and matched
before accepted reconciliation. This code change does not recover an old reply,
alter a signed plan, clear UNKNOWN, release liability or authorize another canary.
No staging release or migration is part of this diagnostic repair.

## Optional OpenAI response metadata compatibility

The official API overview describes `openai-organization` as organization
metadata; it does not promise an organization-ID echo. The fixed-origin TLS
request, sealed credential fingerprint, explicit outbound organization/project,
owner grant and committed request binding remain the authority. Bounded printable
organization/project display labels (including legacy `user-*` labels) are not
compared to canonical IDs and never establish account or billing proof. An
explicit canonical `org-`/`org_`/`proj_` ID must still match the sealed scope.
Malformed/multiple metadata values, an explicit client-ID mismatch and non-JSON
content remain rejected. The protected model metadata reader uses the same rule.

Reference: https://developers.openai.com/api/reference/overview#debugging-requests
The historical correlation failure did not retain its failed header, so this
protocol correction does not identify that original field retrospectively.
It neither recovers a discarded reply nor clears UNKNOWN, consumes another
canary, changes limits/grants, runs a migration or publishes a release.

## Explicit bounded founder recovery

An existing owner-only program can recover once from its first recorded OpenAI
response-correlation failure. The original request, UNKNOWN evidence, full
reservation, global request count, original start/deadline and actual owner
identity remain intact. A separate version4 canary run records the new attempt;
it cannot reuse the old run's authorization key or send a third canary. All old
liability remains in the same durable5USD/350-attempt budget. No screenshot or
owner-reported spend is converted into independently reconciled billing.

Version4 limits input to4096 tokens and output to512. The existing one-use native
network permit calls the official fixed `/v1/responses/input_tokens` endpoint
with the same model/input/reasoning/schema/tools before the single generation.
An invalid count or count above4096 blocks generation; it does not truncate,
retry, change model or discard history. The local bound uses conservative public
maximum prices for that enforced input cap. Native usage and Phase7 QA are still
required. The codec discards unrecognized outer transport metadata while keeping
known response restrictions, the reserved `verified` field and actual Polat
output strict. Real model access, provider output and billing remain distinct.

Two authorization paths use the same private recovery primitive:

- The existing authenticated Admin can use a real fresh owner MFA action.
- A reviewed protected runner may execute a specifically delegated recovery under
  the owner's already recorded, unexpired test grant. Current active owner
  membership and an actually verified Auth factor are read independently. No
  factor, challenge, session, JWT claim or authentication time is created.
  The original `approved_at`/`authenticated_at` remain unchanged and the mutation
  actor is SYSTEM with the actual standing-owner and GitHub-run reference.

The protected primitive and canary scope have no authenticated/service-role
EXECUTE grant. The same owner/account/committed-reservation gate, native request
builder, actual codec and QA path serve Admin and the protected connector.
Explicit source-bound recovery provenance is included in both binding and sealed
account control. Only the specifically retained old UNKNOWN is quarantined from
active-run dispatch checks; its entire liability and immutable history remain.
Any new UNKNOWN/QA hold, revoked factor/membership, STOP, expired window, stale
source or missing provider evidence blocks subsequent work.

The workflow input `authorized_founder_recovery` defaults to false. It is only
used with `release_with_business_setup` after reviewed migrations, exact-SHA
publication, protected model/pricing observations and a fresh governance check.
Code deployment alone cannot invoke inference or activate a campaign. The caller
must explicitly authorize this bounded operation. The connector performs no
Telegram send, invoice, payment, membership or commercial START. Public artifacts
contain only redacted QA/usage/hash/status evidence. Before/after independent
hashes verify the old UNKNOWN journal and actual owner Auth records unchanged.
Unknown mutation/result/commit acknowledgement is never blindly retried.

An explicitly delegated normal GitHub environment review may be performed through
its authenticated API only as the configured actual reviewer when repository
policy permits it. Required checks/reviewers, environment branch restrictions and
`can_admins_bypass=false` remain enforced; no protection is disabled or approval
fabricated. Genuine provider, transport, device and TEST-payment acceptance must
still be reported separately.

Official token-counting contract:
https://developers.openai.com/api/docs/guides/token-counting

The same reviewed release now runs the existing read-only integration inventory
before deployment, preserving Business AI / merchant / dedicated TEST identities
and webhook separation in a redacted artifact. A second inventory review is not
needed. This observation cannot activate payments or messaging. If the connected
GitHub identity lacks deployments-write permission (HTTP403), the owner uses the
existing secure GitHub review screen once; required-reviewer protection remains.
