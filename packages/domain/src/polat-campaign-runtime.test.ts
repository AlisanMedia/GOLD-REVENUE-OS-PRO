import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { polatFixture } from "./polat-conversation.fixtures";
import { preparePolatConversation } from "./polat-conversation";
import { preparePolatCampaignRuntime } from "./polat-campaign-runtime";

function sample(text = "Hi", language: "en" | "tr" = "en") {
  const input = polatFixture(text, language), prepared = preparePolatConversation(input);
  const scope = { tenant_id: input.tenant_id, campaign_id: randomUUID(), job_id: randomUUID(),
    conversation_id: input.conversation_id, source_message_id: input.source_message_id, revision: 2,
    boundary: input.boundary, plan_version_id: randomUUID(), follow_up: false };
  return { context: prepared.request.context, scope };
}
describe("native Polat campaign profile", () => {
  it.each(["en", "tr"] as const)("preserves %s source/context and disclosed identity without generating a fixture reply", language => {
    const { context, scope } = sample(language === "tr" ? "Merhaba" : "Hi", language);
    const profile = preparePolatCampaignRuntime(context, randomUUID(), scope);
    expect(profile.request.context.recentMessages).toEqual(context.recentMessages);
    expect(profile.request.styleProfile?.language).toBe(language);
    expect(profile.disclosureRequired).toBe(true);
    expect(profile.evidence[0]?.id).toBe("polat:campaign:identity:v1");
    expect(profile.request.systemPolicy).toContain("No retries, fallback or QA regeneration");
    expect("provider" in profile).toBe(false);
  });
  it("labels scheduled follow-ups without inventing a new inbound or conversation", () => {
    const { context, scope } = sample();
    const profile = preparePolatCampaignRuntime(context, randomUUID(), { ...scope, follow_up: true });
    expect(profile.request.systemPolicy).toContain("not a new customer message");
    expect(profile.request.context.recentMessages).toEqual(context.recentMessages);
  });
  it.each(["TENANT", "CONVERSATION", "SOURCE", "OWNERSHIP", "CONTACT", "PLAN", "CONFLICT"])("rejects %s drift", kind => {
    const { context, scope } = sample();
    if (kind === "TENANT") context.tenantId = randomUUID();
    if (kind === "CONVERSATION") context.conversationId = randomUUID();
    if (kind === "SOURCE") scope.source_message_id = randomUUID();
    if (kind === "OWNERSHIP") context.runtimeMode = "HUMAN_TAKEOVER";
    if (kind === "CONTACT") context.contactability = "blocked";
    if (kind === "PLAN") context.commercial = { documents: [{ kind: "plan", version_id: randomUUID() } as NonNullable<typeof context.commercial>["documents"][number]], conflict: false };
    if (kind === "CONFLICT") context.commercial = { documents: [], conflict: true };
    expect(() => preparePolatCampaignRuntime(context, randomUUID(), scope)).toThrow();
  });
});
