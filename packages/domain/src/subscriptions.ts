import { z } from "zod";
export const SUBSCRIPTION_STATES = ["ACTIVE","RENEWAL_DUE","EXPIRED","HOLD","SUSPENDED","CANCELLED"] as const;
export type SubscriptionState = typeof SUBSCRIPTION_STATES[number];
export const subscriptionTermsSchema = z.object({ duration_unit:z.enum(["calendar_month","calendar_year","fixed_days"]),duration_count:z.number().int().min(1).max(366),grace_days:z.number().int().min(0).max(30).default(0),grace_approved:z.boolean().default(false),renewal_notice_days:z.number().int().min(0).max(30).default(3) }).refine(t=>t.grace_days===0||t.grace_approved,"Grace requires approval");
export type SubscriptionTerms = z.infer<typeof subscriptionTermsSchema>;
export function subscriptionExpiry(start:string,raw:unknown):string {
 const terms=subscriptionTermsSchema.parse(raw),d=new Date(start);if(!Number.isFinite(d.getTime()))throw Error("INVALID_ACTIVATION_TIME");
 if(terms.duration_unit==="fixed_days")d.setUTCDate(d.getUTCDate()+terms.duration_count);
 else {const day=d.getUTCDate();d.setUTCDate(1);if(terms.duration_unit==="calendar_month")d.setUTCMonth(d.getUTCMonth()+terms.duration_count);else d.setUTCFullYear(d.getUTCFullYear()+terms.duration_count);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));}return d.toISOString();
}
export function entitlementValid(s:{state:SubscriptionState;ends_at:string;grace_until:string},now:string):boolean {return ["ACTIVE","RENEWAL_DUE"].includes(s.state)&&Date.parse(s.grace_until)>=Date.parse(s.ends_at)&&Date.parse(s.grace_until)>Date.parse(now);}
export function nextSubscriptionState(current:SubscriptionState,action:"hold"|"suspend"|"cancel"|"release"|"renew"|"expire"|"due"):SubscriptionState {
 if(current==="CANCELLED"&&action!=="cancel")throw Error("CANCELLED_SUBSCRIPTION");if(action==="hold")return "HOLD";if(action==="suspend")return "SUSPENDED";if(action==="cancel")return "CANCELLED";if(action==="release"){if(!["HOLD","SUSPENDED"].includes(current))throw Error("INVALID_RELEASE");return "ACTIVE";}if(action==="renew")return ["HOLD","SUSPENDED"].includes(current)?current:"ACTIVE";if(action==="expire")return ["HOLD","SUSPENDED"].includes(current)?current:"EXPIRED";return current==="ACTIVE"?"RENEWAL_DUE":current;
}
export type JourneyState="select"|"payment_pending"|"payment_expired"|"underpaid"|"wrong_network"|"review"|"access_pending"|"join"|"active"|"expired";
const wording:Record<JourneyState,Record<"en"|"tr"|"ar"|"ru",string>>={
 select:{en:"Select your membership.",tr:"Üyeliğinizi seçin.",ar:"اختر عضويتك.",ru:"Выберите подписку."},
 payment_pending:{en:"Your payment is awaiting confirmation. This page updates automatically.",tr:"Ödemeniz onay bekliyor. Bu sayfa otomatik güncellenir.",ar:"الدفع بانتظار التأكيد. يتم تحديث الصفحة تلقائياً.",ru:"Платёж ожидает подтверждения. Страница обновляется автоматически."},
 payment_expired:{en:"This payment request expired. Return to your membership to request a new checkout.",tr:"Ödeme isteğinin süresi doldu. Yeni ödeme için üyeliğinize dönün.",ar:"انتهت صلاحية طلب الدفع. ارجع إلى عضويتك لطلب دفع جديد.",ru:"Срок запроса оплаты истёк. Вернитесь к подписке для нового запроса."},
 underpaid:{en:"The received amount does not match the total. Verification is on hold; do not send another payment yet.",tr:"Alınan tutar toplamla eşleşmiyor. Doğrulama beklemede; henüz tekrar ödeme yapmayın.",ar:"المبلغ المستلم لا يطابق الإجمالي. التحقق معلق؛ لا ترسل دفعة أخرى الآن.",ru:"Полученная сумма не совпадает с итогом. Проверка приостановлена; пока не платите повторно."},
 wrong_network:{en:"The payment network does not match this request. Do not pay again while we review it.",tr:"Ödeme ağı bu istekle eşleşmiyor. İnceleme sırasında tekrar ödeme yapmayın.",ar:"شبكة الدفع لا تطابق الطلب. لا تدفع مرة أخرى أثناء المراجعة.",ru:"Сеть платежа не соответствует запросу. Не платите повторно во время проверки."},
 review:{en:"Your payment or access needs review. No new payment is required while it is checked.",tr:"Ödemeniz veya erişiminiz inceleme gerektiriyor. Kontrol sırasında yeni ödeme yapmayın.",ar:"الدفع أو الوصول يحتاج إلى مراجعة. لا حاجة لدفع جديد أثناء التحقق.",ru:"Платёж или доступ требует проверки. Не платите повторно во время проверки."},
 access_pending:{en:"Payment verified. Your membership is active; VIP joining is being prepared.",tr:"Ödeme doğrulandı. Üyeliğiniz aktif; VIP katılımı hazırlanıyor.",ar:"تم التحقق من الدفع. عضويتك نشطة؛ يتم تجهيز الانضمام إلى VIP.",ru:"Платёж подтверждён. Подписка активна; вход в VIP готовится."},
 join:{en:"Payment verified. Your membership is active. Join VIP using the authorized invitation below.",tr:"Ödeme doğrulandı. Üyeliğiniz aktif. Aşağıdaki yetkili davetle VIP’ye katılın.",ar:"تم التحقق من الدفع. عضويتك نشطة. انضم إلى VIP عبر الدعوة المعتمدة أدناه.",ru:"Платёж подтверждён. Подписка активна. Войдите в VIP по приглашению ниже."},
 active:{en:"Your membership and VIP access are active.",tr:"Üyeliğiniz ve VIP erişiminiz aktif.",ar:"عضويتك ووصولك إلى VIP نشطان.",ru:"Подписка и доступ к VIP активны."},
 expired:{en:"Your membership has expired. Select a renewal to restore access.",tr:"Üyeliğinizin süresi doldu. Erişim için yenileme seçin.",ar:"انتهت عضويتك. اختر التجديد لاستعادة الوصول.",ru:"Подписка истекла. Выберите продление для восстановления доступа."}};
export function purchaseJourney(input:{paymentVerified:boolean;paymentState:string;reason?:string;subscriptionState?:string;entitled:boolean;membershipVerified:boolean;inviteAvailable:boolean;mode:"test"|"live"},locale:"en"|"tr"|"ar"|"ru"="en") {
 let state:JourneyState="payment_pending";
 if(input.paymentState==="EXPIRED")state="payment_expired";
 if(input.paymentState==="REVIEW"||["HOLD","SUSPENDED","CANCELLED"].includes(input.subscriptionState??""))state=input.reason==="UNDERPAYMENT"?"underpaid":input.reason==="WRONG_NETWORK"?"wrong_network":"review";
 else if(input.subscriptionState==="EXPIRED"||(input.paymentVerified&&["ACTIVE","RENEWAL_DUE"].includes(input.subscriptionState??"")&&!input.entitled))state="expired";
 else if(input.paymentVerified&&input.entitled)state=input.membershipVerified?"active":input.inviteAvailable?"join":"access_pending";
 const message=wording[state][locale];return {state,message:input.mode==="test"?`TEST ONLY — ${message}`:message,action:state==="join"?"join":state==="expired"||state==="payment_expired"?"select":"wait"};
}
