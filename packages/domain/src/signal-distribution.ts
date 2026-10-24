import { signalClaimSchema, signalPreparedSchema, signalFinishSchema, signalFakeScenariosSchema, signalDispatchPayloadSchema, signalTransportResultSchema, type SignalDispatchPayload, type SignalTransportResult } from "@gold-revenue-os/contracts";
import { canonicalFinancialJson } from "./financial-source-canonical";

export type SignalFixtureStore = {
 readonly mode: "SYNTHETIC";
 claim(tenantId: string): Promise<unknown>;
 begin(tenantId: string, deliveryId: string, token: string): Promise<unknown>;
 finish(tenantId: string, deliveryId: string, token: string, result: SignalTransportResult): Promise<unknown>;
 reconcile(tenantId: string, deliveryId: string, result: SignalTransportResult): Promise<unknown>;
};
type Scenario = { outcome: "ACK" | "KNOWN_FAILURE" | "RATE_LIMITED" | "UNKNOWN_AFTER_EFFECT" | "UNKNOWN_BEFORE_EFFECT"; delay_ms?: number; retry_after_ms?: number };

// A deterministic local transport, not a Telegram adapter. No fetch, credentials,
// callback, receipt writer, environment lookup or financial/access authority.
export class FakeSignalTransport {
 readonly mode = "SYNTHETIC" as const;
 private readonly ledger = new Map<string, { payload: string; ack: Extract<SignalTransportResult,{outcome:"ACK"}> }>();
 private readonly messages = new Map<string, { tenant_id: string; destination: string; text: string | null; attachments: SignalDispatchPayload["attachments"] }>();
 readonly effects: { operation: SignalDispatchPayload["operation"]; operation_key: string }[] = [];
 constructor(private readonly scenarios: Scenario[] = []) { if (!signalFakeScenariosSchema.safeParse(scenarios).success) throw Error("SIGNAL_FAKE_BOUND"); }
 async dispatch(raw: unknown): Promise<SignalTransportResult> {
  const parsed = signalDispatchPayloadSchema.safeParse(raw);if (!parsed.success) throw Error("SIGNAL_PAYLOAD_INVALID");
  const p = parsed.data, canonical = canonicalFinancialJson(p), prior = this.ledger.get(p.operation_key);
  if (prior) { if (prior.payload !== canonical) throw Error("SIGNAL_OPERATION_CONFLICT"); return structuredClone(prior.ack); }
  if (this.ledger.size >= 10000) throw Error("SIGNAL_FAKE_BOUND");
  const scenario = this.scenarios.shift() ?? { outcome: "ACK" };
  const delay = scenario.delay_ms ?? 0;
  if (!Number.isInteger(delay) || delay < 0 || delay > 1000) throw Error("SIGNAL_FAKE_BOUND");
  if (delay) await new Promise(resolve=>setTimeout(resolve,delay));
  // Another independent caller can finish while this simulated API is waiting.
  // Recheck after the await before the synchronous ledger/effect commit.
  const completed = this.ledger.get(p.operation_key);
  if (completed) { if (completed.payload !== canonical) throw Error("SIGNAL_OPERATION_CONFLICT"); return structuredClone(completed.ack); }
  if (scenario.outcome === "UNKNOWN_BEFORE_EFFECT") return { outcome:"UNKNOWN",retry_after_ms:null };
  if (scenario.outcome === "KNOWN_FAILURE" || scenario.outcome === "RATE_LIMITED") return { outcome:scenario.outcome,retry_after_ms:scenario.retry_after_ms??null };
  const ref = p.operation === "SEND" ? `fake-message:${p.operation_key}` : p.message_ref!;
  const existing = this.messages.get(ref);
  if (p.operation !== "SEND" && (!existing || existing.destination !== p.destination_ref || existing.tenant_id !== p.tenant_id)) return { outcome:"KNOWN_FAILURE",retry_after_ms:null };
  if (p.reply_ref && (this.messages.get(p.reply_ref)?.destination !== p.destination_ref || this.messages.get(p.reply_ref)?.tenant_id !== p.tenant_id)) return { outcome:"KNOWN_FAILURE",retry_after_ms:null };
  if (p.operation === "DELETE") this.messages.delete(ref);
  else this.messages.set(ref,{tenant_id:p.tenant_id,destination:p.destination_ref,text:p.text,attachments:structuredClone(p.attachments)});
  const ack: Extract<SignalTransportResult,{outcome:"ACK"}> = { outcome:"ACK",mode:"SYNTHETIC",tenant_id:p.tenant_id,operation_key:p.operation_key,destination_ref:p.destination_ref,message_ref:ref,fact_hash:p.fact_hash,acknowledged_at:new Date().toISOString() };
  this.ledger.set(p.operation_key,{payload:canonical,ack});this.effects.push({operation:p.operation,operation_key:p.operation_key});
  return scenario.outcome === "UNKNOWN_AFTER_EFFECT" ? { outcome:"UNKNOWN",retry_after_ms:null } : structuredClone(ack);
 }
 lookup(operationKey: string) { return structuredClone(this.ledger.get(operationKey)?.ack ?? null); }
 inspectMessage(reference: string) { return structuredClone(this.messages.get(reference) ?? null); }
}

// Invoked by a committed event wake-up or explicit recovery, never a cron/poller.
// A cycle is bounded; remaining work is returned to the caller, not hidden.
export async function dispatchSyntheticSignalWakeup(input: { tenantId: string; store: SignalFixtureStore; transport: FakeSignalTransport; maxJobs?: number }) {
 const max = input.maxJobs ?? 8;
 if (!Number.isInteger(max) || max < 1 || max > 32 || input.store.mode !== "SYNTHETIC" || !(input.transport instanceof FakeSignalTransport)) throw Error("SIGNAL_SYNTHETIC_REQUIRED");
 const start = performance.now(); let confirmed = 0, unknown = 0, held = 0, attempted = 0, hasMore = false;
 const stages = { claim_ms:0,prepare_ms:0,dispatch_ms:0,record_ms:0 };
 for (let i=0;i<max;i++) {
  let clock = performance.now();let raw:unknown;
  try {raw=await input.store.claim(input.tenantId);} catch {throw Error("SIGNAL_STORE_UNAVAILABLE");}stages.claim_ms += performance.now()-clock;
  const lease = signalClaimSchema.safeParse(raw);
  if (!lease.success) throw Error("SIGNAL_STORE_INVALID");
  if (lease.data.state!=="LEASED") {hasMore=lease.data.has_more;break;}
  if (lease.data.tenant_id !== input.tenantId) throw Error("SIGNAL_SCOPE_INVALID");
  hasMore = true;clock = performance.now();
  let value:unknown;try {value=await input.store.begin(input.tenantId,lease.data.delivery_id,lease.data.lease_token);}catch{throw Error("SIGNAL_STORE_UNAVAILABLE");}
  const prepared=signalPreparedSchema.safeParse(value);stages.prepare_ms += performance.now()-clock;
  if (!prepared.success) throw Error("SIGNAL_STORE_INVALID");
  if (prepared.data.state!=="PREPARED") {held++;continue;}
  const p = prepared.data.payload;if(p.tenant_id!==input.tenantId)throw Error("SIGNAL_SCOPE_INVALID");attempted++;clock=performance.now();
  let outcome: SignalTransportResult;
  try {
   outcome=signalTransportResultSchema.parse(await input.transport.dispatch(p));
   if (outcome.outcome === "ACK" && (outcome.tenant_id!==p.tenant_id || outcome.operation_key!==p.operation_key || outcome.destination_ref!==p.destination_ref || outcome.fact_hash!==p.fact_hash || p.operation!=="SEND"&&outcome.message_ref!==p.message_ref)) throw Error("SIGNAL_ACK_INVALID");
  } catch { outcome={outcome:"UNKNOWN",retry_after_ms:null}; }
  stages.dispatch_ms += performance.now()-clock;clock=performance.now();
  try {
   const recorded=signalFinishSchema.safeParse(await input.store.finish(input.tenantId,lease.data.delivery_id,lease.data.lease_token,outcome));
   if (!recorded.success) throw Error("SIGNAL_STORE_INVALID");
   if (recorded.data.state === "FAKE_CONFIRMED" && outcome.outcome === "ACK" && !recorded.data.replay) confirmed++;
   else if (outcome.outcome === "UNKNOWN") unknown++;else held++;
  } catch { unknown++; } // Begun durable lease is never automatically resent.
  stages.record_ms += performance.now()-clock;
 }
 return { classification:"SYNTHETIC" as const,financial_authority:"NONE" as const,live_delivery:false as const,attempted,confirmed,unknown,held,has_more:hasMore,elapsed_ms:performance.now()-start,...stages };
}

export async function reconcileSyntheticSignal(input: {tenantId:string;deliveryId:string;operationKey:string;store:SignalFixtureStore;transport:FakeSignalTransport}) {
 if (input.store.mode!=="SYNTHETIC" || !(input.transport instanceof FakeSignalTransport)) throw Error("SIGNAL_SYNTHETIC_REQUIRED");
 const ack=input.transport.lookup(input.operationKey);
 if (!ack) return {state:"UNKNOWN",financial_authority:"NONE"};
 if(ack.tenant_id!==input.tenantId)throw Error("SIGNAL_SCOPE_INVALID"); // Absence is not proof of non-delivery.
 try {return await input.store.reconcile(input.tenantId,input.deliveryId,signalTransportResultSchema.parse(ack));} catch {throw Error("SIGNAL_STORE_UNAVAILABLE");}
}

export function signalLatencySummary(samples: readonly number[]) {
 if (samples.length>10000) throw Error("SIGNAL_SAMPLE_BOUND");
 const valid=samples.filter(v=>Number.isFinite(v)&&v>=0).sort((a,b)=>a-b);
 const at=(p:number)=>valid.length?valid[Math.max(0,Math.ceil(valid.length*p)-1)]!:null;
 return {classification:"SYNTHETIC" as const,definition:"NEAREST_RANK" as const,sample_size:valid.length,excluded:samples.length-valid.length,p50_ms:at(.5),p95_ms:at(.95),p99_ms:at(.99),max_ms:at(1),real_telegram_performance:"UNVERIFIED" as const};
}
