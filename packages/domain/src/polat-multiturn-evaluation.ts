import{createHash}from 'node:crypto';
import{POLAT_V2_CATALOG,polatV2CorpusHash,type PolatV2Scenario}from './polat-multiturn-v2-corpus';
import type{PolatConversationInput,PolatRuntimeContext}from '@gold-revenue-os/contracts';
import{POLAT_TEST_PROFILE,POLAT_INBOUND_STATES}from '@gold-revenue-os/contracts';
import{canonicalFinancialJson}from './financial-source-canonical';
import{preparePolatConversation,polatIdentity}from './polat-conversation';
import{preparePolatFixtureRuntime}from './polat-runtime-profile';
import{polatFixture}from './polat-conversation.fixtures';
import{polatSalesFixture}from './polat-sales.fixtures';
import{FakePolatTransport}from './polat-response';
import{commercialEvidence,type CommercialContext}from './commercial';
import{ModelProviderError}from './agent-runtime';
import{polatModelObservationSchema,type PolatModelObservation}from '@gold-revenue-os/contracts';
import{polatFixtureMeasurement,summarizePolatModelObservations}from './polat-model-evaluation';
import{POLAT_PROFILE}from './polat-conversation';
import{CONVERSATION_QUALITY_VERSIONS}from './conversation-quality';
import{POLAT_MULTITURN_CORPUS,POLAT_MULTITURN_CORPUS_VERSION}from './polat-multiturn-corpus';
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
function uuid(s:string){const h=sha(s);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
export const polatMultiTurnCorpusHash=()=>sha(canonicalFinancialJson({version:POLAT_MULTITURN_CORPUS_VERSION,scenarios:POLAT_MULTITURN_CORPUS}));
export async function evaluatePolatMultiTurn(corpus?:{version:'polat-multiturn-v2';hash:string;scenarios:readonly PolatV2Scenario[]}){
 if(corpus&&(!/^[a-f0-9]{64}$/u.test(corpus.hash)||corpus.version!=='polat-multiturn-v2'||corpus.scenarios.length>100||corpus.hash!==polatV2CorpusHash(corpus.scenarios)||corpus.scenarios.reduce((n,s)=>n+s.turns.length,0)*2>512))throw Error('POLAT_CORPUS_DESCRIPTOR_INVALID');
 const scenarios=corpus?.scenarios??POLAT_MULTITURN_CORPUS;
 const namespace=(s:string)=>corpus?`${corpus.version}:${s}`:s;
 const variants=[],observations:PolatModelObservation[]=[];let totalRequests=0;
 for(const style of ['DIRECT','ONE_QUESTION']as const){const cases=[];
  for(const scenario of scenarios){
   const messages:PolatConversationInput['messages']=[];let memory:PolatConversationInput['memory']=[],ownership:PolatConversationInput['runtime_mode']='AI_ACTIVE';
   const fixture=polatFixture(),transport=new FakePolatTransport(Array(64).fill('ACK')),turns=[],owned=new Map<string,string>();let requestCount=0;
   for(const[index,step]of scenario.turns.entries()){
    const sourceId=step.duplicate?messages.filter(m=>m.direction==='inbound').at(-1)!.id:uuid(namespace(`${scenario.id}:${index}:source`)),failures:string[]=[];
    const boundary=new Date(Date.UTC(2026,9,24,0,0,index*2)).toISOString();ownership=step.ownership??ownership;
    if(step.duplicate){turns.push({index,source_id:sourceId,state:owned.get(sourceId)??'BLOCKED_WITH_REASON',objective_pass:owned.has(sourceId)&&step.expected==='NO_GENERATION',failures:owned.has(sourceId)?[]:['DUPLICATE_WITHOUT_SOURCE'],quality_action:'NOT_GENERATED',quality_reasons:[],reply_preview:null,characters:0,latency_ms:null,model_status:'NOT_INVOKED',dimensions:null});continue;}
    messages.push({id:sourceId,tenant_id:fixture.tenant_id,conversation_id:fixture.conversation_id,direction:'inbound',author:'CUSTOMER',delivery:'INBOUND_OBSERVED',content:step.text,occurred_at:boundary});
    while(messages.length>20||messages.reduce((sum,m)=>sum+m.content.length,0)>16000)messages.shift();
    if(step.remember){const instrument=step.text.match(/\b(XAUUSD|EURUSD|GBPUSD|BTCUSD)\b/u)?.[0];if(instrument)memory=[{key:'preferred_instrument',value:instrument,quote:instrument,source_message_id:sourceId}];}
    const input={...fixture,messages:structuredClone(messages),memory:memory.filter(m=>messages.some(s=>s.id===m.source_message_id)),boundary,source_message_id:sourceId,runtime_mode:ownership,verified_customer_language:step.language??'en'};
    const plainContext=corpus?{review_context:{messages:input.messages.map(m=>({direction:m.direction,text:m.content})),approved_facts:[]as string[],source_boundary:boundary}}:{};
    if(ownership!=='AI_ACTIVE'){
     const state=ownership==='HUMAN_TAKEOVER'?'HUMAN_OWNED':'BLOCKED_WITH_REASON';owned.set(sourceId,state);
     turns.push({...plainContext,index,source_id:sourceId,state,objective_pass:step.expected==='NO_GENERATION',failures:step.expected==='NO_GENERATION'?[]:['EXPECTED_REPLY_WHILE_OWNED'],quality_action:'NOT_GENERATED',quality_reasons:[],reply_preview:null,characters:0,latency_ms:null,model_status:'NOT_INVOKED',dimensions:null});continue;
    }
    const p=preparePolatConversation(input),catalog=polatSalesFixture(step.text,step.language??'en');
    if(corpus)catalog.catalog=catalog.catalog.map((d,i)=>({...d,version:POLAT_V2_CATALOG.document_version,version_id:`${POLAT_V2_CATALOG.version_uuid_prefix}-0000-4000-8000-${String(i+1).padStart(12,'0')}`,payload:d.kind==='plan'&&step.language==='tr'?{...d.payload,title:POLAT_V2_CATALOG.turkish_plan_title}:d.payload}));
    const commercial:CommercialContext={documents:step.catalog==='NONE'?[]:catalog.catalog.map(({item_id,version_id,version,kind,payload,published_at,effective_from,expires_at,test_only})=>({item_id,version_id,version,kind,payload,published_at,effective_from,expires_at,test_only})),conflict:step.catalog==='CONFLICT'};
    const context={...p.request.context,commercial,commercialEvidence:commercialEvidence(commercial,{tenantId:input.tenant_id,conversationId:input.conversation_id,boundary,locale:step.language??'en'})};
    const runtime:PolatRuntimeContext={version:1,mode:'SYNTHETIC',profile:POLAT_TEST_PROFILE,generation:String(index+1),input,subscription_context:[],financial_authority:'NONE',live_operations_authorized:false};
    const profile=preparePolatFixtureRuntime(runtime,context,uuid(namespace(`${scenario.id}:${index}:run`)),style);
    const reviewContext=corpus?{review_context:{messages:input.messages.map(m=>({direction:m.direction,text:m.content})),approved_facts:profile.prepared.evidence.filter(e=>e.category==='fact').map(e=>e.statement),source_boundary:boundary}}:{};
    const started=performance.now();let latency:number|null=null,modelStarted:number|null=null,observationIndex:number|null=null;
    const measurementScope={tenantId:input.tenant_id,conversationId:input.conversation_id,invocationId:uuid(namespace(`${style}:${scenario.id}:${index}:invocation`)),promptVersion:CONVERSATION_QUALITY_VERSIONS.prompt,personaVersion:POLAT_PROFILE.version};
    try{
     if(++totalRequests>512)throw Error('OFFLINE_REQUEST_CAP');requestCount++;
     if(step.delayMs)await new Promise(resolve=>setTimeout(resolve,step.delayMs));
     modelStarted=performance.now();const response=await profile.provider.invoke(profile.request);latency=performance.now()-started;
     observationIndex=observations.length;observations.push(polatFixtureMeasurement(measurementScope,performance.now()-modelStarted,response,null));
     const output=step.unsafeModel?{...response.output,proposed_response:'Your payment has been verified.'}:response.output;
     const quality=profile.assess(output),safe=quality.action==='SAFE_PREVIEW',text=output.proposed_response;
     if(!['SAFE','HOLD'].includes(step.expected)||safe!==(step.expected==='SAFE'))failures.push('UNEXPECTED_QUALITY_DISPOSITION');
     for(const required of step.contains??[])if(!text.includes(required))failures.push('QUESTION_OR_CONTEXT_MISSED:'+required);
     for(const denied of step.excludes??[])if(text.toLocaleLowerCase('en').includes(denied.toLocaleLowerCase('en')))failures.push('FORBIDDEN_OR_IRRELEVANT_TEXT:'+denied);
     if(text.length>600||(text.match(/\?/gu)?.length??0)>1)failures.push('LENGTH_OR_QUESTION_FRICTION');
     if(p.disclosureRequired&&!text.includes(polatIdentity[profile.request.styleProfile!.language as keyof typeof polatIdentity]??polatIdentity.en))failures.push('AI_DISCLOSURE_MISSING');
     if(safe&&(quality.qa.grounding.blocked||quality.qa.grounding.action_receipt_failures.length))failures.push('UNSAFE_APPROVED_CLAIM');
     if(/saved your|recorded your|kaydedildi/iu.test(text))failures.push('UNCOMMITTED_SAVED_ACTION');
     let state='HUMAN_HANDOFF_PENDING';
     if(safe){const command={version:1 as const,mode:'SYNTHETIC' as const,tenant_id:input.tenant_id,conversation_id:input.conversation_id,message_id:sourceId,operation_id:uuid(namespace(`${scenario.id}:${index}:operation`)),generation:String(index+1),source_hash:sha(step.text),body_hash:sha(text),actor:'AI' as const};const receipt=await transport.send(command,text,()=>Promise.resolve(true));if(receipt.result!=='FAKE_ACK')throw Error('OFFLINE_FAKE_ACK_REQUIRED');state='AI_RESPONDED';messages.push({id:uuid(namespace(`${scenario.id}:${index}:ack`)),tenant_id:input.tenant_id,conversation_id:input.conversation_id,direction:'outbound',author:'AI',delivery:'FAKE_ACKNOWLEDGED',content:text,occurred_at:new Date(Date.parse(boundary)+1).toISOString()});}
     if(observationIndex!==null)observations[observationIndex]=polatModelObservationSchema.parse({...observations[observationIndex],qa:safe?'APPROVED':'HELD',flags:[...(!safe?['HUMAN_ESCALATION']:[]),...(step.unsafeModel?['HALLUCINATED_COMMERCIAL_FACT','UNSAFE_FINANCIAL_CLAIM']:[]),...(text.length>600?['EXCESSIVE_LENGTH']:[])],completion:state==='AI_RESPONDED'?'FAKE_ACKNOWLEDGED':'NOT_COMPLETED'});
     owned.set(sourceId,state);
     turns.push({...reviewContext,index,source_id:sourceId,state,objective_pass:failures.length===0,failures,quality_action:quality.action,quality_reasons:quality.reasons,reply_preview:text,characters:text.length,latency_ms:latency,model_status:'SUCCEEDED',dimensions:{correctness:failures.length===0,naturalness:{method:'DETERMINISTIC_INDICATORS',human_rating:null,values:quality.qa.naturalness.dimensions},question_relevance:!(failures.some(f=>f.startsWith('QUESTION_OR_CONTEXT'))),conciseness:text.length<=600,context_preservation:!(failures.some(f=>f.includes('CONTEXT'))),ai_disclosure:!failures.includes('AI_DISCLOSURE_MISSING'),grounding:!quality.qa.grounding.blocked,commercial_truthfulness:quality.qa.grounding.action_receipt_failures.length===0,sales_next_step:quality.action,objection_signal:p.signals.objection,repetition:quality.qa.scores.repetition,human_escalation:!safe,consent_compliance:!failures.includes('UNCOMMITTED_SAVED_ACTION'),financial_risk_disclosure:/risk|promise|verified performance|risk|garanti/iu.test(text)?'PRESENT':'NOT_APPLICABLE_OR_REVIEW',uncertainty_handling:quality.qa.grounding.factual_confidence}});
    }catch(error){if(modelStarted!==null&&observationIndex===null)observations.push(polatFixtureMeasurement(measurementScope,performance.now()-modelStarted,null,error instanceof ModelProviderError?error:new ModelProviderError('PROVIDER_ERROR','FIXTURE_EVALUATION_FAILURE',false)));const status=error instanceof ModelProviderError?error.kind:'EVALUATION_ERROR';const expected=(status==='TIMEOUT'&&step.expected==='TIMEOUT')||(status==='INVALID_OUTPUT'&&step.expected==='INVALID');owned.set(sourceId,'HUMAN_HANDOFF_PENDING');turns.push({...reviewContext,index,source_id:sourceId,state:'HUMAN_HANDOFF_PENDING',objective_pass:expected,failures:expected?[]:['MODEL_OR_EVALUATION_ERROR:'+status],quality_action:'NOT_GENERATED',quality_reasons:[],reply_preview:null,characters:0,latency_ms:performance.now()-started,model_status:status,dimensions:null});}
   }
   const failures=turns.flatMap(t=>t.failures);cases.push({id:scenario.id,turns,objective_pass:failures.length===0,request_count:requestCount,unique_inbound:owned.size,tracked_inbound:owned.size,tracking_states:[...owned.values()],fake_ack_count:transport.effects.length});
  }
  variants.push({style,cases,scenario_count:cases.length,objective_passed:cases.filter(c=>c.objective_pass).length,turn_count:cases.reduce((s,c)=>s+c.turns.length,0),request_count:cases.reduce((s,c)=>s+c.request_count,0)});
 }
 return{model_observations:observations,model_summary:summarizePolatModelObservations(observations,polatFixture().tenant_id),version:1,corpus_version:corpus?.version??POLAT_MULTITURN_CORPUS_VERSION,corpus_hash:corpus?.hash??polatMultiTurnCorpusHash(),classification:'SYNTHETIC',method:corpus?'FIXED_PAIRED_MULTITURN_V2':'FIXED_PAIRED_MULTITURN_V1',provider:'mock',model:POLAT_TEST_PROFILE,variants,total_requests:totalRequests,valid_tracking_states:POLAT_INBOUND_STATES,history_basis:'OFFLINE_FAKE_ACK_AND_FIXTURE_SEQUENCE_CLOCK',database_acceptance:false,human_naturalness:'NOT_MEASURED',customer_satisfaction:null,live_conversion_rate:null,verified_revenue:null,actual_model_cost:null,input_tokens:null,output_tokens:null,financial_authority:'NONE',live_operations_authorized:false,commercial_verdict:'NO_GO',dispatch:'FAKE_ONLY'}as const;
}
