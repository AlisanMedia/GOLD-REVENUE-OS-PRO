# CONVERSATION ENGINE

## Amaç
Mesajlar doğal insan sohbeti kalitesinde olmalı:
- robotik değil
- template hissi düşük
- müşteri bağlamını bilen
- kısa
- ton uyumlu
- gereksiz kurumsal olmayan

## Pipeline
Incoming Message
→ Customer Memory
→ Intent/Sentiment
→ Conversation Director
→ Specialist Agent
→ Natural Language Renderer
→ Human-Likeness QA
→ Risk/Escalation Check
→ Send

## Style Profile
- formal | neutral | casual | very_casual
- preferred_message_length: short | medium
- emoji_tolerance: none | low | normal
- jargon_level
- language
- response_energy

## Mesaj kuralları
- Default 1–3 kısa cümle.
- Bir mesajda bir ana amaç.
- Uzun açıklama sadece gerektiğinde.
- Kullanıcının kelimelerini mekanik biçimde tekrar etme.
- Her mesaj CTA ile bitmez.
- Kullanıcı kısa yazıyorsa kısa cevap.
- Gerçek tool/check yoksa “kontrol ediyorum” deme.
- Uydurma gecikme bahanesi/kişisel hikâye yok.

## Shadow Mode
Pilot başında agent cevap üretir, otomatik göndermez.
Manager: Approve / Edit / Reject.
Edit'ler evaluation dataset'e yazılır.

## Versioning
Her outgoing message:
- prompt_version
- renderer_version
- qa_version
- kb_version
taşır.
