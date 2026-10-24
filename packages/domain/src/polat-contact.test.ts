import { describe, expect, it } from "vitest";
import { polatContactEventSchema, type PolatContactSnapshot } from "@gold-revenue-os/contracts";
import { assessPolatContact, polatContactCommandHash, polatRecordedOptOut } from "./polat-contact";
const id = "11111111-1111-4111-8111-111111111111";
const event = { version: 1, mode: "SYNTHETIC", evidence_id: id, tenant_id: id, conversation_id: id, expected_revision: "0", expected_generation: "1", source_message_id: id, kind: "SOURCE_RECORDED", payload: { organization_ref: "fixture:organization", provenance_hash: "a".repeat(64), lawful_scope: "REQUESTED_SUPPORT_FIXTURE", basis: "EXPLICIT_REQUEST_FIXTURE", retention_policy_ref: null } };
const snapshot: PolatContactSnapshot = { version: 1, mode: "SYNTHETIC", revision: "1", generation: "2", lawful_scope: "REQUESTED_SUPPORT_FIXTURE", provenance_known: true, marketing_granted: false, marketing_expires_at: null, opted_out: true, suppressed: false, ownership: "AI_ACTIVE", human_acknowledged: false, financial_authority: "NONE", live_operations_authorized: false };
const check = (s: PolatContactSnapshot, purpose: "MARKETING" | "REQUESTED_SUPPORT" = "REQUESTED_SUPPORT") => assessPolatContact({ snapshot: s, expectedRevision: "1", expectedGeneration: "2", purpose, currentSource: true, contactable: true, openEscalation: false, now: "2026-10-24T12:00:00Z" });
describe("fixture contact/ownership evidence contracts", () => {
  it("uses canonical identity without changing opaque organization references", () => {
    expect(polatContactCommandHash(event)).toBe(polatContactCommandHash({ ...event, payload: { ...event.payload } }));
    expect(polatContactCommandHash(event)).not.toBe(polatContactCommandHash({ ...event, payload: { ...event.payload, organization_ref: "Fixture:Organization" } }));
  });
  it.each([{ mode: "LIVE" }, { verified: true }, { financial_authority: "LIVE" }, { expected_generation: "0" }, { raw_callback: "forbidden" }])("rejects authority/extra fields %j", patch => expect(() => polatContactEventSchema.parse({ ...event, ...patch })).toThrow());
  it("separates a requested support reply from marketing permission", () => {
    expect(check(snapshot).state).toBe("FAKE_ELIGIBLE");
    expect(check(snapshot, "MARKETING").state).toBe("REVIEW");
  });
  it.each([{ lawful_scope: "UNKNOWN" }, { provenance_known: false }, { suppressed: true }, { generation: "3" }, { revision: "2" }, { ownership: "HUMAN_ACTIVE", human_acknowledged: true }, { ownership: "PAUSED" }] as const)("fails closed on stale/unknown contact or ownership %j", patch => expect(check({ ...snapshot, ...patch }).state).toBe("REVIEW"));
  it("requires explicit current, unexpired fixture marketing scope", () => {
    const s = { ...snapshot, lawful_scope: "MARKETING_FIXTURE" as const, opted_out: false, marketing_granted: true, marketing_expires_at: "2026-10-25T12:00:00Z" };
    expect(check(s, "MARKETING").state).toBe("FAKE_ELIGIBLE");
    expect(check({ ...s, opted_out: true }, "MARKETING").state).toBe("REVIEW");
    expect(check({ ...s, marketing_expires_at: null }, "MARKETING").state).toBe("REVIEW");
    expect(check({ ...s, marketing_expires_at: "2026-10-24T11:00:00Z" }, "MARKETING").state).toBe("REVIEW");
    expect(check(s, "MARKETING").financial_authority).toBe("NONE");
  });
  it("only previews a saved-opt-out statement from a matching fixture receipt", () => {
    const r = { version: 1, mode: "SYNTHETIC", tenant_id: id, conversation_id: id, evidence_id: id, revision: "1", generation: "2", kind: "OPT_OUT_RECORDED", evidence_hash: "a".repeat(64), commit_state: "FIXTURE_RECORDED", financial_authority: "NONE", live_operations_authorized: false };
    const bound = { tenantId: id, conversationId: id, evidenceId: id, revision: "1" };
    expect(polatRecordedOptOut(r, bound, "en").delivery).toBe("NOT_SENT");
    expect(polatRecordedOptOut(r, bound, "tr").text).toContain("kaydedildi");
    expect(() => polatRecordedOptOut({ ...r, commit_state: "PENDING" }, bound, "en")).toThrow();
    expect(() => polatRecordedOptOut(r, { ...bound, revision: "2" }, "en")).toThrow();
  });
});
