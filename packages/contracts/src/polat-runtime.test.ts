import{describe,it,expect}from "vitest";
import{polatRuntimeDraftSchema}from "./polat-runtime";
const uuid="11111111-1111-4111-8111-111111111111";
const draft={mode:"SYNTHETIC",draft_id:uuid,qa_approved:true,operation_id:uuid,generation:"1",tenant_id:uuid,conversation_id:uuid,message_id:uuid,source_hash:"a".repeat(64),body_hash:"b".repeat(64),body:"Synthetic response",financial_authority:"NONE",live_operations_authorized:false};
describe("Polat TEST runtime wire boundary",()=>{
 it("preserves explicit synthetic and no-authority classification",()=>expect(polatRuntimeDraftSchema.parse(draft)).toEqual(draft));
 it.each([{mode:"LIVE"},{financial_authority:"LIVE"},{live_operations_authorized:true},{verified:true},{generation:"0"},{body:"x".repeat(601)},{body_hash:"wrong"},{lease_token:"forbidden"}])("rejects unexpected authority and malformed drafts %j",patch=>expect(()=>polatRuntimeDraftSchema.parse({...draft,...patch})).toThrow());
});
