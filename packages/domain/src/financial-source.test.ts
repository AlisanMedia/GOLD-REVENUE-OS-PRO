import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  financialSourceContractSchema, financialAssessmentContextSchema, FINANCIAL_REASONS,
  type FinancialSourceContract, type FinancialAssessmentContext, type FinancialFacts, type FinancialAssessment,
} from "@gold-revenue-os/contracts";
import {
  assessFinancialSource, financialFactHash, financialOperationIdentity, financialLegacyReference,
  financialUnavailable, projectFinancialAssessment, financialReasonText,
} from "./financial-source";
import { parseFinancialJson, canonicalFinancialJson, financialSha256, financialTuple } from "./financial-source-canonical";
import { atomicToDecimal } from "./payments";
import { subscriptionExpiry } from "./subscriptions";
import { METRIC_DICTIONARY, analyticsMetricSchema } from "./analytics";
import { EVENT_CONTRACTS } from "./state-event-engine";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = "2026-10-18T12:00:00.000Z";
const hash = (s: string) => financialSha256(s);
function fixture(): { source: FinancialSourceContract; context: FinancialAssessmentContext } {
  const asset: FinancialFacts["asset"] = { kind: "TOKEN", code: "FIXTURE_ASSET_A", network: "fixture:network", contract: "fixture:asset-contract", decimals: 6 };
  const account = { provider_id: "fixture:provider", merchant_account_id: "fixture:merchant" };
  const scope = { tenant_id: id(1), merchant_binding_id: id(2), merchant_revision: 1 };
  const invoice = { invoice_id: id(3), provider_invoice_id: "fixture:invoice", customer_id: id(4), offer_id: id(5), product_version_id: id(6), plan_version_id: id(7), offer_snapshot_hash: hash("offer") };
  const facts: FinancialFacts = {
    account, provider_invoice_id: invoice.provider_invoice_id,
    operation: { kind: "PAYMENT", direction: "IN", transaction_id: "fixture:charge", transfer_index: "0", original_operation_key: null, physical_transfer: null },
    received_units: "123456789", refunded_units: null, amount_basis: "GROSS_CREDIT", asset,
    payer_reference: "private:fixture-payer", recipient_reference: "private:fixture-recipient",
    occurred_at: "2026-10-18T11:59:30.000Z", canonical: true, confirmations: 20, settlement_status: "SETTLED", fee: null, payout: null,
  };
  return {
    source: {
      contract_version: 1, evidence_origin: "SYNTHETIC", provider_environment: "FIXTURE", account, scope,
      invoice_binding: invoice,
      callback: { delivery_id: "delivery:1", event_id: "event:1", source_id: "fake:callback", raw_hash: hash("callback bytes"),
        acquisition: "CALLBACK", authentication: "AUTHENTICATED", authentication_method: "SYNTHETIC", key_reference: "fixture:key-reference",
        source_time: "2026-10-18T11:59:31.000Z", received_at: "2026-10-18T11:59:32.000Z", facts: structuredClone(facts) },
      independent_read: { acquisition: "PROVIDER_LEDGER", status: "OK", source_id: "fake:ledger", source_record_id: "fake:record:1", response_hash: hash("independent bytes"),
        authenticated_account: account, decoder_version: "fixture:v1", read_at: "2026-10-18T11:59:50.000Z", complete: true, source_revision: 1, facts: structuredClone(facts) },
    },
    context: {
      now: stamp, expected_account: structuredClone(account), expected_scope: structuredClone(scope), expected_invoice: structuredClone(invoice),
      merchant_status: "ACTIVE", merchant_approval_reference: "fixture:approval", expected_asset: structuredClone(asset), expected_units: "123456789",
      expected_basis: "GROSS_CREDIT", expected_payer: facts.payer_reference, expected_recipient: facts.recipient_reference,
      invoice_expires_at: "2026-10-18T12:05:00.000Z", history_complete: true,
      policy: { version: "fixture:policy:v1", hash: hash("policy"), source_revision: 1, callback_max_age_seconds: 300, read_max_age_seconds: 60, clock_skew_seconds: 2, min_confirmations: 20, require_canonical: true, physical_transfer_required: false, distinct_refund_identity_supported: true },
    },
  };
}
function changeFacts(source: FinancialSourceContract, change: (facts: FinancialFacts) => void) {
  change(source.independent_read!.facts!);
  source.callback!.facts = structuredClone(source.independent_read!.facts!);
}
function evaluate(f = fixture(), history: unknown = []) { return assessFinancialSource(f.source, f.context, history); }
function record(result: FinancialAssessment) { expect(result.history_record).not.toBeNull(); return result.history_record!; }
function refund(original: FinancialAssessment, suffix = "1", amount = "10000000") {
  const f = fixture();
  changeFacts(f.source, facts => {
    facts.operation = { ...facts.operation, kind: "REFUND", direction: "OUT", original_operation_key: original.history_record?.operation_key ?? hash("missing:original"), transaction_id: "fixture:refund:" + suffix };
    facts.received_units = null; facts.refunded_units = amount; facts.amount_basis = "GROSS_DEBIT";
  });
  f.source.callback!.delivery_id = "refund:delivery:" + suffix;
  f.context.expected_basis = "GROSS_DEBIT";
  return f;
}
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN_IN_FINANCIAL_CONTRACT_TEST"); })); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("Phase16C-1A A01–A44: synthetic contract acceptance, never DB/provider authority", () => {
  it("A01 separate fake sources yield sandbox readiness only", () => {
    const f = fixture(), before = structuredClone(f), result = evaluate(f);
    expect(result).toMatchObject({ source_state: "SOURCE_VERIFIED", fulfillment_eligibility: "ELIGIBLE", financial_authority: "NONE", classification: "SANDBOX", received_units: "123456789" });
    expect(f).toEqual(before); expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private:fixture|fixture:key-reference/u);
  });
  it("A02 missing actual amount stays null, not invoice price", () => {
    const f = fixture(); changeFacts(f.source, x => { x.received_units = null; });
    expect(evaluate(f)).toMatchObject({ source_state: "PENDING", received_units: null, reasons: ["AMOUNT_MISSING"] });
  });
  it("A03 callback and read disagreement is review, neither wins", () => {
    const f = fixture(); f.source.callback!.facts.received_units = "1";
    expect(evaluate(f).reasons).toEqual(["SOURCE_CONFLICT"]);
  });
  it.each(["SCREENSHOT", "CLIENT", "PRECHECKOUT"] as const)("A04 %s cannot be payment authority", acquisition => {
    const f = fixture(); f.source.callback!.acquisition = acquisition;
    expect(evaluate(f)).toMatchObject({ source_state: "REJECTED", financial_authority: "NONE" });
  });
  it("A05 invalid synthetic auth and old replay timestamp are rejected", () => {
    const f = fixture(); f.source.callback!.authentication = "INVALID";
    expect(evaluate(f).reasons).toEqual(["AUTHENTICATION_FAILED"]);
    f.source.callback!.authentication = "AUTHENTICATED"; f.source.callback!.source_time = "2026-10-18T11:00:00.000Z";
    expect(evaluate(f).reasons).toEqual(["REPLAY_WINDOW"]);
  });
  it("A06 rejects oversized raw bodies, nested/escaped duplicate keys and invalid UTF8", () => {
    expect(() => parseFinancialJson(' '.repeat(16385))).toThrow("FINANCIAL_JSON_INVALID");
    for (const raw of ['{"a":1,"a":2}', '{"x":[{"a":1,"\\u0061":2}]}', '{"a":1,}', '[1,]']) expect(() => parseFinancialJson(raw)).toThrow();
    expect(() => parseFinancialJson(new Uint8Array([0xff]))).toThrow();
    expect(parseFinancialJson('{"a":[{"b":"escaped \\" quote"}]}')).toEqual({ a: [{ b: 'escaped " quote' }] });
  });
  it.each([1.2, 1, "1e6", "01", "-1", "1.0", "1,000", "9".repeat(31)])("A07 invalid amount %s is rejected", amount => {
    const f = fixture();
    const source = structuredClone(f.source) as unknown as { independent_read: { facts: { received_units: unknown } } };
    source.independent_read.facts.received_units = amount;
    expect(assessFinancialSource(source, f.context).source_state).toBe("REJECTED");
  });
  it("A07 decimals out of range and sub-millisecond time cannot be rounded", () => {
    const f = fixture(); changeFacts(f.source, x => { x.asset.decimals = 19; });
    expect(evaluate(f).source_state).toBe("REJECTED");
    f.source = fixture().source; f.source.callback!.received_at = "2026-10-18T11:59:32.000001Z";
    expect(evaluate(f).source_state).toBe("REJECTED");
  });
  it("A08 exact 30-digit boundary, minimum atomic unit and zero-credit pending", () => {
    const f = fixture(); f.context.expected_units = "9".repeat(30);
    changeFacts(f.source, x => { x.received_units = f.context.expected_units; });
    expect(evaluate(f).received_units).toBe("9".repeat(30));
    expect(atomicToDecimal("1", 6)).toBe("0.000001");
    changeFacts(f.source, x => { x.received_units = "0"; });
    expect(evaluate(f)).toMatchObject({ source_state: "PENDING", reasons: ["NO_ACTUAL_MOVEMENT"] });
  });
  it.each(["code", "network", "contract", "decimals"] as const)("A09 %s mismatch requires review", field => {
    const f = fixture(); changeFacts(f.source, x => { if (field === "decimals") x.asset.decimals = 5; else x.asset[field] = "fixture:other"; });
    expect(evaluate(f).reasons).toEqual(["ASSET_MISMATCH"]);
  });
  it.each(["payer_reference", "recipient_reference"] as const)("A10 %s mismatch retains financial observation but blocks fulfillment", field => {
    const f = fixture(); changeFacts(f.source, x => { x[field] = "private:other"; });
    expect(evaluate(f)).toMatchObject({ source_state: "SOURCE_VERIFIED", fulfillment_eligibility: "REVIEW", reasons: ["PAYER_MISMATCH"] });
  });
  it.each(["MISSING", "REVOKED"] as const)("A11 merchant %s fails closed", status => {
    const f = fixture(); f.context.merchant_status = status;
    expect(evaluate(f).reasons).toEqual(["MERCHANT_UNAUTHORIZED"]);
  });
  it("A11 missing approval or provider account mismatch fails closed", () => {
    const f = fixture(); f.context.merchant_approval_reference = null;
    expect(evaluate(f).source_state).toBe("REJECTED");
    f.context.merchant_approval_reference = "fixture:approval";
    f.source.independent_read!.authenticated_account!.merchant_account_id = "other:account";
    expect(evaluate(f).source_state).toBe("REJECTED");
  });
  it.each(["tenant_id", "merchant_binding_id", "merchant_revision"] as const)("A12 server scope %s cannot be supplied by caller", field => {
    const f = fixture(); if (field === "merchant_revision") f.source.scope[field] = 2; else f.source.scope[field] = id(99);
    expect(evaluate(f).reasons).toEqual(["SCOPE_MISMATCH"]);
  });
  it.each(["customer_id", "invoice_id", "offer_id", "plan_version_id", "offer_snapshot_hash"] as const)("A12 invoice %s mismatch", field => {
    const f = fixture(); f.source.invoice_binding![field] = field === "offer_snapshot_hash" ? hash("other") : id(99);
    expect(evaluate(f).source_state).toBe("REJECTED");
  });
  it("A13 actual but unallocated source never invents a customer", () => {
    const f = fixture(); f.source.invoice_binding = null; f.context.expected_invoice = null;
    expect(evaluate(f)).toMatchObject({ source_state: "SOURCE_VERIFIED", fulfillment_eligibility: "REVIEW", reasons: ["UNALLOCATED"] });
  });
  it("A14 actual late funds survive while entitlement is held", () => {
    const f = fixture(); f.context.invoice_expires_at = "2026-10-18T11:50:00.000Z";
    expect(evaluate(f)).toMatchObject({ source_state: "SOURCE_VERIFIED", received_units: "123456789", fulfillment_eligibility: "REVIEW", reasons: ["LATE_PAYMENT"] });
  });
  it.each(["123456788", "123456790"])("A15 actual %s is not silently rounded to invoice", amount => {
    const f = fixture(); changeFacts(f.source, x => { x.received_units = amount; });
    expect(evaluate(f)).toMatchObject({ received_units: amount, fulfillment_eligibility: "REVIEW", reasons: ["AMOUNT_MISMATCH"] });
  });
  it("A16 two partial transfers cannot be summed into approved fulfillment", () => {
    const a = fixture(); changeFacts(a.source, x => { x.received_units = "60000000"; });
    const r = evaluate(a), b = fixture(); b.source.callback!.delivery_id = "delivery:2";
    changeFacts(b.source, x => { x.operation.transaction_id = "fixture:second-transfer"; x.received_units = "63456789"; });
    expect(evaluate(b, [record(r)])).toMatchObject({ received_units: "63456789", fulfillment_eligibility: "REVIEW", reasons: ["SECOND_PAYMENT"] });
  });
  it.each([null, 19])("A17 insufficient confirmations %s stay pending", confirmations => {
    const f = fixture(); changeFacts(f.source, x => { x.confirmations = confirmations; });
    expect(evaluate(f).reasons).toEqual(["INSUFFICIENT_FINALITY"]);
  });
  it("A17 unknown canonicality fails closed", () => {
    const f = fixture(); changeFacts(f.source, x => { x.canonical = null; });
    expect(evaluate(f).source_state).toBe("PENDING");
  });
  it("A18 identical delivery replay returns same operation, without input mutation", () => {
    const f = fixture(), first = evaluate(f), history = Object.freeze([Object.freeze(record(first))]);
    const next = evaluate(f, history);
    expect(next).toMatchObject({ replay: true, source_state: "SOURCE_VERIFIED", financial_authority: "NONE" });
    expect(next.history_record?.operation_key).toBe(first.history_record?.operation_key);
    expect(next.assessment_hash).toBe(first.assessment_hash);
  });
  it("A19 same delivery ID with conflicting bytes is held", () => {
    const f = fixture(), first = evaluate(f); f.source.callback!.raw_hash = hash("conflict");
    expect(evaluate(f, [record(first)]).reasons).toEqual(["DELIVERY_CONFLICT"]);
  });
  it("A20 distinct events for one operation cannot create a new operation", () => {
    const f = fixture(), a = evaluate(f); f.source.callback!.delivery_id = "delivery:2"; f.source.callback!.event_id = "event:2";
    const b = evaluate(f, [record(a)]);
    expect(b.replay).toBe(true); expect(b.history_record?.operation_key).toBe(a.history_record?.operation_key);
    expect(b.history_record?.delivery_key).not.toBe(a.history_record?.delivery_key);
  });
  it("A21 separate transfer indexes in one transaction remain distinct", () => {
    const f = fixture(), a = financialOperationIdentity(f.source.independent_read!.facts, "FIXTURE");
    changeFacts(f.source, x => { x.operation.transfer_index = "1"; });
    expect(financialOperationIdentity(f.source.independent_read!.facts, "FIXTURE").key).not.toBe(a.key);
  });
  it("A22 same operation cannot be reused under a different tenant", () => {
    const f = fixture(), a = evaluate(f), next = fixture();
    next.source.scope.tenant_id = id(99); next.context.expected_scope.tenant_id = id(99);
    expect(evaluate(next, [record(a)])).toMatchObject({ source_state: "REVIEW", reasons: ["OPERATION_CONFLICT"] });
  });
  it("A22 physical transfer reuse across merchant aliases and tenants fails", () => {
    const f = fixture(); changeFacts(f.source, x => { x.operation.physical_transfer = { ledger_id: x.asset.network!, transaction_id: x.operation.transaction_id, transfer_index: "0", recipient: x.recipient_reference! }; });
    const a = evaluate(f), next = structuredClone(f);
    next.source.scope.tenant_id = id(99); next.context.expected_scope.tenant_id = id(99);
    next.source.account.merchant_account_id = "fixture:other-merchant";
    next.context.expected_account.merchant_account_id = "fixture:other-merchant";
    next.source.independent_read!.authenticated_account!.merchant_account_id = "fixture:other-merchant";
    changeFacts(next.source, x => { x.account.merchant_account_id = "fixture:other-merchant"; });
    expect(evaluate(next, [record(a)]).reasons).toEqual(["PHYSICAL_REUSE"]);
  });
  it("A23 second actual payment for one invoice is a review, not second entitlement", () => {
    const f = fixture(), a = evaluate(f); f.source.callback!.delivery_id = "delivery:2";
    changeFacts(f.source, x => { x.operation.transaction_id = "fixture:charge:2"; });
    expect(evaluate(f, [record(a)])).toMatchObject({ source_state: "SOURCE_VERIFIED", fulfillment_eligibility: "REVIEW", reasons: ["SECOND_PAYMENT"] });
  });
  it("A24 canonical UTF8 golden vectors, property order, delimiter safety and exact opaque IDs", () => {
    const tuple = financialTuple("delivery", ["fixture:provider", "FIXTURE", "fixture:merchant", "delivery:1"]);
    expect(hash(tuple)).toBe("700422fc936e3a90b5abf6353ccd861a3672ad99c334044a822691eae5ae5470");
    const canonical = canonicalFinancialJson({ b: ["é", null, true], a: "İ" });
    expect(hash(canonical)).toBe("f395df87d266fc2aba0704914cdb718e2e9c0aba2b03ef192ed1b8c2727a2695");
    expect(canonical).toBe(canonicalFinancialJson({ a: "İ", b: ["é", null, true] }));
    expect(financialTuple("x", ["a:b", "c"])).not.toBe(financialTuple("x", ["a", "b:c"]));
    for (const [a, b] of [["ID", "id"], ["001", "1"], ["é", "e\u0301"]]) expect(financialTuple("x", [a!])).not.toBe(financialTuple("x", [b!]));
    expect(hash(canonicalFinancialJson({ x: "e\u0301" }))).toBe("35f78b22a07442667ba77286cd2cccc03ee4dba5431d5bf183a3d3984a99e5b2");
    expect(hash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("A25 missing/future/stale source timestamps and revisions fail closed", () => {
    const f = fixture(); changeFacts(f.source, x => { x.occurred_at = null; });
    expect(evaluate(f).reasons).toEqual(["SOURCE_TIME_MISSING"]);
    changeFacts(f.source, x => { x.occurred_at = "2026-10-19T12:00:00.000Z"; });
    expect(evaluate(f).reasons).toEqual(["SOURCE_TIME_INVALID"]);
    f.source = fixture().source; f.source.independent_read!.source_revision = 2;
    expect(evaluate(f).reasons).toEqual(["SOURCE_STALE"]);
    f.source.independent_read!.source_revision = 1; f.source.independent_read!.read_at = "2026-10-18T11:00:00.000Z";
    expect(evaluate(f).reasons).toEqual(["SOURCE_STALE"]);
  });
  it("A26 undefined policy/finality/freshness remains pending", () => {
    const f = fixture(); f.context.policy = null; expect(evaluate(f).reasons).toEqual(["POLICY_INCOMPLETE"]);
    f.context.policy = fixture().context.policy; f.context.policy!.min_confirmations = null;
    expect(evaluate(f).reasons).toEqual(["POLICY_INCOMPLETE"]);
  });
  it("A27 ledger-only observation does not substitute for missing callback", () => {
    const f = fixture(); f.source.callback = null;
    expect(evaluate(f)).toMatchObject({ source_state: "PENDING", reasons: ["CALLBACK_MISSING"] });
  });
  it.each(["TIMEOUT", "RATE_LIMITED", "UNAVAILABLE"] as const)("A28 provider %s is pending, never failed funds", status => {
    const f = fixture(); f.source.independent_read!.status = status;
    expect(evaluate(f)).toMatchObject({ source_state: "PENDING", reasons: ["SOURCE_UNAVAILABLE"] });
  });
  it("A28 incomplete ledger pagination never means payment absent", () => {
    const f = fixture(); f.source.independent_read!.complete = false;
    expect(evaluate(f).reasons).toEqual(["SOURCE_INCOMPLETE"]);
  });
  it("A29 refund sharing original charge reference has a distinct operation", () => {
    const original = evaluate(), f = refund(original); changeFacts(f.source, x => { x.operation.transaction_id = "fixture:charge"; });
    const r = evaluate(f, [record(original)]);
    expect(r.history_record?.operation_key).not.toBe(original.history_record?.operation_key);
    expect(r.refunded_units).toBe("10000000"); expect(r.fulfillment_eligibility).toBe("INELIGIBLE");
  });
  it("A30 separate partial refunds remain distinct; duplicate delivery not summed twice", () => {
    const original = evaluate(), one = evaluate(refund(original, "1", "50000000"), [record(original)]);
    const twoFixture = refund(original, "2", "70000000");
    const two = evaluate(twoFixture, [record(original), record(one), record(one)]);
    expect(two.reasons).toEqual(["REFUND_EFFECT_REVIEW"]);
    expect(two.refunded_units).toBe("70000000");
    expect(evaluate(twoFixture, [record(original), record(one), record(two)]).replay).toBe(true);
    expect(two.history_record?.operation_key).not.toBe(one.history_record?.operation_key);
  });
  it("A31 refund-before-payment and excess refund totals stay unresolved", () => {
    const original = evaluate(), f = refund(original, "1", "123456790");
    expect(evaluate(f).reasons).toEqual(["REFUND_ORIGINAL_MISSING"]);
    expect(evaluate(f, [record(original)]).reasons).toEqual(["REFUND_TOTAL_EXCEEDED"]);
    const refundFirst = evaluate(refund(original));
    expect(evaluate(fixture(), [record(refundFirst)]).reasons).toEqual(["REFUND_EFFECT_REVIEW"]);
  });
  it.each(["REFUND_REQUEST", "DISPUTE"] as const)("A32 %s without actual debit is not outflow", kind => {
    const f = fixture(); changeFacts(f.source, x => { x.operation.kind = kind; x.operation.direction = "NONE"; x.received_units = null; });
    expect(evaluate(f)).toMatchObject({ source_state: "REVIEW", refunded_units: null, reasons: ["NO_ACTUAL_MOVEMENT"] });
  });
  it("A33 later reversal/reorg produces new assessment without changing history", () => {
    const f = fixture(), original = evaluate(f), before = structuredClone(original);
    changeFacts(f.source, x => { x.settlement_status = "REVERSED"; x.canonical = false; });
    const later = evaluate(f, [record(original)]);
    expect(later).toMatchObject({ source_state: "REVIEW", reasons: ["SOURCE_REVERSED"] });
    expect(later.assessment_hash).not.toBe(original.assessment_hash); expect(original).toEqual(before);
  });
  it("A34 synthetic data cannot pretend LIVE; claimed provider data gains no authority", () => {
    const f = fixture(); f.source.provider_environment = "LIVE";
    expect(evaluate(f)).toMatchObject({ source_state: "REJECTED", financial_authority: "NONE" });
    f.source.evidence_origin = "PROVIDER";
    expect(evaluate(f)).toMatchObject({ source_state: "PENDING", financial_authority: "NONE", classification: "UNAVAILABLE", reasons: ["AUTHORITY_UNAVAILABLE"] });
  });
  it.each(["verified", "trusted", "financial_authority", "manager_approved", "ai_approved"])("A35 unexpected %s is not authority", field => {
    const f = fixture(); expect(assessFinancialSource({ ...f.source, [field]: true }, f.context).source_state).toBe("REJECTED");
    expect(assessFinancialSource(f.source, { ...f.context, [field]: true }).source_state).toBe("REJECTED");
  });
  it("A36 valid hash without authentication proves no payment", () => {
    const f = fixture(); f.source.callback!.authentication = "UNKNOWN";
    expect(evaluate(f).reasons).toEqual(["AUTHENTICATION_FAILED"]);
  });
  it("A37 callback cache and identical acquisition cannot pass independent-read guard", () => {
    const f = fixture(); f.source.independent_read!.acquisition = "CALLBACK_CACHE";
    expect(evaluate(f).reasons).toEqual(["INDEPENDENCE_MISSING"]);
    f.source.independent_read!.acquisition = "PROVIDER_LEDGER"; f.source.independent_read!.response_hash = f.source.callback!.raw_hash;
    expect(evaluate(f).reasons).toEqual(["INDEPENDENCE_MISSING"]);
  });
  it("A38 new read/advancing finality changes assessment, not financial operation/fact", () => {
    const f = fixture(), first = evaluate(f); f.context.now = "2026-10-18T12:00:01.000Z";
    f.source.independent_read!.read_at = "2026-10-18T12:00:00.000Z";
    changeFacts(f.source, x => { x.confirmations = 21; });
    const next = evaluate(f, [record(first)]);
    expect(next.replay).toBe(true); expect(next.history_record?.operation_key).toBe(first.history_record?.operation_key);
    expect(next.history_record?.fact_hash).toBe(first.history_record?.fact_hash); expect(next.assessment_hash).not.toBe(first.assessment_hash);
  });
  it("A39 assets remain separate, no known fee or payout is invented", () => {
    const f = fixture(), one = evaluate(f); changeFacts(f.source, x => { x.asset.code = "FIXTURE_ASSET_B"; });
    f.context.expected_asset.code = "FIXTURE_ASSET_B";
    const two = evaluate(f);
    expect(one.history_record?.asset_key).not.toBe(two.history_record?.asset_key);
    expect(two).toMatchObject({ fee: null, payout: null, financial_authority: "NONE" });
  });
  it("A40 missing cost/denominator/legacy amount remains unavailable, never zero", () => {
    expect(financialUnavailable()).toEqual({ status: "UNAVAILABLE", value: null, financial_authority: "NONE" });
    const f = fixture(); f.context.expected_units = null;
    expect(evaluate(f).fulfillment_eligibility).toBe("PENDING");
    expect(analyticsMetricSchema.parse({ id: "collected", status: "UNAVAILABLE", value: null, unit: "money", sample: 0, denominator: null, reason: "AUTHORITATIVE_AMOUNT_MISSING", basis: "PERIOD" }).value).toBeNull();
    expect(METRIC_DICTIONARY.collected.verification).toContain("no amount");
  });
  it("A41 pure role projection redacts source references and denies readonly", () => {
    const r = evaluate(); expect(projectFinancialAssessment(r, "readonly")).toBeNull();
    expect(projectFinancialAssessment(r, "analyst")?.received_units).toBeNull();
    for (const role of ["super_admin", "manager", "support"] as const) expect(projectFinancialAssessment(r, role)?.received_units).toBe("123456789");
    expect(JSON.stringify(projectFinancialAssessment(r, "manager"))).not.toMatch(/history_record|operation_tuple|delivery_key|private:|key-reference/u);
  });
  it("A42 safe serialization omits private data and errors echo no input", () => {
    const f = fixture(); changeFacts(f.source, x => { x.payer_reference = "private:DO_NOT_LOG"; });
    const result = evaluate(f);
    expect(JSON.stringify(result)).not.toContain("DO_NOT_LOG");
    expect(JSON.stringify(projectFinancialAssessment(result, "support"))).not.toContain("DO_NOT_LOG");
    const invalid = assessFinancialSource({ ...f.source, credential: "DO_NOT_LOG" }, f.context);
    expect(JSON.stringify(invalid)).not.toContain("DO_NOT_LOG");
  });
  it("A43 legacy alias is explicit, cannot emit an event or financial receipt", () => {
    const key = record(evaluate()).operation_key, ref = financialLegacyReference(key);
    expect(ref).toBe("fs1:" + key); expect(ref).not.toMatch(/^[a-f0-9]{64}$/u);
    expect(EVENT_CONTRACTS["payment.confirmed"].requiredPayloadKeys).toEqual(["payment_id", "tx_hash"]);
    expect(evaluate().financial_authority).toBe("NONE");
  });
  it("A44 existing calendar/fixed-day and time basis stay intact", () => {
    const terms = { duration_unit: "calendar_month", duration_count: 1 };
    expect(subscriptionExpiry("2024-01-31T00:00:00.000Z", terms)).toBe("2024-02-29T00:00:00.000Z");
    expect(subscriptionExpiry("2024-01-31T00:00:00.000Z", { ...terms, duration_unit: "fixed_days", duration_count: 30 })).toBe("2024-03-01T00:00:00.000Z");
    expect(METRIC_DICTIONARY.collected.time).toContain("verified_at");
    const f = fixture(); changeFacts(f.source, x => { x.occurred_at = "2026-10-18T14:59:30.000+03:00"; });
    expect(financialFactHash(f.source.independent_read!.facts)).toBe(financialFactHash(fixture().source.independent_read!.facts));
  });
});

describe("strict boundary and safe reason vocabulary", () => {
  it.each(FINANCIAL_REASONS)("TR/EN explicit reason: %s", reason => {
    expect(financialReasonText(reason)).toMatch(/[a-zA-ZıİşŞüÜğĞçÇöÖ]/u);
    expect(financialReasonText(reason, "en-US")).not.toBe(reason);
    expect(financialReasonText(reason)).not.toBe(financialReasonText(reason, "en-US"));
  });
  it("all nested structures reject injected authority fields", () => {
    const f = fixture(); expect(financialSourceContractSchema.safeParse(f.source).success).toBe(true);
    expect(financialAssessmentContextSchema.safeParse(f.context).success).toBe(true);
    const injectors: ((s: FinancialSourceContract) => object)[] = [s => s.account, s => s.scope, s => s.invoice_binding!,
      s => s.callback!, s => s.independent_read!, s => s.independent_read!.facts!, s => s.callback!.facts.operation, s => s.independent_read!.facts!.asset];
    for (const target of injectors) {
      const copy = structuredClone(f.source); Object.assign(target(copy), { trusted: true });
      expect(assessFinancialSource(copy, f.context).source_state).toBe("REJECTED");
    }
  });
  it("unknown origin, missing history and invalid history fail closed", () => {
    const f = fixture(); f.source.evidence_origin = "UNKNOWN"; expect(evaluate(f).source_state).toBe("PENDING");
    f.source.evidence_origin = "SYNTHETIC"; f.context.history_complete = false;
    expect(evaluate(f).reasons).toEqual(["HISTORY_INCOMPLETE"]);
    f.context.history_complete = true; expect(evaluate(f, [{ financial_authority: "LIVE" }]).source_state).toBe("REJECTED");
  });
  it("canonical JSON rejects getters, sparse/cyclic/non-JSON and malformed strings", () => {
    for (const bad of [undefined, NaN, Infinity, -0, 1.1, new Date(), [undefined], Array(1), "\ud800"]) expect(() => canonicalFinancialJson(bad)).toThrow();
    expect(() => canonicalFinancialJson({ get secret() { throw Error("GETTER_MUST_NOT_RUN"); } })).toThrow("FINANCIAL_JSON_INVALID");
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(() => canonicalFinancialJson(cyclic)).toThrow();
    const array = [1]; Object.defineProperty(array, "0", { get() { throw Error("GETTER_MUST_NOT_RUN"); }, enumerable: true });
    expect(() => canonicalFinancialJson(array)).toThrow("FINANCIAL_JSON_INVALID");
    const symbols = [1]; Object.assign(symbols, { [Symbol("extra")]: 1 });
    expect(() => canonicalFinancialJson(symbols)).toThrow("FINANCIAL_JSON_INVALID");
  });
  it("A19 a reused delivery hash cannot authorize a different operation", () => {
    const f = fixture(), first = evaluate(f);
    changeFacts(f.source, x => { x.operation.transaction_id = "fixture:another"; });
    expect(evaluate(f, [record(first)]).reasons).toEqual(["DELIVERY_CONFLICT"]);
  });
  it("A26 missing physical-transfer or refund capability fails closed", () => {
    const f = fixture(); f.context.policy!.physical_transfer_required = true;
    expect(evaluate(f).reasons).toEqual(["SOURCE_INCOMPLETE"]);
    const original = evaluate(), r = refund(original); r.context.policy!.distinct_refund_identity_supported = null;
    expect(evaluate(r, [record(original)]).reasons).toEqual(["REFUND_PENDING"]);
  });
  it("A41–A42 presentation rejects fabricated authority and non-monetary strings", () => {
    const r = evaluate();
    expect(projectFinancialAssessment({ ...r, received_units: "private:do-not-echo" }, "manager")).toBeNull();
    expect(projectFinancialAssessment({ ...r, financial_authority: "LIVE" }, "manager")).toBeNull();
  });
  it("A28 bounded history is explicit, never silently truncated", () => {
    const row = record(evaluate());
    expect(evaluate(fixture(), Array(65).fill(row)).reasons).toEqual(["HISTORY_INVALID"]);
    const f = fixture(); f.context.history_complete = false;
    expect(evaluate(f, [row]).reasons).toEqual(["HISTORY_INCOMPLETE"]);
  });
  it("A02 buyer debit cannot substitute for actual merchant received amount", () => {
    const f = fixture(); changeFacts(f.source, x => { x.amount_basis = "BUYER_DEBIT"; });
    expect(evaluate(f)).toMatchObject({ source_state: "PENDING", received_units: null, reasons: ["AMOUNT_MISSING"] });
  });
  it("A25 financial event time cannot occur after its callback source time", () => {
    const f = fixture(); changeFacts(f.source, x => { x.occurred_at = "2026-10-18T11:59:40.000Z"; });
    expect(evaluate(f).reasons).toEqual(["SOURCE_TIME_INVALID"]);
  });
  it("A24 raw/fact/assessment literal golden hashes match independent Python reference", () => {
    const f = fixture();
    expect(financialFactHash(f.source.independent_read!.facts)).toBe("baa4eca63c15cf98ca54ea79c08cbecbc271a085b7d04ae7ea124747a4a53ca8");
    expect(evaluate(f).assessment_hash).toBe("b99acec3585eb050496c24144d3aa6eeac70c35163fe896dadaa1f7e71b2ea26");
  });
  it("A42 incomplete or rejected source does not publish an actual-received amount", () => {
    const f = fixture(); f.source.callback!.authentication = "INVALID";
    expect(evaluate(f).received_units).toBeNull();
    f.source.callback!.authentication = "AUTHENTICATED"; f.source.independent_read!.status = "TIMEOUT";
    expect(evaluate(f).received_units).toBeNull();
  });
  it("A42 helper failures and accessor objects do not echo or evaluate private input", () => {
    expect(() => financialFactHash({ "private:do-not-log": "credential" })).toThrow("FINANCIAL_CONTRACT_INVALID");
    const getter = { get received_units() { throw Error("PRIVATE_GETTER_MUST_NOT_RUN"); } };
    expect(projectFinancialAssessment(getter, "manager")).toBeNull();
    expect(() => financialFactHash(getter)).toThrow("FINANCIAL_JSON_INVALID");
  });
  it("A25 malformed timezone cannot pass as an unknown numeric date", () => {
    const f = fixture(); f.context.now = "2026-10-18T12:00:00.000+29:00";
    expect(evaluate(f).source_state).toBe("REJECTED");
  });
});
