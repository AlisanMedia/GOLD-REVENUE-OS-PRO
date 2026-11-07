import { IDENTITY_DOMAINS_V1 } from "@gold-revenue-os/contracts";
import{createHash}from "node:crypto";
import{jeffResponseCommandSchema,jeffResponseReceiptSchema,jeffInboundStateSchema,type JeffResponseCommand,type JeffResponseReceipt,jeffSalesInputSchema}from "@gold-revenue-os/contracts";
import{buildJeffSalesPreview}from "./jeff-sales";
import{canonicalFinancialJson}from "./financial-source-canonical";
import{prepareJeffConversation,assessJeffDraft,JeffFixtureProvider}from "./jeff-conversation";
import{ModelProviderError,type ModelResponse}from "./agent-runtime";
const digest=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
const key=(v:JeffResponseCommand)=>JSON.stringify([IDENTITY_DOMAINS_V1["JEFF_FAKE1"],v.tenant_id,v.conversation_id,v.message_id,v.operation_id]);
export function jeffReceipt(command:JeffResponseCommand,result:JeffResponseReceipt["result"]):JeffResponseReceipt{return jeffResponseReceiptSchema.parse({version:1,mode:"SYNTHETIC",origin:"FAKE",tenant_id:command.tenant_id,conversation_id:command.conversation_id,message_id:command.message_id,operation_id:command.operation_id,body_hash:command.body_hash,result,reference:result==="FAKE_ACK"?`jeff-fake:${command.operation_id}`:null});}
export function bindJeffReceipt(raw:unknown,command:JeffResponseCommand){const r=jeffResponseReceiptSchema.parse(raw);for(const field of["tenant_id","conversation_id","message_id","operation_id","body_hash"]as const)if(r[field]!==command[field])throw Error("JEFF_RECEIPT_SCOPE_MISMATCH");return r;}
export class FakeJeffTransport{
 readonly mode="SYNTHETIC";#effects:JeffResponseCommand[]=[];#cursor=0;
 get effects():ReadonlyArray<JeffResponseCommand>{return structuredClone(this.#effects);}
 #ledger=new Map<string,{factHash:string;receipt:JeffResponseReceipt}>();
 constructor(private readonly plan:ReadonlyArray<"ACK"|"UNKNOWN_AFTER_EFFECT"|"FAILED_BEFORE_SEND">=["ACK"],private readonly delayMs=0){if(!Number.isInteger(delayMs)||delayMs<0||delayMs>1000)throw Error("FAKE_DELAY_INVALID");}
 async send(raw:unknown,body:string,allowed:()=>Promise<boolean>):Promise<JeffResponseReceipt>{
  const command=jeffResponseCommandSchema.parse(raw);const factHash=digest(JSON.stringify(command));if(body.length>600)throw Error("JEFF_BODY_LIMIT");if(digest(body)!==command.body_hash)throw Error("JEFF_BODY_HASH_MISMATCH");
  const existing=this.#ledger.get(key(command));if(existing){if(existing.factHash!==factHash)throw Error("JEFF_OPERATION_CONFLICT");return structuredClone(existing.receipt);}
  if(this.delayMs)await new Promise(resolve=>setTimeout(resolve,this.delayMs));
  if(!await allowed()){const denied=jeffReceipt(command,"FAILED_BEFORE_SEND");this.#ledger.set(key(command),{factHash,receipt:Object.freeze(denied)});return structuredClone(denied);}
  // Recheck after awaited guard: overlapping fake sends still have one effect.
  const concurrent=this.#ledger.get(key(command));if(concurrent){if(concurrent.factHash!==factHash)throw Error("JEFF_OPERATION_CONFLICT");return structuredClone(concurrent.receipt);}
  const outcome=this.plan[this.#cursor++]??"FAILED_BEFORE_SEND";
  if(outcome==="FAILED_BEFORE_SEND"){const failed=jeffReceipt(command,"FAILED_BEFORE_SEND");this.#ledger.set(key(command),{factHash,receipt:Object.freeze(failed)});return structuredClone(failed);}
  const receipt=jeffReceipt(command,"FAKE_ACK");this.#ledger.set(key(command),{factHash,receipt:Object.freeze(receipt)});this.#effects.push(command);
  return outcome==="UNKNOWN_AFTER_EFFECT"?jeffReceipt(command,"UNKNOWN"):structuredClone(receipt);
 }
 observe(command:JeffResponseCommand):JeffResponseReceipt|null{const c=jeffResponseCommandSchema.parse(command),entry=this.#ledger.get(key(c));if(entry&&entry.factHash!==digest(JSON.stringify(c)))throw Error("JEFF_OPERATION_CONFLICT");return entry?structuredClone(entry.receipt):null;}
}
export interface JeffFixtureResponseStore{
 readonly mode:"SYNTHETIC";
 prepare(command:JeffResponseCommand,body?:string):Promise<unknown>;
 canDispatch(command:JeffResponseCommand):Promise<boolean>;
 record(receipt:JeffResponseReceipt):Promise<unknown>;
 hold(input:{tenant_id:string;message_id:string;generation:string;reason:"QA_HOLD"|"MODEL_UNAVAILABLE"}):Promise<unknown>;
}
class JeffFixtureTimeout extends Error{}
function limited<T>(promise:Promise<T>,milliseconds:number):Promise<T>{
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new JeffFixtureTimeout("JEFF_FIXTURE_STEP_TIMEOUT")),milliseconds);promise.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e instanceof Error?e:new Error("JEFF_FIXTURE_STEP_ERROR"));});});
}
export async function runJeffResponseFixture(args:{input:unknown;operationId:string;generation:string;store:JeffFixtureResponseStore;transport:FakeJeffTransport;stepTimeoutMs?:number;sales?:unknown}){
 const budget=args.stepTimeoutMs??1000;if(!Number.isInteger(budget)||budget<1||budget>1000)throw Error("JEFF_STEP_BUDGET_INVALID");
 let cancelled=false;
 if(args.store.mode!=="SYNTHETIC"||!(args.transport instanceof FakeJeffTransport))throw Error("JEFF_FIXTURE_ONLY");
 const p=prepareJeffConversation(args.input);const salesInput=args.sales===undefined?null:jeffSalesInputSchema.parse(args.sales);if(salesInput&&canonicalFinancialJson(salesInput.conversation)!==canonicalFinancialJson(p.input))throw Error("JEFF_SALES_RESPONSE_SCOPE_MISMATCH");const salesStart=performance.now(),sales=salesInput?buildJeffSalesPreview(salesInput):null;let result:ModelResponse;
 try{result=sales?{output:sales.output,provider:"mock",model:"jeff-sales-fixture-v1",providerRequestId:null,latencyMs:performance.now()-salesStart,usage:{inputTokens:null,outputTokens:null,totalTokens:null,billedAmount:null,billedCurrency:null}}:await new JeffFixtureProvider(p).invoke(p.request);}catch(error){
  if(!(error instanceof ModelProviderError))throw error;
  let held:unknown;try{held=await limited(args.store.hold({tenant_id:p.input.tenant_id,message_id:p.input.source_message_id,generation:args.generation,reason:"MODEL_UNAVAILABLE"}),budget);}catch(e){if(!(e instanceof JeffFixtureTimeout))throw e;return{state:"AI_RESPONSE_PENDING",quality:null,delivery:"NOT_SENT",persistence:"UNCONFIRMED",financial_authority:"NONE",live_operations_authorized:false}as const;}
  return {state:jeffInboundStateSchema.parse(held),quality:null,delivery:"NOT_SENT",model_failure:error.kind,financial_authority:"NONE",live_operations_authorized:false}as const;
 }
 const quality=sales?.quality??assessJeffDraft(p,result.output);
 if(quality.action!=="SAFE_PREVIEW"){
  let held:unknown;try{held=await limited(args.store.hold({tenant_id:p.input.tenant_id,message_id:p.input.source_message_id,generation:args.generation,reason:"QA_HOLD"}),budget);}catch(e){if(!(e instanceof JeffFixtureTimeout))throw e;return{state:"AI_RESPONSE_PENDING",quality,delivery:"NOT_SENT",persistence:"UNCONFIRMED",financial_authority:"NONE",live_operations_authorized:false}as const;}
  return {state:jeffInboundStateSchema.parse(held),quality,delivery:"NOT_SENT",financial_authority:"NONE",live_operations_authorized:false}as const;
 }
 const command=jeffResponseCommandSchema.parse({version:1,mode:"SYNTHETIC",tenant_id:p.input.tenant_id,conversation_id:p.input.conversation_id,message_id:p.input.source_message_id,operation_id:args.operationId,generation:args.generation,source_hash:digest(p.input.messages.at(-1)!.content),body_hash:digest(result.output.proposed_response),actor:"AI"});
 let prepared:unknown;try{prepared=await limited(args.store.prepare(command,result.output.proposed_response),budget);}catch(e){if(!(e instanceof JeffFixtureTimeout))throw e;return{state:"DELIVERY_UNKNOWN",quality,delivery:"UNKNOWN",persistence:"UNCONFIRMED",financial_authority:"NONE",live_operations_authorized:false}as const;}
 if(!prepared||typeof prepared!=="object"||!("state"in prepared))throw Error("JEFF_PREPARE_INVALID");
 if(prepared.state!=="PREPARED")return {state:jeffInboundStateSchema.parse(prepared.state),quality,delivery:"NOT_SENT",financial_authority:"NONE",live_operations_authorized:false}as const;
 if(!("operation_id"in prepared)||prepared.operation_id!==command.operation_id||!("generation"in prepared)||prepared.generation!==command.generation||!("mode"in prepared)||prepared.mode!=="SYNTHETIC")throw Error("JEFF_PREPARE_SCOPE_MISMATCH");
 let receipt:JeffResponseReceipt,state:ReturnType<typeof jeffInboundStateSchema.parse>;
 try{
  receipt=bindJeffReceipt(await limited(args.transport.send(command,result.output.proposed_response,async()=>{if(cancelled)return false;const yes=await args.store.canDispatch(command);return yes&&!cancelled;}),budget),command);
  state=jeffInboundStateSchema.parse(await limited(args.store.record(receipt),budget));
 }catch(e){if(!(e instanceof JeffFixtureTimeout))throw e;cancelled=true;return{state:"DELIVERY_UNKNOWN",quality,delivery:"UNKNOWN",persistence:"UNCONFIRMED",financial_authority:"NONE",live_operations_authorized:false}as const;}
 if(state==="AI_RESPONDED"&&receipt.result!=="FAKE_ACK")throw Error("JEFF_FALSE_DELIVERY_STATE");
 return {state,quality,delivery:state==="DELIVERY_UNKNOWN"?"UNKNOWN":receipt.result==="FAKE_ACK"?"FAKE_ACKNOWLEDGED":receipt.result==="UNKNOWN"?"UNKNOWN":"NOT_SENT",financial_authority:"NONE",live_operations_authorized:false}as const;
}
export function jeffOverdueContract(input:{receivedAt:string;now:string;state:string;sandboxAckAt:string|null;thresholdSeconds:number}){
 const a=Date.parse(input.receivedAt),b=Date.parse(input.now);jeffInboundStateSchema.parse(input.state);
 const ack=input.sandboxAckAt===null?null:Date.parse(input.sandboxAckAt);
 if(ack!==null&&(!Number.isFinite(ack)||ack<a||ack>b))throw Error("JEFF_TIME_CONTRACT_INVALID");
 if(!Number.isFinite(a)||!Number.isFinite(b)||b<a||!Number.isInteger(input.thresholdSeconds)||input.thresholdSeconds<1||input.thresholdSeconds>86400)throw Error("JEFF_TIME_CONTRACT_INVALID");
 return {age_seconds:Math.floor((b-a)/1000),overdue:input.sandboxAckAt===null&&!['BLOCKED_WITH_REASON','CLOSED_WITH_EVIDENCE'].includes(input.state)&&b-a>input.thresholdSeconds*1000,notification:"PREVIEW_ONLY",dispatch:"DISABLED",financial_authority:"NONE"}as const;
}
