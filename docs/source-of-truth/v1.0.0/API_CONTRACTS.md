# API CONTRACTS

Base prefix: `/api/v1`

## Customers
- `GET /customers`
- `GET /customers/:id`
- `POST /customers/import`
- `PATCH /customers/:id`

Filters:
state, segment, risk, assigned_manager, subscription_status, search.

Import must create:
- import batch
- dedup report
- rejected rows report

## Conversations
- `GET /customers/:id/conversations`
- `POST /conversations/:id/human-takeover`
- `POST /conversations/:id/return-to-ai`
- `POST /conversations/:id/messages`

## Offers
- `POST /customers/:id/offers`
Server resolves approved product/price.

## Payments
- `POST /customers/:id/payment-intents`
- `GET /payments/:id`
- `POST /webhooks/payments/:provider`

Webhook requirements:
signature, raw-body validation, idempotency, replay protection.

## Subscriptions
- `GET /customers/:id/subscriptions`
- `POST /subscriptions/:id/extend` (manager+)

## Access
- `POST /customers/:id/access/grant`
- `POST /customers/:id/access/revoke`

Automatic path must still pass Access Engine policy.

## Escalations
- `GET /escalations`
- `GET /escalations/:id`
- `POST /escalations/:id/assign`
- `POST /escalations/:id/resolve`

## Surveys
- `POST /survey-responses`
- `GET /customers/:id/survey-responses`

## Agent Ops
- `GET /agent-tasks`
- `GET /agent-runs/:id`
- `POST /agent-tasks/:id/cancel`

No public endpoint accepts arbitrary prompt + arbitrary tool list.
