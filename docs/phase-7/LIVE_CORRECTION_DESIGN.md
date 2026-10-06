# Live claim correction (Phase 7 remains open)

Live deployment `ae9035ff13636841a43b759902b511510ed0e3a0` exposed:

- EN/AR prospective help offers labelled as questions, and RU knowledge limits
  labelled as business facts. Strict QA correctly rejected the mismatched kinds.
- An Arabic product assertion combined with an uncertainty clause incorrectly
  passed that individual claim's uncertainty check. The complete draft was blocked
  for another claim, but that is not proof of correct per-claim truth enforcement.
- The short renderer dropped TR's third sentence containing a knowledge limit.
- Later test replies revived earlier membership/access topics despite a correct
  context anchor. The provider now explicitly names the exact bounded current
  source message and requires the response to address that turn.

The next prompt specifies actual question punctuation, separates honest knowledge
limits from facts, and forbids a generic product overview when catalog/pricing is
unavailable. Deterministic EN/TR/AR/RU product predicates prevent the observed mixed
assertion/uncertainty bypass. Invalid claims always have zero evidence confidence.
These conservative text predicates are not unrestricted semantic proof.

The renderer preserves complete wording and trailing qualifications. Existing QA
length evaluation and the one-rewrite budget own concision; no numeric QA threshold,
provider, model, source anchor, identity policy, outbound setting, or permission changes.
Versions: prompt v4, renderer v4, QA v3, evaluation set v4; context remains 3.

Existing original evidence remains immutable. Fresh live output review on the new
merged and staging-validated SHA is mandatory; local regression tests cannot close
Phase 7. Phase 8 and historical import remain prohibited.
