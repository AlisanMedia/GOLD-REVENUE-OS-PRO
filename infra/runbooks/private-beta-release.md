# Private beta: exact-SHA isolated staging release

26 Ekim 2026 founder UAT yetkisi, ticari üretim veya ücretli müşteri GO kararı değildir.
Bu dosya bir sonucu onaylamaz. Actual run/deployment/migration kimlikleri raporda
ayrı gösterilir. Başarılı mock test, hosted backup veya gerçek Admin girişi değildir.

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

1. Exact current main, strict ruleset25348710, independent Application/Database
   ve staging reviewer/main/bypass ayarlarının official API read-back'i alınır.
2. Committed Git blob'larından bütün migration path/SHA256 envanteri çıkarılır.
   Yeni environment dosyası bu commit'in parçası veya authority sayılmaz.
3. Aktif CANARY/FOUNDER/FRIENDS UAT penceresi varsa release bloklanır; mevcut
   program/grant otomatik STOPPED yapılmaz veya sıfırlanmaz. Disposable local PostgreSQL17 başlatılır. Linked hedef host/user/ref doğrulanır.
   Hosted source'a **yalnız read-only** `pg_dump`/fingerprint işlemleri yapılır.
4. Tek transaction-snapshot custom dump; bağımsız disposable DB restore; source
   database/public-schema owner korunur. Initdb public schema creation TOC girdisi
   dışında hiçbir dump kaydı atlanmaz; bütün ACL girdileri replay edilir. Owner,
   ACL, RLS/constraint/policy/function ve satır hash/count fingerprint'leri kıyaslanır.
   Source dump sırasında değişirse eşitlik sağlanmaz ve release durur.
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
