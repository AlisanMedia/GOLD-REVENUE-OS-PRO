import { z } from "zod";

export const CAMPAIGN_STATES = ["CONFIGURING", "READY", "ACTIVE", "PAUSED", "STOPPED"] as const;
export const campaignStateSchema = z.enum(CAMPAIGN_STATES);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const positiveDecimal = z.string().regex(/^(?:0|[1-9][0-9]{0,8})\.[0-9]{6}$/u)
  .refine(v => BigInt(v.replace(".", "")) > 0n);
const markets = z.array(z.string().regex(/^[A-Z]{2}$/u)).min(1).max(100)
  .refine(v => new Set(v).size === v.length && !v.includes("TR"));

/** A founder declaration is provenance, not independently verified individual consent. */
export const campaignPermissionSchema = z.strictObject({
  version: z.literal(1), classification: z.literal("OWNER_ATTESTED_EXISTING_PERMISSION"),
  batch_id: z.uuid(), dataset_version: z.string().min(1).max(80), dataset_hash: hash,
  source: z.string().min(1).max(160), channel: z.enum(["TELEGRAM_BOT", "TELEGRAM_BUSINESS"]),
  markets, purpose: z.literal("SIGNAL_SERVICE_MARKETING"), reference: z.string().min(1).max(160),
});
export const campaignConfigurationSchema = z.strictObject({
  version: z.literal(1), name: z.string().trim().min(1).max(120),
  mode: z.enum(["SYNTHETIC", "COMMERCIAL"]), batch_id: z.uuid(), plan_version_id: z.uuid(),
  markets, default_language: z.literal("en"),
  starts_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
  maximum_messages: z.number().int().min(1).max(1_000_000),
  maximum_per_customer: z.number().int().min(1).max(100),
  maximum_per_day: z.number().int().min(1).max(50),
  minimum_interval_seconds: z.number().int().min(60).max(2_592_000),
  follow_up_after_seconds: z.number().int().min(60).max(2_592_000),
  maximum_model_calls: z.number().int().min(1).max(1_000_000),
  budget_currency: z.literal("USD"), budget_amount: positiveDecimal,
  maximum_liability_per_call: positiveDecimal,
  maximum_output_tokens: z.number().int().min(1).max(4096),
  timezone: z.string().min(1).max(80), window_start: z.number().int().min(0).max(23),
  window_end: z.number().int().min(0).max(23),
}).superRefine((v, ctx) => {
  if (Date.parse(v.expires_at) <= Date.parse(v.starts_at)) ctx.addIssue({ code: "custom", message: "CAMPAIGN_WINDOW" });
  if (v.window_start === v.window_end) ctx.addIssue({ code: "custom", message: "CAMPAIGN_CONTACT_WINDOW" });
  try { new Intl.DateTimeFormat("en", { timeZone: v.timezone }).format(); }
  catch { ctx.addIssue({ code: "custom", message: "CAMPAIGN_TIMEZONE" }); }
  if (BigInt(v.maximum_liability_per_call.replace(".", "")) > BigInt(v.budget_amount.replace(".", "")))
    ctx.addIssue({ code: "custom", message: "CAMPAIGN_LIABILITY" });
});
export type CampaignConfiguration = z.infer<typeof campaignConfigurationSchema>;
export const campaignSummarySchema = z.strictObject({
  id: z.uuid(), name: z.string(), state: campaignStateSchema, mode: z.enum(["SYNTHETIC", "COMMERCIAL"]),
  revision: z.number().int().positive(), configuration: campaignConfigurationSchema,
  blockers: z.array(z.string()).max(30), imported: z.number().int().nonnegative(),
  eligible: z.number().int().nonnegative(), reachable: z.number().int().nonnegative(),
  active_conversations: z.number().int().nonnegative(), awaiting_responses: z.number().int().nonnegative(),
  scheduled: z.number().int().nonnegative(), unknown: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(), suppressed: z.number().int().nonnegative(),
  interested: z.number().int().nonnegative(), pending_payments: z.number().int().nonnegative(),
  verified_sales: z.number().int().nonnegative(), active_vip: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(), reserved_liability: z.string(),
  revenue: z.null(), actual_cost: z.null(), financial_authority: z.literal("NONE"),
  live_dispatch_enabled: z.literal(false),
});
export const campaignWorkspaceSchema = z.strictObject({
  items: z.array(campaignSummarySchema).max(25),
  next_after: z.uuid().nullable(),
});
export type CampaignWorkspace = z.infer<typeof campaignWorkspaceSchema>;
export const campaignOptionsSchema = z.strictObject({
  batches: z.array(z.strictObject({ id: z.uuid(), source: z.string(), unique_customers: z.number().int().nonnegative() })).max(100),
  plans: z.array(z.strictObject({ id: z.uuid(), title: z.string(), amount: z.string(), currency: z.string(), test_only: z.boolean() })).max(100),
});
export type CampaignOptions = z.infer<typeof campaignOptionsSchema>;
