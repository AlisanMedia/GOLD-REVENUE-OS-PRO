# PHASE_16B_SCOPE_REPORT

GOLD REVENUE OS PRO · 18 Ekim 2026 UTC

**PHASE 16B DESIGN COMPLETE — OWNER DECISIONS PENDING**

## 1. Ne tamamlandı, neye izin verilmedi?

Üç ticari model karşılaştırıldı; resmî Telegram ve Türkiye düzenleyici kaynakları incelendi; C01–C10 karar kaydı, payment-to-VIP sözleşmesi, işletim/rollback/scale kapıları ve sonraki dar çalışma sırası hazırlandı. Ayrıntının tek kanonik tasarımı [PHASE_16B_SCOPE_DESIGN.md](docs/phases/PHASE_16B_SCOPE_DESIGN.md) dosyasıdır. Bu rapor kurucunun karar verebilmesi içindir.

**Phase 16B yazılımı uygulanmadı.** Phase 16C–16F, üretim kurulumu, pilot, gerçek ödeme, Telegram mesajı, VIP grant, kampanya ve geçmiş müşteri import'u başlatılmadı. Phase 15 CLOSED ve Phase 16A COMPLETE — VERIFIED korunur. Daha eski genel Phase16 yasakları, yeni owner talimatıyla yalnız bu tasarım ve belge yayını için aşılmıştır.

## 2. Doğrulanmış repository durumu

| Konu | Kanıt |
| --- | --- |
| Başlangıç current main | `fec93a914b8dd29e39bcd431610b1ab3c11da46a`, GitHub API protected=true |
| Main governance | [Ruleset 25348710](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/rules/25348710), active; Application ve Database GitHub Actions 15368'e bağlı ayrı strict check; PR gerekli; review count 0; bypass yok; force push/silme engelli |
| Phase 16A | [PR #102](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/pull/102) merged; [PR CI 39143739934](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/39143739934) ve [main CI 39144072922](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/39144072922): Application + Database PASS |
| Kabul edilmiş uygulama | Phase15 app `fe823267365d7f0c554737081a7ff667cc730ae1`; [staging 39082759184](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/39082759184) önceki 59/59 sentetik kabul; yeniden çalıştırılmadı |
| Bu belge PR'ı | Rapor commit'i hazırlanırken yeni PR/head ve CI henüz yoktur. Exact PR-head iki PASS → bypass olmadan merge → exact final main iki PASS kanıtları nihai owner teslimine ve PR kaydına eklenmelidir |

Backlog/master içindeki eski protected=false ve genel Phase16 NOT AUTHORIZED satırları tarihli gözlemlerdir; 16A gerçek ayarları ve bugünkü sınırlı owner yetkisi üzerindedir. Tarihsel build-pack ve başarısız/cancelled kanıtlar değiştirilmedi. Hosted DB okunmadığından eski test invoice/subscription sayıları bugünkü rakamlar diye sunulmaz.

## 3. Ne satmak daha mantıklı?

| Model | Gelir fikri | Ana bağımlılık / risk | İlk aşama değerlendirmesi |
| --- | --- | --- | --- |
| A — lisanslı sinyal yeniden satışı | İzinli sinyal/hizmet üyeliği ve yenileme | Açık redistribution/sublicensing ve bölge/kanal hakları, ürün/ülkeye uygun düzenleyici sınıflandırma, merchant kabulü, supplier kalitesi ve sürekliliği | Onaylı lisans/ürün/talep kanıtı henüz yok; “bir supplier'a abone olup yeniden satmak” izin sayılmaz |
| B — B2B Revenue OS | Yetkili işletmeye yazılım ve gerekiyorsa kurulum/operasyon hizmeti | Gerçek B2B talep/sözleşme, rol ve privacy/merchant ayrımı; AI'ın finansal tavsiyeye kaymaması | **Önerilen ilk model**; mevcut platform yatırımını kullanır ve doğrudan içerik tedariki bağımlılığını azaltır. Henüz owner kararı veya kanıtlanmış kârlılık değildir |
| C — hibrit | Yetkili içerik satışı ile yazılım gelirini birlikte işletmek | İki ayrı hak, satıcı, gelir/maliyet ve veri kapsamı; daha yüksek operasyon/hukuk yükü | İlk doğrulama için gereksiz karmaşıklık riski; iki kol ayrıca kanıtlanırsa ileride değerlendirilebilir |

B önerisinde müşterinin son üyelerinden topladığı para bizim yazılım gelirimiz değildir. Bizim software/service faturamız ve onun membership receipt'i ayrı ticari gerçeklerdir. Henüz fiyat, supplier payı, merchant, kazanç veya talep icat edilmedi. Mevcut multi-tenant veri izolasyonu, tamamlanmış self-serve B2B SaaS billing/provisioning ürünü olduğu anlamına gelmez; bu sistemlerin yeniden yapılması önerilmiyor.

Üç model için margin, acquisition/retention, veri/taşınabilirlik, ölçek, dış provider bağımlılığı ve savunulabilirlik karşılaştırması tasarımın 3. bölümündedir. B'nin uzun vadeli avantajı içerik mülkiyeti iddiası değil, doğru operasyon, kaynaklı denetim, provider taşınabilirliği ve ölçülebilen hizmet değeridir; bunun ticari sonucu henüz ölçülmedi.

## 4. Resmî kaynaklardan çıkan somut sınırlar

- Telegram içindeki dijital satışlarda Stars gerekir; dış web sitemiz olması bot içindeki checkout kuralını kaldırmaz. Bağımsız web, Telegram'dan crypto'ya dolanma yolu değildir. [Telegram resmî ödeme politikası](https://core.telegram.org/bots/payments-stars), [ADR-006](docs/adr/ADR_006_PHASE10_MULTI_CHANNEL_PAYMENTS.md).
- Türkiye için kripto ödemesi önerisi, TCMB m.3–4 değerlendirilmeden açılamaz. Stars/Fragment'ın yerel sınıflandırması ve payout uygunluğu da varsayılmaz. [TCMB yönetmeliği](https://www.tcmb.gov.tr/wps/wcm/connect/6937855a-7c29-4d08-a26e-51ef3273c022/%C3%96demelerde+Kripto+Varl%C4%B1klar%C4%B1n+Kullan%C4%B1lmamas%C4%B1na+Dair+Y%C3%B6netmelik.pdf?MOD=AJPERES), [Telegram developer terms](https://telegram.org/tos/bot-developers).
- Supplier'ın dağıtım izni, finansal faaliyet yetkisi yerine geçmez. Yatırım danışmanlığı, genel yatırım tavsiyesi ve tarafsız finansal bilgi ayrı incelenmeli; AI'ın kişiye özel yatırım yönlendirmesi ayrıca risk taşır. [SPK izinsiz faaliyetler](https://spk.gov.tr/yatirimcilar/izinsiz-sermaye-piyasasi-faaliyetleri), [SPK 17.06.2026 güncel rehberi](https://spk.gov.tr/data/61e496a11b41c60d1404d6b2/Yat%C4%B1r%C4%B1m%20Hizmet%20ve%20Faaliyetleri%20ile%20Yat%C4%B1r%C4%B1m%20Kurulu%C5%9Flar%C4%B1na%20%C4%B0li%C5%9Fkin%20Rehber%20%28Versiyon%2C%20i-SPK.37.9%29.pdf).
- Aydınlatma, işlemeye ilişkin hukuki sebep ve pazarlama onayı aynı şey değildir. Yurt dışı cloud/AI aktarımı ayrı koşulludur; Telegram username veya önceki chat genel iletişim izni değildir. [KVKK aktarım](https://www.kvkk.gov.tr/Icerik/2053/Yurtdisina-Aktarim), [KVKK 2026/347](https://www.kvkk.gov.tr/Icerik/8710/veri-sorumlulari-tarafindan-acik-riza-ve-aydinlatma-metinlerinin-ayri-ayri-duzenlenmesi-gerektigi-hakkinda-kisisel-verileri-koruma-kurulunun-18-02-2026-tarihli-ve-2026-347-sayili-ilke-kararina-iliskin-kamuoyu-duyurusu), [Ticaret Bakanlığı](https://www.ticaret.gov.tr/ic-ticaret/ticari-elektronik-iletiler/genel-bilgiler).
- “Dijital ürün” etiketi tek başına bütün VIP hizmetlerini iadesiz yapmaz. Satıcı, hizmetin niteliği, terms, iptal/iade ve vergi/eBelge yükümlülükleri seçilmiş işlem bazında avukat ve mali müşavir incelemesi ister. Vergi oranı veya istisna seçilmedi. [Mesafeli sözleşmeler rehberi](https://tuketici.ticaret.gov.tr/yayinlar/tuketici-bilgi-rehberi/mesafeli-sozlesmeler-hakkinda-bilgilendirme), [GİB resmî portalı](https://ebelge.gib.gov.tr/anasayfa.html).

Türkiye henüz seçilmiş satış pazarı değildir; Türkçe yönetim dili ülke kararı sayılmaz. Başka pazarların lisans/promotion/privacy/vergi uygunluğu araştırılmış veya onaylı değildir. Bu çalışma lisans, merchant kabulü veya hukuki görüş vermez; somut ürün/şirket/ülke için uzman onayı gereken alanları belirler.

## 5. C01–C10 kurucu karar özeti

Tam sicil; mevcut karar, owner kararı, dış kanıt, teknik bağımlılık, acceptance ve sorumluyu tasarımın 5. bölümünde içerir.

| Kapı | Bugün elimizde olan | Canlıya geçmeden gereken / sorumlu |
| --- | --- | --- |
| C01 Model/ürün/hak | Versioned catalog, Model B önerisi | A/B/C, tek gerçek ürün ve hak zinciri, müşteri paydası; owner + commercial/legal |
| C02 Merchant/kanal | ADR-006 sınırı | Satıcı/merchant ülke ve tek yüzey, provider kabulü; owner + merchant/legal |
| C03 Gerçek ödeme | Güvenli test altyapısı, kapalı live yol | Gerçek tutarlı receipt, bağımsız kaynak, dedup ve ayrı provider kabulü; engineering + merchant |
| C04 Abonelik/VIP | Kabul edilmiş calendar/fixed-day ve fenced primitives | Gerçek terms, join/expiry/recovery bağlantısı, repurchase/refund politikası; owner + engineering/ops |
| C05 Terms/vergi | Onaylı ticari veri çerçevesi | Ürün/ülkeye uygun claims, terms, refund/tax; legal/tax + owner |
| C06 Privacy/consent | RLS, opt-out, anonim k≥5; survey ürün seçimleri final | İzinli cohort, amaç, retention/legal hold ve transfer/DPA; privacy + owner |
| C07 İnsan operasyonu | Case/takeover ve eski tek staging manager alert | Primary/backup ve saat/hedefler, live bildirim yetkisi; owner + ops |
| C08 Üretim/recovery | GitHub release/environment koruması | Ayrı production/MFA, backup/restore ve RPO/RTO; owner + infra/security |
| C09 Maliyet/kapasite | Telemetry, missing-cost güvenliği | Gerçek fiyat/billing, bütçe/queue/p95/expiry hedefi ve ölçüm; owner + finance/engineering |
| C10 Exact release/cohort | Zorunlu iki CI ve bypass kapalı | Entegre yeni dar kabul, exact SHA ve her cohort için ayrı owner GO |

Eksik ticari girdiler tasarımın tamamlanmasını engellemez; ticari pilotu engeller. Şu an bütün ticari giriş sicili **NO-GO** kalır. Önceden kararlaştırılmış Phase14 survey audience/triggers/channels/topics, 4–5 soru, privacy seçenekleri ve AI çıktıları tekrar sorulmuyor. Onaylanmamış live cadence/cohort/retention/gerçek gönderim kararları ayrı kalır.

## 6. Gelecekte ödeme nasıl VIP erişimine dönüşecek?

Onaylı teklif ve değişmez ürün/plan snapshot'ı → tek merchant/yüzey invoice'u → authenticated provider confirmation → payer/tutar/asset/network ve transaction kimliğinin bağımsız kontrolü → immutable actual-amount receipt ve trusted event/outbox → tek payment period → doğru numeric Telegram kullanıcı/kanal bağlama → gerçek join request → yetkili onay → gözlenmiş membership. Bu hedef akıştır; tamamı canlıda bağlı değildir.

Mevcut private receipt tablosu actual received amount/currency saklamaz; bu nedenle “receipt ID var” diyerek Phase15 gelir grafikleri açılmaz. Yeni tasarım amount/provenance sınırını tanımlar, bu turda writer veya şema eklemez. Stars bakiyesi, supplier ücreti, teklif fiyatı ve bankaya ulaşan nakit ayrıdır. Eksik maliyet sıfır kabul edilmez; gerçek MRR/ARR, refund, margin/CAC/LTV/ROI gerekli kanıt/policy yoksa UNAVAILABLE kalır.

Mevcut [Stars verifier](apps/web/src/lib/payments/telegram-evidence.ts) recurring ödemeyi reddeder. Resmî API'deki native 30 günlük recurring ile mevcut takvim ayı birbirinin yerine kullanılamaz. İlk kapsam için otomatik tahsilatsız one-off önerilir; bu da gerçek plan/süre onayı değildir. [Bot API](https://core.telegram.org/bots/api#createinvoicelink).

Tasarımın 26 kabul senaryosu; duplicate/replay, wrong tenant/payer/amount/network, expired invoice, refund, ledger kesintisi, concurrent/crash/stale processing, Telegram permission/yanlış join, cancellation/expiry, test→live reddi, takeover/consent ve privacy'yi kapsar. Bunlar **gelecek test beklentileridir**, yeni test PASS veya provider kabulü değildir. AI ve manager review kendiliklerinden ödeme/erişim otoritesi yaratamaz.

## 7. Risk, işletim ve uygulama sırası

| Öncelik | Doğrulanmış olan / henüz kanıtlanmayan | Sonraki gereklilik |
| --- | --- | --- |
| P0 ticari gate | Lisans/merchant/ürün/ülke/consent/terms tamamlanmış değil; hukuka aykırı işletim tespiti yapılmadı | C01–C06 dış kanıt ve owner kararları |
| P0 teknik gate | Gerçek tutarlı receipt writer ve integrated live ödeme→VIP yolu yok; test kapsamının kasıtlı sınırı | C03/C04 ayrı implementation ve gerçek provider kabul yetkisi |
| P0 ops gate | Production restore, staffed coverage ve sayısal limit kanıtı yok | C07–C10; runbook veya staging başarısını prod proof saymamak |
| P1 somut read/işletim sınırı | Admin access/payment/job/audit aggregate'ları sınırsız; join router/scheduler live loop'a bağlı değil | Bounded read paketi; ardından fake-provider event/retry/recovery kabulü |
| P1 policy/safety sınırı | Cancelled repurchase; live-off revoke claim'i de durdurur | Exact owner policy ve ayrı yetkili correction yolu; kill switch mevcut erişimi kendiliğinden geri almaz |
| P1 hipotez | Lease/hold sonrası provider etkisi, raw invitation projection ve plan overlap riskleri | Sentetik reproducer/role projection incelemesi; exploit diye sunulmaz |
| P2 gelecek | Multi-brand, self-serve SaaS billing, partner payouts, FX, warehouse | Talep/ekonomi/ölçüm ve yeni owner scope olmadan yapılmamalı |

Kaynak kod satırları ve ayrıntılı risk matrisi tasarımın 2/12. bölümlerindedir. Daha önceki 58 join polling hatası eski izole provider kabulünün kanıtıdır; yeni üretim olayı değildir ve bu çalışma testi tekrarlamadı.

Önerilen sıra: **16C-0 bounded Admin read → 16C-1 financial-source sözleşmeleri → 16D payment/VIP reliability → 16E recovery/operations/cost kanıtı → 16F ayrı izinli integrated provider/pilot gate.** Bunlar yetkilendirilmiş yeni fazlar değildir. Ticari seçimleri beklerken en küçük bağımsız uygulanabilir iş 16C-0'dır; mevcut read kısıtını synthetic CI ile düzeltir, para/abonelik/worker yazmasına dokunmaz. Büyük live provider implementasyonuna belirsiz ürün/merchant ile başlanması önerilmez.

İlk 10 için C01–C10 tam, açık P0=0, yetkisiz işlem=0 ve kapsam içi receipt/period/membership mutabakatı %100 olmalı; bütçe/latency/expiry/observation/coverage ve RPO/RTO hedefleri owner tarafından sayısallaştırılıp ölçülmelidir. Bu sayısal işletim girdileri uydurulmadı. 25/50/100'e her artış ayrı owner kararı ve hedef yük/ekonomi/recovery kanıtı ister; bir gate diğerini otomatik açmaz.

## 8. Owner'dan gereken tam kararlar

Önce yönü netleştiren beş karar: **D01 model; D02 satıcı/merchant ve hedef ülke; D03 gerçek ürün/hak sahibi; D04 tek checkout yüzeyi; D05 pilot müşteri paydası.** B önerisini benimsenmiş saymıyorum. Tek tenant'ın 10 son üyesi ile 10 B2B işletmenin farklı pilotlar olduğunu özellikle ayırdım.

Canlıdan önce ayrıca D06 gerçek fiyat/süre/yenileme/cancel/refund/repurchase; D07 lawful cohort/contact/privacy/retention; D08 insan coverage; D09 kaynaklı maliyet/cap/ölçüm hedefleri; D10 exact provider test hedef/tutar/count izni; D11 production/recovery yetkisi ve hedefleri; D12 sonraki dar uygulama, exact release ve cohort GO. Bunların cevapları public PR'a kişisel/secret bilgi olarak konulmamalı; özel kanıtın onaylı referansı yeterlidir.

## 9. Önerilen sonraki Codex talimatı — ayrı onay bekler

```text
GOLD REVENUE OS PRO — PHASE 16C-0 BOUNDED ADMIN READS ONLY

Owner authorization: yalnız B08 entitlement Admin read-model iyileştirmesi.
Güncel main ve ruleset 25348710'u doğrula; Phase16B tasarımını yeniden kullan.
Mevcut subscriptions/channel-access/Customer360 tüketicilerini koruyarak
access, payment-period, job ve audit okumalarını bounded, stable pagination
ve least-privilege secondary evidence projections ile sınırla.
Gerekli değişiklik yalnız read RPC/migration, mevcut frontend ve focused
sentetik testlerle sınırlı olsun; receipt/payment/period/entitlement yazma
otoritesi, state-machine, LIVE activation, cron veya provider routing değiştirme.
Önce ölçülebilir projection/EXPLAIN baseline al; missing/cross-tenant/RBAC,
pagination/drift, kanıt kaybı olmaması, TR/EN ve mobil okunabilirliği doğrula.
Implementation dalı: codex/phase16c0-bounded-admin-reads.
Owner bu önerilen komutu ayrıca onaylarsa yalnız o exact dal için
vercel.json deploymentEnabled=false eklenmesini de yetkilendirir;
main=false, diğer dal kuralları ve cron korunur. İlk push suppression
içermeli; mekanizma doğrulanamazsa publication durur. Bu dar istisna
global Vercel ayarı, production veya deployment yetkisi değildir.
Application ve Database exact-head PASS sonrası normal PR merge ve
post-merge iki CI şarttır; owner bu dar PR merge'ini yetkilendirir.
Deployment veya gerçek provider kabulü bu komutta yoktur.
Phase16C-1/16D+, ticari pilot, payment/VIP/outbound/import kapalı kalır.
Sonuç raporuyla dur; kapsamı genişletme veya fazı kendiliğinden kapatma.
```

Bu öneri mevcut bir uygulama emri değildir. İçindeki exact feature-dal suppression istisnası da yalnız owner bu sonraki komutu ayrıca onaylarsa geçerlidir; mevcut 16B'de vercel.json değişmez. Owner başka bir paketi seçerse o paketin exact scope ve güvenli yayın yetkisi ayrıca tanımlanmalıdır.

## 10. Belge teslimi ve değişmeyen kontroller

Yalnız `docs/phases/PHASE_16B_SCOPE_DESIGN.md` ve `PHASE_16B_SCOPE_REPORT.md` eklenir. Mevcut `docs/master-product-context-20261016` dalının exact deployment suppression'ı ve `main=false` push öncesi geri okunur; vercel.json, workflow, infra, kod, DB schema ve secret değişmez. Markdown/yerel hedef ve kaynak referans kontrolü, PII/secret taraması, exact diff ve git diff --check gerekir. İki exact PR-head CI PASS olmadan merge yok; final main'de de iki check aranır. Yeni deployment/Preview olmadığı Vercel kayıtlarıyla doğrulanır.

Rapor hazırlanırken yayın kimlikleri bilinmediği için uydurulmadı. Final owner dosyası ve PR teslim kaydı gerçek PR/head/merged SHA ve run sonuçlarını ekler. Bu turdaki CI repository'nin mandatory yayın kapısıdır; eski controlled staging veya gerçek Telegram/provider matrisi yeniden dispatch edilmez. Canlı DB flags bu turda yeniden sorgulanmadı; çalışma bunları değiştirmedi veya aktivasyon işlemi başlatmadı.

Araştırma, mevcut cloud/runtime ve Firecrawl güvenlik yönergeleriyle yürütüldü. Telegram için Firecrawl unsupported sonucu korunarak mevcut web okuma aracına geçildi. Hiçbir yeni ücretli hizmet/provisioning, provider ödeme kabul testi, müşteri/manager mesajı, production entitlement, tarihi import veya Phase16C uygulaması yapılmadı.

**PHASE 16B DESIGN COMPLETE — OWNER DECISIONS PENDING**

Phase 16B yazılım uygulaması CLOSED değildir. Ticari pilot NO-GO; burada durulur.
