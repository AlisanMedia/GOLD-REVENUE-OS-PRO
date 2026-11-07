import { describe,it,expect,vi } from "vitest";
import { randomUUID,generateKeyPairSync,sign } from "node:crypto";
import { jeffBridgeSignatureBytes,verifyJeffBridgeSignatures,jeffGenuineExecutionGate,requireJeffNetworkPermit,type JeffBridgeSignatureEnvelope,type JeffBridgePublicKeys } from "./jeff-experiment-execution-gate";
import { jeffBridgeFixtureBinding } from "../../../tests/helpers/jeff-bridge-fixtures";
import { jeffGuardDigest } from "./jeff-experiment-journal";
import { jeffClaudeCanaryPlan } from "./jeff-claude-canary";
import { jeffModelAcceptanceManifest } from "./jeff-model-acceptance";
import { sendJeffClaudeHttpsOnce } from "./jeff-claude-https-boundary";
import { prepareJeffConversation } from "./jeff-conversation";
import { jeffFixture } from "./jeff-conversation.fixtures";
const socket=vi.hoisted(()=>vi.fn(()=>{throw Error("EXTERNAL_SOCKET_FORBIDDEN");}));
vi.mock("node:https",()=>({request:socket}));

function setup(bindingExtra:Record<string,unknown>={},payloadExtra:Record<string,unknown>={}){
 const b=jeffBridgeFixtureBinding(bindingExtra),now=Date.now(),roles=["owner","account_control","committed_reservation"] as const;
 const pairs=roles.map(()=>generateKeyPairSync("ed25519"));
 const keys=Object.fromEntries(roles.map((role,i)=>[role,{key_id:role+"_fixture_key",key:pairs[i]!.publicKey}])) as unknown as JeffBridgePublicKeys;
 const payload:JeffBridgeSignatureEnvelope["payload"]={version:1,purpose:"JEFF_CONTROLLED_EXPERIMENT",run_id:randomUUID(),attempt_id:randomUUID(),binding_hash:jeffGuardDigest(b),request_hash:"e".repeat(64),body_hash:"f".repeat(64),account_scope_hash:b.account_scope_hash,authorization_record_hash:b.authorization_record_hash,reserved_request_count:1,reserved_liability:"0.02",issued_at:new Date(now-1000).toISOString(),expires_at:new Date(now+20000).toISOString(),nonce:randomUUID(),...payloadExtra};
 const e={payload,...Object.fromEntries(roles.map((role,i)=>[role,{key_id:keys[role].key_id,signature:sign(null,jeffBridgeSignatureBytes(role,keys[role].key_id,payload),pairs[i]!.privateKey).toString("base64url")}]))}as JeffBridgeSignatureEnvelope;
 const expected={run_id:payload.run_id,attempt_id:payload.attempt_id,request_hash:payload.request_hash,body_hash:payload.body_hash};return{b,now,keys,e,expected};
}
describe("independent signature contract without execution authority",()=>{
 it("validates three distinct offline keys but cannot issue a genuine transport permit",()=>{
  const s=setup();expect(verifyJeffBridgeSignatures(s.e,s.keys,s.b,s.expected,s.now)).toBe(true);expect(()=>requireJeffNetworkPermit(s.e)).toThrow("BLOCKED");expect(jeffGenuineExecutionGate()).toMatchObject({state:"BLOCKED",authorized_external_requests:0,execution_enabled:false});
 });
 it.each(["owner","account_control","committed_reservation"] as const)("requires authentic independent %s proof",role=>{const s=setup();s.e[role].signature="A".repeat(86);expect(verifyJeffBridgeSignatures(s.e,s.keys,s.b,s.expected,s.now)).toBe(false);});
 it("denies the same identity pretending to be independent control planes",()=>{const s=setup(),keys={...s.keys,account_control:s.keys.owner};expect(verifyJeffBridgeSignatures(s.e,keys,s.b,s.expected,s.now)).toBe(false);});
 it.each(["model","corpus_hash","currency","maximum_output_tokens","manifest_hash"])("denies %s drift",field=>{const s=setup();const b={...s.b,[field]:field==="maximum_output_tokens"?513:field==="currency"?"EUR":field==="model"?"different":"f".repeat(64)};expect(verifyJeffBridgeSignatures(s.e,s.keys,b,s.expected,s.now)).toBe(false);});
 it("denies future, stale and expired proof timestamps",()=>{const s=setup();for(const now of [s.now-5000,s.now+70000,NaN])expect(verifyJeffBridgeSignatures(s.e,s.keys,s.b,s.expected,now)).toBe(false);});
 it("rejects extra verification flags and untrusted key injection",()=>{const s=setup();for(const e of [{...s.e,verified:true},{...s.e,trusted_keys:s.keys},{...s.e,payload:{...s.e.payload,account_cap_verified:true}}])expect(verifyJeffBridgeSignatures(e,s.keys,s.b,s.expected,s.now)).toBe(false);});
 it("rejects an authentically signed but inconsistent reservation liability",()=>{
  const extra={maximum_requests:3,maximum_spend:"0.06",targets:["1".repeat(64),"2".repeat(64),"3".repeat(64)]};
  const bad=setup(extra,{reserved_request_count:2,reserved_liability:"0.02"}),good=setup(extra,{reserved_request_count:2,reserved_liability:"0.04"});
  expect(verifyJeffBridgeSignatures(bad.e,bad.keys,bad.b,bad.expected,bad.now)).toBe(false);expect(verifyJeffBridgeSignatures(good.e,good.keys,good.b,good.expected,good.now)).toBe(true);
 });
 it("blocks genuine invocation before any network or secret resolution for every supplied approval",async()=>{
  const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("NETWORK_FORBIDDEN"));try{for(const raw of [{},setup().e,{execution_enabled:true,apiKey:"SYNTHETIC"},jeffModelAcceptanceManifest()])await expect(sendJeffClaudeHttpsOnce(raw,prepareJeffConversation(jeffFixture("Hi","en")).request)).rejects.toThrow("BLOCKED");expect(network).not.toHaveBeenCalled();expect(socket).not.toHaveBeenCalled();}finally{network.mockRestore();}
 });
 it("keeps the separate one-request canary and full-v2 approval disabled",()=>{
  const c=jeffClaudeCanaryPlan(),m=jeffModelAcceptanceManifest();expect(c.plan.maximum_requests).toBe(1);expect(c.plan.authorized_external_requests).toBe(0);expect(c.plan.approved_spend).toBeNull();expect(c.corpus_hash).not.toBe(m.corpus_hash);expect(c.plan_hash).toMatch(/^[a-f0-9]{64}$/u);expect(m.execution_enabled).toBe(false);expect(m.authorized_external_requests).toBe(0);
  expect(c.plan_hash).toBe("82dec46b30a7bf70d312b5732b2e118200a0e5157897d7ce7ae23202237530b9");expect(c.corpus_hash).toBe("1830661589932e08c76f3d0d6b7b22d64dbf4aa06234e3c8a119c20432c80a45");
 });
});
