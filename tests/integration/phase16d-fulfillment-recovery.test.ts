import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { TestTelegramAccessAdapter, AuthorizedTelegramAccessAdapter, type AccessJob } from "../../apps/web/src/lib/entitlements/adapter";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
import { runTestEntitlementCycle } from "../../apps/web/src/lib/entitlements/service";

const tenant = "16de2000-0000-4000-8000-000000000001";
const job: AccessJob = { id: "16de8000-0000-4000-8000-000000000001", tenant_id: tenant,
  subscription_id: "16de8000-0000-4000-8000-000000000002", lease_token: "16de8000-0000-4000-8000-000000000003",
  mode: "test", operation: "invite", telegram_user_id: "test:123", chat_id: "test:vip", invite_reference: null,
  invite_expires_at: "2030-01-01T00:05:00Z" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN_IN_SYNTHETIC_TEST"); }));
  mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "entitlement_claim_job" ? job : true }));
});
afterEach(() => vi.unstubAllGlobals());

describe("16D registered TEST worker / no provider network", () => {
  it("does nothing when no lease is available", async () => {
    const execute = vi.fn();mocks.rpc.mockResolvedValue({ error: null, data: null });
    expect(await runTestEntitlementCycle(tenant, { execute })).toEqual({ processed: false });expect(execute).not.toHaveBeenCalled();
  });
  it.each(["entitlement_tick", "entitlement_claim_job"])("fails closed on %s error", async failing => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: null, error: name === failing ? { message: "private transport detail" } : null }));
    const execute = vi.fn();await expect(runTestEntitlementCycle(tenant, { execute })).rejects.toThrow(failing === "entitlement_tick" ? "ENTITLEMENT_TICK_FAILED" : "ACCESS_CLAIM_FAILED");
    expect(execute).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalledWith("entitlement_complete_job", expect.anything());
  });
  it.each([{ ...job, tenant_id: "16de2000-0000-4000-8000-000000000002" }, { ...job, mode: "live" }])("rejects a foreign or live lease before transport", async input => {
    mocks.rpc.mockResolvedValue({ error: null, data: input });const execute = vi.fn();
    await expect(runTestEntitlementCycle(tenant, { execute })).rejects.toThrow(input.mode === "live" ? "LIVE_ACCESS_DISABLED" : "ACCESS_TENANT_MISMATCH");expect(execute).not.toHaveBeenCalled();
  });
  it("malformed lease evidence cannot reach transport", async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { ...job, lease_token: null } });const execute = vi.fn();
    await expect(runTestEntitlementCycle(tenant, { execute })).rejects.toThrow();expect(execute).not.toHaveBeenCalled();
  });
  it("registered default transport creates only a TEST invitation and commits the exact lease", async () => {
    expect(await runTestEntitlementCycle(tenant)).toEqual({ processed: true, confirmed: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("entitlement_complete_job", { target_tenant_id: tenant, target_job_id: job.id,
      lease_value: job.lease_token, result_value: { ok: true, invite_reference: expect.stringMatching(/^test:invite:/u) as string, expires_at: job.invite_expires_at } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("provider failure never reports confirmed or includes thrown secrets", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "entitlement_claim_job" ? job : name !== "entitlement_complete_job" }));
    const execute = vi.fn().mockRejectedValue(Error("fixture-private-not-for-audit"));
    expect(await runTestEntitlementCycle(tenant, { execute })).toEqual({ processed: true, confirmed: false });
    expect(mocks.rpc).toHaveBeenLastCalledWith("entitlement_complete_job", expect.objectContaining({ result_value: { ok: false } }));expect(execute).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("fixture-private-not-for-audit");
  });
  it("unknown completion outcome is not immediately replayed through a second provider call", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "entitlement_claim_job" ? job : null, error: name === "entitlement_complete_job" ? { message: "connection lost" } : null }));
    const execute = vi.fn().mockResolvedValue({ ok: true, invite_reference: "test:invite:once", expires_at: job.invite_expires_at });
    await expect(runTestEntitlementCycle(tenant, { execute })).rejects.toThrow("ACCESS_COMPLETION_REJECTED");expect(execute).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
  });
  it("stale completion does not fabricate membership success", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "entitlement_claim_job" ? { ...job, operation: "join" } : name !== "entitlement_complete_job" }));
    expect(await runTestEntitlementCycle(tenant, new TestTelegramAccessAdapter())).toEqual({ processed: true, confirmed: false });
  });
  it("missing membership is reported as left for deterministic reconciliation", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "entitlement_claim_job" ? { ...job, operation: "reconcile" } : true }));
    await runTestEntitlementCycle(tenant, new TestTelegramAccessAdapter("missing"));
    expect(mocks.rpc).toHaveBeenLastCalledWith("entitlement_complete_job", expect.objectContaining({ result_value: { ok: true, membership: "left" } }));expect(fetch).not.toHaveBeenCalled();
  });
});

describe("16D dormant API adapter / injected fake transport only", () => {
  const config = { enabled: true, botToken: "synthetic-not-a-credential", botUserId: "1", channelId: "-100123", userId: "123", ownerApproval: "offline-fixture" };
  const liveShape: AccessJob = { ...job, mode: "live", chat_id: config.channelId, telegram_user_id: config.userId, operation: "reconcile" };
  it.each([429, 500])("bounds a %s provider failure to one attempted fake request", async status => {
    const transport = vi.fn(async () => Response.json({ ok: false }, { status }));
    await expect(new AuthorizedTelegramAccessAdapter(config, transport).execute(liveShape)).rejects.toThrow("TELEGRAM_ACCESS_PROVIDER_FAILURE");expect(transport).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
  });
  it("permission loss prevents invite or approval", async () => {
    const transport = vi.fn().mockResolvedValueOnce(Response.json({ ok: true, result: { type: "channel" } })).mockResolvedValueOnce(Response.json({ ok: true, result: { status: "member" } }));
    await expect(new AuthorizedTelegramAccessAdapter(config, transport).execute({ ...liveShape, operation: "join" })).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(2);expect(fetch).not.toHaveBeenCalled();
  });
  it("a returned different identity cannot count as membership", async () => {
    const transport = vi.fn().mockResolvedValueOnce(Response.json({ ok: true, result: { type: "channel" } })).mockResolvedValueOnce(Response.json({ ok: true, result: { status: "administrator", can_invite_users: true, can_restrict_members: true } })).mockResolvedValueOnce(Response.json({ ok: true, result: { status: "member", user: { id: 999 } } }));
    await expect(new AuthorizedTelegramAccessAdapter(config, transport).execute(liveShape)).rejects.toThrow("TELEGRAM_IDENTITY_MISMATCH");expect(transport).toHaveBeenCalledTimes(3);expect(fetch).not.toHaveBeenCalled();
  });
});
