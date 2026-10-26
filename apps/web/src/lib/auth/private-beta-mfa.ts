import { z } from "zod";

type ApiResult = Promise<{ data: unknown; error: unknown }>;
export type PrivateBetaMfaApi = Readonly<{
  listFactors: () => ApiResult;
  getAuthenticatorAssuranceLevel: () => ApiResult;
  enroll: (value: { factorType: "totp"; friendlyName: string }) => ApiResult;
  challengeAndVerify: (value: { factorId: string; code: string }) => ApiResult;
}>;
const factor = z.object({ id: z.uuid(), factor_type: z.string(), status: z.enum(["verified", "unverified"]) });
const factors = z.object({ all: z.array(factor).max(10), totp: z.array(factor).max(10) });
const assurance = z.object({ currentLevel: z.enum(["aal1", "aal2"]), currentAuthenticationMethods: z.array(z.union([z.string().max(80), z.object({ method: z.string(), timestamp: z.number().int().nonnegative().safe() })])).max(20) });
const enrollment = z.object({ id: z.uuid(), type: z.literal("totp"), totp: z.object({ qr_code: z.string().min(1).max(32768), secret: z.string().regex(/^[A-Za-z2-7]{16,128}={0,6}$/u) }) });
export type PrivateBetaMfaFactor = Readonly<{ id: string; label: number }>;
export type PrivateBetaMfaFailure = "UNAVAILABLE" | "INVALID_CODE" | "NO_FACTOR" | "ENROLLMENT_PENDING" | "ALREADY_ENROLLED" | "VERIFICATION_NOT_CONFIRMED";

/** Only provider QR vector markup; no active markup, remote image or unsafe HTML insertion. */
export function privateBetaMfaQrUri(raw: string) {
  if (raw.length > 32768) throw Error("MFA_QR_INVALID");
  const prefix = "data:image/svg+xml;utf-8,";
  let svg = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  if (!svg.trimStart().startsWith("<")) svg = decodeURIComponent(svg);
  if (!/^\s*<svg\b[\s\S]*<\/svg>\s*$/u.test(svg) || /<!|<\?|\bon[a-z]+\s*=|\bhref\s*=|url\s*\(|javascript:|<style\b/iu.test(svg)) throw Error("MFA_QR_INVALID");
  const tags = [...svg.matchAll(/<\/?([A-Za-z][A-Za-z0-9:_-]*)\b/gu)];
  if (!tags.length || tags.length > 1024 || tags.some(v => !["svg", "path", "rect", "g", "circle"].includes(v[1]!))) throw Error("MFA_QR_INVALID");
  const attributes = [...svg.matchAll(/\s([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=/gu)];
  if (attributes.some(v => !["xmlns", "viewBox", "width", "height", "fill", "stroke", "stroke-width", "d", "x", "y", "rx", "ry", "cx", "cy", "r", "transform", "shape-rendering"].includes(v[1]!))) throw Error("MFA_QR_INVALID");
  return prefix + encodeURIComponent(svg);
}
/** UX coordinator only. Supabase's verified session and SQL MFA/role guards remain authoritative. */
export function createPrivateBetaMfaController(api: PrivateBetaMfaApi, now: () => number = Date.now) {
  let ownEnrollment: string | null = null;
  async function read() {
    const result = await api.listFactors();
    if (result.error) throw Error("UNAVAILABLE");
    const value = factors.parse(result.data);
    const verified = value.totp.filter(f => f.factor_type === "totp" && f.status === "verified");
    const selected: PrivateBetaMfaFactor[] = verified.map((f, index) => ({ id: f.id, label: index + 1 }));
    const level = await api.getAuthenticatorAssuranceLevel();
    if (level.error) throw Error("UNAVAILABLE");
    const current = assurance.parse(level.data), clock = now();
    const fresh = Number.isFinite(clock) && current.currentLevel === "aal2" && current.currentAuthenticationMethods.some(m => typeof m !== "string" && m.method === "totp" && m.timestamp * 1000 <= clock && clock - m.timestamp * 1000 <= 300000);
    return { factors: selected, fresh, pendingEnrollment: value.all.some(f => f.factor_type === "totp" && f.status === "unverified") };
  }
  return Object.freeze({
    async inspect() { try { return { ok: true as const, ...await read() }; } catch { return { ok: false as const, error: "UNAVAILABLE" as const }; } },
    async enroll() {
      try {
        const current = await read();
        if (current.factors.length) return { ok: false as const, error: "ALREADY_ENROLLED" as const };
        if (current.pendingEnrollment) return { ok: false as const, error: "ENROLLMENT_PENDING" as const };
        const result = await api.enroll({ factorType: "totp", friendlyName: "Polat VIP private beta" });
        if (result.error) throw Error("unavailable");
        const value = enrollment.parse(result.data);
        ownEnrollment = value.id;
        return { ok: true as const, factorId: value.id, qr: privateBetaMfaQrUri(value.totp.qr_code), secret: value.totp.secret };
      } catch { return { ok: false as const, error: "UNAVAILABLE" as const }; }
    },
    async verify(factorId: string, code: string) {
      if (!z.uuid().safeParse(factorId).success || !/^\d{6}$/u.test(code)) return { ok: false as const, error: "INVALID_CODE" as const };
      try {
        const current = await read();
        if (!current.factors.some(f => f.id === factorId) && ownEnrollment !== factorId) return { ok: false as const, error: "NO_FACTOR" as const };
        const result = await api.challengeAndVerify({ factorId, code });
        if (result.error) return { ok: false as const, error: "INVALID_CODE" as const };
        const confirmed = await read();
        if (!confirmed.fresh || !confirmed.factors.some(f => f.id === factorId)) return { ok: false as const, error: "VERIFICATION_NOT_CONFIRMED" as const };
        ownEnrollment = null;
        return { ok: true as const };
      } catch { return { ok: false as const, error: "UNAVAILABLE" as const }; }
    },
  });
}
