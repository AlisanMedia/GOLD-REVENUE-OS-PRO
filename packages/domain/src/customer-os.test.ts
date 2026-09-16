import { describe, expect, it } from "vitest";
import { classifyDedup, classifyRows, normalizeIdentity, normalizeImportRow } from "./customer-os";

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

  it("groups exact identities inside one upload without creating duplicate customers", () => {
    const rows = [
      normalizeImportRow(2, { email: "same@example.com", telegram_username: "@same_user" }, "legacy"),
      normalizeImportRow(3, { email: "SAME@example.com" }, "legacy"),
    ];
    const classified = classifyRows(rows, []);
    expect(classified[0]).toMatchObject({
      classification: "new_customer",
      planned_mutation: { action: "create_customer" },
    });
    expect(classified[1]).toMatchObject({
      classification: "exact_match",
      candidate_customer_id: null,
      planned_mutation: { action: "link_batch" },
    });
    expect(classified[0]!.batch_customer_ref).toBe(classified[1]!.batch_customer_ref);
  });

  it("uses one batch reference when exact identities form a transitive group", () => {
    const rows = [
      normalizeImportRow(2, { email: "first@example.com", telegram_user_id: "123" }, "legacy"),
      normalizeImportRow(3, { telegram_user_id: "123", email: "second@example.com" }, "legacy"),
      normalizeImportRow(4, { email: "second@example.com" }, "legacy"),
    ];
    const classified = classifyRows(rows, []);
    expect(classified.map((row) => row.classification)).toEqual(["new_customer", "exact_match", "exact_match"]);
    expect(new Set(classified.map((row) => row.batch_customer_ref)).size).toBe(1);
  });
});
