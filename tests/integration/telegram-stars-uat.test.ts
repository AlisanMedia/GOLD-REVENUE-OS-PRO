import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { connectTelegramStarsUat, type StarsUatAttemptCustody } from "../../apps/web/src/lib/payments/telegram-stars-uat";
import { starsUatInvoicePayload } from "../../packages/domain/src/telegram-stars-uat";

const now = Date.parse("2026-10-26T12:00:00Z"), stamp = now / 1000;
const program = "9fcc1400-0000-4000-8000-000000000001", tenant = "9fcc1400-0000-4000-8000-000000000002", invoiceId = "9fcc1400-0000-4000-8000-000000000003";
const token = "7100000001:SYNTHETIC_NOT_A_REAL_BOT_CREDENTIAL", secret = "SYNTHETIC_WEBHOOK_SECRET_NOT_A_CREDENTIAL";
const invoice = { version: 1, environment: "TELEGRAM_DEDICATED_TEST", program_id: program, tenant_id: tenant, invoice_id: invoiceId, bot_user_id: "7100000001", payer_user_id: "7100000002", product_code: "POLAT_VIP_30D_DRAFT", duration_days: 30, currency: "XTR", amount_units: "1", issued_at: new Date(now - 60000).toISOString(), expires_at: new Date(now + 60000).toISOString() };
const authority = { version: 1, scope: "TELEGRAM_STARS_PRIVATE_BETA_TEST", environment: "TELEGRAM_DEDICATED_TEST", program_id: program, tenant_id: tenant,
  bot_user_id: "7100000001", authority_record_id: "9fcc1400-0000-4000-8000-000000000004", binding_revision: 1, release_sha: "a".repeat(40), expires_at: new Date(now + 60000).toISOString(),
  permitted_payers: ["7100000002"], approved_test_amount_units: "1", allowed_operations: ["getMe", "sendInvoice", "answerPreCheckoutQuery", "getStarTransactions", "refundStarPayment"] };
function webhook(kind: "PAYMENT" | "REFUND" = "PAYMENT") {
  return JSON.stringify({ update_id: kind === "PAYMENT" ? 101 : 102, message: { from: { id: 7100000002, is_bot: false }, chat: { id: 7100000002, type: "private" }, date: stamp,
    [kind === "PAYMENT" ? "successful_payment" : "refunded_payment"]: { currency: "XTR", total_amount: 1, invoice_payload: starsUatInvoicePayload(invoiceId), telegram_payment_charge_id: "OPAQUE-charge-1", provider_payment_charge_id: "" } } });
}
function transactions(kind: "PAYMENT" | "REFUND" = "PAYMENT") { return { transactions: [{ id: "OPAQUE-charge-1", amount: 1, date: stamp,
  [kind === "PAYMENT" ? "source" : "receiver"]: { type: "user", user: { id: 7100000002, is_bot: false }, transaction_type: "invoice_payment", invoice_payload: starsUatInvoicePayload(invoiceId) } }] }; }
function fixture() {
  const order: string[] = [], reserved = new Set<string>(), records: Parameters<StarsUatAttemptCustody["record"]>[0][] = [];
  let current: unknown = structuredClone(authority), clock = now;
  const custody: StarsUatAttemptCustody = {
    async reserve(value) { order.push("reserve:" + value.operation); const unique = value.operation === "getMe" || value.operation === "getStarTransactions" ? value.request_key : value.effect_key;
      if (reserved.has(unique)) return { attempt_id: randomUUID(), dispatch: false }; reserved.add(unique); return { attempt_id: randomUUID(), dispatch: true }; },
    async record(value) { order.push("record:" + value.state); records.push(value); },
  };
  const transport = vi.fn<typeof fetch>().mockImplementation((url) => {
    const method = String(url).split("/").at(-1); order.push("dispatch:" + method);
    const result = method === "getMe" ? { id: 7100000001, is_bot: true, first_name: "SYNTHETIC TEST BOT" }
      : method === "sendInvoice" ? { message_id: 123, chat: { id: 7100000002, type: "private" }, invoice: { currency: "XTR", total_amount: 1 } }
        : method === "getStarTransactions" ? transactions() : true;
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result }), { status: 200 }));
  });
  const deps = { readAuthenticatedBinding: () => Promise.resolve(current), readProtectedCredential: () => Promise.resolve({ bot_token: token, webhook_secret: secret }), custody, transport, now: () => clock };
  return { deps, transport, records, order, setBinding: (v: unknown) => { current = v; }, setNow: (v: number) => { clock = v; } };
}
async function session(f: ReturnType<typeof fixture>, key = "connect-1") {
  const s = await connectTelegramStarsUat(f.deps, key);
  if (s.state !== "CONNECTED_TO_DEDICATED_TEST") throw Error("FIXTURE_CONNECTION_FAILED"); return s;
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("dedicated Telegram Stars TEST server transport, injected offline HTTP only", () => {
  it("authenticates the exact test-network bot and reserves before every fixed-host dispatch", async () => {
    const f = fixture(), s = await session(f); expect(s.financial_authority).toBe("NONE");
    expect(await s.sendInvoice(invoice, "invoice-1")).toEqual({ state: "ACKNOWLEDGED", value: { provider_message_id: "123" } });
    expect(f.order).toEqual(["reserve:getMe", "dispatch:getMe", "record:ACKNOWLEDGED", "reserve:sendInvoice", "dispatch:sendInvoice", "record:ACKNOWLEDGED"]);
    for (const [url, options] of f.transport.mock.calls) { expect(url).toMatch(/^https:\/\/api\.telegram\.org\/bot[^/]+\/test\/(getMe|sendInvoice)$/u); expect(options).toMatchObject({ redirect: "error", cache: "no-store" }); }
    const sent = JSON.parse(String(f.transport.mock.calls[1]?.[1]?.body)); expect(sent).toMatchObject({ currency: "XTR", provider_token: "", prices: [{ amount: 1 }] });
    expect(JSON.stringify(f.records)).not.toContain(token); expect(JSON.stringify(f.records)).not.toContain(secret);
  });
  it("does not accept an arbitrary JSON activation flag or missing authenticated binding", async () => {
    const f = fixture(); f.setBinding({ ...authority, execution_enabled: true }); expect((await connectTelegramStarsUat(f.deps, "connect")).state).toBe("BLOCKED");
    f.setBinding(null); expect((await connectTelegramStarsUat(f.deps, "connect2")).state).toBe("BLOCKED"); expect(f.transport).not.toHaveBeenCalled();
  });
  it("marks mismatched getMe identity UNKNOWN before recording, never mints a session", async () => {
    const f = fixture(); f.transport.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { id: 7100000009, is_bot: true } })));
    expect((await connectTelegramStarsUat(f.deps, "connect")).state).toBe("UNKNOWN"); expect(f.records.at(-1)?.state).toBe("UNKNOWN"); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it("keeps an unpriced draft blocked, without inferring XTR from the USD reference", async () => {
    const f = fixture(); f.setBinding({ ...authority, approved_test_amount_units: null }); const s = await session(f);
    expect((await s.sendInvoice(invoice, "invoice")).state).toBe("BLOCKED"); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it("rejects wrong tenant, bot, payer, live environment and price before a payment API call", async () => {
    const f = fixture(), s = await session(f);
    for (const changed of [{ tenant_id: randomUUID() }, { bot_user_id: "7100000009" }, { payer_user_id: "7100000009" }, { environment: "LIVE" }, { amount_units: "2" }]) expect((await s.sendInvoice({ ...invoice, ...changed }, randomUUID())).state).toBe("BLOCKED");
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it("fences consent/binding revision drift between connection and dispatch", async () => {
    const f = fixture(), s = await session(f); f.setBinding({ ...authority, binding_revision: 2, permitted_payers: ["7100000009"] });
    expect((await s.sendInvoice(invoice, "invoice")).state).toBe("BLOCKED"); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it("requires verified webhook secret and opaque matching capabilities, not copied JSON", async () => {
    const f = fixture(), s = await session(f);
    expect(() => s.authenticateWebhook(webhook(), "WRONG", invoice)).toThrow("STARS_TEST_WEBHOOK_AUTH_OR_BINDING_INVALID");
    expect(() => s.readUpdate({ kind: "AUTHENTICATED_STARS_TEST_UPDATE" })).toThrow("STARS_TEST_UPDATE_CAPABILITY_DENIED");
    const e = s.authenticateWebhook(webhook(), secret, invoice); expect(s.readUpdate(e).kind).toBe("PAYMENT");
    expect(() => s.assess(invoice, e, { kind: "AUTHENTICATED_STARS_TEST_LEDGER" }, [])).toThrow("STARS_TEST_EVIDENCE_CAPABILITY_DENIED");
  });
  it("precheckout only acknowledges readiness; no receipt or entitlement is created", async () => {
    const f = fixture(), s = await session(f);
    const raw = JSON.stringify({ update_id: 100, pre_checkout_query: { id: "precheckout-1", from: { id: 7100000002, is_bot: false }, currency: "XTR", total_amount: 1, invoice_payload: starsUatInvoicePayload(invoiceId) } });
    const e = s.authenticateWebhook(raw, secret, invoice);
    expect(await s.answerPreCheckout(invoice, e, "precheckout")).toEqual({ state: "ACKNOWLEDGED", value: { accepted_for_test_checkout_only: true } });
    expect(await s.answerPreCheckout(invoice, { kind: "AUTHENTICATED_STARS_TEST_UPDATE" }, "tampered")).toMatchObject({ state: "BLOCKED" });
    expect(f.transport).toHaveBeenCalledTimes(2);
  });
  it("rejects an aged precheckout capability before dispatch, preserving the documented deadline", async () => {
    const f = fixture(), s = await session(f);
    const raw = JSON.stringify({ update_id: 100, pre_checkout_query: { id: "precheckout-old", from: { id: 7100000002, is_bot: false }, currency: "XTR", total_amount: 1, invoice_payload: starsUatInvoicePayload(invoiceId) } });
    const e = s.authenticateWebhook(raw, secret, invoice); f.setNow(now + 9000);
    expect((await s.answerPreCheckout(invoice, e, "old-query")).state).toBe("BLOCKED"); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it("corroborates callback and independent ledger; refund ACK remains distinct from actual refund evidence", async () => {
    const f = fixture(), s = await session(f), e = s.authenticateWebhook(webhook(), secret, invoice), read = await s.readLedger(0, 25, "ledger-1");
    if (read.state !== "ACKNOWLEDGED") throw Error("FIXTURE_LEDGER_FAILED");
    const paid = s.assess(invoice, e, read.value, []); expect(paid.assessment).toMatchObject({ state: "CORROBORATED_TEST_FACTS", financial_authority: "NONE", genuine_receipt_authorized: false }); expect(paid.payment).not.toBeNull();
    expect(await s.refund(paid.payment!, "refund-1")).toEqual({ state: "ACKNOWLEDGED", value: { refund_request_acknowledged_only: true } });
    expect((await s.refund(paid.payment!, "refund-again")).state).toBe("BLOCKED");
    expect((await s.refund({ kind: "CORROBORATED_STARS_TEST_PAYMENT" }, "fake")).state).toBe("BLOCKED");
    f.transport.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: transactions("REFUND") })));
    const refundRead = await s.readLedger(0, 25, "ledger-refund"); if (refundRead.state !== "ACKNOWLEDGED") throw Error("FIXTURE_REFUND_LEDGER_FAILED");
    const refunded = s.assess(invoice, s.authenticateWebhook(webhook("REFUND"), secret, invoice), refundRead.value, [paid.assessment.history_entry!]);
    expect(refunded.assessment).toMatchObject({ state: "CORROBORATED_TEST_FACTS", reason: "TEST_REFUND_CORROBORATED", financial_authority: "NONE" });
  });
  it.each(["network", "partial", "oversized", "wrong-chat", "server-error", "invalid-usage-json"])("%s consumes a reservation, remains UNKNOWN and never retries", async kind => {
    const f = fixture(), s = await session(f);
    if (kind === "network") f.transport.mockRejectedValueOnce(Error("PRIVATE_PROVIDER_TEXT_DO_NOT_LOG"));
    else f.transport.mockResolvedValueOnce(new Response(kind === "partial" ? '{"ok":' : kind === "oversized" ? "x".repeat(16385) : kind === "invalid-usage-json" ? '{"ok":true,"ok":false}' : JSON.stringify({ ok: true, result: { message_id: 9, chat: { id: 7100000009, type: "private" }, invoice: { currency: "XTR", total_amount: 1 } } }), { status: kind === "server-error" ? 500 : 200 }));
    const r = await s.sendInvoice(invoice, "invoice-unknown"); expect(r.state).toBe("UNKNOWN"); expect(f.records.at(-1)?.state).toBe("UNKNOWN"); expect(JSON.stringify(r)).not.toContain("PRIVATE");
    expect((await s.sendInvoice(invoice, "another-key")).state).toBe("BLOCKED"); expect(f.transport).toHaveBeenCalledTimes(2);
    // Read-only reconciliation remains possible after an uncertain mutation.
    expect((await s.readLedger(0, 25, "reconcile")).state).toBe("ACKNOWLEDGED");
  });
  it("does not retry an explicit rate limit or reset the durable effect identity after restart", async () => {
    const f = fixture(), s = await session(f);
    f.transport.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 3 }, description: "DO_NOT_EXPOSE" }), { status: 429 }));
    expect(await s.sendInvoice(invoice, "invoice-1")).toEqual({ state: "REJECTED", reason: "STARS_TEST_PROVIDER_REJECTED_NO_AUTOMATIC_RETRY" });
    expect(f.transport).toHaveBeenCalledTimes(2);
    const restarted = await session(f, "connect-restart"); expect((await restarted.sendInvoice(invoice, "different-key")).state).toBe("BLOCKED"); expect(f.transport).toHaveBeenCalledTimes(3);
  });
  it("bounds concurrent independent sessions using shared durable reservation identity", async () => {
    const f = fixture(), a = await session(f, "connect-a"), b = await session(f, "connect-b");
    const results = await Promise.all([a.sendInvoice(invoice, "send-a"), b.sendInvoice(invoice, "send-b")]);
    expect(results.filter(r => r.state === "ACKNOWLEDGED")).toHaveLength(1); expect(results.filter(r => r.state === "BLOCKED")).toHaveLength(1); expect(f.transport).toHaveBeenCalledTimes(3);
  });
  it("enforces the deadline even if an injected transport ignores AbortSignal", async () => {
    vi.useFakeTimers(); const f = fixture(), s = await session(f); f.transport.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    const pending = s.sendInvoice(invoice, "invoice-timeout"); await vi.advanceTimersByTimeAsync(10001);
    expect((await pending).state).toBe("UNKNOWN"); expect(f.records.at(-1)?.state).toBe("UNKNOWN"); expect(f.transport).toHaveBeenCalledTimes(2);
  });
  it("fails before dispatch when externally cancelled and rejects ledger bounds", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    expect((await connectTelegramStarsUat({ ...f.deps, signal: controller.signal }, "cancelled")).state).toBe("BLOCKED"); expect(f.transport).not.toHaveBeenCalled();
    const s = await session(f); expect((await s.readLedger(0, 100, "invalid")).state).toBe("BLOCKED"); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it("holds an acknowledged provider response if durable outcome recording fails", async () => {
    const f = fixture(), s = await session(f); f.deps.custody.record = () => Promise.reject(Error("PRIVATE_DB_TEXT"));
    const result = await s.sendInvoice(invoice, "invoice"); expect(result.state).toBe("UNKNOWN"); expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(f.transport).toHaveBeenCalledTimes(2);
  });
  it("feeds TEST persistence only the opaque authenticated callback and independently committed ledger", async () => {
    const f = fixture(), record = vi.fn().mockResolvedValue({ recorded: true, replay: false, receipt_id: randomUUID(), subscription_id: randomUUID(), mode: "test", origin: "TELEGRAM_DEDICATED_TEST", financial_authority: "NONE" });
    const connected = await connectTelegramStarsUat({ ...f.deps, readTestHistory: () => Promise.resolve([]), recordTestEvidence: record }, "connect");
    if (connected.state !== "CONNECTED_TO_DEDICATED_TEST") throw Error("FIXTURE_CONNECTION_FAILED");
    const e = connected.authenticateWebhook(webhook(), secret, invoice), read = await connected.readLedger(0, 25, "ledger");
    if (read.state !== "ACKNOWLEDGED") throw Error("FIXTURE_LEDGER_FAILED");
    expect((await connected.recordTestEvidence(invoice, e, read.value)).state).toBe("ACKNOWLEDGED");
    expect(record).toHaveBeenCalledTimes(1); expect(record.mock.calls[0]?.[0]).toMatchObject({ invoice_id: invoiceId, event: { origin: "TELEGRAM_DEDICATED_TEST", kind: "PAYMENT" }, ledger: { complete: true } });
    expect(record.mock.calls[0]?.[0].ledger_attempt_id).toMatch(/^[a-f0-9-]{36}$/u);
    expect((await connected.recordTestEvidence(invoice, { kind: "AUTHENTICATED_STARS_TEST_UPDATE" }, read.value)).state).toBe("BLOCKED");
    expect(record).toHaveBeenCalledTimes(1);
  });
  it.each(["invite", "join", "revoke", "reconcile"])("executes %s only through a server-owned dedicated TEST lease and matching provider evidence", async operation => {
    const f = fixture(), channel = "-1007400000001", job = randomUUID();
    f.setBinding({ ...authority, test_channel_id: channel, revocable_payers: [invoice.payer_user_id], allowed_operations: [...authority.allowed_operations, "getChat", "getChatMember", "createChatInviteLink", "revokeChatInviteLink", "approveChatJoinRequest", "banChatMember", "sendMessage"] });
    f.transport.mockImplementation((url, options) => {
      const method = String(url).split("/").at(-1), b = JSON.parse(String(options?.body ?? "{}"));
      const result = method === "getMe" ? { id: 7100000001, is_bot: true }
        : method === "getChat" ? { id: Number(channel), type: "channel" }
          : method === "getChatMember" && b.user_id === 7100000001 ? { status: "administrator", user: { id: 7100000001, is_bot: true }, can_invite_users: true, can_restrict_members: true }
            : method === "getChatMember" ? { status: operation === "revoke" ? "kicked" : "member", user: { id: 7100000002, is_bot: false } }
              : method === "createChatInviteLink" ? { invite_link: "https://t.me/+SYNTHETIC_TEST_ONLY", expire_date: b.expire_date, creates_join_request: true, is_primary: false, is_revoked: false }
                : method === "revokeChatInviteLink" ? { is_revoked: true }
                  : method === "sendMessage" ? { message_id: 7, chat: { id: 7100000002, type: "private" } } : true;
      return Promise.resolve(new Response(JSON.stringify({ ok: true, result })));
    });
    const record = vi.fn().mockImplementation(value => Promise.resolve({ recorded: true, status: value.outcome.status, effect_known: true }));
    const s = await connectTelegramStarsUat({ ...f.deps, claimTestAccess: () => Promise.resolve({ job: { version: 1, program_id: program, tenant_id: tenant, job_id: job, lease_token: randomUUID(), operation, revision: 1, payer_user_id: invoice.payer_user_id,
      channel_id: channel, invite_reference: operation === "revoke" ? "https://t.me/+SYNTHETIC_TEST_ONLY" : null, invite_expires_at: new Date(now + 300000).toISOString(), subscription_active: operation !== "revoke" } }), recordTestAccess: record }, "connect");
    if (s.state !== "CONNECTED_TO_DEDICATED_TEST") throw Error("FIXTURE_CONNECTION_FAILED");
    const result = await s.processNextTestAccess("access");
    expect(result).toMatchObject({ state: "ACKNOWLEDGED", value: { status: operation === "invite" ? "INVITED" : operation === "revoke" ? "REVOKED" : "MEMBER" } });
    expect(record).toHaveBeenCalledTimes(1); expect(record.mock.calls[0]?.[0].outcome.primary_attempt_id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(JSON.stringify(result)).not.toContain("https://t.me/");
    expect(f.transport.mock.calls.every(([url]) => String(url).includes("/test/"))).toBe(true);
  });
  it("keeps an unknown TEST access effect reviewable, never asserts revoked or retries", async () => {
    const f = fixture(), record = vi.fn().mockResolvedValue({ recorded: true, status: "REVIEW", effect_known: false });
    f.setBinding({ ...authority, test_channel_id: "-1007400000001", revocable_payers: [invoice.payer_user_id], allowed_operations: [...authority.allowed_operations, "getChat", "getChatMember", "banChatMember"] });
    const s = await connectTelegramStarsUat({ ...f.deps, claimTestAccess: () => Promise.resolve({ job: { version: 1, program_id: program, tenant_id: tenant, job_id: randomUUID(), lease_token: randomUUID(), operation: "revoke", revision: 1,
      payer_user_id: invoice.payer_user_id, channel_id: "-1007400000001", invite_reference: null, invite_expires_at: new Date(now + 300000).toISOString(), subscription_active: false } }), recordTestAccess: record }, "connect");
    if (s.state !== "CONNECTED_TO_DEDICATED_TEST") throw Error("FIXTURE_CONNECTION_FAILED");
    f.transport.mockRejectedValueOnce(Error("PRIVATE_UNKNOWN_EFFECT"));
    const result = await s.processNextTestAccess("review"); expect(result.state).toBe("UNKNOWN"); expect(record.mock.calls[0]?.[0].outcome.status).toBe("UNKNOWN"); expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(f.transport).toHaveBeenCalledTimes(2);
  });
  it("requires a separately configured TEST channel and authenticated matching join request", async () => {
    const f = fixture(), s = await session(f); expect((await s.processNextTestAccess("disabled")).state).toBe("BLOCKED");
    f.setBinding({ ...authority, test_channel_id: "-1007400000001", allowed_operations: [...authority.allowed_operations, "approveChatJoinRequest"] });
    const record = vi.fn().mockResolvedValue({ queued: true });
    const connected = await connectTelegramStarsUat({ ...f.deps, recordTestJoinRequest: record }, "join-connect");
    if (connected.state !== "CONNECTED_TO_DEDICATED_TEST") throw Error("FIXTURE_CONNECTION_FAILED");
    const raw = JSON.stringify({ update_id: 900, chat_join_request: { chat: { id: -1007400000001, type: "channel" }, from: { id: 7100000002, is_bot: false }, date: stamp, invite_link: { invite_link: "https://t.me/+SYNTHETIC_TEST_ONLY", creates_join_request: true } } });
    expect((await connected.receiveTestJoinRequest(raw, "WRONG")).state).toBe("BLOCKED");
    expect((await connected.receiveTestJoinRequest(raw, secret)).state).toBe("ACKNOWLEDGED");
    expect(record).toHaveBeenCalledTimes(1); expect(record.mock.calls[0]?.[0]).not.toHaveProperty("invite_reference");
  });
});
