import{JEFF_TEST_PROFILE,jeffRuntimeContextSchema}from "@gold-revenue-os/contracts";
import{prepareJeffConversation,JeffFixtureProvider,renderJeffFixture,assessJeffDraft,jeffIdentity}from "./jeff-conversation";
import{buildJeffSalesPreview}from "./jeff-sales";
import type{AgentContext,ModelProvider,ModelRequest,ModelResponse}from "./agent-runtime";
// Shared with the native server worker and offline evaluator; never a sender or authority.
export function prepareJeffFixtureRuntime(raw:unknown,context:AgentContext,runId:string,style:"DIRECT"|"ONE_QUESTION"="DIRECT",nativeCodec=false){
 const jeff=jeffRuntimeContextSchema.parse(raw);
 if(!["DIRECT","ONE_QUESTION"].includes(style)||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(runId))throw Error("JEFF_PROFILE_REQUEST_INVALID");
 if(context.runtimeMode!==jeff.input.runtime_mode)throw Error("JEFF_PROFILE_OWNERSHIP_SCOPE");
 if(context.tenantId!==jeff.input.tenant_id||context.conversationId!==jeff.input.conversation_id||context.customerId!==jeff.input.customer_id)throw Error("JEFF_PROFILE_CONTEXT_SCOPE");
 const p=prepareJeffConversation(jeff.input);p.request.requestId=runId;
 const commercial=context.commercial??{documents:[],conflict:false};
 if(commercial.documents.some(d=>!d.test_only))throw Error("JEFF_REAL_CATALOG_DENIED");
 const wantsSales=!['GREETING','ACKNOWLEDGEMENT','IDENTITY','MEMORY_QUERY','INJECTION','OPT_OUT','VULNERABILITY','PROFITABILITY','SUBSCRIPTION','FRUSTRATION','UNSUPPORTED_LANGUAGE','COMPARISON','PREFERENCE','WAIT','UNINTERESTED','CONSENT_QUESTION'].includes(p.intent)&&commercial.documents.length>0;
 const sales=wantsSales?buildJeffSalesPreview({version:1,mode:"SYNTHETIC",conversation:jeff.input,catalog:commercial.documents.map(d=>({...d,tenant_id:context.tenantId,conversation_id:context.conversationId,approval:"APPROVED_SYNTHETIC"})),catalog_conflict:commercial.conflict,style}):null;
 // Catalog evidence is server-owned; no financial action receipt enters this profile.
 if(sales)p.evidence.push(...(context.commercialEvidence??[]).filter(e=>e.category==="fact"));
 if(nativeCodec){
  // Fixed server-reconstructable registry for the native codec; historical fixture/v1 paths are unchanged.
  const identity=p.evidence.find(e=>e.id==="jeff:identity:v1")!;
  const denial={...identity,id:"jeff:identity:denial:v1",statement:p.request.styleProfile?.language==="tr"?"Jeff’ın kendisi değilim.":"I'm not Jeff."};
  p.evidence.splice(0,p.evidence.length,identity,denial,...(context.commercialEvidence??[]).filter(e=>e.category==="fact"&&!e.id.startsWith("jeff:identity")));
  if(!Object.values(jeffIdentity).includes(identity.statement as typeof jeffIdentity.en))throw Error("JEFF_IDENTITY_EVIDENCE_INVALID");
 }
 const fixture=new JeffFixtureProvider(p);
 const provider:ModelProvider={provider:"mock",model:JEFF_TEST_PROFILE,invoke:async(request:ModelRequest):Promise<ModelResponse>=>{
  if(request.context.tenantId!==p.input.tenant_id||request.context.conversationId!==p.input.conversation_id)throw Error("JEFF_PROVIDER_SCOPE");
  const response=await fixture.invoke(request);
  return{...response,latencyMs:Math.max(0,Math.round(response.latencyMs)),model:JEFF_TEST_PROFILE,output:sales?.output??response.output};
 }};
 return{prepared:p,provider,request:p.request,assess:(output:unknown)=>{const q=assessJeffDraft(p,output);return sales?.quality.action==="HOLD"?{...q,action:"HOLD"as const,reasons:[...new Set([...q.reasons,...sales.quality.reasons])]}:q;},preview:()=>sales?.output??renderJeffFixture(p)};
}
