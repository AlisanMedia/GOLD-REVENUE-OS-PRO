import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { financialEvidenceFenceSchema, financialEvidenceRecordedSchema, financialEvidencePageSchema, type FinancialSourceContract } from "../../packages/contracts/src/index";
import { prepareFinancialEvidenceCommand, canonicalFinancialEvidence, financialEvidenceRequestHash, financialEvidenceStorageHash } from "../../packages/domain/src/financial-evidence";
import { assessFinancialSource } from "../../packages/domain/src/financial-source";

const databaseUrl = process.env.FSE_DISPOSABLE_DB_URL;
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
function sql(statement: string): string {
  const url = new URL(databaseUrl!);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1") throw Error("FSE_LOCAL_DATABASE_REQUIRED");
  try {
    return execFileSync(process.env.FSE_PSQL_BIN ?? "psql", [databaseUrl!, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], { input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 20000 }).trim();
  } catch { throw Error("FSE_LOCAL_DATABASE_ASSERTION_FAILED"); }
}
function json(statement: string): unknown { return JSON.parse(sql(statement).split("\n").at(-1)!); }
function bundle(label: string, kind = "PAYMENT", amount = "1000", parent: string | null = null, scenario = "ready") {
  const b = json(`select private.phase16c1b_bundle(${quote(label)},1,${quote(amount)},${quote(kind)},${parent === null ? "null" : quote(parent)},false,${quote(scenario)});`) as {
    namespace_id: string; binding_version_id: string; command_id: string; series_id: string; read_acquisition_id: string;
    source: FinancialSourceContract; context: unknown; history: Parameters<typeof prepareFinancialEvidenceCommand>[0]["history"]; fence: unknown;
  };
  return { b, command: prepareFinancialEvidenceCommand({ namespaceId: b.namespace_id, bindingVersionId: b.binding_version_id, commandId: b.command_id,
    seriesId: b.series_id, previousAssessmentId: null, readAcquisitionId: b.read_acquisition_id, source: b.source, context: b.context, history: b.history,
    fence: financialEvidenceFenceSchema.parse(b.fence) }) };
}
function record(command: ReturnType<typeof prepareFinancialEvidenceCommand>) {
  return financialEvidenceRecordedSchema.parse(json(`select private.record_financial_evidence_v1(${quote(canonicalFinancialEvidence(command))},${quote(financialEvidenceRequestHash(command))});`));
}

it("financial persistence response cannot masquerade as genuine authority", () => {
  expect(financialEvidenceRecordedSchema.safeParse({ version: 1, command_id: "10000000-0000-4000-8000-000000000001", assessment_id: "10000000-0000-4000-8000-000000000002", assessment_revision: "1", claim_id: null,
    storage_outcome: "PENDING", financial_authority: "LIVE", historical: false }).success).toBe(false);
  expect(financialEvidenceStorageHash(["a", "b"])).not.toBe(financialEvidenceStorageHash(["ab"]));
});

// Explicitly skipped in Application (no database). Database CI must set this
// loopback-only variable and run this file, where these are real SQL assertions.
describe.runIf(Boolean(databaseUrl))("B synthetic PostgreSQL / actual TypeScript v1 bridge", () => {
  beforeAll(() => {
    if (sql("select coalesce(to_regprocedure('private.phase16c1b_bundle(text,integer,text,text,text,boolean,text)')::text,'');") === "") {
      sql(readFileSync("supabase/tests/helpers/phase16c1b_fixtures.sql", "utf8"));
    }
  });
  it("real v1 output commits atomically and unknown-COMMIT lookup/replay creates no second effect", () => {
    const { command } = bundle("bridge-payment");
    expect(command.assessment).toMatchObject({ source_state: "SOURCE_VERIFIED", financial_authority: "NONE" });
    expect(sql(`select private.fse_canonical(${quote(JSON.stringify(command))}::jsonb);`)).toBe(canonicalFinancialEvidence(command));
    expect(sql(`select private.fse_storage_hash(jsonb_build_array('command',private.fse_canonical(${quote(JSON.stringify(command))}::jsonb)));`)).toBe(financialEvidenceRequestHash(command));
    const first = record(command), replay = record(command);
    expect(first).toMatchObject({ historical: false, financial_authority: "NONE" });
    expect(replay).toEqual({ ...first, historical: true });
    expect(json(`select private.read_financial_evidence_command_v1(${quote(command.namespace_id)},${quote(command.tenant_id)},${quote(command.command_id)},${quote(financialEvidenceRequestHash(command))});`)).toEqual(replay);
    expect(JSON.stringify(command)).not.toMatch(/test:fse-payer|test:fse-recipient|fixture:key/u);
  });
  it("retains missing, invalid and unavailable source evidence without financial claims", () => {
    for (const scenario of ["missing_amount", "invalid_auth", "timeout"]) {
      const { command } = bundle("bridge-" + scenario, "PAYMENT", "1000", null, scenario);
      expect(command.assessment.financial_authority).toBe("NONE");
      expect(record(command).claim_id).toBeNull();
    }
  });
  it("keeps source verification separate from unallocated fulfillment", () => {
    const { command } = bundle("bridge-unallocated", "PAYMENT", "1000", null, "unallocated");
    expect(command.assessment).toMatchObject({ source_state: "SOURCE_VERIFIED", fulfillment_eligibility: "REVIEW", reasons: ["UNALLOCATED"] });
    expect(record(command)).toMatchObject({ storage_outcome: "RECORDED", financial_authority: "NONE" });
  });
  it("actual v1 handles partial refunds without fake receipt or subscription authority", () => {
    const parent = bundle("bridge-refund-parent").command;record(parent);
    const parentKey = parent.operation!.operation_key;
    for (const [label, amount] of [["bridge-refund-a", "300"], ["bridge-refund-b", "400"]]) {
      const { command } = bundle(label!, "REFUND", amount!, parentKey);
      expect(command.assessment).toMatchObject({ source_state: "SOURCE_VERIFIED", fulfillment_eligibility: "INELIGIBLE", reasons: ["REFUND_EFFECT_REVIEW"] });
      expect(record(command).claim_id).not.toBeNull();
    }
    expect(sql(`select linked_refund_units::text from private.fse_operations where namespace_id=${quote(parent.namespace_id)} and operation_key=${quote(parentKey)};`)).toBe("700");
    const excess = bundle("bridge-refund-excess", "REFUND", "500", parentKey).command;
    expect(excess.assessment.reasons).toEqual(["REFUND_TOTAL_EXCEEDED"]);record(excess);
    expect(sql(`select linked_refund_units::text from private.fse_operations where namespace_id=${quote(parent.namespace_id)} and operation_key=${quote(parentKey)};`)).toBe("700");
  });
  it("source version remains v1 and genuine financial events/receipts remain absent", () => {
    const { b, command } = bundle("bridge-final-negative");
    expect(command.assessment).toEqual(assessFinancialSource(b.source, b.context, b.history));
    expect(sql("select count(*) from private.verified_payment_receipts;")).toBe("0");
    expect(sql("select count(*) from public.domain_events where event_type='payment.confirmed';")).toBe("0");
    expect(sql("select count(*) from public.subscriptions where mode='live';")).toBe("0");
    expect(sql("select count(*) from public.channel_access where mode='live';")).toBe("0");
  });
  it("refund observed before its known parent stays unresolved, then correlates through a new assessment", () => {
    const parentPreview = bundle("bridge-delayed-parent").command;
    const parentKey = parentPreview.operation!.operation_key;
    const orphan = bundle("bridge-delayed-refund", "REFUND", "100", parentKey).command;
    expect(orphan.assessment.reasons).toEqual(["REFUND_ORIGINAL_MISSING"]);record(orphan);
    record(bundle("bridge-delayed-parent").command);
    const fresh = bundle("bridge-delayed-refund", "REFUND", "100", parentKey).command;
    expect(fresh.assessment.reasons).toEqual(["REFUND_EFFECT_REVIEW"]);record(fresh);
    expect(sql(`select linked_refund_units::text from private.fse_operations where namespace_id=${quote(fresh.namespace_id)} and operation_key=${quote(parentKey)};`)).toBe("100");
  });
  it("distinct transfer indexes are separate operations on the same synthetic transaction", () => {
    for (const index of ["0", "1"]) {
      const { b } = bundle("bridge-transfer-index");
      const source = structuredClone(b.source);
      for (const facts of [source.callback!.facts, source.independent_read!.facts!]) {
        facts.operation.transfer_index = index;
        facts.operation.physical_transfer = { ledger_id: "TRON", transaction_id: facts.operation.transaction_id, transfer_index: index, recipient: facts.recipient_reference! };
      }
      source.callback!.delivery_id += ":" + index;
      const command = prepareFinancialEvidenceCommand({ namespaceId: b.namespace_id, bindingVersionId: b.binding_version_id, commandId: b.command_id, seriesId: b.series_id,
        previousAssessmentId: null, readAcquisitionId: b.read_acquisition_id, source, context: b.context, history: b.history, fence: financialEvidenceFenceSchema.parse(b.fence) });
      expect(command.assessment.source_state).toBe("SOURCE_VERIFIED");expect(record(command).claim_id).not.toBeNull();
    }
    expect(sql("select count(*) from private.fse_operation_claims c join private.fse_operations o using(namespace_id,operation_key) where o.transaction_id='fixture:transaction:bridge-transfer-index';")).toBe("2");
  });
  it("assessment revisions append to one series and reject a stale previous revision", () => {
    const first = bundle("bridge-series").command, a = record(first);
    const next = bundle("bridge-series").command;
    next.evaluation_series_id = first.evaluation_series_id;next.previous_assessment_id = a.assessment_id;
    const b = record(next);
    expect(b.assessment_revision).toBe("2");expect(b.assessment_id).not.toBe(a.assessment_id);
    const fork = bundle("bridge-series").command;
    fork.evaluation_series_id = first.evaluation_series_id;fork.previous_assessment_id = a.assessment_id;
    expect(() => record(fork)).toThrow("FSE_LOCAL_DATABASE_ASSERTION_FAILED");
    expect(sql(`select count(*) from private.fse_assessments where namespace_id=${quote(first.namespace_id)} and tenant_id=${quote(first.tenant_id)} and evaluation_series_id=${quote(first.evaluation_series_id)};`)).toBe("2");
  });
  it("validates each actual SQL read projection against a strict safe DTO", () => {
    for (const collection of ["observations", "assessments", "claims", "allocations", "refunds", "history"]) {
      const result = json(`select set_config('request.jwt.claim.sub',private.phase16c1b_id('user:2')::text,false);select public.admin_financial_evidence_page_v1(private.phase16c1b_id('namespace'),private.phase16c1b_id('tenant:1'),${quote(collection)});`);
      const page = financialEvidencePageSchema.parse(result);
      expect(page.financial_authority).toBe("NONE");
      expect(JSON.stringify(page)).not.toMatch(/payer_digest|operation_key|raw_hash|test:fse-payer|fixture:key/u);
      if (page.items[0]) expect(financialEvidencePageSchema.safeParse({ ...page, items: [{ ...page.items[0], raw_callback: "SECRET_SENTINEL" }] }).success).toBe(false);
    }
  });
});
