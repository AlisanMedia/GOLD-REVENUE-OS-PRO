# TEST PLAN

## P0 Acceptance

### Database
- migrations clean
- tenant isolation
- unique constraints
- dedup does not merge obvious distinct users
- append-only state history

### State
- valid transitions pass
- invalid transitions 409
- concurrent event cannot double-transition

### Events
- persisted before dispatch
- consumer idempotency
- retry
- dead-letter

### Payments
- duplicate webhook does not double-subscribe
- invalid signature rejected
- wrong amount/network flagged
- delayed confirmation handled
- exactly one subscription.started

### Access
- valid grant
- expiry revoke
- access failure escalates
- manual override audited

### Conversation
- memory loaded
- response length adapts
- template repetition test
- direct “are you AI?” non-deceptive
- KB conflict escalates
- critical message blocks auto-send

### Human Takeover
- stops AI outbound
- human reply works
- scheduled followup paused
- return-to-AI gets resolution context

### Admin
- Customer 360 complete
- critical queue updates
- RBAC enforced
- filters/search usable

## Pilot gates

### 10 users
Goal: technical integrity
- 0 duplicate payment/access
- 100% audit
- human takeover works
- no unhandled critical case

### 25 users
Goal: conversation quality
Track:
- rewrite rate
- robotic score
- reply rate
- escalation accuracy

### 50 users
Goal: conversion/payment
Track:
- qualified
- offer
- payment completion
- payment→access time
- payment failures

### 100 users
Goal: retention
Track:
- onboarding
- support
- 7/14/30-day engagement
- renewal intent
- churn reasons

## Regression dataset
Cases:
casual trader, formal trader, inactive, price objection, trust objection,
support complaint, payment missing, legal threat, asks for human,
asks “are you AI?”, refund, VIP negotiation.
