import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { authenticatePrivateBetaIngress, authenticatePrivateBetaUpdate } from "../../apps/web/src/lib/polat/private-beta-webhook";
import { consumePrivateBetaBusinessSendPermit, privateBetaBusinessUpdateId, verifyPrivateBetaBusinessSend } from "../../apps/web/src/lib/polat/private-beta-business";

const now = Date.parse("2026-10-27T09:00:00Z"), founder = "7100000002", representative = "7100000003", bot = "7100000001";
const credential = bot + ":OFFLINE_BUSINESS_FIXTURE_CREDENTIAL_ONLY";
const config = { tenantId: "92cb1000-0000-4000-8000-000000000001", programId: "92cb1000-0000-4000-8000-000000000002", releaseSha: "f".repeat(40), webhookSecret: "OFFLINE_WEBHOOK_".padEnd(48, "x"), relaySecret: "OFFLINE_RELAY_".padEnd(48, "y") };
function scope() { return { version: 2, mode: "BUSINESS", program_id: config.programId, tenant_id: config.tenantId, bot_id: bot, api_environment: "production", credential_sha256: createHash("sha256").update(credential).digest("hex"), repository_sha: config.releaseSha, representative_user_id: representative, business_connection_id: "opaque:BUSINESS/Fixture", founder_chat_id: founder, business_generation: "2", enabled: true, can_reply: true, observed_at: new Date(now - 60000).toISOString(), expires_at: new Date(now + 600000).toISOString() }; }
const clock = { wall: () => now, monotonic: () => 1 };
function proof(changes: Record<string, unknown> = {}) { return { ok: true, result: { id: scope().business_connection_id, user: { id: Number(representative), is_bot: false, first_name: "PRIVATE_STAFF_FIXTURE", username: "PRIVATE_FIXTURE_ALIAS" }, is_enabled: true, rights: { can_reply: true, can_read_messages: false, can_delete_all_messages: false }, date: now / 1000 - 600, user_chat_id: Number(representative), ...changes } }; }
function response(body: unknown = proof(), status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function claimed(changes: Record<string, string> = {}) { return { business_connection_id: scope().business_connection_id, business_generation: "2", chat_id: founder, ...changes }; }
function signed(body: unknown) { const raw = typeof body === "string" ? body : JSON.stringify(body), timestamp = String(now / 1000), signature = createHmac("sha256", config.relaySecret).update(JSON.stringify(["POLAT_UAT_RELAY1", timestamp, createHash("sha256").update(raw).digest("hex")])).digest("hex"); return new Request("https://fixture.invalid/api/webhooks/private-beta/telegram", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": config.webhookSecret, "x-polat-uat-timestamp": timestamp, "x-polat-uat-signature": signature }, body: raw }); }
function message(changes: Record<string, unknown> = {}) { return { message_id: 3, date: now / 1000, business_connection_id: scope().business_connection_id, from: { id: Number(founder), is_bot: false }, chat: { id: Number(founder), type: "private" }, text: "Hi, this is an invented test only.", ...changes }; }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("BUSINESS send authority is a fresh independent read and a one-use in-process capability", () => {
  it("uses one fixed-host request, no redirect/retry, and safely projects complete official metadata", async () => {
    const network = vi.fn().mockResolvedValue(response());
    const permit = await verifyPrivateBetaBusinessSend(scope(), credential, network, clock);
    expect(network).toHaveBeenCalledTimes(1); const [url, init] = network.mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${credential}/getBusinessConnection`); expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", body: JSON.stringify({ business_connection_id: scope().business_connection_id }) });
    expect(JSON.stringify(permit)).not.toContain(credential); expect(JSON.stringify(permit)).not.toContain("PRIVATE_STAFF");
    consumePrivateBetaBusinessSendPermit(permit, scope(), claimed(), () => 1, () => now);
    expect(() => consumePrivateBetaBusinessSendPermit(permit, scope(), claimed(), () => 1, () => now)).toThrow("PRIVATE_BETA_BUSINESS_PERMISSION_UNVERIFIED");
  });
  it.each(["wrong-connection", "wrong-representative", "disabled", "no-right", "missing-rights", "bot-representative", "malformed"])("%s cannot create a send permit", async kind => {
    const p = proof(); if (kind === "wrong-connection") p.result.id = "another"; if (kind === "wrong-representative") p.result.user.id++; if (kind === "disabled") p.result.is_enabled = false; if (kind === "no-right") p.result.rights.can_reply = false; if (kind === "missing-rights") Reflect.deleteProperty(p.result, "rights"); if (kind === "bot-representative") p.result.user.is_bot = true;
    const network = vi.fn().mockResolvedValue(kind === "malformed" ? new Response("not JSON", { headers: { "content-type": "application/json" } }) : response(p));
    await expect(verifyPrivateBetaBusinessSend(scope(), credential, network, clock)).rejects.toThrow("PRIVATE_BETA_BUSINESS_PERMISSION_UNVERIFIED"); expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(["can_read_messages", "can_delete_sent_messages", "can_delete_all_messages", "can_edit_name", "can_edit_bio", "can_edit_profile_photo", "can_edit_username", "can_change_gift_settings", "can_view_gifts_and_stars", "can_convert_gifts_to_stars", "can_transfer_and_upgrade_gifts", "can_transfer_stars", "can_manage_stories"])("excess %s cannot authorize a BUSINESS UAT send", async right => {
    const network = vi.fn().mockResolvedValue(response(proof({ rights: { can_reply: true, [right]: true } })));
    await expect(verifyPrivateBetaBusinessSend(scope(), credential, network, clock)).rejects.toThrow("PRIVATE_BETA_BUSINESS_PERMISSION_UNVERIFIED"); expect(network).toHaveBeenCalledTimes(1);
  });
  it("unknown rights are rejected even when false, rather than silently discarded", async () => {
    const network = vi.fn().mockResolvedValue(response(proof({ rights: { can_reply: true, future_financial_right: false } })));
    await expect(verifyPrivateBetaBusinessSend(scope(), credential, network, clock)).rejects.toThrow("PRIVATE_BETA_BUSINESS_PERMISSION_UNVERIFIED");
  });
  it.each(["credential", "expired", "disabled", "unknown-field"])("%s fails before independent read", async kind => {
    const s = scope(); if (kind === "expired") s.expires_at = new Date(now).toISOString(); if (kind === "disabled") s.enabled = false;
    const network = vi.fn(); await expect(verifyPrivateBetaBusinessSend(kind === "unknown-field" ? { ...s, verified: true } : s, kind === "credential" ? "BAD_FIXTURE" : credential, network, clock)).rejects.toThrow(); expect(network).not.toHaveBeenCalled();
  });
  it.each(["json", "generation", "chat", "scope", "expired"])("%s drift cannot reuse a genuine in-memory permit", async kind => {
    const permit = await verifyPrivateBetaBusinessSend(scope(), credential, vi.fn().mockResolvedValue(response()), clock);
    expect(() => consumePrivateBetaBusinessSendPermit(kind === "json" ? JSON.parse(JSON.stringify(permit)) : permit, kind === "scope" ? { ...scope(), founder_chat_id: "7100000009" } : scope(), claimed(kind === "generation" ? { business_generation: "3" } : kind === "chat" ? { chat_id: "7100000009" } : {}), () => kind === "expired" ? 10002 : 1, () => now)).toThrow("PRIVATE_BETA_BUSINESS_PERMISSION_UNVERIFIED");
  });
  it.each([429, 401, 403, 500])("HTTP%s remains blocked without retries or provider diagnostics", async status => {
    const network = vi.fn().mockResolvedValue(response({ ok: false, description: credential }, status)); const result = verifyPrivateBetaBusinessSend(scope(), credential, network, clock);
    await expect(result).rejects.toThrow("PRIVATE_BETA_BUSINESS_PERMISSION_UNVERIFIED"); expect(network).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized and duplicate-key provider data", async () => {
    for (const raw of ["x".repeat(16385), JSON.stringify(proof()).replace('"ok":true', '"ok":true,"ok":true')]) await expect(verifyPrivateBetaBusinessSend(scope(), credential, vi.fn().mockResolvedValue(new Response(raw, { headers: { "content-type": "application/json" } })), clock)).rejects.toThrow("PRIVATE_BETA_BUSINESS_PERMISSION_UNVERIFIED");
  });
  it("bounds a transport that ignores cancellation without a second call", async () => {
    vi.useFakeTimers(); const network = vi.fn().mockImplementation(() => new Promise(() => undefined)); const pending = verifyPrivateBetaBusinessSend(scope(), credential, network, clock); const assertion = expect(pending).rejects.toThrow("PRIVATE_BETA_BUSINESS_PERMISSION_UNVERIFIED"); await vi.advanceTimersByTimeAsync(10001); await assertion; expect(network).toHaveBeenCalledTimes(1);
  });
});

describe("authenticated BUSINESS normalization is distinct from BOT authority", () => {
  it("normalizes inbound without retaining private profile names", async () => {
    const r = await authenticatePrivateBetaIngress(signed({ update_id: 2, business_message: message() }), config, now); expect(r.kind).toBe("BUSINESS");
    if (r.kind !== "BUSINESS") throw Error("Expected Business fixture"); expect(r.event.envelope?.providerUserId).toBe(founder); expect(r.event.envelope?.text).toContain("invented test"); expect(r.event.kind).toBe("MESSAGE");
  });
  it("the accepted BOT-only parser still rejects BUSINESS updates", async () => { await expect(authenticatePrivateBetaUpdate(signed({ update_id: 2, business_message: message() }), config, now)).rejects.toThrow("PRIVATE_BETA_WEBHOOK_INVALID"); });
  it.each(["connection", "edit", "delete", "echo", "human"])("%s has explicit non-inbound evidence", async kind => {
    const m = message(kind === "human" ? { from: { id: Number(representative), is_bot: false } } : kind === "echo" ? { sender_business_bot: { id: Number(bot) } } : {});
    const raw = kind === "connection" ? { business_connection: { id: scope().business_connection_id, user: { id: Number(representative), is_bot: false }, is_enabled: false, rights: { can_reply: false } } } : kind === "delete" ? { deleted_business_messages: { business_connection_id: scope().business_connection_id, chat: m.chat, message_ids: [3, 4] } } : { [kind === "edit" ? "edited_business_message" : "business_message"]: m };
    const r = await authenticatePrivateBetaIngress(signed({ update_id: 2, ...raw }), config, now); expect(r.kind).toBe("BUSINESS"); if (r.kind !== "BUSINESS") throw Error("Expected Business fixture");
    if (kind === "echo") expect(r.event.botEcho).toBe(true); if (kind === "human") expect(r.event.providerUserId).toBe(representative); if (kind === "connection") expect(r.event.restrictionObserved).toBe(true); if (kind === "delete") expect(r.event.providerMessageIds).toEqual(["3", "4"]); if (kind === "edit") expect(r.event.kind).toBe("EDIT");
  });
  it("preserves unsupported captions and hash without reading media", async () => {
    const m = message(); Reflect.deleteProperty(m, "text"); const r = await authenticatePrivateBetaIngress(signed({ update_id: 2, business_message: { ...m, photo: [{ file_id: "SECRET_FILE_FIXTURE" }], caption: "A private test caption" } }), config, now); if (r.kind !== "BUSINESS") throw Error("Expected Business fixture"); expect(r.event.unsupported).toBe(true); expect(r.event.envelope?.text).toContain("A private test caption"); expect(r.event.envelope?.text).not.toContain("SECRET_FILE_FIXTURE");
  });
  it.each(["two-classes", "group", "bad-user", "duplicate-delete", "too-many-deletes", "fake-normal"])("rejects %s envelopes", async kind => {
    const m = message(kind === "group" ? { chat: { id: Number(founder), type: "group" } } : kind === "bad-user" ? { from: { id: -1, is_bot: false } } : {});
    const raw = kind === "two-classes" ? { business_message: m, edited_business_message: m } : kind === "duplicate-delete" || kind === "too-many-deletes" ? { deleted_business_messages: { business_connection_id: scope().business_connection_id, chat: m.chat, message_ids: kind === "duplicate-delete" ? [3, 3] : Array.from({ length: 101 }, (_, i) => i + 1) } } : kind === "fake-normal" ? { message: m } : { business_message: m };
    await expect(authenticatePrivateBetaIngress(signed({ update_id: 2, ...raw }), config, now)).rejects.toThrow();
  });
  it("namespaces update identities without normalizing opaque connection IDs", () => {
    const a = privateBetaBusinessUpdateId("CaseSensitive", "2"), b = privateBetaBusinessUpdateId("casesensitive", "2"); expect(a.length).toBeLessThanOrEqual(120); expect(a).not.toBe(b); expect(a).toMatch(/^business:[a-f0-9]{64}:2$/u); expect(() => privateBetaBusinessUpdateId("x", "1;SELECT")).toThrow();
  });
});
