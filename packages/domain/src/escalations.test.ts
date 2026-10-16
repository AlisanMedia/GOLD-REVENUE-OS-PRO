import { describe, expect, it } from "vitest";
import { ESCALATION_SEVERITIES, escalationCategoryLabels, escalationSeverityLabels, escalationDuration, escalationNotificationSchema, escalationSafeResponses, managerNotificationText } from "./escalations";
import { inferStyleProfile } from "./conversation-quality";

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
    expect(text).toContain("Bekleme süresi: 1 dakikadan az"); expect(text).not.toContain("Unmatched");
    for (const origin of ["http://example.test", "https://user:pass@example.test", "https://example.test/?token=secret", "https://example.test/#x", "https://example.test/path", `https://${"a".repeat(301)}.test`]) expect(() => managerNotificationText(job, origin)).toThrow();
  });
  it("rejects the existing VIP destination and technical bot, malformed scopes and excessive attempts", () => {
    for (const v of [{ chat_id: "-1003944824067" }, { bot_id: "8673054837" }, { tenant_id: "wrong" }, { attempt: 6 }]) expect(escalationNotificationSchema.safeParse({ ...job, ...v }).success).toBe(false);
  });
  it.each(Object.entries(escalationCategoryLabels))("renders %s as Turkish without customer data or invented actions", (category, label) => {
    const parsed = escalationNotificationSchema.parse({ ...job, category, customer_id: "12000000-0000-4000-8000-000000000099", raw_message: "PRIVATE CUSTOMER TEXT" });
    const text = managerNotificationText(parsed, "https://example.test");
    expect(text).toContain(`Konu: ${label}`);
    expect(text).not.toContain(category); expect(text).not.toContain(parsed.customer_id); expect(text).not.toContain("PRIVATE CUSTOMER TEXT");
    expect(text).not.toMatch(/ödeme.*doğrulandı|iade.*onaylandı|erişim.*açıldı|yönetici.*atandı|yapay zekâ.*duraklatıldı/iu);
    expect(text.split("\n")[0]).toBe("GOLD REVENUE OS");
    expect(text).toContain("STAGING · TEST BİLDİRİMİ"); expect(text).toContain("Vaka: GR-12000000");
    expect(text.match(/https:\/\//gu)).toHaveLength(1); expect(text.length).toBeLessThan(1000);
    expect(text.replace(`https://example.test/admin/attention/${job.case_id}`, "")).not.toContain(job.case_id);
  });
  it.each(ESCALATION_SEVERITIES)("translates %s while preserving the enum", severity => {
    const parsed = escalationNotificationSchema.parse({ ...job, severity, waiting_seconds: Number.MAX_SAFE_INTEGER });
    expect(parsed.severity).toBe(severity);
    expect(managerNotificationText(parsed, "https://example.test")).toContain(`Öncelik: ${escalationSeverityLabels[severity]}`);
    expect(managerNotificationText(parsed, "https://example.test").length).toBeLessThan(1000);
  });
  it.each([[0, "1 dakikadan az"], [60, "1 dakika"], [3599, "59 dakika"], [3660, "1 saat 1 dakika"], [90000, "1 gün 1 saat"]])("formats %s seconds without technical units", (seconds, expected) => {
    expect(escalationDuration(Number(seconds))).toBe(expected);
  });
  it("rejects dynamic markup/category injection rather than interpreting customer text", () => {
    expect(() => managerNotificationText({ ...job, category: "<b>İade</b>" } as unknown as typeof job, "https://example.test")).toThrow();
  });
  it("defaults customer language to English independently of Turkish operator messages", () => {
    expect(inferStyleProfile([{ direction: "outbound", content: "Merhaba, yönetici olarak yardımcı olacağım." }]).language).toBe("en");
    expect(inferStyleProfile([{ direction: "inbound", content: "I want a refund" }, { direction: "outbound", content: "Merhaba, yönetici notu Türkçedir." }]).language).toBe("en");
    for (const [content, locale] of [["Please reply in Turkish", "tr"], ["مرحباً أحتاج مساعدة", "ar"], ["Здравствуйте, нужна помощь", "ru"], ["Please reply in English", "en"]]) expect(inferStyleProfile([{ direction: "inbound", content: content! }]).language).toBe(locale);
  });
});
