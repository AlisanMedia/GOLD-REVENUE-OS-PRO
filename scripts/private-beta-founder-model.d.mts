export type PrivateBetaFounderModelObservation = Readonly<{
  version: 1; mode: "PROTECTED_FOUNDER_MODEL_PRICING_OBSERVATION"; state: "RECORDED" | "BLOCKED";
  actual_inference_requests: 0; provider_billing: "UNKNOWN"; provider_enforced_cap: "UNVERIFIED"; actual_billed_amount: null;
  owner_authority: "NOT_GRANTED"; genuine_execution_authority: "BLOCKED"; database_authority_written: false; financial_authority: "NONE"; commercial_pilot: "NO_GO";
  database_observation_write: "NOT_ATTEMPTED" | "UNVERIFIED" | "VERIFIED";
  reason?: string; repository_sha?: string; account_scope_hash?: string; model_response_hash?: string; pricing_source_hash?: string;
  policy_hash?: string; observed_at?: string; expires_at?: string;
}>;
export function collectPrivateBetaFounderModel(input: Readonly<{
  env: Readonly<Record<string, string | undefined>>; request?: typeof fetch; now?: () => number;
}>): Promise<PrivateBetaFounderModelObservation>;
