import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPrivateBetaProtectedCanary } from "../../scripts/private-beta-founder-canary.mjs";
import { createPolatPrivateBetaProvider } from "../../packages/domain/src/polat-private-beta-provider";
import { polatGuardDigest } from "../../packages/domain/src/polat-experiment-journal";
import { polatOpenAICanaryPlan } from "../../packages/domain/src/polat-openai-canary";
import { polatClaudeFixtureWire } from "../helpers/polat-bridge-fixtures";

// Offline HTTP/database/socket doubles only. These do not establish an actual
// founder login, MFA, workflow review, provider success, bill or Telegram result.
const network = vi.hoisted(() => ({ calls: [] as string[], inputTokens: 37, body: "" }));
vi.mock("node:https", () => ({ request: (options: RequestOptions, callback: (response: IncomingMessage) => void) => {
  const socket = new EventEmitter() as ClientRequest;
  socket.destroy = (() => socket) as ClientRequest["destroy"];
  socket.end = (() => { network.calls.push(String(options.path)); queueMicrotask(() => {
    const r = new EventEmitter() as IncomingMessage; r.statusCode = 200; r.headers = { "content-type": "application/json", "x-request-id": "req_offline_control_fixture", "openai-organization": "user-offline-fixture" };
    r.resume = (() => r) as IncomingMessage["resume"]; callback(r);
    r.emit("data", Buffer.from(options.path === "/v1/responses/input_tokens" ? JSON.stringify({ object: "response.input_tokens", input_tokens: network.inputTokens }) : network.body)); r.emit("end");
  }); return socket; }) as ClientRequest["end"];
  return socket;
} }));
const T = "91cc2000-0000-4000-8000-000000000001", P = "91cc1000-0000-4000-8000-000000000001", SHA = "a".repeat(40), KEY = "SYNTHETIC_OPENAI_KEY_NEVER_AUTHORITY";
const A = "91cc4000-0000-4000-8000-000000000001", R = "91cc3000-0000-4000-8000-000000000001";
const DB = "https://api.supabase.com/v1/projects/xqvwkghpmezcpgugetqc/database/query";
const H = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
function fixture() {
  const at = Date.now(), expiry = new Date(at + 120000).toISOString(), plan = polatOpenAICanaryPlan();
  const env: Record<string,string|undefined> = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "AlisanMedia/GOLD-REVENUE-OS-PRO", GITHUB_REF: "refs/heads/main", GITHUB_RUN_ID: "1234", GITHUB_SHA: SHA, VALIDATED_SHA: SHA, AUTHORIZED_FOUNDER_RECOVERY: "true", PRIVATE_BETA_PROGRAM_ID: P, SUPABASE_ACCESS_TOKEN: "SYNTHETIC_MANAGEMENT_KEY_NEVER_AUTHORITY", OPENAI_API_KEY: KEY };
  const scopeHash = polatGuardDigest(["OPENAI_PROJECT1", "org-fixture", "proj_fixture"]), custody = polatGuardDigest(["POLAT_UAT_CREDENTIAL_CUSTODY1", scopeHash, H(KEY)]);
  const binding = { version: 4, mode: "PRIVATE_BETA_UAT", program_id: P, tenant_id: T, conversation_style: "DIRECT", provider: "openai", model: "gpt-6.1-sol", model_version: "gpt-6.1-sol", protocol_version: "responses-v1", repository_sha: SHA, manifest_hash: "b".repeat(64), authorization_record_hash: "c".repeat(64), account_scope_hash: scopeHash, corpus_version: plan.plan.version, corpus_hash: plan.corpus_hash, plan_hash: plan.plan_hash, maximum_requests: 2, maximum_spend: "5.00", maximum_attempt_liability: "0.0264704", currency: "USD", maximum_output_tokens: 512, timeout_ms: 10000, expires_at: expiry, financial_authority: "NONE", commercial_sales: false,
    scope: "OWNER_ONLY", effective_limit_kind: "LOCAL_DURABLE_RESERVATION_CAP", maximum_input_tokens: 4096, retained_unknown_attempt_id: "91cc4000-0000-4000-8000-000000000099", retained_unknown_run_id: "91cc3000-0000-4000-8000-000000000099", recovery_authorization_hash: "9".repeat(64), recovery_authority: "PROTECTED_EXISTING_OWNER_GRANT", recovery_execution_ref: "GITHUB_RUN:1234:" + SHA };
  const bindingHash = polatGuardDigest(binding);
  const owner = { version: 1, origin: "SERVER_AUTHENTICATED_OWNER_GRANT", program_id: P, tenant_id: T, owner_user_id: "91cc6000-0000-4000-8000-000000000001", role: "super_admin", aal: "aal2", authenticated_at: new Date(at - 2000).toISOString(), approved_at: new Date(at - 1000).toISOString(), starts_at: new Date(at - 2000).toISOString(), expires_at: expiry, revoked: false, phase: "CANARY", binding_hash: bindingHash, policy_hash: "d".repeat(64), credential_custody_hash: custody };
  const payload = { version: 4, origin: "SERVER_DERIVED_OWNER_ONLY_UAT_CONTROL", scope: "OWNER_ONLY", program_id: P, tenant_id: T, account_scope_hash: scopeHash, repository_sha: SHA, manifest_hash: binding.manifest_hash, authorization_record_hash: binding.authorization_record_hash, provider: "openai", model: binding.model, model_access: true, organization_id: "org-fixture", project_id: "proj_fixture", credential_sha256: H(KEY), policy_hash: owner.policy_hash, credential_custody_hash: custody, currency: "USD", effective_limit_kind: "LOCAL_DURABLE_RESERVATION_CAP", local_maximum_spend: "5.00", local_reserved_liability: "4.628448", local_remaining_allowance: "0.371552", provider_billing: "UNKNOWN", provider_enforced_cap: "UNVERIFIED", canary_result_hash: null, unknown_outcome_count: 0, request_bound: null, observed_at: new Date(at).toISOString(), expires_at: expiry,
    retained_unknown_attempt_id: binding.retained_unknown_attempt_id, retained_unknown_run_id: binding.retained_unknown_run_id, retained_unknown_liability: "4.628448", recovery_authorization_hash: binding.recovery_authorization_hash, recovery_authority: binding.recovery_authority, recovery_execution_ref: binding.recovery_execution_ref };
  const pricing = { version: 2, origin: "INDEPENDENT_OFFICIAL_PRICING_READ", model: binding.model, currency: "USD", source_url: "https://developers.openai.com/api/docs/models/gpt-6.1-sol", source_hash: "7".repeat(64), maximum_input_tokens: 1050000, maximum_input_usd_per_million: "4.4", maximum_output_usd_per_million: "16.5", observed_at: new Date(at).toISOString(), expires_at: expiry, all_billable_components_covered: true };
  const state = { role: "postgres", standing: true, version: "3", global: 1, prepared: false, nonce: "", native: "", conversation: "", requestHash: "", bodyHash: "", outcome: null as null | Record<string,unknown>, queries: [] as string[], afterParent: "1".repeat(64), afterAuth: "2".repeat(64), failPrepareAck: false, failRecordAck: false };
  const request = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe(DB); expect(init?.redirect).toBe("error");
    const sql = JSON.parse(String(init?.body)).query as string; state.queries.push(sql);
    const args = [...sql.matchAll(/'([^']*)'/gu)].map(m => m[1]!); let value: unknown;
    if (sql.includes("jsonb_build_object('tenant_id'")) value = { tenant_id: T, stage: "CANARY", generation: "4", request_count: state.global, account_version: state.version, repository_sha: state.version === "4" ? SHA : "f".repeat(40), eligible: state.version === "3", standing_owner: state.standing, canary_accepted: state.outcome?.qa === "APPROVED", retained_fingerprint: "1".repeat(64), auth_fingerprint: "2".repeat(64) };
    else if (sql.includes("private.private_beta_recover_founder_test(")) { state.prepared = true; state.version = "4"; value = { program_id: P, stage: "CANARY", generation: "5" }; }
    else if (sql.includes("private.private_beta_protected_canary_scope(")) value = { program_id: P, tenant_id: T, stage: "CANARY", repository_sha: SHA, provider: "openai", model: binding.model, owner_only: true };
    else if (sql.includes("public.private_beta_binding_v1(")) value = binding;
    else if (sql.includes("public.private_beta_owner_grant_v1(")) value = owner;
    else if (sql.includes("public.private_beta_account_control_v1(")) value = { payload, pricing };
    else if (sql.includes("public.private_beta_reserve_v1(")) {
      state.native = args[2]!; state.requestHash = args[3]!; state.bodyHash = args[4]!; state.conversation = args[6]!; state.global++;
      payload.local_reserved_liability = "4.6549184"; payload.local_remaining_allowance = "0.3450816";
      value = { version: 1, mode: "PRIVATE_BETA_UAT", program_id: P, tenant_id: T, run_id: R, native_run_id: state.native, attempt_id: A, binding_hash: bindingHash, request_hash: state.requestHash, body_hash: state.bodyHash, replay: false, dispatch_started: false, liability: binding.maximum_attempt_liability };
    } else if (sql.includes("public.private_beta_begin_v1(")) { state.nonce = args[3]!; value = { dispatch: true }; }
    else if (sql.includes("public.private_beta_committed_attempt_v1(")) {
      const attempt = { version: 2, purpose: "POLAT_PRIVATE_BETA_UAT", program_id: P, tenant_id: T, run_id: R, native_run_id: state.native, conversation_id: state.conversation, attempt_id: A, participant_id: null, scope: "CANARY", source_message_id: null, binding_hash: bindingHash, request_hash: state.requestHash, body_hash: state.bodyHash, account_scope_hash: scopeHash, authorization_record_hash: binding.authorization_record_hash, global_ordinal: 2, participant_ordinal: 0, liability: binding.maximum_attempt_liability, reserved_liability: payload.local_reserved_liability, generation: "5", dispatch_nonce: state.nonce, issued_at: new Date(at).toISOString(), expires_at: new Date(at + 30000).toISOString() };
      value = { version: 1, mode: "PRIVATE_BETA_UAT", state: "DISPATCH_STARTED", ownership: "AI_ACTIVE", participation: "ACTIVE", program_id: P, tenant_id: T, run_id: R, native_run_id: state.native, conversation_id: state.conversation, attempt_id: A, request_hash: state.requestHash, body_hash: state.bodyHash, binding_hash: bindingHash, generation: "5", dispatch_nonce: state.nonce, payload: attempt };
    } else if (sql.includes("public.private_beta_record_v1(")) { const hex = /decode\('([a-f0-9]+)','hex'\)/u.exec(sql)?.[1]; expect(hex).toBeTruthy(); state.outcome = JSON.parse(Buffer.from(hex!, "hex").toString("utf8")); value = { recorded: true }; }
    else if (sql.includes("jsonb_build_object('accepted'")) value = { accepted: state.outcome?.qa === "APPROVED", retained_fingerprint: state.afterParent, auth_fingerprint: state.afterAuth };
    else throw Error("OFFLINE_FIXED_QUERY_ONLY");
    const failing = state.failPrepareAck && sql.includes("private.private_beta_recover_founder_test(") || state.failRecordAck && sql.includes("public.private_beta_record_v1(");
    const response = new Response(JSON.stringify([{ database_role: state.role, value }]), { status: failing ? 500 : 201, headers: { "content-type": "application/json" } }); Object.defineProperty(response, "url", { value: DB }); return response;
  });
  return { env, state, request, payload, owner, run: () => runPrivateBetaProtectedCanary({ env, request, providerFactory: createPolatPrivateBetaProvider }) };
}
beforeEach(() => { network.calls = []; network.inputTokens = 37; network.body = JSON.stringify({ id: "resp_offline_fixture", object: "response", model: "gpt-6.1-sol", status: "completed", created_at: 1, output: [{ type: "message", id: "msg_offline_fixture", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(polatClaudeFixtureWire()) }] }], usage: { input_tokens: 37, output_tokens: 121, total_tokens: 158 } }); });

describe("protected founder canary connector, offline controls and native QA", () => {
  it("uses one native attempt/count/generation and independently verifies old evidence and actual Auth records unchanged", async () => {
    const f = fixture(), result = await f.run();
    expect(result).toMatchObject({ state: "REAL_CANARY_QA_ACCEPTED", initiated_attempts: 1, actual_inference_requests: 1, qa: "APPROVED", original_unknown_preserved: true, existing_owner_auth_preserved: true, actual_billed_amount: null, telegram_messages: 0, automatic_retries: 0 });
    expect(network.calls).toEqual(["/v1/responses/input_tokens", "/v1/responses"]); expect(f.state.global).toBe(2);
    expect(f.payload.retained_unknown_liability).toBe("4.628448"); expect(f.state.outcome).toMatchObject({ status: "SUCCEEDED", qa: "APPROVED" });
    expect(JSON.stringify(result)).not.toContain(KEY); expect(f.state.queries.filter(q => q.includes("private.private_beta_recover_founder_test("))).toHaveLength(1);
    expect(f.state.queries.join("\n")).not.toMatch(/set_config|insert into auth|update auth/iu);
  });
  it.each(["opt-in", "branch", "sha", "event", "repository"])("blocks invalid protected %s before database or inference", async key => {
    const f = fixture(); if (key === "opt-in") f.env.AUTHORIZED_FOUNDER_RECOVERY = "false"; if (key === "branch") f.env.GITHUB_REF = "refs/heads/fixture"; if (key === "sha") f.env.GITHUB_SHA = "b".repeat(40); if (key === "event") f.env.GITHUB_EVENT_NAME = "pull_request"; if (key === "repository") f.env.GITHUB_REPOSITORY = "foreign/repo";
    expect(await f.run()).toMatchObject({ state: "BLOCKED", initiated_attempts: 0 }); expect(f.request).not.toHaveBeenCalled(); expect(network.calls).toHaveLength(0);
  });
  it.each(["role", "owner", "unknown-prepare-ack"])("does not infer, retry or fabricate successful recovery after %s denial", async kind => {
    const f = fixture(); if (kind === "role") f.state.role = "authenticated"; if (kind === "owner") f.state.standing = false; if (kind === "unknown-prepare-ack") f.state.failPrepareAck = true;
    expect(await f.run()).toMatchObject({ state: "BLOCKED", initiated_attempts: 0 }); expect(network.calls).toHaveLength(0);
    expect(f.state.queries.filter(q => q.includes("private.private_beta_recover_founder_test("))).toHaveLength(kind === "unknown-prepare-ack" ? 1 : 0);
  });
  it.each(["parent", "auth", "record-ack"])("holds %s readback/commit uncertainty without another generation", async kind => {
    const f = fixture(); if (kind === "parent") f.state.afterParent = "f".repeat(64); if (kind === "auth") f.state.afterAuth = "f".repeat(64); if (kind === "record-ack") f.state.failRecordAck = true;
    expect(await f.run()).toMatchObject({ state: "BLOCKED", initiated_attempts: 1, original_unknown_preserved: "NOT_YET_VERIFIED" }); expect(network.calls.filter(p => p === "/v1/responses")).toHaveLength(1);
  });
  it("keeps over-cap input out of model inference and preserves both liabilities", async () => {
    const f = fixture(); network.inputTokens = 4097;
    expect(await f.run()).toMatchObject({ state: "BLOCKED", initiated_attempts: 1 }); expect(network.calls).toEqual(["/v1/responses/input_tokens"]);
    expect(f.state.outcome).toMatchObject({ status: "FAILED", qa: "NOT_EVALUATED" }); expect(f.payload.local_reserved_liability).toBe("4.6549184");
  });
});
