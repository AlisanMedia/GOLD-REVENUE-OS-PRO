import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ rpc: vi.fn(), legacyProvider: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: fake.rpc }) }));
vi.mock("@/lib/agent-runtime/context-builder", () => ({ buildAgentContext: vi.fn() }));
vi.mock("@/lib/polat/test-runtime", () => ({ polatTask: () => false, preparePolatRuntimeProfile: vi.fn(), dispatchPolatTestProposal: vi.fn(), holdPolatTestSource: vi.fn(), recoverPolatTestConversation: vi.fn() }));
vi.mock("@/lib/agent-runtime/providers/openai-responses", () => ({ openAIProviderFromEnvironment: fake.legacyProvider }));
vi.mock("@/lib/messaging/outbound-dispatch", () => ({ dispatchQueuedTelegramMessage: vi.fn() }));
vi.mock("../../apps/web/src/lib/polat/private-beta-provider", () => ({ createPrivateBetaProviderFromDatabase: vi.fn() }));
vi.mock("../../apps/web/src/lib/polat/private-beta-runtime", () => ({ readPrivateBetaSource: vi.fn(), dispatchPrivateBetaProposal: vi.fn(), holdPrivateBetaSource: vi.fn() }));
vi.mock("../../apps/web/src/lib/polat/test-model", () => ({ polatOfflineRuntimeProvider: vi.fn() }));
import { runDeterministicWorker } from "../../apps/web/src/lib/agent-runtime/worker";

beforeEach(() => { vi.clearAllMocks(); fake.rpc.mockResolvedValue({ data: [], error: null }); });
afterEach(() => vi.unstubAllEnvs());
describe("UAT deployment cannot spend its existing OpenAI key through the legacy worker", () => {
  it.each(["a".repeat(40), "invalid-marker-is-restrictive"])("rejects unscoped worker before claiming any source for marker %s", async marker => {
    vi.stubEnv("POLAT_UAT_RELEASE_SHA", marker);
    await expect(runDeterministicWorker({ workerId: "offline-isolation", deploymentRef: "offline" })).rejects.toThrow("POLAT_UAT_SCOPED_WORKER_REQUIRED");
    expect(fake.legacyProvider).not.toHaveBeenCalled();
    expect(fake.rpc.mock.calls.map(([name]) => name)).toEqual(["record_agent_worker_heartbeat"]);
    expect(fake.rpc).toHaveBeenCalledWith("record_agent_worker_heartbeat", expect.objectContaining({ result_value: "failed", claimed_events_value: 0, claimed_tasks_value: 0 }));
  });
  it("preserves the old non-UAT empty worker path without loading a model credential", async () => {
    vi.stubEnv("POLAT_UAT_RELEASE_SHA", "");
    const result = await runDeterministicWorker({ workerId: "offline-original", deploymentRef: "offline" });
    expect(result.tasksClaimed).toBe(0); expect(fake.legacyProvider).not.toHaveBeenCalled();
    expect(fake.rpc.mock.calls.map(([name]) => name)).toEqual(["claim_event_outbox", "claim_agent_tasks", "record_agent_worker_heartbeat"]);
  });
});
