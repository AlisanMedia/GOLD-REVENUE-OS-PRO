import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "../../apps/web/node_modules/react";
import { renderToStaticMarkup as render } from "../../apps/web/node_modules/react-dom/server";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { AdminI18nProvider } from "../../apps/web/src/components/admin-i18n";
import { EntitlementPagination } from "../../apps/web/src/components/entitlement-pagination";
import { entitlementCursor } from "../../apps/web/src/lib/entitlements/read-model";
import type { AdminLocale } from "../../apps/web/src/lib/i18n/core";
const mocks = vi.hoisted(() => ({ page: vi.fn(), detail: vi.fn(), read: vi.fn(), names: vi.fn(), role: "manager", path: "/admin/subscriptions" }));
vi.mock("@/lib/entitlements/admin", () => ({ entitlementPage: mocks.page, subscriptionDetail: mocks.detail, requireEntitlementRead: mocks.read }));
vi.mock("@/lib/admin/server", () => ({ getCustomerDisplayNames: mocks.names }));
vi.mock("@/components/entitlement-pagination", () => import("../../apps/web/src/components/entitlement-pagination"));
vi.mock("@/lib/entitlements/read-model", () => import("../../apps/web/src/lib/entitlements/read-model"));
vi.mock("@/lib/admin/permissions", () => import("../../apps/web/src/lib/admin/permissions"));
vi.mock("@/components/purchase-status", () => import("../../apps/web/src/components/purchase-status"));
vi.mock("../../apps/web/src/app/admin/subscriptions/actions", () => ({ subscriptionControl: async () => {}, testSubscription: async () => {}, requestAccess: async () => {}, testAccessCycle: async () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path, notFound: () => { throw Error("NOT_FOUND"); } }));
import SubscriptionsPage from "../../apps/web/src/app/admin/subscriptions/page";
import ChannelAccessPage from "../../apps/web/src/app/admin/channel-access/page";
import SubscriptionDetail from "../../apps/web/src/app/admin/subscriptions/[id]/page";
const id = "ec030000-0000-4000-8000-000000000321", customer = "ec020000-0000-4000-8000-000000000001", time = "2026-10-18T12:00:00Z";
const sub = { id, customer_id: customer, plan_version_id: id, mode: "test", state: "ACTIVE", starts_at: time, ends_at: "2026-11-18T12:00:00Z", grace_until: "2026-11-18T12:00:00Z", renewal_due_at: time,
  created_at: time, revision: 1, has_payment: true, access_status: "INVITED", plan_snapshot: { title: "Synthetic TEST plan", duration_unit: "calendar_month", duration_count: 1, grace_days: 0, renewal_notice_days: 3 } };
const access = { id, subscription_id: id, customer_id: customer, mode: "test", status: "INVITED", telegram_user_id: "test:12345", chat_id: "test:vip", invite_reference: "test:invite:PRIVATE", invite_present: true, invite_expires_at: time, membership_checked_at: null };
const terms = { locale: "en", amount: "79", currency: "USD", billing: "recurring", terms: "Original synthetic plan terms.", tax_rule: null, renewal_rule: null, cancellation_rule: null, inclusions: [], restrictions: [], disclosures: [] };
const next = entitlementCursor.parse({ version: 1, scope: "a".repeat(64), started_at: time, after_id: id, after_time: time, anchor_id: id, anchor_time: time });
const result = (collection: string, items: unknown[]) => ({ context: { role: mocks.role }, error: null, page: { collection, items, has_more: true, next_cursor: next, page_size: 25, observed_at: time, started_at: time, consistency: "LIVE_KEYSET_REFRESH_FOR_CHANGES", version: 1 } });
function localized(locale: AdminLocale, node: React.ReactNode) { return render(h(AdminI18nProvider, { locale }, node)); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.role = "manager";
  mocks.read.mockImplementation(async () => ({ role: mocks.role })); mocks.names.mockResolvedValue({ [customer]: "Synthetic customer · TEST" });
  mocks.detail.mockResolvedValue({ context: { role: mocks.role }, error: null, detail: { version: 1, observed_at: time, subscription: sub, access, plan_terms: terms } });
  mocks.page.mockImplementation(async (collection: string) => result(collection, collection === "subscriptions" ? [sub] : collection === "access" ? [access] : collection === "jobs" ? [
    { id, access_id: id, subscription_id: id, operation: "reconcile", status: "FAILED", attempts: 2, available_at: time, last_error: "DETAILS_RESTRICTED" },
  ] : collection === "payments" ? [{ id, subscription_id: id, mode: "test", event_id: id, test_invoice_id: id, receipt_id: null, period_start: time, period_end: sub.ends_at }] : [
    { id, subscription_id: id, action: "retry", mode: "test", created_at: time, details: { attempt: 2 } },
  ]));
});
describe("Phase16C0 actual Admin components", () => {
  it.each(["tr-TR", "en-US"] as const)("renders bounded list navigation in %s", async locale => {
    const html = localized(locale, await SubscriptionsPage({ searchParams: Promise.resolve({ customer }) }));
    expect(html).toContain(locale === "tr-TR" ? "Sonraki kayıtlar" : "Next records"); expect(html).toContain("cursor=");
    expect(html).toContain("customer=" + customer); expect(html).toContain("Synthetic customer");
    expect(html).not.toContain("invite:PRIVATE"); expect(html).not.toContain("lease_token");
    expect(mocks.page).toHaveBeenCalledWith("subscriptions", { customer, size: 25, cursor: undefined });
  });
  it.each(["support", "analyst"])("keeps %s subscription controls absent", async role => {
    mocks.role = role; const html = localized("tr-TR", await SubscriptionsPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain('name="invoice_id"'); expect(html).not.toContain('name="action"'); expect(html).toContain(`href="/admin/subscriptions/${id}"`);
  });
  it("keeps manager test and mutation forms unchanged and test-labeled", async () => {
    const html = localized("tr-TR", await SubscriptionsPage({ searchParams: Promise.resolve({}) })); expect(html).toContain('name="invoice_id"'); expect(html).toContain('name="request_id"'); expect(html).toContain("YALNIZCA TEST");
  });
  it("opens a direct detail beyond 100 without loading a subscription list", async () => {
    const html = localized("tr-TR", await SubscriptionDetail({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("Abonelik kanıtları"); expect(mocks.detail).toHaveBeenCalledWith(id);
    expect(mocks.page).toHaveBeenCalledOnce(); expect(mocks.page).toHaveBeenCalledWith("audit", { subscription: id, customer, size: 25, cursor: undefined });
  });
  it.each(["payments", "jobs", "access", "audit"])("loads only selected %s evidence", async evidence => {
    const html = localized("en-US", await SubscriptionDetail({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ evidence }) }));
    expect(mocks.page).toHaveBeenCalledOnce(); expect(mocks.page).toHaveBeenCalledWith(evidence, expect.objectContaining({ subscription: id, customer }));
    expect(html).toContain('aria-current="page"'); expect(html).toContain("evidence=" + evidence);
    expect(html).not.toContain("lease_token"); expect(html).not.toContain("invite:PRIVATE");
  });
  it.each(["tr-TR", "en-US"] as const)("keeps customer preview English for %s operators", async locale => {
    const html = localized(locale, await SubscriptionDetail({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('lang="en"'); expect(html).toContain("This preview creates no real membership, payment or Telegram access.");
  });
  it("retains original plan terms and distinguishes a quoted plan price from revenue", async () => {
    const html = localized("en-US", await SubscriptionDetail({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("Original synthetic plan terms."); expect(html).toContain("Plan price · not collected revenue");
    expect(html).toContain("79 USD");
  });
  it("rejects a foreign customer parameter on a direct detail", async () => {
    const html = localized("tr-TR", await SubscriptionDetail({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ customer: id }) }));
    expect(html).toContain('role="alert"'); expect(mocks.page).not.toHaveBeenCalled();
  });
  it("retains unavailable/error state without false not-found or no-record claims", async () => {
    mocks.detail.mockResolvedValue({ error: "unavailable", detail: null });
    expect(localized("en-US", await SubscriptionDetail({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }))).toContain("does not mean there are no records");
    mocks.page.mockResolvedValue({ context: { role: "manager" }, error: "unavailable", page: null });
    const html = localized("en-US", await SubscriptionsPage({ searchParams: Promise.resolve({}) })); expect(html).toContain('role="alert"'); expect(html).not.toContain("No subscriptions.");
  });
  it("invalid list URL reports refresh guidance without querying data", async () => {
    const html = localized("tr-TR", await SubscriptionsPage({ searchParams: Promise.resolve({ size: "100000" }) })); expect(html).toContain('role="alert"'); expect(mocks.page).not.toHaveBeenCalled();
  });
  it("channel access reads no joined job history and shows no raw invitation", async () => {
    const html = localized("tr-TR", await ChannelAccessPage({ searchParams: Promise.resolve({}) })); expect(mocks.page).toHaveBeenCalledOnce(); expect(mocks.page).toHaveBeenCalledWith("access", expect.anything());
    expect(html).toContain("Davet kaydı var"); expect(html).toContain("evidence=jobs"); expect(html).not.toContain("test:invite:PRIVATE");
  });
  it("makes final, partial and empty states distinguishable", () => {
    const partial = localized("en-US", h(EntitlementPagination, { path: "/admin/subscriptions", size: "25", next, hasMore: true, count: 25 }));
    const final = localized("en-US", h(EntitlementPagination, { path: "/admin/subscriptions", size: "25", next: null, hasMore: false, count: 0, continued: true }));
    expect(partial).toContain("More records available"); expect(final).toContain("End of current results"); expect(final).not.toContain("Next records"); expect(final).toContain("First page / refresh");
  });
});

if (process.env.PHASE16C0_PREVIEW_DIR) {
  it("exports actual-component synthetic TR/EN previews", async () => {
    const dir = process.env.PHASE16C0_PREVIEW_DIR!; mkdirSync(dir, { recursive: true });
    const css = readFileSync("apps/web/src/app/globals.css", "utf8").replace('@import "tailwindcss";', "");
    for (const locale of ["tr-TR", "en-US"] as const) {
      for (const [name, node] of [
        ["subscriptions", await SubscriptionsPage({ searchParams: Promise.resolve({}) })],
        ["access", await ChannelAccessPage({ searchParams: Promise.resolve({}) })],
        ["detail", await SubscriptionDetail({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })],
      ] as const) writeFileSync(`${dir}/${name}-${locale}.html`, `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gold Revenue · SYNTHETIC TEST</title><style>${css}</style>${localized(locale,node)}</html>`);
    }
  });
}
