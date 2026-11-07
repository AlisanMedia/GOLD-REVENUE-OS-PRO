import "server-only";
import{jeffRuntimeDraftSchema,JEFF_TEST_PROFILE,jeffResponseCommandSchema,jeffContactTicketSchema,type JeffRuntimeContext}from "@gold-revenue-os/contracts";
import{createSupabaseAdminClient}from "@/lib/supabase/admin";
import{FakeJeffTransport,bindJeffReceipt,prepareJeffFixtureRuntime,type AgentContext}from "@gold-revenue-os/domain";
export function jeffTask(value:{model_provider:string;model_name:string}){return value.model_provider==="mock"&&value.model_name===JEFF_TEST_PROFILE;}
export function prepareJeffRuntimeProfile(jeff:JeffRuntimeContext,context:AgentContext,runId:string,nativeCodec=false){return prepareJeffFixtureRuntime(jeff,context,runId,"DIRECT",nativeCodec);}

async function rpc(name:string,args:Record<string,unknown>):Promise<unknown>{const{data,error}=await createSupabaseAdminClient().rpc(name,args);if(error)throw Error("JEFF_TEST_RPC:"+(error.code??"UNAVAILABLE"));return data;}
export async function dispatchJeffTestProposal(tenantId:string,proposalId:string,transport:FakeJeffTransport){
 if(!(transport instanceof FakeJeffTransport))throw Error("JEFF_FAKE_TRANSPORT_REQUIRED");
 const d=jeffRuntimeDraftSchema.parse(await rpc("jeff_test_runtime_queue_v1",{target_tenant_id:tenantId,target_proposal_id:proposalId}));
 if(d.tenant_id!==tenantId)throw Error("JEFF_DRAFT_SCOPE");
 if(!d.qa_approved)return{state:"HUMAN_HANDOFF_PENDING",delivery:"NOT_SENT",financial_authority:"NONE"}as const;
 const command=jeffResponseCommandSchema.parse({version:1,mode:"SYNTHETIC",tenant_id:d.tenant_id,conversation_id:d.conversation_id,message_id:d.message_id,operation_id:d.operation_id,generation:d.generation,source_hash:d.source_hash,body_hash:d.body_hash,actor:"AI"});
 const contact=jeffContactTicketSchema.parse(await rpc("jeff_test_contact_ticket_v1",{target_tenant_id:tenantId,draft_id_value:d.draft_id,purpose_value:"REQUESTED_SUPPORT"}));
 if(contact.state!=="FAKE_ELIGIBLE")return{state:"HUMAN_HANDOFF_PENDING",delivery:"NOT_SENT",financial_authority:"NONE"}as const;
 const prepared=await rpc("jeff_test_runtime_prepare_v1",{target_tenant_id:tenantId,draft_id_value:d.draft_id});
 if(!prepared||typeof prepared!=="object"||!("state"in prepared))throw Error("JEFF_PREPARE_INVALID");
 if(prepared.state!=="PREPARED"){
  // Read the independent FAKE transport ledger; never resend an unknown effect.
  const observed=prepared.state==="DELIVERY_UNKNOWN"?transport.observe(command):null;
  if(observed?.result==="FAKE_ACK")return{state:String(await rpc("jeff_test_runtime_receipt_v1",{target_tenant_id:tenantId,draft_id_value:d.draft_id,receipt_value:JSON.stringify(bindJeffReceipt(observed,command))})),delivery:"FAKE_ACK",financial_authority:"NONE"}as const;
  return{state:String(prepared.state),delivery:"NOT_SENT",financial_authority:"NONE"}as const;
 }
 if(!("operation_id"in prepared)||prepared.operation_id!==command.operation_id||!("generation"in prepared)||prepared.generation!==command.generation||!("mode"in prepared)||prepared.mode!=="SYNTHETIC")throw Error("JEFF_PREPARE_SCOPE");
 const receipt=bindJeffReceipt(await transport.send(command,d.body,async()=>await rpc("jeff_test_runtime_can_send_v1",{target_tenant_id:tenantId,draft_id_value:d.draft_id})===true),command);
 const state=await rpc("jeff_test_runtime_receipt_v1",{target_tenant_id:tenantId,draft_id_value:d.draft_id,receipt_value:JSON.stringify(receipt)});
 return{state:String(state),delivery:receipt.result,financial_authority:"NONE"}as const;
}
export async function holdJeffTestSource(tenantId:string,conversationId:string,eventId:string){return rpc("jeff_test_runtime_hold_v1",{target_tenant_id:tenantId,target_conversation_id:conversationId,target_event_id:eventId,reason_value:"MODEL_UNAVAILABLE"});}

export async function recoverJeffTestConversation(tenantId:string,conversationId:string,transport:FakeJeffTransport){
 await rpc("jeff_test_runtime_refresh_v1",{target_tenant_id:tenantId,target_conversation_id:conversationId});
 const rows=await rpc("jeff_test_runtime_recovery_v1",{target_tenant_id:tenantId,target_conversation_id:conversationId});
 if(!Array.isArray(rows)||rows.length>1)throw Error("JEFF_RECOVERY_BOUND");
 for(const row of rows){if(!row||typeof row!=="object"||typeof row.proposal_id!=="string")throw Error("JEFF_RECOVERY_INVALID");await dispatchJeffTestProposal(tenantId,row.proposal_id,transport);}
}
