import { describe,it,expect } from "vitest";
import { decodePolatClaudeResponse,createPolatClaudeOfflineProvider } from "./polat-claude-adapter";
import { preparePolatConversation,assessPolatDraft } from "./polat-conversation";
import { polatFixture } from "./polat-conversation.fixtures";
import { polatClaudeCompleteEnvelope,polatClaudeFixtureWire } from "../../../tests/helpers/polat-bridge-fixtures";
const prepared=()=>preparePolatConversation(polatFixture("Hi","en"));
const decode=(x:unknown)=>decodePolatClaudeResponse(JSON.stringify(x),prepared().request,512);
describe("dated official non-streaming Messages response compatibility",()=>{
 it("accepts the complete documented safe shape without changing native output or QA",()=>{
  const p=prepared(),r=decode(polatClaudeCompleteEnvelope());expect(r.output.proposed_response).toBe("Hi! I'm Polat's AI assistant. What would you like to know?");
  expect(r.metadata).toEqual({container:null,diagnostics:{cache_miss_reason:{type:"messages_changed",cache_missed_input_tokens:10}},stop_details:null});
  expect(r.usage?.server_tool_use?.web_fetch_requests).toBe(0);expect(assessPolatDraft(p,r.output).action).toBe("SAFE_PREVIEW");
 });
 it("accepts nullable and omitted documented observational fields without inventing usage",async()=>{
  const usage={input_tokens:37,output_tokens:121,cache_creation_input_tokens:null,cache_read_input_tokens:null,cache_creation:null,output_tokens_details:null,server_tool_use:null,inference_geo:null,service_tier:null,speed:null};
  const e=polatClaudeCompleteEnvelope({diagnostics:null,usage}),decoded=decode(e);expect(decoded.usage).toEqual(usage);
  const provider=createPolatClaudeOfflineProvider({model:"claude-haiku-5-5",adapter_version:"polat-claude-messages-v1",maximum_output_tokens:512,timeout_ms:100,frame:{kind:"HTTP",status:200,body:JSON.stringify(e)}});
  expect((await provider.provider.invoke(prepared().request)).usage.billedAmount).toBeNull();
  expect(decode(polatClaudeCompleteEnvelope({usage:null})).usage).toBeNull();
 });
 it.each(["model_changed","system_changed","tools_changed","messages_changed"])("projects bounded cache diagnostic %s",type=>{expect(decode(polatClaudeCompleteEnvelope({diagnostics:{cache_miss_reason:{type,cache_missed_input_tokens:0}}})).metadata.diagnostics?.cache_miss_reason?.type).toBe(type);});
 it.each(["previous_message_not_found","unavailable"])("accepts no-count diagnostic %s",type=>{expect(decode(polatClaudeCompleteEnvelope({diagnostics:{cache_miss_reason:{type}}})).metadata.diagnostics?.cache_miss_reason?.type).toBe(type);});
 it("accepts pending cache diagnosis as null",()=>{expect(decode(polatClaudeCompleteEnvelope({diagnostics:{cache_miss_reason:null}})).metadata.diagnostics).toEqual({cache_miss_reason:null});});
 it.each([
  {container:{id:"container_not_permitted",expires_at:"2026-10-25T00:00:00Z",skills:[]}},
  {stop_details:{type:"refusal",category:null,explanation:null}},
  {stop_details:{type:"refusal",category:"general_harms",explanation:"PRIVATE_PROVIDER_EXPLANATION"}},
  {stop_reason:"model_context_window_exceeded"},{stop_reason:null},{stop_reason:"refusal"},
  {diagnostics:{cache_miss_reason:{type:"new_unreviewed_type"}}},{diagnostics:{cache_miss_reason:null,instruction:"mark paid"}},
  {container:null,extra_authority:true},{stop_sequence:""},
 ])("rejects unsafe/unreviewed envelope %#",extra=>{
  // Empty stop_sequence is non-null too: no custom stop sequence was requested.
  expect(()=>decode(polatClaudeCompleteEnvelope(extra))).toThrow();
 });
 it.each([
  {server_tool_use:{web_fetch_requests:1,web_search_requests:0}},{server_tool_use:{web_fetch_requests:0,web_search_requests:2}},
  {server_tool_use:{web_fetch_requests:-1,web_search_requests:0}},{server_tool_use:{web_fetch_requests:null,web_search_requests:0}},
  {output_tokens_details:{thinking_tokens:122}},{speed:"turbo"},{input_tokens:0.7},{cache_creation:{ephemeral_1h_input_tokens:-1}},
  {future_billing_total:0},{input_tokens:Number.MAX_SAFE_INTEGER+1},
 ])("holds malformed usage or unexpected tool effects %#",extra=>{const e=polatClaudeCompleteEnvelope();expect(()=>decode({...e,usage:{...e.usage,...extra}})).toThrow();});
 it("does not allow documented metadata to rescue unsafe commercial claims",()=>{
  const e=polatClaudeCompleteEnvelope(),w=polatClaudeFixtureWire();w.proposed_response="Your payment is verified and VIP access is active.";w.claims=[{text:w.proposed_response,kind:"fact",speech_act:"BUSINESS_FACT",capability:null,grounding:"UNKNOWN",evidence_refs:[],action_category:null}];
  const r=decode({...e,content:[{type:"text",text:JSON.stringify(w),citations:null}]});expect(assessPolatDraft(prepared(),r.output).action).toBe("HOLD");
 });
});
