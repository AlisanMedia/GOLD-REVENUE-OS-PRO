import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ context: vi.fn(), session: vi.fn(), user: vi.fn(), claims: vi.fn(), insert: vi.fn(), single: vi.fn(), admin: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getUserContext: state.context }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getSession: state.session, getUser: state.user, getClaims: state.claims } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: state.admin }));
vi.mock("@/lib/env", () => ({ publicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "https://auth.fixture.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "SYNTHETIC_PUBLISHABLE" }) }));
import { recoverUnfinishedMfa, recoverOwnUnfinishedMfa, unenrollMfaWithUserSession, type MfaRecoveryDependencies } from "../../apps/web/src/lib/auth/mfa-enrollment-recovery";

const USER = "b1510000-0000-4000-8000-000000000001", TENANT = "b1520000-0000-4000-8000-000000000001", FACTOR = "b1530000-0000-4000-8000-000000000001", OTHER = "b1540000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-11-01T18:00:00Z"), TOKEN = "SYNTHETIC_OWN_AAL1_SESSION_NEVER_EXPOSE";
const factor = () => ({ id: FACTOR, factor_type: "totp", status: "unverified" });
const actor = () => ({ userId: USER, tenantId: TENANT, role: "super_admin", sessionUserId: USER, aal: "aal1", methods: [{ method: "password", timestamp: NOW / 1000 - 10 }] });
function dependencies() {
  const calls: string[] = [];
  const value = {
    actor: vi.fn<MfaRecoveryDependencies["actor"]>(async () => { calls.push("actor"); return actor(); }),
    factors: vi.fn().mockImplementationOnce(async () => { calls.push("factors"); return [factor()]; }).mockImplementation(async () => { calls.push("factors"); return []; }),
    unenroll: vi.fn<MfaRecoveryDependencies["unenroll"]>(async () => { calls.push("unenroll"); return "ACKNOWLEDGED" as const; }),
    audit: vi.fn<MfaRecoveryDependencies["audit"]>(async stage => { calls.push("audit:" + stage); }), now: () => NOW,
  } satisfies MfaRecoveryDependencies;
  return { value, calls };
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("authorized abandoned-enrollment recovery, offline Auth boundary", () => {
  it("requires fresh same-user ownership, persists intent before one unverified-only effect and independently checks absence", async () => {
    const { value, calls } = dependencies();
    expect(await recoverUnfinishedMfa({ factorId: FACTOR, confirmed: true }, value)).toEqual({ status: 200, data: { recovered: true } });
    expect(calls).toEqual(["actor", "factors", "audit:requested", "unenroll", "factors", "audit:completed"]);
    expect(value.unenroll).toHaveBeenCalledExactlyOnceWith(FACTOR);
    expect(value.audit.mock.calls[0]?.[2]).toMatch(/^[a-f0-9]{64}$/u); expect(JSON.stringify(value.audit.mock.calls)).not.toContain(FACTOR);
  });
  it.each([false, undefined])("does nothing without explicit recovery confirmation (%s)", async confirmed => {
    const { value } = dependencies(); expect((await recoverUnfinishedMfa({ factorId: FACTOR, confirmed: Boolean(confirmed) }, value)).status).toBe(409);
    expect(value.actor).not.toHaveBeenCalled(); expect(value.unenroll).not.toHaveBeenCalled(); expect(value.audit).not.toHaveBeenCalled();
  });
  it.each(["unauthenticated", "role", "foreign-session", "aal2", "stale-password", "timestamp-free", "future", "refreshed-iat"])("cannot recover with %s authority", async mode => {
    const { value } = dependencies(); const owner = actor();
    if (mode === "role") owner.role = "support"; if (mode === "foreign-session") owner.sessionUserId = OTHER;
    if (mode === "aal2") owner.aal = "aal2"; if (mode === "stale-password" || mode === "refreshed-iat") owner.methods[0]!.timestamp = NOW / 1000 - 301;
    if (mode === "future") owner.methods[0]!.timestamp = NOW / 1000 + 1;
    value.actor.mockResolvedValue(mode === "unauthenticated" ? null : mode === "timestamp-free" ? { ...owner, methods: ["password"] } : { ...owner, iat: NOW / 1000 });
    const result = await recoverUnfinishedMfa({ factorId: FACTOR, confirmed: true }, value);
    expect(result.status).not.toBe(200); expect(value.factors).not.toHaveBeenCalled(); expect(value.audit).not.toHaveBeenCalled(); expect(value.unenroll).not.toHaveBeenCalled();
  });
  it.each(["verified", "verified-phone", "multiple", "foreign-factor", "missing"])("protects %s factors without mutation or bulk cleanup", async mode => {
    const { value } = dependencies(); const rows = mode === "verified" ? [{ ...factor(), status: "verified" }] : mode === "verified-phone" ? [factor(), { id: OTHER, factor_type: "phone", status: "verified" }] : mode === "multiple" ? [factor(), { ...factor(), id: OTHER }] : mode === "foreign-factor" ? [{ ...factor(), id: OTHER }] : [];
    value.factors.mockReset().mockResolvedValue(rows);
    expect(await recoverUnfinishedMfa({ factorId: FACTOR, confirmed: true }, value)).toEqual({ status: 409, error: "RECOVERY_BLOCKED" });
    expect(value.unenroll).not.toHaveBeenCalled(); expect(value.audit).not.toHaveBeenCalled();
  });
  it("cannot mutate if append-only intent custody fails", async () => {
    const { value } = dependencies(); value.audit.mockRejectedValue(Error(TOKEN));
    const result = await recoverUnfinishedMfa({ factorId: FACTOR, confirmed: true }, value);
    expect(result).toEqual({ status: 503, error: "UNAVAILABLE" }); expect(value.unenroll).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
  it.each(["REJECTED", "UNKNOWN"] as const)("records %s and never retries or enrolls a replacement", async outcome => {
    const { value } = dependencies(); value.unenroll.mockResolvedValue(outcome);
    const result = await recoverUnfinishedMfa({ factorId: FACTOR, confirmed: true }, value);
    expect(result.status).toBe(409); expect(value.unenroll).toHaveBeenCalledOnce(); expect(value.factors).toHaveBeenCalledOnce();
    expect(value.audit.mock.calls.map(c => c[0])).toEqual(["requested", outcome === "REJECTED" ? "blocked" : "unknown"]);
  });
  it.each(["still-present", "verification-race", "readback-error", "audit-error"])("does not claim completion after %s", async mode => {
    const { value } = dependencies();
    if (mode === "still-present") value.factors.mockImplementation(async () => [factor()]);
    if (mode === "verification-race") value.factors.mockReset().mockResolvedValueOnce([factor()]).mockResolvedValue([{ ...factor(), status: "verified" }]);
    if (mode === "readback-error") value.factors.mockReset().mockResolvedValueOnce([factor()]).mockRejectedValue(Error(TOKEN));
    if (mode === "audit-error") value.audit.mockResolvedValueOnce(undefined).mockRejectedValue(Error(TOKEN));
    const result = await recoverUnfinishedMfa({ factorId: FACTOR, confirmed: true }, value);
    expect(result).toEqual({ status: 409, error: "RECOVERY_NOT_CONFIRMED" }); expect(value.unenroll).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

function response(url: string, value: unknown, status = 200) {
  const result = new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); Object.defineProperty(result, "url", { value: url }); return result;
}
const httpInput = () => ({ supabaseUrl: "https://auth.fixture.invalid", publishableKey: "SYNTHETIC_PUBLISHABLE", accessToken: TOKEN, factorId: FACTOR });
describe("own-session Auth unenroll transport, offline network only", () => {
  it("uses the captured AAL1 token on one fixed own-factor DELETE, with no admin mutation, refresh or session revocation", async () => {
    const network = vi.fn<typeof fetch>(async url => response(String(url), { id: FACTOR }));
    expect(await unenrollMfaWithUserSession(httpInput(), network)).toBe("ACKNOWLEDGED");
    const [url, init] = network.mock.calls[0]!; expect(url).toBe("https://auth.fixture.invalid/auth/v1/factors/" + FACTOR);
    expect(init).toMatchObject({ method: "DELETE", redirect: "error", cache: "no-store", headers: { apikey: "SYNTHETIC_PUBLISHABLE", authorization: "Bearer " + TOKEN } });
    expect(network).toHaveBeenCalledOnce(); expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([401, 403, 404, 422, 429])("holds actual Auth HTTP %i without a retry or reflected error text", async status => {
    const network = vi.fn<typeof fetch>(async url => response(String(url), { message: TOKEN }, status));
    expect(await unenrollMfaWithUserSession(httpInput(), network)).toBe("REJECTED"); expect(network).toHaveBeenCalledOnce();
  });
  it.each(["modeless-id", "extra-fields", "wrong-origin", "huge", "server-error"])("treats %s as unknown rather than success", async mode => {
    const network = vi.fn<typeof fetch>(async url => response(mode === "wrong-origin" ? "https://other.invalid" : String(url), mode === "modeless-id" ? { id: OTHER } : mode === "extra-fields" ? { id: FACTOR, secret: TOKEN } : mode === "huge" ? { filler: "x".repeat(5000) } : { id: FACTOR }, mode === "server-error" ? 500 : 200));
    expect(await unenrollMfaWithUserSession(httpInput(), network)).toBe("UNKNOWN"); expect(network).toHaveBeenCalledOnce();
  });
  it.each(["headers", "body"])("times out stalled %s and never retries an unknown deletion", async mode => {
    vi.useFakeTimers();
    const network = vi.fn<typeof fetch>(async url => {
      if (mode === "headers") return new Promise<Response>(() => undefined);
      const result = new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"id":')); } }), { headers: { "content-type": "application/json" } }); Object.defineProperty(result, "url", { value: String(url) }); return result;
    });
    const pending = unenrollMfaWithUserSession(httpInput(), network); await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toBe("UNKNOWN"); expect(network).toHaveBeenCalledOnce();
  });
});

describe("server-owned identity, tenant and audit integration, offline dependencies", () => {
  beforeEach(() => {
    state.context.mockResolvedValue({ user: { id: USER }, tenants: [{ id: TENANT, role: "super_admin" }] });
    state.session.mockResolvedValue({ data: { session: { access_token: TOKEN } }, error: null });
    state.claims.mockResolvedValue({ data: { claims: { sub: USER, aal: "aal1", amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] } }, error: null });
    state.user.mockResolvedValue({ data: { user: { id: USER, factors: [factor()] } }, error: null });
    state.single.mockResolvedValue({ data: { id: 1 }, error: null });
    state.insert.mockReturnValue({ select: () => ({ single: state.single }) }); state.admin.mockReturnValue({ from: () => ({ insert: state.insert }) });
  });
  it("derives tenant/actor from the validated session and appends only hashes; no credentials or setup material enter audit/results", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(async url => { state.user.mockResolvedValue({ data: { user: { id: USER, factors: [] } }, error: null }); return response(String(url), { id: FACTOR }); });
    const result = await recoverOwnUnfinishedMfa({ factorId: FACTOR, confirmed: true });
    expect(result.status).toBe(200); expect(state.user).toHaveBeenCalledWith(TOKEN); expect(state.claims).toHaveBeenCalledExactlyOnceWith(TOKEN); expect(network).toHaveBeenCalledOnce();
    expect(state.insert).toHaveBeenCalledTimes(2);
    for (const call of state.insert.mock.calls) { expect(call[0]).toMatchObject({ tenant_id: TENANT, actor_id: USER, actor_type: "HUMAN" }); expect(call[0].entity_id).toMatch(/^[a-f0-9]{64}$/u); }
    for (const secret of [TOKEN, FACTOR]) { expect(JSON.stringify(state.insert.mock.calls)).not.toContain(secret); expect(JSON.stringify(result)).not.toContain(secret); }
  });
  it.each(["unauthenticated", "support", "membership", "foreign-claims", "verified", "stale"])("refuses %s before Auth mutation or admin audit credential access", async mode => {
    if (mode === "unauthenticated") state.context.mockResolvedValue(null);
    if (mode === "support") state.context.mockResolvedValue({ user: { id: USER }, tenants: [{ id: TENANT, role: "support" }] });
    if (mode === "membership") state.context.mockResolvedValue({ user: { id: USER }, tenants: [] });
    if (mode === "foreign-claims") state.claims.mockResolvedValue({ data: { claims: { sub: OTHER } }, error: null });
    if (mode === "verified") state.user.mockResolvedValue({ data: { user: { id: USER, factors: [{ ...factor(), status: "verified" }] } }, error: null });
    if (mode === "stale") state.claims.mockResolvedValue({ data: { claims: { sub: USER, aal: "aal1", amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - 301 }], iat: Math.floor(Date.now() / 1000) } }, error: null });
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("UNEXPECTED_OFFLINE_NETWORK"));
    expect((await recoverOwnUnfinishedMfa({ factorId: FACTOR, confirmed: true })).status).not.toBe(200);
    expect(network).not.toHaveBeenCalled(); expect(state.admin).not.toHaveBeenCalled();
  });
});
