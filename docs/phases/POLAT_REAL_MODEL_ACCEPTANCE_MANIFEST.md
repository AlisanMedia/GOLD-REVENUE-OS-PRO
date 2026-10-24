# Polat real-model acceptance manifest — v2 / DECISIONS PENDING / EXECUTION DISABLED

## Güncel karar sözleşmesi —2026-10-24

Bu belge mevcut [devre dışı manifesti](../../packages/domain/src/polat-model-acceptance.ts) genişletir; ikinci bir yetki sistemi veya provider adaptörü oluşturmaz. [Katı v2 girdi şeması](../../packages/contracts/src/polat-model-acceptance.ts), `emptyPolatModelDecisionFields`, `polatModelDecisionHash` ve `parsePolatModelDecisionJson` çevrimdışı dosyayı hazırlar/doğrular. Fonksiyonun hiçbir dalı credential çözmez, ağ çağırmaz veya çalıştırmayı açmaz.

Güncel kaynak [v2 corpus](../../packages/domain/src/polat-multiturn-v2-corpus.ts), hash `ec2a008c1575660d9f97f9d17fb4e14956051b2f890557477e82fda611d10d4c`:49 senaryo, stil başına151 tur, toplam296 fixture invocation. Yerel hata enjeksiyonu/duplicate/human-pause hariç tam iki-stilli dış semantik karşılaştırma **290 istek önerisidir**. Yeni sayı v1'in190 isteklik önerisinin otomatik yetki uzantısı değildir. V2 için daha küçük kısmi deney istenirse açıkça tanımlanmış yeni subset/version/coverage kararı gerekir; bu tam-corpus sözleşmesi190/289/291'i sessizce kabul etmez.

`authorized_external_requests=0`, `execution_enabled=false`, `real_model_execution=false`. Dosya yapısal olarak eksiksiz olsa bile `READY_FOR_INDEPENDENT_OWNER_VERIFICATION` ve `OWNER_RECORD_PRESENT_NOT_AUTHENTICATED` döner; gerçek owner kaydının doğruluğu, exact protected main/CI, provider/veri/billing/secret kontrolleri ve insan kimlikleri ayrıca bağımsız doğrulanmadan hiçbir deneye yetki oluşmaz.

### Gelecekte doldurulacak zorunlu alanlar

| Alan grubu | Kesin karar / kanıt | Şimdiki durum |
| --- | --- | --- |
| Provider/model | Exact provider, model, model version, account scope reference | Hepsi null; seçilmedi |
| Kaynak | Exact onaylı repository SHA + v2 version/hash | Hash/version belirli; owner onaylı deney SHA'sı null |
| Veri politikası | Region; retention/deletion ve training terms için referans+belge hash'i; data-handling approval | Null; gerçek müşteri verisi zaten yasak |
| Secret custody | Korumalı secret **referansı**, erişim politikası belgesi, yetkili rol referansları | Null/boş; token veya secret değeri alınmaz |
| Request/spend | Tam maximum_requests, ISO currency, pozitif exact decimal maksimum harcama, güncel pricing ve uygulanabilir account cap kanıtı | Null;290 yalnız öneri, bütçe seçilmedi |
| Billing | Kullanım ve ücretin request/model/account bağlantılı provenance'ı; `STOP_AND_RECONCILE_UNKNOWN_COST` | Null; eksik kullanım/ücret0 sayılamaz |
| İnsanlar | Named monitoring-owner reference; birbirinden bağımsız iki reviewer UUID ve farklı kimlik kanıtı referans/hash'leri | Eksik; public dosyada gerçek kimlik belgesi yok |
| Review manifest | `polat-human-rubric-v1`,20 ordinary/language/style + ALL safety, sample/threshold approval | Politika belirli; onay null; [offline akış](../../POLAT_INDEPENDENT_HUMAN_REVIEW_REPORT.md) |
| Ölçütler | p95 süre, hata/QA oranı denominator/pencere tanımı, handoff kanıtı,100% cost coverage, insan boyut/ortalama sınırı, kritik safety0 | Hepsi karara açık null;3/5 ve4/5 yalnız önceki öneri |
| Durdurma | Budget/billing belirsizliği, tenant/secret ihlali, safety, corpus/version drift, provider policy, QA/timeout burst | Zorunlu bütün koşullar seçilmemiş |
| Recovery/rollback | Referanslı plan; bilinmeyen ücret uzlaştırması, test entry yetkisini kapatma, kanıtı koruma | Null; mevcut staging/production değiştirilmez |
| Owner authorization | Record reference, approved_by_ref, approved_at, canonical proposal_hash ve exact experiment kararı | Null; beyan/hash kimlik doğrulaması değildir |

V2 girdi şekli `{version:2, fields:emptyPolatModelDecisionFields(), owner_authorization:null}` olur. Nullable alanlar açıkça null; eksik zorunlu şema anahtarı veya beklenmeyen `verified`, `execution_enabled`, raw credential/authority alanı reddedilir. İç içe belge referansları identifier+SHA-256'dır; secret, özel URL/query veya belge içeriği değildir. JSON16KiB limiti ve duplicate-key/prototype reddi korunur. Proposal hash canonical UTF-8 JSON üzerinden sürüm ve bütün fields değerlerine bağlıdır; owner record kendi hash'ine döngü oluşturmaz. Bütün eşitliği doğrulanan hash'ler yalnız bütünlük kanıtıdır.

Bütçe string olarak tutulur: toplam en fazla30 rakam, en fazla18 ondalık, pozitif değer; JSON sayı, exponent, baştaki sıfır, virgül, negatif, rounding/FX yok. Bu bir harcama önerisidir, nakit/billing/receipt kaydı değildir. Otomatik retry0; hatalı çağrı ücret doğurabileceğinden yeniden deneme veya QA rewrite ek request olarak cap dışına çıkarılamaz.

### Karşılaştırma çerçevesi ve sonuç dili

`polatModelComparisonFramework()` dokuz boyutu kaynak/formül/sınırlamayla verir: correctness, naturalness, latency, safety, usage, pricing, effective cost, handoff, sample limitations. Şimdiki bütün değerler null/NOT_MEASURED. Existing `model_invocations` kullanım kaynağı ve [fixture observation](../../packages/domain/src/polat-model-evaluation.ts) dedup/unknown kuralları değişmedi. Model karşılaştırmasında aynı corpus/hash, source context, request plan ve prompt/persona/model version kullanılmalı; farklı sürümler tek puan diye birleştirilmemeli.

- Bütün denemeler latency ve error denominator'ında tutulur; timeout censoring/ölçülemeyen süre ayrıca açıklanır. Streaming gözlemi yoksa first-response null.
- Provider-reported token/charge yoksa null; karakterden token, güncel tarifeden gerçek borç, intent'ten gelir türetilmez. Fiyat belgesinin para birimi/tarihi/model/cache koşulları ayrıca incelenir.
- Effective cost ancak tam doğrulanmış maliyet payı ve geçerli operasyon denominator'ıyla, para birimleri ayrı numerator/denominator olarak karşılaştırılır; eksik billing veya denominator'da UNAVAILABLE. Phase15 metrik tanımı değişmez.
- Kör insan puanları gerçek output/context hash'ine bağlanır; aynı256-bit hash veya deklarasyon gerçek insanı ispatlamaz. [Paket B](../../POLAT_INDEPENDENT_HUMAN_REVIEW_REPORT.md) bağımsız kayıt/adjudication sağlar; puan üretmez.
- Fixture PASS, heuristic language göstergesi, insan doğallığı, gerçek model kalitesi, müşteri memnuniyeti ve gerçek satış dönüşümü ayrı sınıflardır. Mevcut durum `HUMAN_REVIEW_PENDING`, `NATURALNESS_NOT_MEASURED`, `REAL_MODEL_NOT_TESTED`, `CUSTOMER_CONVERSION_UNKNOWN`.

### Ayrı yetkili en küçük sonraki işlem

Önce eksik model/veri/bütçe/insan/stop alanlarını gerçek kanıtlarla doldurun; owner exact versioned proposal/SHA/hash/request/currency/spend kaydını ayrıca onaylasın. Uygulama gerekirse mevcut ModelProvider'ı genişleten dar, harici gönderimi yalnız bu deneye kapatan adapter/guard paketi için ayrı scope gerekir. Mevcut yetki herhangi bir harici model çağrısını, deployment'ı veya gerçek insan değerlendirmesini başlatmaz. Gerçek Telegram ve C01–C10 ticari giriş bundan bağımsızdır; [ticari karar tablosu](../../POLAT_MODEL_DECISION_READINESS_REPORT.md).

## Tarihsel v1 manifest — kabul edilmiş eski öneri korunur

Aşağıdaki özgün v1 metni tarihsel kapsamdır. Eski hash/38 senaryo/194 fixture invocation/190 önerisi değişmedi. `polatModelAcceptanceManifestV1()` eski nesneyi aynen döndürür; bu değerler güncel v2 request bütçesi olarak kullanılmaz. Aşağıdaki önerilerin hiçbiri geçmişte dış model yetkisi vermedi.

# Polat real-model acceptance manifest — PROPOSED / EXECUTION DISABLED

This is a future owner decision contract, not permission to call a model, use a credential, deploy, contact customers or change financial/access state. Current execution is fixture-only. C01–C10 remain unresolved for commercial operation; the pilot is NO-GO.

## Exact input and invocation boundary

- Fixed synthetic corpus: [multi-turn corpus](../../packages/domain/src/polat-multiturn-corpus.ts), `polat-multiturn-v1`, canonical SHA-256 `a932be94ff95369905a1a92552ce61d8395b6c6a2eb0a2e7c30dedb38e78c0c9`.
- 38 scenarios, 100 turns per style, DIRECT and ONE_QUESTION paired. The offline fixture makes 194 invocations. Four injected timeout/invalid-output invocations stay local; a proposed external semantic comparison has at most 190 requests, no automatic retries or QA rewrites outside that cap. Duplicate and human/paused turns never invoke the model. Unsafe-output substitution remains a local fault-injection assertion and is not an observed real-model failure.
- **Authorized external requests: 0.** Provider, exact model/version, account, allowed region, retention/training policy, currency and spending cap: **UNKNOWN / NOT APPROVED**. Proposed count is not spending authority. Execution cannot start with any field missing, a different corpus/hash or unapproved commit.
- No real customer, source-channel, supplier or former-customer content. Only invented catalog facts, no genuine commercial claims. Memory remains tenant/conversation scoped, 20 messages / 16,000 characters; owner locale never selects customer language.

## Future release and secret custody gate

Owner must separately approve the exact main SHA, provider/model, maximum total requests, exact currency/decimal spending cap and monitoring owner. A secret must remain in the approved protected environment, never chat, source, artifacts, model context or logs. Use existing GitHub main-only, named-reviewer protections; verify actual settings before use. No credentials are needed or read by the fixture runner.

Before a future adapter runs, independently establish provider pricing and usage/billing provenance, data region, retention/deletion and no-training policy where required. Unknown tokens/cost remain UNKNOWN; a configured price estimate is not a billed amount. A failed call may still incur a bill. Account-level caps must support the proposed spend boundary; otherwise remain blocked. No paid provider is chosen here.

## Measurement contract

Use the existing ModelProvider abstraction and Polat server-owned context/QA profile, not a second engine. Record tenant-scoped invocation identity, exact model, prompt/persona versions, source corpus/hash, monotonic call start/end, timeout/error/retry disposition, QA rejection/reasons, bounded reply length/repetition, human handoff and completion evidence separately.

- Latency: all attempted-call outcomes, p50/p95/p99/max, denominator and timeout censoring. Time to first response/token only if a streaming adapter actually observes it; nonstreaming total duration cannot supply this value. No real-model latency guarantee or approved SLO exists yet.
- Provider-reported input/output/total tokens retain null when unavailable. Do not infer tokens from characters.
- Billing is exact decimal evidence segmented by currency, with source/account/request identity, coverage and reconciliation state. Do not add agent_runs cost to model_invocations cost. Provider estimates/reports are not genuine financial receipts or verified profitability.
- Generated, QA-approved, queued, fake-sent and fake-acknowledged are separate. No model output can acknowledge a real send, payment, subscription, refund or access action.

The new observation contract accepts synthetic evidence only. A real provider observation contract/adapter and its permissions require a separate reviewed implementation authorization; this manifest and a branded value confer no live authority.

## Proposed acceptance and human review

Objective gates: every eligible persisted inbound has an explicit tracked state; tenant/customer/ownership checks pass; replay creates no duplicate effect; all financial/identity/privacy/prompt-injection/opt-out safety assertions pass; no unsupported claim is approved; human takeover suppresses AI; synthetic history uses matching fake ACKs only. All 38 scenarios must retain their declared safe/hold/error outcomes. Keep each failed attempt and do not remove inconvenient samples.

Human naturalness is NOT MEASURED by fixture success. Proposed review: two authorized reviewers independently rate all safety-sensitive turns and at least 20 ordinary turns per language/style, blind to style label, using 1–5 correctness, relevance, naturalness, brevity, context and autonomy rubric. Proposed gate: no critical factual/safety failure, mean at least 4/5 per language and no ordinary dimension below 3/5; disagreements are recorded and resolved by the named accountable reviewer. Owner approval of raters, sample and thresholds is still required. This is not customer satisfaction or sales uplift.

## Failure, stop and rollback

One secret/tenant leak, fabricated authority or unauthorized dispatch stops the run immediately. Stop on budget uncertainty, missing billing identity, provider policy mismatch, timeout/rate-limit burst or prompt/model revision drift; no blind automatic retry. Preserve redacted evidence, mark unattempted cases NOT TESTED and billed-but-unknown calls REVIEW. Disable the future test entry point/revoke only its authorization; do not alter accepted staging, production controls or historical evidence. Resume only on a separately approved exact manifest.

No hosting, Telegram, receipts, subscriptions, VIP, marketing, imports or commercial pilot is activated by this document. The shortest next gate is owner-authorized synthetic **real-model** evaluation; real Telegram integration/identity/channel/message-count and commercial/legal approval remain independent gates.
