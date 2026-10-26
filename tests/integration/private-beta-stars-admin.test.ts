import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "../../apps/web/node_modules/react";
import { renderToStaticMarkup as render } from "../../apps/web/node_modules/react-dom/server";
import { AdminI18nProvider } from "../../apps/web/src/components/admin-i18n";
import { translator } from "../../apps/web/src/lib/i18n/core";

const mocks = vi.hoisted(() => ({ require: vi.fn(), rpc: vi.fn(), adapter: vi.fn(), checkout: vi.fn(), i18n: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/server", () => ({ requireAdminCapability: mocks.require }));
vi.mock("@/lib/admin/permissions", () => import("../../apps/web/src/lib/admin/permissions"));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/payments/admin", () => import("../../apps/web/src/lib/payments/admin"));
vi.mock("@/lib/payments/service", () => ({ configuredTestAdapter: mocks.adapter }));
vi.mock("@/lib/i18n/server", () => ({ getAdminI18n: mocks.i18n }));
vi.mock("@/components/membership-checkout-preview", () => import("../../apps/web/src/components/membership-checkout-preview"));
vi.mock("../../apps/web/src/app/admin/payments/actions", () => ({ reconcilePayment: async () => {}, simulatePayment: async () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); } }));
import PaymentPage from "../../apps/web/src/app/admin/payments/[id]/page";
import { paymentDetail, starsAdminEvidenceSchema } from "../../apps/web/src/lib/payments/admin";

const tenant = "91cd3000-0000-4000-8000-000000000001", invoice = "91cd3000-0000-4000-8000-000000000002", offer = "91cd3000-0000-4000-8000-000000000003", customer = "91cd3000-0000-4000-8000-000000000004", owner = "91cd3000-0000-4000-8000-000000000005", receipt = "91cd3000-0000-4000-8000-000000000006", subscription = "91cd3000-0000-4000-8000-000000000007";
const at = "2026-10-26T11:00:00Z";
function detail(dedicated = true) { return { invoice: { id: invoice, tenant_id: tenant, customer_id: customer, offer_id: offer, provider_id: "telegram_stars_test", provider_reference: "test:stars:" + invoice, channel: "telegram_stars", surface: "telegram_bot", mode: "test", amount_units: "777", decimals: 0, asset: "XTR", network: dedicated ? "TELEGRAM_TEST" : "telegram", recipient: "test:bot:900000001", payer_reference: "test:123456789", min_confirmations: 1, status: "PENDING", expires_at: "2026-10-27T11:00:00Z", created_at: at, quote_snapshot: { ...(dedicated ? { origin: "TELEGRAM_DEDICATED_TEST" } : {}), product_code: "POLAT_VIP_30D_DRAFT", private_source_reference: "PRIVATE_SOURCE_NOT_FOR_PAGE" }, last_evidence_at: null, confirmed_at: null, reconciliation_count: 0, idempotency_key: "offline-stars-admin-fixture", created_by: owner }, observations: [], transactions: [] }; }
function evidence() { return starsAdminEvidenceSchema.parse({ version: 1, invoice_id: invoice, mode: "test", origin: "TELEGRAM_DEDICATED_TEST", financial_authority: "NONE", receipts: [{ id: receipt, kind: "PAYMENT", amount_units: "777", currency: "XTR", recorded_at: at, source_time: at, source_hash: "a".repeat(64), ledger_hash: "b".repeat(64) }], subscription: { id: subscription, state: "ACTIVE", mode: "test" }, jobs: [{ operation: "join", status: "DONE" }], page_size: 25, has_more_receipts: false, has_more_jobs: false }); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.require.mockResolvedValue({ tenantId: tenant, userId: owner, role: "super_admin" }); mocks.i18n.mockResolvedValue({ locale: "en-US", t: translator("en-US") });
  mocks.rpc.mockImplementation(async name => ({ data: name === "admin_payment_detail" ? detail() : evidence(), error: null })); mocks.checkout.mockResolvedValue({ type: "MOCK_CHECKOUT_FIXTURE" }); mocks.adapter.mockReturnValue({ createCheckout: mocks.checkout });
});
describe("existing Admin payment detail separates dedicated Telegram TEST evidence from simulation", () => {
  it.each(["tr-TR", "en-US"] as const)("renders genuine-source TEST records without fixture generation or simulation controls in %s", async locale => {
    mocks.i18n.mockResolvedValue({ locale, t: translator(locale) }); const tree = await PaymentPage({ params: Promise.resolve({ id: invoice }), searchParams: Promise.resolve({}) });
    const html = render(h(AdminI18nProvider, { locale }, tree));
    expect(html).toContain(translator(locale)("Telegram dedicated TEST invoice")); expect(html).toContain(translator(locale)("TEST payment receipt")); expect(html).toContain("777"); expect(html).toContain(`/admin/subscriptions/${subscription}`);
    expect(html).not.toContain(translator(locale)("Simulate and reconcile")); expect(html).not.toContain(translator(locale)("XTR invoice contract only. Nothing is sent to Telegram.")); expect(html).not.toContain("PRIVATE_SOURCE_NOT_FOR_PAGE"); expect(html).not.toContain("test:123456789");
    expect(html).not.toContain("Simulation amounts"); expect(html).not.toContain("payment simulation confirmed");
    expect(mocks.adapter).not.toHaveBeenCalled(); expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("admin_private_beta_stars_evidence_v1", { target_tenant_id: tenant, target_invoice_id: invoice });
  });
  it("preserves the accepted historical simulation checkout path for other invoices", async () => {
    mocks.rpc.mockResolvedValue({ data: detail(false), error: null }); const tree = await PaymentPage({ params: Promise.resolve({ id: invoice }), searchParams: Promise.resolve({}) });
    const html = render(h(AdminI18nProvider, { locale: "en-US" }, tree)); expect(html).toContain("MOCK_CHECKOUT_FIXTURE"); expect(html).toContain("Simulate and reconcile"); expect(html).toContain("Nothing is sent to Telegram"); expect(mocks.adapter).toHaveBeenCalledTimes(1); expect(mocks.checkout).toHaveBeenCalledTimes(1); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not call unavailable dedicated receipt evidence an empty history or completed payment", async () => {
    mocks.rpc.mockImplementation(async name => name === "admin_payment_detail" ? { data: detail(), error: null } : { data: null, error: { code: "08006", message: "PRIVATE_DB_DIAGNOSTIC" } });
    const tree = await PaymentPage({ params: Promise.resolve({ id: invoice }), searchParams: Promise.resolve({}) }); const html = render(h(AdminI18nProvider, { locale: "en-US" }, tree));
    expect(html).toContain("Dedicated TEST evidence is unavailable"); expect(html).not.toContain("No dedicated TEST payment or refund receipt is recorded"); expect(html).not.toContain("PRIVATE_DB_DIAGNOSTIC"); expect(mocks.adapter).not.toHaveBeenCalled();
  });
  it("reports independent collection incompleteness instead of silently dropping history", async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "admin_payment_detail" ? detail() : { ...evidence(), has_more_receipts: true, has_more_jobs: true }, error: null }));
    const tree = await PaymentPage({ params: Promise.resolve({ id: invoice }), searchParams: Promise.resolve({}) }); const html = render(h(AdminI18nProvider, { locale: "en-US" }, tree)); expect(html).toContain("up to 25 receipts and 25 access jobs independently"); expect(html).toContain("the result is incomplete");
  });
  it("rejects wrong-invoice evidence, raw charge fields and technical hashes outside owner/manager roles", async () => {
    for (const raw of [{ ...evidence(), invoice_id: offer }, { ...evidence(), raw_charge_id: "PRIVATE_CHARGE" }]) {
      mocks.rpc.mockImplementation(async name => ({ data: name === "admin_payment_detail" ? detail() : raw, error: null })); expect((await paymentDetail(invoice))?.starsEvidence).toBeNull();
    }
    mocks.require.mockResolvedValue({ tenantId: tenant, userId: owner, role: "support" }); mocks.rpc.mockImplementation(async name => ({ data: name === "admin_payment_detail" ? detail() : evidence(), error: null })); expect((await paymentDetail(invoice))?.starsEvidence).toBeNull();
    mocks.rpc.mockImplementation(async name => ({ data: name === "admin_payment_detail" ? detail() : { ...evidence(), receipts: evidence().receipts.map(row => ({ ...row, source_hash: null, ledger_hash: null })) }, error: null })); expect((await paymentDetail(invoice))?.starsEvidence?.receipts).toHaveLength(1);
  });
  it("never queries dedicated evidence when the authorized invoice does not exist", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null }); expect(await paymentDetail(invoice)).toBeNull(); expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.rpc).toHaveBeenCalledWith("admin_payment_detail", { target_tenant_id: tenant, target_invoice_id: invoice });
  });
});
