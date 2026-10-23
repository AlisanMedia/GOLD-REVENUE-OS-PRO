import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { accessJobSchema,TestTelegramAccessAdapter,type TelegramAccessAdapter } from "./adapter";
export async function runTestEntitlementCycle(tenantId:string,adapter:TelegramAccessAdapter=new TestTelegramAccessAdapter()){
 const db=createSupabaseAdminClient(),tenant=z.uuid().parse(tenantId);
 const tick=await db.rpc("entitlement_tick",{target_tenant_id:tenant});if(tick.error)throw Error("ENTITLEMENT_TICK_FAILED");
 const claim=await db.rpc("entitlement_claim_job",{target_tenant_id:tenant});if(claim.error)throw Error("ACCESS_CLAIM_FAILED");if(!claim.data)return {processed:false};
 const job=accessJobSchema.parse(claim.data);if(job.tenant_id!==tenant)throw Error("ACCESS_TENANT_MISMATCH");if(job.mode!=="test")throw Error("LIVE_ACCESS_DISABLED");
 let result;try{result=await adapter.execute(job);}catch{result={ok:false};}
 const complete=await db.rpc("entitlement_complete_job",{target_tenant_id:tenant,target_job_id:job.id,lease_value:job.lease_token,result_value:result});if(complete.error)throw Error("ACCESS_COMPLETION_REJECTED");return {processed:true,confirmed:complete.data===true};
}
