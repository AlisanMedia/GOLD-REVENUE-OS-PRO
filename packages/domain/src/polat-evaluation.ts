import{buildPolatSalesPreview}from "./polat-sales";
import{POLAT_SALES_CORPUS,polatSalesFixture}from "./polat-sales.fixtures";
import{METRIC_DICTIONARY,analyticsWorkspaceSchema}from "./analytics";
export const POLAT_RESPONSE_METRICS=Object.freeze({
 captured:{source:"private.polat_inbound_work",formula:"Distinct captured message records in received_at window",limit:1000},
 coverage_gap:{source:"messages + explicit Polat controls",formula:"Persisted configured-scope inbound without a work row; source created_at window",limit:1000},
 ai_ack_rate:{source:"private.polat_response_evidence + work",formula:"Eligible work with current valid fake AI ACK / eligible captured work; zero denominator or truncated sample => null",limit:1000},
 human_ownership_rate:{source:"work + current native ownership",formula:"Acknowledged human-owned work / (human-owned + human-handoff-pending); no denominator/truncation => null",limit:1000},
 latency:{source:"work.responded_at - work.received_at",formula:"p50/p95 of nonnegative persisted fake-ACK delay; no ACK/truncated sample => null",limit:1000}
});
export function evaluatePolatOffline(){
 const variants=(["DIRECT","ONE_QUESTION"]as const).map(style=>{
  const cases=POLAT_SALES_CORPUS.map(item=>{const x=polatSalesFixture(item.text,"lang"in item?item.lang:"en");x.style=style;const r=buildPolatSalesPreview(x),text=r.output.proposed_response;
   const failures:string[]=[];
   if(r.next_action!==item.next||!text.includes(item.contains))failures.push("QUESTION_OR_NEXT_STEP_MISSED");
   if(r.quality.qa.grounding.blocked||r.quality.qa.grounding.action_receipt_failures.length)failures.push("TRUTHFULNESS_OR_AUTHORITY");
   if(text.length>600||(text.match(/\?/gu)?.length??0)>1)failures.push("LENGTH_OR_QUESTION_FRICTION");
   if(["STOP_CONTACT","WAIT"].includes(item.next)&&text.includes("10.00"))failures.push("UNWANTED_SALES_PITCH");
   if(item.next==="HUMAN_REVIEW"&&(!r.handoff.required||r.quality.action!=="HOLD"))failures.push("HUMAN_BOUNDARY");
   if(item.next!=="HUMAN_REVIEW"&&r.quality.action!=="SAFE_PREVIEW")failures.push("CONVERSATION_QA_HOLD");
   return {id:item.id,language:x.conversation.verified_customer_language,characters:text.length,guard_pass:failures.length===0,failures,quality_action:r.quality.action,quality_reasons:r.quality.reasons,reply_preview:text,delivery:"NOT_SENT"as const};});
  return {style,cases,guard_passed:cases.filter(c=>c.guard_pass).length,case_count:cases.length,average_characters:cases.reduce((s,c)=>s+c.characters,0)/cases.length};
 });
 return {version:1,method:"PAIRED_DETERMINISTIC_SYNTHETIC_CORPUS_V1",classification:"SYNTHETIC",sample_policy:"Same 15 invented customer turns, same catalog and clock per variant; all cases retained",variants,selection:"MANAGER_REVIEW_REQUIRED",human_naturalness:"NOT_MEASURED",customer_satisfaction:null,live_conversion_rate:null,verified_revenue:null,actual_model_cost:null,experimentation:"OFFLINE_ONLY",dispatch:"DISABLED",financial_authority:"NONE",live_operations_authorized:false}as const;
}
export function polatCrmMetricEvidence(raw:unknown){
 const w=analyticsWorkspaceSchema.parse(raw);
 const ids=["inbound","outbound","ai_handled","human_handled","first_human_response","resolution_time","critical_cases","failed_deliveries","renewal_events","renewal_rate","cancelled","active_subscriptions","refunds","collected","invocations","billing_coverage","ai_cost","success_tasks"]as const;
 const rows=ids.map(id=>{const value=w.metrics.find(m=>m.id===id);return{id,definition:METRIC_DICTIONARY[id],status:value?.status??"UNAVAILABLE",value:value?.value??null,unit:value?.unit??"count",sample:value?.sample??0,denominator:value?.denominator??null,reason:value?.reason??"METRIC_EVIDENCE_MISSING",classification:METRIC_DICTIONARY[id].section==="costs"||["invocations","inbound","outbound","ai_handled","human_handled","first_human_response","resolution_time","critical_cases","failed_deliveries","success_tasks"].includes(id)?w.operational_scope:w.mode};});
 const funnel=["qualification","offer","payment","subscription"].map(stage=>{const x=w.funnel.find(f=>f.stage===stage);return {stage,count:stage==="payment"&&w.mode==="LIVE"&&!w.metrics.some(m=>m.id==="collected"&&m.status==="AVAILABLE")?null:x?.count??null,rate:stage==="payment"&&w.mode==="LIVE"&&!w.metrics.some(m=>m.id==="collected"&&m.status==="AVAILABLE")?null:x?.rate??null,denominator:x?.previous??null,classification:w.mode};});
 return{rows,funnel,unavailable:[{id:"offer_presentation_rate",reason:"Approved offer existence is not proof of provider-delivered presentation"},{id:"opt_out_rate",reason:"No accepted complete opt-out decision/event denominator in this read model"},{id:"customer_satisfaction",reason:"Offline text guard coverage is not actual customer satisfaction"}],financial_authority:"NONE",live_operations_authorized:false}as const;
}
