import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest, ModelResponse } from "../../packages/domain/src/agent-runtime";
import { decodePolatClaudeResponse } from "../../packages/domain/src/polat-claude-adapter";
import { polatClaudeCompleteEnvelope, polatClaudeFixtureWire } from "../helpers/polat-bridge-fixtures";
import { polatClaudeCanaryPlan } from "../../packages/domain/src/polat-claude-canary";
import { polatGenuineExecutionGate } from "../../packages/domain/src/polat-experiment-execution-gate";

const state = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), factory: vi.fn(), calls: 0, fail: false, wire: null as unknown, request: null as ModelRequest | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getUserContext: state.auth }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/polat/private-beta-canary", () => import("../../apps/web/src/lib/polat/private-beta-canary"));
vi.mock("../../apps/web/src/lib/polat/private-beta-provider", () => ({ createPrivateBetaProviderFromDatabase: state.factory }));
import { POST } from "../../apps/web/src/app/api/v1/admin/private-beta/canary/route";

const tenant = "93be1000-0000-4000-8000-000000000001", program = "93be2000-0000-4000-8000-000000000001", attempt = "93be3000-0000-4000-8000-000000000001", sha = "a".repeat(40);
const request = (body = "program_id=" + program, type = "application/x-www-form-urlencoded", origin = "https://fixture.invalid") => new Request("https://fixture.invalid/api/v1/admin/private-beta/canary", { method: "POST", headers: { origin, "content-type": type }, body });

beforeEach(() => {
  vi.clearAllMocks(); state.calls = 0; state.fail = false; state.wire = null; state.request = null; vi.stubEnv("POLAT_UAT_RELEASE_SHA", sha);
  state.auth.mockResolvedValue({ user: { id: "private-owner-fixture" }, tenants: [{ id: tenant, role: "super_admin" }] });
  state.rpc.mockResolvedValue({ data: { program_id: program, tenant_id: tenant, stage: "CANARY", repository_sha: sha }, error: null });
  state.factory.mockImplementation(async (input: { assess: (request: ModelRequest, response: ModelResponse) => "APPROVED" | "HELD" }) => {
    let evidence: unknown = null;
    return { provider: { async invoke(inputRequest: ModelRequest) {
      state.calls++; state.request = inputRequest; if (state.fail) throw Error("SYNTHETIC_SECRET_MUST_NOT_ESCAPE");
      const decoded = decodePolatClaudeResponse(JSON.stringify(polatClaudeCompleteEnvelope({ content: [{ type: "text", text: JSON.stringify(state.wire ?? polatClaudeFixtureWire()), citations: null }] })), inputRequest, 512);
      const response: ModelResponse = { provider: "anthropic", model: "claude-haiku-5-5", providerRequestId: decoded.providerRequestId, output: decoded.output, evidenceResolution: decoded.evidenceResolution, latencyMs: 12.5, usage: { inputTokens: 37, outputTokens: 121, totalTokens: null, billedAmount: null, billedCurrency: null } };
      const qa = await input.assess(inputRequest, response);
      evidence = { attempt_id: attempt, outcome: { qa, response_hash: decoded.response_hash, elapsed_ms: "12.500000" } };
      return response;
    } }, evidence: () => evidence };
  });
});

describe("authenticated single-request canary entrypoint (offline controls and provider)", () => {
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
    const result = await POST(request()), body = await result.json(), canary = polatClaudeCanaryPlan();
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store"); expect(state.calls).toBe(1);
    expect(state.request?.context.recentMessages.map(m => m.content)).toEqual(["Hi"]); expect(state.request?.context.tenantId).toBe(tenant); expect(state.request?.timeoutMs).toBe(10000); expect(state.request?.styleProfile?.language).toBe("en");
    expect(body).toMatchObject({ status: "CANARY_ACCOUNTING_RECONCILIATION_PENDING", attempt_id: attempt, plan_hash: canary.plan_hash, corpus_hash: canary.corpus_hash, qa: "APPROVED", input_tokens: 37, output_tokens: 121, actual_billed_amount: null, billing_status: "UNKNOWN_REQUIRES_INDEPENDENT_RECONCILIATION", telegram_messages: 0, founder_testing_enabled: false, financial_authority: "NONE" });
    expect(body.response_preview).toBe("Hi! I'm Polat's AI assistant. What would you like to know?");
    expect(state.factory).toHaveBeenCalledWith(expect.objectContaining({ tenantId: tenant, programId: program, scope: "CANARY" }));
  });
  it("evaluates the actual unsafe output and returns HELD without a safe substitution", async () => {
    const wire = polatClaudeFixtureWire(); wire.proposed_response = "Your payment is verified and VIP access is active."; wire.claims = [{ text: wire.proposed_response, kind: "fact", speech_act: "BUSINESS_FACT", capability: null, grounding: "UNKNOWN", evidence_refs: [], action_category: null }]; state.wire = wire;
    const result = await POST(request()), body = await result.json(); expect(result.status).toBe(200); expect(state.calls).toBe(1); expect(body).toMatchObject({ status: "CANARY_HELD", qa: "HELD", response_preview: null, founder_testing_enabled: false });
  });
  it("returns a sanitized review state after an unknown failure without retry or secret reflection", async () => {
    state.fail = true; const result = await POST(request()); expect(result.status).toBe(409); expect(await result.text()).not.toContain("SYNTHETIC_SECRET"); expect(state.calls).toBe(1);
    expect(polatGenuineExecutionGate()).toMatchObject({ state: "BLOCKED", release: "DORMANT", authorized_external_requests: 0, execution_enabled: false });
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
