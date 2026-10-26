import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatePrivateBetaUpdate, privateBetaSecretMatches } from "../../apps/web/src/lib/polat/private-beta-webhook";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), scope: vi.fn(), queue: vi.fn(), dispatch: vi.fn(), worker: vi.fn(), after: vi.fn(), callbacks: [] as Array<() => unknown> }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/polat/private-beta-webhook", () => import("../../apps/web/src/lib/polat/private-beta-webhook"));
vi.mock("@/lib/polat/private-beta-runtime", () => ({ privateBetaRpc: mocks.rpc, privateBetaTransportScope: mocks.scope, queuePrivateBetaNotice: mocks.queue, dispatchPrivateBetaMessage: mocks.dispatch }));
vi.mock("@/lib/agent-runtime/worker", () => ({ runDeterministicWorker: mocks.worker }));
import { POST } from "../../apps/web/src/app/api/webhooks/private-beta/telegram/route";

const tenantId = "91cd1000-0000-4000-8000-000000000001", programId = "91cd1000-0000-4000-8000-000000000002", participantId = "91cd1000-0000-4000-8000-000000000003", conversationId = "91cd1000-0000-4000-8000-000000000004", messageId = "91cd1000-0000-4000-8000-000000000005";
const config = { tenantId, programId, releaseSha: "f".repeat(40), webhookSecret: "OFFLINE_WEBHOOK_FIXTURE_".padEnd(48, "x"), relaySecret: "OFFLINE_RELAY_FIXTURE_".padEnd(48, "y") };
const numericId = 9123456789;
function update(text = "Hello", changes: Record<string, unknown> = {}) { return { update_id: 91001, message: { message_id: 91002, date: Math.floor(Date.now() / 1000), chat: { id: numericId, type: "private" }, from: { id: numericId, is_bot: false, username: "untrusted_test_alias", first_name: "UNTRUSTED TEST NAME" }, text }, ...changes }; }
function signedRequest(body: string, overrides: Record<string, string> = {}, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  const signature = createHmac("sha256", config.relaySecret).update(JSON.stringify(["POLAT_UAT_RELAY1", timestamp, createHash("sha256").update(Buffer.from(body)).digest("hex")])).digest("hex");
  return new Request("https://gold-revenue-os-staging.vercel.app/api/webhooks/private-beta/telegram", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": config.webhookSecret, "x-polat-uat-timestamp": timestamp, "x-polat-uat-signature": signature, ...overrides }, body });
}
function accepted(status = "ACTIVE", extra: Record<string, unknown> = {}) { return { status, program_id: programId, participant_id: participantId, notice_version: "polat-private-beta-notice-v1", notice_text: status === "NOTICE_REQUIRED" ? "Offline notice fixture" : null, ...extra }; }
function source(duplicate = false) { return { conversation_id: conversationId, message_id: messageId, event_id: null, duplicate }; }
async function flushAfter() { for (const callback of mocks.callbacks.splice(0)) await callback(); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.callbacks.length = 0;
  vi.stubEnv("POLAT_UAT_TENANT_ID", tenantId); vi.stubEnv("POLAT_UAT_PROGRAM_ID", programId); vi.stubEnv("POLAT_UAT_RELEASE_SHA", config.releaseSha); vi.stubEnv("POLAT_UAT_TELEGRAM_WEBHOOK_SECRET", config.webhookSecret); vi.stubEnv("POLAT_UAT_RELAY_SECRET", config.relaySecret);
  mocks.scope.mockResolvedValue({ bot_id: "900000001" }); mocks.queue.mockResolvedValue(messageId); mocks.dispatch.mockResolvedValue({ status: "sent", message_id: messageId }); mocks.worker.mockResolvedValue({ tasksClaimed: 1 });
  mocks.after.mockImplementation((callback: () => unknown) => { mocks.callbacks.push(callback); });
  mocks.rpc.mockImplementation(async name => name === "ingest_telegram_message" ? source() : name === "private_beta_track_source_v1" ? true : name === "private_beta_bind_conversation_v1" || name === "private_beta_feedback_v1" ? { recorded: true } : accepted());
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("actual private beta webhook authentication, offline requests only", () => {
  it("verifies exact body/timestamp MAC, private numeric sender and fixed server configuration", async () => {
    const body = JSON.stringify(update("Merhaba")), now = Date.now();
    const result = await authenticatePrivateBetaUpdate(signedRequest(body, {}, now), config, now);
    expect(result.config).toEqual(config); expect(result.envelope.text).toBe("Merhaba"); expect(result.envelope.providerUserId).toBe(String(numericId)); expect(result.envelope.providerChatId).toBe(String(numericId));
  });
  it.each(["missing", "wrong", "changed-body", "expired", "future"])("rejects %s authentication before any participant or model work", async kind => {
    const body = JSON.stringify(update()), now = Date.now(); let request: Request;
    if (kind === "changed-body") { const signed = signedRequest(body, {}, now); request = new Request(signed.url, { method: "POST", headers: signed.headers, body: JSON.stringify(update("tampered")) }); }
    else request = signedRequest(body, kind === "missing" ? { "x-polat-uat-signature": "" } : kind === "wrong" ? { "x-telegram-bot-api-secret-token": "WRONG_OFFLINE" } : {}, now + (kind === "expired" ? -301_000 : kind === "future" ? 301_000 : 0));
    await expect(authenticatePrivateBetaUpdate(request, config, now)).rejects.toThrow(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("rejects duplicate JSON keys even with a valid relay signature", async () => {
    const valid = JSON.stringify(update()); const duplicate = valid.replace('"update_id":91001', '"update_id":91001,"update_id":91002');
    await expect(authenticatePrivateBetaUpdate(signedRequest(duplicate), config)).rejects.toThrow();
  });
  it.each(["body", "declared-length", "bad-content-type"])("enforces bounded %s before parsing provider data", async kind => {
    const body = kind === "body" ? " ".repeat(16_385) : JSON.stringify(update());
    const request = signedRequest(body, kind === "declared-length" ? { "content-length": "16385" } : kind === "bad-content-type" ? { "content-type": "text/plain" } : {});
    await expect(authenticatePrivateBetaUpdate(request, config)).rejects.toThrow();
  });
  it.each(["bot", "foreign-chat", "group", "missing-is-bot", "negative-identity"])("rejects %s identity instead of trusting username or prior chats", async kind => {
    const value = update();
    if (kind === "bot") value.message.from.is_bot = true;
    if (kind === "foreign-chat") value.message.chat.id = numericId + 1;
    if (kind === "group") value.message.chat.type = "supergroup";
    if (kind === "negative-identity") { value.message.from.id = -1; value.message.chat.id = -1; }
    const body = JSON.stringify(value, kind === "missing-is-bot" ? (key, field) => key === "is_bot" ? undefined : field : undefined);
    await expect(authenticatePrivateBetaUpdate(signedRequest(body), config)).rejects.toThrow();
  });
  it("a secret value, JSON verified flag or missing server scope cannot enable authentication", async () => {
    expect(privateBetaSecretMatches(null, config.webhookSecret)).toBe(false);
    await expect(authenticatePrivateBetaUpdate(signedRequest(JSON.stringify(update())), { ...config, verified: true })).rejects.toThrow();
    await expect(authenticatePrivateBetaUpdate(signedRequest(JSON.stringify(update())), { ...config, tenantId: undefined })).rejects.toThrow();
  });
  it("preserves a photo caption and source hash without fetching media or leaking file identifiers", async () => {
    const original = update(), { text: _text, ...message } = original.message, invitation = "a".repeat(48);
    const body = JSON.stringify({ ...original, message: { ...message, photo: [{ file_id: "OFFLINE_PRIVATE_FILE_ID", file_unique_id: "OFFLINE_PRIVATE_UNIQUE_ID", width: 320, height: 200 }], caption: `Please review this attachment. /start ${invitation}` } });
    const result = await authenticatePrivateBetaUpdate(signedRequest(body), config);
    expect(result.unsupported).toBe(true); expect(result.envelope.text).toMatch(/^\/unsupported photo\n/u); expect(result.envelope.text).toContain("attachment content was not fetched or interpreted"); expect(result.envelope.text).toContain(createHash("sha256").update(body).digest("hex"));
    expect(result.envelope.text).toContain("Original caption: Please review this attachment. /start [invitation redacted]"); expect(result.envelope.text).not.toContain("OFFLINE_PRIVATE_FILE_ID"); expect(result.envelope.text).not.toContain("OFFLINE_PRIVATE_UNIQUE_ID"); expect(result.envelope.text).not.toContain(invitation); expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("accepts authenticated decimal location metadata only as unsupported input, never financial or model facts", async () => {
    const original = update(), { text: _text, ...message } = original.message;
    const body = JSON.stringify({ ...original, message: { ...message, location: { latitude: 41.015137, longitude: 28.97953, horizontal_accuracy: 3.25 } } });
    const result = await authenticatePrivateBetaUpdate(signedRequest(body), config);
    expect(result.unsupported).toBe(true); expect(result.envelope.text).toMatch(/^\/unsupported location\n/u); expect(result.envelope.text).toContain("not fetched or interpreted"); expect(result.envelope.text).not.toContain("41.015137"); expect(result.envelope.text).not.toContain("28.97953"); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled();
  });
});

describe("actual private beta BOT route with injected offline persistence and dispatch", () => {
  it("denies invalid authentication without reading provider configuration or scheduling work", async () => {
    const response = await POST(signedRequest(JSON.stringify(update()), { "x-polat-uat-signature": "0".repeat(64) }));
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "PRIVATE_BETA_INGRESS_DENIED" }); expect(mocks.scope).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("uninvited users trigger no message, model, notice or paid attempt", async () => {
    mocks.rpc.mockResolvedValue({ status: "UNINVITED", program_id: null, participant_id: null, notice_version: null, notice_text: null });
    const response = await POST(signedRequest(JSON.stringify(update()))); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, duplicate: false });
    expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.rpc).toHaveBeenCalledWith("private_beta_participant_for_chat_v1", expect.objectContaining({ target_tenant_id: tenantId, provider_user_id_value: String(numericId), provider_chat_id_value: String(numericId) })); expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("one-time invitation material reaches only its validator and is redacted before ordinary history", async () => {
    const code = "a".repeat(48); mocks.rpc.mockImplementation(async name => name === "ingest_telegram_message" ? source() : accepted("NOTICE_REQUIRED"));
    const response = await POST(signedRequest(JSON.stringify(update(`/start ${code}`)))); expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("private_beta_invite_accept_v1", expect.objectContaining({ command_value: `/start ${code}` }));
    const args = mocks.rpc.mock.calls.find(([name]) => name === "ingest_telegram_message")![1]; expect(args.content_value).toBe("/start [invitation redacted]"); expect(args.username_value).toBeNull(); expect(args.first_name_value).toBeNull(); expect(args.last_name_value).toBeNull();
    expect(JSON.stringify(args)).not.toContain(code); expect(mocks.dispatch).not.toHaveBeenCalled(); await flushAfter();
    expect(mocks.queue).toHaveBeenCalledWith({ tenantId, programId, participantId, conversationId, sourceMessageId: messageId, kind: "NOTICE" }); expect(JSON.stringify(mocks.queue.mock.calls)).not.toContain(code); expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("agree binds the actual conversation before queuing only a fixed acknowledgement", async () => {
    const response = await POST(signedRequest(JSON.stringify(update("/agree")))); expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("private_beta_bind_conversation_v1", { target_tenant_id: tenantId, participant_id_value: participantId, target_conversation_id: conversationId });
    await flushAfter(); expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ kind: "AGREED" })); expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("active ordinary inbound enters only the existing scoped worker after committed persistence", async () => {
    const response = await POST(signedRequest(JSON.stringify(update("What does the fictional test membership include?")))); expect(response.status).toBe(200); expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["private_beta_participant_for_chat_v1", "ingest_telegram_message", "private_beta_bind_conversation_v1", "private_beta_track_source_v1"]);
    expect(mocks.rpc).toHaveBeenCalledWith("private_beta_track_source_v1", { target_tenant_id: tenantId, target_conversation_id: conversationId, source_message_id_value: messageId });
    await flushAfter(); expect(mocks.worker).toHaveBeenCalledTimes(1); expect(mocks.worker).toHaveBeenCalledWith({ deploymentRef: config.releaseSha, conversation: { tenantId, conversationId }, polatUat: { programId } }); expect(mocks.queue).not.toHaveBeenCalled();
  });
  it.each(["/stop", "do not message me again"])("%s commits participation suppression before any further worker work", async text => {
    mocks.rpc.mockImplementation(async name => name === "ingest_telegram_message" ? source() : accepted("REVOKED"));
    const response = await POST(signedRequest(JSON.stringify(update(text)))); expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls[0]).toEqual(["private_beta_invite_accept_v1", expect.objectContaining({ command_value: "/stop" })]);
    await flushAfter(); expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ kind: "STOPPED" })); expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("a deletion request is acknowledged without claiming completed deletion", async () => {
    mocks.rpc.mockImplementation(async name => name === "ingest_telegram_message" ? source() : accepted("DELETE_REQUESTED"));
    expect((await POST(signedRequest(JSON.stringify(update("/delete"))))).status).toBe(200); await flushAfter(); expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ kind: "DELETE_REQUESTED" })); expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("informal feedback preserves source linkage and invokes no model", async () => {
    expect((await POST(signedRequest(JSON.stringify(update("/feedback 4 3 5 4"))))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("private_beta_feedback_v1", { target_tenant_id: tenantId, participant_id_value: participantId, source_message_id_value: messageId, useful_value: 4, natural_value: 3, correct_value: 5, satisfied_value: 4 });
    await flushAfter(); expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ kind: "FEEDBACK_RECORDED" })); expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("a duplicate signed delivery is authenticated again but ingestion dedupe prevents second effects", async () => {
    mocks.rpc.mockImplementation(async name => name === "ingest_telegram_message" ? source(true) : accepted());
    const body = JSON.stringify(update()); const response = await POST(signedRequest(body)); expect(await response.json()).toEqual({ ok: true, duplicate: true }); expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("a crash after ingestion but before notice queue returns503 and a control replay repairs the durable obligation", async () => {
    let persisted = false;
    mocks.rpc.mockImplementation(async name => {
      if (name === "ingest_telegram_message") { const duplicate = persisted; persisted = true; return source(duplicate); }
      return accepted("NOTICE_REQUIRED");
    });
    mocks.queue.mockRejectedValueOnce(Error("OFFLINE_CRASH_BEFORE_QUEUE_COMMIT")).mockResolvedValueOnce(messageId);
    const body = JSON.stringify(update(`/start ${"a".repeat(48)}`));
    const interrupted = await POST(signedRequest(body)); expect(interrupted.status).toBe(503); expect(await interrupted.text()).not.toContain("OFFLINE_CRASH_BEFORE_QUEUE_COMMIT"); expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
    const replay = await POST(signedRequest(body)); expect(await replay.json()).toEqual({ ok: true, duplicate: true }); expect(mocks.queue).toHaveBeenCalledTimes(2); expect(mocks.dispatch).not.toHaveBeenCalled();
    await flushAfter(); expect(mocks.dispatch).toHaveBeenCalledTimes(1); expect(mocks.dispatch).toHaveBeenCalledWith(tenantId, programId, messageId); expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("ordinary replay repairs a crash before first conversation binding and restores durable tracking without a duplicate worker", async () => {
    let persisted = false, interrupted = true;
    mocks.rpc.mockImplementation(async name => {
      if (name === "ingest_telegram_message") { const duplicate = persisted; persisted = true; return source(duplicate); }
      if (name === "private_beta_bind_conversation_v1" && interrupted) { interrupted = false; throw Error("OFFLINE_FIRST_BIND_CRASH"); }
      return name === "private_beta_track_source_v1" ? true : accepted();
    });
    const body = JSON.stringify(update("A first ordinary message after acceptance"));
    expect((await POST(signedRequest(body))).status).toBe(503); expect(mocks.after).not.toHaveBeenCalled();
    expect(await (await POST(signedRequest(body))).json()).toEqual({ ok: true, duplicate: true });
    expect(mocks.rpc).toHaveBeenCalledWith("private_beta_track_source_v1", { target_tenant_id: tenantId, target_conversation_id: conversationId, source_message_id_value: messageId });
    expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("an identical ordinary replay does not schedule a second paid worker", async () => {
    let persisted = false;
    mocks.rpc.mockImplementation(async name => { if (name === "ingest_telegram_message") { const duplicate = persisted; persisted = true; return source(duplicate); } return accepted(); });
    const body = JSON.stringify(update("A normal test question"));
    expect((await POST(signedRequest(body))).status).toBe(200); await flushAfter();
    expect(await (await POST(signedRequest(body))).json()).toEqual({ ok: true, duplicate: true }); await flushAfter();
    expect(mocks.worker).toHaveBeenCalledTimes(1); expect(mocks.queue).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("background worker failure never turns HTTP ingestion acceptance into delivered evidence or a retry", async () => {
    mocks.worker.mockRejectedValue(Error("OFFLINE_MODEL_UNKNOWN")); const response = await POST(signedRequest(JSON.stringify(update()))); expect(await response.json()).toEqual({ ok: true, duplicate: false });
    await flushAfter(); expect(mocks.worker).toHaveBeenCalledTimes(1); expect(mocks.queue).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("foreign program bindings and missing participant scope fail closed before message history", async () => {
    for (const patch of [{ program_id: conversationId }, { program_id: null }, { participant_id: null }]) {
      mocks.rpc.mockClear(); mocks.rpc.mockResolvedValue(accepted("ACTIVE", patch));
      const response = await POST(signedRequest(JSON.stringify(update()))); expect(response.status).toBe(200); expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.after).not.toHaveBeenCalled();
    }
  });
  it.each(["participant", "ingestion", "binding", "tracking", "feedback", "provider-scope"])("a %s failure never fabricates a response, ACK or paid success", async failure => {
    if (failure === "provider-scope") mocks.scope.mockRejectedValue(Error("PRIVATE_FIXTURE_DIAGNOSTIC"));
    else mocks.rpc.mockImplementation(async name => { if (failure === "participant" && name === "private_beta_participant_for_chat_v1" || failure === "ingestion" && name === "ingest_telegram_message" || failure === "binding" && name === "private_beta_bind_conversation_v1" || failure === "tracking" && name === "private_beta_track_source_v1" || failure === "feedback" && name === "private_beta_feedback_v1") throw Error("PRIVATE_FIXTURE_DIAGNOSTIC"); return name === "ingest_telegram_message" ? source() : accepted(); });
    const response = await POST(signedRequest(JSON.stringify(update(failure === "feedback" ? "/feedback 4 3 5 4" : "Hello")))); expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE_FIXTURE_DIAGNOSTIC"); expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("unsupported authority-shaped participant fields are rejected before ingestion", async () => {
    mocks.rpc.mockResolvedValue({ ...accepted(), verified: true, raw_secret: "PRIVATE_NOT_FOR_HTTP" });
    const response = await POST(signedRequest(JSON.stringify(update()))); expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE_NOT_FOR_HTTP"); expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("an unknown slash command cannot turn into model or send authority", async () => {
    expect((await POST(signedRequest(JSON.stringify(update("/force-send verified=true"))))).status).toBe(200); expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("ACTIVE unsupported media is acknowledged after durable binding and tracking with zero model or outbound work", async () => {
    const original = update(), { text: _text, ...message } = original.message;
    const body = JSON.stringify({ ...original, message: { ...message, photo: [{ file_id: "OFFLINE_NO_MODEL_FILE", width: 100, height: 100 }], caption: "Please ask a human to review this." } });
    const response = await POST(signedRequest(body)); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, duplicate: false });
    expect(mocks.rpc).toHaveBeenCalledWith("private_beta_bind_conversation_v1", { target_tenant_id: tenantId, participant_id_value: participantId, target_conversation_id: conversationId });
    expect(mocks.rpc).toHaveBeenCalledWith("private_beta_track_source_v1", { target_tenant_id: tenantId, target_conversation_id: conversationId, source_message_id_value: messageId });
    const ingested = mocks.rpc.mock.calls.find(([name]) => name === "ingest_telegram_message")![1]; expect(ingested.content_value).toContain("/unsupported photo"); expect(ingested.content_value).toContain("Original caption: Please ask a human to review this."); expect(JSON.stringify(ingested)).not.toContain("OFFLINE_NO_MODEL_FILE");
    expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("duplicate unsupported media repairs an interrupted bind and durable review tracking without any paid or outbound attempt", async () => {
    let persisted = false, interrupted = true;
    mocks.rpc.mockImplementation(async name => {
      if (name === "ingest_telegram_message") { const duplicate = persisted; persisted = true; return source(duplicate); }
      if (name === "private_beta_bind_conversation_v1" && interrupted) { interrupted = false; throw Error("OFFLINE_MEDIA_BIND_CRASH"); }
      return name === "private_beta_track_source_v1" ? true : accepted();
    });
    const original = update(), { text: _text, ...message } = original.message;
    const body = JSON.stringify({ ...original, message: { ...message, document: { file_id: "OFFLINE_REPLAY_FILE", file_name: "synthetic-test.pdf" }, caption: "Original test caption" } });
    expect((await POST(signedRequest(body))).status).toBe(503); expect(mocks.after).not.toHaveBeenCalled();
    const replay = await POST(signedRequest(body)); expect(replay.status).toBe(200); expect(await replay.json()).toEqual({ ok: true, duplicate: true });
    expect(mocks.rpc).toHaveBeenCalledWith("private_beta_track_source_v1", { target_tenant_id: tenantId, target_conversation_id: conversationId, source_message_id_value: messageId });
    expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
