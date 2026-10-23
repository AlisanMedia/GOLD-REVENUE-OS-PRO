import { z } from "zod";
import { financialSourceContractSchema, financialAssessmentContextSchema, financialHistoryRecordSchema } from "./financial-source";

const time = z.iso.datetime({ offset: true });
const version = z.number().int().min(1).max(2147483647);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const fixtureRef = z.string().regex(/^fixture:[A-Za-z0-9:._-]{1,120}$/u);
export const signalCommercialJourneySchema = z.object({
 version: z.literal(1), mode: z.literal("SYNTHETIC"), evaluated_at: time, tenant_id: z.uuid(), customer_id: z.uuid(),
 checkout: z.object({ channel: z.enum(["telegram_stars","external_crypto"]).nullable(), surface: z.enum(["telegram_bot","telegram_mini_app","independent_web"]).nullable() }).strict(),
 offer: z.object({ id: z.uuid(), tenant_id: z.uuid(), customer_id: z.uuid(), state: z.enum(["APPROVED","DRAFT","EXPIRED","REVOKED"]),
  product_version_id: z.uuid(), plan_version_id: z.uuid(), snapshot_hash: hash, expires_at: time }).strict().nullable(),
 payment: z.object({ source: financialSourceContractSchema, context: financialAssessmentContextSchema, history: z.array(financialHistoryRecordSchema).max(64) }).strict().nullable(),
 subscription: z.object({ id: z.uuid(), tenant_id: z.uuid(), customer_id: z.uuid(), invoice_id: z.uuid(), offer_id: z.uuid(), mode: z.literal("test"),
  state: z.enum(["ACTIVE","RENEWAL_DUE","EXPIRED","HOLD","SUSPENDED","CANCELLED"]), starts_at: time, ends_at: time, grace_until: time,
  revision: version, source_revision: version, offer_snapshot_hash: hash,
  terms: z.object({ duration_unit: z.enum(["calendar_month","calendar_year","fixed_days"]), duration_count: z.number().int(), grace_days: z.number().int(), grace_approved: z.boolean(), renewal_notice_days: z.number().int() }).strict(),
 }).strict().nullable(),
 membership: z.object({ tenant_id: z.uuid(), customer_id: z.uuid(), subscription_id: z.uuid(), destination_id: z.uuid(), binding_id: z.uuid(),
  binding_state: z.enum(["VERIFIED_FIXTURE","UNKNOWN","REVOKED"]), state: z.enum(["FAKE_CONFIRMED","PENDING","UNKNOWN","REVOKED","RESTRICTED"]),
  observed_at: time, max_age_seconds: z.number().int().min(1).max(300), revision: version, source_revision: version,
 }).strict().nullable(),
 route: z.object({ tenant_id: z.uuid(), provider_id: z.uuid(), destination_id: z.uuid(), revision: version, source_revision: version,
  authorization: z.enum(["SYNTHETIC_APPROVED","UNVERIFIED","REVOKED"]), rights_reference: fixtureRef.nullable(), paused: z.boolean(),
 }).strict(),
 controls: z.object({ fixture_admission_enabled: z.boolean(), live_enabled: z.literal(false) }).strict(),
}).strict();
export type SignalCommercialJourney = z.infer<typeof signalCommercialJourneySchema>;

// Metadata contract only; no contact list, identity, import or messaging function.
export const reactivationReviewSchema = z.object({
 version: z.literal(1), mode: z.literal("SYNTHETIC"), tenant_id: z.uuid(), evaluated_at: time,
 source_organization: fixtureRef, provenance_hash: hash, source_kind: z.enum(["SUPPLIER_PORTFOLIO","EXISTING_CUSTOMER_RECORD","ANONYMOUS_FEEDBACK"]),
 tenant_ownership: z.enum(["REVIEWED_FIXTURE","UNKNOWN","DENIED"]), purpose: z.literal("REACTIVATION_PREVIEW"),
 data_use_rights: z.enum(["REVIEWED_FIXTURE","UNKNOWN","DENIED"]), data_use_reference: fixtureRef.nullable(),
 lawful_basis: z.enum(["CONSENT","OTHER_REVIEWED_BASIS","UNKNOWN"]), lawful_basis_reference: fixtureRef.nullable(),
 jurisdiction_review: z.enum(["REVIEWED_FIXTURE","UNKNOWN"]), marketing_permission: z.enum(["VERIFIED_FIXTURE","UNKNOWN","DENIED"]),
 marketing_scope: z.array(z.enum(["TELEGRAM_REACTIVATION","EMAIL_REACTIVATION"])).max(2), marketing_reference: fixtureRef.nullable(),
 channel: z.enum(["TELEGRAM","EMAIL"]), contactability: z.enum(["ALLOWED_FIXTURE","UNKNOWN","BLOCKED"]),
 suppressed: z.boolean(), opted_out: z.boolean(), takeover: z.boolean(), open_escalation: z.boolean(),
 retention_until: time.nullable(), legal_hold: z.boolean(), permission_expires_at: time.nullable(),
 history_complete: z.boolean(), recent_contacts: z.number().int().min(0).max(10000), max_contacts: z.number().int().min(1).max(10).nullable(),
 timezone: z.string().min(1).max(80).nullable(), window_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).nullable(), window_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).nullable(),
}).strict();
export type ReactivationReview = z.infer<typeof reactivationReviewSchema>;
