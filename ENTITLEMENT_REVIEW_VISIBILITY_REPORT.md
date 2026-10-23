# Operatörün belirsiz erişim işlerini ayırt etmesi

23 Ekim 2026, autonomous batch üçüncü repository-only paket. Başlangıç main
`3187db0fe2ba5076d9726ba67976b0b5497d9dd5` (PR110). Önceki paketlerin
protected merge/post-merge iki CI kapısı tamamlanmadan bu paket yayınlanmaz.
PR/head/main/CI gerçek final kanıtı toplu indirilebilir owner raporundadır.

## Kanıtlanmış operasyon boşluğu ve çözüm

C0 job projeksiyonu raw last_error'ı doğru biçimde redakte eder; fakat yeni R1
UNKNOWN_EFFECT ve bütçe nedenleri UI'da yalnız “Technical details restricted” olarak
sunuluyordu. Operatör hangi işte kör retry yapmaması gerektiğini ayırt edemiyordu.
Bu bir production incident veya veri sızıntısı iddiası değildir.

Yeni `admin_entitlement_job_health_v1`, mevcut paged jobs listesinin en fazla100
seçili ID'si için tek read-only batch query yapar. Tenant auth.uid+aktif membership
ve existing entitlements.read rol sınırı aynı; subscription/job scope tamamı yeniden
SQL'de doğrulanır. Duplicate/null/foreign/oversized selectors fail closed; bilinmeyen
ve yabancı ID aynı scope-unavailable cevabını verir. Yeni tablo veya writer yoktur.

Manager/super_admin/support yalnız allowlisted reason, TEST claim/reclaim/provider
failure sayaçları, effect uncertainty, lease durumu ve revision-current bilgisini görür.
Analyst SQL'de reason/effect/lease redacted, counters null alır; server ayrıca redaction
beklentisini denetler. Readonly/anon ve Admin-bypass service_role yetkisi yoktur.
Lease token, invite, Telegram ID, payer/source/raw provider error alanı yoktur.
LIVE işinde TEST counters/kanıt uydurulmaz. Financial/retry authority her zaman NONE.

Mevcut abonelik detayında yalnız “Erişim işlemleri” sekmesi bu ek read'i çağırır;
empty/non-job sekmelerinde query yok. Tarih/sayfa/cursor/C0 schema bozulmaz. TR/EN
component belirsiz sonuçta “tekrarlamayın”, tükenen bütçede “yetkili inceleme”,
revoke/reconcile için açık yükümlülük ve stale revision için güncel kaynak kontrolü
anlatır. Sayaçlar ikincil keyboard-accessible details bölümündedir. Yeni reset,
force-retry, success/refund/access writer veya form yoktur. Müşteri dili değişmez.

## Gerçek kabul

-Yeni pgTAP40 assertion (gerçek authenticated RPC/raw SELECT denial dahil).
-Focused server+C0 typed projection102 PASS; full unit827 PASS, integration384
 PASS/9 local DB-context SKIP. Lint/strict TypeScript/build ayrıca mandatory CI gate.
-Gerçek Chromium, actual component + mevcut CSS: TR/EN ×320/390/768/1440 =8
 responsive/keyboard PASS; overflow0, native Tab+Enter summary toggle, visible
 headings. Synthetic screenshots outside repo; HTTP/HTTPS tamamen blocked.
-Recovery fingerprint yeni read function body/ACL'yi kapsar. Eski source/period,
 financial metric ve anonymity privacy contracts değiştirilmez.

## Korunan başarısız denemeler ve sınırlar

İlk full integration, eski C0 actual-page fixture'ının yeni alias import/mock'u
bilmemesi nedeniyle fail oldu. Mock gerçek component'e genişletildi, eski assertion
korundu ve yeni unknown/error page kontrolleri eklendi. TypeScript nullable
counter rendering'i reddetti; null0 yapılmadan alan bilinmiyorsa gösterilmiyor.
Browser file:// navigation managed policy nedeniyle reddedildi; policy değişmedi.
Aynı owned synthetic HTML standart CDP test DOM'una yüklenip dış ağ blocked kaldı.
İlk keyboard driver Enter text event'ini eksik gönderdi; native input olayı düzeltildi,
UI programatik click/open ile zorlanmadı. Başarısız loglar final evidence'da korunur.

Bu paket review çözmez, bütçe yenilemez veya gerçek external effect doğrulamaz.
Genuine correction/activation bağımsız provider evidence, exact owner scope ve
C01–C10 kapıları ister. TEST observations gerçek financial authority değildir.
Hosted migration, deployment, payment/provider, Telegram/VIP/customer outbound,
imports, secret/permission setting ve paid infrastructure değişikliği yoktur.
Yalnız exact feature branch deployment=false eklenir; main/eski entries/crons korunur.
