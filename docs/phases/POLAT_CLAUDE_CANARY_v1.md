# Polat Claude canary v1 — ÖNERİ / GERÇEK İSTEK YETKİSİ YOK

2026-10-25. [Kod ve golden hash](../../packages/domain/src/polat-claude-canary.ts), [aynı owner karar föyü](POLAT_REAL_MODEL_ACCEPTANCE_MANIFEST.md), [uygulama sınırı](../../POLAT_GENUINE_EXPERIMENT_BRIDGE_IMPLEMENTATION_REPORT.md).

Bu ayrı kabul kapsamı, tam `polat-multiturn-v2` değerlendirmesinin yerine geçmez. V2 corpus/hash, 290 hedef ve tarihsel sonuçlar değişmedi. 290 istek / 5.00 USD **NOT APPROVED**. Canary için de dış istek yetkisi **0**, spend/currency onayı **null**.

| Alan | Tam değer / anlam |
| --- | --- |
| Plan | `polat-claude-canary-v1` |
| Plan SHA-256 | `372b81b5017359aef85f3b4080c1ff7f6bf9193459c30a2505425fc5463066c5` |
| Ayrı corpus SHA-256 | `1afc425d131e4f3e7ee82976e034b703fffbd59bd388b6c1738a6617290d3630` |
| Tek hedef hash | `fad046264ce333ee1cd696ed4dee62c0f361be401368857e8e3267b1a4e1b37c` |
| Aday | Anthropic / exact `claude-haiku-5-5`; gerçek hesap/model erişimi doğrulanmadı |
| Girdi | Yalnız uydurma test bağlamı; English / DIRECT / `Hi`; Polat'ın AI asistanı kimliğini açıkça belirtmeli |
| İstek sayısı önerisi | En fazla **1 started request**; failed/timeout/unknown da sayılır |
| Teknik öneri | Output ceiling512, timeout10000ms, stream=false; retry/fallback/QA regeneration0 |
| Protokol | Kabul edilmiş adapter pin'i `2023-06-01`; güncel belgelerdeki örnek `2026-10-21` ile aynı sürüm olduğu iddia edilmez |
| Onaylı tutar/para birimi | **YOK**; gerçek tarife, worst-case liability ve bağımsız billing/account cap kanıtı gerekir |

Hash'ler mevcut canonical UTF-8/SHA-256 yardımcılarıyla ayrı üretilir. Planın kopyasını değiştirmek, hash eşleştirmek veya modele API key vermek runtime yetkisi yaratmaz. Tam v2 için geçerli bir gelecek onay da bu ayrı canary'yi kendiliğinden yetkilendirmez. İlgili canary/version/hash, exact repository SHA, protokol, request/output/time sınırları ve bütçe aynı mevcut manifestin ayrıca incelenen versioned kapsamına açıkça bağlanmalıdır; yeni paralel onay sistemi yoktur.

## Ayrı yetki geldikten sonraki kabul sırası — şimdi ÇALIŞTIRILMAZ

1. Hesap/model erişimi, veri bölgesi/retention/training, bağımsız owner authorization, etkin account kontrolü ve durable run custody doğrulanır. Aylık workspace limiti transactional experiment bütçesi değildir. Korumalı credential custody ve yalnız yetkili runner gereklidir.
2. Aynı server-owned authorization/account/run kimliği altında request ve exact-decimal liability DB'de atomik olarak rezerve edilip commit'i doğrulanır. Run klasörü/restart, counter veya unknown sonucu sıfırlayamaz. Committed dispatch işareti olmadan socket açılmaz. Başlamış deneme yeniden gönderilmez.
3. Yalnız sabit `https://api.anthropic.com/v1/messages` için tek istek: exact model/response identity, tamamlanma, nullable metadata ve native output/evidence doğrulanır. Container/tool/refusal/unsupported/partial sonuçlar fail closed. Actual model text aynı Phase7 QA'ya gider; güvenli fixture yanıtıyla değiştirilmez.
4. Monotonic süre ve gerçekten raporlanan token/cache/thinking sayıları kaydedilir. Nonstreaming ilk-token ölçümü **UNKNOWN**. Model faturası token×tarife veya test tutarından türetilmez. Abort, uzakta iptal/ücretsiz işlem/refund kanıtı değildir.
5. Response/usage/billing/request sayısı bağımsız olarak uzlaştırılır. Cost eksik, model/protokol drift, provider error, QA hold veya unknown completion varsa **STOP + REVIEW**; başka istek ve kör retry yok. Başarısız ilk denemeye replacement çağrı eklenmez.

Gerçek canary bile Türkçe doğallık, iki stilin kalitesi, customer satisfaction, dönüşüm veya insan kalite kabulü değildir. Bağımsız insan-review kapsamı ve tam corpus deneyi ayrı kalır. Şimdiki testler fake network ve disposable PostgreSQL içindir; gerçek Anthropic response/latency/billing **NOT TESTED**.

Rollback: ağı açma/credential çözümleme yapılmaz; future approved runner durdurulur ve unresolved reservation korunur. Audit/history silinmez. Supplier/merchant/consent/payment/VIP/pilot izinleri canary ile değişmez.

`REAL_MODEL_EXECUTION=false`; `AUTHORIZED_EXTERNAL_REQUESTS=0`; `HUMAN_REVIEW_PENDING`; `financial_authority=NONE`; `COMMERCIAL_PILOT=NO_GO`; `PHASE16C-1=OPEN`.
