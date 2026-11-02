import type { createPolatPrivateBetaProvider } from "../packages/domain/src/polat-private-beta-provider";
export type ProtectedFounderCanaryResult = Readonly<{
  version: 1; mode: "PROTECTED_EXISTING_OWNER_CANARY_RECOVERY"; state: "BLOCKED" | "ALREADY_ACCEPTED_NO_DISPATCH" | "REAL_CANARY_QA_ACCEPTED";
  financial_authority: "NONE"; commercial_pilot: "NO_GO"; actual_billed_amount: null; provider_billing: "UNKNOWN";
  automatic_retries: 0; telegram_messages: 0; original_unknown_preserved: boolean | string; owner_mfa_manufactured: false;
  recovery_mutation?: string; initiated_attempts?: number; actual_inference_requests?: 1; repository_sha?: string;
  model?: string; input_tokens?: number | null; output_tokens?: number | null; response_hash?: string | null;
  elapsed_ms?: string | null; qa?: string; independent_journal_readback?: boolean; reason?: string;
  original_unknown_readback_hash?: string; existing_owner_auth_preserved?: boolean;
}>;
export function runPrivateBetaProtectedCanary(input: Readonly<{ env: Readonly<Record<string,string|undefined>>; request?: typeof fetch; providerFactory?: typeof createPolatPrivateBetaProvider }>): Promise<ProtectedFounderCanaryResult>;
