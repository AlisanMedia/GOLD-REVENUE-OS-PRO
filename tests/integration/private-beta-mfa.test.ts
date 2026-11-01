import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "../../apps/web/node_modules/react";
import { renderToStaticMarkup as render } from "../../apps/web/node_modules/react-dom/server";
import { AdminI18nProvider } from "../../apps/web/src/components/admin-i18n";
import { PrivateBetaMfa } from "../../apps/web/src/components/private-beta-mfa";
import { createPrivateBetaMfaController, privateBetaMfaQrUri, submitPrivateBetaMfaRecovery, type PrivateBetaMfaApi } from "../../apps/web/src/lib/auth/private-beta-mfa";

const id = "b11a0000-0000-4000-8000-000000000001", foreign = "b11a0000-0000-4000-8000-000000000002", now = Date.parse("2026-10-26T10:20:00Z");
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><path fill="#fff" d="M0 0h21v21H0z"/><path stroke="#000" d="M1 1h1"/></svg>';
function api(verified = true) {
  const value = { id, factor_type: "totp", status: verified ? "verified" : "unverified" };
  return {
    listFactors: vi.fn().mockResolvedValue({ data: { all: verified ? [value] : [], totp: verified ? [value] : [] }, error: null }),
    getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: "aal1", currentAuthenticationMethods: [{ method: "password", timestamp: now / 1000 }] }, error: null }),
    enroll: vi.fn().mockResolvedValue({ data: { id, type: "totp", totp: { qr_code: "data:image/svg+xml;utf-8," + svg, secret: "ABCDEFGHIJKLMNOPQRSTUVWX" } }, error: null }),
    challengeAndVerify: vi.fn().mockResolvedValue({ data: { access_token: "OFFLINE_SESSION_NEVER_EXPOSE" }, error: null }),
  };
}
describe("private beta MFA genuine-session UX, offline validation only", () => {
  it("does not contact Auth, enroll or render a secret during SSR in either locale", () => {
    for (const locale of ["tr-TR", "en-US"] as const) {
      const html = render(h(AdminI18nProvider, { locale }, h(PrivateBetaMfa)));
      expect(html).toContain(locale === "tr-TR" ? "Hesap Güvenliğini Kontrol Et" : "Check Account Security");
      expect(html).not.toContain("data:image"); expect(html).not.toContain("ABCDEFGHIJKLMNOP"); expect(html).not.toContain("<input");
    }
  });
  it("reports only actual verified TOTP factors and never promotes password/iat freshness to MFA", async () => {
    const a = api(), c = createPrivateBetaMfaController(a, () => now), result = await c.inspect();
    expect(result).toEqual({ ok: true, factors: [{ id, label: 1 }], fresh: false, pendingEnrollment: false });
    expect(a.enroll).not.toHaveBeenCalled(); expect(a.challengeAndVerify).not.toHaveBeenCalled();
  });
  it("does not create duplicate factors or erase an unfinished enrollment", async () => {
    const a = api(), c = createPrivateBetaMfaController(a, () => now);
    expect(await c.enroll()).toEqual({ ok: false, error: "ALREADY_ENROLLED" });
    a.listFactors.mockResolvedValue({ data: { all: [{ id, factor_type: "totp", status: "unverified" }], totp: [] }, error: null });
    expect(await c.enroll()).toEqual({ ok: false, error: "ENROLLMENT_PENDING" }); expect(a.enroll).not.toHaveBeenCalled();
  });
  it("enrolls only after an explicit call and returns only bounded private setup material", async () => {
    const a = api(false), c = createPrivateBetaMfaController(a, () => now);
    const result = await c.enroll();
    expect(a.enroll).toHaveBeenCalledTimes(1); expect(a.enroll).toHaveBeenCalledWith({ factorType: "totp", friendlyName: "Polat VIP private beta" });
    expect(result.ok).toBe(true); expect(result.ok && result.factorId).toBe(id); expect(result.ok && result.qr).toContain("data:image/svg+xml;utf-8,%3Csvg");
  });
  it("finishes only its own enrollment after the provider verifies it", async () => {
    const a = api(false), c = createPrivateBetaMfaController(a, () => now);
    expect((await c.enroll()).ok).toBe(true);
    a.listFactors.mockResolvedValue({ data: { all: [{ id, factor_type: "totp", status: "unverified" }], totp: [] }, error: null });
    a.challengeAndVerify.mockImplementation(() => {
      a.listFactors.mockResolvedValue({ data: { all: [{ id, factor_type: "totp", status: "verified" }], totp: [{ id, factor_type: "totp", status: "verified" }] }, error: null });
      a.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2", currentAuthenticationMethods: [{ method: "totp", timestamp: now / 1000 }] }, error: null });
      return Promise.resolve({ data: { access_token: "OFFLINE_SESSION_NEVER_EXPOSE" }, error: null });
    });
    expect(await c.verify(id, "123456")).toEqual({ ok: true });
    expect(a.challengeAndVerify).toHaveBeenCalledTimes(1);
  });
  it("rejects foreign factor IDs and invalid codes before challenge", async () => {
    const a = api(), c = createPrivateBetaMfaController(a, () => now);
    expect(await c.verify(id, "12x456")).toEqual({ ok: false, error: "INVALID_CODE" });
    expect(await c.verify(foreign, "123456")).toEqual({ ok: false, error: "NO_FACTOR" }); expect(a.challengeAndVerify).not.toHaveBeenCalled();
  });
  it("requires a provider-issued aal2 session and current totp AMR after verification", async () => {
    const a = api(), c = createPrivateBetaMfaController(a, () => now);
    expect(await c.verify(id, "123456")).toEqual({ ok: false, error: "VERIFICATION_NOT_CONFIRMED" });
    a.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2", currentAuthenticationMethods: [{ method: "totp", timestamp: now / 1000 - 10 }] }, error: null });
    const verified = await c.verify(id, "123456"); expect(verified).toEqual({ ok: true }); expect(JSON.stringify(verified)).not.toContain("OFFLINE_SESSION");
  });
  it.each([now / 1000 - 301, now / 1000 + 1])("holds stale/future TOTP timestamp %s", async timestamp => {
    const a = api(); a.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2", currentAuthenticationMethods: [{ method: "totp", timestamp }] }, error: null });
    expect(await createPrivateBetaMfaController(a, () => now).verify(id, "123456")).toEqual({ ok: false, error: "VERIFICATION_NOT_CONFIRMED" });
  });
  it("does not leak provider errors and does not retry a failed challenge", async () => {
    const a = api(); a.challengeAndVerify.mockResolvedValue({ data: null, error: { message: "PRIVATE_PROVIDER_DETAIL" } });
    const result = await createPrivateBetaMfaController(a, () => now).verify(id, "123456");
    expect(result).toEqual({ ok: false, error: "INVALID_CODE" }); expect(a.challengeAndVerify).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toContain("PRIVATE_PROVIDER_DETAIL");
  });
  it("supports the pinned SDK field and fails closed on timestamp-free RFC8176 AMR", async () => {
    const a = api(); a.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2", currentAuthenticationMethods: ["password", "totp"] }, error: null });
    const c = createPrivateBetaMfaController(a, () => now);
    expect(await c.inspect()).toMatchObject({ ok: true, fresh: false });
    expect(await c.verify(id, "123456")).toEqual({ ok: false, error: "VERIFICATION_NOT_CONFIRMED" });
  });
  it.each(['<svg><script>alert(1)</script></svg>', '<svg><image href="https://evil.invalid"/></svg>', '<svg onload="x()"></svg>', '<svg><foreignObject/></svg>', '<svg><path style="fill:url(https://evil.invalid)"/></svg>'])("rejects unsafe provider SVG %s", value => expect(() => privateBetaMfaQrUri(value)).toThrow());

  it("projects the actual SVGo/goqrsvg envelope without allowing XML instructions, xlink references or arbitrary styles", () => {
    // Representative PUBLIC renderer format, not an actual QR or secret.
    const provider = '<?xml version="1.0"?>\n<!-- Generated by SVGo -->\n<svg width="9" height="9" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect x="0" y="0" width="3" height="3" style="fill:black;stroke:none"/></svg>';
    const projected = decodeURIComponent(privateBetaMfaQrUri("data:image/svg+xml;utf-8," + provider));
    expect(projected).toContain('fill="black" stroke="none"'); expect(projected).not.toContain("<?xml"); expect(projected).not.toContain("xmlns:xlink"); expect(projected).not.toContain("style=");
    for (const bad of [provider.replace('<?xml version="1.0"?>', '<?xml-stylesheet href="https://evil.invalid"?>'), provider.replace('style="fill:black;stroke:none"', 'style="fill:black;filter:url(https://evil.invalid)"'), provider.replace('width="3"', 'href="https://evil.invalid"'), '<!DOCTYPE svg SYSTEM "https://evil.invalid">' + svg]) expect(() => privateBetaMfaQrUri(bad)).toThrow("MFA_QR_INVALID");
  });
  it("supports ordinary dense provider QR rectangles beyond the previous 32KiB/1024-tag limits with a fixed upper bound", () => {
    const rectangles = '<rect x="0" y="0" width="3" height="3" style="fill:white;stroke:none"/>'.repeat(1500);
    expect(privateBetaMfaQrUri('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' + rectangles + '</svg>')).toContain("data:image/svg+xml;utf-8,");
    expect(() => privateBetaMfaQrUri("x".repeat(524289))).toThrow("MFA_QR_INVALID");
  });
  it("keeps a valid first-time enrollment usable through the manual key when a provider QR is unsupported", async () => {
    const a = api(false); a.enroll.mockResolvedValue({ data: { id, type: "totp", totp: { qr_code: '<svg><script>PRIVATE_UNSAFE_CONTENT</script></svg>', secret: "ABCDEFGHIJKLMNOPQRSTUVWX" } }, error: null });
    const result = await createPrivateBetaMfaController(a, () => now).enroll();
    expect(result).toMatchObject({ ok: true, factorId: id, qr: null, secret: "ABCDEFGHIJKLMNOPQRSTUVWX" }); expect(JSON.stringify(result)).not.toContain("PRIVATE_UNSAFE_CONTENT"); expect(a.challengeAndVerify).not.toHaveBeenCalled();
  });
  it("does not auto-recover or reenroll an abandoned factor; only a confirmed, server-authorized removal prepares a later setup", async () => {
    const a = api(false), recover = vi.fn<NonNullable<PrivateBetaMfaApi["recoverUnverifiedEnrollment"]>>();
    a.listFactors.mockResolvedValue({ data: { all: [{ id, factor_type: "totp", status: "unverified" }], totp: [] }, error: null });
    const c = createPrivateBetaMfaController({ ...a, recoverUnverifiedEnrollment: recover }, () => now);
    expect(await c.inspect()).toMatchObject({ ok: true, factors: [], pendingEnrollment: true });
    expect(await c.enroll()).toEqual({ ok: false, error: "ENROLLMENT_PENDING" }); expect(recover).not.toHaveBeenCalled();
    expect(await c.recover(false)).toEqual({ ok: false, error: "RECOVERY_CONFIRMATION_REQUIRED" }); expect(recover).not.toHaveBeenCalled();
    recover.mockImplementation(async () => { a.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null }); return { data: { recovered: true }, error: null }; });
    expect(await c.recover(true)).toEqual({ ok: true }); expect(recover).toHaveBeenCalledExactlyOnceWith({ factorId: id, confirmed: true }); expect(a.enroll).not.toHaveBeenCalled();
    expect((await c.enroll()).ok).toBe(true); expect(a.enroll).toHaveBeenCalledOnce();
  });
  it("requires reauthentication evidence from the server, never a client approval flag", async () => {
    const a = api(false), recover = vi.fn().mockResolvedValue({ data: null, error: { code: "RECOVERY_REAUTH_REQUIRED", message: "PRIVATE_PROVIDER_DETAIL" } });
    a.listFactors.mockResolvedValue({ data: { all: [{ id, factor_type: "totp", status: "unverified" }], totp: [] }, error: null });
    const c = createPrivateBetaMfaController({ ...a, recoverUnverifiedEnrollment: recover }, () => now); await c.inspect();
    expect(await c.recover(true)).toEqual({ ok: false, error: "RECOVERY_REAUTH_REQUIRED" }); expect(a.enroll).not.toHaveBeenCalled();
  });
  it("holds stale factor/account selections and verified-factor races before requesting recovery", async () => {
    for (const row of [{ id: foreign, factor_type: "totp", status: "unverified" }, { id, factor_type: "totp", status: "verified" }]) {
      const a = api(false), recover = vi.fn(); a.listFactors.mockResolvedValue({ data: { all: [{ id, factor_type: "totp", status: "unverified" }], totp: [] }, error: null });
      const c = createPrivateBetaMfaController({ ...a, recoverUnverifiedEnrollment: recover }, () => now); await c.inspect();
      a.listFactors.mockResolvedValue({ data: { all: [row], totp: [] }, error: null });
      expect(await c.recover(true)).toEqual({ ok: false, error: "RECOVERY_BLOCKED" }); expect(recover).not.toHaveBeenCalled();
    }
  });
  it("does not allow concurrent setup requests to create multiple first-time enrollments", async () => {
    const a = api(false); let release: (() => void) | undefined;
    a.enroll.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return { data: { id, type: "totp", totp: { qr_code: svg, secret: "ABCDEFGHIJKLMNOPQRSTUVWX" } }, error: null }; });
    const c = createPrivateBetaMfaController(a, () => now), first = c.enroll(); await vi.waitFor(() => expect(a.enroll).toHaveBeenCalledOnce());
    expect(await c.enroll()).toEqual({ ok: false, error: "UNAVAILABLE" }); release?.(); expect((await first).ok).toBe(true); expect(a.enroll).toHaveBeenCalledOnce();
  });
  it("the browser submits only a fixed same-origin recovery intent, with no token, tenant or secret", async () => {
    const network = vi.fn<typeof fetch>(async () => Response.json({ recovered: true }));
    expect(await submitPrivateBetaMfaRecovery({ factorId: id, confirmed: true }, network)).toEqual({ data: { recovered: true }, error: null });
    const [path, init] = network.mock.calls[0]!; expect(path).toBe("/api/v1/admin/private-beta/mfa-recovery"); expect(init).toMatchObject({ method: "POST", credentials: "same-origin", redirect: "error" });
    expect(String(init?.body)).toBe("factor_id=" + id + "&confirmed=yes"); expect(network).toHaveBeenCalledOnce();
  });
});
