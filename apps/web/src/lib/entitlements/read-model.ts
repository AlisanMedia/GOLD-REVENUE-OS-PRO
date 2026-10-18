import { z } from "zod";

export const entitlementCollection = z.enum(["subscriptions", "access", "payments", "jobs", "audit"]);
export type EntitlementCollection = z.infer<typeof entitlementCollection>;
const time = z.iso.datetime({ offset: true });
const mode = z.enum(["test", "live"]);
const accessState = z.enum(["PENDING", "INVITED", "MEMBER", "REVOKED", "REVIEW"]);
export const subscriptionRow = z.strictObject({
  id: z.uuid(), customer_id: z.uuid(), plan_version_id: z.uuid(), mode,
  state: z.enum(["ACTIVE", "RENEWAL_DUE", "EXPIRED", "HOLD", "SUSPENDED", "CANCELLED"]),
  starts_at: time, ends_at: time, grace_until: time, renewal_due_at: time, created_at: time,
  revision: z.number().int().positive(), has_payment: z.boolean(), access_status: accessState.nullable(),
  plan_snapshot: z.strictObject({ title: z.string().max(160).nullable(),
    duration_unit: z.enum(["fixed_days", "calendar_month", "calendar_year"]).nullable(),
    duration_count: z.number().nullable(), grace_days: z.number().nullable(), renewal_notice_days: z.number().nullable() }),
});
export const accessRow = z.strictObject({
  id: z.uuid(), subscription_id: z.uuid(), customer_id: z.uuid(), mode, status: accessState,
  telegram_user_id: z.string().max(32).nullable(), chat_id: z.string().max(64).nullable(),
  invite_reference: z.string().max(512).nullable(), invite_present: z.boolean(),
  invite_expires_at: time.nullable(), membership_checked_at: time.nullable(),
});
export const paymentRow = z.strictObject({
  id: z.uuid(), subscription_id: z.uuid(), mode, event_id: z.uuid().nullable(),
  test_invoice_id: z.uuid().nullable(), receipt_id: z.uuid().nullable(), period_start: time, period_end: time,
});
export const jobRow = z.strictObject({
  id: z.uuid(), access_id: z.uuid(), subscription_id: z.uuid(), operation: z.enum(["invite", "join", "revoke", "reconcile"]),
  status: z.enum(["PENDING", "RUNNING", "DONE", "FAILED", "STALE"]), attempts: z.number().int().nonnegative(),
  available_at: time, last_error: z.enum(["PROVIDER_FAILURE", "DETAILS_RESTRICTED"]).nullable(),
});
export const auditRow = z.strictObject({
  id: z.uuid(), subscription_id: z.uuid(), action: z.string().max(80), mode, created_at: time,
  details: z.strictObject({ operation: z.enum(["invite", "join", "revoke", "reconcile"]).optional(), attempt: z.number().int().nonnegative().optional() }),
});
export const entitlementCursor = z.strictObject({
  version: z.literal(1), scope: z.string().regex(/^[a-f0-9]{64}$/u), started_at: time,
  after_id: z.uuid(), after_time: time.nullable(), anchor_id: z.uuid(), anchor_time: time.nullable(),
});
export type EntitlementCursor = z.infer<typeof entitlementCursor>;
export function entitlementPageSchema<T extends z.ZodType>(row: T) {
  return z.strictObject({ version: z.literal(1), collection: entitlementCollection, observed_at: time, started_at: time,
    page_size: z.number().int().min(1).max(100), items: z.array(row).max(100), has_more: z.boolean(),
    consistency: z.literal("LIVE_KEYSET_REFRESH_FOR_CHANGES"), next_cursor: entitlementCursor.nullable(),
  }).refine(p => p.items.length <= p.page_size && p.has_more === (p.next_cursor !== null));
}
export type EntitlementPage<T> = {
  version: 1; collection: EntitlementCollection; observed_at: string; started_at: string; page_size: number;
  items: T[]; has_more: boolean; consistency: "LIVE_KEYSET_REFRESH_FOR_CHANGES"; next_cursor: EntitlementCursor | null;
};
export const rowSchemas = { subscriptions: subscriptionRow, access: accessRow, payments: paymentRow, jobs: jobRow, audit: auditRow };
export type EntitlementRows = { [K in EntitlementCollection]: z.infer<(typeof rowSchemas)[K]> };
export const subscriptionDetailSchema = z.strictObject({
  version: z.literal(1), observed_at: time, subscription: subscriptionRow, access: accessRow.nullable(),
  plan_terms: z.strictObject({ locale: z.enum(["en","tr","ar","ru"]).nullable(), amount: z.string().max(19).nullable(), currency: z.string().regex(/^[A-Z]{3}$/u).nullable(),
    billing: z.enum(["one_off","recurring","unknown"]).nullable(), terms: z.string().max(1200).nullable(), tax_rule: z.string().max(300).nullable(),
    renewal_rule: z.string().max(300).nullable(), cancellation_rule: z.string().max(300).nullable(),
    inclusions: z.array(z.string().max(300)).max(12), restrictions: z.array(z.string().max(300)).max(12), disclosures: z.array(z.string().max(300)).max(12) }),
});
export const entitlementSearchSchema = z.object({
  cursor: z.string().min(1).max(1500).regex(/^[A-Za-z0-9_-]+$/u).optional(),
  size: z.enum(["25", "50", "100"]).default("25"), customer: z.uuid().optional(),
  evidence: z.enum(["payments", "jobs", "audit", "access"]).default("audit"), error: z.string().max(80).optional(),
});
export type EntitlementSearch = z.infer<typeof entitlementSearchSchema>;
// Navigation data, not a bearer credential. SQL independently checks scope/rows.
export function decodeEntitlementCursor(value: string): EntitlementCursor {
  if (!/^[A-Za-z0-9_-]{1,1500}$/u.test(value)) throw new Error("ENTITLEMENT_CURSOR_INVALID");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error("ENTITLEMENT_CURSOR_INVALID");
  return entitlementCursor.parse(JSON.parse(bytes.toString("utf8")) as unknown);
}
export function encodeEntitlementCursor(value: EntitlementCursor): string {
  return Buffer.from(JSON.stringify(entitlementCursor.parse(value))).toString("base64url");
}
export function entitlementHref(path: string, input: { size: string; customer?: string | undefined; evidence?: string | undefined; cursor?: EntitlementCursor | null | undefined }): string {
  const params = new URLSearchParams({ size: input.size });
  if (input.customer) params.set("customer", z.uuid().parse(input.customer));
  if (input.evidence) params.set("evidence", entitlementSearchSchema.shape.evidence.parse(input.evidence));
  if (input.cursor) params.set("cursor", encodeEntitlementCursor(input.cursor));
  return path + "?" + params.toString();
}
