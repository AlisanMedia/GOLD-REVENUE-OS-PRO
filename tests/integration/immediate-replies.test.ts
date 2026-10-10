import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ worker: vi.fn(), state: vi.fn(), drain: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent-runtime/worker", () => ({ runDeterministicWorker: mocks.worker }));
vi.mock("@/lib/messaging/automatic-replies", () => ({ drainAutomaticReplies: mocks.drain }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.state }) }) }) }) }) }));
const input = { deploymentRef: "fixture", conversation: { tenantId: "tenant", conversationId: "conversation" } };
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks();
  mocks.state.mockResolvedValue({ data: { automatic_replies_enabled: true, runtime_mode: "AI_ACTIVE", human_takeover: false }, error: null });
  mocks.worker.mockResolvedValue({ tasksClaimed: 1 });
  mocks.drain.mockResolvedValue(undefined);
});
describe("Bounded immediate conversation burst (fixtures, not live evidence)", () => {
  it("sends the preceding approved reply before claiming the next source-ordered task", async () => {
    let pending = false;
    const order: string[] = [];
    mocks.worker.mockImplementation(async () => { order.push("claim"); if (pending) return { tasksClaimed: 0 }; pending = true; return { tasksClaimed: 1 }; });
    mocks.drain.mockImplementation(async (scope) => { expect(scope).toEqual(input.conversation); order.push("send"); pending = false; });
    const { runImmediateConversationReplies } = await import("../../apps/web/src/lib/agent-runtime/immediate-replies");
    await runImmediateConversationReplies(input);
    expect(order).toEqual(["claim", "send", "claim", "send", "claim", "send"]);
  });
  it("processes at most three sequential single-task invocations in the same scope", async () => {
    const { runImmediateConversationReplies } = await import("../../apps/web/src/lib/agent-runtime/immediate-replies");
    await runImmediateConversationReplies(input);
    expect(mocks.worker).toHaveBeenCalledTimes(3);
    expect(mocks.worker.mock.calls.every(([call]) => call === input)).toBe(true);
  });
  it.each([
    { automatic_replies_enabled: false, runtime_mode: "AI_ACTIVE", human_takeover: false },
    { automatic_replies_enabled: true, runtime_mode: "HUMAN_TAKEOVER", human_takeover: true },
  ])("retains one invocation when automatic eligibility is absent", async (data) => {
    mocks.state.mockResolvedValue({ data, error: null });
    const { runImmediateConversationReplies } = await import("../../apps/web/src/lib/agent-runtime/immediate-replies");
    await runImmediateConversationReplies(input); expect(mocks.worker).toHaveBeenCalledTimes(1);
    expect(mocks.drain).not.toHaveBeenCalled();
  });
  it("stops when another worker owns the lease or no task remains", async () => {
    mocks.worker.mockResolvedValueOnce({ tasksClaimed: 1 }).mockResolvedValueOnce({ tasksClaimed: 0 });
    const { runImmediateConversationReplies } = await import("../../apps/web/src/lib/agent-runtime/immediate-replies");
    await runImmediateConversationReplies(input); expect(mocks.worker).toHaveBeenCalledTimes(2);
  });
  it("reserves time for one worst-case generation plus rewrite and send", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(50_000);
    const { runImmediateConversationReplies } = await import("../../apps/web/src/lib/agent-runtime/immediate-replies");
    await runImmediateConversationReplies(input); expect(mocks.worker).toHaveBeenCalledTimes(1);
  });
});
