import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), connect: vi.fn(), create: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ getUserContext: m.context }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => Promise.resolve({ rpc: m.rpc }) }));
vi.mock("@/lib/payments/telegram-stars-uat-store", () => ({ createTelegramStarsUatFromDatabase: m.connect }));
import { POST, GET } from "../../apps/web/src/app/api/v1/admin/private-beta/stars-test-invoice/route";
const tenant = randomUUID(), program = randomUUID(), offer = randomUUID(), command = randomUUID(), invoice = randomUUID();
const url = "https://gold-revenue-os-staging.vercel.app/api/v1/admin/private-beta/stars-test-invoice";
const body = () => new URLSearchParams({ program_id: program, approved_offer_id: offer, command_id: command }).toString();
const request = (raw = body(), headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin: new URL(url).origin, "content-type": "application/x-www-form-urlencoded", ...headers }, body: raw });
beforeEach(() => {
  vi.clearAllMocks(); m.context.mockResolvedValue({ user: { id: randomUUID() }, tenants: [{ id: tenant, role: "super_admin" }] });
  m.rpc.mockResolvedValue({ error: null, data: { tenant_id: tenant, program_id: program, approved_offer_id: offer, command_id: command, repository_sha: "a".repeat(40), already_created: false, invoice_id: null } });
  m.create.mockResolvedValue({ invoice_id: invoice }); m.send.mockResolvedValue({ state: "ACKNOWLEDGED", value: { provider_message_id: "123" } });
  m.connect.mockResolvedValue({ state: "CONNECTED_TO_DEDICATED_TEST", createInvoice: m.create, sendInvoice: m.send });
});
describe("actual owner-only dedicated Stars TEST invoice endpoint; offline injected dependencies", () => {
  it("GET never creates an invoice or touches credentials/provider", () => { expect(GET().status).toBe(405); expect(m.rpc).not.toHaveBeenCalled(); expect(m.connect).not.toHaveBeenCalled(); });
  it("requires same origin before any authenticated/server work", async () => {
    expect((await POST(request(body(), { origin: "https://attacker.invalid" }))).status).toBe(403); expect(m.context).not.toHaveBeenCalled(); expect(m.connect).not.toHaveBeenCalled();
  });
  it("denies unauthenticated and non-owner roles without a provider load", async () => {
    m.context.mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(401);
    for (const role of ["manager", "support", "analyst", "readonly"]) { m.context.mockResolvedValueOnce({ user: { id: randomUUID() }, tenants: [{ id: tenant, role }] }); expect((await POST(request())).status).toBe(403); }
    expect(m.connect).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each(["tenant", "amount", "duplicate", "oversized", "json"])("rejects %s input instead of accepting client authority", async kind => {
    let raw = body(), headers: Record<string, string> = {};
    if (kind === "tenant") raw += "&tenant_id=" + randomUUID(); if (kind === "amount") raw += "&amount_units=1";
    if (kind === "duplicate") raw += "&program_id=" + program; if (kind === "oversized") raw += "x".repeat(513);
    if (kind === "json") { raw = JSON.stringify({ program_id: program }); headers = { "content-type": "application/json" }; }
    expect((await POST(request(raw, headers))).status).toBe(400); expect(m.rpc).not.toHaveBeenCalled(); expect(m.connect).not.toHaveBeenCalled();
  });
  it("stops at missing fresh MFA/control/price before credentials or network", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "PRIVATE_MFA_OR_CONTROL_REASON" } });
    const result = await POST(request()); expect(result.status).toBe(409); expect(await result.text()).not.toContain("PRIVATE_MFA"); expect(m.connect).not.toHaveBeenCalled();
  });
  it("derives tenant from authenticated selection and only acknowledges a TEST invoice, not payment", async () => {
    const r = await POST(request()); expect(r.status).toBe(200); expect(await r.json()).toEqual({ status: "TEST_INVOICE_ACKNOWLEDGED", invoice_id: invoice, origin: "TELEGRAM_DEDICATED_TEST", financial_authority: "NONE", receipt_created: false });
    expect(m.rpc).toHaveBeenCalledWith("admin_private_beta_stars_invoice_scope_v1", { target_tenant_id: tenant, program_id_value: program, approved_offer_id_value: offer, command_id_value: command });
    expect(m.connect).toHaveBeenCalledOnce(); expect(m.create).toHaveBeenCalledWith(offer, command); expect(m.send).toHaveBeenCalledOnce();
  });
  it("does not resend an existing command merely because the owner presses again", async () => {
    const current = await m.rpc(); m.rpc.mockResolvedValueOnce({ ...current, data: { ...current.data, already_created: true, invoice_id: invoice } });
    const r = await POST(request()); expect(await r.json()).toMatchObject({ status: "EXISTING_TEST_INVOICE_REVIEW", invoice_id: invoice }); expect(m.connect).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
  });
  it("rejects source/tenant drift and unknown provider outcomes without blind retry", async () => {
    const current = await m.rpc(); m.rpc.mockResolvedValueOnce({ ...current, data: { ...current.data, tenant_id: randomUUID() } });
    expect((await POST(request())).status).toBe(409); expect(m.connect).not.toHaveBeenCalled();
    m.rpc.mockResolvedValueOnce(current); m.send.mockResolvedValueOnce({ state: "UNKNOWN" });
    const r = await POST(request()); expect(r.status).toBe(409); expect(await r.json()).toMatchObject({ retry: "NONE", financial_authority: "NONE" }); expect(m.send).toHaveBeenCalledOnce();
  });
});
