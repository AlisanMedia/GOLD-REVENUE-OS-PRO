export type BotInventory = Readonly<{
  role: "BUSINESS_AI" | "MERCHANT" | "STARS_DEDICATED_TEST";
  api_environment: "TELEGRAM_PRODUCTION" | "TELEGRAM_DEDICATED_TEST";
  credential_name: string; state: "OBSERVED" | "BLOCKED" | "NOT_CONFIGURED";
  metadata_requests: number; provider_status?: number | null; reason?: string;
  bot_id?: string; bot_username?: string; secretary_capability?: boolean | null; get_me_source_hash?: string;
  webhook?: { target: string; url_hash: string; source_hash: string; pending_update_count: number; allowed_updates: string[] | null; error_present: boolean };
}>;
export function observeProtectedIntegrationInventory(input: {
  env: Readonly<Record<string, string | undefined>>; request?: typeof fetch; now?: () => number;
}): Promise<Readonly<{
  version: 1; mode: "PROTECTED_READ_ONLY_INTEGRATION_INVENTORY"; repository_sha: string; observed_at: string;
  configured_names: readonly string[]; missing_names: readonly string[];
  openai: Readonly<{ state: "OBSERVED" | "BLOCKED"; provider_status: number | null; model_access: "OBSERVED" | "UNVERIFIED"; model_metadata_requests: number; actual_inference_requests: 0; reason?: string }>;
  openai_http_classification: string | null; bots: readonly BotInventory[]; bot_role_conflicts: readonly (readonly string[])[];
  credential_access: "PROTECTED_JOB_ONLY"; genuine_execution_authority: "BLOCKED"; provider_account_authority: "UNVERIFIED";
  webhook_mutations: 0; database_mutations: 0; actual_inference_requests: 0; telegram_messages: 0; payment_requests: 0;
  billing: "UNKNOWN"; financial_authority: "NONE"; commercial_pilot: "NO_GO";
}>>;
