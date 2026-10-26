import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { RequestOptions, IncomingMessage, ClientRequest } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preparePolatConversation, assessPolatDraft } from "./polat-conversation";
import { polatFixture } from "./polat-conversation.fixtures";
import { polatClaudeCanaryPlan } from "./polat-claude-canary";
import { polatGuardDigest } from "./polat-experiment-journal";
import { preparePolatClaudeRequest } from "./polat-claude-adapter";
import { polatClaudeCompleteEnvelope, polatClaudeFixtureWire } from "../../../tests/helpers/polat-bridge-fixtures";
import { createPolatPrivateBetaNetworkAuthority, polatPrivateBetaBindingSchema, requirePolatNetworkPermit, polatGenuineExecutionGate, type PolatPrivateBetaAttemptPayload } from "./polat-experiment-execution-gate";
const fake = vi.hoisted(() => ({ calls: [] as Array<{ options: RequestOptions; body: string }>, status: 200, message: "", disconnect: false, readOverride: new Map<string, { status?: number; body?: string; headers?: Record<string, string> }>() }));
function costFixture() {
  const n = new Date(), day = n.getUTCDate(), start = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1);
  return { data: Array.from({ length: day }, (_, i) => ({ starting_at: new Date(start + i * 86400000).toISOString(), ending_at: new Date(start + (i + 1) * 86400000).toISOString(), results: i === 0 ? [{ amount: "123.45", currency: "USD", workspace_id: "wrkspc_test" }] : [] })), has_more: false, next_page: null };
}
vi.mock("node:https", () => ({ request: (options: RequestOptions, callback: (r: IncomingMessage) => void) => {
  const socket = new EventEmitter() as EventEmitter & { end: (body?: string) => void; destroy: () => void }; socket.destroy = () => {};
  socket.end = body => { fake.calls.push({ options, body: body ?? "" }); queueMicrotask(() => {
    if (fake.disconnect) { socket.emit("error", Error("PRIVATE_TOKEN_OR_CUSTOMER_CONTENT")); return; }
    const path = String(options.path), override = [...fake.readOverride].find(([prefix]) => path.startsWith(prefix))?.[1];
    let value: unknown = null;
    if (path.includes("/workspaces/")) value = { id: "wrkspc_test", name: "isolated-uat", archived_at: null };
    if (path.includes("/spend_limits/")) value = { id: "spl_test", type: "spend_limit", amount: "500", currency: "USD", is_enabled: true, period: "monthly", scope: { type: "workspace", workspace_id: "wrkspc_test" }, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
    if (path.includes("/api_keys?")) value = { data: [{ id: "apikey_test", status: "active", scope: { type: "workspace", workspace_id: "wrkspc_test" }, expires_at: null }], has_more: false, first_id: "apikey_test", last_id: "apikey_test" };
    if (path.includes("/models/")) value = { id: "claude-haiku-5-5", type: "model", display_name: "Test-only provider frame" };
    if (path.includes("/cost_report?")) value = costFixture();
    if (path === "/v1/messages") value = JSON.parse(fake.message || JSON.stringify(polatClaudeCompleteEnvelope())) as unknown;
    const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void };
    response.statusCode = override?.status ?? (path === "/v1/messages" ? fake.status : 200); response.headers = { "content-type": "application/json", "request-id": "req_private_beta_test", "anthropic-workspace-id": "wrkspc_test", ...override?.headers }; response.resume = () => {};
    callback(response as unknown as IncomingMessage); response.emit("data", Buffer.from(override?.body ?? JSON.stringify(value))); response.emit("end");
  }); }; return socket as unknown as ClientRequest;
} }));
import { createPolatPrivateBetaProvider, readPolatAnthropicUatAccount, boundPolatPrivateBetaLiability, readPolatPrivateBetaOfficialPricing, type PolatPrivateBetaProviderOutcome, type PolatPrivateBetaReservation } from "./polat-private-beta-provider";
function fixture() {
  const now = Date.now(), c = polatClaudeCanaryPlan(), prepared = preparePolatConversation(polatFixture("Hi", "en")), credential = "SYNTHETIC_NOT_A_REAL_API_CREDENTIAL", accountScope = polatGuardDigest(["ANTHROPIC_WORKSPACE1", "wrkspc_test"]);
  prepared.request.requestId = "91cb2000-0000-4000-8000-000000000001"; prepared.request.timeoutMs = 10000;
  const binding = polatPrivateBetaBindingSchema.parse({ version: 1, mode: "PRIVATE_BETA_UAT", conversation_style: "DIRECT", program_id: "91cb1000-0000-4000-8000-000000000001", tenant_id: prepared.input.tenant_id, provider: "anthropic", model: "claude-haiku-5-5", model_version: "claude-haiku-5-5", protocol_version: "2023-06-01", repository_sha: "a".repeat(40), manifest_hash: "b".repeat(64), authorization_record_hash: "c".repeat(64), account_scope_hash: accountScope, corpus_version: c.plan.version, corpus_hash: c.corpus_hash, plan_hash: c.plan_hash, maximum_requests: 1, maximum_spend: "5.00", maximum_attempt_liability: "0.02", currency: "USD", maximum_output_tokens: 512, timeout_ms: 10000, expires_at: new Date(now + 600000).toISOString(), financial_authority: "NONE", commercial_sales: false });
  const custody = polatGuardDigest(["POLAT_UAT_CREDENTIAL_CUSTODY1", binding.account_scope_hash, createHash("sha256").update(credential, "utf8").digest("hex")]), hash = polatGuardDigest(binding), wire = preparePolatClaudeRequest(prepared.request, 512);
  const owner = { version: 1, origin: "SERVER_AUTHENTICATED_OWNER_GRANT", program_id: binding.program_id, tenant_id: binding.tenant_id, owner_user_id: "91cb9000-0000-4000-8000-000000000001", role: "super_admin", aal: "aal2", authenticated_at: new Date(now - 2000).toISOString(), approved_at: new Date(now - 1000).toISOString(), starts_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 1200000).toISOString(), revoked: false, phase: "CANARY", binding_hash: hash, policy_hash: "e".repeat(64), credential_custody_hash: custody };
  const account = { payload: { version: 1, origin: "INDEPENDENT_ACCOUNT_CONTROL", program_id: binding.program_id, tenant_id: binding.tenant_id, workspace_id: "wrkspc_test", account_scope_hash: binding.account_scope_hash, repository_sha: binding.repository_sha, manifest_hash: binding.manifest_hash, authorization_record_hash: binding.authorization_record_hash, provider: "anthropic", model: "claude-haiku-5-5", model_access: true, policy_hash: owner.policy_hash, credential_custody_hash: custody, region_evidence_hash: "1".repeat(64), retention_evidence_hash: "2".repeat(64), training_evidence_hash: "3".repeat(64), effective_limit_kind: "ENFORCED_EXPERIMENT_HARD_CAP", currency: "USD", enforced_maximum_spend: "5.00", independently_observed_spend: "0", remaining_allowance: "5.00", billing_state: "RECONCILED", canary_reconciliation_hash: null, unknown_outcome_count: 0, request_bound: { request_hash: wire.request_hash, body_hash: wire.body_hash, maximum_output_tokens: 512, maximum_possible_charge: "0.02", pricing_evidence_hash: "9".repeat(64), valid_until: new Date(now + 30000).toISOString() }, billing_evidence_hash: "4".repeat(64), observed_at: new Date(now).toISOString(), expires_at: new Date(now + 60000).toISOString() } };
  const payload: PolatPrivateBetaAttemptPayload = { version: 2, purpose: "POLAT_PRIVATE_BETA_UAT", program_id: binding.program_id, tenant_id: binding.tenant_id, run_id: "91cb6000-0000-4000-8000-000000000001", native_run_id: prepared.request.requestId, conversation_id: prepared.request.context.conversationId, attempt_id: "91cb3000-0000-4000-8000-000000000001", participant_id: null, scope: "CANARY", source_message_id: null, binding_hash: hash, request_hash: wire.request_hash, body_hash: wire.body_hash, account_scope_hash: binding.account_scope_hash, authorization_record_hash: binding.authorization_record_hash, global_ordinal: 1, participant_ordinal: 0, liability: "0.02", reserved_liability: "0.02", generation: "1", dispatch_nonce: "91cb4000-0000-4000-8000-000000000001", issued_at: new Date(now).toISOString(), expires_at: new Date(now + 30000).toISOString() };
  const committed = { version: 1, mode: "PRIVATE_BETA_UAT", state: "DISPATCH_STARTED", ownership: "AI_ACTIVE", participation: "ACTIVE", program_id: binding.program_id, tenant_id: binding.tenant_id, run_id: payload.run_id, native_run_id: prepared.request.requestId, conversation_id: prepared.request.context.conversationId, attempt_id: payload.attempt_id, request_hash: wire.request_hash, body_hash: wire.body_hash, binding_hash: hash, generation: "1", dispatch_nonce: payload.dispatch_nonce, payload };
  const credentialRead = vi.fn(() => Promise.resolve(credential)), readOwner = vi.fn(() => Promise.resolve(owner)), readAccount = vi.fn(() => Promise.resolve(account)), readCommitted = vi.fn(() => Promise.resolve(committed));
  const authority = createPolatPrivateBetaNetworkAuthority({ deployed_sha: binding.repository_sha, readOwnerGrant: readOwner, readIndependentAccount: readAccount, readCommittedAttempt: readCommitted, resolveCredential: credentialRead });
  const reservation: PolatPrivateBetaReservation = { version: 1, mode: "PRIVATE_BETA_UAT", program_id: binding.program_id, tenant_id: binding.tenant_id, run_id: payload.run_id, native_run_id: prepared.request.requestId, attempt_id: payload.attempt_id, binding_hash: hash, request_hash: wire.request_hash, body_hash: wire.body_hash, liability: "0.02", replay: false, dispatch_started: false };
  const outcomes: PolatPrivateBetaProviderOutcome[] = [], reserve = vi.fn(() => Promise.resolve(reservation)), begin = vi.fn(() => Promise.resolve({ dispatch: true })), record = vi.fn((_r: PolatPrivateBetaReservation, outcome: PolatPrivateBetaProviderOutcome) => { outcomes.push(outcome); return Promise.resolve(); });
  const service = createPolatPrivateBetaProvider({ binding, authority, store: { reserve, begin, record }, assess: (_r, response) => assessPolatDraft(prepared, response.output).action === "SAFE_PREVIEW" ? "APPROVED" : "HELD" });
  return { now, binding, owner, account, payload, committed, authority, prepared, credentialRead, readOwner, readAccount, readCommitted, reservation, reserve, begin, record, outcomes, service };
}
beforeEach(() => { fake.calls = []; fake.status = 200; fake.message = ""; fake.disconnect = false; fake.readOverride.clear(); });
describe("finite genuine UAT authority extension, offline independent boundaries", () => {
  it("keeps legacy/fixture authority dormant and rejects manually supplied permit JSON", () => {
    expect(polatGenuineExecutionGate()).toMatchObject({ state: "BLOCKED", authorized_external_requests: 0 }); expect(() => requirePolatNetworkPermit({ kind: "AUTHENTICATED_POLAT_NETWORK_PERMIT", verified: true })).toThrow("BLOCKED"); expect(fake.calls).toHaveLength(0);
  });
  it("requires three independent server observations before reading a credential and mints one single-use permit", async () => {
    const s = fixture(); expect(await s.authority.preflight(s.binding)).toMatchObject({ state: "READY" }); expect(s.credentialRead).not.toHaveBeenCalled();
    const permit = await s.authority.issue({ binding: s.binding, run_id: s.payload.run_id, attempt_id: s.payload.attempt_id, request: s.prepared.request });
    expect(JSON.stringify(permit)).not.toMatch(/SYNTHETIC|credential|workspace/u); expect(requirePolatNetworkPermit(permit).attempt_id).toBe(s.payload.attempt_id); expect(() => requirePolatNetworkPermit(permit)).toThrow("BLOCKED"); expect(fake.calls).toHaveLength(0);
    await expect(s.authority.issue({ binding: s.binding, run_id: s.payload.run_id, attempt_id: s.payload.attempt_id, request: s.prepared.request })).rejects.toThrow("ALREADY_ISSUED");
  });
  it.each(["mfa", "role", "revoked", "tenant", "sha", "policy", "custody", "account-source", "workspace-identity", "unknown-billing", "stale-account", "insufficient-allowance", "spend", "unexpected-authority"])("fails closed on %s without resolving credentials", async change => {
    const s = fixture();
    if (change === "mfa") s.owner.aal = "aal1"; if (change === "role") s.owner.role = "manager"; if (change === "revoked") s.owner.revoked = true; if (change === "tenant") s.owner.tenant_id = s.owner.owner_user_id;
    if (change === "sha") s.account.payload.repository_sha = "f".repeat(40); if (change === "policy") s.account.payload.policy_hash = "f".repeat(64); if (change === "custody") s.account.payload.credential_custody_hash = "f".repeat(64); if (change === "account-source") s.account.payload.origin = "SYNTHETIC";
    if (change === "workspace-identity") s.account.payload.workspace_id = "wrkspc_other";
    if (change === "unknown-billing") s.account.payload.billing_state = "UNKNOWN"; if (change === "stale-account") s.account.payload.observed_at = new Date(s.now - 300001).toISOString(); if (change === "insufficient-allowance") s.account.payload.remaining_allowance = "0";
    if (change === "spend") s.binding.maximum_spend = "5.01"; if (change === "unexpected-authority") Object.assign(s.binding, { verified: true });
    expect(await s.authority.preflight(s.binding, s.now)).toMatchObject({ state: "BLOCKED" }); expect(s.credentialRead).not.toHaveBeenCalled();
  });
  it.each(["uncommitted", "human", "revoked", "body", "nonce", "ordinal", "canary-plan", "wrong-key"])("denies %s before any model socket", async change => {
    const s = fixture(); if (change === "uncommitted") s.committed.state = "RESERVED"; if (change === "human") s.committed.ownership = "HUMAN_ACTIVE"; if (change === "revoked") s.committed.participation = "REVOKED";
    if (change === "body") s.committed.body_hash = "f".repeat(64); if (change === "nonce") s.committed.dispatch_nonce = s.payload.attempt_id; if (change === "ordinal") s.payload.global_ordinal = 2;
    if (change === "canary-plan") s.prepared.request.context.recentMessages[0]!.content = "Different greeting";
    if (change === "wrong-key") s.credentialRead.mockResolvedValueOnce("DIFFERENT_SYNTHETIC_CREDENTIAL");
    await expect(s.authority.issue({ binding: s.binding, run_id: s.payload.run_id, attempt_id: s.payload.attempt_id, request: s.prepared.request })).rejects.toThrow(); expect(fake.calls).toHaveLength(0);
  });
  it.each(["FOUNDER", "FRIEND"] as const)("binds %s to an exact private-beta conversation/source while keeping the native run distinct from the durable program run", async scope => {
    const s = fixture(); s.binding.corpus_version = "polat-private-beta-conversation-v1"; s.binding.maximum_requests = 350; s.owner.phase = scope === "FOUNDER" ? "FOUNDER" : "FRIENDS";
    s.payload.scope = scope; s.payload.participant_id = "91cb7000-0000-4000-8000-000000000001"; s.payload.source_message_id = s.prepared.request.context.recentMessages.at(-1)!.id;
    s.payload.participant_ordinal = scope === "FOUNDER" ? 20 : 30; s.payload.global_ordinal = 350; s.payload.reserved_liability = "5.00";
    s.payload.binding_hash = s.owner.binding_hash = s.committed.binding_hash = polatGuardDigest(s.binding);
    expect(s.payload.run_id).not.toBe(s.prepared.request.requestId);
    const permit = await s.authority.issue({ binding: s.binding, run_id: s.payload.run_id, attempt_id: s.payload.attempt_id, request: s.prepared.request }); expect(requirePolatNetworkPermit(permit).run_id).toBe(s.payload.run_id);
  });
  it.each(["founder-cap", "friend-cap", "global-cap", "wrong-source", "wrong-conversation", "wrong-native-run", "friend-before-stage"])("rejects %s even with a matching recomputed request hash", async change => {
    const s = fixture(); s.binding.corpus_version = "polat-private-beta-conversation-v1"; s.binding.maximum_requests = 350; s.owner.phase = "FRIENDS";
    s.payload.scope = change === "founder-cap" ? "FOUNDER" : "FRIEND"; s.payload.participant_id = "91cb7000-0000-4000-8000-000000000001"; s.payload.source_message_id = s.prepared.request.context.recentMessages.at(-1)!.id; s.payload.participant_ordinal = 1;
    if (change === "founder-cap") s.payload.participant_ordinal = 21; if (change === "friend-cap") s.payload.participant_ordinal = 31; if (change === "global-cap") s.payload.global_ordinal = 351;
    if (change === "wrong-source") s.payload.source_message_id = s.payload.attempt_id;
    if (change === "wrong-conversation") s.prepared.request.context.conversationId = s.payload.attempt_id;
    if (change === "wrong-native-run") s.prepared.request.requestId = s.payload.attempt_id;
    if (change === "friend-before-stage") s.owner.phase = "FOUNDER";
    const w = preparePolatClaudeRequest(s.prepared.request, 512); s.committed.body_hash = s.payload.body_hash = w.body_hash; s.committed.request_hash = s.payload.request_hash = w.request_hash;
    s.payload.binding_hash = s.owner.binding_hash = s.committed.binding_hash = polatGuardDigest(s.binding);
    await expect(s.authority.issue({ binding: s.binding, run_id: s.payload.run_id, attempt_id: s.payload.attempt_id, request: s.prepared.request })).rejects.toThrow(); expect(s.credentialRead).not.toHaveBeenCalled(); expect(fake.calls).toHaveLength(0);
  });
  it("permits bounded UNKNOWN billing only after independently reconciled canary, no unknown effects, fresh account controls and exact current-request liability", async () => {
    const s = fixture(); s.binding.corpus_version = "polat-private-beta-conversation-v1"; s.binding.maximum_requests = 350; s.owner.phase = "FRIENDS";
    s.payload.scope = "FRIEND"; s.payload.participant_id = s.owner.owner_user_id; s.payload.source_message_id = s.prepared.request.context.recentMessages.at(-1)!.id; s.payload.participant_ordinal = 1;
    s.account.payload.billing_state = "BOUNDED_LIABILITY_RESERVED"; Object.assign(s.account.payload, { canary_reconciliation_hash: "7".repeat(64) });
    s.payload.binding_hash = s.owner.binding_hash = s.committed.binding_hash = polatGuardDigest(s.binding);
    expect(await s.authority.preflight(s.binding)).toMatchObject({ state: "READY" });
    const p = await s.authority.issue({ binding: s.binding, run_id: s.payload.run_id, attempt_id: s.payload.attempt_id, request: s.prepared.request }); expect(requirePolatNetworkPermit(p).attempt_id).toBe(s.payload.attempt_id);
  });
  it.each(["missing-canary", "unknown-outcome", "canary-stage", "missing-bound", "exceeds-liability", "expired-bound", "different-output"])("does not weaken the bounded policy for %s", async change => {
    const s = fixture(); s.account.payload.billing_state = "BOUNDED_LIABILITY_RESERVED"; s.owner.phase = "FRIENDS"; Object.assign(s.account.payload, { canary_reconciliation_hash: "7".repeat(64) });
    if (change === "missing-canary") s.account.payload.canary_reconciliation_hash = null;
    if (change === "unknown-outcome") s.account.payload.unknown_outcome_count = 1;
    if (change === "canary-stage") s.owner.phase = "CANARY";
    if (change === "missing-bound") Object.assign(s.account.payload, { request_bound: null });
    if (change === "exceeds-liability") s.account.payload.request_bound.maximum_possible_charge = "0.020000000000000001";
    if (change === "expired-bound") s.account.payload.request_bound.valid_until = new Date(s.now - 1).toISOString();
    if (change === "different-output") s.account.payload.request_bound.maximum_output_tokens = 511;
    await expect(s.authority.issue({ binding: s.binding, run_id: s.payload.run_id, attempt_id: s.payload.attempt_id, request: s.prepared.request })).rejects.toThrow(); expect(s.credentialRead).not.toHaveBeenCalled(); expect(fake.calls).toHaveLength(0);
  });
});
describe("exact conservative liability, never an actual bill", () => {
  it("binds the current request and reserves full documented model input capacity without floating-point money", () => {
    const s = fixture(), proof = { version: 1, origin: "INDEPENDENT_OFFICIAL_PRICING_READ", model: "claude-haiku-5-5", currency: "USD", source_url: "https://platform.claude.com/docs/en/models/haiku-5-5/overview", source_hash: "8".repeat(64), maximum_input_tokens: 1000000, maximum_input_usd_per_million: "0.50", maximum_output_usd_per_million: "2.50", observed_at: new Date(s.now).toISOString(), expires_at: new Date(s.now + 3600000).toISOString(), all_billable_components_covered: true };
    const bound = boundPolatPrivateBetaLiability(s.prepared.request, 512, proof, s.now); expect(bound).toMatchObject({ maximum_possible_charge: "0.50128", request_hash: s.payload.request_hash, body_hash: s.payload.body_hash }); expect(typeof bound.maximum_possible_charge).toBe("string"); expect(bound).not.toHaveProperty("actual_billed_amount");
    expect(() => boundPolatPrivateBetaLiability(s.prepared.request, 512, { ...proof, expires_at: new Date(s.now - 1).toISOString() }, s.now)).toThrow("PRICING_STALE");
    expect(() => boundPolatPrivateBetaLiability(s.prepared.request, 512, { ...proof, origin: "SYNTHETIC" }, s.now)).toThrow();
  });
  it("reads only fixed official pricing with no credential, and does not assert account-specific surcharges are covered", async () => {
    const raw = "---\ntitle: Claude Haiku 5.5\nurl: https://platform.claude.com/docs/en/models/haiku-5-5/overview\n---\nContext window\n1M tokens\n### Pricing\nInput\n$0.10 / MTok for prompts up to 100,000 tokens\n$0.50 / MTok for prompts over 100,000 tokens\nOutput\n$0.50 / MTok for prompts up to 100,000 tokens\n$2.50 / MTok for prompts over 100,000 tokens\n### Other\n";
    const response = new Response(raw, { status: 200, headers: { "content-type": "text/markdown" } }); Object.defineProperty(response, "url", { value: "https://platform.claude.com/docs/en/models/haiku-5-5/overview.md" });
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    try { const r = await readPolatPrivateBetaOfficialPricing(); expect(r).toMatchObject({ state: "PRICES_OBSERVED", account_billable_scope: "UNVERIFIED", external_inference_requests: 0, actual_billed_amount: null }); expect(fetcher).toHaveBeenCalledWith("https://platform.claude.com/docs/en/models/haiku-5-5/overview.md", expect.objectContaining({ method: "GET", redirect: "error" })); if (r.state === "PRICES_OBSERVED") expect(() => boundPolatPrivateBetaLiability(fixture().prepared.request, 512, r.proof)).toThrow(); }
    finally { fetcher.mockRestore(); }
  });
  it("fails closed when official pricing changes or the document is unavailable, without silently retaining old rates", async () => {
    const response = new Response("# Claude Haiku 5.5\nContext window 1M tokens\n### Pricing\nInput $99 / MTok\nOutput $99 / MTok", { status: 200, headers: { "content-type": "text/markdown" } }); Object.defineProperty(response, "url", { value: "https://platform.claude.com/docs/en/models/haiku-5-5/overview.md" });
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(response); try { expect(await readPolatPrivateBetaOfficialPricing()).toMatchObject({ state: "BLOCKED", external_inference_requests: 0 }); } finally { fetcher.mockRestore(); }
  });
});
describe("genuine provider path with injected offline HTTPS socket", () => {
  it("commits reserve and start before one dispatch, evaluates exact output and records usage separately from billing", async () => {
    const s = fixture(), result = await s.service.provider.invoke(s.prepared.request);
    expect(s.reserve).toHaveBeenCalledTimes(1); expect(s.begin).toHaveBeenCalledTimes(1); expect(fake.calls).toHaveLength(1); expect(s.record).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("anthropic"); expect(result.output.proposed_response).toBe(polatClaudeFixtureWire().proposed_response); expect(result.usage.billedAmount).toBeNull(); expect(s.outcomes[0]).toMatchObject({ status: "SUCCEEDED", qa: "APPROVED", actual_billed_amount: null, financial_authority: "NONE" });
  });
  it("passes unsafe actual output to native QA without a substitute", async () => {
    const s = fixture(), wire = polatClaudeFixtureWire(); wire.proposed_response = "Your payment is verified and VIP access is active."; wire.claims = [{ text: wire.proposed_response, kind: "fact", speech_act: "BUSINESS_FACT", capability: null, grounding: "UNKNOWN", evidence_refs: [], action_category: null }];
    fake.message = JSON.stringify({ ...polatClaudeCompleteEnvelope(), content: [{ type: "text", text: JSON.stringify(wire), citations: null }] });
    const result = await s.service.provider.invoke(s.prepared.request); expect(result.output.proposed_response).toBe(wire.proposed_response); expect(s.outcomes[0]?.qa).toBe("HELD"); expect(fake.calls).toHaveLength(1);
  });
  it.each([401, 403, 429, 500])("accounts for %s once and never retries or falls back", async status => {
    const s = fixture(); fake.status = status; await expect(s.service.provider.invoke(s.prepared.request)).rejects.toMatchObject({ retryable: false }); expect(fake.calls).toHaveLength(1); expect(s.outcomes).toHaveLength(1); expect(s.outcomes[0]?.actual_billed_amount).toBeNull();
  });
  it("records unknown effects, rejects a replay after restart and never invents a bill", async () => {
    const s = fixture(); fake.disconnect = true; await expect(s.service.provider.invoke(s.prepared.request)).rejects.toMatchObject({ retryable: false }); expect(s.outcomes[0]).toMatchObject({ stage: "RESULT_UNKNOWN", status: "UNKNOWN" });
    s.reservation.dispatch_started = true; await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow("RESERVATION"); expect(fake.calls).toHaveLength(1);
  });
  it("holds missing usage and unknown evidence commits without another call", async () => {
    const s = fixture(); fake.message = JSON.stringify(polatClaudeCompleteEnvelope({ usage: null })); await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow("USAGE_UNAVAILABLE"); expect(s.outcomes[0]).toMatchObject({ qa: "HELD", input_tokens: null, output_tokens: null });
    const t = fixture(); t.record.mockRejectedValueOnce(Error("PRIVATE_STORAGE_CONTENT")); await expect(t.service.provider.invoke(t.prepared.request)).rejects.toThrow("COMMIT_UNKNOWN"); expect(fake.calls).toHaveLength(2);
  });
  it("logs neither raw prompt nor secrets even on transport failure", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")], s = fixture(); fake.disconnect = true;
    await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow(); spies.forEach(x => { expect(x).not.toHaveBeenCalled(); x.mockRestore(); });
  });
  it("requires a matching actual workspace ACK and holds mismatch as uncertain without retry", async () => {
    const s = fixture(); fake.readOverride.set("/v1/messages", { headers: { "anthropic-workspace-id": "wrkspc_wrong" } });
    await expect(s.service.provider.invoke(s.prepared.request)).rejects.toThrow("WORKSPACE_INVALID"); expect(s.outcomes[0]).toMatchObject({ stage: "RESULT_UNKNOWN", status: "UNKNOWN", actual_billed_amount: null }); expect(fake.calls).toHaveLength(1);
  });
  it("does not dispatch twice when independent callers receive one committed reservation winner", async () => {
    const s = fixture(); let claimed = false;
    s.reserve.mockImplementation(() => { const replay = claimed; claimed = true; return Promise.resolve({ ...s.reservation, replay }); });
    const result = await Promise.allSettled([s.service.provider.invoke(s.prepared.request), s.service.provider.invoke(s.prepared.request)]);
    expect(result.filter(x => x.status === "fulfilled")).toHaveLength(1); expect(fake.calls).toHaveLength(1); expect(s.outcomes).toHaveLength(1);
  });
});
describe("fixed official read-only account-control adapter, mocked network only", () => {
  const read = () => { const now = Date.now(), n = new Date(now); return readPolatAnthropicUatAccount({ config: { workspace_id: "wrkspc_test", spend_limit_id: "spl_test", api_key_id: "apikey_test", program_starts_at: new Date(now - 1000).toISOString(), program_expires_at: new Date(Math.min(now + 600000, Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1))).toISOString() }, adminCredential: () => Promise.resolve("SYNTHETIC_ADMIN_CREDENTIAL_ONLY"), inferenceCredential: () => Promise.resolve("SYNTHETIC_INFERENCE_CREDENTIAL_ONLY"), now }); };
  it("reads exact workspace/model/cap and complete cost history without making an inference or claiming transactional/billed authority", async () => {
    expect(await read()).toMatchObject({ state: "OBSERVED", configured_monthly_cap_usd: "5", observed_month_to_date_usd: "1.2345", observed_remaining_usd: "3.7655", actual_attempt_billing: "UNKNOWN", experiment_transaction_cap: "REQUIRES_COMMITTED_DURABLE_RESERVATION", cost_report_may_lag: true, inference_requests: 0 });
    expect(fake.calls).toHaveLength(5); expect(fake.calls.every(c => c.options.method === "GET" && c.options.hostname === "api.anthropic.com" && c.body === "")).toBe(true);
  });
  it.each(["early-access", "redirect", "wrong-workspace", "unknown-cost", "incomplete-history", "pagination", "duplicate-key", "wrong-asset", "monthly-over-cap"])("fails closed for %s and never calls Messages", async change => {
    if (change === "early-access") fake.readOverride.set("/v1/organizations/spend_limits/", { status: 403 });
    if (change === "redirect") fake.readOverride.set("/v1/organizations/workspaces/", { status: 302, headers: { location: "https://untrusted.invalid" } });
    if (change === "wrong-workspace") fake.readOverride.set("/v1/models/", { headers: { "anthropic-workspace-id": "wrkspc_other" } });
    const c = costFixture(); if (change === "unknown-cost") c.data[0]!.results[0]!.amount = ""; if (change === "incomplete-history") c.data.shift(); if (change === "pagination") c.has_more = true;
    if (change === "wrong-asset") c.data[0]!.results[0]!.currency = "EUR"; if (change === "monthly-over-cap") c.data[0]!.results[0]!.amount = "500.00000000000001";
    if (["unknown-cost", "incomplete-history", "pagination", "wrong-asset", "monthly-over-cap"].includes(change)) fake.readOverride.set("/v1/organizations/cost_report?", { body: JSON.stringify(c) });
    if (change === "duplicate-key") fake.readOverride.set("/v1/organizations/cost_report?", { body: '{"data":[],"data":[],"has_more":false,"next_page":null}' });
    expect(await read()).toMatchObject({ state: "BLOCKED", inference_requests: 0 }); expect(fake.calls.every(c => c.options.method === "GET")).toBe(true);
  });
});
