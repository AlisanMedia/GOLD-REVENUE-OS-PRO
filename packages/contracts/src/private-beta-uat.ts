import { z } from "zod";

const id = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
export const privateBetaConfigurationSchema = z.strictObject({
  repository_sha: z.string().regex(/^[a-f0-9]{40}$/u).nullable(), starts_at: timestamp.nullable(), expires_at: timestamp.nullable(),
  retention_days: z.number().int().min(1).max(30).nullable(), notice_version: z.literal("polat-private-beta-notice-v1"),
  primary_operator: id.nullable(), backup_operator: id.nullable(),
});
export const privateBetaWorkspaceSchema = z.strictObject({
  version: z.literal(1), mode: z.literal("PRIVATE_BETA_UAT"),
  program: z.strictObject({ id, stage: z.enum(["DRAFT", "CANARY", "FOUNDER", "FRIENDS", "STOPPED"]), generation: z.string().regex(/^[1-9][0-9]*$/u),
    repository_sha: z.string().regex(/^[a-f0-9]{40}$/u).nullable(), starts_at: timestamp.nullable(), expires_at: timestamp.nullable(), retention_days: z.number().int().min(1).max(30).nullable(), notice_version: z.string(),
    configuration_complete: z.boolean(), account_state: z.enum(["MISSING", "OBSERVED", "STALE", "BLOCKED"]), canary_state: z.enum(["NOT_STARTED", "PENDING", "REVIEW", "RECONCILED"]),
    global_requests: z.number().int().min(0).max(350), maximum_requests: z.literal(350), reserved_liability: z.string().nullable(), currency: z.literal("USD").nullable(), actual_billed_amount: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/u).nullable(), billing_status: z.enum(["UNKNOWN", "INDEPENDENTLY_RECONCILED", "ROLE_RESTRICTED"]),
    founder_limit: z.literal(20), friend_limit: z.literal(30), friend_limit_count: z.literal(10), primary_operator_configured: z.boolean(), backup_operator_configured: z.boolean(),
  }).nullable(),
  participants: z.array(z.strictObject({ id, kind: z.enum(["FOUNDER", "FRIEND"]), status: z.enum(["PENDING_NOTICE", "ACTIVE", "REVOKED"]), conversation_id: id.nullable(), joined_at: timestamp, revoked_at: timestamp.nullable(), model_requests: z.number().int().min(0).max(30), maximum_requests: z.number().int().min(20).max(30) })).max(12),
  attempts: z.array(z.strictObject({ id, scope: z.enum(["CANARY", "FOUNDER", "FRIEND"]), created_at: timestamp, status: z.enum(["RESERVED", "DISPATCH_STARTED", "SUCCEEDED", "FAILED", "UNKNOWN"]), qa: z.enum(["APPROVED", "HELD", "NOT_EVALUATED"]), input_tokens: z.number().int().nonnegative().nullable(), output_tokens: z.number().int().nonnegative().nullable(), actual_billed_amount: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/u).nullable(), billing_status: z.enum(["UNKNOWN", "INDEPENDENTLY_RECONCILED", "ROLE_RESTRICTED"]) })).max(100),
  notes: z.array(z.strictObject({ id, conversation_id: id.nullable(), scenario: z.string().max(80), outcome: z.enum(["PASS", "FAIL", "NOT_TESTED", "BLOCKED", "NOTE"]), note: z.string().max(1000), created_at: timestamp, author: z.enum(["OPERATOR", "TESTER", "SYSTEM"]) })).max(100),
  page_size: z.number().int().min(1).max(100), has_more: z.boolean(), next_cursor: z.record(z.string(), z.unknown()).nullable(), notes_has_more: z.boolean(), financial_authority: z.literal("NONE"), commercial_sales: z.literal(false),
});
export type PrivateBetaWorkspace = z.infer<typeof privateBetaWorkspaceSchema>;
export const privateBetaNotesPageSchema = z.strictObject({
  version: z.literal(1), program_id: id, program_generation: z.string().regex(/^[1-9][0-9]*$/u),
  items: privateBetaWorkspaceSchema.shape.notes, page_size: z.number().int().min(1).max(100), has_more: z.boolean(), next_cursor: z.record(z.string(), z.unknown()).nullable(),
});
export type PrivateBetaNotesPage = z.infer<typeof privateBetaNotesPageSchema>;
