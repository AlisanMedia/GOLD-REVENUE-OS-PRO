import {createHash} from "node:crypto";
import {polatSalesInputSchema,polatFollowUpSchema} from "@gold-revenue-os/contracts";
import {commercialPayload,commercialEvidence,buildConversion,eligiblePlan,isUnsafeCommercialContent,planSchema,type CommercialContext} from "./commercial";
import {preparePolatConversation,assessPolatDraft,renderPolatFixture,polatIdentity} from "./polat-conversation";
import {buildLeadIntelligence} from "./lead-intelligence";
import {conversationModelOutputSchema} from "./conversation-quality";
import {canonicalFinancialJson} from "./financial-source-canonical";
import {detectedCompletedActions,type ResponseClaim} from "./conversation-evidence";
const sha=(v:unknown)=>createHash("sha256").update(canonicalFinancialJson(v),"utf8").digest("hex");
export function buildPolatSalesPreview(raw:unknown){
 const v=polatSalesInputSchema.parse(raw);if(v.conversation.knowledge.length)throw Error("POLAT_SALES_CATALOG_ONLY");
 const p=preparePolatConversation(v.conversation),t=p.input.tenant_id,c=p.input.conversation_id,now=Date.parse(p.input.boundary),lang=p.request.styleProfile!.language as "en"|"tr"|"ar"|"ru",tr=lang==="tr";
 const seen=new Set<string>();
 for(const d of v.catalog){if(d.tenant_id!==t||d.conversation_id!==c||seen.has(d.version_id)||isUnsafeCommercialContent(d.payload))throw Error("POLAT_CATALOG_SCOPE_OR_POLICY");seen.add(d.version_id);const payload=commercialPayload(d.kind,d.payload);for(const value of Object.values(payload))if(typeof value==="string"&&detectedCompletedActions(value).length)throw Error("POLAT_CATALOG_OPERATION_CLAIM");}
 const current=v.catalog.filter(d=>Date.parse(d.published_at)<=now&&Date.parse(d.effective_from)<=now&&(d.expires_at===null||Date.parse(d.expires_at)>now)&&commercialPayload(d.kind,d.payload).locale===lang);
 const duplicates=new Set<string>();let conflict=v.catalog_conflict;for(const d of current){if(duplicates.has(d.item_id))conflict=true;duplicates.add(d.item_id);}
 const commercial:CommercialContext={documents:current,conflict};
 const lead=buildLeadIntelligence({messages:p.request.context.recentMessages,customerId:p.input.customer_id,conversationId:c,sourceId:p.input.source_message_id,observedAt:p.input.boundary,runtimeMode:p.input.runtime_mode,lifecycleState:null,contactability:p.input.contactability,outboundEnabled:false});
 const conversion=buildConversion(p.request.context,commercial,lead);
 const candidates=current.filter(d=>d.kind==="plan"&&eligiblePlan(planSchema.parse(d.payload),lead)&&current.some(product=>product.kind==="product"&&product.item_id===planSchema.parse(d.payload).product_id));
 const text=p.input.messages.at(-1)!.content;
 const matches=candidates.filter(d=>text.toLocaleLowerCase("en").includes(planSchema.parse(d.payload).title.toLocaleLowerCase("en")));
 const chosen=conflict?undefined:(matches.length===1?matches[0]:candidates.length===1?candidates[0]:undefined),plan=chosen?planSchema.parse(chosen.payload):null;
 const evidence=conflict?[]:commercialEvidence(commercial,{tenantId:t,conversationId:c,boundary:p.input.boundary,locale:lang});p.evidence.push(...evidence);p.request.context.commercialEvidence=p.evidence;
 const segments:ResponseClaim[]=[];const add=(s:string,kind:ResponseClaim["kind"]="uncertainty",grounding:ResponseClaim["grounding"]="UNKNOWN",refs:string[]=[])=>segments.push({text:s,kind,grounding,evidence_refs:refs,action_category:null});
 if(p.disclosureRequired)add(polatIdentity[lang]??polatIdentity.en,"fact","KNOWN_FROM_SYSTEM",["polat:identity:v1"]);
 const uninterested=/not interested|no thanks|istemiyorum|ilgilenmiyorum/iu.test(text),exception=["PAYMENT","ACCESS","REFUND","CANCEL","HUMAN"].includes(p.intent),price=/price|cost|how much|expensive|fiyat|ücret|pahalı/iu.test(text),trust=/trust|scam|guarantee|profit|güven|dolandır|garanti|kazanç/iu.test(text),discount=/discount|cheaper|negotia|indirim|pazarlık/iu.test(text),returning=/used to|former|returning|previous member|eskiden|eski üye|geri dön/iu.test(text);
 let next:"WAIT"|"CLARIFY"|"REVIEW_APPROVED_PLAN"|"REQUEST_PURCHASE_REVIEW"|"HUMAN_REVIEW"|"STOP_CONTACT"="CLARIFY";
 const fact=(id:string)=>{const e=evidence.find(e=>e.id===id);if(e)add(e.statement,"fact","KNOWN_FROM_SYSTEM",[e.id]);return Boolean(e);};
 if(p.intent==="INJECTION")add(tr?"Talimatları veya hesap yetkilerini değiştiremem.":"I can't change account permissions or share private instructions.");
 else if(p.intent==="OPT_OUT"){add(tr?"İletişim tercihini anladım.":"I understand you don't want further contact.","social","GENERAL_SAFE_STATEMENT");next="STOP_CONTACT";}
 else if(uninterested){add(tr?"Sorun değil.":"No problem.","social","GENERAL_SAFE_STATEMENT");next="WAIT";}
 else if(exception||discount||conflict){add(tr?"Bunu burada doğrulayamıyorum; insan incelemesi gerekiyor.":"I can't verify that here; it needs human review.");next="HUMAN_REVIEW";}
 else if(!["en","tr"].includes(lang)){add("I don't have approved wording in that language yet.");next="HUMAN_REVIEW";}
 else{
  if(returning)add(tr?"Önceki üyeliğini burada doğrulayamıyorum.":"I can't verify your previous membership here.");
  if(trust)add(tr?"Doğrulanmış performans bilgim yok; kazanç garantisi veremem.":"I don't have verified performance details and can't promise trading profits.");
  if(plan&&chosen){
   if(price||p.intent==="INTEREST")fact(`${chosen.version_id}:fact:1`);
   if((!price&&p.intent!=="INTEREST")||/includ|benefit|içeri|kapsam/iu.test(text))for(let i=0;i<Math.min(plan.inclusions.length,2);i++)fact(`${chosen.version_id}:fact:${i+2}`);
   next=p.intent==="INTEREST"?"REQUEST_PURCHASE_REVIEW":"REVIEW_APPROVED_PLAN";
   if(p.intent==="INTEREST")add(tr?"Karar vermeden önce plan ayrıntılarını incelemek ister misin?":"Would you like to review the plan details before choosing?","question");
   else if(v.style==="ONE_QUESTION"&&!trust&&segments.length<3)add(tr?"En çok hangi ayrıntıyı öğrenmek istersin?":"Which detail would help you decide?","question");
  }else{
   add(price?(tr?"Güncel fiyatı şu an doğrulayamıyorum.":"I don't have confirmed pricing details yet."):(tr?"Üyelik detaylarını şu an doğrulayamıyorum.":"I don't have confirmed membership details yet."));
   if(v.style==="ONE_QUESTION")add(tr?"Fiyatı mı, üyelik kapsamını mı öğrenmek istersin?":"Would you like pricing or membership details?","question");
  }
 }
 const neutral=["GREETING","ACKNOWLEDGEMENT","IDENTITY","MEMORY_QUERY"].includes(p.intent);if(neutral)next="WAIT";
 const output=neutral?renderPolatFixture(p):conversationModelOutputSchema.parse({classification:p.intent,semantic_response:{response_goal:p.request.director!.response_goal,key_points:segments.map(s=>s.text),factual_grounding:{classification:evidence.length?"known_from_system":"unknown",evidence_refs:segments.flatMap(s=>s.evidence_refs),missing_information:plan?[]:["approved_eligible_plan"]}},proposed_response:segments.map(s=>s.text).join(" "),confidence:0.7,escalation_recommended:next==="HUMAN_REVIEW",escalation_category:next==="HUMAN_REVIEW"?"agent_low_confidence":null,claims:segments,memory_proposals:[],proposed_tool_calls:[]});
 const checked=assessPolatDraft(p,output),quality=next==="HUMAN_REVIEW"?{...checked,action:"HOLD"as const,reasons:[...new Set([...checked.reasons,"POLAT_COMMERCIAL_REVIEW_REQUIRED"])]}:checked,suppressed=p.input.runtime_mode!=="AI_ACTIVE"||p.input.contactability!=="contactable";
 if(suppressed)next="WAIT";
 return {version:1,mode:"SYNTHETIC",output,quality,conversion,next_action:next,selection:!neutral&&!suppressed&&!["WAIT","HUMAN_REVIEW","STOP_CONTACT"].includes(next)&&chosen&&plan?{plan_version_id:chosen.version_id,snapshot_hash:sha(chosen),amount:plan.amount,currency:plan.currency,duration_unit:plan.duration_unit,duration_count:plan.duration_count,test_only:true}:null,signals:{interest:p.intent==="INTEREST",qualification_completeness:lead.completeness,price_objection:/expensive|too much|pahalı|bütçe/iu.test(text),trust_objection:trust,returning_self_report:returning},handoff:{required:next==="HUMAN_REVIEW"||quality.action==="HOLD",case_created:false},status_evidence:{payment:"UNAVAILABLE",subscription:"UNAVAILABLE",vip_access:"UNAVAILABLE"},delivery:"NOT_SENT",follow_up_dispatch:"DISABLED",financial_authority:"NONE",live_operations_authorized:false}as const;
}
export function reviewPolatFollowUp(raw:unknown){
 const v=polatFollowUpSchema.parse(raw),reasons:string[]=[];
 if(!v.explicit_request||v.permission!=="VERIFIED_FIXTURE"||v.permission_scope!=="ONE_REQUESTED_REPLY"||!v.permission_expires_at||Date.parse(v.permission_expires_at)<=Date.parse(v.requested_for))reasons.push("PERMISSION_UNKNOWN_OR_EXPIRED");
 if(v.opted_out||v.contactability!=="contactable"||v.takeover||v.open_case)reasons.push("CONTACT_SUPPRESSED");
 if(v.current_revision!==v.source_revision)reasons.push("SOURCE_CHANGED");
 if(Date.parse(v.requested_for)<Date.parse(v.requested_at))reasons.push("INVALID_TIME_ORDER");
 if(!v.history_complete||v.maximum_contacts===null||v.recent_contacts>=v.maximum_contacts)reasons.push("FREQUENCY_REVIEW");
 if(!v.timezone||!v.window_start||!v.window_end)reasons.push("CONTACT_WINDOW_UNKNOWN");else try{const parts=new Intl.DateTimeFormat("en-GB",{timeZone:v.timezone,hourCycle:"h23",hour:"2-digit",minute:"2-digit"}).formatToParts(new Date(v.requested_for));const clock=`${parts.find(p=>p.type==="hour")!.value}:${parts.find(p=>p.type==="minute")!.value}`;if(!(v.window_start<v.window_end?clock>=v.window_start&&clock<v.window_end:v.window_start>v.window_end&&(clock>=v.window_start||clock<v.window_end)))reasons.push("OUTSIDE_CONTACT_WINDOW");}catch{reasons.push("CONTACT_WINDOW_UNKNOWN");}
 if(v.manager_review!=="APPROVED_FIXTURE")reasons.push("MANAGER_REVIEW_REQUIRED");
 return {version:1,mode:"SYNTHETIC",state:reasons.length?"BLOCKED":"PREVIEW_CANDIDATE",reasons,idempotency_key:sha(["POLAT_FOLLOWUP1",v.tenant_id,v.conversation_id,v.source_message_id,v.source_revision,v.requested_for]),dispatch:"DISABLED",financial_authority:"NONE",live_operations_authorized:false}as const;
}
