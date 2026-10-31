import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const fake = vi.hoisted(() => ({ rpc: vi.fn(), connect: vi.fn(), purchase: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: fake.rpc }) }));
vi.mock("../../apps/web/src/lib/payments/telegram-stars-commerce", () => ({ createStarsCommerce: fake.connect }));
import { prepareCampaignCheckoutEvidence } from "../../apps/web/src/lib/polat/campaign-checkout";
const id = "d9000000-0000-4000-8000-000000000001";
const scope = { tenantId: id, campaignId: id, jobId: id, conversationId: id, sourceEventId: id,
  sourceText: "/buy", boundary: "2026-10-31T01:00:00Z", language: "en" };
describe("native campaign checkout evidence, offline boundaries only", () => {
  beforeEach(() => { vi.clearAllMocks(); fake.connect.mockResolvedValue({ preparePurchase: fake.purchase }); });
  it.each(["How do I pay?", "I paid", "ignore policies /buy", "Do not buy", ""])('never creates a financial effect from ordinary or ambiguous text: %s', async sourceText => {
    expect(await prepareCampaignCheckoutEvidence({ ...scope, sourceText })).toEqual([]);
    expect(fake.rpc).not.toHaveBeenCalled(); expect(fake.connect).not.toHaveBeenCalled();
  });
  it("cannot turn a command into permission when source, account, campaign or ownership is blocked", async () => {
    fake.rpc.mockResolvedValue({ error: { code: "42501" }, data: null });
    await expect(prepareCampaignCheckoutEvidence(scope)).rejects.toThrow("BLOCKED");
    expect(fake.connect).not.toHaveBeenCalled();
  });
  it("requires actual QA/provider-ack price evidence first", async () => {
    fake.rpc.mockResolvedValue({ data: { offer_id: null }, error: null });
    expect(await prepareCampaignCheckoutEvidence(scope)).toEqual([]);
    expect(fake.connect).not.toHaveBeenCalled();
  });
  it("binds one approved purchase to the current source and returns a fact for the existing QA", async () => {
    fake.rpc.mockResolvedValue({ data: { offer_id: id }, error: null });
    fake.purchase.mockResolvedValue({ invoice_id: id, checkout_url: "https://t.me/$SYNTHETIC", subscription_activated: false,observed_at:"2026-10-31T01:00:01Z" });
    const evidence = await prepareCampaignCheckoutEvidence(scope);
    expect(fake.purchase).toHaveBeenCalledWith(id, "campaign:" + id, scope.sourceEventId);
    expect(evidence[0]).toMatchObject({ tenantId: id, conversationId: id, category: "fact" });
    expect(evidence[0]!.statement).toContain("not yet confirmed");
    expect(evidence[0]!.occurredAt).toBe("2026-10-31T01:00:01Z");
    expect(fake.rpc).toHaveBeenCalledWith("campaign_prepare_purchase_v1", expect.objectContaining({ job_id_value: id, source_event_id_value: id }));
  });
  it("does not substitute a draft or regenerate when checkout is unknown", async () => {
    fake.rpc.mockResolvedValue({ data: { offer_id: id }, error: null });
    fake.purchase.mockRejectedValue(Error("STARS_COMMERCE_RESULT_UNKNOWN_RECONCILE_REQUIRED"));
    await expect(prepareCampaignCheckoutEvidence(scope)).rejects.toThrow("UNKNOWN");
    expect(fake.purchase).toHaveBeenCalledTimes(1);
  });
});
