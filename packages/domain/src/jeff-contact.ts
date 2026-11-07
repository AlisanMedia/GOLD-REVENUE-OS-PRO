import { createHash } from "node:crypto";
import { jeffContactEventSchema, jeffContactReceiptSchema, jeffContactSnapshotSchema } from "@gold-revenue-os/contracts";
import { canonicalFinancialJson } from "./financial-source-canonical";

// Pure contracts are not consent, legal approval, persistence or financial authority.
export function jeffContactCommandHash(raw: unknown) {
  return createHash("sha256").update(canonicalFinancialJson(jeffContactEventSchema.parse(raw)), "utf8").digest("hex");
}
export function assessJeffContact(input: { snapshot: unknown; expectedRevision: string; expectedGeneration: string; purpose: "MARKETING" | "REQUESTED_SUPPORT"; currentSource: boolean; contactable: boolean; openEscalation: boolean; now: string }) {
  const s = jeffContactSnapshotSchema.parse(input.snapshot), reasons: string[] = [];
  if (!Number.isFinite(Date.parse(input.now))) throw Error("JEFF_CONTACT_CLOCK_INVALID");
  if (s.revision !== input.expectedRevision || s.generation !== input.expectedGeneration) reasons.push("CONTACT_OR_OWNER_CHANGED");
  if (!s.provenance_known || s.lawful_scope === "UNKNOWN") reasons.push("CONTACT_SCOPE_UNKNOWN");
  if (!input.currentSource || !input.contactable || s.suppressed) reasons.push("CONTACT_SUPPRESSED");
  if (s.ownership !== "AI_ACTIVE" || input.openEscalation) reasons.push("HUMAN_REVIEW_ACTIVE");
  if (input.purpose === "MARKETING" && (s.lawful_scope !== "MARKETING_FIXTURE" || !s.marketing_granted || s.opted_out || s.marketing_expires_at === null || Date.parse(s.marketing_expires_at) <= Date.parse(input.now))) reasons.push("MARKETING_NOT_AUTHORIZED");
  return { state: reasons.length ? "REVIEW" : "FAKE_ELIGIBLE", reasons: [...new Set(reasons)], purpose: input.purpose, transport: "FAKE_ONLY", financial_authority: "NONE", live_operations_authorized: false } as const;
}
export function jeffRecordedOptOut(raw: unknown, expected: { tenantId: string; conversationId: string; evidenceId: string; revision: string }, locale: "en" | "tr") {
  const r = jeffContactReceiptSchema.parse(raw);
  if (r.tenant_id !== expected.tenantId || r.conversation_id !== expected.conversationId || r.evidence_id !== expected.evidenceId || r.revision !== expected.revision || r.kind !== "OPT_OUT_RECORDED") throw Error("JEFF_CONTACT_RECEIPT_SCOPE");
  return { text: locale === "tr" ? "Pazarlama mesajı istemediğin kaydedildi." : "Your marketing opt-out is recorded.", classification: "SYNTHETIC_RECEIPT_PREVIEW", delivery: "NOT_SENT", financial_authority: "NONE" } as const;
}
