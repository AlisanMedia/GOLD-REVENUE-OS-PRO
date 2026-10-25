import { describe,it,expect,vi } from "vitest";
import { randomUUID,generateKeyPairSync,sign } from "node:crypto";
import { polatBridgeSignatureBytes,verifyPolatBridgeSignatures,polatGenuineExecutionGate,requirePolatNetworkPermit,type PolatBridgeSignatureEnvelope,type PolatBridgePublicKeys } from "./polat-experiment-execution-gate";
import { polatBridgeFixtureBinding } from "../../../tests/helpers/polat-bridge-fixtures";
import { polatGuardDigest } from "./polat-experiment-journal";
import { polatClaudeCanaryPlan } from "./polat-claude-canary";
import { polatModelAcceptanceManifest } from "./polat-model-acceptance";
import { sendPolatClaudeHttpsOnce } from "./polat-claude-https-boundary";
import { preparePolatConversation } from "./polat-conversation";
import { polatFixture } from "./polat-conversation.fixtures";
const socket=vi.hoisted(()=>vi.fn(()=>{throw Error("EXTERNAL_SOCKET_FORBIDDEN");}));
vi.mock("node:https",()=>({request:socket}));

function setup(bindingExtra:Record<string,unknown>={},payloadExtra:Record<string,unknown>={}){
 const b=polatBridgeFixtureBinding(bindingExtra),now=Date.now(),roles=["owner","account_control","committed_reservation"] as const;
 const pairs=roles.map(()=>generateKeyPairSync("ed25519"));
 const keys=Object.fromEntries(roles.map((role,i)=>[role,{key_id:role+"_fixture_key",key:pairs[i]!.publicKey}])) as unknown as PolatBridgePublicKeys;
 const payload:PolatBridgeSignatureEnvelope["payload"]={version:1,purpose:"POLAT_CONTROLLED_EXPERIMENT",run_id:randomUUID(),attempt_id:randomUUID(),binding_hash:polatGuardDigest(b),request_hash:"e".repeat(64),body_hash:"f".repeat(64),account_scope_hash:b.account_scope_hash,authorization_record_hash:b.authorization_record_hash,reserved_request_count:1,reserved_liability:"0.02",issued_at:new Date(now-1000).toISOString(),expires_at:new Date(now+20000).toISOString(),nonce:randomUUID(),...payloadExtra};
 const e={payload,...Object.fromEntries(roles.map((role,i)=>[role,{key_id:keys[role].key_id,signature:sign(null,polatBridgeSignatureBytes(role,keys[role].key_id,payload),pairs[i]!.privateKey).toString("base64url")}]))}as PolatBridgeSignatureEnvelope;
 const expected={run_id:payload.run_id,attempt_id:payload.attempt_id,request_hash:payload.request_hash,body_hash:payload.body_hash};return{b,now,keys,e,expected};
}
describe("independent signature contract without execution authority",()=>{
 it("validates three distinct offline keys but cannot issue a genuine transport permit",()=>{
  const s=setup();expect(verifyPolatBridgeSignatures(s.e,s.keys,s.b,s.expected,s.now)).toBe(true);expect(()=>requirePolatNetworkPermit(s.e)).toThrow("BLOCKED");expect(polatGenuineExecutionGate()).toMatchObject({state:"BLOCKED",authorized_external_requests:0,execution_enabled:false});
 });
 it.each(["owner","account_control","committed_reservation"] as const)("requires authentic independent %s proof",role=>{const s=setup();s.e[role].signature="A".repeat(86);expect(verifyPolatBridgeSignatures(s.e,s.keys,s.b,s.expected,s.now)).toBe(false);});
 it("denies the same identity pretending to be independent control planes",()=>{const s=setup(),keys={...s.keys,account_control:s.keys.owner};expect(verifyPolatBridgeSignatures(s.e,keys,s.b,s.expected,s.now)).toBe(false);});
 it.each(["model","corpus_hash","currency","maximum_output_tokens","manifest_hash"])("denies %s drift",field=>{const s=setup();const b={...s.b,[field]:field==="maximum_output_tokens"?513:field==="currency"?"EUR":field==="model"?"different":"f".repeat(64)};expect(verifyPolatBridgeSignatures(s.e,s.keys,b,s.expected,s.now)).toBe(false);});
 it("denies future, stale and expired proof timestamps",()=>{const s=setup();for(const now of [s.now-5000,s.now+70000,NaN])expect(verifyPolatBridgeSignatures(s.e,s.keys,s.b,s.expected,now)).toBe(false);});
 it("rejects extra verification flags and untrusted key injection",()=>{const s=setup();for(const e of [{...s.e,verified:true},{...s.e,trusted_keys:s.keys},{...s.e,payload:{...s.e.payload,account_cap_verified:true}}])expect(verifyPolatBridgeSignatures(e,s.keys,s.b,s.expected,s.now)).toBe(false);});
 it("rejects an authentically signed but inconsistent reservation liability",()=>{
  const extra={maximum_requests:3,maximum_spend:"0.06",targets:["1".repeat(64),"2".repeat(64),"3".repeat(64)]};
  const bad=setup(extra,{reserved_request_count:2,reserved_liability:"0.02"}),good=setup(extra,{reserved_request_count:2,reserved_liability:"0.04"});
  expect(verifyPolatBridgeSignatures(bad.e,bad.keys,bad.b,bad.expected,bad.now)).toBe(false);expect(verifyPolatBridgeSignatures(good.e,good.keys,good.b,good.expected,good.now)).toBe(true);
 });
 it("blocks genuine invocation before any network or secret resolution for every supplied approval",async()=>{
  const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("NETWORK_FORBIDDEN"));try{for(const raw of [{},setup().e,{execution_enabled:true,apiKey:"SYNTHETIC"},polatModelAcceptanceManifest()])await expect(sendPolatClaudeHttpsOnce(raw,preparePolatConversation(polatFixture("Hi","en")).request)).rejects.toThrow("BLOCKED");expect(network).not.toHaveBeenCalled();expect(socket).not.toHaveBeenCalled();}finally{network.mockRestore();}
 });
 it("keeps the separate one-request canary and full-v2 approval disabled",()=>{
  const c=polatClaudeCanaryPlan(),m=polatModelAcceptanceManifest();expect(c.plan.maximum_requests).toBe(1);expect(c.plan.authorized_external_requests).toBe(0);expect(c.plan.approved_spend).toBeNull();expect(c.corpus_hash).not.toBe(m.corpus_hash);expect(c.plan_hash).toMatch(/^[a-f0-9]{64}$/u);expect(m.execution_enabled).toBe(false);expect(m.authorized_external_requests).toBe(0);
  expect(c.plan_hash).toBe("372b81b5017359aef85f3b4080c1ff7f6bf9193459c30a2505425fc5463066c5");expect(c.corpus_hash).toBe("1afc425d131e4f3e7ee82976e034b703fffbd59bd388b6c1738a6617290d3630");
 });
});
