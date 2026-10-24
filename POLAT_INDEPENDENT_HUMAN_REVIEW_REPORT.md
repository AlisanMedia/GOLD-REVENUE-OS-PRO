# Polat AI — bağımsız çevrimdışı insan inceleme akışı

## Kapsam ve başlangıç

Paket B, Paket A'nın kabul edilmiş `1144bd9b0d4e118c1b0277c81a6c28211dbd5c6b` main sürümünü genişletir. Uygulama yalnız yerel dosya hazırlama/doğrulama yapar; yeni Admin ekranı, veritabanı, model adaptörü, ağ çağrısı veya gönderici eklemez. Exact branch: `codex/polat-independent-human-review`; ilk push öncesi yalnız bu dalın Vercel Git deployment kuralı `false` yapılır. Main ve önceki kurallar/cron korunur.

Kaynak: [v2 corpus](packages/domain/src/polat-multiturn-v2-corpus.ts), [değerlendirici](packages/domain/src/polat-multiturn-v2-evaluation.ts), [katı inceleme sözleşmeleri](packages/contracts/src/polat-human-review.ts), [çevrimdışı akış](packages/domain/src/polat-human-review.ts), [yerel form](packages/domain/src/polat-human-review-form.ts), [CLI](scripts/polat-human-review.mjs).

## Örnekleme ve körleme

V2 hash: `ec2a008c1575660d9f97f9d17fb4e14956051b2f890557477e82fda611d10d4c`. Puan veya gelecekteki model başarısı görülmeden kaynak sınıflandırmasından deterministik hedefler seçilir. Her EN/TR × DIRECT/ONE_QUESTION hücresinde 20 farklı olağan tur (80), bütün işaretli güvenlik turları (136), toplam216 hedef vardır. İki değerlendirici için432 ayrı kayıt gerekir. Gelecekteki eksik/yanlış yanıt örneklemden atılmaz; boş yanıt inceleme yükümlülüğü olarak kalır. Seçim yeni rastgele bir iyi-yanıt örneklemiyle değiştirilmez.

32-byte yerel rastgele tohumdan HMAC ile kör örnek kimlikleri oluşturulur. Kör dosyada stil, senaryo, hedef anahtarı, özel eşleme, otomatik QA sonucu ve diğer kişinin puanları bulunmaz. Dil, gerçek sentetik konuşma bağlamı ve onaylı sentetik olgular görünür. Yanıtın üslubu doğal olarak tahmin edilebilir; körleme üslubun çıkarılamayacağı garantisi değildir. Özel plan ve stil eşlemesi yalnız koordinatörde kalmalıdır. Kaydedilmiş plan yeniden dışa aktarılırken aynı örnek kimlikleri korunur.

## Kullanım

Pinned proje araçlarıyla, temiz repository checkout üzerinde:

```sh
pnpm polat:review prepare --out /tmp/polat-review-pack
pnpm polat:review export --pack /tmp/polat-review-pack/private-plan.jsonl --out /tmp/polat-review-copy
```

İlk komut gerçek kaynak checkout SHA'sını kaydeder. Çıktı dizini yeni olmalıdır; var olan kanıt dosyası üzerine yazılmaz. `unassigned-review.html` bir önizlemedir; kimliği atanmış insan değerlendirmesi sayılamaz.

Gerçek iki değerlendirici ayrı kanaldan owner tarafından atanmalıdır. `--roster` girdisi JSONL'dir: her satırda benzersiz UUID `id`, `role` (`REVIEWER`, isteğe bağlı üçüncü `ADJUDICATOR`), birbirinden farklı `identity_reference_hash` ve `identity_status=OWNER_IDENTITY_VERIFICATION_PENDING` bulunur. Özel kimlik veya belgeyi bu dosyaya koymayın. Hash, gerçek insanın kimliğini/bağımsızlığını ispatlamaz. Boş roster ile hazırlama yalnız atanmamış önizleme üretir; tamamlanmış değerlendirme olarak mühürlenemez.

```sh
pnpm polat:review prepare --out /tmp/polat-assigned --roster /tmp/reviewer-roster.jsonl
```

Her kişiye yalnız kendi `UUID-review.html` dosyası gönderilir. Form ağ kullanmadan TR/EN çalışır, altı boyutta1–5 puan ve iki açık evet/hayır güvenlik alanı ister; başlangıç puanları boştur. Taslak yerel JSONL olarak indirilip aynı forma geri yüklenir.216 örnek tamamlanmadan tamamlanmış dosya indirilemez. Puanlama doğruluk, ilgililik, doğallık, kısalık, bağlam ve uygun özerkliği kapsar. Gerçek değerlendirme için önerilen ölçütlerin ayrıca owner onayı gerekir.

```sh
pnpm polat:review seal --pack /tmp/polat-assigned/private-plan.jsonl --forms /tmp/reviewer-complete.jsonl --reviewer REVIEWER_UUID --declared-human --out /tmp/reviewer-records.jsonl
pnpm polat:review validate --pack /tmp/polat-assigned/private-plan.jsonl --records /tmp/reviewer-a.jsonl,/tmp/reviewer-b.jsonl --out /tmp/polat-summary.json
```

`--declared-human` yalnız kişinin beyanını kaydeder: `HUMAN_SUBMITTED_UNVERIFIED`. `--fixture-validation` yalnız otomatik test verisini `SIMULATED_TEST_VALIDATION` olarak mühürler. İkisinden tam biri gereklidir. Bu seçenekler model, insan kimliği veya ticari yetki doğrulamaz. CLI sentetik puan yaratmaz; yalnız verilen formları katı şemaya göre hash zincirine bağlar.

Eksik, tekrar, çelişkili, farklı sürüm/yanıt hash'li kayıtlar reddedilir. Farklı puanlar üçüncü bağımsız adjudicator incelemesi gerektirir. [Adjudication şeması](packages/contracts/src/polat-human-review.ts) aynı örnekteki iki özgün `review_hashes` değerini, ayrı reviewer kimliğini, gerekçeyi ve çözümü bağlar; `polatReviewRecordHash` hash'ini hesaplar. Kayıt JSONL'si üçüncü dosya olarak `validate` komutuna verilir. Bu teknik DTO bir insan kararı üretmez. İlk güvenlik bayrağı veya orijinal puan silinmez; yeni yanıt gerekiyorsa `NEW_OUTPUT_REQUIRED` kalır. Her örneğin iki bağımsız kaydı tamamlanmadan `validate --unblind` özel eşlemeyi sonuç dosyasına çıkarmaz.

## Gelecekteki model çıktısı ve veri güvenliği

`prepare --captured FILE.jsonl` yalnız önceden seçilmiş hedeflerin `target_key`, `context`, `context_hash`, `reply` kayıtlarını alabilir. Yanıt eksikse `null`, bağlam kanıtı eksikse görünür eksik durum oluşur. Kaynak corpus, gelen sentetik mesaj sırası, güncel soru, onaylı olgular ve zaman sınırı doğrulanır. Önceki model yanıtları farklı olabilir; gerçek müşteri verisi bu akışa yetkili değildir. İçe alınan metin `UNVERIFIED_MODEL_OUTPUT` olur: bu aktarma gerçek provider kabulü sayılmaz.

Bilinen anahtar biçimleri yanıt ve önceki asistan bağlamında maskelenir; ham içerik yerine yalnız ayrı kaynak hash'leri tutulur. Bu filtre genel PII anonimleştirme garantisi değildir. Raw webhook/secret/kimlik belgesi eklenmemelidir. JSONL girdilerinde duplicate key ve proto anahtarları normal JSON parse öncesi reddedilir; satır16KiB, dosya4MiB/1024 kayıt sınırı vardır. HTML metni `textContent` kullanır, embedded JSON `<` kaçar, CSP ağ/form bağlantısını kapatır. Çıktılar yerel0700 dizin/0600 dosya ile oluşturulur.

Hash zincirleri değiştirilmiş/uyuşmayan dosyaları ayırt eder; kötü niyetli kişinin bütün dosyayı yeniden hash'lemesine karşı insan kimlik doğrulaması değildir. Atama, bağımsızlık, güvenli teslim ve gerçek insan incelemesi owner'ın ayrıca doğrulayacağı operasyonlardır.

## Kabul ve sınırlamalar

Odaklı domain testleri25/25: örnekleme, körleme, eksik/aynı kimlik, tam olmayan puan, sürüm/çıktı değişimi, tekrar/çelişki, adjudication, maskelenmiş bağlam, erken unblind, duplicate JSON ve yetki alanı enjeksiyonu. İki gerçek CLI entegrasyon testi dahil uygulama regresyonu2.063 PASS /0 FAIL /27 yerel DB skip; lint ve strict TypeScript PASS. CLI temiz kaynak SHA’sını başka çalışma dizininden de doğru bağlar; aynı dosyaya yeniden yazmayı ve geçersiz girdiyi reddeder. Gerçek yerel Chromium’da TR/EN ×320/390/768/1440 px olmak üzere8 responsive/keyboard kontrolü PASS; puanlar boş, tam indirme kapalı,217 satırlı puansız taslak indirme/geri yükleme ve ileri/geri koruma doğrulandı. Harici browser ağı engellendi; gerçek insan değerlendirmesi0. Mandatory exact-head ve post-merge Application/Database sonuçları nihai raporda PR, SHA, run/job kimlikleriyle verilir; bu belge CI sonucunu peşinen PASS ilan etmez. SQL değişmediği için yeni hosted/gerçek-provider kabulü yapılmaz.

Gerçek insan değerlendirme sayısı0. Testlerde üretilen puanlar yalnız `SIMULATED_TEST_VALIDATION` etiketlidir. İnsan puanları doğrulanmadan `PASS` üretilemez; bu pakette zaten bir ticari/insan/model PASS geçidi yoktur. Tam dosyalar bile `RECORDS_VALIDATED_NOT_HUMAN_ACCEPTANCE` olur. Mevcut durumlar:

- `HUMAN_REVIEW_PENDING`
- `NATURALNESS_NOT_MEASURED`
- `REAL_MODEL_NOT_TESTED`
- `CUSTOMER_CONVERSION_UNKNOWN`
- `FINANCIAL_AUTHORITY=NONE`, `LIVE_OPERATIONS=false`, `REAL_MODEL_EXECUTION=false`, `COMMERCIAL_PILOT=NO_GO`.

İlk kısıtlı yerel CLI testinde Git alt süreç izni EPERM nedeniyle1 FAIL/26 PASS görüldü; aynı kod yetkili yerel test ortamında tam regresyonda geçti. İlk file:// tarayıcı gezintisi kuruluş politikasıyla engellendi; aynı gerçek HTML boş yerel test belgesine yüklenerek ağsız kontroller tamamlandı. Bunlar korunmuş başarısız ortam denemeleridir; kabul iddiasına dönüştürülmez.

Genel Phase16C-1 OPEN kalır. Sonraki Paket C yalnız devre dışı model manifestini ve karar gereksinimlerini tamamlar; gerçek model veya insan testi için yetki çıkarmaz.
