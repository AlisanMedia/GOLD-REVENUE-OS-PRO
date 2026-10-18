# PHASE 16C-0 — Bounded Admin Reads & Safe Evidence Pagination

**Durum:** Uygulama ve sentetik kabul raporu. Korunan PR/head ve merge sonrası CI kanıtı yayın teslim kaydına eklenir. Bu belge tek başına merge veya owner kabulü iddiası değildir. **Fazın kapanması ayrı owner kararına bağlıdır.**

## 1. Yetki, başlangıç ve sınır

- Repository: `AlisanMedia/GOLD-REVENUE-OS-PRO`.
- API ve git remote ile doğrulanan başlangıç main: `315f856405abb1943041e7c51392a34a82f6a6c3`; Application ve Database SUCCESS, GitHub Actions app `15368`.
- Active ruleset `25348710`: strict Application + Database, PR zorunlu, bypass listesi boş, force-push/silme kapalı. Son yayın öncesi tekrar okunur.
- Yetki yalnız Phase16C-0 read-model/projection/pagination, ilgili dört Admin ekranı, additive migration ve sentetik testlerdir. Phase16C-1/16D+, gerçek ödeme/Telegram/VIP/outbound/import/pilot yetkisi yoktur.
- [16A governance](PHASE_16A_GOVERNANCE_REPORT.md), [16B tasarım](docs/phases/PHASE_16B_SCOPE_DESIGN.md), [16B owner raporu](PHASE_16B_SCOPE_REPORT.md), [ADR007](docs/adr/ADR_007_PHASE11_FENCED_ENTITLEMENTS.md) korunur. Yeni açık owner scope'u tarihsel genel yasakları yalnız bu dar kapsamda aşar.

## 2. Doğrulanan kök neden

[Phase11 migration](supabase/migrations/20261013222720_phase11_subscription_access.sql) içindeki eski `admin_entitlement_list` yalnız subscriptions dizisini100 ile sınırlar; access/payments/jobs/audit fan-out'u sınırsızdır. Geniş satır JSON'u raw invitation ve gereksiz teknik alanları taşır. Kaynak tablolarındaki geniş authenticated SELECT, yalnız RPC/React redaksiyonuyla kapatılamaz.

Eski subscription-detail ekranı genel liste içinden ID arar; ilk100 dışındaki mevcut abonelik yanlışlıkla404 olabilir. Bunlar kod düzeyinde doğrulanan sınırlardır. Ölçülmüş production olayı, gerçekleşmiş müşteri veri sızıntısı veya exploit iddiası değildir.

## 3. Teslim edilen salt-okuma API

[Additive migration](supabase/migrations/20261018200156_phase16c0_bounded_entitlement_reads.sql) geçmiş migration'ları değiştirmez.

| API / koleksiyon | Sözleşme |
| --- | --- |
| `admin_entitlement_page_v1` | Tek koleksiyon, tenant/customer/subscription scope, default25, hard maximum100; 0/101+ reddedilir. En fazla n+1 lookahead; tüm geçmişi sayan count yoktur. |
| subscriptions | `(created_at DESC,id DESC)`; compact approved-plan projection, immutable period existence ve unique access-status scalar'ı. |
| access | `id DESC`; tabloda created_at yoktur. Unique subscription-access bağı korunur. |
| payments | `(period_start DESC,id DESC)`; immutable dönemler ayrı sayfalanır, diğer listelerin limitiyle kesilmez. |
| jobs | `id DESC`; available_at retry sırasında değiştiği için sıralama anahtarı yapılmaz. Durum/zaman güncel okunur. |
| audit | `(created_at DESC,id DESC)`; tüm yetkili tarihçe bounded sayfalarla erişilebilir. |
| `admin_subscription_detail_v1` | Doğrudan tenant+ID lookup; ilk100'e bağlı değildir. Tek subscription ve unique access; ödeme dönemi varlığı sayfa içeriğinden bağımsızdır. |
| `admin_entitlement_list` | Eski Phase11 verifier için korunur. Beş dizi **bağımsız100** ile sınırlı; her biri `pages` altında has_more/next_cursor ve açık compatibility işareti taşır. Yeni UI bu toplu çağrıyı kullanmaz. |

25 satır, normal operatör incelemesini ve veri/serialization maliyetini küçük tutar;100, kanıt incelemesi için sınırlı üst değerdir. Detayda plan fiyatı/koşulları explicit allowlist ile korunur; fiyat tahsilat diye sunulmaz. Koşul metni1200, rule metinleri300, listeler ayrı ayrı12×300 ile sınırlıdır. Kaynağın tamamı veya keyfi JSON tarayıcıya aktarılmaz; orijinal kayıt değiştirilmez.

## 4. Cursor ve eşzamanlılık garantisi

Cursor yalnız navigation verisidir, erişim yetkisi veya kriptografik olarak imzalı bir bearer token değildir. SQL her çağrıda auth.uid, aktif tenant üyeliği ve rol yetkisini yeniden doğrular. SHA-256 scope fingerprint'i actor/role/tenant/customer/subscription/collection/page-size'a bağlıdır. Sınır ve anchor kayıtlarının gerçek anahtarları aynı yetkili scope içinde kontrol edilir. Bozuk, başka scope'a ait veya30 dakikadan eski cursor generic refresh hatası verir; URL'de kullanıcı/tenant kimliği, davet veya lease yoktur.

Keyset sıralama sabit anahtarlara dayanır ve timestamp eşitlikleri ID ile çözülür. Anchor üst sınırı korunur; worker available_at/status güncellemesi kaydı farklı sayfaya taşımaz. Bu bir transaction boyunca tutulan MVCC snapshot/export değildir. Gezinti başladıktan sonra eklenen, özellikle geç tarihli/backdated kayıtların tümünü görmek için **İlk sayfa / yenile** gerekir. UI bunu açıkça bildirir. Mevcut immutable kayıtlar normal worker güncellemeleriyle sıralama değiştirmez; kayıtlar silinmez veya yeniden yazılmaz.

## 5. Rol ve hassas alanlar

| Rol | Okuma | Sayısal Telegram kimliği / private chat | Raw invitation | Lease / raw job error / keyfi audit JSON |
| --- | --- | --- | --- | --- |
| super_admin, manager | İzinli | İzinli | Yalnız mevcut operasyonel ihtiyaç için RPC'de bounded/exact-host projection; listelerde raw davet gösterilmez | Verilmez; yalnız allowlist operation/attempt ve güvenli hata kodu |
| support | İzinli; mutation yok | Mevcut kimlik doğrulama ihtiyacı korunur | null | Verilmez |
| analyst | İzinli; mutation yok | null | null; payment event/invoice/receipt source referansları da null | Verilmez |
| readonly | Entitlement RPC/detail reddedilir | Yok | Yok | Yok |

Authenticated raw access/job/audit/binding/channel SELECT kaldırılır. Subscription/payment tablolarında kabul edilmiş RLS/count davranışı için yalnız güvenli kolon SELECT'i kalır; commercial snapshot, receipt/reference veya lease üzerinden redaksiyon aşılamaz. Mevcut service-role worker yetkileri değiştirilmez. Private receipt/control tablolarına erişim veya writer yetkisi eklenmez. SECURITY DEFINER search_path `pg_catalog`, nesneler qualified, execute yalnız authenticated + içeride RBAC; private yardımcıların client execute yetkisi yoktur.

## 6. Operatör ekranları

- `/admin/subscriptions`:25 kayıt, tek bounded customer-name batch'i, customer filtresi, sonraki/yenile bağlantıları. Onaylı TEST yönetim formları ve mevcut mutation action'ları korunur; payment fan-out yüklenmez.
- `/admin/subscriptions/[id]`: doğrudan detay; **Ödeme dönemleri / Kanal Erişimi / Erişim işlemleri / Geçmiş** sekmelerinden yalnız seçilen kanıt koleksiyonu sorgulanır. Fiyat/koşul ve teknik referanslar ikincil bölümlerdedir.
- `/admin/channel-access`: access sayfası, görünür durum/binding, raw invitation yerine davet varlığı ve süre; işler ilgili abonelikte açılır.
- `/admin/customers/[id]`: yalnız o customer+tenant abonelikleri; bounded özet ve detay bağlantıları. Başka customer/collection cursor'ı kullanılamaz.
- TR default/EN hesap tercihi, UTC tarihleri, localized durumlar, odaklanabilir tablo scroll alanı ve44px pagination bağlantıları. Customer preview İngilizce kalır. Empty, incomplete ve failed/expired-link durumları farklıdır; kaynak hatası “kayıt yok” veya404 diye yorumlanmaz.
- Server-only DAL strict Zod response şemaları kullanır; ek hassas kolon, yanlış koleksiyon, limit veya completeness ihlali unavailable olur. Memoization yalnız request içidir; privileged HTTP yanıtı private/no-store kontrolünden geçer.

## 7. Sentetik ölçüm ve indeks gerekçesi

Ölçüm yalnız boş disposable PostgreSQL17 DB'de aynı transaction/fixture üzerinde alındı; hosted staging veya production yük testi yapılmadı. Workload: **321 subscriptions,320 access,1.600 payment periods,3.160 jobs,3.200 audit**; aynı müşteri için iki plan ve büyük geçmiş, eşit sort timestamp'leri. [Fixture](supabase/tests/helpers/phase16c0_fixtures.sql), [EXPLAIN sorguları](supabase/tests/phase16c0_read_plans.sql).

| Ölçüm | Önce | Sonra |
| --- | ---: | ---: |
| Eski toplu RPC JSON'u | 3.308.003 bayt | 192.328 bayt; her dizi≤100 |
| Toplu RPC audit satırı | 3.200 | 100 + açık has_more; kalan kanıt v1 sayfalarda |
| Toplu RPC EXPLAIN execution | 79,235 ms | 30,084 ms |
| Subscription key sorgusu,26 lookahead | 0,141 ms; seq scan + sort | 0,022 ms; tenant-created-id index-only scan |
| Derin scoped audit key sorgusu | 0,450 ms;3.200 tarama, sort | 0,049 ms; scoped keyset index-only scan,26 satır |
| Yeni UI subscription RPC,25 | — | 5,072 ms;16.517 bayt |
| Yeni scoped audit RPC,25 | — | 0,708 ms |

Default25 RPC JSON boyutları: access10.964, payments9.137, jobs7.662, audit5.884 bayt. Bunlar SQL JSON ölçümleridir; Next HTML boyutu veya production p95/SLA değildir. Tek kontrollü EXPLAIN gözlemleri cache/planning farkları içerir; genellenmiş throughput/maliyet garantisi verilmez. Uyumluluk wrapper'ının beş yetkilendirilmiş çağrısı bazı buffer/plan maliyetlerini artırır; ana UI yalnız gereken koleksiyonu okur.

Beş indeks: tenant-created-id subscriptions; tenant-id ve tenant-access-id jobs; tenant-created-id ve tenant-subscription-created-id audit. Gerekçe mevcut eksik sort/tenant-prefix erişim şeklidir. Mevcut channel_access tenant-id unique ve Phase15 payment-period indeksleri tekrar kullanılır; gereksiz customer/payment indeksleri eklenmez. Bu yoğun tek-tenant fixture'ında bazı job/access sorgularında planner mevcut primary key'i seçmiştir; yeni her indeks için ölçülmüş hızlanma iddiası yoktur.

## 8. Kabul ve korunmuş başarısız denemeler

- Odaklı pgTAP:103 yeni kontrol; mevcut64 Phase11 kontrolüyle **167/167 PASS**. Bütün tarihçeyi first/middle/final sayfalardan tam dolaşma, bağımsız limitler, ties, direct>100, RBAC, scope/cursor tampering, raw projection bypass, immutable evidence hash ve financial/access/receipt/import/message invariants.
- İki bağlantılı gerçek PostgreSQL barrier testi PASS: ilk sayfadan sonra concurrent audit insert ve job zaman/durum update; önceki kayıtlar kayıpsız/tekrarsız, refresh yeni audit'i gösterir. Mevcut Phase11 concurrent consumer/lease sözleşmesi de PASS.
- Unit642 PASS; repository integration300 PASS (yeni read/UX kontrolleri dahil). Son exact-commit CI bu yerel kayıtların üstündeki yayın kapısıdır.
- Focused authenticated localhost HTTP/Admin: **31/31 PASS**, private/no-store ve cleanup doğrulandı. Sonuç teslim artifact/CI'da ayrıca raporlanır. Gerçek staging veya provider kabulü değildir. CI mevcut Phase11 HTTP entry point'inden yalnız localhost guard altında eklenir; hosted staging davranışı değiştirilmez.
- TR/EN × dört ekran ×320/390/768/1440:32 actual-component sentetik screenshot ve keyboard/overflow kontrolü. Görseller localhost authenticated HTML'inden, script'leri çıkarılmış güvenli preview olarak üretilir. UI görseli gerçek müşteri veya production ekranı değildir.
- Lint, strict TypeScript, build, audit ve üç read RPC için plpgsql_check compile kontrolü uygulanır. Geçmiş advisory istisnası CI'daki tek mevcut GHSA-vfj7-8cjw-p6xm'dir; yeni ignore/dependency eklenmez.
- Yerel plain-Postgres full db-lint, Supabase CLI history tablosu bulunmadığı için mevcut `admin_system_health` fonksiyonunda hata verdi. Yeni read fonksiyonlarının doğrudan lint'i PASS; zorunlu Database CI gerçek Supabase reset/history/full lint kapısıdır. Bu yerel hata PASS diye değiştirilmez.
- Yerel Auth namespace/search_path ve boş test-role setup hataları, fixture global test-reference çakışması, Vitest alias/case beklenti düzeltmeleri ve sandbox'ta Git child-process beklemesi korunur. Sonuncusu network-enabled yönetilen test ortamında doğrulandı; bütün integration testi2,21–4,29 saniyede geçti. File-URL browser policy engeli HTTP localhost preview ile, browser policy değiştirilmeden çözüldü. Bunlar production arızası değildir.
- Son yerel uygulama restart'ında membership500 görüldü; doğrudan SDK sorgusu200 döndü. Gateway yenilenmesinden sonra aynı son uygulama/schema ile31/31 HTTP PASS alındı. Bu son yerel bağlantı hatasının kesin iç nedeni ayrıştırılmadı; uygulama kaynağında onu örten bir yetki/koruma gevşetmesi yapılmadı. Başarısız kayıt korunur; normal Supabase kullanan exact-head ve post-merge CI ayrıca zorunludur.

## 9. Yayın kapısı ve değişen dosya sınırı

Feature dalı: `codex/phase16c0-bounded-admin-reads`. İlk push'un içinde yalnız exact dal için `git.deploymentEnabled=false` vardır. `main=false`, tüm eski branch kuralları, cron ve diğer Vercel alanları birebir korunur. [Resmî git configuration](https://vercel.com/docs/project-configuration/git-configuration) ve şema doğrulaması/read-back kullanılır.

PR kapsamı: bu rapor; tek additive SQL migration; entitlement DAL/read schemas/pagination component; dört mevcut sayfa; minimal TR/EN dictionaries/labels; focused pgTAP fixtures/assertions/query/concurrency; focused integration/UX ve localhost-only HTTP test script'i; üç mevcut Phase11 test entry point'ine yalnız bu kontrollerin eklenmesi; exact branch suppression. Workflow, worker/cron, provider adapter/route, payment/subscription mutation state-machine, private receipt/control writer, immutable build-pack, secrets veya production settings değişmez.

Normal protected PR merge için **exact PR head Application SUCCESS + Database SUCCESS** ve app15368 gerekir. Pending/cancelled/skipped/empty combined status PASS değildir. Merge sonrası final main ve iki yeni CI ayrı doğrulanır. PR/head/merge/run kimlikleri henüz oluşmadan uydurulmaz; final indirilebilir owner raporu ve PR teslim açıklamasında gerçek kimlikler verilir.

## 10. Kalan sınırlar ve sonraki owner kararı

- Bu görev deployment-free'dir. Yeni kod/migration uzak staging veya production'a uygulanmaz. Operasyonel rollout için ayrıca exact release/deployment ve acceptance yetkisi gerekir.
- Cursor canlı görünüm gezinmesidir; tüm kullanıcılar için uzun süreli snapshot veya full export değildir. Değişiklikleri görmek için refresh gerekir. Bilerek yeni maliyetli snapshot servisi/table/cache eklenmez.
- Ham SQL row JSON'ları yerine rol duyarlı allowlist sunulur. Yetkili tarihçe satırları korunur; token/PII/keyfi teknik payload veya onaysız ticari alanı görünür kılmak “tam kanıt” sayılmaz.
- Hosted kill-switch/DB flag'leri bu görevde yeniden sorgulanmaz; hiçbir uzaktan değişiklik/activation yoktur. Live ödeme, production VIP, broad outbound ve historical import yetkisi yoktur. Phase14 anonim privacy/RLS/source yapısı değişmez.
- Önce owner bu raporun final CI/merge kanıtıyla Phase16C-0 kabul kararını vermelidir. Sonraki **16C-1 financial-source contracts**, [16B bağımlılık sırası](docs/phases/PHASE_16B_SCOPE_DESIGN.md) ve C01–C03 kararlarıyla ayrıca kapsamlandırılır; bu PR gerçek financial writer/provider/receipt authority veya pilot açmaz.

**PHASE 16C-0 IMPLEMENTED — OWNER ACCEPTANCE PENDING**
