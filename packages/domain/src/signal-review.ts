import{signalReviewCommandSchema,signalReviewSafeSummarySchema}from "@gold-revenue-os/contracts";
import{parseFinancialJson}from "./financial-source-canonical";
// A parsed command or hash confers no authority. The private fixture recorder
// independently checks DB membership, scope, current context and stored evidence.
export function parseSignalReviewCommand(raw:string){if(Buffer.byteLength(raw,"utf8")>4096)throw Error("SIGNAL_REVIEW_BOUND");return{command:signalReviewCommandSchema.parse(parseFinancialJson(raw)),financial_authority:"NONE"as const,live_operations_authorized:false as const};}
export function projectSignalReviewSummary(input:unknown,role:"super_admin"|"manager"|"support"|"analyst"|"readonly"){
 if(!["super_admin","manager","support","analyst"].includes(role))throw Error("SIGNAL_REVIEW_READ_DENIED");
 const summary=signalReviewSafeSummarySchema.parse(input);
 return{...summary,financial_authority:"NONE"as const,live_operations_authorized:false as const};
}
