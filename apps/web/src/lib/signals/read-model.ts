import { z } from "zod";
export const signalCollections=["deliveries","events","providers","sources","destinations","routes","history"] as const;
export const signalStatuses=["PENDING","RUNNING","RETRY","FAKE_CONFIRMED","UNKNOWN","REVIEW","STALE","NO_EFFECT","STALE_ACK"] as const;
export const signalCodes=["QUEUED","SOURCE_RESTRICTED","SOURCE_UNAVAILABLE","PARSE_UNCERTAIN","SOURCE_STALE","POLICY_DISABLED","CONFIG_CHANGED","SOURCE_AGE_REVIEW","LEASE_RECOVERED","UNKNOWN_EFFECT","LEASE_BUDGET","CLAIM_BUDGET","CLAIMED","NO_DESTINATION_MESSAGE","REFERENCE_UNRESOLVED","PAYLOAD_UNSUPPORTED","BEGUN","FAKE_ACK","RECONCILED_FAKE_ACK","KNOWN_FAILURE","RATE_LIMITED","FAILURE_BUDGET","UNRECORDED"] as const;
export const signalStates=[...signalStatuses,"PAUSED","CONFIGURED_DISABLED","SIMULATED","SOURCE_RESTRICTED","SOURCE_UNAVAILABLE","NO_OBSERVATION","MESSAGE","EDIT","DELETE"] as const;
export type SignalCollection=typeof signalCollections[number];
const id=z.uuid(),time=z.iso.datetime({offset:true}),seq=z.string().regex(/^[1-9][0-9]{0,18}$/u);
const decimal=z.string().regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/u);
export const signalCursorSchema=z.strictObject({version:z.literal(1),scope:z.string().regex(/^[a-f0-9]{64}$/u),started_at:time,after:z.string().min(1).max(36),anchor:z.string().min(1).max(36)});
export type SignalCursor=z.infer<typeof signalCursorSchema>;
export const signalRowSchema=z.strictObject({
 id,kind:z.enum(["PROVIDER","SOURCE","DESTINATION","ROUTE","EVENT","DELIVERY","HISTORY"]),label:z.string().max(220),reference:z.string().max(220),
 state:z.enum(signalStates),provider_id:id.nullable(),source_id:id.nullable(),destination_id:id.nullable(),event_id:id.nullable(),delivery_id:id.nullable(),
 provider_label:z.string().max(100).nullable(),source_label:z.string().max(100).nullable(),destination_label:z.string().max(100).nullable(),revision:seq.nullable(),
 observed_at:time.nullable(),published_at:time.nullable(),recorded_at:time.nullable(),acknowledged_at:time.nullable(),available_at:time.nullable(),code:z.enum(signalCodes).nullable(),
 parse_state:z.enum(["STRUCTURED","UNCERTAIN","UNAVAILABLE"]).nullable(),current:z.boolean().nullable(),paused:z.boolean().nullable(),authorization:z.enum(["UNVERIFIED","SYNTHETIC_APPROVED","REVOKED"]).nullable(),
 claims:z.number().int().min(0).max(7).nullable(),reclaims:z.number().int().min(0).max(2).nullable(),failures:z.number().int().min(0).max(5).nullable(),
 signal:z.strictObject({action:z.enum(["OPEN","UPDATE","BREAK_EVEN","PARTIAL_PROFIT","CLOSE","CANCEL","COMMENTARY"]),direction:z.enum(["BUY","SELL"]).nullable(),symbol:z.string().regex(/^[A-Z0-9._/-]{1,24}$/u).nullable(),order_type:z.enum(["MARKET","LIMIT","STOP"]).nullable(),entry:z.array(decimal).max(2),stop_loss:decimal.nullable(),take_profits:z.array(decimal).max(12)}).nullable(),
});
export type SignalRow=z.infer<typeof signalRowSchema>;
export const signalPageSchema=z.strictObject({version:z.literal(1),mode:z.literal("SYNTHETIC"),financial_authority:z.literal("NONE"),live_authority:z.literal("NONE"),collection:z.enum(signalCollections),page_size:z.number().int().min(1).max(100),items:z.array(signalRowSchema).max(100),has_more:z.boolean(),next_cursor:signalCursorSchema.nullable(),consistency:z.literal("LIVE_KEYSET_REFRESH_FOR_CHANGES")}).superRefine((v,ctx)=>{
 const kinds={providers:"PROVIDER",sources:"SOURCE",destinations:"DESTINATION",routes:"ROUTE",events:"EVENT",deliveries:"DELIVERY",history:"HISTORY"};
 if(v.has_more!==(v.next_cursor!==null)||v.items.length>v.page_size||new Set(v.items.map(r=>r.id)).size!==v.items.length||v.items.some(r=>r.kind!==kinds[v.collection]))ctx.addIssue({code:"custom",message:"SIGNAL_PAGE_INVALID"});
});
export type SignalPage=z.infer<typeof signalPageSchema>;
const finite=z.number().finite().nonnegative().nullable();
export const signalSummarySchema=z.strictObject({version:z.literal(1),mode:z.literal("SYNTHETIC"),financial_authority:z.literal("NONE"),live_authority:z.literal("NONE"),enabled:z.boolean(),observed_at:time,oldest_pending_at:time.nullable(),
 counts:z.array(z.strictObject({status:z.enum(signalStatuses),value:z.number().int().min(0).max(10000),complete:z.boolean()})).length(9),
 latency:z.strictObject({sampled:z.number().int().min(0).max(1000),valid:z.number().int().min(0).max(1000),p50_ms:finite,p95_ms:finite,p99_ms:finite,max_ms:finite,last_ack_at:time.nullable()})
}).superRefine((v,c)=>{if((v.latency.valid>0&&[v.latency.p50_ms,v.latency.p95_ms,v.latency.p99_ms,v.latency.max_ms].some(x=>x===null))||new Set(v.counts.map(x=>x.status)).size!==9||v.latency.valid>v.latency.sampled||(v.latency.valid===0&&[v.latency.p50_ms,v.latency.p95_ms,v.latency.p99_ms,v.latency.max_ms].some(x=>x!==null)))c.addIssue({code:"custom",message:"SIGNAL_SUMMARY_INVALID"});});
export type SignalSummary=z.infer<typeof signalSummarySchema>;
export const signalSearchSchema=z.strictObject({collection:z.enum(signalCollections).default("deliveries"),provider:id.optional(),source:id.optional(),destination:id.optional(),delivery:id.optional(),status:z.preprocess(v=>v===""?undefined:v,z.enum(signalStatuses).optional()),size:z.enum(["25","50","100"]).default("25"),cursor:z.string().min(1).max(1024).optional()});
export type SignalSearch=z.infer<typeof signalSearchSchema>;
export function decodeSignalCursor(raw:string):SignalCursor {
 const value:unknown=JSON.parse(raw);
 // Detect duplicate/noncanonical JSON before schema parsing reorders valid object keys.
 if(JSON.stringify(value)!==raw)throw Error("SIGNAL_CURSOR_INVALID");
 return signalCursorSchema.parse(value);
}
export function signalHref(input:Partial<Omit<SignalSearch,"cursor">>&{cursor?:SignalCursor|undefined}={}):string {
 const params=new URLSearchParams();for(const key of ["collection","provider","source","destination","delivery","status","size"] as const)if(input[key])params.set(key,input[key]);if(input.cursor)params.set("cursor",JSON.stringify(input.cursor));return "/admin/signals"+(params.size?"?"+params.toString():"");
}
