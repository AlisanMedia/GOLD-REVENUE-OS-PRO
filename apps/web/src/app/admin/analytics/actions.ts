"use server";
import {z} from "zod";
import {requireAdminCapability} from "@/lib/admin/server";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {revalidatePath} from "next/cache";
const input=z.discriminatedUnion("action",[
 z.object({action:z.literal("submit"),request:z.uuid(),category:z.enum(["SUPPLIER","PROCESSING","INFRASTRUCTURE","SUPPORT","COMMISSION","OTHER"]),classification:z.enum(["ASSUMPTION","DOCUMENTED"]),amount:z.string().regex(/^(0|[1-9][0-9]{0,20})(\.[0-9]{1,8})?$/),currency:z.string().regex(/^[A-Z]{3,6}$/),start:z.iso.date(),end:z.iso.date(),reference:z.string().min(8).max(240),hash:z.string().regex(/^[a-f0-9]{64}$/).nullable()}).strict(),
 z.object({action:z.literal("review"),id:z.uuid(),revision:z.number().int().positive(),approve:z.boolean()}).strict()
]);
export async function analyticsCostAction(raw:unknown):Promise<{ok:boolean;error?:"invalid"|"changed"|"denied"|"unavailable"}>{
 const context=await requireAdminCapability("analytics.manage"),parsed=input.safeParse(raw);if(!parsed.success)return {ok:false,error:"invalid"};const v=parsed.data;
 const args=v.action==="review"?{target_tenant_id:context.tenantId,item_value:v.id,expected_revision:v.revision,approve_value:v.approve}:{target_tenant_id:context.tenantId,request_value:v.request,category_value:v.category,classification_value:v.classification,amount_value:v.amount,currency_value:v.currency,start_value:v.start,end_value:v.end,reference_value:v.reference,hash_value:v.hash};
 const db=await createSupabaseServerClient();const {error}=await db.rpc(v.action==="review"?"admin_analytics_cost_review":"admin_analytics_cost_submit",args);
 if(error)return {ok:false,error:error.code==="PT409"?"changed":error.code==="42501"?"denied":["22023","23514"].includes(error.code)?"invalid":"unavailable"};
 revalidatePath("/admin/analytics","layout");return {ok:true};
}
