"use server";
import { z } from "zod";
import { requireAdminCapability } from "@/lib/admin/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
export type SuccessActionState={status:"idle"|"success"|"error";code:string;nextCursor?:string};
export async function successAction(_previous:SuccessActionState,form:FormData):Promise<SuccessActionState> {
 const context=await requireAdminCapability("success.manage"),db=await createSupabaseServerClient();
 const parsed=z.object({task:z.uuid(),revision:z.coerce.number().int().positive(),action:z.enum(["claim","assign","wait","complete","dismiss","recommend_winback","preview","review_preview"]),assignee:z.union([z.uuid(),z.literal("")]).optional(),note:z.string().max(1000).optional(),preview:z.uuid().optional(),reason:z.string().optional()}).safeParse(Object.fromEntries(form));
 if(!parsed.success)return {status:"error",code:"INVALID_INPUT"};const p=parsed.data;
 if(p.action==="review_preview"&&!p.preview)return {status:"error",code:"INVALID_INPUT"};
 const {error}=await db.rpc(p.action==="review_preview"?"admin_success_review_preview":p.action==="preview"?"admin_success_preview":"admin_success_action",{target_tenant_id:context.tenantId,...(p.action==="review_preview"?{preview_value:p.preview}:{task_value:p.task}),expected_revision:p.revision,...(["preview","review_preview"].includes(p.action)?{}:{action_value:p.action,assignee_value:p.assignee||null,note_value:p.note||null,reason_value:p.reason||null})});
 if(error)return {status:"error",code:["PT409","42501","55000","22023"].includes(error.code)?error.code:"UNAVAILABLE"};
 revalidatePath("/admin/customer-success","layout");revalidatePath("/admin");return {status:"success",code:p.action==="preview"?"PREVIEW_CREATED":"SAVED"};
}
export async function refreshSuccess(_previous:SuccessActionState,form:FormData):Promise<SuccessActionState> {
 const context=await requireAdminCapability("success.manage"),db=await createSupabaseServerClient();
 const parsed=z.object({request:z.uuid(),customer:z.union([z.uuid(),z.literal("")]).optional(),cursor:z.union([z.uuid(),z.literal("")]).optional()}).safeParse(Object.fromEntries(form));if(!parsed.success)return {status:"error",code:"INVALID_INPUT"};
 const {data,error}=await db.rpc("admin_success_refresh",{target_tenant_id:context.tenantId,request_id_value:parsed.data.request,customer_value:parsed.data.customer||null,after_value:parsed.data.cursor||null});
 if(error)return {status:"error",code:error.code==="42501"?"SANDBOX_DISABLED":"UNAVAILABLE"};
 revalidatePath("/admin/customer-success","layout");revalidatePath("/admin");return {status:"success",code:data?.next_cursor?"BATCH_COMPLETE_MORE_AVAILABLE":"SAVED",...(typeof data?.next_cursor==="string"?{nextCursor:data.next_cursor}:{})};
}
export async function saveContactPolicy(_previous:SuccessActionState,form:FormData):Promise<SuccessActionState> {
 const context=await requireAdminCapability("success.manage"),db=await createSupabaseServerClient();
 const parsed=z.object({customer:z.uuid(),revision:z.coerce.number().int().min(0),consent:z.enum(["UNKNOWN","GRANTED","DENIED"]),opted_out:z.enum(["true","false"]),language:z.enum(["en","tr","ar","ru"]),timezone:z.string().max(100),window_start:z.coerce.number().int().min(0).max(23),window_end:z.coerce.number().int().min(1).max(24),evidence:z.string().trim().min(8).max(300)}).safeParse(Object.fromEntries(form));if(!parsed.success)return {status:"error",code:"INVALID_INPUT"};const p=parsed.data;
 if(p.window_end<=p.window_start)return {status:"error",code:"INVALID_INPUT"};
 const {error}=await db.rpc("admin_success_contact_policy",{target_tenant_id:context.tenantId,customer_value:p.customer,expected_revision:p.revision,consent_value:p.consent,opted_out_value:p.opted_out==="true",language_value:p.language,timezone_value:p.timezone||null,window_start_value:p.window_start,window_end_value:p.window_end,evidence_value:p.evidence});if(error)return {status:"error",code:error.code==="PT409"?"PT409":"UNAVAILABLE"};revalidatePath("/admin/customer-success","layout");return {status:"success",code:"SAVED"};
}
export async function retrySuccessReview(_previous:SuccessActionState,form:FormData):Promise<SuccessActionState> {
 const context=await requireAdminCapability("success.manage"),db=await createSupabaseServerClient();
 const p=z.object({job:z.uuid(),attempts:z.coerce.number().int().min(1).max(32)}).safeParse(Object.fromEntries(form));if(!p.success)return {status:"error",code:"INVALID_INPUT"};
 const {error}=await db.rpc("admin_success_retry_review",{target_tenant_id:context.tenantId,job_value:p.data.job,expected_attempts:p.data.attempts});if(error)return {status:"error",code:error.code==="PT409"?"PT409":"UNAVAILABLE"};revalidatePath("/admin/customer-success","layout");return {status:"success",code:"REVIEW_REQUEUED"};
}
