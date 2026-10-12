import { z } from "zod";
import type { ContextMessage } from "./agent-runtime";

export const LEAD_FIELDS = ["experience_level", "primary_instrument", "actively_trades", "previous_service_experience", "goals", "requirements", "pain_points", "objections", "communication_style", "preferred_language", "preferred_signal_frequency", "price_sensitivity", "lead_source"] as const;
export const LEAD_CLASSIFICATIONS = ["explicit", "verified_system", "inferred", "unknown"] as const;
export const NEXT_ACTIONS = ["ASK_ONE_QUESTION", "ANSWER_EXISTING_QUESTION", "CONTINUE_CONVERSATION", "HUMAN_REVIEW", "PREPARE_LATER_STAGE", "WAIT"] as const;
const sourceSchema = z.object({ type: z.enum(["message", "system"]), id: z.string().min(1).max(160), quote: z.string().max(4096), observed_at: z.string().min(10).max(80) }).strict();
const fieldSchema = z.object({ key: z.enum(LEAD_FIELDS), value: z.string().min(1).max(400).nullable(), classification: z.enum(LEAD_CLASSIFICATIONS), confidence: z.number().min(0).max(1), source: sourceSchema.nullable() }).strict().superRefine((f, c) => {
  if (f.classification === "unknown" ? f.value !== null || f.source !== null || f.confidence !== 0 : f.value === null || f.source === null) c.addIssue({ code: "custom", message: "Value and provenance must agree with classification" });
  if (f.classification === "verified_system" && (f.key !== "lead_source" || f.source?.type !== "system")) c.addIssue({ code: "custom", message: "Only authoritative lead source is system verified" });
  if (["explicit", "inferred"].includes(f.classification) && f.source?.type !== "message") c.addIssue({ code: "custom", message: "Message evidence required" });
});
export const leadIntelligenceSchema = z.object({ version: z.literal("lead-intelligence-v1"), identity: z.enum(["matched", "unmatched"]), fields: z.array(fieldSchema).length(LEAD_FIELDS.length), completeness: z.number().min(0).max(1), missing_fields: z.array(z.enum(LEAD_FIELDS)), next_action: z.object({ action: z.enum(NEXT_ACTIONS), reason: z.string().max(160), field: z.enum(LEAD_FIELDS).nullable(), question: z.string().max(180).nullable(), delivery: z.literal("proposal_only") }).strict() }).strict().superRefine((r,c) => {
  if (new Set(r.fields.map(f=>f.key)).size !== LEAD_FIELDS.length) c.addIssue({code:"custom",message:"Exactly one value per field required"});
  const missing = r.fields.filter(f=>f.classification === "unknown" || f.classification === "inferred").map(f=>f.key);
  if (JSON.stringify(missing) !== JSON.stringify(r.missing_fields) || Math.abs(r.completeness - (LEAD_FIELDS.length-missing.length)/LEAD_FIELDS.length)>0.00001) c.addIssue({code:"custom",message:"Completeness must use supported evidence"});
  if ((r.next_action.action === "ASK_ONE_QUESTION") !== Boolean(r.next_action.question && r.next_action.field)) c.addIssue({code:"custom",message:"Bounded question contract"});
});
export type LeadIntelligence = z.infer<typeof leadIntelligenceSchema>;
type LeadField = LeadIntelligence["fields"][number];
export type LeadInput = { messages: readonly ContextMessage[]; customerId: string | null; conversationId: string | null; sourceId: string; observedAt: string; runtimeMode: string; lifecycleState: string | null; contactability: string; outboundEnabled: boolean; prior?: LeadIntelligence | null };
const patterns: ReadonlyArray<[LeadField["key"], RegExp, string | null]> = [
  ["experience_level", /^(?:I(?: am|['’]m) (?:a )?|I have |experience(?: level)?:\s*)(beginner|intermediate|experienced|advanced)(?: trader| trading experience)?[.!]?$/iu, null],
  ["experience_level", /^(?:Ben )?(yeni başlayan|orta seviye|tecrübeli|deneyimli)(?: bir trader)?(?:yım|im)?[.!]?$/iu, null],
  ["experience_level", /^(?:I have|I['’]ve been trading for)\s+(\d+ (?:years?|months?)(?: of trading experience)?)[.!]?$/iu, null],
  ["actively_trades", /^(?:I (?:actively )?trade(?: (?:gold|XAUUSD|forex|daily))?|I am actively trading|Aktif (?:olarak )?trade yapıyorum)[.!]?$/iu, "yes"],
  ["actively_trades", /^(?:I (?:do not|don['’]t) (?:actively )?trade|I am not trading|Aktif trade yapmıyorum)[.!]?$/iu, "no"],
  ["primary_instrument", /^(?:I (?:mainly |primarily |only )?trade|My primary instrument is|primary instrument:|Ana enstrümanım)\s+(XAUUSD|gold|forex|EURUSD|BTCUSD)[.!]?$/iu, null],
  ["previous_service_experience", /^(?:I have (?:used|tried)|I previously used|Daha önce kullandığım)\s+(.{0,250}(?:signal service|signal provider|sinyal servisi).{0,40})[.!]?$/iu, null],
  ["previous_service_experience", /^(?:I have never used a signal service|Daha önce sinyal servisi kullanmadım)[.!]?$/iu, "none"],
  ["goals", /^(?:My goal is|I want to|Hedefim)\s+(.{1,300})[.!]?$/iu, null],
  ["requirements", /^(?:I need|My requirement is|İhtiyacım)\s+(.{1,300})[.!]?$/iu, null],
  ["pain_points", /^(?:My main problem is|My pain point is|Sorunum)\s+(.{1,300})[.!]?$/iu, null],
  ["objections", /^(?:I am concerned about|I worry about|My concern is|Endişem)\s+(.{1,300})[.!]?$/iu, null],
  ["communication_style", /^(?:I prefer|Please use|Tercihim)\s+(brief replies|short replies|detailed replies|formal language|casual language|kısa cevaplar)[.!]?$/iu, null],
  ["preferred_language", /^(?:Please (?:reply|respond|speak) in|I prefer replies in)\s+(English|Turkish|Arabic|Russian)[.!]?$/iu, null],
  ["preferred_language", /^(Türkçe|İngilizce|Arapça|Rusça) (?:yanıt|cevap) ver[.!]?$/iu, null],
  ["preferred_signal_frequency", /^(?:I prefer|I want|Tercihim)\s+((?:one|two|three|\d+) signals? (?:per|a) (?:day|week)|daily signals|weekly signals|günde \d+ sinyal)[.!]?$/iu, null],
  ["price_sensitivity", /^(?:My budget is|I can afford|Bütçem)\s+(.{1,100})[.!]?$/iu, null],
];
const questions: Record<string, Partial<Record<LeadField["key"],string>>> = {
  en: { experience_level: "How much trading experience do you have?", actively_trades: "Do you actively trade at the moment?", primary_instrument: "Which instrument do you mainly trade?", previous_service_experience: "Have you used a signal service before?", goals: "What would you like help with most?" },
  tr: { experience_level: "Ne kadar trading tecrüben var?", actively_trades: "Şu anda aktif trade yapıyor musun?", primary_instrument: "Ağırlıklı olarak hangi enstrümanda işlem yapıyorsun?", previous_service_experience: "Daha önce sinyal servisi kullandın mı?", goals: "En çok hangi konuda destek istiyorsun?" },
};
export function buildLeadIntelligence(input: LeadInput): LeadIntelligence {
  const fields: LeadField[] = LEAD_FIELDS.map(key=>({key,value:null,classification:"unknown",confidence:0,source:null}));
  if (input.prior) for (const old of leadIntelligenceSchema.parse(input.prior).fields) {
    if (old.key !== "lead_source" && old.source && Date.parse(old.source.observed_at)<=Date.parse(input.observedAt)) fields[LEAD_FIELDS.indexOf(old.key)]={...old};
  }
  for (const message of input.messages) {
    if (message.direction!=="inbound" || !message.id || Date.parse(message.occurredAt)>Date.parse(input.observedAt)) continue;
    // Questions, quotations, grammar fixtures and imperative data-forging are not customer attributes.
    if (/grammar check|corrected sentence|[“”"]|ignore.*(?:rules|instructions)|system prompt/iu.test(message.content)) continue;
    for (const statement of message.content.normalize("NFKC").split(/(?<=[.!?])\s+|;\s*|\n/u)) {
      if (statement.endsWith("?") || statement.length>400) continue;
      for (const [key,pattern,canonical] of patterns) {
        const match=pattern.exec(statement.trim()); if (!match) continue;
        fields[LEAD_FIELDS.indexOf(key)]={key,value:(canonical ?? match[1] ?? statement).replace(/[.!]$/u,"").trim(),classification:"explicit",confidence:0.98,source:{type:"message",id:message.id,quote:statement.trim(),observed_at:message.occurredAt}};
      }
      if (/^XAUUSD[.!]?$/iu.test(statement.trim()) && fields[1]?.classification==="unknown") fields[1]={key:"primary_instrument",value:"XAUUSD",classification:"inferred",confidence:0.55,source:{type:"message",id:message.id,quote:statement.trim(),observed_at:message.occurredAt}};
    }
  }
  fields[LEAD_FIELDS.indexOf("lead_source")]={key:"lead_source",value:input.conversationId?"telegram":"customer_os",classification:"verified_system",confidence:1,source:{type:"system",id:input.sourceId,quote:"",observed_at:input.observedAt}};
  const missing=fields.filter(f=>f.classification==="unknown" || f.classification==="inferred").map(f=>f.key);
  const latest=[...input.messages].reverse().find(m=>m.direction==="inbound")?.content ?? "";
  let next:LeadIntelligence["next_action"]={action:"CONTINUE_CONVERSATION",reason:"No qualification interruption warranted",field:null,question:null,delivery:"proposal_only"};
  if (input.runtimeMode!=="AI_ACTIVE" || !input.outboundEnabled || ["blocked","revoked","unknown"].includes(input.contactability)) next={...next,action:"WAIT",reason:"Human control or delivery policy forbids messaging"};
  else if (/refund|paid.*(?:no|not|without).*access|fraud|scam|lost money|human review|speak to a human|iade|dolandır|ödeme.*erişim/iu.test(latest)) next={...next,action:"HUMAN_REVIEW",reason:"Sensitive dispute requires human review"};
  else if (["QUALIFIED","OFFER_SENT","INTERESTED"].includes(input.lifecycleState ?? "")) next={...next,action:"PREPARE_LATER_STAGE",reason:"Sales stage requires future approved business engine"};
  else if (/^(?:Please )?(?:ask me (?:one |a )?question|what do you need to know|bana (?:bir )?soru sor)[.!?]?$/iu.test(latest.trim())) {
    const language=/bana .*soru|Türkçe/iu.test(latest)?"tr":"en";
    const field=["actively_trades","primary_instrument","experience_level","previous_service_experience","goals"].find(k=>missing.includes(k as LeadField["key"])) as LeadField["key"]|undefined;
    const question=field?questions[language]?.[field]:null;
    const alreadyAsked=question && input.messages.some(m=>m.direction==="outbound" && m.content.includes(question));
    if (field && question && !alreadyAsked) next={...next,action:"ASK_ONE_QUESTION",reason:"Customer invited discovery; one missing field",field,question};
  } else if (/[?؟]/u.test(latest)) next={...next,action:"ANSWER_EXISTING_QUESTION",reason:"Answer the customer's current question first"};
  return leadIntelligenceSchema.parse({version:"lead-intelligence-v1",identity:input.customerId?"matched":"unmatched",fields,completeness:(LEAD_FIELDS.length-missing.length)/LEAD_FIELDS.length,missing_fields:missing,next_action:next});
}

export function validateLeadProvenance(value: unknown, input: LeadInput): LeadIntelligence {
  const result=leadIntelligenceSchema.parse(value);
  if (result.identity !== (input.customerId?"matched":"unmatched")) throw new Error("LEAD_IDENTITY_MISMATCH");
  for (const field of result.fields) {
    if (!field.source) continue;
    if (field.source.type==="system") {
      if (field.source.id!==input.sourceId || field.key!=="lead_source" || field.value!==(input.conversationId?"telegram":"customer_os")) throw new Error("LEAD_SYSTEM_FACT_FORGED");
    } else if (!input.messages.some(m=>m.direction==="inbound" && m.id===field.source?.id && m.content.normalize("NFKC").includes(field.source.quote) && m.occurredAt===field.source.observed_at)) throw new Error("LEAD_PROVENANCE_INVALID");
  }
  return result;
}
