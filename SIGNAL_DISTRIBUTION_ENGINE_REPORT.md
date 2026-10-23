# Sinyal dağıtım motoru — repository-only sentetik kabul

Paket B, sahibin dört paketlik yetkisi içindedir. Başlangıç main `332b56949a453981ba75bd3e99a9dbfcf0041ec5`. A/PR113 ve bağımsız D/PR114 exact-head ve post-merge Application/Database kabulünden sonra ilerlenir. Genel16C-1 OPEN ve ticari pilot NO-GO kalır. Gerçek Telegram hesabı, kaynak, hedef veya ödeme bağlantısı yoktur.

## Uygulama ve güvenlik sınırı

Bir eklemeli migration, dört private/RLS tablo ekler: `signal_deliveries`, immutable `signal_attempts`, immutable `signal_delivery_history`, `signal_message_bindings`. Mevcut kaynaklara kalıcı fixture offset/batch hash, politikalara revision, hedeflere adil sıra zaman damgası eklenir. Olay→kuyruk→audit aynı transaction içindedir. PostgreSQL NOTIFY yalnız commit sonrası wake ipucudur; yetki veya kayıt yerine geçmez. Kaybolan wake için kalıcı kuyruk ve checkpoint okunur. Gerçek listener/worker/cron/HTTP sender kaydı yapılmaz.

Private fixture-only ingest batch (en fazla25 frame/64KiB), claim, durable begin, finish, reconciliation ve pause işlevlerinin anon/authenticated/service_role execute yetkisi yoktur. Kaynak olay en fazla100 rotaya atomik dağılır;101 hedefte bütün statement geri alınır. Yalnız aktif, outbound-disabled `signal-sandbox-*`, FAKE adapter ve fixture source/destination referansları kabul edilir. Tenant kimliği lease, prepared payload, fake transport, ACK ve DB sınırlarında ayrı ayrı doğrulanır. Aynı hedef adı başka tenant'a erişim sağlamaz.

Claim çağrısı en fazla32 obsolete işi ve16 hedef başını inceler, en fazla1 lease üretir. Deterministik sıra, SKIP LOCKED, tenant advisory guard ve hedef turn zamanı kullanılır. Bir hedefteki4096 eski iş başka hedefi kilitlemez. Lease30s; en fazla2 pre-effect reclaim, toplam7 claim,5 kesin provider-failure; exponential backoff250ms başlangıç/30s tavan, explicit retry-after en fazla300s. Sinyal tazeliği60s fixture-only politikadır. Bunlar LIVE Telegram retry/SLA politikası değildir; Phase11 fonksiyonları değişmez.

Begin kalıcı olmadan fake effect çalışmaz; begun lease kaybı UNKNOWN olur. Unknown sonuç körlemesine tekrar gönderilmez ve sıralı hedef ilerlemesini durdurur. Ayrı fake ledger lookup yalnız eşleşen tenant/operation/destination/fact ACK ile mutabakat yapabilir; boş/restart edilmiş ledger “gönderilmedi” kanıtı değildir. Reconciliation eski UNKNOWN geçmişini silmez. Yanlış ACK, eski token ve değişmiş policy/source revision başarılı sayılmaz. Callback/manager/AI kaynaklı finansal otorite oluşmaz.

İlk içerik SEND, eşlenmiş mesajın revizyonu EDIT, bilinen mesajın silinmesi DELETE olur. Kaynak/destination/message/operation kimlikleri ayrıdır. İlk kopya ve sonraki düzenleme aynı fake message binding'i kullanır; hedefi bulunmayan silme NO_EFFECT'tir, gerçek Telegram revoke iddiası değildir. Orphan reply/edit,4096 karakterden uzun içerik, belirsiz parse, restricted/unavailable source incelemeye gider. Orijinal içerik kısaltılmaz, fiyatlar dönüştürülmez, LLM ile işlem talimatı üretilmez. Media yalnız izinli fixture metadata/ref simülasyonudur; gerçek dosya indirme/yükleme yoktur.

## Gerçek sentetik kabul

-35 odaklı domain testi;78 yeni pgTAP +38 A regresyonu =116 PASS.
-5 gerçek Node/SQL/FakeSignalTransport bridge: canonical hash, birden çok kaynak→aynı hedef, edit/delete, UNKNOWN→fake lookup, tenant/financial güvenlik ve source-offset recovery. Her claim/begin/finish ayrı gerçek SQL commit kullanır; mock DB değildir.
-4 bağımsız PostgreSQL race/crash senaryosu: precommit backend ölümü, tek lease/expiry kazananı ve stale-token red, committed begin sonrası UNKNOWN,4096 eski iş ve adil ikinci hedef. Ayrı iki bağlantılı LISTEN/NOTIFY testi commit öncesi görünmezliği ve commit sonrası kalıcı kuyruğu doğrular.
-988 unit PASS;391 integration PASS /14 yerel DB-context SKIP. İlgili5 yeni bridge Database CI'da gerçekten çalışır. Lint/strict TypeScript/build PASS. Mandatory exact-head ve post-merge CI kanıtları nihai owner artifact'ında ayrı kaydedilir.
-Gerçek yerel PG17 dump/restore sonrası bütün signal event/job/attempt/history/binding, ACL ve function fingerprint'leri eşit. Kaynak dump veya lease token artifact'a yazılmaz. Hosted backup/restore kabulü değildir.

## Ölçüm — gerçek Telegram değil

Aynı disposable PostgreSQL17,11 tenant/sağlayıcı/hedef,11 bağlantı; hedef başına8 olaylık dalga. Claim/begin/finish ayrı commit; gerçek dış taşıma yerine açıkça sahte ACK harness. Ölçüm ilk gözlemlenebilir kaynak alımı→fake API acknowledgement; upstream yayın zamanı ve müşteri okuması ölçülmez. Percentile nearest-rank; toplam süre `/proc/uptime` monotonic, Node aşamaları `performance.now`. UTC cross-boundary zamanları aynı test hostundandır.

| Profil /88 olay | p50 ms | p95 ms | p99 /max ms | 1s hedefi |
|---|---:|---:|---:|---|
| Fake ACK2ms |255.564|350.031|366.105|Bu sentetik profilde sağlandı|
| Fake ACK150ms |868.284|1463.919|1502.615|**Sağlanmadı**; FIFO queue beklemesi artıyor|

176/176 sentetik ACK; fixture'lar sonrasında disabled/suspended. İlk önceki ölçümler352.359ms ve1438.580ms p95 olarak korunur, son kaynak ölçümü tabloda verilmiştir. Normal profilde SQL ingestion p95=.682ms, queue insert=.254ms, queue wait=342.741ms, prepare=9.230ms, fake dispatch/ACK=11.794ms, ACK persist=6.645ms. Ayrı1000-v1-normalization/SHA256 microbenchmark: p50=.051847ms, p95=.165967ms, p99=.354006ms; gerçek Telegram decode değildir. Farklı aşamaların percentile'ları toplanmaz. Gerçek Telegram subsecond teslimi/production capacity **UNVERIFIED**.

Aktif kuyruk başı gerçek planında `signal_delivery_head` index scan1 row/4 buffer ile .050ms gözlendi; private claim envelope en fazla248 byte. İlk tenant-wide history denemesi733 unrelated satır filtreledi; deneysel ek/covering index planner tarafından seçilmedi ve release'den çıkarıldı. Gerçek evidence consumer delivery-ID filtreli, mevcut `signal_history_delivery` index'i kullanır. Farklı query kapsamları için production hızlanma iddiası yapılmaz. Operasyon listesi ve güvenli sayfalar C paketinde ayrıca kabul edilir.

## Korunan sınırlar ve kalan işler

Eski payment adapters/classifier, genuine receipt/event writer, subscription/VIP state machine, financial metric dictionary, anonymous survey privacy, agent/cron ve hosted konfigürasyon değişmez. Yeni source/dispatch tümü SYNTHETIC; `financial_authority=NONE`. Doğrudan worker/browser DB yazarı veya force-send UI yoktur. Vercel değişikliği yalnız `codex/signal-distribution-engine=false`; bütün eski kurallar/main=false/cron korunur. Deployment veya gerçek provider kabulü yapılmaz.

Gerçek Telegram adapter/session, supplier rights, protected-content uyumu, source gap/media protokolü, tam destination allowlist/permission, gerçek network/finality kabulü ve hosted release ayrı yetki gerektirir. Normal üyelik dağıtım hakkı değildir. Unknown için sahte ACK üretilemez; insan gözetimi ve bağımsız doğrulama gereklidir. Gerçek tedarikçi maliyeti/merchant/kripto hattı/ülke veya kaynak SLA seçilmedi.
