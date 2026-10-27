export type PrivateBetaOpenAIAccountObservation = Readonly<{
  version: 1; mode: "PROTECTED_READ_ONLY_OPENAI_PREFLIGHT"; provider: "openai"; model: "gpt-6.1-sol";
  state: "OBSERVED" | "BLOCKED"; model_access: "OBSERVED" | "UNVERIFIED"; model_metadata_requests: number; actual_inference_requests: 0;
  genuine_execution_authority: "BLOCKED"; actual_attempt_billing: "UNKNOWN"; actual_billed_amount: null;
  provider_account_authority: "UNVERIFIED"; effective_experiment_cap: "UNVERIFIED"; data_policy: "UNVERIFIED"; region: "UNVERIFIED";
  retention_and_training: "UNVERIFIED"; database_authority_written: false; financial_authority: "NONE"; commercial_pilot: "NO_GO";
  reason?: string; repository_sha?: string; program_id?: string; account_scope_hash?: string; credential_sha256?: string;
  program_response_hash?: string; model_response_hash?: string; observed_at?: string; unresolved?: readonly string[];
}>;
export function privateBetaOpenAIAccountQuery(programId: string): string;
export function observePrivateBetaOpenAIAccount(input: {
  env: Readonly<Record<string, string | undefined>>; request?: typeof fetch; now?: () => number;
}): Promise<PrivateBetaOpenAIAccountObservation>;
