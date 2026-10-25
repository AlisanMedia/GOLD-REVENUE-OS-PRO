import { beforeEach,afterEach,describe,it,expect,vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ClientRequest,IncomingMessage,RequestOptions } from "node:http";
import type { PolatVerifiedNetworkContext } from "./polat-experiment-execution-gate";
import { preparePolatConversation,assessPolatDraft } from "./polat-conversation";
import { polatFixture } from "./polat-conversation.fixtures";
import { preparePolatClaudeRequest } from "./polat-claude-adapter";
import { polatBridgeFixtureBinding,polatClaudeCompleteEnvelope,polatClaudeFixtureWire } from "../../../tests/helpers/polat-bridge-fixtures";
const fixture=vi.hoisted(()=>({context:null as unknown as PolatVerifiedNetworkContext,status:200,body:null as Buffer|null,delay:0,headers:{} as Record<string,string>,failure:"",silent:false,partial:false,constructorFailure:false,calls:[] as Array<{options:RequestOptions;body:string}>,destroyed:0}));
vi.mock("./polat-experiment-execution-gate",()=>({requirePolatNetworkPermit:()=>fixture.context}));
vi.mock("node:https",()=>({request:(options:RequestOptions,callback:(r:IncomingMessage)=>void)=>{
  if(fixture.constructorFailure)throw Error("PRIVATE_SYNTHETIC_KEY_AND_PROMPT");
  const socket=new EventEmitter()as EventEmitter&{end:(body:string)=>void;destroy:()=>void};
  socket.destroy=()=>{fixture.destroyed++;};
  socket.end=body=>{fixture.calls.push({options,body});queueMicrotask(()=>{
    if(fixture.failure){socket.emit("error",Error(fixture.failure));return;}if(fixture.silent)return;
    const response=new EventEmitter()as EventEmitter&{statusCode:number;headers:Record<string,string>;resume:()=>void};response.statusCode=fixture.status;response.headers={"content-type":"application/json","request-id":"req_offline_fixture",...fixture.headers};response.resume=()=>{};
    callback(response as unknown as IncomingMessage);
    setTimeout(()=>{if(fixture.partial){response.emit("aborted");return;}response.emit("data",fixture.body??Buffer.from(JSON.stringify(polatClaudeCompleteEnvelope())));response.emit("end");},fixture.delay);
  });};return socket as unknown as ClientRequest;
}}));
import { sendPolatClaudeHttpsOnce } from "./polat-claude-https-boundary";
const request=()=>({...preparePolatConversation(polatFixture("Hi","en")).request,timeoutMs:50});
beforeEach(()=>{
  const r=request(),b=polatBridgeFixtureBinding({timeout_ms:50}),w=preparePolatClaudeRequest(r,512);
  fixture.context={binding:b,run_id:"91cb2000-0000-4000-8000-000000000001",attempt_id:"91cb3000-0000-4000-8000-000000000001",request_hash:w.request_hash,body_hash:w.body_hash,credential:"SYNTHETIC_NOT_A_CREDENTIAL"};
  Object.assign(fixture,{status:200,body:null,delay:0,headers:{},failure:"",silent:false,partial:false,constructorFailure:false,calls:[],destroyed:0});
});
afterEach(()=>vi.restoreAllMocks());
describe("dormant genuine HTTPS implementation through an injected offline socket boundary",()=>{
 it("sends exactly one fixed-host bounded request and decodes the actual complete response",async()=>{
  const r=await sendPolatClaudeHttpsOnce({},request());expect(fixture.calls).toHaveLength(1);const q=fixture.calls[0]!;
  expect(q.options).toMatchObject({protocol:"https:",hostname:"api.anthropic.com",port:443,path:"/v1/messages",method:"POST",maxHeaderSize:8192});
  expect(q.options.headers).toMatchObject({"anthropic-version":"2023-06-01","x-client-request-id":fixture.context.attempt_id});
  const body:unknown=JSON.parse(q.body);expect(body).toMatchObject({model:"claude-haiku-5-5",max_tokens:512,stream:false});for(const k of ["temperature","top_p","top_k","tools"])expect(body).not.toHaveProperty(k);
  expect(r.response.usage.billedAmount).toBeNull();expect(r.response.usage.totalTokens).toBeNull();expect(r.provider_usage?.speed).toBe("standard");expect(r.response.latencyMs).toBeGreaterThanOrEqual(0);expect(r.automatic_retries).toBe(0);
 });
 it.each([[301,"CLAUDE_REDIRECT_DENIED"],[307,"CLAUDE_REDIRECT_DENIED"],[401,"CLAUDE_AUTH_DENIED"],[403,"CLAUDE_AUTH_DENIED"],[429,"CLAUDE_RATE_LIMIT"],[500,"CLAUDE_HTTP_FAILURE"],[529,"CLAUDE_HTTP_FAILURE"]])("maps %s without following Location or making another call",async(status,code)=>{
  fixture.status=status;fixture.headers={location:"https://untrusted.invalid/steal"};fixture.body=Buffer.from("PRIVATE_SYNTHETIC_BODY");await expect(sendPolatClaudeHttpsOnce({},request())).rejects.toMatchObject({code,retryable:false});expect(fixture.calls).toHaveLength(1);
 });
 it("stops unknown timeout without retry even if the delayed response arrives",async()=>{fixture.delay=65;await expect(sendPolatClaudeHttpsOnce({},request())).rejects.toMatchObject({code:"CLAUDE_TIMEOUT_UNKNOWN",outcome_unknown:true});await new Promise(r=>setTimeout(r,25));expect(fixture.calls).toHaveLength(1);expect(fixture.destroyed).toBe(1);});
 it("honors abort without authorizing another attempt",async()=>{
  const c=new AbortController();fixture.silent=true;const p=sendPolatClaudeHttpsOnce({},request(),c.signal);c.abort();await expect(p).rejects.toMatchObject({code:"CLAUDE_ABORT_UNKNOWN",outcome_unknown:true});expect(fixture.calls).toHaveLength(1);
  await expect(sendPolatClaudeHttpsOnce({},request())).rejects.toThrow("REPLAY_DENIED");expect(fixture.calls).toHaveLength(1);
 });
 it("creates no socket for a signal already aborted before the attempt",async()=>{const c=new AbortController();c.abort();await expect(sendPolatClaudeHttpsOnce({},request(),c.signal)).rejects.toThrow("BEFORE_ATTEMPT");expect(fixture.calls).toHaveLength(0);});
 it.each(["connection","partial","oversize","utf8","header","type"])("bounds and redacts %s failure",async(kind)=>{
  if(kind==="connection")fixture.failure="RAW_PRIVATE_PROMPT_AND_SECRET";if(kind==="partial")fixture.partial=true;if(kind==="oversize")fixture.body=Buffer.alloc(65537,65);if(kind==="utf8")fixture.body=Buffer.from([255]);if(kind==="header")fixture.headers={"x-client-request-id":"different_attempt"};if(kind==="type")fixture.headers={"content-type":"text/html"};
  try{await sendPolatClaudeHttpsOnce({},request());throw Error("EXPECTED_FAILURE");}catch(e){expect(e).toMatchObject({retryable:false});expect(String(e)).not.toContain("RAW_PRIVATE");}expect(fixture.calls).toHaveLength(1);
 });
 it("redacts synchronous HTTP errors and does not log credentials or prompts",async()=>{
  const logs=[vi.spyOn(console,"log"),vi.spyOn(console,"warn"),vi.spyOn(console,"error")];fixture.constructorFailure=true;await expect(sendPolatClaudeHttpsOnce({},request())).rejects.toThrow("CLAUDE_REQUEST_START_UNKNOWN");logs.forEach(log=>expect(log).not.toHaveBeenCalled());
 });
 it("rejects changed body/request before dispatch and never reuses the failed reservation",async()=>{
  fixture.context.body_hash="e".repeat(64);await expect(sendPolatClaudeHttpsOnce({},request())).rejects.toThrow("DRIFT");expect(fixture.calls).toHaveLength(0);
  fixture.context.body_hash=preparePolatClaudeRequest(request(),512).body_hash;await expect(sendPolatClaudeHttpsOnce({},request())).rejects.toThrow("REPLAY_DENIED");expect(fixture.calls).toHaveLength(0);
 });
 it("rejects a mismatched response model without an automatic fallback",async()=>{fixture.body=Buffer.from(JSON.stringify(polatClaudeCompleteEnvelope({model:"other"})));await expect(sendPolatClaudeHttpsOnce({},request())).rejects.toThrow("ENVELOPE_INVALID");expect(fixture.calls).toHaveLength(1);});
 it("uses an immutable source snapshot while the fake request is in flight",async()=>{
  fixture.delay=5;const r=request(),pending=sendPolatClaudeHttpsOnce({},r);r.context.commercialEvidence=[];
  const result=await pending;expect(result.response.output.claims[1]?.evidence_refs).toEqual(["polat:identity:v1"]);expect(fixture.calls).toHaveLength(1);
 });
 it("passes unsafe actual model text to native QA instead of a safe substitute",async()=>{
  const e=polatClaudeCompleteEnvelope(),w=polatClaudeFixtureWire();w.proposed_response="Your payment is verified and VIP access is active.";w.claims=[{text:w.proposed_response,kind:"fact",speech_act:"BUSINESS_FACT",capability:null,grounding:"UNKNOWN",evidence_refs:[],action_category:null}];fixture.body=Buffer.from(JSON.stringify({...e,content:[{type:"text",text:JSON.stringify(w),citations:null}]}));
  const r=await sendPolatClaudeHttpsOnce({},request());expect(r.response.output.proposed_response).toBe(w.proposed_response);expect(assessPolatDraft(preparePolatConversation(polatFixture("Hi","en")),r.response.output).action).toBe("HOLD");expect(fixture.calls).toHaveLength(1);
 });
});
