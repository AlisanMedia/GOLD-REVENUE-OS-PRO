import { z } from "zod";

export const POLAT_INTENTS = ["IDENTITY", "GREETING", "ACKNOWLEDGEMENT", "MEMORY_QUERY", "QUESTION", "PRICE", "TRUST", "INTEREST", "OBJECTION", "PAYMENT", "ACCESS", "REFUND", "CANCEL", "HUMAN", "OPT_OUT", "INJECTION", "UNKNOWN"] as const;
export const polatMessageSchema = z.strictObject({
  id:z.uuid(),tenant_id:z.uuid(),conversation_id:z.uuid(),direction:z.enum(["inbound","outbound"]),
  content:z.string().min(1).max(4096),occurred_at:z.iso.datetime({offset:true}),
  author:z.enum(["CUSTOMER","AI","HUMAN"]),delivery:z.enum(["INBOUND_OBSERVED","FAKE_ACKNOWLEDGED","UNVERIFIED"]),
}).superRefine((v,c)=>{if((v.direction==="inbound")!==(v.author==="CUSTOMER")||(v.direction==="inbound")!==(v.delivery==="INBOUND_OBSERVED"))c.addIssue({code:"custom",message:"MESSAGE_PROVENANCE_INVALID"});});
export const polatKnowledgeSchema=z.strictObject({id:z.uuid(),tenant_id:z.uuid(),conversation_id:z.uuid(),
  origin:z.literal("APPROVED_KNOWLEDGE_FIXTURE"),topic:z.enum(["service","pricing","support","policy"]),
  locale:z.enum(["en","tr","ar","ru"]),statement:z.string().min(1).max(500),effective_at:z.iso.datetime({offset:true}),expires_at:z.iso.datetime({offset:true}).nullable(),
});
export const polatMemorySchema=z.strictObject({key:z.enum(["preferred_instrument","service_question","communication_preference"]),value:z.string().min(1).max(180),source_message_id:z.uuid(),quote:z.string().min(1).max(180)});
export const polatConversationInputSchema=z.strictObject({
  version:z.literal(1),mode:z.literal("SYNTHETIC"),tenant_id:z.uuid(),conversation_id:z.uuid(),customer_id:z.uuid().nullable(),
  source_message_id:z.uuid(),boundary:z.iso.datetime({offset:true}),runtime_mode:z.enum(["AI_ACTIVE","HUMAN_TAKEOVER","PAUSED"]),
  contactability:z.enum(["contactable","unknown","blocked","revoked"]),verified_customer_language:z.enum(["en","tr","ar","ru"]).nullable(),
  messages:z.array(polatMessageSchema).min(1).max(20),memory:z.array(polatMemorySchema).max(24),knowledge:z.array(polatKnowledgeSchema).max(20),
});
export type PolatConversationInput=z.infer<typeof polatConversationInputSchema>;
export type PolatIntent=(typeof POLAT_INTENTS)[number];
