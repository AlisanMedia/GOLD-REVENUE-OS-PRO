import { z } from "zod";

const revision = z.string().regex(/^(?:0|[1-9][0-9]{0,17})$/u);
const generation = z.string().regex(/^[1-9][0-9]{0,17}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const reference = z.string().regex(/^[A-Za-z0-9:_-]{3,100}$/u);
const base = {
  version: z.literal(1), mode: z.literal("SYNTHETIC"), evidence_id: z.uuid(),
  tenant_id: z.uuid(), conversation_id: z.uuid(), expected_revision: revision,
  expected_generation: generation, source_message_id: z.uuid().nullable(),
};
const event = <K extends string, P extends z.ZodType>(kind: K, payload: P) => z.strictObject({ ...base, kind: z.literal(kind), payload });
export const polatContactEventSchema = z.discriminatedUnion("kind", [
  event("SOURCE_RECORDED", z.strictObject({ organization_ref: reference, provenance_hash: hash,
    lawful_scope: z.enum(["UNKNOWN", "REQUESTED_SUPPORT_FIXTURE", "MARKETING_FIXTURE"]),
    basis: z.enum(["UNKNOWN", "EXPLICIT_REQUEST_FIXTURE", "CONSENT_FIXTURE"]), retention_policy_ref: reference.nullable() })),
  event("MARKETING_GRANTED", z.strictObject({ expires_at: z.iso.datetime({ offset: true }), timezone: z.string().min(1).max(80), window_start: z.number().int().min(0).max(23), window_end: z.number().int().min(1).max(24) })),
  event("MARKETING_REVOKED", z.strictObject({ reason: z.enum(["OWNER_REVIEW", "CONSENT_EXPIRED", "CUSTOMER_REQUEST"]) })),
  event("OPT_OUT_RECORDED", z.strictObject({ origin: z.literal("CURRENT_CUSTOMER_REQUEST") })),
  event("CONTACT_SUPPRESSED", z.strictObject({ reason: z.enum(["SAFETY", "CUSTOMER_REQUEST", "UNKNOWN_SCOPE"]) })),
  event("SUPPORT_REQUEST_RECORDED", z.strictObject({ origin: z.literal("CURRENT_CUSTOMER_REQUEST") })),
  event("HUMAN_REQUESTED", z.strictObject({ origin: z.literal("CURRENT_CUSTOMER_REQUEST") })),
  event("HUMAN_ACKNOWLEDGED", z.strictObject({ origin: z.literal("AUTHORIZED_FIXTURE_OPERATOR") })),
  event("AI_PAUSED", z.strictObject({ origin: z.literal("AUTHORIZED_FIXTURE_OPERATOR") })),
  event("AI_RESUMED", z.strictObject({ origin: z.literal("AUTHORIZED_FIXTURE_OPERATOR") })),
  event("OFFER_PRESENTED", z.strictObject({ offer_id: z.uuid(), draft_id: z.uuid(), snapshot_hash: hash })),
]);
export type PolatContactEvent = z.infer<typeof polatContactEventSchema>;
export const polatContactReceiptSchema = z.strictObject({ version: z.literal(1), mode: z.literal("SYNTHETIC"), tenant_id: z.uuid(), conversation_id: z.uuid(), evidence_id: z.uuid(), revision, generation,
  kind: z.enum(["SOURCE_RECORDED", "MARKETING_GRANTED", "MARKETING_REVOKED", "OPT_OUT_RECORDED", "CONTACT_SUPPRESSED", "SUPPORT_REQUEST_RECORDED", "HUMAN_REQUESTED", "HUMAN_ACKNOWLEDGED", "AI_PAUSED", "AI_RESUMED", "OFFER_PRESENTED"]),
  evidence_hash: hash, commit_state: z.literal("FIXTURE_RECORDED"), financial_authority: z.literal("NONE"), live_operations_authorized: z.literal(false) });
export const polatContactSnapshotSchema = z.strictObject({ version: z.literal(1), mode: z.literal("SYNTHETIC"), revision, generation,
  lawful_scope: z.enum(["UNKNOWN", "REQUESTED_SUPPORT_FIXTURE", "MARKETING_FIXTURE"]), provenance_known: z.boolean(), marketing_granted: z.boolean(), marketing_expires_at: z.iso.datetime({ offset: true }).nullable(),
  opted_out: z.boolean(), suppressed: z.boolean(), ownership: z.enum(["AI_ACTIVE", "HUMAN_ACTIVE", "PAUSED"]), human_acknowledged: z.boolean(),
  financial_authority: z.literal("NONE"), live_operations_authorized: z.literal(false) });
export type PolatContactSnapshot = z.infer<typeof polatContactSnapshotSchema>;
export const polatContactTicketSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("REVIEW"), financial_authority: z.literal("NONE"), live_operations_authorized: z.literal(false) }),
  z.strictObject({ state: z.literal("FAKE_ELIGIBLE"), revision, generation, financial_authority: z.literal("NONE"), live_operations_authorized: z.literal(false) }),
]);
export const polatContactCursorSchema = z.strictObject({ v: z.literal(1), tenant: z.uuid(), user: z.uuid(), role: z.enum(["super_admin", "manager", "support", "analyst"]), conversation: z.uuid(), size: z.number().int().min(1).max(100), revision, generation, before: generation, expires: z.iso.datetime({ offset: true }) });
export const polatContactPageSchema = z.strictObject({ version: z.literal(1), mode: z.literal("SYNTHETIC"),
  items: z.array(z.strictObject({ revision, kind: polatContactReceiptSchema.shape.kind, created_at: z.iso.datetime({ offset: true }), actor: z.enum(["SOURCE", "OPERATOR"]), organization_ref: reference.nullable() })).max(100),
  snapshot: polatContactSnapshotSchema, page_size: z.number().int().min(1).max(100), has_more: z.boolean(), next_cursor: polatContactCursorSchema.nullable(), financial_authority: z.literal("NONE"), live_operations_authorized: z.literal(false),
}).superRefine((v,c) => { if (v.items.length > v.page_size || v.has_more !== (v.next_cursor !== null)) c.addIssue({ code: "custom", message: "POLAT_CONTACT_PAGE_INCONSISTENT" }); });
