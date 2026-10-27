import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("../messaging/telegram-adapter", () => ({ sendTelegramText: mocks.send }));
vi.mock("../../apps/web/src/lib/messaging/telegram-adapter", () => ({ sendTelegramText: mocks.send }));
import { dispatchPrivateBetaMessage } from "../../apps/web/src/lib/polat/private-beta-runtime";
const t = "92cb2000-0000-4000-8000-000000000001", p = "92cb2000-0000-4000-8000-000000000002", mid = "92cb2000-0000-4000-8000-000000000003", bot = "7100000001", founder = "7100000002", representative = "7100000003";
const credential = bot + ":OFFLINE_BUSINESS_FIXTURE_CREDENTIAL_ONLY", sha = "f".repeat(40), fixtureTime = Date.now();
function scope() { return { version: 2, mode: "BUSINESS", program_id: p, tenant_id: t, bot_id: bot, api_environment: "production", credential_sha256: createHash("sha256").update(credential).digest("hex"), repository_sha: sha, representative_user_id: representative, business_connection_id: "OPAQUE_BUSINESS_FIXTURE", founder_chat_id: founder, business_generation: "2", enabled: true, can_reply: true, observed_at: new Date(fixtureTime - 60000).toISOString(), expires_at: new Date(fixtureTime + 600000).toISOString() }; }
function claimed() { return { dispatch: true, message_id: mid, program_id: p, bot_id: bot, chat_id: founder, body: "I'm Polat's AI assistant. This is an invented test only.", reply_to_provider_message_id: "4", mode: "BUSINESS", business_connection_id: scope().business_connection_id, business_generation: "2" }; }
const proof = () => new Response(JSON.stringify({ ok: true, result: { id: scope().business_connection_id, user: { id: Number(representative), is_bot: false }, is_enabled: true, rights: { can_reply: true } } }), { status: 200, headers: { "content-type": "application/json" } });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("POLAT_UAT_RELEASE_SHA", sha); vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sha); vi.stubEnv("POLAT_UAT_TELEGRAM_BOT_TOKEN", credential);
  mocks.rpc.mockImplementation(async name => ({ data: name === "private_beta_transport_config_v1" ? scope() : name === "private_beta_claim_reply_v1" ? claimed() : name === "private_beta_business_transport_hold_v1" ? { held: true } : { recorded: true }, error: null }));
  mocks.send.mockResolvedValue({ result: { kind: "sent", providerMessageId: "5", providerChatId: founder }, providerStatus: 200 }); vi.stubGlobal("fetch", vi.fn().mockImplementation(proof));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("actual BUSINESS dispatcher with offline provider boundaries", () => {
  it("independently verifies rights, atomically claims, rereads generation, sends once and records actual provider result", async () => {
    const result = await dispatchPrivateBetaMessage(t, p, mid); expect(result).toEqual({ status: "sent", message_id: mid }); expect(fetch).toHaveBeenCalledTimes(1); expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["private_beta_transport_config_v1", "private_beta_claim_reply_v1", "private_beta_transport_config_v1", "record_outbound_message_result"]);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ businessConnectionId: scope().business_connection_id, chatId: founder }));
    expect(mocks.rpc).toHaveBeenCalledWith("record_outbound_message_result", expect.objectContaining({ result_value: "sent", provider_message_id_value: "5" }));
  });
  it("an unverified read creates a visible hold before claim and never calls send", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error(credential)));
    expect(await dispatchPrivateBetaMessage(t, p, mid)).toEqual({ status: "blocked", message_id: mid }); expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["private_beta_transport_config_v1", "private_beta_business_transport_hold_v1"]);
    expect(mocks.rpc).toHaveBeenCalledWith("private_beta_business_transport_hold_v1", { target_tenant_id: t, program_id_value: p, target_message_id: mid, reason_value: "PERMISSION_READ_UNVERIFIED" });
  });
  it.each(["can_transfer_stars", "can_delete_all_messages", "can_edit_profile_photo", "unknown_future_right"])("excess %s triggers review before claim or send", async right => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { id: scope().business_connection_id, user: { id: Number(representative), is_bot: false }, is_enabled: true, rights: { can_reply: true, [right]: true } } }), { status: 200, headers: { "content-type": "application/json" } })));
    expect(await dispatchPrivateBetaMessage(t, p, mid)).toEqual({ status: "blocked", message_id: mid }); expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["private_beta_transport_config_v1", "private_beta_business_transport_hold_v1"]);
  });
  it("a revoked claim cannot cause a send even after a valid independent read", async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "private_beta_transport_config_v1" ? scope() : { dispatch: false }, error: null }));
    expect(await dispatchPrivateBetaMessage(t, p, mid)).toEqual({ status: "blocked", message_id: mid }); expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each(["generation", "connection", "chat", "mode"])("post-claim %s drift records a known local block rather than an external success", async kind => {
    let reads = 0;
    mocks.rpc.mockImplementation(async name => { if (name === "private_beta_transport_config_v1") return { data: { ...scope(), ...(reads++ && kind === "generation" ? { business_generation: "3" } : {}) }, error: null }; if (name === "private_beta_claim_reply_v1") { const value = claimed(); if (kind === "connection") value.business_connection_id = "ANOTHER"; if (kind === "chat") value.chat_id = "7100000009"; if (kind === "mode") { Reflect.deleteProperty(value, "mode"); Reflect.deleteProperty(value, "business_connection_id"); Reflect.deleteProperty(value, "business_generation"); } return { data: value, error: null }; } return { data: { held: true }, error: null }; });
    expect(await dispatchPrivateBetaMessage(t, p, mid)).toEqual({ status: "blocked", message_id: mid }); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.rpc).toHaveBeenCalledWith("record_outbound_message_result", expect.objectContaining({ result_value: "blocked", provider_message_id_value: null, provider_status_value: 0 })); expect(mocks.rpc).toHaveBeenCalledWith("private_beta_business_transport_hold_v1", expect.objectContaining({ reason_value: "SCOPE_CHANGED" }));
  });
  it("UNKNOWN send is recorded once without blind retry or a successful ACK", async () => {
    mocks.send.mockResolvedValue({ result: { kind: "failed", errorCode: "TELEGRAM_DELIVERY_UNCERTAIN", retryable: false }, providerStatus: 0 }); expect(await dispatchPrivateBetaMessage(t, p, mid)).toEqual({ status: "unknown", message_id: mid }); expect(mocks.send).toHaveBeenCalledTimes(1); expect(mocks.rpc).toHaveBeenCalledWith("record_outbound_message_result", expect.objectContaining({ result_value: "failed", error_code_value: "TELEGRAM_DELIVERY_UNCERTAIN", provider_message_id_value: null }));
  });
  it("a normal BOT program never fetches or invents a business connection", async () => {
    const s = scope(); const b = { version: 1, program_id: p, tenant_id: t, bot_id: bot, api_environment: "production", credential_sha256: s.credential_sha256, repository_sha: sha }; const c = claimed(); Reflect.deleteProperty(c, "mode"); Reflect.deleteProperty(c, "business_connection_id"); Reflect.deleteProperty(c, "business_generation");
    mocks.rpc.mockImplementation(async name => ({ data: name === "private_beta_transport_config_v1" ? b : name === "private_beta_claim_reply_v1" ? c : { recorded: true }, error: null }));
    expect(await dispatchPrivateBetaMessage(t, p, mid)).toEqual({ status: "sent", message_id: mid }); expect(fetch).not.toHaveBeenCalled(); expect(mocks.send).toHaveBeenCalledTimes(1); expect(mocks.send.mock.calls[0][0]).not.toHaveProperty("businessConnectionId");
  });
  it("wrong custody/release fails before any independent lookup, claim or send", async () => { vi.stubEnv("POLAT_UAT_TELEGRAM_BOT_TOKEN", "OFFLINE_WRONG_CUSTODY"); await expect(dispatchPrivateBetaMessage(t, p, mid)).rejects.toThrow("PRIVATE_BETA_BOT_CREDENTIAL_UNVERIFIED"); expect(fetch).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.rpc).toHaveBeenCalledTimes(1); });
});
