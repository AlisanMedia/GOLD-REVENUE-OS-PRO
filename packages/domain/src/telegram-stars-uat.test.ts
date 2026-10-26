import { describe, expect, it } from "vitest";
import { assessTelegramStarsUatEvidence, parseTelegramStarsUatLedger, parseTelegramStarsUatUpdate, prepareTelegramStarsUatInvoice, starsUatInvoicePayload,
  type StarsUatHistory, type TelegramStarsUatInvoice } from "./telegram-stars-uat";

const now = Date.parse("2026-10-26T12:00:00Z"), iso = new Date(now).toISOString(), stamp = now / 1000;
const invoice: TelegramStarsUatInvoice = { version: 1, environment: "TELEGRAM_DEDICATED_TEST", program_id: "9fcc1200-0000-4000-8000-000000000001", tenant_id: "9fcc1200-0000-4000-8000-000000000002", invoice_id: "9fcc1200-0000-4000-8000-000000000003",
  bot_user_id: "7100000001", payer_user_id: "7100000002", product_code: "POLAT_VIP_30D_DRAFT", duration_days: 30, currency: "XTR", amount_units: "1", issued_at: new Date(now - 60000).toISOString(), expires_at: new Date(now + 60000).toISOString() };
const body = (kind: "PAYMENT" | "REFUND" = "PAYMENT", charge = "opaque-CHARGE-AbC") => {
  const payment = { currency: "XTR", total_amount: 1, invoice_payload: starsUatInvoicePayload(invoice.invoice_id), telegram_payment_charge_id: charge, provider_payment_charge_id: "" };
  return { update_id: kind === "PAYMENT" ? 101 : 102, message: { from: { id: 7100000002, is_bot: false }, chat: { id: 7100000002, type: "private" }, date: stamp, successful_payment: kind === "PAYMENT" ? payment : undefined, refunded_payment: kind === "REFUND" ? payment : undefined } };
};
const ledgerBody = (kind: "PAYMENT" | "REFUND" = "PAYMENT", charge = "opaque-CHARGE-AbC") => {
  const party = { type: "user", user: { id: 7100000002, is_bot: false }, transaction_type: "invoice_payment", invoice_payload: starsUatInvoicePayload(invoice.invoice_id) };
  return { ok: true, result: { transactions: [{ id: charge, amount: 1, date: stamp, source: kind === "PAYMENT" ? party : undefined, receiver: kind === "REFUND" ? party : undefined }] } };
};
const event = (kind: "PAYMENT" | "REFUND" = "PAYMENT") => parseTelegramStarsUatUpdate(JSON.stringify(body(kind)), invoice, now);
const ledger = (kind: "PAYMENT" | "REFUND" = "PAYMENT") => parseTelegramStarsUatLedger(JSON.stringify(ledgerBody(kind)), invoice.bot_user_id, 0, 25, iso);
const assess = (history: readonly StarsUatHistory[] = []) => assessTelegramStarsUatEvidence(invoice, event(), ledger(), history, now);

describe("Telegram Stars dedicated-network test contracts; no financial authority", () => {
  it("prepares only an explicit test XTR price, empty provider token and private single-use invoice", () => {
    const prepared = prepareTelegramStarsUatInvoice(invoice, now);
    expect(prepared).toMatchObject({ chat_id: invoice.payer_user_id, currency: "XTR", provider_token: "", prices: [{ amount: 1 }], protect_content: true });
    expect(prepared.title).toContain("TEST ONLY"); expect(prepared.description).toContain("No real money"); expect(JSON.stringify(prepared)).not.toContain("69.00");
  });
  it.each([null, "0", "-1", "1.0", "1e3", "9007199254740992", 1])("rejects missing, inexact or overflow Stars price %s", amount_units => {
    expect(() => prepareTelegramStarsUatInvoice({ ...invoice, amount_units }, now)).toThrow();
  });
  it("preserves the maximum exact safe atomic unit boundary without rounding or FX", () => {
    expect(prepareTelegramStarsUatInvoice({ ...invoice, amount_units: "9007199254740991" }, now).prices[0]?.amount).toBe(9007199254740991);
    expect(() => prepareTelegramStarsUatInvoice({ ...invoice, currency: "USD" }, now)).toThrow();
  });
  it("rejects an expired, future-issued or unexpected-authority invoice", () => {
    expect(() => prepareTelegramStarsUatInvoice({ ...invoice, expires_at: iso }, now)).toThrow();
    expect(() => prepareTelegramStarsUatInvoice({ ...invoice, issued_at: new Date(now + 1).toISOString() }, now)).toThrow();
    expect(() => prepareTelegramStarsUatInvoice({ ...invoice, financial_authority: "LIVE" }, now)).toThrow();
  });
  it("projects successful-payment evidence without raw body, user profile or secret", () => {
    const v = event(); expect(v).toMatchObject({ kind: "PAYMENT", origin: "TELEGRAM_DEDICATED_TEST", charge_id: "opaque-CHARGE-AbC", amount_units: "1" });
    expect(JSON.stringify(v)).not.toContain("is_bot"); expect(v.raw_hash).toMatch(/^[a-f0-9]{64}$/u);
  });
  it.each(["payer", "chat", "currency", "amount", "invoice", "recurring", "future", "stale"])("rejects mismatched %s update before persistence", kind => {
    const v = body(), p = v.message.successful_payment!;
    if (kind === "payer") v.message.from.id = 7100000009;
    if (kind === "chat") v.message.chat.id = 7100000009;
    if (kind === "currency") p.currency = "USD";
    if (kind === "amount") p.total_amount = 2;
    if (kind === "invoice") p.invoice_payload = "unrelated";
    if (kind === "recurring") Object.assign(p, { is_recurring: true });
    if (kind === "future") v.message.date += 61;
    if (kind === "stale") v.message.date -= 301;
    expect(() => parseTelegramStarsUatUpdate(JSON.stringify(v), invoice, now)).toThrow("STARS_TEST_UPDATE_INVALID");
  });
  it.each(["duplicate", "escaped-duplicate", "exponent", "decimal", "overflow", "oversized"])("rejects unsafe raw JSON %s", kind => {
    let raw = JSON.stringify(body());
    if (kind === "duplicate") raw = raw.replace('"update_id":101', '"update_id":101,"update_id":102');
    if (kind === "escaped-duplicate") raw = raw.replace('"total_amount":1', '"total_amount":1,"total_\\u0061mount":2');
    if (kind === "exponent") raw = raw.replace('"total_amount":1', '"total_amount":1e0');
    if (kind === "decimal") raw = raw.replace('"total_amount":1', '"total_amount":1.0');
    if (kind === "overflow") raw = raw.replace('"total_amount":1', '"total_amount":9007199254740992');
    if (kind === "oversized") raw += " ".repeat(16385);
    expect(() => parseTelegramStarsUatUpdate(raw, invoice, now)).toThrow("STARS_TEST_UPDATE_INVALID");
  });
  it("never treats a precheckout approval as received payment", () => {
    const raw = JSON.stringify({ update_id: 102, pre_checkout_query: { id: "query-1", from: { id: 7100000002, is_bot: false }, currency: "XTR", total_amount: 1, invoice_payload: starsUatInvoicePayload(invoice.invoice_id) } });
    const e = parseTelegramStarsUatUpdate(raw, invoice, now);
    expect(assessTelegramStarsUatEvidence(invoice, e, ledger(), [], now)).toMatchObject({ state: "PENDING", reason: "PRE_CHECKOUT_IS_NOT_PAYMENT", financial_authority: "NONE" });
  });
  it("corroborates only dedicated test facts, never a genuine receipt or live access", () => {
    const result = assess(); expect(result).toMatchObject({ state: "CORROBORATED_TEST_FACTS", financial_authority: "NONE", genuine_receipt_authorized: false, amount_units: "1", replay: false });
    expect(result.history_entry).not.toBeNull(); expect(JSON.stringify(result)).not.toContain(invoice.payer_user_id);
  });
  it("requires independent, fresh, complete ledger observation", () => {
    for (const changed of [null, { ...ledger(), complete: false }, { ...ledger(), raw_hash: event().raw_hash }, { ...ledger(), read_at: new Date(now - 300001).toISOString() }, { ...ledger(), read_at: new Date(now + 60001).toISOString() }]) {
      expect(assessTelegramStarsUatEvidence(invoice, event(), changed, [], now).state).toBe("PENDING");
    }
    expect(assessTelegramStarsUatEvidence(invoice, event(), { ...ledger(), read_at: "not-time" }, [], now).state).toBe("REJECTED");
  });
  it("keeps full or non-first ledger pages incomplete and respects hard bounds", () => {
    expect(parseTelegramStarsUatLedger(JSON.stringify(ledgerBody()), invoice.bot_user_id, 0, 1, iso).complete).toBe(false);
    expect(parseTelegramStarsUatLedger(JSON.stringify(ledgerBody()), invoice.bot_user_id, 1, 25, iso).complete).toBe(false);
    for (const limit of [0, 26, 100]) expect(() => parseTelegramStarsUatLedger(JSON.stringify(ledgerBody()), invoice.bot_user_id, 0, limit, iso)).toThrow();
  });
  it.each(["payer", "amount", "invoice", "duplicates", "direction", "nanostars"])("holds or rejects conflicting ledger %s", kind => {
    const v = ledgerBody(), t = v.result.transactions[0]!, p = t.source!;
    if (kind === "payer") p.user.id = 7100000009;
    if (kind === "amount") t.amount = 2;
    if (kind === "invoice") p.invoice_payload = "unrelated";
    if (kind === "duplicates") v.result.transactions.push(structuredClone(t));
    if (kind === "direction") { t.receiver = p; t.source = undefined; }
    if (kind === "nanostars") { Object.assign(t, { nanostar_amount: 1 }); expect(() => parseTelegramStarsUatLedger(JSON.stringify(v), invoice.bot_user_id, 0, 25, iso)).toThrow(); return; }
    const result = assessTelegramStarsUatEvidence(invoice, event(), parseTelegramStarsUatLedger(JSON.stringify(v), invoice.bot_user_id, 0, 25, iso), [], now);
    expect(result.state).toBe(kind === "direction" ? "PENDING" : "REVIEW");
  });
  it("holds late payment as review instead of silently creating a valid subscription", () => {
    const late = { ...invoice, issued_at: new Date(now - 120000).toISOString(), expires_at: new Date(now - 1000).toISOString() };
    const e = parseTelegramStarsUatUpdate(JSON.stringify(body()), late, now);
    expect(assessTelegramStarsUatEvidence(late, e, ledger(), [], now)).toMatchObject({ state: "REVIEW", reason: "PAYMENT_AFTER_INVOICE_EXPIRY", amount_units: null });
  });
  it("replay delivery and different events for the same operation do not create another movement", () => {
    const prior = assess().history_entry!;
    expect(assess([prior])).toMatchObject({ replay: true, operation_key: prior.operation_key });
    const v = body(); v.update_id++;
    const another = assessTelegramStarsUatEvidence(invoice, parseTelegramStarsUatUpdate(JSON.stringify(v), invoice, now), ledger(), [prior], now);
    expect(another).toMatchObject({ replay: true, operation_key: prior.operation_key }); expect(another.delivery_key).not.toBe(prior.delivery_key);
  });
  it("rejects operation reuse across tenants and delivery facts changing under the same update identity", () => {
    const prior = assess().history_entry!;
    expect(assess([{ ...prior, tenant_id: "9fcc1200-0000-4000-8000-000000000009" }])).toMatchObject({ state: "REJECTED", reason: "GLOBAL_OPERATION_REUSE" });
    expect(assess([{ ...prior, raw_hash: "f".repeat(64) }])).toMatchObject({ state: "REVIEW", reason: "DELIVERY_CONFLICT" });
  });
  it("holds a second distinct actual payment against an already allocated test invoice", () => {
    const raw = body("PAYMENT", "second-actual-charge"); raw.update_id = 900;
    const e = parseTelegramStarsUatUpdate(JSON.stringify(raw), invoice, now), l = parseTelegramStarsUatLedger(JSON.stringify(ledgerBody("PAYMENT", "second-actual-charge")), invoice.bot_user_id, 0, 25, iso);
    expect(assessTelegramStarsUatEvidence(invoice, e, l, [assess().history_entry!], now)).toMatchObject({ state: "REVIEW", reason: "SECOND_PAYMENT_FOR_INVOICE", amount_units: null });
  });
  it("uses separate payment/refund identities even when Telegram reuses the charge id", () => {
    const paid = assess(), refund = assessTelegramStarsUatEvidence(invoice, event("REFUND"), ledger("REFUND"), [paid.history_entry!], now);
    expect(refund).toMatchObject({ state: "CORROBORATED_TEST_FACTS", reason: "TEST_REFUND_CORROBORATED", financial_authority: "NONE" });
    expect(refund.operation_key).not.toBe(paid.operation_key);
    expect(assessTelegramStarsUatEvidence(invoice, event("REFUND"), ledger("REFUND"), [paid.history_entry!, refund.history_entry!], now).replay).toBe(true);
  });
  it("does not allocate a refund before its original corroborated payment", () => {
    expect(assessTelegramStarsUatEvidence(invoice, event("REFUND"), ledger("REFUND"), [], now)).toMatchObject({ state: "PENDING", reason: "REFUND_ORIGINAL_PAYMENT_REQUIRED" });
  });
  it("does not normalize opaque charge case or accept a foreign bot scope", () => {
    const e = parseTelegramStarsUatUpdate(JSON.stringify(body("PAYMENT", "opaque-charge-abc")), invoice, now), l = parseTelegramStarsUatLedger(JSON.stringify(ledgerBody("PAYMENT", "opaque-charge-abc")), invoice.bot_user_id, 0, 25, iso);
    expect(assessTelegramStarsUatEvidence(invoice, e, l, [], now).operation_key).not.toBe(assess().operation_key);
    expect(assessTelegramStarsUatEvidence(invoice, { ...event(), bot_user_id: "7100000009" }, ledger(), [], now).state).toBe("REJECTED");
  });
  it("rejects oversized or malformed history and unexpected authority fields", () => {
    expect(assess(Array.from({ length: 101 }, () => assess().history_entry!)).state).toBe("REJECTED");
    expect(assessTelegramStarsUatEvidence(invoice, { ...event(), financial_authority: "LIVE" } as ReturnType<typeof event>, ledger(), [], now).state).toBe("REJECTED");
  });
});
