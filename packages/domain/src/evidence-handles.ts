import type { AgentContext } from "./agent-runtime";

export type EvidenceHandle = { handle: string; messageId: string; direction: string };
// The registry is created only from the server's already tenant-scoped bounded
// context. Customer text and model-authored IDs never populate this registry.
export function messageEvidenceHandles(context: AgentContext): EvidenceHandle[] {
  return context.recentMessages.map((message, index) => ({
    handle: index === context.recentMessages.length - 1 ? "EVIDENCE_CURRENT_MESSAGE" : `EVIDENCE_MESSAGE_${index + 1}`,
    messageId: message.id, direction: message.direction,
  }));
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
    guaranteed_commitments: [], verified_business_knowledge_available: false,
  };
}
