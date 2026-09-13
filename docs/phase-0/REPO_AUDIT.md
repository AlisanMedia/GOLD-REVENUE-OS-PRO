# Gold Revenue OS — REPO AUDIT

Tarih: 12 Eylül 2026 · Phase 0 · Kaynak paket: v1.0.0

Durum: İnceleme tamamlandı. Phase 0 değişikliklerle onaylandı; Phase 1 yalnız foundation kapsamıyla yetkilendirildi.

## 1. Sonuç

Bu teslimat bir mevcut uygulama denetimi değil, greenfield ürün/mühendislik paketi denetimidir. ZIP içinde uygulama kodu, kurulmuş bağımlılıklar, migration geçmişi, test uygulaması veya deployment tanımı yoktur. Mevcut çalışan sistem ya da yeniden kullanılabilecek çalışma zamanı kodu bulunduğu iddia edilemez.

Merkezi Customer OS, deterministik para/erişim hizmetleri, sınırlı agent araçları ve olay temelli orkestrasyon doğru başlangıçtır. Mimari yön **koşullu uygun**; SQL ve sözleşmeler **üretime hazır değil**. Foundation, belgelenen tenant/auth/audit düzeltmeleriyle kurulabilir. Tam ürün için mesaj edinimi, ödeme kanalı ve yaşam döngüsü kararları ayrıca çözülmelidir.

Önerilen başlangıç: tek TypeScript monorepo, modüler backend, ayrı web ve kalıcı worker süreçleri. İlk yatırım tenant izolasyonu, erişim yetkisi, denetlenebilir işlemler ve test altyapısına yapılmalı. Çok sayıda bağımsız agent servisi ve 14 ekranın erken geliştirilmesi bu temeli geciktirir.

## 2. İnceleme kapsamı ve yöntem

Yüklenen `Gold_Revenue_OS_Codex_Build_Pack(1).zip` açıldı. İçindeki 18 dosyanın tamamı baştan sona okundu; yalnız başlık veya anahtar kelime taraması yapılmadı. Manifest, tablo/enum envanteri ve dosyalar arası gereksinimler karşılaştırıldı. Platform kısıtları resmi Telegram, Supabase, Next.js, Node.js, BullMQ, Vercel ve Render belgeleriyle kontrol edildi.

ZIP SHA-256:
`bc44a915ff69d6cbe96df4cc9ae87aff368db60efef621a79b973ff9ed28a280`

İç klasör: `gold_revenue_os_codex_pack/`.

Kaynak içerikleri değiştirilmedi. SQL çalıştırılmadı, paket kurulmadı, repository/scaffold oluşturulmadı, uzak servis açılmadı, webhook kaydedilmedi, gerçek müşteriye mesaj gönderilmedi. Statik denetim, runtime veya penetration test sonucu değildir. Hesapların, ücretli planların ve dış repository erişimlerinin hazır olduğu varsayılmadı.

## 3. Eksiksiz okuma envanteri

Satır sayıları ZIP’teki dosyaların yerel kopyasından hesaplanmıştır. `manifest.json` kendisi dışında 17 dosyayı listeler; listedeki dosyaların tamamı mevcut, arşivde toplam 18 dosya vardır.

| Dosya | Satır | Denetimdeki rolü | Sonuç |
| --- | ---: | --- | --- |
| README.md | 27 | Ürün döngüsü ve başlangıç | Okundu; audit-first kuralı açık |
| CODEX_MASTER_PROMPT.md | 109 | Mühendislik ve faz onayı | Okundu; mevcut kullanıcı talebiyle uyumlu |
| SYSTEM_SPEC.md | 223 | MVP, roller, müşteri ve gelir döngüsü | Okundu; bazı alan/geçişler diğer dosyalarda eksik |
| ARCHITECTURE.md | 87 | Katmanlar, araç sınırı ve önerilen stack | Okundu; dağıtım/transaction ayrıntıları yok |
| DATABASE_SCHEMA.sql | 373 | 25 tablo, 8 enum | Tamamı okundu; açıkça taslak |
| STATE_MACHINE.md | 41 | 20 state, geçiş grafiği ve guard’lar | Okundu; hata ve yenileme yolları eksik |
| AGENTS.md | 61 | 8 MVP rolü ve davranış kuralları | Okundu; bunlar ürün agent rolleri, ayrı servis şartı değil |
| CONVERSATION_ENGINE.md | 52 | Konuşma hattı, shadow ve sürümleme | Okundu; çıkış sürüm alanları SQL’de tam değil |
| ESCALATION_ENGINE.md | 55 | Severity, pause, takeover ve return | Okundu; yarış koşulları/süre hedefi belirtilmemiş |
| IMPLEMENTATION_ROADMAP.md | 69 | Phase 0–18 sırası | Okundu; güvenlik kontrollerinin bir bölümü geç |
| ADMIN_PANEL.md | 97 | 14 ekran ve yönetici aksiyonları | Okundu; permission matrisi gerekli |
| API_CONTRACTS.md | 62 | /api/v1 endpoint taslağı | Okundu; OpenAPI/şema/hata sözleşmesi yok |
| EVENT_CATALOG.yaml | 23 | 21 olay türü | Okundu; envelope ve consumer sözleşmesi yok |
| SECURITY_COMPLIANCE.md | 62 | Provenance, RBAC, secret ve kill switch | Okundu; DB/servis uygulaması yok |
| TEST_PLAN.md | 95 | Acceptance ve 10/25/50/100 pilot | Okundu; test kodu değil |
| ADR_001_CORE_PRINCIPLES.md | 32 | Ana ilkeler | Okundu; kaynakta Proposed |
| .env.example | 26 | Ortam değişkenleri sözleşmesi | Okundu; entegrasyon sırları boş |
| manifest.json | 31 | Paket sürümü ve kapsam | Okundu; manifest uyumlu |

## 4. Mevcut repository/stack haritası

| Alan | Bulunan | Eksik / doğrulanmamış |
| --- | --- | --- |
| Kaynak kod | Markdown, YAML, SQL, JSON ve env örneği | TS/TSX, React bileşenleri, backend yok |
| Paketler | ARCHITECTURE.md’de öneri isimleri | package.json, lockfile, kesin sürümler yok |
| Veritabanı | PostgreSQL/Supabase DDL taslağı | Migration dosyaları/geçmişi, RLS, fonksiyon ve trigger yok |
| Auth | auth.users FK ve app_users | Session doğrulama, login, MFA ve bootstrap yok |
| Tenant/RBAC | tenants, tenant_members ve role enum | Permission matrisi, DB politikaları, platform admin ayrımı yok |
| API | Endpoint isimleri | Handler, request/response şeması, limit ve pagination yok |
| Worker/events | Queue iş isimleri ve olay kataloğu | Outbox, consumer receipt, retry/DLQ, worker kodu yok |
| Deployment | Vercel + persistent worker önerisi | Runtime sağlayıcısı, bölgeler, IaC, CI/CD yok |
| Test | Kabul senaryoları | Çalıştırılabilir test, fixture veya rapor yok |
| Git | Arşivde Git geçmişi yok | Uzak repository/branch verilmedi veya incelenmedi |

Paket sürümü `1.0.0`, uygulama veya bağımlılık sürümü değildir. Hedef sürüm aileleri TARGET_ARCHITECTURE.md’de önerilir; kesin patch sürümleri Phase 1 kurulumunda uyumluluk kontrolüyle kilitlenir.

## 5. Veritabanı denetimi

### 5.1 Tam tablo haritası

| Alan | Tablolar |
| --- | --- |
| Kimlik ve tenant | tenants, app_users, tenant_members |
| Customer OS | customers, customer_identities, customer_profiles, customer_memory |
| İletişim | conversations, messages, followups |
| State/olay/audit | customer_state_history, events, audit_logs |
| Ticaret ve erişim | products, prices, offers, payments, subscriptions, channel_access |
| İçgörü | surveys, survey_responses, customer_insights |
| Agent ve insan operasyonu | agent_tasks, agent_runs, escalations |

Enum’lar: app_role, customer_state, payment_status, subscription_status, access_status, escalation_severity, escalation_status, actor_type.

### 5.2 Kritik bulgular

| ID | Kaynak konumu | Gözlem | Etki / düzeltme |
| --- | --- | --- | --- |
| DB-01 | SQL tüm tablolar ve son Codex notu | ENABLE RLS, policy ve grants yok | Tablo erişimi ve satır yetkisi ayrı tanımlanmalı; izin varsayılanı deny |
| DB-02 | customer_identities, offers, messages, subscriptions vb. | tenant_id ve ilişkili id ayrı FK’larla doğrulanıyor | A tenant satırı B tenant müşterisine bağlanabilir; `(tenant_id,id)` ilişkileri ve ilişki tutarlılığı zorunlu |
| DB-03 | events, customer_state_history, audit_logs | Append-only ilkesi DDL’de korunmuyor; tenant/customer cascade silmeleri var | Yetkisiz UPDATE/DELETE ve toplu kanıt kaybı engellenmeli; finansal kayıt/kanıt silme politikası ayrı |
| DB-04 | events | Event store var, transactional outbox/consumer receipt yok | DB commit ile queue publish arasında olay kaybı veya çift uygulama |
| DB-05 | uq_messages_external | `(tenant_id,external_message_id)` | Chat/connector kapsamı eksik; farklı sohbet mesajları çakışabilir |
| DB-06 | payments, subscriptions, channel_access | Invoice/idempotency unique var; provider event/charge, fulfillment ve entitlement benzersizliği yok | Birden fazla fatura/tekrar event aynı ticari sonucu yeniden uygulayabilir |
| DB-07 | customer_memory | Provenance nullable, confidence aralığı kısıtlanmamış; aktif index unique değil | Kanıtsız veya çelişen aktif memory; scalar ve çok değerli alan politikası gerekli |
| DB-08 | subscriptions/prices/payments | Tarih sırası, pozitif süre, payment tutarı/confirmations kontrolleri eksik | Geçersiz abonelikler; kripto hassasiyeti için numeric(18,6) tüm asset’lere yetmez |
| DB-09 | customer_profiles, messages, customer_insights | İstenen alanlar kısmi | Memory summary/trial/retention, renderer/QA/KB versiyonu ve insight sahipliği tanımlanmalı |
| DB-10 | SQL bütünlüğü | Import, provenance, eligibility, KB, agent policy, approval, connector/config tabloları yok | Ürün gereksinimleri migration’lara fazlara göre eklenmeli |
| DB-11 | customers.assigned_manager_id, escalations.assigned_to | Sadece global app_users FK | Atanan kişinin aynı tenant üyeliği ve permission’ı kontrol edilmeli |
| DB-12 | customers/conversations.updated_at | Kolon var, otomatik güncelleme yok | Sıralama ve eşzamanlılık güvenilmez; updated_at ile ayrıca version sayacı |

Supabase’te erişime açık şemalarda RLS uygulanması ve servis anahtarlarının RLS’yi aşabilmesi özellikle önemlidir. Bu tasarım service-role ile bütün kullanıcı isteklerini çalıştırmamalıdır. [Resmi RLS belgesi](https://supabase.com/docs/guides/database/postgres/row-level-security)

### 5.3 Şema çalıştırılabilirliği sınırı

Taslak `auth.users` bağımlılığı nedeniyle hazırlanmış Supabase bağlamı ister. SQL parser ya da gerçek Postgres migration testi bu fazda çalıştırılmadı. “Migration clean” sonucu verilmedi. Phase 1 sadece foundation tablolarını incelenmiş migration’lara dönüştürür; 25 tablonun tamamını tek seferde oluşturmaz.

## 6. Dosyalar arası çelişkiler

1. SYSTEM_SPEC §3 yalnız Super Admin/Manager/Analyst/Agent Worker anlatırken SQL ve SECURITY_COMPLIANCE support/readonly ekliyor. İnsan rolleri için güvenlik belgesindeki beş rol esas alınmalı; Agent Worker ayrı service principal olmalı.
2. SYSTEM_SPEC §4 trial’dan PAID’a kısayol gösteriyor; STATE_MACHINE trial→INTERESTED yolu kullanıyor. Ödeme sadece doğrulanmış olayla kabul edilmeli; trial sırasında ödeme denemesi erişimi yanlışlıkla sonlandırmamalı.
3. Access kurallarında MANUAL_HOLD var; enum ve şemada temsil edilmiyor. Hold, satış state’inden bağımsız entitlement politikası olmalı.
4. Director/Renderer SYSTEM_SPEC’te V2 agent’ları, CONVERSATION_ENGINE’de temel aşamalar. MVP’de ayrı otonom agent yerine aynı runtime’ın aşamaları olarak uygulanmalı.
5. Escalation Phase 12’de, agent müşteri konuşması Phase 6–7’de. Minimum pause/critical gate/takeover ilk outbound öncesine çekilmeli; tam case deneyimi Phase 12’de kalabilir.
6. Hardening Phase 17’de, ücretli pilot Phase 16’da. Tenant, ödeme tekrarları, restore ve erişim uzlaştırması pilot öncesi kabul kapısı olmalı.
7. State ve ödeme event’leri tanımlı; refund, hold, takeover, message failure ve memory update olayları eksik. Mevcut kataloğun üzerine sürümlü ekleme gerekir.
8. ENV tek bot/payment secret seti sunuyor; SYSTEM_SPEC tenant bazlı entegrasyon istiyor. Tenant connector kayıtları ile secret referansları gerekir.

Çözüm önerileri kaynak dosyalarının yerine geçmiş onaylı kararlar değildir. Ayrıntılı izlenebilir kayıt GAP_ANALYSIS.md’dedir.

## 7. Dış platformda doğrulanan ürün engelleri

**İlk temas:** Standart Telegram botu kullanıcıya özel sohbeti kendiliğinden başlatamaz. Lead import, bot tarafından iletişime geçilebilir kişi yaratmaz. Öneri: müşteri başlatmalı bot bağlantısı + doğrulanmış chat identity + ayrı contact eligibility kaydı. Telegram bot etiketinin görünmesi de doğal dil kalitesinden ayrı bir platform özelliğidir. [Telegram bot tanıtımı](https://core.telegram.org/bots)

**Ödeme:** Telegram içindeki dijital hizmet satışları için Stars şartı, paketin bot merkezli kripto satış döngüsüyle çelişiyor. VIP sinyal erişimini dijital hizmet olarak değerlendirmek ürünün tarifinden çıkan mühendislik çıkarımıdır. Bot içi satış için Stars önerisi, kripto-only kaynak gereksiniminde owner kararı gerektirir. Harici checkout linkinin bu kuralı otomatik çözdüğü varsayılmaz. [Telegram dijital ödeme kuralları](https://core.telegram.org/bots/payments-stars)

Bu iki konu Foundation’ı engellemez; mesajlaşma ve ödeme fazları için çözülmeden geçilemeyecek karar noktalarıdır.

## 8. Yeniden kullanım, doğrulama ve onay

Korunacaklar: ürün isimleri, Customer 360 hedefi, tenant sınırı, 20 state’in iş terminolojisi, 21 başlangıç event’i, deterministik servis prensibi, agent davranış kuralları, pilot merdiveni ve acceptance senaryoları. SQL kavramsal başlangıçtır; migration olarak doğrudan kullanılamaz.

Tamamlanan doğrulamalar: 18/18 dosya tam okuma; manifest uyumu; 25 tablo/8 enum/20 state/21 event envanteri; DB ve doküman çapraz incelemesi; resmi platform kısıtlarının kontrolü. Uygulama lint/typecheck/build/test sonucu yoktur, çünkü uygulama yoktur.

Phase 0 teslimatları: REPO_AUDIT.md, TARGET_ARCHITECTURE.md, GAP_ANALYSIS.md ve PHASE_1_PLAN.md. Phase 1, kullanıcının açık onayından sonra yalnız foundation kapsamıyla başlayacaktır.
