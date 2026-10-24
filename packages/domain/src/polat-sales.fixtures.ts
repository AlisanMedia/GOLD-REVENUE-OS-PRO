import type {z} from "zod";
import type {polatSalesInputSchema} from "@gold-revenue-os/contracts";
import {polatFixture} from "./polat-conversation.fixtures";
export function polatSalesFixture(text="I'm interested",language:"en"|"tr"="en"):z.infer<typeof polatSalesInputSchema>{
 const conversation=polatFixture(text,language),base={tenant_id:conversation.tenant_id,conversation_id:conversation.conversation_id,approval:"APPROVED_SYNTHETIC"as const,version:1,published_at:"2026-10-23T00:00:00Z",effective_from:"2026-10-23T00:00:00Z",expires_at:null,test_only:true as const};
 const productId="61c05000-0000-4000-8000-000000000001",planId="61c05000-0000-4000-8000-000000000002";
 return {version:1 as const,mode:"SYNTHETIC"as const,conversation,catalog_conflict:false,style:"DIRECT"as "DIRECT"|"ONE_QUESTION",catalog:[
 {...base,item_id:productId,version_id:"61c06000-0000-4000-8000-000000000001",kind:"product"as const,payload:{title:"Fixture Service",locale:language,source:"Invented test catalog; no real commercial rights",description:language==="tr"?"Deneme hizmeti, sentetik sinyal özetleri sunar.":"The fixture service provides synthetic signal summaries.",service_rights:"Synthetic examples only; no supplier approval"}},
 {...base,item_id:planId,version_id:"61c06000-0000-4000-8000-000000000002",kind:"plan"as const,payload:{title:language==="tr"?"Deneme Üyeliği":"Fixture Membership",locale:language,source:"Approved synthetic fixture only",product_id:productId,amount:"10.00",currency:"USD",duration_unit:"calendar_month",duration_count:1,billing:"one_off",inclusions:[language==="tr"?"sentetik sinyal özetleri":"synthetic signal summaries"],restrictions:[],terms:language==="tr"?"Yalnız sentetik değerlendirme içindir.":"For synthetic evaluation only.",eligibility:{instrument:null,actively_trades:null,experience_level:null},max_discount_bps:0,trial:false,offer_valid_hours:24,tax_rule:null,renewal_rule:null,cancellation_rule:null,disclosures:[]}}
 ]};
}
export const POLAT_SALES_CORPUS=[
 {id:"interested",text:"I'm interested in joining",next:"REQUEST_PURCHASE_REVIEW",contains:"10.00 USD"},
 {id:"price_objection",text:"That's too expensive. What is the price?",next:"REVIEW_APPROVED_PLAN",contains:"10.00 USD"},
 {id:"trust_objection",text:"Can I trust this? Do you guarantee profits?",next:"REVIEW_APPROVED_PLAN",contains:"can't promise trading profits"},
 {id:"confused",text:"I'm confused, what's included?",next:"REVIEW_APPROVED_PLAN",contains:"synthetic signal summaries"},
 {id:"returning",text:"I'm a returning former member, what is the price?",next:"REVIEW_APPROVED_PLAN",contains:"can't verify your previous membership"},
 {id:"payment_uncertain",text:"I paid. Is my payment confirmed?",next:"HUMAN_REVIEW",contains:"can't verify"},
 {id:"vip_access",text:"I paid but have no VIP access",next:"HUMAN_REVIEW",contains:"human review"},
 {id:"refund",text:"I want a refund",next:"HUMAN_REVIEW",contains:"human review"},
 {id:"uninterested",text:"No thanks, I'm not interested",next:"WAIT",contains:"No problem"},
 {id:"opt_out",text:"Do not contact me again",next:"STOP_CONTACT",contains:"don't want further contact"},
 {id:"multiple_objections",text:"Too expensive, how much is it, and can I trust any profit guarantee?",next:"REVIEW_APPROVED_PLAN",contains:"10.00 USD"},
 {id:"human_request",text:"Can I talk to Polat?",next:"HUMAN_REVIEW",contains:"human review"},
 {id:"negotiation",text:"Can you give me a discount?",next:"HUMAN_REVIEW",contains:"human review"},
 {id:"turkish",text:"Fiyat ve üyelik kapsamı nedir?",lang:"tr"as const,next:"REVIEW_APPROVED_PLAN",contains:"10.00 USD"},
 {id:"cancel",text:"Cancel my subscription",next:"HUMAN_REVIEW",contains:"human review"}
]as const;
