import {createHash} from "node:crypto";
import {sourceCapabilitiesSchema,sourcePacketSchema,recoveryPageSchema,type SourceCapabilities,type RecoveryPage} from "@gold-revenue-os/contracts";
import {canonicalFinancialJson} from "./financial-source-canonical";
import {normalizeSignal} from "./signals";
export function assessRecoveryPage(input:unknown,scope:{tenantId:string;sourceId:string;epoch:string;expectedFrom:number}){
 const page=recoveryPageSchema.parse(input);const reasons:string[]=[];
 if(page.tenant_id!==scope.tenantId||page.source_id!==scope.sourceId||page.epoch!==scope.epoch||page.from!==scope.expectedFrom)reasons.push("SCOPE_OR_CHECKPOINT");
 const sorted=[...page.entries].sort((a,b)=>a.sequence-b.sequence);
 if(!page.complete||sorted.length!==page.to-page.from+1||sorted.some((v,i)=>v.sequence!==page.from+i))reasons.push("INCOMPLETE_HISTORY");
 if(sorted.some(v=>v.event.tenant_id!==page.tenant_id||v.event.source_id!==page.source_id))reasons.push("SOURCE_MISMATCH");
 const digest=createHash("sha256").update(canonicalFinancialJson(["SIGNAL_RECOVERY1",page.tenant_id,page.source_id,page.epoch,String(page.from),String(page.to),sorted.map(v=>[String(v.sequence),normalizeSignal(v.event).fact_hash])]),"utf8").digest("hex");
 return {state:reasons.length?"BLOCKED" as const:"SYNTHETIC_COMPLETE" as const,reasons,source_hash:digest,financial_authority:"NONE" as const,live_operations_authorized:false as const};
}
// History is supplied separately from observed callback frames. There is no network,
// login/session data, claim of Telegram authentication or protected-content fallback.
export class FakeRecoverableSignalSource{
 readonly mode="SYNTHETIC" as const;readonly capabilities:SourceCapabilities;
 private readonly history:Map<number,ReturnType<typeof sourcePacketSchema.parse>>;
 constructor(caps:unknown,history:readonly unknown[]){this.capabilities=sourceCapabilitiesSchema.parse(caps);if(history.length>4096)throw Error("HISTORY_BOUND");this.history=new Map();for(const raw of history){const p=sourcePacketSchema.parse(raw);if(this.history.has(p.sequence))throw Error("HISTORY_CONFLICT");this.history.set(p.sequence,structuredClone(p));}}
 page(scope:{tenantId:string;sourceId:string;epoch:string;from:number;to:number}):RecoveryPage{
  if(this.capabilities.recovery!=="INDEPENDENT_FAKE_HISTORY"||this.capabilities.sequence!=="MONOTONIC_INT")throw Error("SOURCE_RECOVERY_UNSUPPORTED");
  const range=recoveryPageSchema.parse({version:1,mode:this.mode,origin:"INDEPENDENT_FAKE_HISTORY",tenant_id:scope.tenantId,source_id:scope.sourceId,epoch:scope.epoch,from:scope.from,to:scope.to,complete:false,entries:[]});
  const entries=[];for(let n=range.from;n<=range.to;n++){const v=this.history.get(n);if(v){if(v.event.tenant_id!==scope.tenantId||v.event.source_id!==scope.sourceId)throw Error("SOURCE_SCOPE_INVALID");entries.push(structuredClone(v));}}
  return {...range,complete:entries.length===range.to-range.from+1,entries};
 }
}
