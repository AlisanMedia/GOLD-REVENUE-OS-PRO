import { describe, expect, it } from "vitest";
import { classifyDedup, normalizeIdentity, normalizeImportRow } from "./customer-os";

describe("customer identity normalization", () => {
  it("normalizes supported identities deterministically", () => {
    expect(normalizeIdentity("email", "  Trader@Example.COM ").value).toBe("trader@example.com");
    expect(normalizeIdentity("telegram_username", "@Gold_Trader").value).toBe("gold_trader");
    expect(normalizeIdentity("telegram_user_id", "+123456").value).toBe("123456");
    expect(normalizeIdentity("phone", "0532 111 22 33").value).toBe("+905321112233");
    expect(normalizeIdentity("external_id", " CRM-007 ").value).toBe("crm-007");
  });

  it("rejects invalid identities instead of guessing", () => {
    expect(normalizeIdentity("email", "not-an-email").error?.code).toBe("invalid_email");
    expect(normalizeIdentity("phone", "123").error?.code).toBe("invalid_phone");
  });
});

describe("deduplication", () => {
  const existing = [{ id: "c-1", display_name: "Ali Trader", identities: [{ identity_type: "email" as const, normalized_value: "ali@example.com" }] }];

  it("returns exact_match only for one consistent identity owner", () => {
    const row = normalizeImportRow(1, { email: "ALI@example.com", name: "Ali Trader" }, "crm");
    expect(classifyDedup(row, existing)).toMatchObject({ classification: "exact_match", candidate_customer_id: "c-1" });
  });

  it("marks a name-only candidate probable and does not merge it", () => {
    const row = normalizeImportRow(1, { name: "Ali Trader" }, "crm");
    expect(classifyDedup(row, existing)).toMatchObject({ classification: "probable_match", candidate_customer_id: "c-1", planned_mutation: { action: "manual_review" } });
  });

  it("marks conflicting identity owners ambiguous", () => {
    const row = normalizeImportRow(1, { email: "ali@example.com", phone: "+905321112233" }, "crm");
    const conflict = [...existing, { id: "c-2", display_name: "Other", identities: [{ identity_type: "phone" as const, normalized_value: "+905321112233" }] }];
    expect(classifyDedup(row, conflict).classification).toBe("ambiguous");
  });

  it("classifies unseen identities as new_customer", () => {
    const row = normalizeImportRow(1, { email: "new@example.com" }, "crm");
    expect(classifyDedup(row, existing)).toMatchObject({ classification: "new_customer", planned_mutation: { action: "create_customer" } });
  });
});
