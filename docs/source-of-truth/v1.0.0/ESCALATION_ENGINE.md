# HUMAN ESCALATION ENGINE

## Severity
LOW: agent çözebilir.
MEDIUM: agent cevaplar, case loglanır.
HIGH: auto-send durur, manager notification.
CRITICAL: conversation pause + immediate notification + temporary response.

## Critical categories
- refund_request
- payment_not_reflected
- access_missing_after_payment
- legal_threat
- fraud_accusation
- financial_loss_complaint
- security_issue
- high_value_negotiation
- user_requests_human
- agent_low_confidence
- knowledge_conflict
- VIP_complaint

## Temporary responses
General:
“Bunu yanlış yönlendirmek istemiyorum. Ekibimizden birine danışıp sana net şekilde döneceğim.”

Payment:
“Ödemeyi yanlış bilgi vermeden kontrol ettireyim. İşlemi ilgili kişiye iletiyorum, sonucunu sana buradan yazacağız.”

Special:
“Bu standart bir konu değil, sana yanlış bir şey söylemeyeyim. Yetkiliyle netleştirip döneyim.”

## Case fields
id, tenant_id, customer_id, conversation_id, severity, category,
detected_message_id, summary, evidence, suggested_resolution,
suggested_reply, assigned_to, status, created_at, first_response_at,
resolved_at, resolution_code, resolution_note.

## Human takeover
Takeover:
- automation_paused = true
- customer-facing followups paused
- AI may summarize internally
- only human messages sent

Return:
- manager resolution summary
- Customer Memory update
- automation_paused = false
- Orchestrator recalculates next action

## Admin notification
MVP: Telegram admin bot.
Payload:
severity, customer, category, waiting duration, summary, deep link.
