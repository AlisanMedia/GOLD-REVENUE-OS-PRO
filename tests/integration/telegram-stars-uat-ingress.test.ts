import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => { throw Error("UNEXPECTED_REAL_DB_ACCESS"); } }));
import { processTelegramStarsUatWebhook, starsUatRelaySignature } from "../../apps/web/src/lib/payments/telegram-stars-uat-handler";
import { handleStarsTestRelay, starsTestRelaySignature } from "../../supabase/functions/polat-private-beta-stars-ingress/relay";

const now = Date.parse("2026-10-26T12:00:00Z"), timestamp = String(now / 1000), tenant = randomUUID(), program = randomUUID(), invoiceId = randomUUID();
const config = { tenantId: tenant, programId: program, webhookSecret: "SYNTHETIC_STARS_WEBHOOK_SECRET_NOT_CREDENTIAL", relaySecret: "SYNTHETIC_STARS_RELAY_SECRET_NOT_CREDENTIAL" };
const invoice = { version: 1, environment: "TELEGRAM_DEDICATED_TEST", program_id: program, tenant_id: tenant, invoice_id: invoiceId, bot_user_id: "7400000001", payer_user_id: "7300000001", product_code: "POLAT_VIP_30D_DRAFT", duration_days: 30, currency: "XTR", amount_units: "1", issued_at: new Date(now - 60000).toISOString(), expires_at: new Date(now + 60000).toISOString() };
const payment = (kind = "successful_payment") => JSON.stringify({ update_id: 55, message: { from: { id: 7300000001, is_bot: false }, [kind]: { invoice_payload: "uat-stars:" + invoiceId, currency: "XTR", total_amount: 1, telegram_payment_charge_id: "TEST-charge" } } });
function request(raw = payment(), changed: Record<string, string> = {}) { return new Request("https://gold-revenue-os-staging.vercel.app/api/webhooks/private-beta-stars", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": config.webhookSecret,
  "x-polat-stars-uat-timestamp": timestamp, "x-polat-stars-uat-signature": starsUatRelaySignature(raw, timestamp, config.relaySecret), ...changed }, body: raw }); }
function fixture() {
  const s = { state: "CONNECTED_TO_DEDICATED_TEST", authenticateWebhook: vi.fn().mockReturnValue({ kind: "AUTHENTICATED_STARS_TEST_UPDATE" }), answerPreCheckout: vi.fn().mockResolvedValue({ state: "ACKNOWLEDGED" }),
    readLedger: vi.fn().mockResolvedValue({ state: "ACKNOWLEDGED", value: { kind: "AUTHENTICATED_STARS_TEST_LEDGER" } }), recordTestEvidence: vi.fn().mockResolvedValue({ state: "ACKNOWLEDGED", value: { receipt_id: randomUUID(), subscription_id: randomUUID(), replay: false } }),
    prepareTestAccess: vi.fn().mockResolvedValue({}), processNextTestAccess: vi.fn().mockResolvedValue({ state: "ACKNOWLEDGED", value: { status: "INVITED" } }), receiveTestJoinRequest: vi.fn().mockResolvedValue({ state: "ACKNOWLEDGED" }) };
  const deps = { config, now: () => now, connect: vi.fn().mockResolvedValue(s), invoice: vi.fn().mockResolvedValue(invoice), claim: vi.fn().mockResolvedValue({ dispatch: true, state: "PENDING", ingress_id: randomUUID() }), complete: vi.fn().mockResolvedValue({ recorded: true }) };
  return { deps, s };
}
describe("separate Stars dedicated TEST authenticated ingress; offline only", () => {
  it.each(["wrong-secret", "wrong-mac", "expired", "missing-config"])("rejects %s before database or provider work", async kind => {
    const f = fixture(); const headers = kind === "wrong-secret" ? { "x-telegram-bot-api-secret-token": "WRONG" } : kind === "wrong-mac" ? { "x-polat-stars-uat-signature": "f".repeat(64) } : kind === "expired" ? { "x-polat-stars-uat-timestamp": "1000000000" } : {};
    const response = await processTelegramStarsUatWebhook(request(payment(), headers), { ...f.deps, config: kind === "missing-config" ? { ...config, relaySecret: "" } : config });
    expect(response.status).toBe(kind === "missing-config" ? 503 : 401); expect(f.deps.claim).not.toHaveBeenCalled(); expect(f.deps.connect).not.toHaveBeenCalled();
  });
  it("ignores ordinary /start/text and never creates invoices or invokes a model", async () => {
    const f = fixture(), response = await processTelegramStarsUatWebhook(request('{"update_id":55,"message":{"text":"/start"}}'), f.deps);
    expect(await response.json()).toMatchObject({ status: "IGNORED_NO_TEST_PAYMENT_ACTION" }); expect(f.deps.claim).not.toHaveBeenCalled(); expect(f.deps.connect).not.toHaveBeenCalled();
  });
  it.each(["duplicate-keys", "exponent", "oversized"])("rejects unsafe %s update without provider work", async kind => {
    const f = fixture(); let raw = payment();
    if (kind === "duplicate-keys") raw = raw.replace('"update_id":55', '"update_id":55,"update_id":56');
    if (kind === "exponent") raw = raw.replace('"total_amount":1', '"total_amount":1e0');
    if (kind === "oversized") raw += " ".repeat(16385);
    const r = await processTelegramStarsUatWebhook(request(raw), f.deps); expect(r.status).toBe(kind === "oversized" ? 413 : 400); expect(f.deps.connect).not.toHaveBeenCalled();
  });
  it("acknowledges previously completed duplicates without repeating a getMe, checkout or ledger call", async () => {
    const f = fixture(); f.deps.claim.mockResolvedValue({ dispatch: false, state: "COMPLETE", ingress_id: randomUUID() });
    const response = await processTelegramStarsUatWebhook(request(), f.deps); expect(await response.json()).toMatchObject({ status: "DUPLICATE_ALREADY_PROCESSED" }); expect(f.deps.connect).not.toHaveBeenCalled();
  });
  it("does not treat a pending duplicate as completed provider acceptance", async () => {
    const f = fixture(); f.deps.claim.mockResolvedValue({ dispatch: false, state: "PENDING", ingress_id: randomUUID() });
    expect(await(await processTelegramStarsUatWebhook(request(), f.deps)).json()).toMatchObject({ status: "DUPLICATE_REVIEW_REQUIRED" }); expect(f.deps.connect).not.toHaveBeenCalled();
  });
  it("runs precheckout without receipt, subscription or VIP activation", async () => {
    const f = fixture(), raw = JSON.stringify({ update_id: 55, pre_checkout_query: { id: "q-1", from: { id: 7300000001 }, invoice_payload: "uat-stars:" + invoiceId, currency: "XTR", total_amount: 1 } });
    expect(await(await processTelegramStarsUatWebhook(request(raw), f.deps)).json()).toMatchObject({ status: "TEST_UPDATE_PROCESSED" });
    expect(f.s.answerPreCheckout).toHaveBeenCalledOnce(); expect(f.s.readLedger).not.toHaveBeenCalled(); expect(f.s.recordTestEvidence).not.toHaveBeenCalled();
    expect(f.deps.invoice).toHaveBeenCalledWith(invoiceId, "7300000001");
  });
  it.each(["successful_payment", "refunded_payment"])("processes %s only after authenticated source, independent ledger and guarded TEST recorder", async kind => {
    const f = fixture(); expect(await(await processTelegramStarsUatWebhook(request(payment(kind)), f.deps)).json()).toMatchObject({ status: "TEST_UPDATE_PROCESSED" });
    expect(f.s.authenticateWebhook).toHaveBeenCalledOnce(); expect(f.s.readLedger).toHaveBeenCalledOnce(); expect(f.s.recordTestEvidence).toHaveBeenCalledOnce(); expect(f.s.processNextTestAccess).toHaveBeenCalledOnce();
    expect(f.s.prepareTestAccess).toHaveBeenCalledTimes(kind === "successful_payment" ? 1 : 0); expect(f.deps.complete.mock.calls.at(-1)?.[2]).toBe("COMPLETE");
  });
  it("holds incomplete ledger/access/account results and retains review ownership without retry", async () => {
    for (const cause of ["ledger", "access", "account"] as const) {
      const f = fixture(); if (cause === "ledger") f.s.readLedger.mockResolvedValue({ state: "UNKNOWN" });
      if (cause === "access") f.s.processNextTestAccess.mockResolvedValue({ state: "UNKNOWN" }); if (cause === "account") f.deps.connect.mockResolvedValue({ state: "BLOCKED" });
      const response = await processTelegramStarsUatWebhook(request(), f.deps); expect(await response.json()).toMatchObject({ status: "TEST_UPDATE_REVIEW_REQUIRED" });
      expect(f.deps.complete.mock.calls.at(-1)?.[2]).toBe("REVIEW"); expect(f.deps.connect).toHaveBeenCalledTimes(1);
    }
  });
  it("rejects foreign invoice or payer scope without treating an interested user as paid", async () => {
    const f = fixture(); f.deps.invoice.mockResolvedValue({ ...invoice, tenant_id: randomUUID() });
    expect(await(await processTelegramStarsUatWebhook(request(), f.deps)).json()).toMatchObject({ status: "TEST_UPDATE_REVIEW_REQUIRED" }); expect(f.s.authenticateWebhook).not.toHaveBeenCalled();
  });
  it("queues authenticated join handling separately from payment processing", async () => {
    const f = fixture(); const raw = '{"update_id":55,"chat_join_request":{"fixture":"full join identity is checked by the actual adapter"}}';
    expect(await(await processTelegramStarsUatWebhook(request(raw), f.deps)).json()).toMatchObject({ status: "TEST_UPDATE_PROCESSED" });
    expect(f.s.receiveTestJoinRequest).toHaveBeenCalledOnce(); expect(f.deps.invoice).not.toHaveBeenCalled(); expect(f.s.recordTestEvidence).not.toHaveBeenCalled();
  });
  it("uses fixed staging target, isolated MAC domain, no redirects and no upstream body exposure", async () => {
    const raw = payment(), cfg = { webhookSecret: config.webhookSecret, relaySecret: config.relaySecret, vercelBypass: "SYNTHETIC_PROJECT_ONLY_SSO_CREDENTIAL" };
    expect(await starsTestRelaySignature(raw, timestamp, cfg.relaySecret)).toBe(starsUatRelaySignature(raw, timestamp, cfg.relaySecret));
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ private_staff: "DO_NOT_REFLECT" }));
    const r = await handleStarsTestRelay(new Request("https://fixture.invalid?target=https://attacker.invalid", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": cfg.webhookSecret }, body: raw }), cfg, network, now);
    expect(r.status).toBe(200); expect(await r.text()).not.toContain("DO_NOT_REFLECT"); expect(network).toHaveBeenCalledOnce(); expect(network.mock.calls[0]?.[0]).toBe("https://gold-revenue-os-staging.vercel.app/api/webhooks/private-beta-stars");
    expect(network.mock.calls[0]?.[1]?.redirect).toBe("error"); expect(new Headers(network.mock.calls[0]?.[1]?.headers).get("x-polat-stars-uat-signature")).toBe(starsUatRelaySignature(raw, timestamp, cfg.relaySecret));
  });
  it("does not expose or retry an unknown relay result", async () => {
    const cfg = { webhookSecret: config.webhookSecret, relaySecret: config.relaySecret, vercelBypass: "SYNTHETIC_PROJECT_ONLY_SSO_CREDENTIAL" }, network = vi.fn<typeof fetch>().mockRejectedValue(Error("PRIVATE_PROVIDER_SECRET"));
    const r = await handleStarsTestRelay(new Request("https://fixture.invalid", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": cfg.webhookSecret }, body: payment() }), cfg, network, now);
    expect(r.status).toBe(503); expect(await r.text()).not.toContain("PRIVATE"); expect(network).toHaveBeenCalledOnce();
  });
});
