import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { discoverPrivateBetaBusinessConnections, discoverAndRecordPrivateBetaBusinessConnections, privateBetaBotWebhookRequest, verifyAndRecordPrivateBetaBusiness } from "../../scripts/private-beta-release-bot.mjs";
const t = "92cb3000-0000-4000-8000-000000000001", p = "92cb3000-0000-4000-8000-000000000002", sha = "f".repeat(40), bot = "7100000001", representative = "7100000003", founder = "7100000002", key = bot + ":OFFLINE_BUSINESS_FIXTURE_CREDENTIAL_ONLY", now = Date.parse("2026-10-27T09:00:00Z");
const hash = (value: string) => createHash("sha256").update(value).digest("hex"), connection = "Opaque:BUSINESS/Fixture", expiration = new Date(now + 600000).toISOString();
function program(changes: Record<string, unknown> = {}) { return { database_role: "postgres", program_id: p, tenant_id: t, repository_sha: sha, stage: "DRAFT", generation: "1", manifest_hash: "a".repeat(64), authorization_record_hash: "b".repeat(64), bot_id: bot, credential_sha256: hash(key), has_participants: false, ...changes }; }
function seed(changes: Record<string, unknown> = {}) { return { version: 1, program_id: p, tenant_id: t, bot_id: bot, credential_sha256: hash(key), repository_sha: sha, representative_user_id: representative, founder_chat_id: founder, business_connection_id: connection, business_generation: "1", program_generation: "1", expires_at: expiration, ...changes }; }
function actualConnection(changes: Record<string, unknown> = {}) { return { id: connection, user: { id: Number(representative), is_bot: false, first_name: "PRIVATE STAFF FIXTURE", username: "PRIVATE_ALIAS" }, is_enabled: true, rights: { can_reply: true, can_delete_sent_messages: false }, ...changes }; }
function scoped(changes: Record<string, unknown> = {}) { return { version: 2, mode: "BUSINESS", program_id: p, tenant_id: t, bot_id: bot, api_environment: "production", credential_sha256: hash(key), repository_sha: sha, representative_user_id: representative, business_connection_id: connection, founder_chat_id: founder, business_generation: "2", enabled: true, can_reply: true, observed_at: new Date(now).toISOString(), expires_at: expiration, ...changes }; }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function fixture(changes: { program?: Record<string, unknown>; seed?: Record<string, unknown>; connection?: Record<string, unknown>; scope?: Record<string, unknown>; discoveryStatus?: number; updates?: unknown[]; secretary?: boolean } = {}) {
  const writes: string[] = [];
  let discovery: { source_hash: string; candidates: unknown[]; program_generation: string } | null = null;
  const network = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
    if (url === "https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query") {
      const query = JSON.parse(String(init.body)).query as string;
      if (query.includes("as private_beta_program")) return json([{ private_beta_program: program(changes.program) }]);
      if (query.includes("business_discovery_record")) { const encoded = query.match(/decode\('([a-f0-9]+)'/u)![1]; discovery = JSON.parse(Buffer.from(encoded, "hex").toString("utf8")); writes.push(query); return json([{ private_beta_business_discovery_record: null }]); }
      if (query.includes("business_discovery_summary")) return json([{ business_discovery_summary: { source_hash: discovery?.source_hash, candidate_count: discovery?.candidates.length, program_generation: discovery?.program_generation } }]);
      if (query.includes("business_control_seed")) return json([{ business_seed: seed(changes.seed) }]);
      if (query.includes("business_control_record")) { writes.push(query); return json([{ private_beta_business_control_record: null }]); }
      if (query.includes("transport_config_v1")) return json([{ business_scope: scoped(changes.scope) }]);
      throw Error("UNEXPECTED_OFFLINE_QUERY");
    }
    if (url === `https://api.telegram.org/bot${key}/getMe`) return json({ ok: true, result: { id: Number(bot), is_bot: true, can_connect_to_business: changes.secretary ?? true } });
    if (url === `https://api.telegram.org/bot${key}/getBusinessConnection`) return json({ ok: true, result: actualConnection(changes.connection) });
    if (url === `https://api.telegram.org/bot${key}/getUpdates`) return json({ ok: true, result: changes.updates ?? [{ update_id: 31, business_connection: actualConnection() }] }, changes.discoveryStatus ?? 200);
    throw Error("UNEXPECTED_OFFLINE_URL");
  });
  return { network, writes, input: { programId: p, sha, managementToken: "OFFLINE_PROTECTED_MANAGEMENT_FIXTURE_ONLY", botToken: key, network, now: () => now } };
}

describe("protected BUSINESS candidate discovery (injected offline network only)", () => {
  it("discovers bounded candidate IDs without mutating DB or enrolling any account", async () => {
    const f = fixture(); const result = await discoverPrivateBetaBusinessConnections(f.input); expect(result.state).toBe("CANDIDATE_ONLY"); expect(result.connection_authority).toBe("NONE"); expect(result.database_mutations).toBe(0); expect(result.candidates).toEqual([expect.objectContaining({ business_connection_id: connection, representative_user_id: representative, update_id: "31" })]); expect(f.writes).toEqual([]);
    const request = f.network.mock.calls.find(([url]) => url.endsWith("/getUpdates"))![1]; const body = JSON.parse(request.body); expect(body).toEqual({ timeout: 0, limit: 10, allowed_updates: ["business_connection", "business_message"] }); expect(body).not.toHaveProperty("offset"); expect(request.redirect).toBe("error"); expect(JSON.stringify(result)).not.toContain(key); expect(JSON.stringify(result)).not.toContain("PRIVATE STAFF"); expect(JSON.stringify(result)).not.toContain("PRIVATE_ALIAS");
    expect(f.network.mock.calls.filter(([url]) => url.includes("/getUpdates"))).toHaveLength(1); expect(f.network.mock.calls.some(([url]) => /deleteWebhook|setWebhook|sendMessage/u.test(url))).toBe(false);
  });
  it("derives only private nonbot chat IDs under a known candidate, never greeting content or names", async () => {
    const f = fixture({ updates: [{ update_id: 31, business_connection: actualConnection() }, { update_id: 32, business_message: { business_connection_id: connection, from: { id: Number(founder), is_bot: false, first_name: "PRIVATE_CUSTOMER_NAME" }, chat: { id: Number(founder), type: "private" }, text: "PRIVATE_TEST_GREETING_DO_NOT_RETAIN", location: { latitude: 41.015137, longitude: 28.97953 } } }] });
    const result = await discoverPrivateBetaBusinessConnections(f.input); expect(result.candidates[0].founder_chat_ids).toEqual([founder]); expect(JSON.stringify(result)).not.toContain("PRIVATE_CUSTOMER_NAME"); expect(JSON.stringify(result)).not.toContain("PRIVATE_TEST_GREETING_DO_NOT_RETAIN"); expect(JSON.stringify(result)).not.toContain("41.015137"); expect(f.writes).toEqual([]);
  });
  it.each(["without-connection", "bot", "other-connection", "group", "representative", "sender-chat-mismatch"])("%s cannot manufacture founder candidates", async kind => {
    const m = { business_connection_id: connection, from: { id: Number(founder), is_bot: false }, chat: { id: Number(founder), type: "private" }, text: "Invented test greeting" };
    if (kind === "bot") m.from.is_bot = true; if (kind === "other-connection") m.business_connection_id = "OTHER"; if (kind === "group") m.chat.type = "group"; if (kind === "representative") { m.from.id = Number(representative); m.chat.id = Number(representative); } if (kind === "sender-chat-mismatch") m.chat.id++;
    const f = fixture({ updates: [...(kind === "without-connection" ? [] : [{ update_id: 31, business_connection: actualConnection() }]), { update_id: 32, business_message: m }] }); const result = await discoverPrivateBetaBusinessConnections(f.input); expect(result.candidates.flatMap(c => c.founder_chat_ids)).toEqual([]); expect(result.connection_authority).toBe("NONE");
  });
  it("the protected CLI result persists private IDs but serializes only a public-safe summary", async () => {
    const f = fixture({ updates: [{ update_id: 31, business_connection: actualConnection() }, { update_id: 32, business_message: { business_connection_id: connection, from: { id: Number(founder), is_bot: false }, chat: { id: Number(founder), type: "private" }, text: "PRIVATE_TEST_MESSAGE" } }] });
    const summary = await discoverAndRecordPrivateBetaBusinessConnections(f.input); expect(summary).toMatchObject({ mode: "PROTECTED_BUSINESS_DISCOVERY_SUMMARY", candidate_count: 1, founder_chat_candidate_count: 1, database_readback_verified: true, connection_authority: "NONE" });
    const serialized = JSON.stringify(summary); for (const value of [connection, representative, founder, key, "PRIVATE STAFF FIXTURE", "PRIVATE_TEST_MESSAGE"]) expect(serialized).not.toContain(value);
    expect(summary).not.toHaveProperty("candidates"); expect(f.writes).toHaveLength(1); expect(f.writes[0]).toContain("private_beta_business_discovery_record");
    const encoded = f.writes[0].match(/decode\('([a-f0-9]+)'/u)![1], stored = JSON.parse(Buffer.from(encoded, "hex").toString("utf8")); expect(stored.candidates).toEqual([expect.objectContaining({ business_connection_id: connection, representative_user_id: representative, founder_chat_ids: [founder] })]); expect(stored).toMatchObject({ program_generation: "1", credential_sha256: hash(key) }); expect(stored).not.toHaveProperty("content");
  });
  it("an active webhook conflict remains BLOCKED, never removed or retried", async () => { const f = fixture({ discoveryStatus: 409 }); await expect(discoverPrivateBetaBusinessConnections(f.input)).rejects.toThrow("BUSINESS_DISCOVERY_WEBHOOK_ACTIVE"); expect(f.writes).toEqual([]); expect(f.network.mock.calls.filter(([url]) => url.includes("/getUpdates"))).toHaveLength(1); });
  it.each(["active-program", "existing-participants", "secretary-disabled", "wrong-credential"])("%s prevents new-bot discovery", async kind => {
    const f = fixture(kind === "active-program" ? { program: { stage: "FOUNDER" } } : kind === "existing-participants" ? { program: { has_participants: true } } : kind === "secretary-disabled" ? { secretary: false } : { program: { credential_sha256: "d".repeat(64) } });
    await expect(discoverPrivateBetaBusinessConnections(f.input)).rejects.toThrow(); expect(f.network.mock.calls.some(([url]) => url.includes("/getUpdates"))).toBe(false); expect(f.writes).toEqual([]);
  });
  it("absence of a candidate never becomes a verified connection", async () => { const f = fixture({ updates: [] }); const result = await discoverPrivateBetaBusinessConnections(f.input); expect(result.state).toBe("NO_CANDIDATE"); expect(result.connection_authority).toBe("NONE"); expect(result.candidates).toEqual([]); });
});

describe("protected independent BUSINESS enrollment and separate database read-back", () => {
  it("records only exact independent proof and verifies persistence", async () => {
    const f = fixture(); const result = await verifyAndRecordPrivateBetaBusiness(f.input); expect(result.database_readback_verified).toBe(true); expect(result.telegram_messages).toBe(0); expect(result.model_requests).toBe(0); expect(result.connection_identity_hash).toBe(hash(connection)); expect(f.writes).toHaveLength(1);
    expect(f.network.mock.calls.filter(([url]) => url.endsWith("/getBusinessConnection"))).toHaveLength(1); expect(f.network.mock.calls.some(([url]) => /setWebhook|sendMessage|getUpdates/u.test(url))).toBe(false); expect(JSON.stringify(result)).not.toContain(key); expect(JSON.stringify(result)).not.toContain(connection); expect(JSON.stringify(result)).not.toContain(representative);
    const encoded = f.writes[0].match(/decode\('([a-f0-9]+)'/u)![1], proof = JSON.parse(Buffer.from(encoded, "hex").toString("utf8")); expect(proof).toMatchObject({ origin: "INDEPENDENT_TELEGRAM_BUSINESS_READ", representative_user_id: representative, business_connection_id: connection, enabled: true, can_reply: true, expected_generation: "1" });
  });
  it.each(["representative", "connection", "rights", "disabled", "missing-owner-binding"])("%s mismatch cannot write a business seal", async kind => {
    const f = fixture(kind === "representative" ? { connection: { user: { id: Number(representative) + 1, is_bot: false } } } : kind === "connection" ? { connection: { id: "FOREIGN" } } : kind === "rights" ? { connection: { rights: { can_reply: false } } } : kind === "disabled" ? { connection: { is_enabled: false } } : { seed: { representative_user_id: null } });
    await expect(verifyAndRecordPrivateBetaBusiness(f.input)).rejects.toThrow(); expect(f.writes).toEqual([]);
  });
  it.each(["can_read_messages", "can_delete_sent_messages", "can_delete_all_messages", "can_edit_name", "can_edit_bio", "can_edit_profile_photo", "can_edit_username", "can_change_gift_settings", "can_view_gifts_and_stars", "can_convert_gifts_to_stars", "can_transfer_and_upgrade_gifts", "can_transfer_stars", "can_manage_stories", "future_financial_right"])("excess or unknown %s is denied before persisting account authority", async right => {
    const f = fixture({ connection: { rights: { can_reply: true, [right]: right === "future_financial_right" ? false : true } } });
    await expect(verifyAndRecordPrivateBetaBusiness(f.input)).rejects.toThrow("BUSINESS_CONNECTION_UNVERIFIED"); expect(f.writes).toEqual([]);
    expect(f.network.mock.calls.some(([url]) => /sendMessage|setWebhook|deleteWebhook/u.test(url))).toBe(false);
  });
  it.each(["generation", "connection", "enabled", "expiry"])("a submitted write without matching %s read-back is not PASS", async kind => {
    const f = fixture({ scope: kind === "generation" ? { business_generation: "3" } : kind === "connection" ? { business_connection_id: "FOREIGN" } : kind === "enabled" ? { enabled: false } : { expires_at: new Date(now + 300000).toISOString() } });
    await expect(verifyAndRecordPrivateBetaBusiness(f.input)).rejects.toThrow("BUSINESS_CONTROL_PERSISTENCE_UNVERIFIED"); expect(f.writes).toHaveLength(1);
  });
  it("keeps BOT subscriptions unchanged and requires explicit BUSINESS update classes", () => {
    const secret = "OFFLINE_WEBHOOK_FIXTURE_".padEnd(48, "x"); expect(privateBetaBotWebhookRequest(secret).allowed_updates).toEqual(["message"]); expect(privateBetaBotWebhookRequest(secret, "BUSINESS").allowed_updates).toEqual(["business_connection", "business_message", "edited_business_message", "deleted_business_messages"]); expect(privateBetaBotWebhookRequest(secret, "BUSINESS").drop_pending_updates).toBe(false);
  });
});
