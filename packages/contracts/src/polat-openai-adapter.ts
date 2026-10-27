import { z } from "zod";

/** Reviewed engineering target, not account availability or an execution grant. */
export const POLAT_OPENAI_MODEL = "gpt-6.1-sol" as const;
export const POLAT_OPENAI_PROTOCOL = "responses-v1" as const;
export const POLAT_OPENAI_CODEC = "openai-responses-v1" as const;
const counter = z.number().int().min(0).max(2147483647);
export const polatOpenAIUsageSchema = z.strictObject({
  input_tokens: counter, output_tokens: counter, total_tokens: counter,
  input_tokens_details: z.strictObject({ cached_tokens: counter, cache_write_tokens: counter.optional() }).optional(),
  output_tokens_details: z.strictObject({ reasoning_tokens: counter }).optional(),
}).superRefine((u, ctx) => {
  if (u.total_tokens !== u.input_tokens + u.output_tokens) ctx.addIssue({ code: "custom", message: "OPENAI_USAGE_TOTAL_CONFLICT" });
  if ((u.input_tokens_details?.cached_tokens ?? 0) > u.input_tokens || (u.input_tokens_details?.cache_write_tokens ?? 0) > u.input_tokens
    || (u.input_tokens_details?.cached_tokens ?? 0) + (u.input_tokens_details?.cache_write_tokens ?? 0) > u.input_tokens)
    ctx.addIssue({ code: "custom", message: "OPENAI_USAGE_INPUT_CONFLICT" });
  if ((u.output_tokens_details?.reasoning_tokens ?? 0) > u.output_tokens) ctx.addIssue({ code: "custom", message: "OPENAI_USAGE_REASONING_CONFLICT" });
});
export type PolatOpenAIUsage = z.infer<typeof polatOpenAIUsageSchema>;
