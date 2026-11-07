import { z } from "zod";

export * from "./financial-source";
export * from "./financial-evidence";
export * from "./signals";

export const APP_ROLES = ["super_admin", "manager", "support", "analyst", "readonly"] as const;
export const appRoleSchema = z.enum(APP_ROLES);
export type AppRole = z.infer<typeof appRoleSchema>;

export const tenantSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  slug: z.string().min(2).max(80),
  role: appRoleSchema,
});

export const meResponseSchema = z.object({
  user: z.object({ id: z.uuid(), email: z.email().nullable() }),
  tenants: z.array(tenantSummarySchema),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string(),
  }),
});

export type TenantSummary = z.infer<typeof tenantSummarySchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;

export const customerStates = [
  "NEW", "CONTACT_READY", "CONTACTED", "REPLIED", "QUALIFIED", "OFFER_SENT",
  "INTERESTED", "NOT_INTERESTED", "SURVEY_OFFERED", "SURVEY_COMPLETED",
  "TRIAL_ACTIVE", "PAYMENT_PENDING", "PAID", "ACCESS_GRANTED", "ACTIVE",
  "RENEWAL_DUE", "RENEWED", "EXPIRED", "CHURNED", "WINBACK",
] as const;

export const customerStateSchema = z.enum(customerStates);

export const stateTransitionRequestSchema = z.object({
  expected_from_state: customerStateSchema,
  to_state: customerStateSchema,
  reason_code: z.string().trim().min(1).max(120),
  correlation_id: z.uuid(),
  causation_id: z.uuid().nullable().optional(),
  triggering_event: z.string().trim().min(1).max(160),
  triggering_event_id: z.uuid().nullable().optional(),
  idempotency_key: z.string().trim().min(1).max(240),
  occurred_at: z.iso.datetime({ offset: true }).optional(),
}).strict();

export const stateTransitionResponseSchema = z.object({
  attempt_id: z.uuid().optional(),
  accepted: z.boolean(),
  result: z.enum(["accepted", "rejected"]),
  rejection_code: z.string().nullable().optional(),
  customer_id: z.uuid().optional(),
  from_state: customerStateSchema.optional(),
  to_state: customerStateSchema.optional(),
  correlation_id: z.uuid(),
  event_id: z.uuid().nullable().optional(),
  history_id: z.uuid().nullable().optional(),
});

export type StateTransitionRequest = z.infer<typeof stateTransitionRequestSchema>;
export type StateTransitionResponse = z.infer<typeof stateTransitionResponseSchema>;

export * from "./signal-commerce";
export * from "./signal-distribution";

export * from "./signal-recovery";

export * from "./signal-parser";

export * from "./signal-wave";

export * from "./signal-review";
export * from "./jeff-conversation";
export * from "./jeff-response";

export * from "./jeff-sales";
export * from "./campaign";

export * from "./jeff-operations";

export * from "./jeff-runtime";
export * from "./jeff-contact";
export * from "./private-beta-uat";

export * from "./jeff-model-evaluation";

export * from "./jeff-human-review";

export * from "./jeff-model-acceptance";

export * from "./jeff-experiment-guard";
export * from "./jeff-claude-adapter";
export * from "./jeff-openai-adapter";
export * from "./jeff-experiment-bridge";
export * from "./jeff-campaign-execution";

export { IDENTITY_DOMAINS_V1 } from "./historical/identity-domains-v1";
export * from "./jeff-identity";
export { IDENTITY_NAMES_V1 } from "./historical/identity-names-v1";

export { IDENTITY_WIRE_V1, currentIdentityTag } from "./historical/identity-wire-v1";
