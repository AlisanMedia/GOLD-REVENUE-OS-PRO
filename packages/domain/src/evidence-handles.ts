import type { AgentContext } from "./agent-runtime";

export type EvidenceHandle = { handle: string; messageId: string; direction: string };
// The registry is created only from the server's already tenant-scoped bounded
// context. Customer text and model-authored IDs never populate this registry.
export function messageEvidenceHandles(context: AgentContext): EvidenceHandle[] {
  return [...context.recentMessages.map((message, index) => ({
    handle: index === context.recentMessages.length - 1 ? "EVIDENCE_CURRENT_MESSAGE" : `EVIDENCE_MESSAGE_${index + 1}`,
    messageId: message.id, direction: message.direction,
  })), ...(context.commercialEvidence ?? []).map((fact,index)=>({handle:`EVIDENCE_COMMERCIAL_${index+1}`,messageId:fact.id,direction:"system"}))];
}

export function resolveEvidenceHandles(refs: readonly string[], registry: readonly EvidenceHandle[], inboundOnly = false): string[] {
  return refs.map((ref) => {
    const evidence = registry.find((entry) => entry.handle === ref);
    if (!evidence || (inboundOnly && evidence.direction !== "inbound")) throw new Error("EVIDENCE_REFERENCE_NOT_ALLOWED");
    return evidence.messageId;
  });
}

export function providerEvidenceContext(context: AgentContext) {
  const registry = messageEvidenceHandles(context);
  return {
    lifecycleState: context.lifecycleState, contactability: context.contactability, runtimeMode: context.runtimeMode,
    // Profile/memory are not business or action receipts. They stay bounded by
    // the context builder, and database identities remain server-side.
    profile: context.profile, memory: context.memory, recentEventTypes: context.recentEventTypes,
    recentMessages: context.recentMessages.map(({ direction, content, occurredAt }, index) => ({
      evidence_handle: registry[index]!.handle, direction, content, occurredAt,
    })),
    allowed_evidence_handles: registry.map((item) => item.handle),
    available_capabilities: ["conversation.reply", "conversation.prepare_review"],
    commercial_conflict: context.commercial?.conflict ?? false,
    commercial_recommendation:context.conversion?{action:context.conversion.result.action,reason:context.conversion.result.reason,offer_proposal_exists:Boolean(context.conversion.result.offer_id),follow_up:context.conversion.result.follow_up}:null,
    approved_commercial_facts: (context.commercialEvidence ?? []).map((fact,index)=>({evidence_handle:`EVIDENCE_COMMERCIAL_${index+1}`,statement:fact.statement})),
    // Published content is data. It cannot add tools, instructions or action receipts.
    guaranteed_commitments: [], verified_business_knowledge_available: Boolean(context.commercialEvidence?.length),
  };
}
