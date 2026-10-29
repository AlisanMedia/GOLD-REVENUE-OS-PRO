# Kurucu kontrollü kampanya uygulaması

Başlangıç main: `cacb50515946f103971f32310919a542870587de`.
PR142/143 zaten birleşmiştir; mevcut staging run40856743866 başarılıdır.
Yeni head/merge/CI/yayın sonucu oluşmadan bu belge bunlar için PASS iddia etmez.
Kesin korumalı yayın kanıtları son dış owner raporuna yazılır.

## Onay denetimi

| Kontrol | Sınıf | Son davranış |
|---|---|---|
| Koşulsuz import423 | A | MFA/kurucu/tenant ve dosya hash'ine bağlı toplu beyan/commit; eski ham RPC kapalı |
| Her uygun satıra onay | A | Kesin kimlikler otomatik; gerçek çelişkiler görünür incelemede; güvenli alt küme ilerler |
| Konuşma başına otomatik yanıt açma | A | Tek START kapsamındaki sahipsiz varsayılan/AI konuşmalar devralır; gerçek insan sahipliği korunur |
| Her tam fiyatlı teklifin insan incelemesi | A | Güncel plan/ürün/kaynak/uygunluk ve tam fiyat yeniden doğrulanarak açıkça SYSTEM onayı |
| Rutin takipte tekrar owner kabulü | A | Mevcut scheduled_jobs + Customer Success worker, kaynak/zaman/sıklık/kota ve generation kontrolü |
| Tarihsel faz/beta kotalarının kampanyaya taşınması | A | CONFIGURING/READY/ACTIVE/PAUSED/STOPPED; kampanya kotaları ayrı; mevcut UAT350/5 değişmez |
| MFA, tenant/RBAC, QA, insan devralma, opt-out, kill switch | B | Korunur; START/config dışında her rutin mesajda kurucu oturumu/onayı aranmaz |
| Botun sohbet başlatma sınırı, Business erişim penceresi | C | Sayısal eşleşmiş mevcut sohbet/gözlenen platform yetkisi gerekir; username/liste izni değildir |
| Genuine hesap, ödeme ve VIP kabulü | C/D | Gerçek delil olmadan sentetik sonuç yetkiye dönüştürülmez |

Kurucunun yeni beyanı işletme girdisidir. `OWNER_ATTESTED_EXISTING_PERMISSION`
bağımsız doğrulanmış bireysel rıza değildir. Gerçek dosya verilmediği için yaklaşık
1161 beklentisi doğrulanmış müşteri sayılmaz; bu geliştirmede gerçek import/outreach yok.
Uluslararası import açık ülke/dil verisini korur, eksik chat/ülke kimliği uydurmaz,
örtük+90 üretimini reddeder. Genel İYS şartı eklenmez; TR ticari hedef dışında kalır.
Hedef ülke seçimi, ilgili finansal tanıtım koşulunun bağımsız kanıtı değildir.

## Kod ve güvenlik

Bir additive migration: private kampanya/kitle/beyan/suppression ve existing queue
bağları. Ham authenticated/service tablo erişimi yok; RLS ve atomik append-only audit.
Eşleşme commit sırasında güncel kimliklerden yeniden türetilir; candidate/group hash
tek başına yetki vermez. Kuyruk, toplam deneme/azami yükümlülük ve lease PostgreSQL'de
kalır. UNKNOWN/crash bütçeyi sıfırlamaz veya kör yeniden gönderime dönüşmez.
Aynı native Polat context/sales/Phase7 QA/FakePolatTransport kullanılır. Yeni chatbot,
model sağlayıcı, mali ledger veya dashboard yoktur. Admin→Polat İşlemleri→Kampanya
merkezi kitle/plan seçimi, START/PAUSE/STOP, uzlaştırma, kuyruk/inceleme ve UNKNOWN
maliyet gösterir. Faz11'in verified payment→subscription tüketicisi yeniden yazılmaz.

Gerçek kampanya model/Telegram yürütücüsü bu pakette tamamlanmış sayılmaz. Mevcut
canlı sağlayıcı binding'i özel UAT kapsamındadır; bunu ticari kitleye taşımak güvenlik
kontrolünü aşar. Fake işçi COMMERCIAL kapsamını reddeder; genel model işçisi kampanya
kaynağını onaysız ücretli legacy yola düşüremez. ACTIVE kontrol durumudur, gerçek
model/teslimat başarısı değildir. Genuine campaign/account/transport binding ve
worker entegrasyonu kalan teknik engeldir; faz numarası veya per-message kabul değildir.
Finansal authority NONE; genuine receipt writer/LIVE VIP açılmaz.

## Kabul ve başarısız denemeler

Gerçek disposable PG17 bağlantıları + native Polat QA + fake transport.
İlk testte extension search_path, SQL alias çakışması ve opt-out reason eksikliği
bulunup düzeltildi. Native test aynı transaction timestamp'lerinde eski mesaj
seçimini yakaladı: accepted last_inbound_id sırası kullanıldı. Assertion gevşetilmedi.
Eski koşulsuz423 kaynak assertion'ı yeni RPC/kurucu rolüne güncellendi; eski ham RPC
privilege reddi korunur. İlk genel local testte sandbox child-process izin sorunu;
izinli tekrarda human-review CLI dirty-tree reddi (clean commit'te tekrar doğrulanır).
Local Turbopack bind reddi ve alternatif webpack'in eski node:crypto barrel
uyumsuzluğu kaydedilir; varsayılan Application CI build'i zorunlu, alternatif PASS değil.
Kesin adetler ve tüm head/post-merge sonuçları dış owner raporunda doğrulanır.

Son bütünlük denetimi ilk head'de kampanya ACK'i tamamlandığı halde native Polat
inbound durumunun AI_RESPONSE_PENDING kalabildiğini gösterdi. Aynı mevcut native
prepare/outcome/hold kanıtı atomik olarak kullanılır; QA'dan geçen gerçek fixture
metni hash'ine bağlı kaydedilir ve yalnız native FAKE_ACK sonrasında bounded geçmişe
girer. Native generation ile kampanya revision ayrı ayrı fence edilir. Eski fixture
store arayüzüne geriye uyumlu optional body eklenir; ModelProvider değişmez.
Bu düzeltmenin ilk koşusunda native opt-out/insan devralma sonucu doğru biçimde
HUMAN_HANDOFF_PENDING döndüğü için iki eski beklenti düzeltildi; PAUSE sonrasındaki
AI_RESPONSE_PENDING ise gerçek hataydı ve tek denemeli kampanyada görünür
BLOCKED_WITH_REASON olarak kapatıldı. Son koşu: 56 pgTAP, 6 native runtime ve 5
bağımsız bağlantı/çökme senaryosu PASS; etkilenen 278 fixture/regresyon testi PASS.
Staging için aynı 56 kontrolü çalıştırıp tüm sentetik satırları geri alan smoke
sorgusu disposable PG17'de doğrulandı; hosted sonuç henüz iddia edilmez.

## Yayın ve geri dönüş

Exact branch deployment=false; main=false ve cron korunur. App15368 Application+
Database exact-head/post-merge SUCCESS ve normal protected merge zorunludur.
Yalnız mevcut korumalı staging release: restore ile doğrulanmış encrypted backup
migration'dan önce. Audit/migration geçmişi silinmez. Eski uygulamaya geri dönmeden
önce kampanyaları PAUSED/STOPPED ve outbound kapalı doğrulayın; eski model işçisi
kampanya maliyet kontrolünü bilmeyebilir. Roll-forward tercih edilir.

FINANCIAL_AUTHORITY=NONE · COMMERCIAL_PILOT=NO_GO · PHASE16C-1=OPEN.
