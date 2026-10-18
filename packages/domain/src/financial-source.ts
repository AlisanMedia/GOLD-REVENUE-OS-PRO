import {
  financialSourceContractSchema, financialAssessmentContextSchema, financialHistoryRecordSchema,
  financialFactsSchema, financialAssetSchema, financialHashSchema, financialAssessmentSchema,
  type FinancialSourceContract, type FinancialFacts, type FinancialHistoryRecord,
  type FinancialAssessment, type FinancialReason, type AppRole,
} from "@gold-revenue-os/contracts";
import { z } from "zod";
import { canonicalFinancialJson, financialSha256, financialTuple, financialTupleHash } from "./financial-source-canonical";

const same = (a: unknown, b: unknown) => canonicalFinancialJson(a) === canonicalFinancialJson(b);
const instant = (value: string) => new Date(value).toISOString();
const secretRef = (value: string | null) => value === null ? null : financialTupleHash("private-ref", [value]);
function parseContract<T>(schema: z.ZodType<T>, raw: unknown): T {
  canonicalFinancialJson(raw);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw Error("FINANCIAL_CONTRACT_INVALID");
  return parsed.data;
}
export function financialAssetKey(raw: unknown): string {
  const a = parseContract(financialAssetSchema, raw);
  return financialTupleHash("asset", [a.kind, a.code, a.network, a.contract, String(a.decimals)]);
}
function units(facts: FinancialFacts): string | null {
  return facts.operation.kind === "PAYMENT" ? facts.received_units : facts.operation.kind === "REFUND" ? facts.refunded_units : null;
}
export function financialOperationIdentity(raw: unknown, environment: FinancialSourceContract["provider_environment"]): { tuple: string; key: string } {
  const f = parseContract(financialFactsSchema, raw), o = f.operation;
  parseContract(financialSourceContractSchema.shape.provider_environment, environment);
  // Tenant is intentionally excluded: a physical payment cannot be claimed again
  // merely by changing tenant/customer/invoice. Opaque identifiers stay exact.
  const tuple = financialTuple("operation", [f.account.provider_id, environment, f.account.merchant_account_id,
    o.kind, o.direction, o.transaction_id, o.transfer_index, financialAssetKey(f.asset)]);
  return { tuple, key: financialSha256(tuple) };
}
export function financialFactHash(raw: unknown): string {
  return financialSha256(financialFactTuple(parseContract(financialFactsSchema, raw)));
}
function financialFactTuple(f: FinancialFacts): string {
  // Public-safe history carries only hashed private references, never payer/account
  // text, raw callbacks or credentials. Finality/read timestamps are assessments.
  return canonicalFinancialJson({
    version: 1, account: secretRef(canonicalFinancialJson(f.account)),
    invoice: secretRef(f.provider_invoice_id), operation: secretRef(canonicalFinancialJson(f.operation)),
    received_units: f.received_units, refunded_units: f.refunded_units, amount_basis: f.amount_basis,
    asset: financialAssetKey(f.asset), payer: secretRef(f.payer_reference), recipient: secretRef(f.recipient_reference),
    occurred_at: f.occurred_at ? instant(f.occurred_at) : null,
  });
}
function comparableFacts(f: FinancialFacts): unknown {
  // Counts can advance and nullable observations can gain finality independently.
  // Conflicting financial bindings/amounts/statuses cannot silently win.
  return { ...f, occurred_at: f.occurred_at ? instant(f.occurred_at) : null,
    canonical: null, confirmations: null, fee: null, payout: null };
}
function physicalIdentity(f: FinancialFacts): { tuple: string; key: string } | null {
  const p = f.operation.physical_transfer;
  if (!p) return null;
  const tuple = financialTuple("physical", [p.ledger_id, financialAssetKey(f.asset), p.transaction_id, p.transfer_index, secretRef(p.recipient)]);
  return { tuple, key: financialSha256(tuple) };
}

/** Readiness evaluation only. No I/O, clock reads, persistence or financial authority.
 * Context/history must eventually come from a separately authorized server boundary.
 * Claimed authentication booleans/types/hashes cannot turn this into a live verifier.
 */
export function assessFinancialSource(raw: unknown, contextRaw: unknown, historyRaw: unknown = []): FinancialAssessment {
  const base: FinancialAssessment = {
    contract_version: 1, source_state: "REJECTED", fulfillment_eligibility: "INELIGIBLE",
    financial_authority: "NONE", classification: "UNAVAILABLE", completeness: "UNVERIFIABLE",
    reasons: [], received_units: null, refunded_units: null, fee: null, payout: null,
    replay: false, assessment_hash: null, history_record: null,
  };
  const invalid = (reason: FinancialReason): FinancialAssessment => Object.freeze({ ...base, reasons: Object.freeze([reason]) });
  // Reject unexpected fields and non-JSON objects without echoing validation input.
  try {
    canonicalFinancialJson(raw); canonicalFinancialJson(contextRaw);
    if (!Array.isArray(historyRaw) || historyRaw.length > 64 || Reflect.ownKeys(historyRaw).length !== historyRaw.length + 1
      || Object.values(Object.getOwnPropertyDescriptors(historyRaw)).some(d => !("value" in d))) return invalid("HISTORY_INVALID");
    for (const row of historyRaw) canonicalFinancialJson(row);
  }
  catch { return invalid("SCHEMA_INVALID"); }
  const source = financialSourceContractSchema.safeParse(raw);
  if (!source.success) return invalid("SCHEMA_INVALID");
  const c = source.data, parsedContext = financialAssessmentContextSchema.safeParse(contextRaw);
  if (!parsedContext.success) return invalid("CONTEXT_INVALID");
  const ctx = parsedContext.data;
  const parsedHistory = z.array(financialHistoryRecordSchema).max(64).safeParse(historyRaw);
  if (!parsedHistory.success) return invalid("HISTORY_INVALID");
  const history = parsedHistory.data;
  if (history.some(h => financialSha256(h.operation_tuple) !== h.operation_key || financialSha256(h.fact_tuple) !== h.fact_hash
    || (h.physical_key === null) !== (h.physical_tuple === null)
    || h.physical_tuple !== null && financialSha256(h.physical_tuple) !== h.physical_key)) return invalid("HISTORY_INVALID");
  const read = c.independent_read, cb = c.callback, f = read?.facts;
  let record: FinancialHistoryRecord | null = null;
  let replay = false;
  const result = (state: FinancialAssessment["source_state"], eligibility: FinancialAssessment["fulfillment_eligibility"], reasons: readonly FinancialReason[]): FinancialAssessment => {
    const hash = financialSha256(canonicalFinancialJson({
      version: 1, facts: f ? financialFactHash(f) : null, callback_hash: cb?.raw_hash ?? null,
      read_hash: read?.response_hash ?? null, now: instant(ctx.now),
      read_at: read ? instant(read.read_at) : null, callback_at: cb ? instant(cb.received_at) : null,
      scope: secretRef(canonicalFinancialJson(ctx.expected_scope)), invoice: secretRef(canonicalFinancialJson(ctx.expected_invoice)),
      policy: ctx.policy, state, eligibility, reasons,
      source_envelope_hash: financialSha256(canonicalFinancialJson(c)), context_hash: financialSha256(canonicalFinancialJson(ctx)),
    }));
    return Object.freeze({ ...base, source_state: state, fulfillment_eligibility: eligibility,
      classification: c.evidence_origin === "SYNTHETIC" ? "SANDBOX" : "UNAVAILABLE",
      completeness: state === "SOURCE_VERIFIED" ? "COMPLETE_CORROBORATED" : state === "REVIEW" ? "CONFLICTED" : state === "PENDING" ? "INCOMPLETE" : "UNVERIFIABLE",
      reasons: Object.freeze([...reasons]),
      received_units: state === "SOURCE_VERIFIED" && f && ["GROSS_CREDIT", "NET_SETTLEMENT"].includes(f.amount_basis) ? f.received_units : null,
      refunded_units: state === "SOURCE_VERIFIED" && f?.amount_basis === "GROSS_DEBIT" ? f.refunded_units : null,
      // Only a corroborated synthetic source may carry recorded fee/payout facts.
      fee: state === "SOURCE_VERIFIED" && f?.fee ? structuredClone(f.fee) : null,
      payout: state === "SOURCE_VERIFIED" && f?.payout ? structuredClone(f.payout) : null,
      replay, assessment_hash: hash, history_record: record ? Object.freeze({ ...record, source_state: state }) : null,
    });
  };
  const pending = (r: FinancialReason) => result("PENDING", "PENDING", [r]);
  const reject = (r: FinancialReason) => result("REJECTED", "INELIGIBLE", [r]);
  const review = (r: FinancialReason) => result("REVIEW", "REVIEW", [r]);
  if (c.evidence_origin === "SYNTHETIC" && !["FIXTURE", "SANDBOX"].includes(c.provider_environment)) return reject("SYNTHETIC_LIVE_MISMATCH");
  if (c.evidence_origin === "UNKNOWN" || c.provider_environment === "UNKNOWN") return pending("ORIGIN_UNVERIFIABLE");
  // No actual provider authentication/read is implemented or authorized here.
  if (c.evidence_origin !== "SYNTHETIC") return pending("AUTHORITY_UNAVAILABLE");
  if (!same(c.scope, ctx.expected_scope) || !same(c.account, ctx.expected_account)) return reject("SCOPE_MISMATCH");
  if (c.invoice_binding && !same(c.invoice_binding, ctx.expected_invoice)) return reject("SCOPE_MISMATCH");
  if (ctx.merchant_status !== "ACTIVE" || !ctx.merchant_approval_reference) return reject("MERCHANT_UNAUTHORIZED");
  const policy = ctx.policy;
  if (!policy || policy.callback_max_age_seconds === null || policy.read_max_age_seconds === null || policy.clock_skew_seconds === null
    || policy.min_confirmations === null || policy.require_canonical === null || policy.physical_transfer_required === null) return pending("POLICY_INCOMPLETE");
  if (!ctx.history_complete) return pending("HISTORY_INCOMPLETE");
  if (!cb) return pending("CALLBACK_MISSING");
  if (cb.acquisition !== "CALLBACK") return reject("UNTRUSTED_SOURCE");
  if (cb.authentication !== "AUTHENTICATED" || cb.authentication_method !== "SYNTHETIC" || !cb.key_reference) return reject("AUTHENTICATION_FAILED");
  const now = Date.parse(ctx.now), skew = policy.clock_skew_seconds * 1000;
  const tooFuture = (t: string) => Date.parse(t) > now + skew;
  const tooOld = (t: string, age: number) => now - Date.parse(t) > age * 1000;
  if (!cb.source_time) return pending("SOURCE_TIME_MISSING");
  if (tooFuture(cb.source_time) || tooFuture(cb.received_at) || Date.parse(cb.source_time) > Date.parse(cb.received_at) + skew) return reject("SOURCE_TIME_INVALID");
  if (tooOld(cb.source_time, policy.callback_max_age_seconds)) return reject("REPLAY_WINDOW");
  if (!read || read.status !== "OK") return pending("SOURCE_UNAVAILABLE");
  if (!read.complete || !f) return pending("SOURCE_INCOMPLETE");
  if (read.acquisition !== "PROVIDER_LEDGER" || read.source_id === cb.source_id || read.response_hash === cb.raw_hash) return pending("INDEPENDENCE_MISSING");
  if (!same(read.authenticated_account, ctx.expected_account) || !same(f.account, ctx.expected_account) || !same(cb.facts.account, ctx.expected_account)) return reject("MERCHANT_UNAUTHORIZED");
  if (read.source_revision !== policy.source_revision || tooOld(read.read_at, policy.read_max_age_seconds)) return pending("SOURCE_STALE");
  if (tooFuture(read.read_at) || f.occurred_at && (tooFuture(f.occurred_at) || Date.parse(f.occurred_at) > Date.parse(read.read_at) + skew
    || Date.parse(f.occurred_at) > Date.parse(cb.source_time) + skew)) return review("SOURCE_TIME_INVALID");
  if (!f.occurred_at || !cb.facts.occurred_at) return pending("SOURCE_TIME_MISSING");
  if (f.settlement_status === "REVERSED" || cb.facts.settlement_status === "REVERSED") return review("SOURCE_REVERSED");
  if (!same(comparableFacts(f), comparableFacts(cb.facts))) return review("SOURCE_CONFLICT");
  if (!same(f.asset, ctx.expected_asset)) return review("ASSET_MISMATCH");
  const op = f.operation, identity = financialOperationIdentity(f, c.provider_environment), physical = physicalIdentity(f);
  if (policy.physical_transfer_required && !physical) return pending("SOURCE_INCOMPLETE");
  if (physical && (op.transfer_index !== op.physical_transfer?.transfer_index || op.transaction_id !== op.physical_transfer.transaction_id
    || f.recipient_reference !== op.physical_transfer.recipient || f.asset.network !== op.physical_transfer.ledger_id)) return review("SCOPE_MISMATCH");
  const delivery = financialTupleHash("delivery", [c.account.provider_id, c.provider_environment, c.account.merchant_account_id, cb.delivery_id]);
  const invoiceKey = c.invoice_binding ? financialTupleHash("invoice", [c.scope.tenant_id, c.invoice_binding.invoice_id]) : null;
  record = {
    operation_key: identity.key, operation_tuple: identity.tuple, physical_key: physical?.key ?? null, physical_tuple: physical?.tuple ?? null,
    delivery_key: delivery, raw_hash: cb.raw_hash, fact_hash: financialFactHash(f), fact_tuple: financialFactTuple(f),
    tenant_key: financialTupleHash("tenant", [c.scope.tenant_id]),
    account_key: financialTupleHash("account", [c.account.provider_id, c.provider_environment, c.account.merchant_account_id]),
    invoice_key: invoiceKey, asset_key: financialAssetKey(f.asset), kind: op.kind,
    original_operation_key: op.original_operation_key, units: units(f), source_state: "PENDING",
  };
  if (history.some(h => h.delivery_key === delivery && (h.raw_hash !== cb.raw_hash || h.operation_key !== identity.key || h.fact_tuple !== record?.fact_tuple))) return review("DELIVERY_CONFLICT");
  const sameOp = history.filter(h => h.operation_key === identity.key);
  if (sameOp.some(h => h.tenant_key !== record?.tenant_key || h.operation_tuple !== identity.tuple
    || h.fact_tuple !== record?.fact_tuple || h.invoice_key !== invoiceKey)) return review("OPERATION_CONFLICT");
  if (history.some(h => physical && h.physical_key === physical.key && (h.operation_key !== identity.key || h.tenant_key !== record?.tenant_key || h.physical_tuple !== physical.tuple))) return review("PHYSICAL_REUSE");
  replay = sameOp.some(h => h.source_state === "SOURCE_VERIFIED");
  if (["REFUND_REQUEST", "DISPUTE"].includes(op.kind)) return review("NO_ACTUAL_MOVEMENT");
  const actual = units(f);
  if (op.kind === "PAYMENT" && !["GROSS_CREDIT", "NET_SETTLEMENT"].includes(f.amount_basis)
    || op.kind === "REFUND" && f.amount_basis !== "GROSS_DEBIT") return pending("AMOUNT_MISSING");
  if (actual === null) return pending("AMOUNT_MISSING");
  if (actual === "0") return pending("NO_ACTUAL_MOVEMENT");
  if (f.settlement_status !== "SETTLED" || f.confirmations === null || f.confirmations < policy.min_confirmations
    || cb.facts.confirmations === null || cb.facts.confirmations < policy.min_confirmations
    || policy.require_canonical && (f.canonical !== true || cb.facts.canonical !== true)) return pending("INSUFFICIENT_FINALITY");
  if (!c.invoice_binding || !ctx.expected_invoice) return result("SOURCE_VERIFIED", "REVIEW", ["UNALLOCATED"]);
  if (f.provider_invoice_id !== ctx.expected_invoice.provider_invoice_id) return result("SOURCE_VERIFIED", "REVIEW", ["SCOPE_MISMATCH"]);
  if (ctx.expected_payer === null || ctx.expected_recipient === null || f.payer_reference !== ctx.expected_payer || f.recipient_reference !== ctx.expected_recipient) return result("SOURCE_VERIFIED", "REVIEW", ["PAYER_MISMATCH"]);
  if (f.amount_basis !== ctx.expected_basis) return result("SOURCE_VERIFIED", "REVIEW", ["AMOUNT_MISMATCH"]);
  const distinct = [...new Map(history.filter(h => h.source_state === "SOURCE_VERIFIED").map(h => [h.operation_key, h])).values()];
  if (op.kind === "REFUND") {
    if (policy.distinct_refund_identity_supported !== true) return result("SOURCE_VERIFIED", "REVIEW", ["REFUND_PENDING"]);
    const original = distinct.find(h => h.operation_key === op.original_operation_key && h.kind === "PAYMENT" && h.units !== null
      && h.tenant_key === record?.tenant_key && h.account_key === record?.account_key && h.asset_key === record?.asset_key && h.invoice_key === invoiceKey);
    if (!original?.units) return result("SOURCE_VERIFIED", "REVIEW", ["REFUND_ORIGINAL_MISSING"]);
    const refunded = distinct.filter(h => h.kind === "REFUND" && h.original_operation_key === original.operation_key && h.operation_key !== identity.key);
    if (refunded.some(h => h.units === null || h.asset_key !== record?.asset_key)) return review("REFUND_PENDING");
    const total = refunded.reduce((sum, h) => sum + BigInt(h.units!), BigInt(actual));
    if (total > BigInt(original.units)) return result("SOURCE_VERIFIED", "REVIEW", ["REFUND_TOTAL_EXCEEDED"]);
    return result("SOURCE_VERIFIED", "INELIGIBLE", ["REFUND_EFFECT_REVIEW"]);
  }
  if (history.some(h => h.kind === "REFUND" && h.original_operation_key === identity.key)) return result("SOURCE_VERIFIED", "REVIEW", ["REFUND_EFFECT_REVIEW"]);
  if (distinct.some(h => h.kind === "PAYMENT" && h.invoice_key === invoiceKey && h.operation_key !== identity.key)) return result("SOURCE_VERIFIED", "REVIEW", ["SECOND_PAYMENT"]);
  if (ctx.expected_units === null) return result("SOURCE_VERIFIED", "PENDING", ["AMOUNT_MISSING"]);
  if (actual !== ctx.expected_units) return result("SOURCE_VERIFIED", "REVIEW", ["AMOUNT_MISMATCH"]);
  if (!ctx.invoice_expires_at) return result("SOURCE_VERIFIED", "PENDING", ["POLICY_INCOMPLETE"]);
  if (Date.parse(f.occurred_at) > Date.parse(ctx.invoice_expires_at)) return result("SOURCE_VERIFIED", "REVIEW", ["LATE_PAYMENT"]);
  return result("SOURCE_VERIFIED", "ELIGIBLE", ["SOURCE_READY"]);
}

/** A legacy alias proposal only; never emits payment.confirmed or creates a receipt. */
export function financialLegacyReference(operationKey: string): string { return "fs1:" + parseContract(financialHashSchema, operationKey); }

export function financialUnavailable(): Readonly<{ status: "UNAVAILABLE"; value: null; financial_authority: "NONE" }> {
  return Object.freeze({ status: "UNAVAILABLE", value: null, financial_authority: "NONE" });
}
export function projectFinancialAssessment(raw: unknown, role: AppRole, locale: "tr-TR" | "en-US" = "tr-TR") {
  if (role === "readonly" || !["super_admin", "manager", "support", "analyst"].includes(role)) return null;
  try { canonicalFinancialJson(raw); } catch { return null; }
  const parsed = financialAssessmentSchema.safeParse(raw);
  if (!parsed.success) return null;
  const result = parsed.data;
  // Allowlist, not object spread: no raw input, private tuple, payer or key reference.
  const labels = locale === "en-US"
    ? { PENDING: "Source verification pending", REVIEW: "Review required", REJECTED: "Verification request rejected", SOURCE_VERIFIED: "Financial source verified (synthetic)" }
    : { PENDING: "Kaynak doğrulaması bekleniyor", REVIEW: "İnceleme gerekiyor", REJECTED: "Doğrulama isteği reddedildi", SOURCE_VERIFIED: "Finansal kaynak doğrulandı (sentetik)" };
  return Object.freeze({ source_state: result.source_state, label: labels[result.source_state],
    fulfillment_eligibility: result.fulfillment_eligibility, financial_authority: "NONE" as const,
    classification: result.classification, completeness: result.completeness,
    received_units: role === "analyst" ? null : result.received_units,
    refunded_units: role === "analyst" ? null : result.refunded_units,
    reasons: Object.freeze(result.reasons.map(code => ({ code, message: financialReasonText(code, locale) }))),
  });
}

// Every reason gets an explicit operator translation; never echo upstream text.
export function financialReasonText(reason: FinancialReason, locale: "tr-TR" | "en-US" = "tr-TR"): string {
  return FINANCIAL_REASON_TEXT[reason]?.[locale === "en-US" ? 1 : 0] ?? (locale === "en-US" ? "Invalid assessment." : "Geçersiz değerlendirme.");
}
const FINANCIAL_REASON_TEXT: Record<FinancialReason, readonly [string, string]> = {
  SOURCE_READY: ["Sentetik kaynaklar tutarlı; gerçek ödeme yetkisi yok.", "Synthetic sources agree; no real payment authority."],
  SCHEMA_INVALID: ["Kaynak biçimi geçersiz.", "Invalid source format."], CONTEXT_INVALID: ["Doğrulama bağlamı geçersiz.", "Invalid assessment context."],
  ORIGIN_UNVERIFIABLE: ["Kaynağın kökeni doğrulanamıyor.", "Source origin cannot be verified."], SYNTHETIC_LIVE_MISMATCH: ["Test kaydı canlı kaynak olarak kullanılamaz.", "A test record cannot be used as a live source."],
  AUTHORITY_UNAVAILABLE: ["Gerçek sağlayıcı doğrulaması bu pakette bulunmuyor.", "Real provider verification is unavailable in this package."],
  AUTHENTICATION_FAILED: ["Kaynak kimlik doğrulaması başarısız.", "Source authentication failed."], UNTRUSTED_SOURCE: ["Bu bildirim ödeme kanıtı değildir.", "This notification is not payment evidence."],
  CALLBACK_MISSING: ["Doğrulanmış ödeme bildirimi bekleniyor.", "An authenticated payment notification is required."], REPLAY_WINDOW: ["Bildirim zaman aralığı dışında; kaynak incelemesi gerekiyor.", "Notification outside the allowed window; source review required."],
  SOURCE_UNAVAILABLE: ["Bağımsız işlem kaynağına ulaşılamadı.", "Independent transaction source unavailable."], SOURCE_INCOMPLETE: ["İşlem kaynağı eksik.", "Transaction source incomplete."],
  SOURCE_CONFLICT: ["Kaynaklar birbiriyle uyuşmuyor.", "Sources disagree."], INDEPENDENCE_MISSING: ["Bağımsız kaynak okuması doğrulanamadı.", "Independent source acquisition is not established."],
  AMOUNT_MISSING: ["Gerekli tutar kanıtı eksik.", "Required amount evidence is missing."], NO_ACTUAL_MOVEMENT: ["Gerçek para hareketi doğrulanmadı.", "No actual financial movement is established."],
  ASSET_MISMATCH: ["Varlık, ağ veya hassasiyet uyuşmuyor.", "Asset, network or precision mismatch."], PAYER_MISMATCH: ["Ödeyen veya alıcı bağlantısı inceleme gerektiriyor.", "Payer or recipient binding requires review."],
  SCOPE_MISMATCH: ["İşlem bağlantısı uygun değil.", "Transaction binding does not match."], MERCHANT_UNAUTHORIZED: ["Satıcı hesabı yetkisi doğrulanamadı.", "Merchant account authority is not established."],
  UNALLOCATED: ["Finansal gözlem bir siparişe bağlanamadı.", "Financial observation is not allocated to an order."], LATE_PAYMENT: ["Ödeme sipariş süresi sonrasında gözlendi.", "Payment occurred after invoice expiry."],
  AMOUNT_MISMATCH: ["Alınan tutar veya tutarın anlamı siparişle uyuşmuyor.", "Actual amount or amount basis does not match the order."], SPLIT_UNAPPROVED: ["Parçalı ödeme birleştirmesi onaylı değil.", "Split-payment aggregation is not approved."],
  INSUFFICIENT_FINALITY: ["İşlem kesinliği henüz yeterli değil.", "Transaction finality is not sufficient."], POLICY_INCOMPLETE: ["Doğrulama politikası eksik.", "Verification policy incomplete."],
  SOURCE_TIME_MISSING: ["Kaynak zamanı eksik.", "Source timestamp missing."], SOURCE_TIME_INVALID: ["Kaynak zamanları tutarsız.", "Source timestamps are inconsistent."], SOURCE_STALE: ["Kaynak okuması veya sürümü güncel değil.", "Source read or revision is stale."],
  SOURCE_REVERSED: ["Kaynak işlemin geri alındığını gösteriyor; inceleme gerekiyor.", "Source indicates a reversal; review required."],
  DELIVERY_CONFLICT: ["Aynı bildirim kimliği farklı içerikle geldi.", "The same delivery identity has conflicting content."], OPERATION_CONFLICT: ["Aynı işlem için çelişkili bağlantı veya kanıt var.", "The same operation has conflicting bindings or evidence."],
  PHYSICAL_REUSE: ["Aynı transfer yeniden kullanılmaya çalışılıyor.", "The same physical transfer is being reused."], SECOND_PAYMENT: ["Sipariş için ikinci ödeme gözlendi; otomatik hak verilmedi.", "A second payment was observed for the order; no automatic entitlement."],
  REFUND_ORIGINAL_MISSING: ["İadenin ilk ödeme bağlantısı doğrulanamadı.", "The refund's original payment is not established."], REFUND_TOTAL_EXCEEDED: ["İade toplamı ilk ödemeyi aşıyor; inceleme gerekiyor.", "Refund total exceeds the original payment; review required."],
  REFUND_PENDING: ["İade bağlantısının kanıtı eksik.", "Refund linkage evidence incomplete."], REFUND_EFFECT_REVIEW: ["İadenin abonelik etkisi ayrıca incelenmeli.", "Refund consequences for subscriptions require separate review."],
  HISTORY_INCOMPLETE: ["Tekrar kullanım denetimi için geçmiş eksik.", "History is incomplete for duplicate-claim checks."], HISTORY_INVALID: ["Geçmiş değerlendirme biçimi geçersiz.", "Invalid prior assessment history."],
};
