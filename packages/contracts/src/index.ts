import { z } from "zod";

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
