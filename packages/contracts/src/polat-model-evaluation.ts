import{z}from "zod";
import { POLAT_CLAUDE_MODEL, polatClaudeUsageSchema } from "./polat-claude-adapter";
const tokens=z.number().int().min(0).max(2147483647).nullable();
const duration=z.number().finite().min(0).max(3600000).nullable();
const amount=z.string().regex(/^(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,18})?$/u);
export const POLAT_MODEL_FLAGS=["HALLUCINATED_COMMERCIAL_FACT","UNSAFE_FINANCIAL_CLAIM","REPETITIVE","EXCESSIVE_LENGTH","HUMAN_ESCALATION"]as const;
export const polatModelObservationSchema=z.strictObject({
 version:z.literal(1),mode:z.literal("SYNTHETIC"),financial_authority:z.literal("NONE"),live_operations_authorized:z.literal(false),
 tenant_id:z.uuid(),conversation_id:z.uuid(),invocation_id:z.uuid(),source:z.literal("FIXTURE_PROVIDER"),
 provider:z.literal("mock"),model:z.enum(["polat-fixture-v1","polat-test-runtime-v1"]),prompt_version:z.string().regex(/^[a-zA-Z0-9_.:-]{1,80}$/u),persona_version:z.string().regex(/^[a-zA-Z0-9_.:-]{1,80}$/u),
 status:z.enum(["SUCCEEDED","TIMED_OUT","RATE_LIMITED","INVALID_OUTPUT","PROVIDER_ERROR"]),retry:z.enum(["NONE","BOUNDED_BACKOFF","REVIEW"]),
 elapsed_ms:duration,provider_latency_ms:duration,time_to_first_response_ms:duration,
 usage:z.strictObject({input_tokens:tokens,output_tokens:tokens,total_tokens:tokens}),
 billing:z.strictObject({amount,currency:z.string().regex(/^[A-Z]{3,6}$/u),basis:z.literal("SIMULATED_PROVIDER_REPORT")}).nullable(),
 qa:z.enum(["APPROVED","HELD","NOT_EVALUATED"]),flags:z.array(z.enum(POLAT_MODEL_FLAGS)).max(5),completion:z.enum(["NOT_COMPLETED","FAKE_ACKNOWLEDGED","UNKNOWN"]),
}).superRefine(observationConsistency);
function observationConsistency(v: {time_to_first_response_ms:number|null;elapsed_ms:number|null;usage:{input_tokens:number|null;output_tokens:number|null;total_tokens:number|null};status:string;qa:string;completion:string}, c:z.RefinementCtx) {
 if(v.time_to_first_response_ms!==null&&(v.elapsed_ms===null||v.time_to_first_response_ms>v.elapsed_ms)||v.usage.total_tokens!==null&&v.usage.input_tokens!==null&&v.usage.output_tokens!==null&&v.usage.total_tokens!==v.usage.input_tokens+v.usage.output_tokens||v.status!=="SUCCEEDED"&&(v.qa!=="NOT_EVALUATED"||v.completion==="FAKE_ACKNOWLEDGED")||v.completion==="FAKE_ACKNOWLEDGED"&&v.qa!=="APPROVED")c.addIssue({code:"custom",message:"POLAT_MODEL_OBSERVATION_INCONSISTENT"});
}
/** Same measurement invariants; distinct offline origin cannot masquerade as real provider evidence. */
export const polatOfflineClaudeObservationSchema=z.strictObject({...polatModelObservationSchema.shape,
 version:z.literal(2),source:z.literal("OFFLINE_CLAUDE_HTTP"),provider:z.literal("anthropic"),model:z.literal(POLAT_CLAUDE_MODEL),
 real_model_execution:z.literal(false),provider_usage:polatClaudeUsageSchema.nullable(),response_hash:z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
}).superRefine(observationConsistency);
export type PolatOfflineClaudeObservation=z.infer<typeof polatOfflineClaudeObservationSchema>;
export type PolatModelObservation=z.infer<typeof polatModelObservationSchema>;
const count=z.number().int().min(0).max(1000),decimal=z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/u).nullable();
export const polatModelSummarySchema=z.strictObject({version:z.literal(1),mode:z.literal("SYNTHETIC"),financial_authority:z.literal("NONE"),live_operations_authorized:z.literal(false),observed_at:z.iso.datetime({offset:true}),start:z.iso.date(),end:z.iso.date(),sample_limit:z.literal(1000),complete:z.boolean(),count,success:count,errors:count,timeouts:count,rate_limited:count,invalid_output:count,qa_held_runs:count,escalated_runs:count,latency:z.strictObject({sample:count,p50_ms:decimal,p95_ms:decimal}),tokens:z.strictObject({input:decimal,output:decimal,input_known:count,output_known:count}),billing:z.strictObject({known:count,readable:z.boolean(),coverage:decimal,amount:z.null(),status:z.enum(["UNKNOWN","ROLE_RESTRICTED"])}),time_to_first_response_ms:z.null(),versions:z.array(z.strictObject({prompt:z.string().max(80),persona:z.string().max(80),count})).max(10),versions_complete:z.boolean(),basis:z.literal("MODEL_INVOCATIONS_ONLY"),consistency:z.literal("STATEMENT_SNAPSHOT")}).superRefine((v,c)=>{if(v.success+v.errors!==v.count||v.latency.sample>v.count||v.tokens.input_known>v.count||v.tokens.output_known>v.count||v.billing.known>v.count||!v.complete&&[v.latency.p50_ms,v.latency.p95_ms,v.tokens.input,v.tokens.output,v.billing.coverage].some(x=>x!==null)||v.tokens.input_known!==v.count&&v.tokens.input!==null||v.tokens.output_known!==v.count&&v.tokens.output!==null||!v.billing.readable&&(v.billing.status!=="ROLE_RESTRICTED"||v.billing.coverage!==null||v.billing.known!==0))c.addIssue({code:"custom",message:"POLAT_MODEL_SUMMARY_INCONSISTENT"});});
export type PolatModelSummary=z.infer<typeof polatModelSummarySchema>;
