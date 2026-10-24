import{z}from "zod";
import{polatConversationInputSchema}from "./polat-conversation";
export const POLAT_TEST_PROFILE="polat-test-runtime-v1"as const;
export const polatRuntimeContextSchema=z.strictObject({version:z.literal(1),mode:z.literal("SYNTHETIC"),profile:z.literal(POLAT_TEST_PROFILE),generation:z.string().regex(/^[1-9][0-9]{0,18}$/u),input:polatConversationInputSchema,subscription_context:z.array(z.strictObject({id:z.uuid(),state:z.string().max(40),ends_at:z.iso.datetime({offset:true}).nullable(),mode:z.literal("test")})).max(3),financial_authority:z.literal("NONE"),live_operations_authorized:z.literal(false)});
export const polatRuntimeDraftSchema=z.strictObject({mode:z.literal("SYNTHETIC"),draft_id:z.uuid(),qa_approved:z.boolean(),operation_id:z.uuid(),generation:z.string().regex(/^[1-9][0-9]{0,18}$/u),tenant_id:z.uuid(),conversation_id:z.uuid(),message_id:z.uuid(),source_hash:z.string().regex(/^[a-f0-9]{64}$/u),body_hash:z.string().regex(/^[a-f0-9]{64}$/u),body:z.string().min(1).max(600),financial_authority:z.literal("NONE"),live_operations_authorized:z.literal(false)});
export type PolatRuntimeContext=z.infer<typeof polatRuntimeContextSchema>;
