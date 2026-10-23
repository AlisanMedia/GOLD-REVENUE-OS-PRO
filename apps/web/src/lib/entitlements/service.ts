import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { accessJobSchema,TestTelegramAccessAdapter,type TelegramAccessAdapter } from "./adapter";
const testQueueSchema=z.object({version:z.literal(1),job:accessJobSchema.nullable(),examined:z.number().int().min(0).max(32),stale:z.number().int().min(0).max(32),review:z.number().int().min(0).max(32),blocked:z.number().int().min(0).max(32),has_more:z.boolean()}).strict();
const testResultSchema=z.object({ok:z.boolean(),invite_reference:z.string().max(512).optional(),expires_at:z.iso.datetime({offset:true}).optional(),membership:z.enum(["member","left","kicked"]).optional()}).strict();
const maintenanceSchema=z.strictObject({version:z.literal(1),processed:z.number().int().min(0).max(25),held:z.number().int().min(0).max(9),expired:z.number().int().min(0).max(8),renewal_due:z.number().int().min(0).max(8),has_more:z.boolean(),busy:z.boolean()}).refine(m=>m.processed===m.held+m.expired+m.renewal_due&&(!m.busy||(m.processed===0&&m.has_more)));
export async function runTestEntitlementCycle(tenantId:string,adapter:TelegramAccessAdapter=new TestTelegramAccessAdapter()){
 const db=createSupabaseAdminClient(),tenant=z.uuid().parse(tenantId);
 const tick=await db.rpc("entitlement_test_maintenance_v1",{target_tenant_id:tenant});if(tick.error)throw Error("ENTITLEMENT_TICK_FAILED");
 const maintenance=maintenanceSchema.parse(tick.data);
 const claim=await db.rpc("entitlement_test_claim_cycle_v1",{target_tenant_id:tenant});if(claim.error)throw Error("ACCESS_CLAIM_FAILED");
 const queue=testQueueSchema.parse(claim.data),job=queue.job;
 if(!job)return {processed:false,maintenance,queue:{examined:queue.examined,stale:queue.stale,review:queue.review,blocked:queue.blocked,has_more:queue.has_more}};
 if(job.tenant_id!==tenant)throw Error("ACCESS_TENANT_MISMATCH");if(job.mode!=="test")throw Error("LIVE_ACCESS_DISABLED");
 const begin=await db.rpc("entitlement_test_begin_effect_v1",{target_tenant_id:tenant,target_job_id:job.id,lease_value:job.lease_token});
 if(begin.error)throw Error("ACCESS_EFFECT_AUTHORIZATION_FAILED");if(begin.data!==true)return {processed:true,confirmed:false};
 let result;try{result=testResultSchema.parse(await adapter.execute(job));}catch{result={ok:false,outcome:"unknown"};}
 const complete=await db.rpc("entitlement_complete_job",{target_tenant_id:tenant,target_job_id:job.id,lease_value:job.lease_token,result_value:result});if(complete.error)throw Error("ACCESS_COMPLETION_REJECTED");return {processed:true,confirmed:result.ok===true&&complete.data===true};
}
