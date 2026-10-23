# Sinyal ticari entegrasyonu — sentetik sözleşme paketi

Kapsam: sahibin dört paketlik sinyal altyapısı yetkisindeki bağımsız D paketi. Gerçek satış, ödeme, müşteri listesi, Telegram bağlantısı veya yayın açılmaz. Genel Phase16C-1 OPEN, ticari pilot NO-GO kalır.

## Gerçekte eklenen

`packages/contracts/src/signal-commerce.ts` ve `packages/domain/src/signal-commerce.ts`, mevcut FinancialSourceContract v1, Phase10 `assertPaymentSurface`, Phase11 takvim/gün/grace hesapları ve tenant/müşteri/teklif/fatura bağlarını tekrar kullanır. Yeni muhasebe defteri, ödeme sınıflandırıcısı, receipt/event yazıcısı veya abonelik tüketicisi oluşturulmaz. Kaynak sözleşmelerin birbiriyle tutarlı olması gerçek ödeme kanıtı sayılmaz.

Teklifin onaylı/süreli/değişmez sürümü; bağımsız finansal gözlem; aynı fatura ve teklif snapshot'ına bağlı TEST abonelik; güncel fixture kimlik/üyelik kanıtı; aynı hedefe ait güncel, duraklatılmamış sentetik tedarikçi rotası ayrı ayrı incelenir. Eksik, çelişkili, eski veya başka tenant'a ait bağlar ilerlemeyi durdurur. Üyelik kopyası, müşteri sözü, ekran görüntüsü veya callback cache'i bağımsız ödeme doğrulaması değildir. Bir müşterinin aboneliği yayın kanalını açamaz.

Çıktı daima `OFFLINE_CONSISTENCY_ONLY`, `financial_authority=NONE`, `signal_access_authority=NONE`, `live_operations_authorized=false`, `commercial_verdict=NO_GO` içerir. `SANDBOX_READY`, yalnız sunulan sentetik sözleşmelerin uyumunu anlatır; tahsilat/paid state/signal delivery kanıtı değildir. C01, C02, C03 onaylanmış sayılmaz.

Kripto varlık/ağ/kontrat/ondalık hassasiyeti, gerçek alınan tutar, finality/canonicality, yanlış ağ/tutar, refund/reorg, replay ve global işlem kimliği mevcut finansal değerlendirmeye bırakılır. FX, cüzdan/adres, merchant veya ağ seçimi yoktur. Telegram bot/mini-app içinden external crypto checkout reddedilir; bağımsız web örneği yalnız fixture senaryosudur. Gerçek Stars veya kripto kabulü ayrıca hukuki/merchant/provider onayı gerektirir. Eksik ücret/maliyet ve gerçek kârlılık Phase15 kapsamında unavailable kalır.

Eski müşteriyi yeniden değerlendirme sözleşmesi yalnız metadata kabul eder: kaynak kuruluş, provenans hash'i, tenant sahipliği, verinin kullanım hakkı, incelenmiş hukuki dayanak, kanal ve amaç bazlı ayrı pazarlama izni, suppression/opt-out, takeover/açık destek, süre/retention/legal hold, sıklık geçmişi ve yerel saat penceresi. Müşteri/telefon/Telegram ID listesi, import veya sender işlevi yoktur. Geçmiş sohbet veya tedarikçi ilişkisi izin yerine geçmez. Anonim anket cevabı müşteri adayı olamaz. Her sonuç `import_authority=NONE`, `outbound_authority=NONE`; müşteri dili varsayılanı İngilizcedir.

## Kabul ve sınırlar

57 ağsız senaryo ile yanlış tutar/ağ, screenshot/callback-cache, reversed/pending ödeme, başka müşteri/tenant, eski revizyon, hold/cancel/expiry, belirsiz üyelik, bilinmeyen haklar, Telegram/crypto kanal ayrımı; consent/suppression/saat/süre/sıklık ve anonim kaynak yasağı kontrol edilir. Hazırlık sırasında depo dışı test düzenindeki Zod çözümleme hatası giderildi; gerçek PR'da proje toolchain'i ve tam Application/Database kapıları ayrıca çalışır. Kesin PR/head/merge/CI kanıtı nihai konsolide dosyada kaydedilir; eski başarılı CI yeni kabul sayılmaz.

Depoya entegrasyondan sonra gerçek yerel sonuç: 57 odaklı senaryo; toplam 953 unit PASS, 390 integration PASS / 9 mevcut DB-context SKIP, lint/strict TypeScript/build ve 156 yerel Markdown bağlantısı PASS. Database CI mevcut gerçek PostgreSQL bridge testlerini ayrıca yürütür; yerel SKIP, DB PASS sayılmaz.

Migration yok; kabul edilmiş payment, receipt/event, subscription/access state machine, survey privacy, worker/cron, metric definitions ve hosted ayarlarda değişiklik yok. [İşletim sınırları](infra/runbooks/signal-commercial-readiness.md), [Phase16B tasarımı](docs/phases/PHASE_16B_SCOPE_DESIGN.md), [pilot C01–C10](docs/phases/PILOT_ENTRY_v0.1.md).

Gerçek bağlantı önkoşulları: sağlayıcı/kanal/içerik/ülke bazında belgeli dağıtım hakkı; izinli teknik feed; açık source/destination allowlist; hesap ve kanal yetkisi; güvenli oturum yönetimi; kayıp update ve gerçek medya uyumu; ayrı hedef/adet/etki tanımlı provider kabulü; hosted release/migration için yeni yetki. Normal üyelik kopyalama/yeniden satma hakkı veya korumalı içerik bypass izni vermez. Eski müşteri portföyüne gerçek erişim ve iletişim ayrı hukuki/sahip onayı olmadan kapalıdır.

## Mevcut zorunlu regresyonda deterministik fixture düzeltmesi

A paketi post-merge CI40011774162 Application PASS / Database FAIL verdi: Phase16C-0 test136 tenant-wide ilk access satırının davet taşımasını bekliyordu. Legacy fixture rastgele UUID kullandığı için daha büyük, davetsiz satır önce gelebiliyordu; SQL sonucu NULL oldu. Runtime read/izin semantiği değiştirilmedi. Aynı manager kontrolü artık bilinen fixture aboneliğini doğrudan okuyup davet değerini eksiksiz eşitlikle doğrular. Deterministik bir yüksek-ID REVIEW/no-invite karşı-örneği eklendi; ilk satırın davetsiz olabileceği ayrıca doğrulanır. Diğer authorization/redaction, pagination ve integrity assertions korunur. Bu test-only düzeltme D paketinin mevcut abonelik regresyon kabulüne dahildir; başarısız tarihsel CI PASS diye yeniden yazılmaz.
