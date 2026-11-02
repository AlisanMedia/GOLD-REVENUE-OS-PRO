import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { RequestOptions, IncomingMessage, ClientRequest } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preparePolatConversation, assessPolatDraft } from "./polat-conversation";
import { polatFixture } from "./polat-conversation.fixtures";
import { polatClaudeFixtureWire } from "../../../tests/helpers/polat-bridge-fixtures";
import { preparePolatOpenAIRequest, decodePolatOpenAIResponse } from "./polat-openai-adapter";
import { polatOpenAICanaryPlan } from "./polat-openai-canary";
import { polatClaudeCanaryPlan } from "./polat-claude-canary";
import { polatGuardDigest } from "./polat-experiment-journal";
import type { ModelRequest, ModelResponse } from "./agent-runtime";
import { createPolatPrivateBetaNetworkAuthority, polatPrivateBetaBindingSchema, polatPrivateBetaAccountEvidenceSchema, requirePolatNetworkPermit, polatGenuineExecutionGate, type PolatPrivateBetaAttemptPayload } from "./polat-experiment-execution-gate";

const fake = vi.hoisted(() => ({ calls: [] as Array<{ options: RequestOptions; body: string }>, body: "", status: 200, stall: false, disconnect: false, timeline: [] as string[], headers: {} as Record<string, string | string[] | undefined> }));
vi.mock("node:https", () => ({ request: (options: RequestOptions, callback: (response: IncomingMessage) => void) => {
  const socket = new EventEmitter() as ClientRequest;
  socket.destroy = (() => socket) as ClientRequest["destroy"];
  socket.end = ((body: string) => {
    fake.calls.push({ options, body }); fake.timeline.push("network");
    if (fake.stall) return socket;
    queueMicrotask(() => {
      if (fake.disconnect) { socket.emit("error", Error("SYNTHETIC_SECRET_MUST_NOT_LEAK")); return; }
      const response = new EventEmitter() as IncomingMessage;
      response.statusCode = fake.status; response.headers = { "content-type": "application/json", "x-request-id": "req_fixture_001", ...fake.headers };
      response.resume = (() => response) as IncomingMessage["resume"]; callback(response);
      response.emit("data", Buffer.from(fake.body)); response.emit("end");
    });
    return socket;
  }) as ClientRequest["end"];
  return socket;
} }));
import { createPolatPrivateBetaProvider, boundPolatPrivateBetaWireLiability, estimatePolatOwnerOnlyOpenAIUsageLiability, type PolatPrivateBetaReservation, type PolatPrivateBetaProviderOutcome } from "./polat-private-beta-provider";
import { sendPolatOpenAIHttpsOnce } from "./polat-openai-https-boundary";
import { sendPolatClaudeHttpsOnce } from "./polat-claude-https-boundary";

function response(extra: Record<string, unknown> = {}) {
  return { id: "resp_fixture_001", object: "response", model: "gpt-6.1-sol", status: "completed", created_at: 1793059200, completed_at: 1793059201,
    error: null, incomplete_details: null, instructions: null, metadata: {}, parallel_tool_calls: false, tools: [], tool_choice: "none", background: false,
    previous_response_id: null, conversation: null, prompt: null, max_output_tokens: 512, reasoning: { effort: "low", summary: null }, service_tier: "default", truncation: "disabled",
    prompt_cache_options: { mode: "explicit", ttl: "30m", comparison_response_id: null }, prompt_cache_diagnostics: { type: "unavailable" },
    output: [{ type: "message", id: "msg_fixture_001", role: "assistant", status: "completed", phase: "final_answer", content: [{ type: "output_text", text: JSON.stringify(polatClaudeFixtureWire()), annotations: [], logprobs: [] }] }],
    usage: { input_tokens: 37, output_tokens: 121, total_tokens: 158, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 7 } }, ...extra };
}
function fixture() {
  const now = Date.now(), prepared = preparePolatConversation(polatFixture("Hi", "en")); prepared.request.timeoutMs = 10000; prepared.request.requestId = "91cc6000-0000-4000-8000-000000000001";
  const canary = polatOpenAICanaryPlan(), credential = "SYNTHETIC_OPENAI_CREDENTIAL_NOT_AUTHORITY", credentialHash = createHash("sha256").update(credential).digest("hex");
  const accountScope = polatGuardDigest(["OPENAI_PROJECT1", "org-fixture", "proj_fixture"]);
  const binding = polatPrivateBetaBindingSchema.parse({ version: 2, mode: "PRIVATE_BETA_UAT", program_id: "91cc1000-0000-4000-8000-000000000001", tenant_id: prepared.request.context.tenantId, conversation_style: "DIRECT", provider: "openai", model: "gpt-6.1-sol", model_version: "gpt-6.1-sol", protocol_version: "responses-v1", repository_sha: "a".repeat(40), manifest_hash: "b".repeat(64), authorization_record_hash: "c".repeat(64), account_scope_hash: accountScope,
    corpus_version: canary.plan.version, corpus_hash: canary.corpus_hash, plan_hash: canary.plan_hash, maximum_requests: 1, maximum_spend: "5.00", maximum_attempt_liability: "4.20768", currency: "USD", maximum_output_tokens: 512, timeout_ms: 10000, expires_at: new Date(now + 120000).toISOString(), financial_authority: "NONE", commercial_sales: false });
  const hash = polatGuardDigest(binding), wire = preparePolatOpenAIRequest(prepared.request, 512), custody = polatGuardDigest(["POLAT_UAT_CREDENTIAL_CUSTODY1", accountScope, credentialHash]);
  const owner = { version: 1, origin: "SERVER_AUTHENTICATED_OWNER_GRANT", program_id: binding.program_id, tenant_id: binding.tenant_id, owner_user_id: "91cc2000-0000-4000-8000-000000000001", role: "super_admin", aal: "aal2", authenticated_at: new Date(now - 1000).toISOString(), approved_at: new Date(now).toISOString(), starts_at: new Date(now - 1000).toISOString(), expires_at: binding.expires_at, revoked: false, phase: "CANARY", binding_hash: hash, policy_hash: "d".repeat(64), credential_custody_hash: custody };
  const account = { payload: { version: 2, origin: "INDEPENDENT_ACCOUNT_CONTROL", program_id: binding.program_id, tenant_id: binding.tenant_id, account_scope_hash: accountScope, organization_id: "org-fixture", project_id: "proj_fixture", credential_sha256: credentialHash, repository_sha: binding.repository_sha, manifest_hash: binding.manifest_hash, authorization_record_hash: binding.authorization_record_hash,
    provider: "openai", model: "gpt-6.1-sol", model_access: true, policy_hash: owner.policy_hash, credential_custody_hash: custody, region_evidence_hash: "e".repeat(64), retention_evidence_hash: "e".repeat(64), training_evidence_hash: "e".repeat(64), effective_limit_kind: "ENFORCED_EXPERIMENT_HARD_CAP", currency: "USD", enforced_maximum_spend: "5.00", independently_observed_spend: "0", remaining_allowance: "5.00", billing_state: "RECONCILED", billing_evidence_hash: "f".repeat(64), canary_reconciliation_hash: null as string | null, unknown_outcome_count: 0,
    request_bound: { request_hash: wire.request_hash, body_hash: wire.body_hash, maximum_output_tokens: 512, maximum_possible_charge: "4.20768", pricing_evidence_hash: "8".repeat(64), valid_until: new Date(now + 60000).toISOString() }, observed_at: new Date(now).toISOString(), expires_at: new Date(now + 120000).toISOString() } };
  const payload: PolatPrivateBetaAttemptPayload = { version: 2, purpose: "POLAT_PRIVATE_BETA_UAT", program_id: binding.program_id, tenant_id: binding.tenant_id, run_id: "91cc3000-0000-4000-8000-000000000001", native_run_id: prepared.request.requestId, conversation_id: prepared.request.context.conversationId, attempt_id: "91cc4000-0000-4000-8000-000000000001", participant_id: null, scope: "CANARY", source_message_id: null, binding_hash: hash, request_hash: wire.request_hash, body_hash: wire.body_hash, account_scope_hash: accountScope, authorization_record_hash: binding.authorization_record_hash, global_ordinal: 1, participant_ordinal: 0, liability: "4.20768", reserved_liability: "4.20768", generation: "1", dispatch_nonce: "91cc5000-0000-4000-8000-000000000001", issued_at: new Date(now).toISOString(), expires_at: new Date(now + 30000).toISOString() };
  const committed = { version: 1, mode: "PRIVATE_BETA_UAT", state: "DISPATCH_STARTED", ownership: "AI_ACTIVE", participation: "ACTIVE", program_id: binding.program_id, tenant_id: binding.tenant_id, run_id: payload.run_id, native_run_id: payload.native_run_id, conversation_id: payload.conversation_id, attempt_id: payload.attempt_id, request_hash: payload.request_hash, body_hash: payload.body_hash, binding_hash: hash, generation: "1", dispatch_nonce: payload.dispatch_nonce, payload };
  const credentialRead = vi.fn(() => { fake.timeline.push("credential"); return Promise.resolve(credential); });
  const authority = createPolatPrivateBetaNetworkAuthority({ deployed_sha: binding.repository_sha, readOwnerGrant: () => Promise.resolve(owner), readIndependentAccount: () => Promise.resolve(account), readCommittedAttempt: () => Promise.resolve(committed), resolveCredential: credentialRead });
  const reservation: PolatPrivateBetaReservation = { version: 1, mode: "PRIVATE_BETA_UAT", program_id: binding.program_id, tenant_id: binding.tenant_id, run_id: payload.run_id, native_run_id: payload.native_run_id, attempt_id: payload.attempt_id, binding_hash: hash, request_hash: payload.request_hash, body_hash: payload.body_hash, replay: false, dispatch_started: false, liability: payload.liability };
  const outcomes: PolatPrivateBetaProviderOutcome[] = [], reserve = vi.fn(() => { fake.timeline.push("reserve_committed"); return Promise.resolve(reservation); }), begin = vi.fn(() => { fake.timeline.push("start_committed"); return Promise.resolve({ dispatch: true }); }), record = vi.fn((_r: PolatPrivateBetaReservation, outcome: PolatPrivateBetaProviderOutcome) => { fake.timeline.push("outcome_committed"); outcomes.push(outcome); return Promise.resolve(); });
  const assess = vi.fn((_request: ModelRequest, actual: ModelResponse) => assessPolatDraft(prepared, actual.output).action === "SAFE_PREVIEW" ? "APPROVED" as const : "HELD" as const);
  const service = createPolatPrivateBetaProvider({ binding, authority, store: { reserve, begin, record }, assess });
  return { now, prepared, binding, owner, account, payload, committed, authority, credentialRead, reservation, outcomes, reserve, begin, record, service, assess };
}
function ownerOnlyFixture(founder = false) {
  const original = fixture();
  const binding = polatPrivateBetaBindingSchema.parse({ ...original.binding, version: 3, scope: "OWNER_ONLY", effective_limit_kind: "LOCAL_DURABLE_RESERVATION_CAP",
    ...(founder ? { corpus_version: "polat-private-beta-conversation-v1", corpus_hash: "3".repeat(64), plan_hash: "4".repeat(64), maximum_requests: 350 } : {}) });
  if (binding.version !== 3) throw Error("OWNER_ONLY_FIXTURE_REQUIRED");
  const hash = polatGuardDigest(binding), owner = { ...original.owner, binding_hash: hash, phase: founder ? "FOUNDER" : "CANARY" };
  const a = original.account.payload;
  const account = polatPrivateBetaAccountEvidenceSchema.parse({ version: 3, origin: "SERVER_DERIVED_OWNER_ONLY_UAT_CONTROL", scope: "OWNER_ONLY",
    program_id: a.program_id, tenant_id: a.tenant_id, account_scope_hash: a.account_scope_hash, repository_sha: a.repository_sha, manifest_hash: a.manifest_hash, authorization_record_hash: a.authorization_record_hash,
    provider: "openai", model: "gpt-6.1-sol", model_access: true, organization_id: a.organization_id, project_id: a.project_id, credential_sha256: a.credential_sha256,
    policy_hash: a.policy_hash, credential_custody_hash: a.credential_custody_hash, currency: "USD", effective_limit_kind: "LOCAL_DURABLE_RESERVATION_CAP", local_maximum_spend: "5.00",
    local_reserved_liability: founder ? "0.001963" : "0", local_remaining_allowance: founder ? "4.998037" : "5.00", provider_billing: "UNKNOWN", provider_enforced_cap: "UNVERIFIED",
    canary_result_hash: founder ? "7".repeat(64) : null, unknown_outcome_count: 0, request_bound: a.request_bound, observed_at: a.observed_at, expires_at: a.expires_at });
  if (account.version !== 3) throw Error("OWNER_ONLY_FIXTURE_REQUIRED");
  const payload: PolatPrivateBetaAttemptPayload = { ...original.payload, binding_hash: hash, scope: founder ? "FOUNDER" : "CANARY", global_ordinal: founder ? 2 : 1,
    participant_id: founder ? "91cc7000-0000-4000-8000-000000000001" : null, participant_ordinal: founder ? 1 : 0, source_message_id: founder ? original.prepared.request.context.recentMessages.at(-1)!.id : null,
    reserved_liability: founder ? "4.209643" : "4.20768" };
  const committed = { ...original.committed, binding_hash: hash, payload };
  const reservation = { ...original.reservation, binding_hash: hash };
  const reserve = vi.fn(() => {
    fake.timeline.push("reserve_committed"); account.local_reserved_liability = payload.reserved_liability; account.local_remaining_allowance = founder ? "0.790357" : "0.79232";
    return Promise.resolve(reservation);
  });
  const authority = createPolatPrivateBetaNetworkAuthority({ deployed_sha: binding.repository_sha, readOwnerGrant: () => Promise.resolve(owner), readIndependentAccount: () => Promise.resolve({ payload: account }), readCommittedAttempt: () => Promise.resolve(committed), resolveCredential: original.credentialRead });
  const service = createPolatPrivateBetaProvider({ binding, authority, store: { reserve, begin: original.begin, record: original.record }, assess: original.assess });
  return { ...original, binding, owner, account, payload, committed, reservation, reserve, authority, service };
}
beforeEach(() => { fake.calls = []; fake.body = JSON.stringify(response()); fake.status = 200; fake.stall = false; fake.disconnect = false; fake.timeline = []; fake.headers = {}; });

describe("OpenAI fixed Responses codec, offline fixtures only", () => {
  it("uses exact model/native schema, scoped source handles, explicit identity and locked cost-affecting parameters", () => {
    const s = fixture(), wire = preparePolatOpenAIRequest(s.prepared.request, 512), serialized = JSON.stringify(wire.body);
    expect(wire.body).toMatchObject({ model: "gpt-6.1-sol", max_output_tokens: 512, stream: false, store: false, background: false, service_tier: "default", tools: [], tool_choice: "none", parallel_tool_calls: false, reasoning: { effort: "low" }, prompt_cache_options: { mode: "explicit", ttl: "30m" } });
    expect(serialized).not.toMatch(/prompt_cache_breakpoint|previous_response_id|temperature|top_p|authorization/u);
    expect(serialized).not.toContain(s.binding.tenant_id); expect(serialized).not.toContain(s.prepared.request.context.conversationId); expect(serialized).toContain("Polat's AI assistant"); expect(serialized).toContain("EVIDENCE_CURRENT_MESSAGE");
  });
  it("decodes actual native output and keeps usage distinct from unknown actual billing", () => {
    const s = fixture(), decoded = decodePolatOpenAIResponse(JSON.stringify(response()), s.prepared.request, 512);
    expect(decoded.output.proposed_response).toBe(polatClaudeFixtureWire().proposed_response); expect(decoded.output.claims[1]!.evidence_refs).toEqual(["polat:identity:v1"]); expect(decoded.usage?.output_tokens_details?.reasoning_tokens).toBe(7); expect(decoded).not.toHaveProperty("actual_billed_amount");
  });
  it("accepts documented nullable metadata without forwarding raw instructions, reasoning or private identity", () => {
    const s = fixture(), base = response(), decoded = decodePolatOpenAIResponse(JSON.stringify(response({ access_programs: { cyber: "standard" }, moderation: null, safety_identifier: "PRIVATE_FIXTURE_IDENTITY", prompt_cache_key: null, prompt_cache_retention: "24h", output: [{ type: "reasoning", id: "rs_fixture", summary: [], content: [{ type: "reasoning_text", text: "PRIVATE_REASONING" }], encrypted_content: "PRIVATE_ENCRYPTED", status: "completed" }, ...base.output] })), s.prepared.request, 512);
    expect(JSON.stringify(decoded)).not.toMatch(/PRIVATE_REASONING|PRIVATE_ENCRYPTED|PRIVATE_FIXTURE_IDENTITY/u);
  });
  it.each(["model", "status", "tool", "refusal", "background", "prior", "tier", "cache", "authority", "output-limit", "usage-total", "usage-negative"])("holds incompatible response %s", change => {
    const s = fixture(); let extra: Record<string, unknown> = {};
    if (change === "model") extra = { model: "gpt-6-luna" }; if (change === "status") extra = { status: "incomplete" }; if (change === "tool") extra = { output: [{ type: "function_call", name: "send", arguments: "{}" }] }; if (change === "refusal") extra = { output: [{ ...response().output[0], content: [{ type: "refusal", refusal: "No" }] }] };
    if (change === "background") extra = { background: true }; if (change === "prior") extra = { previous_response_id: "resp_foreign" }; if (change === "tier") extra = { service_tier: "priority" }; if (change === "cache") extra = { prompt_cache_options: { mode: "implicit", ttl: "30m" } }; if (change === "authority") extra = { verified: true }; if (change === "output-limit") extra = { max_output_tokens: 513 }; if (change === "usage-total") extra = { usage: { input_tokens: 37, output_tokens: 121, total_tokens: 159 } }; if (change === "usage-negative") extra = { usage: { input_tokens: -1, output_tokens: 0, total_tokens: 0 } };
    expect(() => decodePolatOpenAIResponse(JSON.stringify(response(extra)), s.prepared.request, 512)).toThrow();
  });
  it("accepts documented optional/null echoes as unknown metadata without replacing request/account authority", () => {
    const s = fixture();
    for (const echo of [null, undefined]) {
      const decoded = decodePolatOpenAIResponse(JSON.stringify(response({ service_tier: echo, prompt_cache_options: echo })), s.prepared.request, 512);
      expect(decoded.output.proposed_response).toBe(polatClaudeFixtureWire().proposed_response); expect(decoded.metadata.service_tier).toBeNull(); expect(decoded).not.toHaveProperty("actual_billed_amount");
    }
  });
  it("rejects duplicate keys, malformed JSON, cache write charges, extra messages and foreign evidence", () => {
    const s = fixture(), foreign = polatClaudeFixtureWire(); foreign.claims[1]!.evidence_refs = ["foreign-customer"];
    for (const raw of ["{\"id\":\"resp_a\",\"id\":\"resp_b\"}", "not-json", JSON.stringify(response({ usage: { ...response().usage, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1 } } })), JSON.stringify(response({ output: [...response().output, ...response().output] })), JSON.stringify(response({ output: [{ ...response().output[0], content: [{ type: "output_text", text: JSON.stringify(foreign) }] }] }))]) expect(() => decodePolatOpenAIResponse(raw, s.prepared.request, 512)).toThrow();
  });
  it("does not permit a QA rewrite, output enlargement or changed prompt version", () => {
    const s = fixture(); expect(() => preparePolatOpenAIRequest(s.prepared.request, 513)).toThrow();
    expect(() => preparePolatOpenAIRequest({ ...s.prepared.request, rewriteFeedback: { scores: {} as never, reasons: [], attempt: 1 } }, 512)).toThrow("PLAN_DENIED");
    expect(() => preparePolatOpenAIRequest({ ...s.prepared.request, versions: { ...s.prepared.request.versions!, qa: "foreign" } as never }, 512)).toThrow("VERSION_DRIFT");
  });
  it("independently pins the new canary without changing historical Claude hashes or authorizing any request", () => {
    expect(polatOpenAICanaryPlan()).toMatchObject({ corpus_hash: "afda9041422b96eca4ccb86e95febfc920b35db01d38ffc42b96505a4f955fad", plan_hash: "05ed93b8aef4c47bf86c333ce779dd0e408692cadcf3e2e167af74a6b256a71f", plan: { authorized_external_requests: 0, execution_enabled: false, maximum_requests: 1 } });
    expect(polatClaudeCanaryPlan()).toMatchObject({ corpus_hash: "1afc425d131e4f3e7ee82976e034b703fffbd59bd388b6c1738a6617290d3630", plan_hash: "372b81b5017359aef85f3b4080c1ff7f6bf9193459c30a2505425fc5463066c5" });
  });
});

describe("OpenAI through existing three-reader gate and durable attempt contract, fake sockets", () => {
  it.each([
    ["x-client-request-id", "SYNTHETIC_PRIVATE_CLIENT", "CLIENT_ID"],
    ["openai-organization", "org-SYNTHETIC_PRIVATE_ORGANIZATION", "ORGANIZATION"],
    ["openai-project", "proj_SYNTHETIC_PRIVATE_PROJECT", "PROJECT"],
    ["content-type", "text/event-stream", "CONTENT_TYPE"],
  ])("keeps %s mismatches unknown while retaining only the failed check name", async (header, value, component) => {
    const s = fixture(); fake.headers[header] = value;
    const code = "OPENAI_UAT_RESPONSE_CORRELATION_INVALID_" + component;
    await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow(code);
    expect(s.outcomes[0]).toMatchObject({ status: "UNKNOWN", stage: "RESULT_UNKNOWN", error_code: code, qa: "NOT_EVALUATED", input_tokens: null, output_tokens: null, actual_billed_amount: null });
    expect(s.assess).not.toHaveBeenCalled(); expect(fake.calls).toHaveLength(1); expect(s.record).toHaveBeenCalledOnce();
    expect(JSON.stringify(s.outcomes)).not.toContain(value); expect(s.payload.reserved_liability).toBe("4.20768");
  });
  it.each([
    { header: "x-client-request-id", value: ["SYNTHETIC_PRIVATE_CLIENT"], component: "CLIENT_ID" },
    { header: "openai-organization", value: ["org-fixture"], component: "ORGANIZATION" },
    { header: "openai-project", value: ["proj_fixture"], component: "PROJECT" },
    { header: "content-type", value: ["application/json"], component: "CONTENT_TYPE" },
    { header: "content-type", value: undefined, component: "CONTENT_TYPE" },
  ])("continues holding non-scalar or absent required header metadata ($header)", async ({ header, value, component }) => {
    const s = fixture(); fake.headers[header] = value;
    await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow("OPENAI_UAT_RESPONSE_CORRELATION_INVALID_" + component);
    expect(s.outcomes[0]).toMatchObject({ status: "UNKNOWN", qa: "NOT_EVALUATED", actual_billed_amount: null }); expect(s.assess).not.toHaveBeenCalled(); expect(fake.calls).toHaveLength(1);
  });
  it("accepts exact optional echoes without making header metadata account authority", async () => {
    const s = fixture(); fake.headers = { "x-client-request-id": s.payload.attempt_id, "openai-organization": "org-fixture", "openai-project": "proj_fixture", "content-type": "application/json; charset=utf-8" };
    await s.service.provider.invoke(s.prepared.request);
    expect(s.outcomes[0]).toMatchObject({ status: "SUCCEEDED", qa: "APPROVED", actual_billed_amount: null }); expect(fake.calls).toHaveLength(1);
  });
  it("reserves and starts before credential use/network, then assesses the exact response", async () => {
    const s = fixture(), actual = await s.service.provider.invoke(s.prepared.request);
    expect(fake.calls).toHaveLength(1); expect(fake.calls[0]!.options).toMatchObject({ hostname: "api.openai.com", path: "/v1/responses", method: "POST", headers: { "OpenAI-Organization": "org-fixture", "OpenAI-Project": "proj_fixture", "x-client-request-id": s.payload.attempt_id } });
    expect(fake.timeline).toEqual(["reserve_committed", "start_committed", "credential", "network", "outcome_committed"]); expect(s.assess).toHaveBeenCalledWith(s.prepared.request, actual);
    expect(s.outcomes[0]).toMatchObject({ status: "SUCCEEDED", qa: "APPROVED", actual_billed_amount: null, financial_authority: "NONE" });
    expect(actual.usage).toEqual({ inputTokens: 37, outputTokens: 121, totalTokens: 158, billedAmount: null, billedCurrency: null }); expect(s.service.automatic_retries).toBe(0);
  });
  it("does not release any reserved liability or invent a bill when documented echo metadata is absent", async () => {
    const s = fixture(); fake.body = JSON.stringify(response({ service_tier: null, prompt_cache_options: null }));
    const actual = await s.service.provider.invoke(s.prepared.request);
    expect(actual.usage.billedAmount).toBeNull(); expect(s.reservation.liability).toBe("4.20768"); expect(s.payload.reserved_liability).toBe("4.20768");
    expect(s.outcomes[0]).toMatchObject({ status: "SUCCEEDED", actual_billed_amount: null, actual_billed_currency: null }); expect(fake.calls).toHaveLength(1);
  });
  it.each(["reported-balance", "project", "organization", "credential", "provider", "model", "stale", "spend", "unknown", "owner", "source", "sha"])("denies missing/mismatched %s before network", async change => {
    const s = fixture();
    if (change === "reported-balance") s.account.payload.effective_limit_kind = "REPORTED_BALANCE"; if (change === "project") s.account.payload.project_id = "proj_other"; if (change === "organization") s.account.payload.organization_id = "org-other"; if (change === "credential") s.account.payload.credential_sha256 = "0".repeat(64); if (change === "provider") s.account.payload.provider = "anthropic"; if (change === "model") s.account.payload.model = "gpt-6-luna"; if (change === "stale") s.account.payload.observed_at = new Date(s.now - 300001).toISOString(); if (change === "spend") s.account.payload.enforced_maximum_spend = "5.01"; if (change === "unknown") s.account.payload.unknown_outcome_count = 1; if (change === "owner") s.owner.aal = "aal1"; if (change === "source") s.account.payload.origin = "SYNTHETIC"; if (change === "sha") s.account.payload.repository_sha = "f".repeat(40);
    await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow(); expect(fake.calls).toHaveLength(0);
  });
  it("does not accept hand-written permit JSON or use an OpenAI permit against Anthropic", async () => {
    const s = fixture(); await expect(sendPolatOpenAIHttpsOnce({ kind: "AUTHENTICATED_POLAT_NETWORK_PERMIT", verified: true }, s.prepared.request)).rejects.toThrow("BLOCKED");
    const permit = await s.authority.issue({ binding: s.binding, run_id: s.payload.run_id, attempt_id: s.payload.attempt_id, request: s.prepared.request });
    await expect(sendPolatClaudeHttpsOnce(permit, s.prepared.request)).rejects.toThrow("PROVIDER_MISMATCH"); expect(() => requirePolatNetworkPermit(permit)).toThrow("BLOCKED"); expect(fake.calls).toHaveLength(0);
    expect(polatGenuineExecutionGate()).toMatchObject({ authorized_external_requests: 0, execution_enabled: false });
  });
  it("rejects binding budget/model/canary output drift without treating JSON as approval", async () => {
    const s = fixture();
    expect(await s.authority.preflight({ ...s.binding, maximum_spend: "5.01" })).toMatchObject({ state: "BLOCKED" });
    expect(await s.authority.preflight({ ...s.binding, model: "gpt-6-luna" })).toMatchObject({ state: "BLOCKED" });
    expect(await s.authority.preflight({ ...s.binding, verified: true })).toMatchObject({ state: "BLOCKED" });
    const binding = { ...s.binding, maximum_output_tokens: 511 }, hash = polatGuardDigest(binding); s.owner.binding_hash = hash; s.committed.binding_hash = hash; s.payload.binding_hash = hash;
    await expect(s.authority.issue({ binding, run_id: s.payload.run_id, attempt_id: s.payload.attempt_id, request: s.prepared.request })).rejects.toThrow(); expect(fake.calls).toHaveLength(0);
  });
  it("handles pre-dispatch abort and post-dispatch cancellation without retrying an unknown effect", async () => {
    const s = fixture(), before = new AbortController(); before.abort();
    const first = await s.authority.issue({ binding: s.binding, run_id: s.payload.run_id, attempt_id: s.payload.attempt_id, request: s.prepared.request });
    await expect(sendPolatOpenAIHttpsOnce(first, s.prepared.request, before.signal)).rejects.toThrow("ABORT_BEFORE_ATTEMPT"); expect(fake.calls).toHaveLength(0);
    const u = fixture(), after = new AbortController(); fake.stall = true;
    const second = await u.authority.issue({ binding: u.binding, run_id: u.payload.run_id, attempt_id: u.payload.attempt_id, request: u.prepared.request });
    const pending = sendPolatOpenAIHttpsOnce(second, u.prepared.request, after.signal); after.abort();
    await expect(pending).rejects.toThrow("ABORT_UNKNOWN"); expect(fake.calls).toHaveLength(1); await expect(sendPolatOpenAIHttpsOnce(second, u.prepared.request)).rejects.toThrow("BLOCKED"); expect(fake.calls).toHaveLength(1);
  });
  it("lets only the one durable reservation winner dispatch concurrent duplicate attempts", async () => {
    const s = fixture(); let claimed = false;
    s.reserve.mockImplementation(() => { const replay = claimed; claimed = true; return Promise.resolve({ ...s.reservation, replay }); });
    const both = await Promise.allSettled([s.service.provider.invoke(s.prepared.request), s.service.provider.invoke(s.prepared.request)]);
    expect(both.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(both.filter(result => result.status === "rejected")).toHaveLength(1); expect(fake.calls).toHaveLength(1); expect(s.begin).toHaveBeenCalledOnce();
  });
  it("keeps the actual unsafe text for QA and its held evidence, without substituting a safe draft", async () => {
    const s = fixture(), unsafe = polatClaudeFixtureWire(); unsafe.proposed_response = "Guaranteed profits."; unsafe.claims = [{ ...unsafe.claims[1]!, text: unsafe.proposed_response }];
    fake.body = JSON.stringify(response({ output: [{ ...response().output[0], content: [{ type: "output_text", text: JSON.stringify(unsafe) }] }] }));
    const actual = await s.service.provider.invoke(s.prepared.request); expect(actual.output.proposed_response).toBe("Guaranteed profits."); expect(s.assess).toHaveBeenCalledWith(s.prepared.request, actual); expect(s.outcomes[0]?.qa).toBe("HELD"); expect(fake.calls).toHaveLength(1);
  });
  it.each([401, 403, 429, 500, 302])("records HTTP %i once, without retry or raw provider error leakage", async status => {
    const s = fixture(); fake.status = status; fake.body = '{"error":{"message":"PRIVATE_PROMPT_SECRET"}}';
    await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow(/^OPENAI_UAT_/u); expect(fake.calls).toHaveLength(1); expect(s.record).toHaveBeenCalledOnce(); expect(JSON.stringify(s.outcomes)).not.toMatch(/PRIVATE_PROMPT|SYNTHETIC_OPENAI_CREDENTIAL/u);
  });
  it("holds missing usage and unknown connection results with their consumed budget", async () => {
    const s = fixture(); fake.body = JSON.stringify(response({ usage: null })); await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow("USAGE_UNAVAILABLE"); expect(s.outcomes[0]).toMatchObject({ qa: "HELD", input_tokens: null, output_tokens: null, actual_billed_amount: null });
    const u = fixture(); fake.disconnect = true; await expect(u.service.provider.invoke(u.prepared.request)).rejects.toThrow("CONNECTION_UNKNOWN"); expect(u.outcomes[0]).toMatchObject({ status: "UNKNOWN", stage: "RESULT_UNKNOWN" }); expect(fake.calls).toHaveLength(2);
  });
  it("marks actual timeout unknown, preserving exactly one attempt and zero retry", async () => {
    vi.useFakeTimers();
    try { const s = fixture(); fake.stall = true; const call = expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow("TIMEOUT_UNKNOWN"); await vi.advanceTimersByTimeAsync(10000); await call; expect(fake.calls).toHaveLength(1); expect(s.outcomes[0]?.status).toBe("UNKNOWN"); }
    finally { vi.useRealTimers(); }
  });
  it("does not dispatch a replayed reservation or unresolved result after a restart", async () => {
    const s = fixture(); s.reservation.replay = true; await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow("RESERVATION"); expect(fake.calls).toHaveLength(0);
    const u = fixture(); u.account.payload.unknown_outcome_count = 1; await expect(u.service.provider.invoke(u.prepared.request)).rejects.toThrow("PREFLIGHT"); expect(fake.calls).toHaveLength(0);
  });
  it("holds oversized/mismatched/partial actual output and never substitutes a fixture", async () => {
    for (const body of ["x".repeat(65537), JSON.stringify(response({ model: "gpt-6-luna" })), JSON.stringify(response({ status: "incomplete" }))]) {
      const s = fixture(); fake.body = body; await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow(/^OPENAI_UAT_/u); expect(s.outcomes[0]).toMatchObject({ status: "UNKNOWN", qa: "NOT_EVALUATED" }); expect(s.assess).not.toHaveBeenCalled();
    }
    expect(fake.calls).toHaveLength(3);
  });
});

describe("owner-only OpenAI local UAT, synthetic database and fake sockets", () => {
  it("keeps a complete canary reservation, scoped key/project and unknown actual billing", async () => {
    const s = ownerOnlyFixture();
    expect(await s.authority.preflight(s.binding)).toMatchObject({ state: "READY", financial_authority: "NONE" });
    const actual = await s.service.provider.invoke(s.prepared.request);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.options.headers).toMatchObject({ "OpenAI-Organization": "org-fixture", "OpenAI-Project": "proj_fixture" });
    expect(fake.timeline).toEqual(["reserve_committed", "start_committed", "credential", "network", "outcome_committed"]);
    expect(s.account).toMatchObject({ version: 3, local_reserved_liability: "4.20768", local_remaining_allowance: "0.79232", provider_billing: "UNKNOWN", provider_enforced_cap: "UNVERIFIED" });
    expect(actual.usage.billedAmount).toBeNull(); expect(s.outcomes[0]).toMatchObject({ qa: "APPROVED", actual_billed_amount: null, financial_authority: "NONE" });
    // Only the trusted durable journal may subsequently value successful usage.
    expect(await s.authority.preflight(s.binding)).toMatchObject({ state: "BLOCKED" });
    expect(s.service).toMatchObject({ automatic_retries: 0, automatic_fallbacks: 0, qa_regenerations: 0 });
  });
  it("admits founder scope using a server-derived canary result without claiming financial reconciliation", async () => {
    const s = ownerOnlyFixture(true);
    const actual = await s.service.provider.invoke(s.prepared.request);
    expect(fake.calls).toHaveLength(1); expect(actual.provider).toBe("openai");
    expect(s.account).toMatchObject({ provider_billing: "UNKNOWN", provider_enforced_cap: "UNVERIFIED", canary_result_hash: "7".repeat(64), local_reserved_liability: "4.209643" });
    expect(s.account).not.toHaveProperty("billing_evidence_hash"); expect(s.account).not.toHaveProperty("canary_reconciliation_hash"); expect(s.account).not.toHaveProperty("independently_observed_spend");
  });
  it("allows the owner's bounded 24-hour window while old account versions retain their five-minute requirement", async () => {
    const s = ownerOnlyFixture();
    s.account.observed_at = new Date(s.now - 3600000).toISOString(); s.account.expires_at = new Date(s.now + 3600000).toISOString();
    s.owner.expires_at = s.account.expires_at;
    expect(await s.authority.preflight(s.binding)).toMatchObject({ state: "READY" });
    const historical = fixture(); historical.account.payload.observed_at = s.account.observed_at; historical.account.payload.expires_at = s.account.expires_at;
    expect(await historical.authority.preflight(historical.binding)).toMatchObject({ state: "BLOCKED" });
  });
  it.each(["independent-origin", "reconciled", "enforced", "external-spend", "external-bill", "friends", "larger-cap"])("does not let owner-local evidence claim %s", change => {
    const s = ownerOnlyFixture(), changes: Record<string, unknown> = {};
    if (change === "independent-origin") changes.origin = "INDEPENDENT_ACCOUNT_CONTROL";
    if (change === "reconciled") changes.provider_billing = "RECONCILED";
    if (change === "enforced") changes.provider_enforced_cap = "VERIFIED";
    if (change === "external-spend") changes.independently_observed_spend = "0";
    if (change === "external-bill") changes.actual_billed_amount = "0";
    if (change === "friends") changes.scope = "FRIENDS";
    if (change === "larger-cap") changes.local_maximum_spend = "5.01";
    expect(polatPrivateBetaAccountEvidenceSchema.safeParse({ ...s.account, ...changes }).success).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
  it("requires version-three binding and control together, preserving the old account contract", async () => {
    const local = ownerOnlyFixture(), old = fixture();
    expect(await local.authority.preflight(old.binding)).toMatchObject({ state: "BLOCKED" });
    expect(await old.authority.preflight(local.binding)).toMatchObject({ state: "BLOCKED" });
    expect(polatPrivateBetaBindingSchema.safeParse({ ...local.binding, scope: "FRIENDS" }).success).toBe(false);
    expect(local.credentialRead).not.toHaveBeenCalled(); expect(old.credentialRead).not.toHaveBeenCalled();
  });
  it.each(["canary", "unknown", "owner-phase", "scope", "project", "organization", "credential", "owner-mfa", "sha", "manifest", "authorization", "custody", "model-access"])("holds missing or mismatched %s before founder dispatch", async change => {
    const s = ownerOnlyFixture(true);
    if (change === "canary") s.account.canary_result_hash = null;
    if (change === "unknown") s.account.unknown_outcome_count = 1;
    if (change === "owner-phase") s.owner.phase = "FRIENDS";
    if (change === "scope") s.account.account_scope_hash = "0".repeat(64);
    if (change === "project") s.account.project_id = "proj_other";
    if (change === "organization") s.account.organization_id = "org-other";
    if (change === "credential") s.account.credential_sha256 = "0".repeat(64);
    if (change === "owner-mfa") s.owner.aal = "aal1";
    if (change === "sha") s.account.repository_sha = "f".repeat(40);
    if (change === "manifest") s.account.manifest_hash = "0".repeat(64);
    if (change === "authorization") s.account.authorization_record_hash = "0".repeat(64);
    if (change === "custody") s.account.credential_custody_hash = "0".repeat(64);
    if (change === "model-access") Object.assign(s.account, { model_access: false });
    await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow(); expect(fake.calls).toHaveLength(0);
  });
  it.each(["overspent", "inconsistent", "insufficient", "stale", "too-long", "beyond-owner", "future"])("holds invalid local accounting or validity (%s)", async change => {
    const s = ownerOnlyFixture();
    if (change === "overspent") { s.account.local_reserved_liability = "5.01"; s.account.local_remaining_allowance = "0"; }
    if (change === "inconsistent") { s.account.local_reserved_liability = "1"; s.account.local_remaining_allowance = "5.00"; }
    if (change === "insufficient") { s.account.local_reserved_liability = "1"; s.account.local_remaining_allowance = "4"; }
    if (change === "stale") s.account.observed_at = new Date(s.now - 86400001).toISOString();
    if (change === "too-long") s.account.expires_at = new Date(s.now + 86400001).toISOString();
    if (change === "beyond-owner") s.account.expires_at = new Date(Date.parse(s.owner.expires_at) + 1).toISOString();
    if (change === "future") s.account.observed_at = new Date(s.now + 10000).toISOString();
    expect(await s.authority.preflight(s.binding)).toMatchObject({ state: "BLOCKED" }); expect(s.credentialRead).not.toHaveBeenCalled();
  });
  it.each(["friend", "reply-21", "global-351", "source", "attempt", "unreserved", "exposure-drift"])("denies committed attempt drift (%s) before credential use", async change => {
    const s = ownerOnlyFixture(true); await s.reserve();
    if (change === "friend") s.payload.scope = "FRIEND";
    if (change === "reply-21") s.payload.participant_ordinal = 21;
    if (change === "global-351") s.payload.global_ordinal = 351;
    if (change === "source") s.payload.source_message_id = "91cc9000-0000-4000-8000-000000000001";
    if (change === "attempt") s.committed.attempt_id = "91cc9000-0000-4000-8000-000000000001";
    if (change === "unreserved") { s.account.local_reserved_liability = "0.001963"; s.account.local_remaining_allowance = "4.998037"; }
    if (change === "exposure-drift") s.payload.reserved_liability = "4.21";
    await expect(s.authority.issue({ binding: s.binding, run_id: s.payload.run_id, attempt_id: s.payload.attempt_id, request: s.prepared.request })).rejects.toThrow();
    expect(s.credentialRead).not.toHaveBeenCalled(); expect(fake.calls).toHaveLength(0);
  });
  it("accepts founder reply twenty with the current reservation already charged to local exposure", async () => {
    const s = ownerOnlyFixture(true); s.payload.participant_ordinal = 20;
    await s.service.provider.invoke(s.prepared.request); expect(fake.calls).toHaveLength(1);
  });
  it.each(["missing-usage", "failed", "unknown", "qa-held"])("does not release local reserved exposure or invent billing after %s", async mode => {
    const s = ownerOnlyFixture();
    if (mode === "missing-usage") fake.body = JSON.stringify(response({ usage: null }));
    if (mode === "failed") fake.status = 401;
    if (mode === "unknown") fake.disconnect = true;
    if (mode === "qa-held") s.assess.mockReturnValue("HELD");
    await Promise.allSettled([s.service.provider.invoke(s.prepared.request)]);
    expect(fake.calls).toHaveLength(1); expect(s.account.local_reserved_liability).toBe("4.20768");
    expect(s.outcomes[0]).toMatchObject({ actual_billed_amount: null, actual_billed_currency: null });
    expect(await s.authority.preflight(s.binding)).toMatchObject({ state: "BLOCKED" });
  });
  it.each([
    null,
    { input_tokens: 0, output_tokens: 121, total_tokens: 121 },
    { input_tokens: 37, output_tokens: 0, total_tokens: 37 },
    { input_tokens: 1050001, output_tokens: 121, total_tokens: 1050122 },
  ])("holds observed missing/out-of-bounds usage before QA or delivery (%j)", async usage => {
    const s = ownerOnlyFixture(); fake.body = JSON.stringify(response({ usage }));
    await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow("POLAT_UAT_USAGE_BOUND_UNVERIFIED");
    expect(s.assess).not.toHaveBeenCalled(); expect(fake.calls).toHaveLength(1); expect(s.record).toHaveBeenCalledOnce();
    expect(s.outcomes[0]).toMatchObject({ stage: "RESULT_UNKNOWN", status: "UNKNOWN", qa: "NOT_EVALUATED", error_code: "POLAT_UAT_USAGE_BOUND_UNVERIFIED", actual_billed_amount: null });
    expect(s.account.local_reserved_liability).toBe("4.20768");
    expect(await s.authority.preflight(s.binding)).toMatchObject({ state: "BLOCKED" });
  });
});

describe("exact OpenAI liability is not billed cost", () => {
  const proof = () => ({ version: 2, origin: "INDEPENDENT_OFFICIAL_PRICING_READ", model: "gpt-6.1-sol", currency: "USD", source_url: "https://developers.openai.com/api/docs/pricing", source_hash: "8".repeat(64), maximum_input_tokens: 1050000, maximum_input_usd_per_million: "4", maximum_output_usd_per_million: "15", observed_at: new Date(Date.now() - 1).toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString(), all_billable_components_covered: true });
  it("reserves the full documented capacity and rounds monetary upper bounds upward", () => {
    const s = fixture(), wire = preparePolatOpenAIRequest(s.prepared.request, 512), input = { request_hash: wire.request_hash, body_hash: wire.body_hash, maximum_output_tokens: 512 };
    expect(boundPolatPrivateBetaWireLiability(input, proof()).maximum_possible_charge).toBe("4.20768");
    expect(() => boundPolatPrivateBetaWireLiability(input, { ...proof(), maximum_input_usd_per_million: "2", maximum_output_usd_per_million: "10" })).toThrow("PRICING_BOUND_UNVERIFIED");
    expect(boundPolatPrivateBetaWireLiability(input, { ...proof(), maximum_input_usd_per_million: "4.000000000000000001" }).maximum_possible_charge).toBe("4.207680000000000002");
    for (const extra of [{ all_billable_components_covered: false }, { maximum_input_tokens: 1000 }, { maximum_input_usd_per_million: "3.99" }, { maximum_output_usd_per_million: "14" }, { origin: "SYNTHETIC" }, { actual_billed_amount: "0" }]) expect(() => boundPolatPrivateBetaWireLiability(input, { ...proof(), ...extra })).toThrow();
  });
  it("labels conservative observed-usage valuation as an estimate while actual provider billing stays unknown", () => {
    const valued = estimatePolatOwnerOnlyOpenAIUsageLiability({ input_tokens: 37, output_tokens: 121, total_tokens: 158 }, proof());
    expect(valued).toMatchObject({ classification: "CONSERVATIVE_USAGE_ESTIMATE", estimated_liability: "0.001963", provider_billing: "UNKNOWN", actual_billed_amount: null, actual_billed_currency: null, financial_authority: "NONE" });
    expect(estimatePolatOwnerOnlyOpenAIUsageLiability({ input_tokens: 1, output_tokens: 1, total_tokens: 2 }, { ...proof(), maximum_input_usd_per_million: "4.000000000000000001" }).estimated_liability).toBe("0.000019000000000001");
  });
  it.each([null, { input_tokens: 0, output_tokens: 121, total_tokens: 121 }, { input_tokens: 37, output_tokens: null, total_tokens: 37 }, { input_tokens: 37, output_tokens: 513, total_tokens: 550 }, { input_tokens: 37, output_tokens: 121, total_tokens: 159 }, { input_tokens: 1050001, output_tokens: 1, total_tokens: 1050002 }])("rejects missing or invalid observed usage instead of releasing a reservation (%j)", usage => {
    expect(() => estimatePolatOwnerOnlyOpenAIUsageLiability(usage, proof())).toThrow();
  });
  it("requires current conservative pricing for the usage estimate", () => {
    const usage = { input_tokens: 37, output_tokens: 121, total_tokens: 158 };
    expect(() => estimatePolatOwnerOnlyOpenAIUsageLiability(usage, { ...proof(), maximum_input_usd_per_million: "2", maximum_output_usd_per_million: "10" })).toThrow("PRICING_BOUND_UNVERIFIED");
    expect(() => estimatePolatOwnerOnlyOpenAIUsageLiability(usage, { ...proof(), observed_at: new Date(Date.now() - 86400001).toISOString() })).toThrow("PRICING_STALE");
  });
});


describe("OpenAI optional display metadata compatibility, fake sockets only", () => {
  it.each(["genesis", "user-legacy-account", "Organization display name"])("accepts %s as non-authoritative display metadata", async organization => {
    const s = fixture(); fake.headers["openai-organization"] = organization; fake.headers["openai-project"] = "Default project";
    const actual = await s.service.provider.invoke(s.prepared.request);
    expect(actual).toMatchObject({ provider: "openai", model: "gpt-6.1-sol" });
    expect(fake.calls).toHaveLength(1); expect(fake.calls[0]!.options.headers).toMatchObject({ "OpenAI-Organization": "org-fixture", "OpenAI-Project": "proj_fixture" });
    expect(s.outcomes[0]).toMatchObject({ qa: "APPROVED", actual_billed_amount: null });
    expect(JSON.stringify(s.outcomes)).not.toContain(organization);
  });
  it.each(["", "x".repeat(257), "invalid\nmetadata"])("holds malformed display metadata without QA or a retry", async organization => {
    const s = fixture(); fake.headers["openai-organization"] = organization;
    await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow("CORRELATION_INVALID_ORGANIZATION");
    expect(s.assess).not.toHaveBeenCalled(); expect(fake.calls).toHaveLength(1);
    expect(s.outcomes[0]).toMatchObject({ status: "UNKNOWN", actual_billed_amount: null });
  });
});
