import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { TestTelegramAccessAdapter, AuthorizedTelegramAccessAdapter, type AccessJob } from "../../apps/web/src/lib/entitlements/adapter";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
import { runTestEntitlementCycle } from "../../apps/web/src/lib/entitlements/service";

const tenant = "16de2000-0000-4000-8000-000000000001";
const maintenance = { version: 1, processed: 0, held: 0, expired: 0, renewal_due: 0, has_more: false, busy: false };
const queue = (value: unknown) => ({ version: 1, job: value, examined: value ? 1 : 0, stale: 0, review: 0, blocked: 0, has_more: false });
const job: AccessJob = { id: "16de8000-0000-4000-8000-000000000001", tenant_id: tenant,
  subscription_id: "16de8000-0000-4000-8000-000000000002", lease_token: "16de8000-0000-4000-8000-000000000003",
  mode: "test", operation: "invite", telegram_user_id: "test:123", chat_id: "test:vip", invite_reference: null,
  invite_expires_at: "2030-01-01T00:05:00Z" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN_IN_SYNTHETIC_TEST"); }));
  mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "entitlement_test_maintenance_v1" ? maintenance : name === "entitlement_test_claim_cycle_v1" ? queue(job) : true }));
});
afterEach(() => vi.unstubAllGlobals());

describe("16D registered TEST worker / no provider network", () => {
  it("does nothing when no lease is available", async () => {
    const execute = vi.fn();mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "entitlement_test_maintenance_v1" ? maintenance : queue(null) }));
    expect(await runTestEntitlementCycle(tenant, { execute })).toEqual({ processed: false, maintenance, queue: { examined: 0, stale: 0, review: 0, blocked: 0, has_more: false } });expect(execute).not.toHaveBeenCalled();
  });
  it.each(["entitlement_test_maintenance_v1", "entitlement_test_claim_cycle_v1"])("fails closed on %s error", async failing => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "entitlement_test_maintenance_v1" ? maintenance : null, error: name === failing ? { message: "private transport detail" } : null }));
    const execute = vi.fn();await expect(runTestEntitlementCycle(tenant, { execute })).rejects.toThrow(failing === "entitlement_test_maintenance_v1" ? "ENTITLEMENT_TICK_FAILED" : "ACCESS_CLAIM_FAILED");
    expect(execute).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalledWith("entitlement_complete_job", expect.anything());
  });
  it.each([{ ...job, tenant_id: "16de2000-0000-4000-8000-000000000002" }, { ...job, mode: "live" }])("rejects a foreign or live lease before transport", async input => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "entitlement_test_maintenance_v1" ? maintenance : queue(input) }));const execute = vi.fn();
    await expect(runTestEntitlementCycle(tenant, { execute })).rejects.toThrow(input.mode === "live" ? "LIVE_ACCESS_DISABLED" : "ACCESS_TENANT_MISMATCH");expect(execute).not.toHaveBeenCalled();
  });
  it("malformed lease evidence cannot reach transport", async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: queue({ ...job, lease_token: null }) });const execute = vi.fn();
    await expect(runTestEntitlementCycle(tenant, { execute })).rejects.toThrow();expect(execute).not.toHaveBeenCalled();
  });
  it("registered default transport creates only a TEST invitation and commits the exact lease", async () => {
    expect(await runTestEntitlementCycle(tenant)).toEqual({ processed: true, confirmed: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("entitlement_complete_job", { target_tenant_id: tenant, target_job_id: job.id,
      lease_value: job.lease_token, result_value: { ok: true, invite_reference: expect.stringMatching(/^test:invite:/u) as string, expires_at: job.invite_expires_at } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([null, true, { ...maintenance, processed: 26 }, { ...maintenance, processed: 1 }, { ...maintenance, busy: true }])("fails closed on malformed bounded maintenance (%j)", async data => {
    mocks.rpc.mockResolvedValue({ error: null, data });const execute = vi.fn();
    await expect(runTestEntitlementCycle(tenant, { execute })).rejects.toThrow();expect(execute).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith("entitlement_test_claim_cycle_v1", expect.anything());
  });
  it("reports deferred maintenance even when no access job is available", async () => {
    const partial = { ...maintenance, processed: 25, held: 9, expired: 8, renewal_due: 8, has_more: true };
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "entitlement_test_maintenance_v1" ? partial : queue(null) }));
    expect(await runTestEntitlementCycle(tenant)).toMatchObject({ processed: false, maintenance: partial });
    expect(mocks.rpc).not.toHaveBeenCalledWith("entitlement_tick", expect.anything());
  });
  it("uncertain adapter exception never reports confirmed or includes thrown secrets", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "entitlement_test_maintenance_v1" ? maintenance : name === "entitlement_test_claim_cycle_v1" ? queue(job) : name !== "entitlement_complete_job" }));
    const execute = vi.fn().mockRejectedValue(Error("fixture-private-not-for-audit"));
    expect(await runTestEntitlementCycle(tenant, { execute })).toEqual({ processed: true, confirmed: false });
    expect(mocks.rpc).toHaveBeenLastCalledWith("entitlement_complete_job", expect.objectContaining({ result_value: { ok: false, outcome: "unknown" } }));expect(execute).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("fixture-private-not-for-audit");
  });
  it("unknown completion outcome is not immediately replayed through a second provider call", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "entitlement_test_maintenance_v1" ? maintenance : name === "entitlement_test_claim_cycle_v1" ? queue(job) : true, error: name === "entitlement_complete_job" ? { message: "connection lost" } : null }));
    const execute = vi.fn().mockResolvedValue({ ok: true, invite_reference: "test:invite:once", expires_at: job.invite_expires_at });
    await expect(runTestEntitlementCycle(tenant, { execute })).rejects.toThrow("ACCESS_COMPLETION_REJECTED");expect(execute).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
  });
  it("persists dispatch authorization before invoking the TEST adapter", async () => {
    const execute = vi.fn(async () => {
      expect(mocks.rpc).toHaveBeenLastCalledWith("entitlement_test_begin_effect_v1", { target_tenant_id: tenant, target_job_id: job.id, lease_value: job.lease_token });
      return { ok: false };
    });
    await runTestEntitlementCycle(tenant, { execute });
    expect(execute).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenLastCalledWith("entitlement_complete_job", expect.objectContaining({ result_value: { ok: false } }));
  });
  it.each([false, null])("does not execute when begin-effect is not positively acknowledged (%s)", async data => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "entitlement_test_maintenance_v1" ? maintenance : name === "entitlement_test_claim_cycle_v1" ? queue(job) : name === "entitlement_test_begin_effect_v1" ? data : true }));
    const execute = vi.fn();expect(await runTestEntitlementCycle(tenant, { execute })).toEqual({ processed: true, confirmed: false });
    expect(execute).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalledWith("entitlement_complete_job", expect.anything());
  });
  it("lost begin-effect ACK does not invoke the adapter or blindly repeat", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: name === "entitlement_test_begin_effect_v1" ? { message: "fixture-private-detail" } : null, data: name === "entitlement_test_maintenance_v1" ? maintenance : name === "entitlement_test_claim_cycle_v1" ? queue(job) : true }));
    const execute = vi.fn();await expect(runTestEntitlementCycle(tenant, { execute })).rejects.toThrow("ACCESS_EFFECT_AUTHORIZATION_FAILED");
    expect(execute).not.toHaveBeenCalled();expect(mocks.rpc.mock.calls.filter(([name]: [string]) => name === "entitlement_test_begin_effect_v1")).toHaveLength(1);
  });
  it("reports a partially drained backlog without inventing an external completion", async () => {
    const progress = { ...queue(null), examined: 32, stale: 29, review: 2, blocked: 1, has_more: true };
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "entitlement_test_maintenance_v1" ? maintenance : progress }));const execute = vi.fn();
    expect(await runTestEntitlementCycle(tenant, { execute })).toEqual({ processed: false, maintenance, queue: { examined: 32, stale: 29, review: 2, blocked: 1, has_more: true } });
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([{}, { ok: "false" }, { ok: true, private_error: "not-for-logs" }])("malformed adapter result is uncertainty, never safe retry evidence", async result => {
    // Deliberately violates the adapter contract to exercise the runtime boundary.
    const execute = vi.fn().mockResolvedValue(result);
    expect(await runTestEntitlementCycle(tenant, { execute })).toEqual({ processed: true, confirmed: false });
    expect(mocks.rpc).toHaveBeenLastCalledWith("entitlement_complete_job", expect.objectContaining({ result_value: { ok: false, outcome: "unknown" } }));
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("not-for-logs");
  });
  it.each([{ ...queue(job), examined: 33 }, { ...queue(job), version: 2 }, { ...queue(job), financial_authority: "LIVE" }])("rejects malformed or unexpected queue authority", async data => {
    mocks.rpc.mockResolvedValue({ error: null, data });const execute = vi.fn();
    await expect(runTestEntitlementCycle(tenant, { execute })).rejects.toThrow();expect(execute).not.toHaveBeenCalled();
  });
  it("stale completion does not fabricate membership success", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "entitlement_test_maintenance_v1" ? maintenance : name === "entitlement_test_claim_cycle_v1" ? queue({ ...job, operation: "join" }) : name !== "entitlement_complete_job" }));
    expect(await runTestEntitlementCycle(tenant, new TestTelegramAccessAdapter())).toEqual({ processed: true, confirmed: false });
  });
  it("missing membership is reported as left for deterministic reconciliation", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "entitlement_test_maintenance_v1" ? maintenance : name === "entitlement_test_claim_cycle_v1" ? queue({ ...job, operation: "reconcile" }) : true }));
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
