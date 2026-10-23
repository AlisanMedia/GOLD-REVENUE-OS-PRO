import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  financialEvidenceCommandSchema, financialEvidenceReadRequestSchema,
  type FinancialAssessmentContext, type FinancialSourceContract,
} from "@gold-revenue-os/contracts";
import {
  canonicalFinancialEvidence, financialEvidenceStorageHash, financialEvidenceRequestHash,
  prepareFinancialEvidenceCommand, projectFinancialEvidence, decodeFinancialEvidenceCursor, financialEvidenceRecoveryDecision,
} from "./financial-evidence";
import { financialSha256, financialTuple } from "./financial-source-canonical";
import { assessFinancialSource, financialUnavailable } from "./financial-source";
import { subscriptionExpiry } from "./subscriptions";
import { EVENT_CONTRACTS } from "./state-event-engine";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const account = { provider_id: "fixture:provider", merchant_account_id: "fixture:account" };
  const asset = { kind: "TOKEN" as const, code: "FIXTURE", network: "fixture:ledger", contract: "fixture:contract", decimals: 6 };
  const scope = { tenant_id: id(1), merchant_binding_id: id(2), merchant_revision: 1 };
  const invoice = { invoice_id: id(3), provider_invoice_id: "test:invoice", customer_id: id(4), offer_id: id(5), product_version_id: id(6), plan_version_id: id(7), offer_snapshot_hash: financialSha256("offer") };
  const facts = { account, provider_invoice_id: "test:invoice", operation: { kind: "PAYMENT" as const, direction: "IN" as const, transaction_id: "opaque:Charge🙂", transfer_index: null, original_operation_key: null, physical_transfer: null },
    received_units: "1000", refunded_units: null, amount_basis: "GROSS_CREDIT" as const, asset,
    payer_reference: "private:fixture-payer", recipient_reference: "private:fixture-recipient",
    occurred_at: "2026-10-23T10:00:00.000Z", canonical: true, confirmations: 20, settlement_status: "SETTLED" as const, fee: null, payout: null };
  const source: FinancialSourceContract = { contract_version: 1, evidence_origin: "SYNTHETIC", provider_environment: "FIXTURE", account, scope, invoice_binding: invoice,
    callback: { delivery_id: "delivery:1", event_id: "event:1", raw_hash: financialSha256("callback"), source_id: "fixture:callback", acquisition: "CALLBACK", authentication: "AUTHENTICATED", authentication_method: "SYNTHETIC", key_reference: "private:fixture-key", source_time: "2026-10-23T10:00:01.000Z", received_at: "2026-10-23T10:00:02.000Z", facts: structuredClone(facts) },
    independent_read: { acquisition: "PROVIDER_LEDGER", status: "OK", source_id: "fixture:ledger", source_record_id: "record:1", response_hash: financialSha256("ledger"), authenticated_account: account, decoder_version: "fixture:v1", read_at: "2026-10-23T10:00:03.000Z", complete: true, source_revision: 1, facts: structuredClone(facts) } };
  const context: FinancialAssessmentContext = { now: "2026-10-23T10:00:04.000Z", expected_scope: scope, expected_account: account, expected_invoice: invoice, merchant_status: "ACTIVE", merchant_approval_reference: "fixture:approval", expected_asset: asset, expected_units: "1000", expected_basis: "GROSS_CREDIT", expected_payer: facts.payer_reference, expected_recipient: facts.recipient_reference, invoice_expires_at: "2026-10-23T11:00:00.000Z", history_complete: true,
    policy: { version: "v1", hash: financialSha256("policy"), source_revision: 1, callback_max_age_seconds: 300, read_max_age_seconds: 60, clock_skew_seconds: 2, min_confirmations: 20, require_canonical: true, physical_transfer_required: false, distinct_refund_identity_supported: true } };
  const input = { namespaceId: id(20), bindingVersionId: id(21), commandId: id(22), seriesId: id(23), previousAssessmentId: null, readAcquisitionId: id(24), source, context, history: [],
    fence: { namespace_revision: "1", scope_revision: "1", generation: "0", binding_revision: "1", policy_hash: context.policy!.hash, history_hash: financialSha256("empty history"), prepared_at: "2026-10-23T10:00:04.123456Z" } };
  return input;
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("Phase16C-1B pure persistence contracts, no authority or DB effects", () => {
  it("bounds retry and resolves unknown COMMIT with the same command", () => {
    expect(financialEvidenceRecoveryDecision("COMMIT_UNKNOWN", 1).action).toBe("READ_SAME_COMMAND");
    expect(financialEvidenceRecoveryDecision("40001", 1).action).toBe("REFRESH_CONTEXT");
    expect(financialEvidenceRecoveryDecision("40P01", 2)).toEqual({ action: "RETRY_TRANSACTION", delay_ms: 150 });
    expect(financialEvidenceRecoveryDecision("55P03", 3).action).toBe("STOP");
    expect(financialEvidenceRecoveryDecision("40001", 3).action).toBe("STOP");
    expect(financialEvidenceRecoveryDecision("23514", 1).action).toBe("STOP");
    expect(financialEvidenceRecoveryDecision("COMMIT_UNKNOWN", 4).action).toBe("STOP");
  });
  it("binds immutable v1 assessment without raw source/PII", () => {
    const f = fixture(), result = prepareFinancialEvidenceCommand(f);
    expect(result.assessment).toEqual(assessFinancialSource(f.source, f.context));
    expect(result).toMatchObject({ evidence_origin: "SYNTHETIC", financial_authority: "NONE", effect_kind: "ALLOCATION_CANDIDATE" });
    expect(JSON.stringify(result)).not.toMatch(/private:fixture|payer_reference|key_reference|raw_body|signature/u);
    expect(result.observations).toHaveLength(2);
    expect(result.operation?.transaction_id).toBe("opaque:Charge🙂");
  });
  it("has deterministic storage digest, null-safe identities and opaque UTF8", () => {
    expect(financialEvidenceStorageHash(["a:b", "c"])).not.toBe(financialEvidenceStorageHash(["a", "b:c"]));
    expect(financialEvidenceStorageHash([null])).not.toBe(financialEvidenceStorageHash(["null"]));
    expect(financialEvidenceStorageHash(["ID"])).not.toBe(financialEvidenceStorageHash(["id"]));
    expect(financialEvidenceStorageHash(["é"])).not.toBe(financialEvidenceStorageHash(["e\u0301"]));
    expect(financialEvidenceStorageHash(["golden", null, "A|::B", "🙂Z"])).toBe("53596389d3c30da10310a4b1b970b0a0f7308229a93b21e9e74825053457d0ee");
  });
  it("command hash is order independent, but binds every context/source revision", () => {
    const c = prepareFinancialEvidenceCommand(fixture());
    expect(financialEvidenceRequestHash(c)).toBe(financialEvidenceRequestHash(Object.fromEntries(Object.entries(c).reverse())));
    const changed = structuredClone(c); changed.fence.generation = "1";
    expect(financialEvidenceRequestHash(c)).not.toBe(financialEvidenceRequestHash(changed));
    changed.fence = c.fence; changed.source_envelope_hash = financialSha256("different");
    expect(financialEvidenceRequestHash(c)).not.toBe(financialEvidenceRequestHash(changed));
  });
  it.each([1, 1.5, "01", "1e3", "1.0", "-1", "1".repeat(31)])("rejects noncanonical money %s", amount => {
    const c = prepareFinancialEvidenceCommand(fixture());
    expect(financialEvidenceCommandSchema.safeParse({ ...c, observations: [{ ...c.observations[0], received_units: amount }] }).success).toBe(false);
  });
  it("retains exact 30-digit actuals and never fills missing amount from expected", () => {
    const f = fixture();
    f.source.callback!.facts.received_units = null; f.source.independent_read!.facts!.received_units = null;
    const missing = prepareFinancialEvidenceCommand(f);
    expect(missing.assessment.received_units).toBeNull(); expect(missing.effect_kind).toBe("NONE");
    expect(missing.observations.every(o => o.received_units === null)).toBe(true);
    const c = prepareFinancialEvidenceCommand(fixture()); c.observations[0]!.received_units = "9".repeat(30);
    expect(financialEvidenceCommandSchema.parse(c).observations[0]?.received_units).toBe("9".repeat(30));
  });
  it.each(["LIVE", "PROVIDER", "UNKNOWN"])("cannot promote namespace/origin %s", value => {
    const f = fixture();
    expect(() => prepareFinancialEvidenceCommand({ ...f, source: { ...f.source, evidence_origin: value } })).toThrow();
    expect(financialEvidenceCommandSchema.safeParse({ ...prepareFinancialEvidenceCommand(f), financial_authority: value }).success).toBe(false);
  });
  it("rejects unexpected authority fields at nested boundaries", () => {
    const c = prepareFinancialEvidenceCommand(fixture());
    for (const value of [{ ...c, verified: true }, { ...c, fence: { ...c.fence, paid: true } }, { ...c, observations: [{ ...c.observations[0], raw_callback: "SECRET" }] }]) {
      expect(() => canonicalFinancialEvidence(value)).toThrow("FINANCIAL_EVIDENCE_INVALID");
    }
  });
  it("never invokes accessors or accepts non-JSON/prototype/symbol payloads", () => {
    const c = prepareFinancialEvidenceCommand(fixture()), getter = vi.fn(() => "SECRET");
    Object.defineProperty(c, "evil", { enumerable: true, get: getter });
    expect(() => canonicalFinancialEvidence(c)).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(() => canonicalFinancialEvidence(new Date())).toThrow();
    const c2 = prepareFinancialEvidenceCommand(fixture());
    Object.defineProperty(c2, Symbol("secret"), { value: "SECRET", enumerable: true });
    expect(() => canonicalFinancialEvidence(c2)).toThrow();
  });
  it("keeps v1 16KiB bound separate from the bounded storage envelope", () => {
    expect(() => financialSha256("x".repeat(16385))).toThrow();
    expect(() => financialEvidenceStorageHash(["x".repeat(65536)])).toThrow();
    expect(() => financialEvidenceStorageHash(["\ud800"])).toThrow();
  });
  it("keeps full history failures closed and unknown costs unavailable", () => {
    const f = fixture(); f.context.history_complete = false;
    const result = prepareFinancialEvidenceCommand(f);
    expect(result.assessment).toMatchObject({ source_state: "PENDING", reasons: ["HISTORY_INCOMPLETE"] });
    expect(result.effect_kind).toBe("NONE"); expect(financialUnavailable()).toEqual({ status: "UNAVAILABLE", value: null, financial_authority: "NONE" });
  });
  it("redacts foreign conflict reasons, raw identities and analyst amounts", () => {
    const c = prepareFinancialEvidenceCommand(fixture());
    c.assessment = { ...c.assessment, source_state: "REVIEW", reasons: ["PHYSICAL_REUSE"] };
    expect(projectFinancialEvidence(c, "readonly")).toBeNull();
    const tr = projectFinancialEvidence(c, "analyst");
    expect(tr).toMatchObject({ received_units: null, reasons: [{ code: "REVIEW_REQUIRED", message: "İnceleme gerekiyor" }] });
    expect(projectFinancialEvidence(c, "manager", "en-US")?.reasons[0]?.message).toBe("Review required");
    expect(JSON.stringify(tr)).not.toMatch(/operation_key|private|merchant|source_id|raw_hash/u);
  });
  it("preserves microseconds in cursor, independent of customer language", () => {
    const cursor = { version: 1, scope_hash: financialSha256("scope"), generation: "1", started_at: "2026-10-23T12:00:00.123456Z", anchor_time: "2026-10-23T12:00:00.123456Z", anchor_id: id(1), after_time: "2026-10-23T11:00:00.654321Z", after_id: id(2) };
    const encoded = Buffer.from(JSON.stringify(cursor)).toString("base64url");
    expect(decodeFinancialEvidenceCursor(encoded)).toEqual(cursor);
    expect(() => decodeFinancialEvidenceCursor(encoded + "=")).toThrow();
    expect(() => decodeFinancialEvidenceCursor(Buffer.from('{"version":1,"version":1}').toString("base64url"))).toThrow();
  });
  it("uses 25/100 read bounds and retains original event/duration semantics", () => {
    expect(financialEvidenceReadRequestSchema.parse({ namespace_id: id(1), tenant_id: id(2), collection: "claims" }).page_size).toBe(25);
    for (const n of [0, 101, 1.5]) expect(financialEvidenceReadRequestSchema.safeParse({ namespace_id: id(1), tenant_id: id(2), collection: "claims", page_size: n }).success).toBe(false);
    expect(EVENT_CONTRACTS["payment.confirmed"].requiredPayloadKeys).toEqual(["payment_id", "tx_hash"]);
    expect(financialTuple("operation", ["Opaque", null])).toBe('["FS1","operation","Opaque",null]');
    expect(subscriptionExpiry("2028-01-31T00:00:00.000Z", { duration_unit: "calendar_month", duration_count: 1 })).toBe("2028-02-29T00:00:00.000Z");
  });
});
