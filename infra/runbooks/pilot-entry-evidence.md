# Pilot giriş kanıtı — çevrimdışı değerlendirme

Bu prosedür [PILOT_ENTRY_v0.1](../../docs/phases/PILOT_ENTRY_v0.1.md) C01–C10
sözleşmesini değiştirmez veya pilot açmaz. Overall16C-1 OPEN; gerçek ticari pilot
**NO-GO**. Genuine receipt/event writer, real provider, Telegram/VIP, hosted
migration/deployment, historical imports ve customer outbound bu pakette yoktur.

## Neden bu araç var?

Önceki pilot sözleşmesi ve runbook'lar vardı; fakat eksik/cancelled/wrong-head CI,
yanlış GitHub app, stale snapshot veya bilinmeyen deployment inventory'sini
fail-closed biçimde ayıran çalıştırılabilir bir entry-evidence kontrolü yoktu.
`packages/domain/src/pilot-readiness.ts` ve `scripts/pilot-readiness.mjs` yalnız
snapshot tutarlılığını değerlendirir. **OFFLINE_CONSISTENCY_ONLY**, finansal yetki
NONE ve live_operations_authorized=false her sonuçta sabittir. Ticari verdict
daima NO_GO; bütün teknik testler PASS olsa da bu araç bir release yetkisi değildir.

## Güvenli girdiler ve çalıştırma

1. Mevcut yetkili GitHub read connector ile branch main, ruleset25348710 ve exact
   main check-runs'ı yeniden okuyun. Application ve Database app15368, exact SHA,
   completed/success ve doğru run/job URL'leri ayrı olmalıdır. Combined status,
   eski success veya submitted settings form'u bu kanıtın yerine geçmez.
2. Exact staging project için yalnız passive deployment inventory okuyun. Bilinmeyen
   envanter null'dır;0 diye doldurulmaz. Tarihsel yaratılıp silinmiş deployment,
   ilgili gözlem penceresinde yaratılmışsa tarihsel FAIL olarak korunur. Eski16C-1A
   olayı bu batch'in sıfır sonucuyla silinmez. Reserved inactive hostnames konusu
   owner-supplied Vercel support case CSE_014fafUZrwe3Bsc1 ile değerlendirilmiştir.
3. `pilotSnapshotSchema` alanlarına yalnız sanitized metaveri yazın: source time,
   exact main SHA, actual governance flags, required contexts/app, exact checks ve
   batch-since deployment count. C01–C10 referansları sadece digest ve
   UNVERIFIED_REFERENCE/SYNTHETIC_ONLY tipidir. Hash gerçek onay veya auth değildir.
   Eksik mandatory gözlemi varsayımla tamamlamayın; unavailable olarak raporlayın.
4. JSON'u repository dışında tutun. Credential, customer/payer kimliği, webhook body,
   license contract metni, cookies veya secret field eklemeyin. Girdi16KiB bounded;
   mevcut duplicate-key-safe parser, unsafe numeric notation ve beklenmeyen fields
   reddeder. CLI hata ayrıntısı/source içeriği yazmaz.
5. Managed cloud'daki pinned Node24 ile, **hiç network/deploy çağrısı olmadan**:

   ```sh
   node scripts/pilot-readiness.mjs --snapshot /tmp/reviewed-snapshot.json --branch codex/pilot-readiness-evidence
   ```

   Branch argümanı gerçek incelenen publication branch'tir. CLI yalnız git
   rev-parse/status/show ve vercel.json okur; branch/main=false ve baseline config'in
   aynen korunmasını veya yalnız exact yeni branch=false diff'ini doğrular.
   Yazmaz, fetch/push/deploy/worker çalıştırmaz. Çıktıyı owner report yanında saklayın.
   NO-GO değerlendirmesi üretebilmek exit0'dır, pilot GO değildir. Invalid input exit2.

## Sonuçları yorumlama

| Sonuç | Anlamı |
| --- | --- |
| Repository PASS | Verilen snapshot kendi içinde current local SHA, iki zorunlu check ve suppression ile tutarlı; dış sistem bağımsız auth doğrulaması değildir |
| FAIL | Yanlış head/app, failed/cancelled/skipped/pending check, bypass/policy veya bilinen unauthorized deployment; düzeltilmeden publication/acceptance yok |
| NOT_TESTED | Missing check, bilinmeyen deployment inventory veya expired artifact; success veya0 sayılmaz |
| C01–C08 BLOCKED | Ticari/merchant/financial/provider/privacy/operasyon/hosted recovery dış kanıtı ve owner yetkisi gerektirir |
| C09 NOT_TESTED | Gerçek ücret/bütçe/capacity kapsamı eksik; production cost0 veya throughput garantisi yok |
| C10 DEFERRED | Gerçek release/pilot cohort yetkisi bu pakette yok; her10→25→50→100 ayrıca onaylanır |

30 dakikalık freshness yalnız offline snapshot/artifact sınırıdır; LIVE source
finality, finansal settlement, privacy retention, SLA veya RPO/RTO politikası seçmez.
Kaynağın gelecekte olması, stale olması ve local SHA değişmesi yeniden okuma ister.
Snapshot self-asserted flags, hashes veya model/manager önerisiyle doğrulanmış sayılmaz.
Authentic external approval ileride başka açık owner scope ve qualified review ister;
bu schema'ya LIVE authority field ekleyerek sınır geçilemez.

## Gelecek gerçek kabul ve durdurma kapıları

- C01/C02/C05/C06: owner+yetkili hukuk/vergi/merchant incelemesi; tek ürün/ülke/kanal,
  supplier rights, lawful consent/privacy ve terms kanıtı. Önceki survey ürün
  kararları yeniden sorulmaz; ticari bilinmeyenler seçilmiş sayılmaz.
- C03/C04: ayrı yetkili genuine source→immutable receipt/event→period→numeric identity→
  observed membership chain; yanlış tenant/amount/payer/network, replay,refund/reorg,
  provider outage ve uncertain effect gerçek kabulü. SyntheticB02.D/genuineD-E
  acceptance DEFERRED kalır; fake tests bunları PASS yapmaz.
- C07/C08/C09: named primary/backup, exact incident/spend/latency goals, production
  isolation/MFA ve hosted restore/rollback gerçek kanıtı. Değerler bilinmiyorsa
  varsayımla bütçe/SLA/RPO/RTO doldurulmaz. Production altyapısı kurulmaz.
- C10: önce bütün prerequisites, exact SHA için mandatory iki CI ve yeni dar gerçek
  kabul; sonra owner exact cohort GO. Unknown receipt/membership, unauthorized effect,
  critical incident veya sayısal cap aşımı admission/scale'ı durdurur; audit ve açık
  revoke/reconcile obligations silinmez. Global LIVE stop bypass edilmez.

Bu prosedür yalnız ilerideki kabulü hazırlar. [Sentetik recovery](synthetic-recovery.md)
ve [rollback](rollback.md) ilkeleri korunur; burada hiçbir gerçek tatbikat çalıştırılmaz.
