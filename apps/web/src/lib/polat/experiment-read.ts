import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{40}$/u);
export const experimentPageSchema = z.strictObject({
  version: z.literal(1), observed_at: z.string(), page_size: z.number().int().min(1).max(100), has_more: z.boolean(), billing_readable: z.boolean(),
  next_cursor: z.record(z.string(), z.unknown()).nullable(), financial_authority: z.literal("NONE"), authorized_external_requests: z.literal(0), execution_enabled: z.literal(false),
  items: z.array(z.strictObject({ id: z.uuid(), created_at: z.string(), mode: z.literal("OFFLINE_SYNTHETIC"), provider: z.literal("anthropic"), model: z.literal("claude-haiku-5-5"), repository_sha: hash,
    corpus_version: z.enum(["polat-multiturn-v2", "polat-claude-canary-v1"]), request_count: z.number().int().min(0).max(290), maximum_requests: z.number().int().min(1).max(290), evidence_count: z.number().int().min(0).max(1024),
    stop_reason: z.string().max(80).nullable(), reserved_liability: z.string().max(64).nullable(), currency: z.string().regex(/^[A-Z]{3}$/u).nullable(), actual_billed_amount: z.null(), financial_authority: z.literal("NONE"), execution_enabled: z.literal(false),
  })).max(100),
}).superRefine((p,c) => {
  if (p.items.length > p.page_size || p.has_more !== (p.next_cursor !== null) || !p.billing_readable && p.items.some(r => r.reserved_liability !== null || r.currency !== null)) c.addIssue({code:"custom",message:"EXPERIMENT_PROJECTION_INVALID"});
});
export type ExperimentPage = z.infer<typeof experimentPageSchema>;
const cursorSchema = z.strictObject({ v: z.literal(1), tenant: z.uuid(), user: z.uuid(), role: z.enum(["super_admin", "manager", "support", "analyst"]), size: z.number().int().min(1).max(100), anchor_time: z.string().max(64), anchor_id: z.uuid(), before_time: z.string().max(64), before_id: z.uuid(), expires: z.string().max(64) });
export function experimentCursor(raw: string) { return cursorSchema.parse(JSON.parse(raw)); }
