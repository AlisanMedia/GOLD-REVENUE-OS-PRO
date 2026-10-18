import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeEntitlementCursor, encodeEntitlementCursor, entitlementCursor, entitlementHref,
  entitlementPageSchema, entitlementSearchSchema, rowSchemas } from "../../apps/web/src/lib/entitlements/read-model";
import { translator } from "../../apps/web/src/lib/i18n/core";
import { entitlementCopy } from "../../apps/web/src/lib/i18n/entitlements";
const mocks = vi.hoisted(() => ({ require: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/server", () => ({ requireAdminCapability: mocks.require }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
import { entitlementPage, subscriptionDetail } from "../../apps/web/src/lib/entitlements/admin";
const id = "ec030000-0000-4000-8000-000000000001", customer = "ec020000-0000-4000-8000-000000000001";
const time = "2026-10-18T12:00:00+00:00";
const cursor = entitlementCursor.parse({ version: 1, scope: "a".repeat(64), started_at: time,
  after_id: id, after_time: time, anchor_id: id, anchor_time: time });
const subscription = { id, customer_id: customer, plan_version_id: id, mode: "test", state: "ACTIVE", starts_at: time,
  ends_at: time, grace_until: time, renewal_due_at: time, created_at: time, revision: 1, has_payment: true, access_status: null,
  plan_snapshot: { title: "Synthetic TEST plan", duration_unit: "calendar_month", duration_count: 1, grace_days: null, renewal_notice_days: null } };
const page = (items: unknown[] = [subscription]) => ({ version: 1, collection: "subscriptions", observed_at: time, started_at: time, page_size: 25,
  items, has_more: false, next_cursor: null, consistency: "LIVE_KEYSET_REFRESH_FOR_CHANGES" });
const terms = { locale: null, amount: null, currency: null, billing: null, terms: null, tax_rule: null, renewal_rule: null, cancellation_rule: null, inclusions: [], restrictions: [], disclosures: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.require.mockResolvedValue({ tenantId: "server-owned-tenant", role: "manager", userId: id }); mocks.rpc.mockResolvedValue({ data: page(), error: null }); });
describe("Phase16C0 typed read boundary", () => {
  it("uses only authenticated server tenant and explicit customer filters", async () => {
    const result = await entitlementPage("subscriptions", { ...{ tenant_id: "foreign-tenant" }, customer });
    expect(result.page?.items).toHaveLength(1);
    expect(mocks.require).toHaveBeenCalledWith("entitlements.read");
    expect(mocks.rpc).toHaveBeenCalledWith("admin_entitlement_page_v1", { target_tenant_id: "server-owned-tenant", collection_value: "subscriptions",
      target_customer_id: customer, target_subscription_id: null, page_size_value: 25, cursor_value: null });
  });
  it("retrieves a detail directly, never searching a first page", async () => {
    mocks.rpc.mockResolvedValue({ data: { version: 1, observed_at: time, subscription, access: null, plan_terms: terms }, error: null });
    expect((await subscriptionDetail(id)).detail?.subscription.id).toBe(id);
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("admin_subscription_detail_v1", { target_tenant_id: "server-owned-tenant", target_subscription_id: id });
  });
  it("keeps absent detail distinct from failed loading", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null }); expect((await subscriptionDetail(id)).detail).toBeNull();
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57014" } }); expect((await subscriptionDetail(id)).error).toBe("unavailable");
  });
  it("invalid detail IDs never reach SQL", async () => { expect((await subscriptionDetail("not-a-uuid")).detail).toBeNull(); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("preserves authorization redirects/rejections without making any read", async () => {
    mocks.require.mockRejectedValue(Error("DENIED")); await expect(entitlementPage("jobs")).rejects.toThrow("DENIED"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not reinterpret a source failure as an empty page", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "private source details" } });
    const result = await entitlementPage("subscriptions"); expect(result.page).toBeNull(); expect(result.error).toBe("unavailable"); expect(JSON.stringify(result)).not.toContain("private source");
  });
  it("shows cursor refresh guidance without leaking SQL errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "sensitive internal text" } }); expect((await entitlementPage("jobs")).error).toBe("cursor");
  });
  it("treats transport failures as unavailable without a false empty or 404", async () => {
    mocks.rpc.mockRejectedValue(Error("private network detail"));
    expect((await entitlementPage("subscriptions")).error).toBe("unavailable");
    expect((await subscriptionDetail(id)).error).toBe("unavailable");
  });
  it("rejects malformed cursor before database work", async () => { expect((await entitlementPage("audit", { cursor: "malformed!" })).error).toBe("cursor"); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("passes a validated cursor and narrow subscription scope", async () => {
    await entitlementPage("audit", { subscription: id, cursor: encodeEntitlementCursor(cursor), size: 50 });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_entitlement_page_v1", expect.objectContaining({ target_subscription_id: id, cursor_value: cursor, page_size_value: 50 }));
  });
  it.each([0, 101, 100000])("rejects page size %s before SQL", async size => { await expect(entitlementPage("audit", { size })).rejects.toThrow(); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("requires exact response collection and explicit bounded schema", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...page(), collection: "jobs" }, error: null }); expect((await entitlementPage("subscriptions")).error).toBe("unavailable");
    mocks.rpc.mockResolvedValue({ data: page(Array(101).fill(subscription)), error: null }); expect((await entitlementPage("subscriptions")).error).toBe("unavailable");
  });
  it("rejects unexpected sensitive fields rather than silently accepting future columns", () => {
    expect(entitlementPageSchema(rowSchemas.subscriptions).safeParse(page([{ ...subscription, commercial_snapshot: { private: true } }])).success).toBe(false);
    expect(rowSchemas.jobs.safeParse({ id, access_id: id, subscription_id: id, operation: "invite", status: "PENDING", attempts: 0,
      available_at: time, last_error: null, lease_token: id }).success).toBe(false);
  });
  it("rejects false completeness flags and overlong invitation fields", () => {
    expect(entitlementPageSchema(rowSchemas.subscriptions).safeParse({ ...page(), has_more: true }).success).toBe(false);
    expect(entitlementPageSchema(rowSchemas.subscriptions).safeParse({ ...page(), next_cursor: cursor }).success).toBe(false);
    expect(rowSchemas.access.safeParse({ id, subscription_id: id, customer_id: customer, mode: "test", status: "INVITED", telegram_user_id: null,
      chat_id: null, invite_reference: "x".repeat(513), invite_present: true, invite_expires_at: time, membership_checked_at: null }).success).toBe(false);
  });
});
describe("Phase16C0 navigation and localization", () => {
  it("round trips navigation data without customer identity or invitation contents", () => {
    const encoded = encodeEntitlementCursor(cursor); expect(decodeEntitlementCursor(encoded)).toEqual(cursor);
    expect(JSON.stringify(decodeEntitlementCursor(encoded))).not.toMatch(/tenant_id|telegram|invite|lease|email/u);
  });
  it.each(["!", "a".repeat(1501), Buffer.from('{"lease_token":"x"}').toString("base64url")])("rejects invalid URL cursor", value => expect(() => decodeEntitlementCursor(value)).toThrow());
  it("keeps customer/evidence filters on next links and drops cursor on refresh", () => {
    const next = entitlementHref("/admin/subscriptions", { customer, size: "25", cursor });
    expect(new URL(next, "http://localhost").searchParams.get("customer")).toBe(customer);
    expect(new URL(next, "http://localhost").searchParams.get("cursor")).toBeTruthy();
    const reset = entitlementHref("/admin/subscriptions/" + id, { size: "25", evidence: "payments" }); expect(reset).not.toContain("cursor="); expect(reset).toContain("evidence=payments");
  });
  it.each([{ size: "100000" }, { cursor: ["one", "two"] }, { customer: "foreign" }, { evidence: "lease_token" }])("validates operator URL inputs", input => expect(entitlementSearchSchema.safeParse(input).success).toBe(false));
  it("defaults to 25 without changing the customer language policy", () => expect(entitlementSearchSchema.parse({}).size).toBe("25"));
  it.each(Object.keys(entitlementCopy) as (keyof typeof entitlementCopy)[])("localizes %s in both languages", key => { expect(translator("tr-TR")(key)).toBeTruthy(); expect(translator("en-US")(key)).toBeTruthy(); });
});
