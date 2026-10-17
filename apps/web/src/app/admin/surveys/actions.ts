"use server";
import { z } from "zod";
import { surveyDefinitionSchema } from "@gold-revenue-os/domain";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
const id=z.uuid(),revision=z.number().int().positive();
const input=z.discriminatedUnion("action",[
 z.object({action:z.literal("save"),definition:surveyDefinitionSchema,id:id.optional(),revision:revision.optional()}).strict(),
 z.object({action:z.literal("state"),id,revision,operation:z.enum(["approve","publish","archive"])}).strict(),
 z.object({action:z.literal("refresh"),id,month:z.string().regex(/^\d{4}-\d{2}-01$/)}).strict(),
 z.object({action:z.literal("review"),id,revision,operation:z.enum(["review","approve","reject","plan","complete","assign"]),assignee:id.nullable().optional(),note:z.string().max(1000).optional(),triage:z.boolean().optional()}).strict(),
 z.object({action:z.enum(["eligibility","invitation"]),id,customer:id,conversation:id,requested:z.boolean(),request:id}).strict(),
 z.object({action:z.literal("consent"),customer:id,revision:z.number().int().nonnegative(),consent:z.enum(["UNKNOWN","GRANTED","DENIED"]),evidence:z.string().min(8).max(300),expires:z.iso.datetime()}).strict(),
 z.object({action:z.literal("policy"),revision,settings:z.object({cadence_days:z.number().int().min(7).max(365).nullable(),cadence_approval:z.string().min(8).max(300).nullable(),retention_days:z.number().int().min(1).max(3650).nullable(),retention_approval:z.string().min(8).max(300).nullable(),legal_hold:z.boolean(),legal_hold_reference:z.string().max(300).nullable()}).strict()}).strict(),
 z.object({action:z.literal("telegram"),invitation:id}).strict(),
]);
export async function surveyAction(raw:unknown):Promise<{ok:boolean;data?:unknown;error?:"changed"|"invalid"|"denied"|"unavailable"}>{
 const context=await requireAdminCapability("surveys.manage"),value=input.safeParse(raw);if(!value.success)return {ok:false,error:"invalid"};const v=value.data;let name:string,args:Record<string,unknown>;
 switch(v.action){
 case "save":name="admin_survey_save";args={definition_value:v.definition,version_value:v.id??null,expected_revision:v.revision??0};break;
 case "state":name="admin_survey_state";args={version_value:v.id,expected_revision:v.revision,action_value:v.operation};break;
 case "refresh":name="admin_survey_refresh";args={version_value:v.id,month_value:v.month};break;
 case "review":name="admin_survey_review";args={item_value:v.id,expected_revision:v.revision,action_value:v.operation,assignee_value:v.assignee??null,note_value:v.note??null,triage_value:v.triage??false};break;
 case "consent":name="admin_survey_consent";args={customer_value:v.customer,expected_revision:v.revision,consent_value:v.consent,evidence_value:v.evidence,expires_value:v.expires};break;
 case "policy":name="admin_survey_policy";args={settings_value:v.settings,expected_revision:v.revision};break;
 case "telegram":name="admin_survey_telegram_start";args={invitation_value:v.invitation};break;
 default:name=v.action==="invitation"?"admin_survey_invitation":"admin_survey_eligibility";args={version_value:v.id,customer_value:v.customer,conversation_value:v.conversation,requested_value:v.requested,...(v.action==="invitation"?{request_id_value:v.request}:{})};
 }
 const db=await createSupabaseServerClient();const response=await db.rpc(name,{target_tenant_id:context.tenantId,...args});const data:unknown=response.data;const error=response.error;
 if(error)return {ok:false,error:error.code==="PT409"?"changed":error.code==="42501"?"denied":error.code==="22023"||error.code==="23514"?"invalid":"unavailable"};
 revalidatePath("/admin/surveys");revalidatePath("/admin/feedback");revalidatePath("/admin/insights");return {ok:true,data};
}
