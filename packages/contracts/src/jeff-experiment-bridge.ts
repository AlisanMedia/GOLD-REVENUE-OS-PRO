import { IDENTITY_WIRE_V1 } from "./historical/identity-wire-v1";
import { z } from "zod";
import { JEFF_CLAUDE_MODEL, CLAUDE_MESSAGES_API_VERSION } from "./jeff-claude-adapter";

export const jeffBridgeHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const jeffBridgeMoneySchema = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/u).refine(s => s.replace(".", "").length <= 30);
/** A persisted fixture policy is never an authenticated owner/account grant. */
export const jeffBridgeBindingSchema = z.strictObject({
  version: z.literal(1), mode: z.literal("OFFLINE_SYNTHETIC"),
  provider: z.literal("anthropic"), model: z.literal(JEFF_CLAUDE_MODEL), model_version: z.literal(JEFF_CLAUDE_MODEL), protocol_version: z.literal(CLAUDE_MESSAGES_API_VERSION),
  repository_sha: z.string().regex(/^[a-f0-9]{40}$/u), corpus_version: z.enum(["jeff-multiturn-v2", "jeff-claude-canary-v1", IDENTITY_WIRE_V1["jeff-claude-canary-v1"], IDENTITY_WIRE_V1["jeff-multiturn-v2"]]),
  corpus_hash: jeffBridgeHashSchema, plan_hash: jeffBridgeHashSchema, manifest_hash: jeffBridgeHashSchema,
  authorization_record_hash: jeffBridgeHashSchema, account_scope_hash: jeffBridgeHashSchema,
  profile_version: z.string().regex(/^[a-zA-Z0-9_.:-]{1,80}$/u),
  maximum_requests: z.number().int().min(1).max(290), maximum_spend: jeffBridgeMoneySchema, maximum_attempt_liability: jeffBridgeMoneySchema,
  currency: z.string().regex(/^[A-Z]{3}$/u), maximum_output_tokens: z.number().int().min(1).max(4096), timeout_ms: z.number().int().min(1).max(60000),
  targets: z.array(jeffBridgeHashSchema).min(1).max(290), expires_at: z.iso.datetime({ offset: true }),
  financial_authority: z.literal("NONE"), live_operations_authorized: z.literal(false), authorized_external_requests: z.literal(0), execution_enabled: z.literal(false),
}).superRefine((p,c) => {
  if (new Set(p.targets).size !== p.targets.length || p.maximum_requests > p.targets.length) c.addIssue({ code: "custom", message: "BRIDGE_TARGETS_INVALID" });
});
export type JeffBridgeBinding = z.infer<typeof jeffBridgeBindingSchema>;
export const JEFF_BRIDGE_STAGES = ["DISPATCH_STARTED", "PROVIDER_RESULT", "RESULT_UNKNOWN", "DELAYED_RESULT", "RECONCILIATION", "RUN_CANCELLED"] as const;
/** Hashes/counters only: no prompt, raw provider body, payer, credential or response text. */
export const jeffBridgeOutcomeSchema = z.strictObject({
  version: z.literal(1), evidence_id: z.uuid(), stage: z.enum(JEFF_BRIDGE_STAGES).exclude(["DISPATCH_STARTED"]),
  status: z.enum(["SUCCEEDED", "FAILED", "UNKNOWN", "INCOMPLETE", "CONFLICT", "SIMULATED_RECONCILED", "CANCELLED"]),
  response_hash: jeffBridgeHashSchema.nullable(), response_identity_hash: jeffBridgeHashSchema.nullable(),
  elapsed_ms: z.string().regex(/^(0|[1-9][0-9]{0,7})(?:\.[0-9]{1,8})?$/u).nullable(),
  input_tokens: z.number().int().min(0).max(2147483647).nullable(), output_tokens: z.number().int().min(0).max(2147483647).nullable(),
  qa: z.enum(["APPROVED", "HELD", "NOT_EVALUATED"]),
  reconciliation_hash: jeffBridgeHashSchema.nullable(), simulated_billed_amount: jeffBridgeMoneySchema.nullable(), currency: z.string().regex(/^[A-Z]{3}$/u),
  actual_billed_amount: z.null(), actual_billed_currency: z.null(), financial_authority: z.literal("NONE"), live_operations_authorized: z.literal(false),
});
export type JeffBridgeOutcome = z.infer<typeof jeffBridgeOutcomeSchema>;
export const jeffBridgeReservationSchema = z.strictObject({
  version: z.literal(1), mode: z.literal("OFFLINE_SYNTHETIC"), run_id: z.uuid(), attempt_id: z.uuid(),
  binding_hash: jeffBridgeHashSchema, request_hash: jeffBridgeHashSchema, body_hash: jeffBridgeHashSchema, target_hash: jeffBridgeHashSchema,
  ordinal: z.number().int().min(1).max(290), generation: z.string().regex(/^[1-9][0-9]{0,8}$/u),
  currency: z.string().regex(/^[A-Z]{3}$/u), liability: jeffBridgeMoneySchema, dispatch_started: z.boolean(),
  replay: z.boolean(), financial_authority: z.literal("NONE"), live_operations_authorized: z.literal(false),
});
export type JeffBridgeReservation = z.infer<typeof jeffBridgeReservationSchema>;
