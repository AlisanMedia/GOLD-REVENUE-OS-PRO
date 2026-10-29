import { describe, expect, it } from "vitest";
import { campaignConfigurationSchema } from "@gold-revenue-os/contracts";
import { assessCampaignContact, campaignLiability, campaignPermissionHash, campaignWithinContactWindow, prepareCampaignSalesReply } from "./campaign";
import { normalizeCampaignImportRow } from "./campaign-import";
import { polatSalesFixture } from "./polat-sales.fixtures";

export const campaignFixtureConfig = () => campaignConfigurationSchema.parse({ version: 1, name: "Synthetic campaign", mode: "SYNTHETIC",
  batch_id: "61ca2000-0000-4000-8000-000000000001", plan_version_id: "61c06000-0000-4000-8000-000000000002", markets: ["GB", "DE"], default_language: "en",
  starts_at: "2026-10-29T00:00:00Z", expires_at: "2026-11-29T00:00:00Z", maximum_messages: 100, maximum_per_customer: 3, maximum_per_day: 1,
  minimum_interval_seconds: 86400, follow_up_after_seconds: 86400, maximum_model_calls: 100, budget_currency: "USD", budget_amount: "1.000000",
  maximum_liability_per_call: "0.010000", maximum_output_tokens: 512, timezone: "UTC", window_start: 9, window_end: 18,
});
const permission = () => ({ version: 1, classification: "OWNER_ATTESTED_EXISTING_PERMISSION", batch_id: campaignFixtureConfig().batch_id,
  dataset_version: "invented-v1", dataset_hash: "a".repeat(64), source: "Invented historical source", channel: "TELEGRAM_BOT", markets: ["GB", "DE"], purpose: "SIGNAL_SERVICE_MARKETING", reference: "invented-owner-attestation" });
const contact = () => ({ configuration: campaignFixtureConfig(), permission: permission(), market: "GB", contactability: "user_initiated" as const,
  numericIdentityMatched: true, existingPrivateChat: true, platformWindowOpen: true, optedOut: false, suppressed: false, humanOwned: false, openCase: false });

describe("single founder campaign policy", () => {
  it("records batch provenance without inventing individual consent", () => {
    const result = assessCampaignContact(contact());
    expect(result.eligible).toBe(true);
    expect(result.provenance).toBe("OWNER_ATTESTED_EXISTING_PERMISSION");
    expect(result.individually_verified_consent).toBe(false);
    expect(result.financial_authority).toBe("NONE");
  });
  it.each([{ market: null }, { market: "TR" }, { market: "US" }, { optedOut: true }, { suppressed: true }, { humanOwned: true }, { openCase: true },
    { numericIdentityMatched: false }, { existingPrivateChat: false }, { platformWindowOpen: false }, { contactability: "unknown" as const }, { contactability: "blocked" as const }, { contactability: "revoked" as const }])("denies an ineligible route: %j", change => {
    expect(assessCampaignContact({ ...contact(), ...change }).eligible).toBe(false);
  });
  it("does not infer platform authority from owner permission", () => {
    expect(assessCampaignContact({ ...contact(), existingPrivateChat: false }).reasons).toContain("PLATFORM_ROUTE_UNAVAILABLE");
    expect(assessCampaignContact({ ...contact(), permission: { ...permission(), batch_id: "61ca2000-0000-4000-8000-000000000002" } }).eligible).toBe(false);
  });
  it("binds source dataset/version/channel in a canonical hash", () => {
    const p = permission(), h = campaignPermissionHash(p);
    expect(h).toMatch(/^[a-f0-9]{64}$/u);
    expect(campaignPermissionHash({ ...p, reference: p.reference })).toBe(h);
    for (const change of [{ dataset_version: "invented-v2" }, { dataset_hash: "b".repeat(64) }, { channel: "TELEGRAM_BUSINESS" }]) expect(campaignPermissionHash({ ...p, ...change })).not.toBe(h);
    expect(() => campaignPermissionHash({ ...p, actor_id: "invented-founder" })).toThrow();
  });
  it.each([{ markets: ["TR"] }, { markets: ["GB", "GB"] }, { maximum_messages: 0 }, { maximum_per_customer: 0 }, { default_language: "tr" },
    { budget_amount: "1e6" }, { budget_amount: "1.0000001" }, { budget_amount: "0.000000" }, { maximum_liability_per_call: "2.000000" },
    { minimum_interval_seconds: 0 }, { window_end: 9 }, { timezone: "Invented/Zone" }, { expires_at: "2026-10-28T00:00:00Z" }, { maximum_output_tokens: 8192 }])("rejects malformed commercial configuration: %j", change => {
    expect(() => campaignConfigurationSchema.parse({ ...campaignFixtureConfig(), ...change })).toThrow();
  });
  it("commercial budgets do not inherit the fixed private-beta 350/5 limits", () => {
    const config = campaignConfigurationSchema.parse({ ...campaignFixtureConfig(), mode: "COMMERCIAL", maximum_model_calls: 1000, budget_amount: "20.000000" });
    expect(campaignLiability(config, 350).may_reserve).toBe(true);
    expect(campaignLiability(config, 350).actual_billed_cost).toBeNull();
  });
  it("counts failed/unknown initiated attempts and reserves exact decimal liability", () => {
    expect(campaignLiability(campaignFixtureConfig(), 99)).toMatchObject({ may_reserve: true, reserved_microunits: "990000", actual_billed_cost: null });
    expect(campaignLiability(campaignFixtureConfig(), 100).may_reserve).toBe(false);
    expect(campaignLiability({ ...campaignFixtureConfig(), budget_amount: "0.010000" }, 1).may_reserve).toBe(false);
    expect(() => campaignLiability(campaignFixtureConfig(), -1)).toThrow();
  });
  it("enforces configured contact windows including midnight", () => {
    const config = campaignFixtureConfig();
    expect(campaignWithinContactWindow(config, new Date("2026-10-29T09:00:00Z"))).toBe(true);
    expect(campaignWithinContactWindow(config, new Date("2026-10-29T18:00:00Z"))).toBe(false);
    expect(campaignWithinContactWindow({ ...config, window_start: 22, window_end: 6 }, new Date("2026-10-29T23:00:00Z"))).toBe(true);
  });
  it("reuses Polat QA to approve routine truthful pricing without per-message review", () => {
    const result = prepareCampaignSalesReply({ sales: polatSalesFixture("What is the price?"), approvedPlanVersion: campaignFixtureConfig().plan_version_id, campaignActive: true });
    expect(result.campaign_disposition).toBe("QA_APPROVED_AUTOMATIC");
    expect(result.output.proposed_response).toContain("10.00 USD");
    expect(result.owner_message_approval_required).toBe(false);
    expect(result.delivery).toBe("NOT_SENT");
  });
  it.each(["I paid. Confirm my payment", "Do not contact me again", "I want a refund", "Can I speak to a human?"])("holds an actual exception: %s", text => {
    expect(prepareCampaignSalesReply({ sales: polatSalesFixture(text), approvedPlanVersion: campaignFixtureConfig().plan_version_id, campaignActive: true }).campaign_disposition).toBe("HELD");
  });
  it("does not approve another price version or a paused campaign", () => {
    const sales = polatSalesFixture("What is the price?");
    expect(prepareCampaignSalesReply({ sales, approvedPlanVersion: "61c06000-0000-4000-8000-000000000099", campaignActive: true }).campaign_disposition).toBe("HELD");
    expect(prepareCampaignSalesReply({ sales, approvedPlanVersion: campaignFixtureConfig().plan_version_id, campaignActive: false }).campaign_disposition).toBe("HELD");
  });
});

describe("international historical import normalization", () => {
  it("preserves declared source/language and defaults English without claiming verified history", () => {
    const row = normalizeCampaignImportRow(2, { telegram_user_id: "123456789", country_code: "gb", historical_relationship: "Invented previous customer" }, "Invented supplier");
    expect(row.errors).toEqual([]);
    expect(row.normalized_payload.contact).toEqual({ market: "GB", language: "en", relationship: "Invented previous customer", provenance: "SOURCE_IMPORT_DECLARED" });
  });
  it("does not invent missing market/chat identity", () => {
    const row = normalizeCampaignImportRow(2, { telegram_username: "invented_user" }, "Invented supplier");
    expect(row.normalized_payload.contact).toMatchObject({ market: null, language: "en" });
    expect(row.identities.some(i => i.identity_type === "telegram_user_id")).toBe(false);
  });
  it("does not infer a Turkish +90 phone prefix", () => {
    expect(normalizeCampaignImportRow(2, { phone: "05551234567" }, "Invented supplier").errors.map(e => e.code)).toContain("explicit_international_phone_required");
    expect(normalizeCampaignImportRow(2, { phone: "+447700900123" }, "Invented supplier").errors).toEqual([]);
  });
  it("retains unsupported language and market for reconciliation instead of silently authorizing", () => {
    const row = normalizeCampaignImportRow(2, { telegram_user_id: "123456789", country_code: "unknown", preferred_language: "invented" }, "Invented supplier");
    expect(row.errors.map(e => e.code)).toEqual(expect.arrayContaining(["invalid_market", "unsupported_language"]));
  });
});
