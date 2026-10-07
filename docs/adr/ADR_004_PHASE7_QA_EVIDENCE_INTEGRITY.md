# ADR 004: Phase 7 QA precision and authoritative evidence

Status: Accepted for corrective validation; Phase 7 closeout remains subject to fresh live evidence and owner approval.

The model uses opaque handles derived from the tenant-scoped context v3 manifest. Provider JSON Schema enumerates those handles. The server resolves them to message IDs, rejects unknown handles without retrying, and retains both wire and resolved outputs. A database trigger reconstructs the registry from bounded messages and independently resolves the wire references before accepting stage evidence. Customer text cannot add registry entries. Memory handles additionally require inbound direction.

Speech acts distinguish acknowledgement, current-turn language preference, available conversational capability, prospective preparation for review, guaranteed commitment, completed action, and factual assertions. Phase 7 offers conversation replies and preparation of a human-reviewed proposal. It has no guaranteed outbound or financial commitments and no verified business catalog. An offer is not a completion receipt. Completed actions still require exact tenant/conversation/boundary-scoped backend evidence. A preference acknowledgement never proves a durable memory write. Existing truthful identity behavior is unchanged.

Memory provenance uses one service-only database validator shared by the worker and the table trigger. It checks the run/event/source mapping, tenant, conversation, customer, inbound direction, source timestamp and bounded included-message list. The trigger records rejection evidence and prevents invalid proposals becoming accepted. Browser roles cannot invoke the validator or write evidence.

QA publishes prompt v5, director v3, renderer v5, QA v4, output schema v4 and evaluation set phase7-balanced-v5. Context remains v3. Numeric thresholds and maximum one rewrite remain unchanged. Safe injection refusals may mention protected prompts without disclosing them. A repetition exemption applies only to the requested text and count; accidental duplication remains penalized.

Structural context fit and semantic context fit are separate fields. Semantic fit uses documented intent/constraint checks, with coverage and mandatory human review recorded; this does not represent a general semantic-model judgement. Factual evidence separates grounded assertion score, availability of verified business knowledge and unsupported assertion count. Honest uncertainty with no factual assertion has a null grounded assertion score rather than implying catalog certainty. Model confidence does not become evidence confidence.

Regressions include 24 safe and 28 unsafe EN/TR/AR/RU cases with explicit denominators, adversarial speech-act labels, fabricated references, missing action receipts, safe refusal, requested and accidental repetition, and wrong-topic output despite matching the structural goal. Transactional pgTAP exercises nonexistent, other-conversation, other-tenant, future and excluded memory sources, plus a valid pending source. These fixtures are not live evidence.

Outbound and autonomous messaging remain disabled, historical import remains locked, and Phase 8 is not started. Merge and deployment require CI. Fresh Telegram tests and a final manual content review are required before recommending closeout.
