import { z } from "zod";

export const JEFF_CLAUDE_MODEL = "claude-haiku-5-5" as const;
export const JEFF_CLAUDE_ADAPTER_VERSION = "jeff-claude-messages-v1" as const;
export const CLAUDE_MESSAGES_API_VERSION = "2023-06-01" as const;
const tokens = z.number().int().min(0).max(2147483647).nullable();
/** Observed counters, never a price, estimated total or billed amount. */
export const jeffClaudeUsageSchema = z.strictObject({
  input_tokens: tokens.optional(), output_tokens: tokens.optional(),
  cache_creation_input_tokens: tokens.optional(), cache_read_input_tokens: tokens.optional(),
  cache_creation: z.strictObject({ ephemeral_1h_input_tokens: tokens.optional(), ephemeral_5m_input_tokens: tokens.optional() }).nullable().optional(),
  output_tokens_details: z.strictObject({ thinking_tokens: tokens.optional() }).nullable().optional(),
  inference_geo: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u).nullable().optional(),
  service_tier: z.enum(["standard", "priority", "batch"]).nullable().optional(),
  speed: z.enum(["standard", "fast"]).nullable().optional(),
  server_tool_use: z.strictObject({ web_fetch_requests: tokens, web_search_requests: tokens }).nullable().optional(),
}).superRefine((u,c) => {
  if (u.output_tokens != null && u.output_tokens_details?.thinking_tokens != null && u.output_tokens_details.thinking_tokens > u.output_tokens)
    c.addIssue({ code: "custom", message: "THINKING_USAGE_EXCEEDS_OUTPUT" });
});
export type JeffClaudeUsage = z.infer<typeof jeffClaudeUsageSchema>;
/** Data-only mock HTTP injection. There is no fetch/callback/credential argument. */
export const jeffClaudeOfflineFrameSchema = z.strictObject({
  kind: z.enum(["HTTP", "CONNECTION_LOST"]), status: z.number().int().min(100).max(599),
  body: z.string().max(65536), delay_ms: z.number().int().min(0).max(1000).default(0),
  ignore_abort: z.boolean().default(false), retry_after_ms: z.number().int().min(0).max(60000).nullable().default(null),
});
export const jeffClaudeOfflineConfigSchema = z.strictObject({
  adapter_version: z.literal(JEFF_CLAUDE_ADAPTER_VERSION), model: z.literal(JEFF_CLAUDE_MODEL),
  maximum_output_tokens: z.number().int().min(1).max(4096), timeout_ms: z.number().int().min(1).max(1000),
  frame: jeffClaudeOfflineFrameSchema,
});
export type JeffClaudeOfflineConfig = z.infer<typeof jeffClaudeOfflineConfigSchema>;
