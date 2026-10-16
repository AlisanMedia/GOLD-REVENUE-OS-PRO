import { describe, expect, it } from "vitest";
import { ESCALATION_SEVERITIES, escalationNotificationSchema, escalationSafeResponses, managerNotificationText } from "./escalations";

const job = { id: "12000000-0000-4000-8000-000000000001", tenant_id: "12000000-0000-4000-8000-000000000002", case_id: "12000000-0000-4000-8000-000000000003", lease_token: "12000000-0000-4000-8000-000000000004", attempt: 1, chat_id: "12345", bot_id: "99999", severity: "HIGH" as const, category: "payment_dispute" as const, customer_id: null, waiting_seconds: 20 };
describe("Escalation presentation authority", () => {
  it("represents all four priorities without turning an ordinary question into a payment fact", () => {
    expect(ESCALATION_SEVERITIES).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    expect(escalationNotificationSchema.parse(job).category).toBe("payment_dispute");
  });
  it("uses short truthful EN/TR/AR/RU holds with no completed-contact or financial claim", () => {
    expect(Object.keys(escalationSafeResponses)).toEqual(["en", "tr", "ar", "ru"]);
    for (const text of Object.values(escalationSafeResponses)) expect(text.length).toBeLessThan(150);
    expect(escalationSafeResponses.en).toBe("I cannot verify this here. This needs human review.");
    expect(Object.values(escalationSafeResponses).join(" ")).not.toMatch(/notified|contacted|refund approved|payment verified|erişim.*aktif|уведомлен|تم إبلاغ/iu);
  });
  it("excludes raw customer content and rejects an injected app origin", () => {
    const text = managerNotificationText(job, "https://example.test");
    expect(text).toContain(`/admin/attention/${job.case_id}`);
    expect(text).toContain("Waiting: 20s"); expect(text).toContain("Unmatched");
    for (const origin of ["http://example.test", "https://user:pass@example.test", "https://example.test/?token=secret"]) expect(() => managerNotificationText(job, origin)).toThrow();
  });
  it("rejects the existing VIP destination and technical bot, malformed scopes and excessive attempts", () => {
    for (const v of [{ chat_id: "-1003944824067" }, { bot_id: "8673054837" }, { tenant_id: "wrong" }, { attempt: 6 }]) expect(escalationNotificationSchema.safeParse({ ...job, ...v }).success).toBe(false);
  });
});
