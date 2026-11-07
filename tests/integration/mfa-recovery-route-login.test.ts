import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup as render } from "../../apps/web/node_modules/react-dom/server";

const state = vi.hoisted(() => ({ recover: vi.fn(), signin: vi.fn(), redirect: vi.fn((path: string) => { throw Error("FIXTURE_REDIRECT:" + path); }) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/mfa-enrollment-recovery", () => ({ recoverOwnUnfinishedMfa: state.recover }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { signInWithPassword: state.signin } }) }));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
import { POST } from "../../apps/web/src/app/api/v1/admin/private-beta/mfa-recovery/route";
import { signIn } from "../../apps/web/src/app/(auth)/login/actions";
import LoginPage from "../../apps/web/src/app/(auth)/login/page";

const factor = "b1530000-0000-4000-8000-000000000001";
function request(body = "factor_id=" + factor + "&confirmed=yes", origin = "https://fixture.invalid", type = "application/x-www-form-urlencoded") {
  return new Request("https://fixture.invalid/api/v1/admin/private-beta/mfa-recovery", { method: "POST", headers: { origin, "content-type": type }, body });
}
beforeEach(() => { vi.clearAllMocks(); state.recover.mockResolvedValue({ status: 200, data: { recovered: true } }); state.signin.mockResolvedValue({ error: null }); });

describe("same-origin owner recovery route, offline server boundary", () => {
  it("accepts only the expected factor and explicit intent; leaves user, tenant and fresh authentication to the server", async () => {
    const result = await POST(request()); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({ recovered: true }); expect(state.recover).toHaveBeenCalledExactlyOnceWith({ factorId: factor, confirmed: true });
  });
  it("rejects another origin before any identity lookup or effect", async () => {
    expect((await POST(request(undefined, "https://attacker.invalid"))).status).toBe(403); expect(state.recover).not.toHaveBeenCalled();
  });
  it.each([
    "factor_id=" + factor,
    "factor_id=" + factor + "&confirmed=no",
    "factor_id=" + factor + "&confirmed=yes&confirmed=yes",
    "factor_id=" + factor + "&factor_id=" + factor + "&confirmed=yes",
    "factor_id=" + factor + "&confirmed=yes&tenant_id=" + factor,
    "factor_id=" + factor + "&confirmed=yes&verified=true",
    "factor_id=foreign&confirmed=yes",
    "factor_id=" + "x".repeat(600) + "&confirmed=yes",
  ])("rejects malformed, duplicate or authority-bearing form %j", async body => {
    expect((await POST(request(body))).status).toBe(400); expect(state.recover).not.toHaveBeenCalled();
  });
  it("does not accept JSON approval documents or convert an uncertain result into success", async () => {
    expect((await POST(request(JSON.stringify({ factor_id: factor, confirmed: true }), undefined, "application/json"))).status).toBe(400); expect(state.recover).not.toHaveBeenCalled();
    state.recover.mockResolvedValue({ status: 409, error: "RECOVERY_NOT_CONFIRMED" });
    const result = await POST(request()); expect(result.status).toBe(409); expect(await result.json()).toEqual({ error: "RECOVERY_NOT_CONFIRMED", retry: "NONE" });
  });
  it("never reflects raw provider errors or authentication material", async () => {
    state.recover.mockRejectedValue(Error("SYNTHETIC_SECRET_NOT_FOR_OUTPUT"));
    const result = await POST(request()); expect(result.status).toBe(503); expect(await result.text()).not.toContain("SYNTHETIC_SECRET"); expect(state.recover).toHaveBeenCalledOnce();
  });
});

function form(mode: string | null = "1") {
  const value = new FormData(); value.set("email", "fixture@example.invalid"); value.set("password", "SYNTHETIC_EXISTING_PASSWORD"); if (mode !== null) value.set("mfa_recovery", mode); return value;
}
describe("existing-account reauthentication return path", () => {
  it("shows the existing sign-in form and a fixed recovery context without starting Auth, deleting factors or rendering setup material", async () => {
    const html = render(await LoginPage({ searchParams: Promise.resolve({ mfa_recovery: "1" }) }));
    expect(html).toContain('name="mfa_recovery"'); expect(html).toContain("same account"); expect(html).toContain('autoComplete="current-password"'); expect(html).not.toContain("data:image"); expect(state.signin).not.toHaveBeenCalled(); expect(state.recover).not.toHaveBeenCalled();
  });
  it("reauthenticates through the existing password API and returns only to the fixed private MFA panel", async () => {
    await expect(signIn(form())).rejects.toThrow("FIXTURE_REDIRECT:/admin/jeff-operations?view=beta#private-beta-mfa-title");
    expect(state.signin).toHaveBeenCalledExactlyOnceWith({ email: "fixture@example.invalid", password: "SYNTHETIC_EXISTING_PASSWORD" }); expect(state.recover).not.toHaveBeenCalled();
  });
  it("retains the recovery context after invalid credentials and does not grant recovery from a form flag", async () => {
    state.signin.mockResolvedValue({ error: { message: "PRIVATE_AUTH_ERROR" } });
    await expect(signIn(form())).rejects.toThrow("FIXTURE_REDIRECT:/login?mfa_recovery=1&error=invalid"); expect(state.recover).not.toHaveBeenCalled();
  });
  it("preserves the ordinary sign-in destination and ignores untrusted redirect URLs", async () => {
    for (const mode of [null, "https://attacker.invalid"]) {
      const input = form(mode); input.set("return_to", "https://attacker.invalid");
      await expect(signIn(input)).rejects.toThrow("FIXTURE_REDIRECT:/admin");
    }
  });
});
