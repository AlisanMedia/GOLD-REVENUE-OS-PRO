import { z } from "zod";
import { conversationModelOutputSchema, memoryProposalSchema } from "./conversation-quality";
import { responseClaimSchema } from "./conversation-evidence";
import { SPEECH_ACTS, CONVERSATION_CAPABILITIES } from "./speech-acts";

/** Existing native output/evidence vocabulary shared by protocol codecs, never a second QA engine. */
export const polatNativeWireOutputSchema = conversationModelOutputSchema.omit({ memory_proposals: true }).extend({
  claims: z.array(responseClaimSchema.extend({ speech_act: z.enum(SPEECH_ACTS), capability: z.enum(CONVERSATION_CAPABILITIES).nullable() })).min(1).max(16),
  memory_proposals: z.array(memoryProposalSchema.omit({ provenance_message_ids: true }).extend({ provenance_evidence_refs: z.array(z.string().min(1).max(160)).min(1).max(8) })).max(8),
  proposed_tool_calls: z.array(z.strictObject({ name: z.string(), version: z.number().int(), arguments: z.strictObject({}) })).max(0),
});

/** Protocol-compatible generation schema; strict local native parsing remains mandatory. */
export function polatSupportedNativeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(polatSupportedNativeSchema);
  if (!value || typeof value !== "object") return value;
  const omitted = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems", "format"]);
  return Object.fromEntries(Object.entries(value).filter(([key, v]) => !omitted.has(key) && !(key === "minItems" && v !== 0 && v !== 1)).map(([key, v]) => [key, polatSupportedNativeSchema(v)]));
}
