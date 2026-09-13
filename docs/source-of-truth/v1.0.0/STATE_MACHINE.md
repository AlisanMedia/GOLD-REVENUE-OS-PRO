# STATE MACHINE

```mermaid
stateDiagram-v2
    [*] --> NEW
    NEW --> CONTACT_READY
    CONTACT_READY --> CONTACTED
    CONTACTED --> REPLIED
    REPLIED --> QUALIFIED
    QUALIFIED --> OFFER_SENT
    OFFER_SENT --> INTERESTED
    OFFER_SENT --> NOT_INTERESTED
    INTERESTED --> PAYMENT_PENDING
    PAYMENT_PENDING --> PAID
    PAID --> ACCESS_GRANTED
    ACCESS_GRANTED --> ACTIVE
    ACTIVE --> RENEWAL_DUE
    RENEWAL_DUE --> RENEWED
    RENEWED --> ACTIVE
    RENEWAL_DUE --> EXPIRED
    EXPIRED --> CHURNED
    CHURNED --> WINBACK
    WINBACK --> INTERESTED

    NOT_INTERESTED --> SURVEY_OFFERED
    SURVEY_OFFERED --> SURVEY_COMPLETED
    SURVEY_COMPLETED --> TRIAL_ACTIVE
    TRIAL_ACTIVE --> INTERESTED
    TRIAL_ACTIVE --> EXPIRED
```

## Guard rules
- PAYMENT_PENDING → PAID yalnız verified payment event ile.
- PAID → ACCESS_GRANTED valid subscription + policy ile.
- ACTIVE → RENEWAL_DUE süreye göre scheduler ile.
- RENEWAL_DUE → EXPIRED ödeme yoksa.
- EXPIRED → CHURNED grace tamamlanınca.
- Invalid transition = 409 + audit log.

State history append-only tutulur:
from_state, to_state, reason_code, actor_type, actor_id, event_id, created_at.
