import "server-only";
import{polatRuntimeDraftSchema,POLAT_TEST_PROFILE,polatResponseCommandSchema,polatContactTicketSchema,type PolatRuntimeContext}from "@gold-revenue-os/contracts";
import{createSupabaseAdminClient}from "@/lib/supabase/admin";
import{preparePolatConversation,PolatFixtureProvider,renderPolatFixture,assessPolatDraft}from "@gold-revenue-os/domain";
import{buildPolatSalesPreview}from "@gold-revenue-os/domain";
import{FakePolatTransport,bindPolatReceipt,type AgentContext,type ModelProvider,type ModelRequest,type ModelResponse}from "@gold-revenue-os/domain";
export function polatTask(value:{model_provider:string;model_name:string}){return value.model_provider==="mock"&&value.model_name===POLAT_TEST_PROFILE;}
export function preparePolatRuntimeProfile(polat:PolatRuntimeContext,context:AgentContext,runId:string){
 const p=preparePolatConversation(polat.input);p.request.requestId=runId;
 const commercial=context.commercial??{documents:[],conflict:false};
 if(commercial.documents.some(d=>!d.test_only))throw Error("POLAT_REAL_CATALOG_DENIED");
 const wantsSales=!['GREETING','ACKNOWLEDGEMENT','IDENTITY','MEMORY_QUERY','INJECTION','OPT_OUT'].includes(p.intent)&&commercial.documents.length>0;
 const sales=wantsSales?buildPolatSalesPreview({version:1,mode:"SYNTHETIC",conversation:polat.input,catalog:commercial.documents.map(d=>({...d,tenant_id:context.tenantId,conversation_id:context.conversationId,approval:"APPROVED_SYNTHETIC"})),catalog_conflict:commercial.conflict,style:"DIRECT"}):null;
 // Catalog evidence is server-owned; no financial action receipt enters this profile.
 if(sales)p.evidence.push(...(context.commercialEvidence??[]).filter(e=>e.category==="fact"));
 const fixture=new PolatFixtureProvider(p);
 const provider:ModelProvider={provider:"mock",model:POLAT_TEST_PROFILE,invoke:async(request:ModelRequest):Promise<ModelResponse>=>{
  if(request.context.tenantId!==p.input.tenant_id||request.context.conversationId!==p.input.conversation_id)throw Error("POLAT_PROVIDER_SCOPE");
  const response=await fixture.invoke({...request,...(request.rewriteFeedback?{...p.request}:{}),requestId:p.request.requestId});
  return{...response,latencyMs:Math.max(0,Math.round(response.latencyMs)),model:POLAT_TEST_PROFILE,output:sales?.output??response.output};
 }};
 return{prepared:p,provider,request:p.request,assess:(output:unknown)=>sales?.quality??assessPolatDraft(p,output),preview:()=>sales?.output??renderPolatFixture(p)};
}
async function rpc(name:string,args:Record<string,unknown>):Promise<unknown>{const{data,error}=await createSupabaseAdminClient().rpc(name,args);if(error)throw Error("POLAT_TEST_RPC:"+(error.code??"UNAVAILABLE"));return data;}
export async function dispatchPolatTestProposal(tenantId:string,proposalId:string,transport:FakePolatTransport){
 if(!(transport instanceof FakePolatTransport))throw Error("POLAT_FAKE_TRANSPORT_REQUIRED");
 const d=polatRuntimeDraftSchema.parse(await rpc("polat_test_runtime_queue_v1",{target_tenant_id:tenantId,target_proposal_id:proposalId}));
 if(d.tenant_id!==tenantId)throw Error("POLAT_DRAFT_SCOPE");
 if(!d.qa_approved)return{state:"HUMAN_HANDOFF_PENDING",delivery:"NOT_SENT",financial_authority:"NONE"}as const;
 const command=polatResponseCommandSchema.parse({version:1,mode:"SYNTHETIC",tenant_id:d.tenant_id,conversation_id:d.conversation_id,message_id:d.message_id,operation_id:d.operation_id,generation:d.generation,source_hash:d.source_hash,body_hash:d.body_hash,actor:"AI"});
 const contact=polatContactTicketSchema.parse(await rpc("polat_test_contact_ticket_v1",{target_tenant_id:tenantId,draft_id_value:d.draft_id,purpose_value:"REQUESTED_SUPPORT"}));
 if(contact.state!=="FAKE_ELIGIBLE")return{state:"HUMAN_HANDOFF_PENDING",delivery:"NOT_SENT",financial_authority:"NONE"}as const;
 const prepared=await rpc("polat_test_runtime_prepare_v1",{target_tenant_id:tenantId,draft_id_value:d.draft_id});
 if(!prepared||typeof prepared!=="object"||!("state"in prepared))throw Error("POLAT_PREPARE_INVALID");
 if(prepared.state!=="PREPARED"){
  // Read the independent FAKE transport ledger; never resend an unknown effect.
  const observed=prepared.state==="DELIVERY_UNKNOWN"?transport.observe(command):null;
  if(observed?.result==="FAKE_ACK")return{state:String(await rpc("polat_test_runtime_receipt_v1",{target_tenant_id:tenantId,draft_id_value:d.draft_id,receipt_value:JSON.stringify(bindPolatReceipt(observed,command))})),delivery:"FAKE_ACK",financial_authority:"NONE"}as const;
  return{state:String(prepared.state),delivery:"NOT_SENT",financial_authority:"NONE"}as const;
 }
 if(!("operation_id"in prepared)||prepared.operation_id!==command.operation_id||!("generation"in prepared)||prepared.generation!==command.generation||!("mode"in prepared)||prepared.mode!=="SYNTHETIC")throw Error("POLAT_PREPARE_SCOPE");
 const receipt=bindPolatReceipt(await transport.send(command,d.body,async()=>await rpc("polat_test_runtime_can_send_v1",{target_tenant_id:tenantId,draft_id_value:d.draft_id})===true),command);
 const state=await rpc("polat_test_runtime_receipt_v1",{target_tenant_id:tenantId,draft_id_value:d.draft_id,receipt_value:JSON.stringify(receipt)});
 return{state:String(state),delivery:receipt.result,financial_authority:"NONE"}as const;
}
export async function holdPolatTestSource(tenantId:string,conversationId:string,eventId:string){return rpc("polat_test_runtime_hold_v1",{target_tenant_id:tenantId,target_conversation_id:conversationId,target_event_id:eventId,reason_value:"MODEL_UNAVAILABLE"});}

export async function recoverPolatTestConversation(tenantId:string,conversationId:string,transport:FakePolatTransport){
 await rpc("polat_test_runtime_refresh_v1",{target_tenant_id:tenantId,target_conversation_id:conversationId});
 const rows=await rpc("polat_test_runtime_recovery_v1",{target_tenant_id:tenantId,target_conversation_id:conversationId});
 if(!Array.isArray(rows)||rows.length>1)throw Error("POLAT_RECOVERY_BOUND");
 for(const row of rows){if(!row||typeof row!=="object"||typeof row.proposal_id!=="string")throw Error("POLAT_RECOVERY_INVALID");await dispatchPolatTestProposal(tenantId,row.proposal_id,transport);}
}
