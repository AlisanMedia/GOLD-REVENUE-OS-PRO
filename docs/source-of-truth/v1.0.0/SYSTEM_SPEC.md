# SYSTEM SPEC — Gold Revenue OS

## 1. Vizyon
Gold Revenue OS; forex/gold sinyal servisleri için müşteri edinimi, satış, ödeme,
Telegram erişimi, satış sonrası destek, yenileme, churn ve müşteri içgörüsünü
tek panelde yöneten agent tabanlı işletim sistemidir.

**Conversation → Payment → Access → Retention → Intelligence → Improvement**

## 2. MVP başarı kriterleri
- Customer 360 eksiksiz çalışır.
- Lead import + dedup yapılır.
- Customer state machine otomatik ilerler.
- Agent müşteri profilini okuyarak doğal konuşma yürütebilir.
- Payment Intent oluşturulur.
- Doğrulanmış webhook sonrası subscription başlar.
- Access Engine VIP kanal erişimini açar/kapatır.
- Critical mesaj otomatik eskale edilir.
- Yönetici konuşmayı canlı devralabilir.
- Survey/konuşma verisinden insight üretilebilir.
- Tüm privileged aksiyonlar audit edilir.

## 3. Roller
### Super Admin
Tüm sistemi, tenant'ları, agent politikalarını ve kritik vakaları yönetir.
### Manager
Müşteri, case, access, subscription ve human takeover yönetir.
### Analyst
Analytics ve intelligence görür.
### Agent Worker
Sadece whitelisted tool'larla işlem yapar.

## 4. Customer State Machine
NEW
→ CONTACT_READY
→ CONTACTED
→ REPLIED
→ QUALIFIED
→ OFFER_SENT
→ INTERESTED
→ PAYMENT_PENDING
→ PAID
→ ACCESS_GRANTED
→ ACTIVE
→ RENEWAL_DUE
→ RENEWED / EXPIRED
→ CHURNED
→ WINBACK

Alternatif:
OFFER_SENT
→ NOT_INTERESTED
→ SURVEY_OFFERED
→ SURVEY_COMPLETED
→ TRIAL_ACTIVE
→ PAID / EXPIRED

## 5. P0 Event'ler
- customer.created
- customer.state_changed
- message.received
- message.sent
- qualification.completed
- offer.created
- offer.accepted
- payment.intent_created
- payment.confirmed
- payment.failed
- subscription.started
- subscription.renewal_due
- subscription.renewed
- subscription.expired
- access.granted
- access.revoked
- survey.completed
- escalation.created
- escalation.resolved
- agent.task_created
- agent.task_completed

## 6. MVP agent'ları
1. Orchestrator
2. Lead Intelligence
3. Conversation / Qualification
4. Conversion
5. Payment & Access coordinator
6. Customer Success
7. Customer Intelligence
8. QA / Escalation Evaluator

V2:
- Objection Specialist
- Research Agent
- Renewal Agent
- Win-back Agent
- Product Strategy Agent
- Revenue Analyst
- Conversation Director
- Natural Language Renderer

## 7. Customer Memory
Merkezi DB source-of-truth olacaktır.

Alanlar:
- experience_level
- primary_instrument
- preferred_signal_frequency
- risk_preference
- previous_service_experience
- pain_points
- objections
- communication_style
- preferred_message_length
- price_sensitivity
- trust_level
- last_conversation_summary
- next_best_action
- trial_interest
- churn_reason
- retention_risk

Her memory item provenance taşır:
source_type, source_id, observed_at, confidence.

## 8. Conversation Quality
Müşteri-facing agent:
- kısa yazar
- gereksiz kurumsal dil kullanmaz
- müşteri tonuna adapte olur
- bir mesajda bir ana amaç taşır
- aynı template'i herkese kullanmaz
- geçmiş konuşmayı hatırlar
- bağlam oluşmadan satışa yüklenmez
- uydurma kişisel hayat/deneyim üretmez
- doğrudan AI/bot olup olmadığı sorulursa yanıltıcı cevap vermez
- finansal vaat/performans konusunda doğrulanmamış iddia üretmez

## 9. Human Escalation
Critical kategoriler:
- refund
- payment mismatch
- ödeme sonrası access yok
- legal threat
- fraud/scam accusation
- financial loss complaint
- security issue
- high-value negotiation
- user asks for human
- knowledge conflict
- low confidence
- VIP complaint

Akış:
DETECT → PAUSE → TEMP RESPONSE → CREATE CASE → NOTIFY MANAGER →
HUMAN TAKEOVER → RESOLVE → RETURN TO AI

## 10. Crypto Payment
AI private key görmez.

Payment record:
invoice_id, customer_id, order_id, asset, network, amount,
provider_session/address, expires_at, tx_hash, confirmations, status.

Webhook:
- signature verification
- idempotency
- replay protection
- amount/network validation

`payment.confirmed`
→ subscription.started
→ access.granted

## 11. Access Engine
Deterministic kurallar:
- PAID + valid subscription → grant
- TRIAL_ACTIVE → temporary grant
- EXPIRED + grace over → revoke
- MANUAL_HOLD → no auto grant

## 12. Admin Panel
P0 ekranlar:
1. Dashboard
2. Customers
3. Customer 360
4. Conversations
5. Needs Your Attention
6. Payments
7. Subscriptions
8. Channel Access
9. Agents
10. Knowledge Base
11. Surveys
12. Analytics
13. Settings
14. Audit Logs

## 13. Customer Intelligence
Sistem şu sorulara veriyle cevap üretir:
- İnsanlar neden alıyor?
- Neden almıyor?
- Neden churn oluyor?
- Hangi fiyat/offer çalışıyor?
- Hangi sinyal sıklığı tercih ediliyor?
- Hangi support beklentileri tekrar ediyor?
- Trial→paid darboğazı nerede?
- Hangi segment daha değerli?

Insight çıktısı:
finding, evidence_count, confidence, affected_segment,
revenue_impact_estimate, recommended_experiment, owner, status.

## 14. Multi-tenant
Tüm business tablolarında tenant_id bulunur.
Tenant seviyesinde branding, Telegram, pricing, payment, KB, agent policies,
escalation ve permissions ayrılır.

## 15. Pilot
- 10 kullanıcı: teknik bütünlük
- 25: conversation quality
- 50: conversion + payment
- 100: retention + renewal
- sonra kontrollü scale
