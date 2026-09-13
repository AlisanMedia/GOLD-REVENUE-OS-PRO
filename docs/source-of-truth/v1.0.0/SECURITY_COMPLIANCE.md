# SECURITY & OPERATIONAL CONTROLS

## Secrets
Agent context içine asla girmez:
- wallet private key / seed
- payment secret
- Telegram bot secret
- DB service role key
- auth/session tokens

## Payment
- webhook signature validation
- raw payload hash
- idempotency
- replay protection
- duplicate tx defense
- wrong network/asset handling
- reconciliation
- AI payment confirmation kararı vermez

## Access
- one-time invite where possible
- expiry
- audit
- revoke reason
- manual override
- reconciliation job

## Data provenance
Her imported field:
source, source_record_id, import_batch, collected_at (if known),
permitted_use flag if applicable.

Belirsiz identity merge sessiz yapılmaz.

## Customer communication
- guaranteed-profit claim yok
- fabricated performance claim yok
- fake human biography yok
- unauthorized price yok
- fabricated payment/access status yok
- direct AI identity question deceptive cevaplanmaz
- contact eligibility configurable ve auditable olur

## RBAC
Roles:
super_admin, manager, support, analyst, readonly.

Sensitive actions elevated permission + audit:
manual access, extension, refund workflow, payment correction, export,
agent policy/KB publish.

## Rate limit
Per tenant, channel, customer, agent, endpoint.

## Kill switches
- pause all outbound
- pause payment automation
- pause access automation
- pause specific agent
- pause tenant
- force human review
