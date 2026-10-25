import{polatModelObservationSchema,polatOfflineClaudeObservationSchema,POLAT_CLAUDE_MODEL,type PolatModelObservation,type PolatClaudeUsage}from "@gold-revenue-os/contracts";
import{ModelProviderError,type ModelRequest,type ModelResponse}from "./agent-runtime";
import{PolatFixtureProvider,type PreparedPolatConversation}from "./polat-conversation";

export function polatFixtureMeasurement(scope:{tenantId:string;conversationId:string;invocationId:string;promptVersion:string;personaVersion:string},elapsedMs:number,response:ModelResponse|null,failure:ModelProviderError|null):PolatModelObservation{
 if(response&&(response.provider!=="mock"||!["polat-fixture-v1","polat-test-runtime-v1"].includes(response.model)))throw Error("POLAT_EXTERNAL_OBSERVATION_DENIED");
 return polatModelObservationSchema.parse({...modelMeasurement(scope,elapsedMs,response,failure),version:1,source:"FIXTURE_PROVIDER",provider:"mock",model:response?.model??"polat-test-runtime-v1"});
}
function modelMeasurement(scope:Parameters<typeof polatFixtureMeasurement>[0],elapsedMs:number,response:ModelResponse|null,failure:ModelProviderError|null){
 const status=failure?.kind==="TIMEOUT"?"TIMED_OUT":failure?.kind==="RATE_LIMIT"?"RATE_LIMITED":failure?.kind==="INVALID_OUTPUT"?"INVALID_OUTPUT":failure?"PROVIDER_ERROR":"SUCCEEDED";
 if(!response&&!failure)throw Error("POLAT_MODEL_RESULT_MISSING");
 return {mode:"SYNTHETIC",financial_authority:"NONE",live_operations_authorized:false,tenant_id:scope.tenantId,conversation_id:scope.conversationId,invocation_id:scope.invocationId,prompt_version:scope.promptVersion,persona_version:scope.personaVersion,status,retry:failure?.retryable?"BOUNDED_BACKOFF":failure?"REVIEW":"NONE",elapsed_ms:elapsedMs,provider_latency_ms:response?.latencyMs??null,time_to_first_response_ms:null,usage:{input_tokens:response?.usage.inputTokens??null,output_tokens:response?.usage.outputTokens??null,total_tokens:response?.usage.totalTokens??null},billing:null,qa:"NOT_EVALUATED",flags:[],completion:"NOT_COMPLETED"};
}

/** Reuse fixture measurement normalization while keeping the actual response identity and counters. */
export function polatOfflineClaudeMeasurement(scope:Parameters<typeof polatFixtureMeasurement>[0],elapsedMs:number,response:ModelResponse|null,failure:ModelProviderError|null,extra:{provider_usage:PolatClaudeUsage|null;response_hash:string|null}){
 if(response&&(response.provider!=="anthropic"||response.model!==POLAT_CLAUDE_MODEL))throw Error("POLAT_CLAUDE_OBSERVATION_IDENTITY_DENIED");
 return polatOfflineClaudeObservationSchema.parse({...modelMeasurement(scope,elapsedMs,response,failure),version:2,source:"OFFLINE_CLAUDE_HTTP",provider:"anthropic",model:POLAT_CLAUDE_MODEL,real_model_execution:false,retry:"NONE",provider_usage:extra.provider_usage,response_hash:extra.response_hash});
}

/** Construct the fixture internally. This runner cannot select an external provider. */
export async function observePolatFixture(prepared:PreparedPolatConversation,request:ModelRequest,scope:{tenantId:string;conversationId:string;invocationId:string;promptVersion:string;personaVersion:string}){
 if(scope.tenantId!==prepared.input.tenant_id||scope.conversationId!==prepared.input.conversation_id)throw Error("POLAT_MODEL_SCOPE_DENIED");
 const started=performance.now();let response:ModelResponse|null=null,failure:ModelProviderError|null=null;
 try{response=await new PolatFixtureProvider(prepared).invoke(request);}catch(e){failure=e instanceof ModelProviderError?e:new ModelProviderError("PROVIDER_ERROR","FIXTURE_FAILURE",false);}
 const observation=polatFixtureMeasurement(scope,performance.now()-started,response,failure);
 return{response,failure,observation};
}
/** Safe structured diagnostic: deliberately excludes all scope IDs and input/output text. */
export function safePolatModelObservation(raw:unknown,role:"super_admin"|"manager"|"support"|"analyst"|"readonly"){
 if(!["super_admin","manager","support","analyst"].includes(role))throw Error("POLAT_MODEL_READ_DENIED");const v=polatModelObservationSchema.parse(raw);const{tenant_id:_t,conversation_id:_c,invocation_id:_i,billing,...safe}=v;void _t;void _c;void _i;
 return{...safe,billing:role==="support"?null:billing,billing_visibility:role==="support"?"ROLE_RESTRICTED":"SIMULATED_ONLY"};
}
/** One invocation ID is one cost source; conflicting repeats are never silently added. */
export function summarizePolatModelObservations(raw:readonly unknown[],tenantId:string){
 if(raw.length>1000)throw Error("POLAT_MODEL_SAMPLE_LIMIT");const seen=new Map<string,PolatModelObservation>();
 for(const item of raw){const v=polatModelObservationSchema.parse(item);if(v.tenant_id!==tenantId)throw Error("POLAT_MODEL_SCOPE_DENIED");const old=seen.get(v.invocation_id);if(old&&JSON.stringify(old)!==JSON.stringify(v))throw Error("POLAT_MODEL_REPLAY_CONFLICT");seen.set(v.invocation_id,v);}
 const rows=[...seen.values()],latencies=rows.flatMap(v=>v.elapsed_ms===null?[]:[v.elapsed_ms]).sort((a,b)=>a-b);
 const q=(p:number)=>latencies.length?latencies[Math.ceil(p*latencies.length)-1]!:null;
 const tokenSum=(key:"input_tokens"|"output_tokens")=>rows.length&&rows.every(v=>v.usage[key]!==null)?rows.reduce((sum,v)=>sum+BigInt(v.usage[key]!),0n).toString():null;
 // No estimate, price table, FX or numeric provider billing conversion.
 const currencies=new Map<string,{units:bigint;scale:number;sample:number}>();for(const v of rows){if(!v.billing)continue;const[a,b=""]=v.billing.amount.split("."),old=currencies.get(v.billing.currency)??{units:0n,scale:0,sample:0},scale=Math.max(old.scale,b.length);currencies.set(v.billing.currency,{units:old.units*10n**BigInt(scale-old.scale)+BigInt(a!+b)*10n**BigInt(scale-b.length),scale,sample:old.sample+1});}
 return{mode:"SYNTHETIC"as const,financial_authority:"NONE"as const,live_operations_authorized:false as const,count:rows.length,success:rows.filter(v=>v.status==="SUCCEEDED").length,errors:rows.filter(v=>v.status!=="SUCCEEDED").length,qa_held:rows.filter(v=>v.qa==="HELD").length,completed_fake:rows.filter(v=>v.completion==="FAKE_ACKNOWLEDGED").length,latency:{sample:latencies.length,p50_ms:q(.5),p95_ms:q(.95),p99_ms:q(.99)},tokens:{input:tokenSum("input_tokens"),output:tokenSum("output_tokens")},billing:{known:rows.filter(v=>v.billing!==null).length,coverage:rows.length?rows.filter(v=>v.billing!==null).length/rows.length:null,amounts:[...currencies].map(([currency,v])=>{const padded=v.units.toString().padStart(v.scale+1,"0");return{currency,amount:v.scale?`${padded.slice(0,-v.scale)}.${padded.slice(-v.scale)}`:padded,sample:v.sample,basis:"SIMULATED_PROVIDER_REPORT"as const};})},human_ratings:"NOT_MEASURED"as const};
}
