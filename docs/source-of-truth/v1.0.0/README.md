# Gold Revenue OS — Codex Build Pack

Bu klasör, Telegram merkezli forex/gold sinyal operasyonunu agent tabanlı,
ölçeklenebilir bir Revenue & Customer Intelligence sistemine dönüştürmek için
Codex'e verilecek source-of-truth paketidir.

## Ana döngü
Lead → Conversation → Qualification → Offer → Payment → Access → Onboarding →
Retention → Renewal/Churn → Customer Intelligence → Product Improvement

## Başlangıç
1. Bu klasörü repo köküne koy.
2. `CODEX_MASTER_PROMPT.md` içeriğini Codex'e ilk komut olarak ver.
3. Codex ilk turda sadece repo audit yapsın.
4. Audit onaylanmadan büyük mimari değişiklik yapılmasın.
5. Her faz sonunda test + migration + docs + phase report zorunlu olsun.

## Ana prensipler
- Tek müşteri = tek Customer 360 kaydı.
- AI iletişim/reasoning yapar.
- Para, erişim, abonelik süresi ve state değişimleri deterministic backend tarafından yürütülür.
- Her kritik olay event üretir.
- Kritik mesajlar Human Escalation Engine'e gider.
- Customer-facing mesajlar kısa, doğal, bağlama duyarlı ve kişiselleştirilmiş olur.
- Sistem “ben insanım” gibi sahte iddialar üretmez; doğrudan sorulursa yanıltıcı cevap vermez.
- Agent'lar private key/secrets görmez.
- Multi-tenant temel ilk günden vardır.
