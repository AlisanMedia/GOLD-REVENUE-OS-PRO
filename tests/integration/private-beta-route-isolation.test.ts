import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), admin: vi.fn(), env: vi.fn(), legacySend: vi.fn(), conversation: vi.fn(), dispatch: vi.fn(), recovery: vi.fn(), worker: vi.fn(), success: vi.fn(), surveys: vi.fn(), automatic: vi.fn(), escalation: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getUserContext: mocks.context }));
vi.mock("@/lib/admin/permissions", () => import("../../apps/web/src/lib/admin/permissions"));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/messaging/server-env", () => ({ createSupabaseAdminClient: mocks.admin, telegramServerEnv: mocks.env }));
vi.mock("@/lib/messaging/telegram-adapter", () => ({ sendTelegramText: mocks.legacySend }));
vi.mock("@/lib/polat/private-beta-runtime", () => ({ privateBetaConversation: mocks.conversation, dispatchPrivateBetaMessage: mocks.dispatch, drainPrivateBetaRecovery: mocks.recovery }));
vi.mock("@/lib/polat/private-beta-isolation", () => import("../../apps/web/src/lib/polat/private-beta-isolation"));
vi.mock("@/lib/agent-runtime/worker", () => ({ runDeterministicWorker: mocks.worker }));
vi.mock("@/lib/customer-success/worker", () => ({ drainCustomerSuccess: mocks.success }));
vi.mock("@/lib/surveys/worker", () => ({ drainSurveys: mocks.surveys }));
vi.mock("@/lib/messaging/automatic-replies", () => ({ drainAutomaticReplies: mocks.automatic }));
vi.mock("@/lib/escalations/service", () => ({ drainEscalations: mocks.escalation }));
import { POST as manualReply } from "../../apps/web/src/app/api/v1/conversations/[id]/messages/route";
import { GET as cron } from "../../apps/web/src/app/api/internal/agent-worker/route";
import { privateBetaIsolationActive } from "../../apps/web/src/lib/polat/private-beta-isolation";

const tenantId = "91cd2000-0000-4000-8000-000000000001", programId = "91cd2000-0000-4000-8000-000000000002", conversationId = "91cd2000-0000-4000-8000-000000000003", messageId = "91cd2000-0000-4000-8000-000000000004", correlationId = "91cd2000-0000-4000-8000-000000000005";
const staffId = "91cd2000-0000-4000-8000-000000000006";
const scope = () => ({ params: Promise.resolve({ id: conversationId }) });
function request(body: Record<string, unknown> = { content: "Polat Support: I'll review the test access question.", correlation_id: correlationId }, headers: Record<string, string> = {}) { return new Request(`https://fixture.invalid/api/v1/conversations/${conversationId}/messages`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "offline-manual-idempotency", ...headers }, body: JSON.stringify(body) }); }
function scheduled(workload?: string, auth = "Bearer OFFLINE_CRON_FIXTURE") { const url = new URL("https://fixture.invalid/api/internal/agent-worker"); if (workload) url.searchParams.set("workload", workload); return new Request(url, { headers: { authorization: auth } }); }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("POLAT_UAT_RELEASE_SHA", "f".repeat(40)); vi.stubEnv("CRON_SECRET", "OFFLINE_CRON_FIXTURE");
  mocks.context.mockResolvedValue({ user: { id: staffId, email: "private-staff@example.test" }, tenants: [{ id: tenantId, role: "manager" }] });
  mocks.conversation.mockResolvedValue({ program_id: programId }); mocks.rpc.mockResolvedValue({ data: { message_id: messageId, status: "pending", duplicate: false }, error: null }); mocks.dispatch.mockResolvedValue({ status: "sent", message_id: messageId }); mocks.recovery.mockResolvedValue({ conversations: 0, tasks_claimed: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); });
function expectLegacyUnused() { for (const mock of [mocks.env, mocks.admin, mocks.legacySend, mocks.worker, mocks.success, mocks.surveys, mocks.automatic, mocks.escalation]) expect(mock).not.toHaveBeenCalled(); }

describe("private beta manual replies retain named ownership and isolate unrelated traffic (offline)", () => {
  it("uses only authenticated tenant and the MFA/ownership queue before the private-beta dispatcher", async () => {
    const response = await manualReply(request(), scope()); expect(response.status).toBe(201); expect(await response.json()).toEqual({ status: "sent", message_id: messageId, duplicate: false });
    expect(mocks.conversation).toHaveBeenCalledWith(tenantId, conversationId);
    expect(mocks.rpc).toHaveBeenCalledWith("admin_private_beta_queue_manual_v1", { target_tenant_id: tenantId, target_conversation_id: conversationId, content_value: "Polat Support: I'll review the test access question.", idempotency_key_value: "offline-manual-idempotency", correlation_id_value: correlationId, reply_to_message_id_value: null });
    expect(mocks.dispatch).toHaveBeenCalledWith(tenantId, programId, messageId); expectLegacyUnused();
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(staffId); expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain("private-staff@example.test");
  });
  it("unrelated legacy conversations cannot use the beta deployment to send", async () => {
    mocks.conversation.mockResolvedValue(null); const response = await manualReply(request(), scope()); expect(response.status).toBe(423); expect(await response.json()).toEqual({ error: "LEGACY_MESSAGING_ISOLATED" }); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled(); expectLegacyUnused();
  });
  it("MFA, named-operator or takeover denial cannot fall back to the legacy sender", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "PRIVATE_OWNERSHIP_DIAGNOSTIC" } });
    const response = await manualReply(request(), scope()); expect(response.status).toBe(423); const body = await response.text(); expect(body).toContain("PRIVATE_BETA_OPERATOR_OR_OWNERSHIP_REQUIRED"); expect(body).not.toContain("PRIVATE_OWNERSHIP_DIAGNOSTIC"); expect(mocks.dispatch).not.toHaveBeenCalled(); expectLegacyUnused();
  });
  it("a replayed manual command returns the persisted state without another send", async () => {
    mocks.rpc.mockResolvedValue({ data: { message_id: messageId, status: "sent", duplicate: true }, error: null }); const response = await manualReply(request(), scope()); expect(await response.json()).toEqual({ message_id: messageId, status: "sent", duplicate: true }); expect(mocks.dispatch).not.toHaveBeenCalled(); expectLegacyUnused();
  });
  it("unknown delivery remains UNKNOWN and is not retried or called customer-read", async () => {
    mocks.dispatch.mockResolvedValue({ status: "unknown", message_id: messageId }); const response = await manualReply(request(), scope()); expect(response.status).toBe(422); expect(await response.json()).toEqual({ status: "unknown", message_id: messageId, duplicate: false, delivery_evidence: "UNKNOWN", error: "DELIVERY_UNKNOWN_REVIEW_REQUIRED" }); expect(mocks.dispatch).toHaveBeenCalledTimes(1); expectLegacyUnused();
  });
  it("a partial provider or persistence error is held without diagnostic leakage or fallback", async () => {
    mocks.dispatch.mockRejectedValue(Error("PRIVATE_PROVIDER_DIAGNOSTIC")); const response = await manualReply(request(), scope()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "PRIVATE_BETA_MANUAL_REPLY_HELD" }); expect(mocks.dispatch).toHaveBeenCalledTimes(1); expectLegacyUnused();
  });
  it("missing authentication and readonly membership are denied before beta scope reads", async () => {
    mocks.context.mockResolvedValue(null); expect((await manualReply(request(), scope())).status).toBe(401);
    mocks.context.mockResolvedValue({ user: { id: staffId }, tenants: [{ id: tenantId, role: "readonly" }] }); expect((await manualReply(request(), scope())).status).toBe(403); expect(mocks.conversation).not.toHaveBeenCalled(); expectLegacyUnused();
  });
  it("client tenant and authority fields cannot choose a different dispatch scope", async () => {
    const response = await manualReply(request({ content: "Fixture", correlation_id: correlationId, tenant_id: programId, verified: true }), scope()); expect(response.status).toBe(400); expect(mocks.conversation).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); expectLegacyUnused();
  });
  it("invalid idempotency and conversation references never dispatch", async () => {
    expect((await manualReply(request(undefined, { "idempotency-key": "" }), scope())).status).toBe(400);
    expect((await manualReply(request(), { params: Promise.resolve({ id: "not-a-uuid" }) })).status).toBe(400); expect(mocks.conversation).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled(); expectLegacyUnused();
  });
});

describe("private beta scheduled recovery is restrictive, bounded and separate from old live workloads", () => {
  it("runs only private-beta recovery rather than accepted legacy worker/drains", async () => {
    const response = await cron(scheduled()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "ok", private_beta: { conversations: 0, tasks_claimed: 0 } }); expect(mocks.recovery).toHaveBeenCalledTimes(1); expectLegacyUnused();
  });
  it.each(["customer-success", "surveys", "forged-workload"])("%s cannot activate a legacy workload on the private beta release", async workload => {
    const response = await cron(scheduled(workload)); expect(response.status).toBe(423); expect(await response.json()).toEqual({ error: "LEGACY_WORKLOAD_ISOLATED" }); expect(mocks.recovery).not.toHaveBeenCalled(); expectLegacyUnused();
  });
  it("cron authentication precedes all recovery and provider work", async () => {
    for (const header of ["", "Bearer WRONG_OFFLINE", "Basic OFFLINE_CRON_FIXTURE"]) expect((await cron(scheduled(undefined, header))).status).toBe(401);
    expect(mocks.recovery).not.toHaveBeenCalled(); expectLegacyUnused();
  });
  it("recovery failure does not execute a legacy fallback or fabricate a success", async () => {
    mocks.recovery.mockRejectedValue(Error("PRIVATE_RECOVERY_DIAGNOSTIC")); const response = await cron(scheduled()); expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "WORKER_EXECUTION_FAILED" }); expectLegacyUnused();
  });
  it("the deployment marker is a restriction, never independent operational authority", () => {
    expect(privateBetaIsolationActive()).toBe(true); vi.stubEnv("POLAT_UAT_RELEASE_SHA", "invalid-unverified-marker"); expect(privateBetaIsolationActive()).toBe(true); vi.stubEnv("POLAT_UAT_RELEASE_SHA", ""); expect(privateBetaIsolationActive()).toBe(false); expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.recovery).not.toHaveBeenCalled();
  });
});
