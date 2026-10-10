import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), dispatch: vi.fn(), result: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn(), gte: vi.fn(), order: vi.fn(), limit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/messaging/server-env", () => ({ telegramServerEnv: () => ({ tenantId: "tenant" }), createSupabaseAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/messaging/outbound-dispatch", () => ({ dispatchQueuedTelegramMessage: mocks.dispatch }));
type Result = { data: { id: string }[]; error: null };
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: mocks.select, eq: mocks.eq, in: mocks.in, gte: mocks.gte, order: mocks.order, limit: mocks.limit,
    then: (fulfilled: (result: Result) => unknown) => mocks.result().then(fulfilled) };
  for (const method of [mocks.from, mocks.select, mocks.eq, mocks.in, mocks.gte, mocks.order, mocks.limit]) method.mockReturnValue(query);
  mocks.result.mockResolvedValue({ data: [{ id: "approved-send" }], error: null });
  mocks.dispatch.mockResolvedValue(undefined);
});
describe("Conversation-scoped deterministic delivery", () => {
  it("filters the same tenant/conversation and only fresh queued quality-approved replies", async () => {
    const { drainAutomaticReplies } = await import("../../apps/web/src/lib/messaging/automatic-replies");
    await drainAutomaticReplies({ tenantId: "tenant", conversationId: "conversation" });
    expect(mocks.eq.mock.calls).toContainEqual(["tenant_id", "tenant"]);
    expect(mocks.eq.mock.calls).toContainEqual(["conversation_id", "conversation"]);
    expect(mocks.eq.mock.calls).toContainEqual(["actor_id", "quality-approved-reply"]);
    expect(mocks.eq.mock.calls).toContainEqual(["direction", "outbound"]);
    expect(mocks.in).toHaveBeenCalledWith("status", ["pending", "retry_scheduled"]);
    expect(mocks.gte).toHaveBeenCalledWith("created_at", expect.any(String));
    expect(mocks.limit).toHaveBeenCalledWith(3);
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith({ tenantId: "tenant", messageId: "approved-send", automatic: true });
  });
  it("rejects a different tenant before reading or dispatching", async () => {
    const { drainAutomaticReplies } = await import("../../apps/web/src/lib/messaging/automatic-replies");
    await drainAutomaticReplies({ tenantId: "other-tenant", conversationId: "conversation" });
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("does not dispatch on a failed query or with no eligible sends", async () => {
    const { drainAutomaticReplies } = await import("../../apps/web/src/lib/messaging/automatic-replies");
    mocks.result.mockResolvedValueOnce({ data: null, error: { message: "fixture" } }).mockResolvedValueOnce({ data: [], error: null });
    await drainAutomaticReplies({ tenantId: "tenant", conversationId: "conversation" });
    await drainAutomaticReplies({ tenantId: "tenant", conversationId: "conversation" });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
