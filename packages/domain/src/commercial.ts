import { z } from "zod";
import type { AgentContext } from "./agent-runtime";
import { splitResponseSentences, type BackendEvidence } from "./conversation-evidence";
import type { LeadIntelligence } from "./lead-intelligence";
import type {ConversationDirector} from "./conversation-quality";
import type {ConversationModelOutput} from "./conversation-quality";

export const KB_CATEGORIES = ["Product","Pricing","Support","Signal Service","Payment Information","Telegram","Trial","Renewal","Policies","FAQ"] as const;
export const COMMERCIAL_LOCALES = ["en","tr","ar","ru"] as const;
export const decimalAmountSchema = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/);
const text = z.string().trim().min(1).max(1200);
const list = z.array(z.string().trim().min(1).max(300)).max(12);
const base = { title:z.string().trim().min(1).max(120), locale:z.enum(COMMERCIAL_LOCALES), source:text };
export const productSchema = z.object({...base,description:text,service_rights:text}).strict();
export const planSchema = z.object({...base,product_id:z.string().uuid(),amount:decimalAmountSchema,currency:z.string().regex(/^[A-Z]{3}$/),
  duration_unit:z.enum(["fixed_days","calendar_month","calendar_year"]),duration_count:z.number().int().min(1).max(366),
  billing:z.enum(["one_off","recurring","unknown"]),inclusions:list,restrictions:list,terms:text,
  eligibility:z.object({instrument:z.string().max(40).nullable(),actively_trades:z.boolean().nullable(),experience_level:z.string().max(40).nullable()}).strict(),
  max_discount_bps:z.number().int().min(0).max(10000),trial:z.boolean(),offer_valid_hours:z.number().int().min(1).max(168),
  tax_rule:z.string().max(300).nullable(),renewal_rule:z.string().max(300).nullable(),cancellation_rule:z.string().max(300).nullable(),disclosures:list,
}).strict().superRefine((p,c)=>{try{new Intl.NumberFormat("en",{style:"currency",currency:p.currency});}catch{c.addIssue({code:"custom",message:"ISO currency required"});}
  if(p.currency==="XTR"&&(!/^[1-9][0-9]*(?:\.0{1,6})?$/u.test(p.amount)||p.billing!=="one_off"))c.addIssue({code:"custom",message:"Stars requires positive whole units and one-off billing"});
  if(!/^(?:XTR|USD|EUR|GBP|TRY|AED|SAR|RUB|JPY|CAD|AUD|CHF|CNY|INR|BRL|SGD|HKD|NZD|ZAR|KRW|KWD|BHD|OMR|QAR|SEK|NOK|DKK|PLN|CZK|HUF|MXN|IDR|MYR|THB|PHP|EGP|ILS|RON|BGN|VND)$/u.test(p.currency)) c.addIssue({code:"custom",message:"Supported ISO currency required"});
});
export const knowledgeSchema = z.object({...base,content:text,category:z.enum(KB_CATEGORIES),plan_id:z.string().uuid().nullable(),
  declared_amount:decimalAmountSchema.nullable(),declared_currency:z.string().regex(/^[A-Z]{3}$/).nullable()}).strict().superRefine((k,c)=>{
  if(k.category==="Pricing" && (!k.plan_id||!k.declared_amount||!k.declared_currency))c.addIssue({code:"custom",message:"Pricing knowledge must reference structured plan and amount"});
});
export function commercialPayload(kind:string,value:unknown) { return kind==="product"?productSchema.parse(value):kind==="plan"?planSchema.parse(value):kind==="knowledge"?knowledgeSchema.parse(value):(()=>{throw new Error("COMMERCIAL_KIND_INVALID");})(); }
export function isUnsafeCommercialContent(value:unknown):boolean {
  const s=JSON.stringify(value);
  return /ignore.{0,30}(?:instructions|rules|policy)|system prompt|developer message|reveal.{0,30}(?:secret|token|prompt)|sk-[A-Za-z0-9_-]{12,}|service_role|BEGIN PRIVATE KEY|guarantee(?:d|s)?.{0,15}(?:profit|return)|risk.free|garanti.{0,15}(?:kazanç|kâr)|(?:payment|access).{0,15}(?:confirmed|activated)/iu.test(s);
}
export type CommercialDocument={item_id:string;version_id:string;version:number;kind:"product"|"plan"|"knowledge";published_at:string;effective_from:string;expires_at:string|null;test_only:boolean;payload:unknown};
export type CommercialContext={documents:CommercialDocument[];conflict:boolean};
export function commercialEvidence(context:CommercialContext,scope:{tenantId:string;conversationId:string;boundary:string;locale?:"en"|"tr"|"ar"|"ru"}):BackendEvidence[] {
  if(context.conflict)return [];
  const result:BackendEvidence[]=[];
  for(const d of context.documents){
    if(Date.parse(d.published_at)>Date.parse(scope.boundary)||Date.parse(d.effective_from)>Date.parse(scope.boundary)||(d.expires_at&&Date.parse(d.expires_at)<=Date.parse(scope.boundary))||isUnsafeCommercialContent(d.payload)) continue;
    const p=commercialPayload(d.kind,d.payload);
    const statements:string[]=[];
    if(d.kind==="plan"){
      const plan=planSchema.parse(p), locale=scope.locale??plan.locale;
      const period=plan.duration_unit==="calendar_month"?{en:"calendar month",tr:"takvim ayı",ar:"شهر تقويمي",ru:"календарный месяц"}[locale]:
        plan.duration_unit==="calendar_year"?{en:"calendar year",tr:"takvim yılı",ar:"سنة تقويمية",ru:"календарный год"}[locale]:{en:"day",tr:"gün",ar:"يوم",ru:"день"}[locale];
      statements.push({en:`${plan.title} costs ${plan.amount} ${plan.currency} for ${plan.duration_count} ${period}.`,tr:`${plan.title} fiyatı ${plan.duration_count} ${period} için ${plan.amount} ${plan.currency}.`,ar:`سعر ${plan.title} هو ${plan.amount} ${plan.currency} لمدة ${plan.duration_count} ${period}.`,ru:`Стоимость ${plan.title}: ${plan.amount} ${plan.currency} за ${plan.duration_count} ${period}.`}[locale]);
      for(const inclusion of plan.inclusions) statements.push({en:`${plan.title} includes ${inclusion}.`,tr:`${plan.title} şunları içerir: ${inclusion}.`,ar:`تشمل ${plan.title}: ${inclusion}.`,ru:`${plan.title} включает: ${inclusion}.`}[locale]);
      statements.push(plan.terms,...plan.restrictions,...plan.disclosures);
      if(plan.tax_rule)statements.push(plan.tax_rule);if(plan.renewal_rule)statements.push(plan.renewal_rule);if(plan.cancellation_rule)statements.push(plan.cancellation_rule);
    } else if(d.kind==="knowledge")statements.push(knowledgeSchema.parse(p).content);
    else statements.push(productSchema.parse(p).description);
    for(const [i,statement]of statements.flatMap(splitResponseSentences).entries())result.push({id:`${d.version_id}:fact:${i+1}`,tenantId:scope.tenantId,conversationId:scope.conversationId,occurredAt:d.published_at,status:"completed",category:"fact",statement});
  }
  let characters=0;return result.filter(f=>{characters+=f.statement.length;return characters<=8000;}).slice(0,40);
}
export function eligiblePlan(plan:z.infer<typeof planSchema>,lead:LeadIntelligence|null):boolean{
  const checks:[string,string|null][]=[["primary_instrument",plan.eligibility.instrument],["experience_level",plan.eligibility.experience_level],["actively_trades",plan.eligibility.actively_trades===null?null:plan.eligibility.actively_trades?"yes":"no"]];
  return checks.every(([key,expected])=>expected===null||Boolean(lead?.fields.some(f=>f.key===key&&["explicit","verified_system"].includes(f.classification)&&f.value?.toLowerCase()===expected.toLowerCase())));
}
export const conversionResultSchema=z.object({version:z.literal("conversion-v1"),action:z.enum(["WAIT","ANSWER","RECOMMEND","PREPARE_OFFER","HUMAN_REVIEW"]),plan_version_id:z.string().uuid().nullable(),offer_id:z.string().uuid().nullable().optional(),reason:z.string().max(200),discount_bps:z.number().int().min(0).max(10000),follow_up:z.object({action:z.enum(["WAIT","REVIEW_ONE_FOLLOW_UP"]),reason:z.string().max(160),delivery:z.literal("none")}).strict()}).strict();
export function buildConversion(context:AgentContext,commercial:CommercialContext,lead:LeadIntelligence|null){
  const text=context.recentMessages.at(-1)?.content??"";
  let action:"WAIT"|"ANSWER"|"RECOMMEND"|"PREPARE_OFFER"|"HUMAN_REVIEW"="ANSWER",reason="Answer current question from published records",selected:CommercialDocument|undefined;
  if(context.runtimeMode!=="AI_ACTIVE"||["unknown","blocked","revoked"].includes(context.contactability)){action="WAIT";reason="Human control or contact policy";}
  else if(commercial.conflict){action="HUMAN_REVIEW";reason="Commercial knowledge conflicts with structured catalog";}
  else if(lead?.next_action.action==="HUMAN_REVIEW"){action="HUMAN_REVIEW";reason="Sensitive customer dispute takes priority";}
  else if(/(?:recommend|which plan|offer|trial|öner|teklif|deneme|عرض|рекоменд|предлож)/iu.test(text)){
    const candidates=commercial.documents.filter(d=>d.kind==="plan"&&eligiblePlan(planSchema.parse(d.payload),lead));
    const period=/annual|year|yıllık|год|سنوي/iu.test(text)?"calendar_year":/monthly|month|aylık|месяц|شهري/iu.test(text)?"calendar_month":null;
    const wantsTrial=/trial|deneme|пробн|تجريب/iu.test(text);
    const matching=candidates.filter(d=>(!period||planSchema.parse(d.payload).duration_unit===period)&&(!wantsTrial||planSchema.parse(d.payload).trial));
    selected=matching.find(d=>text.toLowerCase().includes(planSchema.parse(d.payload).title.toLowerCase()))??(matching.length===1?matching[0]:undefined);
    if(selected){action=/offer|teklif|عرض|предлож/iu.test(text)?"PREPARE_OFFER":"RECOMMEND";reason="Published eligible plan matches explicit request";}
    else reason="No approved eligible plan; preserve uncertainty";
  } else if(/(?:how much|price|cost|include|included|inclusions?|benefits?|what do i get|fiyat|ücret|bedel|içer|neler|сколько|цена|стоим|вход|включ|السعر|كم|يشمل|يتضمن)/iu.test(text)){
    const candidates=commercial.documents.filter(d=>d.kind==="plan"&&eligiblePlan(planSchema.parse(d.payload),lead));
    const period=/annual|year|yıllık|год|سنوي/iu.test(text)?"calendar_year":/monthly|month|aylık|месяц|شهري/iu.test(text)?"calendar_month":null;
    const matching=candidates.filter(d=>!period||planSchema.parse(d.payload).duration_unit===period);
    selected=matching.find(d=>text.toLowerCase().includes(planSchema.parse(d.payload).title.toLowerCase()))??(matching.length===1?matching[0]:undefined);
    reason=selected?"Published eligible plan matches explicit question":"No approved eligible plan; preserve uncertainty";
  }
  const invited=/follow up|remind me|hatırlat|напомни|ذكرني/iu.test(text)&&!/do not|don['’]t|never|no follow/iu.test(text)&&!["WAIT","HUMAN_REVIEW"].includes(action);
  return conversionResultSchema.parse({version:"conversion-v1",action,reason,plan_version_id:selected?.version_id??null,discount_bps:0,follow_up:{action:invited?"REVIEW_ONE_FOLLOW_UP":"WAIT",reason:invited?"Customer explicitly requested follow-up; human review only, no scheduled send":"No independent outreach authorized; answer or wait",delivery:"none"}});
}
export function canRewriteOptionalInference(input:{response:string;claims:readonly {kind:string;grounding:string}[];reasons:readonly string[]}):boolean{
  return input.reasons.includes("UNSUPPORTED_CLAIM")&&input.claims.some(c=>c.kind==="fact"&&c.grounding==="INFERRED")
    &&!input.claims.some(c=>c.kind==="completed_action")
    &&!input.reasons.some(r=>["ACTION_RECEIPT_REQUIRED","ESCALATION_REQUIRED","EVIDENCE_REFERENCE_NOT_ALLOWED"].includes(r))
    &&!/(?:payment|access|refund|guarantee|profit|human|identity|ödeme|erişim|kazanç)/iu.test(input.response);
}

export function canonicalizeSingleCommercialFact(
  output: ConversationModelOutput,
  evidence: readonly BackendEvidence[],
): ConversationModelOutput {
  if (output.claims.length !== 1) return output;
  const claim = output.claims[0]!;
  if (claim.kind !== "fact" || claim.grounding !== "KNOWN_FROM_SYSTEM"
    || claim.action_category !== null || claim.evidence_refs.length !== 1) return output;
  const fact = evidence.find((item) => item.id === claim.evidence_refs[0] && item.category === "fact");
  if (!fact) return output;
  return {
    ...output,
    proposed_response: fact.statement,
    claims: [{...claim,text:fact.statement}],
    semantic_response: {
      ...output.semantic_response,
      key_points: [fact.statement],
      factual_grounding: {
        classification: "known_from_system",
        evidence_refs: [fact.id],
        missing_information: [],
      },
    },
  };
}

export function canonicalizeRequestedPlanAnswer(
  output: ConversationModelOutput,
  input: {
    sourceText: string;
    sourceMessageId: string;
    planVersionId: string | null | undefined;
    commercial: CommercialContext | undefined;
    evidence: readonly BackendEvidence[];
  },
): ConversationModelOutput {
  if (!input.planVersionId || !input.commercial || input.commercial.conflict) return output;
  if (/(?:payment|paid|access|refund|guarantee|profit|support|human|ödeme|erişim|iade|kazanç|kâr|оплат|доступ|прибыл|دفع|وصول|ربح)/iu.test(input.sourceText)) return output;
  const asksPrice = /(?:how much|price|cost|fiyat|ücret|bedel|сколько|цена|стоим|السعر|كم)/iu.test(input.sourceText);
  const asksInclusions = /(?:include|included|inclusions?|benefits?|what do i get|içer|neler|вход|включ|يشمل|يتضمن)/iu.test(input.sourceText);
  if (!asksPrice && !asksInclusions) return output;
  const document = input.commercial.documents.find((item) => item.kind === "plan" && item.version_id === input.planVersionId);
  if (!document) return output;
  const plan = planSchema.parse(document.payload);
  const ids = [
    ...(asksPrice ? [`${document.version_id}:fact:1`] : []),
    ...(asksInclusions ? plan.inclusions.map((_, index) => `${document.version_id}:fact:${index + 2}`) : []),
  ];
  const facts = ids.map((id) => input.evidence.find((item) => item.id === id && item.category === "fact"));
  if (facts.some((fact) => !fact)) return output;
  const resolved = facts as BackendEvidence[];
  const response = resolved.map((fact) => fact.statement).join(" ");
  return {
    ...output,
    proposed_response: response,
    confidence: 1,
    escalation_recommended: false,
    escalation_category: null,
    claims: resolved.map((fact) => ({text:fact.statement,kind:"fact" as const,speech_act:"BUSINESS_FACT" as const,grounding:"KNOWN_FROM_SYSTEM" as const,evidence_refs:[fact.id],action_category:null})),
    semantic_response: {
      ...output.semantic_response,
      key_points: resolved.slice(0, 4).map((fact) => fact.statement),
      factual_grounding: {classification:"known_from_system",evidence_refs:resolved.map((fact) => fact.id),missing_information:[]},
    },
  };
}
export function commercialDirector(director:ConversationDirector,text:string,commercial:CommercialContext|undefined):ConversationDirector{
 if(commercial?.conflict)return {...director,should_escalate:true,should_ask_question:false,should_sell:false,response_goal:"State that commercial details need human review without quoting conflicting terms."};
 // A complete policy/method question is not a personal refund/payment claim.
 // Appended operations/disputes do not match this whole-turn boundary.
 const policy=/^(?:what (?:is|are) (?:the |your )?(?:refund|cancellation) (?:policy|terms)|which payment methods do you accept|how can i pay|iade politikanız nedir|iptal koşulları nelerdir|hangi ödeme yöntemlerini kabul ediyorsunuz|ما هي سياسة الاسترداد|ما هي طرق الدفع|какова политика возврата|какие способы оплаты вы принимаете)[?؟.!]?$/iu.test(text.trim());
 const supported=commercial?.documents.some(x=>x.kind==="knowledge"&&["Policies","Payment Information"].includes(knowledgeSchema.parse(x.payload).category));
 return policy&&supported?{...director,primary_intent:"membership_details",conversation_stage:"information",should_escalate:false,should_ask_question:false,should_answer_directly:true,should_sell:false,response_goal:"Answer the customer's policy question using only the applicable published policy statements."}:director;
}
