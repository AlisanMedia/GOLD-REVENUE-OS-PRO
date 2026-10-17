import { z } from "zod";

export const surveyLanguages = ["en", "tr", "ar", "ru"] as const;
export const surveyTopics = ["SIGNAL", "VALUE", "SUPPORT", "RENEWAL", "CANCELLATION", "TRUST", "FEATURE", "IMPROVEMENT"] as const;
const text = z.string().trim().min(1).max(240);
export const surveyQuestionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,19}$/),
  type: z.enum(["RATING", "SINGLE", "MULTIPLE", "TEXT"]),
  topic: z.enum(surveyTopics), label: text,
  choices: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,19}$/).refine(v=>!["skip","stop","next","select","text"].includes(v)&&!v.startsWith("sel_")), label: text }).strict()).max(8).default([]),
}).strict().superRefine((q, ctx) => {
  if ((q.type === "SINGLE" || q.type === "MULTIPLE") && q.choices.length < 2) ctx.addIssue({code:"custom",message:"At least two choices required"});
  if ((q.type === "TEXT" || q.type === "RATING") && q.choices.length) ctx.addIssue({code:"custom",message:"Unexpected choices"});
  if (new Set(q.choices.map(c => c.id)).size !== q.choices.length) ctx.addIssue({code:"custom",message:"Duplicate choice"});
});
export const surveyDefinitionSchema = z.object({
  title: z.string().trim().min(3).max(120), language: z.enum(surveyLanguages).default("en"),
  audience: z.enum(["PROSPECT", "TRIAL", "VIP", "ALL"]),
  trigger: z.enum(["REQUESTED", "VIP_JOIN", "CANCELLATION", "DEPARTURE", "PERIODIC"]),
  privacy: z.enum(["IDENTIFIED", "ANONYMOUS", "BOTH"]).default("BOTH"),
  questions: z.array(surveyQuestionSchema).min(4).max(5),
}).strict().superRefine((s,ctx) => {
  if (/guaranteed (profit|return|income)|risk.free (trading|return)|audited (returns|performance)/iu.test(JSON.stringify(s.questions))) ctx.addIssue({code:"custom",message:"Unsupported commercial claim"});
  if (new Set(s.questions.map(q=>q.id)).size !== s.questions.length) ctx.addIssue({code:"custom",message:"Duplicate question"});
});
export type SurveyDefinition = z.infer<typeof surveyDefinitionSchema>;
export const surveyAnswerSchema = z.object({ question: z.string().max(20), skipped: z.boolean(), value: z.union([z.number().int().min(1).max(5),z.string().max(500),z.array(z.string().max(20)).max(8),z.null()]) }).strict();
export const surveyAnswersSchema = z.array(surveyAnswerSchema).min(4).max(5);
export type SurveyAnswer = z.infer<typeof surveyAnswerSchema>;
export function normalizeSurveyAnswers(definition: SurveyDefinition, input: unknown, anonymous = false): SurveyAnswer[] {
  const answers = surveyAnswersSchema.parse(input);
  if (answers.length !== definition.questions.length || new Set(answers.map(a=>a.question)).size !== answers.length) throw Error("SURVEY_ANSWERS_INVALID");
  return definition.questions.map(q => {
    const a = answers.find(a=>a.question===q.id);
    if (!a || (a.skipped && a.value!==null)) throw Error("SURVEY_ANSWERS_INVALID");
    if (a.skipped) return a;
    if (q.type === "RATING" && (typeof a.value!=="number" || !Number.isInteger(a.value) || a.value<1 || a.value>5)) throw Error("SURVEY_ANSWERS_INVALID");
    if (q.type === "TEXT" && (typeof a.value!=="string" || !a.value.trim() || (anonymous && /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:https?:\/\/|www\.)|@[a-z0-9_]{3,}|\+?\d[\d ()-]{7,}\d/iu.test(a.value)))) throw Error("SURVEY_TEXT_PRIVACY");
    if (q.type === "SINGLE" && (typeof a.value!=="string" || !q.choices.some(c=>c.id===a.value))) throw Error("SURVEY_ANSWERS_INVALID");
    if (q.type === "MULTIPLE" && (!Array.isArray(a.value) || !a.value.length || new Set(a.value).size!==a.value.length || a.value.some(v=>!q.choices.some(c=>c.id===v)))) throw Error("SURVEY_ANSWERS_INVALID");
    return {...a,value:typeof a.value==="string"?a.value.trim():a.value};
  });
}

const rating = (id:string,topic:typeof surveyTopics[number],label:string) => ({id,type:"RATING" as const,topic,label,choices:[]});
const choices = (id:string,topic:typeof surveyTopics[number],label:string,values:string[]) => ({id,type:"SINGLE" as const,topic,label,choices:values.map((v,i)=>({id:`c${i+1}`,label:v}))});
const note = {id:"suggestion",type:"TEXT" as const,topic:"IMPROVEMENT" as const,label:"What could we improve? Please do not include personal or payment information.",choices:[]};
export const surveyStarterTemplates: readonly SurveyDefinition[] = [
  {title:"Your needs and questions",language:"en",audience:"PROSPECT",trigger:"REQUESTED",privacy:"BOTH",questions:[choices("need","FEATURE","What are you looking for?",["Clear service information","Membership options","Support","Other"]),choices("objection","VALUE","What would help you decide?",["Clearer pricing","Understanding the service","More support information","I am not considering membership"]),rating("clarity","TRUST","How clear is the information available to you?"),rating("support","SUPPORT","How helpful has the support been?"),note]},
  {title:"Your VIP onboarding experience",language:"en",audience:"VIP",trigger:"VIP_JOIN",privacy:"BOTH",questions:[rating("joining","RENEWAL","How easy was it to get started?"),rating("clarity","SIGNAL","How clear is the service information?"),rating("support","SUPPORT","How helpful was onboarding support?"),rating("value","VALUE","How would you rate the value you have experienced so far?"),note]},
  {title:"Service satisfaction and value",language:"en",audience:"ALL",trigger:"PERIODIC",privacy:"BOTH",questions:[rating("signal","SIGNAL","How clear and timely do you find the service updates?"),rating("value","VALUE","How would you rate the membership value?"),rating("support","SUPPORT","How satisfied are you with support?"),rating("renewal","RENEWAL","How satisfied are you with your renewal experience?"),note]},
  {title:"Cancellation and departure feedback",language:"en",audience:"VIP",trigger:"CANCELLATION",privacy:"BOTH",questions:[choices("reason","CANCELLATION","What is your main reason for leaving?",["Price or value","Service did not meet my needs","Support experience","No longer needed","Other"]),rating("value","VALUE","How would you rate the membership value?"),rating("support","SUPPORT","How satisfied were you with support?"),choices("future","RENEWAL","Would you like to consider the service again?",["Yes","Maybe","No"]),note]},
].map(s=>surveyDefinitionSchema.parse(s));

export type SurveyCallback = { session: string; revision: number; question: number; choice: string };
export function surveyCallback(v:SurveyCallback):string {
  if(!/^[a-f0-9]{16}$/.test(v.session)||!Number.isSafeInteger(v.revision)||v.revision<1||v.revision>999||!Number.isInteger(v.question)||v.question<0||v.question>4||!/^(?:[1-5]|[a-z][a-z0-9_]{0,23})$/.test(v.choice))throw Error("SURVEY_CALLBACK_INVALID");
  return `s14:${v.session}:${v.revision}:${v.question}:${v.choice}`;
}
export function parseSurveyCallback(value:unknown):SurveyCallback {
  if(typeof value!=="string"||new TextEncoder().encode(value).length>64)throw Error("SURVEY_CALLBACK_INVALID");
  const match=/^s14:([a-f0-9]{16}):(\d{1,3}):([0-4]):([1-5]|[a-z][a-z0-9_]{0,23})$/.exec(value);
  if(!match)throw Error("SURVEY_CALLBACK_INVALID");
  const result={session:match[1]!,revision:Number(match[2]),question:Number(match[3]),choice:match[4]!};surveyCallback(result);return result;
}
export const surveyTelegramUpdateSchema=z.object({update_id:z.number().int().nonnegative(),callback_query:z.object({id:z.string().min(1).max(100),from:z.object({id:z.number().int().positive()}),message:z.object({message_id:z.number().int().positive(),chat:z.object({id:z.number().int(),type:z.literal("private")})}),data:z.string().max(64)})});
export function normalizeSurveyTelegramUpdate(input:unknown) {
 const callback=surveyTelegramUpdateSchema.safeParse(input);
 if(callback.success){const u=callback.data,q=u.callback_query;return {kind:"callback" as const,update:u.update_id,callback:q.id,user:String(q.from.id),chat:String(q.message.chat.id),message:q.message.message_id,...parseSurveyCallback(q.data)};}
 const u=z.object({update_id:z.number().int().nonnegative(),message:z.object({message_id:z.number().int().positive(),from:z.object({id:z.number().int().positive(),is_bot:z.literal(false).optional()}),chat:z.object({id:z.number().int().positive(),type:z.literal("private")}),text:z.string().trim().min(1).max(500)})}).parse(input);
 return {kind:"text" as const,update:u.update_id,user:String(u.message.from.id),chat:String(u.message.chat.id),message:u.message.message_id,text:u.message.text};
}
export function surveyTelegramPrompt(d:SurveyDefinition,state:{session:string;revision:number;question:number;selected?:string[];anonymousUrl?:string}){
 const q=d.questions[state.question];if(!q)throw Error("SURVEY_QUESTION_INVALID");
 const words={en:["Skip","Stop","Continue","Optional: reply with a short message."],tr:["Atla","Durdur","Devam","İsteğe bağlı: kısa bir mesajla yanıtlayın."],ar:["تخطي","إيقاف","متابعة","اختياري: أجب برسالة قصيرة."],ru:["Пропустить","Остановить","Продолжить","Необязательно: ответьте коротким сообщением."]}[d.language];
 const button=(text:string,choice:string)=>({text,callback_data:surveyCallback({...state,choice})});
 const options=q.type==="RATING"?[[1,2,3,4,5].map(n=>button(String(n),String(n)))]:q.type==="SINGLE"||q.type==="MULTIPLE"?q.choices.map(c=>[button((state.selected?.includes(c.id)?"✓ ":"")+c.label,q.type==="MULTIPLE"?"sel_"+c.id:c.id)]):[];
 if(q.type==="MULTIPLE")options.push([button(words[2]!,"next")]);
 options.push([button(words[0]!,"skip"),button(words[1]!,"stop")]);
 let privacy="";if(state.anonymousUrl&&d.privacy!=="IDENTIFIED"){const u=new URL(state.anonymousUrl);if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash||!/^\/survey\/anonymous\/[a-f0-9-]{36}$/.test(u.pathname))throw Error("SURVEY_ANONYMOUS_LINK_INVALID");const names={en:["Anonymous web form","Telegram exposes sender identity. For identity-unlinked feedback, use the separate shared web form."],tr:["Anonim web formu","Telegram gönderici kimliğini gösterir. Kimliksiz geri bildirim için ayrı ortak web formunu kullanın."],ar:["نموذج ويب مجهول","يعرض Telegram هوية المرسل. للملاحظات غير المرتبطة بالهوية استخدم النموذج المشترك المنفصل."],ru:["Анонимная веб-форма","Telegram раскрывает отправителя. Для отзыва без привязки к личности используйте отдельную общую веб-форму."]}[d.language];privacy="\n"+names[1];const markup:({text:string;callback_data:string}|{text:string;url:string})[][]=options;markup.push([{text:names[0]!,url:u.href}]);return {text:`STAGING · TEST\n${state.question+1}/${d.questions.length} · ${q.label}${q.type==="TEXT"?"\n"+words[3]:""}${privacy}`,reply_markup:{inline_keyboard:markup},send_enabled:false as const,transport:"PREVIEW" as const};}
 return {text:`STAGING · TEST\n${state.question+1}/${d.questions.length} · ${q.label}${q.type==="TEXT"?"\n"+words[3]:""}`,reply_markup:{inline_keyboard:options},send_enabled:false as const,transport:"PREVIEW" as const};
}
export function anonymousDistribution(cells:Readonly<Record<string,number>>, minimum=5):Record<string,number>|null {
 if(minimum<5)throw Error("PRIVACY_THRESHOLD_INVALID");
 const values=Object.values(cells);
 return values.reduce((a,b)=>a+b,0)<minimum||values.some(n=>n>0&&n<minimum)?null:{...cells};
}
export function surveyAlertDraft(category:string,severity:string,reference:string,adminUrl:string):{status:"DRAFTED";send_enabled:false;chat_id:"-5537216841";bot_id:"8915334711";text:string} {
 const categories:Record<string,string>={security_issue:"Güvenlik sorunu",legal_threat:"Hukuki şikâyet",fraud_accusation:"Dolandırıcılık şikâyeti",financial_loss:"Maddi kayıp şikâyeti",refund_request:"İade talebi",missing_access:"VIP erişim sorunu",payment_dispute:"Ödeme itirazı",human_request:"Yöneticiyle görüşme talebi"};
 const url=new URL(adminUrl);
 if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||!/^\/admin\/(attention|feedback|insights)(?:\/[a-f0-9-]+)?$/.test(url.pathname)||!/^FB-[A-F0-9]{6}$/.test(reference))throw Error("SURVEY_ALERT_INVALID");
 return {status:"DRAFTED",send_enabled:false,chat_id:"-5537216841",bot_id:"8915334711",text:`GOLD REVENUE OS · STAGING / TEST\nGeri bildirim incelemesi — TASLAK\n\nÖncelik: ${severity==="CRITICAL"?"Kritik":"Yüksek"}\nKonu: ${categories[category]??"Müşteri geri bildirimi"}\nAnket yanıtında inceleme gerektiren bir konu tespit edildi.\nYönetici bildirimi gönderilmedi. Kaynak kaydını yönetim panelinden inceleyin.\n\nKayıt: ${reference}\nYönetim paneli: ${url.href}`};
}
