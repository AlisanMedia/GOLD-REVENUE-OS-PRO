import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest, ModelResponse } from "../../packages/domain/src/agent-runtime";
import { decodeJeffClaudeResponse } from "../../packages/domain/src/jeff-claude-adapter";
import { jeffClaudeCompleteEnvelope, jeffClaudeFixtureWire } from "../helpers/jeff-bridge-fixtures";
import { jeffClaudeCanaryPlan } from "../../packages/domain/src/jeff-claude-canary";
import { jeffOpenAICanaryPlan } from "../../packages/domain/src/jeff-openai-canary";
import { decodeJeffOpenAIResponse } from "../../packages/domain/src/jeff-openai-adapter";
import { jeffGenuineExecutionGate } from "../../packages/domain/src/jeff-experiment-execution-gate";

const state = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), factory: vi.fn(), calls: 0, fail: false, wire: null as unknown, request: null as ModelRequest | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getUserContext: state.auth }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/jeff/private-beta-canary", () => import("../../apps/web/src/lib/jeff/private-beta-canary"));
vi.mock("../../apps/web/src/lib/jeff/private-beta-provider", () => ({ createPrivateBetaProviderFromDatabase: state.factory }));
import { POST } from "../../apps/web/src/app/api/v1/admin/private-beta/canary/route";

const tenant = "93be1000-0000-4000-8000-000000000001", program = "93be2000-0000-4000-8000-000000000001", attempt = "93be3000-0000-4000-8000-000000000001", sha = "a".repeat(40);
const request = (body = "program_id=" + program, type = "application/x-www-form-urlencoded", origin = "https://fixture.invalid") => new Request("https://fixture.invalid/api/v1/admin/private-beta/canary", { method: "POST", headers: { origin, "content-type": type }, body });

beforeEach(() => {
  vi.clearAllMocks(); state.calls = 0; state.fail = false; state.wire = null; state.request = null; vi.stubEnv("JEFF_UAT_RELEASE_SHA", sha);
  state.auth.mockResolvedValue({ user: { id: "private-owner-fixture" }, tenants: [{ id: tenant, role: "super_admin" }] });
  state.rpc.mockResolvedValue({ data: { program_id: program, tenant_id: tenant, stage: "CANARY", repository_sha: sha }, error: null });
  state.factory.mockImplementation(async (input: { assess: (request: ModelRequest, response: ModelResponse) => "APPROVED" | "HELD" }) => {
    let evidence: unknown = null;
    return { provider: { async invoke(inputRequest: ModelRequest) {
      state.calls++; state.request = inputRequest; if (state.fail) throw Error("SYNTHETIC_SECRET_MUST_NOT_ESCAPE");
      const decoded = decodeJeffClaudeResponse(JSON.stringify(jeffClaudeCompleteEnvelope({ content: [{ type: "text", text: JSON.stringify(state.wire ?? jeffClaudeFixtureWire()), citations: null }] })), inputRequest, 512);
      const response: ModelResponse = { provider: "anthropic", model: "claude-haiku-5-5", providerRequestId: decoded.providerRequestId, output: decoded.output, evidenceResolution: decoded.evidenceResolution, latencyMs: 12.5, usage: { inputTokens: 37, outputTokens: 121, totalTokens: null, billedAmount: null, billedCurrency: null } };
      const qa = await input.assess(inputRequest, response);
      evidence = { attempt_id: attempt, outcome: { qa, response_hash: decoded.response_hash, elapsed_ms: "12.500000" } };
      return response;
    } }, evidence: () => evidence };
  });
});

describe("authenticated single-request canary entrypoint (offline controls and provider)", () => {
  it("returns a specific MFA response only for the exact trusted pre-dispatch SQL denial", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "PRIVATE_BETA_FRESH_AUTH_REQUIRED" } });
    const result = await POST(request());
    expect(result.status).toBe(403); expect(await result.json()).toEqual({ error: "CANARY_MFA_REQUIRED", retry: "NONE", financial_authority: "NONE" });
    expect(state.rpc).toHaveBeenCalledOnce(); expect(state.factory).not.toHaveBeenCalled(); expect(state.calls).toBe(0);
  });
  it.each([
    { code: "40001", message: "PRIVATE_BETA_FRESH_AUTH_REQUIRED" },
    { code: "42501", message: "PRIVATE_BETA_FRESH_AUTH_REQUIRED SYNTHETIC_PRIVATE_DETAIL" },
    { code: "42501", message: "PRIVATE_BETA_UNAVAILABLE" },
  ])("keeps other SQL denials generic without inventing MFA or retry safety", async error => {
    state.rpc.mockResolvedValue({ data: null, error });
    const result = await POST(request()); expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: "CANARY_BLOCKED_OR_REVIEW_REQUIRED", retry: "NONE", financial_authority: "NONE" }); expect(state.factory).not.toHaveBeenCalled();
  });
  it("never turns provider-side MFA-like text into a pre-dispatch reauthentication result", async () => {
    state.factory.mockResolvedValue({ provider: { invoke: async () => { state.calls++; throw Error("PRIVATE_BETA_FRESH_AUTH_REQUIRED"); } }, evidence: () => null });
    const result = await POST(request()); expect(result.status).toBe(409); expect(await result.text()).not.toContain("CANARY_MFA_REQUIRED"); expect(state.calls).toBe(1);
  });
  it("rejects cross-origin before authentication, SQL or any provider invocation", async () => {
    expect((await POST(request(undefined, undefined, "https://attacker.invalid"))).status).toBe(403); expect(state.auth).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled(); expect(state.factory).not.toHaveBeenCalled();
  });
  it.each([null, { user: { id: "fixture" }, tenants: [{ id: tenant, role: "manager" }] }, { user: { id: "fixture" }, tenants: [] }])("requires a verified authenticated owner tenant", async context => {
    state.auth.mockResolvedValue(context); expect((await POST(request())).status).toBe(context ? 403 : 401); expect(state.rpc).not.toHaveBeenCalled(); expect(state.calls).toBe(0);
  });
  it.each(["program_id=" + program + "&program_id=" + program, "program_id=" + program + "&execution_enabled=true", "program_id=invalid", "x=" + "x".repeat(600)])("rejects invalid, repeated or unexpected form fields", async body => {
    expect((await POST(request(body))).status).toBe(400); expect(state.rpc).not.toHaveBeenCalled(); expect(state.calls).toBe(0);
  });
  it("does not accept a JSON approval document, even with the matching program", async () => {
    expect((await POST(request(JSON.stringify({ program_id: program }), "application/json"))).status).toBe(400); expect(state.factory).not.toHaveBeenCalled();
  });
  it("keeps real invocation blocked when the authenticated SQL MFA/owner/stage guard denies", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private failure details" } });
    const result = await POST(request()); expect(result.status).toBe(409); expect(await result.text()).not.toContain("private failure"); expect(state.factory).not.toHaveBeenCalled(); expect(state.calls).toBe(0);
    expect(state.rpc).toHaveBeenCalledWith("admin_private_beta_canary_scope_v1", { target_tenant_id: tenant, program_id_value: program });
  });
  it("rejects a wrong tenant or release before obtaining the provider capability", async () => {
    state.rpc.mockResolvedValue({ data: { program_id: program, tenant_id: "93be1000-0000-4000-8000-000000000002", stage: "CANARY", repository_sha: sha }, error: null });
    expect((await POST(request())).status).toBe(409); expect(state.factory).not.toHaveBeenCalled();
    state.rpc.mockResolvedValue({ data: { program_id: program, tenant_id: tenant, stage: "CANARY", repository_sha: "b".repeat(40) }, error: null });
    expect((await POST(request())).status).toBe(409); expect(state.calls).toBe(0);
  });
  it("uses the accepted fixed Hi plan, actual codec output and native QA, with accounting still pending", async () => {
    const result = await POST(request()), body = await result.json(), canary = jeffClaudeCanaryPlan();
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store"); expect(state.calls).toBe(1);
    expect(state.request?.context.recentMessages.map(m => m.content)).toEqual(["Hi"]); expect(state.request?.context.tenantId).toBe(tenant); expect(state.request?.timeoutMs).toBe(10000); expect(state.request?.styleProfile?.language).toBe("en");
    expect(body).toMatchObject({ status: "CANARY_ACCOUNTING_RECONCILIATION_PENDING", attempt_id: attempt, plan_hash: canary.plan_hash, corpus_hash: canary.corpus_hash, qa: "APPROVED", input_tokens: 37, output_tokens: 121, actual_billed_amount: null, billing_status: "UNKNOWN_REQUIRES_INDEPENDENT_RECONCILIATION", telegram_messages: 0, founder_testing_enabled: false, financial_authority: "NONE" });
    expect(body.response_preview).toBe("Hi! I'm Jeff's AI assistant. What would you like to know?");
    expect(state.factory).toHaveBeenCalledWith(expect.objectContaining({ tenantId: tenant, programId: program, scope: "CANARY" }));
  });
  it("evaluates the actual unsafe output and returns HELD without a safe substitution", async () => {
    const wire = jeffClaudeFixtureWire(); wire.proposed_response = "Your payment is verified and VIP access is active."; wire.claims = [{ text: wire.proposed_response, kind: "fact", speech_act: "BUSINESS_FACT", capability: null, grounding: "UNKNOWN", evidence_refs: [], action_category: null }]; state.wire = wire;
    const result = await POST(request()), body = await result.json(); expect(result.status).toBe(200); expect(state.calls).toBe(1); expect(body).toMatchObject({ status: "CANARY_HELD", qa: "HELD", response_preview: null, founder_testing_enabled: false });
  });
  it("returns a sanitized review state after an unknown failure without retry or secret reflection", async () => {
    state.fail = true; const result = await POST(request()); expect(result.status).toBe(409); expect(await result.text()).not.toContain("SYNTHETIC_SECRET"); expect(state.calls).toBe(1);
    expect(jeffGenuineExecutionGate()).toMatchObject({ state: "BLOCKED", release: "DORMANT", authorized_external_requests: 0, execution_enabled: false });
  });
});

const draftForm = () => request('program_id=' + program + '&expected_generation=1');
function draftWorkspace() { return { program: { id: program, stage: 'DRAFT', generation: '1', repository_sha: sha, global_requests: 0, canary_state: 'NOT_STARTED', account_state: 'OBSERVED' } }; }
function draftRpc() {
  let scopeReads = 0;
  return vi.fn(async (name: string) => {
    if (name === 'admin_private_beta_canary_scope_v1') return ++scopeReads === 1 ? { data: null, error: { code: '42501' } } : { data: { program_id: program, tenant_id: tenant, stage: 'CANARY', repository_sha: sha }, error: null };
    if (name === 'admin_private_beta_workspace_v1') return { data: draftWorkspace(), error: null };
    if (name === 'admin_private_beta_transition_v1') return { data: { program_id: program, stage: 'CANARY', generation: '2' }, error: null };
    throw Error('UNEXPECTED_OFFLINE_RPC');
  });
}
describe('one explicit owner canary action from an existing draft, offline provider', () => {
  it.each(["workspace", "prepare", "transition", "scope-readback"])("retains MFA feedback at the %s boundary without creating a provider", async boundary => {
    let scopes = 0;
    state.rpc.mockImplementation(async (name: string) => {
      if (name === "admin_private_beta_canary_scope_v1") {
        scopes++;
        return { data: null, error: { code: "42501", message: scopes > 1 && boundary === "scope-readback" ? "PRIVATE_BETA_FRESH_AUTH_REQUIRED" : "PRIVATE_BETA_UNAVAILABLE" } };
      }
      if (name === "admin_private_beta_workspace_v1") return boundary === "workspace" ? { data: null, error: { code: "42501", message: "PRIVATE_BETA_FRESH_AUTH_REQUIRED" } }
        : { data: { program: { ...draftWorkspace().program, account_state: "OWNER_TEST_AVAILABLE", model_provider: "openai", model_name: "gpt-6.1-sol" } }, error: null };
      if (name === "admin_private_beta_prepare_founder_test_v1") return boundary === "prepare" ? { data: null, error: { code: "42501", message: "PRIVATE_BETA_FRESH_AUTH_REQUIRED" } }
        : { data: { program_id: program, stage: "DRAFT", generation: "2" }, error: null };
      if (name === "admin_private_beta_transition_v1") return boundary === "transition" ? { data: null, error: { code: "42501", message: "PRIVATE_BETA_FRESH_AUTH_REQUIRED" } }
        : { data: { program_id: program, stage: "CANARY", generation: "3" }, error: null };
      throw Error("OFFLINE_UNEXPECTED_RPC");
    });
    const result = await POST(request("program_id=" + program + "&expected_generation=1"));
    expect(result.status).toBe(403); expect(await result.json()).toEqual({ error: "CANARY_MFA_REQUIRED", retry: "NONE", financial_authority: "NONE" }); expect(state.factory).not.toHaveBeenCalled(); expect(state.calls).toBe(0);
  });
  it('uses the real owner-scoped transition and generation lock before rereading scope and making one fixture invocation', async () => {
    const rpc = draftRpc(); state.rpc.mockImplementation(rpc);
    const result = await POST(draftForm()); expect(result.status).toBe(200); expect(state.calls).toBe(1);
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['admin_private_beta_canary_scope_v1', 'admin_private_beta_workspace_v1', 'admin_private_beta_transition_v1', 'admin_private_beta_canary_scope_v1']);
    expect(state.rpc).toHaveBeenCalledWith('admin_private_beta_transition_v1', { target_tenant_id: tenant, program_id_value: program, stage_value: 'CANARY', expected_generation_value: 1 });
    expect((await result.json()).founder_testing_enabled).toBe(false);
  });
  it.each(['0', '-1', '1.0', '01', '1e2', '1000000000', 'true', '1&expected_generation=1'])('rejects invalid or duplicate draft generation %s before any RPC', async generation => {
    const result = await POST(request('program_id=' + program + '&expected_generation=' + generation));
    expect(result.status).toBe(400); expect(state.rpc).not.toHaveBeenCalled(); expect(state.factory).not.toHaveBeenCalled();
  });
  it.each(['foreign-program', 'wrong-release', 'wrong-generation', 'not-draft', 'used-budget', 'unknown-outcome', 'missing-account'])('rejects %s before any transition or provider construction', async mode => {
    const w = draftWorkspace(); const p = w.program;
    if (mode === 'foreign-program') p.id = tenant; if (mode === 'wrong-release') p.repository_sha = 'b'.repeat(40);
    if (mode === 'wrong-generation') p.generation = '2'; if (mode === 'not-draft') p.stage = 'STOPPED';
    if (mode === 'used-budget') p.global_requests = 1; if (mode === 'unknown-outcome') p.canary_state = 'REVIEW'; if (mode === 'missing-account') p.account_state = 'MISSING';
    state.rpc.mockImplementation(async (name: string) => name === 'admin_private_beta_workspace_v1' ? { data: w, error: null } : { data: null, error: { code: '42501' } });
    expect((await POST(draftForm())).status).toBe(409); expect(state.calls).toBe(0); expect(state.factory).not.toHaveBeenCalled();
    expect(state.rpc.mock.calls.some(c => c[0] === 'admin_private_beta_transition_v1')).toBe(false);
  });
  it.each(['mfa', 'window', 'account', 'revision', 'unknown-ack', 'scope-readback'])('never invokes, retries or grants conversations after %s failure', async mode => {
    const rpc = draftRpc(); let scopes = 0;
    state.rpc.mockImplementation(async (name: string) => {
      if (name === 'admin_private_beta_canary_scope_v1') { scopes++; if (mode === 'scope-readback' || scopes === 1) return { data: null, error: { code: '42501', message: 'PRIVATE_DIAGNOSTIC' } }; }
      if (name === 'admin_private_beta_transition_v1' && mode !== 'scope-readback') return mode === 'unknown-ack' ? { data: { program_id: program, stage: 'CANARY', generation: '99' }, error: null } : { data: null, error: { code: mode === 'revision' ? '40001' : mode === 'mfa' ? '42501' : '55000', message: 'PRIVATE_DIAGNOSTIC' } };
      return rpc(name);
    });
    const result = await POST(draftForm()); expect(result.status).toBe(409); expect(await result.text()).not.toContain('PRIVATE_DIAGNOSTIC'); expect(state.calls).toBe(0); expect(state.factory).not.toHaveBeenCalled();
    expect(state.rpc.mock.calls.filter(c => c[0] === 'admin_private_beta_transition_v1')).toHaveLength(1);
  });
  it('does not transition an already authorized CANARY again, even when a draft browser submitted its old generation', async () => {
    expect((await POST(draftForm())).status).toBe(200); expect(state.calls).toBe(1);
    expect(state.rpc).toHaveBeenCalledOnce(); expect(state.rpc).not.toHaveBeenCalledWith('admin_private_beta_transition_v1', expect.anything());
  });
  it('allows only the winner of concurrent draft transition attempts to reach the provider', async () => {
    let scopes = 0, transitions = 0;
    state.rpc.mockImplementation(async (name: string) => {
      if (name === 'admin_private_beta_canary_scope_v1') return ++scopes <= 2 ? { data: null, error: { code: '42501' } } : { data: { program_id: program, tenant_id: tenant, stage: 'CANARY', repository_sha: sha }, error: null };
      if (name === 'admin_private_beta_workspace_v1') return { data: draftWorkspace(), error: null };
      if (name === 'admin_private_beta_transition_v1') return ++transitions === 1 ? { data: { program_id: program, stage: 'CANARY', generation: '2' }, error: null } : { data: null, error: { code: '40001' } };
      throw Error('UNEXPECTED_OFFLINE_RPC');
    });
    const results = await Promise.all([POST(draftForm()), POST(draftForm())]);
    expect(results.map(r => r.status).sort()).toEqual([200,409]); expect(state.calls).toBe(1); expect(transitions).toBe(2);
  });
});

it('preserves the selected OpenAI plan and assesses the actual Responses codec output after the authenticated draft transition', async () => {
  const rpc = draftRpc(); state.rpc.mockImplementation(async (name: string) => {
    const r = await rpc(name);
    return name === 'admin_private_beta_canary_scope_v1' && r.data ? { data: { ...r.data, provider: 'openai', model: 'gpt-6.1-sol' }, error: null } : r;
  });
  state.factory.mockImplementation(async (input: { assess: (request: ModelRequest, response: ModelResponse) => 'APPROVED' | 'HELD' }) => {
    let evidence: unknown = null;
    return { provider: { async invoke(request: ModelRequest) {
      state.calls++;
      const raw = { id: 'resp_fixture_canary', object: 'response', model: 'gpt-6.1-sol', status: 'completed', created_at: 1793059200, completed_at: 1793059201,
        error: null, incomplete_details: null, instructions: null, metadata: {}, parallel_tool_calls: false, tools: [], tool_choice: 'none', background: false,
        previous_response_id: null, conversation: null, prompt: null, max_output_tokens: 512, reasoning: { effort: 'low', summary: null }, service_tier: 'default', truncation: 'disabled',
        prompt_cache_options: { mode: 'explicit', ttl: '30m', comparison_response_id: null }, prompt_cache_diagnostics: { type: 'unavailable' },
        output: [{ type: 'message', id: 'msg_fixture_canary', role: 'assistant', status: 'completed', phase: 'final_answer', content: [{ type: 'output_text', text: JSON.stringify(jeffClaudeFixtureWire()), annotations: [], logprobs: [] }] }],
        usage: { input_tokens: 37, output_tokens: 121, total_tokens: 158, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 7 } } };
      const decoded = decodeJeffOpenAIResponse(JSON.stringify(raw), request, 512);
      const response: ModelResponse = { provider: 'openai', model: 'gpt-6.1-sol', providerRequestId: decoded.providerRequestId, output: decoded.output, evidenceResolution: decoded.evidenceResolution, latencyMs: 12.5, usage: { inputTokens: 37, outputTokens: 121, totalTokens: 158, billedAmount: null, billedCurrency: null } };
      const qa = input.assess(request,response); evidence = { attempt_id: attempt, outcome: { qa, response_hash: decoded.response_hash, elapsed_ms: '12.500000' } }; return response;
    } }, evidence: () => evidence };
  });
  const result = await POST(draftForm()); expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ provider: 'openai', model: 'gpt-6.1-sol', plan_hash: jeffOpenAICanaryPlan().plan_hash, qa: 'APPROVED', actual_billed_amount: null, founder_testing_enabled: false }); expect(state.calls).toBe(1);
});

describe('owner-only local UAT preparation', () => {
  function personalRpc(fault?: string) {
    let reads = 0;
    return vi.fn(async (name: string) => {
      if (name === 'admin_private_beta_canary_scope_v1') return ++reads === 1 ? { data: null, error: { code: '42501' } } : { data: { program_id: program, tenant_id: tenant, stage: 'CANARY', repository_sha: sha, provider: 'openai', model: 'gpt-6.1-sol', owner_only: true }, error: null };
      if (name === 'admin_private_beta_workspace_v1') return { data: { program: { ...draftWorkspace().program, repository_sha: null, account_state: 'OWNER_TEST_AVAILABLE', model_provider: 'openai', model_name: 'gpt-6.1-sol' } }, error: null };
      if (name === 'admin_private_beta_prepare_founder_test_v1') return fault === 'mfa' ? { data: null, error: { code: '42501' } } : { data: { program_id: program, stage: 'DRAFT', generation: fault === 'lost-ack' ? '99' : '2' }, error: null };
      if (name === 'admin_private_beta_transition_v1') return { data: { program_id: program, stage: 'CANARY', generation: '3' }, error: null };
      throw Error('UNEXPECTED_OFFLINE_RPC');
    });
  }
  it('uses a real-owner RPC to bind protected observations before one canary; unknown billing stays unknown', async () => {
    const rpc = personalRpc(); state.rpc.mockImplementation(rpc);
    // The factory/transport are offline test doubles, never genuine model evidence.
    const response = await POST(draftForm()); expect(response.status).toBe(200);
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['admin_private_beta_canary_scope_v1', 'admin_private_beta_workspace_v1', 'admin_private_beta_prepare_founder_test_v1', 'admin_private_beta_transition_v1', 'admin_private_beta_canary_scope_v1']);
    expect(state.rpc).toHaveBeenCalledWith('admin_private_beta_prepare_founder_test_v1', { target_tenant_id: tenant, program_id_value: program, expected_generation_value: 1, repository_sha_value: sha });
    expect(state.rpc).toHaveBeenCalledWith('admin_private_beta_transition_v1', { target_tenant_id: tenant, program_id_value: program, stage_value: 'CANARY', expected_generation_value: 2 });
    expect(state.calls).toBe(1); expect(await response.json()).toMatchObject({ status: 'CANARY_OWNER_TEST_PASSED', billing_status: 'UNKNOWN_REQUIRES_INDEPENDENT_RECONCILIATION', actual_billed_amount: null, financial_authority: 'NONE', founder_testing_enabled: false, telegram_messages: 0 });
  });
  it.each(['mfa', 'lost-ack'])('does not invoke after %s preparation failure or retry preparation', async fault => {
    const rpc = personalRpc(fault); state.rpc.mockImplementation(rpc);
    expect((await POST(draftForm())).status).toBe(409); expect(state.calls).toBe(0); expect(state.factory).not.toHaveBeenCalled();
    expect(rpc.mock.calls.filter(c => c[0] === 'admin_private_beta_prepare_founder_test_v1')).toHaveLength(1);
    expect(rpc.mock.calls.some(c => c[0] === 'admin_private_beta_transition_v1')).toBe(false);
  });
  it('rejects a conflicting platform release before creating a personal owner grant', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'b'.repeat(40)); state.rpc.mockImplementation(personalRpc());
    try { expect((await POST(draftForm())).status).toBe(409); expect(state.calls).toBe(0); expect(state.rpc.mock.calls.some(c => c[0] === 'admin_private_beta_prepare_founder_test_v1')).toBe(false); }
    finally { vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined); }
  });
});

// Offline application tests; database controls remain the authority for actual
// fresh MFA, the one-use window and preservation of both UNKNOWN reservations.
describe('one-use owner continuation after the second unknown attempt', () => {
  const continuationForm = () => request('program_id=' + program + '&expected_generation=5');
  function continuationRpc(fault?: string) {
    let scopes = 0;
    return vi.fn(async (name: string) => {
      if (name === 'admin_private_beta_canary_scope_v1') {
        scopes++;
        if (scopes === 1 || fault === 'scope-readback') return { data: null, error: { code: '42501' } };
        return { data: { program_id: program, tenant_id: tenant, stage: 'CANARY', repository_sha: sha, provider: 'openai', model: 'gpt-6.1-sol', owner_only: true }, error: null };
      }
      if (name === 'admin_private_beta_workspace_v1') return { data: { program: {
        id: fault === 'foreign-program' ? tenant : program, stage: 'CANARY',
        generation: fault === 'stale-generation' ? '6' : '5',
        canary_state: fault === 'review-only' ? 'REVIEW' : 'CONTINUATION_AVAILABLE',
      } }, error: null };
      if (name === 'admin_private_beta_continue_founder_test_v1') {
        if (fault === 'mfa') return { data: null, error: { code: '42501', message: 'PRIVATE_BETA_FRESH_AUTH_REQUIRED' } };
        if (fault === 'conflict') return { data: null, error: { code: '40001' } };
        return { data: { program_id: program, stage: 'CANARY', generation: fault === 'lost-ack' ? '99' : '6' }, error: null };
      }
      throw Error('UNEXPECTED_OFFLINE_RPC');
    });
  }
  it('calls the actual owner continuation once and rereads scope before one invocation', async () => {
    const rpc = continuationRpc(); state.rpc.mockImplementation(rpc);
    const response = await POST(continuationForm()); expect(response.status).toBe(200);
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['admin_private_beta_canary_scope_v1', 'admin_private_beta_workspace_v1', 'admin_private_beta_continue_founder_test_v1', 'admin_private_beta_canary_scope_v1']);
    expect(state.rpc).toHaveBeenCalledWith('admin_private_beta_continue_founder_test_v1', { target_tenant_id: tenant, program_id_value: program, expected_generation_value: 5, repository_sha_value: sha });
    expect(state.calls).toBe(1);
    expect(await response.json()).toMatchObject({ status: 'CANARY_OWNER_TEST_PASSED', actual_billed_amount: null, financial_authority: 'NONE', telegram_messages: 0, founder_testing_enabled: false });
  });
  it.each(['mfa', 'conflict', 'lost-ack', 'scope-readback'])('never creates a provider or repeats continuation after %s', async fault => {
    const rpc = continuationRpc(fault); state.rpc.mockImplementation(rpc);
    const response = await POST(continuationForm()); expect(response.status).toBe(fault === 'mfa' ? 403 : 409);
    expect(state.factory).not.toHaveBeenCalled(); expect(state.calls).toBe(0);
    expect(rpc.mock.calls.filter(call => call[0] === 'admin_private_beta_continue_founder_test_v1')).toHaveLength(1);
  });
  it.each(['foreign-program', 'stale-generation', 'review-only'])('refuses %s workspace before any continuation', async fault => {
    state.rpc.mockImplementation(continuationRpc(fault));
    expect((await POST(continuationForm())).status).toBe(409);
    expect(state.rpc.mock.calls.some(call => call[0] === 'admin_private_beta_continue_founder_test_v1')).toBe(false);
    expect(state.factory).not.toHaveBeenCalled();
  });
  it('does not use stale platform code to authorize continuation', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'b'.repeat(40)); state.rpc.mockImplementation(continuationRpc());
    try {
      expect((await POST(continuationForm())).status).toBe(409);
      expect(state.rpc.mock.calls.some(call => call[0] === 'admin_private_beta_continue_founder_test_v1')).toBe(false);
      expect(state.factory).not.toHaveBeenCalled();
    } finally { vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined); }
  });
});


describe('explicit stopped-personal-setup rearm uses actual owner RPC', () => {
  function stoppedRpc(fault?: string) {
    let scopes = 0;
    return vi.fn(async (name: string) => {
      if (name === 'admin_private_beta_canary_scope_v1') {
        scopes++; if (scopes === 1 || fault === 'scope-readback') return { data: null, error: { code: '42501' } };
        return { data: { program_id: program, tenant_id: tenant, stage: 'CANARY', repository_sha: sha, provider: 'openai', model: 'gpt-6.1-sol', owner_only: true }, error: null };
      }
      if (name === 'admin_private_beta_workspace_v1') return { data: { program: { id: program, stage: 'STOPPED', generation: '7', canary_state: fault === 'ineligible' ? 'REVIEW' : 'CONTINUATION_AVAILABLE' } }, error: null };
      if (name === 'admin_private_beta_rearm_founder_test_v1') {
        if (fault === 'mfa') return { data: null, error: { code: '42501', message: 'PRIVATE_BETA_FRESH_AUTH_REQUIRED' } };
        if (fault === 'conflict') return { data: null, error: { code: '40001' } };
        return { data: { program_id: program, stage: 'CANARY', generation: fault === 'lost-ack' ? '99' : '8' }, error: null };
      }
      return { data: null, error: { code: '42501' } };
    });
  }
  it('requires the separate rearm RPC and independent scope readback before one genuine provider invocation', async () => {
    const rpc = stoppedRpc(); state.rpc.mockImplementation(rpc);
    expect((await POST(request('program_id=' + program + '&expected_generation=7'))).status).toBe(200);
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['admin_private_beta_canary_scope_v1', 'admin_private_beta_workspace_v1', 'admin_private_beta_rearm_founder_test_v1', 'admin_private_beta_canary_scope_v1']);
    expect(state.calls).toBe(1);
  });
  it.each(['mfa', 'conflict', 'lost-ack', 'scope-readback', 'ineligible'])('never creates a provider or repeats the owner action after %s', async fault => {
    const rpc = stoppedRpc(fault); state.rpc.mockImplementation(rpc);
    expect((await POST(request('program_id=' + program + '&expected_generation=7'))).status).toBe(fault === 'mfa' ? 403 : 409);
    expect(state.factory).not.toHaveBeenCalled(); expect(state.calls).toBe(0);
    expect(rpc.mock.calls.filter(c => c[0] === 'admin_private_beta_rearm_founder_test_v1').length).toBeLessThanOrEqual(1);
    expect(rpc.mock.calls.some(c => c[0] === 'admin_private_beta_continue_founder_test_v1')).toBe(false);
  });
});
