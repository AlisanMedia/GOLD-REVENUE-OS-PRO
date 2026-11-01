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
export type PrivateBetaOpenAIReadonlyInput = Readonly<{
  env: Readonly<Record<string, string | undefined>>; request?: typeof fetch; now?: () => number;
}>;
export type OpenAIProjectHardLimitObservation = Readonly<{
  version: 1; mode: "PROTECTED_READ_ONLY_OPENAI_PROJECT_CONTROLS"; provider: "openai"; state: "OBSERVED" | "BLOCKED";
  actual_inference_requests: 0; genuine_execution_authority: "BLOCKED"; provider_account_authority: "UNVERIFIED";
  effective_experiment_cap: "UNVERIFIED"; actual_billed_amount: null; billing: "UNKNOWN"; database_authority_written: false;
  financial_authority: "NONE"; commercial_pilot: "NO_GO"; control_metadata_requests: number;
  project_http_status: number | null; limit_http_status: number | null;
  reason?: string; repository_sha?: string; account_scope_hash?: string; monthly_hard_limit_usd?: string;
  enforcement?: "enforcing"; enforcement_delay_possible?: true; project_response_hash?: string; limit_response_hash?: string;
  observed_at?: string; unresolved?: readonly string[];
  project_residency?: string;
}>;
export function observeOpenAIProjectHardLimit(input: PrivateBetaOpenAIReadonlyInput): Promise<OpenAIProjectHardLimitObservation>;
export function observeConfiguredOpenAIModel(input: PrivateBetaOpenAIReadonlyInput): Promise<Readonly<{
  version: 1; mode: "PROTECTED_READ_ONLY_MODEL_METADATA"; provider: "openai"; model: "gpt-6.1-sol";
  state: "OBSERVED" | "BLOCKED"; model_access: "OBSERVED" | "UNVERIFIED"; model_metadata_requests: number;
  actual_inference_requests: 0; genuine_execution_authority: "BLOCKED"; provider_account_authority: "UNVERIFIED";
  effective_experiment_cap: "UNVERIFIED"; actual_billed_amount: null; billing: "UNKNOWN"; data_policy: "UNVERIFIED";
  database_authority_written: false; financial_authority: "NONE"; commercial_pilot: "NO_GO";
  provider_status: number | null; reason?: string; repository_sha?: string; model_response_hash?: string;
  observed_at?: string; unresolved?: readonly string[]; account_scope_hash: null;
}>>;
