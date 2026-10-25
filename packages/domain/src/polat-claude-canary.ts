import { polatGuardDigest } from "./polat-experiment-journal";
import { POLAT_CLAUDE_MODEL, CLAUDE_MESSAGES_API_VERSION } from "@gold-revenue-os/contracts";

/** Separate PLAN ONLY. Does not alter v2, its 290 targets, or any owner manifest. */
const plan = {
  version: "polat-claude-canary-v1", mode: "PROPOSED_SYNTHETIC_INPUT_CANARY", provider: "anthropic", model: POLAT_CLAUDE_MODEL,
  protocol_version: CLAUDE_MESSAGES_API_VERSION, maximum_requests: 1, automatic_retries: 0, automatic_fallbacks: 0, qa_regenerations: 0,
  proposed_maximum_output_tokens: 512, proposed_timeout_ms: 10000, approved_spend: null, approved_currency: null,
  cases: [{ id: "canary-hello-en-v1", language: "en", style: "DIRECT", text: "Hi", expected: "SAFE", commercial_facts: "NO_PRICE_OR_TRADING_CLAIMS", required_identity: "Polat AI assistant" }],
  acceptance: ["EXACT_RESPONSE_MODEL_AND_COMPLETION", "NATIVE_QA_ON_ACTUAL_OUTPUT", "OBSERVED_USAGE_NOT_ESTIMATED_BILLING", "INDEPENDENT_COST_RECONCILIATION_BEFORE_ANOTHER_REQUEST"],
  stop: ["UNKNOWN_RESULT", "UNKNOWN_BILLING", "ANY_QA_HOLD", "MODEL_OR_VERSION_DRIFT", "ACCOUNT_AUTHORITY_UNAVAILABLE"],
  human_quality_acceptance: "NOT_ESTABLISHED", owner_approval: "PENDING", authorized_external_requests: 0, execution_enabled: false,
  financial_authority: "NONE", live_operations_authorized: false,
} as const;
export function polatClaudeCanaryPlan() {
  const copy=structuredClone(plan);
  return { plan: copy, corpus_hash: polatGuardDigest(copy.cases), plan_hash: polatGuardDigest(copy), target_hash: polatGuardDigest([copy.version, copy.cases[0].id, copy.cases[0].language, copy.cases[0].style]) };
}
