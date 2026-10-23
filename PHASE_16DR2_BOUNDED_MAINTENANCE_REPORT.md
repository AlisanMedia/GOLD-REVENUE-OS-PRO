# TEST bakım bütçesi — repository-only uygulama

Başlangıç main `c2bdaf6cf4633e135b1b6e23b9af16e553f3c7f1`, 23 Ekim 2026.
Owner'ın en fazla dört repository-only paket yetkisinin ilk paketi. Genel16C-1
OPEN, ticari pilot NO-GO. Bu commit öncesi checkpoint CI/merge olmuş gibi sunulmaz;
final bağımsız owner raporu exact head/merge/run/job kanıtını ayrıca kaydeder.

## Sorun ve en küçük çözüm

R1 claim cycle en fazla32 işi inceleyip1 lease üretir; fakat kayıtlı TEST worker
önce legacy `entitlement_tick` çağırıyordu. Bu fonksiyon bütün due subscription
satırlarını iki sınırsız döngüyle değiştirir; RENEWAL_DUE tekrar sayılır. Gerçek
production performans olayı iddiası yoktur.

Yeni service-role-only `entitlement_test_maintenance_v1`: exact active,
outbound-disabled `phase11-sandbox-*` tenant ve yalnız mode=test satırları.
Bir transaction en fazla9 payment hold,8 expiry,8 renewal transition üretir.
Her lane deterministic sırada, row-level SKIP LOCKED; claimant ile aynı nonblocking
advisory tenant guard. Locked/busy veya backlog, has_more ile incomplete gösterilir.
Expiry/review, gerçek Telegram revoke başarı kanıtı sayılmaz; revoke job korunur.
Bad payment evidence, expiry/renewal lane'lerinden dışlanarak hold önceliği korunur.
Zaten RENEWAL_DUE olan satır tekrar audit/iş üretmez. Mutation+audit+obligation atomic.

İki partial due-date index, tarih sıralı bounded head query'lerini destekler.
Bu sonuç/write sınırıdır; payment-history existence scan'inin worst-case I/O veya
bütün invocation için sabit süre garantisi değildir. Daha büyük hosted cardinality
ve global tenant scheduling/fairness ayrıca ölçülmelidir.

Kayıtlı TEST service yeni envelope'u strict schema ile doğrular;25 üzeri,
tutarsız toplam/busy veya ek authority field fail closed olur. No-job sonucunda
maintenance.has_more korunur. Legacy `entitlement_tick` imzası/gövdesi ve LIVE
semantiği değişmez; eski ayrı compatibility çağrısı hâlâ unbounded olup bu worker
artık onu kullanmaz. R1 lease/budget/unknown-effect kuralları değişmez.

## Gerçek yerel kanıt ve korunan failures

-29/29 yeni pgTAP;32/32 affected worker integration.
-3/3 iki gerçek backend: scheduler contention/nonblocking; precommit process death
 state+audit+compensation rollback;128 transition'ı duplicate audit olmadan drain.
-İlk fixture yanlışlıkla start'tan önce end yazdı, ikinci fixture expired subscription
 için yeni admission istedi. DB bu iki hatayı doğru biçimde reddetti. Tarihsel logs
 dış evidence dizininde korunur; constraint/guard zayıflatılmadan historical fixture
 owner-only SQL ile kuruldu. İlk integration mock eksik yeni envelope nedeniyle
 fail oldu; gerçek runtime assertion gevşetilmeden mock düzeltildi.
-Etkilenen dört SQL suite411/411; tüm unit796 PASS, integration333 PASS/9
 DB-context SKIP; lint/strict TypeScript/build PASS. Bridge'in DB kısmı mandatory
 Database CI'da ayrıca yürür; local skip genuine PASS diye sunulmaz.
-Global-count eski testlerin persisted concurrency fixture'ından sonra çalıştırılması
 iki local regression failure üretti. Eski assertions değiştirilmedi; fresh DB ve
 doğru sırada411/411 geçti. Yeni concurrency CI'da eski rollback/global-count
 assertions bittikten sonra ve recovery fingerprint'ten önce çalışır.
-Aynı128-due sentetik fixture: legacy scan128 row, execution0.094ms; indexed
 expiry head8 row,0.029ms, bounded envelope107 byte. Bunlar farklı iş kapsamlarını
 gösteren tek warm fixture gözlemidir, throughput/SLA veya production benchmark değil.
-Mandatory CI exact final-head sonuçları final owner raporunda ayrı verilir.

Recovery fingerprint yeni function body/ACL'yi de kapsar. CI Database yeni rollback
pgTAP+independent connections'ı mevcut mandatory gates yanında çalıştırır. Hiçbir
accepted provider testi/hosted staging acceptance tekrar dispatch edilmez.

## İlk mandatory CI başarısızlığı — korunur

[39996380290](https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/39996380290):
Application SUCCESS, Database FAIL. R2 rollback testinin, aynı16de kimliklerini
persist eden eski16D concurrency fixture'ından sonra çalışması auth.users PK
çakışmasına yol açtı. Runtime veya security assertion failure değildir. R2 rollback
testi, eski16D rollback testinden sonra fakat iki kalıcı concurrency script'inden
önceye alındı. Assertion, veri constraint'i veya gate kaldırılmadı. Bu başarısız
run daha sonraki green sonuçla tarihsel PASS olarak yeniden yazılmaz.

## Güvenlik ve kalan kapı

Tek Vercel değişikliği exact `codex/phase16d-r2-bounded-maintenance=false` entry;
main=false/eski entries/crons korunur. Deployment, hosted migration, gerçek para,
receipt/trusted event, Telegram/VIP/customer outbound/import ve paid resource yok.
Bütçeler TEST-only engineering sınırıdır, LIVE retry/SLA policy değildir.
R1 uncertain-review otomatik temizlenmez; genuine independent correction yolu ayrı
owner/merchant/provider authority ve acceptance ister. C01–C10 dış kapıları açılmaz.
