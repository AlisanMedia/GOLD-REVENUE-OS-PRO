# Gold Revenue OS — PHASE 1 PLAN

Tarih: 12 Eylül 2026 · Durum: **Değişikliklerle onaylandı — uygulama başladı**

Kaynak: IMPLEMENTATION_ROADMAP.md Phase 1 “Next.js shell, Supabase, auth, tenant, RBAC, audit”. Bu plan yalnız o foundation kapsamını somutlaştırır. Sonraki ana fazlar ayrı onay gerektirir.

## 1. Teslim edilecek sonuç

Kullanıcı güvenli giriş yapar, yetkili olduğu tenant’ı görür, rolüne uygun sayfalara erişir. Manager kendi tenant’ının görüntüleme adını güncelleyebilir; değişiklik ve audit aynı transaction’da oluşur. Başka tenant’a erişim, rol yükseltme veya audit silme denemesi backend/DB’de reddedilir. Platform admin yolu tenant üyeliğinden bağımsızdır.

Bu, sentetik veriyle çalışan gerçek bir foundation dilimidir. Phase 1 sonunda Customer 360, agent konuşması, gelir dashboard’u veya payment/access motoru varmış gibi sunulmaz.

## 2. Kapsam

| Dahil | Sonraki fazda |
| --- | --- |
| Greenfield pnpm monorepo ve Next.js shell | Customer import, dedup ve Customer 360 |
| TS strict, lint, typecheck, build ve CI | Event store/dispatcher/BullMQ worker |
| Local Supabase, incelenmiş foundation migrations | Telegram bot/webhook/outbound |
| Auth login/logout, MFA gerektiren yönetici sınırı | LLM/agent/tools/QA/shadow pipeline |
| Tenant seçimi ve DB/RLS izolasyonu | Product/offer/price/payment/subscription/access |
| Güncel membership/permission kontrolleri | Case/escalation ekranları, surveys/intelligence |
| Platform admin ayrımı ve kontrollü bootstrap | Tam admin panel ve canlı ticari analytics |
| Atomik audit, idempotent tenant ayarı değişimi | Production auto-send, gerçek veri importu, paid pilot |
| Sentetik seed, negatif güvenlik testleri, rapor | White-label ticari ürünleştirme |

Payment ve Telegram hesap/anahtarları Phase 1 için gerekmiyor. Bu entegrasyonları kurmak amacıyla servis satın alınmaz veya gerçek müşteriye erişilmez.

## 3. Önkoşullar ve varsayılanlar

1. Kullanıcının Phase 1’e açık onayı 12 Eylül 2026 tarihinde sekiz kapsam değişikliğiyle alındı.
2. Hedef repository greenfield ve adı öneri olarak `gold-revenue-os`; mevcut farklı projeye kod eklenmez. Uzak repo belirtilmezse onay sonrasında izole yerel repo üzerinden başlanabilir; uzak push/provisioning yapılmış varsayılmaz.
3. Node 24 LTS, pnpm, Docker ve Supabase CLI uygunluğu kurulum sırasında kontrol edilir. Kesin sürümler ve lockfile commit edilir. Bugünkü belge major aile önerisidir, test edilmiş dependency manifest’i değildir.
4. Yerel Auth ve DB testleri için Supabase local runtime gerekir. Docker yoksa test için ayrı staging Supabase projesi erişimi çözülür; üretim DB’sine düşülmez ve sahte test sonucu yazılmaz.
5. Staging hedefi Vercel + ayrı Supabase projesidir. Deploy/provisioning, gerçek hesap ve bölgeye bağlı ayrı işlem olarak raporlanır; yerel foundation kabulüyle karıştırılmaz.
6. İlk super admin bootstrap’ı operator-only akıştır. “İlk kaydolan admin olur” veya e-posta domain’ine göre admin yaklaşımı kullanılmaz. Public signup MVP’de kapalı, yetkili kullanıcı bootstrap/davet modeli kullanılır.

## 4. İş paketleri ve bağımlılık sırası

### P1.1 — Repository ve sürüm temeli

Kaynak paketi `docs/source-of-truth/v1.0.0/` altında byte-identical koru. Root AGENTS.md’ye mühendislik/onay kurallarını ve ürün AGENTS referansını koy. pnpm workspace ve Next.js uygulamasını oluştur; strict typecheck ve package boundary’leri tanımla. Kurulum sürümlerini güvenlik/peer dependency kontrolü sonrası kilitle.

Dokunulacak yollar: `README.md`, `AGENTS.md`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `.gitignore`, `.env.example`, `docs/source-of-truth/v1.0.0/*`, `docs/phase-0/*`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`, `apps/web/src/app/{layout,page,error,not-found}.tsx`, `apps/web/src/app/globals.css`, `packages/{contracts,domain,db,config,observability}/package.json`.

Kabul: yeni checkout frozen lockfile ile kurulabilir, lint/typecheck/build çalışır; secret veya customer verisi repo’da yoktur. Source checksum’ları orijinalle aynıdır.

### P1.2 — Foundation DB, tenant ve RLS

Sadece foundation tablolarını oluştur. Tenant kayıtları/id ilişkileri, rol check’leri, üyelik durumu, tenant settings ve atomik audit kontratı tasarlanır. Private fonksiyonlar ve exposed API grant’leri default deny olur. `updated_at` ve version gerektiği yerde otomatik yönetilir.

Dokunulacak yollar: `supabase/config.toml`, `supabase/migrations/*`, `supabase/seed.sql`, `supabase/tests/foundation_rls.test.sql`, `packages/db/src/{types,client}.ts`, `packages/domain/src/{tenancy,authz,audit}/*`.

Kabul: temiz reset + migrations başarılı; iki tenant’ın üyeleri/satırları ayrılır; kullanıcı kendini platform admin yapamaz; membership ve audit tablolarının doğrudan yetkisiz mutasyonu reddedilir.

### P1.3 — Session, login ve tenant context

Server-side doğrulanmış auth kimliği kullan. Proxy yönlendirmeyi kolaylaştırır; API/komut izin kontrolünün yerine geçmez. Session expiration, logout, MFA, üye olmayan kullanıcı ve çoklu tenant seçimi davranışlarını uygula. JWT metadata veya browser tenant header’ını izin kanıtı sayma.

Dokunulacak yollar: `apps/web/src/proxy.ts`, `apps/web/src/lib/auth/{client,server,require-user,require-tenant}.ts`, `apps/web/src/app/(auth)/login/page.tsx`, `apps/web/src/app/(auth)/mfa/page.tsx`, `apps/web/src/app/(tenant)/layout.tsx`, `apps/web/src/app/(tenant)/settings/page.tsx`, `apps/web/src/app/api/v1/me/route.ts`, `apps/web/src/app/api/v1/tenants/route.ts`.

Kabul: anon protected API’ye 401; geçerli session fakat üyelik yoksa bilgi sızdırmayan ret; tenant switching sonrası eski tenant verisi cache’ten görünmez. Admin mutation MFA olmadan çalışmaz. Üyeliği kaldırılan veya rolü düşürülen kişi eski JWT ile ayrıcalığı sürdüremez.

### P1.4 — İzinli mutation ve audit vertical slice

Manager’ın yalnız kendi tenant görüntüleme adını değiştirdiği `PATCH /api/v1/tenants/:tenantId/settings` işlemini ekle. Bu Phase 1 endpoint’i kaynak API kataloğuna önerilen foundation ekidir. Request Zod şeması, expected_version ve idempotency key ile kontrol edilir; tenant_id/actor kimliği sunucuda doğrulanır.

Transaction: yetki + expected version → settings update → mutation receipt → allowlisted audit → commit. Aynı key/aynı body aynı sonucu döndürür; aynı key/farklı body 409. Eşzamanlı eski version 409. Audit failure hiçbir ayar değişikliği bırakmaz. Reddedilen yetki isteği ayrı güvenlik kaydına alınır.

Dokunulacak yollar: `packages/contracts/src/{foundation,errors}.ts`, `packages/domain/src/tenancy/update-settings.ts`, `packages/domain/src/authz/permissions.ts`, `packages/domain/src/audit/record.ts`, `packages/db/src/commands/tenant-settings.ts`, `apps/web/src/app/api/v1/tenants/[tenantId]/settings/route.ts`, `apps/web/src/app/api/v1/audit-logs/route.ts`, `apps/web/src/app/(tenant)/audit/page.tsx`, ilgili migration/fonksiyonlar.

Kabul: Manager kendi tenant adı değişimini ve audit sonucunu görür; support/analyst/readonly aynı mutation’ı yapamaz. Raw Data API ile komutun etrafından dolaşılamaz. Ekonomik aksiyon, secret ayarı ve agent policy endpoint’i eklenmez.

### P1.5 — Bootstrap, secret ve operasyon temeli

Operator-only bootstrap runbook’u ve idempotent script ile ilk tenant/platform admin ilişkisini kur. Kimlik bağlamı ve hedef kullanıcı doğrulanır; sabit parola repo’ya girmez. Script tekrar çalışınca çift membership/admin oluşmaz. Application env schema yalnız bu fazın ihtiyaçlarını zorunlu kılar; boş Telegram/payment/OpenAI alanları foundation boot’u bozmaz.

Dokunulacak yollar: `scripts/bootstrap-foundation.ts`, `packages/config/src/{env,public-env}.ts`, `packages/observability/src/{logger,redaction,correlation}.ts`, `apps/web/src/app/api/health/live/route.ts`, `apps/web/src/app/api/health/ready/route.ts`, `infra/runbooks/{bootstrap,secrets,foundation-rollback}.md`.

Kabul: privileged credentials yalnız operator/server context’te; health response secret/DB detayını açmaz; hassas fixture’lar log/client/audit içinde yoktur. Staging mail teslimatı açılacaksa custom SMTP/domain doğrulanır; yerelde mail catcher kullanılır.

### P1.6 — Test, CI ve güvenlik kanıtı

Unit testten bağımsız gerçek Postgres/RLS ve tarayıcı testi çalıştır. CI’de reset/migrations, role izolasyonu ve kullanıcı akışı zorunludur. Build’in lint yaptığı varsayılmaz; komutlar ayrı çağrılır.

Dokunulacak yollar: `.github/workflows/ci.yml`, `vitest.config.ts`, `playwright.config.ts`, `tests/integration/{foundation-authz,tenant-settings,audit-atomicity}.test.ts`, `tests/e2e/foundation.spec.ts`, `supabase/tests/*`, `packages/domain/src/authz/permissions.test.ts`.

Kabul: aşağıdaki matris yeşil; failed veya skipped güvenlik testi açıkça raporlanır ve faz tamamlandı sayılmaz. Başarısız test beklenen çıktıyı değiştirilerek gizlenmez.

### P1.7 — Rapor ve durma noktası

`docs/phases/PHASE_1_REPORT.md` oluştur: tamamlananlar, exact dependency versions, migrations, test komutları/sonuçları, manuel kontrol, staging durumu, riskler ve rollback. Phase 2 için onay bekle. Phase 1 onayıyla Customer OS veya event engine kendiliğinden başlatılmaz.

## 5. Migration kapsamı

Aşağıdaki adlar migration konu adlarıdır; hayali timestamp dosya isimleri değildir. Gerçek isimler Phase 1’de Supabase CLI üzerinden oluşturulur.

| Konu | İçerik |
| --- | --- |
| foundation_types_and_identity | Gerekli role/actor type, app_users/Auth bağı, platform_admins, tenants |
| foundation_memberships_and_settings | tenant_members, üyelik status, tenant_settings/version, tenant scoped ilişkiler |
| foundation_audit_and_requests | Append-only audit_logs, mutation_requests/idempotency kayıtları ve kısıtlar |
| foundation_authorization_and_commands | RLS, explicit grants, private authz fonksiyonları ve atomik tenant settings komutu |

Komut receipt’i `(tenant_id, actor_id, action, idempotency_key)` unique olur, request hash/sonuç tutar. Audit tenant kayıtları için zorunlu; platform bootstrap aksiyonlarında explicit scope ile null tenant desteklenebilir. Runtime role’larına global admin tablosu yazma izni verilmez.

SQL taslağının tamamı migration’a kopyalanmaz. `customers`, `events`, `payments`, `subscriptions`, `channel_access` ve agent tabloları bu faza dahil değildir. Migration testleri Supabase context’inde çalışır; salt SQL metni kontrolü yeterli değildir.

## 6. API ve hata sözleşmesi

| Endpoint | Yetki | Amaç |
| --- | --- | --- |
| GET /api/v1/me | Geçerli auth | Kimlik ve güvenli capability özeti |
| GET /api/v1/tenants | Geçerli auth | Yalnız erişilebilir tenant’lar |
| GET /api/v1/tenants/:tenantId/settings | Güncel tenant permission | Güvenli ayar görünümü |
| PATCH /api/v1/tenants/:tenantId/settings | Manager veya açık global yetki + MFA | Sadece görüntüleme adı mutation’ı |
| GET /api/v1/audit-logs | Tenant audit.read; manager/global | Redacted, tenant-scoped, sayfalı kayıt |
| GET /api/health/live | Sınırlı public | Process canlılığı |
| GET /api/health/ready | Kontrollü/sınırlı | Bağımlılık hazır/hazır değil; ayrıntı sızdırmaz |

Başarılı response tipleri ve `error: {code,message,request_id}` hata yapısı contracts paketinde tanımlanır. 401 kimlik yok; 403 bilinen tenant içinde izin yok; erişilemeyen tenant/kaynak için 404; 409 version/idempotency çakışması; 422 geçersiz body; 429 limit. DB/secret/raw stack trace response’a girmez. Cookie tabanlı mutation’da origin/CSRF koruması ve allowlist redirect kullanılır. Liste endpoint’lerinde cursor ve en fazla 100 kayıt sınırı önerilir.

## 7. Kabul test matrisi

| ID | Test | Beklenen kanıt |
| --- | --- | --- |
| F01 | Temiz clone/install/migrate | Frozen lockfile; boş local DB’de migration/seed başarılı |
| F02 | Anon, expired session, logout | Protected UI/API erişimi yok |
| F03 | A ve B tenant | A kullanıcısı B satırını listeleyemez/okuyamaz/mutate edemez |
| F04 | Tenant_id/actor/role spoof | Header/body/JWT user_metadata permission vermez |
| F05 | DB/Data API bypass | UI/API dışında doğrudan grant/RPC denemesi yetkiyi aşamaz |
| F06 | Manager/support/analyst/readonly | Mutation, audit ve masked read izinleri matrise uygun |
| F07 | Rol düşürme / üyelik iptali | Mevcut session token’ıyla ayrıcalık devam etmez |
| F08 | Platform admin bootstrap | Public signup admin yaratamaz; repeat bootstrap duplicate yaratmaz |
| F09 | MFA | Elevated mutation gerekli assurance olmadan reddedilir |
| F10 | Mutation + audit transaction | İsim değişimi bir audit üretir; audit failure mutation’ı rollback eder |
| F11 | Duplicate ve concurrent request | Aynı key/aynı payload bir etki; farklı payload veya stale version 409 |
| F12 | Audit append-only | App role UPDATE/DELETE edemez; cascade ile silme yolu yok |
| F13 | Secret redaction | Fixture sırları log, audit, API response, client bundle’da yok |
| F14 | Tenant switching/cache | Önceki tenant verisi diğer tenant ekranında görünmez |
| F15 | Input/CSRF/pagination/rate | Invalid/oversize istek reddedilir; liste sınırı ve origin kontrolü var |
| F16 | E2E gerçek akış | Login→tenant→settings update→audit view→logout tarayıcıda tamam |
| F17 | Responsive/klavye | Login ve shell mobil/desktop’ta kullanılabilir; focus ve hata görünür |

Planlanan komut ailesi: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`; DB reset ve DB test komutları kurulu Supabase CLI `--help` ile doğrulanır. Bunlar bu fazda çalıştırılmış komutlar değildir; Phase 1 scripts sözleşmesidir.

## 8. Rollback ve ortam ayrımı

Local ve CI ortamları sentetiktir; local reset yeniden uygulanabilir. Staging ve production sırları, DB projeleri ve auth redirect’leri ayrıdır. Preview hiçbir zaman prod service credentials taşımaz.

Phase 1 schema değişimleri additive tutulur. Staging hata durumunda son çalışan web sürümüne dönülür, gerekli DB düzeltmesi forward migration ile yapılır. Tenant/audit tabloları kör drop edilmez. Bootstrap başarısızlığında public erişim açılmadan principal/üyelik ve audit durumu incelenir. Secret sızıntısında key rotation ve session erişim sınırı uygulanır. Çalışan ortam yoksa “rollback denendi” denmez; local/staging hangi prova yapıldı ayrı yazılır.

## 9. Çıkış kapısı

Phase 1 ancak F01–F17’nin ilgili otomatik/manuel kanıtları, migration raporu ve bilinen sınırlamaları teslim edildiğinde tamamlanır. İki tenant negatif testleri, atomik audit veya yetki bypass testleri başarısızsa sonraki faza geçilmez. Üretim deploy’u bulunmaması yerel foundation başarısını yok saydırmaz; fakat production-ready etiketi de verilmez.

Phase 1 onaylandı. Bitiş raporundan sonra Phase 2 için ayrıca onay beklenecektir.
