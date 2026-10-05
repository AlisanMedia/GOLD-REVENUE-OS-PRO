# Phase 7 corrective design (not a closeout report)

Baseline: `5913781ca65e2cc715c38b3d8e10c71d40825629`.
Phase 7 remains open until corrected CI, staging and fresh authorized live evidence pass.
Phase 8, autonomous sending, historical imports and financial/access mutations remain prohibited.

## Evidence and truth

- Structured per-sentence claims distinguish system/tool facts, customer reports,
  qualified inference, safe social language, honest uncertainty and unsupported claims.
- Backend facts and completed actions require exact, completed, tenant/conversation-
  scoped evidence at or before the context boundary. The Phase 7 worker supplies no
  operational action receipts; it cannot claim a send, payment, access grant or handoff.
- Claim coverage is checked against the rendered draft. Uncovered claims fail closed.
  Deterministic predicate checks additionally reject operational claims mislabelled
  as social/uncertainty. These are text safeguards, not proof of unrestricted semantic
  understanding. Manual review of actual multilingual outputs remains required.
- Model confidence is retained separately from evidence-derived grounding/factual
  confidence. A factual-assertion count of zero means no business value was asserted:
  QA confidence of 100 then measures safe honesty, not certainty about an unknown price.
- Original generation, rendered draft, claim review, individual naturalness indicators,
  memory validation and one rewrite are preserved as append-only, tenant-scoped stages.
  Indicators are labelled deterministic text indicators, not an invented human score.

## Source and memory boundaries

- Context remains source-message version 3; audit manifest is version 2.
- Ordered message IDs, exact included event IDs, timestamp boundary, SHA-256 of the
  actual bounded message substrings, aggregate context hash and retrieval version are
  retained without copying message bodies into the manifest.
- Event and memory retrieval are timestamp-bounded. Current profile/customer versions
  updated after the source are excluded rather than represented as historical facts.
- Ambiguous equal-timestamp message ordering fails closed.
- Runtime rejects the entire invalid memory proposal, preserving rejection evidence.
  A database trigger independently checks existence, tenant, conversation, customer,
  inbound direction, source event, included IDs and timestamp on insert/acceptance.
  Invalid proposals are rejected, never pending/accepted. Language inference is not
  an explicit fact without an actual language-preference statement.

## Conversation and rewrite

- One attentive professional external profile is independent of internal routing.
  Direct identity questions remain truthful; no invented biography or operational story.
- Current-source language and negative emoji preferences take priority.
- Unicode letters/marks/numbers survive normalization, including Arabic and Cyrillic.
- Director uses explicit intent classes and identifies `pricing.source_of_truth` gaps.
- Existing numeric QA thresholds are unchanged. New named naturalness indicators use
  the documented >60 rewrite boundary; unsafe claims/escalation remain blocked.
- Exactly one rewrite is allowed. Residual rewrite-required outputs are blocked.
- Worker claims one task per invocation, with at most two 25s provider deadlines,
  preserving the existing 60s function budget. This reduces Phase 7 throughput but
  prevents a long multi-task rewrite batch from losing leases or execution evidence.

## Regression evidence

EN/TR/AR/RU property fixtures cover 19 categories each; the evaluation set contains
94 cases including the 18 previous cases. Unit tests cover receipt scope/time,
multilingual uncertainty/questions/repetition, confidence separation and memory.
Worker integration tests explicitly use mocked providers and are not live evidence.
pgTAP tests cover immutable evidence, successful-invocation prerequisites, role and
tenant denial, and whole-proposal rejection/acceptance revalidation.

No model, tenant permissions, outbound setting, import lock or QA thresholds are
changed to make a live result pass. Live rewrite and manual output review are still
mandatory before an owner closeout recommendation.
