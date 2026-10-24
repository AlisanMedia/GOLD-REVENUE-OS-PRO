import{POLAT_TEST_PROFILE,polatRuntimeContextSchema}from "@gold-revenue-os/contracts";
import{preparePolatConversation,PolatFixtureProvider,renderPolatFixture,assessPolatDraft}from "./polat-conversation";
import{buildPolatSalesPreview}from "./polat-sales";
import type{AgentContext,ModelProvider,ModelRequest,ModelResponse}from "./agent-runtime";
// Shared with the native server worker and offline evaluator; never a sender or authority.
export function preparePolatFixtureRuntime(raw:unknown,context:AgentContext,runId:string,style:"DIRECT"|"ONE_QUESTION"="DIRECT"){
 const polat=polatRuntimeContextSchema.parse(raw);
 if(!["DIRECT","ONE_QUESTION"].includes(style)||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(runId))throw Error("POLAT_PROFILE_REQUEST_INVALID");
 if(context.runtimeMode!==polat.input.runtime_mode)throw Error("POLAT_PROFILE_OWNERSHIP_SCOPE");
 if(context.tenantId!==polat.input.tenant_id||context.conversationId!==polat.input.conversation_id||context.customerId!==polat.input.customer_id)throw Error("POLAT_PROFILE_CONTEXT_SCOPE");
 const p=preparePolatConversation(polat.input);p.request.requestId=runId;
 const commercial=context.commercial??{documents:[],conflict:false};
 if(commercial.documents.some(d=>!d.test_only))throw Error("POLAT_REAL_CATALOG_DENIED");
 const wantsSales=!['GREETING','ACKNOWLEDGEMENT','IDENTITY','MEMORY_QUERY','INJECTION','OPT_OUT','VULNERABILITY','PROFITABILITY','SUBSCRIPTION','FRUSTRATION','UNSUPPORTED_LANGUAGE','COMPARISON','PREFERENCE','WAIT','UNINTERESTED','CONSENT_QUESTION'].includes(p.intent)&&commercial.documents.length>0;
 const sales=wantsSales?buildPolatSalesPreview({version:1,mode:"SYNTHETIC",conversation:polat.input,catalog:commercial.documents.map(d=>({...d,tenant_id:context.tenantId,conversation_id:context.conversationId,approval:"APPROVED_SYNTHETIC"})),catalog_conflict:commercial.conflict,style}):null;
 // Catalog evidence is server-owned; no financial action receipt enters this profile.
 if(sales)p.evidence.push(...(context.commercialEvidence??[]).filter(e=>e.category==="fact"));
 const fixture=new PolatFixtureProvider(p);
 const provider:ModelProvider={provider:"mock",model:POLAT_TEST_PROFILE,invoke:async(request:ModelRequest):Promise<ModelResponse>=>{
  if(request.context.tenantId!==p.input.tenant_id||request.context.conversationId!==p.input.conversation_id)throw Error("POLAT_PROVIDER_SCOPE");
  const response=await fixture.invoke(request);
  return{...response,latencyMs:Math.max(0,Math.round(response.latencyMs)),model:POLAT_TEST_PROFILE,output:sales?.output??response.output};
 }};
 return{prepared:p,provider,request:p.request,assess:(output:unknown)=>{const q=assessPolatDraft(p,output);return sales?.quality.action==="HOLD"?{...q,action:"HOLD"as const,reasons:[...new Set([...q.reasons,...sales.quality.reasons])]}:q;},preview:()=>sales?.output??renderPolatFixture(p)};
}
