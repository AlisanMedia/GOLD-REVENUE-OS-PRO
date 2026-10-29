import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
const resultSchema=z.object({processed:z.number().int().min(0).max(125),tenants:z.number().int().min(0).max(5),mode:z.literal("PREVIEW_ONLY")});
export async function drainCustomerSuccess() {
 const db=createSupabaseAdminClient();
 const {data,error}=await db.rpc("process_customer_success_due");
 if(error)throw Error("CUSTOMER_SUCCESS_WORKER_FAILED");
 const current=resultSchema.parse(data);
 const campaigns=await db.rpc("process_campaign_due_v1");
 if(campaigns.error)throw Error("CAMPAIGN_SCHEDULER_FAILED");
 return {...current,campaigns:z.strictObject({scheduled:z.number().int().min(0).max(125),campaigns:z.number().int().min(0).max(5),external_dispatch:z.literal(false)}).parse(campaigns.data)};
}
