import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POLAT_CLAUDE_MODEL, POLAT_CLAUDE_ADAPTER_VERSION, POLAT_MODEL_STOP_CONDITIONS, polatOfflineClaudeObservationSchema, type PolatGuardPolicy } from "@gold-revenue-os/contracts";
import { preparePolatClaudeRequest, decodePolatClaudeResponse, createPolatClaudeOfflineProvider, polatClaudeRealExecutionReadiness } from "./polat-claude-adapter";
import { parsePolatClaudeJson } from "./polat-claude-json";
import { preparePolatConversation, POLAT_PROFILE, PolatFixtureProvider } from "./polat-conversation";
import * as conversation from "./polat-conversation";
import { polatFixture } from "./polat-conversation.fixtures";
import { emptyPolatModelDecisionFields, polatModelDecisionHash, polatModelAcceptanceManifest } from "./polat-model-acceptance";
import { createPolatClaudeOfflineTransport, createPolatOfflineTransport, openPolatOfflineExperiment, polatClaudeOfflineTransportEvidence, polatGuardInvocationTargets, polatOfflineTransportCalls } from "./polat-experiment-guard";
import { requestFingerprint } from "./agent-runtime";
import { canonicalFinancialJson } from "./financial-source-canonical";

const roots: string[] = [];
const reply = "Hi! I'm Polat's AI assistant. What would you like to know?";
function wire() { return {
  classification: "GREETING", semantic_response: { response_goal: "Respond to the greeting", key_points: ["Hi!", "I'm Polat's AI assistant.", "What would you like to know?"], factual_grounding: { classification: "unknown", evidence_refs: ["EVIDENCE_COMMERCIAL_1"], missing_information: ["approved_scoped_fact"] } },
  proposed_response: reply, confidence: 0.7, escalation_recommended: false, escalation_category: null,
  claims: [
    { text: "Hi!", kind: "social", speech_act: "ACKNOWLEDGEMENT", capability: null, grounding: "GENERAL_SAFE_STATEMENT", evidence_refs: [], action_category: null },
    { text: "I'm Polat's AI assistant.", kind: "fact", speech_act: "BUSINESS_FACT", capability: null, grounding: "KNOWN_FROM_SYSTEM", evidence_refs: ["EVIDENCE_COMMERCIAL_1"], action_category: null },
    { text: "What would you like to know?", kind: "question", speech_act: "QUESTION", capability: null, grounding: "UNKNOWN", evidence_refs: [], action_category: null },
  ], memory_proposals: [], proposed_tool_calls: [],
}; }
function envelope(extra: Record<string, unknown> = {}) { return { id: "msg_offline_001", type: "message", role: "assistant", model: POLAT_CLAUDE_MODEL, stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify(wire()), citations: null }], usage: { input_tokens: 37, output_tokens: 121, cache_creation_input_tokens: 8, cache_read_input_tokens: 4 }, ...extra }; }
function config(extra: Record<string, unknown> = {}) { return { adapter_version: POLAT_CLAUDE_ADAPTER_VERSION, model: POLAT_CLAUDE_MODEL, maximum_output_tokens: 512, timeout_ms: 100, frame: { kind: "HTTP", status: 200, body: JSON.stringify(envelope()) }, ...extra }; }
const request = () => preparePolatConversation(polatFixture("Hi", "en")).request;
const cost = () => ({ amount: "0.001", currency: "USD", basis: "SIMULATED_RECONCILED_BILLING", evidence_hash: "7".repeat(64) });
/** These are invented fixture references, not genuine owner/account verification. */
function setup(limit = 3, budget = "0.06") {
  const evidence = () => ({ reference: "fixture-only-evidence", sha256: "1".repeat(64) }), fields = emptyPolatModelDecisionFields();
  Object.assign(fields, { provider: "anthropic", model: POLAT_CLAUDE_MODEL, model_version: POLAT_CLAUDE_MODEL, provider_account_ref: "fixture-account", approved_repository_sha: "a".repeat(40), monitoring_owner_ref: "fixture-monitor" });
  fields.data_policy = { region: "fixture-region", retention_terms: evidence(), training_terms: evidence(), data_handling_approval: evidence() };
  fields.custody = { protected_secret_reference: "fixture-no-credential", access_policy: evidence(), authorized_role_refs: ["fixture-operator"] };
  fields.budget = { maximum_requests: 290, currency: "USD", maximum_decimal_spend: budget, pricing_evidence: evidence(), cap_enforcement_evidence: evidence() };
  fields.billing = { usage_provenance: evidence(), billing_provenance: evidence(), incomplete_usage_handling: "STOP_AND_RECONCILE_UNKNOWN_COST" };
  fields.reviewers = [1, 2].map(n => ({ id: `71f01000-0000-4000-8000-00000000000${n}`, identity_evidence: { reference: `fixture-human-${n}`, sha256: String(n).repeat(64) } }));
  fields.review_manifest.approval = evidence();
  fields.thresholds = { latency_p95_max_ms: 1000, errors_max_basis_points: 0, qa_holds_max_basis_points: 0, handoff_evidence_required: true, cost_coverage_required_basis_points: 10000, human_dimension_minimum: 3, human_mean_minimum: 4, critical_safety_failures_max: 0 };
  fields.stop_conditions = [...POLAT_MODEL_STOP_CONDITIONS]; fields.recovery_plan = evidence(); fields.rollback_plan = evidence();
  const manifest = { version: 2, fields, owner_authorization: { record_reference: "SIMULATED-NOT-AUTHORIZATION", approved_by_ref: "fixture-owner", approved_at: "2026-10-25T00:00:00Z", proposal_hash: polatModelDecisionHash(fields), decision: "AUTHORIZE_CONTROLLED_SYNTHETIC_MODEL_TEST" } };
  const policy: PolatGuardPolicy = { version: 2, mode: "OFFLINE_SYNTHETIC", repository_sha: fields.approved_repository_sha!, manifest_hash: manifest.owner_authorization.proposal_hash, corpus_version: fields.corpus_version, corpus_hash: fields.corpus_hash, provider: "anthropic", model: POLAT_CLAUDE_MODEL, model_version: POLAT_CLAUDE_MODEL, profile_version: POLAT_PROFILE.version, adapter_version: POLAT_CLAUDE_ADAPTER_VERSION, maximum_output_tokens: 512, account_state: "SIMULATED_ENFORCED", account_cap_evidence_hash: "1".repeat(64), account_cap_amount: budget, policy_evidence_hash: "1".repeat(64), valid_until: new Date(Date.now() + 600000).toISOString(), simulation_request_limit: limit, timeout_ms: 100, maximum_attempt_liability: "0.02", currency: "USD", financial_authority: "NONE", live_operations_authorized: false, authorized_external_requests: 0, execution_enabled: false };
  const root = mkdtempSync(join(tmpdir(), "polat-claude-")); roots.push(root);
  return { manifest, policy, directory: join(root, "journal") };
}
const target = () => polatGuardInvocationTargets()[0]!.target_hash;
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); });

describe("isolated Claude Messages codec / no network", () => {
  it("uses documented wire parameters, exact model, output cap and handles without database identity", () => {
    const r = request(), p = preparePolatClaudeRequest(r, 512), text = JSON.stringify(p.body);
    expect(p.body.model).toBe(POLAT_CLAUDE_MODEL); expect(p.body.max_tokens).toBe(512); expect(p.api_version).toBe("2023-06-01");
    for (const field of ["temperature", "top_p", "top_k", "thinking", "tools", "metadata"]) expect(p.body).not.toHaveProperty(field);
    expect(p.body.stream).toBe(false); expect(p.body.output_config.format.type).toBe("json_schema");
    expect(text).not.toContain(r.context.tenantId); expect(text).not.toContain(r.context.conversationId); expect(text).not.toContain(r.context.recentMessages[0]!.id);
    expect(text).toContain("EVIDENCE_CURRENT_MESSAGE"); expect(text).toContain("Polat's AI assistant");
  });
  it("retains bounded multi-turn content and explicit customer language without operator locale", () => {
    const r = request(); r.context.recentMessages=[{ id: "61a04000-0000-4000-8000-000000000002", direction: "inbound", content: "Tercihim XAUUSD", occurredAt: "2026-10-23T00:00:00Z" },...r.context.recentMessages];
    const s = JSON.stringify(preparePolatClaudeRequest(r, 512).body); expect(s).toContain("Tercihim XAUUSD"); expect(s).toContain('Hi'); expect(s).toContain('"language\\":\\"en');
  });
  it("decodes the actual text and resolves server-owned evidence, retaining nullable billing/total", async () => {
    const p = createPolatClaudeOfflineProvider(config()), r = await p.provider.invoke(request());
    expect(r.output.proposed_response).toBe(reply); expect(r.provider).toBe("anthropic"); expect(r.model).toBe(POLAT_CLAUDE_MODEL); expect(r.providerRequestId).toBe("msg_offline_001");
    expect(r.output.claims[1]!.evidence_refs).toEqual(["polat:identity:v1"]); expect(r.usage).toEqual({ inputTokens: 37, outputTokens: 121, totalTokens: null, billedAmount: null, billedCurrency: null });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0); expect(p.evidence().provider_usage?.cache_read_input_tokens).toBe(4); expect(p.evidence().calls).toBe(1);
  });
  it("preserves missing usage as null without guessing from text", async () => { const p = createPolatClaudeOfflineProvider(config({ frame: { kind: "HTTP", status: 200, body: JSON.stringify(envelope({ usage: null })) } })); const r = await p.provider.invoke(request()); expect(Object.values(r.usage)).toEqual([null, null, null, null, null]); expect(p.evidence().provider_usage).toBeNull(); });
  it("does not expose thinking or signatures in normalized response/evidence", async () => { const p = createPolatClaudeOfflineProvider(config({ frame: { kind: "HTTP", status: 200, body: JSON.stringify(envelope({ content: [{ type: "thinking", thinking: "PRIVATE_SYNTHETIC_REASONING", signature: "PRIVATE_SIGNATURE" }, ...envelope().content] })) } })); const r = await p.provider.invoke(request()); expect(JSON.stringify([r,p.evidence()])).not.toContain("PRIVATE_SYNTHETIC"); expect(JSON.stringify([r,p.evidence()])).not.toContain("PRIVATE_SIGNATURE"); });
  it.each(["max_tokens", "tool_use", "pause_turn", "refusal", "stop_sequence"])("rejects partial or unsupported stop %s", stop_reason => { expect(() => decodePolatClaudeResponse(JSON.stringify(envelope({ stop_reason })), request(), 512)).toThrow("PARTIAL_OR_UNSUPPORTED"); });
  it.each(["other-model", "claude-haiku-5-5-latest"])("rejects model mismatch %s", model => { expect(() => decodePolatClaudeResponse(JSON.stringify(envelope({ model })), request(), 512)).toThrow("ENVELOPE_INVALID"); });
  it.each(["{}", "not json", '{"id":"x","id":"y"}', '"' + 'x'.repeat(65537) + '"'])("rejects malformed/bounded envelope %#", raw => { expect(() => decodePolatClaudeResponse(raw, request(), 512)).toThrow(); });
  it("rejects wrong role/id, multiple texts, unknown blocks, usage overflow and excess output tokens", () => {
    for (const e of [envelope({ id: "not-message" }),envelope({ role: "user" }),envelope({ content: [envelope().content[0],envelope().content[0]] }),envelope({ content: [{ type: "tool_use", input: {} }] }),envelope({ usage: { input_tokens: -1, output_tokens: 1 } }),envelope({ usage: { input_tokens: 1, output_tokens: 513 } })]) expect(() => decodePolatClaudeResponse(JSON.stringify(e),request(),512)).toThrow();
  });
  it("rejects unknown evidence, outbound-only customer proof and executable proposals", () => {
    const a=wire();a.claims[1]!.evidence_refs=["foreign-tenant-reference"];
    expect(()=>decodePolatClaudeResponse(JSON.stringify(envelope({content:[{type:"text",text:JSON.stringify(a)}]})),request(),512)).toThrow();
    const b=wire(); const injected={...b,proposed_tool_calls:[{name:"payment.confirmed",version:1,arguments:{}}]};
    expect(()=>decodePolatClaudeResponse(JSON.stringify(envelope({content:[{type:"text",text:JSON.stringify(injected)}]})),request(),512)).toThrow("SCHEMA_INVALID");
  });
  it.each([0,4097,1.5,NaN])("denies invalid output ceiling %s before a call", n=>{expect(()=>preparePolatClaudeRequest(request(),n)).toThrow();});
  it("rejects rewrites, human control, stale schema and secret-marked context", () => {
    for(const change of [r=>{r.outputSchemaVersion=3;},r=>{r.context.runtimeMode="HUMAN_TAKEOVER";},r=>{r.context.profile={authorization:"SYNTHETIC-PRIVATE"};}] as Array<(r:ReturnType<typeof request>)=>void>){const r=request();change(r);expect(()=>preparePolatClaudeRequest(r,512)).toThrow();}
    const r=request(); r.rewriteFeedback={scores:{} as never,reasons:[],attempt:1};expect(()=>preparePolatClaudeRequest(r,512)).toThrow("PLAN_DENIED");
  });
  it.each([[401,"CLAUDE_AUTH_DENIED"],[403,"CLAUDE_AUTH_DENIED"],[429,"CLAUDE_RATE_LIMIT"],[500,"CLAUDE_HTTP_ERROR"],[529,"CLAUDE_HTTP_ERROR"],[504,"CLAUDE_TIMEOUT_UNKNOWN"]])("maps HTTP %s without retry or reflected raw errors", async(status,code)=>{
    const fetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("EXTERNAL_REQUEST_FORBIDDEN"));
    const p=createPolatClaudeOfflineProvider(config({frame:{kind:"HTTP",status,body:'RAW_PRIVATE_PROMPT_AND_CREDENTIAL',retry_after_ms:25}}));
    await expect(p.provider.invoke(request())).rejects.toMatchObject({code,retryable:false});expect(p.evidence().calls).toBe(1);expect(fetch).not.toHaveBeenCalled();
  });
  it("handles a monotonic timeout and abort; late frames cannot change evidence", async()=>{
    vi.useFakeTimers();const p=createPolatClaudeOfflineProvider(config({timeout_ms:5,frame:{kind:"HTTP",status:200,body:JSON.stringify(envelope()),delay_ms:100,ignore_abort:true}}));
    const pending=expect(p.provider.invoke(request())).rejects.toMatchObject({kind:"TIMEOUT",outcome_unknown:true,retryable:false});await vi.advanceTimersByTimeAsync(6);await pending;await vi.runAllTimersAsync();expect(p.evidence().calls).toBe(1);expect(p.evidence().response_hash).toBeNull();
  });
  it("honors explicit AbortSignal and pre-abort without a fake successful result", async()=>{
    const p=createPolatClaudeOfflineProvider(config({frame:{kind:"HTTP",status:200,body:JSON.stringify(envelope()),delay_ms:10}})),c=new AbortController();const pending=p.provider.invoke(request(),c.signal);c.abort();await expect(pending).rejects.toMatchObject({code:"CLAUDE_ABORT_UNKNOWN",retryable:false});
    const p2=createPolatClaudeOfflineProvider(config());await expect(p2.provider.invoke(request(),c.signal)).rejects.toThrow("BEFORE_ATTEMPT");expect(p2.evidence().calls).toBe(0);
  });
  it("rejects repeated/concurrent identical invocation rather than automatically retrying", async()=>{const p=createPolatClaudeOfflineProvider(config());const a=p.provider.invoke(request());await expect(p.provider.invoke(request())).rejects.toThrow("REPLAY_DENIED");await a;expect(p.evidence().calls).toBe(1);});
  it("denies overlapping different requests and clears prior usage before an unknown attempt",async()=>{const p=createPolatClaudeOfflineProvider(config({frame:{kind:"HTTP",status:200,body:JSON.stringify(envelope()),delay_ms:10}})),a=p.provider.invoke(request()),second=request();second.requestId="second-fixture-request";await expect(p.provider.invoke(second)).rejects.toThrow("CONCURRENT_DENIED");await a;expect(p.evidence().provider_usage?.input_tokens).toBe(37);const c=new AbortController(),pending=p.provider.invoke(second,c.signal);c.abort();await expect(pending).rejects.toThrow("ABORT_UNKNOWN");expect(p.evidence().calls).toBe(2);expect(p.evidence().provider_usage).toBeNull();expect(p.evidence().response_hash).toBeNull();});
  it("handles nonfinancial fractions without changing exact financial canonical rules",()=>{expect(parsePolatClaudeJson('{"confidence":0.7}')).toEqual({confidence:0.7});expect(()=>canonicalFinancialJson({amount:0.7})).toThrow();for(const raw of ['{"a":1,"\\u0061":2}','{"__proto__":{}}','{"n":1e400}','{"n":9007199254740993}','{"a":1,}'])expect(()=>parsePolatClaudeJson(raw)).toThrow();});
  it("does not accept credentials, callbacks, alternate models or a forged approval as execution",()=>{for(const extra of [{apiKey:"NOT-A-CREDENTIAL"},{fetchImpl:()=>{}},{model:"other-model"},{execution_enabled:true}])expect(()=>createPolatClaudeOfflineProvider({...config(),...extra})).toThrow();expect(polatClaudeRealExecutionReadiness().state).toBe("BLOCKED");expect(polatModelAcceptanceManifest().execution_enabled).toBe(false);});
});

describe("Claude fake transport through the accepted accounting journal and QA",()=>{
  it("reuses the journal and actual native QA without invoking the safe fixture provider",async()=>{
    const s=setup(),g=openPolatOfflineExperiment({...s,create:true}),p=createPolatClaudeOfflineTransport(target(),config(),cost());
    const fixture=vi.spyOn(PolatFixtureProvider.prototype,"invoke");const qa=vi.spyOn(conversation,"assessPolatDraft");
    const pending=g.attempt(p,s.policy,p.request_hash);
    const inFlight=readFileSync(join(s.directory,"evidence.jsonl"),"utf8");expect(inFlight).toContain('"kind":"RESERVED"');expect(inFlight).not.toContain('"kind":"RESULT"');
    const result=await pending;expect(result.observation?.qa).toBe("APPROVED");expect(result.disposition).toBe("RECORDED");expect(result.response?.output.proposed_response).toBe(reply);expect(qa.mock.calls[0]![1]).toMatchObject({proposed_response:reply});expect(fixture).not.toHaveBeenCalled();
    expect(result.observation).toMatchObject({version:2,source:"OFFLINE_CLAUDE_HTTP",provider:"anthropic",model:POLAT_CLAUDE_MODEL,real_model_execution:false,retry:"NONE"});expect(result.summary.actual_billed_cost).toBeNull();expect(polatClaudeOfflineTransportEvidence(p).calls).toBe(1);g.close();
  });
  it("keeps unknown actual billing unknown and stops despite tokens or a valid response",async()=>{const s=setup(),g=openPolatOfflineExperiment({...s,create:true}),p=createPolatClaudeOfflineTransport(target(),config());const r=await g.attempt(p,s.policy,p.request_hash);expect(r.summary.reason).toBe("BILLING_UNKNOWN");expect(r.observation?.qa).toBe("APPROVED");expect(r.observation?.usage.total_tokens).toBeNull();expect(r.observation?.billing).toBeNull();expect(r.response).toBeNull();expect(r.summary.simulated_reserved_liability).toBe("0.02");g.close();});
  it("persists replay prevention across reopen under a stable run and binding",async()=>{const s=setup(),g=openPolatOfflineExperiment({...s,create:true}),p=createPolatClaudeOfflineTransport(target(),config(),cost());await g.attempt(p,s.policy,p.request_hash);g.close();const resumed=openPolatOfflineExperiment(s),again=createPolatClaudeOfflineTransport(target(),config(),cost());const r=await resumed.attempt(again,s.policy,again.request_hash);expect(r.disposition).toBe("ALREADY_RECORDED");expect(polatOfflineTransportCalls(again)).toBe(0);resumed.close();});
  it("counts a failed start against lifetime request budget with no hidden retries",async()=>{const s=setup(1);s.manifest.fields.thresholds.errors_max_basis_points=10000;s.manifest.owner_authorization.proposal_hash=polatModelDecisionHash(s.manifest.fields);s.policy.manifest_hash=s.manifest.owner_authorization.proposal_hash;const g=openPolatOfflineExperiment({...s,create:true}),p=createPolatClaudeOfflineTransport(target(),config({frame:{kind:"HTTP",status:429,body:""}}),cost());const r=await g.attempt(p,s.policy,p.request_hash);expect(r.summary.attempts).toBe(1);expect(r.observation?.retry).toBe("NONE");const other=createPolatClaudeOfflineTransport(polatGuardInvocationTargets()[1]!.target_hash,config(),cost());expect((await g.attempt(other,s.policy,other.request_hash)).summary.reason).toBe("REQUEST_LIMIT_REACHED");expect(polatOfflineTransportCalls(other)).toBe(0);g.close();});
  it("stops unknown outcomes and retains obligations across restart",async()=>{const s=setup(),g=openPolatOfflineExperiment({...s,create:true}),p=createPolatClaudeOfflineTransport(target(),config({frame:{kind:"CONNECTION_LOST",status:200,body:""}}));const r=await g.attempt(p,s.policy,p.request_hash);expect(r.summary.reason).toBe("RESULT_UNKNOWN");expect(r.summary.simulated_reserved_liability).toBe("0.02");g.close();const resumed=openPolatOfflineExperiment(s),other=createPolatClaudeOfflineTransport(target(),config(),cost());await resumed.attempt(other,s.policy,other.request_hash);expect(polatOfflineTransportCalls(other)).toBe(0);resumed.close();});
  it("denies concurrent guard attempts and persists one request",async()=>{const s=setup(),g=openPolatOfflineExperiment({...s,create:true}),p=createPolatClaudeOfflineTransport(target(),config({frame:{kind:"HTTP",status:200,body:JSON.stringify(envelope()),delay_ms:10}}),cost());const pending=g.attempt(p,s.policy,p.request_hash);await expect(g.attempt(p,s.policy,p.request_hash)).rejects.toThrow("CLOSED_OR_BUSY");await pending;expect(g.summary().attempts).toBe(1);g.close();});
  it.each(["maximum_output_tokens","timeout_ms"]as const)("rejects adapter %s drift before dispatch",async key=>{const s=setup(),g=openPolatOfflineExperiment({...s,create:true}),p=createPolatClaudeOfflineTransport(target(),config({[key]:key==="timeout_ms"?50:256}),cost());const r=await g.attempt(p,s.policy,p.request_hash);expect(r.summary.reason).toBe("POLICY_DRIFT");expect(polatOfflineTransportCalls(p)).toBe(0);g.close();});
  it("rejects fixture-provider interchange, model/corpus/account drift and forged live fields",async()=>{const s=setup(),g=openPolatOfflineExperiment({...s,create:true}),fixture=createPolatOfflineTransport(target());expect((await g.attempt(fixture,s.policy,fixture.request_hash)).summary.reason).toBe("POLICY_DRIFT");g.close();for(const change of [{corpus_hash:"0".repeat(64)},{model_version:"other-model"},{account_state:"UNKNOWN"},{execution_enabled:true}]){const x=setup();expect(()=>openPolatOfflineExperiment({...x,policy:{...x.policy,...change},create:true})).toThrow();}});
  it("reserves exact liability and stops before a second attempt exceeds the budget",async()=>{const s=setup(2,"0.02"),g=openPolatOfflineExperiment({...s,create:true}),p=createPolatClaudeOfflineTransport(target(),config(),{...cost(),amount:"0.02"});await g.attempt(p,s.policy,p.request_hash);const next=createPolatClaudeOfflineTransport(polatGuardInvocationTargets()[1]!.target_hash,config(),cost());expect((await g.attempt(next,s.policy,next.request_hash)).summary.reason).toBe("BUDGET_EXHAUSTED");expect(polatOfflineTransportCalls(next)).toBe(0);g.close();});
  it("runs unsafe actual response through QA and never substitutes an approved draft",async()=>{const unsafe="I have verified your payment and activated VIP access.",w=wire();w.proposed_response=unsafe;w.claims=[{...w.claims[1]!,text:unsafe,kind:"completed_action",speech_act:"COMPLETED_ACTION",grounding:"UNSUPPORTED_CLAIM",evidence_refs:[]}];const s=setup(),g=openPolatOfflineExperiment({...s,create:true}),p=createPolatClaudeOfflineTransport(target(),config({frame:{kind:"HTTP",status:200,body:JSON.stringify(envelope({content:[{type:"text",text:JSON.stringify(w)}]}))}}),cost());const qa=vi.spyOn(conversation,"assessPolatDraft");const r=await g.attempt(p,s.policy,p.request_hash);expect(qa.mock.calls[0]![1]).toMatchObject({proposed_response:unsafe});expect(r.observation?.qa).toBe("HELD");expect(r.summary.reason).toBe("QA_REVIEW_REQUIRED");expect(r.response).toBeNull();expect(polatOfflineTransportCalls(p)).toBe(1);g.close();});
  it("rejects a reused response identity for a different reserved request",async()=>{const s=setup(),g=openPolatOfflineExperiment({...s,create:true}),a=createPolatClaudeOfflineTransport(target(),config(),cost());await g.attempt(a,s.policy,a.request_hash);const b=createPolatClaudeOfflineTransport(polatGuardInvocationTargets()[1]!.target_hash,config(),cost());const r=await g.attempt(b,s.policy,b.request_hash);expect(r.summary.attempts).toBe(2);expect(r.summary.reason).toBe("RESPONSE_ID_REUSE");expect(r.response).toBeNull();expect(polatOfflineTransportCalls(b)).toBe(1);g.close();});
  it("rejects prompt version drift and keeps unchanged exact wire hashes stable",()=>{const r=request(),a=preparePolatClaudeRequest(r,512);expect(preparePolatClaudeRequest(r,512).body_hash).toBe(a.body_hash);expect(preparePolatClaudeRequest(r,256).body_hash).not.toBe(a.body_hash);Object.assign(r,{versions:{...r.versions!,prompt:"stale-prompt"}});expect(()=>preparePolatClaudeRequest(r,512)).toThrow("VERSION_DRIFT");});
  it("stores hashes/counters only and never logs raw prompt, response, scope or credentials",async()=>{const logs=[vi.spyOn(console,"log"),vi.spyOn(console,"error"),vi.spyOn(console,"warn")],s=setup(),g=openPolatOfflineExperiment({...s,create:true}),p=createPolatClaudeOfflineTransport(target(),config(),cost());await g.attempt(p,s.policy,p.request_hash);g.close();const journal=readFileSync(join(s.directory,"evidence.jsonl"),"utf8");for(const raw of [reply,"systemPolicy","fixture-no-credential","msg_offline_001","61a02000-"])expect(journal).not.toContain(raw);logs.forEach(l=>expect(l).not.toHaveBeenCalled());});
  it("keeps independent authorization/account/durability blocked even for complete fake manifest",()=>{const s=setup();expect(polatClaudeRealExecutionReadiness(s.manifest)).toMatchObject({state:"BLOCKED",execution_enabled:false,real_model_execution:false,authorized_external_requests:0,independent_owner_authority:"NOT_VERIFIED",durable_run_custody:"NOT_VERIFIED",account_access_and_hard_cap:"UNKNOWN"});expect(()=>polatOfflineClaudeObservationSchema.parse({financial_authority:"LIVE"})).toThrow();expect(requestFingerprint(request())).toMatch(/^[a-f0-9]{64}$/u);});
  it("retains the original unsupported claim metadata as HELD instead of relabelling it",async()=>{const w=wire();w.claims[1]!.speech_act="IDENTITY_RESPONSE";const s=setup(),g=openPolatOfflineExperiment({...s,create:true}),p=createPolatClaudeOfflineTransport(target(),config({frame:{kind:"HTTP",status:200,body:JSON.stringify(envelope({content:[{type:"text",text:JSON.stringify(w)}]}))}}),cost());const qa=vi.spyOn(conversation,"assessPolatDraft"),r=await g.attempt(p,s.policy,p.request_hash);expect(qa.mock.calls[0]![1]).toMatchObject({claims:w.claims.map((c,i)=>({...c,evidence_refs:i===1?["polat:identity:v1"]:c.evidence_refs}))});expect(r.observation?.qa).toBe("HELD");expect(r.summary.reason).toBe("QA_REVIEW_REQUIRED");expect(r.response).toBeNull();g.close();});
});
