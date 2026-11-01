export type PrivateBetaFounderIngressResult = Readonly<{
  version: 1; mode: "PROTECTED_FOUNDER_BUSINESS_INGRESS"; operation: "prepare" | "register" | "INVALID"; state: "PREPARED" | "REGISTERED" | "BLOCKED";
  mutation_state: "NOT_ATTEMPTED" | "UNVERIFIED" | "ACKNOWLEDGED"; webhook_registration: "NOT_ATTEMPTED" | "UNKNOWN" | "VERIFIED";
  ingress_authentication_verified: boolean; upstream_hmac_delivery_verified: false;
  actual_inference_requests: 0; telegram_messages: 0; actual_billed_amount: null; provider_billing: "UNKNOWN"; provider_enforced_cap: "UNVERIFIED";
  financial_authority: "NONE"; commercial_pilot: "NO_GO"; reason?: string; repository_sha?: string; scope_hash?: string;
  updated_names?: readonly string[]; edge_secret_names?: readonly string[]; edge_secret_write?: "ACKNOWLEDGED"; edge_function_deployed?: false;
  bot_id?: string; bot_source_hash?: string; allowed_update_names?: readonly string[]; webhook_configuration_verified?: true; inbound_delivery_observed?: false; sso_changed?: false;
}>;
export function runPrivateBetaFounderIngress(input: Readonly<{
  command: "prepare" | "register"; env: Readonly<Record<string, string | undefined>>; request?: typeof fetch; random?: (size: number) => Uint8Array; now?: () => number;
}>): Promise<PrivateBetaFounderIngressResult>;
