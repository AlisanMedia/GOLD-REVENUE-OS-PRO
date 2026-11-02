import { describe, expect, it, vi } from "vitest";
import { waitForPrivateBetaFounder } from "../../scripts/private-beta-founder-wait.mjs";
const sha = "a".repeat(40), program = "93be2000-0000-4000-8000-000000000001";
const env = () => ({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "AlisanMedia/GOLD-REVENUE-OS-PRO", GITHUB_SHA: sha, VALIDATED_SHA: sha, PRIVATE_BETA_PROGRAM_ID: program, FOUNDER_SETUP_WAIT: "CANARY", SUPABASE_ACCESS_TOKEN: "SYNTHETIC_MANAGEMENT_TOKEN_NOT_A_SECRET" });
const row = () => ({ role: "postgres", stage: "CANARY", canary_ready: true, local_scope: true, release_matches: true, business_configured: false, held: false });
function response(value: unknown, status = 200) { const r = new Response(JSON.stringify([{ setup: value }]), { status, headers: { "content-type": "application/json" } }); Object.defineProperty(r, "url", { value: "https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query" }); return r; }
describe("protected owner setup status observer (offline HTTP)", () => {
  it("observes real durable readiness from documented query201 JSON without inference or retries", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(row(), 201)), delay = vi.fn();
    expect(await waitForPrivateBetaFounder({ env: env(), request, delay })).toMatchObject({ ready: true, state: "READY", model_requests: 0, telegram_messages: 0 });
    expect(request).toHaveBeenCalledOnce(); expect(delay).not.toHaveBeenCalled();
  });
  it.each(["empty", "duplicate", "wrong-role", "foreign-url", "http202"])("holds untrusted query201/read status (%s) instead of polling or claiming readiness", async kind => {
    let r = response({ ...row(), ...(kind === "wrong-role" ? { role: "authenticated" } : {}) }, kind === "http202" ? 202 : 201);
    if (kind === "empty" || kind === "duplicate") {
      r = new Response(kind === "empty" ? null : '[{"setup":{},"setup":{}}]', { status: 201, headers: { "content-type": "application/json" } });
      Object.defineProperty(r, "url", { value: "https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query" });
    }
    if (kind === "foreign-url") { r = new Response(r.body, { status: r.status, headers: r.headers }); Object.defineProperty(r, "url", { value: "https://foreign.invalid" }); }
    const request = vi.fn<typeof fetch>().mockResolvedValue(r), delay = vi.fn();
    expect(await waitForPrivateBetaFounder({ env: env(), request, delay })).toMatchObject({ ready: false, state: "STATUS_READ_UNVERIFIED" }); expect(request).toHaveBeenCalledOnce(); expect(delay).not.toHaveBeenCalled();
  });
  it("uses only fixed private status SELECTs and authentic durable canary state", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(row())), delay = vi.fn();
    expect(await waitForPrivateBetaFounder({ env: env(), request, delay })).toMatchObject({ ready: true, state: "READY", model_requests: 0, telegram_messages: 0 });
    const [url, init] = request.mock.calls[0]!; expect(url).toBe("https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query");
    const query = JSON.parse(String(init?.body)).query as string;
    expect(query).toContain("private.private_beta_founder_canary_hash(p)"); expect(query).toContain(program); expect(query).toContain(sha);
    expect(query).not.toMatch(/set_config|insert |update |delete |verified\s*=/iu); expect(delay).not.toHaveBeenCalled();
  });
  it.each(["role", "canary_ready", "local_scope", "release_matches", "stage"])("does not call an owner status ready when %s is untrusted or incomplete", async field => {
    const value: Record<string, unknown> = row(); value[field] = field === "role" ? "authenticated" : field === "stage" ? "DRAFT" : false;
    const request = vi.fn<typeof fetch>().mockImplementation(async () => response(value)), delay = vi.fn().mockResolvedValue(undefined);
    const result = await waitForPrivateBetaFounder({ env: env(), request, delay }); expect(result.ready).toBe(false); expect(request.mock.calls.length).toBeLessThanOrEqual(33);
  });
  it("cannot replace the founder's Business configuration with canary success alone", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => response(row())), delay = vi.fn().mockResolvedValue(undefined);
    expect(await waitForPrivateBetaFounder({ env: { ...env(), FOUNDER_SETUP_WAIT: "BUSINESS" }, request, delay })).toMatchObject({ ready: false, state: "OWNER_ACTION_REQUIRED" });
    expect(request).toHaveBeenCalledTimes(21); expect(delay).toHaveBeenCalledTimes(20);
  });
  it("stops observing on an unknown outcome, a stop or a read failure, without retry", async () => {
    for (const value of [{ ...row(), held: true }, { ...row(), stage: "STOPPED" }]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(response(value));
      expect(await waitForPrivateBetaFounder({ env: env(), request })).toMatchObject({ ready: false, state: "HELD" }); expect(request).toHaveBeenCalledTimes(1);
    }
    const request = vi.fn<typeof fetch>().mockRejectedValue(Error("SYNTHETIC_TOKEN_MUST_NOT_APPEAR"));
    const result = await waitForPrivateBetaFounder({ env: env(), request }); expect(result.state).toBe("STATUS_READ_UNVERIFIED"); expect(JSON.stringify(result)).not.toContain("SYNTHETIC_TOKEN"); expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects a non-main execution before credential/network use", async () => {
    const request = vi.fn<typeof fetch>();
    expect((await waitForPrivateBetaFounder({ env: { ...env(), GITHUB_REF: "refs/heads/test" }, request })).ready).toBe(false); expect(request).not.toHaveBeenCalled();
  });
});
