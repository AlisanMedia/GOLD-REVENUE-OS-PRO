import { createHash } from "node:crypto";
import {
  financialSourceContractSchema, financialAssessmentContextSchema,
  financialEvidenceCommandSchema, financialEvidenceFenceSchema, financialEvidenceSelectorsSchema,
  financialEvidenceCursorSchema, type FinancialHistoryRecord, type AppRole,
  type FinancialEvidenceCommand, type FinancialEvidenceFence, type FinancialEvidenceSelectors,
} from "@gold-revenue-os/contracts";
import { assessFinancialSource, financialAssetKey, financialFactHash, financialOperationIdentity, projectFinancialAssessment } from "./financial-source";
import { canonicalFinancialJson, financialSha256, financialTuple, financialTupleHash } from "./financial-source-canonical";

const fail = () => new Error("FINANCIAL_EVIDENCE_INVALID");
export const FINANCIAL_EVIDENCE_COMMAND_MAX_BYTES = 65536;

/** Separate storage digest domain; never raises the accepted v1 16KiB limit. */
export function financialEvidenceStorageHash(parts: readonly (string | null)[]): string {
  const digest = createHash("sha256");
  digest.update("FSESTORE1;");
  let bytes = 10;
  for (const part of parts) {
    if (part === null) { digest.update("N;"); bytes += 2; continue; }
    if (Buffer.from(part, "utf8").toString("utf8") !== part) throw fail();
    const buffer = Buffer.from(part, "utf8"), prefix = `S${buffer.length}:`;
    bytes += Buffer.byteLength(prefix) + buffer.length + 1;
    if (bytes > FINANCIAL_EVIDENCE_COMMAND_MAX_BYTES) throw fail();
    digest.update(prefix); digest.update(buffer); digest.update(";");
  }
  return digest.digest("hex");
}

// Canonicalize only the strict, already validated storage shape. Individual v1
// source/result/history parts still pass the existing canonicalFinancialJson.
export function canonicalFinancialEvidence(raw: unknown): string {
  let nodes = 0;
  function inspect(v: unknown, depth: number): void {
    if (++nodes > 4096 || depth > 16) throw fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (Buffer.from(v).toString("utf8") !== v) throw fail(); return; }
    if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) throw fail(); return; }
    if (typeof v !== "object" || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null && !(Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype))) throw fail();
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Reflect.ownKeys(v).length !== Object.keys(descriptors).length) throw fail();
    if (Array.isArray(v) && Object.keys(v).length !== v.length) throw fail();
    for (const [key, d] of Object.entries(descriptors)) {
      if (Array.isArray(v) && key === "length") continue;
      if (!d.enumerable || !("value" in d) || Buffer.from(key).toString("utf8") !== key) throw fail();
      inspect(d.value as unknown, depth + 1);
    }
  }
  inspect(raw, 0);
  const value = financialEvidenceCommandSchema.safeParse(raw);
  if (!value.success) throw fail();
  function encode(v: unknown): string {
    if (Array.isArray(v)) return "[" + v.map(encode).join(",") + "]";
    if (v !== null && typeof v === "object") return "{" + Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => JSON.stringify(k) + ":" + encode(x)).join(",") + "}";
    return JSON.stringify(v);
  }
  const result = encode(value.data);
  if (Buffer.byteLength(result) > FINANCIAL_EVIDENCE_COMMAND_MAX_BYTES || Buffer.from(result).toString("utf8") !== result) throw fail();
  return result;
}
export function financialEvidenceRequestHash(command: unknown): string {
  return financialEvidenceStorageHash(["command", canonicalFinancialEvidence(command)]);
}

export function prepareFinancialEvidenceCommand(input: {
  namespaceId: string; bindingVersionId: string; commandId: string;
  seriesId: string; previousAssessmentId: string | null; readAcquisitionId: string;
  source: unknown; context: unknown; history: readonly FinancialHistoryRecord[];
  fence: FinancialEvidenceFence;
}): FinancialEvidenceCommand {
  canonicalFinancialJson(input.source); canonicalFinancialJson(input.context); canonicalFinancialJson(input.fence);
  const source = financialSourceContractSchema.parse(input.source), ctx = financialAssessmentContextSchema.parse(input.context);
  canonicalFinancialJson(source); canonicalFinancialJson(ctx);
  const fence = financialEvidenceFenceSchema.parse(input.fence);
  if (source.evidence_origin !== "SYNTHETIC" || !["FIXTURE", "SANDBOX"].includes(source.provider_environment)) throw fail();
  const assessment = assessFinancialSource(source, ctx, input.history);
  const f = source.independent_read?.facts ?? source.callback?.facts;
  const identity = f ? financialOperationIdentity(f, source.provider_environment) : null;
  const physical = f?.operation.physical_transfer;
  const physicalTuple = physical && f ? financialTuple("physical", [physical.ledger_id, financialAssetKey(f.asset), physical.transaction_id, physical.transfer_index, financialTupleHash("private-ref", [physical.recipient])]) : null;
  const cb = source.callback, read = source.independent_read;
  const deliveryKey = cb ? financialTupleHash("delivery", [source.account.provider_id, source.provider_environment, source.account.merchant_account_id, cb.delivery_id]) : null;
  const selectors: FinancialEvidenceSelectors = financialEvidenceSelectorsSchema.parse({
    operation_key: identity?.key ?? null, physical_key: physicalTuple ? financialSha256(physicalTuple) : null,
    delivery_key: deliveryKey, invoice_id: source.invoice_binding?.invoice_id ?? null,
    original_operation_key: f?.operation.original_operation_key ?? null,
    kind: f?.operation.kind ?? null,
  });
  const observations: FinancialEvidenceCommand["observations"] = [];
  const detail = (facts: typeof f) => ({
    amount_basis: facts?.amount_basis ?? null, settlement_status: facts?.settlement_status ?? null,
    confirmations: facts?.confirmations == null ? null : String(facts.confirmations), canonical: facts?.canonical ?? null,
    fee: facts?.fee ?? null, payout: facts?.payout ?? null,
    payer_digest: facts?.payer_reference == null ? null : financialTupleHash("private-ref", [facts.payer_reference]),
    recipient_digest: facts?.recipient_reference == null ? null : financialTupleHash("private-ref", [facts.recipient_reference]),
  });
  if (cb && deliveryKey) observations.push({
    kind: "CALLBACK", acquisition: cb.acquisition, acquisition_key: deliveryKey, source_id: cb.source_id, source_record_id: cb.event_id,
    delivery_id: cb.delivery_id, event_id: cb.event_id, read_acquisition_id: null,
    authentication: cb.authentication,
    authentication_method: cb.authentication_method === "SYNTHETIC" ? "SYNTHETIC" : "UNKNOWN",
    raw_hash: cb.raw_hash, fact_hash: financialFactHash(cb.facts),
    source_time: cb.source_time, observed_at: cb.received_at, source_revision: null,
    decoder_version: "financial-source-v1", status: cb.authentication === "AUTHENTICATED" ? "OK" : "INVALID",
    complete: true, received_units: cb.facts.received_units, refunded_units: cb.facts.refunded_units, asset: cb.facts.asset, ...detail(cb.facts),
  });
  if (read) observations.push({
    kind: "INDEPENDENT_READ", acquisition: read.acquisition, acquisition_key: financialTupleHash("read-acquisition", [source.account.provider_id, source.provider_environment, source.account.merchant_account_id, input.readAcquisitionId]),
    source_id: read.source_id, source_record_id: read.source_record_id, delivery_id: null, event_id: null, read_acquisition_id: input.readAcquisitionId,
    authentication: read.authenticated_account ? "AUTHENTICATED" : "UNKNOWN", authentication_method: "SYNTHETIC",
    raw_hash: read.response_hash, fact_hash: read.facts ? financialFactHash(read.facts) : null,
    source_time: read.facts?.occurred_at ?? null, observed_at: read.read_at,
    source_revision: read.source_revision === null ? null : String(read.source_revision), decoder_version: read.decoder_version,
    status: read.status, complete: read.complete, received_units: read.facts?.received_units ?? null,
    refunded_units: read.facts?.refunded_units ?? null, asset: read.facts?.asset ?? null, ...detail(read.facts ?? undefined),
  });
  const verified = assessment.source_state === "SOURCE_VERIFIED";
  const effect = !verified ? "NONE" : f?.operation.kind === "PAYMENT" && assessment.fulfillment_eligibility === "ELIGIBLE"
    ? "ALLOCATION_CANDIDATE" : f?.operation.kind === "REFUND" && assessment.fulfillment_eligibility === "INELIGIBLE" && assessment.reasons.includes("REFUND_EFFECT_REVIEW")
      ? "REFUND_CORRELATION" : "CLAIM_ONLY";
  const command = financialEvidenceCommandSchema.parse({
    version: 1, evidence_origin: "SYNTHETIC", financial_authority: "NONE",
    namespace_id: input.namespaceId, tenant_id: source.scope.tenant_id, binding_version_id: input.bindingVersionId,
    command_id: input.commandId, evaluation_series_id: input.seriesId, previous_assessment_id: input.previousAssessmentId,
    evaluation_clock: ctx.now, fence, selectors,
    source_envelope_hash: financialSha256(canonicalFinancialJson(source)), context_hash: financialSha256(canonicalFinancialJson(ctx)),
    operation: f && identity ? {
      operation_key: identity.key, operation_tuple: identity.tuple,
      provider_id: f.account.provider_id, environment: source.provider_environment,
      merchant_account_id: f.account.merchant_account_id, kind: f.operation.kind, direction: f.operation.direction,
      transaction_id: f.operation.transaction_id, transfer_index: f.operation.transfer_index, asset: f.asset,
      original_operation_key: f.operation.original_operation_key,
      physical_key: selectors.physical_key, physical_tuple: physicalTuple,
    } : null,
    observations, assessment, effect_kind: effect,
  });
  canonicalFinancialEvidence(command);
  return command;
}

export function projectFinancialEvidence(command: unknown, role: AppRole, locale: "tr-TR" | "en-US" = "tr-TR") {
  const parsed = financialEvidenceCommandSchema.safeParse(command);
  if (!parsed.success) return null;
  const safe = projectFinancialAssessment(parsed.data.assessment, role, locale);
  if (!safe) return null;
  // Never reveal that another tenant owns a matching global identity.
  const hidden = new Set(["OPERATION_CONFLICT", "PHYSICAL_REUSE", "DELIVERY_CONFLICT"]);
  return Object.freeze({ ...safe, reasons: Object.freeze(safe.reasons.map(r => hidden.has(r.code)
    ? { code: "REVIEW_REQUIRED", message: locale === "en-US" ? "Review required" : "İnceleme gerekiyor" } : r)) });
}

export function decodeFinancialEvidenceCursor(value: string): ReturnType<typeof financialEvidenceCursorSchema.parse> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length > 1500) throw fail();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length > 1024 || decoded.toString("base64url") !== value) throw fail();
  // Cursors contain no authority or sensitive identity, but duplicate fields are
  // still rejected through the existing bounded grammar before schema parsing.
  return financialEvidenceCursorSchema.parse(parseCursor(decoded));
}

import { parseFinancialJson as parseCursor } from "./financial-source-canonical";

/** A bounded recommendation, not a worker or a new execution authority. */
export function financialEvidenceRecoveryDecision(code: string, attempt: number) {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 3) return { action: "STOP", delay_ms: 0 } as const;
  if (code === "COMMIT_UNKNOWN") return { action: "READ_SAME_COMMAND", delay_ms: 0 } as const;
  if (attempt === 3) return { action: "STOP", delay_ms: 0 } as const;
  if (code === "FSE_STALE_CONTEXT" || code === "40001" || code === "23505") return { action: "REFRESH_CONTEXT", delay_ms: 0 } as const;
  if (["40P01", "55P03"].includes(code)) return { action: "RETRY_TRANSACTION", delay_ms: [50, 150][attempt - 1]! } as const;
  return { action: "STOP", delay_ms: 0 } as const;
}
