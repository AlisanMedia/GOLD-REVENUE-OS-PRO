# Gold Revenue OS — GAP ANALYSIS

Tarih: 12 Eylül 2026 · Phase 0 · Durum: Bulgu ve öneri kaydı

## 1. Nasıl okunmalı?

Bu kayıt, yalnız “kod henüz yok” listesinden oluşmaz. Greenfield projede doğal olarak gelecekte yapılacak işler ile mevcut spesifikasyonun güvenli uygulamayı engelleyen çelişki/eksikleri ayrılır. Hiçbir öneri kaynak paket üzerinde uygulanmış değildir.

Öncelikler: **P0** ilgili akış açılmadan kapanmalı; **P1** ilgili fazın çıkışında kapanmalı; **P2** ölçüm veya ileri ürünleşme aşamasında ele alınabilir. P0 her zaman Phase 1 demek değildir. “Kapı” en geç tamamlanacağı aşamayı belirtir. Mühendislik rol isimleri sorumluluk önerisidir; atanmış personel veya tahmini tamamlanma tarihi değildir.

## 2. Kaynak çelişkileri ve ürün kararları

| ID | Öncelik / kaynak kanıtı | Eksik veya çelişki | Önerilen çözüm | Kapı / sahibi | Kapanış kanıtı |
| --- | --- | --- | --- | --- | --- |
| G01 | P0 · ARCHITECTURE Telegram; SYSTEM_SPEC edinim | Lead import’tan özel ilk temas başlatılabileceği açıklığa kavuşturulmamış | Müşteri başlatmalı bot girişini, chat identity ve contact eligibility’yi ayrı tut | Phase 5 / Product + backend | Botu başlatmamış import kaydına send reddedilir; inbound kişi doğru eşleşir |
| G02 | P0 · SYSTEM_SPEC §10, ROADMAP Phase 10 | Nihai kripto sağlayıcısı ve kanal sözleşmesi seçilmedi | Crypto-first, provider-neutral model; Stars varsayılanı yok; sağlayıcı Phase 10’da seçilir | Phase 10 / Owner + product | Onaylı provider ADR’si, sandbox ve idempotency testleri |
| G03 | P0 · SYSTEM_SPEC §3, SECURITY RBAC, SQL app_role | Global super admin, tenant admin ve service actor ayrımı yok | Platform admin ayrı kayıt; tenant rolleri permission matrisi; agent service principal | Phase 1 / backend | Tenant manager kendini global admin yapamaz; rol düşürme anında etkili |
| G04 | P0 · SYSTEM_SPEC §4, STATE_MACHINE trial kenarları | Trial→PAID ve trial→INTERESTED farklı; ödeme beklerken trial hakkı | Sales state ile entitlement ayrılır; verified ödeme dışında PAID yok | Phase 3 / product + backend | Guard matrisi, trial ödemesi başarı/başarısızlık testleri |
| G05 | P0 · STATE_MACHINE; SYSTEM_SPEC access | MANUAL_HOLD temsil edilmiyor; hold’un mevcut erişime etkisi belirsiz | Ayrı hold policy, gerekçe/actor/süre; grant ve revoke etkisi açık | Phase 11 / product + backend | Hold altında grant yok; süre/çözüm ve override audited |
| G06 | P0 · ROADMAP Phase 6–7 ve 12 | AI konuşması, escalation altyapısından önce geliyor | İlk outbound öncesi minimum pause/critical gate/takeover; tam vaka UI Phase 12 | Phase 5–7 / backend | In-flight/pending/followup yarış testleri |
| G07 | P0 · ROADMAP Phase 16–17 | Pilot hardening’den önce | Ödeme, tenant, restore, replay ve access integrity testlerini ilgili faz/pilot öncesine çek | Phase 16 öncesi / engineering | Pilot kontrol raporunda kanıt ve rollback provası |
| G08 | P1 · SYSTEM_SPEC V2, CONVERSATION_ENGINE | Director/renderer V2 agent ama MVP pipeline içinde | MVP pipeline aşaması, bağımsız agent servisi değil | Phase 6–7 / AI lead | Tek bounded run içinde versioned drafting/QA |
| G09 | P1 · ADMIN_PANEL quick actions; SECURITY sensitive actions | “Manager+” aşırı geniş; extension/export/KB publish ayrı yetki değil | Capability bazlı izin, gerekçe, audit; ekonomik aksiyon ayrıca elevated | Phase 1 sözleşme; ilgili UI fazı / product | Readonly/support/analyst negatif testleri |
| G10 | P1 · STATE_MACHINE; TEST_PLAN | Erken yenileme, failed/expired payment retry, refund/reversal, geç olay eksik | Lifecycle sözleşmesi; ödeme gerçeği state yüzünden atılmaz, REVIEW/reconcile | Phase 3 ve 10–11 / backend | Geçersiz 409, geçerli sıra dışı olayı kaybetmeyen test |

G01’in teknik dayanağı standart botun sohbet başlatma kısıtıdır. G02’nin platform dayanağı Telegram içi dijital hizmetlerde Stars şartıdır; VIP sinyal üyeliğinin bu kategoriye girdiği ürün tarifinden çıkarımdır. Harici web linki otomatik çözüm kabul edilmez. [Telegram bot modeli](https://core.telegram.org/bots), [Dijital ödeme kuralları](https://core.telegram.org/bots/payments-stars)

## 3. Veri, izolasyon ve güvenilirlik açıkları

| ID | Öncelik / kaynak kanıtı | Somut eksik | Önerilen çözüm | Kapı / sahibi | Kapanış kanıtı |
| --- | --- | --- | --- | --- | --- |
| G11 | P0 · SQL son not ve tüm DDL | RLS/grant/fonksiyon politikaları yok | Default deny; public/private erişimi, explicit grants ve rol testleri | Phase 1 + her yeni tablo / backend | Gerçek JWT ve DB rolleriyle iki tenant CRUD/RPC izolasyonu |
| G12 | P0 · SQL ilişkili business FK’ları | Cross-tenant FK ve cross-customer zincir hatası mümkün | Composite tenant FK; conversation/customer/offer-price-product uyumu | Phase 1 desen; Phase 2+ tablolar / backend | Yanlış tenant veya yanlış müşteri ilişkisi DB’de reddedilir |
| G13 | P0 · SQL events/history/audit | Append-only koruması yok; cascade kanıtı silebilir | UPDATE/DELETE grant kaldır, kontrollü lifecycle/PII retention | Phase 1 audit, Phase 3 event/history / backend | App rolü update/delete yapamaz; tenant silme bypass edemez |
| G14 | P0 · EVENT_CATALOG, SQL events | Envelope/schema_version/outbox/consumer receipt yok | Versioned event + transactional outbox + consumer unique | Phase 3 / backend | Commit/publish arası crash ve duplicate replay aynı sonucu verir |
| G15 | P0 · STATE_MACHINE “concurrent” test hedefi | Guard’ların atomiklik ve version sözleşmesi yok | Compare-and-swap/row lock; tek transaction history/event | Phase 3 / backend | Aynı version’dan iki eşzamanlı geçişten yalnız biri uygulanır |
| G16 | P0 · SQL uq_messages_external | Mesaj uniqueness chat/connector kapsamını içermiyor | Connector+chat+message key; update receipt ayrı | Phase 5 / backend | İki chat aynı message_id’yi taşıyabilir; aynı update yinelenmez |
| G17 | P0 · SQL payments/subscriptions | Provider charge ve business fulfillment uniqueness yok | Webhook receipt, provider account-scoped charge, order snapshot/allocation | Phase 10–11 / backend | Duplicate event/iki invoice aynı entitlement’ı iki kez başlatmaz |
| G18 | P0 · SQL amount, expires_at/ends_at | Asset scale, negatif ödeme, tarih/süre kısıtları eksik | Exact decimal/atomic units, positive checks, ends>starts ve grace≥ends | Phase 9–11 / backend | Hassasiyet, wrong asset/network, boundary tarih testleri |
| G19 | P0 · ESCALATION pause/return | Tek boolean queued/in-flight iş yarışını çözmüyor | Conversation sender serialization + epoch + final gate + durable intent | İlk outbound öncesi / backend | Pause commit sonrası yeni AI send başlamaz; eski task geçersiz |
| G20 | P0 · SECURITY secrets, ENV | Global bot/payment env seti multi-tenant config değil | Tenant connector registry + server-only encrypted secret reference | Phase 5 / platform | A tenant connector secret’ı B işinde çözülemez; log/modelde sır yok |
| G21 | P1 · API import, SECURITY provenance, SQL | Import batch/rejected rows/field provenance/merge review yok | Import ve provenance tabloları; field source/id/batch/time/permitted-use | Phase 2 / backend | Raporlu import, deterministik duplicate, belirsiz merge review |
| G22 | P0 · SECURITY eligibility, SQL | Consent/opt-out/suppression/ulaşılabilirlik veri modeli yok | Kanal bazlı eligibility ve reason/evidence; opt-out outbound’u keser | Phase 2 model, Phase 5 guard / product + backend | İçe aktarma iletişim izni sayılmaz; opt-out queued send’i durdurur |
| G23 | P1 · SYSTEM_SPEC memory, SQL | Provenance nullable; scalar aktif değerde çakışma, confidence check yok | Typed memory keys; zorunlu provenance; scalar partial unique; source precedence | Phase 2 / backend | İki eşzamanlı scalar update; eski/yeni kanıt seçimi ve supersede |
| G24 | P1 · ADMIN KB, CONVERSATION versioning | KB/prompt/renderer/QA sürüm depoları yok | Approved/published/effective sürümler ve outgoing lineage | Phase 6–7 / AI lead | Eski konuşma hangi config ile üretildi tekrar izlenebilir |
| G25 | P1 · CONVERSATION shadow | Draft/onay/edit/reject tabloları ve stale approval yok | Draft version + approval event; yeni inbound/policy değişince revalidate | Phase 7 / backend + AI | Stale draft gönderilmez; edit eval kaydına provenance ile gider |
| G26 | P1 · SYSTEM_SPEC insights, SQL customer_insights | evidence_count, segment, revenue estimate, experiment/owner eksik | Insight/evidence/experiment kayıtları; estimated ile realized ayrımı | Phase 14–15 / analytics | Insight kanıta bağlanır; revenue tahmini gerçekleşen gelir gibi sunulmaz |
| G27 | P1 · API_CONTRACTS | Request/response/authorization/error/page limit yok | Versioned Zod/OpenAPI, pagination, 401/403/404/409/422/429 sözleşmesi | Phase 1 foundation; her API fazı / backend | Contract ve authorization negatif testleri |
| G28 | P1 · SECURITY/ENV | Log/PII redaction, secret rotation, env boundaries eksik | Süreç bazlı env schema, redaction, rotation runbook | Phase 1 / platform | Fixture sırları client bundle/log/audit’te çıkmaz |
| G29 | P0 · SQL channel_access, SYSTEM_SPEC grant | Invite ile gerçek üyelik/entitlement ayrışmıyor | Desired/observed access, user-bound join check, reconcile | Phase 11 / backend | Forwarded invite yanlış kişiye erişim vermez; failed grant case açar |
| G30 | P1 · SQL agent/tasks ve TEST_PLAN | İş iptali/lease/retry bütçesi/LLM maliyet limiti yok | Task lifecycle, bounded tools/rewrites, tenant budget, circuit breaker | Phase 3/6 / backend + AI | Sonsuz döngü yok; iptal edilen task dış etki üretemez |

## 4. Ölçek ve operasyon riskleri

| ID | Öncelik | Risk ve fırsat maliyeti | Kontrol ve üst sınır | Kapı |
| --- | --- | --- | --- | --- |
| G31 | P0 | Worker’ı web request içinde çalıştırmak yarım ödeme/erişim işi bırakır | Persistent worker + DB outbox, ayrı crash/restart deneyi | Phase 3 |
| G32 | P0 | Redis kaybı veya tekrar iş çalışması ticari gerçeği bozabilir | DB authority, receipt, reconciliation; Redis persistence ve noeviction | Phase 3 |
| G33 | P1 | Tek tenant yüksek hacimle diğerlerini bekletir | Per-tenant queue bütçesi; payment/access önceliği; oldest-job alarmı | Pilot öncesi |
| G34 | P1 | Büyük Customer 360/mesaj geçmişi ve import DB/LLM maliyetini büyütür | Keyset pagination, bounded context, incremental summary, streaming import | Phase 2/4/6 |
| G35 | P0 | Gerçek para akışında restore kanıtı yok | PITR/backup planı, restore tatbikatı, payment/access resync | Ücretli pilot öncesi |
| G36 | P1 | Tek event JSON yığını rapor ve audit sorgusunu yavaşlatır | Tenant-first indeks, query plan ölçümü; zamanla projection/partition | Phase 3/15 |
| G37 | P1 | Bölge/para birimi/timezone’ı koda gömmek global genişlemeyi pahalılaştırır | Tenant policy, UTC persistence, exact money, locale config | Foundation desen, commerce uygulama |
| G38 | P0 | Prompt injection ödeme/erişim/secret yetkisini ele geçirebilir | Untrusted context, whitelist + deterministic authorization + evidence | Phase 6 |
| G39 | P1 | “Doğal konuşma” için sınırsız rewrite marjı tüketir | Conversation başına budget/latency cap, QA calibration, insan fallback | Phase 7 |
| G40 | P1 | 18 fazı 18 ayrı platform projesine çevirmek bakım maliyetini büyütür | Tek monorepo; minimum vertical slice; gerekçeli dependency ekleme | Tüm fazlar |

## 5. Hedef veri modeli eklemeleri — faz sınırıyla

Bu isimler planlanan kavramsal modellerdir; SQL üretilmedi.

| Faz | Kaynak taslağından alınacak / genişletilecek | Yeni modeller |
| --- | --- | --- |
| 1 | tenants, app_users, tenant_members, audit_logs | platform_admins, tenant_settings, mutation_requests; private authz/command fonksiyonları |
| 2 | customers, identities, profiles, memory | import_batches, import_rows, field_provenance, identity_merge_reviews, contact_permissions/suppressions |
| 3 | events, customer_state_history | outbox_messages, consumer_receipts, job_attempts/leases; versioned aggregate |
| 5 | conversations, messages | tenant_connectors, secret references, webhook_receipts, message_send_intents, automation control |
| 6–7 | agent_tasks/runs | agent_policies, prompt_versions, kb_entries/versions, drafts, approvals, evaluation_records |
| 9–11 | products/prices/offers/payments/subscriptions/access | orders/order snapshot, payment_attempts/settlements, subscription_periods, access_commands, holds, refunds |
| 12–15 | escalations, surveys, insights | case_activity/notification_delivery, insight_evidence, experiments, analytics projections |

Gerekli minimum takeover control modeli Phase 5–7’ye alınır; Phase 12’deki case yönetimiyle aynı domain’in parçası olur. İkinci paralel escalation sistemi yaratılmaz.

## 6. Phase 1’e giriş ve çıkış için öncelik

**Phase 1’e giriş:** Kullanıcı onayı. Tam ürün ödeme kanalı seçilmeden foundation geliştirilebilir; Phase 1 ödeme veya mesaj göndermez.

**Phase 1 içinde zorunlu kapatılacaklar:** G03, G09’un permission temeli, G11, G12’nin tenant ilişki deseni, G13’ün audit bölümü, G27’nin foundation API bölümü, G28. G07/G40 için faz kapıları CI/rapor düzenine yazılır. Bu maddeler kapansa bile sonraki fazların tüm güvenliği tamamlanmış sayılmaz.

**Phase 1’i genişletmeden izlenecekler:** G01/G02 ürün kararları, G04/G10 state matrisi ve G14 outbox tasarımı ADR taslağı olarak kalır. Customer tabloları, event dispatcher veya ödeme adapter’i foundation’a eklenmez.

## 7. Owner karar kuyruğu

| Karar | Önerilen varsayılan | En geç ihtiyaç |
| --- | --- | --- |
| Phase 1 kapsamı | PHASE_1_PLAN.md’deki auth/tenant/RBAC/audit dilimi | Geliştirme öncesi açık onay |
| Repository sahipliği ve servis bölgesi | Gold Revenue OS’e ait ayrı repo; staging/prod izolasyonu | Uzak repository/provisioning öncesi |
| Telegram ilk temas modeli | Müşteri başlatmalı standart bot | Phase 5 |
| Dijital satış ödeme kanalı | Crypto-first, provider-neutral; nihai sağlayıcı Phase 10’da | Phase 10 |
| Satıcı ülke, tüzel kişi ve hizmet kapsamı | Varsayım yapılmaz; belgelenir | Provider ve production seçiminden önce |
| MVP ürün sayısı ve fiyat/süre/grace | Tek ana ürün, DB/config kaynaklı | Phase 9 |
| Manual hold/refund/extension yetkileri | Gerekçe + elevated capability + audit | İlgili aksiyon açılmadan |
| Pilot ve harcama bütçesi | 10→25→50→100; ölçülen maliyet ve ayrı scale onayı | Phase 16 ve her scale adımı |

Finansal sinyal üretimi, kullanıcı adına trade açma, broker fonlarını yönetme ve private key custody mevcut ürün kapsamına eklenmez. Sinyal hizmetinin hangi ülkelerde hangi şartlarla sunulabileceği bu mimari denetimle doğrulanmış değildir; şirket/ülke bilgileri olmadan hukuki uygunluk sonucu çıkarılmaz.

## 8. Stratejik değerlendirme

Kalıcı değer, kullanılan modelin adında değil; müşteri kimliği, izinli temas, dönüşüm kanıtı, ödeme/erişim doğruluğu ve öğrenme verisinin aynı tenant modelinde birikmesindedir. Bu merkez, model/kanal değiştiğinde korunur.

Zayıf nokta, kaynak paketin gelir döngüsünü lineer göstermesine rağmen gerçek hayatta ödeme, abonelik, insan devralması ve kanal erişiminin eşzamanlı ilerlemesidir. Bu ayrımı şimdi yapmak erken backend maliyeti yaratır; yapmamak yanlış erişim, çift tahsilat/fulfillment ve insan operasyonu yükünü hacimle büyütür.

Net sıra: önce yetki ve kanıt sistemi; sonra müşteri/state/olay; ardından insan kontrolü olan iletişim; doğrulanmış ödeme/erişim; en son veriye dayalı optimizasyon ve white-label büyüme. Phase 1 onayı bu sıranın yalnız ilk uygulama adımıdır.
