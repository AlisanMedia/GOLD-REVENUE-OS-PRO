import { z } from "zod";

export const POLAT_CLAUDE_MODEL = "claude-haiku-5-5" as const;
export const POLAT_CLAUDE_ADAPTER_VERSION = "polat-claude-messages-v1" as const;
export const CLAUDE_MESSAGES_API_VERSION = "2023-06-01" as const;
const tokens = z.number().int().min(0).max(2147483647).nullable();
/** Observed counters, never a price, estimated total or billed amount. */
export const polatClaudeUsageSchema = z.strictObject({
  input_tokens: tokens.optional(), output_tokens: tokens.optional(),
  cache_creation_input_tokens: tokens.optional(), cache_read_input_tokens: tokens.optional(),
  cache_creation: z.strictObject({ ephemeral_1h_input_tokens: tokens.optional(), ephemeral_5m_input_tokens: tokens.optional() }).optional(),
  output_tokens_details: z.strictObject({ thinking_tokens: tokens.optional() }).optional(),
  inference_geo: z.enum(["global", "us"]).optional(), service_tier: z.enum(["standard", "priority", "batch"]).optional(),
});
export type PolatClaudeUsage = z.infer<typeof polatClaudeUsageSchema>;
/** Data-only mock HTTP injection. There is no fetch/callback/credential argument. */
export const polatClaudeOfflineFrameSchema = z.strictObject({
  kind: z.enum(["HTTP", "CONNECTION_LOST"]), status: z.number().int().min(100).max(599),
  body: z.string().max(65536), delay_ms: z.number().int().min(0).max(1000).default(0),
  ignore_abort: z.boolean().default(false), retry_after_ms: z.number().int().min(0).max(60000).nullable().default(null),
});
export const polatClaudeOfflineConfigSchema = z.strictObject({
  adapter_version: z.literal(POLAT_CLAUDE_ADAPTER_VERSION), model: z.literal(POLAT_CLAUDE_MODEL),
  maximum_output_tokens: z.number().int().min(1).max(4096), timeout_ms: z.number().int().min(1).max(1000),
  frame: polatClaudeOfflineFrameSchema,
});
export type PolatClaudeOfflineConfig = z.infer<typeof polatClaudeOfflineConfigSchema>;
